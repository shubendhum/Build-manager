"""What to do next on a project.

The project page used to open on a reference card, so the sequence of the job —
drawings, packages, quotes, award, invoice — lived in the user's head. This
computes that sequence from actual project state and returns it as a ranked list
of actions, each pointing at the tab that resolves it.

Read-only. Every figure comes from the same collections the tabs read.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends

from db import db
from auth import get_current_user
from trades import trade_warnings
from invoices import derive as derive_invoice
from packages import LIVE_QUOTE_STATUSES, COMMITTED_STATUSES
from steps import list_steps
from timeline import get_timeline
import build_sequence

nextsteps_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

# An invitation that has been sitting unanswered this long is worth chasing.
CHASE_AFTER_DAYS = 3
# Severity drives colour and ordering: blockers first, then decisions, then setup.
SEVERITY_RANK = {"urgent": 0, "decision": 1, "todo": 2}


def _days_since(iso: str) -> int:
    try:
        stamp = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return 0
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - stamp).days


def _action(id_, severity, title, detail, tab, count=None):
    return {"id": id_, "severity": severity, "title": title, "detail": detail,
            "tab": tab, "count": count}


@nextsteps_router.get("/projects/{project_id}/next-steps")
async def next_steps(project_id: str):
    if not await db.projects.find_one({"id": project_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Project not found.")

    # One read per collection — this endpoint loads on every project page view.
    documents = await db.documents.find({"project_id": project_id}, {"_id": 0, "category": 1}).to_list(500)
    plans = await db.plan_analyses.find({"project_id": project_id}, {"_id": 0, "id": 1, "job_status": 1, "status": 1}).to_list(200)
    packages = await db.work_packages.find({"project_id": project_id}, {"_id": 0}).to_list(500)
    quotes = await db.quotes.find({"project_id": project_id}, {"_id": 0, "attachment": 0}).to_list(1000)
    rfqs = await db.rfqs.find({"project_id": project_id}, {"_id": 0}).to_list(500)
    invoices = await db.invoices.find({"project_id": project_id}, {"_id": 0}).to_list(500)
    tasks = await db.tasks.find({"project_id": project_id}, {"_id": 0}).to_list(1000)

    actions, done = [], []

    # ---- 1. Drawings in, plan out --------------------------------------
    has_drawings = any(d.get("category") == "drawings" for d in documents)
    if not has_drawings:
        actions.append(_action(
            "upload-drawings", "todo", "Upload your architect's drawings",
            "Nothing filed under Drawings yet. Everything else starts here.", "drawings"))
    else:
        done.append("Drawings uploaded")

    applied_plan = any(p.get("status") == "applied" for p in plans)
    analysed_plan = any(p.get("job_status") == "analyzed" for p in plans)
    if has_drawings and not plans:
        actions.append(_action(
            "run-planner", "todo", "Run the AI Planner on your drawings",
            "It reads the sheets and proposes tasks, packages and a cost estimate.", "drawings"))
    elif analysed_plan and not applied_plan:
        actions.append(_action(
            "apply-plan", "decision", "Review and apply the draft build plan",
            "The analysis is finished and waiting for you to approve it.", "drawings"))
    elif applied_plan:
        done.append("Build plan applied")

    # ---- 2. Packages ---------------------------------------------------
    quotes_by_pkg = {}
    for q in quotes:
        quotes_by_pkg.setdefault(q.get("package_id"), []).append(q)
    invited_pkg_ids = {r.get("package_id") for r in rfqs if r.get("invitations")}

    if not packages:
        if applied_plan or has_drawings:
            actions.append(_action(
                "create-packages", "todo", "Break the build into work packages",
                "A package is one scope you can send out for quotes and later award.", "work"))
    else:
        done.append(f"{len(packages)} work packages defined")

        never_sent = [p for p in packages if p["id"] not in invited_pkg_ids]
        if never_sent:
            actions.append(_action(
                "send-packages", "todo",
                f"{len(never_sent)} package{'' if len(never_sent) == 1 else 's'} never sent for quote",
                ", ".join(p["title"] for p in never_sent[:4])
                + ("…" if len(never_sent) > 4 else ""),
                "work", len(never_sent)))

        # A package with live prices and no award is a decision sitting on you.
        awaiting = [p for p in packages
                    if p["status"] not in COMMITTED_STATUSES
                    and any(q["status"] in LIVE_QUOTE_STATUSES for q in quotes_by_pkg.get(p["id"], []))]
        if awaiting:
            actions.append(_action(
                "decide-quotes", "decision",
                f"{len(awaiting)} package{'' if len(awaiting) == 1 else 's'} have quotes waiting for a decision",
                ", ".join(p["title"] for p in awaiting[:4]) + ("…" if len(awaiting) > 4 else ""),
                "work", len(awaiting)))

        awarded = [p for p in packages if p["status"] in COMMITTED_STATUSES]
        if awarded:
            done.append(f"{len(awarded)} package{'' if len(awarded) == 1 else 's'} awarded")

    # ---- 3. Chase silent trades ---------------------------------------
    silent = []
    for rfq in rfqs:
        if rfq.get("status") == "closed":
            continue
        for inv in rfq.get("invitations", []):
            if inv.get("status") in {"sent", "viewed"} and inv.get("sent_at") \
                    and _days_since(inv["sent_at"]) >= CHASE_AFTER_DAYS:
                silent.append(inv)
    if silent:
        oldest = max(_days_since(i["sent_at"]) for i in silent)
        actions.append(_action(
            "chase-trades", "decision",
            f"{len(silent)} trade{'' if len(silent) == 1 else 's'} haven't responded",
            f"Longest wait is {oldest} days. Resend from the quote request.",
            "work", len(silent)))

    # Trades that opened the link but never priced it are the warmest to chase.
    never_opened = [i for r in rfqs if r.get("status") != "closed"
                    for i in r.get("invitations", [])
                    if i.get("status") == "sent" and not i.get("first_viewed_at") and i.get("sent_at")
                    and _days_since(i["sent_at"]) >= CHASE_AFTER_DAYS]
    if never_opened:
        actions.append(_action(
            "unopened-rfqs", "todo",
            f"{len(never_opened)} quote request{'' if len(never_opened) == 1 else 's'} never opened",
            "They may not have received it — try SMS, or check the address on file.",
            "work", len(never_opened)))

    # ---- 4. Compliance -------------------------------------------------
    trade_ids = {q["trade_id"] for q in quotes if q.get("trade_id")}
    trade_ids |= {i["trade_id"] for r in rfqs for i in r.get("invitations", []) if i.get("trade_id")}
    if trade_ids:
        involved = await db.trades.find({"id": {"$in": list(trade_ids)}}, {"_id": 0}).to_list(500)
        lapsed = [t for t in involved
                  if any(w["level"] == "expired" for w in trade_warnings(t))]
        if lapsed:
            actions.append(_action(
                "lapsed-cover", "urgent",
                f"{len(lapsed)} trade{'' if len(lapsed) == 1 else 's'} on this job have lapsed cover",
                ", ".join(t["business_name"] for t in lapsed[:4]) + ("…" if len(lapsed) > 4 else ""),
                "work", len(lapsed)))

    # ---- 5. Money ------------------------------------------------------
    derived = [derive_invoice(dict(i)) for i in invoices]
    overdue_invoices = [i for i in derived if i.get("is_overdue")]
    if overdue_invoices:
        total = round(sum(i["balance"] for i in overdue_invoices), 2)
        actions.append(_action(
            "overdue-invoices", "urgent",
            f"{len(overdue_invoices)} invoice{'' if len(overdue_invoices) == 1 else 's'} overdue",
            f"${total:,.2f} outstanding past its due date.", "money", len(overdue_invoices)))

    # ---- 6. The supervisor's own checklist ------------------------------
    # Permits, hold points and certificates have no package behind them, so
    # without this they are invisible on every screen but their own.
    checklist = await list_steps(project_id)
    holds = checklist["hold_points"]
    if holds:
        actions.append(_action(
            "hold-point", "urgent",
            f"{len(holds)} mandatory hold point{'' if len(holds) == 1 else 's'} — do not proceed",
            holds[0]["name"], "steps", len(holds)))

    late = [r for r in checklist["reminders"] if r["severity"] == "overdue"]
    if late:
        actions.append(_action(
            "checklist-overdue", "urgent",
            f"{len(late)} checklist item{'' if len(late) == 1 else 's'} overdue",
            f"{late[0]['name']} — {late[0]['why']}", "steps", len(late)))

    early = [r for r in checklist["reminders"] if r["severity"] in {"lead-time", "due-soon"}]
    if early:
        actions.append(_action(
            "checklist-lead-time", "decision",
            f"{len(early)} thing{'' if len(early) == 1 else 's'} to start now, not later",
            f"{early[0]['name']} — {early[0]['why']}", "steps", len(early)))

    # ---- 7. Materials -----------------------------------------------------
    # A ten-week lead time falls due long before anyone is on site, so an order
    # date that has passed is the most expensive thing on this list.
    plan = await get_timeline(project_id)
    late_orders = [o for o in plan["orders"] if o["status"] == "overdue"]
    if late_orders:
        actions.append(_action(
            "orders-overdue", "urgent",
            f"{len(late_orders)} material order{'' if len(late_orders) == 1 else 's'} past its date",
            f"{late_orders[0]['name']} — {abs(late_orders[0]['days_left'])} days ago",
            "timeline", len(late_orders)))

    order_now = [o for o in plan["orders"] if o["status"] == "order-now"]
    if order_now:
        actions.append(_action(
            "orders-now", "decision",
            f"{len(order_now)} thing{'' if len(order_now) == 1 else 's'} to order this week",
            f"{order_now[0]['name']} — {order_now[0]['lead_weeks']} weeks' notice",
            "timeline", len(order_now)))

    if plan["start_has_passed"]:
        actions.append(_action(
            "start-has-passed", "urgent", "The handover date is no longer reachable",
            f"It needed to start {plan['planned_start']}.", "timeline"))

    if checklist["items_done"]:
        done.append(f"{checklist['items_done']} of {checklist['items_total']} checklist items done")

    actions.sort(key=lambda a: SEVERITY_RANK.get(a["severity"], 9))

    # Tab-level counts drive the attention chips on the grouped navigation.
    badges = {}
    for a in actions:
        if a["count"]:
            badges[a["tab"]] = badges.get(a["tab"], 0) + a["count"]

    # The current stage rides along here because this endpoint is fetched on
    # every screen — the header can then show it everywhere without a second call.
    current_stage = None
    if packages:
        settled = {"awarded", "ordered", "in-progress", "complete"}
        placed = [(build_sequence.step_for(p["title"], p.get("trade_type")), p)
                  for p in packages if p["status"] not in settled]
        if placed:
            n, _ = min(placed, key=lambda x: x[0])
            step = build_sequence.BY_NUMBER.get(n)
            if step:
                current_stage = {"n": step["n"], "key": step["key"], "name": step["name"],
                                 "of": len(build_sequence.SEQUENCE)}

    return {"project_id": project_id, "actions": actions, "done": done, "badges": badges,
            "current_stage": current_stage,
            "checklist": {"phase": checklist["current_phase_name"],
                          "done": checklist["items_done"], "total": checklist["items_total"]}}
