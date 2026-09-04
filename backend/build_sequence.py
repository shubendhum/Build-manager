"""The order a Victorian residential build actually happens in.

The roadmap's six payment stages say when money moves, not what happens next on
site. A builder thinks in the real sequence — site cut, underground plumber,
slab, frame, trusses, frame inspection, roof, wrap and windows, rough-ins,
insulation, plaster, fit-offs — and the trades on the board should read in that
order rather than alphabetically or by payment stage.

Two things fall out of having it as data:

  * every package can be placed in the sequence, so the board reads in build
    order and it is obvious what is coming next;
  * a package can be chased before it is needed, because we know how far ahead
    of its step it must be priced and booked.

Note the corrections a builder would insist on: the underground plumber goes in
BEFORE the slab, trusses go on immediately after the wall frames by the same
carpenter, and the mandatory inspections sit between the work and whatever would
cover it up. The plumber attends three times, the electrician twice.
"""
from typing import Optional

# lead_weeks: how far ahead of the step this needs to be priced and booked.
# Long-lead items (trusses, windows) are the ones that delay a job when left.
SEQUENCE = [
    {"n": 1,  "key": "pre-start",          "name": "Pre-start preparation",
     "detail": "Stamped permit drawings, temporary fencing, site toilet, temporary water and power, asset protection, surveyor set-out.",
     "trades": ["other"], "stage_key": "pre-construction", "lead_weeks": 2},

    {"n": 2,  "key": "site-cut",           "name": "Site cut and excavation",
     "detail": "Strip topsoil, cut and fill, excavate footings, service trenches and any retaining.",
     "trades": ["excavator-earthworks"], "stage_key": "base", "lead_weeks": 3},

    {"n": 3,  "key": "underground-plumbing", "name": "Underground plumber",
     "detail": "Sewer and sanitary drainage, under-slab wastes, stormwater sleeves, water entry. Compliance certificate required.",
     "trades": ["plumber"], "stage_key": "base", "lead_weeks": 3,
     "note": "Before the slab, not after — this is the plumber's first of three visits."},

    {"n": 4,  "key": "slab-prep",          "name": "Slab preparation",
     "detail": "Formwork, crushed rock, waffle pods, reinforcement, vapour barrier, termite protection. Under-slab electrical conduits go in now.",
     "trades": ["concreter"], "stage_key": "base", "lead_weeks": 3},

    {"n": 5,  "key": "pre-slab-inspection", "name": "Footing / pre-slab inspection",
     "detail": "Mandatory. The building surveyor must approve before any concrete is poured.",
     "trades": ["building-surveyor"], "stage_key": "base", "lead_weeks": 1, "mandatory": True},

    {"n": 6,  "key": "slab-pour",          "name": "Concrete slab",
     "detail": "Pour and cure.",
     "trades": ["concreter"], "stage_key": "base", "lead_weeks": 2},

    {"n": 7,  "key": "wall-frames",        "name": "Wall frames",
     "detail": "Ground floor frame, upper floor structure, beams and load-bearing members.",
     "trades": ["carpenter"], "stage_key": "frame", "lead_weeks": 6},

    {"n": 8,  "key": "roof-trusses",       "name": "Roof trusses",
     "detail": "Trusses, bracing and tie-downs, normally by the frame carpenter straight after the walls.",
     "trades": ["carpenter"], "stage_key": "frame", "lead_weeks": 8,
     "note": "Long lead — trusses are made to order and hold up the whole job if left late."},

    {"n": 9,  "key": "frame-inspection",   "name": "Frame inspection",
     "detail": "Mandatory. Completed before the frame is covered.",
     "trades": ["building-surveyor"], "stage_key": "frame", "lead_weeks": 1, "mandatory": True},

    {"n": 10, "key": "roofing",            "name": "Roof plumber or roof tiler",
     "detail": "Fascia, gutters, sheets or tiles, flashings and penetrations. Get weatherproof as early as possible.",
     "trades": ["roofer", "plumber"], "stage_key": "lockup", "lead_weeks": 4},

    {"n": 11, "key": "wrap-windows",       "name": "Wall wrap, windows and external doors",
     "detail": "Sarking, then windows and external doors installed and correctly flashed.",
     "trades": ["carpenter", "other"], "stage_key": "lockup", "lead_weeks": 10,
     "note": "Windows are the longest lead on most jobs — order early."},

    {"n": 12, "key": "cladding",           "name": "Brickwork or external cladding",
     "detail": "Brick veneer, cladding, eaves and external finishes. The building reaches lock-up.",
     "trades": ["bricklayer", "renderer"], "stage_key": "lockup", "lead_weeks": 5},

    {"n": 13, "key": "plumbing-rough-in",  "name": "Plumbing rough-in",
     "detail": "Water, gas, internal wastes, shower and bath sets, tap locations.",
     "trades": ["plumber"], "stage_key": "fixing", "lead_weeks": 3,
     "note": "The plumber's second visit."},

    {"n": 14, "key": "electrical-rough-in", "name": "Electrical rough-in",
     "detail": "Cabling, switchboard, lights, power, smoke alarms, data and security. Heating/cooling and solar rough-in around now.",
     "trades": ["electrician"], "stage_key": "fixing", "lead_weeks": 3,
     "note": "The electrician's first of two visits."},

    {"n": 15, "key": "insulation",         "name": "Insulation",
     "detail": "Wall and ceiling insulation, after both rough-ins and before plaster. Photograph the services before they are covered.",
     "trades": ["other"], "stage_key": "fixing", "lead_weeks": 2},

    {"n": 16, "key": "plaster",            "name": "Plaster",
     "detail": "Ceiling and wall plasterboard, stopping and cornices.",
     "trades": ["plasterer"], "stage_key": "fixing", "lead_weeks": 3},

    {"n": 17, "key": "waterproof-tiling",  "name": "Waterproofing and tiling",
     "detail": "Wet areas waterproofed and documented before any tiling starts.",
     "trades": ["waterproofer", "tiler"], "stage_key": "fixing", "lead_weeks": 3},

    {"n": 18, "key": "internal-fixing",    "name": "Internal fixing",
     "detail": "Internal doors, skirting, architraves, stairs, kitchen, robes and cabinetry.",
     "trades": ["carpenter"], "stage_key": "fixing", "lead_weeks": 6},

    {"n": 19, "key": "painting",           "name": "Painting",
     "detail": "Internal and external painting.",
     "trades": ["painter"], "stage_key": "fixing", "lead_weeks": 3},

    {"n": 20, "key": "electrical-fit-off", "name": "Electrical fit-off",
     "detail": "Switches, outlets, lights, appliances, switchboard, smoke alarms. Certificate of Electrical Safety required.",
     "trades": ["electrician"], "stage_key": "completion", "lead_weeks": 2,
     "note": "The electrician's second visit."},

    {"n": 21, "key": "plumbing-fit-off",   "name": "Plumbing fit-off",
     "detail": "Toilets, taps, basins, sinks, hot water unit, gas appliances, final connections. Compliance certificates required.",
     "trades": ["plumber"], "stage_key": "completion", "lead_weeks": 2,
     "note": "The plumber's third visit."},

    {"n": 22, "key": "final-finishes",     "name": "Final finishes",
     "detail": "Flooring, shower screens, mirrors, appliances, door hardware, garage door.",
     "trades": ["tiler", "carpenter", "other"], "stage_key": "completion", "lead_weeks": 6},

    {"n": 23, "key": "external-works",     "name": "External works",
     "detail": "Downpipes and stormwater connected, driveway, paths, drainage, grading, fencing and landscaping per the permit.",
     "trades": ["concreter", "excavator-earthworks", "other"], "stage_key": "completion", "lead_weeks": 4},

    {"n": 24, "key": "defects-clean",      "name": "Testing, defects and cleaning",
     "detail": "Test electrical, plumbing, heating/cooling and drainage. Complete the defect inspection.",
     "trades": ["other"], "stage_key": "completion", "lead_weeks": 2},

    {"n": 25, "key": "occupancy",          "name": "Final inspection and Occupancy Permit",
     "detail": "Submit plumbing, electrical, termite, glazing and waterproofing certificates. Surveyor issues the Occupancy Permit.",
     "trades": ["building-surveyor"], "stage_key": "completion", "lead_weeks": 2, "mandatory": True},
]


# Everything the builder has to DO at each step that is not a trade to quote:
# permits, mandatory inspections, certificates to collect, notifications, and
# the site set-up. These are the items with no package behind them, so without
# listing them they simply do not appear anywhere.
#
# The supervisor's own checklist — permits, hold points, certificates — lives in
# supervisor.py. This module stays about the order the trades come in.

BY_KEY = {s["key"]: s for s in SEQUENCE}
BY_NUMBER = {s["n"]: s for s in SEQUENCE}
SEQUENCE_KEYS = set(BY_KEY)

# Words that place a package in the sequence when its trade type is ambiguous —
# a plumber appears at three different steps, so the title has to disambiguate.
KEYWORDS = [
    ("underground-plumbing",  ("underground", "sewer", "drainage", "under-slab", "under slab", "sanitary")),
    ("plumbing-fit-off",      ("fit-off", "fit off", "fitoff", "fixtures", "tapware")),
    ("plumbing-rough-in",     ("rough-in", "rough in", "roughin", "heating", "cooling", "hvac",
                               "air con", "aircon", "refrigerat", "duct")),
    ("electrical-fit-off",    ("fit-off", "fit off", "fitoff")),
    ("electrical-rough-in",   ("rough-in", "rough in", "roughin")),
    ("roof-trusses",          ("truss", "trusses")),
    ("wall-frames",           ("frame", "framing", "wall frame")),
    ("roofing",               ("roof", "gutter", "fascia", "downpipe", "flashing")),
    ("wrap-windows",          ("window", "glazing", "external door", "wrap", "sarking")),
    ("cladding",              ("brick", "cladding", "veneer", "render", "eaves", "hebel", "masonry")),
    ("slab-prep",             ("slab", "waffle", "footing", "pier", "pile", "screw pile", "termite")),
    ("site-cut",              ("site cut", "excavat", "earthwork", "site prep", "bulk earth")),
    ("waterproof-tiling",     ("waterproof", "tiling", "tiler", "tile", "screed")),
    ("insulation",            ("insulation", "batts")),
    ("plaster",               ("plaster", "gyprock", "plasterboard", "cornice")),
    ("painting",              ("paint",)),
    ("internal-fixing",       ("internal fix", "skirting", "architrave", "cabinet", "kitchen", "joinery",
                               "wardrobe", "stair", "benchtop", "splashback")),
    ("final-finishes",        ("floor covering", "flooring", "shower screen", "mirror", "appliance",
                               "caulk", "carpet", "vinyl")),
    ("external-works",        ("driveway", "landscap", "path", "paving", "stormwater", "crossover",
                               "nature strip", "letterbox", "clothesline", "gates", "fenc")),
    ("roofing",               ("garage door",)),
    ("defects-clean",         ("builder's clean", "builders clean", "site clean", "waste removal",
                               "rubbish", "defect")),
    ("wrap-windows",          ("scaffold",)),
    ("site-cut",              ("compaction", "geotech", "soil test")),
    ("pre-start",             ("site establish", "temporary fencing", "temp fencing", "site fencing",
                               "toilet", "amenities", "survey",
                               "set-out", "set out", "setout", "asset protection", "temporary power")),
]


def place(title: str, trade_type: Optional[str]) -> Optional[dict]:
    """Which step of the build a package belongs to.

    Trade type alone is not enough — a plumber appears at steps 3, 13 and 21 —
    so the title decides, and the trade type narrows it.
    """
    text = (title or "").lower()
    trade = (trade_type or "").lower()

    # Collect every step the title points at, then take the EARLIEST that also
    # matches the trade. A package called "Plumbing Rough-in & Fit-off" covers
    # two visits; it belongs where the plumber is first needed, because that is
    # when it has to be priced and booked. Matching the trade as well stops
    # "rough-in" pulling the electrician onto the plumber's step.
    on_trade, any_step = [], []
    for key, words in KEYWORDS:
        if not any(w in text for w in words):
            continue
        step = BY_KEY[key]
        any_step.append(step)
        if trade and trade in step["trades"]:
            on_trade.append(step)

    if on_trade:
        return min(on_trade, key=lambda s: s["n"])
    # What the package is called beats a generic trade type. "Screw Piles" is
    # filed under "other", which would otherwise drag it to step 1.
    if any_step:
        return min(any_step, key=lambda s: s["n"])
    if trade:
        matches = [s for s in SEQUENCE if trade in s["trades"]]
        if matches:
            return min(matches, key=lambda s: s["n"])
    return None


def step_for(title: str, trade_type: Optional[str]) -> int:
    """Sort key. Anything unplaceable sorts to the end rather than the start."""
    step = place(title, trade_type)
    return step["n"] if step else 99
