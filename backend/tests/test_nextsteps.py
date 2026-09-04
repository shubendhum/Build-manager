"""Backend tests for BuildManager VIC — the "what to do next" engine.

Self-fixturing; walks a project through the procurement sequence and asserts the
advice changes with the state. Runs against the console notify driver.
"""
import io
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:3080").rstrip("/")
API = f"{BASE_URL}/api"
CREDS = {"email": "pm@rldtech.com.au", "password": "SitePM-2026"}
T = 30
PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=CREDS, timeout=T)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def trades(session):
    made = []
    for label, email in (("A", "nsa@example.com"), ("B", "nsb@example.com")):
        r = session.post(f"{API}/trades", timeout=T, json={
            "business_name": f"NSTEST {label} {uuid.uuid4().hex[:6]}",
            "trade_type": "plumber", "email": email,
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
        "name": f"NSTEST {uuid.uuid4().hex[:8]}", "client_name": "C",
        "site_suburb": "Ballarat", "site_postcode": "3350",
    })
    assert r.status_code in (200, 201), r.text
    pid = r.json()["id"]
    yield pid
    session.delete(f"{API}/projects/{pid}", timeout=T)


def steps(session, project_id):
    r = session.get(f"{API}/projects/{project_id}/next-steps", timeout=T)
    assert r.status_code == 200, r.text
    return r.json()


def ids(payload):
    return [a["id"] for a in payload["actions"]]


class TestSequence:
    def test_empty_project_asks_for_drawings(self, session, project_id):
        assert "upload-drawings" in ids(steps(session, project_id))

    def test_drawings_then_asks_to_plan_or_package(self, session, project_id):
        session.post(f"{API}/projects/{project_id}/documents", timeout=T,
                     files={"file": ("d.pdf", io.BytesIO(PDF), "application/pdf")},
                     data={"title": "Drawings", "category": "drawings"})
        s = steps(session, project_id)
        assert "upload-drawings" not in ids(s)
        assert "Drawings uploaded" in s["done"]
        # With drawings and no plan, the planner is the suggested next move.
        assert "run-planner" in ids(s)

    def test_packages_created_then_asks_to_send(self, session, project_id):
        for title in ("Plumbing", "Electrical"):
            r = session.post(f"{API}/projects/{project_id}/packages", timeout=T,
                             json={"title": title, "trade_type": "plumber", "stage_key": "lockup"})
            assert r.status_code in (200, 201)
        s = steps(session, project_id)
        send = next(a for a in s["actions"] if a["id"] == "send-packages")
        assert send["count"] == 2
        # Packages and quotes are the board now, so the badge lands there.
        assert s["badges"]["work"] == 2
        assert any("work packages defined" in d for d in s["done"])

    def test_quotes_in_becomes_a_decision(self, session, project_id, trades):
        pkg = next(p for p in session.get(f"{API}/projects/{project_id}/packages", timeout=T).json()
                   if p["title"] == "Plumbing")
        for tid, amount in ((trades[0], 1000), (trades[1], 1200)):
            session.post(f"{API}/projects/{project_id}/quotes", timeout=T, json={
                "work_package": pkg["title"], "package_id": pkg["id"], "trade_id": tid,
                "stage_key": "lockup", "amount_ex_gst": amount, "gst_amount": amount * 0.1,
                "total_inc_gst": amount * 1.1,
            })
        s = steps(session, project_id)
        decide = next(a for a in s["actions"] if a["id"] == "decide-quotes")
        assert decide["count"] == 1 and decide["severity"] == "decision"
        assert decide["tab"] == "work"
        assert "Plumbing" in decide["detail"]

    def test_awarding_clears_the_decision(self, session, project_id):
        quotes = session.get(f"{API}/projects/{project_id}/quotes", timeout=T).json()
        session.post(f"{API}/quotes/{quotes[0]['id']}/accept", timeout=T)
        s = steps(session, project_id)
        assert "decide-quotes" not in ids(s), "awarded packages should stop asking for a decision"
        assert any("awarded" in d for d in s["done"])

    def test_urgent_sorts_above_decisions(self, session, project_id):
        """Overdue money must outrank a pending choice."""
        session.post(f"{API}/projects/{project_id}/invoices", timeout=T, json={
            "invoice_number": f"OVERDUE-{uuid.uuid4().hex[:5]}", "trade_id": None,
            "amount_ex_gst": 500, "gst_amount": 50, "total_inc_gst": 550,
            "issue_date": "2026-01-01", "due_date": "2026-01-15",
        })
        s = steps(session, project_id)
        severities = [a["severity"] for a in s["actions"]]
        assert "urgent" in severities
        assert severities.index("urgent") == 0, "urgent items must sort first"
        assert "overdue-invoices" in ids(s)


class TestShape:
    def test_unknown_project_404(self, session):
        r = session.get(f"{API}/projects/{uuid.uuid4()}/next-steps", timeout=T)
        assert r.status_code == 404

    def test_badges_only_count_actions_that_have_counts(self, session, project_id):
        s = steps(session, project_id)
        counted = sum(a["count"] for a in s["actions"] if a["count"])
        assert sum(s["badges"].values()) == counted

    def test_every_action_points_at_a_real_tab(self, session, project_id):
        # The six screens a job actually has, after the merge.
        valid = {"work", "steps", "drawings", "money", "diary", "overview"}
        for a in steps(session, project_id)["actions"]:
            assert a["tab"] in valid, f"{a['id']} points at unknown tab {a['tab']}"
