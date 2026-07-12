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


async def seed_trades_and_finance():
    """Phase 2 seed: trades, quotes, invoices, progress claims for the demo project. Idempotent."""
    if await db.trades.find_one({"is_seed": True}):
        return
    project = await db.projects.find_one({"name": DEMO_PROJECT_NAME, "is_seed": True})
    if not project:
        return
    pid = project["id"]
    today = datetime.now(timezone.utc).date()

    def d(days):
        return (today + timedelta(days=days)).isoformat()

    def trade(business_name, trade_type, contact, phone, licence, licence_days, insurer, policy, ins_days, rate, rating):
        return {
            "id": str(uuid.uuid4()), "is_seed": True, "business_name": business_name, "trade_type": trade_type,
            "contact_person": contact, "phone": phone, "email": f"admin@{business_name.lower().replace(' ', '').replace('&', 'and')}.com.au",
            "abn": "51 824 753 556", "licence_number": licence, "licence_expiry": d(licence_days),
            "insurer": insurer, "insurance_policy_number": policy, "insurance_expiry": d(ins_days),
            "rate_notes": rate, "rating": rating, "notes": "",
            "created_at": now_iso(), "updated_at": now_iso(),
        }

    trades = [
        trade("Ballarat Electrical Co", "electrician", "Mick Torrance", "0407 221 384", "REC 28374", 420, "CGU", "PL-8837121", 300, "Call-out $120 + $95/hr", 5),
        trade("Western Vic Electrical", "electrician", "Dana Kovacs", "0421 660 903", "REC 31502", 510, "Allianz", "PL-5521904", 380, "$90/hr", 4),
        trade("JT Plumbing & Gas", "plumber", "Jake Tolhurst", "0400 118 762", "VBA 49213", 18, "QBE", "PL-2290187", 210, "Day rate $880", 4),
        trade("ABC Concreting", "concreter", "Tony Abela", "0417 555 210", "CB-L 61443", 600, "GIO", "PL-7714530", 450, "$78/m2 slab incl. pump", 5),
        trade("Ballarat Frame & Truss", "carpenter", "Sean Docherty", "0439 902 187", "CB-U 72651", 700, "CGU", "PL-9931126", 520, "Frame $34/m2 supply & erect", 4),
        trade("Grampians Plumbing Services", "plumber", "Priya Nair", "0432 774 590", "VBA 51877", 365, "QBE", "PL-6612094", 290, "$95/hr + materials", 3),
    ]
    await db.trades.insert_many([dict(t) for t in trades])
    await db.projects.update_one({"id": pid}, {"$set": {"trade_ids": [t["id"] for t in trades]}})

    # Link seeded roadmap tasks (previously free-text trades) to trade entities
    name_to_id = {t["business_name"]: t["id"] for t in trades}
    for name, tid in name_to_id.items():
        await db.tasks.update_many({"project_id": pid, "assigned_trade": name}, {"$set": {"trade_id": tid}})

    # Quotes: two work packages
    def quote(work_package, trade_name, ex, quote_days, expiry_days, scope, exclusions, status):
        gst = round(ex * 0.1, 2)
        return {
            "id": str(uuid.uuid4()), "is_seed": True, "project_id": pid, "work_package": work_package,
            "trade_id": name_to_id[trade_name], "stage_key": "lockup",
            "amount_ex_gst": ex, "gst_amount": gst, "total_inc_gst": round(ex + gst, 2),
            "quote_date": d(quote_days), "expiry_date": d(expiry_days),
            "scope_description": scope, "exclusions": exclusions, "status": status,
            "attachment": None, "created_at": now_iso(), "updated_at": now_iso(),
        }

    q_elec_accepted = quote("Electrical rough-in + fit-off", "Ballarat Electrical Co", 28400, -20, 40,
                            "Full electrical rough-in and fit-off per plans E01-E04: 42 GPOs, 28 LED downlights, switchboard, smoke alarms.",
                            "Excludes NBN conduit and garden lighting.", "accepted")
    quotes = [
        q_elec_accepted,
        quote("Electrical rough-in + fit-off", "Western Vic Electrical", 31900, -18, 30,
              "Electrical rough-in and fit-off per plans. Standard fittings allowance $2,200.",
              "Excludes switchboard upgrade and smoke alarm interconnection.", "rejected"),
        quote("Plumbing rough-in + fit-off", "JT Plumbing & Gas", 24750, -6, 25,
              "Water, gas and sanitary rough-in plus fixture fit-off. Includes 5-star tapware allowance.",
              "Excludes stormwater connection to legal point of discharge.", "pending"),
        quote("Plumbing rough-in + fit-off", "Grampians Plumbing Services", 23200, -4, 35,
              "Plumbing rough-in and fit-off per hydraulic drawings. Standard PC items.",
              "Excludes gas meter application fees and tapware supply.", "pending"),
    ]
    await db.quotes.insert_many([dict(q) for q in quotes])

    # Invoices: one paid, one unpaid within terms, one overdue part-paid (linked to accepted quote)
    def invoice(number, trade_name, quote_id, desc, ex, inv_days, due_days, payments):
        gst = round(ex * 0.1, 2)
        total = round(ex + gst, 2)
        paid = round(sum(p["amount"] for p in payments), 2)
        status = "paid" if paid >= total else ("part-paid" if paid > 0 else "unpaid")
        return {
            "id": str(uuid.uuid4()), "is_seed": True, "project_id": pid, "invoice_number": number,
            "trade_id": name_to_id[trade_name], "quote_id": quote_id, "description": desc,
            "amount_ex_gst": ex, "gst_amount": gst, "total_inc_gst": total,
            "invoice_date": d(inv_days), "due_date": d(due_days), "payments": payments, "status": status,
            "created_at": now_iso(), "updated_at": now_iso(),
        }

    invoices = [
        invoice("INV-1042", "ABC Concreting", None, "Slab pour including pump hire", 18600, -30, -16,
                [{"id": str(uuid.uuid4()), "amount": 20460.0, "date": d(-20), "note": "EFT"}]),
        invoice("INV-2210", "Ballarat Frame & Truss", None, "Frame supply & erect — progress claim 1", 22000, -3, 14, []),
        invoice("INV-0871", "Ballarat Electrical Co", q_elec_accepted["id"], "Electrical rough-in — 60% complete", 17000, -24, -10,
                [{"id": str(uuid.uuid4()), "amount": 10000.0, "date": d(-12), "note": "Part payment"}]),
    ]
    await db.invoices.insert_many([dict(i) for i in invoices])

    # Progress claims schedule: Deposit + Base paid, Frame claimed
    from claims import build_schedule
    lines = build_schedule(pid, project.get("contract_value", 0))
    seed_status = {
        "Deposit": ("paid", d(-140), d(-133)),
        "Base": ("paid", d(-60), d(-49)),
        "Frame": ("claimed", d(-4), None),
    }
    for line in lines:
        line["is_seed"] = True
        if line["stage_label"] in seed_status:
            status, claimed, paid = seed_status[line["stage_label"]]
            line["status"] = status
            line["claimed_date"] = claimed
            line["paid_date"] = paid
    await db.claims.insert_many([dict(l) for l in lines])


async def seed_all():
    await seed_user()
    await seed_demo_project()
    await seed_trades_and_finance()
