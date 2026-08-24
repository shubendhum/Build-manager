"""The trade board — one row per package, covering the whole builder loop.

A builder thinks in terms of a tradie and where they're up to: engage them, get
prices, book them, read the invoice, pay it, stay on top of the cost. The app
stored that as five separate tabs, so the sequence lived in the user's head.

This returns one row per work package with every figure that line needs and the
single next action to take, so the whole loop is one screen.

Read-only. No new collections.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends

from db import db
from auth import get_current_user
from invoices import derive as derive_invoice
from packages import LIVE_QUOTE_STATUSES, STAGE_ORDER

board_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

CHASE_AFTER_DAYS = 3

# Row order: whatever needs the user first, then work in flight, then done.
STATE_RANK = {
    "decide": 0,        # quotes in, waiting on a decision
    "chasing": 1,       # sent, no reply
    "not-engaged": 2,   # nobody asked yet
    "to-schedule": 3,   # awarded, no dates
    "booked": 4,        # dates set, no invoice
    "invoiced": 5,      # money owing
    "paid": 6,          # settled
}


def _days_since(iso: str) -> int:
    try:
        stamp = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return 0
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - stamp).days


def _money(v):
    return round(v, 2) if v else 0.0


@board_router.get("/projects/{project_id}/board")
async def trade_board(project_id: str):
    if not await db.projects.find_one({"id": project_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Project not found.")

    packages = await db.work_packages.find({"project_id": project_id}, {"_id": 0}).to_list(500)
    quotes = await db.quotes.find({"project_id": project_id}, {"_id": 0, "attachment.file_path": 0}).to_list(1000)
    rfqs = await db.rfqs.find({"project_id": project_id}, {"_id": 0}).to_list(500)
    invoices = await db.invoices.find({"project_id": project_id}, {"_id": 0}).to_list(500)
    est_lines = await db.estimate_lines.find({"project_id": project_id}, {"_id": 0}).to_list(1000)

    trade_ids = {q["trade_id"] for q in quotes if q.get("trade_id")}
    trade_ids |= {i["trade_id"] for r in rfqs for i in r.get("invitations", []) if i.get("trade_id")}
    trade_ids |= {i["trade_id"] for i in invoices if i.get("trade_id")}
    trades = await db.trades.find({"id": {"$in": list(trade_ids)}}, {"_id": 0}).to_list(500)
    tmap = {t["id"]: t for t in trades}

    quotes_by_pkg, rfqs_by_pkg, est_by_pkg = {}, {}, {}
    for q in quotes:
        quotes_by_pkg.setdefault(q.get("package_id"), []).append(q)
    for r in rfqs:
        rfqs_by_pkg.setdefault(r.get("package_id"), []).append(r)
    for line in est_lines:
        est_by_pkg.setdefault(line.get("package_id"), []).append(line)

    # An invoice belongs to a package directly, or through the quote it cites.
    quote_pkg = {q["id"]: q.get("package_id") for q in quotes}
    inv_by_pkg, unallocated = {}, []
    for inv in invoices:
        d = derive_invoice(dict(inv))
        pkg_id = d.get("package_id") or quote_pkg.get(d.get("quote_id"))
        if pkg_id:
            inv_by_pkg.setdefault(pkg_id, []).append(d)
        else:
            unallocated.append(d)

    rows = []
    for pkg in packages:
        pkg_quotes = quotes_by_pkg.get(pkg["id"], [])
        pkg_rfqs = [r for r in rfqs_by_pkg.get(pkg["id"], []) if r.get("status") != "closed"]
        pkg_invoices = inv_by_pkg.get(pkg["id"], [])

        live = [q for q in pkg_quotes if q["status"] in LIVE_QUOTE_STATUSES]
        accepted = next((q for q in pkg_quotes if q["status"] == "accepted"), None)

        invitations = [i for r in pkg_rfqs for i in r.get("invitations", [])]
        invited = len(invitations)
        replied = sum(1 for i in invitations if i.get("status") == "submitted")
        sent_stamps = [i["sent_at"] for i in invitations if i.get("sent_at")]
        oldest_sent = max((_days_since(s) for s in sent_stamps), default=0)

        invoiced = _money(sum(i["total_inc_gst"] for i in pkg_invoices))
        paid = _money(sum(i["amount_paid"] for i in pkg_invoices))
        overdue = sum(1 for i in pkg_invoices if i.get("is_overdue"))

        awarded_amount = accepted["total_inc_gst"] if accepted else None
        trade = tmap.get(accepted["trade_id"]) if accepted else None
        scheduled = pkg.get("scheduled_start")

        # --- the state machine: exactly one next action per row -----------
        if awarded_amount is not None:
            if invoiced and paid >= invoiced - 0.005:
                state, action = "paid", None
            elif invoiced:
                state = "invoiced"
                action = {"id": "pay", "label": "Record payment"}
            elif scheduled:
                state = "booked"
                action = {"id": "invoice", "label": "Record invoice"}
            else:
                state = "to-schedule"
                action = {"id": "schedule", "label": "Book dates"}
        elif live:
            state = "decide"
            action = {"id": "award", "label": "Compare & award"}
        elif invited:
            state = "chasing"
            action = ({"id": "chase", "label": "Chase"} if oldest_sent >= CHASE_AFTER_DAYS
                      else {"id": "view-rfq", "label": "View request"})
        else:
            state = "not-engaged"
            action = {"id": "get-quotes", "label": "Get quotes"}

        estimate = _money(sum(
            (line["quantity"] * line["rate"]) * (1.1 if line.get("gst_applicable", True) else 1.0)
            for line in est_by_pkg.get(pkg["id"], [])))
        benchmark = awarded_amount if awarded_amount is not None else (
            min((q["total_inc_gst"] for q in live), default=None))

        rows.append({
            "package_id": pkg["id"],
            "title": pkg["title"],
            # Carried so "Get quotes" can prefill the scope the trade will read.
            "scope": pkg.get("scope", ""),
            "trade_type": pkg.get("trade_type"),
            "stage_key": pkg.get("stage_key"),
            "sort_order": pkg.get("sort_order", 0),
            "state": state,
            "next_action": action,

            "trade_id": trade["id"] if trade else None,
            "trade_name": trade["business_name"] if trade else None,
            "trade_phone": trade.get("phone") if trade else None,
            "trade_email": trade.get("email") if trade else None,

            "invited": invited,
            "replied": replied,
            "days_since_sent": oldest_sent,
            "rfq_id": pkg_rfqs[0]["id"] if pkg_rfqs else None,

            "quote_count": len(pkg_quotes),
            "live_quote_count": len(live),
            "best_quote": _money(min((q["total_inc_gst"] for q in live), default=0)) or None,
            "awarded_amount": awarded_amount,

            "scheduled_start": pkg.get("scheduled_start"),
            "scheduled_end": pkg.get("scheduled_end"),

            "invoiced": invoiced,
            "paid": paid,
            "outstanding": _money(invoiced - paid),
            "overdue_count": overdue,

            "estimate_total": estimate,
            "variance_vs_estimate": _money(benchmark - estimate) if benchmark and estimate else None,
        })

    rows.sort(key=lambda r: (STATE_RANK.get(r["state"], 9),
                             STAGE_ORDER.get(r["stage_key"], 99),
                             r["sort_order"]))

    committed = _money(sum(r["awarded_amount"] or 0 for r in rows))
    return {
        "project_id": project_id,
        "rows": rows,
        "totals": {
            "estimate": _money(sum(r["estimate_total"] for r in rows)),
            "committed": committed,
            "invoiced": _money(sum(r["invoiced"] for r in rows) + sum(i["total_inc_gst"] for i in unallocated)),
            "paid": _money(sum(r["paid"] for r in rows) + sum(i["amount_paid"] for i in unallocated)),
            "outstanding": _money(sum(r["outstanding"] for r in rows)
                                  + sum(i["balance"] for i in unallocated)),
            "unallocated_invoiced": _money(sum(i["total_inc_gst"] for i in unallocated)),
            "package_count": len(rows),
            "needs_you": sum(1 for r in rows if r["state"] in {"decide", "chasing", "invoiced"}),
        },
    }
