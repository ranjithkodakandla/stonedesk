from typing import Any, Dict, List

from ..planning_engine import parse_float, thickness_inches

_WALL = 3.0
_HEIGHT_TOP = 6.0
_FOAM_LAYER = 0.75
_HONEYCOMB_SEP_IN = 1.25


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


_FORKLIFT_CLEARANCE_IN = 7.0
_BASE_SUPPORT_IN = 2.0


def island_cassette_dimensions_operational(
    pieces: List[Dict[str, Any]],
    default_thickness: str,
    wood_thickness: float,
) -> Dict[str, float]:
    """
    Operational island cassette: slabs adjacent (no intentional gap; film ignored).
    Depth along container length = sum of slab thicknesses + light framing.
    Height = longest slab edge + base support + normal top clearance.
    Forklift clearance added on external height (operational handling).
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
