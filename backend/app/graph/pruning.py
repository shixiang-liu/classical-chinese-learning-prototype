import logging

from app.graph.state import PipelineState

logger = logging.getLogger(__name__)

_MAX_CHUNKS = 4
_MAX_CHARS_PER_CHUNK = 220


def _trim_chunk(chunk: str) -> str:
    text = chunk.strip()
    if len(text) <= _MAX_CHARS_PER_CHUNK:
        return text
    return text[:_MAX_CHARS_PER_CHUNK].rstrip() + '...'


def pruning_node(state: PipelineState) -> PipelineState:
    if not state.get('is_structured') or state.get('error_code'):
        return {
            **state,
            'pruning_passed': False,
            'pruning_reasons': ['skipped_non_structured_or_error'],
            'retrieval_needed': False,
            'generation_allowed': False,
        }

    reasons: list[str] = []
    task = state.get('selected_task') or state.get('task_type')
    source_text = (state.get('source_text') or '').strip()
    raw_input = state.get('raw_input', '').strip()
    retrieved_chunks = state.get('retrieved_chunks') or []

    if source_text:
        state_context_mode = 'full'
        reasons.append('source_text_available')
    else:
        state_context_mode = state.get('context_mode', 'full')

    retrieval_needed = task not in {'guided_explain', 'general_chat'} or not source_text
    if task == 'general_chat':
        retrieval_needed = False
        reasons.append('general_chat_direct_reply')

    if len(raw_input) > 240:
        reasons.append('raw_input_long')
    if not source_text:
        reasons.append('source_text_missing')

    pruned_chunks = [_trim_chunk(chunk) for chunk in retrieved_chunks[:_MAX_CHUNKS] if chunk.strip()]
    if retrieved_chunks and len(retrieved_chunks) > len(pruned_chunks):
        reasons.append('retrieved_chunks_trimmed')

    logger.info('pruning: task=%s retrieval_needed=%s reasons=%s', task, retrieval_needed, reasons)
    return {
        **state,
        'context_mode': state_context_mode,
        'retrieved_chunks': pruned_chunks,
        'pruning_passed': True,
        'pruning_reasons': reasons or ['default_pass'],
        'retrieval_needed': retrieval_needed,
        'generation_allowed': True,
    }
