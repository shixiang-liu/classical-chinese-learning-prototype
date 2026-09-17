from app.db import (
    create_evidence_event,
    create_result_object,
    create_session,
    get_session,
    update_session_status,
)
from app.graph.grounding import grounding_node
from app.graph.state import PipelineState
from app.graph.workflow import workflow
from app.langfuse_client import annotate_span, finalize_span, trace_pipeline

DEFAULT_BLOOM = 'understand'
DEFAULT_MASTERY = 'inferred'


def build_initial_state(
    *,
    raw_input: str,
    role: str,
    user_id: str,
    project_id: str | None = None,
    history_messages: list[dict[str, str]] | None = None,
    task_type: str | None = None,
    source_text: str | None = None,
    web_search_enabled: bool = False,
    web_search_requested: bool | None = None,
    mcp_runtime: dict[str, object] | None = None,
    bloom_level: str = DEFAULT_BLOOM,
    mastery_status: str = DEFAULT_MASTERY,
) -> PipelineState:
    return PipelineState(
        raw_input=raw_input,
        role=role,
        user_id=user_id,
        project_id=project_id,
        history_messages=history_messages or [],
        content_type='unknown',
        task_type=task_type or '',
        age_stage='primary',
        content_anchor=None,
        is_structured=True,
        allowed_tasks=[],
        selected_task='',
        pruning_passed=False,
        pruning_reasons=[],
        retrieval_needed=False,
        generation_allowed=False,
        context_mode='full',
        web_search_requested=bool(web_search_enabled if web_search_requested is None else web_search_requested),
        web_search_enabled=web_search_enabled,
        mcp_runtime=mcp_runtime,
        retrieved_chunks=[],
        source_text=source_text,
        raw_output='',
        validation_passed=False,
        validation_errors=[],
        error_code=None,
        result_object=None,
        evidence_refs=[],
        sedimentation_summary=None,
        bloom_level=bloom_level,
        bloom_level_target=DEFAULT_BLOOM,
        mastery_status=mastery_status,
    )


def run_pipeline(
    state: PipelineState,
    project_id: str | None = None,
    continue_session_id: str | None = None,
) -> tuple[dict, dict | None, PipelineState]:
    grounded = grounding_node(state)
    if continue_session_id:
        existing_session = get_session(continue_session_id)
        if existing_session is None:
            raise ValueError(f"session not found: {continue_session_id}")
        update_session_status(continue_session_id, 'running')
        session = {**existing_session, 'status': 'running'}
        session_id = continue_session_id
    else:
        session = create_session(
            user_id=state['user_id'],
            role=state['role'],
            task_type=grounded.get('task_type') or 'general_chat',
            context_mode=state['context_mode'],
            project_id=project_id,
            status='running',
        )
        session_id = session['session_id']

    with trace_pipeline(
        name='slm.run_pipeline',
        user_id=state['user_id'],
        session_id=session_id,
        input_payload={
            'raw_input': state['raw_input'][:500],
            'role': state['role'],
            'task_type': grounded.get('task_type'),
            'project_id': project_id,
        },
        metadata={
            'context_mode': state.get('context_mode'),
            'bloom_level': state.get('bloom_level'),
            'mastery_status': state.get('mastery_status'),
        },
    ) as trace_span:
        create_evidence_event(
            session_id=session_id,
            user_id=state['user_id'],
            event_type='user_input',
            actor=state['role'],
            payload={'raw_input': state['raw_input'][:500], 'task_type': grounded.get('task_type')},
            bloom_level=state['bloom_level'],
            mastery_status=state['mastery_status'],
        )

        annotate_span(
            trace_span,
            name='slm.input',
            metadata={'task_type': grounded.get('task_type'), 'project_id': project_id},
        )

        current = workflow.invoke(state)

        if current.get('error_code') in {'ERR_ROLE_TASK_FORBIDDEN', 'ERR_TASK_NOT_ALLOWED_FOR_CONTENT', 'ERR_MISSING_SOURCE_TEXT', 'ERR_UNRECOGNIZED_CONTENT'}:
            create_evidence_event(
                session_id=session_id,
                user_id=state['user_id'],
                event_type='routing_rejected',
                actor='system',
                payload={
                    'content_type': current.get('content_type'),
                    'task_type': current.get('task_type'),
                    'selected_task': current.get('selected_task'),
                    'is_structured': current.get('is_structured'),
                    'allowed_tasks': current.get('allowed_tasks', []),
                    'error_code': current.get('error_code'),
                },
                bloom_level=current.get('bloom_level'),
                mastery_status=current.get('mastery_status'),
                error_type=current.get('error_code'),
            )
            annotate_span(
                trace_span,
                name='slm.routing_rejected',
                level='ERROR',
                status_message=current.get('error_code'),
                metadata={'error_code': current.get('error_code')},
            )
            finalize_span(
                trace_span,
                output={'session_status': 'failed'},
                metadata={'error_code': current.get('error_code')},
                level='ERROR',
                status_message=current.get('error_code'),
            )
            update_session_status(session_id, 'failed')
            return {**session, 'status': 'failed'}, None, current

        if not current.get('is_structured'):
            annotate_span(
                trace_span,
                name='slm.unstructured_chat',
                metadata={'selected_task': current.get('selected_task') or current.get('task_type')},
            )
            finalize_span(
                trace_span,
                output={'session_status': 'completed', 'structured': False},
                metadata={'selected_task': current.get('selected_task') or current.get('task_type')},
            )
            update_session_status(session_id, 'completed')
            ordinary_chat_state = {
                **current,
                'validation_passed': True,
                'validation_errors': [],
                'result_object': None,
                'evidence_refs': [],
                'raw_output': '',
            }
            return {**session, 'status': 'completed'}, None, ordinary_chat_state

        create_evidence_event(
            session_id=session_id,
            user_id=state['user_id'],
            event_type='pruning',
            actor='system',
            payload={
                'passed': current.get('pruning_passed'),
                'reasons': current.get('pruning_reasons', []),
                'retrieval_needed': current.get('retrieval_needed'),
                'generation_allowed': current.get('generation_allowed'),
                'context_mode': current.get('context_mode'),
            },
            bloom_level=current.get('bloom_level'),
            mastery_status=current.get('mastery_status'),
            error_type=current.get('error_code'),
        )
        annotate_span(
            trace_span,
            name='slm.pruning',
            metadata={
                'passed': current.get('pruning_passed'),
                'reasons': current.get('pruning_reasons', []),
                'retrieval_needed': current.get('retrieval_needed'),
            },
        )

        create_evidence_event(
            session_id=session_id,
            user_id=state['user_id'],
            event_type='generation',
            actor='system',
            payload={
                'task_type': current.get('selected_task'),
                'bloom_level': current.get('bloom_level'),
                'retrieved_chunk_count': len(current.get('retrieved_chunks', [])),
            },
            bloom_level=current.get('bloom_level'),
            mastery_status=current.get('mastery_status'),
            error_type=current.get('error_code'),
        )
        annotate_span(
            trace_span,
            name='slm.generation',
            metadata={
                'selected_task': current.get('selected_task'),
                'retrieved_chunk_count': len(current.get('retrieved_chunks', [])),
            },
        )

        create_evidence_event(
            session_id=session_id,
            user_id=state['user_id'],
            event_type='validation',
            actor='system',
            payload={
                'passed': current['validation_passed'],
                'errors': current['validation_errors'],
                'error_code': current.get('error_code'),
            },
            bloom_level=current.get('bloom_level'),
            mastery_status=current.get('mastery_status'),
            error_type=current.get('error_code'),
        )
        annotate_span(
            trace_span,
            name='slm.validation',
            level='ERROR' if not current['validation_passed'] else 'DEFAULT',
            status_message=current.get('error_code') if not current['validation_passed'] else None,
            metadata={
                'passed': current['validation_passed'],
                'errors': current['validation_errors'],
            },
        )

        if not current['validation_passed']:
            finalize_span(
                trace_span,
                output={'session_status': 'failed'},
                metadata={'validation_errors': current['validation_errors']},
                level='ERROR',
                status_message=current.get('error_code') or 'validation_failed',
            )
            update_session_status(session_id, 'failed')
            return {**session, 'status': 'failed'}, None, current

        if current.get('sedimentation_summary'):
            create_evidence_event(
                session_id=session_id,
                user_id=state['user_id'],
                event_type='guided_explain_sedimentation',
                actor='system',
                payload=current['sedimentation_summary'],
                bloom_level=current.get('bloom_level'),
                mastery_status=current.get('mastery_status'),
            )
            annotate_span(
                trace_span,
                name='slm.sedimentation',
                metadata=current['sedimentation_summary'],
            )

        update_session_status(session_id, 'validated')

        result_status = 'ready' if current['evidence_refs'] else 'draft'
        review_status = 'accepted' if current.get('role') == 'student' else 'pending_review'
        result = create_result_object(
            session_id=session_id,
            result_type=current['selected_task'],
            content=current['result_object'],
            evidence_refs=current['evidence_refs'],
            status=result_status,
            review_status=review_status,
        )

        update_session_status(session_id, 'persisted')
        finalize_span(
            trace_span,
            output={
                'result_id': result['result_id'],
                'result_type': result['result_type'],
                'review_status': result['review_status'],
                'session_status': 'persisted',
            },
            metadata={
                'evidence_count': len(current['evidence_refs']),
                'bloom_level': current.get('bloom_level'),
            },
        )
        session = {**session, 'status': 'persisted'}
        return session, result, current
