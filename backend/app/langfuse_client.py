from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Iterator

from app.config import LANGFUSE_BASE_URL, LANGFUSE_ENABLED, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY

logger = logging.getLogger(__name__)

_langfuse_client = None
_langfuse_disabled_reason: str | None = None


def _build_client():
    global _langfuse_client, _langfuse_disabled_reason
    if _langfuse_client is not None or _langfuse_disabled_reason is not None:
        return _langfuse_client
    if not LANGFUSE_ENABLED:
        _langfuse_disabled_reason = 'disabled'
        return None
    if not LANGFUSE_PUBLIC_KEY or not LANGFUSE_SECRET_KEY:
        _langfuse_disabled_reason = 'missing_credentials'
        logger.warning('Langfuse enabled but credentials are missing.')
        return None

    try:
        from langfuse import Langfuse
    except Exception as exc:  # pragma: no cover - optional dependency
        _langfuse_disabled_reason = 'sdk_unavailable'
        logger.warning('Langfuse SDK not available: %s', exc)
        return None

    try:
        _langfuse_client = Langfuse(
            public_key=LANGFUSE_PUBLIC_KEY,
            secret_key=LANGFUSE_SECRET_KEY,
            host=LANGFUSE_BASE_URL,
        )
    except Exception as exc:  # pragma: no cover - best effort init
        _langfuse_disabled_reason = 'init_failed'
        logger.warning('Failed to initialize Langfuse client: %s', exc)
        return None
    return _langfuse_client


def is_langfuse_enabled() -> bool:
    return _build_client() is not None


@contextmanager
def trace_pipeline(
    *,
    name: str,
    user_id: str,
    session_id: str,
    input_payload: dict[str, Any],
    metadata: dict[str, Any] | None = None,
) -> Iterator[Any | None]:
    client = _build_client()
    if client is None:
        yield None
        return

    span = None
    try:
        with client.start_as_current_span(name=name, input=input_payload) as current_span:
            span = current_span
            try:
                current_span.update_trace(
                    user_id=user_id,
                    session_id=session_id,
                    metadata=metadata or {},
                    tags=['slm', 'teaching-workspace'],
                )
            except Exception as exc:  # pragma: no cover - SDK API variance
                logger.warning('Failed to update Langfuse trace context: %s', exc)
            yield current_span
    except Exception as exc:  # pragma: no cover - best effort tracing
        logger.warning('Langfuse trace setup failed: %s', exc)
        yield span
    finally:
        try:
            client.flush()
        except Exception:
            pass


def annotate_span(span: Any | None, *, name: str, level: str = 'DEFAULT', status_message: str | None = None, metadata: dict[str, Any] | None = None) -> None:
    if span is None:
        return
    try:
        with span.start_as_current_span(name=name) as child_span:
            if metadata:
                child_span.update(metadata=metadata)
            if status_message:
                child_span.update_status(level=level, status_message=status_message)
    except Exception as exc:  # pragma: no cover - best effort tracing
        logger.warning('Langfuse child span failed: %s', exc)


def finalize_span(span: Any | None, *, output: dict[str, Any] | None = None, metadata: dict[str, Any] | None = None, level: str = 'DEFAULT', status_message: str | None = None) -> None:
    if span is None:
        return
    try:
        payload: dict[str, Any] = {}
        if output is not None:
            payload['output'] = output
        if metadata is not None:
            payload['metadata'] = metadata
        if payload:
            span.update(**payload)
        if status_message:
            span.update_status(level=level, status_message=status_message)
    except Exception as exc:  # pragma: no cover - best effort tracing
        logger.warning('Langfuse span finalization failed: %s', exc)
