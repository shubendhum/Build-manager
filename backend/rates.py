import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from db import db
from auth import get_current_user
from trades import TRADE_TYPES

rates_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

# Victoria 2025 market reference rates (AUD ex-GST) — western Victoria.
# (work_item, trade_type, unit, labour_low, labour_high, supply_install_low, supply_install_high, notes)
REFERENCE_RATES = [
    ("Bricklaying", "bricklayer", "per 1,000 bricks", 690, 1100, 1300, 2000, "incl. bricks & mortar at S&I"),
    ("Plastering — walls", "plasterer", "per m²", None, None, 20, 35, "wet-area board $35–50"),
    ("Plastering — ceilings", "plasterer", "per m²", None, None, 25, 40, "higher for raked/high ceilings"),
    ("Tiling", "tiler", "per m²", 45, 95, 85, 180, "tile cost drives S&I range"),
    ("Painting — walls", "painter", "per m²", 15, 25, 25, 40, ""),
    ("Concreting — slab", "concreter", "per m²", None, None, 80, 150, "standard 100mm residential"),
    ("Concreting — pour", "concreter", "per m³", None, None, 400, 700, "incl. formwork"),
    ("Roofing — metal/tile", "roofer", "per m²", None, None, 60, 120, ""),
    ("Rendering", "renderer", "per m²", None, None, 35, 75, ""),
    ("Timber framing — materials", "carpenter", "per m²", None, None, 35, 85, "materials only"),
    ("Timber frame — complete", "carpenter", "per m²", None, None, 1400, 1550, "full frame ~$1,480/m²"),
    ("Electrical", "electrician", "per point", None, None, 60, 120, "switchboard $500–1,000 extra"),
    ("Plumbing — fixture install", "plumber", "per fixture", 250, 600, None, None, "install only"),
    ("Plumbing — fixture area", "plumber", "per fixture area", None, None, 600, 2000, "new build per bathroom/kitchen/laundry"),
    ("Waterproofing — wet areas", "waterproofer", "per m²", None, None, 50, 90, ""),
    ("Waterproofing — roof", "waterproofer", "per m²", None, None, 90, 110, ""),
    ("Site prep / excavation", "excavator-earthworks", "per project", None, None, 10000, 50000, "site dependent"),
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def reference_docs() -> list:
    docs = []
    for idx, (item, trade_type, unit, ll, lh, sl, sh, notes) in enumerate(REFERENCE_RATES):
        docs.append({
            "id": str(uuid.uuid4()), "work_item": item, "trade_type": trade_type, "unit": unit,
            "labour_low": ll, "labour_high": lh, "supply_install_low": sl, "supply_install_high": sh,
            "notes": notes, "is_reference": True, "sort_order": idx,
            "created_at": now_iso(), "updated_at": now_iso(),
        })
    return docs


async def ensure_reference_rates():
    if await db.rates.count_documents({}) == 0:
        await db.rates.insert_many([dict(d) for d in reference_docs()])


class RateInput(BaseModel):
    work_item: str
    trade_type: str = "other"
    unit: str = ""
    labour_low: Optional[float] = None
    labour_high: Optional[float] = None
    supply_install_low: Optional[float] = None
    supply_install_high: Optional[float] = None
    notes: str = ""


class RateUpdate(BaseModel):
    work_item: Optional[str] = None
    trade_type: Optional[str] = None
    unit: Optional[str] = None
    labour_low: Optional[float] = None
    labour_high: Optional[float] = None
    supply_install_low: Optional[float] = None
    supply_install_high: Optional[float] = None
    notes: Optional[str] = None


@rates_router.get("/rates")
async def list_rates():
    return await db.rates.find({}, {"_id": 0}).sort("sort_order", 1).to_list(500)


@rates_router.post("/rates")
async def create_rate(data: RateInput):
    if not data.work_item.strip():
        raise HTTPException(status_code=400, detail="Work item name is required.")
    if data.trade_type not in TRADE_TYPES:
        raise HTTPException(status_code=400, detail=f"trade_type must be one of: {sorted(TRADE_TYPES)}")
    last = await db.rates.find({}).sort("sort_order", -1).to_list(1)
    rate = data.model_dump()
    rate["work_item"] = rate["work_item"].strip()
    rate["id"] = str(uuid.uuid4())
    rate["is_reference"] = False
    rate["sort_order"] = (last[0]["sort_order"] + 1) if last else 0
    rate["created_at"] = now_iso()
    rate["updated_at"] = now_iso()
    await db.rates.insert_one(dict(rate))
    rate.pop("_id", None)
    return rate


@rates_router.put("/rates/{rate_id}")
async def update_rate(rate_id: str, data: RateUpdate):
    if not await db.rates.find_one({"id": rate_id}):
        raise HTTPException(status_code=404, detail="Rate item not found.")
    updates = data.model_dump(exclude_unset=True)
    if "trade_type" in updates and updates["trade_type"] not in TRADE_TYPES:
        raise HTTPException(status_code=400, detail=f"trade_type must be one of: {sorted(TRADE_TYPES)}")
    updates["updated_at"] = now_iso()
    await db.rates.update_one({"id": rate_id}, {"$set": updates})
    return await db.rates.find_one({"id": rate_id}, {"_id": 0})


@rates_router.delete("/rates/{rate_id}")
async def delete_rate(rate_id: str):
    result = await db.rates.delete_one({"id": rate_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rate item not found.")
    return {"message": "Rate item deleted."}


@rates_router.post("/rates/reset")
async def reset_rates():
    await db.rates.delete_many({})
    await db.rates.insert_many([dict(d) for d in reference_docs()])
    return await db.rates.find({}, {"_id": 0}).sort("sort_order", 1).to_list(500)
