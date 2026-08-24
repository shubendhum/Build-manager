"""Email integration routes and inbound quote ingestion.

Sending goes out through the builder's own Gmail. When a trade replies, we match
the reply back to the exact invitation via the Gmail threadId we recorded when
sending, pull down any attached quote, and read the price off it with the local
vision model — as a DRAFT the builder confirms, never an accepted price.

Collections: integrations, gmail_messages (replies already ingested)
"""
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

import gmail
import notify
from db import db
from auth import get_current_user
from ai import vision_chat, extract_json, image_content, text_content, coerce_float
from plans import render_pages

logger = logging.getLogger(__name__)

integrations_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])
# Google redirects the browser here; it carries its own ?state instead of a cookie.
public_integrations_router = APIRouter(prefix="/api/integrations")

QUOTE_UPLOAD_DIR = Path(__file__).parent / "uploads" / "quotes"
QUOTE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

READABLE_ATTACHMENTS = {"application/pdf", "image/jpeg", "image/png", "image/webp"}

EXTRACT_PROMPT = (
    "This is a quote from a building subcontractor. Extract the commercial terms.\n"
    "Reply with ONLY a JSON object, no commentary:\n"
    '{"amount_ex_gst": number or null, "gst_amount": number or null, '
    '"total_inc_gst": number or null, "lead_time": "string or null", '
    '"inclusions": "one or two sentences or null", "exclusions": "one or two sentences or null"}\n'
    "Amounts are Australian dollars. If only one total is shown and it says it includes GST, "
    "put it in total_inc_gst and leave the others null. Never guess a number that is not there."
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- status / connect ----------

@integrations_router.get("/integrations/gmail")
async def gmail_status():
    return await gmail.public_status()


@integrations_router.get("/integrations/gmail/authorize")
async def gmail_authorize():
    if not gmail.configured():
        raise HTTPException(
            status_code=400,
            detail="Gmail is not set up on the server yet. GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET "
                   "and a redirect URI must be configured in backend/.env.",
        )
    return {"auth_url": await gmail.build_auth_url()}


@integrations_router.get("/integrations/gmail/aliases")
async def gmail_aliases():
    status = await gmail.public_status()
    if not status["connected"]:
        raise HTTPException(status_code=400, detail="Gmail is not connected.")
    return {"send_as": gmail.send_as() or status["email_address"],
            "aliases": await gmail.list_aliases()}


class TestSendInput(BaseModel):
    to: str


@integrations_router.post("/integrations/gmail/test")
async def gmail_test_send(data: TestSendInput):
    """Prove the connection end to end by sending one real message."""
    status = await gmail.public_status()
    if not status["connected"]:
        raise HTTPException(status_code=400, detail="Gmail is not connected.")
    if "@" not in data.to:
        raise HTTPException(status_code=400, detail="That doesn't look like an email address.")

    sender = gmail.send_as() or status["email_address"]
    html = (
        "<div style=\"font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#0f172a\">"
        "<p style=\"font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#b45309;"
        "font-weight:600;margin:0 0 6px\">BuildManager VIC</p>"
        "<h2 style=\"margin:0 0 12px;font-size:18px\">Email connection test</h2>"
        f"<p>This message was sent from <strong>{sender}</strong> through your connected Gmail account.</p>"
        "<p>If you reply to it, the reply lands back in your inbox as normal. Replies to a real "
        "<em>quote request</em> are additionally read into the job and turned into a draft price "
        "for you to confirm.</p>"
        "<p style=\"font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:12px\">"
        "Nothing was sent to any tradie — this went only to the address you nominated.</p></div>"
    )
    text = (
        "BuildManager VIC — email connection test\n\n"
        f"Sent from {sender} through your connected Gmail account.\n\n"
        "Replies to a real quote request are read back into the job and turned into a "
        "draft price for you to confirm.\n\n"
        "Nothing was sent to any tradie."
    )
    try:
        sent = await gmail.send_message(data.to, "BuildManager — email connection test", html, text)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return {"message": f"Test email sent to {data.to}.", "sent_from": sender, **sent}


@integrations_router.post("/integrations/gmail/disconnect")
async def gmail_disconnect():
    await gmail.disconnect()
    return {"message": "Gmail disconnected."}


@public_integrations_router.get("/gmail/callback")
async def gmail_callback(code: Optional[str] = Query(None), state: Optional[str] = Query(None),
                         error: Optional[str] = Query(None)):
    """Google sends the browser back here. Always redirect to the app rather than
    rendering JSON at the user."""
    base = notify.public_base_url() or ""
    if error:
        return RedirectResponse(f"{base}/settings?gmail=error&reason={error}")
    if not code:
        return RedirectResponse(f"{base}/settings?gmail=error&reason=no_code")
    try:
        result = await gmail.exchange_code(code, state or "")
        return RedirectResponse(f"{base}/settings?gmail=connected&address={result['email_address'] or ''}")
    except Exception as exc:  # noqa: BLE001 — must not show a stack trace in a browser
        logger.exception("Gmail OAuth callback failed")
        await gmail.save_integration(last_error=str(exc)[:300])
        return RedirectResponse(f"{base}/settings?gmail=error&reason=exchange_failed")


# ---------- inbound ----------

async def extract_quote_terms(raw: bytes, media_type: str, body_text: str) -> dict:
    """Read the commercial terms off an attached quote (or the email body)."""
    content = [text_content(EXTRACT_PROMPT)]
    try:
        if media_type == "application/pdf":
            # Reuse the planner's renderer; first two pages carry the totals.
            for page_b64 in render_pages(raw, media_type)[:2]:
                content.append(image_content(page_b64))
        elif media_type in READABLE_ATTACHMENTS:
            import base64
            content.append(image_content(base64.b64encode(raw).decode(), media_type))
    except Exception:  # noqa: BLE001 — a bad attachment must not stop ingestion
        logger.warning("Could not render the attachment; falling back to the email text.")

    if body_text.strip():
        content.append(text_content(f"The email said:\n{body_text[:2000]}"))

    try:
        reply = await vision_chat(content, max_tokens=600, timeout=120.0)
        data = extract_json(reply)
    except (RuntimeError, ValueError) as exc:
        logger.warning("Quote extraction failed: %s", exc)
        return {}
    if not isinstance(data, dict):
        return {}

    ex = coerce_float(data.get("amount_ex_gst"))
    gst = coerce_float(data.get("gst_amount"))
    total = coerce_float(data.get("total_inc_gst"))
    # Fill in whichever leg the quote left out, assuming 10% GST.
    if total is None and ex is not None:
        gst = gst if gst is not None else round(ex * 0.10, 2)
        total = round(ex + gst, 2)
    elif ex is None and total is not None:
        ex = round(total / 1.1, 2)
        gst = round(total - ex, 2)
    return {
        "amount_ex_gst": ex, "gst_amount": gst, "total_inc_gst": total,
        "lead_time": str(data.get("lead_time") or "").strip()[:120],
        "inclusions": str(data.get("inclusions") or "").strip()[:1000],
        "exclusions": str(data.get("exclusions") or "").strip()[:1000],
    }


async def ingest_reply(rfq: dict, invitation: dict, message: dict) -> Optional[dict]:
    """Turn one Gmail reply into a draft quote awaiting the builder's confirmation."""
    payload = message.get("payload", {})
    body_text = gmail.plain_body(payload)
    sender = gmail.header(payload, "From")
    subject = gmail.header(payload, "Subject")

    quote_id = str(uuid.uuid4())
    attachment_doc, terms = None, {}
    for att in gmail.attachments_in(payload):
        if att["media_type"] not in READABLE_ATTACHMENTS:
            continue
        try:
            raw = await gmail.download_attachment(message["id"], att["attachment_id"])
        except RuntimeError as exc:
            logger.warning("Attachment download failed: %s", exc)
            continue
        suffix = Path(att["filename"]).suffix or ".pdf"
        path = QUOTE_UPLOAD_DIR / f"{quote_id}{suffix}"
        path.write_bytes(raw)
        attachment_doc = {"filename": att["filename"], "file_path": str(path),
                          "media_type": att["media_type"]}
        terms = await extract_quote_terms(raw, att["media_type"], body_text)
        break   # the first readable attachment is the quote

    if not terms:
        terms = await extract_quote_terms(b"", "", body_text)

    package = await db.work_packages.find_one({"id": rfq.get("package_id")}, {"_id": 0}) or {}
    total = terms.get("total_inc_gst")

    quote = {
        "id": quote_id,
        "project_id": rfq["project_id"],
        "package_id": rfq.get("package_id"),
        "trade_id": invitation["trade_id"],
        "work_package": package.get("title") or rfq["scope"].splitlines()[0][:60],
        "stage_key": rfq.get("stage_key", "lockup"),
        "amount_ex_gst": terms.get("amount_ex_gst") or 0.0,
        "gst_amount": terms.get("gst_amount") or 0.0,
        "total_inc_gst": total or 0.0,
        "quote_date": datetime.now(timezone.utc).date().isoformat(),
        "expiry_date": None,
        "scope_description": terms.get("inclusions", ""),
        "exclusions": terms.get("exclusions", ""),
        "lead_time": terms.get("lead_time", ""),
        "contact_name": sender[:120],
        "contact_phone": "",
        "contact_email": sender[:200],
        # A quote with no number is not a price to decide on — keep it out of
        # the live set so the board does not offer to award $0.
        "status": "pending" if total else "expired",
        "source": "email",
        # The price was read by a model, so it must be confirmed before it can
        # be trusted as a commitment.
        "needs_review": True,
        "email_subject": subject[:200],
        "email_body": body_text[:4000],
        "rfq_id": rfq["id"],
        "invitation_id": invitation["id"],
        "attachment": attachment_doc,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.quotes.insert_one(dict(quote))

    # A reply with no price in it is not a quote — it is a forward, a question or
    # an acknowledgement. Record it so the builder can read it, but leave the
    # invitation open so the watcher keeps looking at that thread for a real
    # price rather than closing the door on it.
    priced = bool(total)
    await db.rfqs.update_one(
        {"id": rfq["id"], "invitations.id": invitation["id"]},
        {"$set": {
            "invitations.$.status": "submitted" if priced else invitation.get("status", "sent"),
            "invitations.$.submitted_at": now_iso() if priced else None,
            "invitations.$.quote_id": quote_id if priced else None,
            "invitations.$.last_reply_at": now_iso(),
            "updated_at": now_iso(),
        }},
    )
    if priced and rfq.get("package_id"):
        await db.work_packages.update_one(
            {"id": rfq["package_id"], "status": {"$in": ["draft", "out-for-quote"]}},
            {"$set": {"status": "quotes-in", "updated_at": now_iso()}},
        )
    return {"quote_id": quote_id, "trade_id": invitation["trade_id"],
            "total_inc_gst": total, "priced": priced,
            "had_attachment": attachment_doc is not None}


@integrations_router.post("/integrations/gmail/poll")
async def poll_replies():
    """Check every open invitation's thread for new replies.

    Threads are looked up by the id recorded at send time, so this never scans
    the mailbox and never sees mail unrelated to a quote request.
    """
    status = await gmail.public_status()
    if not status["connected"]:
        raise HTTPException(status_code=400, detail="Gmail is not connected.")

    rfqs = await db.rfqs.find(
        {"status": "open", "invitations.gmail_thread_id": {"$ne": None}}, {"_id": 0}
    ).to_list(500)

    ingested, errors = [], []
    for rfq in rfqs:
        for inv in rfq.get("invitations", []):
            thread_id = inv.get("gmail_thread_id")
            if not thread_id or inv.get("status") in {"submitted", "declined"}:
                continue
            try:
                thread = await gmail.get_thread(thread_id)
            except RuntimeError as exc:
                errors.append(str(exc))
                continue
            for message in thread.get("messages", []):
                if message.get("id") == inv.get("gmail_message_id"):
                    continue    # our own outgoing message
                if await db.gmail_messages.find_one({"id": message["id"]}, {"_id": 1}):
                    continue    # already ingested
                await db.gmail_messages.insert_one(
                    {"id": message["id"], "thread_id": thread_id, "rfq_id": rfq["id"],
                     "invitation_id": inv["id"], "ingested_at": now_iso()})
                result = await ingest_reply(rfq, inv, message)
                if result:
                    ingested.append(result)
                break   # one reply per invitation is enough to raise a quote

    await gmail.save_integration(last_poll_at=now_iso(),
                                 last_error="; ".join(errors)[:300] if errors else None)
    return {"checked": len(rfqs), "ingested": len(ingested), "quotes": ingested,
            "errors": errors}


# ---------- background polling ----------

POLL_INTERVAL_SECONDS = int(__import__("os").environ.get("GMAIL_POLL_SECONDS", "180"))


async def poll_loop():
    """Check for replies on a timer.

    Quietly does nothing while Gmail is unconnected, so a fresh install costs
    one cheap database read every few minutes and never touches the network.
    """
    import asyncio
    while True:
        try:
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            status = await gmail.public_status()
            if not status["connected"]:
                continue
            result = await poll_replies()
            if result["ingested"]:
                logger.info("Gmail poll ingested %s new quote(s)", result["ingested"])
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — the loop must survive any single failure
            logger.exception("Gmail poll failed; will retry next interval")
