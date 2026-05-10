"""
Greedy batching toward an ideal crate weight with min/max bands.
Prefers closeness to ideal; optional bonuses for same flat / material batch keys.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Tuple

BundleSortKey = Callable[[Dict[str, Any]], Tuple]
WeightFn = Callable[[Dict[str, Any]], float]


def _dev2(wt: float, ideal: float) -> float:
    d = wt - ideal
    return d * d


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
) -> List[List[Dict[str, Any]]]:
    """
    Pack sorted bundles into batches without splitting bundles.
    When the next bundle fits under max_kg, choose merge vs start-new crate by
    minimizing deviation from ideal (plus soft bonuses for adjacency/material).
    """
    items = sorted(bundles, key=sort_key)
    batches: List[List[Dict[str, Any]]] = []
    cur: List[Dict[str, Any]] = []
    cur_wt = 0.0

    def flush() -> None:
        nonlocal cur, cur_wt
        if cur:
            batches.append(cur)
            cur = []
            cur_wt = 0.0

    for b in items:
        w = float(weight_fn(b))
        if w > max_kg:
            flush()
            batches.append([b])
            continue

        if not cur:
            cur = [b]
            cur_wt = w
            continue

        if cur_wt + w > max_kg:
            flush()
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

        # Need mass in current crate — keep merging if under min
        if cur_wt < min_kg:
            cur.append(b)
            cur_wt = wt_after
            continue

        # Prefer merge when merge cost is lower than closing out + starting new
        if cost_merge <= cost_flush + orphan_penalty:
            cur.append(b)
            cur_wt = wt_after
        else:
            flush()
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
) -> List[List[Dict[str, Any]]]:
    """
    FIFO packing in caller-provided order (dispatch / adjacency already applied).
    Same merge-vs-flush scoring as greedy_ideal_batches but never re-sorts globally.
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
