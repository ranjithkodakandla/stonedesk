"""
Aggregate planner summary for management view (Checkpoint 3).
"""
from __future__ import annotations

from typing import Any, Dict, List

from ..planning_engine import piece_weight
from .packing import TYPE_SPECS


def _crate_fill_pct(crate: Dict[str, Any]) -> float:
    wt = float(crate.get("total_weight_kg") or crate.get("weight") or 0)
    mx = float(crate.get("max_weight") or 0)
    if mx <= 0:
        return 0.0
    return min(100.0, round(100.0 * wt / mx, 1))


def _external_vol(crate: Dict[str, Any]) -> float:
    d = crate.get("dimensions") or {}
    el = float(d.get("external_length") or 0)
    ew = float(d.get("external_width") or 0)
    eh = float(d.get("external_height") or 0)
    return max(0.0, el * ew * eh)


def build_planner_summary(
    pieces: List[Dict[str, Any]],
    crates: List[Dict[str, Any]],
    containers_result: Dict[str, Any],
    *,
    material: str,
    thickness: str,
    color: str,
) -> Dict[str, Any]:
    """High-level KPIs for API / UI."""
    total_wt = sum(float(c.get("total_weight_kg") or c.get("weight") or 0) for c in crates)
    n = len(crates)
    island_n = sum(1 for c in crates if c.get("category") == "island")
    kitchen_n = sum(1 for c in crates if c.get("category") == "perimeter")
    vanity_n = sum(1 for c in crates if c.get("category") == "vanity")
    range_n = sum(1 for c in crates if c.get("category") == "range")
    misc_n = sum(1 for c in crates if c.get("category") == "misc")

    fills = [_crate_fill_pct(c) for c in crates]
    avg_fill = round(sum(fills) / len(fills), 1) if fills else 0.0

    vols = [_external_vol(c) for c in crates if _external_vol(c) > 0]
    avg_vol = sum(vols) / len(vols) if vols else 0.0
    avg_el = sum(float((c.get("dimensions") or {}).get("external_length") or 0) for c in crates) / n if n else 0
    avg_ew = sum(float((c.get("dimensions") or {}).get("external_width") or 0) for c in crates) / n if n else 0
    avg_eh = sum(float((c.get("dimensions") or {}).get("external_height") or 0) for c in crates) / n if n else 0

    underloaded: List[str] = []
    overloaded: List[str] = []
    for c in crates:
        cat = str(c.get("category") or "misc")
        spec = TYPE_SPECS.get(cat, TYPE_SPECS["misc"])
        wt = float(c.get("total_weight_kg") or 0)
        name = str(c.get("name") or c.get("serial") or "")
        if wt < float(spec["min_kg"]) and wt > 0:
            underloaded.append(name)
        if wt > float(spec["max_kg"]):
            overloaded.append(name)

    cont_list = containers_result.get("containers") or []
    n20 = sum(1 for x in cont_list if x.get("type") == "20ft")
    n40 = sum(1 for x in cont_list if x.get("type") == "40ft")

    weight_utils = [float(x.get("weight_utilization_pct") or 0) for x in cont_list]
    floor_utils = [float(x.get("floor_utilization_pct_approx") or 0) for x in cont_list]
    avg_cont_w_util = round(sum(weight_utils) / len(weight_utils), 1) if weight_utils else 0.0
    avg_floor_util = round(sum(floor_utils) / len(floor_utils), 1) if floor_utils else 0.0

    rem_payload = sum(float(x.get("remaining_payload_kg") or 0) for x in cont_list)
    rem_floor = sum(float(x.get("remaining_floor_area_sq_in_approx") or 0) for x in cont_list)

    piece_wt = sum(piece_weight(p, material, thickness, color) for p in pieces)

    warnings: List[str] = list(containers_result.get("warnings") or [])
    for c in cont_list:
        for w in c.get("warnings") or []:
            if w not in warnings:
                warnings.append(w)

    return {
        "total_selected_parts": len(pieces),
        "total_selected_weight_kg": round(piece_wt, 1),
        "total_crates": n,
        "island_crates": island_n,
        "kitchen_crates": kitchen_n,
        "vanity_crates": vanity_n,
        "range_crates": range_n,
        "misc_crates": misc_n,
        "total_crate_weight_kg": round(total_wt, 1),
        "average_crate_weight_kg": round(total_wt / n, 1) if n else 0.0,
        "average_crate_external_dims_in": {
            "length": round(avg_el, 1),
            "width": round(avg_ew, 1),
            "height": round(avg_eh, 1),
        },
        "average_crate_external_volume_cu_in": round(avg_vol, 1),
        "average_crate_fill_pct": avg_fill,
        "underloaded_crate_names": underloaded,
        "overloaded_crate_names": overloaded,
        "container_count_20ft": n20,
        "container_count_40ft": n40,
        "container_count_total": len(cont_list),
        "average_container_weight_utilization_pct": avg_cont_w_util,
        "average_container_floor_utilization_pct_approx": avg_floor_util,
        "total_remaining_payload_kg": round(rem_payload, 1),
        "total_remaining_floor_area_sq_in_approx": round(rem_floor, 1),
        "warnings": warnings,
    }
