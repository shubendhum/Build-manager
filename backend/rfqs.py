"""Requests for quote — one scope, many trades.

An RFQ belongs to a work package and carries an `invitations` array: one entry
per invited trade, each with its own token, status and timestamps. That is what
lets the same scope go to three plumbers and be compared, and what stops the
first responder from closing the request for everyone else.

Drawings ride along via `document_ids`, served to the trade through a
token-scoped public route so they never need a login.

Collections: rfqs, notifications (send log, written by notify.py)
"""
import uuid
import secrets
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel

from db import db
from auth import get_current_user
from roadmap_template import STAGE_KEYS
import notify

rfqs_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])
public_rfqs_router = APIRouter(prefix="/api/public")  # NO auth — trade-facing portal

RFQ_STATUSES = {"open", "closed"}
INVITATION_STATUSES = {"pending", "sent", "viewed", "submitted", "declined", "failed"}
CHANNELS = {"email", "sms"}

ATTACH_TYPES = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_ATTACH_BYTES = 10 * 1024 * 1024
QUOTE_UPLOAD_DIR = Path(__file__).parent / "uploads" / "quotes"
QUOTE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def format_date(iso: Optional[str]) -> str:
    """dd/mm/yyyy — matches the formatting used everywhere else in the app."""
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%d/%m/%Y")
    except ValueError:
        return iso


class RfqInput(BaseModel):
    package_id: str
    trade_ids: List[str] = []
    scope: str = ""
    stage_key: Optional[str] = None
    due_date: Optional[str] = None
    document_ids: List[str] = []


class InviteInput(BaseModel):
    trade_ids: List[str]


class SendInput(BaseModel):
    channels: List[str] = ["email"]
    invitation_ids: Optional[List[str]] = None


# ---------- helpers ----------

async def hydrate_rfqs(rfqs: list) -> list:
    """Attach trade details to every invitation, and the package title."""
    trade_ids = {i["trade_id"] for r in rfqs for i in r.get("invitations", []) if i.get("trade_id")}
    package_ids = {r["package_id"] for r in rfqs if r.get("package_id")}
    trades = await db.trades.find(
        {"id": {"$in": list(trade_ids)}},
        {"_id": 0, "id": 1, "business_name": 1, "contact_person": 1, "email": 1, "phone": 1},
    ).to_list(500)
    packages = await db.work_packages.find({"id": {"$in": list(package_ids)}}, {"_id": 0, "id": 1, "title": 1}).to_list(500)
    tmap = {t["id"]: t for t in trades}
    pmap = {p["id"]: p["title"] for p in packages}

    for r in rfqs:
        r["package_title"] = pmap.get(r.get("package_id"))
        for inv in r.get("invitations", []):
            trade = tmap.get(inv.get("trade_id"), {})
            inv["trade_name"] = trade.get("business_name")
            inv["trade_email"] = trade.get("email")
            inv["trade_phone"] = trade.get("phone")
        r["invited_count"] = len(r.get("invitations", []))
        r["submitted_count"] = sum(1 for i in r.get("invitations", []) if i.get("status") == "submitted")
    return rfqs


async def load_documents(project_id: str, document_ids: List[str]) -> list:
    """Validate that every requested document belongs to this project."""
    if not document_ids:
        return []
    docs = await db.documents.find(
        {"id": {"$in": document_ids}, "project_id": project_id},
        {"_id": 0, "file_path": 0},
    ).to_list(100)
    missing = set(document_ids) - {d["id"] for d in docs}
    if missing:
        raise HTTPException(status_code=404, detail="One or more selected documents were not found on this project.")
    return docs


def new_invitation(trade_id: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "trade_id": trade_id,
        # One token per trade — a shared link would lose attribution, view
        # tracking, and the ability to close one trade out without the rest.
        "token": secrets.token_urlsafe(24),
        "status": "pending",
        "sent_at": None,
        "gmail_thread_id": None,
        "gmail_message_id": None,
        "first_viewed_at": None,
        "downloaded_at": None,
        "submitted_at": None,
        "quote_id": None,
        "channels": [],
        "last_error": None,
    }


# ---------- builder-side routes ----------

@rfqs_router.post("/projects/{project_id}/rfqs")
async def create_rfq(project_id: str, data: RfqInput):
    project = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    package = await db.work_packages.find_one({"id": data.package_id, "project_id": project_id}, {"_id": 0})
    if not package:
        raise HTTPException(status_code=404, detail="Work package not found.")
    if not data.trade_ids:
        raise HTTPException(status_code=400, detail="Select at least one trade to request a quote from.")

    scope = (data.scope or package.get("scope") or "").strip()
    if not scope:
        raise HTTPException(status_code=400, detail="Scope of works is required.")
    stage_key = data.stage_key or package.get("stage_key") or "lockup"
    if stage_key not in STAGE_KEYS:
        raise HTTPException(status_code=400, detail=f"stage_key must be one of: {sorted(STAGE_KEYS)}")

    unique_trade_ids = list(dict.fromkeys(data.trade_ids))
    found = await db.trades.find({"id": {"$in": unique_trade_ids}}, {"_id": 0, "id": 1}).to_list(500)
    if len(found) != len(unique_trade_ids):
        raise HTTPException(status_code=404, detail="One or more selected trades were not found.")
    await load_documents(project_id, data.document_ids)

    rfq = {
        "id": str(uuid.uuid4()),
        "project_id": project_id,
        "package_id": data.package_id,
        # Snapshot the scope so later package edits don't rewrite what was sent.
        "scope": scope,
        "stage_key": stage_key,
        "due_date": data.due_date or None,
        "document_ids": list(data.document_ids),
        "status": "open",
        "invitations": [new_invitation(tid) for tid in unique_trade_ids],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.rfqs.insert_one(dict(rfq))
    rfq.pop("_id", None)
    await db.work_packages.update_one(
        {"id": data.package_id, "status": "draft"},
        {"$set": {"status": "out-for-quote", "updated_at": now_iso()}},
    )
    return (await hydrate_rfqs([rfq]))[0]


@rfqs_router.get("/projects/{project_id}/rfqs")
async def list_rfqs(project_id: str):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    rfqs = await db.rfqs.find({"project_id": project_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return await hydrate_rfqs(rfqs)


@rfqs_router.post("/rfqs/{rfq_id}/invitations")
async def add_invitations(rfq_id: str, data: InviteInput):
    rfq = await db.rfqs.find_one({"id": rfq_id}, {"_id": 0})
    if not rfq:
        raise HTTPException(status_code=404, detail="Quote request not found.")
    if rfq["status"] == "closed":
        raise HTTPException(status_code=409, detail="This quote request is closed.")
    existing = {i["trade_id"] for i in rfq["invitations"]}
    to_add = [t for t in dict.fromkeys(data.trade_ids) if t not in existing]
    if not to_add:
        raise HTTPException(status_code=400, detail="Those trades have already been invited.")
    found = await db.trades.find({"id": {"$in": to_add}}, {"_id": 0, "id": 1}).to_list(500)
    if len(found) != len(to_add):
        raise HTTPException(status_code=404, detail="One or more selected trades were not found.")

    invitations = [new_invitation(tid) for tid in to_add]
    await db.rfqs.update_one(
        {"id": rfq_id},
        {"$push": {"invitations": {"$each": invitations}}, "$set": {"updated_at": now_iso()}},
    )
    rfq = await db.rfqs.find_one({"id": rfq_id}, {"_id": 0})
    return (await hydrate_rfqs([rfq]))[0]


@rfqs_router.delete("/rfqs/{rfq_id}/invitations/{invitation_id}")
async def remove_invitation(rfq_id: str, invitation_id: str):
    rfq = await db.rfqs.find_one({"id": rfq_id}, {"_id": 0})
    if not rfq:
        raise HTTPException(status_code=404, detail="Quote request not found.")
    inv = next((i for i in rfq["invitations"] if i["id"] == invitation_id), None)
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found.")
    if inv["status"] == "submitted":
        raise HTTPException(status_code=409, detail="This trade has already submitted a quote — delete the quote instead.")
    await db.rfqs.update_one(
        {"id": rfq_id},
        {"$pull": {"invitations": {"id": invitation_id}}, "$set": {"updated_at": now_iso()}},
    )
    rfq = await db.rfqs.find_one({"id": rfq_id}, {"_id": 0})
    return (await hydrate_rfqs([rfq]))[0]


@rfqs_router.post("/rfqs/{rfq_id}/send")
async def send_rfq(rfq_id: str, data: SendInput):
    """Deliver the request to invited trades.

    Partial failure is normal and expected: one trade with no email must not
    stop the other two from going out, so this always returns 200 with a
    per-invitation result list.
    """
    rfq = await db.rfqs.find_one({"id": rfq_id}, {"_id": 0})
    if not rfq:
        raise HTTPException(status_code=404, detail="Quote request not found.")
    if rfq["status"] == "closed":
        raise HTTPException(status_code=409, detail="This quote request is closed.")

    channels = [c for c in dict.fromkeys(data.channels) if c in CHANNELS]
    if not channels:
        raise HTTPException(status_code=400, detail=f"Select at least one channel: {sorted(CHANNELS)}")

    base_url = notify.public_base_url()
    if not base_url:
        raise HTTPException(
            status_code=400,
            detail="PUBLIC_BASE_URL is not configured on the server, so quote links cannot be built. "
                   "Set it in backend/.env and restart.",
        )

    targets = [i for i in rfq["invitations"]
               if data.invitation_ids is None or i["id"] in data.invitation_ids]
    if data.invitation_ids is None:
        targets = [i for i in targets if i["status"] in {"pending", "failed"}]
    if not targets:
        raise HTTPException(status_code=400, detail="No invitations to send. They may all have been sent already.")
    if len(targets) > notify.max_per_send():
        raise HTTPException(
            status_code=400,
            detail=f"Refusing to send to {len(targets)} recipients in one go (limit {notify.max_per_send()}).",
        )

    project = await db.projects.find_one({"id": rfq["project_id"]}, {"_id": 0}) or {}
    package = await db.work_packages.find_one({"id": rfq["package_id"]}, {"_id": 0}) or {}
    documents = await load_documents(rfq["project_id"], rfq.get("document_ids", []))
    trades = await db.trades.find(
        {"id": {"$in": [i["trade_id"] for i in targets]}},
        {"_id": 0, "id": 1, "business_name": 1, "contact_person": 1, "email": 1, "phone": 1},
    ).to_list(500)
    tmap = {t["id"]: t for t in trades}

    suburb_line = f"{project.get('site_suburb', '')} VIC {project.get('site_postcode', '')}".strip()
    site_address = ", ".join(p for p in [project.get("site_street") or "", suburb_line] if p.strip())

    # The drawings travel WITH the request as real attachments — a trade should
    # not have to go and fetch anything to price a job. Read once, reuse for
    # every recipient. Anything that would push the message over Gmail's limit
    # is left off and named, rather than silently dropped.
    attachments, skipped, total = [], [], 0
    for doc in documents:
        record = await db.documents.find_one({"id": doc["id"]}, {"_id": 0, "file_path": 1})
        path = Path((record or {}).get("file_path", ""))
        if not path.exists():
            skipped.append(f"{doc['filename']} (missing on disk)")
            continue
        raw = path.read_bytes()
        if total + len(raw) > notify.MAX_ATTACHMENT_BYTES:
            skipped.append(f"{doc['filename']} (too large to attach)")
            continue
        total += len(raw)
        attachments.append({"filename": doc["filename"], "content": raw,
                           "media_type": doc.get("media_type") or "application/octet-stream"})
    attached_docs = [d for d in documents
                     if any(a["filename"] == d["filename"] for a in attachments)]

    results = []
    for inv in targets:
        trade = tmap.get(inv["trade_id"], {})
        context = {
            "builder_name": project.get("builder_name") or "The builder",
            "project_name": project.get("name") or "",
            "site_address": site_address,
            "trade_name": trade.get("business_name") or "",
            "contact_person": trade.get("contact_person") or "",
            "package_title": package.get("title") or rfq["scope"].splitlines()[0][:60],
            "scope": rfq["scope"],
            "due_date": format_date(rfq.get("due_date")),
            "documents": attached_docs,
            "portal_url": f"{base_url}/quote/{inv['token']}",
        }
        rendered = notify.render_rfq(context)

        sent_channels, errors = [], []
        email_result = None
        for channel in channels:
            to = trade.get("email", "") if channel == "email" else trade.get("phone", "")
            body = rendered["text"] if channel == "email" else rendered["sms"]
            subject = rendered["subject"] if channel == "email" else ""
            note_id = await notify.record_notification(
                project_id=rfq["project_id"], rfq_id=rfq_id, invitation_id=inv["id"],
                trade_id=inv["trade_id"], channel=channel, to=to, subject=subject, body=body,
            )
            if channel == "email":
                result = await notify.send_email(to, rendered["subject"], rendered["html"],
                                                 rendered["text"], attachments=attachments)
                email_result = result
            else:
                result = await notify.send_sms(to, rendered["sms"])
            await notify.settle_notification(note_id, result)
            if result.ok:
                sent_channels.append(channel)
            else:
                errors.append(f"{channel}: {result.error}")

        ok = bool(sent_channels)
        updates = {
            "invitations.$.status": "sent" if ok else "failed",
            "invitations.$.sent_at": now_iso() if ok else inv.get("sent_at"),
            "invitations.$.channels": sent_channels,
            "invitations.$.last_error": None if ok else "; ".join(errors),
            "updated_at": now_iso(),
        }
        # Keep the Gmail thread so a reply can be matched back to this trade.
        if email_result and email_result.thread_id:
            updates["invitations.$.gmail_thread_id"] = email_result.thread_id
            updates["invitations.$.gmail_message_id"] = email_result.provider_message_id
        await db.rfqs.update_one({"id": rfq_id, "invitations.id": inv["id"]}, {"$set": updates})
        results.append({
            "invitation_id": inv["id"],
            "trade_id": inv["trade_id"],
            "trade_name": trade.get("business_name"),
            "ok": ok,
            "channels": sent_channels,
            "error": None if ok else "; ".join(errors),
        })

    if any(r["ok"] for r in results):
        await db.work_packages.update_one(
            {"id": rfq["package_id"], "status": {"$in": ["draft", "out-for-quote"]}},
            {"$set": {"status": "out-for-quote", "updated_at": now_iso()}},
        )

    return {
        "sent": sum(1 for r in results if r["ok"]),
        "failed": sum(1 for r in results if not r["ok"]),
        "attached": [a["filename"] for a in attachments],
        "skipped_attachments": skipped,
        "results": results,
    }


@rfqs_router.get("/rfqs/{rfq_id}/log")
async def rfq_log(rfq_id: str):
    if not await db.rfqs.find_one({"id": rfq_id}):
        raise HTTPException(status_code=404, detail="Quote request not found.")
    return await db.notifications.find({"rfq_id": rfq_id}, {"_id": 0}).sort("created_at", -1).to_list(500)


@rfqs_router.post("/rfqs/{rfq_id}/close")
async def close_rfq(rfq_id: str):
    rfq = await db.rfqs.find_one({"id": rfq_id}, {"_id": 0})
    if not rfq:
        raise HTTPException(status_code=404, detail="Quote request not found.")
    await db.rfqs.update_one({"id": rfq_id}, {"$set": {"status": "closed", "updated_at": now_iso()}})
    rfq["status"] = "closed"
    return (await hydrate_rfqs([rfq]))[0]


# ---------- public portal routes (token auth only) ----------

async def get_invitation(token: str) -> tuple:
    rfq = await db.rfqs.find_one({"invitations.token": token}, {"_id": 0})
    if not rfq:
        raise HTTPException(status_code=404, detail="Quote request not found. Check the link you were sent.")
    if rfq["status"] == "closed":
        raise HTTPException(status_code=410, detail="This quote request has been closed by the builder.")
    invitation = next(i for i in rfq["invitations"] if i["token"] == token)
    return rfq, invitation


@public_rfqs_router.get("/rfqs/{token}")
async def public_rfq(token: str):
    rfq, invitation = await get_invitation(token)
    project = await db.projects.find_one({"id": rfq["project_id"]}, {"_id": 0}) or {}
    package = await db.work_packages.find_one({"id": rfq["package_id"]}, {"_id": 0}) or {}
    trade = await db.trades.find_one({"id": invitation["trade_id"]}, {"_id": 0, "business_name": 1}) or {}
    documents = await db.documents.find(
        {"id": {"$in": rfq.get("document_ids", [])}, "project_id": rfq["project_id"]},
        {"_id": 0, "file_path": 0},
    ).to_list(100)

    # Stamp the first view once — this is what answers "did they even open it?"
    if not invitation.get("first_viewed_at"):
        await db.rfqs.update_one(
            {"id": rfq["id"], "invitations.token": token, "invitations.first_viewed_at": None},
            {"$set": {"invitations.$.first_viewed_at": now_iso(),
                      "invitations.$.status": "viewed" if invitation["status"] in {"pending", "sent"} else invitation["status"]}},
        )

    street = project.get("site_street") or ""
    suburb_line = f"{project.get('site_suburb', '')} VIC {project.get('site_postcode', '')}".strip()
    return {
        "project_name": project.get("name"),
        "site_address": ", ".join(p for p in [street, suburb_line] if p.strip()),
        "builder_name": project.get("builder_name") or "The builder",
        "trade_name": trade.get("business_name"),
        "package_title": package.get("title"),
        "scope": rfq["scope"],
        "due_date": rfq.get("due_date"),
        "status": invitation["status"],
        "documents": documents,
    }


@public_rfqs_router.get("/rfqs/{token}/documents/{doc_id}")
async def public_rfq_document(token: str, doc_id: str):
    rfq, invitation = await get_invitation(token)
    # Authorise against the RFQ, never the document id alone — otherwise one
    # valid token could read every document on the project.
    if doc_id not in rfq.get("document_ids", []):
        raise HTTPException(status_code=404, detail="Document not found for this quote request.")
    doc = await db.documents.find_one({"id": doc_id, "project_id": rfq["project_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    file_path = Path(doc["file_path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Document file missing on disk.")
    if not invitation.get("downloaded_at"):
        await db.rfqs.update_one(
            {"id": rfq["id"], "invitations.token": token},
            {"$set": {"invitations.$.downloaded_at": now_iso()}},
        )
    return FileResponse(file_path, media_type=doc.get("media_type", "application/octet-stream"),
                        filename=doc["filename"])


@public_rfqs_router.post("/rfqs/{token}/submit")
async def public_rfq_submit(
    token: str,
    amount_ex_gst: float = Form(...),
    gst_amount: float = Form(...),
    inclusions: str = Form(""),
    exclusions: str = Form(""),
    lead_time: str = Form(""),
    contact_name: str = Form(...),
    contact_phone: str = Form(""),
    contact_email: str = Form(""),
    attachment: Optional[UploadFile] = File(None),
):
    rfq, invitation = await get_invitation(token)
    # 409 applies to THIS invitation only — the other invited trades are unaffected.
    if invitation["status"] == "submitted":
        raise HTTPException(status_code=409, detail="You have already submitted a quote for this request.")
    if amount_ex_gst < 0 or gst_amount < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative.")
    if not contact_name.strip():
        raise HTTPException(status_code=400, detail="Contact name is required.")

    quote_id = str(uuid.uuid4())
    attach_doc = None
    if attachment is not None and attachment.filename:
        if attachment.content_type not in ATTACH_TYPES:
            raise HTTPException(status_code=400, detail="Attachment must be a PDF, JPEG, PNG or WEBP file.")
        raw = await attachment.read()
        if len(raw) == 0:
            raise HTTPException(status_code=400, detail="Attached file is empty.")
        if len(raw) > MAX_ATTACH_BYTES:
            raise HTTPException(status_code=413, detail="Attachment too large. Maximum size is 10 MB.")
        ext = ATTACH_TYPES[attachment.content_type]
        file_path = QUOTE_UPLOAD_DIR / f"{quote_id}{ext}"
        file_path.write_bytes(raw)
        attach_doc = {"filename": attachment.filename or f"attachment{ext}", "file_path": str(file_path),
                      "media_type": attachment.content_type}

    package = await db.work_packages.find_one({"id": rfq["package_id"]}, {"_id": 0}) or {}
    # Group by the package record, not by parsing the scope text — two trades
    # with slightly different wording must still land in the same comparison.
    work_package = package.get("title") or rfq["scope"].strip().splitlines()[0][:60]

    quote = {
        "id": quote_id,
        "project_id": rfq["project_id"],
        "package_id": rfq.get("package_id"),
        "trade_id": invitation["trade_id"],
        "work_package": work_package,
        "stage_key": rfq.get("stage_key", "lockup"),
        "amount_ex_gst": round(float(amount_ex_gst), 2),
        "gst_amount": round(float(gst_amount), 2),
        "total_inc_gst": round(float(amount_ex_gst) + float(gst_amount), 2),
        "quote_date": datetime.now(timezone.utc).date().isoformat(),
        "expiry_date": None,
        "scope_description": inclusions.strip(),
        "exclusions": exclusions.strip(),
        "lead_time": lead_time.strip(),
        "contact_name": contact_name.strip(),
        "contact_phone": contact_phone.strip(),
        "contact_email": contact_email.strip(),
        "status": "submitted",
        "source": "portal",
        "rfq_id": rfq["id"],
        "invitation_id": invitation["id"],
        "attachment": attach_doc,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.quotes.insert_one(dict(quote))
    await db.rfqs.update_one(
        {"id": rfq["id"], "invitations.token": token},
        {"$set": {"invitations.$.status": "submitted",
                  "invitations.$.submitted_at": now_iso(),
                  "invitations.$.quote_id": quote_id,
                  "updated_at": now_iso()}},
    )
    if rfq.get("package_id"):
        await db.work_packages.update_one(
            {"id": rfq["package_id"], "status": {"$in": ["draft", "out-for-quote"]}},
            {"$set": {"status": "quotes-in", "updated_at": now_iso()}},
        )
    return {"message": "Quote submitted. The builder will be in touch.", "quote_id": quote_id}
