import uuid
import secrets
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel
from db import db
from auth import get_current_user
from roadmap_template import STAGE_KEYS

rfqs_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])
public_rfqs_router = APIRouter(prefix="/api/public")  # NO auth — trade-facing portal

RFQ_STATUSES = {"sent", "submitted", "closed"}
ATTACH_TYPES = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_ATTACH_BYTES = 10 * 1024 * 1024
QUOTE_UPLOAD_DIR = Path(__file__).parent / "uploads" / "quotes"
QUOTE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class RfqInput(BaseModel):
    trade_id: str
    scope: str
    stage_key: str = "lockup"
    due_date: Optional[str] = None


async def attach_trade_names(rfqs: list) -> list:
    trade_ids = list({r["trade_id"] for r in rfqs if r.get("trade_id")})
    trades = await db.trades.find({"id": {"$in": trade_ids}}, {"_id": 0, "id": 1, "business_name": 1, "email": 1}).to_list(500)
    tmap = {t["id"]: t for t in trades}
    for r in rfqs:
        t = tmap.get(r.get("trade_id"), {})
        r["trade_name"] = t.get("business_name")
        r["trade_email"] = t.get("email")
    return rfqs


# ---------- Authed routes (builder side) ----------

@rfqs_router.post("/projects/{project_id}/rfqs")
async def create_rfq(project_id: str, data: RfqInput):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    if not await db.trades.find_one({"id": data.trade_id}):
        raise HTTPException(status_code=404, detail="Trade not found.")
    if not data.scope.strip():
        raise HTTPException(status_code=400, detail="Scope of works is required.")
    if data.stage_key not in STAGE_KEYS:
        raise HTTPException(status_code=400, detail=f"stage_key must be one of: {sorted(STAGE_KEYS)}")
    rfq = {
        "id": str(uuid.uuid4()),
        "project_id": project_id,
        "trade_id": data.trade_id,
        "scope": data.scope.strip(),
        "stage_key": data.stage_key,
        "due_date": data.due_date or None,
        "token": secrets.token_urlsafe(24),
        "status": "sent",
        "submitted_quote_id": None,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.rfqs.insert_one(dict(rfq))
    rfq.pop("_id", None)
    return (await attach_trade_names([rfq]))[0]


@rfqs_router.get("/projects/{project_id}/rfqs")
async def list_rfqs(project_id: str):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    rfqs = await db.rfqs.find({"project_id": project_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return await attach_trade_names(rfqs)


@rfqs_router.post("/rfqs/{rfq_id}/close")
async def close_rfq(rfq_id: str):
    rfq = await db.rfqs.find_one({"id": rfq_id}, {"_id": 0})
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found.")
    await db.rfqs.update_one({"id": rfq_id}, {"$set": {"status": "closed", "updated_at": now_iso()}})
    rfq["status"] = "closed"
    return (await attach_trade_names([rfq]))[0]


# ---------- Public portal routes (token auth only) ----------

async def get_open_rfq(token: str) -> dict:
    rfq = await db.rfqs.find_one({"token": token}, {"_id": 0})
    if not rfq:
        raise HTTPException(status_code=404, detail="Quote request not found. Check the link you were sent.")
    if rfq["status"] == "closed":
        raise HTTPException(status_code=410, detail="This quote request has been closed by the builder.")
    return rfq


@public_rfqs_router.get("/rfqs/{token}")
async def public_rfq(token: str):
    rfq = await get_open_rfq(token)
    project = await db.projects.find_one({"id": rfq["project_id"]}, {"_id": 0})
    trade = await db.trades.find_one({"id": rfq["trade_id"]}, {"_id": 0, "business_name": 1, "contact_person": 1})
    street = (project or {}).get("site_street") or ""
    suburb_line = f"{(project or {}).get('site_suburb', '')} VIC {(project or {}).get('site_postcode', '')}".strip()
    return {
        "project_name": (project or {}).get("name"),
        "site_address": ", ".join(p for p in [street, suburb_line] if p.strip()),
        "builder_name": (project or {}).get("builder_name") or "The builder",
        "trade_name": (trade or {}).get("business_name"),
        "scope": rfq["scope"],
        "due_date": rfq.get("due_date"),
        "status": rfq["status"],
    }


@public_rfqs_router.post("/rfqs/{token}/submit")
async def public_rfq_submit(
    token: str,
    amount_ex_gst: float = Form(...),
    gst_amount: float = Form(...),
    inclusions: str = Form(""),
    exclusions: str = Form(""),
    lead_time: str = Form(""),
    contact_name: str = Form(...),
    contact_phone: str = Form(""),
    contact_email: str = Form(""),
    attachment: Optional[UploadFile] = File(None),
):
    rfq = await get_open_rfq(token)
    if rfq["status"] == "submitted":
        raise HTTPException(status_code=409, detail="A quote has already been submitted for this request.")
    if amount_ex_gst < 0 or gst_amount < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative.")
    if not contact_name.strip():
        raise HTTPException(status_code=400, detail="Contact name is required.")

    quote_id = str(uuid.uuid4())
    attach_doc = None
    if attachment is not None and attachment.filename:
        if attachment.content_type not in ATTACH_TYPES:
            raise HTTPException(status_code=400, detail="Attachment must be a PDF, JPEG, PNG or WEBP file.")
        raw = await attachment.read()
        if len(raw) == 0:
            raise HTTPException(status_code=400, detail="Attached file is empty.")
        if len(raw) > MAX_ATTACH_BYTES:
            raise HTTPException(status_code=413, detail="Attachment too large. Maximum size is 10 MB.")
        ext = ATTACH_TYPES[attachment.content_type]
        file_path = QUOTE_UPLOAD_DIR / f"{quote_id}{ext}"
        file_path.write_bytes(raw)
        attach_doc = {"filename": attachment.filename or f"attachment{ext}", "file_path": str(file_path),
                      "media_type": attachment.content_type}

    work_package = rfq["scope"].strip().splitlines()[0][:60]
    quote = {
        "id": quote_id,
        "project_id": rfq["project_id"],
        "trade_id": rfq["trade_id"],
        "work_package": work_package,
        "stage_key": rfq.get("stage_key", "lockup"),
        "amount_ex_gst": round(float(amount_ex_gst), 2),
        "gst_amount": round(float(gst_amount), 2),
        "total_inc_gst": round(float(amount_ex_gst) + float(gst_amount), 2),
        "quote_date": datetime.now(timezone.utc).date().isoformat(),
        "expiry_date": None,
        "scope_description": inclusions.strip(),
        "exclusions": exclusions.strip(),
        "lead_time": lead_time.strip(),
        "contact_name": contact_name.strip(),
        "contact_phone": contact_phone.strip(),
        "contact_email": contact_email.strip(),
        "status": "submitted",
        "source": "portal",
        "rfq_id": rfq["id"],
        "attachment": attach_doc,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.quotes.insert_one(dict(quote))
    await db.rfqs.update_one({"id": rfq["id"]}, {"$set": {
        "status": "submitted", "submitted_quote_id": quote_id, "updated_at": now_iso(),
    }})
    return {"message": "Quote submitted. The builder will be in touch.", "quote_id": quote_id}
