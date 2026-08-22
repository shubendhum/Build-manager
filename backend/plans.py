"""AI Build Planner — architectural drawing analysis, draft build plan generation,
and one-click apply into tasks + estimate lines.

Collections: plan_analyses (uploaded drawing + extracted scope),
             plan_drafts (AI-generated build plan awaiting user review/apply).
"""
import asyncio
import io
import json
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
from PIL import Image

from db import db
from auth import get_current_user
from roadmap_template import STAGES, STAGE_KEYS
from trades import TRADE_TYPES
from ai import vision_chat, extract_json, image_content, text_content, coerce_float, coerce_int

logger = logging.getLogger(__name__)

# ---------- Async job runner ----------

_running_jobs = set()  # track active analysis job tasks


async def _update_job(plan_id: str, **kwargs):
    """Atomically update job_status, job_step, job_error, etc."""
    await db.plan_analyses.update_one(
        {"id": plan_id},
        {"$set": {**kwargs, "updated_at": now_iso()}},
    )


async def _run_analysis(plan_id: str):
    """Background task: render pages → AI per page → aggregate scope → done."""
    # Concurrency guard: max 1 job at a time
    _running_jobs.add(plan_id)
    try:
        await _update_job(plan_id, job_status="processing", job_step="Rendering drawing sheets…")
        plan = await db.plan_analyses.find_one({"id": plan_id}, {"_id": 0})
        if not plan:
            await _update_job(plan_id, job_status="failed", job_error="Plan document not found.")
            return

        file_path = Path(plan["file_path"])
        raw = file_path.read_bytes()
        pages = render_pages(raw, plan["media_type"])

        # Step 1: per-sheet extraction
        page_summaries = []
        for i, page_b64 in enumerate(pages, start=1):
            await _update_job(plan_id, job_status="processing",
                              job_step=f"Reading sheet {i} of {len(pages)}…")
            try:
                raw_reply = await vision_chat([
                    {"role": "system", "content": PAGE_SYSTEM},
                    {"role": "user", "content": [image_content(page_b64), text_content(page_prompt(i, len(pages)))]},
                ], max_tokens=1024)
                try:
                    page_summaries.append(extract_json(raw_reply))
                except ValueError:
                    page_summaries.append({"drawing_type": "other", "summary": raw_reply[:400],
                                           "rooms": [], "key_dimensions": [], "construction_notes": []})
            except RuntimeError as e:
                await _update_job(plan_id, job_status="failed",
                                  job_error=f"AI analysis of sheet {i} failed: {str(e)[:200]}")
                return

        # Step 2: aggregate into a scope
        await _update_job(plan_id, job_status="processing", job_step="Aggregating the project scope…")
        try:
            agg_reply = await vision_chat([
                {"role": "system", "content": PAGE_SYSTEM},
                {"role": "user", "content": AGGREGATE_PROMPT.format(pages_json=json.dumps(page_summaries, indent=1))},
            ], max_tokens=1200)
            scope = clean_scope(extract_json(agg_reply))
        except RuntimeError as e:
            await _update_job(plan_id, job_status="failed",
                              job_error=f"Scope aggregation failed: {str(e)[:200]}")
            return
        except ValueError as e:
            logger.error(f"Failed to parse AI scope response: {e}")
            await _update_job(plan_id, job_status="failed",
                              job_error="AI returned an unreadable response. Please try again.")
            return

        await _update_job(plan_id, job_status="analyzed", job_step="Complete.",
                          page_summaries=page_summaries, scope=scope)

    except Exception as e:
        logger.error(f"Background analysis failed for {plan_id}: {e}")
        await _update_job(plan_id, job_status="failed",
                          job_error=f"Unexpected error: {str(e)[:200]}")
    finally:
        _running_jobs.discard(plan_id)

plans_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

MAX_PLAN_BYTES = 30 * 1024 * 1024  # 30 MB — architectural PDF sets are heavy
MAX_PDF_PAGES = 8
PDF_RENDER_DPI = 150
MAX_PAGE_PX = 1600
PLAN_TYPES = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png"}
PLANS_DIR = Path(__file__).parent / "uploads" / "plans"
PLANS_DIR.mkdir(parents=True, exist_ok=True)

STAGE_LABELS = {s["key"]: s["label"] for s in STAGES}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- Page rendering ----------

def downscale_jpeg_b64(img: Image.Image) -> str:
    import base64
    img = img.convert("RGB")
    img.thumbnail((MAX_PAGE_PX, MAX_PAGE_PX))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def render_pages(raw: bytes, media_type: str) -> List[str]:
    """Return a list of base64 JPEG pages (≤8 pages, ≤1600px) from a PDF or image upload."""
    if media_type == "application/pdf":
        import pymupdf
        try:
            doc = pymupdf.open(stream=raw, filetype="pdf")
        except Exception:
            raise HTTPException(status_code=400, detail="File is not a readable PDF.")
        if doc.page_count == 0:
            raise HTTPException(status_code=400, detail="PDF contains no pages.")
        pages = []
        zoom = PDF_RENDER_DPI / 72.0
        for page in doc.pages(0, min(doc.page_count, MAX_PDF_PAGES)):
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            pages.append(downscale_jpeg_b64(img))
        doc.close()
        return pages
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        raise HTTPException(status_code=400, detail="File is not a valid image. Upload a PDF, JPEG or PNG drawing.")
    return [downscale_jpeg_b64(img)]


# ---------- Prompts ----------

PAGE_SYSTEM = (
    "You are an expert Australian residential building designer and estimator reviewing "
    "architectural drawings for a licensed builder in Victoria. "
    "You reply ONLY with a single valid JSON object. No markdown fences, no commentary."
)


def page_prompt(page_no: int, total: int) -> str:
    return (
        f"This is sheet {page_no} of {total} of an architectural drawing set for a residential project.\n"
        "Extract what this sheet shows. Return a JSON object with EXACTLY these keys:\n"
        '- "drawing_type": e.g. "floor plan", "elevation", "site plan", "section", "electrical plan", "title sheet", "other".\n'
        '- "summary": 1-3 sentences describing what the sheet shows.\n'
        '- "rooms": array of room/space names visible (empty if not a floor plan).\n'
        '- "key_dimensions": array of notable dimensions or areas stated on the sheet (as strings).\n'
        '- "construction_notes": array of construction/material/site details readable on the sheet '
        "(cladding, roof material, slab type, storeys, garage, setbacks, easements, etc.)."
    )


AGGREGATE_PROMPT = (
    "Below are structured extractions from each sheet of an architectural drawing set for a residential "
    "project in Victoria, Australia. Combine them into a single project scope.\n\n"
    "SHEET EXTRACTIONS:\n{pages_json}\n\n"
    "Return a JSON object with EXACTLY these keys:\n"
    '- "dwelling_type": e.g. "single dwelling", "double-storey house", "unit", "extension".\n'
    '- "storeys": integer.\n'
    '- "bedrooms": integer (best estimate from room lists).\n'
    '- "bathrooms": number (count bath/ensuite/powder as visible).\n'
    '- "garage_spaces": integer.\n'
    '- "approx_floor_area_m2": number, best estimate of total floor area in square metres.\n'
    '- "construction_type": short phrase, e.g. "slab on ground + timber frame + brick veneer".\n'
    '- "roof_type": short phrase, e.g. "Colorbond metal, 22.5° pitch".\n'
    '- "notable_features": array of strings (alfresco, raked ceilings, WIR, solar, etc.).\n'
    '- "site_considerations": array of strings (fall, easements, setbacks, soil, bushfire/BAL, etc.).\n'
    '- "summary": 3-5 sentence professional summary of the proposed build for the builder\'s records.\n'
    "Use null for anything genuinely not determinable. Do not invent details that contradict the sheets."
)

DRAFT_SYSTEM = (
    "You are an expert construction planner and estimator for a licensed residential builder in "
    "Victoria, Australia. You produce practical build programmes and preliminary estimates. "
    "You reply ONLY with a single valid JSON object. No markdown fences, no commentary."
)

DRAFT_PROMPT = (
    "PROJECT SCOPE (extracted from the architectural drawings):\n{scope_json}\n\n"
    "CONSTRUCTION STAGES (use these exact stage_key values, nothing else):\n{stages}\n\n"
    "Note: generic Victorian compliance tasks (permits, mandatory inspections, insurance) already exist "
    "on the project roadmap — do NOT repeat them. Generate BUILD-SPECIFIC tasks for this particular design.\n\n"
    "RATE GUIDE (western Victoria, AUD ex-GST). Use these rates where a work item matches:\n{rates}\n\n"
    "ALLOWED TRADE CATEGORIES: {trade_types}\n\n"
    "Return a JSON object with EXACTLY these keys:\n"
    '- "tasks": array of 3-8 objects per relevant stage: {{"stage_key": "...", "name": "short task title", '
    '"description": "1 sentence of build-specific detail"}}.\n'
    '- "trade_types": array of trade categories (from the allowed list) this build requires.\n'
    '- "estimate_lines": array of 10-25 objects covering the major cost packages: '
    '{{"description": "...", "stage_key": "...", "quantity": number, "unit": "m²/m³/item/etc", '
    '"rate": number (AUD ex-GST), "rate_ref": "exact work_item name from the rate guide you based the rate on, or null"}}.\n'
    "Quantities must follow from the scope (floor area, storeys, bathrooms…). Where no rate guide item fits, "
    "estimate a realistic 2025 western-Victoria rate and set rate_ref to null."
)


# ---------- Scope / draft validation ----------

def clean_scope(data: dict) -> dict:
    return {
        "dwelling_type": str(data.get("dwelling_type") or "").strip() or None,
        "storeys": coerce_int(data.get("storeys")),
        "bedrooms": coerce_int(data.get("bedrooms")),
        "bathrooms": coerce_float(data.get("bathrooms")),
        "garage_spaces": coerce_int(data.get("garage_spaces")),
        "approx_floor_area_m2": coerce_float(data.get("approx_floor_area_m2")),
        "construction_type": str(data.get("construction_type") or "").strip() or None,
        "roof_type": str(data.get("roof_type") or "").strip() or None,
        "notable_features": [str(x) for x in (data.get("notable_features") or []) if str(x).strip()],
        "site_considerations": [str(x) for x in (data.get("site_considerations") or []) if str(x).strip()],
        "summary": str(data.get("summary") or "").strip(),
    }


async def rate_guide_docs() -> list:
    return await db.rates.find({}, {"_id": 0}).sort("sort_order", 1).to_list(500)


def indicative_rate(r: dict) -> Optional[float]:
    for low_key, high_key in (("supply_install_low", "supply_install_high"), ("labour_low", "labour_high")):
        low, high = r.get(low_key), r.get(high_key)
        if low is not None and high is not None:
            return round((low + high) / 2, 2)
        if high is not None:
            return float(high)
        if low is not None:
            return float(low)
    return None


def clean_draft(data: dict, rates: list) -> dict:
    """Hard validation: stage_keys constrained, numbers coerced, invalid rows dropped."""
    rate_by_name = {r["work_item"].lower(): r for r in rates}

    tasks = []
    for t in data.get("tasks") or []:
        stage_key = str(t.get("stage_key") or "").strip()
        name = str(t.get("name") or t.get("title") or "").strip()
        if stage_key not in STAGE_KEYS or not name:
            continue
        tasks.append({"stage_key": stage_key, "name": name[:120],
                      "description": str(t.get("description") or "").strip()[:500]})
    # Stable sort within stage order, assign sort index
    stage_order = {s["key"]: s["number"] for s in STAGES}
    tasks.sort(key=lambda t: stage_order.get(t["stage_key"], 99))
    for idx, t in enumerate(tasks):
        t["sort"] = idx * 10

    trade_types = [str(t).strip() for t in (data.get("trade_types") or []) if str(t).strip() in TRADE_TYPES]

    lines = []
    for l in data.get("estimate_lines") or []:
        description = str(l.get("description") or "").strip()
        stage_key = str(l.get("stage_key") or "").strip()
        quantity = coerce_float(l.get("quantity"), None)
        rate = coerce_float(l.get("rate"), None)
        if not description or stage_key not in STAGE_KEYS or quantity is None or rate is None:
            continue
        if quantity < 0 or rate < 0:
            continue
        rate_ref = str(l.get("rate_ref") or "").strip()
        matched = rate_by_name.get(rate_ref.lower()) if rate_ref else None
        lines.append({
            "description": description[:200],
            "stage_key": stage_key,
            "quantity": round(quantity, 2),
            "unit": str(l.get("unit") or "").strip()[:30],
            "rate": round(rate, 2),
            "rate_item_id": matched["id"] if matched else None,
            "rate_ref": matched["work_item"] if matched else None,
            "ai_suggested": matched is None,
        })

    return {"tasks": tasks, "trade_types": sorted(set(trade_types)), "estimate_lines": lines}


# ---------- Routes ----------

@plans_router.post("/projects/{project_id}/plans/analyze")
async def analyze_plan(project_id: str, file: UploadFile = File(...)):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    if file.content_type not in PLAN_TYPES:
        raise HTTPException(status_code=400, detail="Upload an architectural drawing as PDF, JPEG or PNG.")
    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > MAX_PLAN_BYTES:
        raise HTTPException(status_code=413, detail="Drawing too large. Maximum upload size is 30 MB.")

    plan_id = str(uuid.uuid4())
    ext = PLAN_TYPES[file.content_type]
    file_path = PLANS_DIR / f"{plan_id}{ext}"
    file_path.write_bytes(raw)

    # Count pages for progress tracking (fast, no AI yet)
    try:
        page_count = len(render_pages(raw, file.content_type))
    except HTTPException:
        raise
    except Exception:
        page_count = 1

    record = {
        "id": plan_id,
        "project_id": project_id,
        "filename": file.filename or f"drawing{ext}",
        "media_type": file.content_type,
        "page_count": page_count,
        "page_summaries": [],
        "scope": None,
        "status": "pending",
        "job_status": "pending",
        "job_step": "Queued for analysis…",
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    doc = dict(record)
    doc["file_path"] = str(file_path)
    await db.plan_analyses.insert_one(doc)

    # Dispatch background analysis task
    asyncio.create_task(_run_analysis(plan_id))

    return {"id": plan_id, "job_status": "pending", "page_count": page_count}


@plans_router.get("/plans/{plan_id}")
async def get_plan_status(plan_id: str):
    """Polling endpoint: returns job status + progress info."""
    plan = await db.plan_analyses.find_one({"id": plan_id}, {"_id": 0, "file_path": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Plan analysis not found.")
    return plan


@plans_router.put("/plans/{plan_id}/scope")
async def update_scope(plan_id: str, data: dict):
    """Save user-edited scope back to the plan."""
    plan = await db.plan_analyses.find_one({"id": plan_id}, {"_id": 0, "project_id": 1})
    if not plan:
        raise HTTPException(status_code=404, detail="Plan analysis not found.")
    cleaned = clean_scope(data)
    await db.plan_analyses.update_one(
        {"id": plan_id},
        {"$set": {"scope": cleaned, "updated_at": now_iso()}},
    )
    return cleaned


@plans_router.get("/projects/{project_id}/plans")
async def list_plans(project_id: str):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    plans = await db.plan_analyses.find({"project_id": project_id},
                                        {"_id": 0, "file_path": 0}).sort("created_at", -1).to_list(50)
    for p in plans:
        p["draft"] = await db.plan_drafts.find_one({"plan_id": p["id"]}, {"_id": 0}, sort=[("created_at", -1)])
    return plans


@plans_router.post("/plans/{plan_id}/generate-draft")
async def generate_draft(plan_id: str):
    plan = await db.plan_analyses.find_one({"id": plan_id}, {"_id": 0, "file_path": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Plan analysis not found.")

    rates = await rate_guide_docs()
    rate_lines = []
    for r in rates:
        rate = indicative_rate(r)
        if rate is None:
            continue
        rate_lines.append(f'- work_item: "{r["work_item"]}" | unit: {r["unit"]} | rate: ${rate:g} | trade: {r["trade_type"]}')

    stages_txt = "\n".join(f'- stage_key "{s["key"]}" — {s["label"]}' for s in STAGES)
    prompt = DRAFT_PROMPT.format(
        scope_json=json.dumps(plan["scope"], indent=1),
        stages=stages_txt,
        rates="\n".join(rate_lines),
        trade_types=", ".join(sorted(TRADE_TYPES)),
    )

    try:
        raw_reply = await vision_chat([
            {"role": "system", "content": DRAFT_SYSTEM},
            {"role": "user", "content": prompt},
        ], max_tokens=6000, timeout=300.0)
        draft_data = clean_draft(extract_json(raw_reply), rates)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"AI draft generation failed: {str(e)[:200]}")
    except ValueError as e:
        logger.error(f"Failed to parse AI draft response: {e}")
        raise HTTPException(status_code=502, detail="AI returned an unreadable draft. Please try again.")

    if not draft_data["tasks"] and not draft_data["estimate_lines"]:
        raise HTTPException(status_code=502, detail="AI draft contained no valid tasks or estimate lines. Please try again.")

    draft = {
        "id": str(uuid.uuid4()),
        "plan_id": plan_id,
        "project_id": plan["project_id"],
        **draft_data,
        "status": "draft",
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.plan_drafts.insert_one(dict(draft))
    await db.plan_analyses.update_one({"id": plan_id}, {"$set": {"status": "drafted", "updated_at": now_iso()}})
    draft.pop("_id", None)
    return draft


class ApplyTask(BaseModel):
    stage_key: str
    name: str
    description: str = ""


class ApplyPackage(BaseModel):
    title: str
    trade_type: str = "other"
    stage_key: str
    scope: str = ""


class ApplyLine(BaseModel):
    description: str
    stage_key: str
    package_title: Optional[str] = None
    quantity: float = 1
    unit: str = ""
    rate: float = 0
    rate_item_id: Optional[str] = None
    ai_suggested: bool = False


class ApplyInput(BaseModel):
    draft_id: str
    tasks: List[ApplyTask] = []
    trade_types: List[str] = []
    packages: List[ApplyPackage] = []
    estimate_lines: List[ApplyLine] = []


@plans_router.post("/plans/{plan_id}/apply")
async def apply_draft(plan_id: str, data: ApplyInput):
    plan = await db.plan_analyses.find_one({"id": plan_id}, {"_id": 0, "project_id": 1})
    if not plan:
        raise HTTPException(status_code=404, detail="Plan analysis not found.")
    draft = await db.plan_drafts.find_one({"id": data.draft_id, "plan_id": plan_id}, {"_id": 0})
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found for this plan.")
    if draft["status"] != "draft":
        raise HTTPException(status_code=409, detail="This draft has already been applied to the project.")

    project_id = plan["project_id"]
    for item in list(data.tasks) + list(data.estimate_lines):
        if item.stage_key not in STAGE_KEYS:
            raise HTTPException(status_code=400, detail=f"stage_key must be one of: {sorted(STAGE_KEYS)}")
    for line in data.estimate_lines:
        if line.quantity < 0 or line.rate < 0:
            raise HTTPException(status_code=400, detail="Quantity and rate cannot be negative.")

    # Tasks — appended after existing tasks in each stage (same logic as manual task creation)
    task_docs = []
    next_sort = {}
    for t in data.tasks:
        if not t.name.strip():
            continue
        if t.stage_key not in next_sort:
            last = await db.tasks.find({"project_id": project_id, "stage_key": t.stage_key}).sort("sort_order", -1).to_list(1)
            next_sort[t.stage_key] = (last[0]["sort_order"] + 10) if last else 0
        else:
            next_sort[t.stage_key] += 10
        task_docs.append({
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "stage_key": t.stage_key,
            "title": t.name.strip(),
            "description": t.description.strip(),
            "status": "not-started",
            "due_date": None,
            "assigned_trade": "",
            "trade_id": None,
            "is_mandatory_inspection": False,
            "sort_order": next_sort[t.stage_key],
            "is_custom": True,
            "ai_generated": True,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        })
    if task_docs:
        await db.tasks.insert_many([dict(d) for d in task_docs])

    # Work packages — created first so estimate lines can be stamped with package_id
    package_ids_by_title = {}
    if data.packages:
        last_pkg = await db.work_packages.find({"project_id": project_id}).sort("sort_order", -1).to_list(1)
        pkg_sort = (last_pkg[0]["sort_order"] + 10) if last_pkg else 0
        pkg_docs = []
        for pkg in data.packages:
            title = pkg.title.strip()
            if not title or title in package_ids_by_title:
                continue
            existing = await db.work_packages.find_one({"project_id": project_id, "title": title}, {"_id": 0, "id": 1})
            if existing:
                package_ids_by_title[title] = existing["id"]
                continue
            pkg_id = str(uuid.uuid4())
            package_ids_by_title[title] = pkg_id
            pkg_docs.append({
                "id": pkg_id,
                "project_id": project_id,
                "title": title,
                "trade_type": pkg.trade_type if pkg.trade_type in TRADE_TYPES else "other",
                "stage_key": pkg.stage_key,
                "scope": pkg.scope.strip(),
                "status": "draft",
                "awarded_quote_id": None,
                "awarded_trade_id": None,
                "source": "planner",
                "plan_id": plan_id,
                "sort_order": pkg_sort,
                "created_by": None,
                "created_at": now_iso(),
                "updated_at": now_iso(),
            })
            pkg_sort += 10
        if pkg_docs:
            await db.work_packages.insert_many([dict(d) for d in pkg_docs])

    # Estimate lines
    line_docs = []
    last = await db.estimate_lines.find({"project_id": project_id}).sort("sort_order", -1).to_list(1)
    sort_order = (last[0]["sort_order"] + 10) if last else 0
    for l in data.estimate_lines:
        if not l.description.strip():
            continue
        line_docs.append({
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "description": l.description.strip(),
            "stage_key": l.stage_key,
            "package_id": package_ids_by_title.get((l.package_title or "").strip()),
            "rate_item_id": l.rate_item_id,
            "quantity": l.quantity,
            "unit": l.unit,
            "rate": l.rate,
            "gst_applicable": True,
            "ai_suggested": l.ai_suggested,
            "sort_order": sort_order,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        })
        sort_order += 10
    if line_docs:
        await db.estimate_lines.insert_many([dict(d) for d in line_docs])

    if data.trade_types:
        valid_types = [t for t in data.trade_types if t in TRADE_TYPES]
        await db.projects.update_one({"id": project_id}, {"$set": {"ai_trade_types": valid_types, "updated_at": now_iso()}})

    await db.plan_drafts.update_one({"id": data.draft_id}, {"$set": {
        "status": "applied", "applied_at": now_iso(), "updated_at": now_iso(),
    }})
    await db.plan_analyses.update_one({"id": plan_id}, {"$set": {"status": "applied", "updated_at": now_iso()}})

    return {
        "message": "Build plan applied to project.",
        "tasks_created": len(task_docs),
        "estimate_lines_created": len(line_docs),
        "trade_types": data.trade_types,
    }
