import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from db import db
from auth import get_current_user
from roadmap_template import STAGES, STAGE_KEYS

estimates_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

STAGE_ORDER = {s["key"]: s["number"] for s in STAGES}
DEFAULT_CONTINGENCY = 12.5


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class EstimateLineInput(BaseModel):
    description: str
    stage_key: str
    rate_item_id: Optional[str] = None
    quantity: float = 1
    unit: str = ""
    rate: float = 0
    gst_applicable: bool = True


class EstimateLineUpdate(BaseModel):
    description: Optional[str] = None
    stage_key: Optional[str] = None
    rate_item_id: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    rate: Optional[float] = None
    gst_applicable: Optional[bool] = None


class EstimateSettingsInput(BaseModel):
    contingency_pct: float


def line_total(line: dict) -> float:
    return round(line["quantity"] * line["rate"], 2)


def estimate_summary(lines: list, contingency_pct: float, contract_value: float) -> dict:
    subtotal = round(sum(line_total(l) for l in lines), 2)
    gst = round(sum(line_total(l) for l in lines if l.get("gst_applicable", True)) * 0.10, 2)
    contingency = round(subtotal * contingency_pct / 100, 2)
    grand_total = round(subtotal + gst + contingency, 2)
    margin = round(contract_value - grand_total, 2)
    margin_pct = round(margin / contract_value * 100, 1) if contract_value else None
    return {
        "subtotal_ex_gst": subtotal,
        "gst": gst,
        "contingency_pct": contingency_pct,
        "contingency_amount": contingency,
        "grand_total": grand_total,
        "contract_value": contract_value,
        "margin": margin,
        "margin_pct": margin_pct,
    }


async def fetch_lines(project_id: str) -> list:
    lines = await db.estimate_lines.find({"project_id": project_id}, {"_id": 0}).to_list(1000)
    lines.sort(key=lambda l: (STAGE_ORDER.get(l["stage_key"], 99), l.get("sort_order", 0)))
    for l in lines:
        l["line_total"] = line_total(l)
    return lines


@estimates_router.get("/projects/{project_id}/estimate")
async def get_estimate(project_id: str):
    project = await db.projects.find_one({"id": project_id}, {"_id": 0, "contract_value": 1, "contingency_pct": 1})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    lines = await fetch_lines(project_id)
    pct = project.get("contingency_pct", DEFAULT_CONTINGENCY)
    return {"project_id": project_id, "lines": lines,
            "summary": estimate_summary(lines, pct, project.get("contract_value", 0))}


@estimates_router.post("/projects/{project_id}/estimate/lines")
async def create_line(project_id: str, data: EstimateLineInput):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    if data.stage_key not in STAGE_KEYS:
        raise HTTPException(status_code=400, detail=f"stage_key must be one of: {sorted(STAGE_KEYS)}")
    if not data.description.strip():
        raise HTTPException(status_code=400, detail="Description is required.")
    if data.quantity < 0 or data.rate < 0:
        raise HTTPException(status_code=400, detail="Quantity and rate cannot be negative.")
    last = await db.estimate_lines.find({"project_id": project_id}).sort("sort_order", -1).to_list(1)
    line = data.model_dump()
    line["description"] = line["description"].strip()
    line["id"] = str(uuid.uuid4())
    line["project_id"] = project_id
    line["sort_order"] = (last[0]["sort_order"] + 10) if last else 0
    line["created_at"] = now_iso()
    line["updated_at"] = now_iso()
    await db.estimate_lines.insert_one(dict(line))
    line.pop("_id", None)
    line["line_total"] = line_total(line)
    return line


@estimates_router.put("/estimate-lines/{line_id}")
async def update_line(line_id: str, data: EstimateLineUpdate):
    if not await db.estimate_lines.find_one({"id": line_id}):
        raise HTTPException(status_code=404, detail="Estimate line not found.")
    updates = data.model_dump(exclude_unset=True)
    if "stage_key" in updates and updates["stage_key"] not in STAGE_KEYS:
        raise HTTPException(status_code=400, detail=f"stage_key must be one of: {sorted(STAGE_KEYS)}")
    if updates.get("quantity") is not None and updates["quantity"] < 0:
        raise HTTPException(status_code=400, detail="Quantity cannot be negative.")
    if updates.get("rate") is not None and updates["rate"] < 0:
        raise HTTPException(status_code=400, detail="Rate cannot be negative.")
    updates["updated_at"] = now_iso()
    await db.estimate_lines.update_one({"id": line_id}, {"$set": updates})
    line = await db.estimate_lines.find_one({"id": line_id}, {"_id": 0})
    line["line_total"] = line_total(line)
    return line


@estimates_router.delete("/estimate-lines/{line_id}")
async def delete_line(line_id: str):
    result = await db.estimate_lines.delete_one({"id": line_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Estimate line not found.")
    return {"message": "Estimate line deleted."}


@estimates_router.put("/projects/{project_id}/estimate/settings")
async def update_settings(project_id: str, data: EstimateSettingsInput):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    if not (0 <= data.contingency_pct <= 50):
        raise HTTPException(status_code=400, detail="Contingency must be between 0 and 50 percent.")
    await db.projects.update_one({"id": project_id}, {"$set": {"contingency_pct": data.contingency_pct, "updated_at": now_iso()}})
    return await get_estimate(project_id)
