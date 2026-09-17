from __future__ import annotations

import inspect
import logging
from typing import Any

import httpx

from app.config import ULTRARAG_SEARCH_URL, ULTRARAG_SERVER_ROOT, ULTRARAG_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)

_PYTHON_READY_SIGNATURE: tuple[str, str] | None = None
_ULTRARAG_RUNTIME_MODE: str | None = None


def _normalize_passages(payload: Any) -> list[str]:
    if isinstance(payload, str):
        text = payload.strip()
        return [text] if text else []

    if isinstance(payload, dict):
        for key in ("ret_psg", "results", "passages", "documents", "data"):
            if key in payload:
                return _normalize_passages(payload[key])
        return []

    if isinstance(payload, list):
        passages: list[str] = []
        for item in payload:
            if isinstance(item, str):
                text = item.strip()
                if text:
                    passages.append(text)
            elif isinstance(item, dict):
                for key in ("text", "content", "document", "passage", "chunk"):
                    value = item.get(key)
                    if isinstance(value, str) and value.strip():
                        passages.append(value.strip())
                        break
                else:
                    passages.extend(_normalize_passages(item.get("children")))
            elif isinstance(item, list):
                passages.extend(_normalize_passages(item))
        return passages

    return []


def _call_if_awaitable(value: Any) -> Any:
    if inspect.isawaitable(value):
        try:
            import asyncio

            return asyncio.run(value)
        except RuntimeError:
            logger.warning("ultrarag awaitable execution skipped because an event loop is already running")
            return None
    return value


def _ensure_python_runtime(config: dict[str, Any]) -> tuple[bool, str | None]:
    global _PYTHON_READY_SIGNATURE
    global _ULTRARAG_RUNTIME_MODE

    server_root = str(config.get("server_root") or ULTRARAG_SERVER_ROOT).strip()

    try:
        from ultrarag.api import ToolCall, initialize  # type: ignore
    except Exception:
        try:
            import ultrarag as ultrarag_module  # type: ignore

            if hasattr(ultrarag_module, "RAG"):
                signature = ("module", str(config.get("retriever_signature") or "default"))
                if _PYTHON_READY_SIGNATURE == signature:
                    _ULTRARAG_RUNTIME_MODE = "module"
                    return True, None
                _PYTHON_READY_SIGNATURE = signature
                _ULTRARAG_RUNTIME_MODE = "module"
                return True, None
        except Exception as exc:
            return False, f"ultrarag_import_failed:{type(exc).__name__}"
        return False, "ultrarag_python_runtime_unavailable"

    if not server_root:
        return False, "ultrarag_server_root_missing"

    signature = (server_root, str(config.get("retriever_signature") or "default"))
    if _PYTHON_READY_SIGNATURE == signature:
        _ULTRARAG_RUNTIME_MODE = "api"
        return True, None

    try:
        initialize(["retriever"], server_root=server_root)
        retriever_init_kwargs = config.get("retriever_init")
        if isinstance(retriever_init_kwargs, dict) and retriever_init_kwargs:
            _call_if_awaitable(ToolCall.retriever.retriever_init(**retriever_init_kwargs))
        _PYTHON_READY_SIGNATURE = signature
        _ULTRARAG_RUNTIME_MODE = "api"
        return True, None
    except Exception as exc:
        return False, f"ultrarag_init_failed:{type(exc).__name__}"


def _search_via_python(query: str, top_k: int, config: dict[str, Any], source_text: str | None = None) -> tuple[list[str], str | None]:
    ready, error = _ensure_python_runtime(config)
    if not ready:
        return [], error

    if _ULTRARAG_RUNTIME_MODE == "module":
        normalized_source = (source_text or "").strip()
        if not normalized_source:
            return [], "ultrarag_source_text_missing"
        try:
            import ultrarag as ultrarag_module  # type: ignore

            rag = ultrarag_module.RAG()
            rag.add(normalized_source, {"source": "source_text"})
            answer = str(rag.ask(query)).strip()
            if not answer or "No documents added yet" in answer or "No relevant information found" in answer or answer == "Information not found":
                return [], "ultrarag_empty_result"
            return [answer], None
        except Exception as exc:
            return [], f"ultrarag_search_failed:{type(exc).__name__}"

    try:
        from ultrarag.api import ToolCall  # type: ignore

        raw_result = _call_if_awaitable(
            ToolCall.retriever.retriever_search(
                query_list=[query],
                top_k=top_k,
            )
        )
        if raw_result is None:
            return [], "ultrarag_python_runtime_unavailable"
        passages = _normalize_passages(raw_result)
        return passages, None if passages else "ultrarag_empty_result"
    except Exception as exc:
        return [], f"ultrarag_search_failed:{type(exc).__name__}"


def _search_via_http(query: str, top_k: int, config: dict[str, Any]) -> tuple[list[str], str | None]:
    search_url = str(config.get("search_url") or ULTRARAG_SEARCH_URL).strip()
    if not search_url:
        return [], "ultrarag_search_url_missing"

    request_body = {
        "query": query,
        "query_list": [query],
        "top_k": top_k,
    }
    request_body.update(config.get("search_body") if isinstance(config.get("search_body"), dict) else {})

    try:
        with httpx.Client(timeout=ULTRARAG_TIMEOUT_SECONDS, follow_redirects=True, trust_env=False) as client:
            response = client.post(search_url, json=request_body)
            response.raise_for_status()
            payload = response.json()
        passages = _normalize_passages(payload)
        return passages, None if passages else "ultrarag_empty_result"
    except Exception as exc:
        return [], f"ultrarag_http_failed:{type(exc).__name__}"


def search_with_ultrarag(query: str, *, top_k: int, config: dict[str, Any], source_text: str | None = None) -> tuple[list[str], str | None]:
    mode = str(config.get("mode") or "auto").strip().lower()

    if mode in {"auto", "python"}:
        passages, error = _search_via_python(query, top_k, config, source_text=source_text)
        if passages:
            return passages, None
        if mode == "python":
            return [], error

    if mode in {"auto", "http"}:
        passages, error = _search_via_http(query, top_k, config)
        if passages:
            return passages, None
        return [], error

    return [], f"ultrarag_mode_unsupported:{mode}"
