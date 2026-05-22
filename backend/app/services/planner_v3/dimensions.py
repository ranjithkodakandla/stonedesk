from typing import Any, Dict, List

from ..planning_engine import parse_float, thickness_inches

_WALL = 3.0
_HEIGHT_TOP = 6.0
_FOAM_LAYER = 0.75
_HONEYCOMB_SEP_IN = 1.25

# ─── Leaned cassette constants (mirrors crateEstimator.js) ───────────────────
_LEAN_FACTOR      = 0.966   # cos(15°) — 15° operational lean from vertical
_SEPARATOR_IN     = 0.75    # foam separator per slab gap
_DEPTH_FRAME      = 4.0     # framing allowance on depth axis
_LENGTH_CLEARANCE = 2.0     # internal end clearance (1" each end)
_END_FRAME        = 2.0     # external end-board thickness (1" each end)
_PALLET_BASE      = 6.0     # pallet / sled base height
_LEAN_HEADROOM    = 4.0     # head clearance above leaned slabs
_FORKLIFT_CLEARANCE_IN = 7.0


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
    Leaned cassette model — mirrors estimateLeanedCassetteDimensions() in crateEstimator.js.

    Slabs lean backward at 15° from vertical in transport. Three axes:

      L (internal_length) — PRIMARY, fixed by slab footprint:
          max_slab_long_edge + end clearance

      D (internal_width) — DEPTH, grows with slab count:
          Σ thicknesses + foam separators + framing

      H (internal_height) — LEAN-CORRECTED, from slab short edge:
          max_slab_short_edge × cos(15°) + pallet + headroom

    Old model used height = max_long_edge which produced 106"–131" external heights.
    Realistic leaned cassette heights are 50–65" for standard island tops.
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

    # Height derives from main pieces only; splash pieces are shallow and don't dictate H
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

    # L — primary length (fixed by slab footprint)
    internal_length = max_long + _LENGTH_CLEARANCE

    # D — cassette depth (grows with slab count + separators)
    separators = max(0, n - 1) * _SEPARATOR_IN
    internal_width = stack_depth + separators + _DEPTH_FRAME

    # H — height from lean geometry
    internal_height = max_short * _LEAN_FACTOR + _PALLET_BASE + _LEAN_HEADROOM

    return {
        "internal_length": round(internal_length, 1),
        "internal_width":  round(internal_width, 1),
        "internal_height": round(internal_height, 1),
        "external_length": round(internal_length + _END_FRAME, 1),          # + end boards
        "external_width":  round(internal_width  + _WALL * 2, 1),           # + side walls
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
