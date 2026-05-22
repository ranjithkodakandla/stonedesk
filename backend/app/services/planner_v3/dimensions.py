from typing import Any, Dict, List

from ..planning_engine import parse_float, thickness_inches

_WALL = 3.0
_HEIGHT_TOP = 6.0
_FOAM_LAYER = 0.75
_HONEYCOMB_SEP_IN = 1.25
_FORKLIFT_CLEARANCE_IN = 7.0
_BASE_SUPPORT_IN = 2.0


def _max_piece_length(pieces: List[Dict[str, Any]]) -> float:
    if not pieces:
        return 0.0
    return max(parse_float(p.get("length")) for p in pieces)


def _max_piece_width(pieces: List[Dict[str, Any]]) -> float:
    if not pieces:
        return 0.0
    return max(parse_float(p.get("width")) for p in pieces)


def horizontal_crate_dimensions(
    main_pieces: List[Dict[str, Any]],
    splash_layers: List[List[Dict[str, Any]]],
    default_thickness: str,
    wood_thickness: float,
) -> Dict[str, float]:
    """Flat-lay horizontal crate: mains on bottom, splashes in stacked layers."""
    all_p = main_pieces + [p for layer in splash_layers for p in layer]
    if not all_p:
        return {
            "internal_length": 0.0,
            "internal_width": 0.0,
            "internal_height": 0.0,
            "external_length": 0.0,
            "external_width": 0.0,
            "external_height": 0.0,
        }

    internal_length = _max_piece_length(all_p) + 6.0
    internal_width = _max_piece_width(all_p) + 6.0

    if main_pieces:
        main_h = max(thickness_inches(str(p.get("thickness") or default_thickness)) for p in main_pieces)
    else:
        main_h = thickness_inches(default_thickness)

    splash_h = 0.0
    active_layers = [layer for layer in splash_layers if layer]
    for li, layer in enumerate(active_layers):
        layer_t = max(thickness_inches(str(p.get("thickness") or default_thickness)) for p in layer)
        splash_h += layer_t + _FOAM_LAYER
        if li + 1 < len(active_layers):
            splash_h += _HONEYCOMB_SEP_IN

    internal_height = max(18.0, main_h + splash_h + 8.0)

    return {
        "internal_length": round(internal_length, 1),
        "internal_width": round(internal_width, 1),
        "internal_height": round(internal_height, 1),
        "external_length": round(internal_length + _WALL, 1),
        "external_width": round(internal_width + _WALL, 1),
        "external_height": round(internal_height + _HEIGHT_TOP, 1),
        "wood_thickness": wood_thickness,
    }


def island_cassette_dimensions_operational(
    pieces: List[Dict[str, Any]],
    default_thickness: str,
    wood_thickness: float,
) -> Dict[str, float]:
    """
    OPTIMIZER coordinate system — do NOT change axis semantics here.

    Used by: recompute_layout.py, geometry_gate.py, phase_a_island.py,
             kitchen_operational_plan.py, container packing solver.

    Axis convention expected by the optimizer:
      internal_length  = cassette DEPTH footprint (Σ thicknesses + framing)
                         ← small value (~15–20"), placed along container length axis
      internal_width   = slab short-edge width (slab WIDTH dimension)
      internal_height  = slab long-edge height (upright slab height)

    For human-readable operational crate cards in the Draft Crate UI use
    leaned_operational_cassette_dimensions() instead — that function uses the
    correct physical orientation (long edge = cassette length, short edge = height).
    """
    if not pieces:
        return {
            "internal_length": 0.0,
            "internal_width": 0.0,
            "internal_height": 0.0,
            "external_length": 0.0,
            "external_width": 0.0,
            "external_height": 0.0,
            "wood_thickness": wood_thickness,
        }

    stack_depth = 0.0
    max_long = 0.0
    max_short = 0.0
    for p in pieces:
        t = thickness_inches(str(p.get("thickness") or default_thickness))
        L = parse_float(p.get("length"))
        W = parse_float(p.get("width"))
        long_e = max(L, W)
        short_e = min(L, W) if L > 0 and W > 0 else max(L, W)
        stack_depth += t
        max_long = max(max_long, long_e)
        max_short = max(max_short, short_e)

    framing_depth = 4.0
    internal_length = min(92.0, stack_depth + framing_depth)
    internal_width = max_short + 6.0
    internal_height = max_long + _BASE_SUPPORT_IN + 6.0

    external_length = round(internal_length + _WALL, 1)
    external_width = round(internal_width + _WALL, 1)
    external_height = round(internal_height + _HEIGHT_TOP + _FORKLIFT_CLEARANCE_IN, 1)

    return {
        "internal_length": round(internal_length, 1),
        "internal_width": round(internal_width, 1),
        "internal_height": round(internal_height, 1),
        "external_length": external_length,
        "external_width": external_width,
        "external_height": external_height,
        "wood_thickness": wood_thickness,
    }


# ─── Leaned operational cassette geometry ────────────────────────────────────
# Physical orientation of island slabs in transport:
#   Long edge  → runs horizontally along cassette primary length axis
#   Short edge → becomes effective standing height (lean-adjusted)
#   Thickness  → accumulates into cassette depth
#
# This is the DISPLAY geometry for Draft Crate UI and operational planning cards.
# DO NOT use for optimizer/container-packing calculations — see
# island_cassette_dimensions_operational() for the optimizer coordinate system.

_LEAN_FACTOR      = 0.966   # cos(15°) — 15° operational lean from vertical
_SEPARATOR_IN     = 0.75    # foam separator per slab gap
_DEPTH_FRAME      = 4.0     # framing on depth axis
_LENGTH_CLEARANCE = 2.0     # internal end clearance (1" each end)
_END_FRAME        = 2.0     # external end-board thickness (1" each end)
_PALLET_BASE      = 6.0     # pallet / sled base height
_LEAN_HEADROOM    = 4.0     # head clearance above leaned slabs


def leaned_operational_cassette_dimensions(
    pieces: List[Dict[str, Any]],
    default_thickness: str,
    wood_thickness: float,
) -> Dict[str, float]:
    """
    OPERATIONAL DISPLAY geometry — mirrors estimateLeanedCassetteDimensions()
    in frontend/src/utils/crateEstimator.js. Keep both in sync manually.

    Physical model (slabs lean at 15° from vertical):
      internal_length = max slab LONG edge + end clearance   [L, fixed primary axis]
      internal_width  = Σ thicknesses + separators + framing  [D, grows with slab count]
      internal_height = max slab SHORT edge × cos(15°) + pallet + headroom  [H]

    Example — 10× 96"×32" @ 3CM:
      internal:  98" × 19.5" × 40.9"
      external: 100" × 25.5" × 53.9"   ← operationally realistic

    vs optimizer coordinates for the same slabs:
      internal:  15.8" × 38" × 104"    ← small footprint, tall (for packing solver)
    """
    if not pieces:
        return {
            "internal_length": 0.0,
            "internal_width": 0.0,
            "internal_height": 0.0,
            "external_length": 0.0,
            "external_width": 0.0,
            "external_height": 0.0,
            "wood_thickness": wood_thickness,
        }

    # Height derives from main pieces (tops); splash pieces are shallow and don't dictate H
    main_pieces = [p for p in pieces if str(p.get("role", "main")) != "splash"]
    ref_pieces = main_pieces if main_pieces else pieces

    stack_depth = 0.0
    max_long = 0.0
    max_short = 0.0
    n = len(pieces)

    for p in pieces:
        stack_depth += thickness_inches(str(p.get("thickness") or default_thickness))

    for p in ref_pieces:
        L = parse_float(p.get("length"))
        W = parse_float(p.get("width"))
        long_e = max(L, W)
        short_e = min(L, W) if L > 0 and W > 0 else max(L, W)
        max_long = max(max_long, long_e)
        max_short = max(max_short, short_e)

    # L — primary length (fixed by slab footprint, not slab count)
    internal_length = max_long + _LENGTH_CLEARANCE

    # D — cassette depth (grows with slab count + foam separators)
    separators = max(0, n - 1) * _SEPARATOR_IN
    internal_width = stack_depth + separators + _DEPTH_FRAME

    # H — height from leaned geometry (short edge drives height, not long edge)
    internal_height = max_short * _LEAN_FACTOR + _PALLET_BASE + _LEAN_HEADROOM

    return {
        "internal_length": round(internal_length, 1),
        "internal_width":  round(internal_width, 1),
        "internal_height": round(internal_height, 1),
        "external_length": round(internal_length + _END_FRAME, 1),
        "external_width":  round(internal_width  + _WALL * 2, 1),
        "external_height": round(internal_height + _HEIGHT_TOP + _FORKLIFT_CLEARANCE_IN, 1),
        "wood_thickness":  wood_thickness,
    }


def island_vertical_dimensions(
    pieces: List[Dict[str, Any]],
    default_thickness: str,
    wood_thickness: float,
) -> Dict[str, float]:
    """
    Vertical cassette: slabs on long edge — tall crate, narrow depth along container length from back wall.
    """
    if not pieces:
        return {
            "internal_length": 0.0,
            "internal_width": 0.0,
            "internal_height": 0.0,
            "external_length": 0.0,
            "external_width": 0.0,
            "external_height": 0.0,
        }

    n = len(pieces)
    t = max(thickness_inches(str(p.get("thickness") or default_thickness)) for p in pieces)
    # Depth along container x (from back): slab thickness stack + framing
    internal_length = min(92.0, 8.0 + n * (t + 0.05))
    internal_width = _max_piece_width(pieces) + 6.0
    internal_height = _max_piece_length(pieces) + 10.0

    return {
        "internal_length": round(internal_length, 1),
        "internal_width": round(internal_width, 1),
        "internal_height": round(internal_height, 1),
        "external_length": round(internal_length + _WALL, 1),
        "external_width": round(internal_width + _WALL, 1),
        "external_height": round(internal_height + _HEIGHT_TOP, 1),
        "wood_thickness": wood_thickness,
    }


def total_piece_weight(pieces: List[Dict[str, Any]], material: str, thickness: str, color: str) -> float:
    from ..planning_engine import piece_weight

    return sum(piece_weight(p, material, thickness, color) for p in pieces)
