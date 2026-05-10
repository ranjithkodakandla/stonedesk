"""
Lightweight geometry checks for merging range units into perimeter (kitchen) crates.
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

from ..planning_engine import parse_float
from .dimensions import horizontal_crate_dimensions

# Operational horizontal crate caps (internal inches) — merged crate must fit.
_MAX_INTERNAL_LENGTH_IN = 132.0
_MAX_INTERNAL_WIDTH_IN = 100.0
_MAX_SPLASH_SUBLAYERS = 8
_MAX_SPLASH_PIECES_LAYER2 = 32
_MAIN_DIM_TOLERANCE_IN = 12.0


def _max_piece_long_short(pieces: List[Dict[str, Any]]) -> Tuple[float, float]:
    best_long = 0.0
    best_short = 0.0
    for p in pieces:
        L = parse_float(p.get("length"))
        W = parse_float(p.get("width"))
        long_e = max(L, W)
        short_e = min(L, W) if L > 0 and W > 0 else max(L, W)
        best_long = max(best_long, long_e)
        best_short = max(best_short, short_e)
    return best_long, best_short


def range_into_kitchen_geometry_ok(
    kitchen_batch_units: List[Dict[str, Any]],
    range_unit: Dict[str, Any],
    *,
    default_thickness: str,
    wood_thickness: float,
) -> bool:
    """
    Validates merged horizontal crate dimensions, splash layer capacity, and main-piece
    length/width compatibility (range not much larger than kitchen mains).
    """
    from .packing import _merge_units_batch

    merged_units = list(kitchen_batch_units) + [range_unit]
    mains, splash_layers = _merge_units_batch(merged_units)

    if len(splash_layers) > _MAX_SPLASH_SUBLAYERS:
        return False

    splash_count = sum(len(layer) for layer in splash_layers)
    if splash_count > _MAX_SPLASH_PIECES_LAYER2:
        return False

    dims = horizontal_crate_dimensions(mains, splash_layers, default_thickness, wood_thickness)
    if dims["internal_length"] > _MAX_INTERNAL_LENGTH_IN or dims["internal_width"] > _MAX_INTERNAL_WIDTH_IN:
        return False

    batch_mains: List[Dict[str, Any]] = []
    for u in kitchen_batch_units:
        batch_mains.extend(u.get("mains") or [])
    r_mains = list(range_unit.get("mains") or [])
    if not batch_mains or not r_mains:
        return True

    kl, kw = _max_piece_long_short(batch_mains)
    rl, rw = _max_piece_long_short(r_mains)
    if rl > kl + _MAIN_DIM_TOLERANCE_IN or rw > kw + _MAIN_DIM_TOLERANCE_IN:
        return False

    return True
