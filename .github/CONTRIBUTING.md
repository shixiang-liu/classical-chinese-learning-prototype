# Contributing Guide

This document covers the practical steps for contributing to Classical Chinese Workbench.

## Prerequisites

- Python 3.11+
- Node.js 20+
- npm
- (Optional) Ollama for local model inference

## Quick Start

### 1. Clone and Install

```powershell
git clone <repo-url>
cd classical-chinese-workbench

# Python backend
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements.txt

# Node.js frontend
cd frontend
npm install
cd ..
```

### 2. Configure Environment

```powershell
cp .env.example .env
```

Edit `.env` to set your model provider and API keys. The defaults work for Ollama local inference.

### 3. Seed Demo Data

```powershell
python backend/scripts/reset_demo_data.py
```

### 4. Start the Stack

```powershell
.\scripts\start-demo.ps1 -ResetDemoData
```

Or start services individually:

```powershell
# Backend
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000

# Frontend (in a separate terminal)
cd frontend
npm run dev
```

## Development Workflow

### Branching

- Branch from `main` for each feature or fix
- Name branches descriptively: `feature/student-export`, `fix/bloom-calculation`
- One logical change per branch

### Before You Code

1. Read `docs/ARCHITECTURE.md` for the system layout and data flow
2. Read `docs/demo_scope_v1.md` for what the prototype does and does not cover

### Code Conventions

**Backend (Python):**
- Follow existing patterns in `backend/app/`
- Use type hints on all new functions
- New API endpoints go in `backend/app/main.py`
- Database operations go in `backend/app/db.py`
- Pydantic schemas go in `backend/app/schemas.py`

**Frontend (TypeScript/React):**
- Use Next.js App Router conventions
- Components live in `frontend/components/`
- API calls go through `frontend/lib/api.ts`
- Types in `frontend/lib/types.ts`
- Run `npm run typecheck` before committing

### Validation

Before submitting a PR:

```powershell
# Frontend
cd frontend
npm run typecheck
npm run lint

# Backend smoke tests
python backend/scripts/smoke_admin_visibility.py
python backend/scripts/smoke_challenge_flow.py
```

## Pull Requests

- Fill in the PR template (`.github/PULL_REQUEST_TEMPLATE.md`)
- Include what changed and why
- List validation steps you ran
- Update docs if behavior changed

## What NOT to Commit

The `.gitignore` already blocks these, but double-check:

- `data/` — SQLite database and Chroma indexes
- `exports/` — generated export files
- `models/` — local model binaries
- `.env` — secrets and API keys
- `*.log` — runtime logs
- `__pycache__/`, `node_modules/`, `.next/` — build artifacts
- Browser profiles, Playwright screenshots

## Troubleshooting

### Backend won't start

- Ensure `.venv` is activated
- Check `data/` directory exists (the reset script creates it)
- Look at `backend-dev-err.log` for startup errors

### Frontend build fails

- Run `npm install` in `frontend/`
- Delete `frontend/.next/` and retry
- Check `npm run typecheck` for TypeScript errors

### Demo data issues

- Re-run `python backend/scripts/reset_demo_data.py`
- The script is idempotent — safe to run multiple times

## Architecture Overview

See `docs/ARCHITECTURE.md` for system structure and data flow.

## API Reference

See `docs/API_REFERENCE.md` for endpoint documentation.
