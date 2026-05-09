from collections import Counter
from typing import Any, Dict, List, Optional, Tuple


WEIGHT_FACTORS = {
    "Granite": {"2CM": 5.5, "3CM": 7.5, "Mixed": 6.5},
    "Quartz": {"2CM": 4.75, "3CM": 6.75, "Mixed": 5.75},
    "Marble": {"2CM": 6.0, "3CM": 8.0, "Mixed": 7.0},
    "Other": {"2CM": 5.5, "3CM": 7.5, "Mixed": 6.5},
}

# Density in kg/m³ per color. Factor = density × thickness_m × 0.0929 (sqft→sqm).
COLOR_DENSITIES: Dict[str, Dict[str, int]] = {
    "Granite": {
        # Light
        "Kashmir White": 2600, "Moon White": 2580, "River White": 2600,
        "Colonial White": 2590, "Bianco Romano": 2610, "White Galaxy": 2590,
        "Crystal White": 2600,
        # Medium-light
        "Giallo Ornamental": 2660, "Venetian Gold": 2660, "Santa Cecilia": 2650,
        "Caledonia": 2660, "Crema Pearl": 2650, "Tiger Skin": 2660,
        # Medium
        "Tan Brown": 2680, "Silver Pearl": 2680, "Verde Butterfly": 2690,
        "Uba Tuba": 2700, "Steel Grey": 2700, "Sapphire Blue": 2700,
        "Vizag Blue": 2700, "New Kashmir White": 2680,
        # Medium-dark
        "Baltic Brown": 2750, "Imperial Red": 2750, "Labrador Antique": 2760,
        "Volga Blue": 2760, "Impala": 2750, "Dakota Mahogany": 2750,
        "Black Pearl": 2780,
        # Dark / Black
        "Absolute Black": 2900, "Black Galaxy": 2950, "Angola Black": 2900,
        "Zimbabwe Black": 2880, "Star Galaxy": 2930,
    },
    "Marble": {
        # Light
        "Carrara White": 2720, "Calacatta Gold": 2710, "Statuario": 2720,
        "Bianco Venatino": 2700, "Volakas": 2690, "White Onyx": 2680,
        # Medium
        "Crema Marfil": 2720, "Botticino": 2740, "Emperador Light": 2740,
        "Ottoman Grey": 2720, "Grey Armani": 2740, "Panda White": 2730,
        # Dark
        "Nero Marquina": 2800, "Emperador Dark": 2780, "Forest Green": 2790,
        "Bardiglio": 2760, "Black & Gold": 2820, "Portoro": 2830,
    },
    # Quartz is engineered — density is uniform regardless of color
}

THICKNESS_INCHES = {
    "2CM": 0.79,
    "3CM": 1.18,
    "Mixed": 0.98,
}

WOOD_DENSITY_FACTORS = {
    "pine": 1.0,
    "rubberwood": 1.08,
    "plywood": 0.94,
    "hardwood": 1.15,
}

PRIORITY_KEYWORDS = ("rush", "urgent", "priority", "asap", "express")
FRAGILE_KEYWORDS = ("fragile", "care", "delicate", "polish", "finished face")
FRAGILITY_SCORES = {
    "standard": 0.0,
    "fragile": 0.7,
    "high": 1.4,
    "high fragility": 1.4,
}
PRIORITY_SCORES = {
    "standard": 0.0,
    "first off": 1.2,
    "rush": 1.8,
    "last off": 0.9,
}
PRIORITY_RANKS = {
    "rush": 0,
    "first off": 1,
    "standard": 2,
    "last off": 3,
}


def parse_float(value: Any, default: float = 0.0) -> float:
    try:
        if value in (None, "", "-"):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def parse_count(value: Any) -> int:
    try:
        if value in (None, "", "-"):
            return 0
        return max(0, int(float(value)))
    except (TypeError, ValueError):
        return 0


def thickness_inches(thickness: str) -> float:
    return THICKNESS_INCHES.get(thickness, THICKNESS_INCHES["Mixed"])


_THICKNESS_M = {"2CM": 0.02, "3CM": 0.03, "Mixed": 0.025}
_SQFT_TO_SQM = 0.0929


def weight_factor(material: str, thickness: str, color: str = "") -> float:
    if color and material in COLOR_DENSITIES and color in COLOR_DENSITIES[material]:
        density = COLOR_DENSITIES[material][color]
        t_m = _THICKNESS_M.get(thickness, 0.025)
        return round(density * t_m * _SQFT_TO_SQM, 3)
    return WEIGHT_FACTORS.get(material, WEIGHT_FACTORS["Other"]).get(thickness, 6.5)


def piece_area_sqft(piece: Dict[str, Any]) -> float:
    return (parse_float(piece.get("length")) * parse_float(piece.get("width"))) / 144.0


def piece_weight(piece: Dict[str, Any], material: str, thickness: str, color: str = "") -> float:
    qty = max(1, parse_count(piece.get("qty")) or 1)
    override = parse_float(piece.get("weight_override"), 0.0)
    if override > 0:
        return override * qty
    return piece_area_sqft(piece) * weight_factor(material, thickness, color) * qty


def piece_volume(piece: Dict[str, Any], thickness: str) -> float:
    qty = max(1, parse_count(piece.get("qty")) or 1)
    return parse_float(piece.get("length")) * parse_float(piece.get("width")) * thickness_inches(thickness) * qty


def normalize_text(value: Any) -> str:
    return str(value or "").strip().lower()


def sortable_token(value: Any) -> Tuple[int, Any]:
    text = str(value or "").strip()
    if not text:
        return (2, "")
    digits = "".join(ch for ch in text if ch.isdigit())
    if digits:
        return (0, int(digits))
    return (1, text.lower())


def piece_destination_key(piece: Dict[str, Any]) -> str:
    building = str(piece.get("building", "")).strip()
    floor = str(piece.get("floor", "")).strip()
    flat = str(piece.get("flat", "")).strip()
    parts = [part for part in [building, floor, flat] if part]
    return " / ".join(parts) if parts else "Warehouse"


def piece_destination_sort_key(piece: Dict[str, Any]) -> Tuple[Tuple[int, Any], Tuple[int, Any], Tuple[int, Any]]:
    return (
        sortable_token(piece.get("building")),
        sortable_token(piece.get("floor")),
        sortable_token(piece.get("flat")),
    )


def piece_family_key(piece: Dict[str, Any]) -> str:
    return str(piece.get("category") or piece.get("part") or "Other").strip() or "Other"


def piece_complexity_score(piece: Dict[str, Any]) -> float:
    score = 1.0
    sink_type = normalize_text(piece.get("sink_type"))
    edge = normalize_text(piece.get("edge"))
    notes = normalize_text(piece.get("notes"))
    orientation = normalize_text(piece.get("orientation"))

    if sink_type and sink_type != "no sink":
        score += 1.35
    score += parse_count(piece.get("sink_cut")) * 1.4
    score += parse_count(piece.get("tap_holes")) * 0.25
    score += parse_count(piece.get("grooves")) * 0.65
    score += parse_count(piece.get("radius")) * 0.2

    if edge == "manual":
        score += 0.9
    elif edge == "both":
        score += 1.1
    elif edge == "machine":
        score += 0.35

    if any(keyword in notes for keyword in FRAGILE_KEYWORDS):
        score += 0.75
    if any(keyword in notes for keyword in PRIORITY_KEYWORDS):
        score += 0.35
    if orientation in {"no rotate", "long edge vertical", "finished face protected"}:
        score += 0.45

    return round(score, 2)


def piece_fragility_score(piece: Dict[str, Any]) -> float:
    length = parse_float(piece.get("length"), 1.0)
    width = max(parse_float(piece.get("width"), 1.0), 1.0)
    part = normalize_text(piece.get("part"))
    notes = normalize_text(piece.get("notes"))
    aspect_ratio = max(length, width) / max(1.0, min(length, width))

    score = piece_complexity_score(piece)
    score += FRAGILITY_SCORES.get(normalize_text(piece.get("fragility")), 0.0)
    if aspect_ratio >= 2.4:
        score += 0.8
    if width <= 8 or length <= 20:
        score += 0.45
    if "splash" in part or "sill" in part:
        score += 0.5
    if "fragile" in notes or "no stack" in notes:
        score += 0.75

    return round(score, 2)


def piece_orientation_constraints(piece: Dict[str, Any]) -> str:
    explicit = normalize_text(piece.get("orientation"))
    if explicit and explicit != "auto":
        return explicit

    constraints: List[str] = []
    length = parse_float(piece.get("length"), 0.0)
    width = parse_float(piece.get("width"), 0.0)
    aspect_ratio = max(length, width) / max(1.0, min(length or 1.0, width or 1.0))
    edge = normalize_text(piece.get("edge"))

    if normalize_text(piece.get("sink_type")) not in {"", "no sink"} or parse_count(piece.get("sink_cut")) > 0:
        constraints.append("finished face protected")
    if parse_count(piece.get("grooves")) > 0 or parse_count(piece.get("tap_holes")) > 2:
        constraints.append("keep upright")
    if aspect_ratio >= 2.4:
        constraints.append("long edge vertical")
    if edge in {"manual", "both"}:
        constraints.append("edge protected")

    return ", ".join(constraints) if constraints else "standard upright"


def piece_priority_score(piece: Dict[str, Any]) -> float:
    notes = normalize_text(piece.get("notes"))
    priority = normalize_text(piece.get("delivery_priority"))
    score = PRIORITY_SCORES.get(priority, 0.0)
    if any(keyword in notes for keyword in PRIORITY_KEYWORDS):
        score += 2.0
    if normalize_text(piece.get("sink_type")) not in {"", "no sink"}:
        score += 0.5
    score += parse_count(piece.get("sink_cut")) * 0.35
    score += parse_count(piece.get("grooves")) * 0.2
    return round(score, 2)


def piece_delivery_rank(piece: Dict[str, Any]) -> int:
    priority = normalize_text(piece.get("delivery_priority"))
    return PRIORITY_RANKS.get(priority, PRIORITY_RANKS["standard"])


def build_destination_label(pieces: List[Dict[str, Any]]) -> str:
    destinations = [piece_destination_key(piece) for piece in pieces if piece_destination_key(piece) != "Warehouse"]
    if not destinations:
        return "Warehouse"

    unique = list(dict.fromkeys(destinations))
    if len(unique) == 1:
        return unique[0]
    if len(unique) == 2:
        return " + ".join(unique)
    return f"{unique[0]} + {len(unique) - 1} more drops"


def build_family_label(pieces: List[Dict[str, Any]]) -> str:
    families = list(dict.fromkeys(piece_family_key(piece) for piece in pieces))
    if not families:
        return "Mixed"
    if len(families) == 1:
        return families[0]
    if len(families) == 2:
        return " + ".join(families)
    return f"{families[0]} + {len(families) - 1} more families"


def infer_wood_thickness(
    total_weight: float,
    avg_fragility: float,
    longest_piece: float,
    preferred_thickness: float = 0.0,
) -> float:
    if preferred_thickness > 0:
        return round(preferred_thickness, 2)
    thickness = 1.0
    if total_weight > 650:
        thickness += 0.25
    if total_weight > 1100:
        thickness += 0.25
    if avg_fragility > 3.3:
        thickness += 0.25
    if longest_piece > 118:
        thickness += 0.25
    return round(thickness, 2)


def estimate_auto_dimensions(
    pieces: List[Dict[str, Any]],
    material: str,
    thickness: str,
    max_weight: float,
    reserved_space_pct: float = 0.0,
    preferred_wood_thickness: float = 0.0,
    color: str = "",
) -> Dict[str, float]:
    if not pieces:
        return {
            "internal_length": 0.0,
            "internal_width": 0.0,
            "internal_height": 0.0,
            "external_length": 0.0,
            "external_width": 0.0,
            "external_height": 0.0,
            "sqft": 0.0,
            "weight": 0.0,
            "wood_thickness": 1.0,
            "stack_depth_used": 0.0,
        }

    lengths = [parse_float(piece.get("length")) for piece in pieces]
    widths = [parse_float(piece.get("width")) for piece in pieces]
    total_sqft = sum(piece_area_sqft(piece) * max(1, parse_count(piece.get("qty")) or 1) for piece in pieces)
    total_weight = sum(piece_weight(piece, material, thickness, color) for piece in pieces)
    complexity_scores = [piece_complexity_score(piece) for piece in pieces]
    avg_complexity = sum(complexity_scores) / len(complexity_scores)
    avg_fragility = sum(piece_fragility_score(piece) for piece in pieces) / len(pieces)

    slab_thickness = thickness_inches(thickness)
    separator_depth = 0.18 + min(0.22, avg_complexity * 0.04)
    stack_depth = 3.5
    for piece in pieces:
        qty = max(1, parse_count(piece.get("qty")) or 1)
        stack_depth += qty * (slab_thickness + separator_depth)

    stack_depth_used = stack_depth
    if reserved_space_pct > 0:
        stack_depth *= 1 + (reserved_space_pct / 100.0)

    longest_piece = max(lengths) if lengths else 0.0
    tallest_piece = max(widths) if widths else 0.0

    internal_length = longest_piece + 4.0
    internal_width = max(10.0, stack_depth)
    internal_height = tallest_piece + 5.0

    wood_thickness = infer_wood_thickness(
        total_weight,
        avg_fragility,
        longest_piece,
        preferred_thickness=preferred_wood_thickness,
    )
    external_length = internal_length + (wood_thickness * 2) + 2.0
    external_width = internal_width + 4.5
    external_height = internal_height + (wood_thickness * 2) + 2.5

    return {
        "internal_length": round(internal_length, 1),
        "internal_width": round(internal_width, 1),
        "internal_height": round(internal_height, 1),
        "external_length": round(external_length, 1),
        "external_width": round(external_width, 1),
        "external_height": round(external_height, 1),
        "sqft": round(total_sqft, 2),
        "weight": round(total_weight, 2),
        "wood_thickness": wood_thickness,
        "longest_piece": round(longest_piece, 1),
        "tallest_piece": round(tallest_piece, 1),
        "stack_depth_used": round(stack_depth_used, 2),
    }


def build_crate_metrics(
    crate_doc: Dict[str, Any],
    pieces: List[Dict[str, Any]],
    material: str,
    thickness: str,
    destination_order: Optional[Dict[str, int]] = None,
    project_settings: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    destination_order = destination_order or {}
    project_settings = project_settings or {}
    max_weight = parse_float(crate_doc.get("max_weight"), 1000.0) or 1000.0
    reserved_space_pct = max(0.0, parse_float(crate_doc.get("reserved_space_pct"), 0.0))
    custom = bool(crate_doc.get("custom", False))
    locked = bool(crate_doc.get("locked", False))
    planner_notes = str(crate_doc.get("planner_notes", "")).strip()
    dimension_mode = str(crate_doc.get("dimension_mode", "auto") or "auto")
    preferred_wood_thickness = parse_float(project_settings.get("crate_wood_thickness"), 0.0)
    wood_type = str(project_settings.get("crate_wood_type", "Pine") or "Pine")
    wood_density_factor = WOOD_DENSITY_FACTORS.get(wood_type.strip().lower(), 1.0)
    color = str(project_settings.get("stone_color", "") or "")

    total_weight = sum(piece_weight(piece, material, thickness, color) for piece in pieces)
    total_sqft = sum(piece_area_sqft(piece) * max(1, parse_count(piece.get("qty")) or 1) for piece in pieces)
    total_volume = sum(piece_volume(piece, thickness) for piece in pieces)
    item_count = len(pieces)
    piece_count = sum(max(1, parse_count(piece.get("qty")) or 1) for piece in pieces)

    auto_dims = estimate_auto_dimensions(
        pieces,
        material,
        thickness,
        max_weight=max_weight,
        reserved_space_pct=reserved_space_pct,
        preferred_wood_thickness=preferred_wood_thickness,
        color=color,
    )
    if dimension_mode == "manual":
        dims = {
            "internal_length": parse_float(crate_doc.get("internal_length"), auto_dims["internal_length"]),
            "internal_width": parse_float(crate_doc.get("internal_width"), auto_dims["internal_width"]),
            "internal_height": parse_float(crate_doc.get("internal_height"), auto_dims["internal_height"]),
            "external_length": parse_float(crate_doc.get("external_length"), auto_dims["external_length"]),
            "external_width": parse_float(crate_doc.get("external_width"), auto_dims["external_width"]),
            "external_height": parse_float(crate_doc.get("external_height"), auto_dims["external_height"]),
            "sqft": round(total_sqft, 2),
            "weight": round(total_weight, 2),
            "wood_thickness": parse_float(crate_doc.get("wood_thickness"), auto_dims["wood_thickness"]) or auto_dims["wood_thickness"],
        }
    else:
        dims = auto_dims

    internal_volume = dims["internal_length"] * dims["internal_width"] * dims["internal_height"]
    volume_fill_pct = (total_volume / internal_volume * 100.0) if internal_volume else 0.0
    length_fit_pct = (auto_dims.get("longest_piece", 0.0) / dims["internal_length"] * 100.0) if dims["internal_length"] else 0.0
    height_fit_pct = (auto_dims.get("tallest_piece", 0.0) / dims["internal_height"] * 100.0) if dims["internal_height"] else 0.0
    depth_fit_pct = (auto_dims.get("stack_depth_used", 0.0) / dims["internal_width"] * 100.0) if dims["internal_width"] else 0.0
    geometry_fill_pct = (length_fit_pct + height_fit_pct + depth_fit_pct) / 3.0 if pieces else 0.0
    avg_fragility = sum(piece_fragility_score(piece) for piece in pieces) / len(pieces) if pieces else 0.0
    avg_complexity = sum(piece_complexity_score(piece) for piece in pieces) / len(pieces) if pieces else 0.0

    families = sorted({piece_family_key(piece) for piece in pieces})
    destinations = sorted({piece_destination_key(piece) for piece in pieces})
    dominant_destination = build_destination_label(pieces)
    family_label = build_family_label(pieces)

    reinforcement = bool(crate_doc.get("reinforcement")) or total_weight > 850 or avg_fragility >= 3.4 or len(destinations) > 2
    wood_thickness = parse_float(crate_doc.get("wood_thickness"), 0.0) or dims.get("wood_thickness", 1.0)
    footprint_sqft = (dims["external_length"] * dims["external_width"]) / 144.0 if dims["external_length"] and dims["external_width"] else 0.0
    tare_weight = max(
        32.0 if pieces else 18.0,
        (footprint_sqft * (4.8 + wood_thickness * 1.8))
        + ((dims["external_height"] / 12.0) * 11.0)
        + (18.0 if reinforcement else 0.0)
        + (reserved_space_pct * 0.45),
    )
    tare_weight = round(tare_weight * wood_density_factor, 1)
    gross_weight = round(total_weight + tare_weight, 1)

    payload_limit = max(50.0, max_weight - tare_weight)
    payload_utilization = (total_weight / payload_limit) * 100.0 if payload_limit else 0.0
    gross_utilization = (gross_weight / max_weight) * 100.0 if max_weight else 0.0
    fill_percent = min(100.0, (geometry_fill_pct * 0.65) + (payload_utilization * 0.35))

    dominant_orientation = " / ".join(
        list(dict.fromkeys(piece_orientation_constraints(piece) for piece in pieces))[:3]
    ) if pieces else "manual hold"

    any_no_stack = any(normalize_text(piece.get("stack_preference")) == "no stack" for piece in pieces)
    stackable = bool(crate_doc.get("stackable")) if crate_doc.get("stackable") is not None else (
        not any_no_stack
        and not any(normalize_text(piece.get("orientation")) == "finished face protected" for piece in pieces)
        and gross_weight <= 950
        and avg_fragility < 2.8
        and parse_count(crate_doc.get("reserved_space_pct")) == 0
        and dims["external_height"] <= 50
        and len(destinations) <= 1
    )
    forklift_entry = crate_doc.get("forklift_entry") or ("long side" if dims["external_length"] >= dims["external_width"] * 2 else "short side")

    oversized = (
        dims["external_width"] > auto_dims["external_width"] * 1.18
        or dims["external_length"] > auto_dims["external_length"] * 1.12
        or dims["external_height"] > auto_dims["external_height"] * 1.12
    ) if pieces else dimension_mode == "manual"

    overloaded = gross_weight > max_weight or payload_utilization > 100
    poor_weight_utilization = gross_utilization < 60
    low_fill = fill_percent < 70
    inefficient_grouping = len(destinations) > 2 or len(families) > 2

    warnings: List[str] = []
    if overloaded:
        warnings.append(f"Over max weight by {gross_weight - max_weight:.0f} kg")
    if low_fill:
        warnings.append(f"Low fill {fill_percent:.0f}%")
    if poor_weight_utilization:
        warnings.append(f"Poor weight utilization {gross_utilization:.0f}%")
    if oversized:
        warnings.append("Oversized for current piece mix")
    if inefficient_grouping:
        warnings.append("Mixed destinations/families reduce handling efficiency")
    if reinforcement:
        warnings.append("Reinforcement recommended")
    if any_no_stack:
        warnings.append("No-stack part present")
    if not stackable:
        warnings.append("Single-floor load only")
    if reserved_space_pct > 0:
        warnings.append(f"{reserved_space_pct:.0f}% space reserved")
    if locked:
        warnings.append("Planner locked")

    if overloaded or fill_percent < 70 or gross_utilization < 55 or oversized:
        efficiency_status = "red"
    elif fill_percent < 85 or gross_utilization < 75 or inefficient_grouping:
        efficiency_status = "yellow"
    else:
        efficiency_status = "green"

    if pieces:
        priority_rank = min(
            (piece_delivery_rank(piece) * 100) + destination_order.get(piece_destination_key(piece), 99)
            for piece in pieces
        )
    else:
        priority_rank = 999

    average_piece_weight = total_weight / max(piece_count, 1)

    weighted_height = (
        sum(parse_float(piece.get("width")) * piece_weight(piece, material, thickness, color) for piece in pieces) / total_weight
        if total_weight else 0.0
    )
    center_of_gravity = {
        "x": round(dims["internal_length"] / 2.0, 1),
        "y": round(max(2.0, dims["internal_width"] / 2.0), 1),
        "z": round(min(dims["internal_height"] - 1.0, max(2.0, weighted_height / 2.0)), 1) if dims["internal_height"] else 0.0,
    }

    handling_notes: List[str] = []
    if normalize_text(planner_notes):
        handling_notes.append(planner_notes)
    if avg_fragility >= 3.0:
        handling_notes.append("Protect polished face and use extra separators.")
    if normalize_text(piece_family_key(pieces[0] if pieces else {})) == "kitchen":
        handling_notes.append("Keep cutout-heavy pieces away from outside edges.")
    if not stackable:
        handling_notes.append("Do not double-stack in container.")
    if len(destinations) > 1:
        handling_notes.append("Apply stop-sequence labels on both sides.")

    return {
        "id": crate_doc["id"],
        "project_id": crate_doc["project_id"],
        "crate_id": crate_doc.get("crate_id", ""),
        "name": crate_doc.get("name", crate_doc.get("crate_id", "Crate")),
        "locked": locked,
        "custom": custom,
        "dimension_mode": dimension_mode,
        "planner_notes": planner_notes,
        "reserved_space_pct": reserved_space_pct,
        "max_weight": round(max_weight, 1),
        "wood_thickness": round(wood_thickness, 2),
        "wood_type": wood_type,
        "tare_weight": tare_weight,
        "gross_weight": gross_weight,
        "total_weight": round(total_weight, 1),
        "payload_utilization": round(payload_utilization, 1),
        "gross_utilization": round(gross_utilization, 1),
        "fill_percent": round(fill_percent, 1),
        "volume_fill_percent": round(volume_fill_pct, 1),
        "geometry_fill_percent": round(geometry_fill_pct, 1),
        "internal_length": round(dims["internal_length"], 1),
        "internal_width": round(dims["internal_width"], 1),
        "internal_height": round(dims["internal_height"], 1),
        "external_length": round(dims["external_length"], 1),
        "external_width": round(dims["external_width"], 1),
        "external_height": round(dims["external_height"], 1),
        "sqft": round(total_sqft, 2),
        "footprint_sqft": round(footprint_sqft, 2),
        "center_of_gravity": center_of_gravity,
        "forklift_entry": forklift_entry,
        "stackable": stackable,
        "reinforcement": reinforcement,
        "destination_group": dominant_destination,
        "family_group": family_label,
        "destination_count": len(destinations),
        "family_count": len(families),
        "orientation_constraints": dominant_orientation,
        "piece_count": piece_count,
        "item_count": item_count,
        "piece_ids": [piece["id"] for piece in pieces],
        "delivery_rank": priority_rank,
        "priority_score": round(sum(piece_priority_score(piece) for piece in pieces), 1),
        "average_piece_weight": round(average_piece_weight, 2),
        "avg_fragility": round(avg_fragility, 2),
        "avg_complexity": round(avg_complexity, 2),
        "available_capacity_kg": round(max_weight - gross_weight, 1),
        "efficiency_status": efficiency_status,
        "warnings": warnings,
        "overloaded": overloaded,
        "underloaded": low_fill or poor_weight_utilization or inefficient_grouping,
        "oversized": oversized,
        "poor_weight_utilization": poor_weight_utilization,
        "inefficient_grouping": inefficient_grouping,
        "handling_notes": " ".join(handling_notes).strip(),
        "crate_type": crate_doc.get("crate_type", ""),
        "packing_mode": crate_doc.get("packing_mode", ""),
        "primary_flat": crate_doc.get("primary_flat", ""),
        "secondary_flats": crate_doc.get("secondary_flats", []),
        "weight_band_status": crate_doc.get("weight_band_status", ""),
        "grouping_reason": crate_doc.get("grouping_reason", ""),
        "packing_family": crate_doc.get("packing_family", ""),
        "splash_layer": crate_doc.get("splash_layer", False),
    }


def build_underfilled_crates(crate_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows_by_destination: Dict[str, List[Dict[str, Any]]] = {}
    rows_by_family: Dict[str, List[Dict[str, Any]]] = {}
    for row in crate_rows:
        rows_by_destination.setdefault(row["destination_group"], []).append(row)
        rows_by_family.setdefault(row["family_group"], []).append(row)

    underfilled: List[Dict[str, Any]] = []
    for crate in crate_rows:
        if crate["fill_percent"] >= 85 and crate["gross_utilization"] >= 75 and not crate["oversized"]:
            continue

        merge_candidates: List[str] = []
        for pool in (rows_by_destination.get(crate["destination_group"], []), rows_by_family.get(crate["family_group"], [])):
            for other in pool:
                if other["id"] == crate["id"]:
                    continue
                if other["locked"] or crate["locked"]:
                    continue
                if other["gross_weight"] + crate["gross_weight"] <= max(crate["max_weight"], other["max_weight"]):
                    if other["crate_id"] not in merge_candidates:
                        merge_candidates.append(other["crate_id"])

        reasons: List[str] = []
        if crate["fill_percent"] < 70:
            reasons.append("low fill %")
        if crate["gross_utilization"] < 60:
            reasons.append("poor weight utilization")
        if crate["oversized"]:
            reasons.append("oversized crate")
        if crate["inefficient_grouping"]:
            reasons.append("inefficient grouping")

        suggestion = " / ".join(reasons) if reasons else "needs review"
        underfilled.append(
            {
                "crate_id": crate["crate_id"],
                "name": crate["name"],
                "utilization": crate["fill_percent"],
                "gross_utilization": crate["gross_utilization"],
                "spare_capacity": max(0.0, crate["available_capacity_kg"]),
                "status": crate["efficiency_status"],
                "reasons": reasons,
                "suggestion": f"{crate['crate_id']} is {suggestion}. Recommend merge, resize, or reserve only intentional empty space.",
                "merge_candidates": merge_candidates[:4],
            }
        )

    return underfilled


def build_planning_snapshot(
    project: Optional[Dict[str, Any]],
    pieces: List[Dict[str, Any]],
    crate_docs: List[Dict[str, Any]],
    assignments: List[Dict[str, Any]],
) -> Dict[str, Any]:
    material = (project or {}).get("material", "Granite")
    thickness = (project or {}).get("thickness", "3CM")
    color = str((project or {}).get("stone_color", "") or "")

    pieces_by_id = {piece["id"]: piece for piece in pieces}
    pieces_by_crate: Dict[int, List[Dict[str, Any]]] = {}
    for assignment in assignments:
        piece = pieces_by_id.get(assignment.get("piece_id"))
        crate_id = assignment.get("crate_id")
        if piece is None or crate_id is None:
            continue
        pieces_by_crate.setdefault(crate_id, []).append(piece)

    destination_labels = sorted(
        {piece_destination_key(piece) for piece in pieces},
        key=lambda label: tuple(sortable_token(part) for part in label.split(" / ")),
    )
    destination_order = {label: idx + 1 for idx, label in enumerate(destination_labels)}

    crate_rows = [
        build_crate_metrics(
            crate_doc,
            pieces_by_crate.get(crate_doc["id"], []),
            material,
            thickness,
            destination_order,
            project_settings=project or {},
        )
        for crate_doc in sorted(crate_docs, key=lambda doc: doc["id"])
    ]
    crate_rows.sort(key=lambda row: row["crate_id"])

    project_average_piece_weight = (
        sum(piece_weight(piece, material, thickness, color) for piece in pieces) /
        max(sum(max(1, parse_count(piece.get("qty")) or 1) for piece in pieces), 1)
    ) if pieces else 0.0

    rows_by_destination: Dict[str, List[Dict[str, Any]]] = {}
    rows_by_family: Dict[str, List[Dict[str, Any]]] = {}
    for row in crate_rows:
        rows_by_destination.setdefault(row["destination_group"], []).append(row)
        rows_by_family.setdefault(row["family_group"], []).append(row)

    if project_average_piece_weight > 0:
        for row in crate_rows:
            comparison_pool = rows_by_destination.get(row["destination_group"], []) + rows_by_family.get(row["family_group"], [])
            others = [other for other in comparison_pool if other["id"] != row["id"]]
            has_lighter_peer = any(other["average_piece_weight"] < project_average_piece_weight * 0.75 for other in others)
            has_heavier_peer = any(other["average_piece_weight"] > project_average_piece_weight * 1.35 for other in others)

            if row["average_piece_weight"] > project_average_piece_weight * 1.35 and has_lighter_peer:
                row["warnings"].append("Heavy parts grouped together; rebalance with lighter pieces")
                row["efficiency_status"] = "red" if row["efficiency_status"] != "red" else row["efficiency_status"]
            if row["average_piece_weight"] < project_average_piece_weight * 0.75 and has_heavier_peer:
                row["warnings"].append("Light parts grouped together; mix with heavier compatible pieces")
                if row["efficiency_status"] == "green":
                    row["efficiency_status"] = "yellow"

    underfilled = build_underfilled_crates(crate_rows)
    total_weight = round(sum(row["total_weight"] for row in crate_rows), 1)
    total_gross_weight = round(sum(row["gross_weight"] for row in crate_rows), 1)
    total_sqft = round(sum(row["sqft"] for row in crate_rows), 2)

    avg_fill = round(sum(row["fill_percent"] for row in crate_rows) / len(crate_rows), 1) if crate_rows else 0.0
    avg_gross_util = round(sum(row["gross_utilization"] for row in crate_rows) / len(crate_rows), 1) if crate_rows else 0.0
    avg_payload_util = round(sum(row["payload_utilization"] for row in crate_rows) / len(crate_rows), 1) if crate_rows else 0.0

    exception_rows: List[Dict[str, Any]] = []
    for row in crate_rows:
        for warning in row["warnings"]:
            exception_rows.append(
                {
                    "scope": "crate",
                    "id": row["crate_id"],
                    "name": row["name"],
                    "severity": row["efficiency_status"],
                    "message": warning,
                }
            )

    return {
        "project": project or {},
        "material": material,
        "thickness": thickness,
        "crate_rows": crate_rows,
        "pieces_by_crate": pieces_by_crate,
        "underfilled_crates": underfilled,
        "total_weight": total_weight,
        "total_gross_weight": total_gross_weight,
        "total_sqft": total_sqft,
        "average_fill_percent": avg_fill,
        "average_gross_utilization": avg_gross_util,
        "average_payload_utilization": avg_payload_util,
        "destination_count": len({piece_destination_key(piece) for piece in pieces}),
        "family_count": len({piece_family_key(piece) for piece in pieces}),
        "piece_count": sum(max(1, parse_count(piece.get("qty")) or 1) for piece in pieces),
        "item_count": len(pieces),
        "exception_rows": exception_rows,
    }
