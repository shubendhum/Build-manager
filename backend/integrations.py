"""Email integration routes and inbound quote ingestion.

Sending goes out through the builder's own Gmail. When a trade replies, we match
the reply back to the exact invitation via the Gmail threadId we recorded when
sending, pull down any attached quote, and read the price off it with the local
vision model — as a DRAFT the builder confirms, never an accepted price.

Collections: integrations, gmail_messages (replies already ingested)
"""
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

import antivirus
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

# Classification comes first. Most replies in a quote thread are not quotes —
# they are questions, acknowledgements, out-of-office notices, bounces and
# forwards — and treating those as prices produced a board full of $0 rows.
CLASSIFY_PROMPT = (
    "You are reading a reply to a request for quote sent by a builder to a subcontractor.\n"
    "Decide what this message is, and if it is a quote, extract the commercial terms.\n\n"
    "Reply with ONLY a JSON object:\n"
    '{"kind": "quote" | "question" | "acknowledgement" | "decline" | "out-of-office" '
    '| "bounce" | "other",\n'
    ' "is_quote": true | false,\n'
    ' "confidence": "high" | "medium" | "low",\n'
    ' "amount_ex_gst": number or null, "gst_amount": number or null,\n'
    ' "total_inc_gst": number or null,\n'
    ' "lead_time": string or null, "inclusions": string or null,\n'
    ' "exclusions": string or null,\n'
    ' "summary": "one short sentence describing the reply"}\n\n'
    "Rules:\n"
    "- is_quote is true ONLY when the message or its attachment states a price for the works.\n"
    "- A delivery failure notice, an auto-reply, or a plain acknowledgement is never a quote.\n"
    "- A message that only forwards the request onward is not a quote.\n"
    "- Amounts are Australian dollars. Never invent a number that is not there;\n"
    "  leave it null and set is_quote false.\n"
    "- If only one total is given and it says it includes GST, put it in total_inc_gst."
)

# An emailed signature logo is not a quote. Outlook names them image001.png and
# marks them inline; they are also tiny compared with a real document.
SIGNATURE_NAME = re.compile(r"^(image|icon|logo|banner|sig)[-_ ]?\d*\.(png|jpe?g|gif|webp)$", re.I)
MIN_DOCUMENT_BYTES = 40 * 1024


def looks_like_signature(att: dict) -> bool:
    """Only images can be signature logos.

    `inline` on its own is not enough to disqualify something: several mail
    clients mark genuine attachments inline, and a 1.1 MB marked-up plan sent
    that way is still the document you asked for. A PDF is never a signature.
    """
    if not att.get("media_type", "").startswith("image/"):
        return False
    if att.get("inline"):
        return True
    if SIGNATURE_NAME.match(att.get("filename", "")):
        return True
    # A genuine scanned or photographed quote is not 12 KB.
    return att.get("size", 0) < MIN_DOCUMENT_BYTES


def pick_quote_attachment(attachments: list) -> Optional[dict]:
    """The one most likely to be the quote itself."""
    candidates = [a for a in attachments
                  if a.get("media_type") in READABLE_ATTACHMENTS and not looks_like_signature(a)]
    if not candidates:
        return None

    def rank(a):
        name = a.get("filename", "").lower()
        return (
            0 if "quote" in name or "quotation" in name or "estimate" in name else 1,
            0 if a.get("media_type") == "application/pdf" else 1,
            -a.get("size", 0),          # bigger is more likely the real document
        )
    return sorted(candidates, key=rank)[0]



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

def _unread(why: str) -> dict:
    """Same shape as a successful read, so no caller has to guard for it."""
    return {"kind": "other", "is_quote": False, "confidence": "low", "summary": why[:300],
            "amount_ex_gst": None, "gst_amount": None, "total_inc_gst": None,
            "lead_time": "", "inclusions": "", "exclusions": ""}


async def read_reply(subject: str, sender: str, body_text: str,
                     raw: Optional[bytes], media_type: str) -> dict:
    """Ask the local model what this reply is, and its terms if it is a quote.

    The attachment and the message text go in together — a tradie often writes
    the price in the email and attaches the formal quote, or the reverse.
    """
    content = [text_content(CLASSIFY_PROMPT)]
    if raw:
        try:
            if media_type == "application/pdf":
                for page_b64 in render_pages(raw, media_type)[:3]:
                    content.append(image_content(page_b64))
            elif media_type in READABLE_ATTACHMENTS:
                import base64
                content.append(image_content(base64.b64encode(raw).decode(), media_type))
        except Exception:  # noqa: BLE001 — a bad attachment must not stop the read
            logger.warning("Could not render the attachment; reading the message text only.")

    content.append(text_content(
        f"Subject: {subject}\nFrom: {sender}\n\nMessage:\n{(body_text or '')[:4000]}"))

    try:
        reply = await vision_chat([{"role": "user", "content": content}],
                                  max_tokens=700, timeout=150.0)
        data = extract_json(reply)
    except (RuntimeError, ValueError) as exc:
        logger.warning("Reply classification failed: %s", exc)
        return _unread(f"Could not read: {exc}")
    if not isinstance(data, dict):
        return _unread("Unreadable model response")

    ex = coerce_float(data.get("amount_ex_gst"))
    gst = coerce_float(data.get("gst_amount"))
    total = coerce_float(data.get("total_inc_gst"))
    if total is None and ex is not None:
        gst = gst if gst is not None else round(ex * 0.10, 2)
        total = round(ex + gst, 2)
    elif ex is None and total is not None:
        ex = round(total / 1.1, 2)
        gst = round(total - ex, 2)

    # A "quote" with no number is not a quote, whatever the model called it.
    is_quote = bool(data.get("is_quote")) and bool(total)
    return {
        "kind": str(data.get("kind") or "other")[:40],
        "is_quote": is_quote,
        "confidence": str(data.get("confidence") or "")[:10],
        "summary": str(data.get("summary") or "").strip()[:300],
        "amount_ex_gst": ex, "gst_amount": gst, "total_inc_gst": total,
        "lead_time": str(data.get("lead_time") or "").strip()[:120],
        "inclusions": str(data.get("inclusions") or "").strip()[:1000],
        "exclusions": str(data.get("exclusions") or "").strip()[:1000],
    }


async def ingest_thread(rfq: dict, invitation: dict, messages: list) -> Optional[dict]:
    """Read every unseen message on one invitation and record the outcome once.

    A tradie's price and their PDF often arrive in different messages, in either
    order, so the whole thread is considered together rather than each message
    on its own.
    """
    integration = await gmail.get_integration() or {}
    own = [a for a in (integration.get("email_address"), gmail.send_as()) if a]

    best_doc = None          # the strongest candidate document across the thread
    best_doc_raw = None
    priced = None            # the most recent message that actually states a price
    last_other = None        # what to report when nothing is a quote

    for message in messages:
        payload = message.get("payload", {})
        sender = gmail.header(payload, "From")
        if any(addr.lower() in sender.lower() for addr in own):
            continue         # the builder's own mail, including the request itself

        subject = gmail.header(payload, "Subject")
        body_text = gmail.plain_body(payload)

        chosen = pick_quote_attachment(gmail.attachments_in(payload))
        raw, media_type = None, ""
        if chosen:
            try:
                raw = await gmail.download_attachment(message["id"], chosen["attachment_id"])
                media_type = chosen["media_type"]
            except RuntimeError as exc:
                logger.warning("Attachment download failed: %s", exc)
                raw, chosen = None, None

        verdict = await read_reply(subject, sender, body_text, raw, media_type)

        # Keep the best document seen anywhere in the thread — a PDF named
        # "quote" beats a photo, and either beats nothing.
        if chosen and raw and (best_doc is None or
                               pick_quote_attachment([chosen, best_doc])["filename"] == chosen["filename"]):
            best_doc, best_doc_raw = chosen, raw

        if verdict["is_quote"]:
            priced = {"verdict": verdict, "sender": sender, "subject": subject, "body": body_text}
        else:
            last_other = {"verdict": verdict, "sender": sender}

    if not priced and not last_other and best_doc is None:
        return None

    # Record what came back either way.
    kind = (priced or last_other or {}).get("verdict", {}).get("kind", "other")
    summary = (priced or last_other or {}).get("verdict", {}).get("summary", "")
    await db.rfqs.update_one(
        {"id": rfq["id"], "invitations.id": invitation["id"]},
        {"$set": {"invitations.$.last_reply_at": now_iso(),
                  "invitations.$.last_reply_kind": kind,
                  "invitations.$.last_reply_summary": summary,
                  "updated_at": now_iso()}},
    )

    if not priced:
        logger.info("Thread for %s classified as %s — no quote raised", invitation["trade_id"], kind)
        return {"quote_id": None, "trade_id": invitation["trade_id"], "priced": False,
                "kind": kind, "summary": summary}

    quote_id = str(uuid.uuid4())
    attachment_doc, rejected_attachment = None, None
    if best_doc and best_doc_raw:
        scan = await antivirus.check_incoming(best_doc_raw, best_doc["media_type"], best_doc["filename"])
        if scan.safe_to_store:
            suffix = Path(best_doc["filename"]).suffix or ".pdf"
            path = QUOTE_UPLOAD_DIR / f"{quote_id}{suffix}"
            path.write_bytes(best_doc_raw)
            attachment_doc = {"filename": best_doc["filename"], "file_path": str(path),
                              "media_type": best_doc["media_type"],
                              "file_size": len(best_doc_raw), "scan": scan.model_dump()}
        else:
            logger.warning("Attachment %s not stored: %s", best_doc["filename"], scan.status)
            rejected_attachment = {"filename": best_doc["filename"],
                                   "media_type": best_doc["media_type"], "scan": scan.model_dump()}

    v = priced["verdict"]
    package = await db.work_packages.find_one({"id": rfq.get("package_id")}, {"_id": 0}) or {}
    fields = {
        "project_id": rfq["project_id"], "package_id": rfq.get("package_id"),
        "trade_id": invitation["trade_id"],
        "work_package": package.get("title") or rfq["scope"].splitlines()[0][:60],
        "stage_key": rfq.get("stage_key", "lockup"),
        "amount_ex_gst": v["amount_ex_gst"] or 0.0, "gst_amount": v["gst_amount"] or 0.0,
        "total_inc_gst": v["total_inc_gst"] or 0.0,
        "quote_date": datetime.now(timezone.utc).date().isoformat(),
        "scope_description": v["inclusions"], "exclusions": v["exclusions"],
        "lead_time": v["lead_time"],
        "contact_name": priced["sender"][:120], "contact_email": priced["sender"][:200],
        "status": "pending", "source": "email",
        "needs_review": True, "ai_confidence": v["confidence"], "ai_summary": v["summary"],
        "email_subject": priced["subject"][:200], "email_body": priced["body"][:4000],
        "rfq_id": rfq["id"], "invitation_id": invitation["id"],
        "rejected_attachment": rejected_attachment, "updated_at": now_iso(),
    }
    if attachment_doc:
        fields["attachment"] = attachment_doc

    existing = await db.quotes.find_one(
        {"invitation_id": invitation["id"], "source": "email"}, {"_id": 0, "id": 1, "attachment": 1})
    if existing:
        if attachment_doc and (existing.get("attachment") or {}).get("file_path"):
            Path(existing["attachment"]["file_path"]).unlink(missing_ok=True)
        await db.quotes.update_one({"id": existing["id"]}, {"$set": fields})
        quote_id = existing["id"]
    else:
        await db.quotes.insert_one({**fields, "id": quote_id, "expiry_date": None,
                                    "contact_phone": "", "attachment": attachment_doc,
                                    "created_at": now_iso()})

    await db.rfqs.update_one(
        {"id": rfq["id"], "invitations.id": invitation["id"]},
        {"$set": {"invitations.$.status": "submitted", "invitations.$.submitted_at": now_iso(),
                  "invitations.$.quote_id": quote_id, "updated_at": now_iso()}},
    )
    if rfq.get("package_id"):
        await db.work_packages.update_one(
            {"id": rfq["package_id"], "status": {"$in": ["draft", "out-for-quote"]}},
            {"$set": {"status": "quotes-in", "updated_at": now_iso()}},
        )
    return {"quote_id": quote_id, "trade_id": invitation["trade_id"], "priced": True,
            "kind": v["kind"], "total_inc_gst": v["total_inc_gst"],
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
            fresh = []
            for message in thread.get("messages", []):
                if message.get("id") == inv.get("gmail_message_id"):
                    continue    # our own outgoing message
                if await db.gmail_messages.find_one({"id": message["id"]}, {"_id": 1}):
                    continue    # already read
                fresh.append(message)
            if not fresh:
                continue
            for message in fresh:
                await db.gmail_messages.insert_one(
                    {"id": message["id"], "thread_id": thread_id, "rfq_id": rfq["id"],
                     "invitation_id": inv["id"], "ingested_at": now_iso()})
            result = await ingest_thread(rfq, inv, fresh)
            if result:
                ingested.append(result)

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
