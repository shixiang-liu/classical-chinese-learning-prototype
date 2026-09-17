from contextlib import asynccontextmanager
import hashlib
import hmac
import logging
import os
import re
from typing import Any, Literal

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.auth import create_token, decode_token, get_current_user, hash_password, require_roles, verify_and_upgrade_password
from app.db import (
    create_bloom_override,
    create_challenge_attempt,
    create_evidence_event,
    create_project,
    create_teacher_feedback,
    create_template_version,
    create_user,
    delete_session_bundle,
    find_project_by_owner_and_title,
    generate_student_credentials,
    get_admin_config,
    get_latest_bloom_for_student,
    get_project,
    get_result,
    get_result_by_session,
    get_session,
    get_session_prompt_preview,
    get_teacher_mastery_snapshot,
    get_template_version,
    get_user_by_id,
    get_user_by_username,
    init_db,
    list_admin_config_versions,
    list_admin_configs,
    list_all_results,
    list_all_students,
    list_all_teachers,
    list_bloom_overrides_for_student,
    list_challenge_attempts_by_user,
    list_evidence_events,
    list_project_results,
    list_project_sessions,
    list_projects_for_user,
    list_results_for_teacher,
    list_sessions_by_student,
    list_sessions_for_user,
    list_students_by_teacher,
    list_teacher_feedback_for_student,
    list_template_versions,
    reset_student_password,
    set_active_template_version,
    update_project,
    update_result_review,
    update_result_status,
    update_session_project,
    update_user_password_hash,
    upsert_admin_config,
)
from app.config import MODEL_PATH, ULTRARAG_BASE_URL, ULTRARAG_SERVER_ROOT
from app.exporter import export_result, export_session
from app.file_extract import extract_text_from_file, list_supported_extensions
from app.graph.generate import ERR_MODEL_UNAVAILABLE, _call_model, _extract_json, get_runtime_status, load_model
from app.pipeline import build_initial_state, run_pipeline
from app.graph.workflow import workflow
from app.mcp import get_mcp_status_snapshot, resolve_runtime_controls
from app.skills.registry import get_context_mode, get_runtime_skill_config, list_supported_tasks
from app.schemas import (
    AdminConfigRequest,
    AdminConfigResponse,
    AdminSkillsSnapshotResponse,
    BatchCreateStudentsRequest,
    BloomOverrideRequest,
    ChallengePreviewRequest,
    ChallengePreviewResponse,
    ChallengeSubmitRequest,
    CreateStudentRequest,
    CreateTeacherRequest,
    ExportResponse,
    FileExtractResponse,
    HintStepRequest,
    HintStepResponse,
    LearnHouseBridgeRequest,
    LearnHouseBridgeResponse,
    LoginRequest,
    LoginResponse,
    ProjectCreateRequest,
    ProjectDetailResponse,
    ProjectListResponse,
    ProjectMutationResponse,
    ProjectResolveRequest,
    ProjectUpdateRequest,
    ResetPasswordRequest,
    ReviewResultRequest,
    RunTaskRequest,
    RunTaskResponse,
    TeacherFeedbackRequest,
    TemplateRollbackRequest,
    TemplateVersionActionResponse,
    TemplateVersionCreateRequest,
)

logger = logging.getLogger(__name__)


_BLOOM_SEQUENCE = ["remember", "understand", "apply", "analyze", "evaluate", "create"]
_FAILED_PIPELINE_ERRORS = {
    "ERR_ROLE_TASK_FORBIDDEN",
    "ERR_TASK_NOT_ALLOWED_FOR_CONTENT",
    "ERR_MISSING_SOURCE_TEXT",
    "ERR_UNRECOGNIZED_CONTENT",
}

_ALLOWED_RESULT_TASKS = {"lesson_outline", "question_analysis", "guided_explain", "general_chat"}
_BLOOM_LABELS = {
    "remember": "记忆",
    "understand": "理解",
    "apply": "应用",
    "analyze": "分析",
    "evaluate": "评价",
    "create": "创造",
}

TeacherScope = Literal["class", "school"]
_INITIAL_PLACEMENT_LEVELS = {"remember", "understand", "apply"}
_HINT_SEQUENCE = ["hint_1", "hint_2", "hint_3", "answer"]
_DEFAULT_ADMIN_CONFIGS = {
    "mcp": {
        "enabled": True,
        "providers": [
            "grok-search",
            {
                "name": "ultrarag",
                "config": {
                    "mode": "auto",
                    "base_url": ULTRARAG_BASE_URL,
                    "server_root": ULTRARAG_SERVER_ROOT,
                },
            },
        ],
        "hot_reload": True,
    },
    "skills": {
        "lesson_outline": {"enabled": True, "context_mode": "full"},
        "question_analysis": {"enabled": True, "context_mode": "full"},
        "guided_explain": {"enabled": True, "context_mode": "lite"},
        "general_chat": {"enabled": True, "context_mode": "lite"},
    },
    "capabilities": {
        "web_search_enabled": True,
        "file_upload_enabled": True,
        "think_audit_enabled": True,
        "teacher_release_required": True,
        "export_profile": "teacher-confirmed only",
        "model_profile": "school-safe",
    },
}
_DEFAULT_TEMPLATE_TEXT = {
    "lesson_outline": "生成教师可直接使用的备课提纲，突出教学目标、关键意象与课堂节奏。",
    "question_analysis": "生成结构化题目解析，包含分析步骤、依据与提示梯度。",
    "guided_explain": "面向学生分层提示，不直接给答案，优先引导思考。",
    "general_chat": "围绕古诗词学习场景做轻量问答与鼓励式回应。",
}
_PROJECTABLE_CONTENT_TYPES = {"poem", "classical_prose"}
_GENERIC_RESULT_TITLES = {"引导讲解", "题目解析", "备课提纲", "普通对话", "本次讲解"}
_PROJECT_TITLE_RE = re.compile(r"《([^》]{1,32})》")
_PROJECT_SUFFIX_RE = re.compile(r"(讲解|题目解析|教学提纲|备课提纲|学习项目|升级挑战)$")
_PROJECT_CONTEXT_MAX_ITEMS = 3
_PROJECT_CONTEXT_MAX_CHARS = 96
_INTERNAL_BRIDGE_KEY = os.environ.get("SLM_INTERNAL_BRIDGE_KEY", "slm-bridge-local-dev")  # dev-only default
_STUDENT_V1_POEM_FACTS = {
    "静夜思": {"author": "李白", "dynasty": "唐代", "era": "盛唐"},
    "春晓": {"author": "孟浩然", "dynasty": "唐代", "era": "盛唐"},
    "登鹳雀楼": {"author": "王之涣", "dynasty": "唐代", "era": "盛唐"},
    "望庐山瀑布": {"author": "李白", "dynasty": "唐代", "era": "盛唐"},
    "悯农": {"author": "李绅", "dynasty": "唐代", "era": "中唐"},
    "咏鹅": {"author": "骆宾王", "dynasty": "唐代", "era": "初唐"},
}
_STUDENT_V1_POEM_EXPLAINS = {
    "静夜思": "《静夜思》先写床前月光，亮得像地上结了一层霜；接着写诗人抬头望月，又低头想起故乡。整首诗用安静的月夜景色，写出了淡淡却很深的思乡之情。",
    "春晓": "《春晓》先写春天早晨睡醒后听见鸟叫，再写昨夜风雨，让人想到花可能落了不少。它用很短的几句诗，写出了春天的生机和惜春的心情。",
    "登鹳雀楼": "《登鹳雀楼》先写看到太阳落山、黄河奔流，再写“欲穷千里目，更上一层楼”。它一边写登楼所见的壮阔景色，一边告诉人想看得更远，就要站得更高。",
    "望庐山瀑布": "《望庐山瀑布》先写香炉峰在阳光下生出紫色云雾，再写瀑布像从天上落下。诗人用夸张的想象，把瀑布写得又高又壮观。",
}


def _get_admin_config_or_default(config_key: str) -> dict:
    stored = get_admin_config(config_key)
    if stored is not None:
        return stored
    default_config = _DEFAULT_ADMIN_CONFIGS[config_key]
    return {
        "config_key": config_key,
        "config_json": default_config,
        "updated_by": "system",
        "updated_at": "",
        "version_id": None,
        "summary": "default_config",
        "source_version_id": None,
    }


def _get_capabilities_config() -> dict[str, Any]:
    row = _get_admin_config_or_default("capabilities")
    config_json = row.get("config_json") if isinstance(row.get("config_json"), dict) else {}
    defaults = _DEFAULT_ADMIN_CONFIGS["capabilities"]
    return {**defaults, **config_json}


def _serialize_skill_registry() -> dict[str, dict[str, object]]:
    result: dict[str, dict[str, object]] = {}
    for task_type in list_supported_tasks():
        runtime_config = get_runtime_skill_config(task_type)
        result[task_type] = {
            "task_type": task_type,
            "enabled": bool(runtime_config.get("enabled", True)),
            "context_mode": str(runtime_config.get("context_mode", get_context_mode(task_type))),
            "registered": True,
            "last_error": None,
        }
    return result


def _serialize_mcp_status(*, force_reload: bool = False) -> dict[str, object]:
    config = _get_admin_config_or_default("mcp")
    return get_mcp_status_snapshot(config, force_reload=force_reload)


def _build_template_snapshot() -> tuple[list[dict], dict[str, dict[str, object]], dict[str, Any] | None]:
    versions = list_template_versions()
    if not versions:
        seeded = []
        for task_type, template_text in _DEFAULT_TEMPLATE_TEXT.items():
            seeded.append(
                create_template_version(
                    task_type,
                    template_text,
                    "system",
                    activate=True,
                    summary="default_template_seed",
                )
            )
        versions = seeded

    active_versions_by_task: dict[str, dict[str, object]] = {}
    for task_type in list_supported_tasks():
        active = next((item for item in versions if item["task_type"] == task_type and item.get("is_active")), None)
        if active is None:
            template_text = _DEFAULT_TEMPLATE_TEXT.get(task_type, "")
            active = create_template_version(
                task_type,
                template_text,
                "system",
                activate=True,
                summary="default_template_backfill",
            )
            versions = [active, *versions]
        active_versions_by_task[task_type] = active

    current_template_version = next((item for item in versions if item.get("is_active")), None)
    return versions, active_versions_by_task, current_template_version


def _build_admin_skills_snapshot() -> AdminSkillsSnapshotResponse:
    template_versions, active_versions_by_task, current_template_version = _build_template_snapshot()
    for config_key in ("mcp", "skills", "capabilities"):
        if get_admin_config(config_key) is None:
            upsert_admin_config(config_key, _DEFAULT_ADMIN_CONFIGS[config_key], "system", summary="default_config_seed")
    admin_configs = list_admin_configs()
    return AdminSkillsSnapshotResponse(
        current_template_version=current_template_version,
        template_versions=template_versions,
        admin_configs=admin_configs,
        skills=_serialize_skill_registry(),
        mcp=_serialize_mcp_status(),
        available_tasks=list_supported_tasks(),
        active_versions_by_task=active_versions_by_task,
    )


def _ensure_owned_student(student_id: str, user: dict) -> dict:
    student = get_user_by_id(student_id)
    if student is None or student["role"] != "student":
        raise HTTPException(status_code=404, detail="student not found")
    if user["role"] == "teacher" and student.get("teacher_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="forbidden")
    return student


def _next_bloom_level(current: str) -> str | None:
    try:
        idx = _BLOOM_SEQUENCE.index(current)
    except ValueError:
        return "understand"
    if idx >= len(_BLOOM_SEQUENCE) - 1:
        return None
    return _BLOOM_SEQUENCE[idx + 1]


def _build_challenge_payload(poem_title: str, from_level: str, to_level: str) -> tuple[dict, list[str], str, bool]:
    to_label = _BLOOM_LABELS.get(to_level, to_level)
    seed = int(hashlib.sha256(f"{poem_title}:{from_level}:{to_level}".encode("utf-8")).hexdigest()[:8], 16)
    challenge_type = ["multiple_choice", "fill_blank", "short_answer"][seed % 3]

    if challenge_type == "multiple_choice":
        question = {
            "challenge_type": "multiple_choice",
            "stem": f"下面哪一项最能说明《{poem_title}》表达的是怎样的感受？",
            "options": [
                "A. 春游时的轻松喜悦",
                "B. 看到月色时生出的思乡之情",
                "C. 与友人送别时的不舍",
                "D. 登高望远时的豪迈激昂",
            ],
            "answer_format": "直接回复选项字母，并补一句理由。",
            "target_level": to_level,
        }
        rubric = [
            "能选出合适选项",
            "理由和诗句意思一致",
            "回答简洁清楚",
        ]
    elif challenge_type == "fill_blank":
        question = {
            "challenge_type": "fill_blank",
            "stem": f"填空：在《{poem_title}》里，“举头望明月，低头思____”。补全后，再用一句话说明这句写出了什么感受。",
            "answer_format": "先填空，再补一句解释。",
            "target_level": to_level,
        }
        rubric = [
            "填空正确",
            "能说出诗句表达的感受",
            "表达完整",
        ]
    else:
        question = {
            "challenge_type": "short_answer",
            "stem": f"用两三句话说明《{poem_title}》为什么不只是写月光，而是在借景抒情。",
            "answer_format": "先说看到的景，再说背后的情感。",
            "target_level": to_level,
        }
        rubric = [
            "回答紧扣诗句或题意",
            "能说明自己的理解过程",
            "表达完整、条理清晰",
        ]

    difficulty = "advanced" if to_level in {"analyze", "evaluate", "create"} else "entry"
    review_needed = to_level in {"analyze", "evaluate", "create"}
    return question, rubric, difficulty, review_needed


def _score_challenge_answer(answer: str, to_level: str, question: dict | None = None) -> tuple[float, str | None, str | None]:
    text = answer.strip()
    challenge_type = (question or {}).get("challenge_type") if isinstance(question, dict) else None
    normalized = text.upper()

    if challenge_type == "multiple_choice":
        if not text:
            return 0.1, "expression_insufficient", "empty_answer"
        if normalized.startswith("B"):
            return 0.85, None, None
        if len(text) < 2:
            return 0.35, "memory_gap", "incorrect_option"
        return 0.45, "memory_gap", "reason_misaligned"

    if challenge_type == "fill_blank":
        normalized_text = re.sub(r"\s+", "", text)
        blank_terms = ("乡", "故乡", "思乡", "家乡")
        has_blank = any(term in normalized_text for term in blank_terms)
        if not text:
            return 0.1, "expression_insufficient", "empty_answer"
        if has_blank:
            if len(normalized_text) <= 2:
                return 0.72, None, None
            return 0.82, None, None
        if len(normalized_text) < 2:
            return 0.3, "memory_gap", "blank_not_filled"
        return 0.5, "memory_gap", "insufficient_support"

    length = len(text)
    if length < 8:
        return 0.2, "expression_insufficient", "answer_too_short"
    if length < 20:
        return 0.5, "memory_gap", "insufficient_support"
    score = 0.7
    if to_level in {"analyze", "evaluate", "create"} and length < 35:
        score = 0.6
    return score, None, None


def _clamp_initial_bloom(level: str | None) -> str:
    if level in _INITIAL_PLACEMENT_LEVELS:
        return level
    return "understand"


def _infer_initial_bloom_level(final_state: dict, result: dict | None) -> str:
    result_content = result.get("content_json") if isinstance(result, dict) else None
    result_bloom = result_content.get("bloom_level") if isinstance(result_content, dict) else None
    if isinstance(result_bloom, str):
        return _clamp_initial_bloom(result_bloom)

    selected_task = final_state.get("selected_task") or final_state.get("task_type")
    if selected_task == "question_analysis":
        return "apply"
    if selected_task == "general_chat":
        return "remember"
    return "understand"


def _record_initial_bloom_if_needed(*, user: dict, session: dict, result: dict | None, final_state: dict, had_prior_learning_records: bool, existing_bloom: dict | None) -> None:
    if user["role"] != "student" or had_prior_learning_records or existing_bloom is not None:
        return
    if session.get("status") not in {"completed", "persisted"}:
        return

    inferred_level = _infer_initial_bloom_level(final_state, result)
    create_evidence_event(
        session_id=session["session_id"],
        user_id=user["user_id"],
        event_type="initial_bloom_inferred",
        actor="system",
        payload={
            "reason": "first_learning_interaction",
            "selected_task": final_state.get("selected_task") or final_state.get("task_type"),
            "result_type": result.get("result_type") if result else None,
            "inferred_from": "first_task",
        },
        bloom_level=inferred_level,
        mastery_status="inferred",
    )


def _trim_context_text(value: str | None, limit: int = _PROJECT_CONTEXT_MAX_CHARS) -> str:
    text = (value or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _extract_project_title(*values: str | None) -> str | None:
    for value in values:
        text = (value or "").strip()
        if not text:
            continue
        match = _PROJECT_TITLE_RE.search(text)
        if match:
            return match.group(1).strip()

    for value in values:
        text = (value or "").strip()
        if not text or text in _GENERIC_RESULT_TITLES:
            continue
        normalized = _PROJECT_SUFFIX_RE.sub("", text).strip("《》“”\"' \n\t")
        if normalized and len(normalized) <= 24:
            return normalized
    return None


def _summarize_result_for_context(result: dict | None) -> str:
    if result is None:
        return ""
    content = result.get("content_json")
    if not isinstance(content, dict):
        return ""
    for key in ("hint_content", "answer", "question_text", "title"):
        value = content.get(key)
        if isinstance(value, str) and value.strip():
            return _trim_context_text(value)
    return ""


def _render_result_for_transcript(result: dict | None) -> str:
    if result is None:
        return ""
    content = result.get("content_json")
    if not isinstance(content, dict):
        return ""

    if isinstance(content.get("hint_content"), str) and content["hint_content"].strip():
        return content["hint_content"].strip()
    if isinstance(content.get("answer"), str) and content["answer"].strip():
        follow_up = content.get("follow_up")
        if isinstance(follow_up, str) and follow_up.strip():
            return f'{content["answer"].strip()}\n\n{follow_up.strip()}'
        return content["answer"].strip()
    if isinstance(content.get("question_text"), str) and content["question_text"].strip():
        steps = content.get("analysis_steps") if isinstance(content.get("analysis_steps"), list) else []
        step_lines = [str(item).strip() for item in steps if isinstance(item, str) and item.strip()]
        return "\n\n".join([content["question_text"].strip(), *step_lines]).strip()
    if isinstance(content.get("title"), str) and content["title"].strip():
        return content["title"].strip()
    return ""


def _build_challenge_prompt_text(preview: dict[str, Any]) -> str:
    payload = preview.get("question_json") if isinstance(preview, dict) else {}
    payload = payload if isinstance(payload, dict) else {}
    stem = str(payload.get("stem") or "").strip() or "请完成这道进阶挑战。"
    options = payload.get("options") if isinstance(payload.get("options"), list) else []
    option_lines = [str(item).strip() for item in options if str(item).strip()]
    answer_format = str(payload.get("answer_format") or "").strip()
    parts = [f"来一道{_BLOOM_LABELS.get(preview.get('to_level'), preview.get('to_level', ''))}挑战。", stem]
    if option_lines:
        parts.append("\n".join(option_lines))
    if answer_format:
        parts.append(answer_format)
    return "\n\n".join([part for part in parts if part]).strip()


def _humanize_challenge_failure(cause: str | None, challenge_type: str | None) -> str:
    if challenge_type == "fill_blank":
        if cause in {"blank_not_filled", "empty_answer"}:
            return "还没把空填完整，先把缺的词补上。"
        if cause == "insufficient_support":
            return "空已经填对了，再补一句你理解到的感受。"
    if challenge_type == "multiple_choice":
        if cause == "incorrect_option":
            return "这次选项不对，再看一眼诗句再选。"
        if cause == "reason_misaligned":
            return "选项方向接近了，再补一句更贴合诗意的理由。"
    if cause == "answer_too_short":
        return "回答有点短，再展开一点。"
    if cause == "empty_answer":
        return "你还没有提交答案。"
    return "这次还没通过，先把这一层理解再补强一点。"


def _build_challenge_feedback_text(*, passed: bool, next_level: str, current_level: str, inferred_cause: str | None, question: dict[str, Any]) -> str:
    if passed:
        return f'挑战通过，当前层级提升到 {_BLOOM_LABELS.get(next_level, next_level)}。'
    challenge_type = str(question.get("challenge_type") or "").strip() or None
    return _humanize_challenge_failure(inferred_cause, challenge_type)


def _serialize_session_messages(session_id: str) -> list[dict[str, Any]]:
    events = list_evidence_events(session_id)
    messages: list[dict[str, Any]] = []
    for event in events:
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        event_type = event.get("event_type")
        role = "assistant"
        text = ""
        extra: dict[str, Any] = {}
        if event_type == "user_input":
            text = str(payload.get("raw_input") or "").strip()
            role = "user"
        elif event_type == "assistant_output":
            text = str(payload.get("text") or "").strip()
            role = "assistant"
        elif event_type == "challenge_prompt":
            text = str(payload.get("text") or "").strip()
            role = "assistant"
            if isinstance(payload.get("preview"), dict):
                extra["challenge_preview"] = payload["preview"]
                extra["poem_title"] = payload.get("poem_title")
        elif event_type == "challenge_answer":
            text = str(payload.get("text") or "").strip()
            role = "user"
        elif event_type == "challenge_feedback":
            text = str(payload.get("text") or "").strip()
            role = "assistant"
        if not text:
            continue
        messages.append(
            {
                "message_id": event["event_id"],
                "role": role,
                "text": text,
                "created_at": event["created_at"],
                **extra,
            }
        )
    return messages


def _extract_active_challenge(session_id: str) -> dict[str, Any] | None:
    active: dict[str, Any] | None = None
    for message in _serialize_session_messages(session_id):
        preview = message.get("challenge_preview")
        if isinstance(preview, dict):
            active = {
                "message_id": message["message_id"],
                "poem_title": message.get("poem_title") or preview.get("poem_title"),
                "preview": preview,
            }
            continue
        if active and message.get("role") == "assistant":
            active = None
    return active


def _build_recent_challenge_context(session_id: str) -> str:
    messages = _serialize_session_messages(session_id)
    latest_prompt = None
    latest_answer = None
    latest_feedback = None
    for message in messages:
        if isinstance(message.get("challenge_preview"), dict):
            latest_prompt = message
            latest_answer = None
            latest_feedback = None
            continue
        if latest_prompt is None:
            continue
        if message.get("role") == "user":
            latest_answer = message
        else:
            latest_feedback = message
    if latest_prompt is None:
        return ""
    lines = ["最近一次进阶挑战：", f"题目：{_trim_context_text(str(latest_prompt.get('text') or ''), 140)}"]
    if latest_answer:
        lines.append(f"学生作答：{_trim_context_text(str(latest_answer.get('text') or ''), 100)}")
    if latest_feedback:
        lines.append(f"系统反馈：{_trim_context_text(str(latest_feedback.get('text') or ''), 100)}")
    return "\n".join(lines)


def _serialize_session(session: dict) -> dict[str, Any]:
    project_id = (session.get("project_id") or "").strip()
    project = get_project(project_id) if project_id else None
    return {
        **session,
        "prompt_preview": get_session_prompt_preview(session["session_id"]),
        "project_id": project_id or None,
        "project_title": project["title"] if project else None,
        "project_content_type": project["content_type"] if project else None,
    }


def _build_project_metrics(project: dict) -> dict[str, Any]:
    sessions = list_project_sessions(project["project_id"])
    results = list_project_results(project["project_id"])
    latest_session = sessions[0] if sessions else None
    latest_result = results[0] if results else None
    return {
        "session_count": len(sessions),
        "result_count": len(results),
        "ready_result_count": sum(1 for item in results if item.get("status") in {"ready", "exported"}),
        "pending_review_count": sum(1 for item in results if item.get("review_status") == "pending_review"),
        "latest_session_at": latest_session.get("created_at") if latest_session else None,
        "latest_result_at": latest_result.get("created_at") if latest_result else None,
        "latest_prompt_preview": get_session_prompt_preview(latest_session["session_id"]) if latest_session else None,
    }


def _serialize_project(project: dict) -> dict[str, Any]:
    metrics = _build_project_metrics(project)
    return {
        **project,
        "latest_prompt_preview": metrics.get("latest_prompt_preview"),
        "latest_session_at": metrics.get("latest_session_at"),
        "latest_result_at": metrics.get("latest_result_at"),
        "session_count": metrics.get("session_count"),
        "result_count": metrics.get("result_count"),
    }


def _get_visible_project(project_id: str, user: dict) -> dict:
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    visible = {item["project_id"] for item in list_projects_for_user(user)}
    if project_id not in visible:
        raise HTTPException(status_code=403, detail="forbidden")
    return project


def _get_visible_session(session_id: str, user: dict) -> dict:
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    visible_sessions = {item["session_id"] for item in list_sessions_for_user(user)}
    if session_id not in visible_sessions:
        raise HTTPException(status_code=403, detail="forbidden")
    return session


def _build_project_context(project: dict) -> str:
    title = project.get("title") or "当前学习项目"
    sessions = list_project_sessions(project["project_id"])[:_PROJECT_CONTEXT_MAX_ITEMS]
    if not sessions:
        return f"当前学习项目：《{title}》"

    lines = [f"当前学习项目：《{title}》"]
    for session in reversed(sessions):
        prompt_preview = get_session_prompt_preview(session["session_id"])
        if prompt_preview:
            lines.append(f"学生刚才问过：{_trim_context_text(prompt_preview)}")
        result_summary = _summarize_result_for_context(get_result_by_session(session["session_id"]))
        if result_summary:
            lines.append(f"系统刚才讲到：{result_summary}")
    return "\n".join(lines)


def _merge_project_context(source_text: str | None, project: dict | None) -> str | None:
    if project is None:
        return source_text
    project_context = _build_project_context(project)
    if source_text and source_text.strip():
        return f"{project_context}\n\n补充材料：\n{source_text.strip()}"
    return project_context


def _resolve_or_create_project_for_result(*, user: dict, raw_input: str, source_text: str | None, result: dict | None, content_type: str | None) -> dict | None:
    if user["role"] != "student" or content_type not in _PROJECTABLE_CONTENT_TYPES:
        return None
    result_title = None
    if result and isinstance(result.get("content_json"), dict):
        result_title = result["content_json"].get("title")
    project_title = _extract_project_title(result_title, raw_input, source_text)
    if not project_title:
        return None
    existing = find_project_by_owner_and_title(user["user_id"], user["role"], project_title, content_type)
    if existing is not None:
        return existing
    return create_project(
        title=project_title,
        content_type=content_type,
        owner_id=user["user_id"],
        owner_role=user["role"],
        status="active",
    )


def _merge_history_context(source_text: str | None, history_messages: list[dict[str, str]] | None) -> str | None:
    source = (source_text or "").strip()
    history = history_messages or []
    if not history:
        return source or None

    rendered: list[str] = []
    for item in history[-6:]:
        role = "用户" if item.get("role") == "user" else "助手"
        text = (item.get("text") or "").strip()
        if text:
            rendered.append(f"{role}：{text}")

    if not rendered:
        return source or None

    history_context = "最近对话：\n" + "\n".join(rendered)
    if source:
        return f"{history_context}\n\n补充材料：\n{source}"
    return history_context


def _normalize_content_anchor(anchor: dict | None, *, raw_input: str, source_text: str | None, result: dict | None, content_type: str | None) -> dict[str, Any]:
    current_content_type = content_type or (anchor or {}).get("content_type") or "unknown"
    title = (anchor or {}).get("title")
    confidence = (anchor or {}).get("confidence") or "none"
    if title:
        return {
            "content_type": current_content_type,
            "title": title,
            "confidence": confidence,
        }

    result_title = None
    if result and isinstance(result.get("content_json"), dict):
        result_title = result["content_json"].get("title")
    fallback_title = _extract_project_title(result_title, raw_input, source_text)
    if not fallback_title:
        return {
            "content_type": current_content_type,
            "title": None,
            "confidence": "none",
        }

    return {
        "content_type": current_content_type,
        "title": fallback_title,
        "confidence": "low",
    }


def _resolve_or_create_project_for_anchor(*, user: dict, anchor: dict | None) -> dict | None:
    if user["role"] != "student" or not anchor:
        return None

    content_type = anchor.get("content_type")
    project_title = (anchor.get("title") or "").strip()
    if content_type not in _PROJECTABLE_CONTENT_TYPES or not project_title:
        return None

    existing = find_project_by_owner_and_title(user["user_id"], user["role"], project_title, content_type)
    if existing is not None:
        return existing
    return create_project(
        title=project_title,
        content_type=content_type,
        owner_id=user["user_id"],
        owner_role=user["role"],
        status="active",
    )


def _ensure_user(*, username: str, display_name: str, password: str, role: str, teacher_id: str | None = None) -> dict:
    existing = get_user_by_username(username)
    if existing is not None:
        return existing
    return create_user(
        username=username,
        display_name=display_name,
        password_hash=hash_password(password),
        role=role,
        teacher_id=teacher_id,
    )


def _require_internal_bridge(request: Request) -> None:
    provided_key = request.headers.get("X-SLM-Internal-Key", "")
    if not provided_key or not hmac.compare_digest(provided_key, _INTERNAL_BRIDGE_KEY):
        raise HTTPException(status_code=401, detail="invalid internal bridge key")


def _infer_result_type_from_content(content: dict[str, Any]) -> str | None:
    if "hint_content" in content:
        return "guided_explain"
    if "question_text" in content and "analysis_steps" in content:
        return "question_analysis"
    if "teaching_goals" in content and "activity_flow" in content:
        return "lesson_outline"
    if "answer" in content:
        return "general_chat"
    return None


def _format_embedded_json_text(raw_text: str) -> str | None:
    cleaned = raw_text.strip()
    if not cleaned:
        return None

    try:
        payload = _extract_json(cleaned)
    except Exception:
        payload = None

    if not isinstance(payload, dict):
        return None

    inferred_type = _infer_result_type_from_content(payload)
    if not inferred_type:
        return None
    return _format_bridge_text(inferred_type, payload)


def _format_bridge_text(result_type: str, content: dict[str, Any]) -> str:
    if result_type == "general_chat":
        answer_text = str(content.get("answer") or "").strip()
        embedded_text = _format_embedded_json_text(answer_text)
        if embedded_text:
            return embedded_text
        return answer_text

    if result_type == "guided_explain":
        parts = [str(content.get("hint_content") or "").strip()]
        next_hint = str(content.get("next_challenge_hint") or "").strip()
        if next_hint:
            parts.append(f"下一步可以继续想：{next_hint}")
        return "\n\n".join(part for part in parts if part)

    if result_type == "question_analysis":
        lines: list[str] = []
        title = str(content.get("title") or "题目解析").strip()
        question_text = str(content.get("question_text") or "").strip()
        if title:
            lines.append(title)
        if question_text:
            lines.append(f"题目：{question_text}")
        analysis_steps = [str(step).strip() for step in (content.get("analysis_steps") or []) if str(step).strip()]
        if analysis_steps:
            lines.append("分析步骤：")
            lines.extend(f"{index}. {step}" for index, step in enumerate(analysis_steps, start=1))
        hint_ladder = content.get("hint_ladder") or {}
        if isinstance(hint_ladder, dict):
            answer = str(hint_ladder.get("answer") or "").strip()
            if answer:
                lines.append(f"参考答案：{answer}")
        return "\n".join(lines).strip()

    if result_type == "lesson_outline":
        lines = [str(content.get("title") or "教学提纲").strip()]
        teaching_goals = [str(item).strip() for item in (content.get("teaching_goals") or []) if str(item).strip()]
        key_points = [str(item).strip() for item in (content.get("key_points") or []) if str(item).strip()]
        difficult_points = [str(item).strip() for item in (content.get("difficult_points") or []) if str(item).strip()]
        activity_flow = content.get("activity_flow") or []
        if teaching_goals:
            lines.append("教学目标：")
            lines.extend(f"- {item}" for item in teaching_goals)
        if key_points:
            lines.append("教学重点：")
            lines.extend(f"- {item}" for item in key_points)
        if difficult_points:
            lines.append("教学难点：")
            lines.extend(f"- {item}" for item in difficult_points)
        if isinstance(activity_flow, list) and activity_flow:
            lines.append("课堂流程：")
            for item in activity_flow:
                if not isinstance(item, dict):
                    continue
                step = item.get("step")
                name = str(item.get("name") or "").strip()
                duration = str(item.get("duration") or "").strip()
                description = str(item.get("description") or "").strip()
                prefix = f"{step}. " if step else "- "
                title_part = name or "环节"
                suffix = f"（{duration}）" if duration else ""
                lines.append(f"{prefix}{title_part}{suffix}")
                if description:
                    lines.append(description)
        return "\n".join(line for line in lines if line).strip()

    return str(content.get("answer") or content.get("hint_content") or content.get("title") or "").strip()


def _trim_learnhouse_bridge_context(value: str | None, limit: int) -> str:
    text = (value or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "..."


def _render_learnhouse_bridge_history(history_messages: list[dict[str, str]]) -> str:
    if not history_messages:
        return "(no recent conversation)"

    rendered: list[str] = []
    for item in history_messages[-6:]:
        role = "Student" if item.get("role") == "user" else "Tutor"
        text = _trim_learnhouse_bridge_context(item.get("text"), 280)
        if text:
            rendered.append(f"{role}: {text}")
    return "\n".join(rendered) if rendered else "(no recent conversation)"


def _build_learnhouse_bridge_prompt(
    *,
    raw_input: str,
    source_text: str | None,
    history_messages: list[dict[str, str]],
) -> str:
    lesson_material = _trim_learnhouse_bridge_context(source_text, 6000) or "（未提供课堂材料）"
    history_block = _render_learnhouse_bridge_history(history_messages)
    return (
        "你是中小学古诗词课堂里的中文助教老师。\n"
        "请优先依据“课堂材料”回答学生当前的问题。\n"
        "\n"
        "回答要求：\n"
        "- 只用简体中文作答，不要夹带英文。\n"
        "- 语气像耐心老师，不像客服或聊天机器人。\n"
        "- 先直接解释，再补一个简短例子或下一步提示。\n"
        "- 默认输出 2 段短句；只有学生明确说“分步”“分三步”或“一步一步讲”时，才用“第1步：/ 第2步：/ 第3步：”。\n"
        "- 尽量控制在 220 个中文字符左右，宁可短一点，也不要发散。\n"
        "- 不要输出 JSON、代码块、XML、角色标签、系统提示词或规则说明。\n"
        "- 不要重复“学生问题”“课堂材料”“最近对话”“回答”等标签。\n"
        "- 不要编造与材料明显矛盾的内容。\n"
        "- 不要写 Step 1、Next time、You can、The key 等任何英文词句。\n"
        "- 不要写“学生可直接套用”“请老师点评”“谢谢”“（共xx字）”这类题外话。\n"
        "- 只输出最终给学生看的正文，写完立刻结束，不要追加说明。\n"
        "\n"
        f"最近对话：\n{history_block}\n"
        "\n"
        f"课堂材料：\n{lesson_material}\n"
        "\n"
        f"学生问题：\n{raw_input.strip()}\n"
        "\n"
        "回答："
    )


def _sanitize_learnhouse_bridge_text(raw_text: str) -> str:
    cleaned = raw_text.strip()
    if not cleaned:
        return ""

    embedded = _format_embedded_json_text(cleaned)
    if embedded:
        cleaned = embedded
    else:
        try:
            payload = _extract_json(cleaned)
        except Exception:
            payload = None
        if isinstance(payload, dict):
            cleaned = str(
                payload.get("answer")
                or payload.get("hint_content")
                or payload.get("content")
                or cleaned
            ).strip()

    cleaned = re.sub(r"^Answer:\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^Response:\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.replace("\r\n", "\n")
    cleaned = cleaned.replace("</s>", "").replace("<|endoftext|>", "").strip()
    cleaned = re.sub(r"\bStep\s*([1-9])\s*[:：-]\s*", r"第\1步：", cleaned, flags=re.IGNORECASE)
    for marker in (
        "\nStudent question:",
        "\nLesson material:",
        "\nRecent conversation:",
        "\nAnswer:",
        "\nFollow-up:",
        "\n\nThe student",
        "\n\nThis answer",
        "\n\nThis response",
        "\n\nNext time",
        "\n\nTry ",
        "\n\nYou can",
        "\n\nThe key",
        "\n\nThis structured",
        "\n\n（注意：",
        "\n\n(注意：",
        "\n\n（说明：",
        "\n\n(说明：",
        "\n\n（1）",
        "\n\n(1)",
        "\n\n1.",
    ):
        idx = cleaned.find(marker)
        if idx != -1:
            cleaned = cleaned[:idx].strip()
    cleaned = re.sub(r"Student question:\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"Lesson material:\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"Recent conversation:\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"Follow-up:\s*", "", cleaned, flags=re.IGNORECASE)

    leak_markers = (
        "no_think",
        "You are an excellent K-12 teacher inside an AI learning platform.",
        "You are an excellent K-12 teacher inside an AI",
        "Use the lesson material",
        "Keep the tone",
        "Give a direct explanation",
        "Do not repeat the labels",
        "Stop immediately after the teaching answer",
        "Do not invent details",
        "你是中小学古诗词课堂里的中文助教老师",
        "回答要求：",
        "最近对话：",
        "课堂材料：",
        "学生问题：",
        "回答：",
    )
    earliest_leak_index: int | None = None
    lowered = cleaned.lower()
    for marker in leak_markers:
        idx = lowered.find(marker.lower())
        if idx != -1 and (earliest_leak_index is None or idx < earliest_leak_index):
            earliest_leak_index = idx
    if earliest_leak_index is not None:
        cleaned = cleaned[:earliest_leak_index].strip()

    banned_line_patterns = (
        r"^\s*no_think\b",
        r"^\s*you are an excellent\b",
        r"^\s*use the lesson material\b",
        r"^\s*keep the tone\b",
        r"^\s*give a direct explanation\b",
        r"^\s*do not repeat the labels\b",
        r"^\s*stop immediately after the teaching answer\b",
        r"^\s*do not invent details\b",
        r"^\s*student question\s*[:：]",
        r"^\s*lesson material\s*[:：]",
        r"^\s*recent conversation\s*[:：]",
        r"^\s*answer\s*[:：]",
        r"^\s*follow-up\s*[:：]",
        r"^\s*你是中小学古诗词课堂里的中文助教老师",
        r"^\s*回答要求\s*[:：]",
        r"^\s*学生问题\s*[:：]",
        r"^\s*课堂材料\s*[:：]",
        r"^\s*最近对话\s*[:：]",
        r"^\s*回答\s*[:：]",
    )
    filtered_lines = []
    for line in cleaned.splitlines():
        if any(re.search(pattern, line, flags=re.IGNORECASE) for pattern in banned_line_patterns):
            continue
        filtered_lines.append(line)
    cleaned = "\n".join(filtered_lines).strip()

    if re.search(r"[\u4e00-\u9fff]", cleaned):
        trailing_ascii = re.search(r"\n{2,}\s*[A-Za-z][\s\S]*$", cleaned)
        if trailing_ascii:
            cleaned = cleaned[: trailing_ascii.start()].strip()
        trailing_meta_note = re.search(r"\n{2,}[（(](?:注意|说明)[:：][\s\S]*$", cleaned)
        if trailing_meta_note:
            cleaned = cleaned[: trailing_meta_note.start()].strip()
        trailing_prompt_echo = re.search(r"\n{2,}(?:[（(]\d+[）)]|\d+\.)[\s\S]*$", cleaned)
        if trailing_prompt_echo:
            cleaned = cleaned[: trailing_prompt_echo.start()].strip()

    for marker in ("学生可直接套用", "请老师点评", "谢谢"):
        idx = cleaned.find(marker)
        if idx > 60:
            cleaned = cleaned[:idx].rstrip("，。；：: ")
            break
    cleaned = re.sub(r"[（(]\s*\d+\s*字\s*[）)]\s*$", "", cleaned).strip()
    cleaned = re.sub(r"\n+\s*[（(\[【\"'“‘「『]+\s*$", "", cleaned).strip()
    cleaned = re.sub(r"[（(\[【\"'“‘「『]+\s*$", "", cleaned).strip()

    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    if len(cleaned) > 520:
        sentence_endings = [". ", "! ", "? ", "。", "！", "？", "\n"]
        cutoff = 520
        for ending in sentence_endings:
            idx = cleaned.rfind(ending, 0, 520)
            if idx > 120:
                cutoff = idx + (0 if ending == "\n" else len(ending.strip()))
                break
        cleaned = cleaned[:cutoff].strip()
    return cleaned.strip()


def _build_learnhouse_bridge_state(
    *,
    raw_input: str,
    source_text: str | None,
    history_messages: list[dict[str, str]],
    role: str,
    user_id: str | None,
    content: dict[str, Any],
) -> dict[str, Any]:
    return {
        "raw_input": raw_input,
        "role": role,
        "user_id": user_id,
        "history_messages": history_messages,
        "source_text": source_text,
        "task_type": "guided_explain",
        "selected_task": "guided_explain",
        "content_type": "general",
        "context_mode": "full",
        "validation_passed": True,
        "generation_allowed": True,
        "pruning_passed": True,
        "pruning_reasons": ["learnhouse_bridge_activity_material"],
        "retrieval_needed": False,
        "result_object": content,
        "error_code": None,
    }


def _run_learnhouse_direct_tutor(
    *,
    raw_input: str,
    source_text: str | None,
    history_messages: list[dict[str, str]],
    role: str,
    user_id: str | None,
) -> LearnHouseBridgeResponse | None:
    if role != "student" or not (source_text or "").strip():
        return None

    prompt = _build_learnhouse_bridge_prompt(
        raw_input=raw_input,
        source_text=source_text,
        history_messages=history_messages,
    )
    raw_model_text = _call_model(prompt, max_tokens=180)
    text = _sanitize_learnhouse_bridge_text(raw_model_text)
    if not text:
        return None

    content = {
        "title": "Activity Tutor",
        "bloom_level": "understand",
        "current_hint_level": "hint_2",
        "hint_content": text,
        "next_challenge_hint": None,
        "evidence_refs": ["source-text"] if (source_text or "").strip() else ["model-generated"],
    }
    state = _build_learnhouse_bridge_state(
        raw_input=raw_input,
        source_text=source_text,
        history_messages=history_messages,
        role=role,
        user_id=user_id,
        content=content,
    )
    return LearnHouseBridgeResponse(
        text=text,
        result_type="guided_explain",
        content=content,
        state=state,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    load_model(MODEL_PATH)
    _ensure_user(
        username="admin",
        display_name="演示管理员",
        password="admin123456",
        role="admin",
    )
    teacher = _ensure_user(
        username="teacher",
        display_name="演示教师",
        password="teacher123456",
        role="teacher",
    )
    _ensure_user(
        username="student",
        display_name="演示学生",
        password="student123456",
        role="student",
        teacher_id=teacher["user_id"],
    )
    _ensure_user(
        username="student_a",
        display_name="学生甲",
        password="student123456",
        role="student",
        teacher_id=teacher["user_id"],
    )
    yield


app = FastAPI(title="SLM V1", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def handle_exception(_, exc: Exception):
    logger.exception("unhandled exception")
    return JSONResponse(
        status_code=500,
        content={"error": "ERR_INTERNAL", "message": str(exc), "fallback": "请稍后重试"},
    )


@app.get("/health")
def health():
    return {"status": "ok", "model": get_runtime_status()}


@app.post("/auth/login", response_model=LoginResponse)
def login(body: LoginRequest):
    user = get_user_by_username(body.username)
    if user is None:
        raise HTTPException(status_code=401, detail="invalid username or password")
    verified, upgraded_hash = verify_and_upgrade_password(body.password, user)
    if not verified:
        raise HTTPException(status_code=401, detail="invalid username or password")
    if upgraded_hash is not None:
        update_user_password_hash(user["user_id"], upgraded_hash)
        user = get_user_by_id(user["user_id"])
    token = create_token(user, remember_me=body.remember_me)
    safe_user = {k: v for k, v in user.items() if k != "password_hash"}
    safe_user["session"] = {
        "user_id": user["user_id"],
        "role": user["role"],
        "remember_me": body.remember_me,
        "exp": decode_token(token)["exp"],
    }
    return LoginResponse(access_token=token, user=safe_user)


@app.get("/me")
def me(user=Depends(get_current_user)):
    return {k: v for k, v in user.items() if k != "password_hash"}


@app.post("/users/students")
def create_student(body: CreateStudentRequest, user=Depends(require_roles("teacher", "admin"))):
    if get_user_by_username(body.username) is not None:
        raise HTTPException(status_code=409, detail="username already exists")
    teacher_id = user["user_id"] if user["role"] == "teacher" else body.teacher_id
    if teacher_id is None:
        raise HTTPException(status_code=422, detail="teacher_id is required for admin-created students")
    teacher = get_user_by_id(teacher_id)
    if teacher is None or teacher["role"] != "teacher":
        raise HTTPException(status_code=404, detail="teacher not found")
    student = create_user(
        username=body.username,
        display_name=body.display_name,
        password_hash=hash_password(body.password),
        role="student",
        teacher_id=teacher_id,
    )
    return {k: v for k, v in student.items() if k != "password_hash"}


@app.post("/users/students/batch")
def batch_create_students(body: BatchCreateStudentsRequest, user=Depends(require_roles("teacher", "admin"))):
    teacher_id = user["user_id"] if user["role"] == "teacher" else body.teacher_id
    if teacher_id is None:
        raise HTTPException(status_code=422, detail="admin batch creation requires an assigned teacher flow")
    teacher = get_user_by_id(teacher_id)
    if teacher is None or teacher["role"] != "teacher":
        raise HTTPException(status_code=404, detail="teacher not found")
    created = []
    for item in body.students:
        username, password = generate_student_credentials(item.display_name)
        while get_user_by_username(username) is not None:
            username, password = generate_student_credentials(item.display_name)
        student = create_user(
            username=username,
            display_name=item.display_name,
            password_hash=hash_password(password),
            role="student",
            teacher_id=teacher_id,
        )
        safe_student = {k: v for k, v in student.items() if k != "password_hash"}
        safe_student["initial_password"] = password
        created.append(safe_student)
    return created


@app.get("/users/students")
def list_students(scope: TeacherScope = Query(default="class"), user=Depends(require_roles("teacher", "admin"))):
    if user["role"] == "admin":
        students = list_all_students()
    elif scope == "school":
        students = list_all_students()
    else:
        students = list_students_by_teacher(user["user_id"])
    return [{k: v for k, v in item.items() if k != "password_hash"} for item in students]


@app.get("/users/teachers")
def list_teachers(user=Depends(require_roles("admin"))):
    teachers = list_all_teachers()
    return [{k: v for k, v in item.items() if k != "password_hash"} for item in teachers]


@app.post("/users/students/{student_id}/reset-password")
def reset_student_password_api(student_id: str, body: ResetPasswordRequest, user=Depends(require_roles("teacher", "admin"))):
    _ensure_owned_student(student_id, user)
    reset_student_password(student_id, hash_password(body.new_password))
    return {"student_id": student_id, "password_reset": True}


@app.post("/tasks/run", response_model=RunTaskResponse)
def run_task(body: RunTaskRequest, user=Depends(get_current_user)):
    task_type = body.task_type.strip() if body.task_type else None
    if task_type and task_type not in _ALLOWED_RESULT_TASKS:
        raise HTTPException(status_code=422, detail="unsupported v1 task_type")

    continue_session = None
    if body.session_id:
        continue_session = _get_visible_session(body.session_id, user)
        if continue_session.get("user_id") != user["user_id"] or continue_session.get("role") != user["role"]:
            raise HTTPException(status_code=403, detail="forbidden")

    project = _get_visible_project(body.project_id, user) if body.project_id else None
    if project is None and continue_session and continue_session.get("project_id"):
        project = _get_visible_project(continue_session["project_id"], user)
    bloom = get_latest_bloom_for_student(user["user_id"]) if user["role"] == "student" else None
    had_prior_learning_records = bool(list_sessions_for_user(user)) if user["role"] == "student" else False
    history_messages = [item.model_dump() for item in (body.history_messages or [])]
    prepared_source_text = _merge_project_context(body.source_text, project)
    if project is None:
        prepared_source_text = _merge_history_context(prepared_source_text, history_messages)
    if continue_session:
        challenge_context = _build_recent_challenge_context(continue_session["session_id"])
        if challenge_context:
            prepared_source_text = f"{prepared_source_text.strip()}\n\n{challenge_context}" if prepared_source_text and prepared_source_text.strip() else challenge_context
    capabilities = _get_capabilities_config()
    requested_web_search_enabled = bool(body.web_search_enabled and capabilities.get("web_search_enabled", True))
    mcp_status = _serialize_mcp_status()
    runtime_controls = resolve_runtime_controls(
        requested_web_search_enabled=requested_web_search_enabled,
        mcp_status=mcp_status,
    )
    state = build_initial_state(
        raw_input=body.raw_input,
        role=user["role"],
        user_id=user["user_id"],
        project_id=project["project_id"] if project else None,
        history_messages=history_messages,
        task_type=task_type,
        source_text=prepared_source_text,
        web_search_enabled=bool(runtime_controls["web_search_enabled"]),
        web_search_requested=bool(runtime_controls["web_search_requested"]),
        mcp_runtime=runtime_controls,
        bloom_level=(bloom or {}).get("bloom_level", "understand"),
        mastery_status=(bloom or {}).get("mastery_status", "inferred"),
    )
    session, result, final_state = run_pipeline(
        state,
        project_id=project["project_id"] if project else None,
        continue_session_id=continue_session["session_id"] if continue_session else None,
    )
    final_state["mcp_runtime"] = runtime_controls
    final_state["web_search_requested"] = bool(runtime_controls["web_search_requested"])
    final_state["web_search_enabled"] = bool(runtime_controls["web_search_enabled"])
    if final_state.get("error_code") in _FAILED_PIPELINE_ERRORS:
        raise HTTPException(status_code=422, detail=final_state["error_code"])
    if final_state.get("error_code") == ERR_MODEL_UNAVAILABLE:
        raise HTTPException(status_code=503, detail=ERR_MODEL_UNAVAILABLE)

    content_anchor = _normalize_content_anchor(
        final_state.get("content_anchor"),
        raw_input=body.raw_input,
        source_text=body.source_text,
        result=result,
        content_type=final_state.get("content_type"),
    )
    final_state["content_anchor"] = content_anchor

    if project is None:
        auto_project = content_anchor if content_anchor.get("confidence") == "high" else None
        project = _resolve_or_create_project_for_anchor(user=user, anchor=auto_project)
        if project is not None:
            update_session_project(session["session_id"], project["project_id"])
            session = get_session(session["session_id"]) or session

    _record_initial_bloom_if_needed(
        user=user,
        session=session,
        result=result,
        final_state=final_state,
        had_prior_learning_records=had_prior_learning_records,
        existing_bloom=bloom,
    )
    if result is not None:
        transcript_text = _render_result_for_transcript(result)
        if transcript_text:
            create_evidence_event(
                session_id=session["session_id"],
                user_id=user["user_id"],
                event_type="assistant_output",
                actor="assistant",
                payload={
                    "text": transcript_text,
                    "result_id": result.get("result_id"),
                    "result_type": result.get("result_type"),
                    "title": (result.get("content_json") or {}).get("title") if isinstance(result.get("content_json"), dict) else None,
                },
                bloom_level=final_state.get("bloom_level"),
                mastery_status=final_state.get("mastery_status"),
            )
    return RunTaskResponse(
        session=_serialize_session(session),
        result=result,
        state=final_state,
        project=_serialize_project(project) if project else None,
    )


@app.post("/internal/learnhouse/chat", response_model=LearnHouseBridgeResponse)
def learnhouse_bridge_chat(body: LearnHouseBridgeRequest, request: Request):
    _require_internal_bridge(request)

    task_type = body.task_type.strip() if body.task_type else None
    if task_type and task_type not in _ALLOWED_RESULT_TASKS:
        raise HTTPException(status_code=422, detail="unsupported v1 task_type")

    history_messages = [item.model_dump() for item in (body.history_messages or [])]
    direct_response = _run_learnhouse_direct_tutor(
        raw_input=body.raw_input.strip(),
        source_text=body.source_text,
        history_messages=history_messages,
        role=body.role,
        user_id=(body.user_id or f"learnhouse:{body.role}:bridge").strip(),
    )
    if direct_response is not None:
        return direct_response

    capabilities = _get_capabilities_config()
    requested_web_search_enabled = bool(body.web_search_enabled and capabilities.get("web_search_enabled", True))
    mcp_status = _serialize_mcp_status()
    runtime_controls = resolve_runtime_controls(
        requested_web_search_enabled=requested_web_search_enabled,
        mcp_status=mcp_status,
    )
    state = build_initial_state(
        raw_input=body.raw_input.strip(),
        role=body.role,
        user_id=(body.user_id or f"learnhouse:{body.role}:bridge").strip(),
        history_messages=history_messages,
        task_type=task_type,
        source_text=body.source_text,
        web_search_enabled=bool(runtime_controls["web_search_enabled"]),
        web_search_requested=bool(runtime_controls["web_search_requested"]),
        mcp_runtime=runtime_controls,
    )
    final_state = workflow.invoke(state)
    final_state["mcp_runtime"] = runtime_controls
    final_state["web_search_requested"] = bool(runtime_controls["web_search_requested"])
    final_state["web_search_enabled"] = bool(runtime_controls["web_search_enabled"])

    if final_state.get("error_code") in _FAILED_PIPELINE_ERRORS:
        raise HTTPException(status_code=422, detail=final_state["error_code"])
    if final_state.get("error_code") == ERR_MODEL_UNAVAILABLE:
        raise HTTPException(status_code=503, detail=ERR_MODEL_UNAVAILABLE)
    if not final_state.get("validation_passed"):
        raise HTTPException(
            status_code=422,
            detail=final_state.get("error_code") or "ERR_SCHEMA_VALIDATION",
        )

    content = final_state.get("result_object") or {}
    result_type = final_state.get("selected_task") or final_state.get("task_type") or "general_chat"
    text = _format_bridge_text(result_type, content)
    if not text:
        text = str(final_state.get("raw_output") or "").strip()
    if not text:
        raise HTTPException(status_code=502, detail="bridge returned empty content")

    return LearnHouseBridgeResponse(
        text=text,
        result_type=result_type,
        content=content,
        state=final_state,
    )


@app.post("/files/extract-text", response_model=FileExtractResponse)
async def extract_file_text(file: UploadFile = File(...), user=Depends(get_current_user)):
    capabilities = _get_capabilities_config()
    if not capabilities.get("file_upload_enabled", True):
        raise HTTPException(status_code=403, detail="file_upload_disabled")
    file_name = file.filename or 'uploaded-file'
    try:
        raw = await file.read()
        text = extract_text_from_file(file_name, raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "message": str(exc),
                "supported_extensions": list_supported_extensions(),
            },
        ) from exc
    if not text.strip():
        raise HTTPException(status_code=422, detail="uploaded file has no extractable text")
    return FileExtractResponse(
        file_name=file_name,
        content_type=file.content_type or 'application/octet-stream',
        text=text,
    )


@app.get("/sessions")
def list_sessions(user=Depends(get_current_user)):
    sessions = list_sessions_for_user(user)
    return [_serialize_session(item) for item in sessions]


@app.get("/sessions/{session_id}")
def get_session_detail(session_id: str, user=Depends(get_current_user)):
    session = _get_visible_session(session_id, user)
    return {
        "session": _serialize_session(session),
        "result": get_result_by_session(session_id),
        "messages": _serialize_session_messages(session_id),
        "active_challenge": _extract_active_challenge(session_id),
    }


@app.delete("/sessions/{session_id}")
def delete_session(session_id: str, user=Depends(require_roles("student"))):
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    if session.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="forbidden")
    delete_session_bundle(session_id)
    return {"deleted": True, "session_id": session_id}


@app.get("/projects", response_model=ProjectListResponse)
def list_projects(user=Depends(get_current_user)):
    projects = list_projects_for_user(user)
    serialized = [_serialize_project(item) for item in projects]
    return {
        "projects": serialized,
        "total": len(serialized),
        "owner_role": user["role"],
        "owner_id": user["user_id"],
    }


@app.get("/projects/{project_id}", response_model=ProjectDetailResponse)
def get_project_detail(project_id: str, user=Depends(get_current_user)):
    project = _get_visible_project(project_id, user)
    sessions = [_serialize_session(item) for item in list_project_sessions(project_id)]
    results = list_project_results(project_id)
    return {
        "project": _serialize_project(project),
        "sessions": sessions,
        "results": results,
        "metrics": _build_project_metrics(project),
    }


@app.post("/projects/resolve", response_model=ProjectMutationResponse)
def resolve_project(body: ProjectResolveRequest, user=Depends(require_roles("student"))):
    session = get_session(body.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    if session.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="forbidden")

    project = _resolve_or_create_project_for_anchor(
        user=user,
        anchor={
            "content_type": body.content_type,
            "title": body.title.strip(),
            "confidence": "high",
        },
    )
    if project is None:
        raise HTTPException(status_code=422, detail="project resolve failed")

    update_session_project(body.session_id, project["project_id"])
    return {
        "project": _serialize_project(project),
        "ok": True,
        "message": "project_resolved",
    }


@app.get("/results/{result_id}")
def get_result_detail(result_id: str, user=Depends(get_current_user)):
    result = get_result(result_id)
    if result is None:
        raise HTTPException(status_code=404, detail="result not found")
    session = get_session(result["session_id"])
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    visible = {item["session_id"] for item in list_sessions_for_user(user)}
    if session["session_id"] not in visible:
        raise HTTPException(status_code=403, detail="forbidden")
    return result


@app.post("/exports/result/{result_id}", response_model=ExportResponse)
def export_result_api(result_id: str, user=Depends(get_current_user)):
    result = get_result(result_id)
    if result is None:
        raise HTTPException(status_code=404, detail="result not found")
    session = get_session(result["session_id"])
    if session is None or user["role"] != "student" or session["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="forbidden")
    if result["status"] == "draft":
        raise HTTPException(status_code=422, detail="draft results cannot be exported")
    try:
        export_meta = export_result(result, actor_role=user["role"])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if export_meta["format"] == "docx":
        update_result_status(result_id, "exported")
    return ExportResponse(**export_meta)


@app.post("/exports/session/{session_id}", response_model=ExportResponse)
def export_session_api(session_id: str, user=Depends(get_current_user)):
    session = get_session(session_id)
    if session is None or user["role"] != "student" or session["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="forbidden")
    result = get_result_by_session(session_id)
    if result is None or result.get("status") not in {"ready", "exported"}:
        raise HTTPException(status_code=422, detail="ready result required for session export")
    export_meta = export_session(session_id, result, actor_role=user["role"])
    return ExportResponse(**export_meta)


# --- 教师干预接口 ---

@app.post("/review/results/{result_id}")
def review_result(result_id: str, body: ReviewResultRequest, user=Depends(require_roles("teacher", "admin"))):
    result = get_result(result_id)
    if result is None:
        raise HTTPException(status_code=404, detail="result not found")
    # 教师只能复核属于自己学生的结果，或自己的结果
    session = get_session(result["session_id"])
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    visible = {item["session_id"] for item in list_sessions_for_user(user)}
    if session["session_id"] not in visible:
        raise HTTPException(status_code=403, detail="forbidden")
    updated = update_result_review(result_id, body.review_status, body.content)
    return updated


@app.get("/teacher/students/{student_id}/sessions")
def teacher_view_student_sessions(student_id: str, user=Depends(require_roles("teacher", "admin"))):
    if user["role"] == "admin":
        raise HTTPException(status_code=403, detail="admin should use /sessions directly")
    sessions = list_sessions_by_student(student_id, user["user_id"])
    return sessions


@app.get("/teacher/results")
def teacher_list_results(user=Depends(require_roles("teacher", "admin"))):
    if user["role"] == "admin":
        return list_all_results()
    return list_results_for_teacher(user["user_id"])


@app.post("/teacher/feedback")
def send_teacher_feedback(body: TeacherFeedbackRequest, user=Depends(require_roles("teacher", "admin"))):
    _ensure_owned_student(body.student_id, user)
    fb = create_teacher_feedback(
        teacher_id=user["user_id"],
        student_id=body.student_id,
        content=body.content,
        poem_title=body.poem_title,
        is_ai_assisted=body.is_ai_assisted,
    )
    return fb


@app.get("/teacher/feedback/{student_id}")
def get_feedback_for_student(student_id: str, user=Depends(require_roles("teacher", "admin"))):
    _ensure_owned_student(student_id, user)
    return list_teacher_feedback_for_student(student_id)


@app.post("/teacher/bloom-overrides")
def create_bloom_override_api(body: BloomOverrideRequest, user=Depends(require_roles("teacher", "admin"))):
    _ensure_owned_student(body.student_id, user)
    teacher_id = user["user_id"]
    return create_bloom_override(body.student_id, teacher_id, body.bloom_level, body.note)


@app.get("/teacher/bloom-overrides/{student_id}")
def list_bloom_overrides_api(student_id: str, user=Depends(require_roles("teacher", "admin"))):
    _ensure_owned_student(student_id, user)
    return list_bloom_overrides_for_student(student_id)


@app.get("/teacher/mastery")
def teacher_mastery_snapshot(scope: TeacherScope = Query(default="class"), user=Depends(require_roles("teacher", "admin"))):
    if user["role"] == "admin":
        raise HTTPException(status_code=403, detail="admin should use student and trace endpoints directly")
    if scope == "school":
        return get_teacher_mastery_snapshot()
    return get_teacher_mastery_snapshot(user["user_id"])


@app.get("/students/me/bloom")
def get_my_bloom(user=Depends(require_roles("student"))):
    return get_latest_bloom_for_student(user["user_id"])


@app.get("/students/me/challenges")
def get_my_challenges(user=Depends(require_roles("student"))):
    return list_challenge_attempts_by_user(user["user_id"])


@app.get("/students/me/feedback")
def get_my_teacher_feedback(user=Depends(require_roles("student"))):
    return list_teacher_feedback_for_student(user["user_id"])


@app.post("/students/me/challenges/preview", response_model=ChallengePreviewResponse)
def preview_challenge(body: ChallengePreviewRequest, user=Depends(require_roles("student"))):
    session = _get_visible_session(body.session_id, user) if body.session_id else None
    latest = get_latest_bloom_for_student(user["user_id"]) or {}
    from_level = latest.get("bloom_level", "remember")
    to_level = _next_bloom_level(from_level)
    if to_level is None:
        raise HTTPException(status_code=422, detail="current level has no next challenge")

    question, rubric, difficulty, review_needed = _build_challenge_payload(body.poem_title.strip(), from_level, to_level)
    preview = ChallengePreviewResponse(
        poem_title=body.poem_title.strip(),
        from_level=from_level,
        to_level=to_level,
        difficulty=difficulty,
        review_needed=review_needed,
        question_json=question,
        rubric_json=rubric,
    )
    if session is not None:
        create_evidence_event(
            session_id=session["session_id"],
            user_id=user["user_id"],
            event_type="challenge_prompt",
            actor="assistant",
            payload={
                "text": _build_challenge_prompt_text(preview.model_dump()),
                "preview": preview.model_dump(),
                "poem_title": body.poem_title.strip(),
            },
            bloom_level=from_level,
            mastery_status=(latest or {}).get("mastery_status", "inferred"),
        )
    return preview


@app.post("/students/me/challenges")
def submit_challenge(body: ChallengeSubmitRequest, user=Depends(require_roles("student"))):
    session = _get_visible_session(body.session_id, user) if body.session_id else None
    latest = get_latest_bloom_for_student(user["user_id"]) or {}
    current_level = latest.get("bloom_level", "remember")
    if body.from_level != current_level:
        raise HTTPException(status_code=422, detail=f"challenge must start from current level: {current_level}")

    to_level = _next_bloom_level(body.from_level)
    if to_level is None:
        raise HTTPException(status_code=422, detail="current level has no next challenge")

    question, rubric, difficulty, review_needed = _build_challenge_payload(body.poem_title, body.from_level, to_level)
    score, error_type, inferred_cause = _score_challenge_answer(body.student_answer, to_level, question)
    passed = score >= 0.6
    feedback_text = _build_challenge_feedback_text(
        passed=passed,
        next_level=to_level,
        current_level=body.from_level,
        inferred_cause=inferred_cause,
        question=question,
    )

    attempt = create_challenge_attempt(
        user_id=user["user_id"],
        poem_title=body.poem_title,
        from_level=body.from_level,
        to_level=to_level,
        difficulty=difficulty,
        question=question,
        rubric=rubric,
        student_answer=body.student_answer,
        score=score,
        passed=passed,
        review_needed=review_needed,
    )

    if passed and not review_needed:
        create_bloom_override(
            student_id=user["user_id"],
            teacher_id="system",
            bloom_level=to_level,
            note="challenge_passed_auto_promoted",
            mastery_status="inferred",
        )

    if session is not None:
        create_evidence_event(
            session_id=session["session_id"],
            user_id=user["user_id"],
            event_type="challenge_answer",
            actor="student",
            payload={
                "text": body.student_answer.strip(),
                "poem_title": body.poem_title,
                "to_level": to_level,
            },
            bloom_level=body.from_level,
            mastery_status=(latest or {}).get("mastery_status", "inferred"),
            error_type=error_type,
            inferred_cause=inferred_cause,
        )
        create_evidence_event(
            session_id=session["session_id"],
            user_id=user["user_id"],
            event_type="challenge_feedback",
            actor="assistant",
            payload={
                "text": feedback_text,
                "poem_title": body.poem_title,
                "to_level": to_level,
                "passed": passed,
            },
            bloom_level=to_level if passed else body.from_level,
            mastery_status="inferred",
            error_type=error_type,
            inferred_cause=inferred_cause,
        )

    return {
        "attempt": attempt,
        "current_bloom": get_latest_bloom_for_student(user["user_id"]),
        "review_needed": review_needed,
        "passed": passed,
        "error_type": error_type,
        "inferred_cause": inferred_cause,
        "message": feedback_text,
    }


@app.post("/users/teachers")
def create_teacher(body: CreateTeacherRequest, user=Depends(require_roles("admin"))):
    if get_user_by_username(body.username) is not None:
        raise HTTPException(status_code=409, detail="username already exists")
    teacher = create_user(
        username=body.username,
        display_name=body.display_name,
        password_hash=hash_password(body.password),
        role="teacher",
    )
    return {k: v for k, v in teacher.items() if k != "password_hash"}


@app.get("/admin/results")
def admin_list_results(user=Depends(require_roles("admin"))):
    return list_all_results()


@app.get("/admin/skills", response_model=AdminSkillsSnapshotResponse)
def admin_skills_snapshot(user=Depends(require_roles("admin"))):
    return _build_admin_skills_snapshot()


@app.post("/admin/configs", response_model=AdminConfigResponse)
def admin_upsert_config(body: AdminConfigRequest, user=Depends(require_roles("admin"))):
    summary = f"admin_update:{body.config_key}"
    config = upsert_admin_config(body.config_key, body.config_json, user["user_id"], summary=summary)
    return AdminConfigResponse(
        config=config,
        configs=list_admin_configs(),
        message="config_updated",
    )


@app.get("/admin/configs/{config_key}/versions")
def admin_list_config_versions(config_key: str, user=Depends(require_roles("admin"))):
    return list_admin_config_versions(config_key)


@app.post("/admin/templates", response_model=TemplateVersionActionResponse)
def admin_create_template(body: TemplateVersionCreateRequest, user=Depends(require_roles("admin"))):
    current_active = next((item for item in list_template_versions(body.task_type) if item.get("is_active")), None)
    version = create_template_version(
        body.task_type,
        body.template_text,
        user["user_id"],
        activate=body.activate,
        summary=f"admin_create:{body.task_type}",
        source_version_id=current_active["version_id"] if current_active else None,
    )
    return TemplateVersionActionResponse(
        version=version,
        versions=list_template_versions(body.task_type),
        message="template_version_created",
    )


@app.post("/admin/templates/activate", response_model=TemplateVersionActionResponse)
def admin_activate_template(body: TemplateRollbackRequest, user=Depends(require_roles("admin"))):
    version = set_active_template_version(body.version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="template version not found")
    return TemplateVersionActionResponse(
        version=version,
        versions=list_template_versions(version["task_type"]),
        message="template_version_activated",
    )


@app.post("/admin/templates/rollback", response_model=TemplateVersionActionResponse)
def admin_rollback_template(body: TemplateRollbackRequest, user=Depends(require_roles("admin"))):
    version = get_template_version(body.version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="template version not found")
    restored = create_template_version(
        version["task_type"],
        version["template_text"],
        user["user_id"],
        activate=True,
        summary=f"admin_rollback:{version['task_type']}",
        source_version_id=version["version_id"],
    )
    return TemplateVersionActionResponse(
        version=restored,
        versions=list_template_versions(version["task_type"]),
        message="template_version_rolled_back",
    )


@app.post("/admin/skills/reload")
def admin_reload_skills(user=Depends(require_roles("admin"))):
    return {
        "ok": True,
        "message": "reload_requested",
        "mcp": _serialize_mcp_status(force_reload=True),
        "skills": _serialize_skill_registry(),
    }


@app.get("/admin/traces")
def admin_list_traces(user=Depends(require_roles("admin"))):
    traces = []
    for session in list_sessions_for_user(user):
        result = get_result_by_session(session["session_id"])
        events = list_evidence_events(session["session_id"])
        error_codes = [event.get("error_type") for event in events if event.get("error_type")]
        bloom_levels = [event.get("bloom_level") for event in events if event.get("bloom_level")]
        traces.append(
            {
                "session_id": session["session_id"],
                "user_id": session.get("user_id"),
                "user_role": session["role"],
                "task_type": session["task_type"],
                "context_mode": session["context_mode"],
                "session_status": session["status"],
                "result_id": result["result_id"] if result else None,
                "result_type": result["result_type"] if result else None,
                "review_status": result["review_status"] if result else None,
                "event_count": len(events),
                "last_event_type": events[-1]["event_type"] if events else None,
                "last_error_code": error_codes[-1] if error_codes else None,
                "current_bloom_level": bloom_levels[-1] if bloom_levels else None,
                "pipeline_stages": [event["event_type"] for event in events],
                "created_at": session["created_at"],
            }
        )
    return traces


@app.get("/admin/trace/sessions/{session_id}")
def admin_trace_session(session_id: str, user=Depends(require_roles("admin"))):
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    events = list_evidence_events(session_id)
    stage_summary = []
    for event in events:
        stage_summary.append(
            {
                "stage": event["event_type"],
                "actor": event["actor"],
                "bloom_level": event.get("bloom_level"),
                "mastery_status": event.get("mastery_status"),
                "error_code": event.get("error_type"),
                "created_at": event["created_at"],
            }
        )
    return {
        "session": session,
        "result": get_result_by_session(session_id),
        "events": events,
        "stage_summary": stage_summary,
    }
