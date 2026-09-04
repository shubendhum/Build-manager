"""Planning a build backwards from the date it has to be finished.

A builder is given a handover date, not a start date. So the useful question is
not "when will this finish" but "what has to happen by when for it to finish
then" — and the answer that matters most is the order-by date on a material with
a ten-week lead time, which falls due long before anyone is on site.

Everything here is computed. Nothing is stored except the target date on the
project, so the plan re-derives itself as steps take longer or shorter than the
default and as packages get real dates against them.

Working days only: Saturdays, Sundays and Victorian public holidays are skipped,
because a ten-week lead time quoted by a supplier is in calendar weeks but a
five-day plaster run is not.
"""
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db import db
from auth import get_current_user
from steps import _match_package
import build_sequence
import materials
import supervisor

timeline_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

# Victorian public holidays. Only the fixed and well-known ones — this shifts a
# date by a day or two, and a builder reads the plan as a guide, not a contract.
def _vic_holidays(year: int) -> set:
    """New Year, Australia Day, ANZAC Day, Christmas and Boxing Day, plus the
    Melbourne Cup and Labour Day / Queen's Birthday Mondays."""
    out = {date(year, 1, 1), date(year, 1, 26), date(year, 4, 25),
           date(year, 12, 25), date(year, 12, 26)}

    def nth_weekday(month, weekday, n):
        d = date(year, month, 1)
        d += timedelta(days=(weekday - d.weekday()) % 7)
        return d + timedelta(weeks=n - 1)

    out.add(nth_weekday(3, 0, 2))    # Labour Day, second Monday in March
    out.add(nth_weekday(6, 0, 2))    # King's Birthday, second Monday in June
    out.add(nth_weekday(11, 1, 1))   # Melbourne Cup, first Tuesday in November
    return out


_HOLIDAY_CACHE: dict = {}


def is_working_day(d: date) -> bool:
    if d.weekday() >= 5:
        return False
    hol = _HOLIDAY_CACHE.setdefault(d.year, _vic_holidays(d.year))
    return d not in hol


def add_working_days(start: date, days: int) -> date:
    """The date `days` working days after `start`, counting forwards."""
    d, left = start, days
    while left > 0:
        d += timedelta(days=1)
        if is_working_day(d):
            left -= 1
    return d


def sub_working_days(end: date, days: int) -> date:
    """The date `days` working days before `end`."""
    d, left = end, days
    while left > 0:
        d -= timedelta(days=1)
        if is_working_day(d):
            left -= 1
    return d


def next_working_day(d: date) -> date:
    while not is_working_day(d):
        d += timedelta(days=1)
    return d


def _as_date(value) -> Optional[date]:
    try:
        return date.fromisoformat(str(value)[:10])
    except (ValueError, TypeError):
        return None


def plan_backwards(finish: date) -> list:
    """Walk the sequence from the end, giving every step a start and a finish.

    A step that runs alongside the one before it shares that step's window
    rather than pushing everything else earlier.
    """
    rows, cursor = [], finish
    for step in reversed(build_sequence.SEQUENCE):
        if step["parallel"] and rows:
            # Ends when the step it runs with ends; may start earlier if longer.
            ends = rows[-1]["finish"]
            starts = sub_working_days(ends, step["days"] - 1)
        else:
            ends = cursor
            starts = sub_working_days(ends, step["days"] - 1)
            cursor = sub_working_days(starts, 1)
        rows.append({**step, "start": starts, "finish": ends})
    rows.reverse()
    return rows


def plan_forwards(start: date) -> list:
    """The same walk from a known start date, for a job already under way."""
    rows, cursor = [], next_working_day(start)
    for step in build_sequence.SEQUENCE:
        if step["parallel"] and rows:
            starts = rows[-1]["start"]
            ends = add_working_days(starts, step["days"] - 1)
        else:
            starts = cursor
            ends = add_working_days(starts, step["days"] - 1)
            cursor = add_working_days(ends, 1)
        rows.append({**step, "start": starts, "finish": ends})
    return rows


@timeline_router.get("/projects/{project_id}/timeline")
async def get_timeline(project_id: str):
    """The whole build laid out against dates, planned back from handover."""
    project = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")

    today = date.today()
    target = _as_date(project.get("target_completion"))
    start = _as_date(project.get("start_date"))

    # Backwards from the handover date if there is one, because that is the date
    # a builder is held to. Otherwise forwards from the start, and if neither is
    # set, forwards from today so the shape of the job is still visible.
    if target:
        steps = plan_backwards(target)
        basis = "backwards from handover"
    elif start:
        steps = plan_forwards(start)
        basis = "forwards from site start"
    else:
        steps = plan_forwards(today)
        basis = "forwards from today, because no dates are set yet"

    planned_start = steps[0]["start"]
    planned_finish = steps[-1]["finish"]

    packages = await db.work_packages.find(
        {"project_id": project_id},
        {"_id": 0, "id": 1, "title": 1, "trade_type": 1, "status": 1,
         "scheduled_start": 1, "scheduled_end": 1}).to_list(500)
    for p in packages:
        p["step"] = build_sequence.step_for(p["title"], p.get("trade_type"))

    settled = {"awarded", "ordered", "in-progress", "complete"}
    by_step: dict = {}
    for p in packages:
        by_step.setdefault(p["step"], []).append(p)

    # Where the job actually is: the earliest step still carrying unsettled work.
    current = next((s["n"] for s in build_sequence.SEQUENCE
                    if any(p["status"] not in settled for p in by_step.get(s["n"], []))), None)

    rows, late = [], 0
    for s in steps:
        pkgs = by_step.get(s["n"], [])
        booked = [_as_date(p.get("scheduled_start")) for p in pkgs if p.get("scheduled_start")]
        state = ("done" if pkgs and all(p["status"] == "complete" for p in pkgs)
                 else "current" if current == s["n"]
                 else "past" if current and s["n"] < current
                 else "ahead")
        # Behind means the plan said this should have started and nothing is
        # committed for it. A step with no package is not behind — it may simply
        # not apply to this job.
        behind = bool(s["start"] < today and state in {"past", "current"}
                      and pkgs and not all(p["status"] in settled for p in pkgs))
        if behind:
            late += 1
        rows.append({
            "n": s["n"], "key": s["key"], "name": s["name"], "detail": s["detail"],
            "mandatory": bool(s.get("mandatory")), "days": s["days"], "parallel": s["parallel"],
            "start": s["start"].isoformat(), "finish": s["finish"].isoformat(),
            "state": state, "behind": behind,
            "packages": [{"id": p["id"], "title": p["title"], "status": p["status"],
                          "scheduled_start": p.get("scheduled_start")} for p in pkgs],
            "booked_start": min(booked).isoformat() if booked else None,
        })

    step_dates = {r["n"]: r for r in rows}

    # ---- Materials, which is the point of planning backwards at all ----------
    orders = []
    for m in materials.MATERIALS:
        needed = step_dates.get(m["needed_step"])
        if not needed:
            continue
        need_by = date.fromisoformat(needed["start"])
        order_by = sub_working_days(need_by, m["lead_weeks"] * 5)
        days_left = (order_by - today).days
        # A material is usually supplied by the trade that installs it. Say so,
        # and only offer a supply-only package where nothing covers it — a
        # builder buying frames direct still wants that price on the board.
        entry = next((e for v in supervisor.TRADE_WORK.values() for e in v
                      if e["key"] == m["trade"]), None)
        # Pass the step the material is needed at, so a keyword that hits twice
        # resolves the same way it does on the checklist: "roof" matches both
        # the frame carpenter's roof structure and the roofer, and the roof
        # tiles belong to the second.
        at = [m["needed_step"]]
        supply = _match_package({"match": [f"supply: {m['name'].lower()}"], "type": "other"},
                                packages, at)
        installer = _match_package(entry, packages, at) if entry else None
        orders.append({
            **{k: m[k] for k in ("key", "name", "lead_weeks", "note", "trade")},
            "supply_package": ({"id": supply["id"], "title": supply["title"],
                                "status": supply["status"]} if supply else None),
            "installer_package": ({"id": installer["id"], "title": installer["title"],
                                   "status": installer["status"]} if installer else None),
            "installer_work": entry["work"] if entry else None,
            "needed_step": m["needed_step"], "needed_step_name": needed["name"],
            "needed_by": need_by.isoformat(),
            "order_by": order_by.isoformat(),
            "measured_on_site": bool(m.get("after")),
            "days_left": days_left,
            # Measured items are sequenced, not ordered ahead, so they are never
            # "overdue to order" — saying so would be noise every single day.
            "status": ("sequenced" if m.get("after")
                       else "overdue" if days_left < 0
                       else "order-now" if days_left <= 7
                       else "soon" if days_left <= 28
                       else "later"),
        })
    orders.sort(key=lambda o: (o["measured_on_site"], o["order_by"]))

    overdue_orders = [o for o in orders if o["status"] == "overdue"]
    return {
        "project_id": project_id,
        "basis": basis,
        "target_completion": target.isoformat() if target else None,
        "start_date": start.isoformat() if start else None,
        "planned_start": planned_start.isoformat(),
        "planned_finish": planned_finish.isoformat(),
        "build_days": build_sequence.BUILD_DAYS,
        "build_weeks": round(build_sequence.BUILD_DAYS / 5),
        "today": today.isoformat(),
        "current_step": current,
        "steps": rows,
        "orders": orders,
        "on_track": not late and not overdue_orders,
        "steps_behind": late,
        "orders_overdue": len(overdue_orders),
        # A plan that starts in the past is the clearest signal of all: the date
        # being asked for is not achievable at these durations.
        "start_has_passed": planned_start < today and bool(target),
    }


class SupplyOrder(BaseModel):
    keys: list[str] = []      # material keys to raise a supply package for


@timeline_router.post("/projects/{project_id}/material-orders")
async def raise_supply_packages(project_id: str, data: SupplyOrder,
                                user: dict = Depends(get_current_user)):
    """Put a material on the board so a supply-only price can be asked for.

    Most of the time the trade supplies and installs, and this is not needed.
    But frames, bricks and cabinetry are routinely bought direct, and a
    supply-only quote is still a quote — it belongs on the board with the rest
    of the money, not in somebody's inbox.
    """
    from packages import PackageInput, create_package   # local: avoids an import cycle

    plan = await get_timeline(project_id)
    wanted = [o for o in plan["orders"]
              if o["key"] in data.keys and not o["supply_package"]]
    if not wanted:
        raise HTTPException(status_code=400,
                            detail="Nothing to add — those already have a supply package.")

    made = []
    for o in wanted:
        step = build_sequence.BY_NUMBER[o["needed_step"]]
        pkg = await create_package(project_id, PackageInput(
            title=f"Supply: {o['name']}",
            trade_type="other",
            stage_key=step["stage_key"],
            scope=(f"Supply only, delivered to site for {o['needed_step_name'].lower()}. "
                   f"Needed on site by {o['needed_by']}, so order by {o['order_by']} "
                   f"— about {o['lead_weeks']} weeks' notice. {o['note']}"),
            source="material",
        ), user=user)
        made.append({"id": pkg["id"], "title": pkg["title"]})
    return {"created": made, "count": len(made)}
