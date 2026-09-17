# API Reference

Base URL: `http://127.0.0.1:8000`

Interactive docs available at `http://127.0.0.1:8000/docs` when backend is running.

## Authentication

### POST `/auth/login`

Login with username and password.

**Request:**
```json
{
  "username": "student",
  "password": "student123456",
  "remember_me": false
}
```

**Response:**
```json
{
  "access_token": "eyJ...",
  "user": {
    "user_id": "...",
    "username": "student",
    "display_name": "演示学生",
    "role": "student",
    "teacher_id": "...",
    "session": { ... }
  }
}
```

### GET `/me`

Get current authenticated user info. Requires `Authorization: Bearer <token>`.

## Users

### POST `/users/students`

Create a single student account. Requires teacher or admin role.

**Request:**
```json
{
  "username": "stu001",
  "display_name": "张三",
  "password": "password123",
  "teacher_id": "..."
}
```

### POST `/users/students/batch`

Batch create students. Requires teacher or admin role.

**Request:**
```json
{
  "students": [
    { "display_name": "张三" },
    { "display_name": "李四" }
  ],
  "teacher_id": "..."
}
```

### POST `/users/teachers`

Create a teacher account. Requires admin role.

### POST `/users/reset-password`

Reset user password. Admin can reset any user; teacher can reset own students.

## Projects

### GET `/projects`

List projects visible to the current user.

**Query params:**
- `role`: Filter by owner role (`student`, `teacher`)

### POST `/projects`

Create a new project.

**Request:**
```json
{
  "title": "静夜思",
  "content_type": "poem",
  "status": "active"
}
```

### GET `/projects/{project_id}`

Get project details with session and result counts.

### PATCH `/projects/{project_id}`

Update project title or status.

### DELETE `/projects/{project_id}`

Delete a project and all associated sessions/results.

## Sessions

### GET `/sessions`

List sessions for the current user.

**Query params:**
- `project_id`: Filter by project
- `task_type`: Filter by task type

### GET `/sessions/{session_id}`

Get session details including evidence events.

## Tasks / Pipeline

### POST `/tasks/run`

Run the full LangGraph pipeline for a task.

**Request:**
```json
{
  "raw_input": "《静夜思》里为什么"疑是地上霜"？",
  "task_type": "question_analysis",
  "context_mode": "full",
  "content_type": "poem",
  "source_text": "床前明月光，疑是地上霜...",
  "project_id": "...",
  "history_messages": [
    { "role": "user", "text": "..." },
    { "role": "assistant", "text": "..." }
  ]
}
```

**Response:**
```json
{
  "session_id": "...",
  "result_id": "...",
  "result_type": "question_analysis",
  "content": { ... },
  "error_code": null
}
```

### POST `/tasks/preview`

Preview what task type the system would route content to.

## Challenges

### POST `/challenges/preview`

Preview a challenge for a student at their current Bloom level.

**Request:**
```json
{
  "student_id": "...",
  "poem_title": "静夜思"
}
```

### POST `/challenges/submit`

Submit a challenge answer.

**Request:**
```json
{
  "student_id": "...",
  "poem_title": "静夜思",
  "from_level": "apply",
  "to_level": "analyze",
  "question_json": { ... },
  "rubric_json": [...],
  "answer_text": "..."
}
```

## Results

### GET `/results`

List results. Admin sees all; teacher sees their students'; student sees own.

### GET `/results/{result_id}`

Get a single result with full content.

### PATCH `/results/{result_id}/review`

Review and update a result. Teacher or admin only.

**Request:**
```json
{
  "review_status": "accepted",
  "review_comment": "回答完整，证据充分。"
}
```

### POST `/results/{result_id}/export`

Export a result as PDF or Word.

**Request:**
```json
{
  "format": "pdf"
}
```

## Teacher Feedback

### POST `/feedback`

Create teacher feedback for a student.

**Request:**
```json
{
  "student_id": "...",
  "comment": "你的解释已经比较完整，下次可以补充动作变化的分析。",
  "poem_title": "静夜思",
  "is_ai_assisted": false
}
```

### GET `/feedback/{student_id}`

List feedback for a student.

## Bloom Overrides

### POST `/bloom-overrides`

Manually override a student's Bloom level.

**Request:**
```json
{
  "student_id": "...",
  "bloom_level": "analyze",
  "reason": "课堂表现稳定"
}
```

### GET `/bloom-overrides/{student_id}`

List Bloom override history for a student.

## Admin

### GET `/admin/skills`

Get full admin skills snapshot (skills, MCP status, templates, configs).

### GET `/admin/configs`

List all admin configurations.

### POST `/admin/configs`

Create or update an admin config.

**Request:**
```json
{
  "config_key": "capabilities",
  "config_json": {
    "web_search_enabled": true,
    "file_upload_enabled": true
  },
  "summary": "enable web search and file upload"
}
```

### GET `/admin/students`

List all students (admin only).

### GET `/admin/teachers`

List all teachers (admin only).

### GET `/admin/audit`

List audit events (Bloom adjustments, answer corrections, etc.).

## Template Versions

### GET `/templates`

List all template versions.

### POST `/templates`

Create a new template version.

**Request:**
```json
{
  "task_type": "question_analysis",
  "template_text": "生成结构化题目解析...",
  "activate": true,
  "summary": "updated prompt"
}
```

### POST `/templates/rollback`

Rollback to a previous template version.

## File Operations

### POST `/files/extract`

Extract text from an uploaded file.

**Supported formats:** images, PDF, Word (.docx), text, Markdown

### POST `/files/supported-extensions`

Get list of supported file extensions.

## System

### GET `/health`

Health check endpoint. Returns model runtime status.

```json
{
  "status": "ok",
  "model": {
    "provider": "ollama",
    "model": "gsw-qwen3-4b",
    "available": true
  }
}
```

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "ERR_CODE",
  "message": "Human-readable description",
  "fallback": "请稍后重试"
}
```

Common error codes:

| Code | Meaning |
|------|---------|
| `ERR_MODEL_UNAVAILABLE` | LLM backend not reachable |
| `ERR_ROLE_TASK_FORBIDDEN` | User role not allowed for this task |
| `ERR_GROUNDING_LOW_CONFIDENCE` | Evidence chain insufficient |
| `ERR_MISSING_SOURCE_TEXT` | Required content not provided |
