import uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from db import db
from auth import get_current_user
from roadmap_template import STAGE_KEYS

quotes_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

QUOTE_STATUSES = {"pending", "accepted", "rejected", "expired"}
ATTACH_TYPES = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_ATTACH_BYTES = 10 * 1024 * 1024
QUOTE_UPLOAD_DIR = Path(__file__).parent / "uploads" / "quotes"
QUOTE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_str() -> str:
    return datetime.now(timezone.utc).date().isoformat()


class QuoteInput(BaseModel):
    work_package: str
    trade_id: str
    stage_key: str
    amount_ex_gst: float
    gst_amount: float
    total_inc_gst: float
    quote_date: Optional[str] = None
    expiry_date: Optional[str] = None
    scope_description: str = ""
    exclusions: str = ""
    status: str = "pending"


class QuoteUpdate(BaseModel):
    work_package: Optional[str] = None
    trade_id: Optional[str] = None
    stage_key: Optional[str] = None
    amount_ex_gst: Optional[float] = None
    gst_amount: Optional[float] = None
    total_inc_gst: Optional[float] = None
    quote_date: Optional[str] = None
    expiry_date: Optional[str] = None
    scope_description: Optional[str] = None
    exclusions: Optional[str] = None
    status: Optional[str] = None


async def validate_quote_refs(trade_id: Optional[str], stage_key: Optional[str], status: Optional[str]):
    if trade_id is not None and not await db.trades.find_one({"id": trade_id}):
        raise HTTPException(status_code=404, detail="Trade not found.")
    if stage_key is not None and stage_key not in STAGE_KEYS:
        raise HTTPException(status_code=400, detail=f"stage_key must be one of: {sorted(STAGE_KEYS)}")
    if status is not None and status not in QUOTE_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of: {sorted(QUOTE_STATUSES)}")


async def attach_trade_names(quotes: list) -> list:
    trade_ids = list({q["trade_id"] for q in quotes if q.get("trade_id")})
    trades = await db.trades.find({"id": {"$in": trade_ids}}, {"_id": 0, "id": 1, "business_name": 1}).to_list(500)
    name_map = {t["id"]: t["business_name"] for t in trades}
    for q in quotes:
        q["trade_name"] = name_map.get(q.get("trade_id"))
    return quotes


@quotes_router.get("/projects/{project_id}/quotes")
async def list_quotes(project_id: str):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    # Lazy-expire pending quotes past validity
    await db.quotes.update_many(
        {"project_id": project_id, "status": "pending", "expiry_date": {"$ne": None, "$lt": today_str()}},
        {"$set": {"status": "expired", "updated_at": now_iso()}},
    )
    quotes = await db.quotes.find({"project_id": project_id}, {"_id": 0, "attachment.file_path": 0}).sort("created_at", 1).to_list(500)
    return await attach_trade_names(quotes)


@quotes_router.post("/projects/{project_id}/quotes")
async def create_quote(project_id: str, data: QuoteInput):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    if not data.work_package.strip():
        raise HTTPException(status_code=400, detail="Work package title is required.")
    await validate_quote_refs(data.trade_id, data.stage_key, data.status)
    quote = data.model_dump()
    quote["work_package"] = quote["work_package"].strip()
    quote["id"] = str(uuid.uuid4())
    quote["project_id"] = project_id
    quote["attachment"] = None
    quote["created_at"] = now_iso()
    quote["updated_at"] = now_iso()
    await db.quotes.insert_one(dict(quote))
    quote.pop("_id", None)
    return (await attach_trade_names([quote]))[0]


@quotes_router.put("/quotes/{quote_id}")
async def update_quote(quote_id: str, data: QuoteUpdate):
    if not await db.quotes.find_one({"id": quote_id}):
        raise HTTPException(status_code=404, detail="Quote not found.")
    updates = data.model_dump(exclude_unset=True)
    await validate_quote_refs(updates.get("trade_id"), updates.get("stage_key"), updates.get("status"))
    updates["updated_at"] = now_iso()
    await db.quotes.update_one({"id": quote_id}, {"$set": updates})
    quote = await db.quotes.find_one({"id": quote_id}, {"_id": 0, "attachment.file_path": 0})
    return (await attach_trade_names([quote]))[0]


@quotes_router.delete("/quotes/{quote_id}")
async def delete_quote(quote_id: str):
    quote = await db.quotes.find_one({"id": quote_id})
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found.")
    if quote.get("attachment") and quote["attachment"].get("file_path"):
        Path(quote["attachment"]["file_path"]).unlink(missing_ok=True)
    await db.quotes.delete_one({"id": quote_id})
    return {"message": "Quote deleted."}


@quotes_router.post("/quotes/{quote_id}/accept")
async def accept_quote(quote_id: str):
    quote = await db.quotes.find_one({"id": quote_id}, {"_id": 0})
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found.")
    await db.quotes.update_one({"id": quote_id}, {"$set": {"status": "accepted", "updated_at": now_iso()}})
    result = await db.quotes.update_many(
        {"project_id": quote["project_id"], "work_package": quote["work_package"], "id": {"$ne": quote_id}},
        {"$set": {"status": "rejected", "updated_at": now_iso()}},
    )
    quote["status"] = "accepted"
    return {"accepted": (await attach_trade_names([quote]))[0], "rejected_count": result.modified_count}


@quotes_router.post("/quotes/{quote_id}/attachment")
async def upload_attachment(quote_id: str, file: UploadFile = File(...)):
    quote = await db.quotes.find_one({"id": quote_id})
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found.")
    if file.content_type not in ATTACH_TYPES:
        raise HTTPException(status_code=400, detail="Attachment must be a PDF, JPEG, PNG or WEBP file.")
    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > MAX_ATTACH_BYTES:
        raise HTTPException(status_code=413, detail="Attachment too large. Maximum size is 10 MB.")
    # Remove previous attachment file if present
    if quote.get("attachment") and quote["attachment"].get("file_path"):
        Path(quote["attachment"]["file_path"]).unlink(missing_ok=True)
    ext = ATTACH_TYPES[file.content_type]
    file_path = QUOTE_UPLOAD_DIR / f"{quote_id}{ext}"
    file_path.write_bytes(raw)
    attachment = {"filename": file.filename or f"attachment{ext}", "file_path": str(file_path), "media_type": file.content_type}
    await db.quotes.update_one({"id": quote_id}, {"$set": {"attachment": attachment, "updated_at": now_iso()}})
    return {"filename": attachment["filename"], "media_type": attachment["media_type"]}


@quotes_router.get("/quotes/{quote_id}/attachment")
async def get_attachment(quote_id: str):
    quote = await db.quotes.find_one({"id": quote_id}, {"_id": 0, "attachment": 1})
    if not quote or not quote.get("attachment"):
        raise HTTPException(status_code=404, detail="No attachment for this quote.")
    file_path = Path(quote["attachment"]["file_path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Attachment file missing on disk.")
    return FileResponse(file_path, media_type=quote["attachment"]["media_type"], filename=quote["attachment"]["filename"])
