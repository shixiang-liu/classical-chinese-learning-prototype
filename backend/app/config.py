import os
import json
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]

try:  # optional: read backend/.env if python-dotenv is installed
    from dotenv import load_dotenv

    load_dotenv(APP_ROOT / '.env')
except Exception:
    pass
GROK_CONFIG_PATH = Path.home() / '.config' / 'grok-search' / 'config.json'

MODEL_PATH = os.environ.get('SLM_MODEL_PATH', str(APP_ROOT / 'models' / 'GSW-Qwen3-4B-20251205-q4_k_m.gguf'))
MODEL_PROVIDER = os.environ.get('SLM_MODEL_PROVIDER', 'auto')
OLLAMA_BASE_URL = os.environ.get('SLM_OLLAMA_BASE_URL', 'http://127.0.0.1:11434')
OLLAMA_MODEL = os.environ.get('SLM_OLLAMA_MODEL', 'gsw-qwen3-4b')
OLLAMA_TIMEOUT_SECONDS = float(os.environ.get('SLM_OLLAMA_TIMEOUT_SECONDS', '600'))
DB_PATH = os.environ.get('SLM_DB_PATH', str(APP_ROOT / 'data' / 'db.sqlite'))
CHROMA_DIR = os.environ.get('SLM_CHROMA_DIR', str(APP_ROOT / 'data' / 'chroma'))
EXPORTS_DIR = os.environ.get('SLM_EXPORTS_DIR', str(APP_ROOT / 'exports'))


def _read_grok_config() -> dict:
    try:
        if GROK_CONFIG_PATH.exists():
            return json.loads(GROK_CONFIG_PATH.read_text(encoding='utf-8'))
    except Exception:
        pass
    return {}


_GROK_FILE_CONFIG = _read_grok_config()
GROK_API_URL = os.environ.get('GROK_API_URL', _GROK_FILE_CONFIG.get('GROK_API_URL', 'https://api.x.ai/v1'))
GROK_API_KEY = os.environ.get('GROK_API_KEY', _GROK_FILE_CONFIG.get('GROK_API_KEY', ''))
GROK_MODEL = os.environ.get('GROK_MODEL', _GROK_FILE_CONFIG.get('GROK_MODEL', 'grok-4.20-beta'))
ULTRARAG_BASE_URL = os.environ.get('ULTRARAG_BASE_URL', 'http://127.0.0.1:5050')
ULTRARAG_SEARCH_URL = os.environ.get('ULTRARAG_SEARCH_URL', '')
ULTRARAG_SERVER_ROOT = os.environ.get('ULTRARAG_SERVER_ROOT', '')
ULTRARAG_TIMEOUT_SECONDS = float(os.environ.get('ULTRARAG_TIMEOUT_SECONDS', '3'))

LANGFUSE_ENABLED = os.environ.get('LANGFUSE_ENABLED', '').lower() in {'1', 'true', 'yes', 'on'}
LANGFUSE_PUBLIC_KEY = os.environ.get('LANGFUSE_PUBLIC_KEY', '')
LANGFUSE_SECRET_KEY = os.environ.get('LANGFUSE_SECRET_KEY', '')
LANGFUSE_BASE_URL = os.environ.get('LANGFUSE_BASE_URL', 'https://cloud.langfuse.com')
