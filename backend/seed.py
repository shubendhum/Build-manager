import os
import uuid
from datetime import datetime, timezone, timedelta
from db import db
from auth import hash_password, verify_password
from projects import generate_roadmap_tasks, now_iso

DEMO_PROJECT_NAME = "Residence – Ballarat West"


async def seed_user():
    email = os.environ.get("ADMIN_EMAIL", "pm@rldtech.com.au").lower()
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


async def seed_estimates_and_dashboard():
    """Phase 3 seed: estimate lines + contingency + inspection due dates for demo project. Idempotent."""
    if await db.estimate_lines.find_one({"is_seed": True}):
        return
    project = await db.projects.find_one({"name": DEMO_PROJECT_NAME, "is_seed": True})
    if not project:
        return
    pid = project["id"]
    today = datetime.now(timezone.utc).date()

    def d(days):
        return (today + timedelta(days=days)).isoformat()

    rates = await db.rates.find({}, {"_id": 0, "id": 1, "work_item": 1}).to_list(500)
    rid = {r["work_item"]: r["id"] for r in rates}

    # (description, stage_key, rate_work_item, quantity, unit, rate)
    line_specs = [
        ("Concrete slab 180 m²", "base", "Concreting — slab", 180, "m²", 115),
        ("Timber frame complete 195 m²", "frame", "Timber frame — complete", 195, "m²", 1480),
        ("Electrical points (85)", "lockup", "Electrical", 85, "point", 90),
        ("Roofing — Colorbond 210 m²", "lockup", "Roofing — metal/tile", 210, "m²", 95),
        ("Bricklaying 14,000 bricks", "lockup", "Bricklaying", 14, "per 1,000 bricks", 1650),
        ("Plumbing fixture areas (2 bath + kitchen)", "lockup", "Plumbing — fixture area", 3, "fixture area", 1400),
        ("Tiling wet areas + kitchen", "fixing", "Tiling", 60, "m²", 130),
        ("Waterproofing wet areas", "fixing", "Waterproofing — wet areas", 25, "m²", 70),
        ("Plastering walls", "fixing", "Plastering — walls", 480, "m²", 28),
        ("Painting internal walls", "fixing", "Painting — walls", 520, "m²", 32),
    ]
    lines = []
    for idx, (desc, stage, work_item, qty, unit, rate) in enumerate(line_specs):
        lines.append({
            "id": str(uuid.uuid4()), "is_seed": True, "project_id": pid,
            "description": desc, "stage_key": stage, "rate_item_id": rid.get(work_item),
            "quantity": qty, "unit": unit, "rate": rate, "gst_applicable": True,
            "sort_order": idx * 10, "created_at": now_iso(), "updated_at": now_iso(),
        })
    await db.estimate_lines.insert_many([dict(l) for l in lines])
    await db.projects.update_one({"id": pid}, {"$set": {"contingency_pct": 12.5}})

    # Inspection due dates for dashboard reminders: frame inspection due soon, waterproofing overdue
    await db.tasks.update_one(
        {"project_id": pid, "stage_key": "frame", "is_mandatory_inspection": True},
        {"$set": {"due_date": d(5), "updated_at": now_iso()}})
    await db.tasks.update_one(
        {"project_id": pid, "stage_key": "fixing", "is_mandatory_inspection": True},
        {"$set": {"due_date": d(-3), "updated_at": now_iso()}})


# ---------------------------------------------------------------------------
# PRECOMPUTED SEED ANALYSES — the analysis text below was written by hand so
# that seeding is fast, free and idempotent (no LLM call at startup). Each
# record mimics the exact schema produced by run_ai_analysis() in server.py.
# Every NEW photo uploaded through POST /api/photos/analyze ALWAYS goes
# through the real vision model — nothing at runtime is mocked.
# ---------------------------------------------------------------------------
SEED_PHOTO_SPECS = [
    {
        "asset": "site_preparation.jpg",
        "days_ago": 78,
        "stage_hint": "site-preparation",
        "analysis": {
            "identified_stage": "site-preparation",
            "progress_notes": (
                "Site establishment underway at the Wattle Grove Court block. The building envelope has been "
                "cleared and stripped of topsoil, with the excavator completing the bulk cut for the slab platform. "
                "Temporary site access is in place and the block is draining well with no standing water."
            ),
            "observations": [
                "Tracked excavator on site completing cut-and-fill works",
                "Topsoil stripped and stockpiled at the rear of the block",
                "Building platform levelled and compacted, ready for set-out",
                "Clear machine access maintained along the frontage",
            ],
            "potential_issues": [],
            "confidence": "high",
        },
    },
    {
        "asset": "slab_pour.jpg",
        "days_ago": 55,
        "stage_hint": "base/slab",
        "analysis": {
            "identified_stage": "base/slab",
            "progress_notes": (
                "Concrete pour in progress for the slab. Steel reinforcement and edge formwork are correctly "
                "positioned, and the crew is screeding and hand-trowelling the surface as the pour advances. "
                "Plumbing penetrations are sleeved and appear to align with the hydraulic layout."
            ),
            "observations": [
                "Concrete placement and hand trowelling in progress",
                "Reinforcement mesh visible with correct cover in placed sections",
                "Edge formwork straight and well braced",
                "PVC plumbing penetrations sleeved through the slab zone",
            ],
            "potential_issues": [
                "Exposed reinforcement bar ends near the edge beam are not capped — fit rebar caps to remove the impalement hazard",
            ],
            "confidence": "high",
        },
    },
    {
        "asset": "frame_carpentry.jpg",
        "days_ago": 18,
        "stage_hint": "frame",
        "analysis": {
            "identified_stage": "frame",
            "progress_notes": (
                "Frame carpentry progressing with door and window head trimming underway. Dressed timber components "
                "are being planed and fitted at the saw stools, and joinery cuts are clean with tight tolerances. "
                "The work area is orderly with hand and power tools in good condition."
            ),
            "observations": [
                "Dressed timber sections planed and fitted on saw stools",
                "Clean, square joinery cuts indicating good workmanship",
                "Cordless drill and hand plane in use — tooling in good order",
            ],
            "potential_issues": [],
            "confidence": "medium",
        },
    },
    {
        "asset": "frame_complete.jpg",
        "days_ago": 4,
        "stage_hint": "frame",
        "analysis": {
            "identified_stage": "frame",
            "progress_notes": (
                "Wall and roof framing is structurally complete with bracing panels fixed and roof sarking installed "
                "ahead of the roof covering. Gable and hip framing lines read straight and true. The frame is ready "
                "for the mandatory frame inspection before lockup trades commence."
            ),
            "observations": [
                "Structural bracing panels fixed to external wall frames",
                "Roof sarking installed over hip and gable roof framing",
                "Framing timber stacked on level dunnage beside the dwelling",
                "Window and door openings framed square",
            ],
            "potential_issues": [
                "Spoil and offcuts heaped close to the site access path — clear to maintain safe access",
                "No edge protection visible at roof level — install before roof covering works begin",
            ],
            "confidence": "high",
        },
    },
]

SEED_ASSETS_DIR = os.path.join(os.path.dirname(__file__), "seed_assets")
UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "uploads")


async def seed_photos():
    """Phase 4 seed: demo progress photos with PRECOMPUTED analyses (see note above). Idempotent."""
    if await db.photo_analyses.find_one({"is_seed": True}):
        return
    project = await db.projects.find_one({"name": DEMO_PROJECT_NAME, "is_seed": True})
    if not project:
        return
    import shutil
    now = datetime.now(timezone.utc)
    for spec in SEED_PHOTO_SPECS:
        src = os.path.join(SEED_ASSETS_DIR, spec["asset"])
        if not os.path.exists(src):
            continue
        photo_id = str(uuid.uuid4())
        dest = os.path.join(UPLOADS_DIR, f"{photo_id}.jpg")
        shutil.copyfile(src, dest)
        created = (now - timedelta(days=spec["days_ago"], hours=3)).isoformat()
        await db.photo_analyses.insert_one({
            "id": photo_id,
            "is_seed": True,
            "filename": spec["asset"],
            "project_id": project["id"],
            "stage_hint": spec["stage_hint"],
            "notes": None,
            "analysis": dict(spec["analysis"]),
            "image_url": f"/api/photos/{photo_id}/image",
            "created_at": created,
            "file_path": dest,
            "media_type": "image/jpeg",
        })


def _write_seed_pdf(path, title, lines):
    """Generate a small but real PDF for a seed document using reportlab."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as pdfcanvas
    c = pdfcanvas.Canvas(path, pagesize=A4)
    w, h = A4
    c.setFillColorRGB(0.12, 0.16, 0.23)
    c.rect(0, h - 30 * mm, w, 30 * mm, fill=1, stroke=0)
    c.setFillColorRGB(0.96, 0.62, 0.04)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(20 * mm, h - 18 * mm, title)
    c.setFillColorRGB(0.86, 0.89, 0.94)
    c.setFont("Helvetica", 9)
    c.drawString(20 * mm, h - 25 * mm, "Hartley Constructions Pty Ltd — Registered Building Practitioner DB-U 45821")
    c.setFillColorRGB(0.2, 0.25, 0.33)
    y = h - 45 * mm
    for line in lines:
        if line.startswith("** "):
            c.setFont("Helvetica-Bold", 10)
            line = line[3:]
        else:
            c.setFont("Helvetica", 10)
        c.drawString(20 * mm, y, line)
        y -= 6.5 * mm
    c.setFont("Helvetica-Oblique", 8)
    c.setFillColorRGB(0.45, 0.5, 0.58)
    c.drawString(20 * mm, 15 * mm, "Sample document generated for demonstration — BuildManager VIC")
    c.save()


async def seed_documents():
    """Phase 4 seed: three real PDF documents for the demo project. Idempotent."""
    if await db.documents.find_one({"is_seed": True}):
        return
    project = await db.projects.find_one({"name": DEMO_PROJECT_NAME, "is_seed": True})
    if not project:
        return
    docs_dir = os.path.join(UPLOADS_DIR, "documents")
    os.makedirs(docs_dir, exist_ok=True)
    now = datetime.now(timezone.utc)
    address = "14 Wattle Grove Court, Ballarat West VIC 3350"

    specs = [
        {
            "title": "Working Drawings — Rev C",
            "category": "drawings",
            "filename": "wattle-grove-working-drawings-revC.pdf",
            "notes": "Issued for construction 09/2025.",
            "days_ago": 140,
            "pdf_title": "WORKING DRAWINGS — REV C",
            "lines": [
                f"Project: {DEMO_PROJECT_NAME}", f"Site: {address}", "Client: Sarah & Tom Mitchell", "",
                "** Drawing register", "A01  Site plan & setbacks            1:200", "A02  Floor plan                      1:100",
                "A03  Elevations (N/S/E/W)            1:100", "A04  Sections & construction details 1:50",
                "A05  Window & door schedule", "E01  Electrical layout               1:100",
                "H01  Hydraulic layout                1:100", "", "Issued for construction — September 2025.",
            ],
        },
        {
            "title": "Building Permit BP-2025-04471",
            "category": "permits",
            "filename": "building-permit-BP-2025-04471.pdf",
            "notes": "Issued by the relevant building surveyor.",
            "days_ago": 132,
            "pdf_title": "BUILDING PERMIT — BP-2025-04471",
            "lines": [
                "** Permit details",
                f"Property: {address}", "Description: Construction of a single-storey dwelling (4BR)",
                "Building classification: Class 1a", "Cost of works: $620,000.00",
                "Builder: Hartley Constructions Pty Ltd (DB-U 45821)", "",
                "** Relevant Building Surveyor", "P. Whitfield — RBS-U 1204, Ballarat Building Surveyors Pty Ltd", "",
                "** Mandatory notification stages", "1. Prior to placing footings / slab (Base)",
                "2. Completion of framework (Frame)", "3. Waterproofing of wet areas (Fixing)",
                "4. Final — on completion of all building work",
            ],
        },
        {
            "title": "Domestic Building Insurance Certificate",
            "category": "insurance",
            "filename": "dbi-certificate-HIA-DBI-2025-88431.pdf",
            "notes": "Policy HIA-DBI-2025-88431, expires 30/06/2027.",
            "days_ago": 138,
            "pdf_title": "DOMESTIC BUILDING INSURANCE CERTIFICATE",
            "lines": [
                "** Certificate of insurance",
                "Policy number: HIA-DBI-2025-88431", "Builder: Hartley Constructions Pty Ltd (DB-U 45821)",
                f"Insured works: New single-storey dwelling at {address}",
                "Building owner: Sarah & Tom Mitchell", "Contract value: $620,000.00",
                "Policy expiry: 30/06/2027", "",
                "This policy provides cover as required under the Building Act 1993 (Vic)",
                "for non-completion and defective works, subject to policy terms.",
            ],
        },
    ]
    for spec in specs:
        doc_id = str(uuid.uuid4())
        path = os.path.join(docs_dir, f"{doc_id}.pdf")
        _write_seed_pdf(path, spec["pdf_title"], spec["lines"])
        await db.documents.insert_one({
            "id": doc_id,
            "is_seed": True,
            "project_id": project["id"],
            "title": spec["title"],
            "category": spec["category"],
            "notes": spec["notes"],
            "filename": spec["filename"],
            "file_size": os.path.getsize(path),
            "media_type": "application/pdf",
            "uploaded_at": (now - timedelta(days=spec["days_ago"])).isoformat(),
            "file_path": path,
        })


async def seed_all():
    await seed_user()
    await seed_demo_project()
    await seed_trades_and_finance()
    await seed_estimates_and_dashboard()
    await seed_photos()
    await seed_documents()
