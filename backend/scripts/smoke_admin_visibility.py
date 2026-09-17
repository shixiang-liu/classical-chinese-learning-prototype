import os
import sys
import tempfile
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _auth_headers(client: TestClient, username: str, password: str) -> dict[str, str]:
    resp = client.post("/auth/login", json={"username": username, "password": password})
    resp.raise_for_status()
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def main() -> None:
    tmpdir = tempfile.mkdtemp(prefix="slm-admin-")
    os.environ["SLM_DB_PATH"] = str(Path(tmpdir) / "db.sqlite")
    os.environ["SLM_EXPORTS_DIR"] = str(Path(tmpdir) / "exports")

    from app.main import app

    with TestClient(app) as client:
        admin_headers = _auth_headers(client, "admin", "admin123456")

        teacher_username = f"teacher_{uuid.uuid4().hex[:8]}"
        create_teacher = client.post(
            "/users/teachers",
            headers=admin_headers,
            json={
                "display_name": "Admin Created Teacher",
                "username": teacher_username,
                "password": "teacher123456",
            },
        )
        assert create_teacher.status_code == 200, create_teacher.text
        teacher_payload = create_teacher.json()
        teacher_id = teacher_payload["user_id"]

        teacher_list = client.get("/users/teachers", headers=admin_headers)
        assert teacher_list.status_code == 200, teacher_list.text
        teachers_payload = teacher_list.json()
        assert any(item["user_id"] == teacher_id for item in teachers_payload)
        assert all("password_hash" not in item for item in teachers_payload)

        student_username = f"student_{uuid.uuid4().hex[:8]}"
        create_student = client.post(
            "/users/students",
            headers=admin_headers,
            json={
                "display_name": "Admin Visible Student",
                "username": student_username,
                "password": "student123456",
                "teacher_id": teacher_id,
            },
        )
        assert create_student.status_code == 200, create_student.text

        batch_students = client.post(
            "/users/students/batch",
            headers=admin_headers,
            json={
                "teacher_id": teacher_id,
                "students": [
                    {"display_name": "Batch Student A"},
                    {"display_name": "Batch Student B"},
                ],
            },
        )
        assert batch_students.status_code == 200, batch_students.text
        batch_payload = batch_students.json()
        assert len(batch_payload) == 2
        assert all(item["teacher_id"] == teacher_id for item in batch_payload)
        assert all(item.get("initial_password") for item in batch_payload)

        student_headers = _auth_headers(client, student_username, "student123456")
        content_run = client.post(
            "/tasks/run",
            headers=student_headers,
            json={
                "raw_input": "请一步一步讲解《静夜思》的意思。",
                "task_type": "guided_explain",
                "source_text": "床前明月光，疑是地上霜。举头望明月，低头思故乡。",
            },
        )
        assert content_run.status_code == 200, content_run.text
        content_payload = content_run.json()
        assert content_payload["result"] is not None
        assert content_payload["result"]["result_type"] in {"guided_explain", "question_analysis", "lesson_outline", "general_chat"}

        general_run = client.post(
            "/tasks/run",
            headers=student_headers,
            json={
                "raw_input": "请帮我讲解今天的天气现象",
                "task_type": "guided_explain",
            },
        )
        assert general_run.status_code == 200, general_run.text
        general_payload = general_run.json()
        assert general_payload["result"] is not None
        assert general_payload["result"]["result_type"] == "general_chat"

        admin_students = client.get("/users/students", headers=admin_headers)
        assert admin_students.status_code == 200, admin_students.text
        students_payload = admin_students.json()
        assert any(item["username"] == student_username for item in students_payload)
        assert all("password_hash" not in item for item in students_payload)

        admin_results = client.get("/admin/results", headers=admin_headers)
        assert admin_results.status_code == 200, admin_results.text
        results_payload = admin_results.json()
        assert len(results_payload) >= 2
        assert any(item["result_type"] == "general_chat" for item in results_payload)

        admin_traces = client.get("/admin/traces", headers=admin_headers)
        assert admin_traces.status_code == 200, admin_traces.text
        traces_payload = admin_traces.json()
        assert len(traces_payload) >= 2

        successful_trace = next(item for item in traces_payload if item["result_type"] == content_payload["result"]["result_type"])
        assert successful_trace["event_count"] >= 4
        assert successful_trace["pipeline_stages"][:4] == ["user_input", "pruning", "generation", "validation"]
        assert successful_trace["last_error_code"] is None

        general_trace = next(item for item in traces_payload if item["result_type"] == "general_chat")
        assert general_trace["session_status"] == "persisted"
        assert general_trace["pipeline_stages"] == ["user_input", "pruning", "generation", "validation"]
        assert general_trace["last_error_code"] is None

        trace_detail = client.get(f"/admin/trace/sessions/{successful_trace['session_id']}", headers=admin_headers)
        assert trace_detail.status_code == 200, trace_detail.text
        detail_payload = trace_detail.json()
        assert detail_payload["session"]["session_id"] == successful_trace["session_id"]
        assert isinstance(detail_payload["events"], list)
        assert len(detail_payload["stage_summary"]) >= 4
        assert detail_payload["stage_summary"][0]["stage"] == "user_input"
        assert detail_payload["stage_summary"][-1]["error_code"] is None

        general_detail = client.get(f"/admin/trace/sessions/{general_trace['session_id']}", headers=admin_headers)
        assert general_detail.status_code == 200, general_detail.text
        general_detail_payload = general_detail.json()
        assert [item["stage"] for item in general_detail_payload["stage_summary"]] == ["user_input", "pruning", "generation", "validation"]

    print("smoke admin visibility: ok")


if __name__ == "__main__":
    main()
