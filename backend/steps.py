"""The supervisor's checklist through the build.

The trade board answers "who is doing what". This answers "what do I have to
do" — the permits, the consents, the checks before something is covered up, the
mandatory hold points and the certificates collected on the way out.

Status is stored only where it differs from the default, so a job carries a
handful of records rather than 193 empty ones, and adding an item to the
checklist needs no migration.

Reminders are computed, never stored. Something with a statutory lead time
(road-reserve consent at 20 business days, asset protection within five days of
starting) surfaces before it is needed rather than when it is already late.

Collections: step_actions
"""
from datetime import datetime, timezone, date, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db import db
from auth import get_current_user
import build_sequence
import supervisor

steps_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

STATUSES = {"todo", "in-progress", "done", "n-a"}
SETTLED = {"done", "n-a"}
# A package in one of these is committed, so its step is no longer waiting on it.
PACKAGE_SETTLED = {"awarded", "ordered", "in-progress", "complete"}
# A date this close needs doing now.
DUE_SOON_DAYS = 7

# Reminders are ranked, most urgent first, and the UI colours them by this.
SEVERITY_RANK = {"hold": 0, "overdue": 1, "lead-time": 2, "due-soon": 3, "chase": 4}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_date(value) -> Optional[date]:
    try:
        return date.fromisoformat(str(value)[:10])
    except (ValueError, TypeError):
        return None


class ActionUpdate(BaseModel):
    status: Optional[str] = None
    note: Optional[str] = None
    due_date: Optional[str] = None
    reference: Optional[str] = None      # permit number, certificate number
    document_id: Optional[str] = None    # the filed evidence


def _reminders(phases: list, current_key: Optional[str]) -> list:
    """What the supervisor should be acting on today.

    Everything up to and including the current phase is fair game; a lead-time
    item is pulled forward one phase further because that is the whole point of
    it having a lead time.
    """
    order = {p["key"]: i for i, p in enumerate(phases)}
    current_i = order.get(current_key, len(phases) - 1)
    today = date.today()
    out = []

    def add(severity, phase, item, why):
        out.append({"severity": severity, "why": why, "phase_key": phase["key"],
                    "phase_letter": phase["letter"], "phase_name": phase["name"],
                    "n": item["n"], "action_key": item["action_key"],
                    "name": item["name"], "kind": item["kind"]})

    for phase in phases:
        pi = order[phase["key"]]
        for item in phase["items"]:
            if item["status"] in SETTLED:
                continue
            due = _as_date(item.get("due_date"))
            if due and due < today:
                late = (today - due).days
                add("overdue", phase, item, f"{late} day{'' if late == 1 else 's'} overdue")
                continue
            if due and (due - today).days <= DUE_SOON_DAYS:
                days = (due - today).days
                add("due-soon", phase, item,
                    "due today" if days == 0 else f"due tomorrow" if days == 1 else f"due in {days} days")
                continue
            # A hold point in play stops the job — nothing outranks it.
            if item["kind"] == "hold" and pi <= current_i:
                add("hold", phase, item, "work must not proceed past this")
                continue
            # Lead times reach one phase ahead so there is time to act on them.
            if item.get("remind_days") and pi <= current_i + 1:
                add("lead-time", phase, item,
                    f"needs about {item['remind_days']} days' notice — start it now")
                continue
            if item["external"] and pi <= current_i:
                add("chase", phase, item, "comes from someone else — chase it")

    out.sort(key=lambda r: (SEVERITY_RANK.get(r["severity"], 9), r["n"]))
    return out


@steps_router.get("/projects/{project_id}/steps")
async def list_steps(project_id: str):
    """The whole checklist, phase by phase, with what to act on today."""
    if not await db.projects.find_one({"id": project_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Project not found.")

    saved = {a["action_key"]: a for a in
             await db.step_actions.find({"project_id": project_id}, {"_id": 0}).to_list(1000)}
    packages = await db.work_packages.find(
        {"project_id": project_id},
        {"_id": 0, "id": 1, "title": 1, "trade_type": 1, "status": 1}).to_list(500)

    by_step: dict = {}
    for p in packages:
        by_step.setdefault(build_sequence.step_for(p["title"], p.get("trade_type")), []).append(p)

    phases, done_items = [], 0
    for phase in supervisor.PHASES:
        items = []
        for spec in phase["items"]:
            key = f"{phase['key']}:{spec['key']}"
            rec = saved.get(key, {})
            status = rec.get("status", "todo")
            if status in SETTLED:
                done_items += 1
            items.append({
                **spec, "action_key": key, "status": status,
                "note": rec.get("note", ""), "due_date": rec.get("due_date"),
                "reference": rec.get("reference", ""), "document_id": rec.get("document_id"),
                "completed_at": rec.get("completed_at"),
                "external": spec["kind"] in supervisor.EXTERNAL_KINDS,
            })

        outstanding = [i for i in items if i["status"] not in SETTLED]
        pkgs = [p for n in phase["steps"] for p in by_step.get(n, [])]
        phases.append({
            "key": phase["key"], "letter": phase["letter"], "name": phase["name"],
            "detail": phase["detail"], "hold": bool(phase.get("hold")),
            "steps": [{"n": s, "name": build_sequence.BY_NUMBER[s]["name"]}
                      for s in phase["steps"] if s in build_sequence.BY_NUMBER],
            "packages": [{"id": p["id"], "title": p["title"], "status": p["status"]} for p in pkgs],
            "items": items,
            "done": len(items) - len(outstanding),
            "total": len(items),
            "outstanding": len(outstanding),
            # A phase is finished only when its checks AND its trades are settled.
            "complete": (not outstanding
                         and all(p["status"] in PACKAGE_SETTLED for p in pkgs)),
        })

    current = next((p for p in phases if not p["complete"]), None)
    current_key = current["key"] if current else None
    for p in phases:
        p["current"] = p["key"] == current_key

    reminders = _reminders(phases, current_key)
    return {
        "project_id": project_id,
        "phases": phases,
        "current_phase": current_key,
        "current_phase_name": current["name"] if current else None,
        "items_done": done_items,
        "items_total": supervisor.ITEM_COUNT,
        "reminders": reminders[:12],
        "reminder_count": len(reminders),
        "hold_points": [r for r in reminders if r["severity"] == "hold"],
        "ongoing": supervisor.ONGOING,
        "footnote": supervisor.FOOTNOTE,
    }


@steps_router.put("/projects/{project_id}/steps/{action_key:path}")
async def update_action(project_id: str, action_key: str, data: ActionUpdate):
    """Record progress on one checklist item."""
    if not await db.projects.find_one({"id": project_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Project not found.")

    if not supervisor.find(action_key):
        raise HTTPException(status_code=404, detail="No such checklist item.")

    updates = data.model_dump(exclude_unset=True)
    if "status" in updates and updates["status"] not in STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of: {sorted(STATUSES)}")
    if updates.get("due_date") and not _as_date(updates["due_date"]):
        raise HTTPException(status_code=400, detail="due_date must be a date, as YYYY-MM-DD.")
    if updates.get("document_id"):
        if not await db.documents.find_one({"id": updates["document_id"], "project_id": project_id}):
            raise HTTPException(status_code=404, detail="That document is not on this job.")

    # Stamp when it was finished, and clear the stamp if it is reopened.
    if updates.get("status") == "done":
        updates["completed_at"] = now_iso()
    elif "status" in updates:
        updates["completed_at"] = None

    updates["updated_at"] = now_iso()
    await db.step_actions.update_one(
        {"project_id": project_id, "action_key": action_key},
        {"$set": {"project_id": project_id, "action_key": action_key, **updates}},
        upsert=True,
    )
    return await list_steps(project_id)
