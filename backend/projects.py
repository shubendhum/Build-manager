import uuid
from datetime import datetime, timezone
from typing import List, Optional, Dict
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from db import db
from auth import get_current_user
from roadmap_template import STAGES, STAGE_KEYS, ROADMAP_TEMPLATE

projects_router = APIRouter(prefix="/api/projects", dependencies=[Depends(get_current_user)])
tasks_router = APIRouter(prefix="/api/tasks", dependencies=[Depends(get_current_user)])

PROJECT_TYPES = {"new-build", "extension", "renovation"}
PROJECT_STATUSES = {"planning", "active", "on-hold", "completed"}
TASK_STATUSES = {"not-started", "in-progress", "blocked", "done", "n-a"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- Schemas ----------

class ProjectInput(BaseModel):
    name: str
    client_name: str
    client_contact: str = ""
    site_street: str = ""
    site_suburb: str
    site_postcode: str
    builder_name: str = ""
    builder_registration: str = ""
    dbi_policy_number: str = ""
    dbi_expiry: Optional[str] = None
    contract_value: float = 0
    start_date: Optional[str] = None
    target_completion: Optional[str] = None
    project_type: str = "new-build"
    status: str = "planning"
    notes: str = ""


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    client_name: Optional[str] = None
    client_contact: Optional[str] = None
    site_street: Optional[str] = None
    site_suburb: Optional[str] = None
    site_postcode: Optional[str] = None
    builder_name: Optional[str] = None
    builder_registration: Optional[str] = None
    dbi_policy_number: Optional[str] = None
    dbi_expiry: Optional[str] = None
    contract_value: Optional[float] = None
    start_date: Optional[str] = None
    target_completion: Optional[str] = None
    project_type: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class TaskInput(BaseModel):
    title: str
    description: str = ""
    stage_key: str
    status: str = "not-started"
    due_date: Optional[str] = None
    assigned_trade: str = ""
    trade_id: Optional[str] = None
    is_mandatory_inspection: bool = False


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    stage_key: Optional[str] = None
    status: Optional[str] = None
    due_date: Optional[str] = None
    assigned_trade: Optional[str] = None
    trade_id: Optional[str] = None
    is_mandatory_inspection: Optional[bool] = None
    sort_order: Optional[int] = None


# ---------- Validation ----------

def validate_project_fields(project_type: Optional[str], status: Optional[str], postcode: Optional[str]):
    if project_type is not None and project_type not in PROJECT_TYPES:
        raise HTTPException(status_code=400, detail=f"project_type must be one of: {sorted(PROJECT_TYPES)}")
    if status is not None and status not in PROJECT_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of: {sorted(PROJECT_STATUSES)}")
    if postcode is not None and not (postcode.isdigit() and len(postcode) == 4 and postcode[0] in "38"):
        raise HTTPException(status_code=400, detail="site_postcode must be a valid VIC postcode (3xxx or 8xxx).")


# ---------- Progress ----------

async def stage_counts_for_projects(project_ids: List[str]) -> Dict[str, dict]:
    counts: Dict[str, dict] = {}
    cursor = db.tasks.find({"project_id": {"$in": project_ids}},
                           {"_id": 0, "project_id": 1, "stage_key": 1, "status": 1})
    async for t in cursor:
        stage = counts.setdefault(t["project_id"], {}).setdefault(t["stage_key"], {"done": 0, "relevant": 0, "total": 0})
        stage["total"] += 1
        if t["status"] != "n-a":
            stage["relevant"] += 1
            if t["status"] == "done":
                stage["done"] += 1
    return counts


def compute_progress(stage_counts: dict):
    """Overall % weighted by the Victorian progress payment schedule; stages with
    no relevant (non-n/a) tasks are excluded and weights renormalised."""
    per_stage = {}
    weight_sum = 0
    acc = 0.0
    for stage in STAGES:
        c = stage_counts.get(stage["key"])
        if not c or c["relevant"] == 0:
            per_stage[stage["key"]] = None
            continue
        pct = round(c["done"] / c["relevant"] * 100)
        per_stage[stage["key"]] = pct
        weight_sum += stage["weight"]
        acc += stage["weight"] * pct
    overall = round(acc / weight_sum) if weight_sum else 0
    return overall, per_stage


# ---------- Roadmap generation ----------

async def generate_roadmap_tasks(project_id: str) -> List[dict]:
    tasks = []
    for stage in STAGES:
        for idx, (title, description, is_inspection) in enumerate(ROADMAP_TEMPLATE[stage["key"]]):
            tasks.append({
                "id": str(uuid.uuid4()),
                "project_id": project_id,
                "stage_key": stage["key"],
                "title": title,
                "description": description,
                "status": "not-started",
                "due_date": None,
                "assigned_trade": "",
                "trade_id": None,
                "is_mandatory_inspection": is_inspection,
                "sort_order": idx * 10,
                "is_custom": False,
                "created_at": now_iso(),
                "updated_at": now_iso(),
            })
    await db.tasks.insert_many([dict(t) for t in tasks])
    return tasks


# ---------- Project routes ----------

@projects_router.get("")
async def list_projects():
    projects = await db.projects.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    counts = await stage_counts_for_projects([p["id"] for p in projects])
    for p in projects:
        overall, _ = compute_progress(counts.get(p["id"], {}))
        p["progress"] = overall
    return projects


@projects_router.post("")
async def create_project(data: ProjectInput):
    validate_project_fields(data.project_type, data.status, data.site_postcode)
    if not data.name.strip():
        raise HTTPException(status_code=400, detail="Project name is required.")
    project = data.model_dump()
    project["name"] = project["name"].strip()
    project["id"] = str(uuid.uuid4())
    project["created_at"] = now_iso()
    project["updated_at"] = now_iso()
    await db.projects.insert_one(dict(project))
    await generate_roadmap_tasks(project["id"])
    project["progress"] = 0
    return project


@projects_router.get("/{project_id}")
async def get_project(project_id: str):
    project = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    counts = await stage_counts_for_projects([project_id])
    overall, per_stage = compute_progress(counts.get(project_id, {}))
    project["progress"] = overall
    project["stage_progress"] = per_stage
    return project


@projects_router.put("/{project_id}")
async def update_project(project_id: str, data: ProjectUpdate):
    existing = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Project not found.")
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    validate_project_fields(updates.get("project_type"), updates.get("status"), updates.get("site_postcode"))
    updates["updated_at"] = now_iso()
    await db.projects.update_one({"id": project_id}, {"$set": updates})
    return await get_project(project_id)


@projects_router.delete("/{project_id}")
async def delete_project(project_id: str):
    result = await db.projects.delete_one({"id": project_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Project not found.")
    plans = await db.plan_analyses.find({"project_id": project_id}, {"_id": 0, "id": 1}).to_list(500)
    plan_ids = [p["id"] for p in plans]
    # Every project-scoped collection, or deleting a project silently leaves
    # orphans behind (previously only tasks were cascaded).
    for collection in (db.tasks, db.work_packages, db.quotes, db.rfqs, db.notifications,
                       db.invoices, db.claims, db.estimate_lines, db.variations,
                       db.diary_entries, db.documents, db.plan_analyses):
        await collection.delete_many({"project_id": project_id})
    await db.plan_drafts.delete_many({"plan_id": {"$in": plan_ids}})
    await db.photo_analyses.update_many({"project_id": project_id}, {"$set": {"project_id": None}})
    return {"message": "Project deleted."}


@projects_router.get("/{project_id}/roadmap")
async def get_roadmap(project_id: str):
    project = await db.projects.find_one({"id": project_id}, {"_id": 0, "id": 1, "name": 1})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    tasks = await db.tasks.find({"project_id": project_id}, {"_id": 0}).to_list(1000)
    # Resolve linked trade business names
    trade_ids = list({t["trade_id"] for t in tasks if t.get("trade_id")})
    trade_docs = await db.trades.find({"id": {"$in": trade_ids}}, {"_id": 0, "id": 1, "business_name": 1}).to_list(500)
    trade_names = {t["id"]: t["business_name"] for t in trade_docs}
    for t in tasks:
        t["trade_name"] = trade_names.get(t.get("trade_id"))
    counts = await stage_counts_for_projects([project_id])
    overall, per_stage = compute_progress(counts.get(project_id, {}))
    stages = []
    for stage in STAGES:
        stage_tasks = sorted([t for t in tasks if t["stage_key"] == stage["key"]], key=lambda t: t["sort_order"])
        c = counts.get(project_id, {}).get(stage["key"], {"done": 0, "relevant": 0, "total": 0})
        stages.append({
            **stage,
            "progress": per_stage.get(stage["key"]),
            "done_count": c["done"],
            "relevant_count": c["relevant"],
            "total_count": c["total"],
            "tasks": stage_tasks,
        })
    return {"project_id": project_id, "project_name": project["name"], "overall_progress": overall, "stages": stages}


# ---------- Task routes ----------

@projects_router.post("/{project_id}/tasks")
async def create_task(project_id: str, data: TaskInput):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    if data.stage_key not in STAGE_KEYS:
        raise HTTPException(status_code=400, detail=f"stage_key must be one of: {sorted(STAGE_KEYS)}")
    if data.status not in TASK_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of: {sorted(TASK_STATUSES)}")
    if not data.title.strip():
        raise HTTPException(status_code=400, detail="Task title is required.")
    if data.trade_id and not await db.trades.find_one({"id": data.trade_id}):
        raise HTTPException(status_code=404, detail="Trade not found.")
    last = await db.tasks.find({"project_id": project_id, "stage_key": data.stage_key}).sort("sort_order", -1).to_list(1)
    task = data.model_dump()
    task["title"] = task["title"].strip()
    task["id"] = str(uuid.uuid4())
    task["project_id"] = project_id
    task["sort_order"] = (last[0]["sort_order"] + 10) if last else 0
    task["is_custom"] = True
    task["created_at"] = now_iso()
    task["updated_at"] = now_iso()
    await db.tasks.insert_one(dict(task))
    task.pop("_id", None)
    return task


@tasks_router.put("/{task_id}")
async def update_task(task_id: str, data: TaskUpdate):
    existing = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Task not found.")
    updates = data.model_dump(exclude_unset=True)
    if "status" in updates and updates["status"] not in TASK_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of: {sorted(TASK_STATUSES)}")
    if "stage_key" in updates and updates["stage_key"] not in STAGE_KEYS:
        raise HTTPException(status_code=400, detail=f"stage_key must be one of: {sorted(STAGE_KEYS)}")
    if "title" in updates and updates["title"] is not None and not updates["title"].strip():
        raise HTTPException(status_code=400, detail="Task title cannot be empty.")
    if updates.get("trade_id") and not await db.trades.find_one({"id": updates["trade_id"]}):
        raise HTTPException(status_code=404, detail="Trade not found.")
    if updates.get("due_date") == "":
        updates["due_date"] = None
    updates["updated_at"] = now_iso()
    await db.tasks.update_one({"id": task_id}, {"$set": updates})
    return await db.tasks.find_one({"id": task_id}, {"_id": 0})


@tasks_router.delete("/{task_id}")
async def delete_task(task_id: str):
    result = await db.tasks.delete_one({"id": task_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found.")
    return {"message": "Task deleted."}
