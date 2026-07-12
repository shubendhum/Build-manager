from datetime import datetime, timezone, date, timedelta
from fastapi import APIRouter, Depends
from db import db
from auth import get_current_user
from roadmap_template import STAGES
from projects import stage_counts_for_projects, compute_progress
from invoices import derive as derive_invoice
from trades import with_warnings
from budget import compute_budget

dashboard_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])


@dashboard_router.get("/dashboard")
async def get_dashboard():
    today = datetime.now(timezone.utc).date()
    projects = await db.projects.find({}, {"_id": 0}).to_list(500)
    pids = [p["id"] for p in projects]
    pname = {p["id"]: p["name"] for p in projects}
    counts = await stage_counts_for_projects(pids)

    # Progress + current in-progress stage per project
    current_stage = {}
    portfolio = []
    for p in projects:
        overall, per_stage = compute_progress(counts.get(p["id"], {}))
        p["progress"] = overall
        for s in STAGES:
            pct = per_stage.get(s["key"])
            if pct is not None and pct < 100:
                current_stage[p["id"]] = s["key"]
                break
        budget = await compute_budget(p)
        portfolio.append({
            "id": p["id"], "name": p["name"], "status": p["status"], "progress": overall,
            "contract_value": p.get("contract_value", 0), "budget_health": budget["totals"]["health"],
            "site_suburb": p.get("site_suburb", ""), "site_postcode": p.get("site_postcode", ""),
        })

    # Open tasks across projects
    tasks = await db.tasks.find({"project_id": {"$in": pids}, "status": {"$nin": ["done", "n-a"]}}, {"_id": 0}).to_list(5000)

    inspections = []
    upcoming_tasks = []
    horizon = today + timedelta(days=7)
    for t in tasks:
        entry = {
            "project_id": t["project_id"], "project_name": pname.get(t["project_id"], ""),
            "task_id": t["id"], "title": t["title"], "stage_key": t["stage_key"],
            "due_date": t.get("due_date"), "status": t["status"],
        }
        if t.get("is_mandatory_inspection"):
            if t.get("due_date"):
                due = date.fromisoformat(t["due_date"])
                entry["days_until"] = (due - today).days
                entry["is_overdue"] = due < today
                entry["unscheduled"] = False
                inspections.append(entry)
            elif t["stage_key"] == current_stage.get(t["project_id"]):
                entry.update({"days_until": None, "is_overdue": False, "unscheduled": True})
                inspections.append(entry)
        elif t.get("due_date"):
            due = date.fromisoformat(t["due_date"])
            if due <= horizon:
                entry["is_overdue"] = due < today
                upcoming_tasks.append(entry)

    inspections.sort(key=lambda i: (i["unscheduled"], i["days_until"] if i["days_until"] is not None else 9999))
    upcoming_tasks.sort(key=lambda t: t["due_date"])
    upcoming_tasks = upcoming_tasks[:10]

    # Overdue invoices across projects
    all_invoices = await db.invoices.find({"project_id": {"$in": pids}}, {"_id": 0}).to_list(1000)
    overdue = [derive_invoice(i) for i in all_invoices]
    overdue = [i for i in overdue if i["is_overdue"]]
    overdue.sort(key=lambda i: i["balance"], reverse=True)
    overdue_invoices = {
        "count": len(overdue),
        "total_balance": round(sum(i["balance"] for i in overdue), 2),
        "items": [{
            "invoice_id": i["id"], "invoice_number": i["invoice_number"],
            "project_id": i["project_id"], "project_name": pname.get(i["project_id"], ""),
            "balance": i["balance"], "due_date": i.get("due_date"),
        } for i in overdue[:5]],
    }
    # Resolve trade names for the top overdue items
    inv_by_id = {i["id"]: i for i in all_invoices}
    trade_ids = list({inv_by_id[x["invoice_id"]].get("trade_id") for x in overdue_invoices["items"] if inv_by_id[x["invoice_id"]].get("trade_id")})
    trade_docs = await db.trades.find({"id": {"$in": trade_ids}}, {"_id": 0, "id": 1, "business_name": 1}).to_list(100)
    tname = {t["id"]: t["business_name"] for t in trade_docs}
    for item in overdue_invoices["items"]:
        item["trade_name"] = tname.get(inv_by_id[item["invoice_id"]].get("trade_id"))

    # Trade licence/insurance warnings
    all_trades = await db.trades.find({}, {"_id": 0}).to_list(500)
    trade_warnings = [
        {"trade_id": t["id"], "business_name": t["business_name"], "warnings": t["warnings"]}
        for t in (with_warnings(t) for t in all_trades) if t["warnings"]
    ]

    # Progress claims snapshot for active projects
    claims_snapshot = []
    for p in projects:
        if p["status"] != "active":
            continue
        lines = await db.claims.find({"project_id": p["id"]}, {"_id": 0}).sort("sort_order", 1).to_list(50)
        if not lines:
            continue
        next_unclaimed = next(({"stage_label": l["stage_label"], "amount": l["amount"]}
                               for l in lines if l["status"] == "not-claimed"), None)
        claims_snapshot.append({
            "project_id": p["id"], "project_name": p["name"],
            "contract_value": p.get("contract_value", 0),
            "total_claimed": round(sum(l["amount"] for l in lines if l["status"] in ("claimed", "paid")), 2),
            "total_paid": round(sum(l["amount"] for l in lines if l["status"] == "paid"), 2),
            "next_unclaimed": next_unclaimed,
        })

    return {
        "portfolio": portfolio,
        "inspections": inspections,
        "overdue_invoices": overdue_invoices,
        "trade_warnings": trade_warnings,
        "upcoming_tasks": upcoming_tasks,
        "claims_snapshot": claims_snapshot,
    }
