"""Backend tests for BuildManager VIC — the trade board.

Walks one package through the builder's whole loop — engage, price, award,
book, invoice, pay — and asserts the row's state and next action change at each
step. Self-fixturing; runs against the console notify driver.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:3080").rstrip("/")
API = f"{BASE_URL}/api"
CREDS = {"email": "pm@rldtech.com.au", "password": "SitePM-2026"}
T = 30


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=CREDS, timeout=T)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def trades(session):
    made = []
    for label in ("A", "B"):
        r = session.post(f"{API}/trades", timeout=T, json={
            "business_name": f"BOARDTEST {label} {uuid.uuid4().hex[:6]}",
            "trade_type": "plumber", "email": f"board{label.lower()}@example.com",
        })
        assert r.status_code in (200, 201), r.text
        made.append(r.json()["id"])
    yield made
    for tid in made:
        r = session.delete(f"{API}/trades/{tid}", timeout=T)
        assert r.status_code == 200, f"test trade left behind: {r.text}"


@pytest.fixture(scope="module")
def project_id(session, trades):  # noqa: ARG001 — ordering: trades outlive the project
    r = session.post(f"{API}/projects", timeout=T, json={
        "name": f"BOARDTEST {uuid.uuid4().hex[:8]}", "client_name": "C",
        "site_suburb": "Ballarat", "site_postcode": "3350", "builder_name": "B",
    })
    assert r.status_code in (200, 201), r.text
    pid = r.json()["id"]
    yield pid
    session.delete(f"{API}/projects/{pid}", timeout=T)


@pytest.fixture(scope="module")
def package_id(session, project_id):
    r = session.post(f"{API}/projects/{project_id}/packages", timeout=T, json={
        "title": "Plumbing", "trade_type": "plumber", "stage_key": "lockup", "scope": "Rough-in.",
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def board(session, project_id):
    r = session.get(f"{API}/projects/{project_id}/board", timeout=T)
    assert r.status_code == 200, r.text
    return r.json()


def row_for(session, project_id, package_id):
    return next(r for r in board(session, project_id)["rows"] if r["package_id"] == package_id)


class TestLoop:
    """Each step is the next thing a builder actually does."""

    def test_1_not_engaged(self, session, project_id, package_id):
        row = row_for(session, project_id, package_id)
        assert row["state"] == "not-engaged"
        assert row["next_action"]["id"] == "get-quotes"

    def test_2_asked_but_no_prices(self, session, project_id, package_id, trades):
        r = session.post(f"{API}/projects/{project_id}/rfqs", timeout=T, json={
            "package_id": package_id, "trade_ids": trades, "scope": "Rough-in.",
        })
        assert r.status_code in (200, 201), r.text
        row = row_for(session, project_id, package_id)
        assert row["state"] == "chasing"
        assert row["invited"] == 2 and row["replied"] == 0
        # Only just sent, so the action is to look at it rather than nag.
        assert row["next_action"]["id"] == "view-rfq"

    def test_3_prices_in_becomes_a_decision(self, session, project_id, package_id, trades):
        rfqs = session.get(f"{API}/projects/{project_id}/rfqs", timeout=T).json()
        rfq = next(r for r in rfqs if r["package_id"] == package_id)
        for inv, amount in zip(rfq["invitations"], (1000, 1200)):
            r = requests.post(f"{API}/public/rfqs/{inv['token']}/submit", timeout=T,
                              data={"amount_ex_gst": amount, "gst_amount": amount * 0.1,
                                    "contact_name": "Tradie"})
            assert r.status_code == 200, r.text
        row = row_for(session, project_id, package_id)
        assert row["state"] == "decide"
        assert row["next_action"]["id"] == "award"
        assert row["replied"] == 2
        assert row["best_quote"] == pytest.approx(1100.0), "cheapest live price"

    def test_4_awarded_needs_dates(self, session, project_id, package_id):
        quotes = [q for q in session.get(f"{API}/projects/{project_id}/quotes", timeout=T).json()
                  if q["package_id"] == package_id]
        cheapest = min(quotes, key=lambda q: q["total_inc_gst"])
        session.post(f"{API}/quotes/{cheapest['id']}/accept", timeout=T)
        row = row_for(session, project_id, package_id)
        assert row["state"] == "to-schedule"
        assert row["next_action"]["id"] == "schedule"
        assert row["awarded_amount"] == pytest.approx(1100.0)
        assert row["trade_name"], "the awarded tradie's name shows on the row"

    def test_5_booked_needs_invoice(self, session, project_id, package_id):
        r = session.put(f"{API}/packages/{package_id}", timeout=T,
                        json={"scheduled_start": "2026-10-14", "scheduled_end": "2026-10-18"})
        assert r.status_code == 200, r.text
        row = row_for(session, project_id, package_id)
        assert row["state"] == "booked"
        assert row["next_action"]["id"] == "invoice"
        assert row["scheduled_start"] == "2026-10-14"

    def test_6_invoiced_needs_payment(self, session, project_id, package_id, trades):
        r = session.post(f"{API}/projects/{project_id}/invoices", timeout=T, json={
            "invoice_number": f"BT-{uuid.uuid4().hex[:5]}", "trade_id": trades[0],
            "package_id": package_id, "amount_ex_gst": 1000, "gst_amount": 100,
            "total_inc_gst": 1100, "invoice_date": "2026-10-19", "due_date": "2026-11-19",
        })
        assert r.status_code in (200, 201), r.text
        row = row_for(session, project_id, package_id)
        assert row["state"] == "invoiced"
        assert row["next_action"]["id"] == "pay"
        assert row["invoiced"] == pytest.approx(1100.0)
        assert row["outstanding"] == pytest.approx(1100.0)

    def test_7_paid_closes_the_row(self, session, project_id, package_id):
        invoices = session.get(f"{API}/projects/{project_id}/invoices", timeout=T).json()
        items = invoices["invoices"] if isinstance(invoices, dict) else invoices
        inv = next(i for i in items if i.get("package_id") == package_id)
        r = session.post(f"{API}/invoices/{inv['id']}/payments", timeout=T,
                         json={"amount": 1100, "payment_date": "2026-11-01"})
        assert r.status_code in (200, 201), r.text
        row = row_for(session, project_id, package_id)
        assert row["state"] == "paid"
        assert row["next_action"] is None, "a settled row asks nothing of you"
        assert row["paid"] == pytest.approx(1100.0)
        assert row["outstanding"] == 0


class TestTotals:
    def test_totals_track_the_money(self, session, project_id):
        t = board(session, project_id)["totals"]
        assert t["committed"] == pytest.approx(1100.0)
        assert t["invoiced"] == pytest.approx(1100.0)
        assert t["paid"] == pytest.approx(1100.0)
        assert t["outstanding"] == 0
        assert t["needs_you"] == 0, "everything settled"

    def test_needs_you_counts_only_actionable_rows(self, session, project_id, trades):
        r = session.post(f"{API}/projects/{project_id}/packages", timeout=T,
                         json={"title": "Electrical", "trade_type": "electrician", "stage_key": "fixing"})
        pkg = r.json()["id"]
        session.post(f"{API}/projects/{project_id}/quotes", timeout=T, json={
            "work_package": "Electrical", "package_id": pkg, "trade_id": trades[0],
            "stage_key": "fixing", "amount_ex_gst": 500, "gst_amount": 50, "total_inc_gst": 550,
        })
        b = board(session, project_id)
        assert b["totals"]["needs_you"] == 1, "the undecided package is the only thing waiting"
        assert next(r for r in b["rows"] if r["package_id"] == pkg)["state"] == "decide"

    def test_rows_sort_actionable_first(self, session, project_id):
        states = [r["state"] for r in board(session, project_id)["rows"]]
        assert states[0] == "decide", "what needs you comes first"
        assert states[-1] == "paid", "finished work sinks"

    def test_unknown_project_404(self, session):
        assert session.get(f"{API}/projects/{uuid.uuid4()}/board", timeout=T).status_code == 404


class TestRowIsEnoughToActOn:
    """A board row is what the UI hands straight back to the RFQ endpoint when
    you press "Get quotes". If the row omits a field that endpoint requires, the
    button 422s — which is exactly what happened in production."""

    def test_row_carries_everything_the_rfq_endpoint_needs(self, session, project_id):
        row = board(session, project_id)["rows"][0]
        for field in ("package_id", "title", "scope", "stage_key", "trade_type"):
            assert field in row, f"board row is missing {field}"
        assert row["package_id"], "package_id must be populated, not just present"

    def test_creating_an_rfq_straight_from_a_row_works(self, session, project_id, trades):
        """Post using only what a row provides — no package lookup in between."""
        made = session.post(f"{API}/projects/{project_id}/packages", timeout=T, json={
            "title": "Row-to-RFQ check", "trade_type": "plumber",
            "stage_key": "lockup", "scope": "Scope carried on the row.",
        }).json()["id"]
        row = next(r for r in board(session, project_id)["rows"] if r["package_id"] == made)
        r = session.post(f"{API}/projects/{project_id}/rfqs", timeout=T, json={
            "package_id": row["package_id"],
            "trade_ids": [trades[0]],
            "scope": row["scope"] or "Scope to follow.",
            "stage_key": row["stage_key"],
            "document_ids": [],
        })
        assert r.status_code in (200, 201), f"a board row must be sufficient to raise an RFQ: {r.text}"
