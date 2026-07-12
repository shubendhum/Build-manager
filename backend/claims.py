import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from db import db
from auth import get_current_user

claims_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

# Standard Victorian progress payment schedule (Domestic Building Contracts Act 1995)
CLAIM_SCHEDULE = [
    ("Deposit", 5),
    ("Base", 10),
    ("Frame", 15),
    ("Lockup", 35),
    ("Fixing", 25),
    ("Completion", 10),
]
CLAIM_STATUSES = {"not-claimed", "claimed", "paid"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_str() -> str:
    return datetime.now(timezone.utc).date().isoformat()


class ClaimUpdate(BaseModel):
    percentage: Optional[float] = None
    amount: Optional[float] = None
    status: Optional[str] = None
    claimed_date: Optional[str] = None
    paid_date: Optional[str] = None


def build_schedule(project_id: str, contract_value: float) -> list:
    lines = []
    allocated = 0.0
    for idx, (stage_label, pct) in enumerate(CLAIM_SCHEDULE):
        if idx < len(CLAIM_SCHEDULE) - 1:
            amount = round(contract_value * pct / 100, 2)
            allocated = round(allocated + amount, 2)
        else:
            amount = round(contract_value - allocated, 2)  # last line absorbs rounding
        lines.append({
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "stage_label": stage_label,
            "percentage": pct,
            "amount": amount,
            "status": "not-claimed",
            "claimed_date": None,
            "paid_date": None,
            "sort_order": idx,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        })
    return lines


async def claims_response(project_id: str, project: dict) -> dict:
    lines = await db.claims.find({"project_id": project_id}, {"_id": 0}).sort("sort_order", 1).to_list(50)
    schedule_total = round(sum(l["amount"] for l in lines), 2)
    contract_value = project.get("contract_value", 0)
    variance = round(schedule_total - contract_value, 2)
    warning = None
    if lines and abs(variance) > 0.005:
        warning = (f"Schedule total ${schedule_total:,.2f} does not match the contract value "
                   f"${contract_value:,.2f} (variance ${variance:,.2f}).")
    return {
        "project_id": project_id,
        "lines": lines,
        "summary": {
            "contract_value": contract_value,
            "schedule_total": schedule_total,
            "variance": variance,
            "total_claimed": round(sum(l["amount"] for l in lines if l["status"] in ("claimed", "paid")), 2),
            "total_paid": round(sum(l["amount"] for l in lines if l["status"] == "paid"), 2),
            "warning": warning,
        },
    }


@claims_router.get("/projects/{project_id}/claims")
async def get_claims(project_id: str):
    project = await db.projects.find_one({"id": project_id}, {"_id": 0, "contract_value": 1})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    return await claims_response(project_id, project)


@claims_router.post("/projects/{project_id}/claims/generate")
async def generate_claims(project_id: str, force: bool = Query(False)):
    project = await db.projects.find_one({"id": project_id}, {"_id": 0, "contract_value": 1})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    existing = await db.claims.count_documents({"project_id": project_id})
    if existing and not force:
        raise HTTPException(status_code=409, detail="A progress claim schedule already exists. Use force=true to regenerate.")
    if existing:
        await db.claims.delete_many({"project_id": project_id})
    lines = build_schedule(project_id, project.get("contract_value", 0))
    await db.claims.insert_many([dict(l) for l in lines])
    return await claims_response(project_id, project)


@claims_router.put("/claims/{claim_id}")
async def update_claim(claim_id: str, data: ClaimUpdate):
    existing = await db.claims.find_one({"id": claim_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Claim line not found.")
    updates = data.model_dump(exclude_unset=True)
    if "status" in updates:
        if updates["status"] not in CLAIM_STATUSES:
            raise HTTPException(status_code=400, detail=f"status must be one of: {sorted(CLAIM_STATUSES)}")
        # Auto-stamp dates on status transitions if not explicitly provided
        if updates["status"] in ("claimed", "paid") and not existing.get("claimed_date") and "claimed_date" not in updates:
            updates["claimed_date"] = today_str()
        if updates["status"] == "paid" and not existing.get("paid_date") and "paid_date" not in updates:
            updates["paid_date"] = today_str()
        if updates["status"] == "not-claimed":
            updates.setdefault("claimed_date", None)
            updates.setdefault("paid_date", None)
    if "amount" in updates and updates["amount"] is not None and updates["amount"] < 0:
        raise HTTPException(status_code=400, detail="Amount cannot be negative.")
    updates["updated_at"] = now_iso()
    await db.claims.update_one({"id": claim_id}, {"$set": updates})
    project = await db.projects.find_one({"id": existing["project_id"]}, {"_id": 0, "contract_value": 1})
    return await claims_response(existing["project_id"], project)
