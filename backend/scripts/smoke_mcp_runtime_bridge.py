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
    response = client.post("/auth/login", json={"username": username, "password": password})
    response.raise_for_status()
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def main() -> None:
    tmpdir = tempfile.mkdtemp(prefix="slm-mcp-")
    os.environ["SLM_DB_PATH"] = str(Path(tmpdir) / "db.sqlite")
    os.environ["SLM_EXPORTS_DIR"] = str(Path(tmpdir) / "exports")

    from app.main import app

    with TestClient(app) as client:
        admin_headers = _auth_headers(client, "admin", "admin123456")

        initial_snapshot = client.get("/admin/skills", headers=admin_headers)
        assert initial_snapshot.status_code == 200, initial_snapshot.text
        initial_payload = initial_snapshot.json()
        assert "providers_detail" in initial_payload["mcp"]
        assert "tools" in initial_payload["mcp"]
        assert "grok-search" in initial_payload["mcp"]["providers"]
        assert "ultrarag" in initial_payload["mcp"]["providers"]
        assert "filesystem" not in initial_payload["mcp"]["providers"]
        assert "playwright" not in initial_payload["mcp"]["providers"]
        assert "web_search" in initial_payload["mcp"]["tools"]

        config_response = client.post(
            "/admin/configs",
            headers=admin_headers,
            json={
                "config_key": "mcp",
                "config_json": {
                    "enabled": True,
                    "providers": [
                        {"name": "unknown-provider", "enabled": True},
                    ],
                    "hot_reload": True,
                    "tool_overrides": {
                        "web_search": {"enabled": False},
                    },
                },
            },
        )
        assert config_response.status_code == 200, config_response.text

        reload_response = client.post("/admin/skills/reload", headers=admin_headers)
        assert reload_response.status_code == 200, reload_response.text
        reload_payload = reload_response.json()
        assert "web_search" not in reload_payload["mcp"]["tools"]
        assert reload_payload["mcp"]["providers_detail"]["unknown-provider"]["registered"] is False
        assert reload_payload["mcp"]["last_error"] == "unknown_provider:unknown-provider"

        teacher_username = f"teacher_{uuid.uuid4().hex[:8]}"
        teacher_response = client.post(
            "/users/teachers",
            headers=admin_headers,
            json={
                "display_name": "Runtime Bridge Teacher",
                "username": teacher_username,
                "password": "teacher123456",
            },
        )
        assert teacher_response.status_code == 200, teacher_response.text
        teacher_id = teacher_response.json()["user_id"]

        student_username = f"student_{uuid.uuid4().hex[:8]}"
        student_response = client.post(
            "/users/students",
            headers=admin_headers,
            json={
                "display_name": "Runtime Bridge Student",
                "username": student_username,
                "password": "student123456",
                "teacher_id": teacher_id,
            },
        )
        assert student_response.status_code == 200, student_response.text

        student_headers = _auth_headers(client, student_username, "student123456")
        run_response = client.post(
            "/tasks/run",
            headers=student_headers,
            json={
                "raw_input": "请一步一步讲解《静夜思》的意思。",
                "task_type": "guided_explain",
                "source_text": "床前明月光，疑是地上霜。举头望明月，低头思故乡。",
                "web_search_enabled": True,
            },
        )
        assert run_response.status_code == 200, run_response.text
        run_payload = run_response.json()
        assert run_payload["state"]["web_search_requested"] is True
        assert run_payload["state"]["web_search_enabled"] is False
        assert run_payload["state"]["mcp_runtime"]["reason"] == "web_search_disabled"

    print("smoke mcp runtime bridge: ok")


if __name__ == "__main__":
    main()
