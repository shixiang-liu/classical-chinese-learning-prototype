import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import DB_PATH


Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_connection() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def row_to_dict(row) -> dict:
    return dict(row) if row else None


def _ensure_column(cur, table, column, definition):
    existing = {row[1] for row in cur.execute(f'PRAGMA table_info({table})').fetchall()}
    if column not in existing:
        cur.execute(f'ALTER TABLE {table} ADD COLUMN {column} {definition}')


def _rebuild_sessions_table_if_needed(cur: sqlite3.Cursor) -> None:
    columns = {row[1]: row for row in cur.execute('PRAGMA table_info(sessions)').fetchall()}
    project_column = columns.get('project_id')
    project_is_required = bool(project_column and project_column[3])
    if not project_is_required:
        return

    legacy_columns = set(columns.keys())
    user_id_select = 'user_id' if 'user_id' in legacy_columns else 'NULL'

    cur.execute(
        '''
        CREATE TABLE sessions__new (
            session_id TEXT PRIMARY KEY,
            project_id TEXT DEFAULT NULL,
            user_id TEXT,
            role TEXT NOT NULL,
            task_type TEXT NOT NULL,
            context_mode TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'created',
            created_at TEXT NOT NULL
        )
        '''
    )
    cur.execute(
        f'''
        INSERT INTO sessions__new (session_id, project_id, user_id, role, task_type, context_mode, status, created_at)
        SELECT
            session_id,
            NULLIF(project_id, ''),
            {user_id_select},
            role,
            task_type,
            context_mode,
            status,
            created_at
        FROM sessions
        '''
    )
    cur.execute('DROP TABLE sessions')
    cur.execute('ALTER TABLE sessions__new RENAME TO sessions')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)')


def _rebuild_projects_table_if_needed(cur: sqlite3.Cursor) -> None:
    columns = {row[1] for row in cur.execute('PRAGMA table_info(projects)').fetchall()}
    needs_rebuild = 'grade_span' in columns or 'owner_id' not in columns
    if not needs_rebuild:
        return

    owner_id_select = 'owner_id' if 'owner_id' in columns else "''"

    cur.execute(
        '''
        CREATE TABLE projects__new (
            project_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content_type TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            owner_role TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            created_at TEXT NOT NULL
        )
        '''
    )
    cur.execute(
        f'''
        INSERT INTO projects__new (project_id, title, content_type, owner_id, owner_role, status, created_at)
        SELECT
            project_id,
            title,
            content_type,
            {owner_id_select},
            owner_role,
            COALESCE(status, 'draft'),
            created_at
        FROM projects
        '''
    )
    cur.execute('DROP TABLE projects')
    cur.execute('ALTER TABLE projects__new RENAME TO projects')


DDL = '''
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    teacher_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
    project_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    owner_role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_configs (
    config_key TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version_id TEXT,
    summary TEXT,
    source_version_id TEXT
);
CREATE TABLE IF NOT EXISTS admin_config_versions (
    version_id TEXT PRIMARY KEY,
    config_key TEXT NOT NULL,
    config_json TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    summary TEXT,
    source_version_id TEXT
);
CREATE TABLE IF NOT EXISTS template_versions (
    version_id TEXT PRIMARY KEY,
    task_type TEXT NOT NULL,
    template_text TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    summary TEXT,
    source_version_id TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    project_id TEXT DEFAULT NULL,
    user_id TEXT,
    role TEXT NOT NULL,
    task_type TEXT NOT NULL,
    context_mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS result_objects (
    result_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    result_type TEXT NOT NULL,
    content_json TEXT NOT NULL,
    evidence_refs TEXT NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'pending_review',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS evidence_events (
    event_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    payload TEXT NOT NULL,
    bloom_level TEXT,
    mastery_status TEXT,
    error_type TEXT,
    inferred_cause TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS challenge_attempts (
    attempt_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    poem_title TEXT NOT NULL,
    from_level TEXT NOT NULL,
    to_level TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    question_json TEXT NOT NULL,
    rubric_json TEXT NOT NULL,
    student_answer TEXT NOT NULL,
    score REAL NOT NULL,
    passed INTEGER NOT NULL,
    review_needed INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS teacher_feedback (
    feedback_id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    poem_title TEXT,
    content TEXT NOT NULL,
    is_ai_assisted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    read_at TEXT
);
CREATE TABLE IF NOT EXISTS bloom_overrides (
    override_id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    bloom_level TEXT NOT NULL,
    mastery_status TEXT NOT NULL DEFAULT 'teacher_overridden',
    note TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_teacher_id ON users(teacher_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_results_session_id ON result_objects(session_id);
CREATE INDEX IF NOT EXISTS idx_evidence_session_id ON evidence_events(session_id);
'''


def init_db() -> None:
    con = get_connection()
    cur = con.cursor()
    cur.executescript(DDL)
    _rebuild_projects_table_if_needed(cur)
    _rebuild_sessions_table_if_needed(cur)
    _ensure_column(cur, 'sessions', 'user_id', 'TEXT')
    _ensure_column(cur, 'projects', 'owner_id', "TEXT NOT NULL DEFAULT ''")
    _ensure_column(cur, 'evidence_events', 'user_id', 'TEXT')
    _ensure_column(cur, 'result_objects', 'review_status', "TEXT NOT NULL DEFAULT 'pending_review'")
    _ensure_column(cur, 'result_objects', 'created_at', "TEXT NOT NULL DEFAULT ''")
    _ensure_column(cur, 'users', 'teacher_id', 'TEXT')
    _ensure_column(cur, 'users', 'is_active', 'INTEGER NOT NULL DEFAULT 1')
    _ensure_column(cur, 'admin_configs', 'version_id', 'TEXT')
    _ensure_column(cur, 'admin_configs', 'summary', 'TEXT')
    _ensure_column(cur, 'admin_configs', 'source_version_id', 'TEXT')
    _ensure_column(cur, 'template_versions', 'summary', 'TEXT')
    _ensure_column(cur, 'template_versions', 'source_version_id', 'TEXT')
    con.commit()
    con.close()

    _backfill_admin_config_versions()


# ── users ─────────────────────────────────────────────────────────────────────

def create_user(username, display_name, password_hash, role, teacher_id=None) -> dict:
    user_id = str(uuid.uuid4())
    con = get_connection()
    cur = con.cursor()
    cur.execute(
        'INSERT INTO users (user_id, username, display_name, password_hash, role, teacher_id, is_active, created_at) VALUES (?,?,?,?,?,?,1,?)',
        (user_id, username, display_name, password_hash, role, teacher_id, now_iso()),
    )
    con.commit()
    con.close()
    return get_user_by_id(user_id)


def get_user_by_username(username: str) -> dict | None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM users WHERE username = ?', (username,))
    row = cur.fetchone()
    con.close()
    return dict(row) if row else None


def get_user_by_id(user_id: str) -> dict | None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM users WHERE user_id = ?', (user_id,))
    row = cur.fetchone()
    con.close()
    return dict(row) if row else None


def list_students_by_teacher(teacher_id: str) -> list:
    con = get_connection()
    cur = con.cursor()
    cur.execute("SELECT * FROM users WHERE role='student' AND teacher_id=? ORDER BY display_name", (teacher_id,))
    rows = cur.fetchall()
    con.close()
    return [dict(r) for r in rows]


def list_all_students() -> list:
    con = get_connection()
    cur = con.cursor()
    cur.execute("SELECT * FROM users WHERE role='student' ORDER BY created_at DESC")
    rows = cur.fetchall()
    con.close()
    return [dict(r) for r in rows]


def list_all_teachers() -> list:
    con = get_connection()
    cur = con.cursor()
    cur.execute("SELECT * FROM users WHERE role='teacher' ORDER BY display_name ASC")
    rows = cur.fetchall()
    con.close()
    return [dict(r) for r in rows]


def create_project(title: str, content_type: str, owner_id: str, owner_role: str, status: str = 'draft') -> dict:
    project_id = str(uuid.uuid4())
    created_at = now_iso()
    con = get_connection()
    cur = con.cursor()
    cur.execute(
        'INSERT INTO projects (project_id, title, content_type, owner_id, owner_role, status, created_at) VALUES (?,?,?,?,?,?,?)',
        (project_id, title, content_type, owner_id, owner_role, status, created_at),
    )
    con.commit()
    con.close()
    return get_project(project_id)


def get_project(project_id: str) -> dict | None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM projects WHERE project_id=?', (project_id,))
    row = cur.fetchone()
    con.close()
    return dict(row) if row else None


def find_project_by_owner_and_title(owner_id: str, owner_role: str, title: str, content_type: str | None = None) -> dict | None:
    con = get_connection()
    cur = con.cursor()
    if content_type:
        cur.execute(
            'SELECT * FROM projects WHERE owner_id=? AND owner_role=? AND title=? AND content_type=? ORDER BY created_at DESC LIMIT 1',
            (owner_id, owner_role, title, content_type),
        )
    else:
        cur.execute(
            'SELECT * FROM projects WHERE owner_id=? AND owner_role=? AND title=? ORDER BY created_at DESC LIMIT 1',
            (owner_id, owner_role, title),
        )
    row = cur.fetchone()
    con.close()
    return dict(row) if row else None


def list_projects_for_user(user: dict) -> list[dict]:
    con = get_connection()
    cur = con.cursor()
    if user['role'] == 'admin':
        cur.execute('SELECT * FROM projects ORDER BY created_at DESC')
    elif user['role'] == 'teacher':
        cur.execute('SELECT * FROM projects WHERE owner_id=? OR owner_role=? ORDER BY created_at DESC', (user['user_id'], 'teacher'))
    else:
        cur.execute(
            "SELECT DISTINCT p.* FROM projects p JOIN sessions s ON s.project_id=p.project_id WHERE s.user_id=? ORDER BY p.created_at DESC",
            (user['user_id'],),
        )
    rows = cur.fetchall()
    con.close()
    return [dict(r) for r in rows]


def update_project(project_id: str, *, title: str | None = None, content_type: str | None = None, status: str | None = None) -> dict | None:
    current = get_project(project_id)
    if current is None:
        return None
    next_title = title if title is not None else current['title']
    next_content_type = content_type if content_type is not None else current['content_type']
    next_status = status if status is not None else current['status']
    con = get_connection()
    cur = con.cursor()
    cur.execute(
        'UPDATE projects SET title=?, content_type=?, status=? WHERE project_id=?',
        (next_title, next_content_type, next_status, project_id),
    )
    con.commit()
    con.close()
    return get_project(project_id)


def list_project_results(project_id: str) -> list[dict]:
    con = get_connection()
    cur = con.cursor()
    cur.execute(
        'SELECT r.* FROM result_objects r JOIN sessions s ON s.session_id=r.session_id WHERE s.project_id=? ORDER BY r.created_at DESC',
        (project_id,),
    )
    rows = cur.fetchall()
    con.close()
    return [_parse_result(r) for r in rows]


def list_project_sessions(project_id: str) -> list[dict]:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM sessions WHERE project_id=? ORDER BY created_at DESC', (project_id,))
    rows = cur.fetchall()
    con.close()
    return [dict(r) for r in rows]


def _normalize_admin_config_row(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    data = dict(row)
    data['config_json'] = json.loads(data['config_json'])
    return data


def _backfill_admin_config_versions() -> None:
    con = get_connection()
    cur = con.cursor()
    rows = cur.execute('SELECT * FROM admin_configs ORDER BY updated_at ASC').fetchall()
    for row in rows:
        data = dict(row)
        version_id = data.get('version_id') or str(uuid.uuid4())
        cur.execute(
            'UPDATE admin_configs SET version_id=? WHERE config_key=?',
            (version_id, data['config_key']),
        )
        exists = cur.execute('SELECT 1 FROM admin_config_versions WHERE version_id=?', (version_id,)).fetchone()
        if exists is None:
            cur.execute(
                'INSERT INTO admin_config_versions (version_id, config_key, config_json, updated_by, updated_at, summary, source_version_id) VALUES (?,?,?,?,?,?,?)',
                (
                    version_id,
                    data['config_key'],
                    data['config_json'],
                    data['updated_by'],
                    data['updated_at'],
                    data.get('summary'),
                    data.get('source_version_id'),
                ),
            )
    con.commit()
    con.close()


def upsert_admin_config(config_key: str, config: dict[str, Any], updated_by: str, *, summary: str | None = None) -> dict:
    updated_at = now_iso()
    version_id = str(uuid.uuid4())
    current = get_admin_config(config_key)
    source_version_id = current.get('version_id') if current else None
    config_json = json.dumps(config, ensure_ascii=False)
    con = get_connection()
    cur = con.cursor()
    cur.execute(
        'INSERT INTO admin_config_versions (version_id, config_key, config_json, updated_by, updated_at, summary, source_version_id) VALUES (?,?,?,?,?,?,?)',
        (version_id, config_key, config_json, updated_by, updated_at, summary, source_version_id),
    )
    cur.execute(
        'INSERT INTO admin_configs (config_key, config_json, updated_by, updated_at, version_id, summary, source_version_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT(config_key) DO UPDATE SET config_json=excluded.config_json, updated_by=excluded.updated_by, updated_at=excluded.updated_at, version_id=excluded.version_id, summary=excluded.summary, source_version_id=excluded.source_version_id',
        (config_key, config_json, updated_by, updated_at, version_id, summary, source_version_id),
    )
    con.commit()
    con.close()
    return get_admin_config(config_key)


def get_admin_config(config_key: str) -> dict | None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM admin_configs WHERE config_key=?', (config_key,))
    row = cur.fetchone()
    con.close()
    return _normalize_admin_config_row(row)


def list_admin_configs() -> list[dict]:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM admin_configs ORDER BY config_key ASC')
    rows = cur.fetchall()
    con.close()
    return [_normalize_admin_config_row(row) for row in rows if row is not None]


def list_admin_config_versions(config_key: str | None = None) -> list[dict]:
    con = get_connection()
    cur = con.cursor()
    if config_key:
        cur.execute('SELECT * FROM admin_config_versions WHERE config_key=? ORDER BY updated_at DESC', (config_key,))
    else:
        cur.execute('SELECT * FROM admin_config_versions ORDER BY updated_at DESC')
    rows = cur.fetchall()
    con.close()
    return [_normalize_admin_config_row(row) for row in rows if row is not None]


def create_template_version(task_type: str, template_text: str, created_by: str, *, activate: bool = True, summary: str | None = None, source_version_id: str | None = None) -> dict:
    version_id = str(uuid.uuid4())
    created_at = now_iso()
    con = get_connection()
    cur = con.cursor()
    if activate:
        cur.execute('UPDATE template_versions SET is_active=0 WHERE task_type=?', (task_type,))
    cur.execute(
        'INSERT INTO template_versions (version_id, task_type, template_text, created_by, created_at, is_active, summary, source_version_id) VALUES (?,?,?,?,?,?,?,?)',
        (version_id, task_type, template_text, created_by, created_at, int(activate), summary, source_version_id),
    )
    con.commit()
    con.close()
    return get_template_version(version_id)


def get_template_version(version_id: str) -> dict | None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM template_versions WHERE version_id=?', (version_id,))
    row = cur.fetchone()
    con.close()
    return dict(row) if row else None


def list_template_versions(task_type: str | None = None) -> list[dict]:
    con = get_connection()
    cur = con.cursor()
    if task_type:
        cur.execute('SELECT * FROM template_versions WHERE task_type=? ORDER BY created_at DESC', (task_type,))
    else:
        cur.execute('SELECT * FROM template_versions ORDER BY created_at DESC')
    rows = cur.fetchall()
    con.close()
    return [dict(r) for r in rows]


def set_active_template_version(version_id: str) -> dict | None:
    version = get_template_version(version_id)
    if version is None:
        return None
    con = get_connection()
    cur = con.cursor()
    cur.execute('UPDATE template_versions SET is_active=0 WHERE task_type=?', (version['task_type'],))
    cur.execute('UPDATE template_versions SET is_active=1 WHERE version_id=?', (version_id,))
    con.commit()
    con.close()
    return get_template_version(version_id)


def reset_student_password(student_id: str, new_hash: str) -> None:
    con = get_connection()
    cur = con.cursor()
    cur.execute("UPDATE users SET password_hash=? WHERE user_id=? AND role='student'", (new_hash, student_id))
    con.commit()
    con.close()


def update_user_password_hash(user_id: str, new_hash: str) -> None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('UPDATE users SET password_hash=? WHERE user_id=?', (new_hash, user_id))
    con.commit()
    con.close()


def generate_student_credentials(display_name: str) -> tuple[str, str]:
    normalized = ''.join(ch for ch in display_name.lower() if ch.isalnum()) or 'student'
    username = f"{normalized[:12]}_{uuid.uuid4().hex[:6]}"
    password = f"stu{uuid.uuid4().hex[:8]}"
    return username, password


# ── sessions ──────────────────────────────────────────────────────────────────

def create_session(user_id, role, task_type, context_mode, status='created', project_id=None) -> dict:
    session_id = str(uuid.uuid4())
    con = get_connection()
    cur = con.cursor()
    cur.execute(
        'INSERT INTO sessions (session_id, project_id, user_id, role, task_type, context_mode, status, created_at) VALUES (?,?,?,?,?,?,?,?)',
        (session_id, project_id or None, user_id, role, task_type, context_mode, status, now_iso()),
    )
    con.commit()
    con.close()
    return get_session(session_id)


def update_session_status(session_id: str, status: str) -> None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('UPDATE sessions SET status=? WHERE session_id=?', (status, session_id))
    con.commit()
    con.close()


def update_session_project(session_id: str, project_id: str | None) -> None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('UPDATE sessions SET project_id=? WHERE session_id=?', (project_id or None, session_id))
    con.commit()
    con.close()


def get_session(session_id: str) -> dict | None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM sessions WHERE session_id=?', (session_id,))
    row = cur.fetchone()
    con.close()
    return dict(row) if row else None


def list_sessions_for_user(user: dict) -> list:
    con = get_connection()
    cur = con.cursor()
    if user['role'] == 'admin':
        cur.execute('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 200')
    elif user['role'] == 'teacher':
        cur.execute(
            "SELECT s.* FROM sessions s JOIN users u ON u.user_id=s.user_id WHERE s.user_id=? OR u.teacher_id=? ORDER BY s.created_at DESC",
            (user['user_id'], user['user_id']),
        )
    else:
        cur.execute('SELECT * FROM sessions WHERE user_id=? ORDER BY created_at DESC', (user['user_id'],))
    rows = cur.fetchall()
    con.close()
    return [dict(r) for r in rows]


def list_sessions_by_student(student_id: str, teacher_id: str) -> list:
    con = get_connection()
    cur = con.cursor()
    cur.execute(
        'SELECT s.* FROM sessions s JOIN users u ON u.user_id=s.user_id WHERE s.user_id=? AND u.teacher_id=? ORDER BY s.created_at DESC',
        (student_id, teacher_id),
    )
    rows = cur.fetchall()
    con.close()
    return [dict(r) for r in rows]


def delete_session_bundle(session_id: str) -> None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('DELETE FROM evidence_events WHERE session_id=?', (session_id,))
    cur.execute('DELETE FROM result_objects WHERE session_id=?', (session_id,))
    cur.execute('DELETE FROM sessions WHERE session_id=?', (session_id,))
    con.commit()
    con.close()


# ── result_objects ────────────────────────────────────────────────────────────

def create_result_object(session_id, result_type, content, evidence_refs, status, review_status='pending_review') -> dict:
    result_id = str(uuid.uuid4())
    con = get_connection()
    cur = con.cursor()
    cur.execute(
        'INSERT INTO result_objects (result_id, session_id, result_type, content_json, evidence_refs, review_status, status, created_at) VALUES (?,?,?,?,?,?,?,?)',
        (result_id, session_id, result_type, json.dumps(content, ensure_ascii=False), json.dumps(evidence_refs, ensure_ascii=False), review_status, status, now_iso()),
    )
    con.commit()
    con.close()
    return get_result(result_id)


def _parse_result(row) -> dict | None:
    if row is None:
        return None
    data = dict(row)
    data['content_json'] = json.loads(data['content_json'])
    data['evidence_refs'] = json.loads(data['evidence_refs'])
    return data


def get_result(result_id: str) -> dict | None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM result_objects WHERE result_id=?', (result_id,))
    row = cur.fetchone()
    con.close()
    return _parse_result(row)


def get_result_by_session(session_id: str) -> dict | None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM result_objects WHERE session_id=? ORDER BY rowid DESC LIMIT 1', (session_id,))
    row = cur.fetchone()
    con.close()
    return _parse_result(row)


def update_result_status(result_id: str, status: str) -> None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('UPDATE result_objects SET status=? WHERE result_id=?', (status, result_id))
    con.commit()
    con.close()


def update_result_review(result_id: str, review_status: str, content: dict | None = None) -> dict:
    con = get_connection()
    cur = con.cursor()
    if content is not None:
        cur.execute(
            'UPDATE result_objects SET review_status=?, content_json=? WHERE result_id=?',
            (review_status, json.dumps(content, ensure_ascii=False), result_id),
        )
    else:
        cur.execute('UPDATE result_objects SET review_status=? WHERE result_id=?', (review_status, result_id))
    con.commit()
    con.close()
    return get_result(result_id)


def list_results_for_teacher(teacher_id: str) -> list:
    con = get_connection()
    cur = con.cursor()
    cur.execute(
        'SELECT r.* FROM result_objects r JOIN sessions s ON s.session_id=r.session_id JOIN users u ON u.user_id=s.user_id WHERE u.teacher_id=? OR s.user_id=? ORDER BY r.created_at DESC',
        (teacher_id, teacher_id),
    )
    rows = cur.fetchall()
    con.close()
    return [_parse_result(r) for r in rows]


def list_all_results() -> list:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM result_objects ORDER BY created_at DESC LIMIT 200')
    rows = cur.fetchall()
    con.close()
    return [_parse_result(r) for r in rows]


# ── teacher_feedback ──────────────────────────────────────────────────────────

def create_teacher_feedback(teacher_id, student_id, content, poem_title=None, is_ai_assisted=False) -> dict:
    feedback_id = str(uuid.uuid4())
    created_at = now_iso()
    con = get_connection()
    cur = con.cursor()
    cur.execute(
        'INSERT INTO teacher_feedback (feedback_id, teacher_id, student_id, poem_title, content, is_ai_assisted, created_at) VALUES (?,?,?,?,?,?,?)',
        (feedback_id, teacher_id, student_id, poem_title, content, int(is_ai_assisted), created_at),
    )
    con.commit()
    con.close()
    return {'feedback_id': feedback_id, 'teacher_id': teacher_id, 'student_id': student_id,
            'poem_title': poem_title, 'content': content, 'is_ai_assisted': is_ai_assisted, 'created_at': created_at}


def get_teacher_feedback_item(feedback_id: str) -> dict | None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM teacher_feedback WHERE feedback_id=?', (feedback_id,))
    row = cur.fetchone()
    con.close()
    return dict(row) if row else None


def list_teacher_feedback_for_student(student_id: str) -> list:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM teacher_feedback WHERE student_id=? ORDER BY created_at DESC', (student_id,))
    rows = cur.fetchall()
    con.close()
    return [dict(r) for r in rows]


# ── evidence_events ───────────────────────────────────────────────────────────

def create_evidence_event(session_id, user_id, event_type, actor, payload, bloom_level=None, mastery_status=None, error_type=None, inferred_cause=None) -> dict:
    event_id = str(uuid.uuid4())
    con = get_connection()
    cur = con.cursor()
    cur.execute(
        'INSERT INTO evidence_events (event_id, session_id, user_id, event_type, actor, payload, bloom_level, mastery_status, error_type, inferred_cause, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        (event_id, session_id, user_id, event_type, actor, json.dumps(payload, ensure_ascii=False), bloom_level, mastery_status, error_type, inferred_cause, now_iso()),
    )
    con.commit()
    con.close()
    return get_evidence_event(event_id)


def get_evidence_event(event_id: str) -> dict | None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM evidence_events WHERE event_id=?', (event_id,))
    row = cur.fetchone()
    con.close()
    if row is None:
        return None
    data = dict(row)
    data['payload'] = json.loads(data['payload'])
    return data


def list_evidence_events(session_id: str) -> list:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM evidence_events WHERE session_id=? ORDER BY created_at ASC', (session_id,))
    rows = cur.fetchall()
    con.close()
    result = []
    for row in rows:
        data = dict(row)
        data['payload'] = json.loads(data['payload'])
        result.append(data)
    return result


def get_session_prompt_preview(session_id: str) -> str | None:
    events = list_evidence_events(session_id)
    for event in events:
        if event.get('event_type') != 'user_input':
            continue
        payload = event.get('payload') or {}
        raw_input = payload.get('raw_input')
        if isinstance(raw_input, str) and raw_input.strip():
            return raw_input.strip()
    return None


# ── challenge_attempts ────────────────────────────────────────────────────────

def create_challenge_attempt(user_id, poem_title, from_level, to_level, difficulty, question, rubric, student_answer, score, passed, review_needed) -> dict:
    attempt_id = str(uuid.uuid4())
    created_at = now_iso()
    con = get_connection()
    cur = con.cursor()
    cur.execute(
        'INSERT INTO challenge_attempts (attempt_id, user_id, poem_title, from_level, to_level, difficulty, question_json, rubric_json, student_answer, score, passed, review_needed, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (attempt_id, user_id, poem_title, from_level, to_level, difficulty,
         json.dumps(question, ensure_ascii=False), json.dumps(rubric, ensure_ascii=False),
         student_answer, score, int(passed), int(review_needed), created_at),
    )
    con.commit()
    con.close()
    return get_challenge_attempt(attempt_id)


def get_challenge_attempt(attempt_id: str) -> dict | None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM challenge_attempts WHERE attempt_id=?', (attempt_id,))
    row = cur.fetchone()
    con.close()
    if row is None:
        return None
    data = dict(row)
    data['question_json'] = json.loads(data['question_json'])
    data['rubric_json'] = json.loads(data['rubric_json'])
    return data


def list_challenge_attempts_by_user(user_id: str) -> list:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM challenge_attempts WHERE user_id=? ORDER BY created_at DESC', (user_id,))
    rows = cur.fetchall()
    con.close()
    result = []
    for row in rows:
        data = dict(row)
        data['question_json'] = json.loads(data['question_json'])
        data['rubric_json'] = json.loads(data['rubric_json'])
        result.append(data)
    return result


# ── bloom_overrides ───────────────────────────────────────────────────────────

def create_bloom_override(student_id, teacher_id, bloom_level, note=None, mastery_status: str = 'teacher_overridden') -> dict:
    override_id = str(uuid.uuid4())
    created_at = now_iso()
    con = get_connection()
    cur = con.cursor()
    cur.execute(
        'INSERT INTO bloom_overrides (override_id, student_id, teacher_id, bloom_level, mastery_status, note, created_at) VALUES (?,?,?,?,?,?,?)',
        (override_id, student_id, teacher_id, bloom_level, mastery_status, note, created_at),
    )
    con.commit()
    con.close()
    return {'override_id': override_id, 'student_id': student_id, 'teacher_id': teacher_id,
            'bloom_level': bloom_level, 'mastery_status': mastery_status, 'note': note, 'created_at': created_at}


def get_latest_bloom_for_student(student_id: str) -> dict | None:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM bloom_overrides WHERE student_id=? ORDER BY created_at DESC LIMIT 1', (student_id,))
    row = cur.fetchone()
    if row:
        con.close()
        return dict(row)
    cur.execute('SELECT bloom_level, mastery_status, created_at FROM evidence_events WHERE user_id=? AND bloom_level IS NOT NULL ORDER BY created_at DESC LIMIT 1', (student_id,))
    row = cur.fetchone()
    con.close()
    return dict(row) if row else None


def list_bloom_overrides_for_student(student_id: str) -> list:
    con = get_connection()
    cur = con.cursor()
    cur.execute('SELECT * FROM bloom_overrides WHERE student_id=? ORDER BY created_at DESC', (student_id,))
    rows = cur.fetchall()
    con.close()
    return [dict(r) for r in rows]


def get_teacher_mastery_snapshot(teacher_id: str | None = None) -> list[dict]:
    con = get_connection()
    cur = con.cursor()
    if teacher_id:
        cur.execute(
            "SELECT user_id, username, display_name FROM users WHERE role='student' AND teacher_id=? ORDER BY display_name",
            (teacher_id,),
        )
    else:
        cur.execute(
            "SELECT user_id, username, display_name FROM users WHERE role='student' ORDER BY display_name",
        )
    students = [dict(row) for row in cur.fetchall()]
    result = []
    for student in students:
        cur.execute(
            'SELECT * FROM bloom_overrides WHERE student_id=? ORDER BY created_at DESC LIMIT 1',
            (student['user_id'],),
        )
        bloom_row = cur.fetchone()
        latest_bloom = dict(bloom_row) if bloom_row else None

        cur.execute(
            'SELECT bloom_level, mastery_status, error_type, inferred_cause, created_at FROM evidence_events WHERE user_id=? ORDER BY created_at DESC LIMIT 1',
            (student['user_id'],),
        )
        evidence_row = cur.fetchone()
        latest_evidence = dict(evidence_row) if evidence_row else None

        cur.execute(
            'SELECT to_level, review_needed, score, created_at FROM challenge_attempts WHERE user_id=? ORDER BY created_at DESC LIMIT 1',
            (student['user_id'],),
        )
        attempt_row = cur.fetchone()
        latest_attempt = dict(attempt_row) if attempt_row else None

        current_bloom = latest_bloom or latest_evidence or {}
        updated_at_candidates = [
            item.get('created_at')
            for item in (latest_bloom or {}, latest_attempt or {}, latest_evidence or {})
            if item.get('created_at')
        ]

        result.append(
            {
                'student_id': student['user_id'],
                'username': student['username'],
                'display_name': student['display_name'],
                'bloom_level': current_bloom.get('bloom_level', 'remember'),
                'mastery_status': current_bloom.get('mastery_status', 'inferred'),
                'last_error_type': (latest_evidence or {}).get('error_type'),
                'last_inferred_cause': (latest_evidence or {}).get('inferred_cause'),
                'last_challenge_to_level': (latest_attempt or {}).get('to_level'),
                'last_challenge_score': (latest_attempt or {}).get('score'),
                'last_review_needed': (latest_attempt or {}).get('review_needed'),
                'updated_at': max(updated_at_candidates) if updated_at_candidates else None,
            }
        )
    con.close()
    return result
