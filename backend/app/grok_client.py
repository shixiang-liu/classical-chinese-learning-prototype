import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_CONFIG_PATH = Path.home() / '.config' / 'grok-search' / 'config.json'
_DEFAULT_MODEL = 'grok-4.20-beta'


@dataclass
class GrokResponse:
    text: str
    citations: list[str]
    model: str
    used_web_search: bool


def _load_config_file() -> dict[str, Any]:
    try:
        if _DEFAULT_CONFIG_PATH.exists():
            return json.loads(_DEFAULT_CONFIG_PATH.read_text(encoding='utf-8'))
    except Exception as exc:
        logger.warning('failed to read grok-search config: %s', exc)
    return {}


def _get_config_value(name: str, file_config: dict[str, Any], default: str = '') -> str:
    value = os.environ.get(name)
    if value:
        return value
    file_value = file_config.get(name)
    if isinstance(file_value, str) and file_value:
        return file_value
    return default


def _extract_output_text(payload: dict[str, Any]) -> str:
    parts: list[str] = []
    for item in payload.get('output', []) or []:
        if not isinstance(item, dict) or item.get('type') != 'message':
            continue
        for content in item.get('content', []) or []:
            if not isinstance(content, dict):
                continue
            if content.get('type') == 'output_text':
                text = content.get('text')
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
    if parts:
        return '\n\n'.join(parts).strip()
    output_text = payload.get('output_text')
    if isinstance(output_text, str):
        return output_text.strip()
    return ''


def complete(*, prompt: str, web_search_enabled: bool = False, timeout: float = 45.0) -> GrokResponse:
    file_config = _load_config_file()
    api_url = _get_config_value('GROK_API_URL', file_config, 'https://api.x.ai/v1').rstrip('/')
    api_key = _get_config_value('GROK_API_KEY', file_config)
    model = _get_config_value('GROK_MODEL', file_config, _DEFAULT_MODEL)

    if not api_key:
        raise RuntimeError('GROK_API_KEY is not configured')

    body: dict[str, Any] = {
        'model': model,
        'input': [{'role': 'user', 'content': prompt}],
        'include': ['no_inline_citations'],
    }
    if web_search_enabled:
        body['tools'] = [{'type': 'web_search'}]

    response = httpx.post(
        f'{api_url}/responses',
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        },
        json=body,
        timeout=timeout,
    )
    response.raise_for_status()

    payload = response.json()
    text = _extract_output_text(payload)
    citations = [url for url in (payload.get('citations') or []) if isinstance(url, str) and url.strip()]
    if not text:
        raise RuntimeError('Grok returned empty text')
    return GrokResponse(
        text=text,
        citations=citations,
        model=model,
        used_web_search=web_search_enabled,
    )
