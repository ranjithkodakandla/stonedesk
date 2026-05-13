"""
Greedy batching toward an ideal crate weight with min/max bands.
Prefers closeness to ideal; optional bonuses for same flat / material batch keys.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple

from .adjacency import ADJACENCY_TIER_LABELS, adjacency_tier

BundleSortKey = Callable[[Dict[str, Any]], Tuple]
WeightFn = Callable[[Dict[str, Any]], float]


def _dev2(wt: float, ideal: float) -> float:
    d = wt - ideal
    return d * d


def _sum_main_slots(cur: List[Dict[str, Any]], main_sum_fn: Optional[Callable[[Dict[str, Any]], int]]) -> int:
    if not main_sum_fn:
        return 0
    return sum(int(main_sum_fn(x)) for x in cur)


def greedy_ideal_batches(
    bundles: List[Dict[str, Any]],
    *,
    sort_key: BundleSortKey,
    weight_fn: WeightFn,
    min_kg: float,
    max_kg: float,
    ideal_kg: float,
    same_flat_key_fn: Callable[[Dict[str, Any]], str],
    material_key_fn: Callable[[Dict[str, Any]], str],
    flat_bonus: float = 1200.0,
    material_bonus: float = 800.0,
    main_sum_fn: Optional[Callable[[Dict[str, Any]], int]] = None,
    main_cap: Optional[int] = None,
    batching_trace: Optional[List[List[Dict[str, Any]]]] = None,
) -> List[List[Dict[str, Any]]]:
    """
    Pack sorted bundles into batches without splitting bundles.
    When the next bundle fits under max_kg, choose merge vs start-new crate by
    minimizing squared deviation from ideal minus same-flat / material **cost bonuses**
    (``flat_bonus`` / ``material_bonus`` are not kg — they shrink the merge cost).

    If ``batching_trace`` is a list, one sub-list of decision dicts is appended per
    completed batch (aligned with ``batches`` indices) for UAT explainability.
    """
    items = sorted(bundles, key=sort_key)
    batches: List[List[Dict[str, Any]]] = []
    cur: List[Dict[str, Any]] = []
    cur_wt = 0.0
    cur_events: List[Dict[str, Any]] = []

    def flush() -> None:
        nonlocal cur, cur_wt, cur_events
        if cur:
            batches.append(cur)
            if batching_trace is not None:
                batching_trace.append(list(cur_events))
            cur = []
            cur_wt = 0.0
            cur_events = []

    def _loc(x: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "building": x.get("building"),
            "floor": x.get("floor"),
            "flat": x.get("flat"),
            "flat_key": x.get("flat_key"),
        }

    for b in items:
        w = float(weight_fn(b))
        if w > max_kg:
            flush()
            if batching_trace is not None:
                batching_trace.append(
                    [
                        {
                            "type": "oversize_singleton",
                            "bundle_id": b.get("bundle_id"),
                            "weight_kg": w,
                            "note": "bundle over max_kg — emitted alone",
                        }
                    ]
                )
            batches.append([b])
            continue

        if not cur:
            if batching_trace is not None:
                cur_events = [
                    {
                        "type": "seed",
                        "bundle_id": b.get("bundle_id"),
                        "weight_kg": w,
                        "sort_key": sort_key(b),
                    }
                ]
            cur = [b]
            cur_wt = w
            continue

        if cur_wt + w > max_kg:
            flush()
            if batching_trace is not None:
                cur_events = [
                    {
                        "type": "seed",
                        "bundle_id": b.get("bundle_id"),
                        "weight_kg": w,
                        "sort_key": sort_key(b),
                        "note": "new batch after max_kg capacity split",
                    }
                ]
            cur = [b]
            cur_wt = w
            continue

        mc_cur = _sum_main_slots(cur, main_sum_fn)
        mc_b = int(main_sum_fn(b)) if main_sum_fn else 0
        if main_cap is not None and main_sum_fn is not None and mc_cur + mc_b > main_cap:
            flush()
            if batching_trace is not None:
                cur_events = [
                    {
                        "type": "seed",
                        "bundle_id": b.get("bundle_id"),
                        "weight_kg": w,
                        "sort_key": sort_key(b),
                        "note": "new batch after main_cap split",
                    }
                ]
            cur = [b]
            cur_wt = w
            continue

        # merge vs flush-before-add
        last = cur[-1]
        fk_last = same_flat_key_fn(last)
        fk_b = same_flat_key_fn(b)
        mat_last = material_key_fn(last)
        mat_b = material_key_fn(b)

        merge_flat = flat_bonus if fk_last == fk_b else 0.0
        merge_mat = material_bonus if mat_last and mat_b and mat_last == mat_b else 0.0

        wt_after = cur_wt + w
        cost_merge = _dev2(wt_after, ideal_kg) - merge_flat - merge_mat

        cost_flush = _dev2(cur_wt, ideal_kg) + _dev2(w, ideal_kg)
        orphan_penalty = 0.0
        if w < min_kg:
            orphan_penalty = _dev2(w, ideal_kg) + (max_kg - min_kg) ** 2 * 0.25

        tier, _tie, _fk = adjacency_tier(_loc(last), b)

        # Need mass in current crate — keep merging if under min
        if cur_wt < min_kg:
            if main_cap is not None and main_sum_fn is not None and mc_cur + mc_b > main_cap:
                flush()
                if batching_trace is not None:
                    cur_events = [
                        {
                            "type": "seed",
                            "bundle_id": b.get("bundle_id"),
                            "weight_kg": w,
                            "sort_key": sort_key(b),
                            "note": "new batch after main_cap (under min path)",
                        }
                    ]
                cur = [b]
                cur_wt = w
                continue
            if batching_trace is not None:
                cur_events.append(
                    {
                        "type": "merge_under_min_kg",
                        "bundle_id": b.get("bundle_id"),
                        "weight_kg": w,
                        "crate_weight_before_kg": round(cur_wt, 2),
                        "crate_weight_after_kg": round(wt_after, 2),
                        "min_kg": min_kg,
                        "adjacency_tier": tier,
                        "adjacency_tier_label": ADJACENCY_TIER_LABELS.get(tier, f"tier_{tier}"),
                        "same_flat_key_last": fk_last,
                        "same_flat_key_new": fk_b,
                        "same_flat_bonus_cost_units": merge_flat,
                        "material_bonus_cost_units": merge_mat,
                        "note": "crate still under min_kg — merge forced (no merge-vs-flush choice)",
                    }
                )
            cur.append(b)
            cur_wt = wt_after
            continue

        chosen = "merge" if cost_merge <= cost_flush + orphan_penalty else "flush_then_new_batch"
        if batching_trace is not None:
            cur_events.append(
                {
                    "type": "merge_vs_flush",
                    "choice": chosen,
                    "bundle_id": b.get("bundle_id"),
                    "weight_kg": w,
                    "crate_weight_before_kg": round(cur_wt, 2),
                    "crate_weight_if_merged_kg": round(wt_after, 2),
                    "ideal_kg": ideal_kg,
                    "cost_merge": round(cost_merge, 2),
                    "cost_flush_plus_orphan": round(cost_flush + orphan_penalty, 2),
                    "same_flat_bonus_cost_units": merge_flat,
                    "material_bonus_cost_units": merge_mat,
                    "same_flat": fk_last == fk_b,
                    "same_material_batch": bool(mat_last and mat_b and mat_last == mat_b),
                    "adjacency_tier": tier,
                    "adjacency_tier_label": ADJACENCY_TIER_LABELS.get(tier, f"tier_{tier}"),
                    "orphan_penalty_applied": orphan_penalty > 0,
                }
            )
        if chosen == "merge":
            cur.append(b)
            cur_wt = wt_after
        else:
            flush()
            if batching_trace is not None:
                cur_events = [
                    {
                        "type": "seed",
                        "bundle_id": b.get("bundle_id"),
                        "weight_kg": w,
                        "sort_key": sort_key(b),
                        "note": "new batch after flush (merge cost higher than close+new)",
                    }
                ]
            cur = [b]
            cur_wt = w

    flush()
    return batches


def sequential_ideal_batches(
    ordered_items: List[Dict[str, Any]],
    *,
    weight_fn: WeightFn,
    min_kg: float,
    max_kg: float,
    ideal_kg: float,
    same_flat_key_fn: Callable[[Dict[str, Any]], str],
    material_key_fn: Callable[[Dict[str, Any]], str],
    flat_bonus: float = 1200.0,
    material_bonus: float = 800.0,
    main_sum_fn: Optional[Callable[[Dict[str, Any]], int]] = None,
    main_cap: Optional[int] = None,
) -> List[List[Dict[str, Any]]]:
    """
    FIFO packing in caller-provided order (dispatch / adjacency already applied).
    Same merge-vs-flush scoring as greedy_ideal_batches but never re-sorts globally.
    Optional ``main_cap`` keeps total main-bed slab slots per batch within warehouse rule (e.g. 10).
    """
    queue = list(ordered_items)
    batches: List[List[Dict[str, Any]]] = []

    while queue:
        first = queue.pop(0)
        w0 = float(weight_fn(first))
        if w0 > max_kg:
            batches.append([first])
            continue

        cur: List[Dict[str, Any]] = [first]
        cur_wt = w0

        while queue:
            nxt = queue[0]
            w = float(weight_fn(nxt))
            if cur_wt + w > max_kg:
                break

            mc_cur = _sum_main_slots(cur, main_sum_fn)
            mc_add = int(main_sum_fn(nxt)) if main_sum_fn else 0
            if main_cap is not None and main_sum_fn is not None and mc_cur + mc_add > main_cap:
                break

            last = cur[-1]
            fk_last = same_flat_key_fn(last)
            fk_n = same_flat_key_fn(nxt)
            mat_last = material_key_fn(last)
            mat_n = material_key_fn(nxt)
            merge_flat = flat_bonus if fk_last == fk_n else 0.0
            merge_mat = material_bonus if mat_last and mat_n and mat_last == mat_n else 0.0

            wt_after = cur_wt + w
            cost_merge = _dev2(wt_after, ideal_kg) - merge_flat - merge_mat
            cost_flush = _dev2(cur_wt, ideal_kg) + _dev2(w, ideal_kg)
            orphan_penalty = 0.0
            if w < min_kg:
                orphan_penalty = _dev2(w, ideal_kg) + (max_kg - min_kg) ** 2 * 0.25

            if cur_wt < min_kg:
                if main_cap is not None and main_sum_fn is not None and mc_cur + mc_add > main_cap:
                    break
                queue.pop(0)
                cur.append(nxt)
                cur_wt = wt_after
                continue

            if cost_merge <= cost_flush + orphan_penalty:
                queue.pop(0)
                cur.append(nxt)
                cur_wt = wt_after
            else:
                break

        batches.append(cur)

    return batches
