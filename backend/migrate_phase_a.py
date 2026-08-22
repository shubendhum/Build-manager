"""Phase A migration — work packages and RFQ invitations.

Idempotent. Safe to run repeatedly; a second run reports 0 changes.

  1. Creates a work_packages record for every distinct (project_id, work_package)
     string found on existing quotes, and stamps package_id onto those quotes.
  2. Reshapes pre-Phase-A RFQs: the top-level trade_id/token/status move into an
     `invitations` array of one, and the RFQ-level status collapses to open/closed.

Run inside the backend container:
    docker exec buildmanager-backend python /app/backend/migrate_phase_a.py
"""
import asyncio
import uuid
from datetime import datetime, timezone

from db import db


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def backfill_packages() -> dict:
    """One package per distinct work_package string per project."""
    created = linked = 0
    quotes = await db.quotes.find({}, {"_id": 0}).to_list(10000)
    unlinked = [q for q in quotes if not q.get("package_id")]

    # Reuse a package that already carries this title, so a partial previous run
    # doesn't produce duplicates.
    existing = await db.work_packages.find({}, {"_id": 0, "id": 1, "project_id": 1, "title": 1}).to_list(10000)
    by_title = {(p["project_id"], p["title"]): p["id"] for p in existing}

    groups: dict = {}
    for q in unlinked:
        title = (q.get("work_package") or "Unassigned").strip() or "Unassigned"
        groups.setdefault((q["project_id"], title), []).append(q)

    for (project_id, title), group in groups.items():
        package_id = by_title.get((project_id, title))
        if not package_id:
            first = group[0]
            accepted = next((q for q in group if q.get("status") == "accepted"), None)
            package_id = str(uuid.uuid4())
            last = await db.work_packages.find({"project_id": project_id}).sort("sort_order", -1).to_list(1)
            await db.work_packages.insert_one({
                "id": package_id,
                "project_id": project_id,
                "title": title,
                "trade_type": "other",
                "stage_key": first.get("stage_key") or "lockup",
                "scope": first.get("scope_description") or "",
                "status": "awarded" if accepted else "quotes-in",
                "awarded_quote_id": accepted["id"] if accepted else None,
                "awarded_trade_id": accepted.get("trade_id") if accepted else None,
                "source": "migrated",
                "plan_id": None,
                "sort_order": (last[0]["sort_order"] + 10) if last else 0,
                "created_by": None,
                "created_at": now_iso(),
                "updated_at": now_iso(),
            })
            by_title[(project_id, title)] = package_id
            created += 1

        result = await db.quotes.update_many(
            {"id": {"$in": [q["id"] for q in group]}},
            {"$set": {"package_id": package_id, "updated_at": now_iso()}},
        )
        linked += result.modified_count

    return {"packages_created": created, "quotes_linked": linked}


async def reshape_rfqs() -> dict:
    """Old shape: trade_id + token + status at the top level."""
    legacy = await db.rfqs.find({"invitations": {"$exists": False}}, {"_id": 0}).to_list(10000)
    converted = 0

    for rfq in legacy:
        old_status = rfq.get("status", "sent")
        invitation = {
            "id": str(uuid.uuid4()),
            "trade_id": rfq.get("trade_id"),
            "token": rfq.get("token"),
            "status": "submitted" if old_status == "submitted" else "sent",
            "sent_at": rfq.get("created_at"),
            "first_viewed_at": None,
            "downloaded_at": None,
            "submitted_at": rfq.get("updated_at") if old_status == "submitted" else None,
            "quote_id": rfq.get("submitted_quote_id"),
            "channels": [],
            "last_error": None,
        }
        # The old scope's first line was used as the work_package title, so match
        # the package the quote backfill created from that same string.
        title = (rfq.get("scope") or "").strip().splitlines()[0][:60] if rfq.get("scope") else ""
        package = await db.work_packages.find_one(
            {"project_id": rfq["project_id"], "title": title}, {"_id": 0, "id": 1}
        ) if title else None

        await db.rfqs.update_one(
            {"id": rfq["id"]},
            {"$set": {
                "invitations": [invitation],
                "package_id": package["id"] if package else None,
                "document_ids": [],
                "status": "closed" if old_status == "closed" else "open",
                "updated_at": now_iso(),
            },
             "$unset": {"trade_id": "", "token": "", "submitted_quote_id": ""}},
        )
        converted += 1

    return {"rfqs_converted": converted}


async def main():
    print("Phase A migration")
    print("-" * 40)
    pkg = await backfill_packages()
    print(f"  work packages created : {pkg['packages_created']}")
    print(f"  quotes linked         : {pkg['quotes_linked']}")
    rfq = await reshape_rfqs()
    print(f"  RFQs converted        : {rfq['rfqs_converted']}")
    print("-" * 40)
    total = pkg["packages_created"] + pkg["quotes_linked"] + rfq["rfqs_converted"]
    print("No changes needed — already migrated." if total == 0 else "Migration complete.")


if __name__ == "__main__":
    asyncio.run(main())
