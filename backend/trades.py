import uuid
from datetime import datetime, timezone, date, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from db import db
from auth import get_current_user

trades_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

TRADE_TYPES = {
    "electrician", "plumber", "carpenter", "bricklayer", "plasterer", "tiler", "painter",
    "concreter", "roofer", "renderer", "waterproofer", "excavator-earthworks", "building-surveyor", "other",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class TradeInput(BaseModel):
    business_name: str
    contact_person: str = ""
    trade_type: str = "other"
    phone: str = ""
    email: str = ""
    abn: str = ""
    licence_number: str = ""
    licence_expiry: Optional[str] = None
    insurer: str = ""
    insurance_policy_number: str = ""
    insurance_expiry: Optional[str] = None
    rate_notes: str = ""
    rating: Optional[int] = None
    notes: str = ""


class TradeUpdate(BaseModel):
    business_name: Optional[str] = None
    contact_person: Optional[str] = None
    trade_type: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    abn: Optional[str] = None
    licence_number: Optional[str] = None
    licence_expiry: Optional[str] = None
    insurer: Optional[str] = None
    insurance_policy_number: Optional[str] = None
    insurance_expiry: Optional[str] = None
    rate_notes: Optional[str] = None
    rating: Optional[int] = None
    notes: Optional[str] = None


class AssignInput(BaseModel):
    trade_id: str


def validate_trade_fields(trade_type: Optional[str], rating: Optional[int]):
    if trade_type is not None and trade_type not in TRADE_TYPES:
        raise HTTPException(status_code=400, detail=f"trade_type must be one of: {sorted(TRADE_TYPES)}")
    if rating is not None and not (1 <= rating <= 5):
        raise HTTPException(status_code=400, detail="rating must be between 1 and 5.")


def trade_warnings(trade: dict) -> list:
    """Licence/insurance expired or expiring within 30 days."""
    warnings = []
    today = date.today()
    soon = today + timedelta(days=30)
    for field, label in (("licence_expiry", "licence"), ("insurance_expiry", "insurance")):
        val = trade.get(field)
        if not val:
            continue
        try:
            d = date.fromisoformat(val)
        except ValueError:
            continue
        if d < today:
            warnings.append({"type": label, "level": "expired", "expiry": val})
        elif d <= soon:
            warnings.append({"type": label, "level": "expiring-soon", "expiry": val})
    return warnings


def with_warnings(trade: dict) -> dict:
    trade["warnings"] = trade_warnings(trade)
    return trade


# ---------- Global trades CRUD ----------

@trades_router.get("/trades")
async def list_trades():
    trades = await db.trades.find({}, {"_id": 0}).sort("business_name", 1).to_list(500)
    return [with_warnings(t) for t in trades]


@trades_router.post("/trades")
async def create_trade(data: TradeInput):
    if not data.business_name.strip():
        raise HTTPException(status_code=400, detail="Business name is required.")
    validate_trade_fields(data.trade_type, data.rating)
    trade = data.model_dump()
    trade["business_name"] = trade["business_name"].strip()
    trade["id"] = str(uuid.uuid4())
    trade["created_at"] = now_iso()
    trade["updated_at"] = now_iso()
    await db.trades.insert_one(dict(trade))
    return with_warnings(trade)


@trades_router.get("/trades/{trade_id}")
async def get_trade(trade_id: str):
    trade = await db.trades.find_one({"id": trade_id}, {"_id": 0})
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found.")
    return with_warnings(trade)


@trades_router.put("/trades/{trade_id}")
async def update_trade(trade_id: str, data: TradeUpdate):
    if not await db.trades.find_one({"id": trade_id}):
        raise HTTPException(status_code=404, detail="Trade not found.")
    updates = data.model_dump(exclude_unset=True)
    validate_trade_fields(updates.get("trade_type"), updates.get("rating"))
    if "business_name" in updates and updates["business_name"] is not None and not updates["business_name"].strip():
        raise HTTPException(status_code=400, detail="Business name cannot be empty.")
    updates["updated_at"] = now_iso()
    await db.trades.update_one({"id": trade_id}, {"$set": updates})
    trade = await db.trades.find_one({"id": trade_id}, {"_id": 0})
    return with_warnings(trade)


@trades_router.delete("/trades/{trade_id}")
async def delete_trade(trade_id: str):
    if not await db.trades.find_one({"id": trade_id}):
        raise HTTPException(status_code=404, detail="Trade not found.")
    quote_refs = await db.quotes.count_documents({"trade_id": trade_id})
    invoice_refs = await db.invoices.count_documents({"trade_id": trade_id})
    if quote_refs or invoice_refs:
        raise HTTPException(status_code=400,
                            detail=f"Cannot delete: trade is referenced by {quote_refs} quote(s) and {invoice_refs} invoice(s).")
    await db.trades.delete_one({"id": trade_id})
    await db.tasks.update_many({"trade_id": trade_id}, {"$set": {"trade_id": None}})
    await db.projects.update_many({}, {"$pull": {"trade_ids": trade_id}})
    return {"message": "Trade deleted."}


# ---------- Per-project assignment (many-to-many) ----------

@trades_router.get("/projects/{project_id}/trades")
async def list_project_trades(project_id: str):
    project = await db.projects.find_one({"id": project_id}, {"_id": 0, "trade_ids": 1})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    trade_ids = project.get("trade_ids", [])
    trades = await db.trades.find({"id": {"$in": trade_ids}}, {"_id": 0}).sort("business_name", 1).to_list(500)
    return [with_warnings(t) for t in trades]


@trades_router.post("/projects/{project_id}/trades")
async def assign_trade(project_id: str, data: AssignInput):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    if not await db.trades.find_one({"id": data.trade_id}):
        raise HTTPException(status_code=404, detail="Trade not found.")
    await db.projects.update_one({"id": project_id}, {"$addToSet": {"trade_ids": data.trade_id}})
    return {"message": "Trade assigned."}


@trades_router.delete("/projects/{project_id}/trades/{trade_id}")
async def unassign_trade(project_id: str, trade_id: str):
    result = await db.projects.update_one({"id": project_id}, {"$pull": {"trade_ids": trade_id}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found.")
    return {"message": "Trade unassigned."}
