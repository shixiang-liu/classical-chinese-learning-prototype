import os
import sys
import tempfile
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> None:
    tmpdir = tempfile.mkdtemp(prefix="slm-smoke-")
    os.environ["SLM_DB_PATH"] = str(Path(tmpdir) / "db.sqlite")
    os.environ["SLM_EXPORTS_DIR"] = str(Path(tmpdir) / "exports")

    from app.main import app

    with TestClient(app) as client:
        teacher_login = client.post(
            "/auth/login",
            json={"username": "teacher", "password": "teacher123456"},
        )
        teacher_login.raise_for_status()
        teacher_token = teacher_login.json()["access_token"]
        teacher_headers = {"Authorization": f"Bearer {teacher_token}"}

        student_username = f"student_{uuid.uuid4().hex[:8]}"
        created_student = client.post(
            "/users/students",
            headers=teacher_headers,
            json={
                "display_name": "Smoke Student",
                "username": student_username,
                "password": "student123456",
            },
        )
        created_student.raise_for_status()

        student_login = client.post(
            "/auth/login",
            json={"username": student_username, "password": "student123456"},
        )
        student_login.raise_for_status()
        student_token = student_login.json()["access_token"]
        student_headers = {"Authorization": f"Bearer {student_token}"}

        bloom_before = client.get("/students/me/bloom", headers=student_headers)
        assert bloom_before.status_code == 200
        assert bloom_before.json() is None

        low_level = client.post(
            "/students/me/challenges",
            headers=student_headers,
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

        override_list = client.get(
            f"/teacher/bloom-overrides/{created_student.json()['user_id']}",
            headers=teacher_headers,
        )
        assert override_list.status_code == 200, override_list.text
        override_payload = override_list.json()
        assert len(override_payload) == 1
        assert override_payload[0]["mastery_status"] == "inferred"

        high_level_override = client.post(
            "/teacher/bloom-overrides",
            headers=teacher_headers,
            json={
                "student_id": created_student.json()["user_id"],
                "bloom_level": "apply",
                "note": "prepare for high-level challenge",
            },
        )
        assert high_level_override.status_code == 200, high_level_override.text

        high_level = client.post(
            "/students/me/challenges",
            headers=student_headers,
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

        challenge_list = client.get("/students/me/challenges", headers=student_headers)
        assert challenge_list.status_code == 200
        attempts = challenge_list.json()
        assert len(attempts) == 2

    print("smoke challenge flow: ok")


if __name__ == "__main__":
    main()
