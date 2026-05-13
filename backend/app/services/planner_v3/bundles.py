"""
PartBundle model — logical groups (parent + children) for operational packing.
"""
from __future__ import annotations

from typing import Any, Dict, List

from ..planning_engine import piece_weight
from .classify import flat_key

_SPLASHES_PER_LAYER = 4


def _chunk_splashes(splashes: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    if not splashes:
        return []
    layers: List[List[Dict[str, Any]]] = []
    for i in range(0, len(splashes), _SPLASHES_PER_LAYER):
        layers.append(splashes[i : i + _SPLASHES_PER_LAYER])
    return layers


def _material_batch_key(parent: Dict[str, Any], project_color: str) -> str:
    v = str(parent.get("stone_color") or "").strip()
    return v or project_color


def _ref_location(piece: Dict[str, Any]) -> Dict[str, str]:
    return {
        "building": str(piece.get("building") or "").strip(),
        "floor": str(piece.get("floor") or "").strip(),
        "flat": str(piece.get("flat") or "").strip(),
    }


def build_island_bundles_from_families(
    families: List[Dict[str, Any]],
    material: str,
    thickness: str,
    color: str,
) -> List[Dict[str, Any]]:
    """
    One PartBundle per island family (from build_families).
    Parent = first main piece; remaining mains (e.g. waterfall) + splashes = children.
    """
    bundles: List[Dict[str, Any]] = []
    for fam in families:
        if fam.get("category") != "island":
            continue
        mains: List[Dict[str, Any]] = list(fam.get("main_pieces") or [])
        splashes: List[Dict[str, Any]] = list(fam.get("splash_pieces") or [])
        if not mains:
            continue
        parent = mains[0]
        children = mains[1:] + splashes
        all_pieces = [parent] + children
        wt = sum(piece_weight(p, material, thickness, color) for p in all_pieces)
        loc = _ref_location(parent)
        bundles.append({
            "bundle_id": f"island-{fam.get('family_id', 'x')}-{parent.get('id')}",
            "category": "island",
            "parent": parent,
            "children": children,
            "main_pieces": mains,
            "splash_pieces": splashes,
            "all_pieces": all_pieces,
            "all_piece_ids": [p["id"] for p in all_pieces],
            "flat_key": flat_key(parent),
            "building": loc["building"],
            "floor": loc["floor"],
            "flat": loc["flat"],
            "family_id": fam.get("family_id"),
            "material_batch_key": _material_batch_key(parent, color),
            "total_weight_kg": round(wt, 1),
        })
    return bundles


def build_horizontal_bundles_from_families(
    families: List[Dict[str, Any]],
    category: str,
    material: str,
    thickness: str,
    color: str,
) -> List[Dict[str, Any]]:
    """Perimeter / range / vanity PartBundles — same parent + children model as islands."""
    bundles: List[Dict[str, Any]] = []
    for fam in families:
        if fam.get("category") != category:
            continue
        mains: List[Dict[str, Any]] = list(fam.get("main_pieces") or [])
        splashes: List[Dict[str, Any]] = list(fam.get("splash_pieces") or [])
        if not mains:
            if not splashes:
                continue
            parent = splashes[0]
            children = splashes[1:]
            all_pieces = list(splashes)
            wt = sum(piece_weight(p, material, thickness, color) for p in all_pieces)
            loc = _ref_location(parent)
            bundles.append({
                "bundle_id": f"{category}-{fam.get('family_id', 'x')}-splash-{parent.get('id')}",
                "category": category,
                "parent": parent,
                "children": children,
                "main_pieces": [],
                "splash_pieces": splashes,
                "all_pieces": all_pieces,
                "all_piece_ids": [p["id"] for p in all_pieces],
                "flat_key": flat_key(parent),
                "building": loc["building"],
                "floor": loc["floor"],
                "flat": loc["flat"],
                "family_id": fam.get("family_id"),
                "material_batch_key": _material_batch_key(parent, color),
                "total_weight_kg": round(wt, 1),
            })
            continue
        parent = mains[0]
        children = mains[1:] + splashes
        all_pieces = [parent] + children
        wt = sum(piece_weight(p, material, thickness, color) for p in all_pieces)
        loc = _ref_location(parent)
        bundles.append({
            "bundle_id": f"{category}-{fam.get('family_id', 'x')}-{parent.get('id')}",
            "category": category,
            "parent": parent,
            "children": children,
            "main_pieces": mains,
            "splash_pieces": splashes,
            "all_pieces": all_pieces,
            "all_piece_ids": [p["id"] for p in all_pieces],
            "flat_key": flat_key(parent),
            "building": loc["building"],
            "floor": loc["floor"],
            "flat": loc["flat"],
            "family_id": fam.get("family_id"),
            "material_batch_key": _material_batch_key(parent, color),
            "total_weight_kg": round(wt, 1),
        })
    return bundles


def horizontal_bundle_whole_units(
    bundle: Dict[str, Any],
    category: str,
    material: str,
    thickness: str,
    color: str,
) -> List[Dict[str, Any]]:
    """
    One operational packing unit per PartBundle — preserves family integrity (no weight-driven splitting).
    Over-max-weight bundles are still emitted as a single crate downstream with an overweight warning.
    """
    mains = list(bundle.get("main_pieces") or [])
    splashes = list(bundle.get("splash_pieces") or [])
    splash_layers = _chunk_splashes(splashes)
    return [
        {
            "mains": mains,
            "splash_layers": splash_layers,
            "family_category": category,
            "bundle_id": bundle.get("bundle_id"),
        }
    ]


def horizontal_bundle_to_units(
    bundle: Dict[str, Any],
    category: str,
    material: str,
    thickness: str,
    color: str,
    max_unit_kg: float,
) -> List[Dict[str, Any]]:
    """
    Split heavy bundles into horizontal units (Layer 1 mains, Layer 2+ splashes), splashes on final chunk only.
    """
    from ..planning_engine import piece_weight

    mains = list(bundle.get("main_pieces") or [])
    splashes = list(bundle.get("splash_pieces") or [])
    splash_layers = _chunk_splashes(splashes)
    wt = sum(piece_weight(p, material, thickness, color) for p in mains + splashes)

    units: List[Dict[str, Any]] = []
    if wt <= max_unit_kg:
        units.append({
            "mains": mains,
            "splash_layers": splash_layers,
            "family_category": category,
            "bundle_id": bundle.get("bundle_id"),
        })
        return units

    if not mains:
        remaining_sp = list(splashes)
        while remaining_sp:
            chunk_sp: List[Dict[str, Any]] = []
            chunk_wt = 0.0
            while remaining_sp:
                p = remaining_sp[0]
                pw = piece_weight(p, material, thickness, color)
                if chunk_sp and chunk_wt + pw > max_unit_kg:
                    break
                chunk_sp.append(remaining_sp.pop(0))
                chunk_wt += pw
            chunk_layers = _chunk_splashes(chunk_sp)
            units.append({
                "mains": [],
                "splash_layers": chunk_layers,
                "family_category": category,
                "bundle_id": bundle.get("bundle_id"),
            })
        return units

    remaining = list(mains)
    while remaining:
        chunk_mains: List[Dict[str, Any]] = []
        chunk_wt = 0.0
        while remaining:
            p = remaining[0]
            pw = piece_weight(p, material, thickness, color)
            if chunk_mains and chunk_wt + pw > max_unit_kg:
                break
            chunk_mains.append(remaining.pop(0))
            chunk_wt += pw
        attach_layers = splash_layers if not remaining else []
        units.append({
            "mains": chunk_mains,
            "splash_layers": attach_layers,
            "family_category": category,
            "bundle_id": bundle.get("bundle_id"),
        })
    return units


def island_bundle_adjacency_sort_key(b: Dict[str, Any]) -> tuple:
    """Preference: same flat grouping first, then floor, then building."""
    return (
        b.get("building") or "",
        b.get("floor") or "",
        b.get("flat") or "",
        b.get("flat_key") or "",
        b.get("bundle_id") or "",
    )
