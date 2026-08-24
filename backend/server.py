from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException, Depends, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import asyncio
import io
import json
import base64
import logging
import uuid
from pathlib import Path
from typing import List, Optional
from datetime import datetime, timezone

from PIL import Image
from pydantic import BaseModel, Field
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from db import client, db  # noqa: E402
from auth import auth_router, get_current_user  # noqa: E402
from projects import projects_router, tasks_router  # noqa: E402
from trades import trades_router  # noqa: E402
from quotes import quotes_router  # noqa: E402
from packages import packages_router  # noqa: E402
from nextsteps import nextsteps_router  # noqa: E402
from board import board_router  # noqa: E402
from integrations import integrations_router, public_integrations_router, poll_loop  # noqa: E402
from rfqs import rfqs_router, public_rfqs_router  # noqa: E402
from variations import variations_router  # noqa: E402
from diary import diary_router  # noqa: E402
from search import search_router  # noqa: E402
from plans import plans_router  # noqa: E402
from invoices import invoices_router  # noqa: E402
from claims import claims_router  # noqa: E402
from rates import rates_router, ensure_reference_rates  # noqa: E402
from estimates import estimates_router  # noqa: E402
from budget import budget_router  # noqa: E402
from dashboard import dashboard_router  # noqa: E402
from documents import documents_router  # noqa: E402
from reports import reports_router  # noqa: E402
from seed import seed_all  # noqa: E402
from ai import vision_chat, image_content, text_content  # noqa: E402


UPLOAD_DIR = ROOT_DIR / 'uploads'
UPLOAD_DIR.mkdir(exist_ok=True)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_FORMATS = {'JPEG': ('.jpg', 'image/jpeg'), 'PNG': ('.png', 'image/png'), 'WEBP': ('.webp', 'image/webp')}
VALID_STAGES = {'site-preparation', 'base/slab', 'frame', 'lockup', 'fixing', 'completion', 'external-works', 'unknown'}
VALID_CONFIDENCE = {'low', 'medium', 'high'}

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(title="BuildManager VIC API", openapi_url="/api/openapi.json", docs_url="/api/docs")
api_router = APIRouter(prefix="/api")


# ---------- Models ----------

class AnalysisData(BaseModel):
    identified_stage: str
    progress_notes: str
    observations: List[str]
    potential_issues: List[str]
    confidence: str


class PhotoAnalysisRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    filename: str
    project_id: Optional[str] = None
    stage_hint: Optional[str] = None
    notes: Optional[str] = None
    analysis: AnalysisData
    image_url: str
    created_at: str


# ---------- AI analysis ----------

SYSTEM_PROMPT = (
    "You are an expert construction site supervisor and building inspector in Victoria, Australia. "
    "You are deeply familiar with the standard Victorian residential construction stages: "
    "site-preparation, base/slab, frame, lockup, fixing, completion, and external-works. "
    "You analyze construction progress photos for a licensed builder's site diary. "
    "You reply ONLY with a single valid JSON object. No markdown fences, no commentary, no extra text."
)


def build_user_prompt(stage_hint: Optional[str], notes: Optional[str]) -> str:
    context_lines = []
    if stage_hint:
        context_lines.append(f"The project manager suggests this photo may be from the '{stage_hint}' stage (verify against what you actually see).")
    if notes:
        context_lines.append(f"Additional context from the project manager: {notes}")
    context = ("\n".join(context_lines) + "\n") if context_lines else ""
    return (
        f"Analyze this construction progress photo.\n{context}"
        "Return a JSON object with EXACTLY these keys:\n"
        '- "identified_stage": the Victorian construction stage the photo most likely shows. Must be one of: '
        '"site-preparation", "base/slab", "frame", "lockup", "fixing", "completion", "external-works", "unknown".\n'
        '- "progress_notes": a 2-4 sentence professional progress description suitable for a builder\'s site diary.\n'
        '- "observations": array of strings listing notable items visible (materials, equipment, work quality indicators).\n'
        '- "potential_issues": array of strings listing visible defects, risks, or safety concerns. Empty array if none.\n'
        '- "confidence": one of "low", "medium", "high" reflecting how certain you are of the stage identification.'
    )


def parse_ai_response(raw: str) -> AnalysisData:
    text = raw.strip()
    if text.startswith('```'):
        text = text.strip('`')
        if text.lower().startswith('json'):
            text = text[4:]
    start = text.find('{')
    end = text.rfind('}')
    if start == -1 or end == -1:
        raise ValueError(f"No JSON object in AI response: {raw[:200]}")
    data = json.loads(text[start:end + 1])

    stage = str(data.get('identified_stage', 'unknown')).lower().strip()
    if stage not in VALID_STAGES:
        stage = 'unknown'
    confidence = str(data.get('confidence', 'medium')).lower().strip()
    if confidence not in VALID_CONFIDENCE:
        confidence = 'medium'
    observations = [str(o) for o in data.get('observations', []) if str(o).strip()]
    issues = [str(i) for i in data.get('potential_issues', []) if str(i).strip()]
    return AnalysisData(
        identified_stage=stage,
        progress_notes=str(data.get('progress_notes', '')).strip(),
        observations=observations,
        potential_issues=issues,
        confidence=confidence,
    )


async def run_ai_analysis(image_b64: str, stage_hint: Optional[str], notes: Optional[str]) -> AnalysisData:
    """Construction photo analysis.

    Goes through ai.vision_chat like every other AI call, so the model name,
    endpoint and reasoning settings live in exactly one place.
    """
    raw = await vision_chat(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    image_content(image_b64),
                    text_content(build_user_prompt(stage_hint, notes)),
                ],
            },
        ],
        max_tokens=1024,
        timeout=120.0,
    )
    return parse_ai_response(raw)


# ---------- Routes ----------

@api_router.get("/")
async def root():
    return {"message": "BuildManager VIC API"}


@api_router.post("/photos/analyze", response_model=PhotoAnalysisRecord)
async def analyze_photo(
    file: UploadFile = File(...),
    project_stage: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    project_id: Optional[str] = Form(None),
    user: dict = Depends(get_current_user),
):
    if project_id:
        if not await db.projects.find_one({"id": project_id}):
            raise HTTPException(status_code=404, detail="Project not found.")
    raw_bytes = await file.read()
    if len(raw_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image too large. Maximum upload size is 10 MB.")

    # Verify it is a real image (not just trusting the content-type header)
    try:
        img = Image.open(io.BytesIO(raw_bytes))
        img_format = img.format
        img.load()
    except Exception:
        raise HTTPException(status_code=400, detail="File is not a valid image. Please upload a JPEG, PNG or WEBP photo.")

    if img_format not in ALLOWED_FORMATS:
        raise HTTPException(status_code=400, detail=f"Unsupported image format '{img_format}'. Please upload a JPEG, PNG or WEBP photo.")

    if project_stage and (project_stage == 'unknown' or project_stage not in VALID_STAGES):
        raise HTTPException(status_code=400, detail=f"Invalid project_stage. Must be one of: {sorted(VALID_STAGES - {'unknown'})}")

    # Downscale a copy for the LLM to keep payload lean
    llm_img = img.convert('RGB')
    llm_img.thumbnail((1600, 1600))
    buf = io.BytesIO()
    llm_img.save(buf, format='JPEG', quality=85)
    image_b64 = base64.b64encode(buf.getvalue()).decode('utf-8')

    try:
        analysis = await run_ai_analysis(image_b64, project_stage, notes)
    except (ValueError, json.JSONDecodeError) as e:
        logger.error(f"Failed to parse AI response: {e}")
        raise HTTPException(status_code=502, detail="AI returned an unreadable response. Please try again.")
    except Exception as e:
        logger.error(f"AI analysis failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {str(e)[:200]}")

    # Persist original photo on disk
    photo_id = str(uuid.uuid4())
    ext, _ = ALLOWED_FORMATS[img_format]
    file_path = UPLOAD_DIR / f"{photo_id}{ext}"
    file_path.write_bytes(raw_bytes)

    record = PhotoAnalysisRecord(
        id=photo_id,
        filename=file.filename or f"photo{ext}",
        project_id=project_id,
        stage_hint=project_stage,
        notes=notes,
        analysis=analysis,
        image_url=f"/api/photos/{photo_id}/image",
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    doc = record.model_dump()
    doc['file_path'] = str(file_path)
    doc['media_type'] = ALLOWED_FORMATS[img_format][1]
    await db.photo_analyses.insert_one(doc)
    return record


@api_router.get("/photos", response_model=List[PhotoAnalysisRecord])
async def list_photos(project_id: Optional[str] = Query(None), user: dict = Depends(get_current_user)):
    query = {"project_id": project_id} if project_id else {}
    docs = await db.photo_analyses.find(query, {"_id": 0, "file_path": 0, "media_type": 0}).sort("created_at", -1).to_list(200)
    return docs


@api_router.get("/photos/{photo_id}/image")
async def get_photo_image(photo_id: str, user: dict = Depends(get_current_user)):
    doc = await db.photo_analyses.find_one({"id": photo_id}, {"_id": 0, "file_path": 1, "media_type": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Photo not found.")
    file_path = Path(doc['file_path'])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Photo file missing on disk.")
    return FileResponse(file_path, media_type=doc.get('media_type', 'image/jpeg'))


@api_router.delete("/photos/{photo_id}")
async def delete_photo(photo_id: str, user: dict = Depends(get_current_user)):
    doc = await db.photo_analyses.find_one({"id": photo_id}, {"_id": 0, "file_path": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Photo not found.")
    if doc.get("file_path"):
        Path(doc["file_path"]).unlink(missing_ok=True)
    await db.photo_analyses.delete_one({"id": photo_id})
    return {"message": "Photo deleted."}


app.include_router(auth_router)
app.include_router(projects_router)
app.include_router(tasks_router)
app.include_router(trades_router)
app.include_router(quotes_router)
app.include_router(packages_router)
app.include_router(nextsteps_router)
app.include_router(board_router)
app.include_router(integrations_router)
app.include_router(public_integrations_router)
app.include_router(rfqs_router)
app.include_router(public_rfqs_router)
app.include_router(variations_router)
app.include_router(diary_router)
app.include_router(search_router)
app.include_router(plans_router)
app.include_router(invoices_router)
app.include_router(claims_router)
app.include_router(rates_router)
app.include_router(estimates_router)
app.include_router(budget_router)
app.include_router(dashboard_router)
app.include_router(documents_router)
app.include_router(reports_router)
app.include_router(api_router)


# A 422 is invisible in the access log — it only shows the status code, so a
# malformed request from the browser gives you nothing to debug. Log which
# fields failed and what was actually sent.
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    fields = [{"loc": list(e.get("loc", [])), "msg": e.get("msg")} for e in exc.errors()]
    try:
        body = exc.body if isinstance(exc.body, (dict, list)) else str(exc.body)[:500]
    except Exception:  # noqa: BLE001
        body = "<unreadable>"
    logging.getLogger("validation").warning(
        "422 %s %s -> %s | body=%s", request.method, request.url.path, fields, body)
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.tasks.create_index([("project_id", 1), ("sort_order", 1)])
    await db.work_packages.create_index([("project_id", 1), ("sort_order", 1)])
    await db.rfqs.create_index("invitations.token", unique=True, sparse=True)
    await db.rfqs.create_index([("project_id", 1), ("package_id", 1)])
    await db.quotes.create_index([("project_id", 1), ("package_id", 1)])
    await db.notifications.create_index([("rfq_id", 1), ("created_at", -1)])
    await ensure_reference_rates()
    await seed_all()
    # Background: pull trade replies out of Gmail without anyone clicking.
    asyncio.create_task(poll_loop())


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
