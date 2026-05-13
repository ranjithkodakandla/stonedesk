from typing import Any, Dict, List

from .container_layout import optimize_container_load
from .dispatch_units import (
    build_dispatch_units_from_pieces,
    snapshot_dispatch_context,
    snapshot_normalized_units_json,
)
from .geometry_gate import (
    count_placed_a_crates,
    enrich_placement_results,
    partition_crates_for_manifest,
)
from .packing import build_crates
from .summary_metrics import build_planner_summary


def _payload_cap_kg(project: Dict[str, Any]) -> float:
    """Standard dry 20′ nominal stone payload — never exceed 24,000 kg in v3 layouts."""
    from .container_layout import V3_PAYLOAD_CAP_KG

    raw = project.get("delivery_payload_cap_kg")
    if raw is None:
        return V3_PAYLOAD_CAP_KG
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return V3_PAYLOAD_CAP_KG
    return min(V3_PAYLOAD_CAP_KG, max(1000.0, v))


def run_v3_planner(
    pieces: List[Dict[str, Any]],
    project: Dict[str, Any],
    dispatch_selection: Dict[str, Any],
) -> Dict[str, Any]:
    wood = float(project.get("crate_wood_thickness", 1.5) or 1.5)
    material = project.get("material", "Granite")
    thickness = project.get("thickness", "3CM")
    color = str(project.get("stone_color", "") or "")

    normalized_units, prefix_events = build_dispatch_units_from_pieces(pieces)

    crate_specs_all = build_crates(pieces, project, dispatch_selection, wood)
    manifest_specs, rejected_specs, geometry_rows = partition_crates_for_manifest(
        crate_specs_all,
        project=project,
    )

    cap = _payload_cap_kg(project)
    load_plan = optimize_container_load(manifest_specs, max_payload_kg=cap, project=project)
    enrich_placement_results(manifest_specs, load_plan)

    containers = load_plan.get("containers") or []
    container_optimization = load_plan.get("optimization") or {}

    placed_islands = count_placed_a_crates(load_plan, manifest_specs)
    first_layout: Dict[str, Any] = {}
    if containers:
        first_layout = {k: v for k, v in containers[0].items()}
    island_strip_x = None
    if placed_islands > 0 and first_layout:
        island_strip_x = float(first_layout.get("linear_island_strip_end_x_in") or 0.0)

    manifest_notes = {
        "placed_island_crate_count": placed_islands,
        "layout_island_strip_end_x_in": island_strip_x,
        "manifest_eligible_crate_count": len(manifest_specs),
        "rejected_manifest_crate_count": len(rejected_specs),
    }

    summary = build_planner_summary(
        pieces,
        manifest_specs,
        load_plan,
        material=material,
        thickness=thickness,
        color=color,
        rejected_crates=rejected_specs,
        manifest_notes=manifest_notes,
    )

    top_warnings: List[str] = list(load_plan.get("warnings") or [])
    for w in summary.get("warnings") or []:
        if w not in top_warnings:
            top_warnings.append(w)

    if rejected_specs:
        top_warnings.insert(
            0,
            f"{len(rejected_specs)} crate(s) excluded from container manifest — geometry / gate failures "
            f"(see planner_debug_snapshot.rejected_or_unplaced).",
        )

    placed_ids = set()
    for cont in containers:
        for pl in cont.get("placements") or []:
            try:
                placed_ids.add(int(pl["crate_index"]))
            except (TypeError, ValueError, KeyError):
                continue

    debug_snapshot: Dict[str, Any] = {
        "schema_version": 2,
        "dispatch_context": snapshot_dispatch_context(dispatch_selection),
        "normalized_units": snapshot_normalized_units_json(normalized_units),
        "prefix_normalization_events": prefix_events,
        "geometry_validation": geometry_rows,
        "emitted_crates": [
            {
                "serial": c.get("serial"),
                "category": c.get("category"),
                "crate_class": c.get("crate_class"),
                "planner_debug": c.get("planner_debug"),
            }
            for c in crate_specs_all
        ],
        "container_candidates": container_optimization,
        "final_manifest": {
            "container_count": len(containers),
            "placed_crate_index_count": len(placed_ids),
            "chosen_strategy": container_optimization.get("chosen_strategy"),
        },
        "rejected_or_unplaced": [
            {
                "serial": r.get("serial"),
                "unshippable_reason": r.get("unshippable_reason"),
                "piece_ids": [p["id"] for p in r.get("pieces") or []],
                "planner_debug": r.get("planner_debug"),
            }
            for r in rejected_specs
        ],
    }

    return {
        "crates": manifest_specs,
        "all_emit_specs": crate_specs_all,
        "rejected_manifest_specs": rejected_specs,
        "containers": containers,
        "container_layout": first_layout,
        "summary": summary,
        "warnings": top_warnings,
        "container_optimization": container_optimization,
        "planner_debug_snapshot": debug_snapshot,
    }
