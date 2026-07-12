import re
from fastapi import APIRouter, Depends, Query
from db import db
from auth import get_current_user

search_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])

MAX_RESULTS = 20


@search_router.get("/search")
async def global_search(q: str = Query("", max_length=100)):
    """Case-insensitive search across projects, trades and quotes. Capped at 20 typed results."""
    term = q.strip()
    if len(term) < 2:
        return {"query": term, "results": []}
    rx = {"$regex": re.escape(term), "$options": "i"}
    results = []

    projects = await db.projects.find(
        {"$or": [{"name": rx}, {"site_suburb": rx}]},
        {"_id": 0, "id": 1, "name": 1, "site_suburb": 1, "site_postcode": 1, "status": 1},
    ).to_list(MAX_RESULTS)
    for p in projects:
        results.append({
            "type": "project", "id": p["id"], "title": p["name"],
            "subtitle": f"{p.get('site_suburb', '')} VIC {p.get('site_postcode', '')} · {p.get('status', '')}".strip(),
            "project_id": p["id"],
        })

    trades = await db.trades.find(
        {"$or": [{"business_name": rx}, {"contact_person": rx}]},
        {"_id": 0, "id": 1, "business_name": 1, "trade_type": 1, "contact_person": 1},
    ).to_list(MAX_RESULTS)
    for t in trades:
        subtitle_bits = [t.get("trade_type", ""), t.get("contact_person", "")]
        results.append({
            "type": "trade", "id": t["id"], "title": t["business_name"],
            "subtitle": " · ".join(b for b in subtitle_bits if b),
            "project_id": None,
        })

    quotes = await db.quotes.find(
        {"$or": [{"work_package": rx}, {"scope_description": rx}]},
        {"_id": 0, "id": 1, "work_package": 1, "project_id": 1, "status": 1, "total_inc_gst": 1},
    ).to_list(MAX_RESULTS)
    project_ids = list({qt["project_id"] for qt in quotes})
    pmap = {p["id"]: p["name"] for p in await db.projects.find(
        {"id": {"$in": project_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(100)}
    for qt in quotes:
        results.append({
            "type": "quote", "id": qt["id"], "title": qt["work_package"],
            "subtitle": f"{pmap.get(qt['project_id'], 'Unknown project')} · {qt.get('status', '')}",
            "project_id": qt["project_id"],
        })

    return {"query": term, "results": results[:MAX_RESULTS]}
