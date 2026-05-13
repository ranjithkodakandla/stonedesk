"""
Proximity ordering for pull candidates and merge hints (building → floor → flat).
Tiers (lower = closer): same flat → adjacent flat (same floor) → same floor →
adjacent floor → same building.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from ..planning_engine import sortable_token
from .flat_tokens import flat_sort_key, flats_are_adjacent


def _strip(s: Any) -> str:
    return str(s or "").strip()


def _parse_int_token(s: str) -> Optional[int]:
    if not s:
        return None
    m = re.search(r"-?\d+", s)
    if not m:
        return None
    try:
        return int(m.group(0))
    except ValueError:
        return None


def _floor_rank_token(floor: str) -> Tuple:
    fk = flat_sort_key(floor)
    if fk[0] == 0:
        return (0, fk[1], fk[2], fk[3], fk[4])
    return (1, sortable_token(floor))


ADJACENCY_TIER_LABELS = {
    0: "same_flat",
    1: "adjacent_flat_same_floor",
    2: "same_floor_other_flat",
    3: "adjacent_floor",
    4: "same_building_other_floor",
    6: "other_building",
    9: "unknown_location",
}


def adjacency_tier(ref: Dict[str, Any], cand: Dict[str, Any]) -> Tuple[int, Tuple, str]:
    """
    Sort key for ranking candidates relative to ref (lower is better).
    Returns (tier, tie_break_tuple, flat_key_cand) for stable sorts.
    """
    rb, rf, rfl = _strip(ref.get("building")), _strip(ref.get("floor")), _strip(ref.get("flat"))
    cb, cf, cfl = _strip(cand.get("building")), _strip(cand.get("floor")), _strip(cand.get("flat"))

    fk = cand.get("flat_key") or ""

    if not cb and not cf and not cfl:
        return (9, (1,), fk)

    if rb == cb and rf == cf and rfl == cfl:
        return (0, (0,), fk)

    if rb != cb:
        return (6, (sortable_token(cb), sortable_token(cf), sortable_token(cfl)), fk)

    # same building
    if rf != cf:
        # same floor match failed — adjacent floors?
        fi = _parse_int_token(rf)
        ci = _parse_int_token(cf)
        if fi is not None and ci is not None and abs(fi - ci) == 1:
            return (3, (_floor_rank_token(cf), sortable_token(cfl)), fk)
        return (4, (_floor_rank_token(cf), sortable_token(cfl)), fk)

    # same floor, different flat — alphanumeric adjacency
    if flats_are_adjacent(rfl, cfl):
        return (1, flat_sort_key(cfl), fk)
    # same floor, non-adjacent flat
    return (2, flat_sort_key(cfl), fk)


def sort_bundles_by_pull_proximity(
    ref: Dict[str, Any],
    candidates: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    def key(b: Dict[str, Any]) -> Tuple:
        tier, tie, _fk = adjacency_tier(ref, b)
        return (tier, tie, b.get("bundle_id") or "")

    return sorted(candidates, key=key)


def ordered_pull_piece_ids(
    ref: Dict[str, Any],
    candidate_bundles: List[Dict[str, Any]],
    assigned_piece_ids: set,
    limit: int = 80,
) -> List[int]:
    """Piece IDs from bundles near ref, excluding already-assigned ids."""
    pool = [b for b in candidate_bundles if b.get("all_piece_ids")]
    ordered = sort_bundles_by_pull_proximity(ref, pool)
    out: List[int] = []
    seen: set = set()
    for b in ordered:
        for pid in b.get("all_piece_ids") or []:
            if pid in assigned_piece_ids or pid in seen:
                continue
            seen.add(pid)
            out.append(pid)
            if len(out) >= limit:
                return out
    return out
