"""Tests for the gate on files that arrive from outside.

The magic-byte and configuration checks are pure and always run. The scanning
tests need clamd and skip cleanly without it, so the suite stays green on a
machine that has no scanner.
"""
import asyncio

import pytest

import antivirus

# The industry-standard harmless test string every scanner recognises. Split so
# this file is not itself flagged by a scanner reading the repository.
EICAR = (r"X5O!P%@AP[4\PZX54(P^)7CC)7}$" + "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!" + r"$H+H*").encode()
REAL_PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
REAL_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def run(coro):
    return asyncio.run(coro)


scanner = pytest.mark.skipif(not run(antivirus.available()),
                             reason="clamd not reachable")


class TestMagicBytes:
    """A Content-Type is a claim by the sender, not a fact."""

    def test_real_pdf_accepted(self):
        assert antivirus.looks_like("application/pdf", REAL_PDF) is True

    def test_executable_named_pdf_rejected(self):
        assert antivirus.looks_like("application/pdf", b"MZ\x90\x00 exe") is False

    def test_html_named_pdf_rejected(self):
        assert antivirus.looks_like("application/pdf", b"<html><script>") is False

    def test_real_png_accepted(self):
        assert antivirus.looks_like("image/png", REAL_PNG) is True

    def test_png_bytes_claiming_to_be_jpeg_rejected(self):
        assert antivirus.looks_like("image/jpeg", REAL_PNG) is False

    def test_unknown_type_is_not_second_guessed(self):
        assert antivirus.looks_like("application/octet-stream", b"anything") is True


class TestStoragePolicy:
    def test_clean_may_be_stored(self):
        r = antivirus.ScanResult(status="clean", scanned_at="now")
        assert r.safe_to_store is True

    def test_infected_may_never_be_stored(self, monkeypatch):
        r = antivirus.ScanResult(status="infected", signature="X", scanned_at="now")
        monkeypatch.setenv("ANTIVIRUS_REQUIRED", "false")
        assert r.safe_to_store is False, "an infected file is refused whatever the config says"

    def test_unscanned_refused_when_scanning_is_required(self, monkeypatch):
        monkeypatch.setenv("ANTIVIRUS_REQUIRED", "true")
        assert antivirus.ScanResult(status="unscanned", scanned_at="now").safe_to_store is False

    def test_unscanned_allowed_when_explicitly_relaxed(self, monkeypatch):
        monkeypatch.setenv("ANTIVIRUS_REQUIRED", "false")
        assert antivirus.ScanResult(status="unscanned", scanned_at="now").safe_to_store is True

    def test_required_is_the_default(self, monkeypatch):
        monkeypatch.delenv("ANTIVIRUS_REQUIRED", raising=False)
        assert antivirus.required() is True, "the safe behaviour must not need configuring"


class TestUnreachableScanner:
    def test_reports_unscanned_rather_than_raising(self, monkeypatch):
        monkeypatch.setenv("CLAMAV_HOST", "127.0.0.1")
        monkeypatch.setenv("CLAMAV_PORT", "1")      # nothing listens here
        r = run(antivirus.scan(REAL_PDF))
        assert r.status == "unscanned"
        assert "unreachable" in (r.detail or "").lower()


@scanner
class TestRealScan:
    def test_eicar_is_detected(self):
        r = run(antivirus.scan(EICAR))
        assert r.status == "infected"
        assert "Eicar" in (r.signature or "")
        assert r.safe_to_store is False

    def test_clean_pdf_passes(self):
        assert run(antivirus.scan(REAL_PDF)).status == "clean"

    def test_empty_file_is_clean(self):
        assert run(antivirus.scan(b"")).status == "clean"

    def test_gate_rejects_a_disguised_executable_without_scanning(self):
        r = run(antivirus.check_incoming(b"MZ\x90\x00", "application/pdf", "quote.pdf"))
        assert r.status == "infected"
        assert r.signature == "Content-Type mismatch"

    def test_gate_passes_a_real_pdf(self):
        assert run(antivirus.check_incoming(REAL_PDF, "application/pdf", "quote.pdf")).status == "clean"
