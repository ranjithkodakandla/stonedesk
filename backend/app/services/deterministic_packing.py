"""
Deterministic crate planning engine.

Core principle: packing follows dispatch sequence + family grouping + business packing rules.
NOT generic bin-packing. NOT random optimization.
"""

import re
from typing import Any, Dict, List, Optional, Set, Tuple


# ──────────────── Category Configuration ────────────────────────────────────

CATEGORY_CONFIG: Dict[str, Dict[str, Any]] = {
    "island": {
        "min_kg": 1400, "max_kg": 2200, "ideal_lo": 1800, "ideal_hi": 2000,
        "label": "Island Kitchen", "can_fill_from": [],
        "width_threshold": 36.0,
    },
    "perimeter": {
        "min_kg": 1400, "max_kg": 2200, "ideal_lo": 1800, "ideal_hi": 2000,
        "label": "Perimeter Kitchen", "can_fill_from": ["range"],
        "width_threshold": 25.0,
    },
    "range": {
        "min_kg": 800, "max_kg": 1800, "ideal_lo": 1200, "ideal_hi": 1500,
        "label": "Range Top", "can_fill_from": ["perimeter"],
        "width_threshold": 25.0,
    },
    "vanity": {
        "min_kg": 700, "max_kg": 1600, "ideal_lo": 1000, "ideal_hi": 1300,
        "label": "Vanity", "can_fill_from": [],
        "width_threshold": 19.0,
    },
    "misc": {
        "min_kg": 400, "max_kg": 1200, "ideal_lo": 600, "ideal_hi": 1000,
        "label": "Miscellaneous", "can_fill_from": [],
        "width_threshold": 0.0,
    },
}

PACK_ORDER = ["island", "perimeter", "range", "vanity", "misc"]

# Description keyword → (category, is_splash)
_DESC_RULES: List[Tuple[List[str], str, bool]] = [
    (["island top", "island countertop", "island kitchen"],    "island",    False),
    (["perimeter kitchen", "kitchen countertop", "kitchen top"], "perimeter", False),
    (["range top"],                                              "range",     False),
    (["vanity top", "bathroom top", "laundry top"],              "vanity",    False),
    (["kitchen back splash", "kitchen side splash", "kitchen splash", "kitchen backsplash"], "perimeter", True),
    (["range back splash", "range side splash", "range splash", "range backsplash"],         "range",     True),
    (["vanity back splash", "vanity side splash", "vanity splash", "bathroom splash"],        "vanity",    True),
    (["back splash", "side splash", "backsplash"],               "misc",      True),
]


# ──────────────── Helpers ────────────────────────────────────────────────────

def _parse_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v not in (None, "", "-") else default
    except (TypeError, ValueError):
        return default


def _parse_int(v: Any, default: int = 1) -> int:
    try:
        return max(1, int(float(v))) if v not in (None, "", "-") else default
    except (TypeError, ValueError):
        return default


def _flat_key(piece: Dict[str, Any]) -> str:
    parts = [str(piece.get(k, "") or "").strip() for k in ("building", "floor", "flat")]
    return " / ".join(p for p in parts if p) or "Unassigned"


def _building_key(piece: Dict[str, Any]) -> str:
    return str(piece.get("building", "") or "").strip() or "Unassigned"


def _floor_key(piece: Dict[str, Any]) -> str:
    parts = [str(piece.get(k, "") or "").strip() for k in ("building", "floor")]
    return " / ".join(p for p in parts if p) or "Unassigned"


def _dispatch_key(piece: Dict[str, Any], basis: str) -> str:
    if basis == "building":
        return _building_key(piece)
    if basis == "floor":
        return _floor_key(piece)
    return _flat_key(piece)


def _sortable(value: Any) -> Tuple[int, Any]:
    text = str(value or "").strip()
    if not text:
        return (2, "")
    digits = "".join(c for c in text if c.isdigit())
    if digits:
        return (0, int(digits))
    return (1, text.lower())


def _negate_token(tok: Tuple[int, Any]) -> Tuple[int, Any]:
    kind, val = tok
    if kind == 0 and isinstance(val, int):
        return (0, -val)
    if kind == 1 and isinstance(val, str):
        return (1, "".join(chr(max(0, 0x10FFFF - ord(c))) for c in val[:20]))
    return tok


# ──────────────── Description Classification ────────────────────────────────

def classify_piece(part_description: str, width: float) -> Tuple[str, bool]:
    """
    Returns (category, is_splash) based on description keywords + width threshold.
    Width is the shorter/depth dimension of the slab.
    """
    desc = (part_description or "").strip().lower()

    for keywords, cat, is_splash in _DESC_RULES:
        for kw in keywords:
            if kw in desc:
                if not is_splash:
                    thresh = CATEGORY_CONFIG[cat]["width_threshold"]
                    if thresh > 0 and width < thresh:
                        continue  # width doesn't meet threshold for this category
                return cat, is_splash

    # Island fallback: anything with "island" but width check failed → perimeter
    if "island" in desc:
        return "perimeter", False
    if "kitchen" in desc or "perimeter" in desc:
        thresh = CATEGORY_CONFIG["perimeter"]["width_threshold"]
        if width >= thresh:
            return "perimeter", False
    if "range" in desc:
        thresh = CATEGORY_CONFIG["range"]["width_threshold"]
        if width >= thresh:
            return "range", False
    if "vanity" in desc or "bathroom" in desc or "laundry" in desc:
        thresh = CATEGORY_CONFIG["vanity"]["width_threshold"]
        if width >= thresh:
            return "vanity", False
    if "splash" in desc or "backsplash" in desc:
        return "misc", True

    return "misc", False


def _extract_family_prefix(part_no: str) -> Tuple[Optional[str], str]:
    """
    Parse part_no into (family_prefix, role).
    role = 'main' | 'splash' | 'unknown'

    Handles patterns like:
      1051-01  → prefix "1051", role "main"
      1051-A   → prefix "1051", role "splash"
      1051-02  → prefix "1051", role "main"
    """
    if not part_no:
        return None, "unknown"
    pn = part_no.strip()
    m = re.match(r"^(.+)-([A-Za-z]+)$", pn)
    if m:
        return m.group(1), "splash"
    m = re.match(r"^(.+)-(\d+)$", pn)
    if m:
        return m.group(1), "main"
    return pn, "unknown"


# ──────────────── Family Building ───────────────────────────────────────────

def build_packing_families(pieces: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Group pieces into packing families.

    A family = one main top + all its associated splashes.
    Grouping is driven by part_no prefix (e.g. "1051").
    Fallback: pieces without a recognisable prefix form their own single-piece family.
    """
    # key → {main: [], splash: [], flat_key: str}
    family_map: Dict[Tuple, Dict] = {}

    for piece in pieces:
        part_no = str(piece.get("part_no", "") or "").strip()
        flat_k = _flat_key(piece)
        prefix, role = _extract_family_prefix(part_no)

        if prefix:
            fam_key = (flat_k, prefix)
        else:
            # Each piece without a parseable part_no is its own family
            fam_key = (flat_k, f"_solo_{piece['id']}")
            role = "main"

        if fam_key not in family_map:
            family_map[fam_key] = {
                "key": fam_key,
                "flat_key": flat_k,
                "family_prefix": prefix or f"solo_{piece['id']}",
                "main": [],
                "splash": [],
            }

        # Determine role using description if still unknown
        if role == "unknown":
            desc = str(piece.get("part", "") or "")
            _, is_sp = classify_piece(desc, _parse_float(piece.get("width")))
            role = "splash" if is_sp else "main"

        family_map[fam_key][role].append(piece)

    # Build structured family dicts
    families: List[Dict[str, Any]] = []
    for fam_key, fdata in family_map.items():
        main_pieces = fdata["main"]
        splash_pieces = fdata["splash"]
        all_pieces = main_pieces + splash_pieces

        # Classify family by first main piece (or splash if no main)
        ref = main_pieces[0] if main_pieces else (splash_pieces[0] if splash_pieces else None)
        if ref:
            desc = str(ref.get("part", "") or "")
            width = _parse_float(ref.get("width"))
            category, _ = classify_piece(desc, width)
        else:
            category = "misc"

        families.append({
            "family_id": fdata["family_prefix"],
            "flat_key": fdata["flat_key"],
            "category": category,
            "main_pieces": main_pieces,
            "splash_pieces": splash_pieces,
            "all_pieces": all_pieces,
        })

    return families


# ──────────────── Dispatch Sequence Sorting ─────────────────────────────────

def sort_by_dispatch(
    pieces: List[Dict[str, Any]],
    dispatch_selection: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """
    Filter and sort pieces according to dispatch selection.

    dispatch_selection shape:
    {
      "basis": "building" | "floor" | "flat",
      "buildings": ["3", "5"] or ["all"],
      "floors": ["1", "2"] or ["all"],
      "flats": ["101", "102"] or ["all"],
      "ordering": {"building": "asc"|"desc", "floor": "asc"|"desc", "flat": "asc"|"desc"}
    }
    """
    if not dispatch_selection:
        return sorted(pieces, key=lambda p: (_sortable(p.get("building")), _sortable(p.get("floor")), _sortable(p.get("flat"))))

    buildings = dispatch_selection.get("buildings") or ["all"]
    floors = dispatch_selection.get("floors") or ["all"]
    flats = dispatch_selection.get("flats") or ["all"]
    ordering = dispatch_selection.get("ordering") or {}
    b_ord = ordering.get("building", "asc")
    f_ord = ordering.get("floor", "asc")
    fl_ord = ordering.get("flat", "asc")

    # Filter
    def passes_filter(p: Dict[str, Any]) -> bool:
        b = str(p.get("building", "") or "").strip()
        f = str(p.get("floor", "") or "").strip()
        fl = str(p.get("flat", "") or "").strip()
        if "all" not in buildings and b not in set(buildings):
            return False
        if "all" not in floors and f not in set(floors):
            return False
        if "all" not in flats and fl not in set(flats):
            return False
        return True

    filtered = [p for p in pieces if passes_filter(p)]

    def sort_key(p: Dict[str, Any]) -> Tuple:
        bt = _sortable(p.get("building"))
        ft = _sortable(p.get("floor"))
        flt = _sortable(p.get("flat"))
        if b_ord == "desc":
            bt = _negate_token(bt)
        if f_ord == "desc":
            ft = _negate_token(ft)
        if fl_ord == "desc":
            flt = _negate_token(flt)
        return (bt, ft, flt)

    return sorted(filtered, key=sort_key)


# ──────────────── Weight Calculation ────────────────────────────────────────

_WEIGHT_FACTORS: Dict[str, Dict[str, float]] = {
    "Granite": {"2CM": 5.5, "3CM": 7.5, "Mixed": 6.5},
    "Quartz":  {"2CM": 4.75, "3CM": 6.75, "Mixed": 5.75},
    "Marble":  {"2CM": 6.0, "3CM": 8.0, "Mixed": 7.0},
    "Other":   {"2CM": 5.5, "3CM": 7.5, "Mixed": 6.5},
}


def _piece_weight(piece: Dict[str, Any], material: str, thickness: str) -> float:
    length = _parse_float(piece.get("length"))
    width = _parse_float(piece.get("width"))
    qty = _parse_int(piece.get("qty"))
    override = _parse_float(piece.get("weight_override"))
    if override > 0:
        return override * qty
    sqft = (length * width) / 144.0
    t = str(piece.get("thickness") or thickness)
    wf = _WEIGHT_FACTORS.get(material, _WEIGHT_FACTORS["Other"]).get(t, 6.5)
    return sqft * wf * qty


def _family_weight(family: Dict[str, Any], material: str, thickness: str) -> float:
    return sum(_piece_weight(p, material, thickness) for p in family["all_pieces"])


# ──────────────── Crate Assembly ────────────────────────────────────────────

def _make_crate(
    families: List[Dict[str, Any]],
    category: str,
    dispatch_group: str,
    serial: int,
    packing_notes: str,
    warnings: List[str],
) -> Dict[str, Any]:
    """Assemble a crate document from a list of families."""
    main_pieces = []
    splash_pieces = []
    for fam in families:
        main_pieces.extend(fam["main_pieces"])
        splash_pieces.extend(fam["splash_pieces"])

    all_pieces = main_pieces + splash_pieces
    config = CATEGORY_CONFIG.get(category, CATEGORY_CONFIG["misc"])
    family_ids = [f["family_id"] for f in families]

    has_splash = len(splash_pieces) > 0
    if has_splash:
        notes = packing_notes or "Splashes stacked above tops"
    else:
        notes = packing_notes or ""

    return {
        "category": category,
        "category_label": config["label"],
        "dispatch_group": dispatch_group,
        "family_ids": family_ids,
        "pieces": all_pieces,
        "main_pieces": main_pieces,
        "splash_pieces": splash_pieces,
        "max_weight": config["max_kg"],
        "ideal_lo": config["ideal_lo"],
        "ideal_hi": config["ideal_hi"],
        "serial": serial,
        "packing_notes": notes,
        "warnings": warnings,
        "packing_mode": "deterministic",
        "splash_layer": has_splash,
        "primary_flat": dispatch_group,
        "secondary_flats": [],
    }


def _pack_category(
    families: List[Dict[str, Any]],
    category: str,
    fill_pool: List[Dict[str, Any]],
    dispatch_group: str,
    material: str,
    thickness: str,
    serial_start: int,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], int]:
    """
    Pack families of a given category into crates.
    Returns (crates, unused_fill_families, next_serial).

    fill_pool: families of compatible categories that may be added to reach ideal weight.
    """
    config = CATEGORY_CONFIG[category]
    max_kg = config["max_kg"]
    ideal_lo = config["ideal_lo"]
    ideal_hi = config["ideal_hi"]

    serial = serial_start
    crates: List[Dict[str, Any]] = []
    used_fill: Set[int] = set()

    current_fams: List[Dict[str, Any]] = []
    current_wt = 0.0

    def flush(warns: List[str]):
        nonlocal serial, current_fams, current_wt
        if not current_fams:
            return

        # Try to fill with compatible families if below ideal
        if current_wt < ideal_lo and fill_pool:
            for fill_fam in fill_pool:
                if id(fill_fam) in used_fill:
                    continue
                fw = _family_weight(fill_fam, material, thickness)
                if current_wt + fw <= ideal_hi:
                    current_fams.append(fill_fam)
                    current_wt += fw
                    used_fill.add(id(fill_fam))
                    warns.append(f"{fill_fam['category']} family added to reach target weight")
                    if current_wt >= ideal_lo:
                        break

        # Weight band warnings
        w = list(warns)
        if current_wt < config["min_kg"]:
            w.append(f"Underweight: {current_wt:.0f} kg (min {config['min_kg']} kg)")
        elif current_wt > config["max_kg"]:
            w.append(f"Overweight: {current_wt:.0f} kg (max {config['max_kg']} kg)")
        elif current_wt < ideal_lo:
            w.append(f"Below ideal range: {current_wt:.0f} kg (ideal {ideal_lo}–{ideal_hi} kg)")
        elif current_wt > ideal_hi:
            w.append(f"Above ideal range: {current_wt:.0f} kg (ideal {ideal_lo}–{ideal_hi} kg)")

        crates.append(_make_crate(current_fams, category, dispatch_group, serial, "", w))
        serial += 1
        current_fams = []
        current_wt = 0.0

    for family in families:
        fw = _family_weight(family, material, thickness)
        if current_fams and current_wt + fw > max_kg:
            flush([])
        current_fams.append(family)
        current_wt += fw

    if current_fams:
        flush([])

    unused_fill = [f for f in fill_pool if id(f) not in used_fill]
    return crates, unused_fill, serial


# ──────────────── Main Entry Point ──────────────────────────────────────────

def deterministic_pack(
    pieces: List[Dict[str, Any]],
    dispatch_selection: Optional[Dict[str, Any]],
    material: str,
    thickness: str,
    color: str = "",
) -> List[Dict[str, Any]]:
    """
    Main deterministic crate planning function.

    Returns a list of crate dicts ready for persistence.
    Each crate dict contains:
      - pieces: all pieces in the crate
      - main_pieces: bottom-layer pieces (main tops)
      - splash_pieces: top-layer pieces (splashes)
      - category, category_label, dispatch_group
      - max_weight, ideal_lo, ideal_hi
      - warnings, packing_notes, serial
    """
    if not pieces:
        return []

    # Step 1: Sort pieces by dispatch sequence
    ordered_pieces = sort_by_dispatch(pieces, dispatch_selection or {})
    if not ordered_pieces:
        ordered_pieces = pieces  # fallback: use all if filter returned nothing

    # Step 2: Build packing families
    families = build_packing_families(ordered_pieces)

    # Step 3: Preserve dispatch order for dispatch groups
    dispatch_order: List[str] = []
    seen_dk: Set[str] = set()
    basis = (dispatch_selection or {}).get("basis", "flat")
    for piece in ordered_pieces:
        dk = _dispatch_key(piece, basis)
        if dk not in seen_dk:
            dispatch_order.append(dk)
            seen_dk.add(dk)

    # Group families by dispatch unit
    by_dispatch: Dict[str, Dict[str, List[Dict]]] = {}
    for fam in families:
        dk = fam["flat_key"]
        if dk not in by_dispatch:
            by_dispatch[dk] = {cat: [] for cat in PACK_ORDER}
        by_dispatch[dk].setdefault(fam["category"], []).append(fam)

    # Step 4: Pack dispatch groups in order
    all_crates: List[Dict[str, Any]] = []
    serial = 1

    for dk in dispatch_order:
        if dk not in by_dispatch:
            continue
        cat_pools = by_dispatch[dk]

        # Island: no mixing
        if cat_pools.get("island"):
            crates, _, serial = _pack_category(
                cat_pools["island"], "island", [], dk, material, thickness, serial
            )
            all_crates.extend(crates)

        # Perimeter: can fill from range
        if cat_pools.get("perimeter"):
            crates, remaining_range, serial = _pack_category(
                cat_pools["perimeter"], "perimeter",
                cat_pools.get("range", []),
                dk, material, thickness, serial
            )
            all_crates.extend(crates)
            # Replace range pool with what's left after fill
            cat_pools["range"] = remaining_range

        # Range: can fill from perimeter (what's left after perimeter fill)
        if cat_pools.get("range"):
            crates, _, serial = _pack_category(
                cat_pools["range"], "range",
                cat_pools.get("perimeter", []),  # perimeter might be empty but pass anyway
                dk, material, thickness, serial
            )
            all_crates.extend(crates)

        # Vanity: no kitchen mixing
        if cat_pools.get("vanity"):
            crates, _, serial = _pack_category(
                cat_pools["vanity"], "vanity", [], dk, material, thickness, serial
            )
            all_crates.extend(crates)

        # Misc: pack alone
        if cat_pools.get("misc"):
            crates, _, serial = _pack_category(
                cat_pools["misc"], "misc", [], dk, material, thickness, serial
            )
            all_crates.extend(crates)

    return all_crates


# ──────────────── Dispatch Discovery ────────────────────────────────────────

# ──────────────── Deterministic Crate Dimensions ────────────────────────────

# Standard flat-lay packing constants (inches)
_SLAB_THICKNESS_IN: Dict[str, float] = {"2CM": 0.787, "3CM": 1.181, "Mixed": 1.0}
_FOAM_BETWEEN_PIECES = 0.375    # foam between adjacent pieces in same layer
_MAIN_SPLASH_SEP     = 0.75     # extra padding between main layer and splash layer
_SIDE_MARGIN         = 3.0      # clearance on each side (L and W)
_BASE_PADDING        = 2.0      # base pad under first piece
_TOP_CLEARANCE       = 2.0      # clearance above top piece
_FORKLIFT_SKID       = 4.5      # forklift skid added to external height


def _slab_thick(piece: Dict[str, Any], default_thickness: str) -> float:
    t = str(piece.get("thickness") or default_thickness).strip()
    return _SLAB_THICKNESS_IN.get(t, _SLAB_THICKNESS_IN.get(default_thickness, 1.181))


def _layer_height(pieces: List[Dict[str, Any]], default_thickness: str) -> float:
    """Height (inches) occupied by a flat-lay layer of pieces."""
    if not pieces:
        return 0.0
    h = _BASE_PADDING
    for i, piece in enumerate(pieces):
        qty = _parse_int(piece.get("qty"))
        thick = _slab_thick(piece, default_thickness)
        h += thick * qty
        if qty > 1:
            h += _FOAM_BETWEEN_PIECES * (qty - 1)
        if i < len(pieces) - 1:
            h += _FOAM_BETWEEN_PIECES
    return h


def compute_crate_dimensions(
    main_pieces: List[Dict[str, Any]],
    splash_pieces: List[Dict[str, Any]],
    project_thickness: str,
    wood_thickness: float = 1.5,
) -> Dict[str, float]:
    """
    Compute deterministic crate dimensions for flat-lay packing.

    Main tops occupy the bottom layer; splashes sit on top.
    Dimensions are in inches.
    """
    all_pieces = main_pieces + splash_pieces
    if not all_pieces:
        return {k: 0.0 for k in ("internal_length", "internal_width", "internal_height",
                                  "external_length", "external_width", "external_height")}

    max_length = max((_parse_float(p.get("length")) for p in all_pieces), default=0.0)
    max_width  = max((_parse_float(p.get("width"))  for p in all_pieces), default=0.0)

    main_h   = _layer_height(main_pieces,   project_thickness)
    splash_h = _layer_height(splash_pieces, project_thickness) if splash_pieces else 0.0
    sep_h    = _MAIN_SPLASH_SEP if (main_pieces and splash_pieces) else 0.0

    internal_height = main_h + sep_h + splash_h + _TOP_CLEARANCE
    internal_length = max_length + 2 * _SIDE_MARGIN
    internal_width  = max_width  + 2 * _SIDE_MARGIN
    external_length = internal_length + 2 * wood_thickness
    external_width  = internal_width  + 2 * wood_thickness
    external_height = internal_height + 2 * wood_thickness + _FORKLIFT_SKID

    return {
        "internal_length": round(internal_length, 1),
        "internal_width":  round(internal_width,  1),
        "internal_height": round(internal_height, 1),
        "external_length": round(external_length, 1),
        "external_width":  round(external_width,  1),
        "external_height": round(external_height, 1),
    }


# ──────────────── Dispatch Discovery ────────────────────────────────────────

def discover_dispatch_hierarchy(
    pieces: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Returns the available dispatch hierarchy from the project's pieces.
    Used to populate the dispatch selection UI.
    """
    buildings: Set[str] = set()
    floors_by_building: Dict[str, Set[str]] = {}
    flats_by_floor: Dict[str, Set[str]] = {}  # key: "building/floor"

    for piece in pieces:
        b = str(piece.get("building", "") or "").strip()
        f = str(piece.get("floor", "") or "").strip()
        fl = str(piece.get("flat", "") or "").strip()

        if b:
            buildings.add(b)
        floor_key = " / ".join(p for p in [b, f] if p) or "root"
        if f:
            floors_by_building.setdefault(b or "root", set()).add(f)
        if fl:
            flats_by_floor.setdefault(floor_key, set()).add(fl)

    def sort_values(vals: Set[str]) -> List[str]:
        return sorted(vals, key=lambda v: _sortable(v))

    result = {
        "buildings": sort_values(buildings),
        "floors_by_building": {k: sort_values(v) for k, v in floors_by_building.items()},
        "flats_by_floor": {k: sort_values(v) for k, v in flats_by_floor.items()},
    }
    return result
