from typing import Any, Dict, List


def enrich_layout_with_crates(layout: Dict[str, Any], crate_docs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Attach stable crate_id and dimensions to each placement for UI / 3D."""
    by_idx = {i: d for i, d in enumerate(crate_docs)}
    enriched: List[Dict[str, Any]] = []
    for pl in layout.get("placements", []):
        idx = int(pl.get("crate_index", -1))
        doc = by_idx.get(idx)
        if not doc:
            continue
        layers = doc.get("planner_v3_splash_layers") or []
        enriched.append(
            {
                **pl,
                "crate_id": doc["crate_id"],
                "crate_name": doc.get("name"),
                "crate_class": doc.get("planner_v3_crate_class"),
                "orientation": doc.get("planner_v3_orientation"),
                "weight_kg": round(float(doc.get("weight", 0) or 0), 1),
                "splash_layer_count": len(layers),
                "external_length": float(doc.get("external_length", 0) or 0),
                "external_width": float(doc.get("external_width", 0) or 0),
                "external_height": float(doc.get("external_height", 0) or 0),
            }
        )
    return {**layout, "placements": enriched}
