from __future__ import annotations

import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.auth import hash_password
from app.config import CHROMA_DIR, DB_PATH, EXPORTS_DIR
from app.db import (
    create_bloom_override,
    create_challenge_attempt,
    create_evidence_event,
    create_project,
    create_result_object,
    create_session,
    create_teacher_feedback,
    create_template_version,
    create_user,
    get_connection,
    init_db,
    upsert_admin_config,
)


def reset_path(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
    elif path.exists():
        path.unlink(missing_ok=True)


def set_created_at(table: str, key_column: str, key_value: str, timestamp: str) -> None:
    con = get_connection()
    cur = con.cursor()
    cur.execute(f"UPDATE {table} SET created_at=? WHERE {key_column}=?", (timestamp, key_value))
    con.commit()
    con.close()


def write_demo_state() -> dict[str, dict[str, str]]:
    reset_path(Path(DB_PATH))
    reset_path(Path(CHROMA_DIR))
    reset_path(Path(EXPORTS_DIR))

    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    Path(CHROMA_DIR).mkdir(parents=True, exist_ok=True)
    Path(EXPORTS_DIR).mkdir(parents=True, exist_ok=True)

    init_db()

    admin = create_user("admin", "演示管理员", hash_password("admin123456"), "admin")
    teacher = create_user("teacher", "演示教师", hash_password("teacher123456"), "teacher")
    student = create_user("student", "演示学生", hash_password("student123456"), "student", teacher["user_id"])
    student_a = create_user("student_a", "学生甲", hash_password("student123456"), "student", teacher["user_id"])

    upsert_admin_config(
        "capabilities",
        {
            "web_search_enabled": True,
            "file_upload_enabled": True,
            "think_audit_enabled": True,
            "teacher_release_required": True,
            "export_profile": "teacher-confirmed only",
            "model_profile": "school-safe",
        },
        admin["user_id"],
        summary="demo_seed",
    )
    upsert_admin_config(
        "skills",
        {
            "lesson_outline": {"enabled": True, "context_mode": "full"},
            "question_analysis": {"enabled": True, "context_mode": "full"},
            "guided_explain": {"enabled": True, "context_mode": "lite"},
            "general_chat": {"enabled": True, "context_mode": "lite"},
        },
        admin["user_id"],
        summary="demo_seed",
    )
    upsert_admin_config(
        "mcp",
        {
            "enabled": True,
            "providers": [
                "grok-search",
                {
                    "name": "ultrarag",
                    "config": {
                        "mode": "auto",
                        "base_url": "http://127.0.0.1:5050",
                        "server_root": "",
                    },
                },
            ],
            "hot_reload": True,
        },
        admin["user_id"],
        summary="demo_seed",
    )

    templates = {
        "lesson_outline": "生成教师可直接试讲的古诗备课提纲，突出目标、活动节奏与板书提示。",
        "question_analysis": "生成结构化题目解析，给出分析步骤、证据和分层提示。",
        "guided_explain": "面向学生提供启发式讲解，不直接透出标准答案。",
        "general_chat": "围绕古诗文学习场景进行简洁、友好的辅助回答。",
    }
    for task_type, template_text in templates.items():
        create_template_version(task_type, template_text, admin["user_id"], activate=True, summary="demo_seed")

    student_project = create_project("静夜思", "poem", student["user_id"], "student", "active")
    student_a_project = create_project("春晓", "poem", student_a["user_id"], "student", "active")
    teacher_project = create_project("春晓备课", "poem", teacher["user_id"], "teacher", "active")

    base_time = datetime(2026, 4, 7, 8, 0, tzinfo=timezone.utc)

    def stamp(minutes: int) -> str:
        return (base_time + timedelta(minutes=minutes)).isoformat()

    student_chat = create_session(student["user_id"], "student", "general_chat", "lite", "completed")
    set_created_at("sessions", "session_id", student_chat["session_id"], stamp(0))
    chat_user = create_evidence_event(
        student_chat["session_id"],
        student["user_id"],
        "user_input",
        "student",
        {"raw_input": "老师让我们先说说《静夜思》最打动人的一句，我应该怎么开头？"},
    )
    chat_assistant = create_evidence_event(
        student_chat["session_id"],
        student["user_id"],
        "assistant_output",
        "assistant",
        {"text": "可以先点出“举头望明月，低头思故乡”最容易让人共情，再补一句你为什么会想到离家时的感受。"},
    )
    set_created_at("evidence_events", "event_id", chat_user["event_id"], stamp(1))
    set_created_at("evidence_events", "event_id", chat_assistant["event_id"], stamp(2))
    chat_result = create_result_object(
        student_chat["session_id"],
        "general_chat",
        {
            "title": "课堂热身对话",
            "answer": "建议先抓住“明月”和“思乡”两个核心意象，再用一句自己的生活经验把感受接上。",
            "follow_up": "如果你愿意，我可以继续帮你把开头扩成 3 句课堂发言。",
            "evidence_refs": ["《静夜思》：举头望明月，低头思故乡"],
        },
        ["《静夜思》：举头望明月，低头思故乡"],
        "ready",
        review_status="accepted",
    )
    set_created_at("result_objects", "result_id", chat_result["result_id"], stamp(3))

    analysis_session = create_session(
        student["user_id"],
        "student",
        "question_analysis",
        "full",
        "completed",
        student_project["project_id"],
    )
    set_created_at("sessions", "session_id", analysis_session["session_id"], stamp(10))
    analysis_user = create_evidence_event(
        analysis_session["session_id"],
        student["user_id"],
        "user_input",
        "student",
        {"raw_input": "《静夜思》里为什么“疑是地上霜”能把思乡写得更深？"},
        bloom_level="understand",
        mastery_status="inferred",
    )
    analysis_assistant = create_evidence_event(
        analysis_session["session_id"],
        student["user_id"],
        "assistant_output",
        "assistant",
        {"text": "先看视觉错觉，再看动作变化：把月光误看成霜，让夜色更冷更静；接着“举头”“低头”两个动作，把思乡情绪推出来。"},
        bloom_level="understand",
        mastery_status="inferred",
    )
    set_created_at("evidence_events", "event_id", analysis_user["event_id"], stamp(11))
    set_created_at("evidence_events", "event_id", analysis_assistant["event_id"], stamp(12))
    analysis_result = create_result_object(
        analysis_session["session_id"],
        "question_analysis",
        {
            "title": "《静夜思》题目拆解",
            "question_text": "“疑是地上霜”为什么能加深《静夜思》的思乡情感？",
            "analysis_steps": [
                "先指出“疑”写的是月光带来的瞬间错觉。",
                "再说明“霜”让画面更冷、更静，烘托夜深人静的环境。",
                "最后连接“举头望明月，低头思故乡”，说明冷清月夜更容易勾起乡愁。",
            ],
            "hint_ladder": {
                "hint_1": "先想“月光像霜”写的是景象还是心情。",
                "hint_2": "再比较“月光”和“霜”带来的温度感受。",
                "hint_3": "把“冷清夜色”和“低头思故乡”连起来。",
                "answer": "“疑是地上霜”把月光写得像霜一样清冷，先营造夜深人静的气氛，再自然引出诗人低头思乡的感情。",
            },
            "evidence_refs": ["床前明月光，疑是地上霜", "举头望明月，低头思故乡"],
        },
        ["床前明月光，疑是地上霜", "举头望明月，低头思故乡"],
        "ready",
        review_status="edited",
    )
    set_created_at("result_objects", "result_id", analysis_result["result_id"], stamp(13))

    challenge_session = create_session(
        student["user_id"],
        "student",
        "guided_explain",
        "lite",
        "completed",
        student_project["project_id"],
    )
    set_created_at("sessions", "session_id", challenge_session["session_id"], stamp(20))
    challenge_user = create_evidence_event(
        challenge_session["session_id"],
        student["user_id"],
        "user_input",
        "student",
        {"raw_input": "我能大概解释《静夜思》，但不知道怎样说得更完整。"},
        bloom_level="apply",
        mastery_status="inferred",
    )
    challenge_prompt = create_evidence_event(
        challenge_session["session_id"],
        student["user_id"],
        "challenge_prompt",
        "assistant",
        {
            "text": "进阶挑战：请用“景物变化 + 动作变化 + 情感落点”三个层次，完整说明《静夜思》的思乡表达。",
            "poem_title": "静夜思",
            "preview": {
                "poem_title": "静夜思",
                "from_level": "apply",
                "to_level": "analyze",
                "difficulty": "medium",
                "review_needed": False,
                "question_json": {"challenge_type": "short_answer", "stem": "请分三层解释《静夜思》如何从景物写到情感。"},
                "rubric_json": ["指出景物", "说明动作", "落到情感"],
            },
        },
        bloom_level="apply",
        mastery_status="inferred",
    )
    challenge_answer = create_evidence_event(
        challenge_session["session_id"],
        student["user_id"],
        "challenge_answer",
        "student",
        {
            "text": "诗里先写月光像霜，让夜色显得清冷；再写举头望月、低头思乡的动作变化；最后把看到月亮时突然涌上的思乡情表达出来。",
            "poem_title": "静夜思",
            "to_level": "analyze",
        },
        bloom_level="apply",
        mastery_status="inferred",
    )
    challenge_feedback = create_evidence_event(
        challenge_session["session_id"],
        student["user_id"],
        "challenge_feedback",
        "assistant",
        {
            "text": "这次回答已经能把景物、动作和情感三层关系串起来，说明你可以稳定进入“分析”层级。",
            "poem_title": "静夜思",
            "to_level": "analyze",
            "passed": True,
        },
        bloom_level="analyze",
        mastery_status="inferred",
    )
    set_created_at("evidence_events", "event_id", challenge_user["event_id"], stamp(21))
    set_created_at("evidence_events", "event_id", challenge_prompt["event_id"], stamp(22))
    set_created_at("evidence_events", "event_id", challenge_answer["event_id"], stamp(23))
    set_created_at("evidence_events", "event_id", challenge_feedback["event_id"], stamp(24))
    challenge_result = create_result_object(
        challenge_session["session_id"],
        "guided_explain",
        {
            "title": "《静夜思》分层讲解",
            "bloom_level": "analyze",
            "current_hint_level": "hint_3",
            "hint_content": "回答时可以固定成“月光像霜的夜景很冷清 -> 诗人抬头看月、低头思乡 -> 景物和动作一起推动情感”这条线。",
            "next_challenge_hint": "下一步可以比较《静夜思》和《春晓》在情感表达上的不同。",
            "evidence_refs": ["床前明月光，疑是地上霜", "举头望明月，低头思故乡"],
        },
        ["床前明月光，疑是地上霜", "举头望明月，低头思故乡"],
        "ready",
        review_status="accepted",
    )
    set_created_at("result_objects", "result_id", challenge_result["result_id"], stamp(25))
    challenge_attempt = create_challenge_attempt(
        student["user_id"],
        "静夜思",
        "apply",
        "analyze",
        "medium",
        {"challenge_type": "short_answer", "stem": "请分三层解释《静夜思》如何从景物写到情感。"},
        ["指出景物", "说明动作", "落到情感"],
        "诗里先写月光像霜，让夜色显得清冷；再写举头望月、低头思乡的动作变化；最后把看到月亮时突然涌上的思乡情表达出来。",
        0.92,
        True,
        False,
    )
    set_created_at("challenge_attempts", "attempt_id", challenge_attempt["attempt_id"], stamp(26))
    auto_bloom = create_bloom_override(student["user_id"], "system", "analyze", "challenge_passed_auto_promoted", "inferred")
    set_created_at("bloom_overrides", "override_id", auto_bloom["override_id"], stamp(27))

    feedback = create_teacher_feedback(
        teacher["user_id"],
        student["user_id"],
        "你的“月光像霜”解释已经比较完整，下一次可以主动补上“举头 / 低头”的动作变化。",
        poem_title="静夜思",
        is_ai_assisted=False,
    )
    set_created_at("teacher_feedback", "feedback_id", feedback["feedback_id"], stamp(28))

    student_a_session = create_session(
        student_a["user_id"],
        "student",
        "guided_explain",
        "lite",
        "failed",
        student_a_project["project_id"],
    )
    set_created_at("sessions", "session_id", student_a_session["session_id"], stamp(30))
    student_a_user = create_evidence_event(
        student_a_session["session_id"],
        student_a["user_id"],
        "user_input",
        "student",
        {"raw_input": "《春晓》里为什么会从“春眠不觉晓”写到“花落知多少”？"},
        bloom_level="understand",
        mastery_status="teacher_overridden",
    )
    student_a_fail = create_evidence_event(
        student_a_session["session_id"],
        student_a["user_id"],
        "assistant_output",
        "assistant",
        {"text": "这次回答的证据链不够稳定，系统已交由教师复核，请你先根据“春眠、啼鸟、风雨、花落”四个线索重新整理。"},
        bloom_level="understand",
        mastery_status="teacher_overridden",
        error_type="ERR_GROUNDING_LOW_CONFIDENCE",
        inferred_cause="missing_textual_evidence",
    )
    set_created_at("evidence_events", "event_id", student_a_user["event_id"], stamp(31))
    set_created_at("evidence_events", "event_id", student_a_fail["event_id"], stamp(32))
    student_a_bloom = create_bloom_override(
        student_a["user_id"],
        teacher["user_id"],
        "understand",
        "课堂表现稳定，但需要继续加强诗句证据引用。",
        "teacher_overridden",
    )
    set_created_at("bloom_overrides", "override_id", student_a_bloom["override_id"], stamp(33))
    student_a_feedback = create_teacher_feedback(
        teacher["user_id"],
        student_a["user_id"],
        "《春晓》的情绪判断是对的，但请把“夜来风雨声”与“花落知多少”之间的关系说得更清楚。",
        poem_title="春晓",
        is_ai_assisted=False,
    )
    set_created_at("teacher_feedback", "feedback_id", student_a_feedback["feedback_id"], stamp(34))

    teacher_session = create_session(
        teacher["user_id"],
        "teacher",
        "lesson_outline",
        "full",
        "completed",
        teacher_project["project_id"],
    )
    set_created_at("sessions", "session_id", teacher_session["session_id"], stamp(40))
    teacher_user = create_evidence_event(
        teacher_session["session_id"],
        teacher["user_id"],
        "user_input",
        "teacher",
        {"raw_input": "请给我一份《春晓》的 15 分钟试讲提纲。"},
    )
    teacher_assistant = create_evidence_event(
        teacher_session["session_id"],
        teacher["user_id"],
        "assistant_output",
        "assistant",
        {"text": "我已经整理好一份 15 分钟试讲结构，重点放在“听觉线索”和“惜春情绪”的推进上。"},
    )
    set_created_at("evidence_events", "event_id", teacher_user["event_id"], stamp(41))
    set_created_at("evidence_events", "event_id", teacher_assistant["event_id"], stamp(42))
    teacher_result = create_result_object(
        teacher_session["session_id"],
        "lesson_outline",
        {
            "title": "《春晓》15 分钟试讲提纲",
            "teaching_goals": ["帮助学生概括诗中的春晨景象。", "引导学生理解“惜春”情绪如何由听觉线索推进。"],
            "key_points": ["从“春眠不觉晓”读出春晨的舒缓状态。", "从“夜来风雨声”“花落知多少”读出惜春意味。"],
            "difficult_points": ["让学生说明景物变化和情感变化之间的关系。"],
            "activity_flow": [
                {"step": 1, "name": "导入", "duration": "3 分钟", "description": "用“春天早晨会听到什么”打开学生感官经验。"},
                {"step": 2, "name": "细读", "duration": "6 分钟", "description": "逐句梳理“春眠、啼鸟、风雨、花落”四个线索。"},
                {"step": 3, "name": "表达", "duration": "4 分钟", "description": "让学生用一句话概括全诗情绪，并说明依据。"},
                {"step": 4, "name": "收束", "duration": "2 分钟", "description": "板书“景物变化 -> 惜春情绪”的课堂总结。"},
            ],
            "evidence_refs": ["春眠不觉晓，处处闻啼鸟", "夜来风雨声，花落知多少"],
        },
        ["春眠不觉晓，处处闻啼鸟", "夜来风雨声，花落知多少"],
        "ready",
        review_status="accepted",
    )
    set_created_at("result_objects", "result_id", teacher_result["result_id"], stamp(43))

    return {
        "admin": {"username": "admin", "password": "admin123456"},
        "teacher": {"username": "teacher", "password": "teacher123456"},
        "student": {"username": "student", "password": "student123456"},
        "student_a": {"username": "student_a", "password": "student123456"},
    }


def main() -> None:
    accounts = write_demo_state()
    print("Demo data reset complete.")
    for key, value in accounts.items():
        print(f"{key}: {value['username']} / {value['password']}")


if __name__ == "__main__":
    main()
