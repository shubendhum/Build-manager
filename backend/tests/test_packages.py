"""Backend tests for BuildManager VIC — Phase A work packages.

Self-fixturing: creates its own project, trades and packages, and deletes the
project at teardown (which now cascades every project-scoped collection). Does
NOT depend on the demo seed data.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:3080").rstrip("/")
API = f"{BASE_URL}/api"
CREDS = {"email": "pm@rldtech.com.au", "password": "SitePM-2026"}
T = 20


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=CREDS, timeout=T)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def project_id(session, trades):  # noqa: ARG001 — ordering: trades outlive the project
    r = session.post(f"{API}/projects", timeout=T, json={
        "name": f"PKGTEST {uuid.uuid4().hex[:8]}",
        "client_name": "Test Client",
        "site_suburb": "Ballarat", "site_postcode": "3350",
        "contract_value": 500000,
    })
    assert r.status_code in (200, 201), r.text
    pid = r.json()["id"]
    yield pid
    session.delete(f"{API}/projects/{pid}", timeout=T)


@pytest.fixture(scope="module")
def trades(session):
    made = []
    for name in ("PKGTEST Plumber A", "PKGTEST Plumber B"):
        r = session.post(f"{API}/trades", timeout=T, json={
            "business_name": f"{name} {uuid.uuid4().hex[:6]}",
            "trade_type": "plumber", "email": "pkgtest@example.com",
        })
        assert r.status_code in (200, 201), r.text
        made.append(r.json()["id"])
    yield made
    for tid in made:
        r = session.delete(f"{API}/trades/{tid}", timeout=T)
        assert r.status_code == 200, f"test trade left behind: {r.text}"


def make_package(session, project_id, **over):
    body = {"title": f"Package {uuid.uuid4().hex[:6]}", "trade_type": "plumber",
            "stage_key": "lockup", "scope": "Test scope."}
    body.update(over)
    r = session.post(f"{API}/projects/{project_id}/packages", json=body, timeout=T)
    assert r.status_code in (200, 201), r.text
    return r.json()


def make_quote(session, project_id, package_id, trade_id, amount):
    r = session.post(f"{API}/projects/{project_id}/quotes", timeout=T, json={
        "work_package": "ignored — package_id wins",
        "package_id": package_id, "trade_id": trade_id, "stage_key": "lockup",
        "amount_ex_gst": amount, "gst_amount": amount * 0.1, "total_inc_gst": amount * 1.1,
    })
    assert r.status_code in (200, 201), r.text
    return r.json()


class TestPackageCrud:
    def test_create_and_list(self, session, project_id):
        pkg = make_package(session, project_id, title="Roof plumbing")
        assert pkg["status"] == "draft"
        assert pkg["quote_count"] == 0 and pkg["invited_count"] == 0
        r = session.get(f"{API}/projects/{project_id}/packages", timeout=T)
        assert r.status_code == 200
        assert any(p["id"] == pkg["id"] for p in r.json())

    def test_blank_title_rejected(self, session, project_id):
        r = session.post(f"{API}/projects/{project_id}/packages", json={"title": "   "}, timeout=T)
        assert r.status_code == 400

    def test_bad_stage_key_rejected(self, session, project_id):
        r = session.post(f"{API}/projects/{project_id}/packages",
                         json={"title": "X", "stage_key": "not-a-stage"}, timeout=T)
        assert r.status_code == 400
        assert "stage_key" in r.json()["detail"]

    def test_bad_trade_type_rejected(self, session, project_id):
        r = session.post(f"{API}/projects/{project_id}/packages",
                         json={"title": "X", "trade_type": "astronaut"}, timeout=T)
        assert r.status_code == 400
        assert "trade_type" in r.json()["detail"]

    def test_bad_status_rejected(self, session, project_id):
        pkg = make_package(session, project_id)
        r = session.put(f"{API}/packages/{pkg['id']}", json={"status": "nonsense"}, timeout=T)
        assert r.status_code == 400

    def test_update(self, session, project_id):
        pkg = make_package(session, project_id)
        r = session.put(f"{API}/packages/{pkg['id']}", json={"title": "Renamed", "status": "in-progress"}, timeout=T)
        assert r.status_code == 200
        assert r.json()["title"] == "Renamed" and r.json()["status"] == "in-progress"

    def test_delete_unreferenced(self, session, project_id):
        pkg = make_package(session, project_id)
        assert session.delete(f"{API}/packages/{pkg['id']}", timeout=T).status_code == 200
        assert session.put(f"{API}/packages/{pkg['id']}", json={"title": "x"}, timeout=T).status_code == 404

    def test_delete_blocked_while_quoted(self, session, project_id, trades):
        pkg = make_package(session, project_id)
        quote = make_quote(session, project_id, pkg["id"], trades[0], 1000)
        r = session.delete(f"{API}/packages/{pkg['id']}", timeout=T)
        assert r.status_code == 400
        assert "referenced by" in r.json()["detail"]
        session.delete(f"{API}/quotes/{quote['id']}", timeout=T)

    def test_quote_rejects_unknown_package(self, session, project_id, trades):
        r = session.post(f"{API}/projects/{project_id}/quotes", timeout=T, json={
            "work_package": "x", "package_id": str(uuid.uuid4()), "trade_id": trades[0],
            "stage_key": "lockup", "amount_ex_gst": 1, "gst_amount": 0, "total_inc_gst": 1,
        })
        assert r.status_code == 404


class TestAcceptScoping:
    """The regression that matters most: accepting in one package must not touch another."""

    def test_accept_rejects_only_within_its_package(self, session, project_id, trades):
        pkg_a = make_package(session, project_id, title="Package A")
        pkg_b = make_package(session, project_id, title="Package B")
        a1 = make_quote(session, project_id, pkg_a["id"], trades[0], 1000)
        a2 = make_quote(session, project_id, pkg_a["id"], trades[1], 1200)
        b1 = make_quote(session, project_id, pkg_b["id"], trades[0], 2000)
        b2 = make_quote(session, project_id, pkg_b["id"], trades[1], 2200)

        r = session.post(f"{API}/quotes/{a1['id']}/accept", timeout=T)
        assert r.status_code == 200
        assert r.json()["rejected_count"] == 1, "should reject only the sibling in package A"

        by_id = {q["id"]: q for q in session.get(f"{API}/projects/{project_id}/quotes", timeout=T).json()}
        assert by_id[a1["id"]]["status"] == "accepted"
        assert by_id[a2["id"]]["status"] == "rejected"
        assert by_id[b1["id"]]["status"] == "pending", "package B must be untouched"
        assert by_id[b2["id"]]["status"] == "pending", "package B must be untouched"

    def test_accept_awards_the_package(self, session, project_id, trades):
        pkg = make_package(session, project_id, title="Award me")
        quote = make_quote(session, project_id, pkg["id"], trades[0], 5000)
        session.post(f"{API}/quotes/{quote['id']}/accept", timeout=T)
        got = next(p for p in session.get(f"{API}/projects/{project_id}/packages", timeout=T).json()
                   if p["id"] == pkg["id"])
        assert got["status"] == "awarded"
        assert got["awarded_amount"] == pytest.approx(5500.0)


class TestCoverage:
    def test_coverage_arithmetic(self, session, trades):
        s = session
        r = s.post(f"{API}/projects", timeout=T, json={
            "name": f"COVTEST {uuid.uuid4().hex[:8]}", "client_name": "C",
            "site_suburb": "Ballarat", "site_postcode": "3350",
        })
        pid = r.json()["id"]
        try:
            quoted = make_package(s, pid, title="Quoted only")
            awarded = make_package(s, pid, title="Awarded")
            make_package(s, pid, title="Untouched")

            make_quote(s, pid, quoted["id"], trades[0], 1000)
            win = make_quote(s, pid, awarded["id"], trades[0], 2000)
            s.post(f"{API}/quotes/{win['id']}/accept", timeout=T)

            cov = s.get(f"{API}/projects/{pid}/packages/coverage", timeout=T).json()
            assert cov["package_count"] == 3
            assert cov["priced_count"] == 2
            assert cov["priced_pct"] == pytest.approx(66.7, abs=0.1)
            assert cov["committed_count"] == 1
            assert cov["committed_pct"] == pytest.approx(33.3, abs=0.1)
            assert cov["committed_total"] == pytest.approx(2200.0)
            assert [u["title"] for u in cov["unquoted"]] == ["Untouched"]
        finally:
            s.delete(f"{API}/projects/{pid}", timeout=T)

    def test_budget_groups_by_package(self, session, project_id, trades):
        pkg = make_package(session, project_id, title="Budget grouping check")
        quote = make_quote(session, project_id, pkg["id"], trades[0], 3000)
        session.post(f"{API}/quotes/{quote['id']}/accept", timeout=T)
        budget = session.get(f"{API}/projects/{project_id}/budget", timeout=T).json()
        row = next((w for w in budget["by_work_package"] if w.get("package_id") == pkg["id"]), None)
        assert row is not None, "budget must group by package_id"
        assert row["work_package"] == "Budget grouping check", "label comes from the package record"


class TestProjectCascade:
    def test_delete_project_removes_packages(self, session, trades):
        r = session.post(f"{API}/projects", timeout=T, json={
            "name": f"CASCADE {uuid.uuid4().hex[:8]}", "client_name": "C",
            "site_suburb": "Ballarat", "site_postcode": "3350",
        })
        pid = r.json()["id"]
        pkg = make_package(session, pid, title="Doomed")
        make_quote(session, pid, pkg["id"], trades[0], 100)
        assert session.delete(f"{API}/projects/{pid}", timeout=T).status_code == 200
        assert session.get(f"{API}/projects/{pid}/packages", timeout=T).status_code == 404
