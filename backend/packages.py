"""Work packages — the procurable unit of a build.

A package is one scope of work you can send out for quotes and later award
(e.g. "Plumbing — rough-in & fit-off"). Quotes, RFQs and estimate lines all
hang off it via `package_id`, which replaces the free-text `work_package`
string that previously held a comparison together.

Collection: work_packages
"""
import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from db import db
from auth import get_current_user
from roadmap_template import STAGES, STAGE_KEYS
from trades import TRADE_TYPES
from estimates import line_total

packages_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

PACKAGE_STATUSES = ["draft", "out-for-quote", "quotes-in", "awarded", "ordered", "in-progress", "complete"]
# A package counts as "committed" once a quote has been awarded against it.
COMMITTED_STATUSES = {"awarded", "ordered", "in-progress", "complete"}
# Quotes that still count as a live price (i.e. not rejected or lapsed).
LIVE_QUOTE_STATUSES = {"pending", "submitted", "accepted"}

STAGE_ORDER = {s["key"]: s["number"] for s in STAGES}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def inc_gst(line: dict) -> float:
    """Estimate lines are stored ex-GST; quotes are compared inc-GST."""
    total = line_total(line)
    return round(total * 1.1, 2) if line.get("gst_applicable", True) else total


class PackageInput(BaseModel):
    title: str
    trade_type: str = "other"
    stage_key: str = "lockup"
    scope: str = ""
    status: str = "draft"
    source: str = "manual"
    plan_id: Optional[str] = None
    scheduled_start: Optional[str] = None
    scheduled_end: Optional[str] = None


class PackageUpdate(BaseModel):
    title: Optional[str] = None
    trade_type: Optional[str] = None
    stage_key: Optional[str] = None
    scope: Optional[str] = None
    status: Optional[str] = None
    sort_order: Optional[int] = None
    scheduled_start: Optional[str] = None
    scheduled_end: Optional[str] = None


def validate_package_fields(trade_type: Optional[str], stage_key: Optional[str], status: Optional[str]):
    if trade_type is not None and trade_type not in TRADE_TYPES:
        raise HTTPException(status_code=400, detail=f"trade_type must be one of: {sorted(TRADE_TYPES)}")
    if stage_key is not None and stage_key not in STAGE_KEYS:
        raise HTTPException(status_code=400, detail=f"stage_key must be one of: {sorted(STAGE_KEYS)}")
    if status is not None and status not in PACKAGE_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of: {sorted(PACKAGE_STATUSES)}")


async def hydrate_packages(packages: list, project_id: str) -> list:
    """Attach rolled-up quote/RFQ/estimate figures.

    Fetches each related collection exactly once and groups in memory — never
    one query per package.
    """
    quotes = await db.quotes.find({"project_id": project_id}, {"_id": 0, "attachment": 0}).to_list(1000)
    rfqs = await db.rfqs.find({"project_id": project_id}, {"_id": 0}).to_list(500)
    est_lines = await db.estimate_lines.find({"project_id": project_id}, {"_id": 0}).to_list(1000)

    quotes_by_pkg: dict = {}
    for q in quotes:
        quotes_by_pkg.setdefault(q.get("package_id"), []).append(q)
    rfqs_by_pkg: dict = {}
    for r in rfqs:
        rfqs_by_pkg.setdefault(r.get("package_id"), []).append(r)
    est_by_pkg: dict = {}
    for line in est_lines:
        est_by_pkg.setdefault(line.get("package_id"), []).append(line)

    for pkg in packages:
        pkg_quotes = quotes_by_pkg.get(pkg["id"], [])
        pkg_rfqs = rfqs_by_pkg.get(pkg["id"], [])
        live = [q for q in pkg_quotes if q["status"] in LIVE_QUOTE_STATUSES]
        accepted = next((q for q in pkg_quotes if q["status"] == "accepted"), None)

        pkg["estimate_total"] = round(sum(inc_gst(line) for line in est_by_pkg.get(pkg["id"], [])), 2)
        pkg["quote_count"] = len(pkg_quotes)
        pkg["live_quote_count"] = len(live)
        pkg["lowest_quote"] = round(min((q["total_inc_gst"] for q in live), default=0), 2) or None
        pkg["awarded_amount"] = accepted["total_inc_gst"] if accepted else None
        pkg["awarded_trade_id"] = accepted["trade_id"] if accepted else None
        pkg["rfq_count"] = len(pkg_rfqs)
        pkg["invited_count"] = sum(len(r.get("invitations", [])) for r in pkg_rfqs)
        pkg["responded_count"] = sum(
            1 for r in pkg_rfqs for i in r.get("invitations", []) if i.get("status") == "submitted"
        )
        benchmark = pkg["awarded_amount"] or pkg["lowest_quote"]
        pkg["variance_vs_estimate"] = (
            round(benchmark - pkg["estimate_total"], 2) if benchmark and pkg["estimate_total"] else None
        )
    return packages


def sort_packages(packages: list) -> list:
    return sorted(packages, key=lambda p: (STAGE_ORDER.get(p.get("stage_key"), 99), p.get("sort_order", 0)))


@packages_router.get("/projects/{project_id}/packages")
async def list_packages(project_id: str):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    packages = await db.work_packages.find({"project_id": project_id}, {"_id": 0}).to_list(500)
    return sort_packages(await hydrate_packages(packages, project_id))


@packages_router.post("/projects/{project_id}/packages")
async def create_package(project_id: str, data: PackageInput, user: dict = Depends(get_current_user)):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    if not data.title.strip():
        raise HTTPException(status_code=400, detail="Package title is required.")
    validate_package_fields(data.trade_type, data.stage_key, data.status)

    last = await db.work_packages.find({"project_id": project_id}).sort("sort_order", -1).to_list(1)
    package = data.model_dump()
    package["title"] = package["title"].strip()
    package["scope"] = package["scope"].strip()
    package["id"] = str(uuid.uuid4())
    package["project_id"] = project_id
    package["awarded_quote_id"] = None
    package["sort_order"] = (last[0]["sort_order"] + 10) if last else 0
    package["created_by"] = user.get("id")
    package["created_at"] = now_iso()
    package["updated_at"] = now_iso()
    await db.work_packages.insert_one(dict(package))
    package.pop("_id", None)
    return (await hydrate_packages([package], project_id))[0]


@packages_router.put("/packages/{package_id}")
async def update_package(package_id: str, data: PackageUpdate):
    package = await db.work_packages.find_one({"id": package_id}, {"_id": 0})
    if not package:
        raise HTTPException(status_code=404, detail="Work package not found.")
    updates = data.model_dump(exclude_unset=True)
    validate_package_fields(updates.get("trade_type"), updates.get("stage_key"), updates.get("status"))
    if "title" in updates:
        if not updates["title"].strip():
            raise HTTPException(status_code=400, detail="Package title is required.")
        updates["title"] = updates["title"].strip()
    updates["updated_at"] = now_iso()
    await db.work_packages.update_one({"id": package_id}, {"$set": updates})
    package = await db.work_packages.find_one({"id": package_id}, {"_id": 0})
    return (await hydrate_packages([package], package["project_id"]))[0]


@packages_router.delete("/packages/{package_id}")
async def delete_package(package_id: str):
    if not await db.work_packages.find_one({"id": package_id}):
        raise HTTPException(status_code=404, detail="Work package not found.")
    quote_refs = await db.quotes.count_documents({"package_id": package_id})
    rfq_refs = await db.rfqs.count_documents({"package_id": package_id})
    if quote_refs or rfq_refs:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete: package is referenced by {quote_refs} quote(s) and {rfq_refs} quote request(s).",
        )
    await db.work_packages.delete_one({"id": package_id})
    await db.estimate_lines.update_many({"package_id": package_id}, {"$set": {"package_id": None}})
    return {"message": "Work package deleted."}


@packages_router.get("/projects/{project_id}/packages/coverage")
async def package_coverage(project_id: str):
    """How much of this build is priced, and how much is actually committed."""
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    packages = await db.work_packages.find({"project_id": project_id}, {"_id": 0}).to_list(500)
    packages = sort_packages(await hydrate_packages(packages, project_id))

    total = len(packages)
    priced = [p for p in packages if p["live_quote_count"] > 0]
    committed = [p for p in packages if p["status"] in COMMITTED_STATUSES]
    pct = lambda n: round(n / total * 100, 1) if total else 0.0  # noqa: E731

    return {
        "project_id": project_id,
        "package_count": total,
        "priced_count": len(priced),
        "priced_pct": pct(len(priced)),
        "committed_count": len(committed),
        "committed_pct": pct(len(committed)),
        "estimate_total": round(sum(p["estimate_total"] for p in packages), 2),
        "quoted_total": round(sum(p["lowest_quote"] or 0 for p in priced), 2),
        "committed_total": round(sum(p["awarded_amount"] or 0 for p in packages), 2),
        "unquoted": [
            {"id": p["id"], "title": p["title"], "trade_type": p["trade_type"], "stage_key": p["stage_key"]}
            for p in packages
            if p["live_quote_count"] == 0
        ],
    }
