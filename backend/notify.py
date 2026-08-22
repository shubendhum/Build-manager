"""Outbound notifications — email and SMS.

Drivers are selected by env var and default to `console`, which logs the message
and reports success without touching the network. That keeps a fresh clone, CI
and the existing test suite working with no credentials and no outbound traffic.

Adding a provider means writing one `async def _send_x(...) -> SendResult` and
registering it in the driver map — nothing above this module changes.

Safety rails for the first real sends:
  NOTIFY_ALLOWLIST      comma-separated substrings; when set, any recipient that
                        does not match is skipped (reported as failed, not sent)
  NOTIFY_MAX_PER_SEND   hard cap on recipients in a single send call
"""
import os
import ssl
import uuid
import asyncio
import logging
import smtplib
from email.message import EmailMessage
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import BaseModel

from db import db

logger = logging.getLogger(__name__)

TEMPLATE_DIR = Path(__file__).parent / "templates"
_env = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=select_autoescape(["html"]),
    trim_blocks=True,
    lstrip_blocks=True,
)

NOTIFY_TIMEOUT = 20.0


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SendResult(BaseModel):
    ok: bool
    provider_message_id: Optional[str] = None
    # Gmail returns a thread id; recording it is what lets a reply be matched
    # back to the exact invitation later.
    thread_id: Optional[str] = None
    error: Optional[str] = None


# ---------- configuration ----------

def _env_str(key: str, default: str = "") -> str:
    return (os.environ.get(key) or default).strip()


def email_driver() -> str:
    return _env_str("NOTIFY_EMAIL_DRIVER", "console").lower()


def sms_driver() -> str:
    return _env_str("NOTIFY_SMS_DRIVER", "console").lower()


def public_base_url() -> str:
    """Base URL for links we put in outbound messages.

    The portal link is normally built browser-side from window.location.origin;
    once the server composes the message that is unavailable, so this must be
    configured explicitly rather than guessed.
    """
    return _env_str("PUBLIC_BASE_URL").rstrip("/")


def from_email() -> str:
    return _env_str("NOTIFY_FROM_EMAIL", "no-reply@buildmanager.local")


def from_name() -> str:
    return _env_str("NOTIFY_FROM_NAME", "BuildManager VIC")


def max_per_send() -> int:
    try:
        return int(_env_str("NOTIFY_MAX_PER_SEND", "25"))
    except ValueError:
        return 25


def _allowlist() -> list:
    raw = _env_str("NOTIFY_ALLOWLIST")
    return [p.strip().lower() for p in raw.split(",") if p.strip()] if raw else []


# RFC 2606 / RFC 6761 reserve these precisely so they can appear in tests and
# documentation and never reach a real mailbox. Sending to one is always a
# mistake — a real send costs nothing but noise in the Sent folder and a bounce.
RESERVED_DOMAINS = {"example.com", "example.net", "example.org", "example.edu", "localhost"}
RESERVED_TLDS = (".test", ".example", ".invalid", ".localhost", ".local")


def is_undeliverable(to: str) -> bool:
    addr = (to or "").strip().lower()
    if "@" not in addr:
        return True
    domain = addr.rsplit("@", 1)[1].strip("]>. ")
    return domain in RESERVED_DOMAINS or domain.endswith(RESERVED_TLDS)


def allowed_recipient(to: str) -> bool:
    patterns = _allowlist()
    if not patterns:
        return True
    target = (to or "").lower()
    return any(p in target for p in patterns)


# ---------- email drivers ----------

async def _email_console(to: str, subject: str, html: str, text: str) -> SendResult:
    logger.info("[notify:console:email] to=%s subject=%s\n%s", to, subject, text)
    return SendResult(ok=True, provider_message_id=f"console-{uuid.uuid4()}")


def _smtp_send_blocking(to: str, subject: str, html: str, text: str) -> str:
    host = _env_str("SMTP_HOST")
    if not host:
        raise RuntimeError("SMTP_HOST is not configured.")
    port = int(_env_str("SMTP_PORT", "587"))
    user = _env_str("SMTP_USER")
    password = _env_str("SMTP_PASSWORD")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{from_name()} <{from_email()}>"
    msg["To"] = to
    msg["Message-ID"] = f"<{uuid.uuid4()}@buildmanager>"
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=NOTIFY_TIMEOUT, context=ssl.create_default_context()) as s:
            if user:
                s.login(user, password)
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=NOTIFY_TIMEOUT) as s:
            s.ehlo()
            if _env_str("SMTP_STARTTLS", "true").lower() in {"1", "true", "yes", "on"}:
                s.starttls(context=ssl.create_default_context())
                s.ehlo()
            if user:
                s.login(user, password)
            s.send_message(msg)
    return msg["Message-ID"]


async def _email_smtp(to: str, subject: str, html: str, text: str) -> SendResult:
    # smtplib is blocking; this app also runs 15-25s vision calls on the same
    # loop, so the send has to go to a worker thread.
    message_id = await asyncio.to_thread(_smtp_send_blocking, to, subject, html, text)
    return SendResult(ok=True, provider_message_id=message_id)


async def _email_http(to: str, subject: str, html: str, text: str) -> SendResult:
    url = _env_str("NOTIFY_EMAIL_URL")
    if not url:
        raise RuntimeError("NOTIFY_EMAIL_URL is not configured.")
    headers = {"Content-Type": "application/json"}
    token = _env_str("NOTIFY_EMAIL_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    payload = {
        "from": f"{from_name()} <{from_email()}>",
        "to": [to],
        "subject": subject,
        "html": html,
        "text": text,
    }
    async with httpx.AsyncClient(timeout=NOTIFY_TIMEOUT) as client:
        resp = await client.post(url, json=payload, headers=headers)
    if resp.status_code >= 400:
        return SendResult(ok=False, error=f"Provider returned {resp.status_code}: {resp.text[:200]}")
    body = {}
    try:
        body = resp.json()
    except Exception:  # noqa: BLE001 - provider may return an empty body
        pass
    return SendResult(ok=True, provider_message_id=str(body.get("id") or body.get("message_id") or "") or None)


async def _email_gmail(to: str, subject: str, html: str, text: str) -> SendResult:
    """Send from the builder's own connected mailbox via the Gmail API."""
    import gmail  # imported lazily: notify must stay usable without the integration
    sent = await gmail.send_message(to, subject, html, text)
    return SendResult(ok=True, provider_message_id=sent["message_id"], thread_id=sent["thread_id"])


EMAIL_DRIVERS = {"console": _email_console, "smtp": _email_smtp,
                 "http": _email_http, "gmail": _email_gmail}


# ---------- sms drivers ----------

async def _sms_console(to: str, body: str) -> SendResult:
    logger.info("[notify:console:sms] to=%s\n%s", to, body)
    return SendResult(ok=True, provider_message_id=f"console-{uuid.uuid4()}")


async def _sms_http(to: str, body: str) -> SendResult:
    url = _env_str("NOTIFY_SMS_URL")
    if not url:
        raise RuntimeError("NOTIFY_SMS_URL is not configured.")
    headers = {"Content-Type": "application/json"}
    token = _env_str("NOTIFY_SMS_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    payload = {
        _env_str("NOTIFY_SMS_TO_FIELD", "to"): to,
        _env_str("NOTIFY_SMS_BODY_FIELD", "message"): body,
    }
    sender = _env_str("NOTIFY_SMS_SENDER")
    if sender:
        payload[_env_str("NOTIFY_SMS_SENDER_FIELD", "from")] = sender
    async with httpx.AsyncClient(timeout=NOTIFY_TIMEOUT) as client:
        resp = await client.post(url, json=payload, headers=headers)
    if resp.status_code >= 400:
        return SendResult(ok=False, error=f"Provider returned {resp.status_code}: {resp.text[:200]}")
    body_json = {}
    try:
        body_json = resp.json()
    except Exception:  # noqa: BLE001
        pass
    return SendResult(ok=True, provider_message_id=str(body_json.get("id") or body_json.get("message_id") or "") or None)


SMS_DRIVERS = {"console": _sms_console, "http": _sms_http}


# ---------- public send API ----------

async def send_email(to: str, subject: str, html: str, text: str) -> SendResult:
    """Never raises — transport problems come back as SendResult(ok=False)."""
    if not to:
        return SendResult(ok=False, error="No email address on file for this trade.")
    if is_undeliverable(to):
        return SendResult(ok=False, error=(
            f"{to} is a reserved test address (RFC 2606) — refusing to send. "
            "Nothing was delivered."))
    if not allowed_recipient(to):
        return SendResult(ok=False, error=f"{to} is not on NOTIFY_ALLOWLIST — skipped.")
    driver = EMAIL_DRIVERS.get(email_driver())
    if driver is None:
        return SendResult(ok=False, error=f"Unknown email driver '{email_driver()}'.")
    try:
        return await driver(to, subject, html, text)
    except Exception as exc:  # noqa: BLE001 - a bad provider must not 500 the request
        logger.exception("Email send failed for %s", to)
        return SendResult(ok=False, error=str(exc)[:300])


async def send_sms(to: str, body: str) -> SendResult:
    """Never raises — transport problems come back as SendResult(ok=False)."""
    if not to:
        return SendResult(ok=False, error="No mobile number on file for this trade.")
    if "@" in to:
        return SendResult(ok=False, error=f"{to} is not a mobile number.")
    if not allowed_recipient(to):
        return SendResult(ok=False, error=f"{to} is not on NOTIFY_ALLOWLIST — skipped.")
    driver = SMS_DRIVERS.get(sms_driver())
    if driver is None:
        return SendResult(ok=False, error=f"Unknown SMS driver '{sms_driver()}'.")
    try:
        return await driver(to, body)
    except Exception as exc:  # noqa: BLE001
        logger.exception("SMS send failed for %s", to)
        return SendResult(ok=False, error=str(exc)[:300])


# ---------- templates ----------

def render_rfq(context: dict) -> dict:
    """Returns the exact subject/html/text/sms that will go out."""
    subject = _env.get_template("rfq_email_subject.txt").render(**context).strip()
    return {
        "subject": subject,
        "html": _env.get_template("rfq_email.html").render(**context),
        "text": _env.get_template("rfq_email.txt").render(**context),
        "sms": " ".join(_env.get_template("rfq_sms.txt").render(**context).split()),
    }


# ---------- send log ----------

async def record_notification(*, project_id: str, rfq_id: str, invitation_id: str, trade_id: str,
                              channel: str, to: str, subject: str, body: str) -> str:
    """Write the log row BEFORE attempting delivery, so an in-flight send is
    still visible if the process dies mid-attempt."""
    doc = {
        "id": str(uuid.uuid4()),
        "project_id": project_id,
        "rfq_id": rfq_id,
        "invitation_id": invitation_id,
        "trade_id": trade_id,
        "channel": channel,
        "to": to,
        "subject": subject,
        "body": body,
        "driver": email_driver() if channel == "email" else sms_driver(),
        "provider_message_id": None,
        "status": "queued",
        "error": None,
        "attempts": 1,
        "created_at": now_iso(),
        "sent_at": None,
    }
    await db.notifications.insert_one(dict(doc))
    return doc["id"]


async def settle_notification(notification_id: str, result: SendResult):
    await db.notifications.update_one(
        {"id": notification_id},
        {"$set": {
            "status": "sent" if result.ok else "failed",
            "provider_message_id": result.provider_message_id,
            "error": result.error,
            "sent_at": now_iso() if result.ok else None,
        }},
    )
