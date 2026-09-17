import os
import sys
import tempfile
import time
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _login(client: TestClient, username: str, password: str, remember_me: bool = False):
    resp = client.post(
        "/auth/login",
        json={"username": username, "password": password, "remember_me": remember_me},
    )
    resp.raise_for_status()
    return resp


def _auth_headers(client: TestClient, username: str, password: str) -> dict[str, str]:
    token = _login(client, username, password).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create_student(client: TestClient, teacher_headers: dict[str, str], display_name: str) -> tuple[str, str, dict[str, str]]:
    username = f"student_{uuid.uuid4().hex[:8]}"
    resp = client.post(
        "/users/students",
        headers=teacher_headers,
        json={
            "display_name": display_name,
            "username": username,
            "password": "student123456",
        },
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    headers = _auth_headers(client, username, "student123456")
    return username, payload["user_id"], headers


def main() -> None:
    tmpdir = tempfile.mkdtemp(prefix="slm-v1-")
    os.environ["SLM_DB_PATH"] = str(Path(tmpdir) / "db.sqlite")
    os.environ["SLM_EXPORTS_DIR"] = str(Path(tmpdir) / "exports")

    from app.auth import _TOKEN_TTL_SECONDS, decode_token
    from app.main import app

    with TestClient(app) as client:
        admin_login = _login(client, "admin", "admin123456", remember_me=True)
        admin_login_payload = admin_login.json()
        admin_token_payload = decode_token(admin_login_payload["access_token"])
        assert admin_login_payload["user"]["session"]["remember_me"] is True
        assert admin_token_payload["remember_me"] is True
        ttl_delta = admin_token_payload["exp"] - int(time.time())
        assert _TOKEN_TTL_SECONDS - 10 <= ttl_delta <= _TOKEN_TTL_SECONDS

        admin_headers = {"Authorization": f"Bearer {admin_login_payload['access_token']}"}
        teacher_headers = _auth_headers(client, "teacher", "teacher123456")

        create_teacher = client.post(
            "/users/teachers",
            headers=admin_headers,
            json={
                "display_name": "Smoke Teacher",
                "username": f"teacher_{uuid.uuid4().hex[:8]}",
                "password": "teacher123456",
            },
        )
        assert create_teacher.status_code == 200, create_teacher.text

        batch_students = client.post(
            "/users/students/batch",
            headers=teacher_headers,
            json={"students": [{"display_name": "Batch One"}, {"display_name": "Batch Two"}]},
        )
        assert batch_students.status_code == 200, batch_students.text
        batch_payload = batch_students.json()
        assert len(batch_payload) == 2
        assert all(item["teacher_id"] for item in batch_payload)
        assert all(item["initial_password"].startswith("stu") for item in batch_payload)
        assert all("password_hash" not in item for item in batch_payload)

        result_student_username, result_student_id, result_student_headers = _create_student(
            client, teacher_headers, "Smoke Result Student"
        )
        challenge_student_username, challenge_student_id, challenge_student_headers = _create_student(
            client, teacher_headers, "Smoke Challenge Student"
        )

        reset_password = client.post(
            f"/users/students/{result_student_id}/reset-password",
            headers=teacher_headers,
            json={"new_password": "student654321"},
        )
        assert reset_password.status_code == 200, reset_password.text
        result_student_headers = _auth_headers(client, result_student_username, "student654321")

        other_teacher = client.post(
            "/users/teachers",
            headers=admin_headers,
            json={
                "display_name": "Other Teacher",
                "username": f"teacher_{uuid.uuid4().hex[:8]}",
                "password": "teacher123456",
            },
        )
        assert other_teacher.status_code == 200, other_teacher.text
        other_teacher_headers = _auth_headers(client, other_teacher.json()["username"], "teacher123456")

        foreign_feedback = client.post(
            "/teacher/feedback",
            headers=other_teacher_headers,
            json={
                "student_id": challenge_student_id,
                "content": "not allowed",
            },
        )
        assert foreign_feedback.status_code == 403, foreign_feedback.text

        foreign_override = client.post(
            "/teacher/bloom-overrides",
            headers=other_teacher_headers,
            json={
                "student_id": challenge_student_id,
                "bloom_level": "apply",
                "note": "not allowed",
            },
        )
        assert foreign_override.status_code == 403, foreign_override.text

        me_resp = client.get("/me", headers=result_student_headers)
        assert me_resp.status_code == 200, me_resp.text
        assert me_resp.json()["username"] == result_student_username

        unknown_run = client.post(
            "/tasks/run",
            headers=result_student_headers,
            json={
                "raw_input": "请帮我讲解今天的天气现象",
                "task_type": "guided_explain",
            },
        )
        assert unknown_run.status_code == 200, unknown_run.text
        unknown_payload = unknown_run.json()
        assert unknown_payload["result"] is not None
        assert unknown_payload["result"]["result_type"] == "general_chat"
        assert unknown_payload["state"]["selected_task"] == "general_chat"

        bloom_after_general_chat = client.get("/students/me/bloom", headers=result_student_headers)
        assert bloom_after_general_chat.status_code == 200, bloom_after_general_chat.text
        assert bloom_after_general_chat.json()["bloom_level"] == "remember"
        assert bloom_after_general_chat.json()["mastery_status"] == "inferred"

        general_chat_trace = client.get(f"/admin/trace/sessions/{unknown_payload['session']['session_id']}", headers=admin_headers)
        assert general_chat_trace.status_code == 200, general_chat_trace.text
        general_chat_initial_events = [
            event for event in general_chat_trace.json()["events"] if event["event_type"] == "initial_bloom_inferred"
        ]
        assert len(general_chat_initial_events) == 1
        assert general_chat_initial_events[0]["bloom_level"] == "remember"
        assert general_chat_initial_events[0]["mastery_status"] == "inferred"

        result_student_bloom_before = bloom_after_general_chat

        invalid_matrix = client.post(
            "/tasks/run",
            headers=result_student_headers,
            json={
                "raw_input": "请为《静夜思》生成教学设计",
                "task_type": "lesson_outline",
                "source_text": "床前明月光，疑是地上霜。举头望明月，低头思故乡。",
            },
        )
        assert invalid_matrix.status_code == 422, invalid_matrix.text
        assert invalid_matrix.json()["detail"] == "ERR_ROLE_TASK_FORBIDDEN"

        run_result = client.post(
            "/tasks/run",
            headers=result_student_headers,
            json={
                "raw_input": "请讲解《静夜思》的思乡之情",
                "task_type": "guided_explain",
                "source_text": "床前明月光，疑是地上霜。举头望明月，低头思故乡。",
            },
        )
        assert run_result.status_code == 200, run_result.text
        run_payload = run_result.json()
        assert run_payload["result"] is not None
        result_id = run_payload["result"]["result_id"]
        session_id = run_payload["session"]["session_id"]

        result_student_bloom_after = client.get("/students/me/bloom", headers=result_student_headers)
        assert result_student_bloom_after.status_code == 200, result_student_bloom_after.text
        assert result_student_bloom_after.json()["bloom_level"] in {"remember", "understand", "apply"}
        assert result_student_bloom_after.json()["mastery_status"] == "inferred"

        trace_after_first_run = client.get(f"/admin/trace/sessions/{session_id}", headers=admin_headers)
        assert trace_after_first_run.status_code == 200, trace_after_first_run.text
        initial_events = [event for event in trace_after_first_run.json()["events"] if event["event_type"] == "initial_bloom_inferred"]
        assert len(initial_events) == 0

        current_bloom_after_guided = client.get("/students/me/bloom", headers=result_student_headers)
        assert current_bloom_after_guided.status_code == 200, current_bloom_after_guided.text
        assert current_bloom_after_guided.json()["mastery_status"] == "inferred"
        assert current_bloom_after_guided.json()["bloom_level"] in {"remember", "understand", "apply"}

        admin_traces_after_guided = client.get("/admin/traces", headers=admin_headers)
        assert admin_traces_after_guided.status_code == 200, admin_traces_after_guided.text
        initial_bloom_trace_items = [item for item in admin_traces_after_guided.json() if item["session_id"] == unknown_payload["session"]["session_id"]]
        assert len(initial_bloom_trace_items) == 1
        assert initial_bloom_trace_items[0]["result_type"] == "general_chat"

        second_run = client.post(
            "/tasks/run",
            headers=result_student_headers,
            json={
                "raw_input": "再帮我总结一下《静夜思》的画面",
                "task_type": "guided_explain",
                "source_text": "床前明月光，疑是地上霜。举头望明月，低头思故乡。",
            },
        )
        assert second_run.status_code == 200, second_run.text
        second_session_id = second_run.json()["session"]["session_id"]
        second_trace = client.get(f"/admin/trace/sessions/{second_session_id}", headers=admin_headers)
        assert second_trace.status_code == 200, second_trace.text
        assert not any(event["event_type"] == "initial_bloom_inferred" for event in second_trace.json()["events"])
        assert client.get("/students/me/bloom", headers=result_student_headers).json()["mastery_status"] == "inferred"

        result_detail = client.get(f"/results/{result_id}", headers=result_student_headers)
        assert result_detail.status_code == 200, result_detail.text
        assert result_detail.json()["status"] == "ready"

        export_result_resp = client.post(f"/exports/result/{result_id}", headers=result_student_headers)
        assert export_result_resp.status_code == 200, export_result_resp.text
        export_result_payload = export_result_resp.json()
        assert export_result_payload["format"] in {"docx", "json"}
        assert Path(export_result_payload["file_path"]).exists()

        exported_result = client.get(f"/results/{result_id}", headers=result_student_headers)
        assert exported_result.status_code == 200, exported_result.text
        assert exported_result.json()["status"] == "exported"

        export_session_resp = client.post(f"/exports/session/{session_id}", headers=result_student_headers)
        assert export_session_resp.status_code == 200, export_session_resp.text
        export_session_payload = export_session_resp.json()
        assert export_session_payload["format"] in {"docx", "json"}
        assert Path(export_session_payload["file_path"]).exists()

        result_export_forbidden = client.post(f"/exports/result/{result_id}", headers=teacher_headers)
        assert result_export_forbidden.status_code == 403, result_export_forbidden.text
        session_export_forbidden = client.post(f"/exports/session/{session_id}", headers=teacher_headers)
        assert session_export_forbidden.status_code == 403, session_export_forbidden.text

        admin_students = client.get("/users/students", headers=admin_headers)
        assert admin_students.status_code == 200, admin_students.text
        admin_students_payload = admin_students.json()
        assert any(item["username"] == result_student_username for item in admin_students_payload)
        assert any(item["username"] == challenge_student_username for item in admin_students_payload)
        assert all("password_hash" not in item for item in admin_students_payload)

        admin_results = client.get("/admin/results", headers=admin_headers)
        assert admin_results.status_code == 200, admin_results.text
        assert any(item["result_id"] == result_id for item in admin_results.json())

        admin_traces = client.get("/admin/traces", headers=admin_headers)
        assert admin_traces.status_code == 200, admin_traces.text
        trace_item = next(item for item in admin_traces.json() if item["session_id"] == session_id)
        assert trace_item["event_count"] >= 1
        assert trace_item["result_id"] == result_id
        assert trace_item["result_type"] == "guided_explain"

        rejection_traces = [item for item in admin_traces.json() if item["session_status"] == "failed"]
        assert rejection_traces

        trace_detail = client.get(f"/admin/trace/sessions/{session_id}", headers=admin_headers)
        assert trace_detail.status_code == 200, trace_detail.text
        trace_payload = trace_detail.json()
        assert trace_payload["session"]["session_id"] == session_id
        assert trace_payload["result"]["result_id"] == result_id
        assert len(trace_payload["events"]) >= 1
        assert any(event["event_type"] == "pruning" for event in trace_payload["events"])
        assert any(event["event_type"] == "guided_explain_sedimentation" for event in trace_payload["events"])

        rejection_session_id = rejection_traces[0]["session_id"]
        rejection_detail = client.get(f"/admin/trace/sessions/{rejection_session_id}", headers=admin_headers)
        assert rejection_detail.status_code == 200, rejection_detail.text
        rejection_events = rejection_detail.json()["events"]
        assert any(event["event_type"] == "routing_rejected" for event in rejection_events)

        bloom_before = client.get("/students/me/bloom", headers=challenge_student_headers)
        assert bloom_before.status_code == 200, bloom_before.text
        assert bloom_before.json() is None

        low_level = client.post(
            "/students/me/challenges",
            headers=challenge_student_headers,
            json={
                "poem_title": "静夜思",
                "from_level": "remember",
                "student_answer": "这首诗先写月光像霜，再写思乡之情，表达比较完整。",
            },
        )
        assert low_level.status_code == 200, low_level.text
        low_payload = low_level.json()
        assert low_payload["passed"] is True
        assert low_payload["review_needed"] is False
        assert low_payload["current_bloom"]["bloom_level"] == "understand"
        assert low_payload["current_bloom"]["mastery_status"] == "inferred"
        assert low_payload["current_bloom"]["teacher_id"] == "system"

        teacher_override = client.post(
            "/teacher/bloom-overrides",
            headers=teacher_headers,
            json={
                "student_id": challenge_student_id,
                "bloom_level": "apply",
                "note": "prepare for high-level challenge",
            },
        )
        assert teacher_override.status_code == 200, teacher_override.text

        high_level = client.post(
            "/students/me/challenges",
            headers=challenge_student_headers,
            json={
                "poem_title": "春晓",
                "from_level": "apply",
                "student_answer": "我先分析诗中时间变化与感官线索，再说明春眠、闻啼鸟和风雨声如何共同烘托惜春情绪。",
            },
        )
        assert high_level.status_code == 200, high_level.text
        high_payload = high_level.json()
        assert high_payload["passed"] is True
        assert high_payload["review_needed"] is True
        assert high_payload["attempt"]["to_level"] == "analyze"
        assert high_payload["current_bloom"]["bloom_level"] == "apply"

        challenge_attempts = client.get("/students/me/challenges", headers=challenge_student_headers)
        assert challenge_attempts.status_code == 200, challenge_attempts.text
        assert len(challenge_attempts.json()) == 2

        challenge_overrides = client.get(
            f"/teacher/bloom-overrides/{challenge_student_id}", headers=teacher_headers
        )
        assert challenge_overrides.status_code == 200, challenge_overrides.text
        overrides_payload = challenge_overrides.json()
        assert len(overrides_payload) == 2
        mastery_statuses = {item["mastery_status"] for item in overrides_payload}
        assert mastery_statuses == {"inferred", "teacher_overridden"}

        teacher_mastery = client.get("/teacher/mastery", headers=teacher_headers)
        assert teacher_mastery.status_code == 200, teacher_mastery.text
        mastery_payload = teacher_mastery.json()
        challenge_mastery = next(item for item in mastery_payload if item["student_id"] == challenge_student_id)
        assert challenge_mastery["bloom_level"] == "apply"
        assert challenge_mastery["mastery_status"] == "teacher_overridden"
        assert challenge_mastery["last_challenge_to_level"] == "analyze"
        assert challenge_mastery["last_challenge_score"] >= 0.6
        assert challenge_mastery["last_review_needed"] == 1

        admin_mastery_forbidden = client.get("/teacher/mastery", headers=admin_headers)
        assert admin_mastery_forbidden.status_code == 403, admin_mastery_forbidden.text

        final_bloom = client.get("/students/me/bloom", headers=challenge_student_headers)
        assert final_bloom.status_code == 200, final_bloom.text
        assert final_bloom.json()["bloom_level"] == "apply"
        assert final_bloom.json()["mastery_status"] == "teacher_overridden"

    print("smoke backend v1: ok")


if __name__ == "__main__":
    main()
