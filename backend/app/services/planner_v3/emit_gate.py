"""
Final emit gate + remainder tagging for planner v3 crates (pre–container optimize).

Hard rejects: overweight, vertical over clear height, no main pieces (horizontal expected).
Soft holds: under soft-min weight or under fill ratio unless ``final_remainder``.
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

# Must match ``CONTAINER_20FT["max_clear_height"]`` (avoid circular import from container_layout).
_CLEAR_H_IN = 100.0

# Class letter → operational bands (soft min ≈ target floor; hard max = never exceed).
EMIT_SPECS: Dict[str, Dict[str, float]] = {
    "A": {"soft_min_kg": 1400.0, "hard_max_kg": 2200.0, "min_fill_ratio": 0.52},
    "B": {"soft_min_kg": 1100.0, "hard_max_kg": 2200.0, "min_fill_ratio": 0.52},
    "C": {"soft_min_kg": 700.0, "hard_max_kg": 1800.0, "min_fill_ratio": 0.48},
    "D": {"soft_min_kg": 600.0, "hard_max_kg": 1600.0, "min_fill_ratio": 0.46},
}

MISC_EMIT_SPEC = {"soft_min_kg": 400.0, "hard_max_kg": 1200.0, "min_fill_ratio": 0.42}


def _spec_for(crate: Dict[str, Any]) -> Dict[str, float]:
    cat = str(crate.get("category") or "")
    if cat == "misc":
        return MISC_EMIT_SPEC
    letter = str(crate.get("crate_class") or "D").upper()
    return EMIT_SPECS.get(letter, EMIT_SPECS["D"])


def weight_fill_ratio(crate: Dict[str, Any]) -> float:
    mw = float(crate.get("max_weight") or 0)
    if mw <= 0:
        return 0.0
    return min(1.0, float(crate.get("total_weight_kg") or 0) / mw)


def needs_merge_absorption(crate: Dict[str, Any]) -> bool:
    """True when crate is below soft weight min or fill ratio — merge attempts should continue."""
    flags = crate.get("planner_emit_flags") or []
    if "final_remainder" in flags:
        return False
    spec = _spec_for(crate)
    wt = float(crate.get("total_weight_kg") or 0)
    if wt <= 0:
        return False
    if wt < spec["soft_min_kg"] - 0.01:
        return True
    return weight_fill_ratio(crate) < spec["min_fill_ratio"] - 1e-6


def evaluate_emit_gate(crate: Dict[str, Any], *, is_final_remainder: bool) -> Tuple[str, List[str]]:
    """
    Returns (verdict, extra_warnings). Verdict one of:
    accept | accept_remainder | reject_overweight | reject_height | reject_no_main |
    hold_underweight | hold_underfilled
    """
    spec = _spec_for(crate)
    msgs: List[str] = []
    wt = float(crate.get("total_weight_kg") or 0)
    letter = str(crate.get("crate_class") or "").upper()
    ori = str(crate.get("orientation") or "").lower()
    cat = str(crate.get("category") or "")

    mains = crate.get("main_pieces") or []
    if ori == "horizontal" and len(mains) == 0 and wt > 0 and cat != "misc":
        return "reject_no_main", ["Emit gate: horizontal crate has no main-bed pieces — review classification."]

    if wt > spec["hard_max_kg"] + 0.01:
        return "reject_overweight", [
            f"Emit gate REJECT overweight: {round(wt)} kg > hard max {spec['hard_max_kg']:.0f} kg ({letter}-type)."
        ]

    dims = crate.get("dimensions") or {}
    eh = float(dims.get("external_height") or 0)
    # Island vertical cassettes: ``external_height`` is not always the container “up” axis — geometry_gate
    # validates with a 3D rotated fit. Do not hard-reject here on height alone.
    if ori == "vertical" and cat != "island" and eh > _CLEAR_H_IN + 0.01:
        return "reject_height", [
            f"Emit gate REJECT height: external height {eh:.1f} in > {_CLEAR_H_IN:.1f} in clear — layout blocked."
        ]

    if is_final_remainder:
        return "accept_remainder", ["Emit gate: marked final_remainder — soft band waived by policy."]

    ratio = weight_fill_ratio(crate)
    if wt > 0 and wt < spec["soft_min_kg"] - 0.01:
        msgs.append(
            f"Emit gate HOLD underweight: {round(wt)} kg < soft min {spec['soft_min_kg']:.0f} kg — merge if possible."
        )
        return "hold_underweight", msgs

    if ratio < spec["min_fill_ratio"] - 1e-6 and wt > 0:
        msgs.append(
            f"Emit gate HOLD under-filled weight ratio {ratio:.2f} < {spec['min_fill_ratio']:.2f} — merge candidate."
        )
        return "hold_underfilled", msgs

    return "accept", []


def mark_final_remainders(crates: List[Dict[str, Any]]) -> None:
    """At most one explicitly flagged final remainder per (dispatch_group, class) among soft-under crates."""
    from collections import defaultdict

    buckets: Dict[Tuple[str, str], List[int]] = defaultdict(list)
    for i, c in enumerate(crates):
        key = (str(c.get("dispatch_group") or ""), str(c.get("crate_class") or ""))
        buckets[key].append(i)

    for _key, idxs in buckets.items():
        under_idx: List[int] = []
        for i in idxs:
            c = crates[i]
            spec = _spec_for(c)
            wt = float(c.get("total_weight_kg") or 0)
            if wt <= 0:
                continue
            flags = list(c.get("planner_emit_flags") or [])
            if "final_remainder" in flags:
                continue
            if wt < spec["soft_min_kg"] - 0.01:
                under_idx.append(i)
        if len(under_idx) == 1:
            c = crates[under_idx[0]]
            fl = list(c.get("planner_emit_flags") or [])
            if "final_remainder" not in fl:
                fl.append("final_remainder")
                c["planner_emit_flags"] = fl
                w = list(c.get("warnings") or [])
                msg = "final_remainder: unavoidable tail for this dispatch/class — soft minimum waived."
                if msg not in w:
                    w.append(msg)
                c["warnings"] = w


def finalize_emit_gates(crates: List[Dict[str, Any]]) -> None:
    """Mutates crates: geometry_blocked, planner_emit_verdict, planner_emit_flags, warnings."""
    mark_final_remainders(crates)
    for c in crates:
        flags = list(c.get("planner_emit_flags") or [])
        is_final = "final_remainder" in flags
        verdict, extra = evaluate_emit_gate(c, is_final_remainder=is_final)
        c["planner_emit_verdict"] = verdict
        dbg = c.setdefault("planner_debug", {})
        dbg["emit_gate_verdict"] = verdict
        if verdict == "reject_height":
            c["planner_v3_geometry_blocked"] = True
        if verdict == "reject_no_main":
            c["planner_v3_geometry_blocked"] = True

        w = list(c.get("warnings") or [])
        for m in extra:
            if m not in w:
                w.append(m)
        c["warnings"] = w


def operational_score(plan: Dict[str, Any], crate_specs: List[Dict[str, Any]]) -> float:
    """
    Lower is better (tie-breaker after unplaced count).
    Penalizes container count and poor crate quality; rewards container utilization and avg crate fill.

    Note: total unplaced crates are compared lexicographically first in ``optimize_container_load``,
    so this score intentionally does **not** repeat unplaced counts (avoids double-counting).
    """
    containers = plan.get("containers") or []
    n = len(containers)
    avg_w_util = (
        sum(float(c.get("weight_utilization_pct") or 0) for c in containers) / max(n, 1) if n else 0.0
    )
    avg_f_util = (
        sum(float(c.get("floor_utilization_pct_approx") or 0) for c in containers) / max(n, 1) if n else 0.0
    )

    avg_crate_fill = 0.0
    if crate_specs:
        ratios = [weight_fill_ratio(c) for c in crate_specs if float(c.get("total_weight_kg") or 0) > 0]
        avg_crate_fill = sum(ratios) / len(ratios) if ratios else 0.0

    underweight = 0
    invalid_geo = 0
    family_split = 0
    zone_violation = 0
    for c in crate_specs:
        spec = _spec_for(c)
        wt = float(c.get("total_weight_kg") or 0)
        flgs = c.get("planner_emit_flags") or []
        if wt > 0 and wt < spec["soft_min_kg"] - 0.01 and "final_remainder" not in flgs:
            underweight += 1
        if c.get("planner_v3_geometry_blocked"):
            invalid_geo += 1
        if c.get("planner_v3_zone_violation"):
            zone_violation += 1
        for msg in c.get("warnings") or []:
            if "EXCEPTION family split" in str(msg):
                family_split += 1
                break

    scatter = len({str(c.get("dispatch_group") or "") for c in crate_specs}) if crate_specs else 0

    score = (
        1000.0 * max(n, 1)
        + 25.0 * underweight
        + 40.0 * invalid_geo
        + 15.0 * family_split
        + 12.0 * max(0, scatter - 4)
        + 8.0 * zone_violation
        - 2.0 * avg_w_util
        - 1.5 * avg_f_util
        - 1.0 * (avg_crate_fill * 100.0)
    )
    return score
