"""
Phase A — operational island cassette packing (bundles, ideal ~1900 kg, dynamic dims).
Gated by PLANNER_V3_OPERATIONAL=1 — legacy path remains default.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Set, Tuple

from .adjacency import ordered_pull_piece_ids
from .bundles import build_island_bundles_from_families, island_bundle_adjacency_sort_key
from .classify import build_families
from .dimensions import island_cassette_dimensions_operational, total_piece_weight
from .dispatch import dispatch_group_label
from .scored_packing import greedy_ideal_batches

# kg targets (ideal center inside acceptable band)
_ISLAND_MIN = 1400.0
_ISLAND_MAX = 2200.0
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
) -> Dict[str, Any]:
    pieces = _bundles_to_pieces(batch)
    mains = [b["parent"] for b in batch]
    spl = []
    for b in batch:
        spl.extend(b.get("children") or [])

    wt = total_piece_weight(pieces, material, thickness, color)
    warnings: List[str] = []
    if wt > _ISLAND_MAX:
        warnings.append(f"Island crate exceeds {_ISLAND_MAX:.0f} kg ({round(wt)} kg).")
    if wt < _ISLAND_MIN and pieces:
        warnings.append(
            f"Island crate under {_ISLAND_MIN:.0f} kg ({round(wt)} kg) — underloaded; consider pull candidates."
        )
    band = "ideal" if _ISLAND_MIN <= wt <= _ISLAND_MAX else ("below_ideal" if wt < _ISLAND_MIN else "above_ideal")
    if _ISLAND_IDEAL_LO <= wt <= _ISLAND_IDEAL_HI:
        band = "ideal"

    dims = island_cassette_dimensions_operational(pieces, thickness, wood_thickness)
    spec_letter = "A"
    label = "Island (vertical cassette)"

    if pull_candidate_ids:
        warnings.append(
            f"Pull nearby parts (optional): {len(pull_candidate_ids)} candidate piece(s) ordered by adjacency — auto pull not implemented."
        )

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
        "splash_layers": [],
        "max_weight": float(_ISLAND_MAX),
        "total_weight_kg": round(wt, 1),
        "weight_band_status": band,
        "packing_mode": "v3",
        "grouping_reason": f"Operational Phase A — {len(batch)} bundle(s), adjacent slabs, no spacing",
        "warnings": warnings,
        "main_layer_piece_ids": [p["id"] for p in mains],
        "splash_layer_piece_ids": [p["id"] for p in spl],
        "splash_layer": len(spl) > 0,
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
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Batch island bundles toward ideal center weight without splitting bundles.
    """
    if not island_bundles:
        return [], serial_start

    batches = greedy_ideal_batches(
        island_bundles,
        sort_key=island_bundle_adjacency_sort_key,
        weight_fn=lambda b: float(b.get("total_weight_kg") or 0),
        min_kg=_ISLAND_MIN,
        max_kg=_ISLAND_MAX,
        ideal_kg=_ISLAND_IDEAL_CENTER,
        same_flat_key_fn=lambda b: b.get("flat_key") or "",
        material_key_fn=lambda b: b.get("material_batch_key") or "",
    )

    crates: List[Dict[str, Any]] = []
    serial = serial_start

    for batch in batches:
        bw0 = float(batch[0].get("total_weight_kg") or 0)
        if len(batch) == 1 and bw0 > _ISLAND_MAX:
            one = _emit_island_crate_from_bundles(
                batch=batch,
                dispatch_group=dispatch_group,
                serial=serial,
                material=material,
                thickness=thickness,
                color=color,
                wood_thickness=wood_thickness,
                pull_candidate_ids=[],
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
