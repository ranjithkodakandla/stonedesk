"""
Parametric countertop drawing templates.

A template is a small, config-driven definition: parameters an end user
fills in, constraints that keep the geometry valid, and functions that turn
parameter values into (a) drawing geometry and (b) an ASSEMBLY of the same
canonical countertop fields the manual Source Data entry form produces
(`PieceCreate` in main.py). Both the manual-entry path and this generator
converge on that one canonical shape, so crate planning / cut list / label
printing need no changes to consume generated pieces.

An assembly is a list of {"role": ..., "fields": {...}} entries — one "top"
piece plus, for templates that carry them (vanity/kitchen — never islands),
optional "backsplash" / "side_splash_left" / "side_splash_right" accessory
pieces. Real StoneDesk fabrication drawings always cut backsplash and side
splash from the same job as the top they attach to (see the Concord Crossing
reference drawings), so accessories are bundled with the parent template and
controlled with include_backsplash / include_side_splash booleans rather
than being separate templates a user has to assemble by hand. Every
accessory can be unchecked when a job doesn't need it (e.g. against an
existing wall).

Adding a template = adding one entry to TEMPLATES. No other code changes.
"""

from typing import Any, Dict, List


class TemplateError(ValueError):
    """Raised when parameter values violate a template's constraints."""


def _num(params: Dict[str, Any], key: str, default: float = 0.0) -> float:
    val = params.get(key, default)
    if val is None or val == "":
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _bool(params: Dict[str, Any], key: str, default: bool = True) -> bool:
    val = params.get(key, default)
    if val is None:
        return default
    if isinstance(val, str):
        return val.strip().lower() in ("1", "true", "yes", "on")
    return bool(val)


def _check_range(errors: List[str], label: str, value: float, lo: float, hi: float) -> None:
    if value < lo or value > hi:
        errors.append(f'{label} must be between {lo:g}" and {hi:g}".')


def _tap_hole_geometry(sink_x: float, sink_y: float, sink_length: float, sink_width: float) -> Dict[str, Any]:
    """Faucet/tap hole + its offset dimension and a leader line to the sink
    cutout — real fab drawings always call this out (Ø1.5" hole, offset from
    the back edge) even when the sink cutout itself is "cut by template" and
    not separately dimensioned.

    The offset dimension is drawn beside the hole (shifted by half the sink
    width, a value that itself comes from the entered sink dimensions —
    never a fixed pixel nudge) rather than straight through its centerline,
    because the hole sits on the countertop's own horizontal centerline for
    a centered sink — exactly where the top-edge "X" finish mark also
    lands. Offsetting the dimension line, not just its label, keeps the
    tick marks and text clear of that mark instead of overlapping it.
    """
    hole_offset_back = min(3.0, max(sink_y - 0.5, 0.5))
    hole_x = sink_x + sink_length / 2
    hole_y = hole_offset_back
    dim_x = hole_x + sink_width / 2 + 1.5
    return {
        "pos": [hole_x, hole_y],
        "diameter": 1.5,
        "leader_to": [sink_x + sink_length * 0.35, sink_y],
        "dimensions": [
            {"from": [dim_x, 0], "to": [dim_x, hole_y], "label": f'{hole_offset_back:g}"', "side": "none"},
        ],
    }


def _corner_radius_label(radius: float) -> Dict[str, Any]:
    return {"text": f'R.{radius:g} in', "leader_to": [0, 0], "pos": [-14, 14]}


def _top(fields: Dict[str, Any]) -> Dict[str, Any]:
    return {"role": "top", "fields": fields}


def _backsplash(category: str, length: float, height: float = 4.0) -> Dict[str, Any]:
    return {"role": "backsplash", "fields": {
        "category": category, "shape_type": "Rectangle",
        "length": round(length, 3), "width": height, "sink_type": "No Sink",
    }}


def _side_splash(role: str, category: str, length: float, height: float) -> Dict[str, Any]:
    return {"role": role, "fields": {
        "category": category, "shape_type": "Rectangle",
        "length": round(length, 3), "width": height, "sink_type": "No Sink",
    }}


# ── Standard Island (no backsplash/side splash — islands don't get them) ──
def _island_standard_geometry(params: Dict[str, Any]) -> Dict[str, Any]:
    length = _num(params, "length", 96)
    width = _num(params, "width", 42)
    overhang = _num(params, "overhang", 12)

    outline = [[0, 0], [length, 0], [length, width], [0, width]]
    dimensions = [
        {"from": [0, 0], "to": [length, 0], "label": f'{length:g}"', "side": "top"},
        {"from": [0, 0], "to": [0, width], "label": f'{width:g}"', "side": "left"},
    ]
    notes = []
    if overhang:
        notes.append(f'Overhang: {overhang:g}" (relative to cabinet base, not part of cut size)')
    return {"width_in": length, "height_in": width, "outline": outline, "cutouts": [], "dimensions": dimensions, "notes": notes, "accessories": [], "edge_marks": ["top", "left", "right", "bottom"], "corner_radius": 0.5}


def _island_standard_constraints(params: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    _check_range(errors, "Length", _num(params, "length", 96), 24, 180)
    _check_range(errors, "Width", _num(params, "width", 42), 18, 60)
    _check_range(errors, "Overhang", _num(params, "overhang", 12), 0, 18)
    return errors


def _island_standard_assembly(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [_top({
        "category": "Kitchen - Island Tops",
        "shape_type": "Rectangle",
        "length": _num(params, "length", 96),
        "width": _num(params, "width", 42),
        "sink_type": "No Sink",
        "notes": f'Overhang {_num(params, "overhang", 12):g}"',
    })]


# ── Island With Sink ─────────────────────────────────────────────────────
def _island_sink_geometry(params: Dict[str, Any]) -> Dict[str, Any]:
    length = _num(params, "length", 96)
    width = _num(params, "width", 42)
    sink_length = _num(params, "sink_length", 30)
    sink_width = _num(params, "sink_width", 18)
    sink_offset_left = _num(params, "sink_offset_left", (length - sink_length) / 2)

    outline = [[0, 0], [length, 0], [length, width], [0, width]]
    sink_x = sink_offset_left
    sink_y = (width - sink_width) / 2
    cutouts = [{
        "type": "sink", "shape": "oval",
        "rect": [sink_x, sink_y, sink_length, sink_width],
        "label": "Polish",
    }]
    dimensions = [
        {"from": [0, 0], "to": [length, 0], "label": f'{length:g}"', "side": "top"},
        {"from": [0, 0], "to": [0, width], "label": f'{width:g}"', "side": "left"},
        {"from": [0, width], "to": [sink_x, width], "label": f'{sink_offset_left:g}"', "side": "bottom"},
        {"from": [sink_x, width], "to": [sink_x + sink_length, width], "label": f'{sink_length:g}"', "side": "bottom"},
    ]
    tap_hole = _tap_hole_geometry(sink_x, sink_y, sink_length, sink_width)
    dimensions += tap_hole.pop("dimensions")
    edge_marks = ["top", "left", "right", "bottom"]
    return {"width_in": length, "height_in": width, "outline": outline, "cutouts": cutouts, "dimensions": dimensions, "notes": [], "accessories": [], "edge_marks": edge_marks, "corner_radius": 0.5, "tap_hole": tap_hole}


def _island_sink_constraints(params: Dict[str, Any]) -> List[str]:
    errors = _island_standard_constraints(params)
    length = _num(params, "length", 96)
    width = _num(params, "width", 42)
    sink_length = _num(params, "sink_length", 30)
    sink_width = _num(params, "sink_width", 18)
    sink_offset_left = _num(params, "sink_offset_left", (length - sink_length) / 2)
    min_clear = 3.0

    if sink_length <= 0 or sink_width <= 0:
        errors.append("Sink dimensions must be greater than zero.")
        return errors
    if sink_offset_left < min_clear:
        errors.append(f'Sink is too close to the left edge. Move the sink at least {min_clear:g}".')
    if sink_offset_left + sink_length > length - min_clear:
        errors.append(f'Sink is too close to the right edge. Move the sink at least {min_clear:g}" from the right.')
    if sink_width > width - 2 * min_clear:
        errors.append(f'Sink is too wide for this countertop depth. Leave at least {min_clear:g}" front and back.')
    return errors


def _island_sink_assembly(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    length = _num(params, "length", 96)
    sink_length = _num(params, "sink_length", 30)
    sink_offset_left = _num(params, "sink_offset_left", (length - sink_length) / 2)
    sink_offset_right = length - sink_offset_left - sink_length
    fields = _island_standard_assembly(params)[0]["fields"]
    fields.update({
        "sink_type": "Undermount",
        "sink_length": sink_length,
        "sink_width": _num(params, "sink_width", 18),
        "sink_offset_left": sink_offset_left,
        "sink_offset_right": sink_offset_right,
        "notes": f'Overhang {_num(params, "overhang", 12):g}", sink offset {sink_offset_left:g}" from left',
    })
    return [_top(fields)]


# ── Vanity Top (bundles backsplash + 2 side splashes, per real fab drawings) ──
def _vanity_top_geometry(params: Dict[str, Any]) -> Dict[str, Any]:
    length = _num(params, "length", 55)
    depth = _num(params, "depth", 22.5)
    sink_length = _num(params, "sink_length", 21.625)
    sink_width = _num(params, "sink_width", 15)
    sink_offset_left = _num(params, "sink_offset_left", (length - sink_length) / 2)
    splash_height = _num(params, "splash_height", 4)
    include_backsplash = _bool(params, "include_backsplash", True)
    include_side_splash = _bool(params, "include_side_splash", True)

    outline = [[0, 0], [length, 0], [length, depth], [0, depth]]
    sink_x = sink_offset_left
    sink_y = (depth - sink_width) / 2
    cutouts = [{"type": "sink", "shape": "oval", "rect": [sink_x, sink_y, sink_length, sink_width], "label": "Polish"}]
    tap_hole = _tap_hole_geometry(sink_x, sink_y, sink_length, sink_width)
    dimensions = [
        {"from": [0, 0], "to": [length, 0], "label": f'{length:g}"', "side": "top"},
        {"from": [0, 0], "to": [0, depth], "label": f'{depth:g}"', "side": "left"},
        {"from": [0, depth], "to": [sink_x, depth], "label": f'{sink_offset_left:g}"', "side": "bottom"},
        {"from": [sink_x, depth], "to": [sink_x + sink_length, depth], "label": f'{sink_length:g}"', "side": "bottom"},
    ] + tap_hole.pop("dimensions")
    accessories = []
    if include_backsplash:
        accessories.append({"role": "backsplash", "label": f'Backsplash {length:g}" x {splash_height:g}"', "w": length, "h": splash_height})
    if include_side_splash:
        accessories.append({"role": "side_splash_left", "label": f'Side Splash {depth:g}" x {splash_height:g}"', "w": depth, "h": splash_height})
        accessories.append({"role": "side_splash_right", "label": f'Side Splash {depth:g}" x {splash_height:g}"', "w": depth, "h": splash_height})
    return {"width_in": length, "height_in": depth, "outline": outline, "cutouts": cutouts, "dimensions": dimensions, "notes": [], "accessories": accessories, "edge_marks": ["top", "left", "right", "bottom"], "corner_radius": 0.5, "tap_hole": tap_hole}


def _vanity_top_constraints(params: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    length = _num(params, "length", 55)
    depth = _num(params, "depth", 22.5)
    sink_length = _num(params, "sink_length", 21.625)
    sink_width = _num(params, "sink_width", 15)
    sink_offset_left = _num(params, "sink_offset_left", (length - sink_length) / 2)
    min_clear = 3.0
    _check_range(errors, "Length", length, 24, 120)
    _check_range(errors, "Depth", depth, 18, 30)
    if sink_length <= 0 or sink_width <= 0:
        errors.append("Sink dimensions must be greater than zero.")
        return errors
    if sink_offset_left < min_clear:
        errors.append(f'Sink is too close to the left edge. Move the sink at least {min_clear:g}".')
    if sink_offset_left + sink_length > length - min_clear:
        errors.append(f'Sink is too close to the right edge. Move the sink at least {min_clear:g}" from the right.')
    if sink_width > depth - 2 * min_clear:
        errors.append(f'Sink is too wide for this vanity depth. Leave at least {min_clear:g}" front and back.')
    return errors


def _vanity_top_assembly(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    length = _num(params, "length", 55)
    depth = _num(params, "depth", 22.5)
    sink_length = _num(params, "sink_length", 21.625)
    sink_offset_left = _num(params, "sink_offset_left", (length - sink_length) / 2)
    sink_offset_right = length - sink_offset_left - sink_length
    splash_height = _num(params, "splash_height", 4)

    assembly = [_top({
        "category": "Vanity - Top",
        "shape_type": "Rectangle",
        "length": length,
        "width": depth,
        "sink_type": "Undermount",
        "sink_length": sink_length,
        "sink_width": _num(params, "sink_width", 15),
        "sink_offset_left": sink_offset_left,
        "sink_offset_right": sink_offset_right,
    })]
    if _bool(params, "include_backsplash", True):
        assembly.append(_backsplash("Vanity - Back Splash", length, splash_height))
    if _bool(params, "include_side_splash", True):
        assembly.append(_side_splash("side_splash_left", "Vanity - Side Splash", depth, splash_height))
        assembly.append(_side_splash("side_splash_right", "Vanity - Side Splash", depth, splash_height))
    return assembly


# ── Kitchen Top (L-shaped, bundles backsplash + 2 side splashes) ──────────
def _kitchen_l_top_geometry(params: Dict[str, Any]) -> Dict[str, Any]:
    left_run = _num(params, "left_run", 63)
    right_run = _num(params, "right_run", 49)
    depth = _num(params, "depth", 44)
    notch_depth = _num(params, "notch_depth", 25.5)
    sink_length = _num(params, "sink_length", 33)
    sink_width = _num(params, "sink_width", 21)
    sink_offset_left = _num(params, "sink_offset_left", left_run / 2 - sink_length / 2)
    splash_height = _num(params, "splash_height", 4)
    include_backsplash = _bool(params, "include_backsplash", True)
    include_side_splash = _bool(params, "include_side_splash", True)

    total_length = left_run + right_run
    # L-shape: full-depth run on the left, a shallower notch on the right
    # (matches the real drawings' "26 + 2 OVG" style kitchen tops).
    outline = [
        [0, 0], [total_length, 0], [total_length, notch_depth],
        [left_run, notch_depth], [left_run, depth], [0, depth],
    ]
    sink_x = sink_offset_left
    sink_y = (depth - sink_width) / 2
    cutouts = [{"type": "sink", "shape": "rounded_rect", "rect": [sink_x, sink_y, sink_length, sink_width], "label": "Polish"}]
    tap_hole = _tap_hole_geometry(sink_x, sink_y, sink_length, sink_width)
    dimensions = [
        {"from": [0, 0], "to": [total_length, 0], "label": f'{total_length:g}"', "side": "top"},
        {"from": [0, 0], "to": [0, depth], "label": f'{depth:g}"', "side": "left"},
        {"from": [0, depth], "to": [sink_x, depth], "label": f'{sink_offset_left:g}"', "side": "bottom"},
        {"from": [sink_x, depth], "to": [sink_x + sink_length, depth], "label": f'{sink_length:g}"', "side": "bottom"},
    ] + tap_hole.pop("dimensions")
    accessories = []
    if include_backsplash:
        accessories.append({"role": "backsplash", "label": f'Backsplash {left_run:g}" x {splash_height:g}"', "w": left_run, "h": splash_height})
        accessories.append({"role": "backsplash_right", "label": f'Backsplash {right_run:g}" x {splash_height:g}"', "w": right_run, "h": splash_height})
    if include_side_splash:
        accessories.append({"role": "side_splash_left", "label": f'Side Splash {depth:g}" x {depth:g}"', "w": depth, "h": depth})
        accessories.append({"role": "side_splash_right", "label": f'Side Splash {notch_depth:g}" x {notch_depth:g}"', "w": notch_depth, "h": notch_depth})
    return {"width_in": total_length, "height_in": depth, "outline": outline, "cutouts": cutouts, "dimensions": dimensions, "notes": [], "accessories": accessories, "edge_marks": ["top", "left", "right", "bottom"], "corner_radius": 0.5, "tap_hole": tap_hole}


def _kitchen_l_top_constraints(params: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    left_run = _num(params, "left_run", 63)
    right_run = _num(params, "right_run", 49)
    depth = _num(params, "depth", 44)
    sink_length = _num(params, "sink_length", 33)
    sink_width = _num(params, "sink_width", 21)
    sink_offset_left = _num(params, "sink_offset_left", left_run / 2 - sink_length / 2)
    min_clear = 3.0
    _check_range(errors, "Left Run", left_run, 24, 180)
    _check_range(errors, "Right Run", right_run, 18, 120)
    _check_range(errors, "Depth", depth, 24, 48)
    if sink_length <= 0 or sink_width <= 0:
        errors.append("Sink dimensions must be greater than zero.")
        return errors
    if sink_offset_left < min_clear:
        errors.append(f'Sink is too close to the left edge. Move the sink at least {min_clear:g}".')
    if sink_offset_left + sink_length > left_run - min_clear:
        errors.append(f'Sink does not fit on the left run — move it or shorten the sink at least {min_clear:g}" from the corner.')
    if sink_width > depth - 2 * min_clear:
        errors.append(f'Sink is too wide for this countertop depth. Leave at least {min_clear:g}" front and back.')
    return errors


def _kitchen_l_top_assembly(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    left_run = _num(params, "left_run", 63)
    right_run = _num(params, "right_run", 49)
    depth = _num(params, "depth", 44)
    notch_depth = _num(params, "notch_depth", 25.5)
    sink_length = _num(params, "sink_length", 33)
    sink_offset_left = _num(params, "sink_offset_left", left_run / 2 - sink_length / 2)
    sink_offset_right = (left_run + right_run) - sink_offset_left - sink_length
    splash_height = _num(params, "splash_height", 4)

    assembly = [_top({
        "category": "Kitchen - Perimeter Tops",
        "shape_type": "L-Shape",
        "length": left_run + right_run,
        "width": depth,
        "sink_type": "Undermount",
        "sink_length": sink_length,
        "sink_width": _num(params, "sink_width", 21),
        "sink_offset_left": sink_offset_left,
        "sink_offset_right": sink_offset_right,
        "notes": f'L-shape: {left_run:g}" left run x {right_run:g}" right run, notch depth {notch_depth:g}"',
    })]
    if _bool(params, "include_backsplash", True):
        assembly.append(_backsplash("Kitchen - Back Splash", left_run, splash_height))
        assembly.append(_backsplash("Kitchen - Back Splash", right_run, splash_height))
    if _bool(params, "include_side_splash", True):
        assembly.append(_side_splash("side_splash_left", "Kitchen - Side Splash", depth, depth))
        assembly.append(_side_splash("side_splash_right", "Kitchen - Side Splash", notch_depth, notch_depth))
    return assembly


TEMPLATES: Dict[str, Dict[str, Any]] = {
    "island_standard": {
        "id": "island_standard",
        "name": "Standard Island",
        "category": "island",
        "parameters": [
            {"id": "length", "label": "Length", "unit": "in", "type": "dimension", "default": 96, "min": 24, "max": 180, "required": True},
            {"id": "width", "label": "Width", "unit": "in", "type": "dimension", "default": 42, "min": 18, "max": 60, "required": True},
            {"id": "overhang", "label": "Overhang", "unit": "in", "type": "dimension", "default": 12, "min": 0, "max": 18, "required": False},
        ],
        "geometry_fn": _island_standard_geometry,
        "constraints_fn": _island_standard_constraints,
        "assembly_fn": _island_standard_assembly,
    },
    "island_with_sink": {
        "id": "island_with_sink",
        "name": "Island With Sink",
        "category": "island",
        "parameters": [
            {"id": "length", "label": "Length", "unit": "in", "type": "dimension", "default": 96, "min": 24, "max": 180, "required": True},
            {"id": "width", "label": "Width", "unit": "in", "type": "dimension", "default": 42, "min": 18, "max": 60, "required": True},
            {"id": "overhang", "label": "Overhang", "unit": "in", "type": "dimension", "default": 12, "min": 0, "max": 18, "required": False},
            {"id": "sink_length", "label": "Sink Length", "unit": "in", "type": "dimension", "default": 30, "min": 12, "max": 48, "required": True},
            {"id": "sink_width", "label": "Sink Width", "unit": "in", "type": "dimension", "default": 18, "min": 10, "max": 30, "required": True},
            {"id": "sink_offset_left", "label": "Sink Offset (from left edge)", "unit": "in", "type": "dimension", "default": None, "min": 0, "max": 180, "required": False},
        ],
        "geometry_fn": _island_sink_geometry,
        "constraints_fn": _island_sink_constraints,
        "assembly_fn": _island_sink_assembly,
    },
    "vanity_top": {
        "id": "vanity_top",
        "name": "Vanity Top",
        "category": "vanity",
        "parameters": [
            {"id": "length", "label": "Length", "unit": "in", "type": "dimension", "default": 55, "min": 24, "max": 120, "required": True},
            {"id": "depth", "label": "Depth", "unit": "in", "type": "dimension", "default": 22.5, "min": 18, "max": 30, "required": True},
            {"id": "sink_length", "label": "Sink Length", "unit": "in", "type": "dimension", "default": 21.625, "min": 12, "max": 48, "required": True},
            {"id": "sink_width", "label": "Sink Width", "unit": "in", "type": "dimension", "default": 15, "min": 10, "max": 24, "required": True},
            {"id": "sink_offset_left", "label": "Sink Offset (from left edge)", "unit": "in", "type": "dimension", "default": None, "min": 0, "max": 120, "required": False},
            {"id": "splash_height", "label": "Splash Height", "unit": "in", "type": "dimension", "default": 4, "min": 2, "max": 6, "required": False},
            {"id": "include_backsplash", "label": "Include Backsplash", "type": "boolean", "default": True},
            {"id": "include_side_splash", "label": "Include Side Splashes", "type": "boolean", "default": True},
        ],
        "geometry_fn": _vanity_top_geometry,
        "constraints_fn": _vanity_top_constraints,
        "assembly_fn": _vanity_top_assembly,
    },
    "kitchen_l_top": {
        "id": "kitchen_l_top",
        "name": "Kitchen Top (L-Shape)",
        "category": "kitchen",
        "parameters": [
            {"id": "left_run", "label": "Left Run", "unit": "in", "type": "dimension", "default": 63, "min": 24, "max": 180, "required": True},
            {"id": "right_run", "label": "Right Run", "unit": "in", "type": "dimension", "default": 49, "min": 18, "max": 120, "required": True},
            {"id": "depth", "label": "Depth", "unit": "in", "type": "dimension", "default": 44, "min": 24, "max": 48, "required": True},
            {"id": "notch_depth", "label": "Notch Depth", "unit": "in", "type": "dimension", "default": 25.5, "min": 12, "max": 48, "required": False},
            {"id": "sink_length", "label": "Sink Length", "unit": "in", "type": "dimension", "default": 33, "min": 18, "max": 48, "required": True},
            {"id": "sink_width", "label": "Sink Width", "unit": "in", "type": "dimension", "default": 21, "min": 14, "max": 30, "required": True},
            {"id": "sink_offset_left", "label": "Sink Offset (from left corner)", "unit": "in", "type": "dimension", "default": None, "min": 0, "max": 180, "required": False},
            {"id": "splash_height", "label": "Splash Height", "unit": "in", "type": "dimension", "default": 4, "min": 2, "max": 6, "required": False},
            {"id": "include_backsplash", "label": "Include Backsplash", "type": "boolean", "default": True},
            {"id": "include_side_splash", "label": "Include Side Splashes", "type": "boolean", "default": True},
        ],
        "geometry_fn": _kitchen_l_top_geometry,
        "constraints_fn": _kitchen_l_top_constraints,
        "assembly_fn": _kitchen_l_top_assembly,
    },
}


def list_templates() -> List[Dict[str, Any]]:
    return [
        {"id": t["id"], "name": t["name"], "category": t["category"], "parameters": t["parameters"]}
        for t in TEMPLATES.values()
    ]


def get_template(template_id: str) -> Dict[str, Any]:
    template = TEMPLATES.get(template_id)
    if not template:
        raise TemplateError(f"Unknown template: {template_id}")
    return template


def validate_params(template_id: str, params: Dict[str, Any]) -> List[str]:
    template = get_template(template_id)
    return template["constraints_fn"](params)


def build_geometry(template_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    template = get_template(template_id)
    return template["geometry_fn"](params)


def build_assembly(template_id: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Returns [{role, fields}, ...] — one "top" plus any bundled accessories."""
    template = get_template(template_id)
    return template["assembly_fn"](params)


def build_piece_fields(template_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Back-compat: just the main "top" piece's canonical fields."""
    return build_assembly(template_id, params)[0]["fields"]
