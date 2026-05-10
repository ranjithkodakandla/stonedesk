from typing import Any, Dict, List

from .container_layout import optimize_container_load
from .packing import build_crates
from .summary_metrics import build_planner_summary


def _payload_cap_kg(project: Dict[str, Any]) -> float:
    """Default 24t; port unload often 28t — stored on project as delivery_payload_cap_kg."""
    raw = project.get("delivery_payload_cap_kg")
    if raw is None:
        return 24000.0
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return 24000.0
    return max(20000.0, min(32000.0, v))


def run_v3_planner(
    pieces: List[Dict[str, Any]],
    project: Dict[str, Any],
    dispatch_selection: Dict[str, Any],
) -> Dict[str, Any]:
    wood = float(project.get("crate_wood_thickness", 1.5) or 1.5)
    material = project.get("material", "Granite")
    thickness = project.get("thickness", "3CM")
    color = str(project.get("stone_color", "") or "")

    crate_specs = build_crates(pieces, project, dispatch_selection, wood)
    cap = _payload_cap_kg(project)
    load_plan = optimize_container_load(crate_specs, max_payload_kg=cap)
    containers = load_plan.get("containers") or []
    container_optimization = load_plan.get("optimization") or {}

    top_warnings: List[str] = list(load_plan.get("warnings") or [])
    summary = build_planner_summary(
        pieces,
        crate_specs,
        load_plan,
        material=material,
        thickness=thickness,
        color=color,
    )
    for w in summary.get("warnings") or []:
        if w not in top_warnings:
            top_warnings.append(w)

    first_layout: Dict[str, Any] = {}
    if containers:
        first_layout = {k: v for k, v in containers[0].items()}

    return {
        "crates": crate_specs,
        "containers": containers,
        "container_layout": first_layout,
        "summary": summary,
        "warnings": top_warnings,
        "container_optimization": container_optimization,
    }
