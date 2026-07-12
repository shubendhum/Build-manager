"""Backend tests for BuildManager VIC — Trade quote portal (RFQs).

Uses seeded user pm@rldtech.com.au / SitePM-2026 and seeded project 'Residence - Ballarat West'.
Public endpoints are exercised WITHOUT auth.
"""
import os
import io
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api"
CREDS = {"email": "pm@rldtech.com.au", "password": "SitePM-2026"}


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
    p = next(x for x in r.json() if x["name"] == "Residence – Ballarat West")
    return p["id"]


@pytest.fixture(scope="module")
def trade_id(session):
    r = session.get(f"{API}/trades", timeout=15)
    assert r.status_code == 200
    return r.json()[0]["id"]


@pytest.fixture(scope="module")
def rfq(session, project_id, trade_id):
    payload = {"trade_id": trade_id, "scope": "TEST_RFQ Supply and fix plasterboard\nWalls and ceilings throughout.",
               "stage_key": "fixing", "due_date": "2026-08-01"}
    r = session.post(f"{API}/projects/{project_id}/rfqs", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    yield data
    # Teardown: remove RFQ and any portal quote it produced
    session.post(f"{API}/rfqs/{data['id']}/close", timeout=15)
    quotes = session.get(f"{API}/projects/{project_id}/quotes", timeout=15).json()
    for q in quotes:
        if q.get("rfq_id") == data["id"]:
            session.delete(f"{API}/quotes/{q['id']}", timeout=15)
    # rfq docs themselves have no delete endpoint; closed is terminal.


class TestRfqAuthed:
    def test_create_returns_token(self, rfq):
        assert rfq["status"] == "sent"
        assert len(rfq["token"]) >= 24
        assert rfq["trade_name"]

    def test_unauth_create_401(self, project_id, trade_id):
        r = requests.post(f"{API}/projects/{project_id}/rfqs",
                          json={"trade_id": trade_id, "scope": "x"}, timeout=15)
        assert r.status_code == 401

    def test_create_bad_trade_404(self, session, project_id):
        r = session.post(f"{API}/projects/{project_id}/rfqs",
                         json={"trade_id": "nope", "scope": "x"}, timeout=15)
        assert r.status_code == 404

    def test_create_empty_scope_400(self, session, project_id, trade_id):
        r = session.post(f"{API}/projects/{project_id}/rfqs",
                         json={"trade_id": trade_id, "scope": "   "}, timeout=15)
        assert r.status_code == 400

    def test_list_includes_rfq(self, session, project_id, rfq):
        r = session.get(f"{API}/projects/{project_id}/rfqs", timeout=15)
        assert r.status_code == 200
        assert any(x["id"] == rfq["id"] for x in r.json())


class TestRfqPublicFlow:
    def test_public_get_no_auth(self, rfq):
        r = requests.get(f"{API}/public/rfqs/{rfq['token']}", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "Ballarat" in (data["site_address"] or "") or data["project_name"]
        assert data["scope"].startswith("TEST_RFQ")
        assert data["due_date"] == "2026-08-01"

    def test_public_get_unknown_404(self):
        r = requests.get(f"{API}/public/rfqs/not-a-real-token", timeout=15)
        assert r.status_code == 404

    def test_submit_creates_portal_quote(self, session, project_id, rfq):
        form = {"amount_ex_gst": "12500", "gst_amount": "1250", "inclusions": "All materials",
                "exclusions": "Painting", "lead_time": "2 weeks",
                "contact_name": "Test Trade", "contact_phone": "0400 000 000",
                "contact_email": "trade@example.com"}
        files = {"attachment": ("quote.pdf", io.BytesIO(b"%PDF-1.4 test"), "application/pdf")}
        r = requests.post(f"{API}/public/rfqs/{rfq['token']}/submit", data=form, files=files, timeout=30)
        assert r.status_code == 200, r.text
        quote_id = r.json()["quote_id"]

        # Appears in the authed project quotes list, badged as portal submission
        quotes = session.get(f"{API}/projects/{project_id}/quotes", timeout=15).json()
        q = next(x for x in quotes if x["id"] == quote_id)
        assert q["status"] == "submitted"
        assert q["source"] == "portal"
        assert q["total_inc_gst"] == 13750.0
        assert q["stage_key"] == "fixing"
        assert q["attachment"]["filename"] == "quote.pdf"

        # RFQ flips to submitted
        rfqs = session.get(f"{API}/projects/{project_id}/rfqs", timeout=15).json()
        mine = next(x for x in rfqs if x["id"] == rfq["id"])
        assert mine["status"] == "submitted"
        assert mine["submitted_quote_id"] == quote_id

    def test_second_submission_409(self, rfq):
        form = {"amount_ex_gst": "1", "gst_amount": "0.1", "contact_name": "Again"}
        r = requests.post(f"{API}/public/rfqs/{rfq['token']}/submit", data=form, timeout=15)
        assert r.status_code == 409

    def test_closed_rfq_410(self, session, project_id, trade_id):
        r = session.post(f"{API}/projects/{project_id}/rfqs",
                         json={"trade_id": trade_id, "scope": "TEST_RFQ closing"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        r2 = session.post(f"{API}/rfqs/{data['id']}/close", timeout=15)
        assert r2.status_code == 200
        r3 = requests.get(f"{API}/public/rfqs/{data['token']}", timeout=15)
        assert r3.status_code == 410
        r4 = requests.post(f"{API}/public/rfqs/{data['token']}/submit",
                           data={"amount_ex_gst": "1", "gst_amount": "0", "contact_name": "x"}, timeout=15)
        assert r4.status_code == 410
