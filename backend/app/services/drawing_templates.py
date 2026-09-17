"""
Parametric countertop drawing templates.

A template is a small, config-driven definition: parameters an end user
fills in, constraints that keep the geometry valid, and two pure functions
that turn parameter values into (a) drawing geometry and (b) the same
canonical countertop fields the manual Source Data entry form produces
(`PieceCreate` in main.py). Both the manual-entry path and this generator
converge on that one canonical shape, so crate planning / cut list / label
printing need no changes to consume generated pieces.

Adding a template = adding one entry to TEMPLATES. No other code changes.
"""

from typing import Any, Dict, List


class TemplateError(ValueError):
    """Raised when parameter values violate a template's constraints."""


def _num(params: Dict[str, Any], key: str, default: float = 0.0) -> float:
    val = params.get(key, default)
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _bool(params: Dict[str, Any], key: str, default: bool = False) -> bool:
    val = params.get(key, default)
    if isinstance(val, str):
        return val.strip().lower() in ("1", "true", "yes", "on")
    return bool(val)


def _check_range(errors: List[str], label: str, value: float, lo: float, hi: float) -> None:
    if value < lo or value > hi:
        errors.append(f'{label} must be between {lo:g}" and {hi:g}".')


# ── Standard Island ──────────────────────────────────────────────────────
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
    return {"width_in": length, "height_in": width, "outline": outline, "cutouts": [], "dimensions": dimensions, "notes": notes}


def _island_standard_constraints(params: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    _check_range(errors, "Length", _num(params, "length", 96), 24, 180)
    _check_range(errors, "Width", _num(params, "width", 42), 18, 60)
    _check_range(errors, "Overhang", _num(params, "overhang", 12), 0, 18)
    return errors


def _island_standard_piece_fields(params: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "category": "Kitchen - Island Tops",
        "shape_type": "Rectangle",
        "length": _num(params, "length", 96),
        "width": _num(params, "width", 42),
        "sink_type": "No Sink",
        "notes": f'Overhang {_num(params, "overhang", 12):g}"',
    }


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
        "type": "sink",
        "rect": [sink_x, sink_y, sink_length, sink_width],
        "label": "Sink",
    }]
    dimensions = [
        {"from": [0, 0], "to": [length, 0], "label": f'{length:g}"', "side": "top"},
        {"from": [0, 0], "to": [0, width], "label": f'{width:g}"', "side": "left"},
        {"from": [0, width], "to": [sink_x, width], "label": f'{sink_offset_left:g}"', "side": "bottom"},
        {"from": [sink_x, width], "to": [sink_x + sink_length, width], "label": f'{sink_length:g}"', "side": "bottom"},
    ]
    return {"width_in": length, "height_in": width, "outline": outline, "cutouts": cutouts, "dimensions": dimensions, "notes": []}


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


def _island_sink_piece_fields(params: Dict[str, Any]) -> Dict[str, Any]:
    length = _num(params, "length", 96)
    sink_length = _num(params, "sink_length", 30)
    sink_offset_left = _num(params, "sink_offset_left", (length - sink_length) / 2)
    sink_offset_right = length - sink_offset_left - sink_length
    fields = _island_standard_piece_fields(params)
    fields.update({
        "sink_type": "Undermount",
        "sink_length": sink_length,
        "sink_width": _num(params, "sink_width", 18),
        "sink_offset_left": sink_offset_left,
        "sink_offset_right": sink_offset_right,
        "notes": f'Overhang {_num(params, "overhang", 12):g}", sink offset {sink_offset_left:g}" from left',
    })
    return fields


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
        "piece_fields_fn": _island_standard_piece_fields,
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
        "piece_fields_fn": _island_sink_piece_fields,
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


def build_piece_fields(template_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    template = get_template(template_id)
    return template["piece_fields_fn"](params)
