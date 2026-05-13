"""
Canonical dispatch-unit records for bundle UI, planner provenance, and debug exports.

A DispatchUnit is the single contract row downstream consumers should prefer over ad-hoc family tuples.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Optional, Sequence, Tuple

from ..planning_engine import piece_weight
from .classify import build_families, unit_kind_for_category


def stable_unit_id(*, flat_key: str, family_id: str, category: str, piece_ids: Sequence[int]) -> str:
    payload = f"{flat_key}|{family_id}|{category}|{','.join(map(str, sorted(piece_ids)))}"
    h = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"du-{h[:16]}"


def family_row_to_dispatch_unit(fam: Dict[str, Any], *, index: int = 0) -> Dict[str, Any]:
    """Attach canonical ``unit_id`` + audit fields to one ``build_families`` row (mutates copy)."""
    all_p = fam.get("all_pieces") or []
    pids = sorted(p["id"] for p in all_p)
    uid = stable_unit_id(
        flat_key=str(fam.get("flat_key") or ""),
        family_id=str(fam.get("family_id") or ""),
        category=str(fam.get("category") or ""),
        piece_ids=pids,
    )
    row = dict(fam)
    row["unit_id"] = uid
    row["unit_index"] = index
    row["canonical_family_id"] = str(fam.get("family_id") or "")
    row["source_family_ids"] = [str(fam.get("family_id") or "")]
    uk = fam.get("unit_kind") or unit_kind_for_category(str(fam.get("category") or ""))
    row["unit_kind"] = uk
    row["main_piece_ids"] = [p["id"] for p in fam.get("main_pieces") or []]
    row["splash_piece_ids"] = [p["id"] for p in fam.get("splash_pieces") or []]
    row.setdefault("splash_attach_route", fam.get("splash_attach_route"))
    row.setdefault("detached_reason", fam.get("detached_reason"))
    return row


def build_dispatch_units_from_pieces(pieces: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Families → canonical dispatch units. Returns (units, prefix_normalization_events).

    Events describe heuristic prefix fusion applied during ``build_families`` (see classify).
    """
    norm_events: List[str] = []
    families = build_families(pieces)
    for fam in families:
        ev = fam.get("prefix_normalization_events") or []
        if isinstance(ev, list):
            norm_events.extend(str(x) for x in ev)
    units = [family_row_to_dispatch_unit(f, index=i) for i, f in enumerate(families)]
    return units, norm_events


def dispatch_units_to_bundle_api_rows(
    units: List[Dict[str, Any]],
    *,
    material: str,
    thickness: str,
    color: str,
) -> List[Dict[str, Any]]:
    """Shape for ``GET /families`` — pieces remain embedded for compat; picker keys off ``unit_id``."""
    rows: List[Dict[str, Any]] = []
    for u in units:
        all_pieces = u.get("all_pieces") or []
        piece_ids = [p["id"] for p in all_pieces]
        total_weight = sum(float(piece_weight(p, material, thickness, color) or 0) for p in all_pieces)
        ref = all_pieces[0] if all_pieces else {}
        uid = str(u.get("unit_id") or "")
        cat = str(u.get("category") or "misc")
        detached = u.get("detached_reason")

        rows.append({
            "unit_id": uid,
            "family_id": u.get("canonical_family_id") or u.get("family_id"),
            "family_ui_key": uid or f"{u.get('family_id')}@@{u.get('flat_key')}@@{cat}",
            "flat_key": u.get("flat_key"),
            "building": str(ref.get("building", "") or "").strip(),
            "floor": str(ref.get("floor", "") or "").strip(),
            "flat": str(ref.get("flat", "") or "").strip(),
            "category": cat,
            "unit_kind": u.get("unit_kind"),
            "splash_attach_route": u.get("splash_attach_route"),
            "detached_reason": detached,
            "main_piece_ids": u.get("main_piece_ids") or [],
            "splash_piece_ids": u.get("splash_piece_ids") or [],
            "all_piece_ids": piece_ids,
            "main_part_nos": [str(p.get("part_no", "") or "") for p in u.get("main_pieces") or []],
            "splash_part_nos": [str(p.get("part_no", "") or "") for p in u.get("splash_pieces") or []],
            "main_count": len(u.get("main_pieces") or []),
            "splash_count": len(u.get("splash_pieces") or []),
            "total_pieces": len(all_pieces),
            "total_weight_kg": round(total_weight, 1),
            "embedded_family_row": {k: v for k, v in u.items() if k != "all_pieces"},
        })
    return rows


def snapshot_normalized_units_json(units: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """JSON-safe unit summaries for planner debug blob."""
    out: List[Dict[str, Any]] = []
    for u in units:
        out.append({
            "unit_id": u.get("unit_id"),
            "flat_key": u.get("flat_key"),
            "canonical_family_id": u.get("canonical_family_id") or u.get("family_id"),
            "category": u.get("category"),
            "unit_kind": u.get("unit_kind"),
            "main_piece_ids": u.get("main_piece_ids") or [p["id"] for p in u.get("main_pieces") or []],
            "splash_piece_ids": u.get("splash_piece_ids") or [p["id"] for p in u.get("splash_pieces") or []],
            "splash_attach_route": u.get("splash_attach_route"),
            "detached_reason": u.get("detached_reason"),
            "prefix_normalization_events": u.get("prefix_normalization_events") or [],
        })
    return out


def snapshot_dispatch_context(dispatch_selection: Dict[str, Any]) -> Dict[str, Any]:
    try:
        return json.loads(json.dumps(dispatch_selection or {}, default=str))
    except (TypeError, ValueError):
        return {"raw": str(dispatch_selection)}
