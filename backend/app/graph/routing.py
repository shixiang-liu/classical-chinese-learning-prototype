import logging
from app.graph.state import PipelineState
from app.skills.registry import get_context_mode, is_task_enabled, should_force_hint_ladder

logger = logging.getLogger(__name__)

# content_type -> task_type -> allowed roles
_MATRIX: dict[str, dict[str, list[str]]] = {
    'general': {
        'general_chat': ['teacher', 'student', 'admin'],
    },
    'poem': {
        'general_chat': ['student'],
        'lesson_outline': ['teacher', 'admin'],
        'question_analysis': ['teacher', 'student'],
        'guided_explain': ['student'],
    },
    'classical_prose': {
        'general_chat': ['student'],
        'lesson_outline': ['teacher', 'admin'],
        'question_analysis': ['teacher', 'student'],
        'guided_explain': ['student'],
    },
    'question_set': {
        'general_chat': ['student'],
        'question_analysis': ['teacher', 'student'],
    },
}

_BLOOM_TARGETS: dict[str, str] = {
    'lesson_outline': 'analyze',
    'question_analysis': 'understand',
    'guided_explain': 'remember',
    'general_chat': 'understand',
}


def routing_node(state: PipelineState) -> PipelineState:
    content_type = state['content_type']
    role = state['role']
    task_type = state.get('task_type') or 'guided_explain'

    content_matrix = _MATRIX.get(content_type)
    if content_matrix is None:
        if state.get('raw_input') or state.get('source_text'):
            content_matrix = _MATRIX['general']
            content_type = 'general'
            task_type = 'general_chat'
        else:
            return {
                **state,
                'is_structured': False,
                'allowed_tasks': [],
                'selected_task': '',
                'context_mode': 'lite',
                'bloom_level_target': state.get('bloom_level', 'understand'),
                'error_code': 'ERR_UNRECOGNIZED_CONTENT',
            }

    if role == 'student' and task_type == 'question_analysis' and should_force_hint_ladder(state):
        task_type = 'guided_explain'

    allowed_roles = content_matrix.get(task_type) if is_task_enabled(task_type) else None
    if allowed_roles is None:
        fallback_order = (
            ['general_chat', 'guided_explain', 'question_analysis']
            if role == 'student'
            else ['general_chat', 'question_analysis', 'lesson_outline']
        )
        for candidate in fallback_order:
            if not is_task_enabled(candidate):
                continue
            candidate_roles = content_matrix.get(candidate)
            if candidate_roles and role in candidate_roles:
                task_type = candidate
                allowed_roles = candidate_roles
                break
        if allowed_roles is None:
            return {
                **state,
                'is_structured': False,
                'allowed_tasks': [task for task in content_matrix.keys() if is_task_enabled(task)],
                'selected_task': '',
                'bloom_level_target': state.get('bloom_level', 'understand'),
                'error_code': 'ERR_TASK_NOT_ALLOWED_FOR_CONTENT',
            }

    if role not in allowed_roles:
        return {
            **state,
            'is_structured': False,
            'allowed_tasks': [task for task in content_matrix.keys() if is_task_enabled(task)],
            'selected_task': '',
            'bloom_level_target': state.get('bloom_level', 'understand'),
            'error_code': 'ERR_ROLE_TASK_FORBIDDEN',
        }

    if task_type == 'lesson_outline' and not state.get('source_text') and not state.get('raw_input'):
        return {
            **state,
            'is_structured': False,
            'allowed_tasks': [task for task in content_matrix.keys() if is_task_enabled(task)],
            'selected_task': '',
            'bloom_level_target': state.get('bloom_level', 'understand'),
            'error_code': 'ERR_MISSING_SOURCE_TEXT',
        }

    bloom_target = _BLOOM_TARGETS.get(task_type, 'remember')
    reasons = list(state.get('pruning_reasons', []))
    if should_force_hint_ladder({**state, 'selected_task': task_type}):
        reasons.append('student_direct_answer_request_forced_to_hint_ladder')

    return {
        **state,
        'is_structured': True,
        'allowed_tasks': [task for task in content_matrix.keys() if is_task_enabled(task)],
        'selected_task': task_type,
        'context_mode': get_context_mode(task_type),
        'pruning_reasons': reasons,
        'bloom_level_target': bloom_target,
        'error_code': None,
    }
