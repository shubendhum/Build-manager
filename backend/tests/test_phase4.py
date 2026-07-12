"""Backend tests for BuildManager VIC Phase 4 - Documents, Site Diary PDF, Estimate PDF, Photo delete.

Uses seeded user pm@buildmanagervic.com.au / SitePM-2026 and project 'Residence - Ballarat West'.
Does NOT call the real LLM (no photo analyze here — that's test_photos.py).
"""
import os
import io
import uuid
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api"
CREDS = {"email": "pm@buildmanagervic.com.au", "password": "SitePM-2026"}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=CREDS, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def project_id(session):
    r = session.get(f"{API}/projects", timeout=15)
    assert r.status_code == 200
    p = next(x for x in r.json() if x["name"] == "Residence \u2013 Ballarat West")
    return p["id"]


# ---------- Documents ----------
class TestDocuments:
    def test_unauth_list_401(self, project_id):
        r = requests.get(f"{API}/projects/{project_id}/documents", timeout=15)
        assert r.status_code == 401

    def test_list_seeded_documents(self, session, project_id):
        r = session.get(f"{API}/projects/{project_id}/documents", timeout=15)
        assert r.status_code == 200
        docs = r.json()
        assert len(docs) >= 3, f"Expected >=3 seeded documents, got {len(docs)}"
        titles = [d["title"] for d in docs]
        # Spot-check seeded docs
        assert any("Building Permit" in t or "BP-2025-04471" in t for t in titles), f"Building Permit missing: {titles}"
        assert any("Insurance" in t or "DBI" in t for t in titles), f"Insurance doc missing: {titles}"
        assert any("Drawings" in t or "Working" in t for t in titles), f"Working Drawings missing: {titles}"
        cats = {d["category"] for d in docs}
        assert {"permits", "insurance", "drawings"}.issubset(cats), f"Missing categories: {cats}"

    def test_upload_download_delete_roundtrip(self, session, project_id):
        content = b"TEST document content for Phase 4 verification.\nline 2.\n"
        files = {"file": ("TEST_doc.txt", content, "text/plain")}
        data = {"title": "TEST_Phase4_Doc", "category": "other", "notes": "created by test agent"}
        r = session.post(f"{API}/projects/{project_id}/documents", files=files, data=data, timeout=30)
        assert r.status_code in (200, 201), r.text
        doc = r.json()
        assert doc["title"] == "TEST_Phase4_Doc"
        assert doc["category"] == "other"
        doc_id = doc["id"]

        # verify it appears in listing
        r2 = session.get(f"{API}/projects/{project_id}/documents", timeout=15)
        assert any(d["id"] == doc_id for d in r2.json())

        # download
        r3 = session.get(f"{API}/documents/{doc_id}/download", timeout=15)
        assert r3.status_code == 200
        assert r3.content == content
        cd = r3.headers.get("content-disposition", "")
        assert "attachment" in cd.lower()

        # delete
        r4 = session.delete(f"{API}/documents/{doc_id}", timeout=15)
        assert r4.status_code in (200, 204)

        # verify gone
        r5 = session.get(f"{API}/documents/{doc_id}/download", timeout=15)
        assert r5.status_code == 404

    def test_invalid_category_400(self, session, project_id):
        files = {"file": ("TEST_x.txt", b"x", "text/plain")}
        data = {"title": "TEST_bad_cat", "category": "not-a-category", "notes": ""}
        r = session.post(f"{API}/projects/{project_id}/documents", files=files, data=data, timeout=15)
        assert r.status_code == 400, r.text

    def test_invalid_extension_400(self, session, project_id):
        files = {"file": ("TEST_bad.exe", b"MZ\x90\x00" + b"x" * 100, "application/octet-stream")}
        data = {"title": "TEST_bad_ext", "category": "other", "notes": ""}
        r = session.post(f"{API}/projects/{project_id}/documents", files=files, data=data, timeout=15)
        assert r.status_code == 400, r.text


# ---------- Site Diary PDF ----------
class TestSiteDiaryPDF:
    def test_export_default_range(self, session, project_id):
        r = session.get(f"{API}/projects/{project_id}/site-diary.pdf", timeout=60)
        assert r.status_code == 200, r.text[:200]
        assert r.headers.get("content-type", "").startswith("application/pdf")
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd.lower()
        assert r.content[:4] == b"%PDF"
        # Reasonable size (has photos embedded)
        assert len(r.content) > 10000, f"PDF too small: {len(r.content)} bytes"

    def test_bad_date_format_400(self, session, project_id):
        r = session.get(f"{API}/projects/{project_id}/site-diary.pdf",
                        params={"date_from": "12-02-2026"}, timeout=15)
        assert r.status_code == 400, r.text[:200]

    def test_empty_range_400(self, session, project_id):
        r = session.get(f"{API}/projects/{project_id}/site-diary.pdf",
                        params={"date_from": "2030-01-01"}, timeout=15)
        assert r.status_code == 400, r.text[:200]

    def test_unauth_401(self, project_id):
        r = requests.get(f"{API}/projects/{project_id}/site-diary.pdf", timeout=15)
        assert r.status_code == 401


# ---------- Estimate PDF ----------
class TestEstimatePDF:
    def test_export_estimate(self, session, project_id):
        r = session.get(f"{API}/projects/{project_id}/estimate.pdf", timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"
        assert len(r.content) > 2000

    def test_unauth_401(self, project_id):
        r = requests.get(f"{API}/projects/{project_id}/estimate.pdf", timeout=15)
        assert r.status_code == 401


# ---------- Photo delete ----------
class TestPhotoDelete:
    def test_delete_bogus_photo_404(self, session):
        r = session.delete(f"{API}/photos/bogus-photo-id-{uuid.uuid4().hex[:8]}", timeout=15)
        assert r.status_code == 404

    def test_delete_unauth_401(self):
        r = requests.delete(f"{API}/photos/any-id", timeout=15)
        assert r.status_code == 401


# ---------- Seed idempotency (Phase 4 collections) ----------
class TestSeedIdempotencyPhase4:
    def test_document_and_analysis_counts_stable(self, session, project_id):
        # Snapshot counts
        docs1 = session.get(f"{API}/projects/{project_id}/documents", timeout=15).json()
        photos1 = session.get(f"{API}/photos", params={"project_id": project_id}, timeout=15).json()
        # Should be 3 seeded docs (may include our TEST cleanup already), and >=4 seeded analyses for project
        seed_docs = [d for d in docs1 if not d["title"].startswith("TEST_")]
        assert len(seed_docs) == 3, f"Expected 3 seed docs, got {len(seed_docs)}: {[d['title'] for d in seed_docs]}"
        # Note: gallery may have 5 photos (4 seeded + 1 real from earlier iteration testing)
        assert len(photos1) >= 4, f"Expected >=4 photos for project, got {len(photos1)}"
