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

## What's Been Implemented (2026-02 — Phase 0 complete)
- POST /api/photos/analyze — multipart image (JPEG/PNG/WEBP, ≤10MB, PIL-sniffed) + optional project_stage hint + notes → real GPT-4o analysis returning {identified_stage, progress_notes, observations[], potential_issues[], confidence}. 400 for non-image/invalid stage, 413 for oversized, 502 for AI failure.
- GET /api/photos — list analyses newest-first (limit 200). GET /api/photos/{id}/image — serves original photo (404 if missing).
- Frontend single page (AnalyzePage): drag-drop UploadZone with client-side validation + preview, stage hint Select (auto-detect default), notes Textarea, Analyze button with industrial loading state, AnalysisResult card (amber stage badge, confidence badge, site diary notes, observations, red-styled issues / green no-issues), HistoryGrid with framer-motion staggered thumbnails, sonner toasts. data-testids everywhere.
- Testing: iteration_1 — backend 8/8, frontend 100% (real AI E2E, persistence after reload verified). Regression suite at /app/backend/tests/test_photos.py (makes 1 real AI call).

## Endpoint Contract (Phase 0)
PhotoAnalysisRecord: { id, filename, stage_hint, notes, analysis: { identified_stage: site-preparation|base/slab|frame|lockup|fixing|completion|external-works|unknown, progress_notes: str, observations: [str], potential_issues: [str], confidence: low|medium|high }, image_url: "/api/photos/{id}/image", created_at: ISO }

## Prioritized Backlog
- P0 (Phase 1): Email/password auth (single PM user) — MUST use integration_playbook_expert_v2 for auth playbook; projects CRUD; link photo analyses to projects.
- P1 (Phase 2-3): Victorian compliance roadmap + task management; trades directory; quote management.
- P2 (Phase 4-5): Invoicing; cost estimation w/ VIC 2025 trade rate guide; budget tracking; dashboard; document storage.
- Deferred hardening notes: streaming upload size check (currently reads body then checks), pagination on GET /api/photos, retry on hung AI request.

## Integration Caveats
- AI call takes ~15-25s; frontend axios timeout set to 120s.
- EMERGENT_LLM_KEY in /app/backend/.env; credits deducted per analysis.
- Image testing rules for test agents at /app/image_testing.md (real-feature base64 JPEG/PNG/WEBP only).
