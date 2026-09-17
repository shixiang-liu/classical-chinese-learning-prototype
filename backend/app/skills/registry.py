from collections.abc import Callable

from app.db import get_admin_config
from app.graph.state import PipelineState
from app.skills.guided_explain import build_general_prompt, build_prompt as build_guided_explain_prompt
from app.skills.lesson_outline import build_prompt as build_lesson_outline_prompt
from app.skills.question_analysis import build_prompt as build_question_analysis_prompt

PromptBuilder = Callable[[PipelineState], str]

_DIRECT_ANSWER_KEYWORDS = (
    "直接答案",
    "直接告诉我答案",
    "给我答案",
    "直接说答案",
    "不要提示",
    "别提示",
    "完整答案",
)

_TASK_CONFIG: dict[str, dict[str, object]] = {
    "lesson_outline": {
        "prompt_builder": build_lesson_outline_prompt,
        "context_mode": "full",
    },
    "question_analysis": {
        "prompt_builder": build_question_analysis_prompt,
        "context_mode": "full",
    },
    "guided_explain": {
        "prompt_builder": build_guided_explain_prompt,
        "context_mode": "lite",
    },
    "general_chat": {
        "prompt_builder": build_general_prompt,
        "context_mode": "lite",
    },
}


def _load_runtime_skill_overrides() -> dict[str, dict[str, object]]:
    row = get_admin_config("skills")
    config_json = row.get("config_json") if isinstance(row, dict) else None
    if not isinstance(config_json, dict):
        return {}
    result: dict[str, dict[str, object]] = {}
    for task, value in config_json.items():
        if isinstance(task, str) and isinstance(value, dict):
            result[task] = value
    return result


def get_runtime_skill_config(task: str) -> dict[str, object]:
    base = _TASK_CONFIG.get(task, _TASK_CONFIG["guided_explain"])
    override = _load_runtime_skill_overrides().get(task, {})
    return {
        **base,
        "enabled": bool(override.get("enabled", True)),
        "context_mode": str(override.get("context_mode", base["context_mode"])),
    }


def list_supported_tasks() -> list[str]:
    return list(_TASK_CONFIG.keys())


def get_context_mode(task: str) -> str:
    config = get_runtime_skill_config(task)
    return str(config["context_mode"])


def is_task_enabled(task: str) -> bool:
    config = get_runtime_skill_config(task)
    return bool(config["enabled"])


def get_prompt_builder(task: str) -> PromptBuilder:
    config = _TASK_CONFIG.get(task, _TASK_CONFIG["guided_explain"])
    return config["prompt_builder"]  # type: ignore[return-value]


def should_force_hint_ladder(state: PipelineState) -> bool:
    if state.get("role") != "student":
        return False
    text = f"{state.get('raw_input', '')}\n{state.get('source_text') or ''}"
    return any(keyword in text for keyword in _DIRECT_ANSWER_KEYWORDS)
