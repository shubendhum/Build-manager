"""What has to be ordered, how far ahead, and who normally supplies it.

A trade turning up is not the same as the material being on site, and the two
fail differently. A bricklayer can be rebooked in a week; bricks quoted at four
months cannot. So the long-lead items are tracked in their own right, with the
step they are needed at and the notice that step needs.

lead_weeks is the whole gap between placing the order and needing it on site —
quoting, shop drawings, fabrication and freight — not just the factory time.
Figures are current Australian supplier ranges, taken at the pessimistic end
because a build is delayed by the slowest one, not the average:

  Frames and trusses   1–2 weeks to quote and approve shop drawings, then
                       2–6 weeks fabrication.
  Windows              4–6 weeks standard; longer for custom colours.
  Bricks               The worst of them. Ordinarily weeks, but clay brick lead
                       times have run to four months and beyond in tight
                       markets. Confirm before you rely on this number.
  Hebel                Made to confirmed order only, with minimum quantities.
  Roof cover           2–4 weeks for tiles or sheet.
  Gutters, downpipes   3–7 working days cut to length; sometimes 48 hours.
  Garage door          2–4 weeks manufacture plus 3–10 days freight.
  Cabinetry            6–12 weeks for a custom kitchen; 1–2 for flat-pack.
  Stone benchtops      Cannot be ordered ahead — templated off the installed
                       cabinetry, then 1–3 weeks. Sequenced, not pre-ordered.
  Tapware, PC items    6–8 weeks when not in stock, which is common.

Every one of these can be quoted like a trade, because a supply-only price is
still a price: the board treats it as a package with supply_only set.
"""
from typing import Optional

# needed_step: the sequence step it has to be on site for.
# lead_weeks:  order this far ahead of that step starting.
# trade:       the TRADE_WORK key that normally supplies and installs it, so the
#              app can say "your carpenter usually supplies this" rather than
#              implying you must buy it separately.
# after:       set where the item cannot be ordered ahead at all because it is
#              measured off completed work.
MATERIALS = [
    {"key": "frames-trusses", "name": "Frames and trusses", "needed_step": 7, "lead_weeks": 8,
     "trade": "carpenter-frame", "match": ["frame", "truss"],
     "note": "Made to order from approved shop drawings. Allow 1–2 weeks to quote and approve "
             "them before fabrication even starts."},

    {"key": "windows", "name": "Windows and external doors", "needed_step": 11, "lead_weeks": 6,
     "trade": "windows", "match": ["window", "external door", "glazing"],
     "note": "4–6 weeks is standard. Custom colours and non-standard sizes run longer, and the "
             "glazing has to match the energy report."},

    {"key": "roof-cover", "name": "Roof tiles or roof sheet", "needed_step": 10, "lead_weeks": 4,
     "trade": "roofer", "match": ["roof tile", "roof sheet", "roofing", "colorbond"],
     "note": "Ordered on the truss layout, so it follows the truss approval."},

    {"key": "gutters", "name": "Gutters, fascia and downpipes", "needed_step": 10, "lead_weeks": 2,
     "trade": "roofer", "match": ["gutter", "fascia", "downpipe"],
     "note": "Cut to length in 3–7 working days, sometimes 48 hours. The short one on this list."},

    {"key": "bricks", "name": "Bricks or Hebel panels", "needed_step": 12, "lead_weeks": 10,
     "trade": "cladding", "match": ["brick", "hebel", "cladding", "masonry"],
     "note": "The one that most often holds a job up. Clay brick lead times have run to four "
             "months in tight markets, and Hebel is made to confirmed order with minimum "
             "quantities. Confirm the real date with your supplier before you plan around it."},

    {"key": "insulation-batts", "name": "Insulation", "needed_step": 15, "lead_weeks": 2,
     "trade": "insulation", "match": ["insulation", "batts"],
     "note": "R-values must match the energy report — order off the report, not off the plan."},

    {"key": "hvac-equipment", "name": "Heating and cooling equipment", "needed_step": 13,
     "lead_weeks": 4, "trade": "hvac-rough", "match": ["heating", "cooling", "hvac", "aircon"],
     "note": "The ducts go in at rough-in; the outdoor unit lands much later."},

    {"key": "cabinetry-order", "name": "Kitchen and bathroom cabinetry", "needed_step": 18,
     "lead_weeks": 10, "trade": "cabinetry", "match": ["cabinet", "joinery", "kitchen"],
     "note": "6–12 weeks for a custom kitchen. Selections have to be locked long before that, "
             "and late selections are the usual cause of a late kitchen."},

    {"key": "benchtops-order", "name": "Stone benchtops", "needed_step": 18, "lead_weeks": 3,
     "trade": "cabinetry", "match": ["benchtop", "stone"], "after": "cabinetry",
     "note": "Cannot be ordered ahead. Templated off the cabinetry once it is installed and "
             "level, then 1–3 weeks to fabricate. Sequence it, do not pre-order it."},

    {"key": "garage-door-order", "name": "Garage door", "needed_step": 12, "lead_weeks": 5,
     "trade": "garage-door", "match": ["garage door"],
     "note": "2–4 weeks to manufacture plus freight. Do not book the installer until it has "
             "actually been dispatched."},

    {"key": "tapware", "name": "Tapware, sanitaryware and PC items", "needed_step": 21,
     "lead_weeks": 8, "trade": "plumber-fitoff", "match": ["tapware", "sanitary", "pc item"],
     "note": "6–8 weeks when not in stock, which is common. Client selections drive this, so "
             "chase the selections, not the supplier."},

    {"key": "appliances", "name": "Appliances", "needed_step": 20, "lead_weeks": 6,
     "trade": "sparky-fitoff", "match": ["appliance", "oven", "cooktop"],
     "note": "Needed for the electrical fit-off, and the cabinetry has to be built around the "
             "actual model — confirm dimensions before the joinery is made."},

    {"key": "flooring-order", "name": "Flooring", "needed_step": 22, "lead_weeks": 4,
     "trade": "flooring", "match": ["floor", "carpet", "vinyl", "timber floor"],
     "note": "Timber and engineered boards need acclimatising on site — order early enough to "
             "let them sit."},

    {"key": "screens-order", "name": "Shower screens and mirrors", "needed_step": 22,
     "lead_weeks": 3, "trade": "screens", "match": ["shower screen", "mirror"],
     "after": "tiling",
     "note": "Measured off the finished tiling, so it cannot be ordered ahead either."},

    {"key": "wet-area-fittings", "name": "Wet area fittings and accessories", "needed_step": 22,
     "lead_weeks": 4, "trade": "screens", "match": ["towel rail", "accessor"],
     "note": "Towel rails, roll holders, shelves. Small, easily forgotten, and they need noggins "
             "in the frame long before they are ordered."},
]

BY_KEY = {m["key"]: m for m in MATERIALS}
MATERIAL_COUNT = len(MATERIALS)

# Items measured off completed work rather than ordered ahead.
MEASURED_ON_SITE = [m for m in MATERIALS if m.get("after")]


def for_step(step_n: int) -> list:
    return [m for m in MATERIALS if m["needed_step"] == step_n]


def for_trade(trade_key: str) -> list:
    return [m for m in MATERIALS if m["trade"] == trade_key]


def get(key: str) -> Optional[dict]:
    return BY_KEY.get(key)
