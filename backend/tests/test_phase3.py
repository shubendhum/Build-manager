"""Phase 3 backend tests: Rate Guide, Cost Estimator, Budget, Dashboard."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
EMAIL = "pm@rldtech.com.au"
PASSWORD = "SitePM-2026"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def demo_project_id(client):
    r = client.get(f"{BASE_URL}/api/projects")
    assert r.status_code == 200
    seed = next((p for p in r.json() if "Ballarat West" in p["name"]), None)
    if not seed:
        pytest.skip("seeded demo job not present — these assert the seed's own contents")
    return seed["id"]


# ---------------- Auth guard ----------------
def test_rates_unauth():
    r = requests.get(f"{BASE_URL}/api/rates")
    assert r.status_code == 401


# ---------------- Rates ----------------
class TestRates:
    def test_list_17_sorted(self, client):
        r = client.get(f"{BASE_URL}/api/rates")
        assert r.status_code == 200
        rates = r.json()
        ref = [x for x in rates if x.get("is_reference")]
        assert len(ref) == 17
        # First by sort_order == Bricklaying
        assert rates[0]["work_item"] == "Bricklaying"
        assert rates[0]["supply_install_low"] == 1300
        assert rates[0]["supply_install_high"] == 2000

    def test_crud_custom_rate(self, client):
        payload = {"work_item": "TEST Custom Rate", "trade_type": "tiler", "unit": "per m²",
                   "supply_install_low": 10, "supply_install_high": 20, "notes": "test"}
        r = client.post(f"{BASE_URL}/api/rates", json=payload)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        assert r.json()["is_reference"] is False

        # Edit
        r2 = client.put(f"{BASE_URL}/api/rates/{rid}", json={"notes": "updated"})
        assert r2.status_code == 200
        assert r2.json()["notes"] == "updated"

        # Delete
        r3 = client.delete(f"{BASE_URL}/api/rates/{rid}")
        assert r3.status_code == 200

    def test_invalid_trade_type(self, client):
        r = client.post(f"{BASE_URL}/api/rates",
                        json={"work_item": "Bad", "trade_type": "not-a-trade"})
        assert r.status_code == 400

    def test_reset(self, client):
        # Create a custom then reset
        r = client.post(f"{BASE_URL}/api/rates",
                        json={"work_item": "TEST reset check", "trade_type": "other"})
        assert r.status_code == 200
        r2 = client.post(f"{BASE_URL}/api/rates/reset")
        assert r2.status_code == 200
        data = r2.json()
        assert len(data) == 17
        assert all(x["is_reference"] for x in data)


# ---------------- Estimates ----------------
class TestEstimates:
    def test_summary(self, client, demo_project_id):
        r = client.get(f"{BASE_URL}/api/projects/{demo_project_id}/estimate")
        assert r.status_code == 200
        data = r.json()
        assert len(data["lines"]) == 10
        s = data["summary"]
        assert s["subtotal_ex_gst"] == 403830
        assert s["gst"] == 40383
        assert s["contingency_pct"] == 12.5
        assert s["contingency_amount"] == 50478.75
        assert s["grand_total"] == 494691.75
        assert s["contract_value"] == 620000
        assert s["margin"] == 125308.25
        assert s["margin_pct"] == 20.2

    def test_line_crud(self, client, demo_project_id):
        r = client.post(f"{BASE_URL}/api/projects/{demo_project_id}/estimate/lines",
                        json={"description": "TEST line", "stage_key": "base",
                              "quantity": 10, "unit": "ea", "rate": 50, "gst_applicable": True})
        assert r.status_code == 200
        line = r.json()
        assert line["line_total"] == 500
        lid = line["id"]

        # Edit
        r2 = client.put(f"{BASE_URL}/api/estimate-lines/{lid}", json={"quantity": 20})
        assert r2.status_code == 200
        assert r2.json()["line_total"] == 1000

        # Delete
        r3 = client.delete(f"{BASE_URL}/api/estimate-lines/{lid}")
        assert r3.status_code == 200

        # Verify count back to 10
        r4 = client.get(f"{BASE_URL}/api/projects/{demo_project_id}/estimate")
        assert len(r4.json()["lines"]) == 10

    def test_validation_errors(self, client, demo_project_id):
        # negative qty
        r = client.post(f"{BASE_URL}/api/projects/{demo_project_id}/estimate/lines",
                        json={"description": "x", "stage_key": "base", "quantity": -1, "rate": 5})
        assert r.status_code == 400
        # bad stage
        r = client.post(f"{BASE_URL}/api/projects/{demo_project_id}/estimate/lines",
                        json={"description": "x", "stage_key": "nope", "quantity": 1, "rate": 5})
        assert r.status_code == 400

    def test_settings_and_restore(self, client, demo_project_id):
        # Set 15 -> summary changes
        r = client.put(f"{BASE_URL}/api/projects/{demo_project_id}/estimate/settings",
                       json={"contingency_pct": 15})
        assert r.status_code == 200
        assert r.json()["summary"]["contingency_pct"] == 15

        # Out-of-range
        r2 = client.put(f"{BASE_URL}/api/projects/{demo_project_id}/estimate/settings",
                        json={"contingency_pct": 60})
        assert r2.status_code == 400

        # Restore to 12.5
        r3 = client.put(f"{BASE_URL}/api/projects/{demo_project_id}/estimate/settings",
                        json={"contingency_pct": 12.5})
        assert r3.status_code == 200
        assert r3.json()["summary"]["grand_total"] == 494691.75


# ---------------- Budget ----------------
class TestBudget:
    def test_budget(self, client, demo_project_id):
        r = client.get(f"{BASE_URL}/api/projects/{demo_project_id}/budget")
        assert r.status_code == 200
        b = r.json()
        by_stage = {s["stage_key"]: s for s in b["by_stage"]}
        # Lockup
        assert by_stage["lockup"]["committed"] == 31240
        assert by_stage["lockup"]["invoiced"] == 18700
        assert by_stage["lockup"]["paid"] == 10000
        # Unallocated
        assert by_stage["unallocated"]["invoiced"] == 44660
        assert by_stage["unallocated"]["paid"] == 20460

        wp = {w["work_package"]: w for w in b["by_work_package"]}
        # Find electrical
        elec_keys = [k for k in wp if "lectrical" in k]
        assert elec_keys, f"no electrical WP in {list(wp)}"
        elec = wp[elec_keys[0]]
        assert elec["committed"] == 31240
        assert elec["invoiced"] == 18700
        assert elec["paid"] == 10000
        # Plumbing pending -> committed 0
        plumb_keys = [k for k in wp if "lumbing" in k]
        if plumb_keys:
            assert wp[plumb_keys[0]]["committed"] == 0

        t = b["totals"]
        assert t["estimated"] == 444213
        assert t["estimate_with_contingency"] == 494691.75
        assert t["committed"] == 31240
        assert t["invoiced"] == 63360
        assert t["paid"] == 30460
        assert t["exposure"] == 75900
        assert t["health"] == "under"


# ---------------- Dashboard ----------------
class TestDashboard:
    def test_dashboard(self, client, demo_project_id):
        r = client.get(f"{BASE_URL}/api/dashboard")
        assert r.status_code == 200
        d = r.json()
        # Portfolio
        pf = next((p for p in d["portfolio"] if p["id"] == demo_project_id), None)
        assert pf is not None
        assert pf["budget_health"] == "under"
        assert pf["progress"] == 13

        # Inspections
        titles = [i["title"] for i in d["inspections"]]
        wp = next((i for i in d["inspections"] if "aterproofing" in i["title"]), None)
        assert wp and wp["is_overdue"] is True and wp["days_until"] == -3
        fr = next((i for i in d["inspections"] if "rame" in i["title"] and "nspection" in i["title"].lower() or "approval" in i["title"].lower()), None)
        # Fallback: search for frame inspection
        frame = next((i for i in d["inspections"] if "rame" in i["title"] and i.get("days_until") == 5), None)
        assert frame is not None, f"frame inspection missing in {titles}"
        # First entry should be overdue (waterproofing sorted first)
        assert d["inspections"][0]["is_overdue"] is True

        # Overdue invoices
        oi = d["overdue_invoices"]
        assert oi["count"] == 1
        assert oi["total_balance"] == 8700
        assert oi["items"][0]["invoice_number"] == "INV-0871"

        # Trade warnings
        assert any("JT Plumbing" in w["business_name"] for w in d["trade_warnings"])

        # Upcoming tasks — overdue framing
        assert any("raming" in t["title"] and t.get("is_overdue") for t in d["upcoming_tasks"])

        # Claims snapshot
        snap = next((c for c in d["claims_snapshot"] if c["project_id"] == demo_project_id), None)
        assert snap and snap["next_unclaimed"]["stage_label"] == "Lockup"
        assert snap["next_unclaimed"]["amount"] == 217000
