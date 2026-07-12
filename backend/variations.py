import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from db import db
from auth import get_current_user

variations_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

VARIATION_STATUSES = {"proposed", "approved", "rejected", "billed"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class VariationInput(BaseModel):
    title: str
    description: str = ""
    cost_delta: float = 0
    status: str = "proposed"
    date: Optional[str] = None


class VariationUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    cost_delta: Optional[float] = None
    status: Optional[str] = None
    date: Optional[str] = None


def validate_status(status: Optional[str]):
    if status is not None and status not in VARIATION_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of: {sorted(VARIATION_STATUSES)}")


async def next_number(project_id: str) -> str:
    """Auto-number VO-001, VO-002… per project (based on the highest existing number)."""
    docs = await db.variations.find({"project_id": project_id}, {"_id": 0, "number": 1}).to_list(1000)
    highest = 0
    for d in docs:
        try:
            highest = max(highest, int(str(d.get("number", "")).split("-")[-1]))
        except ValueError:
            continue
    return f"VO-{highest + 1:03d}"


async def approved_variations_total(project_id: str) -> float:
    """Approved + billed variations adjust the contract value."""
    docs = await db.variations.find(
        {"project_id": project_id, "status": {"$in": ["approved", "billed"]}},
        {"_id": 0, "cost_delta": 1},
    ).to_list(1000)
    return round(sum(d.get("cost_delta", 0) for d in docs), 2)


@variations_router.get("/projects/{project_id}/variations")
async def list_variations(project_id: str):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    return await db.variations.find({"project_id": project_id}, {"_id": 0}).sort("number", 1).to_list(1000)


@variations_router.post("/projects/{project_id}/variations")
async def create_variation(project_id: str, data: VariationInput):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    if not data.title.strip():
        raise HTTPException(status_code=400, detail="Variation title is required.")
    validate_status(data.status)
    variation = data.model_dump()
    variation["title"] = variation["title"].strip()
    variation["id"] = str(uuid.uuid4())
    variation["project_id"] = project_id
    variation["number"] = await next_number(project_id)
    variation["date"] = variation["date"] or datetime.now(timezone.utc).date().isoformat()
    variation["created_at"] = now_iso()
    variation["updated_at"] = now_iso()
    await db.variations.insert_one(dict(variation))
    variation.pop("_id", None)
    return variation


@variations_router.put("/variations/{variation_id}")
async def update_variation(variation_id: str, data: VariationUpdate):
    if not await db.variations.find_one({"id": variation_id}):
        raise HTTPException(status_code=404, detail="Variation not found.")
    updates = data.model_dump(exclude_unset=True)
    validate_status(updates.get("status"))
    if "title" in updates and updates["title"] is not None and not updates["title"].strip():
        raise HTTPException(status_code=400, detail="Variation title cannot be empty.")
    updates["updated_at"] = now_iso()
    await db.variations.update_one({"id": variation_id}, {"$set": updates})
    return await db.variations.find_one({"id": variation_id}, {"_id": 0})


@variations_router.delete("/variations/{variation_id}")
async def delete_variation(variation_id: str):
    result = await db.variations.delete_one({"id": variation_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Variation not found.")
    return {"message": "Variation deleted."}
