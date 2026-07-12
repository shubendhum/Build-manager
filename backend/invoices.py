import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from db import db
from auth import get_current_user

invoices_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_str() -> str:
    return datetime.now(timezone.utc).date().isoformat()


class InvoiceInput(BaseModel):
    invoice_number: str
    trade_id: Optional[str] = None
    quote_id: Optional[str] = None
    description: str = ""
    amount_ex_gst: float
    gst_amount: float
    total_inc_gst: float
    invoice_date: Optional[str] = None
    due_date: Optional[str] = None


class InvoiceUpdate(BaseModel):
    invoice_number: Optional[str] = None
    trade_id: Optional[str] = None
    quote_id: Optional[str] = None
    description: Optional[str] = None
    amount_ex_gst: Optional[float] = None
    gst_amount: Optional[float] = None
    total_inc_gst: Optional[float] = None
    invoice_date: Optional[str] = None
    due_date: Optional[str] = None


class PaymentInput(BaseModel):
    amount: float
    date: Optional[str] = None
    note: str = ""


def derive(inv: dict) -> dict:
    paid = round(sum(p["amount"] for p in inv.get("payments", [])), 2)
    balance = round(inv["total_inc_gst"] - paid, 2)
    inv["amount_paid"] = paid
    inv["balance"] = balance
    inv["status"] = "paid" if balance <= 0.005 else ("part-paid" if paid > 0 else "unpaid")
    inv["is_overdue"] = bool(inv.get("due_date")) and balance > 0.005 and inv["due_date"] < today_str()
    return inv


async def validate_invoice_refs(trade_id: Optional[str], quote_id: Optional[str]):
    if trade_id and not await db.trades.find_one({"id": trade_id}):
        raise HTTPException(status_code=404, detail="Trade not found.")
    if quote_id and not await db.quotes.find_one({"id": quote_id}):
        raise HTTPException(status_code=404, detail="Quote not found.")


async def attach_trade_names(invoices: list) -> list:
    trade_ids = list({i["trade_id"] for i in invoices if i.get("trade_id")})
    trades = await db.trades.find({"id": {"$in": trade_ids}}, {"_id": 0, "id": 1, "business_name": 1}).to_list(500)
    name_map = {t["id"]: t["business_name"] for t in trades}
    for i in invoices:
        i["trade_name"] = name_map.get(i.get("trade_id"))
    return invoices


async def quote_overrun_warning(quote_id: Optional[str], invoice_id: Optional[str], new_total: float) -> Optional[str]:
    """Non-blocking warning if invoices linked to an accepted quote exceed its total."""
    if not quote_id:
        return None
    quote = await db.quotes.find_one({"id": quote_id}, {"_id": 0, "total_inc_gst": 1, "work_package": 1})
    if not quote:
        return None
    query = {"quote_id": quote_id}
    if invoice_id:
        query["id"] = {"$ne": invoice_id}
    others = await db.invoices.find(query, {"_id": 0, "total_inc_gst": 1}).to_list(500)
    linked_total = round(sum(i["total_inc_gst"] for i in others) + new_total, 2)
    if linked_total > quote["total_inc_gst"]:
        over = round(linked_total - quote["total_inc_gst"], 2)
        return (f"Warning: total invoiced against quote '{quote['work_package']}' is now "
                f"${linked_total:,.2f}, which exceeds the accepted quote total of ${quote['total_inc_gst']:,.2f} by ${over:,.2f}.")
    return None


@invoices_router.get("/projects/{project_id}/invoices")
async def list_invoices(project_id: str):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    invoices = await db.invoices.find({"project_id": project_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    invoices = [derive(i) for i in invoices]
    await attach_trade_names(invoices)
    summary = {
        "total_invoiced": round(sum(i["total_inc_gst"] for i in invoices), 2),
        "total_paid": round(sum(i["amount_paid"] for i in invoices), 2),
        "outstanding": round(sum(i["balance"] for i in invoices), 2),
        "overdue_count": sum(1 for i in invoices if i["is_overdue"]),
    }
    return {"invoices": invoices, "summary": summary}


@invoices_router.post("/projects/{project_id}/invoices")
async def create_invoice(project_id: str, data: InvoiceInput):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found.")
    if not data.invoice_number.strip():
        raise HTTPException(status_code=400, detail="Invoice number is required.")
    await validate_invoice_refs(data.trade_id, data.quote_id)
    invoice = data.model_dump()
    invoice["invoice_number"] = invoice["invoice_number"].strip()
    invoice["id"] = str(uuid.uuid4())
    invoice["project_id"] = project_id
    invoice["payments"] = []
    invoice["created_at"] = now_iso()
    invoice["updated_at"] = now_iso()
    warning = await quote_overrun_warning(data.quote_id, None, data.total_inc_gst)
    await db.invoices.insert_one(dict(invoice))
    invoice.pop("_id", None)
    derive(invoice)
    await attach_trade_names([invoice])
    invoice["warning"] = warning
    return invoice


@invoices_router.put("/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, data: InvoiceUpdate):
    existing = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    updates = data.model_dump(exclude_unset=True)
    await validate_invoice_refs(updates.get("trade_id"), updates.get("quote_id"))
    updates["updated_at"] = now_iso()
    await db.invoices.update_one({"id": invoice_id}, {"$set": updates})
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    warning = await quote_overrun_warning(invoice.get("quote_id"), invoice_id, invoice["total_inc_gst"])
    derive(invoice)
    await attach_trade_names([invoice])
    invoice["warning"] = warning
    return invoice


@invoices_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str):
    result = await db.invoices.delete_one({"id": invoice_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    return {"message": "Invoice deleted."}


@invoices_router.post("/invoices/{invoice_id}/payments")
async def add_payment(invoice_id: str, data: PaymentInput):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero.")
    payment = {"id": str(uuid.uuid4()), "amount": round(data.amount, 2), "date": data.date or today_str(), "note": data.note}
    await db.invoices.update_one({"id": invoice_id}, {"$push": {"payments": payment}, "$set": {"updated_at": now_iso()}})
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    derive(invoice)
    await db.invoices.update_one({"id": invoice_id}, {"$set": {"status": invoice["status"]}})
    await attach_trade_names([invoice])
    return invoice


@invoices_router.delete("/invoices/{invoice_id}/payments/{payment_id}")
async def delete_payment(invoice_id: str, payment_id: str):
    invoice = await db.invoices.find_one({"id": invoice_id})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    result = await db.invoices.update_one({"id": invoice_id}, {"$pull": {"payments": {"id": payment_id}}, "$set": {"updated_at": now_iso()}})
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Payment not found.")
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    derive(invoice)
    await db.invoices.update_one({"id": invoice_id}, {"$set": {"status": invoice["status"]}})
    await attach_trade_names([invoice])
    return invoice
