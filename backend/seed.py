import os
import uuid
from datetime import datetime, timezone, timedelta
from db import db
from auth import hash_password, verify_password
from projects import generate_roadmap_tasks, now_iso

DEMO_PROJECT_NAME = "Residence – Ballarat West"


async def seed_user():
    email = os.environ.get("ADMIN_EMAIL", "pm@buildmanagervic.com.au").lower()
    password = os.environ.get("ADMIN_PASSWORD", "SitePM-2026")
    existing = await db.users.find_one({"email": email})
    if existing is None:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": email,
            "name": "Site PM",
            "password_hash": hash_password(password),
            "created_at": now_iso(),
        })
    elif not verify_password(password, existing["password_hash"]):
        await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(password)}})


async def seed_demo_project():
    if await db.projects.find_one({"name": DEMO_PROJECT_NAME, "is_seed": True}):
        return
    project_id = str(uuid.uuid4())
    await db.projects.insert_one({
        "id": project_id,
        "is_seed": True,
        "name": DEMO_PROJECT_NAME,
        "client_name": "Sarah & Tom Mitchell",
        "client_contact": "0412 345 678 · mitchell.family@email.com",
        "site_street": "14 Wattle Grove Court",
        "site_suburb": "Ballarat West",
        "site_postcode": "3350",
        "builder_name": "Hartley Constructions Pty Ltd",
        "builder_registration": "DB-U 45821",
        "dbi_policy_number": "HIA-DBI-2025-88431",
        "dbi_expiry": "2027-06-30",
        "contract_value": 620000,
        "start_date": "2025-09-15",
        "target_completion": "2026-08-28",
        "project_type": "new-build",
        "status": "active",
        "notes": "Single-storey 4BR new build. Client prefers site meetings Friday mornings.",
        "created_at": now_iso(),
        "updated_at": now_iso(),
    })
    tasks = await generate_roadmap_tasks(project_id)

    today = datetime.now(timezone.utc)
    overdue = (today - timedelta(days=5)).date().isoformat()
    upcoming = (today + timedelta(days=14)).date().isoformat()

    trades_base = {0: "Ballarat Earthworks", 1: "JT Plumbing & Gas", 4: "ABC Concreting"}
    for t in tasks:
        idx = t["sort_order"] // 10
        updates = {}
        if t["stage_key"] == "pre-construction":
            updates["status"] = "done"
        elif t["stage_key"] == "base":
            updates["status"] = "done" if idx < 4 else "in-progress"
            if idx in trades_base:
                updates["assigned_trade"] = trades_base[idx]
        elif t["stage_key"] == "frame":
            if idx == 0:
                updates.update({"status": "in-progress", "assigned_trade": "Ballarat Frame & Truss", "due_date": overdue})
            elif idx == 3:
                updates["due_date"] = upcoming
        if updates:
            updates["updated_at"] = now_iso()
            await db.tasks.update_one({"id": t["id"]}, {"$set": updates})


async def seed_all():
    await seed_user()
    await seed_demo_project()
