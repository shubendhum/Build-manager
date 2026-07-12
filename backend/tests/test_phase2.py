"""Backend tests for BuildManager VIC Phase 2 - Trades, Quotes, Invoices, Claims.

Reuses seeded pm@rldtech.com.au / SitePM-2026 and seeded project 'Residence - Ballarat West'.
Restores all seed state at teardown.
"""
import os
import io
import uuid
import pytest
import requests
from PIL import Image

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
    seed = next((p for p in r.json() if p["name"] == "Residence \u2013 Ballarat West"), None)
    assert seed is not None
    return seed["id"]


# ---------- Trades ----------
class TestTrades:
    def test_list_seeded_trades(self, session):
        r = session.get(f"{API}/trades", timeout=15)
        assert r.status_code == 200
        trades = r.json()
        assert len(trades) >= 6, f"Expected >=6 seeded trades got {len(trades)}"
        # find JT Plumbing & Gas - expiring-soon licence
        jt = next((t for t in trades if "JT Plumbing" in t.get("business_name", "")), None)
        assert jt is not None, "JT Plumbing & Gas trade not found"
        warnings = jt.get("warnings", [])
        assert any(w["type"] == "licence" and w["level"] in ("expiring-soon", "expired") for w in warnings), \
            f"JT should have licence warning: {warnings}"

    def test_create_update_delete_trade(self, session):
        payload = {"business_name": "TEST_Sparky_" + uuid.uuid4().hex[:6], "trade_type": "electrician", "rating": 4}
        r = session.post(f"{API}/trades", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        # Update
        r2 = session.put(f"{API}/trades/{tid}", json={"rating": 5}, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["rating"] == 5
        # Delete
        r3 = session.delete(f"{API}/trades/{tid}", timeout=15)
        assert r3.status_code == 200

    def test_invalid_trade_type(self, session):
        r = session.post(f"{API}/trades", json={"business_name": "TEST_Bad", "trade_type": "bogus"}, timeout=15)
        assert r.status_code == 400

    def test_invalid_rating(self, session):
        r = session.post(f"{API}/trades", json={"business_name": "TEST_Bad2", "rating": 6}, timeout=15)
        assert r.status_code == 400

    def test_delete_referenced_trade_blocked(self, session, project_id):
        # Find a trade referenced by quotes - Ballarat Electrical Co
        trades = session.get(f"{API}/trades", timeout=15).json()
        elec = next((t for t in trades if "Electrical" in t.get("business_name", "") or "Sparky" in t.get("business_name", "")), None)
        # find any trade that's referenced
        quotes = session.get(f"{API}/projects/{project_id}/quotes", timeout=15).json()
        referenced_ids = {q["trade_id"] for q in quotes if q.get("trade_id")}
        assert referenced_ids, "No referenced trades to test"
        tid = next(iter(referenced_ids))
        r = session.delete(f"{API}/trades/{tid}", timeout=15)
        assert r.status_code == 400
        assert "referenced" in r.text.lower() or "cannot delete" in r.text.lower()

    def test_assign_unassign_trade_to_project(self, session, project_id):
        # Create fresh trade, assign, verify list, unassign
        r = session.post(f"{API}/trades", json={"business_name": "TEST_Assign_" + uuid.uuid4().hex[:6], "trade_type": "painter"}, timeout=15)
        tid = r.json()["id"]
        try:
            r2 = session.post(f"{API}/projects/{project_id}/trades", json={"trade_id": tid}, timeout=15)
            assert r2.status_code == 200
            r3 = session.get(f"{API}/projects/{project_id}/trades", timeout=15)
            assert r3.status_code == 200
            assert any(t["id"] == tid for t in r3.json())
            r4 = session.delete(f"{API}/projects/{project_id}/trades/{tid}", timeout=15)
            assert r4.status_code == 200
            r5 = session.get(f"{API}/projects/{project_id}/trades", timeout=15)
            assert not any(t["id"] == tid for t in r5.json())
        finally:
            session.delete(f"{API}/trades/{tid}", timeout=15)


# ---------- Task-Trade link ----------
class TestTaskTradeLink:
    def test_roadmap_has_trade_names(self, session, project_id):
        rm = session.get(f"{API}/projects/{project_id}/roadmap", timeout=15).json()
        tasks_with_trade = [t for s in rm["stages"] for t in s["tasks"] if t.get("trade_name")]
        assert len(tasks_with_trade) >= 3, f"Expected >=3 tasks with trade_name got {len(tasks_with_trade)}"

    def test_link_task_to_trade(self, session, project_id):
        rm = session.get(f"{API}/projects/{project_id}/roadmap", timeout=15).json()
        task = next(t for s in rm["stages"] for t in s["tasks"] if not t.get("trade_id"))
        orig_trade_id = task.get("trade_id")
        trades = session.get(f"{API}/trades", timeout=15).json()
        tid = trades[0]["id"]
        try:
            r = session.put(f"{API}/tasks/{task['id']}", json={"trade_id": tid}, timeout=15)
            assert r.status_code == 200
            rm2 = session.get(f"{API}/projects/{project_id}/roadmap", timeout=15).json()
            found = next(t for s in rm2["stages"] for t in s["tasks"] if t["id"] == task["id"])
            assert found.get("trade_id") == tid
            assert found.get("trade_name") == trades[0]["business_name"]
        finally:
            session.put(f"{API}/tasks/{task['id']}", json={"trade_id": orig_trade_id}, timeout=15)

    def test_link_task_invalid_trade(self, session, project_id):
        rm = session.get(f"{API}/projects/{project_id}/roadmap", timeout=15).json()
        task_id = rm["stages"][0]["tasks"][0]["id"]
        r = session.put(f"{API}/tasks/{task_id}", json={"trade_id": "bogus-id"}, timeout=15)
        assert r.status_code == 404


# ---------- Quotes ----------
class TestQuotes:
    def test_list_seeded_quotes(self, session, project_id):
        r = session.get(f"{API}/projects/{project_id}/quotes", timeout=15)
        assert r.status_code == 200
        quotes = r.json()
        assert len(quotes) >= 4
        assert all(q.get("trade_name") for q in quotes), "All quotes should have trade_name"

    def test_create_quote(self, session, project_id):
        trades = session.get(f"{API}/trades", timeout=15).json()
        tid = trades[0]["id"]
        payload = {
            "work_package": "TEST_WP_" + uuid.uuid4().hex[:6],
            "trade_id": tid, "stage_key": "frame",
            "amount_ex_gst": 1000, "gst_amount": 100, "total_inc_gst": 1100,
        }
        r = session.post(f"{API}/projects/{project_id}/quotes", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        qid = r.json()["id"]
        session.delete(f"{API}/quotes/{qid}", timeout=15)

    def test_invalid_stage_key(self, session, project_id):
        trades = session.get(f"{API}/trades", timeout=15).json()
        payload = {"work_package": "x", "trade_id": trades[0]["id"], "stage_key": "bogus",
                   "amount_ex_gst": 100, "gst_amount": 10, "total_inc_gst": 110}
        r = session.post(f"{API}/projects/{project_id}/quotes", json=payload, timeout=15)
        assert r.status_code == 400

    def test_accept_plumbing_quote_auto_rejects_others(self, session, project_id):
        quotes = session.get(f"{API}/projects/{project_id}/quotes", timeout=15).json()
        # Plumbing work package has 2 pending
        pending_plumbing = [q for q in quotes if q["status"] == "pending"]
        # group by work_package
        from collections import defaultdict
        groups = defaultdict(list)
        for q in pending_plumbing:
            groups[q["work_package"]].append(q)
        target_group = next((qs for qs in groups.values() if len(qs) >= 2), None)
        assert target_group is not None, "Expected a work_package with >=2 pending quotes"
        q_accept = target_group[0]
        q_other = target_group[1]
        orig_statuses = {q["id"]: q["status"] for q in target_group}
        try:
            r = session.post(f"{API}/quotes/{q_accept['id']}/accept", timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["rejected_count"] >= 1
            # verify other became rejected
            quotes2 = session.get(f"{API}/projects/{project_id}/quotes", timeout=15).json()
            other = next(q for q in quotes2 if q["id"] == q_other["id"])
            assert other["status"] == "rejected"
        finally:
            # restore to pending
            for qid, st in orig_statuses.items():
                session.put(f"{API}/quotes/{qid}", json={"status": st}, timeout=15)

    def test_quote_attachment_upload_and_get(self, session, project_id):
        # create test quote
        trades = session.get(f"{API}/trades", timeout=15).json()
        r = session.post(f"{API}/projects/{project_id}/quotes", json={
            "work_package": "TEST_Attach_" + uuid.uuid4().hex[:6],
            "trade_id": trades[0]["id"], "stage_key": "frame",
            "amount_ex_gst": 100, "gst_amount": 10, "total_inc_gst": 110,
        }, timeout=15).json()
        qid = r["id"]
        try:
            # small PNG
            buf = io.BytesIO()
            Image.new("RGB", (10, 10), (255, 0, 0)).save(buf, format="PNG")
            buf.seek(0)
            files = {"file": ("test.png", buf.read(), "image/png")}
            up = session.post(f"{API}/quotes/{qid}/attachment", files=files, timeout=15)
            assert up.status_code == 200, up.text
            # get bytes
            g = session.get(f"{API}/quotes/{qid}/attachment", timeout=15)
            assert g.status_code == 200
            assert g.headers.get("content-type", "").startswith("image/")
            assert len(g.content) > 0
        finally:
            session.delete(f"{API}/quotes/{qid}", timeout=15)


# ---------- Invoices ----------
class TestInvoices:
    def test_seeded_invoices_summary(self, session, project_id):
        r = session.get(f"{API}/projects/{project_id}/invoices", timeout=15)
        assert r.status_code == 200
        data = r.json()
        summary = data["summary"]
        assert summary["total_invoiced"] == 63360, f"total_invoiced={summary['total_invoiced']}"
        assert summary["total_paid"] == 30460, f"total_paid={summary['total_paid']}"
        assert summary["outstanding"] == 32900, f"outstanding={summary['outstanding']}"
        assert summary["overdue_count"] == 1
        # INV-0871 part-paid + overdue + balance 8700
        inv871 = next((i for i in data["invoices"] if i["invoice_number"] == "INV-0871"), None)
        assert inv871 is not None
        assert inv871["status"] == "part-paid"
        assert inv871["is_overdue"] is True
        assert inv871["balance"] == 8700

    def test_add_and_delete_payment(self, session, project_id):
        # Create a test invoice with a total, then part+full pay
        r = session.post(f"{API}/projects/{project_id}/invoices", json={
            "invoice_number": "TEST-INV-" + uuid.uuid4().hex[:6],
            "amount_ex_gst": 1000, "gst_amount": 100, "total_inc_gst": 1100,
        }, timeout=15)
        assert r.status_code == 200, r.text
        iid = r.json()["id"]
        try:
            p1 = session.post(f"{API}/invoices/{iid}/payments", json={"amount": 300}, timeout=15)
            assert p1.status_code == 200
            assert p1.json()["status"] == "part-paid"
            assert p1.json()["balance"] == 800
            pay_id = p1.json()["payments"][0]["id"]

            p2 = session.post(f"{API}/invoices/{iid}/payments", json={"amount": 800}, timeout=15)
            assert p2.json()["status"] == "paid"

            # delete first payment -> back to part-paid balance 300
            d = session.delete(f"{API}/invoices/{iid}/payments/{pay_id}", timeout=15)
            assert d.status_code == 200
            assert d.json()["status"] == "part-paid"
            assert d.json()["balance"] == 300
        finally:
            session.delete(f"{API}/invoices/{iid}", timeout=15)

    def test_zero_payment_rejected(self, session, project_id):
        r = session.post(f"{API}/projects/{project_id}/invoices", json={
            "invoice_number": "TEST-Z-" + uuid.uuid4().hex[:6],
            "amount_ex_gst": 100, "gst_amount": 10, "total_inc_gst": 110,
        }, timeout=15).json()
        iid = r["id"]
        try:
            p = session.post(f"{API}/invoices/{iid}/payments", json={"amount": 0}, timeout=15)
            assert p.status_code == 400
        finally:
            session.delete(f"{API}/invoices/{iid}", timeout=15)

    def test_quote_overrun_warning(self, session, project_id):
        # find accepted electrical quote
        quotes = session.get(f"{API}/projects/{project_id}/quotes", timeout=15).json()
        accepted = next((q for q in quotes if q["status"] == "accepted"), None)
        assert accepted is not None
        big_total = accepted["total_inc_gst"] + 20000
        r = session.post(f"{API}/projects/{project_id}/invoices", json={
            "invoice_number": "TEST-OVER-" + uuid.uuid4().hex[:6],
            "quote_id": accepted["id"],
            "amount_ex_gst": big_total / 1.1, "gst_amount": big_total - (big_total / 1.1), "total_inc_gst": big_total,
        }, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("warning"), f"Expected non-null warning: {body}"
        assert "exceed" in body["warning"].lower() or "warning" in body["warning"].lower()
        session.delete(f"{API}/invoices/{body['id']}", timeout=15)


# ---------- Claims ----------
class TestClaims:
    def test_seeded_claims(self, session, project_id):
        r = session.get(f"{API}/projects/{project_id}/claims", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert len(data["lines"]) == 6
        total = sum(l["amount"] for l in data["lines"])
        assert round(total, 2) == 620000, f"Schedule total {total}"
        s = data["summary"]
        assert s["total_claimed"] == 186000, f"total_claimed={s['total_claimed']}"
        assert s["total_paid"] == 93000, f"total_paid={s['total_paid']}"
        assert s["warning"] is None
        # Deposit + Base should be paid, Frame claimed
        by_label = {l["stage_label"]: l for l in data["lines"]}
        assert by_label["Deposit"]["status"] == "paid"
        assert by_label["Base"]["status"] == "paid"
        assert by_label["Frame"]["status"] == "claimed"

    def test_amount_change_triggers_variance_warning(self, session, project_id):
        data = session.get(f"{API}/projects/{project_id}/claims", timeout=15).json()
        line = data["lines"][0]
        orig_amount = line["amount"]
        try:
            r = session.put(f"{API}/claims/{line['id']}", json={"amount": orig_amount + 1000}, timeout=15)
            assert r.status_code == 200
            r2 = session.get(f"{API}/projects/{project_id}/claims", timeout=15).json()
            assert r2["summary"]["warning"] is not None
            assert "variance" in r2["summary"]["warning"].lower() or "does not match" in r2["summary"]["warning"].lower()
        finally:
            session.put(f"{API}/claims/{line['id']}", json={"amount": orig_amount}, timeout=15)

    def test_status_claimed_auto_stamps_date(self, session, project_id):
        data = session.get(f"{API}/projects/{project_id}/claims", timeout=15).json()
        not_claimed = next((l for l in data["lines"] if l["status"] == "not-claimed"), None)
        assert not_claimed is not None
        try:
            r = session.put(f"{API}/claims/{not_claimed['id']}", json={"status": "claimed"}, timeout=15)
            assert r.status_code == 200
            updated_lines = r.json()["lines"]
            updated = next(l for l in updated_lines if l["id"] == not_claimed["id"])
            assert updated["claimed_date"] is not None
            assert updated["status"] == "claimed"
        finally:
            session.put(f"{API}/claims/{not_claimed['id']}", json={"status": "not-claimed", "claimed_date": None, "paid_date": None}, timeout=15)

    def test_generate_conflict_without_force(self, session, project_id):
        r = session.post(f"{API}/projects/{project_id}/claims/generate", timeout=15)
        assert r.status_code == 409

    def test_generate_new_project_creates_6_lines(self, session):
        # create fresh project
        p = session.post(f"{API}/projects", json={
            "name": "TEST_ClaimsGen_" + uuid.uuid4().hex[:6], "client_name": "X",
            "site_suburb": "Ballarat", "site_postcode": "3350", "contract_value": 400000,
        }, timeout=15).json()
        pid = p["id"]
        try:
            r = session.post(f"{API}/projects/{pid}/claims/generate", timeout=15)
            assert r.status_code == 200, r.text
            data = r.json()
            assert len(data["lines"]) == 6
            pcts = [l["percentage"] for l in data["lines"]]
            assert pcts == [5, 10, 15, 35, 25, 10]
            total = sum(l["amount"] for l in data["lines"])
            assert round(total, 2) == 400000
            # first line = 5% of 400000 = 20000
            assert data["lines"][0]["amount"] == 20000
            assert data["lines"][2]["amount"] == 60000  # frame 15%
        finally:
            session.delete(f"{API}/projects/{pid}", timeout=15)
