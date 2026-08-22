"""Unit tests for the outbound guard rails.

In-process and offline. These cover the success path that the HTTP suites can no
longer exercise, because those deliberately use reserved addresses so they can
never put a message on the wire.
"""
import asyncio

import pytest

import notify


def run(coro):
    """pytest-asyncio is not a dependency here; drive the coroutine directly."""
    return asyncio.run(coro)


class TestReservedAddresses:
    """RFC 2606 / 6761 reserve these so they can be used in tests and never
    reach anyone. A send there is always a mistake."""

    @pytest.mark.parametrize("addr", [
        "rfqtest-a@example.com", "x@example.org", "y@example.net", "z@example.edu",
        "a@foo.test", "b@bar.invalid", "c@localhost", "d@machine.localhost",
        "e@site.example", "not-an-address",
    ])
    def test_refused(self, addr):
        assert notify.is_undeliverable(addr) is True

    @pytest.mark.parametrize("addr", [
        "dave@gmail.com", "shubendhu2@gmail.com", "info@rldtech.com.au",
        "quotes@homes.rldtech.com.au", "a@examples.com.au", "b@test.com.au",
    ])
    def test_real_addresses_pass(self, addr):
        """The guard must not over-match: test.com.au is a real domain."""
        assert notify.is_undeliverable(addr) is False

    def test_send_email_refuses_without_calling_a_driver(self, monkeypatch):
        called = []
        monkeypatch.setitem(notify.EMAIL_DRIVERS, "console",
                            lambda *a, **k: called.append(a))
        result = run(notify.send_email("rfqtest@example.com", "s", "<p>h</p>", "t"))
        assert result.ok is False
        assert "reserved test address" in result.error
        assert called == [], "the driver must never be reached"


class TestConsoleDriver:
    def test_console_send_succeeds_for_a_real_address(self, monkeypatch):
        monkeypatch.setenv("NOTIFY_EMAIL_DRIVER", "console")
        monkeypatch.delenv("NOTIFY_ALLOWLIST", raising=False)
        result = run(notify.send_email("dave@gmail.com", "Subject", "<p>hi</p>", "hi"))
        assert result.ok is True
        assert result.provider_message_id.startswith("console-")

    def test_unknown_driver_fails_cleanly(self, monkeypatch):
        monkeypatch.setenv("NOTIFY_EMAIL_DRIVER", "smoke-signal")
        result = run(notify.send_email("dave@gmail.com", "s", "h", "t"))
        assert result.ok is False and "Unknown email driver" in result.error


class TestAllowlist:
    def test_empty_allowlist_permits_everyone(self, monkeypatch):
        monkeypatch.delenv("NOTIFY_ALLOWLIST", raising=False)
        assert notify.allowed_recipient("anyone@gmail.com") is True

    def test_allowlist_restricts(self, monkeypatch):
        monkeypatch.setenv("NOTIFY_ALLOWLIST", "shubendhu2@gmail.com,rldtech.com.au")
        assert notify.allowed_recipient("shubendhu2@gmail.com") is True
        assert notify.allowed_recipient("someone@rldtech.com.au") is True
        assert notify.allowed_recipient("random@gmail.com") is False

    def test_send_blocked_by_allowlist(self, monkeypatch):
        monkeypatch.setenv("NOTIFY_EMAIL_DRIVER", "console")
        monkeypatch.setenv("NOTIFY_ALLOWLIST", "rldtech.com.au")
        result = run(notify.send_email("stranger@gmail.com", "s", "h", "t"))
        assert result.ok is False and "NOTIFY_ALLOWLIST" in result.error


class TestSms:
    def test_email_address_is_not_a_mobile(self, monkeypatch):
        monkeypatch.setenv("NOTIFY_SMS_DRIVER", "console")
        result = run(notify.send_sms("dave@gmail.com", "hi"))
        assert result.ok is False and "not a mobile number" in result.error

    def test_console_sms_succeeds(self, monkeypatch):
        monkeypatch.setenv("NOTIFY_SMS_DRIVER", "console")
        monkeypatch.delenv("NOTIFY_ALLOWLIST", raising=False)
        result = run(notify.send_sms("0400000000", "hi"))
        assert result.ok is True
