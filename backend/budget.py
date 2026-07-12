from fastapi import APIRouter, HTTPException, Depends
from db import db
from auth import get_current_user
from roadmap_template import STAGES
from estimates import DEFAULT_CONTINGENCY
from variations import approved_variations_total

budget_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])


def inc_gst_line(line: dict) -> float:
    total = line["quantity"] * line["rate"]
    return round(total * 1.1, 2) if line.get("gst_applicable", True) else round(total, 2)


async def compute_budget(project: dict) -> dict:
    """All figures inc-GST for like-for-like comparison across estimate/quotes/invoices/payments."""
    project_id = project["id"]
    est_lines = await db.estimate_lines.find({"project_id": project_id}, {"_id": 0}).to_list(1000)
    quotes = await db.quotes.find({"project_id": project_id}, {"_id": 0, "attachment": 0}).to_list(500)
    invoices = await db.invoices.find({"project_id": project_id}, {"_id": 0}).to_list(500)
    quote_map = {q["id"]: q for q in quotes}

    def zero():
        return {"estimated": 0.0, "committed": 0.0, "invoiced": 0.0, "paid": 0.0}

    stage_data = {s["key"]: zero() for s in STAGES}
    stage_data["unallocated"] = zero()

    for l in est_lines:
        stage_data.setdefault(l["stage_key"], zero())["estimated"] += inc_gst_line(l)
    for q in quotes:
        if q["status"] == "accepted":
            stage_data.setdefault(q["stage_key"], zero())["committed"] += q["total_inc_gst"]

    wp_data = {}
    for q in quotes:
        wp = wp_data.setdefault(q["work_package"], {"work_package": q["work_package"], "stage_key": q["stage_key"],
                                                    "committed": 0.0, "invoiced": 0.0, "paid": 0.0})
        if q["status"] == "accepted":
            wp["committed"] += q["total_inc_gst"]

    unlinked_invoiced = 0.0
    for inv in invoices:
        paid = sum(p["amount"] for p in inv.get("payments", []))
        linked_quote = quote_map.get(inv.get("quote_id"))
        stage = linked_quote["stage_key"] if linked_quote else "unallocated"
        stage_data.setdefault(stage, zero())["invoiced"] += inv["total_inc_gst"]
        stage_data[stage]["paid"] += paid
        if linked_quote:
            wp = wp_data[linked_quote["work_package"]]
            wp["invoiced"] += inv["total_inc_gst"]
            wp["paid"] += paid
        else:
            unlinked_invoiced += inv["total_inc_gst"]

    by_stage = []
    for s in STAGES + [{"key": "unallocated", "label": "Unallocated", "number": 99, "weight": 0}]:
        d = stage_data[s["key"]]
        if s["key"] == "unallocated" and all(v == 0 for v in d.values()):
            continue
        by_stage.append({
            "stage_key": s["key"], "label": s["label"], "number": s["number"],
            "estimated": round(d["estimated"], 2), "committed": round(d["committed"], 2),
            "invoiced": round(d["invoiced"], 2), "paid": round(d["paid"], 2),
            "variance_est_committed": round(d["committed"] - d["estimated"], 2),
            "variance_committed_invoiced": round(d["invoiced"] - d["committed"], 2),
        })

    by_work_package = sorted(
        [{**wp, "committed": round(wp["committed"], 2), "invoiced": round(wp["invoiced"], 2), "paid": round(wp["paid"], 2),
          "variance_committed_invoiced": round(wp["invoiced"] - wp["committed"], 2)} for wp in wp_data.values()],
        key=lambda w: w["work_package"],
    )

    estimated_lines_total = round(sum(inc_gst_line(l) for l in est_lines), 2)
    contingency_pct = project.get("contingency_pct", DEFAULT_CONTINGENCY)
    subtotal_ex = sum(l["quantity"] * l["rate"] for l in est_lines)
    estimate_with_contingency = round(estimated_lines_total + subtotal_ex * contingency_pct / 100, 2)
    committed_total = round(sum(s["committed"] for s in by_stage), 2)
    invoiced_total = round(sum(s["invoiced"] for s in by_stage), 2)
    paid_total = round(sum(s["paid"] for s in by_stage), 2)
    # Exposure avoids double counting: invoices linked to accepted quotes sit within "committed".
    exposure = round(committed_total + unlinked_invoiced, 2)

    if estimate_with_contingency <= 0:
        health = "no-estimate"
    else:
        ratio = exposure / estimate_with_contingency
        health = "under" if ratio < 0.95 else ("on-track" if ratio <= 1.05 else "over")

    # Approved (and billed) variations adjust the client-side contract value
    variations_total = await approved_variations_total(project_id)
    contract_value = project.get("contract_value", 0) or 0

    return {
        "project_id": project_id,
        "by_stage": by_stage,
        "by_work_package": by_work_package,
        "totals": {
            "estimated": estimated_lines_total,
            "estimate_with_contingency": estimate_with_contingency,
            "contingency_pct": contingency_pct,
            "committed": committed_total,
            "invoiced": invoiced_total,
            "paid": paid_total,
            "exposure": exposure,
            "health": health,
            "contract_value": round(contract_value, 2),
            "approved_variations_total": variations_total,
            "adjusted_contract_value": round(contract_value + variations_total, 2),
        },
    }


@budget_router.get("/projects/{project_id}/budget")
async def get_budget(project_id: str):
    project = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    return await compute_budget(project)
