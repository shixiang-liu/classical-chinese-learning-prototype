import logging
import chromadb
from chromadb.utils import embedding_functions
from app.config import CHROMA_DIR
from app.graph.state import PipelineState
from app.mcp import search_with_ultrarag

logger = logging.getLogger(__name__)

LITE_N = 3
FULL_N = 8

_client = None
_collection = None


def _get_embed_fn():
    return embedding_functions.DefaultEmbeddingFunction()


def init_chroma():
    global _client, _collection
    if _client is None:
        _client = chromadb.PersistentClient(path=CHROMA_DIR)
        _collection = _client.get_or_create_collection(
            name='slm_docs',
            embedding_function=_get_embed_fn(),
        )
        logger.info('ChromaDB initialised at %s', CHROMA_DIR)
    return _client


def get_collection():
    if _collection is None:
        init_chroma()
    return _collection


def add_chunks(chunks: list[str], metadatas: list[dict], ids: list[str]) -> None:
    col = get_collection()
    col.add(documents=chunks, metadatas=metadatas, ids=ids)


def _build_where_clause(state: PipelineState) -> dict:
    filters: list[dict] = [{'content_type': state['content_type']}]
    project_id = (state.get('project_id') or '').strip()
    if project_id:
        filters.append({'project_id': project_id})
    if len(filters) == 1:
        return filters[0]
    return {'$and': filters}


def _normalize_chunks(results: dict, mode: str) -> list[str]:
    documents = results.get('documents') or [[]]
    metadatas = results.get('metadatas') or [[]]
    raw_chunks: list[str] = documents[0] if documents else []
    raw_metadatas: list[dict] = metadatas[0] if metadatas else []

    chunks: list[str] = []
    for index, chunk in enumerate(raw_chunks):
        metadata = raw_metadatas[index] if index < len(raw_metadatas) and isinstance(raw_metadatas[index], dict) else {}
        title = metadata.get('title') or metadata.get('source_title') or metadata.get('project_title') or '未命名材料'
        if mode == 'lite':
            chunks.append(f'[{title}] {chunk[:120].strip()}')
        else:
            source = metadata.get('source') or metadata.get('source_id') or 'local'
            chunks.append(f'[{title} | source={source}] {chunk.strip()}')
    return chunks


def _normalize_external_chunks(passages: list[str], mode: str) -> list[str]:
    chunks: list[str] = []
    for chunk in passages:
        normalized = str(chunk).strip()
        if not normalized:
            continue
        if mode == 'lite':
            chunks.append(f'[UltraRAG] {normalized[:120].strip()}')
        else:
            chunks.append(f'[UltraRAG | source=ultrarag] {normalized}')
    return chunks


def _resolve_ultrarag_config(state: PipelineState) -> dict | None:
    runtime = state.get('mcp_runtime') if isinstance(state.get('mcp_runtime'), dict) else {}
    provider_configs = runtime.get('provider_configs') if isinstance(runtime.get('provider_configs'), dict) else {}
    provider_statuses = runtime.get('providers_detail') if isinstance(runtime.get('providers_detail'), dict) else {}

    config = provider_configs.get('ultrarag')
    status = provider_statuses.get('ultrarag')
    if not isinstance(config, dict) or not isinstance(status, dict):
        return None
    if not status.get('runtime_enabled'):
        return None
    return config


def _retrieve_with_ultrarag(state: PipelineState, top_k: int) -> list[str] | None:
    config = _resolve_ultrarag_config(state)
    if config is None:
        return None

    passages, error = search_with_ultrarag(
        state['raw_input'],
        top_k=top_k,
        config=config,
        source_text=state.get('source_text'),
    )
    if error:
        logger.warning('ultrarag retrieval failed, falling back to chroma (%s)', error)
        return None
    chunks = _normalize_external_chunks(passages, state['context_mode'])
    if chunks:
        logger.info('retrieval: %d UltraRAG chunks (mode=%s)', len(chunks), state['context_mode'])
        return chunks
    return None


def retrieve_node(state: PipelineState) -> PipelineState:
    if not state.get('is_structured') or state.get('error_code'):
        return {**state, 'retrieved_chunks': []}

    n = LITE_N if state['context_mode'] == 'lite' else FULL_N
    where = _build_where_clause(state)

    ultrarag_chunks = _retrieve_with_ultrarag(state, n)
    if ultrarag_chunks is not None:
        return {**state, 'retrieved_chunks': ultrarag_chunks}

    try:
        col = get_collection()
        count = col.count()
        if count == 0:
            return {**state, 'retrieved_chunks': []}
        results = col.query(
            query_texts=[state['raw_input']],
            n_results=min(n, count),
            where=where,
        )
        chunks = _normalize_chunks(results, state['context_mode'])
        logger.info('retrieval: %d chunks (mode=%s, project_id=%s)', len(chunks), state['context_mode'], state.get('project_id'))
        return {**state, 'retrieved_chunks': chunks}
    except Exception as exc:
        logger.error('retrieval failed: %s', exc)
        return {**state, 'retrieved_chunks': [], 'error_code': 'ERR_RETRIEVAL_FAILED'}
