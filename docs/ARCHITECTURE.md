# Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (Browser)                │
│  Next.js 16 + React 19 + Tailwind CSS + SWR         │
│                                                      │
│  /login        /student      /teacher     /admin     │
│  /question     /challenge    /trajectory  /accounts  │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP / JSON
                       ▼
┌─────────────────────────────────────────────────────┐
│                    Backend (FastAPI)                 │
│                                                      │
│  Auth ─── Login, JWT, role guards                    │
│  API  ─── Users, Projects, Sessions, Results         │
│         Challenges, Feedback, Admin Config           │
│                                                      │
│  ┌────────────────────────────────────────────┐     │
│  │           LangGraph Pipeline               │     │
│  │  routing → retrieve → validate → generate  │     │
│  │  → grounding → pruning → sediment          │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  Skills ─── lesson_outline, question_analysis,       │
│             guided_explain, general_chat             │
│                                                      │
│  MCP ───── Provider registry, runtime bridge,        │
│             UltraRAG bridge                          │
│                                                      │
│  Export ─── PDF, Word, JSONL (training data)         │
└──────────┬──────────────────────┬────────────────────┘
           │                      │
           ▼                      ▼
┌──────────────────┐   ┌──────────────────────┐
│  SQLite (db)     │   │  Chroma (vectors)    │
│  Users, sessions,│   │  Embeddings for      │
│  projects, events│   │  retrieval           │
└──────────────────┘   └──────────────────────┘
```

## Directory Structure

```
classical-chinese-workbench/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry, all routes
│   │   ├── auth.py              # JWT auth, password hashing
│   │   ├── db.py                # SQLite operations
│   │   ├── schemas.py           # Pydantic request/response models
│   │   ├── config.py            # Environment configuration
│   │   ├── pipeline.py          # Task execution pipeline
│   │   ├── exporter.py          # PDF/Word/JSONL export
│   │   ├── file_extract.py      # Document text extraction
│   │   ├── grok_client.py       # xAI Grok API client
│   │   ├── langfuse_client.py   # Observability client
│   │   ├── graph/               # LangGraph workflow nodes
│   │   │   ├── workflow.py      # State machine definition
│   │   │   ├── routing.py       # Task type routing
│   │   │   ├── retrieve.py      # RAG retrieval
│   │   │   ├── validate.py      # Content validation
│   │   │   ├── generate.py      # LLM generation
│   │   │   ├── grounding.py     # Evidence grounding
│   │   │   ├── pruning.py       # Context pruning
│   │   │   ├── sediment.py      # Knowledge sediment
│   │   │   └── state.py         # Graph state definition
│   │   ├── mcp/                 # Model Context Protocol
│   │   │   ├── provider_registry.py
│   │   │   ├── runtime_bridge.py
│   │   │   └── ultrarag_bridge.py
│   │   └── skills/              # AI skill implementations
│   │       ├── registry.py
│   │       ├── lesson_outline.py
│   │       ├── question_analysis.py
│   │       ├── guided_explain.py
│   │       ├── practice_gen.py
│   │       ├── review_card.py
│   │       └── learning_summary.py
│   ├── scripts/                 # Backend utility scripts
│   │   ├── reset_demo_data.py   # Demo data seeding
│   │   └── smoke_*.py           # Smoke test scripts
│   └── requirements.txt
├── frontend/
│   ├── app/                     # Next.js App Router pages
│   │   ├── layout.tsx
│   │   ├── page.tsx             # Home/redirect
│   │   ├── login/
│   │   ├── student/
│   │   ├── teacher/
│   │   ├── admin/
│   │   ├── question/
│   │   ├── challenge/
│   │   ├── trajectory/
│   │   └── accounts/
│   ├── components/
│   │   ├── dashboard/           # Main workspace components
│   │   │   ├── StudentWorkspace.tsx
│   │   │   ├── TeacherWorkspace.tsx
│   │   │   ├── AdminWorkspace.tsx
│   │   │   ├── AdminSkillsWorkspace.tsx
│   │   │   ├── AdminTraceWorkspace.tsx
│   │   │   ├── AdminTemplatesWorkspace.tsx
│   │   │   └── ...
│   │   └── shared/              # Shared UI components
│   │       ├── AppShell.tsx
│   │       ├── RoleBadge.tsx
│   │       └── StatusCard.tsx
│   ├── hooks/                   # React hooks
│   ├── lib/                     # Utilities
│   │   ├── api.ts               # API client
│   │   ├── types.ts             # TypeScript types
│   │   ├── validators.ts        # Zod validators
│   │   ├── format.ts            # Formatting utilities
│   │   ├── constants.ts         # App constants
│   │   └── storage.ts           # Local storage helpers
│   ├── public/                  # Static assets
│   └── package.json
├── docs/                        # Product documentation
├── scripts/                     # Launch scripts
├── models/                      # Local model directory (gitignored)
├── data/                        # Runtime data (gitignored)
└── exports/                     # Export output (gitignored)
```

## Data Flow

### Student Conversation Flow

1. Student submits input via `/question` page
2. Frontend calls `POST /tasks/run` with input + optional files
3. Backend routes content through LangGraph pipeline:
   - **routing**: Determines task type (general_chat, question_analysis, guided_explain)
   - **retrieve**: Fetches relevant context from Chroma or UltraRAG
   - **validate**: Checks content safety and role permissions
   - **generate**: Calls LLM (Ollama or Grok) for response
   - **grounding**: Validates response against source evidence
   - **pruning**: Trims context to appropriate length
4. Result stored as `result_objects` linked to `sessions`
5. If poem-related, system auto-creates or matches a `project`
6. Response returned to frontend

### Challenge Flow

1. Student launches challenge from poem project
2. Backend generates challenge from current Bloom level → next level
3. Student submits answer
4. System scores answer and determines pass/fail
5. If passed, Bloom level auto-upgrades (pending teacher confirmation)
6. Teacher can later review and override

### Teacher Intervention Flow

1. Teacher views student project via `/teacher` page
2. Teacher can: write feedback, correct answers, adjust Bloom levels
3. All teacher actions recorded as audit events
4. Student sees teacher-corrected version as the visible default

### Admin Audit Flow

1. Admin views school-wide dashboard at `/admin`
2. Can inspect all sessions, results, challenge attempts, Bloom overrides
3. Can configure capabilities (web search, file upload, skills, MCP providers)
4. Can export training data in JSONL format

## Key Concepts

### Bloom Taxonomy

The system tracks student progress through 6 cognitive levels:

| Level | Label (CN) | Description |
|-------|-----------|-------------|
| remember | 记忆 | Recall facts and basic concepts |
| understand | 理解 | Explain ideas or concepts |
| apply | 应用 | Use information in new situations |
| analyze | 分析 | Draw connections among ideas |
| evaluate | 评价 | Justify a stand or decision |
| create | 创造 | Produce new or original work |

### Project vs Session

- **Project**: A container around a specific poem/classical text for a specific user (student+poem or teacher+poem)
- **Session**: A single interaction within a project or a standalone chat
- **Result**: The structured output of a session (answer, analysis, outline, etc.)
- **Evidence Event**: Individual messages/inputs/outputs within a session

### Role Separation

| Feature | Student | Teacher | Admin |
|---------|---------|---------|-------|
| Chat & Projects | Own only | Own + student projects | All (read-only) |
| Bloom Adjustment | View only | Can override | View audit trail |
| Challenge | Launch & answer | Review queue | View audit trail |
| User Management | None | Create students | Create teachers & students |
| System Config | None | None | Full control |
| Data Export | Single project | All students | School-wide + training data |
