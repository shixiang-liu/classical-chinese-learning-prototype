import json
import logging
import os
import re
import time
from typing import Optional

import httpx

from app.config import MODEL_PATH, MODEL_PROVIDER, OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT_SECONDS
from app.grok_client import complete as complete_with_grok
from app.graph.state import PipelineState
from app.skills.registry import get_prompt_builder

logger = logging.getLogger(__name__)

ERR_MODEL_UNAVAILABLE = 'ERR_MODEL_UNAVAILABLE'

_model = None
_model_path: Optional[str] = None
_model_provider = 'stub'
_model_error: Optional[str] = None
_THREAD_COUNT = max(4, min(12, (os.cpu_count() or 8) - 2))


def load_model(path: str) -> None:
    global _model, _model_path, _model_provider, _model_error
    if _model is not None or _model_provider != 'stub':
        return

    errors: list[str] = []
    provider = (MODEL_PROVIDER or 'auto').strip().lower()

    if provider not in {'auto', 'llama_cpp', 'ollama'}:
        logger.warning('unknown model provider %s, falling back to auto', provider)
        provider = 'auto'

    if provider in {'auto', 'llama_cpp'}:
        try:
            from llama_cpp import Llama  # type: ignore

            logger.info('loading GGUF model from %s via llama_cpp', path)
            _model = Llama(
                model_path=path,
                n_ctx=4096,
                n_threads=_THREAD_COUNT,
                verbose=False,
            )
            _model_path = path
            _model_provider = 'llama_cpp'
            _model_error = None
            logger.info('model loaded via llama_cpp')
            return
        except Exception as exc:
            errors.append(f'llama_cpp: {exc}')
            logger.warning('model load via llama_cpp failed (%s)', exc)

    if provider in {'auto', 'ollama'}:
        try:
            with httpx.Client(timeout=10.0, trust_env=False) as client:
                response = client.get(f'{OLLAMA_BASE_URL.rstrip("/")}/api/tags')
                response.raise_for_status()
                payload = response.json()
            models = payload.get('models', []) if isinstance(payload, dict) else []
            available_names = {item.get('name', '') for item in models if isinstance(item, dict)}
            if OLLAMA_MODEL not in available_names and f'{OLLAMA_MODEL}:latest' not in available_names:
                raise RuntimeError(f'ollama model not found: {OLLAMA_MODEL}')
            _model = None
            _model_path = path
            _model_provider = 'ollama'
            _model_error = None
            logger.info('model connected via ollama: %s (%s)', OLLAMA_MODEL, OLLAMA_BASE_URL)
            return
        except Exception as exc:
            errors.append(f'ollama: {exc}')
            logger.warning('model load via ollama failed (%s)', exc)

    _model = None
    _model_provider = 'stub'
    _model_error = '; '.join(errors) if errors else 'no provider available'
    logger.warning('model load failed (%s)', _model_error)


def get_runtime_status() -> dict[str, Optional[str] | bool]:
    return {
        'provider': _model_provider,
        'model_path': _model_path,
        'ollama_model': OLLAMA_MODEL if _model_provider == 'ollama' else None,
        'ollama_base_url': OLLAMA_BASE_URL if _model_provider == 'ollama' else None,
        'ready': _model_provider != 'stub',
        'error': _model_error,
    }


def _call_ollama(prompt: str, max_tokens: int) -> str:
    prompt = f"/no_think\n{prompt}"
    with httpx.Client(
        timeout=httpx.Timeout(OLLAMA_TIMEOUT_SECONDS, connect=10.0),
        trust_env=False,
    ) as client:
        response = client.post(
            f'{OLLAMA_BASE_URL.rstrip("/")}/api/generate',
            json={
                'model': OLLAMA_MODEL,
                'prompt': prompt,
                'stream': False,
                'think': False,
                'options': {
                    'temperature': 0.3,
                    'num_ctx': 4096,
                    'num_predict': max_tokens,
                },
            },
        )
        response.raise_for_status()
        payload = response.json()

    text = str(payload.get('response', '')).strip()
    if not text:
        raise RuntimeError('ollama returned empty response')
    return text


def _call_model(prompt: str, max_tokens: int = 256) -> str:
    if _model_provider == 'stub':
        load_model(MODEL_PATH)
    if _model_provider == 'ollama':
        return _call_ollama(prompt, max_tokens=max_tokens)
    if _model is None:
        raise RuntimeError(_model_error or 'model provider unavailable')

    result = _model(prompt, max_tokens=max_tokens, temperature=0.3, stop=['```', '<|endoftext|>', '}\n\n'])
    text = result['choices'][0]['text'].strip()
    if not text:
        raise RuntimeError('llama_cpp returned empty response')
    return text


def _max_tokens_for_task(task: str) -> int:
    if task == 'general_chat':
        return 48
    if task == 'guided_explain':
        return 160
    if task == 'question_analysis':
        return 320
    if task == 'lesson_outline':
        return 480
    return 256


def _call_grok(prompt: str, *, web_search_enabled: bool) -> str:
    result = complete_with_grok(prompt=prompt, web_search_enabled=web_search_enabled)
    return json.dumps(
        {
            'title': '普通对话',
            'answer': result.text,
            'follow_up': None,
            'evidence_refs': result.citations or (['grok-web-search'] if web_search_enabled else ['grok-chat']),
        },
        ensure_ascii=False,
    )


def _build_prompt(state: PipelineState) -> str:
    task = state['selected_task'] or state['task_type']
    return get_prompt_builder(task)(state)


def _extract_json(text: str) -> dict:
    m = re.search(r'```(?:json)?\s*([\s\S]+?)```', text)
    if m:
        return json.loads(m.group(1).strip())

    candidates: list[str] = []
    start_idx = None
    depth = 0
    in_string = False
    escape = False

    for idx, ch in enumerate(text):
        if start_idx is None:
            if ch == '{':
                start_idx = idx
                depth = 1
                in_string = False
                escape = False
            continue

        if in_string:
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                candidates.append(text[start_idx:idx + 1])
                start_idx = None

    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue

    m = re.search(r'(\{[\s\S]+\})', text)
    if m:
        return json.loads(m.group(1))
    return json.loads(text)


def generate_node(state: PipelineState) -> PipelineState:
    if not state.get('is_structured') or state.get('error_code'):
        return {**state, 'raw_output': ''}

    prompt = _build_prompt(state)
    task = state.get('selected_task') or state.get('task_type') or 'general_chat'
    t0 = time.time()

    try:
        if state.get('web_search_enabled'):
            raw = _call_grok(prompt, web_search_enabled=bool(state.get('web_search_enabled')))
        else:
            raw = _call_model(prompt, max_tokens=_max_tokens_for_task(task))
    except Exception as exc:
        logger.error('generate_node failed: %s', exc)
        return {
            **state,
            'raw_output': '',
            'error_code': ERR_MODEL_UNAVAILABLE,
            'validation_passed': False,
            'validation_errors': [str(exc)],
            'result_object': None,
            'evidence_refs': [],
        }

    logger.info('generate_node: %.2fs, task=%s', time.time() - t0, task)
    return {**state, 'raw_output': raw}
