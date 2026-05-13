"""
Phase A — operational island cassette packing (bundles, ideal ~1900 kg, dynamic dims).
Gated by PLANNER_V3_OPERATIONAL=1 — legacy path remains default.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Set, Tuple

from .adjacency import ordered_pull_piece_ids
from .bundles import build_island_bundles_from_families, island_bundle_adjacency_sort_key
from .classify import build_families
from .dimensions import island_cassette_dimensions_operational, total_piece_weight
from .dispatch import dispatch_group_label
from .container_layout import CONTAINER_20FT
from .scored_packing import greedy_ideal_batches

# kg targets — acceptable band 1400–2200; ideal 1800–2000 (spec §8–9)
_ISLAND_ACCEPTABLE_LO = 1400.0
_ISLAND_ACCEPTABLE_HI = 2200.0
_ISLAND_IDEAL_CENTER = 1900.0
_ISLAND_IDEAL_LO = 1800.0
_ISLAND_IDEAL_HI = 2000.0


def operational_planner_enabled() -> bool:
    v = os.environ.get("PLANNER_V3_OPERATIONAL", "").strip().lower()
    return v in ("1", "true", "yes", "on")


def collect_island_piece_ids(bundles: List[Dict[str, Any]]) -> Set[int]:
    ids: Set[int] = set()
    for b in bundles:
        ids.update(b.get("all_piece_ids") or [])
    return ids


def _bundles_to_pieces(batch: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for b in batch:
        out.extend(b.get("all_pieces") or [])
    return out


def _batching_summary_lines(
    batch: List[Dict[str, Any]],
    decisions: Optional[List[Dict[str, Any]]],
    actual_kg: float,
) -> List[str]:
    lines = [
        f"Greedy batching: minimize (weight−{_ISLAND_IDEAL_CENTER:g})² minus same-flat ({1200:g}) and material ({800:g}) cost bonuses when merging.",
        f"Actual crate weight: {actual_kg:.1f} kg · Target ideal band: {_ISLAND_IDEAL_LO:.0f}–{_ISLAND_IDEAL_HI:.0f} kg · Acceptable: {_ISLAND_ACCEPTABLE_LO:.0f}–{_ISLAND_ACCEPTABLE_HI:.0f} kg.",
        f"Bundles in crate: {len(batch)} — flat grouping is a soft preference (merge bonuses), not a hard partition.",
    ]
    if not decisions:
        return lines
    merges = [d for d in decisions if d.get("type") == "merge_vs_flush"]
    forced = [d for d in decisions if d.get("type") == "merge_under_min_kg"]
    if forced:
        lines.append(f"Forced merges (under {_ISLAND_ACCEPTABLE_LO:.0f} kg floor): {len(forced)} step(s).")
    if merges:
        n_m = sum(1 for d in merges if d.get("choice") == "merge")
        n_f = sum(1 for d in merges if d.get("choice") == "flush_then_new_batch")
        lines.append(f"Merge vs flush decisions: {n_m} merge(s), {n_f} close-and-new-batch choice(s).")
    return lines


def _emit_island_crate_from_bundles(
    *,
    batch: List[Dict[str, Any]],
    dispatch_group: str,
    serial: int,
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
    pull_candidate_ids: List[int],
    batching_decision_trace: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    pieces = _bundles_to_pieces(batch)
    mains = [b["parent"] for b in batch]
    spl = []
    splash_only: List[Any] = []
    for b in batch:
        spl.extend(b.get("children") or [])
        splash_only.extend(b.get("splash_pieces") or [])

    wt = total_piece_weight(pieces, material, thickness, color)
    warnings: List[str] = []
    if wt > _ISLAND_ACCEPTABLE_HI:
        warnings.append(f"Island crate exceeds {_ISLAND_ACCEPTABLE_HI:.0f} kg ({round(wt)} kg).")
    if wt < _ISLAND_ACCEPTABLE_LO and pieces:
        warnings.append(
            f"UNDERLOADED — crate under {_ISLAND_ACCEPTABLE_LO:.0f} kg ({round(wt)} kg). See suggested pulls."
        )
    band = (
        "ideal"
        if _ISLAND_ACCEPTABLE_LO <= wt <= _ISLAND_ACCEPTABLE_HI
        else ("below_ideal" if wt < _ISLAND_ACCEPTABLE_LO else "above_ideal")
    )
    if _ISLAND_IDEAL_LO <= wt <= _ISLAND_IDEAL_HI:
        band = "ideal"

    if wt > _ISLAND_ACCEPTABLE_HI:
        operational_status = "OVERWEIGHT"
    elif wt < _ISLAND_ACCEPTABLE_LO:
        operational_status = "UNDERLOADED"
    elif _ISLAND_IDEAL_LO <= wt <= _ISLAND_IDEAL_HI:
        operational_status = "OPTIMAL"
    else:
        operational_status = "ACCEPTABLE"

    dims = island_cassette_dimensions_operational(pieces, thickness, wood_thickness)
    eh = float(dims.get("external_height") or 0)
    h_clear = float(CONTAINER_20FT["max_clear_height"])
    if eh > h_clear + 0.01:
        warnings.append(
            f"Tall island cassette (external max axis {eh:.1f} in vs nominal {h_clear:.1f} in clear) — "
            "manifest eligibility uses 3D rotated fit vs 20′ envelope; verify loading orientation on site."
        )
    spec_letter = "A"
    label = "Island (vertical cassette)"

    if pull_candidate_ids:
        warnings.append(
            f"Pull nearby parts (optional): {len(pull_candidate_ids)} candidate piece(s) ordered by adjacency — auto pull not implemented."
        )

    # Layer IDs for UI / pack sheets (vertical cassette still lists splash qty per tier)
    splash_layers_model = [[p["id"] for p in splash_only]] if splash_only else []

    return {
        "crate_class": spec_letter,
        "crate_type_label": f"[{spec_letter}-Type] {label}",
        "category": "island",
        "orientation": "vertical",
        "serial": serial,
        "dispatch_group": dispatch_group,
        "name": f"[{spec_letter}] {label} — {dispatch_group} #{serial}",
        "pieces": pieces,
        "main_pieces": mains,
        "splash_pieces": spl,
        "splash_layers": splash_layers_model,
        "max_weight": float(_ISLAND_ACCEPTABLE_HI),
        "total_weight_kg": round(wt, 1),
        "weight_band_status": band,
        "operational_status": operational_status,
        "packing_mode": "v3",
        "grouping_reason": f"Operational Phase A — {len(batch)} bundle(s), adjacent slabs, no spacing",
        "warnings": warnings,
        "main_layer_piece_ids": [p["id"] for p in mains],
        "splash_layer_piece_ids": [p["id"] for p in splash_only],
        "splash_layer": len(splash_only) > 0,
        "dimensions": dims,
        "part_bundles": [
            {
                "bundle_id": b["bundle_id"],
                "parent_id": b["parent"]["id"],
                "child_ids": [c["id"] for c in b.get("children") or []],
            }
            for b in batch
        ],
        "pull_candidate_piece_ids": pull_candidate_ids[:80],
        "phase_lock": "A",
        "planner_debug": {
            "source_bundle_ids": [str(b.get("bundle_id") or "") for b in batch if b.get("bundle_id")],
            "source_family_ids": sorted({str(b.get("family_id")) for b in batch if b.get("family_id")}),
            "source_unit_ids": [],
            "unit_kind": "island_unit",
            "absorption_history": [],
            "emit_gate_verdict": None,
            "geometry_validation": None,
            "container_placement": None,
            "emit_reason": "island_phase_a_emit",
            "batching_transparency": {
                "model": "greedy_ideal_batches on all scoped island bundles (single global pass; dispatch label is informational)",
                "ideal_center_kg": _ISLAND_IDEAL_CENTER,
                "ideal_band_kg": [_ISLAND_IDEAL_LO, _ISLAND_IDEAL_HI],
                "acceptable_band_kg": [_ISLAND_ACCEPTABLE_LO, _ISLAND_ACCEPTABLE_HI],
                "flat_bonus_cost_units": 1200.0,
                "material_bonus_cost_units": 800.0,
                "decisions": batching_decision_trace or [],
                "summary_lines": _batching_summary_lines(batch, batching_decision_trace, wt),
            },
        },
    }


def _candidate_bundles_for_pull(
    all_island_bundles: List[Dict[str, Any]],
    batch_piece_ids: Set[int],
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for b in all_island_bundles:
        ids = set(b.get("all_piece_ids") or [])
        if ids <= batch_piece_ids:
            continue
        out.append(b)
    return out


def pack_phase_a_islands(
    island_bundles: List[Dict[str, Any]],
    dispatch_group: str,
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
    serial_start: int,
    all_island_bundles: List[Dict[str, Any]],
    *,
    collect_batching_trace: bool = False,
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Batch island bundles toward ideal center weight without splitting bundles.

    Batching is **global** over ``island_bundles`` (caller passes all bundles in scope in one list).
    ``dispatch_group`` is used for crate naming / traceability only — not a partition for optimization.
    """
    if not island_bundles:
        return [], serial_start

    batch_traces: Optional[List[List[Dict[str, Any]]]] = [] if collect_batching_trace else None

    batches = greedy_ideal_batches(
        island_bundles,
        sort_key=island_bundle_adjacency_sort_key,
        weight_fn=lambda b: float(b.get("total_weight_kg") or 0),
        min_kg=_ISLAND_ACCEPTABLE_LO,
        max_kg=_ISLAND_ACCEPTABLE_HI,
        ideal_kg=_ISLAND_IDEAL_CENTER,
        same_flat_key_fn=lambda b: b.get("flat_key") or "",
        material_key_fn=lambda b: b.get("material_batch_key") or "",
        batching_trace=batch_traces,
    )

    crates: List[Dict[str, Any]] = []
    serial = serial_start

    for bi, batch in enumerate(batches):
        trace_row = batch_traces[bi] if batch_traces is not None and bi < len(batch_traces) else None
        bw0 = float(batch[0].get("total_weight_kg") or 0)
        if len(batch) == 1 and bw0 > _ISLAND_ACCEPTABLE_HI:
            one = _emit_island_crate_from_bundles(
                batch=batch,
                dispatch_group=dispatch_group,
                serial=serial,
                material=material,
                thickness=thickness,
                color=color,
                wood_thickness=wood_thickness,
                pull_candidate_ids=[],
                batching_decision_trace=trace_row,
            )
            one["warnings"].append(
                "Single island bundle exceeds max weight — split parts manually or reduce bundle size."
            )
            crates.append(one)
            serial += 1
            continue

        batch_ids: Set[int] = set()
        for b in batch:
            batch_ids.update(b.get("all_piece_ids") or [])
        cand = _candidate_bundles_for_pull(all_island_bundles, batch_ids)
        pulls = ordered_pull_piece_ids(batch[0], cand, batch_ids, limit=80)

        crates.append(
            _emit_island_crate_from_bundles(
                batch=batch,
                dispatch_group=dispatch_group,
                serial=serial,
                material=material,
                thickness=thickness,
                color=color,
                wood_thickness=wood_thickness,
                pull_candidate_ids=pulls,
                batching_decision_trace=trace_row,
            )
        )
        serial += 1

    return crates, serial


def build_island_bundles_indexed_by_dispatch(
    pieces: List[Dict[str, Any]],
    material: str,
    thickness: str,
    color: str,
    basis: str,
) -> Tuple[Dict[str, List[Dict[str, Any]]], Set[int], List[Dict[str, Any]], Dict[str, List[Dict[str, Any]]]]:
    """All island bundles grouped by dispatch key + flat index (legacy index retained for callers)."""
    families = build_families(pieces)
    bundles = build_island_bundles_from_families(families, material, thickness, color)
    by_dk: Dict[str, List[Dict[str, Any]]] = {}
    for b in bundles:
        ref = b["parent"]
        dk = dispatch_group_label(ref, basis)
        by_dk.setdefault(dk, []).append(b)

    flat_index: Dict[str, List[Dict[str, Any]]] = {}
    for b in bundles:
        key = f"{b.get('building')}|{b.get('floor')}|{b.get('flat')}"
        flat_index.setdefault(key, []).append(b)

    ids = collect_island_piece_ids(bundles)
    return by_dk, ids, bundles, flat_index
