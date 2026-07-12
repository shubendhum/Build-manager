# BuildManager VIC — PRD & Build Memory

## Original Problem Statement
Construction project management app for a licensed builder's Project Manager in Victoria, Australia (FARM stack: FastAPI + React + MongoDB). 5-phase build. Eventual scope: projects, Victorian compliance roadmap + task management, trades directory, quote management, invoicing, cost estimation with Victoria 2025 trade rate guide, budget tracking, dashboard, document storage, AI photo analysis. Single primary user: the Project Manager. Email/password auth comes in Phase 1.

## User Personas
- Project Manager (delegate of a licensed builder in Victoria) — sole user for now.

## User Choices (Phase 0)
- Emergent Universal LLM key with GPT-4o vision model
- Photos stored on disk at /app/backend/uploads, served via /api/photos/{id}/image
- Dark slate / amber construction-industry design (carries into later phases)

## Architecture
- FastAPI backend (0.0.0.0:8001, all routes prefixed /api), React 19 frontend (CRA + craco, shadcn/ui, Tailwind, framer-motion), MongoDB via MONGO_URL.
- AI vision: emergentintegrations LlmChat → openai/gpt-4o, base64 image (downscaled to 1600px JPEG q85 via Pillow before sending), strict-JSON prompt, response parsed/validated server-side.
- Photos: originals on disk (/app/backend/uploads/{uuid}.{ext}); analysis docs in Mongo collection `photo_analyses` (uuid string ids, no ObjectId exposure, ISO datetime strings).
- OpenAPI exposed at /api/openapi.json, docs at /api/docs (ingress only routes /api/*).
- Design system: dark slate bg hsl(222.2 47.4% 11.2%), amber primary hsl(38 92% 50%), Barlow headings / Inter body, blueprint grid background. Full guidelines in /app/design_guidelines.json.

## What's Been Implemented
### Phase 0 (2026-02) — AI Photo Analysis POC ✅
- POST /api/photos/analyze — multipart image (JPEG/PNG/WEBP, ≤10MB, PIL-sniffed) + optional project_stage hint + notes + project_id → real GPT-4o analysis returning {identified_stage, progress_notes, observations[], potential_issues[], confidence}. 400 for non-image/invalid stage, 413 for oversized, 502 for AI failure.
- GET /api/photos (?project_id= filter) — list analyses newest-first (limit 200). GET /api/photos/{id}/image — serves original photo (404 if missing).
- Frontend AnalyzePage: drag-drop UploadZone, project select, stage hint Select, notes, Analyze with loading state, AnalysisResult card, HistoryGrid. All photo routes now auth-protected (cookies work for <img>).
- Approved for Phase 4: "Export to Site Diary" PDF report from analysis history.

### Phase 1 (2026-02) — Auth, Projects, VIC Roadmap & Tasks ✅
- Auth (per integration playbook): bcrypt + PyJWT, httpOnly cookies (access 15min / refresh 7d, samesite=lax) + Bearer fallback; POST /api/auth/register|login|logout|refresh, GET /api/auth/me; brute force 5-fail → 15min lockout (429); unique email index; idempotent seed of PM account from ADMIN_EMAIL/ADMIN_PASSWORD env. All API routes protected except auth/openapi/docs. Frontend: AuthContext (null/false/user states), axios refresh interceptor (/app/frontend/src/lib/api.js), ProtectedRoute redirect to /login, Login/Register tabs page. NO forgot-password flow (deferred, not in scope).
- Projects CRUD: /api/projects (GET/POST), /api/projects/{id} (GET/PUT/DELETE — delete cascades tasks, unlinks photos). Fields: name, client_name/contact, site_street/suburb/postcode (VIC 3xxx/8xxx validated), builder_name/registration/dbi_policy_number/dbi_expiry, contract_value, start/target dates, project_type (new-build|extension|renovation), status (planning|active|on-hold|completed), notes.
- VIC Roadmap: project creation auto-generates 36 tasks in 6 stages from /app/backend/roadmap_template.py; 4 mandatory RBS inspection tasks flagged. Stage keys: pre-construction, base, frame, lockup, fixing, completion. Weighted progress per VIC progress payment schedule: 5/10/15/35/25/10 (n-a tasks excluded, weights renormalised). GET /api/projects/{id}/roadmap returns stages+tasks+progress.
- Tasks: statuses not-started|in-progress|blocked|done|n-a; POST /api/projects/{id}/tasks (custom, is_custom=true), PUT/DELETE /api/tasks/{id}; due dates with overdue highlighting; assigned_trade free text (entity linking in Phase 2).
- App shell: sidebar (Dashboard, Projects, Photo Analyzer) + mobile top bar, user info + logout. Pages: DashboardPage (stat cards + active builds), ProjectsPage (cards + create dialog), ProjectDetailPage (Overview | Roadmap & Tasks tabs + 6 disabled future tabs: Trades, Quotes, Invoices, Budget, Photos, Documents), collapsible StageSections with TaskRows, TaskDialog, ProjectFormDialog, DatePicker (shadcn Calendar+Popover).
- Seed: "Residence – Ballarat West" demo project (active, $620k, Ballarat West VIC 3350, DB-U 45821) at 13% — Stage 1 done, Stage 2 4/5, Stage 3 in-progress with overdue task. Idempotent via is_seed flag.
- Testing: iteration_2 — backend 21/21, frontend 100%. Suites: /app/backend/tests/test_phase1.py + test_photos.py (updated for auth). Credentials: /app/memory/test_credentials.md; auth how-to: /app/memory/auth_testing.md.

## Endpoint Contract (Phase 0)
PhotoAnalysisRecord: { id, filename, stage_hint, notes, analysis: { identified_stage: site-preparation|base/slab|frame|lockup|fixing|completion|external-works|unknown, progress_notes: str, observations: [str], potential_issues: [str], confidence: low|medium|high }, image_url: "/api/photos/{id}/image", created_at: ISO }

## Prioritized Backlog
- P0 (Phase 2): Trades directory + link trade entities to tasks; quote management.
- P1 (Phase 3): Invoicing; cost estimation w/ VIC 2025 trade rate guide; budget tracking.
- P2 (Phase 4-5): Per-project Photos tab UI; document storage; full dashboard; "Export to Site Diary" PDF (approved); forgot-password flow.
- Deferred hardening notes: streaming upload size check, pagination on GET /api/photos, cookie secure flag env-driven for production, CORS fallback default.

## Integration Caveats
- AI call takes ~15-25s; frontend axios timeout set to 120s.
- EMERGENT_LLM_KEY in /app/backend/.env; credits deducted per analysis.
- Image testing rules for test agents at /app/image_testing.md (real-feature base64 JPEG/PNG/WEBP only).
