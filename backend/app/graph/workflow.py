from langgraph.graph import END, START, StateGraph

from app.graph.generate import generate_node
from app.graph.grounding import grounding_node
from app.graph.pruning import pruning_node
from app.graph.retrieve import retrieve_node
from app.graph.routing import routing_node
from app.graph.sediment import sediment_guided_explain_node
from app.graph.state import PipelineState
from app.graph.validate import validate_node


def _after_routing(state: PipelineState) -> str:
    if state.get('error_code') or not state.get('is_structured'):
        return 'end'
    return 'pruning'


def _after_pruning(state: PipelineState) -> str:
    if state.get('error_code') or not state.get('generation_allowed'):
        return 'end'
    if state.get('retrieval_needed'):
        return 'retrieve'
    return 'generate'


def _after_validate(state: PipelineState) -> str:
    if state.get('selected_task') == 'guided_explain' and state.get('validation_passed'):
        return 'sediment'
    return 'end'


_graph = StateGraph(PipelineState)
_graph.add_node('grounding', grounding_node)
_graph.add_node('routing', routing_node)
_graph.add_node('pruning', pruning_node)
_graph.add_node('retrieve', retrieve_node)
_graph.add_node('generate', generate_node)
_graph.add_node('validate', validate_node)
_graph.add_node('sediment', sediment_guided_explain_node)
_graph.add_edge(START, 'grounding')
_graph.add_edge('grounding', 'routing')
_graph.add_conditional_edges('routing', _after_routing, {'pruning': 'pruning', 'end': END})
_graph.add_conditional_edges('pruning', _after_pruning, {'retrieve': 'retrieve', 'generate': 'generate', 'end': END})
_graph.add_edge('retrieve', 'generate')
_graph.add_edge('generate', 'validate')
_graph.add_conditional_edges('validate', _after_validate, {'sediment': 'sediment', 'end': END})
_graph.add_edge('sediment', END)

workflow = _graph.compile()
