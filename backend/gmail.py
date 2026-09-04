"""Gmail integration — send quote requests from the builder's own mailbox and
read the replies back in.

Uses OAuth, so no password is ever stored and the builder can revoke access from
their Google account at any time. Talks to Google over httpx rather than the
google-api-python-client, because that library is synchronous and this app also
runs long vision calls on the same event loop.

Outbound RFQs are sent through the Gmail API, which means they appear in the
builder's own Sent folder and thread properly. We record the Gmail threadId
against the invitation, so a reply can be matched back to the exact trade and
package without scanning the mailbox.

Collections: integrations (one doc, id="gmail"), gmail_messages (seen replies)
"""
import base64
import logging
import secrets
from datetime import datetime, timezone, timedelta
from email.message import EmailMessage
from typing import Optional

import httpx

from db import db

logger = logging.getLogger(__name__)

AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke"
GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"

# Deliberately narrow: send, and read. Not `modify` — we track what we have
# already processed in our own database rather than writing labels into Gmail.
SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
]

INTEGRATION_ID = "gmail"
TIMEOUT = 30.0


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _env(key: str, default: str = "") -> str:
    import os
    return (os.environ.get(key) or default).strip()


def client_id() -> str:
    return _env("GOOGLE_CLIENT_ID")


def client_secret() -> str:
    return _env("GOOGLE_CLIENT_SECRET")


def redirect_uri() -> str:
    explicit = _env("GOOGLE_REDIRECT_URI")
    if explicit:
        return explicit
    import notify
    base = notify.public_base_url()
    return f"{base}/api/integrations/gmail/callback" if base else ""


def send_as() -> str:
    """The address quote requests go out from.

    Gmail only accepts a From that is a verified send-as alias on the account;
    anything else is rejected or silently rewritten. Empty means "use the
    account's own address".
    """
    return _env("GMAIL_SEND_AS")


def configured() -> bool:
    return bool(client_id() and client_secret() and redirect_uri())


# ---------- token storage ----------

async def get_integration() -> Optional[dict]:
    return await db.integrations.find_one({"id": INTEGRATION_ID}, {"_id": 0})


async def save_integration(**fields):
    await db.integrations.update_one(
        {"id": INTEGRATION_ID},
        {"$set": {"id": INTEGRATION_ID, "updated_at": now_iso(), **fields}},
        upsert=True,
    )


async def public_status() -> dict:
    """Never leaks tokens — safe to return to the browser."""
    doc = await get_integration()
    return {
        "configured": configured(),
        "connected": bool(doc and doc.get("refresh_token")),
        "email_address": (doc or {}).get("email_address"),
        "connected_at": (doc or {}).get("connected_at"),
        "last_poll_at": (doc or {}).get("last_poll_at"),
        "last_error": (doc or {}).get("last_error"),
        "redirect_uri": redirect_uri(),
    }


# ---------- OAuth flow ----------

async def build_auth_url() -> str:
    state = secrets.token_urlsafe(24)
    await save_integration(oauth_state=state, last_error=None)
    from urllib.parse import urlencode
    params = {
        "client_id": client_id(),
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": " ".join(SCOPES),
        # offline + consent is what actually returns a refresh_token; without
        # prompt=consent Google omits it on re-authorisation.
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{AUTH_ENDPOINT}?{urlencode(params)}"


async def exchange_code(code: str, state: str) -> dict:
    doc = await get_integration() or {}
    if not state or state != doc.get("oauth_state"):
        raise RuntimeError("OAuth state mismatch — start the connection again.")

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(TOKEN_ENDPOINT, data={
            "code": code,
            "client_id": client_id(),
            "client_secret": client_secret(),
            "redirect_uri": redirect_uri(),
            "grant_type": "authorization_code",
        })
    if resp.status_code >= 400:
        raise RuntimeError(f"Google rejected the authorisation: {resp.text[:300]}")
    tokens = resp.json()
    if not tokens.get("refresh_token"):
        raise RuntimeError(
            "Google did not return a refresh token. Remove this app from your "
            "Google account's third-party access list and connect again."
        )

    address = await fetch_address(tokens["access_token"])
    await save_integration(
        refresh_token=tokens["refresh_token"],
        access_token=tokens["access_token"],
        expires_at=(datetime.now(timezone.utc)
                    + timedelta(seconds=int(tokens.get("expires_in", 3600)))).isoformat(),
        scopes=tokens.get("scope", "").split(),
        email_address=address,
        connected_at=now_iso(),
        oauth_state=None,
        last_error=None,
    )
    return {"email_address": address}


async def fetch_address(access_token: str) -> Optional[str]:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(f"{GMAIL_API}/profile",
                                headers={"Authorization": f"Bearer {access_token}"})
    return resp.json().get("emailAddress") if resp.status_code < 400 else None


async def access_token() -> str:
    """Valid bearer token, refreshing when it is close to expiry."""
    doc = await get_integration()
    if not doc or not doc.get("refresh_token"):
        raise RuntimeError("Gmail is not connected. Connect it in Settings first.")

    expires_at = doc.get("expires_at")
    if doc.get("access_token") and expires_at:
        try:
            # 60s of slack so a token cannot expire mid-request.
            if datetime.fromisoformat(expires_at) - timedelta(seconds=60) > datetime.now(timezone.utc):
                return doc["access_token"]
        except ValueError:
            pass

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(TOKEN_ENDPOINT, data={
            "refresh_token": doc["refresh_token"],
            "client_id": client_id(),
            "client_secret": client_secret(),
            "grant_type": "refresh_token",
        })
    if resp.status_code >= 400:
        await save_integration(last_error=f"Token refresh failed: {resp.text[:200]}")
        raise RuntimeError(
            "Gmail access has expired or been revoked. Reconnect it in Settings."
        )
    tokens = resp.json()
    await save_integration(
        access_token=tokens["access_token"],
        expires_at=(datetime.now(timezone.utc)
                    + timedelta(seconds=int(tokens.get("expires_in", 3600)))).isoformat(),
        last_error=None,
    )
    return tokens["access_token"]


async def disconnect():
    doc = await get_integration()
    token = (doc or {}).get("refresh_token")
    if token:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                await client.post(REVOKE_ENDPOINT, data={"token": token})
        except httpx.HTTPError:
            logger.warning("Could not reach Google to revoke the token; clearing locally.")
    await db.integrations.delete_one({"id": INTEGRATION_ID})


# ---------- sending ----------

def build_mime(to: str, subject: str, html: str, text: str,
               sender: str, reply_to: Optional[str] = None,
               attachments: Optional[list] = None) -> EmailMessage:
    """A multipart message the tradie can simply reply to, files included.

    Attachments are real MIME parts, so the drawings arrive with the request
    rather than behind a link the trade has to go and fetch.
    """
    msg = EmailMessage()
    msg["To"] = to
    msg["From"] = sender
    msg["Subject"] = subject
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    for att in attachments or []:
        content = att.get("content")
        if not content:
            continue
        media = att.get("media_type") or "application/octet-stream"
        maintype, _, subtype = media.partition("/")
        msg.add_attachment(content, maintype=maintype or "application",
                           subtype=subtype or "octet-stream",
                           filename=att.get("filename") or "attachment")
    return msg


async def send_message(to: str, subject: str, html: str, text: str,
                       reply_to: Optional[str] = None,
                       attachments: Optional[list] = None) -> dict:
    """Send as the connected mailbox. Returns Gmail's id and threadId."""
    token = await access_token()
    doc = await get_integration() or {}
    sender = send_as() or doc.get("email_address") or "me"

    msg = build_mime(to, subject, html, text, sender, reply_to, attachments)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(
            f"{GMAIL_API}/messages/send",
            headers={"Authorization": f"Bearer {token}"},
            json={"raw": raw},
        )
    if resp.status_code >= 400:
        raise RuntimeError(f"Gmail refused the message ({resp.status_code}): {resp.text[:300]}")
    data = resp.json()
    return {"message_id": data.get("id"), "thread_id": data.get("threadId")}


# ---------- reading replies ----------

async def get_thread(thread_id: str) -> dict:
    token = await access_token()
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(
            f"{GMAIL_API}/threads/{thread_id}",
            headers={"Authorization": f"Bearer {token}"},
            params={"format": "full"},
        )
    if resp.status_code == 404:
        return {}
    if resp.status_code >= 400:
        raise RuntimeError(f"Could not read the Gmail thread: {resp.text[:200]}")
    return resp.json()


async def download_attachment(message_id: str, attachment_id: str) -> bytes:
    token = await access_token()
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(
            f"{GMAIL_API}/messages/{message_id}/attachments/{attachment_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    if resp.status_code >= 400:
        raise RuntimeError(f"Could not download the attachment: {resp.text[:200]}")
    return base64.urlsafe_b64decode(resp.json()["data"])


def header(payload: dict, name: str) -> str:
    for h in payload.get("headers", []):
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def walk_parts(payload: dict):
    """Yield every MIME part, depth first."""
    yield payload
    for part in payload.get("parts", []) or []:
        yield from walk_parts(part)


def plain_body(payload: dict) -> str:
    """Prefer text/plain; fall back to stripped HTML."""
    html_fallback = ""
    for part in walk_parts(payload):
        mime = part.get("mimeType", "")
        data = (part.get("body") or {}).get("data")
        if not data:
            continue
        try:
            decoded = base64.urlsafe_b64decode(data).decode("utf-8", "replace")
        except (ValueError, TypeError):
            continue
        if mime == "text/plain":
            return decoded
        if mime == "text/html" and not html_fallback:
            html_fallback = decoded
    if html_fallback:
        import re
        return re.sub(r"<[^>]+>", " ", html_fallback)
    return ""


def part_header(part: dict, name: str) -> str:
    for h in part.get("headers", []) or []:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def attachments_in(payload: dict) -> list:
    """Real attachments, with enough context to tell a quote from a logo.

    `inline` matters: a signature image is referenced by the HTML body via
    Content-ID and is not something the sender meant to send you.
    """
    found = []
    for part in walk_parts(payload):
        filename = part.get("filename")
        body = part.get("body") or {}
        if filename and body.get("attachmentId"):
            disposition = part_header(part, "Content-Disposition").lower()
            found.append({
                "filename": filename,
                "attachment_id": body["attachmentId"],
                "media_type": part.get("mimeType", "application/octet-stream"),
                "size": body.get("size", 0),
                "inline": "inline" in disposition or bool(part_header(part, "Content-ID")),
            })
    return found


async def list_aliases() -> list:
    """Verified send-as addresses on the connected account."""
    token = await access_token()
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(f"{GMAIL_API}/settings/sendAs",
                                headers={"Authorization": f"Bearer {token}"})
    if resp.status_code >= 400:
        return []
    return [
        {"email": a.get("sendAsEmail"),
         "is_primary": bool(a.get("isPrimary")),
         "verified": a.get("verificationStatus") in (None, "accepted")}
        for a in resp.json().get("sendAs", [])
    ]
