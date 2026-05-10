from typing import Any, Dict, List, Tuple

from ..planning_engine import piece_weight
from .classify import build_families
from .dimensions import horizontal_crate_dimensions, island_vertical_dimensions, total_piece_weight
from .dispatch import dispatch_group_label, sort_pieces_by_dispatch
from .phase_a_island import (
    build_island_bundles_indexed_by_dispatch,
    operational_planner_enabled,
    pack_phase_a_islands,
)
from .phase_bc_horizontal import (
    pack_phase_b_kitchen_range_operational,
    pack_phase_c_vanity_operational,
)

SPLASHES_PER_LAYER = 4

# Warehouse strict bands (kg) — islands, kitchen perimeter, range, vanity
TYPE_SPECS: Dict[str, Dict[str, Any]] = {
    "island": {"min_kg": 1400, "max_kg": 2200, "letter": "A", "label": "Island (vertical)"},
    "perimeter": {"min_kg": 1400, "max_kg": 2200, "letter": "B", "label": "Perimeter kitchen & splashes"},
    "range": {"min_kg": 800, "max_kg": 1800, "letter": "C", "label": "Range tops & splashes"},
    "vanity": {"min_kg": 700, "max_kg": 1600, "letter": "D", "label": "Vanity tops & splashes"},
    "misc": {"min_kg": 400, "max_kg": 1200, "letter": "D", "label": "Misc / splashes"},
}

# All horizontal crate categories (B/C/D/misc): at most one splash tier above mains (2 stone layers total).
# Islands (A) use the vertical cassette path, not this merge.
_MAX_SPLASH_TIERS_HORIZONTAL = 1
_HORIZONTAL_STONE_LAYER_CAP_CATEGORIES = frozenset({"perimeter", "range", "vanity", "misc"})


def _merge_splash_tiers_for_two_layer_cap(
    splash_layers: List[List[Dict[str, Any]]],
    category: str,
    warnings: List[str],
) -> List[List[Dict[str, Any]]]:
    if category not in _HORIZONTAL_STONE_LAYER_CAP_CATEGORIES:
        return splash_layers
    if len(splash_layers) <= _MAX_SPLASH_TIERS_HORIZONTAL:
        return splash_layers
    merged = [p for layer in splash_layers for p in layer]
    cat_label = {"perimeter": "perimeter kitchen (B)", "range": "range tops (C)", "vanity": "vanity (D)", "misc": "misc horizontal"}.get(
        category, category
    )
    warnings.append(
        f"Stone layers capped at 2 for {cat_label} (main bed + one splash tier) — multiple splash courses merged into one tier."
    )
    return [merged]


def _piece_order_index(ordered_pieces: List[Dict[str, Any]]) -> Dict[int, int]:
    return {p["id"]: i for i, p in enumerate(ordered_pieces)}


def _family_sort_key(fam: Dict[str, Any], idx: Dict[int, int]) -> int:
    ids = [p["id"] for p in fam["all_pieces"]]
    return min(idx.get(i, 999999) for i in ids)


def _chunk_splashes(splashes: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    if not splashes:
        return []
    layers: List[List[Dict[str, Any]]] = []
    for i in range(0, len(splashes), SPLASHES_PER_LAYER):
        layers.append(splashes[i : i + SPLASHES_PER_LAYER])
    return layers


def _family_weight(fam: Dict[str, Any], material: str, thickness: str, color: str) -> float:
    return total_piece_weight(fam["all_pieces"], material, thickness, color)


def _emit_horizontal_crate(
    *,
    letter: str,
    label: str,
    category: str,
    dispatch_group: str,
    serial: int,
    main_pieces: List[Dict[str, Any]],
    splash_layers: List[List[Dict[str, Any]]],
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
    warnings: List[str],
) -> Dict[str, Any]:
    splash_layers = _merge_splash_tiers_for_two_layer_cap(splash_layers, category, warnings)
    spl_flat = [p for layer in splash_layers for p in layer]
    pieces = main_pieces + spl_flat
    wt = total_piece_weight(pieces, material, thickness, color)
    spec = TYPE_SPECS.get(category, TYPE_SPECS["misc"])
    lo, hi = spec["min_kg"], spec["max_kg"]
    band = "ideal" if lo <= wt <= hi else ("below_ideal" if wt < lo else "above_ideal")
    if wt > spec["max_kg"]:
        warnings.append(f"Crate {letter}-{serial} exceeds target max {spec['max_kg']} kg ({round(wt)} kg).")

    dims = horizontal_crate_dimensions(main_pieces, splash_layers, thickness, wood_thickness)

    splash_ids_by_layer = [[p["id"] for p in layer] for layer in splash_layers]
    layers_model: List[Dict[str, Any]] = [
        {"role": "main_layer", "layer_index": 0, "piece_ids": [p["id"] for p in main_pieces]},
        {
            "role": "splash_layer",
            "layer_index": 1,
            "sublayers": splash_ids_by_layer,
            "piece_ids": [p["id"] for p in spl_flat],
        },
    ]

    return {
        "crate_class": letter,
        "crate_type_label": f"[{letter}-Type] {label}",
        "category": category,
        "orientation": "horizontal",
        "serial": serial,
        "dispatch_group": dispatch_group,
        "name": f"[{letter}] {label} — {dispatch_group} #{serial}",
        "pieces": pieces,
        "main_pieces": main_pieces,
        "splash_pieces": spl_flat,
        "splash_layers": [[p["id"] for p in layer] for layer in splash_layers],
        "layers": layers_model,
        "max_weight": float(spec["max_kg"]),
        "total_weight_kg": round(wt, 1),
        "weight_band_status": band,
        "packing_mode": "v3",
        "grouping_reason": f"{label}; splashes in {len(splash_layers)} layer(s)" if splash_layers else label,
        "warnings": list(warnings),
        "main_layer_piece_ids": [p["id"] for p in main_pieces],
        "splash_layer_piece_ids": [p["id"] for p in spl_flat],
        "splash_layer": len(splash_layers) > 0,
        "dimensions": dims,
    }


def _emit_island_crate(
    *,
    families: List[Dict[str, Any]],
    dispatch_group: str,
    serial: int,
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
) -> Dict[str, Any]:
    mains: List[Dict[str, Any]] = []
    spl: List[Dict[str, Any]] = []
    for fam in families:
        mains.extend(fam["main_pieces"])
        spl.extend(fam["splash_pieces"])
    pieces = mains + spl
    wt = total_piece_weight(pieces, material, thickness, color)
    spec = TYPE_SPECS["island"]
    warnings: List[str] = []
    if wt > spec["max_kg"]:
        warnings.append(f"Island crate exceeds {spec['max_kg']} kg ({round(wt)} kg).")
    if wt < spec["min_kg"] and len(pieces) > 0:
        warnings.append(f"Island crate under {spec['min_kg']} kg ({round(wt)} kg) — partial batch.")
    band = "ideal" if spec["min_kg"] <= wt <= spec["max_kg"] else ("below_ideal" if wt < spec["min_kg"] else "above_ideal")

    dims = island_vertical_dimensions(pieces, thickness, wood_thickness)
    letter = spec["letter"]
    label = spec["label"]

    return {
        "crate_class": letter,
        "crate_type_label": f"[{letter}-Type] {label}",
        "category": "island",
        "orientation": "vertical",
        "serial": serial,
        "dispatch_group": dispatch_group,
        "name": f"[{letter}] {label} — {dispatch_group} #{serial}",
        "pieces": pieces,
        "main_pieces": mains,
        "splash_pieces": spl,
        "splash_layers": [],
        "max_weight": float(spec["max_kg"]),
        "total_weight_kg": round(wt, 1),
        "weight_band_status": band,
        "packing_mode": "v3",
        "grouping_reason": "Island vertical cassette",
        "warnings": warnings,
        "main_layer_piece_ids": [p["id"] for p in mains],
        "splash_layer_piece_ids": [p["id"] for p in spl],
        "splash_layer": len(spl) > 0,
        "dimensions": dims,
    }


def _pack_islands(
    families: List[Dict[str, Any]],
    dispatch_group: str,
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
    serial_start: int,
    order_idx: Dict[int, int],
) -> Tuple[List[Dict[str, Any]], int]:
    island_fams = [f for f in families if f["category"] == "island"]
    island_fams.sort(key=lambda f: _family_sort_key(f, order_idx))
    crates: List[Dict[str, Any]] = []
    serial = serial_start
    cur: List[Dict[str, Any]] = []
    cur_wt = 0.0
    max_kg = TYPE_SPECS["island"]["max_kg"]
    max_slabs = 14

    def flush() -> None:
        nonlocal cur, cur_wt, serial
        if not cur:
            return
        crates.append(
            _emit_island_crate(
                families=cur,
                dispatch_group=dispatch_group,
                serial=serial,
                material=material,
                thickness=thickness,
                color=color,
                wood_thickness=wood_thickness,
            )
        )
        serial += 1
        cur = []
        cur_wt = 0.0

    for fam in island_fams:
        fw = _family_weight(fam, material, thickness, color)
        next_ct = sum(len(f["main_pieces"]) + len(f["splash_pieces"]) for f in cur)
        next_ct += len(fam["main_pieces"]) + len(fam["splash_pieces"])
        if cur and (cur_wt + fw > max_kg or next_ct > max_slabs):
            flush()
        cur.append(fam)
        cur_wt += fw
    flush()
    return crates, serial


def _unit_weight(unit: Dict[str, Any], material: str, thickness: str, color: str) -> float:
    flat = [p for layer in unit["splash_layers"] for p in layer]
    return total_piece_weight(unit["mains"] + flat, material, thickness, color)


def _merge_units_batch(batch: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[List[Dict[str, Any]]]]:
    mains: List[Dict[str, Any]] = []
    splash_layers: List[List[Dict[str, Any]]] = []
    for u in batch:
        mains.extend(u["mains"])
        splash_layers.extend(u["splash_layers"])
    return mains, splash_layers


def _horizontal_units_from_families(
    families: List[Dict[str, Any]],
    category: str,
    material: str,
    thickness: str,
    color: str,
    order_idx: Dict[int, int],
) -> List[Dict[str, Any]]:
    """One unit = one packable chunk (family or split) with splashes on the final chunk only."""
    spec = TYPE_SPECS.get(category, TYPE_SPECS["misc"])
    cats = [f for f in families if f["category"] == category]
    cats.sort(key=lambda f: _family_sort_key(f, order_idx))
    units: List[Dict[str, Any]] = []

    for fam in cats:
        mains = list(fam["main_pieces"])
        splashes = list(fam["splash_pieces"])
        splash_layers = _chunk_splashes(splashes)
        wt = total_piece_weight(mains + splashes, material, thickness, color)

        if wt <= spec["max_kg"]:
            units.append({
                "mains": mains,
                "splash_layers": splash_layers,
                "family_category": category,
            })
            continue

        remaining = list(mains)
        while remaining:
            chunk_mains: List[Dict[str, Any]] = []
            chunk_wt = 0.0
            while remaining:
                p = remaining[0]
                pw = piece_weight(p, material, thickness, color)
                if chunk_mains and chunk_wt + pw > spec["max_kg"]:
                    break
                chunk_mains.append(remaining.pop(0))
                chunk_wt += pw
            attach_layers = splash_layers if not remaining else []
            units.append({
                "mains": chunk_mains,
                "splash_layers": attach_layers,
                "family_category": category,
            })

    return units


def _pack_perimeter_range_bins(
    families: List[Dict[str, Any]],
    dispatch_group: str,
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
    serial_start: int,
    order_idx: Dict[int, int],
) -> Tuple[List[Dict[str, Any]], int]:
    """
    B-type: perimeter units first; pull range units to reach 1400–2200 kg and to fill toward max.
    C-type: remaining range units; pull perimeter if needed for 800–1800 kg band.
    """
    p_units = _horizontal_units_from_families(
        families, "perimeter", material, thickness, color, order_idx
    )
    r_units = _horizontal_units_from_families(
        families, "range", material, thickness, color, order_idx
    )
    b_spec = TYPE_SPECS["perimeter"]
    c_spec = TYPE_SPECS["range"]
    crates: List[Dict[str, Any]] = []
    serial = serial_start

    while p_units or r_units:
        if p_units:
            batch: List[Dict[str, Any]] = []
            wt = 0.0
            while p_units:
                u = p_units[0]
                uw = _unit_weight(u, material, thickness, color)
                if wt + uw > b_spec["max_kg"] and batch:
                    break
                p_units.pop(0)
                batch.append(u)
                wt += uw

            warnings: List[str] = []
            while r_units and wt < b_spec["min_kg"]:
                u = r_units[0]
                uw = _unit_weight(u, material, thickness, color)
                if wt + uw > b_spec["max_kg"]:
                    break
                r_units.pop(0)
                batch.append(u)
                wt += uw
                warnings.append("Range tops added to reach B-type target weight band.")

            range_fill = False
            while r_units:
                u = r_units[0]
                uw = _unit_weight(u, material, thickness, color)
                if wt + uw > b_spec["max_kg"]:
                    break
                r_units.pop(0)
                batch.append(u)
                wt += uw
                range_fill = True
            if range_fill:
                warnings.append("Additional range tops included to fill B-type crate toward max weight.")

            mains, splash_layers = _merge_units_batch(batch)
            crates.append(
                _emit_horizontal_crate(
                    letter=b_spec["letter"],
                    label=b_spec["label"],
                    category="perimeter",
                    dispatch_group=dispatch_group,
                    serial=serial,
                    main_pieces=mains,
                    splash_layers=splash_layers,
                    material=material,
                    thickness=thickness,
                    color=color,
                    wood_thickness=wood_thickness,
                    warnings=warnings,
                )
            )
            serial += 1
        else:
            batch = []
            wt = 0.0
            while r_units:
                u = r_units[0]
                uw = _unit_weight(u, material, thickness, color)
                if wt + uw > c_spec["max_kg"] and batch:
                    break
                r_units.pop(0)
                batch.append(u)
                wt += uw

            warnings = []
            while p_units and wt < c_spec["min_kg"]:
                u = p_units[0]
                uw = _unit_weight(u, material, thickness, color)
                if wt + uw > c_spec["max_kg"]:
                    break
                p_units.pop(0)
                batch.append(u)
                wt += uw
                warnings.append("Perimeter kitchens added to reach C-type target weight band.")

            perimeter_fill = False
            while p_units:
                u = p_units[0]
                uw = _unit_weight(u, material, thickness, color)
                if wt + uw > c_spec["max_kg"]:
                    break
                p_units.pop(0)
                batch.append(u)
                wt += uw
                perimeter_fill = True
            if perimeter_fill:
                warnings.append("Additional perimeter kitchens included to fill C-type crate toward max weight.")

            mains, splash_layers = _merge_units_batch(batch)
            crates.append(
                _emit_horizontal_crate(
                    letter=c_spec["letter"],
                    label=c_spec["label"],
                    category="range",
                    dispatch_group=dispatch_group,
                    serial=serial,
                    main_pieces=mains,
                    splash_layers=splash_layers,
                    material=material,
                    thickness=thickness,
                    color=color,
                    wood_thickness=wood_thickness,
                    warnings=warnings,
                )
            )
            serial += 1

    return crates, serial


def _pack_vanity_bins(
    families: List[Dict[str, Any]],
    dispatch_group: str,
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
    serial_start: int,
    order_idx: Dict[int, int],
) -> Tuple[List[Dict[str, Any]], int]:
    """Merge multiple vanity families into crates toward 700–1600 kg."""
    spec = TYPE_SPECS["vanity"]
    units = _horizontal_units_from_families(
        families, "vanity", material, thickness, color, order_idx
    )
    crates: List[Dict[str, Any]] = []
    serial = serial_start

    while units:
        batch: List[Dict[str, Any]] = []
        wt = 0.0
        while units:
            u = units[0]
            uw = _unit_weight(u, material, thickness, color)
            if wt + uw > spec["max_kg"] and batch:
                break
            units.pop(0)
            batch.append(u)
            wt += uw

        mains, splash_layers = _merge_units_batch(batch)
        warn: List[str] = []
        if len(batch) > 1:
            warn.append("Multiple vanity runs merged to approach D-type target weight.")
        crates.append(
            _emit_horizontal_crate(
                letter=spec["letter"],
                label=spec["label"],
                category="vanity",
                dispatch_group=dispatch_group,
                serial=serial,
                main_pieces=mains,
                splash_layers=splash_layers,
                material=material,
                thickness=thickness,
                color=color,
                wood_thickness=wood_thickness,
                warnings=warn,
            )
        )
        serial += 1

    return crates, serial


def _pack_misc_bins(
    families: List[Dict[str, Any]],
    dispatch_group: str,
    material: str,
    thickness: str,
    color: str,
    wood_thickness: float,
    serial_start: int,
    order_idx: Dict[int, int],
) -> Tuple[List[Dict[str, Any]], int]:
    """Merge misc / orphan splash units into fewer crates up to max_kg (same pattern as vanity)."""
    spec = TYPE_SPECS["misc"]
    units = _horizontal_units_from_families(
        families, "misc", material, thickness, color, order_idx
    )
    crates: List[Dict[str, Any]] = []
    serial = serial_start

    while units:
        batch: List[Dict[str, Any]] = []
        wt = 0.0
        while units:
            u = units[0]
            uw = _unit_weight(u, material, thickness, color)
            if wt + uw > spec["max_kg"] and batch:
                break
            units.pop(0)
            batch.append(u)
            wt += uw

        mains, splash_layers = _merge_units_batch(batch)
        warn: List[str] = []
        if len(batch) > 1:
            warn.append("Misc splash pieces merged to reduce small crate count.")
        crates.append(
            _emit_horizontal_crate(
                letter=spec["letter"],
                label=spec["label"],
                category="misc",
                dispatch_group=dispatch_group,
                serial=serial,
                main_pieces=mains,
                splash_layers=splash_layers,
                material=material,
                thickness=thickness,
                color=color,
                wood_thickness=wood_thickness,
                warnings=warn,
            )
        )
        serial += 1

    return crates, serial


def _group_families_by_dispatch(
    families: List[Dict[str, Any]], basis: str
) -> "OrderedDict[str, List[Dict[str, Any]]]":
    from collections import OrderedDict

    grouped: "OrderedDict[str, List[Dict[str, Any]]]" = OrderedDict()
    for fam in families:
        ref = fam["main_pieces"][0] if fam["main_pieces"] else fam["splash_pieces"][0]
        dk = dispatch_group_label(ref, basis)
        grouped.setdefault(dk, []).append(fam)
    return grouped


def _dispatch_key_order(pieces: List[Dict[str, Any]], basis: str) -> List[str]:
    order: List[str] = []
    seen = set()
    for p in pieces:
        dk = dispatch_group_label(p, basis)
        if dk not in seen:
            seen.add(dk)
            order.append(dk)
    return order


def build_crates(
    pieces: List[Dict[str, Any]],
    project: Dict[str, Any],
    dispatch_selection: Dict[str, Any],
    wood_thickness: float,
) -> List[Dict[str, Any]]:
    material = project.get("material", "Granite")
    thickness = project.get("thickness", "3CM")
    color = project.get("stone_color", "") or ""

    ordered = sort_pieces_by_dispatch(pieces, dispatch_selection)
    basis = (dispatch_selection or {}).get("basis", "flat")
    order_idx = _piece_order_index(ordered)

    # --- Operational Phase A (bundles + island cassette) — PLANNER_V3_OPERATIONAL=1 ---
    if operational_planner_enabled():
        by_dk, island_ids, bundles_all, _flat_index = build_island_bundles_indexed_by_dispatch(
            ordered, material, thickness, color, basis
        )
        remaining = [p for p in ordered if p["id"] not in island_ids]
        families_rem = build_families(remaining)
        grouped = _group_families_by_dispatch(families_rem, basis)
        dk_order = _dispatch_key_order(ordered, basis)

        all_crates: List[Dict[str, Any]] = []
        serial = 1
        for dispatch_group in dk_order:
            fams = grouped.get(dispatch_group, [])
            ib = by_dk.get(dispatch_group, [])
            ic, serial = pack_phase_a_islands(
                ib,
                dispatch_group,
                material,
                thickness,
                color,
                wood_thickness,
                serial,
                bundles_all,
            )
            all_crates.extend(ic)
            pr, serial = pack_phase_b_kitchen_range_operational(
                fams, dispatch_group, material, thickness, color, wood_thickness, serial, order_idx
            )
            all_crates.extend(pr)
            vb, serial = pack_phase_c_vanity_operational(
                fams, dispatch_group, material, thickness, color, wood_thickness, serial, order_idx
            )
            all_crates.extend(vb)
            mc, serial = _pack_misc_bins(
                fams, dispatch_group, material, thickness, color, wood_thickness, serial, order_idx
            )
            all_crates.extend(mc)

        return all_crates

    # --- Legacy v3 (family-based island pack) ---
    grouped = _group_families_by_dispatch(build_families(ordered), basis)

    all_crates = []
    serial = 1
    for dispatch_group, fams in grouped.items():
        ic, serial = _pack_islands(
            fams, dispatch_group, material, thickness, color, wood_thickness, serial, order_idx
        )
        all_crates.extend(ic)
        pr, serial = _pack_perimeter_range_bins(
            fams, dispatch_group, material, thickness, color, wood_thickness, serial, order_idx
        )
        all_crates.extend(pr)
        vb, serial = _pack_vanity_bins(
            fams, dispatch_group, material, thickness, color, wood_thickness, serial, order_idx
        )
        all_crates.extend(vb)
        mc, serial = _pack_misc_bins(
            fams, dispatch_group, material, thickness, color, wood_thickness, serial, order_idx
        )
        all_crates.extend(mc)

    return all_crates
