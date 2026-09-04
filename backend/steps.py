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


def _match_package(entry: dict, packages: list, phase_steps: list) -> Optional[dict]:
    """Find the board package that covers this piece of trade work.

    Title keywords first, most specific first, and across the whole board rather
    than this phase's steps — one engagement routinely covers two visits, and the
    plumber's rough-in and fit-off are normally the same package. Where a keyword
    hits more than one package, the one sitting in this phase wins: "roof"
    matches both the frame carpenter's roof structure and the roof plumber, and
    only the second of those is roofing.

    Trade type is a last resort and never for "other" — that is the catch-all,
    so matching on it would put the scaffolder against the window supplier.
    """
    for keyword in entry["match"]:
        hits = [p for p in packages if keyword in p["title"].lower()]
        if not hits:
            continue
        return next((p for p in hits if p["step"] in phase_steps), hits[0])

    if entry["type"] == "other":
        return None
    same_type = [p for p in packages
                 if p.get("trade_type") == entry["type"] and p["step"] in phase_steps]
    return same_type[0] if len(same_type) == 1 else None


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
    for p in packages:
        p["step"] = build_sequence.step_for(p["title"], p.get("trade_type"))

    by_step: dict = {}
    for p in packages:
        by_step.setdefault(p["step"], []).append(p)

    phases, done_items, unbooked = [], 0, []
    for phase in supervisor.PHASES:
        # Which trades this phase needs, and whether each is on the board.
        stage_key = next((build_sequence.BY_NUMBER[n]["stage_key"]
                          for n in phase["steps"] if n in build_sequence.BY_NUMBER), "base")
        trades = []
        for entry in supervisor.trade_work_for(phase["key"]):
            match = _match_package(entry, packages, phase["steps"])
            trades.append({
                "key": entry["key"], "work": entry["work"], "trade_type": entry["type"],
                "package": ({"id": match["id"], "title": match["title"],
                             "status": match["status"], "step": match["step"]}
                            if match else None),
                # Everything the board needs to create it in one press.
                "suggested": {"title": entry["work"], "trade_type": entry["type"],
                              "stage_key": stage_key},
            })
        booked = {e["key"]: e for e in trades}
        for t in trades:
            if not t["package"] and not any(u["work"] == t["work"] for u in unbooked):
                unbooked.append({"phase_key": phase["key"], "phase_letter": phase["letter"],
                                 "phase_name": phase["name"], "step": phase["steps"][0], **t})

        items = []
        for spec in phase["items"]:
            key = f"{phase['key']}:{spec['key']}"
            rec = saved.get(key, {})
            status = rec.get("status", "todo")
            if status in SETTLED:
                done_items += 1
            entry = supervisor.trade_for_item(phase["key"], spec["key"])
            items.append({
                **spec, "action_key": key, "status": status,
                # Work a trade does. The board is where it is actioned; here it
                # is only confirmed, so the item carries the row to look at.
                "trade": ({"key": entry["key"], "work": entry["work"],
                           "package": booked[entry["key"]]["package"]}
                          if entry else None),
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
            "trades": trades,
            "unbooked": sum(1 for t in trades if not t["package"]),
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
        # Trade work the checklist expects that nobody is booked for. This is
        # the join between the two screens: confirm here, act on the board.
        "unbooked_trades": unbooked,
        "ongoing": supervisor.ONGOING,
        "footnote": supervisor.FOOTNOTE,
    }


class BookTrades(BaseModel):
    keys: list[str] = []      # trade keys to create; empty means every gap


@steps_router.get("/projects/{project_id}/trade-gaps")
async def trade_gaps(project_id: str):
    """Trade work the checklist expects that nobody is booked for.

    The board asks for this on its own so it does not have to pull all 193
    checklist items just to know what is missing.
    """
    checklist = await list_steps(project_id)
    return {"project_id": project_id, "unbooked": checklist["unbooked_trades"]}


@steps_router.post("/projects/{project_id}/trade-gaps")
async def book_trades(project_id: str, data: BookTrades,
                      user: dict = Depends(get_current_user)):
    """Put missing trade work on the board, where it can be actioned.

    The checklist only confirms; a package is what you send for quotes, award,
    book and pay. Creating them here means the two screens agree.
    """
    from packages import PackageInput, create_package   # local: avoids an import cycle

    gaps = (await trade_gaps(project_id))["unbooked"]
    wanted = [g for g in gaps if not data.keys or g["work"] in data.keys or g["key"] in data.keys]
    if not wanted:
        raise HTTPException(status_code=400, detail="Nothing to add — that work is already on the board.")

    made = []
    for g in wanted:
        pkg = await create_package(project_id, PackageInput(
            title=g["suggested"]["title"],
            trade_type=g["suggested"]["trade_type"],
            stage_key=g["suggested"]["stage_key"],
            scope=f"From the supervisor checklist — phase {g['phase_letter']}, {g['phase_name']}.",
            source="checklist",
        ), user=user)
        made.append({"id": pkg["id"], "title": pkg["title"]})
    return {"created": made, "count": len(made)}


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
