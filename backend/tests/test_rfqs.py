"""Backend tests for BuildManager VIC — Phase A quote requests (RFQ v2).

One RFQ carries many invitations, each with its own token. Public endpoints are
exercised WITHOUT auth. Self-fixturing — creates its own project/trades and
deletes them at teardown, so it does NOT depend on the demo seed data.

Sends run against the `console` notify driver (the default), so nothing leaves
the machine.
"""
import os
import io
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:3080").rstrip("/")
API = f"{BASE_URL}/api"
CREDS = {"email": "pm@rldtech.com.au", "password": "SitePM-2026"}
T = 30

PDF_BYTES = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=CREDS, timeout=T)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def project_id(session, trades):  # noqa: ARG001 — ordering: trades outlive the project
    r = session.post(f"{API}/projects", timeout=T, json={
        "name": f"RFQTEST {uuid.uuid4().hex[:8]}", "client_name": "Test Client",
        "site_street": "1 Test St", "site_suburb": "Ballarat", "site_postcode": "3350",
        "builder_name": "Test Builder Pty Ltd",
    })
    assert r.status_code in (200, 201), r.text
    pid = r.json()["id"]
    yield pid
    session.delete(f"{API}/projects/{pid}", timeout=T)


@pytest.fixture(scope="module")
def trades(session):
    """Three with an email, one deliberately without — partial-failure coverage."""
    made = []
    specs = [("A", "rfqtest-a@example.com"), ("B", "rfqtest-b@example.com"),
             ("C", "rfqtest-c@example.com"), ("NoEmail", "")]
    for label, email in specs:
        r = session.post(f"{API}/trades", timeout=T, json={
            "business_name": f"RFQTEST {label} {uuid.uuid4().hex[:6]}",
            "trade_type": "plumber", "email": email, "phone": "0400000000",
        })
        assert r.status_code in (200, 201), r.text
        made.append(r.json()["id"])
    yield made
    for tid in made:
        r = session.delete(f"{API}/trades/{tid}", timeout=T)
        assert r.status_code == 200, f"test trade left behind: {r.text}"


@pytest.fixture(scope="module")
def package_id(session, project_id):
    r = session.post(f"{API}/projects/{project_id}/packages", timeout=T, json={
        "title": "RFQ test package", "trade_type": "plumber",
        "stage_key": "lockup", "scope": "Supply and install per drawings.",
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def document_id(session, project_id):
    r = session.post(f"{API}/projects/{project_id}/documents", timeout=T,
                     files={"file": ("drawing.pdf", io.BytesIO(PDF_BYTES), "application/pdf")},
                     data={"title": "Working Drawings", "category": "drawings"})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def make_rfq(session, project_id, package_id, trade_ids, document_ids=None):
    r = session.post(f"{API}/projects/{project_id}/rfqs", timeout=T, json={
        "package_id": package_id, "trade_ids": trade_ids,
        "scope": "Supply and install per drawings.", "due_date": "2026-12-01",
        "document_ids": document_ids or [],
    })
    assert r.status_code in (200, 201), r.text
    return r.json()


class TestCreateInvitations:
    def test_one_rfq_many_trades_distinct_tokens(self, session, project_id, package_id, trades):
        rfq = make_rfq(session, project_id, package_id, trades[:3])
        assert rfq["invited_count"] == 3
        tokens = {i["token"] for i in rfq["invitations"]}
        assert len(tokens) == 3, "each trade must get its own token"
        assert all(i["status"] == "pending" for i in rfq["invitations"])
        assert rfq["status"] == "open"

    def test_package_moves_to_out_for_quote(self, session, project_id, package_id, trades):
        make_rfq(session, project_id, package_id, trades[:1])
        pkg = next(p for p in session.get(f"{API}/projects/{project_id}/packages", timeout=T).json()
                   if p["id"] == package_id)
        assert pkg["status"] in ("out-for-quote", "quotes-in", "awarded")

    def test_no_trades_rejected(self, session, project_id, package_id):
        r = session.post(f"{API}/projects/{project_id}/rfqs", timeout=T,
                         json={"package_id": package_id, "trade_ids": [], "scope": "x"})
        assert r.status_code == 400

    def test_unknown_trade_rejected(self, session, project_id, package_id):
        r = session.post(f"{API}/projects/{project_id}/rfqs", timeout=T,
                         json={"package_id": package_id, "trade_ids": [str(uuid.uuid4())], "scope": "x"})
        assert r.status_code == 404

    def test_unknown_package_rejected(self, session, project_id, trades):
        r = session.post(f"{API}/projects/{project_id}/rfqs", timeout=T,
                         json={"package_id": str(uuid.uuid4()), "trade_ids": trades[:1], "scope": "x"})
        assert r.status_code == 404

    def test_document_from_another_project_rejected(self, session, project_id, package_id, trades):
        r = session.post(f"{API}/projects/{project_id}/rfqs", timeout=T, json={
            "package_id": package_id, "trade_ids": trades[:1], "scope": "x",
            "document_ids": [str(uuid.uuid4())],
        })
        assert r.status_code == 404

    def test_add_and_remove_invitations(self, session, project_id, package_id, trades):
        rfq = make_rfq(session, project_id, package_id, trades[:1])
        r = session.post(f"{API}/rfqs/{rfq['id']}/invitations", json={"trade_ids": [trades[1]]}, timeout=T)
        assert r.status_code == 200 and r.json()["invited_count"] == 2
        dup = session.post(f"{API}/rfqs/{rfq['id']}/invitations", json={"trade_ids": [trades[1]]}, timeout=T)
        assert dup.status_code == 400, "re-inviting the same trade should be refused"
        inv_id = r.json()["invitations"][1]["id"]
        gone = session.delete(f"{API}/rfqs/{rfq['id']}/invitations/{inv_id}", timeout=T)
        assert gone.status_code == 200 and gone.json()["invited_count"] == 1


class TestPerInvitationSubmission:
    """The bug this schema exists to fix: one trade submitting must not close the
    request for everyone else."""

    def test_one_submission_leaves_others_open(self, session, project_id, package_id, trades):
        rfq = make_rfq(session, project_id, package_id, trades[:3])
        t1, t2, t3 = [i["token"] for i in rfq["invitations"]]

        r = requests.post(f"{API}/public/rfqs/{t1}/submit", timeout=T,
                          data={"amount_ex_gst": 1000, "gst_amount": 100, "contact_name": "Dave"})
        assert r.status_code == 200, r.text

        for other in (t2, t3):
            assert requests.get(f"{API}/public/rfqs/{other}", timeout=T).status_code == 200
            ok = requests.post(f"{API}/public/rfqs/{other}/submit", timeout=T,
                               data={"amount_ex_gst": 1100, "gst_amount": 110, "contact_name": "Sam"})
            assert ok.status_code == 200, "sibling invitations must still accept a quote"

        quotes = session.get(f"{API}/projects/{project_id}/quotes", timeout=T).json()
        assert sum(1 for q in quotes if q.get("rfq_id") == rfq["id"]) == 3

    def test_double_submit_is_409_for_that_token_only(self, session, project_id, package_id, trades):
        rfq = make_rfq(session, project_id, package_id, trades[:2])
        t1, t2 = [i["token"] for i in rfq["invitations"]]
        requests.post(f"{API}/public/rfqs/{t1}/submit", timeout=T,
                      data={"amount_ex_gst": 1, "gst_amount": 0, "contact_name": "A"})
        again = requests.post(f"{API}/public/rfqs/{t1}/submit", timeout=T,
                              data={"amount_ex_gst": 2, "gst_amount": 0, "contact_name": "A"})
        assert again.status_code == 409
        assert requests.get(f"{API}/public/rfqs/{t2}", timeout=T).status_code == 200

    def test_submitted_quote_carries_package_and_title(self, session, project_id, package_id, trades):
        rfq = make_rfq(session, project_id, package_id, trades[:1])
        token = rfq["invitations"][0]["token"]
        r = requests.post(f"{API}/public/rfqs/{token}/submit", timeout=T,
                          data={"amount_ex_gst": 900, "gst_amount": 90, "contact_name": "Jo"})
        quote_id = r.json()["quote_id"]
        quote = next(q for q in session.get(f"{API}/projects/{project_id}/quotes", timeout=T).json()
                     if q["id"] == quote_id)
        assert quote["package_id"] == package_id
        assert quote["work_package"] == "RFQ test package", "title comes from the package, not the scope text"
        assert quote["total_inc_gst"] == pytest.approx(990.0)

    def test_closed_rfq_returns_410(self, session, project_id, package_id, trades):
        rfq = make_rfq(session, project_id, package_id, trades[:1])
        token = rfq["invitations"][0]["token"]
        assert session.post(f"{API}/rfqs/{rfq['id']}/close", timeout=T).status_code == 200
        assert requests.get(f"{API}/public/rfqs/{token}", timeout=T).status_code == 410

    def test_unknown_token_404(self):
        assert requests.get(f"{API}/public/rfqs/not-a-real-token", timeout=T).status_code == 404


class TestDocuments:
    def test_attached_document_downloads(self, session, project_id, package_id, trades, document_id):
        rfq = make_rfq(session, project_id, package_id, trades[:1], [document_id])
        token = rfq["invitations"][0]["token"]

        portal = requests.get(f"{API}/public/rfqs/{token}", timeout=T).json()
        assert [d["id"] for d in portal["documents"]] == [document_id]
        assert portal["package_title"] == "RFQ test package"
        assert "file_path" not in portal["documents"][0], "never expose the disk path"

        dl = requests.get(f"{API}/public/rfqs/{token}/documents/{document_id}", timeout=T)
        assert dl.status_code == 200
        assert dl.content == PDF_BYTES

    def test_unattached_document_is_not_readable(self, session, project_id, package_id, trades, document_id):
        """A valid token must not read a document that wasn't attached to its RFQ —
        otherwise one trade's link reads every contract on the project."""
        other = session.post(f"{API}/projects/{project_id}/documents", timeout=T,
                             files={"file": ("secret.pdf", io.BytesIO(PDF_BYTES), "application/pdf")},
                             data={"title": "Head Contract", "category": "contracts"})
        secret_id = other.json()["id"]

        rfq = make_rfq(session, project_id, package_id, trades[:1], [document_id])
        token = rfq["invitations"][0]["token"]
        leak = requests.get(f"{API}/public/rfqs/{token}/documents/{secret_id}", timeout=T)
        assert leak.status_code == 404, "unattached documents must not be reachable by token"


class TestSend:
    def test_send_logs_and_marks_sent(self, session, project_id, package_id, trades):
        rfq = make_rfq(session, project_id, package_id, trades[:2])
        r = session.post(f"{API}/rfqs/{rfq['id']}/send", json={"channels": ["email"]}, timeout=T)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["sent"] == 2 and body["failed"] == 0
        assert all(x["ok"] for x in body["results"])

        log = session.get(f"{API}/rfqs/{rfq['id']}/log", timeout=T).json()
        assert len(log) == 2, "one notification row per channel per invitation"
        assert all(n["status"] == "sent" and n["channel"] == "email" for n in log)
        assert all(n["subject"] and n["body"] for n in log), "log stores what was actually sent"

        fresh = next(x for x in session.get(f"{API}/projects/{project_id}/rfqs", timeout=T).json()
                     if x["id"] == rfq["id"])
        assert all(i["status"] == "sent" and i["sent_at"] for i in fresh["invitations"])

    def test_partial_failure_does_not_block_the_rest(self, session, project_id, package_id, trades):
        """The trade with no email must fail alone."""
        rfq = make_rfq(session, project_id, package_id, [trades[0], trades[3]])
        body = session.post(f"{API}/rfqs/{rfq['id']}/send", json={"channels": ["email"]}, timeout=T).json()
        assert body["sent"] == 1 and body["failed"] == 1
        failed = next(x for x in body["results"] if not x["ok"])
        assert "no email address" in failed["error"].lower()

        fresh = next(x for x in session.get(f"{API}/projects/{project_id}/rfqs", timeout=T).json()
                     if x["id"] == rfq["id"])
        by_trade = {i["trade_id"]: i for i in fresh["invitations"]}
        assert by_trade[trades[0]]["status"] == "sent"
        assert by_trade[trades[3]]["status"] == "failed"
        assert by_trade[trades[3]]["last_error"]

    def test_resend_one_invitation_appends_to_log(self, session, project_id, package_id, trades):
        rfq = make_rfq(session, project_id, package_id, trades[:1])
        inv_id = rfq["invitations"][0]["id"]
        session.post(f"{API}/rfqs/{rfq['id']}/send", json={"channels": ["email"]}, timeout=T)
        session.post(f"{API}/rfqs/{rfq['id']}/send",
                     json={"channels": ["email"], "invitation_ids": [inv_id]}, timeout=T)
        log = session.get(f"{API}/rfqs/{rfq['id']}/log", timeout=T).json()
        assert len(log) == 2, "re-sending appends a row rather than mutating the first"

    def test_bad_channel_rejected(self, session, project_id, package_id, trades):
        rfq = make_rfq(session, project_id, package_id, trades[:1])
        r = session.post(f"{API}/rfqs/{rfq['id']}/send", json={"channels": ["carrier-pigeon"]}, timeout=T)
        assert r.status_code == 400

    def test_send_on_closed_rfq_rejected(self, session, project_id, package_id, trades):
        rfq = make_rfq(session, project_id, package_id, trades[:1])
        session.post(f"{API}/rfqs/{rfq['id']}/close", timeout=T)
        r = session.post(f"{API}/rfqs/{rfq['id']}/send", json={"channels": ["email"]}, timeout=T)
        assert r.status_code == 409


class TestViewTracking:
    def test_first_viewed_at_stamps_once(self, session, project_id, package_id, trades):
        rfq = make_rfq(session, project_id, package_id, trades[:1])
        token = rfq["invitations"][0]["token"]

        requests.get(f"{API}/public/rfqs/{token}", timeout=T)
        first = next(x for x in session.get(f"{API}/projects/{project_id}/rfqs", timeout=T).json()
                     if x["id"] == rfq["id"])["invitations"][0]
        assert first["first_viewed_at"], "opening the link must stamp the first view"
        assert first["status"] == "viewed"

        requests.get(f"{API}/public/rfqs/{token}", timeout=T)
        second = next(x for x in session.get(f"{API}/projects/{project_id}/rfqs", timeout=T).json()
                      if x["id"] == rfq["id"])["invitations"][0]
        assert second["first_viewed_at"] == first["first_viewed_at"], "must not move on a second view"

    def test_download_is_stamped(self, session, project_id, package_id, trades, document_id):
        rfq = make_rfq(session, project_id, package_id, trades[:1], [document_id])
        token = rfq["invitations"][0]["token"]
        requests.get(f"{API}/public/rfqs/{token}/documents/{document_id}", timeout=T)
        fresh = next(x for x in session.get(f"{API}/projects/{project_id}/rfqs", timeout=T).json()
                     if x["id"] == rfq["id"])
        assert fresh["invitations"][0]["downloaded_at"]
