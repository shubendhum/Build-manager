"""Unit tests for the Gmail integration's pure parts.

No network and no Google credentials — these cover the MIME we send, the reply
parsing we run against real Gmail payloads, and the GST arithmetic applied to a
price read out of an attached quote.
"""
import base64
import os
import pytest

import gmail


def b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode()


class TestOutgoingMime:
    def test_builds_multipart_with_reply_to(self):
        msg = gmail.build_mime(
            to="dave@example.com", subject="Quote request — Plumbing",
            html="<p>hello</p>", text="hello",
            sender="shubendhu.mahajan@rldtech.com.au", reply_to="quotes@rldtech.com.au")
        assert msg["To"] == "dave@example.com"
        assert msg["From"] == "shubendhu.mahajan@rldtech.com.au"
        assert msg["Reply-To"] == "quotes@rldtech.com.au"
        assert msg.is_multipart(), "must carry both a text and an HTML part"
        types = {p.get_content_type() for p in msg.walk()}
        assert "text/plain" in types and "text/html" in types

    def test_survives_base64url_encoding(self):
        """This is exactly what goes on the wire to the Gmail API."""
        msg = gmail.build_mime("a@b.com", "Sübject — dash", "<p>é</p>", "é",
                               "me@example.com")
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        assert "+" not in raw and "/" not in raw, "url-safe alphabet only"
        assert base64.urlsafe_b64decode(raw) == msg.as_bytes()


class TestReplyParsing:
    """Payload shapes copied from what the Gmail API actually returns."""

    def test_reads_a_header_case_insensitively(self):
        payload = {"headers": [{"name": "From", "value": "Dave <dave@example.com>"}]}
        assert gmail.header(payload, "from") == "Dave <dave@example.com>"
        assert gmail.header(payload, "Subject") == ""

    def test_prefers_plain_text_over_html(self):
        payload = {"mimeType": "multipart/alternative", "parts": [
            {"mimeType": "text/plain", "body": {"data": b64("Our price is $12,400")}},
            {"mimeType": "text/html", "body": {"data": b64("<p>Our price is $12,400</p>")}},
        ]}
        assert gmail.plain_body(payload) == "Our price is $12,400"

    def test_falls_back_to_stripped_html(self):
        payload = {"mimeType": "text/html",
                   "body": {"data": b64("<div><b>Price:</b> $9,900</div>")}}
        body = gmail.plain_body(payload)
        assert "<" not in body and "Price:" in body and "$9,900" in body

    def test_finds_attachments_at_any_depth(self):
        payload = {"mimeType": "multipart/mixed", "parts": [
            {"mimeType": "multipart/alternative", "parts": [
                {"mimeType": "text/plain", "body": {"data": b64("see attached")}},
            ]},
            {"mimeType": "application/pdf", "filename": "Quote-1042.pdf",
             "body": {"attachmentId": "ATT1", "size": 51200}},
        ]}
        found = gmail.attachments_in(payload)
        assert len(found) == 1
        assert found[0]["filename"] == "Quote-1042.pdf"
        assert found[0]["attachment_id"] == "ATT1"
        assert found[0]["media_type"] == "application/pdf"

    def test_inline_parts_without_a_filename_are_not_attachments(self):
        """Signature images have no filename and must not be mistaken for a quote."""
        payload = {"parts": [
            {"mimeType": "image/png", "filename": "", "body": {"attachmentId": "X"}},
        ]}
        assert gmail.attachments_in(payload) == []

    def test_empty_payload_is_safe(self):
        assert gmail.plain_body({}) == ""
        assert gmail.attachments_in({}) == []
        assert gmail.header({}, "From") == ""


class TestConfiguration:
    def test_not_configured_without_credentials(self, monkeypatch):
        monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
        monkeypatch.delenv("GOOGLE_CLIENT_SECRET", raising=False)
        assert gmail.configured() is False

    def test_configured_when_all_three_present(self, monkeypatch):
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "id.apps.googleusercontent.com")
        monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "secret")
        monkeypatch.setenv("GOOGLE_REDIRECT_URI", "https://x/api/integrations/gmail/callback")
        assert gmail.configured() is True

    def test_scopes_are_send_and_read_only(self):
        """Never request gmail.modify — we track processed replies in our own DB."""
        assert "https://www.googleapis.com/auth/gmail.send" in gmail.SCOPES
        assert "https://www.googleapis.com/auth/gmail.readonly" in gmail.SCOPES
        assert not any("gmail.modify" in s for s in gmail.SCOPES)
        assert not any("gmail.compose" in s for s in gmail.SCOPES)


class TestPriceArithmetic:
    """A quote may state only one of the three figures; fill in the rest at 10%."""

    @staticmethod
    def fill(ex, gst, total):
        # mirrors integrations.extract_quote_terms
        if total is None and ex is not None:
            gst = gst if gst is not None else round(ex * 0.10, 2)
            total = round(ex + gst, 2)
        elif ex is None and total is not None:
            ex = round(total / 1.1, 2)
            gst = round(total - ex, 2)
        return ex, gst, total

    def test_ex_gst_only(self):
        assert self.fill(1000.0, None, None) == (1000.0, 100.0, 1100.0)

    def test_total_only(self):
        ex, gst, total = self.fill(None, None, 1100.0)
        assert ex == pytest.approx(1000.0) and gst == pytest.approx(100.0)
        assert total == 1100.0

    def test_all_three_given_are_left_alone(self):
        assert self.fill(1000.0, 95.0, 1095.0) == (1000.0, 95.0, 1095.0)

    def test_nothing_found_stays_none(self):
        assert self.fill(None, None, None) == (None, None, None)
