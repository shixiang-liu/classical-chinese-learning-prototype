from app.graph.state import PipelineState


def sediment_guided_explain_node(state: PipelineState) -> PipelineState:
    if state.get('selected_task') != 'guided_explain' or not state.get('validation_passed'):
        return {**state, 'sedimentation_summary': None}

    result = state.get('result_object') or {}
    summary = {
        'current_hint_level': result.get('current_hint_level'),
        'bloom_level': result.get('bloom_level') or state.get('bloom_level'),
        'next_challenge_hint': result.get('next_challenge_hint'),
        'evidence_refs': result.get('evidence_refs') or state.get('evidence_refs', []),
        'mastery_status': state.get('mastery_status'),
        'used_high_order_hint': result.get('current_hint_level') in {'hint_2', 'hint_3', 'answer'},
    }
    return {**state, 'sedimentation_summary': summary}
