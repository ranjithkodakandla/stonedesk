import re
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from ..planning_engine import parse_float

# (keywords, category, is_splash)
_DESC_RULES: List[Tuple[List[str], str, bool]] = [
    (["island top", "island countertop", "island kitchen"], "island", False),
    (["perimeter kitchen", "kitchen countertop", "kitchen top"], "perimeter", False),
    (["range top"], "range", False),
    (["vanity top", "bathroom top", "laundry top"], "vanity", False),
    (["kitchen back splash", "kitchen side splash", "kitchen splash", "kitchen backsplash"], "perimeter", True),
    (["range back splash", "range side splash", "range splash", "range backsplash"], "range", True),
    (["vanity back splash", "vanity side splash", "vanity splash", "bathroom splash"], "vanity", True),
    (["back splash", "side splash", "backsplash"], "misc", True),
]

WIDTH_THRESH = {
    "island": 36.0,
    "perimeter": 25.0,
    "range": 25.0,
    "vanity": 19.0,
    "misc": 0.0,
}


def piece_description_text(piece: Dict[str, Any]) -> str:
    """Part name + notes — backsplashes often described in notes."""
    return f"{piece.get('part') or ''} {piece.get('notes') or ''}".strip().lower()


def slab_width_for_rules(piece: Dict[str, Any]) -> float:
    """Shorter plan dimension used for category width thresholds."""
    a = parse_float(piece.get("length"))
    b = parse_float(piece.get("width"))
    return min(a, b) if a > 0 and b > 0 else max(a, b)


def classify_piece(piece: Dict[str, Any]) -> Tuple[str, bool]:
    desc = piece_description_text(piece)
    w = slab_width_for_rules(piece)

    for keywords, cat, is_splash in _DESC_RULES:
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
    """
    family_map: Dict[Tuple[str, str], Dict[str, Any]] = {}

    for piece in pieces:
        part_no = str(piece.get("part_no", "") or "").strip()
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
            }

        if role == "splash":
            family_map[fam_key]["splashes"].append(piece)
        else:
            cat, _ = classify_piece(piece)
            family_map[fam_key]["mains_by_cat"][cat].append(piece)

    out: List[Dict[str, Any]] = []
    for fdata in family_map.values():
        pool: List[Dict[str, Any]] = list(fdata["splashes"])
        for cat, mains in fdata["mains_by_cat"].items():
            if not mains:
                continue
            take: List[Dict[str, Any]] = []
            keep: List[Dict[str, Any]] = []
            for s in pool:
                sc, _ = classify_piece(s)
                if cat in {"perimeter", "range", "vanity"} and sc == cat:
                    take.append(s)
                else:
                    keep.append(s)
            pool = keep
            all_p = mains + take
            out.append({
                "family_id": fdata["family_id"],
                "flat_key": fdata["flat_key"],
                "category": cat,
                "main_pieces": mains,
                "splash_pieces": take,
                "all_pieces": all_p,
            })

        for s in pool:
            sc, _ = classify_piece(s)
            out.append({
                "family_id": f"{fdata['family_id']}-splash",
                "flat_key": fdata["flat_key"],
                "category": sc,
                "main_pieces": [],
                "splash_pieces": [s],
                "all_pieces": [s],
            })

    return out
