import re
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from ..planning_engine import parse_float

# ── Standardized Part Type rules — NO width threshold applied ────────────────
# If a piece carries one of these exact Part Type names, the classification is
# definitive regardless of slab width.  Width thresholds only apply to the
# legacy keyword heuristics below where the Part Type field may be absent.
_STANDARDIZED_RULES: List[Tuple[List[str], str, bool]] = [
    (["kitchen - island tops"],     "island",    False),
    (["kitchen - perimeter tops"],  "perimeter", False),
    (["kitchen - range tops"],      "range",     False),
    (["kitchen - back splash"],     "perimeter", True),
    (["kitchen - side splash"],     "perimeter", True),
    (["vanity - top"],              "vanity",    False),
    (["vanity - back splash"],      "vanity",    True),
    (["vanity - side splash"],      "vanity",    True),
    (["misc - full height splash"], "misc",      True),
    (["misc - window sill"],        "misc",      False),
    (["misc - bar top"],            "misc",      False),
]

# ── Legacy keyword patterns — width threshold applied ─────────────────────────
# Used when Part Type field is absent or contains an unrecognized description.
_LEGACY_RULES: List[Tuple[List[str], str, bool]] = [
    (["island top", "island countertop", "island kitchen"], "island", False),
    (["perimeter kitchen", "kitchen countertop", "kitchen top"], "perimeter", False),
    (["range top"], "range", False),
    (["vanity top", "bathroom top", "laundry top"], "vanity", False),
    (["kitchen back splash", "kitchen side splash", "kitchen splash", "kitchen backsplash"], "perimeter", True),
    (["range back splash", "range side splash", "range splash", "range backsplash"], "range", True),
    (["vanity back splash", "vanity side splash", "vanity splash", "bathroom splash"], "vanity", True),
    (["back splash", "side splash", "backsplash"], "misc", True),
]

# Combined list kept for callers that iterate all rules (e.g. _is_main_slab_for_island_rule).
_DESC_RULES: List[Tuple[List[str], str, bool]] = _STANDARDIZED_RULES + _LEGACY_RULES

# Islands (Category A): min(length,width) in inches strictly greater than 36 ⇒ vertical island cassette.
# Overrides Kitchen/Perimeter CSV wording so wide slabs never ship in horizontal B crates.
ISLAND_MIN_EDGE_IN = 36.0

WIDTH_THRESH = {
    "island": 36.0,
    "perimeter": 25.0,
    "range": 25.0,
    "vanity": 19.0,
    "misc": 0.0,
}

_UNIT_KIND_FOR_CAT = {
    "island": "island_unit",
    "perimeter": "perimeter_unit",
    "range": "range_unit",
    "vanity": "vanity_unit",
    "misc": "misc_unit",
}

# When leftover splashes cannot match category-scoped take-rules, attach to first existing row in this order.
_ORPHAN_SPLASH_ATTACH_PRIORITY = ("island", "perimeter", "range", "vanity")


def unit_kind_for_category(cat: str) -> str:
    return _UNIT_KIND_FOR_CAT.get(str(cat), "misc_unit")


def normalize_dispatch_units(families: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """One audit row per family row for bundle/debug UI (dispatch consolidation diagnostics)."""
    rows: List[Dict[str, Any]] = []
    for i, f in enumerate(families):
        mids = [p["id"] for p in (f.get("main_pieces") or [])]
        sids = [p["id"] for p in (f.get("splash_pieces") or [])]
        rows.append({
            "unit_index": i,
            "unit_kind": f.get("unit_kind") or unit_kind_for_category(str(f.get("category") or "")),
            "family_id": f.get("family_id"),
            "flat_key": f.get("flat_key"),
            "category": f.get("category"),
            "main_piece_ids": mids,
            "splash_piece_ids": sids,
            "splash_attach_route": f.get("splash_attach_route"),
            "detached_reason": f.get("detached_reason"),
        })
    return rows


def piece_description_text(piece: Dict[str, Any]) -> str:
    """Part name + notes — backsplashes often described in notes."""
    return f"{piece.get('part') or ''} {piece.get('notes') or ''}".strip().lower()


def slab_width_for_rules(piece: Dict[str, Any]) -> float:
    """Shorter plan dimension used for category width thresholds."""
    a = parse_float(piece.get("length"))
    b = parse_float(piece.get("width"))
    return min(a, b) if a > 0 and b > 0 else max(a, b)


def _is_main_slab_for_island_rule(piece: Dict[str, Any], desc: str) -> bool:
    """True if this row is a main slab (not a thin splash) for island width override."""
    for _keywords, _cat, is_splash in _DESC_RULES:
        for kw in _keywords:
            if kw in desc and is_splash:
                return False
    if "splash" in desc or "backsplash" in desc or "b/s" in desc:
        return False
    return True


def classify_piece(piece: Dict[str, Any]) -> Tuple[str, bool]:
    desc = piece_description_text(piece)
    w = slab_width_for_rules(piece)
    # Explicit UI / CSV category wins over description keywords (e.g. "Kitchen / Vanity" text).
    csv_cat = str(piece.get("category") or "").strip().lower()
    if csv_cat == "island" and _is_main_slab_for_island_rule(piece, desc) and w > ISLAND_MIN_EDGE_IN:
        return "island", False

    # Category A / vertical island — shorter plan edge > 36″ (description / geometry heuristic)
    if _is_main_slab_for_island_rule(piece, desc) and w > ISLAND_MIN_EDGE_IN:
        return "island", False

    # Standardized Part Type rules — NO width threshold.
    # If the Part Type field carries a canonical name, it is definitive.
    for keywords, cat, is_splash in _STANDARDIZED_RULES:
        for kw in keywords:
            if kw in desc:
                return cat, is_splash

    # Legacy keyword heuristics — apply width threshold to filter out narrow mismatches.
    for keywords, cat, is_splash in _LEGACY_RULES:
        for kw in keywords:
            if kw in desc:
                if not is_splash:
                    th = WIDTH_THRESH.get(cat, 0.0)
                    if th > 0 and w < th:
                        continue
                return cat, is_splash

    if "island" in desc:
        return "perimeter", False
    if "kitchen" in desc or "perimeter" in desc:
        if w >= WIDTH_THRESH["perimeter"]:
            return "perimeter", False
    if "range" in desc and w >= WIDTH_THRESH["range"]:
        return "range", False
    if ("vanity" in desc or "bathroom" in desc or "laundry" in desc) and w >= WIDTH_THRESH["vanity"]:
        return "vanity", False
    if "splash" in desc or "backsplash" in desc:
        return "misc", True

    return "misc", False


_SHORT_PN_FUSE = re.compile(r"^(\d)-(\d{2})-(\d{2,})$")


def normalize_part_number_token(part_no: str) -> Tuple[str, Optional[str]]:
    """
    Canonicalize common malformed job prefixes (e.g. ``1-51-08`` → ``1051-08``).
    Returns (normalized_token, log_message_or_None).
    """
    raw = str(part_no or "").strip().replace(" ", "")
    if not raw:
        return "", None
    m = _SHORT_PN_FUSE.match(raw)
    if m:
        fused = f"{m.group(1)}0{m.group(2)}-{m.group(3)}"
        return fused, f"prefix_digit_fuse:{raw}->{fused}"
    return raw, None


def extract_family_prefix(part_no: str) -> Tuple[Optional[str], str]:
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


def flat_key(piece: Dict[str, Any]) -> str:
    parts = [str(piece.get(k, "") or "").strip() for k in ("building", "floor", "flat")]
    return " / ".join(p for p in parts if p) or "Unassigned"


def build_families(pieces: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Group by (flat, part_no prefix). Mains are split by category so an island top does not
    merge with a kitchen top under the same prefix. Splashes attach to the matching horizontal
    category (perimeter / range / vanity) for that prefix.

    Leftover splashes that classify as ``misc`` still prefer attaching to an existing row for the
    same prefix (island → perimeter → range → vanity) so the UI does not show duplicate
    ``1051-03 · Misc`` twins next to kitchen/island rows unless no horizontal row exists.
    """
    family_map: Dict[Tuple[str, str], Dict[str, Any]] = {}

    for piece in pieces:
        part_no_raw = str(piece.get("part_no", "") or "").strip()
        part_no, alias_note = normalize_part_number_token(part_no_raw)
        fk = flat_key(piece)
        prefix, role = extract_family_prefix(part_no)
        if not prefix:
            prefix = f"solo_{piece['id']}"
            role = "main"

        if role == "unknown":
            _, is_sp = classify_piece(piece)
            role = "splash" if is_sp else "main"

        fam_key = (fk, prefix)
        if fam_key not in family_map:
            family_map[fam_key] = {
                "family_id": prefix,
                "flat_key": fk,
                "mains_by_cat": defaultdict(list),
                "splashes": [],
                "prefix_normalization_events": [],
            }

        if alias_note:
            family_map[fam_key]["prefix_normalization_events"].append(alias_note)

        if role == "splash":
            family_map[fam_key]["splashes"].append(piece)
        else:
            cat, _ = classify_piece(piece)
            family_map[fam_key]["mains_by_cat"][cat].append(piece)

    keyed_rows: Dict[Tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)

    for fam_key, fdata in family_map.items():
        pool: List[Dict[str, Any]] = list(fdata["splashes"])
        for cat, mains in fdata["mains_by_cat"].items():
            if not mains:
                continue
            take: List[Dict[str, Any]] = []
            keep: List[Dict[str, Any]] = []
            for s in pool:
                sc, is_sp = classify_piece(s)
                # Island tops: kitchen/perimeter backsplashes share the same fab prefix — ship with the island cassette.
                if cat == "island" and is_sp and sc in {"island", "perimeter"}:
                    take.append(s)
                elif cat in {"perimeter", "range", "vanity"} and sc == cat:
                    take.append(s)
                else:
                    keep.append(s)
            pool = keep
            all_p = mains + take
            keyed_rows[fam_key].append({
                "family_id": fdata["family_id"],
                "flat_key": fdata["flat_key"],
                "category": cat,
                "main_pieces": mains,
                "splash_pieces": take,
                "all_pieces": all_p,
                "unit_kind": unit_kind_for_category(cat),
                "splash_attach_route": "category_scoped_pool_match",
                "prefix_normalization_events": list(fdata.get("prefix_normalization_events") or []),
            })

        remaining_pool: List[Dict[str, Any]] = []
        for s in pool:
            placed = False
            for pcat in _ORPHAN_SPLASH_ATTACH_PRIORITY:
                for r in keyed_rows[fam_key]:
                    if r["category"] != pcat:
                        continue
                    r["splash_pieces"].append(s)
                    r["all_pieces"].append(s)
                    r["splash_attach_route"] = "inherited_orphan_same_prefix"
                    placed = True
                    break
                if placed:
                    break
            if not placed:
                remaining_pool.append(s)

        for s in remaining_pool:
            sc, _ = classify_piece(s)
            keyed_rows[fam_key].append({
                "family_id": f"{fdata['family_id']}-splash",
                "flat_key": fdata["flat_key"],
                "category": sc,
                "main_pieces": [],
                "splash_pieces": [s],
                "all_pieces": [s],
                "unit_kind": "misc_unit",
                "splash_attach_route": "orphan_misc_row",
                "detached_reason": "no_horizontal_row_for_prefix_after_inheritance",
                "prefix_normalization_events": list(fdata.get("prefix_normalization_events") or []),
            })

    out: List[Dict[str, Any]] = []
    for rows in keyed_rows.values():
        out.extend(rows)
    return out
