from copy import deepcopy
from datetime import date, datetime
from io import BytesIO
import os
from typing import Any, Dict, List, Optional

import certifi
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pymongo import MongoClient, ReturnDocument
from pydantic import BaseModel
from .services.container_planner import build_container_plan
from .services.planning_engine import (
    build_planning_snapshot,
    estimate_auto_dimensions,
    piece_destination_key,
    piece_weight as planning_piece_weight,
    weight_factor as planning_weight_factor,
)

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb+srv://virgin_db_user:iddh38iXtoKpt1We@cluster0.t9reftj.mongodb.net/?appName=Cluster0")
MONGODB_DB = os.getenv("MONGODB_DB", "virgin")
ALLOW_MEMORY_FALLBACK = os.getenv("ALLOW_MEMORY_FALLBACK", "false").lower() in {"1", "true", "yes"}

class InMemoryCollection:
    def __init__(self):
        self.docs = []
        self.indexes = []

    def create_index(self, *args, **kwargs):
        self.indexes.append((args, kwargs))

    def _matches(self, doc, query):
        for key, value in (query or {}).items():
            if isinstance(value, dict) and "$in" in value:
                if doc.get(key) not in value["$in"]:
                    return False
            elif doc.get(key) != value:
                return False
        return True

    def _project(self, doc, projection):
        if not projection:
            return deepcopy(doc)
        if isinstance(projection, dict):
            include = {k for k, v in projection.items() if v and k != "_id"}
            if include:
                return {k: deepcopy(doc[k]) for k in include if k in doc}
            return deepcopy(doc)
        return deepcopy(doc)

    def insert_one(self, doc):
        self.docs.append(deepcopy(doc))
        return doc

    def insert_many(self, docs):
        for doc in docs:
            self.insert_one(doc)

    def find(self, query=None, projection=None):
        return [self._project(doc, projection) for doc in self.docs if self._matches(doc, query)]

    def find_one(self, query=None, projection=None, sort=None):
        docs = self.find(query, projection)
        if sort:
            key, direction = sort[0]
            docs = sorted(docs, key=lambda d: d.get(key), reverse=direction < 0)
        return docs[0] if docs else None

    def update_one(self, query, update):
        for doc in self.docs:
            if self._matches(doc, query):
                if "$set" in update:
                    doc.update(deepcopy(update["$set"]))
                return

    def delete_one(self, query):
        for idx, doc in enumerate(self.docs):
            if self._matches(doc, query):
                self.docs.pop(idx)
                return

    def delete_many(self, query):
        self.docs = [doc for doc in self.docs if not self._matches(doc, query)]

    def find_one_and_update(self, query, update, upsert=False, return_document=None):
        doc = self.find_one(query)
        if doc is None and upsert:
            doc = {"_id": query.get("_id")}
            self.docs.append(doc)
        if doc is None:
            return None
        target = next((item for item in self.docs if self._matches(item, query)), None)
        if target is None:
            return None
        if "$inc" in update:
            for key, value in update["$inc"].items():
                target[key] = target.get(key, 0) + value
        return deepcopy(target)


def build_store():
    try:
        if not MONGODB_URI:
            raise ValueError("MONGODB_URI environment variable is missing.")

        mongo_client = MongoClient(
            MONGODB_URI,
            serverSelectionTimeoutMS=1500,
            tlsCAFile=certifi.where(),
        )
        mongo_client.admin.command("ping")
        print(f"Connected to Production MongoDB: {MONGODB_URI.split('@')[-1] if '@' in MONGODB_URI else 'Remote Host'}")
        mongo_db = mongo_client[MONGODB_DB]
        store = {
            "projects": mongo_db["projects"],
            "pieces": mongo_db["pieces"],
            "crates": mongo_db["crates"],
            "assignments": mongo_db["assignments"],
            "counters": mongo_db["counters"],
        }
        return store, "mongo"
    except Exception as e:
        print(f"Production Database Connection Failed: {e}")
        if not ALLOW_MEMORY_FALLBACK:
            raise
        return {
            "projects": InMemoryCollection(),
            "pieces": InMemoryCollection(),
            "crates": InMemoryCollection(),
            "assignments": InMemoryCollection(),
            "counters": InMemoryCollection(),
        }, "memory"


store, STORE_MODE = build_store()
projects_col = store["projects"]
pieces_col = store["pieces"]
crates_col = store["crates"]
assignments_col = store["assignments"]
counters_col = store["counters"]


def ensure_indexes() -> None:
    if not hasattr(projects_col, "create_index"):
        return

    projects_col.create_index("id")
    pieces_col.create_index("id")
    pieces_col.create_index([("project_id", 1), ("id", 1)])
    crates_col.create_index("id")
    crates_col.create_index([("project_id", 1), ("id", 1)])
    assignments_col.create_index("id")
    assignments_col.create_index([("project_id", 1), ("piece_id", 1)])
    assignments_col.create_index([("project_id", 1), ("crate_id", 1)])


ensure_indexes()


def next_sequence(name: str) -> int:
    counter = counters_col.find_one_and_update(
        {"_id": name},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int(counter["seq"])


def utc_now() -> datetime:
    return datetime.utcnow()


def as_iso(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def project_response(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not doc:
        return None
    return {
        "id": doc["id"],
        "name": doc.get("name", ""),
        "customer": doc.get("customer", ""),
        "job_number": doc.get("job_number", ""),
        "material": doc.get("material", "Granite"),
        "thickness": doc.get("thickness", "3CM"),
        "crate_wood_type": doc.get("crate_wood_type", "Pine"),
        "crate_wood_thickness": doc.get("crate_wood_thickness", 1.25),
        "preferred_container_mode": doc.get("preferred_container_mode", "recommended"),
        "date": doc.get("date", date.today().isoformat()),
        "created_at": as_iso(doc.get("created_at")),
        "updated_at": as_iso(doc.get("updated_at")),
    }


def piece_response(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": doc["id"],
        "project_id": doc["project_id"],
        "part": doc.get("part", ""),
        "category": doc.get("category", ""),
        "drawing": doc.get("drawing", ""),
        "length": doc.get("length", 0.0),
        "width": doc.get("width", 0.0),
        "qty": doc.get("qty", 1),
        "unit": doc.get("unit", ""),
        "edge": doc.get("edge", ""),
        "edge_area": doc.get("edge_area", ""),
        "edge_polish_machine": doc.get("edge_polish_machine", 0.0),
        "radius": doc.get("radius", "-"),
        "sink_type": doc.get("sink_type", "No Sink"),
        "sink_cut": doc.get("sink_cut", "-"),
        "tap_holes": doc.get("tap_holes", "-"),
        "grooves": doc.get("grooves", "-"),
        "fragility": doc.get("fragility", "Standard"),
        "orientation": doc.get("orientation", "Auto"),
        "delivery_priority": doc.get("delivery_priority", "Standard"),
        "stack_preference": doc.get("stack_preference", "Auto"),
        "weight_override": doc.get("weight_override", 0.0),
        "notes": doc.get("notes", ""),
        "building": doc.get("building", ""),
        "floor": doc.get("floor", ""),
        "flat": doc.get("flat", ""),
        "created_at": as_iso(doc.get("created_at")),
    }


def crate_response(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": doc["id"],
        "project_id": doc["project_id"],
        "crate_id": doc.get("crate_id", ""),
        "name": doc.get("name", ""),
        "max_weight": doc.get("max_weight", 1000.0),
        "internal_length": doc.get("internal_length", 0.0),
        "internal_width": doc.get("internal_width", 0.0),
        "internal_height": doc.get("internal_height", 0.0),
        "external_length": doc.get("external_length", 0.0),
        "external_width": doc.get("external_width", 0.0),
        "external_height": doc.get("external_height", 0.0),
        "sqft": doc.get("sqft", 0.0),
        "weight": doc.get("weight", 0.0),
        "created_at": as_iso(doc.get("created_at")),
    }


def assignment_response(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": doc["id"],
        "project_id": doc["project_id"],
        "piece_id": doc["piece_id"],
        "crate_id": doc["crate_id"],
        "assigned_at": as_iso(doc.get("assigned_at")),
    }


def pieces_grouped_by_crate(pieces: List[Dict[str, Any]], assignments: List[Dict[str, Any]]) -> Dict[int, List[Dict[str, Any]]]:
    pieces_by_id = {piece["id"]: piece for piece in pieces}
    grouped: Dict[int, List[Dict[str, Any]]] = {}
    for assignment in assignments:
        piece = pieces_by_id.get(assignment.get("piece_id"))
        crate_id = assignment.get("crate_id")
        if piece is None or crate_id is None:
            continue
        grouped.setdefault(crate_id, []).append(piece)
    for crate_pieces in grouped.values():
        crate_pieces.sort(key=lambda item: item["id"])
    return grouped


def project_planning_snapshot(project_id: int) -> Dict[str, Any]:
    project = projects_col.find_one({"id": project_id}, {"_id": 0})
    pieces = sorted(pieces_col.find({"project_id": project_id}, {"_id": 0}), key=lambda doc: doc["id"])
    crates = sorted(crates_col.find({"project_id": project_id}, {"_id": 0}), key=lambda doc: doc["id"])
    assignments = list(assignments_col.find({"project_id": project_id}, {"_id": 0}))
    return build_planning_snapshot(project, pieces, crates, assignments)


def clear_manual_container_plan(project_id: int) -> None:
    projects_col.update_one({"id": project_id}, {"$set": {"manual_container_plan": None}})


def weight_factor(material: str, thickness: str) -> float:
    factors = {
        "Granite": {"2CM": 5.5, "3CM": 7.5, "Mixed": 6.5},
        "Quartz": {"2CM": 4.75, "3CM": 6.75, "Mixed": 5.75},
        "Marble": {"2CM": 6.0, "3CM": 8.0, "Mixed": 7.0},
        "Other": {"2CM": 5.5, "3CM": 7.5, "Mixed": 6.5},
    }
    return factors.get(material, factors["Other"]).get(thickness, 6.5)


def calculate_edge_polish_machine(length: float, width: float, edge_area: str) -> float:
    try:
        l = float(length)
        w = float(width)
    except (TypeError, ValueError):
        return 0.0

    if l <= 0 or w <= 0 or not edge_area:
        return 0.0

    perimeter = 2 * (l + w)
    if edge_area in {"4 Sides", "Perimeter"}:
        return perimeter
    if edge_area == "3 Sides":
        return 2 * max(l, w) + min(l, w)
    if edge_area == "2 Sides":
        return 2 * max(l, w)
    if edge_area == "1 Side":
        return max(l, w)
    return 0.0


def piece_weight(piece: Dict[str, Any], material: str, thickness: str) -> float:
    sqft = (float(piece.get("length", 0)) * float(piece.get("width", 0))) / 144.0
    return sqft * weight_factor(material, thickness) * int(piece.get("qty", 1))


def estimate_crate_dimensions(
    pieces: List[Dict[str, Any]],
    material: str,
    thickness: str,
    max_weight: float,
) -> Dict[str, Any]:
    if not pieces:
        return {
            "internal_length": 0.0,
            "internal_width": 0.0,
            "internal_height": 0.0,
            "external_length": 0.0,
            "external_width": 0.0,
            "external_height": 0.0,
            "sqft": 0.0,
            "weight": 0.0,
        }

    lengths = [float(piece.get("length", 0) or 0) for piece in pieces]
    widths = [float(piece.get("width", 0) or 0) for piece in pieces]
    total_sqft = sum(((float(piece.get("length", 0) or 0) * float(piece.get("width", 0) or 0)) / 144.0) * int(piece.get("qty", 1) or 1) for piece in pieces)
    total_weight = sum(piece_weight(piece, material, thickness) for piece in pieces)
    total_qty = sum(int(piece.get("qty", 1) or 1) for piece in pieces)

    longest_piece = max(lengths) if lengths else 0.0
    widest_piece = max(widths) if widths else 0.0

    # Internal sizing uses the largest piece plus handling clearance.
    clearance = 6.0
    internal_length = max(longest_piece + clearance, 0.0)
    internal_width = max(widest_piece + clearance, 0.0)

    # Height is a heuristic based on stack count and weight. Stone crates need
    # enough headroom for edge protectors, separators, and lifting access.
    height_from_qty = 18.0 + (total_qty * 1.25)
    height_from_weight = 18.0 + (total_weight / 75.0 if total_weight else 0.0)
    height_from_area = 18.0 + (total_sqft / 18.0 if total_sqft else 0.0)
    internal_height = max(24.0, height_from_qty, height_from_weight, height_from_area)
    internal_height = min(internal_height, 60.0)

    # External sizing adds crate walls, runners, and a little top/bottom slack.
    wall_allowance = 3.0
    height_allowance = 6.0
    external_length = internal_length + wall_allowance
    external_width = internal_width + wall_allowance
    external_height = internal_height + height_allowance

    return {
        "internal_length": round(internal_length, 1),
        "internal_width": round(internal_width, 1),
        "internal_height": round(internal_height, 1),
        "external_length": round(external_length, 1),
        "external_width": round(external_width, 1),
        "external_height": round(external_height, 1),
        "sqft": round(total_sqft, 2),
        "weight": round(total_weight, 2),
        "max_weight": max_weight,
    }


CRATE_TEMPLATES: Dict[str, Dict[str, Any]] = {
    "Vanity":   {"max_weight": 900,  "ideal_weight": (400, 750),  "max_pieces": 25, "label": "Vanity"},
    "Kitchen":  {"max_weight": 1200, "ideal_weight": (500, 1000), "max_pieces": 18, "label": "Kitchen"},
    "Island":   {"max_weight": 1500, "ideal_weight": (600, 1200), "max_pieces": 12, "label": "Island"},
    "Splashes": {"max_weight": 650,  "ideal_weight": (200, 500),  "max_pieces": 40, "label": "Side Tops / Splashes"},
    "Laundry":  {"max_weight": 900,  "ideal_weight": (400, 750),  "max_pieces": 25, "label": "Laundry"},
    "Utility":  {"max_weight": 1100, "ideal_weight": (400, 900),  "max_pieces": 20, "label": "Utility"},
    "Other":    {"max_weight": 1100, "ideal_weight": (400, 900),  "max_pieces": 20, "label": "Mixed / Other"},
}


def _get_template(category: str) -> Dict[str, Any]:
    return CRATE_TEMPLATES.get(category, CRATE_TEMPLATES["Other"])


def _piece_destination_key(piece: Dict[str, Any]) -> str:
    building = str(piece.get("building", "")).strip()
    floor = str(piece.get("floor", "")).strip()
    flat = str(piece.get("flat", "")).strip()
    parts = [p for p in [building, floor, flat] if p]
    return " / ".join(parts) if parts else ""


def _piece_flat_key(piece: Dict[str, Any]) -> str:
    building = str(piece.get("building", "")).strip()
    floor = str(piece.get("floor", "")).strip()
    flat = str(piece.get("flat", "")).strip()
    parts = [p for p in [building, floor, flat] if p]
    return " / ".join(parts) if parts else "No Location"


def _piece_floor_key(piece: Dict[str, Any]) -> str:
    building = str(piece.get("building", "")).strip()
    floor = str(piece.get("floor", "")).strip()
    parts = [p for p in [building, floor] if p]
    return " / ".join(parts) if parts else "No Location"


def _piece_building_key(piece: Dict[str, Any]) -> str:
    building = str(piece.get("building", "")).strip()
    return building if building else "No Location"


def _weight_band_status(total_weight: float, template: Dict[str, Any]) -> str:
    ideal_lo, ideal_hi = template["ideal_weight"]
    if ideal_lo <= total_weight <= ideal_hi:
        return "ideal"
    elif total_weight < ideal_lo:
        return "below_ideal"
    else:
        return "above_ideal"


def _distribute_pieces(
    pieces: List[Dict[str, Any]],
    max_weight: float,
    max_pieces: int,
    material: str,
    thickness: str,
) -> List[List[Dict[str, Any]]]:
    """Greedy bin-pack sorted by length desc then weight desc."""
    if not pieces:
        return []
    sorted_pieces = sorted(
        pieces,
        key=lambda p: (
            float(p.get("length", 0)),
            piece_weight(p, material, thickness),
        ),
        reverse=True,
    )
    crates: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    current_wt = 0.0
    for p in sorted_pieces:
        pw = piece_weight(p, material, thickness)
        if current and (len(current) >= max_pieces or current_wt + pw > max_weight):
            crates.append(current)
            current = [p]
            current_wt = pw
        else:
            current.append(p)
            current_wt += pw
    if current:
        crates.append(current)
    return crates


def _crate_weight(pieces: List[Dict[str, Any]], material: str, thickness: str) -> float:
    return sum(piece_weight(p, material, thickness) for p in pieces)


def _dominant_category(pieces: List[Dict[str, Any]]) -> str:
    counts: Dict[str, int] = {}
    for p in pieces:
        cat = p.get("category") or "Other"
        counts[cat] = counts.get(cat, 0) + 1
    return max(counts, key=counts.get) if counts else "Other"


# ─── Strategy 1: Category-Based ──────────────────────────────────────────────

def strategy_category_based(
    pieces: List[Dict[str, Any]],
    user_max_weight: float,
    material: str,
    thickness: str,
) -> List[Dict[str, Any]]:
    """Group by category, then sub-group by destination within each category."""
    # Primary grouping: by category
    by_category: Dict[str, List[Dict[str, Any]]] = {}
    for p in pieces:
        cat = p.get("category") or "Other"
        by_category.setdefault(cat, []).append(p)

    generated: List[Dict[str, Any]] = []
    serial = 1

    for category, cat_pieces in sorted(by_category.items()):
        template = _get_template(category)
        effective_max_weight = min(user_max_weight, template["max_weight"])
        effective_max_pieces = template["max_pieces"]

        # Secondary grouping: by destination within category
        by_dest: Dict[str, List[Dict[str, Any]]] = {}
        for p in cat_pieces:
            dest = _piece_destination_key(p) or category
            by_dest.setdefault(dest, []).append(p)

        for dest_name, dest_pieces in sorted(by_dest.items()):
            batches = _distribute_pieces(
                dest_pieces, effective_max_weight, effective_max_pieces, material, thickness
            )
            for batch in batches:
                total_wt = _crate_weight(batch, material, thickness)
                crate_name = f"{category} — {dest_name}" if dest_name != category else category
                generated.append({
                    "serial": serial,
                    "name": f"{crate_name}-{serial}",
                    "pieces": batch,
                    "max_weight": effective_max_weight,
                    "crate_type": template["label"],
                    "packing_mode": "category",
                    "primary_flat": "",
                    "secondary_flats": [],
                    "weight_band_status": _weight_band_status(total_wt, template),
                    "grouping_reason": f"Grouped by {category} category" + (
                        f", destination {dest_name}" if dest_name != category else ""
                    ),
                })
                serial += 1

    return generated


# ─── Strategy 2: Flat-Based ──────────────────────────────────────────────────

def strategy_flat_based(
    pieces: List[Dict[str, Any]],
    user_max_weight: float,
    material: str,
    thickness: str,
) -> List[Dict[str, Any]]:
    """Group by flat/apartment. Try single-crate-per-flat, split if needed, merge underfilled."""
    # Step 1: Group by flat
    by_flat: Dict[str, List[Dict[str, Any]]] = {}
    for p in pieces:
        key = _piece_flat_key(p)
        by_flat.setdefault(key, []).append(p)

    # Step 2+3: Try single crate per flat, split if exceeds
    raw_crates: List[Dict[str, Any]] = []
    for flat_key, flat_pieces in sorted(by_flat.items()):
        total_wt = _crate_weight(flat_pieces, material, thickness)
        if total_wt <= user_max_weight and len(flat_pieces) <= 30:
            # Fits in one crate
            dom_cat = _dominant_category(flat_pieces)
            template = _get_template(dom_cat)
            raw_crates.append({
                "pieces": flat_pieces,
                "primary_flat": flat_key,
                "secondary_flats": [],
                "crate_type": template["label"],
                "weight": total_wt,
                "max_weight": user_max_weight,
                "grouping_reason": f"All parts for {flat_key}",
                "floor_key": _piece_floor_key(flat_pieces[0]),
                "building_key": _piece_building_key(flat_pieces[0]),
                "weight_band_status": _weight_band_status(total_wt, template),
            })
        else:
            # Split by category within flat
            by_cat: Dict[str, List[Dict[str, Any]]] = {}
            for p in flat_pieces:
                cat = p.get("category") or "Other"
                by_cat.setdefault(cat, []).append(p)

            for cat, cat_pieces in sorted(by_cat.items()):
                template = _get_template(cat)
                eff_max = min(user_max_weight, template["max_weight"])
                batches = _distribute_pieces(cat_pieces, eff_max, template["max_pieces"], material, thickness)
                for batch in batches:
                    wt = _crate_weight(batch, material, thickness)
                    raw_crates.append({
                        "pieces": batch,
                        "primary_flat": flat_key,
                        "secondary_flats": [],
                        "crate_type": template["label"],
                        "weight": wt,
                        "max_weight": eff_max,
                        "grouping_reason": f"{cat} parts for {flat_key} (split due to weight/size)",
                        "floor_key": _piece_floor_key(batch[0]),
                        "building_key": _piece_building_key(batch[0]),
                        "weight_band_status": _weight_band_status(wt, template),
                    })

    # Step 4: Merge underfilled crates with nearby flats
    underfill_threshold = user_max_weight * 0.40
    merged_flags = [False] * len(raw_crates)

    for i, crate in enumerate(raw_crates):
        if merged_flags[i] or crate["weight"] >= underfill_threshold:
            continue
        # Try to merge with nearby crate
        best_j = None
        best_priority = 999
        for j, other in enumerate(raw_crates):
            if i == j or merged_flags[j]:
                continue
            combined_wt = crate["weight"] + other["weight"]
            combined_count = len(crate["pieces"]) + len(other["pieces"])
            if combined_wt > user_max_weight or combined_count > 30:
                continue
            # Priority: same floor > same building > different
            if crate["floor_key"] == other["floor_key"] and crate["floor_key"] != "No Location":
                priority = 1
            elif crate["building_key"] == other["building_key"] and crate["building_key"] != "No Location":
                priority = 2
            else:
                continue  # Don't merge across buildings
            if priority < best_priority or (priority == best_priority and other["weight"] < crate["weight"]):
                best_j = j
                best_priority = priority

        if best_j is not None:
            other = raw_crates[best_j]
            crate["pieces"] = crate["pieces"] + other["pieces"]
            crate["weight"] = crate["weight"] + other["weight"]
            if other["primary_flat"] and other["primary_flat"] != crate["primary_flat"]:
                crate["secondary_flats"] = list(set(
                    crate["secondary_flats"] + [other["primary_flat"]] + other["secondary_flats"]
                ))
            dom_cat = _dominant_category(crate["pieces"])
            template = _get_template(dom_cat)
            crate["crate_type"] = template["label"]
            crate["weight_band_status"] = _weight_band_status(crate["weight"], template)
            merge_label = f" + {other['primary_flat']}" if other["primary_flat"] != crate["primary_flat"] else ""
            crate["grouping_reason"] = f"Merged: {crate['primary_flat']}{merge_label} (underfilled crates combined)"
            merged_flags[best_j] = True

    # Build final output
    generated: List[Dict[str, Any]] = []
    serial = 1
    for i, crate in enumerate(raw_crates):
        if merged_flags[i]:
            continue
        flat_label = crate["primary_flat"]
        if crate["secondary_flats"]:
            flat_label += " + " + ", ".join(crate["secondary_flats"][:2])
            if len(crate["secondary_flats"]) > 2:
                flat_label += f" +{len(crate['secondary_flats']) - 2} more"
        generated.append({
            "serial": serial,
            "name": f"{flat_label}-{serial}",
            "pieces": crate["pieces"],
            "max_weight": crate["max_weight"],
            "crate_type": crate["crate_type"],
            "packing_mode": "flat",
            "primary_flat": crate["primary_flat"],
            "secondary_flats": crate["secondary_flats"],
            "weight_band_status": crate["weight_band_status"],
            "grouping_reason": crate["grouping_reason"],
        })
        serial += 1

    return generated


# ─── Orchestrator ─────────────────────────────────────────────────────────────

def auto_generate_crates(
    pieces: List[Dict[str, Any]],
    strategy: str,
    max_pieces: Optional[int],
    max_weight: Optional[float],
    material: str,
    thickness: str,
) -> List[Dict[str, Any]]:
    if not pieces:
        return []

    effective_max_weight = max_weight if max_weight and max_weight > 0 else 1000.0

    if strategy == "flat":
        return strategy_flat_based(pieces, effective_max_weight, material, thickness)
    else:
        # "category", "smart", "type", or any other value → category-based
        return strategy_category_based(pieces, effective_max_weight, material, thickness)


def crate_group_name(crate_name: str) -> str:
    if "-" not in crate_name:
        return crate_name
    return crate_name.rsplit("-", 1)[0]


def container_plan(
    total_weight: float,
    crate_count: int,
    average_utilization: float,
    distinct_families: int,
    distinct_destinations: int,
    underfilled_count: int,
) -> Dict[str, Any]:
    # Conservative payload guidance based on common dry-container specs from
    # Hapag-Lloyd and Maersk:
    # - 20ft dry: ~28.1t payload, ~33cbm
    # - 40ft dry: ~28.7t payload, ~67cbm
    # For stone, volume/handling usually pushes us to 40ft earlier than payload does.
    container_specs = {
        "20ft": {"payload_kg": 28130, "cbm": 33.2},
        "40ft": {"payload_kg": 28750, "cbm": 67.7},
    }

    if total_weight > container_specs["40ft"]["payload_kg"]:
        return {
            "recommended": "multiple",
            "booking_action": "Split into 2 containers",
            "reason": "This load is over a single standard dry container payload, so it should be split into multiple containers or multiple deliveries.",
            "alternatives": [
                f"20ft dry: up to {container_specs['20ft']['payload_kg']:,} kg and about {container_specs['20ft']['cbm']:.1f} cbm",
                f"40ft dry: up to {container_specs['40ft']['payload_kg']:,} kg and about {container_specs['40ft']['cbm']:.1f} cbm",
            ],
            "next_step": "Split by destination or by load sequence before choosing a carrier booking.",
        }

    if underfilled_count >= max(3, crate_count // 3) and total_weight <= 15000:
        return {
            "recommended": "consolidate",
            "booking_action": "Hold for consolidation",
            "reason": "Several crates are underfilled. Before booking a container, consolidate small crates so you avoid shipping air.",
            "alternatives": [
                "Merge low-fill crates that share the same family or destination.",
                f"20ft dry: up to {container_specs['20ft']['payload_kg']:,} kg and about {container_specs['20ft']['cbm']:.1f} cbm",
                f"40ft dry: up to {container_specs['40ft']['payload_kg']:,} kg and about {container_specs['40ft']['cbm']:.1f} cbm",
            ],
            "next_step": "Repack to raise crate fill to roughly 85-95% before picking the container.",
        }

    if total_weight <= 9000 and crate_count <= 8 and average_utilization >= 88 and distinct_families <= 3:
        recommended = "20ft"
        booking_action = "Book 1 x 20ft"
        reason = (
            "This looks like a compact, well-filled export load. A 20ft dry container is usually the better economical choice "
            "when the crate count is modest and the total weight stays comfortably below payload limits."
        )
    elif total_weight <= 12000 and crate_count <= 14 and distinct_families <= 4 and distinct_destinations <= 6:
        recommended = "40ft"
        booking_action = "Book 1 x 40ft"
        reason = (
            "This is a typical mixed countertop / sill export job. A 40ft dry container is usually the safer choice because "
            "it gives more floor length and less stacking pressure, even though the payload could fit in a 20ft."
        )
    elif total_weight <= 18000:
        recommended = "40ft"
        booking_action = "Book 1 x 40ft"
        reason = (
            "This is a mid-size countertop load. A 40ft dry container gives better floor space for mixed apartment drops, "
            "window sills, and crate staging, even though a 20ft could still handle the weight."
        )
    else:
        recommended = "40ft"
        booking_action = "Book 1 x 40ft"
        reason = (
            "This is a heavy single-container candidate. A 40ft dry container is the safer default for stone because it gives "
            "more loading flexibility and breathing room for padding, blocking, and access."
        )

    return {
        "recommended": recommended,
        "booking_action": booking_action,
        "reason": reason,
        "alternatives": [
            f"20ft dry: up to {container_specs['20ft']['payload_kg']:,} kg and about {container_specs['20ft']['cbm']:.1f} cbm",
            f"40ft dry: up to {container_specs['40ft']['payload_kg']:,} kg and about {container_specs['40ft']['cbm']:.1f} cbm",
        ],
        "next_step": "Keep the crate mix tight and avoid leaving 20-30% empty space in too many crates.",
    }


def crate_insights(project_id: int) -> Dict[str, Any]:
    snapshot = project_planning_snapshot(project_id)
    crate_rows = snapshot["crate_rows"]
    loading_plan = build_container_plan(
        crate_rows,
        manual_plan=snapshot["project"].get("manual_container_plan"),
        preferred_mode=snapshot["project"].get("preferred_container_mode"),
    )

    exception_rows = list(snapshot["exception_rows"])
    for container in loading_plan["containers"]:
        for warning in container.get("warnings", []):
            exception_rows.append(
                {
                    "scope": "container",
                    "id": container["id"],
                    "name": container["type"],
                    "severity": "yellow",
                    "message": warning,
                }
            )

    recommended_target = 92 if any(crate["efficiency_status"] == "red" for crate in crate_rows) else 97

    return {
        "summary": {
            "crates_created": len(crate_rows),
            "shipment_weight": snapshot["total_gross_weight"],
            "net_stone_weight": snapshot["total_weight"],
            "recommended_containers": loading_plan["recommendation"]["booking_action"],
            "container_mode": loading_plan["recommendation"]["mode_label"],
            "cost_index": loading_plan["recommendation"].get("cost_index", 0.0),
        },
        "total_weight": snapshot["total_weight"],
        "shipment_weight": snapshot["total_gross_weight"],
        "crate_count": len(crate_rows),
        "average_utilization": snapshot["average_fill_percent"],
        "average_weight_utilization": snapshot["average_gross_utilization"],
        "recommended_utilization_target": recommended_target,
        "adjusted_target_weight": round(
            snapshot["total_gross_weight"] / len(crate_rows), 0
        ) if crate_rows else 0,
        "distinct_families": snapshot["family_count"],
        "distinct_destinations": snapshot["destination_count"],
        "efficiency_kpis": {
            "average_fill_percent": snapshot["average_fill_percent"],
            "average_weight_utilization": snapshot["average_gross_utilization"],
            "average_payload_utilization": snapshot["average_payload_utilization"],
            "total_sqft": snapshot["total_sqft"],
            "piece_count": snapshot["piece_count"],
            "item_count": snapshot["item_count"],
        },
        "container_plan": loading_plan["recommendation"],
        "container_options": loading_plan["options"],
        "container_loading_plan": loading_plan,
        "crates": crate_rows,
        "underfilled_crates": snapshot["underfilled_crates"],
        "exceptions": exception_rows,
    }


class PieceCreate(BaseModel):
    part: str
    category: str
    drawing: str = ""
    length: float
    width: float
    qty: int = 1
    unit: str = ""
    building: str = ""
    floor: str = ""
    flat: str = ""
    sink_type: str = "No Sink"
    sink_cut: str = "-"
    tap_holes: str = "-"
    grooves: str = "-"
    fragility: str = "Standard"
    orientation: str = "Auto"
    delivery_priority: str = "Standard"
    stack_preference: str = "Auto"
    weight_override: float = 0.0
    edge: str = "None"
    edge_area: str = ""
    edge_polish_machine: float = 0.0
    radius: str = "-"
    notes: str = ""


class PieceUpdate(BaseModel):
    part: str = ""
    category: str = ""
    drawing: str = ""
    length: float = 0.0
    width: float = 0.0
    qty: int = 1
    unit: str = ""
    building: str = ""
    floor: str = ""
    flat: str = ""
    sink_type: str = "No Sink"
    sink_cut: str = "-"
    tap_holes: str = "-"
    grooves: str = "-"
    fragility: str = "Standard"
    orientation: str = "Auto"
    delivery_priority: str = "Standard"
    stack_preference: str = "Auto"
    weight_override: float = 0.0
    edge: str = "None"
    edge_area: str = ""
    edge_polish_machine: float = 0.0
    radius: str = "-"
    notes: str = ""


class ProjectUpdate(BaseModel):
    name: str
    material: str
    thickness: str
    crate_wood_type: str = "Pine"
    crate_wood_thickness: float = 1.25
    preferred_container_mode: str = "recommended"
    customer: str
    job_number: str
    date: str


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://stonedesk-wwrc.vercel.app",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"status": "online", "message": "StoneDesk API is running"}


@app.get("/api/projects/")
def get_projects():
    projects = sorted(projects_col.find({}, {"_id": 0}), key=lambda doc: doc["id"])
    return [project_response(p) for p in projects]


@app.post("/api/projects/")
def create_project():
    project_id = next_sequence("project")
    now = utc_now()
    doc = {
        "id": project_id,
        "name": "",
        "material": "Granite",
        "thickness": "3CM",
        "crate_wood_type": "Pine",
        "crate_wood_thickness": 1.25,
        "preferred_container_mode": "recommended",
        "customer": "",
        "job_number": "",
        "date": date.today().isoformat(),
        "created_at": now,
        "updated_at": now,
    }
    projects_col.insert_one(doc)
    return project_response(doc)


@app.get("/api/projects/{project_id}")
def get_project(project_id: int):
    project = projects_col.find_one({"id": project_id}, {"_id": 0})
    return project_response(project)


@app.put("/api/projects/{project_id}")
def update_project(project_id: int, data: ProjectUpdate):
    update = {
        "name": data.name,
        "material": data.material,
        "thickness": data.thickness,
        "crate_wood_type": data.crate_wood_type,
        "crate_wood_thickness": data.crate_wood_thickness,
        "preferred_container_mode": data.preferred_container_mode,
        "customer": data.customer,
        "job_number": data.job_number,
        "date": data.date,
        "updated_at": utc_now(),
    }
    projects_col.update_one({"id": project_id}, {"$set": update})
    clear_manual_container_plan(project_id)
    return {"message": "ok"}


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: int):
    pieces = list(pieces_col.find({"project_id": project_id}, {"id": 1}))
    piece_ids = [piece["id"] for piece in pieces]
    crates = list(crates_col.find({"project_id": project_id}, {"id": 1}))
    crate_ids = [crate["id"] for crate in crates]

    if piece_ids:
        assignments_col.delete_many({"project_id": project_id, "piece_id": {"$in": piece_ids}})
    if crate_ids:
        assignments_col.delete_many({"project_id": project_id, "crate_id": {"$in": crate_ids}})

    pieces_col.delete_many({"project_id": project_id})
    crates_col.delete_many({"project_id": project_id})
    projects_col.delete_one({"id": project_id})
    return {"message": "ok"}


@app.get("/api/projects/{project_id}/pieces/")
def get_pieces(project_id: int):
    pieces = sorted(pieces_col.find({"project_id": project_id}, {"_id": 0}), key=lambda doc: doc["id"])
    return [piece_response(piece) for piece in pieces]


@app.post("/api/projects/{project_id}/pieces/")
def create_piece(project_id: int, piece: PieceCreate):
    piece_id = next_sequence("piece")
    edge_polish_machine = piece.edge_polish_machine or calculate_edge_polish_machine(piece.length, piece.width, piece.edge_area)
    doc = {
        "id": piece_id,
        "project_id": project_id,
        "part": piece.part,
        "category": piece.category,
        "drawing": piece.drawing,
        "length": piece.length,
        "width": piece.width,
        "qty": piece.qty,
        "unit": piece.unit,
        "building": piece.building,
        "floor": piece.floor,
        "flat": piece.flat,
        "sink_type": piece.sink_type,
        "sink_cut": piece.sink_cut,
        "tap_holes": piece.tap_holes,
        "grooves": piece.grooves,
        "fragility": piece.fragility,
        "orientation": piece.orientation,
        "delivery_priority": piece.delivery_priority,
        "stack_preference": piece.stack_preference,
        "weight_override": piece.weight_override,
        "edge": piece.edge,
        "edge_area": piece.edge_area,
        "edge_polish_machine": edge_polish_machine,
        "radius": piece.radius,
        "notes": piece.notes,
        "created_at": utc_now(),
    }
    pieces_col.insert_one(doc)
    clear_manual_container_plan(project_id)
    return piece_response(doc)


@app.post("/api/projects/{project_id}/pieces/batch")
def create_pieces_batch(project_id: int, pieces_data: List[PieceCreate]):
    docs = []
    for piece in pieces_data:
        piece_id = next_sequence("piece")
        edge_polish_machine = piece.edge_polish_machine or calculate_edge_polish_machine(piece.length, piece.width, piece.edge_area)
        docs.append(
            {
                "id": piece_id,
                "project_id": project_id,
                "part": piece.part,
                "category": piece.category,
                "drawing": piece.drawing,
                "length": piece.length,
                "width": piece.width,
                "qty": piece.qty,
                "unit": piece.unit,
                "building": piece.building,
                "floor": piece.floor,
                "flat": piece.flat,
                "sink_type": piece.sink_type,
                "sink_cut": piece.sink_cut,
                "tap_holes": piece.tap_holes,
                "grooves": piece.grooves,
                "fragility": piece.fragility,
                "orientation": piece.orientation,
                "delivery_priority": piece.delivery_priority,
                "stack_preference": piece.stack_preference,
                "weight_override": piece.weight_override,
                "edge": piece.edge,
                "edge_area": piece.edge_area,
                "edge_polish_machine": edge_polish_machine,
                "radius": piece.radius,
                "notes": piece.notes,
                "created_at": utc_now(),
            }
        )
    if docs:
        pieces_col.insert_many(docs)
        clear_manual_container_plan(project_id)
    return {"message": f"Created {len(docs)} pieces"}


@app.delete("/api/projects/{project_id}/pieces/")
def delete_all_pieces(project_id: int):
    pieces = list(pieces_col.find({"project_id": project_id}, {"id": 1}))
    piece_ids = [piece["id"] for piece in pieces]
    if piece_ids:
        assignments_col.delete_many({"project_id": project_id, "piece_id": {"$in": piece_ids}})
    pieces_col.delete_many({"project_id": project_id})
    clear_manual_container_plan(project_id)
    return {"message": "ok"}


@app.delete("/api/pieces/{piece_id}")
def delete_piece(piece_id: int):
    piece = pieces_col.find_one({"id": piece_id}, {"project_id": 1})
    if piece:
        assignments_col.delete_many({"project_id": piece["project_id"], "piece_id": piece_id})
        clear_manual_container_plan(piece["project_id"])
    pieces_col.delete_one({"id": piece_id})
    return {"message": "ok"}


@app.put("/api/pieces/{piece_id}")
def update_piece(piece_id: int, piece: PieceUpdate):
    existing = pieces_col.find_one({"id": piece_id}, {"project_id": 1})
    if not existing:
        return {"message": "ok"}

    edge_polish_machine = piece.edge_polish_machine or calculate_edge_polish_machine(piece.length, piece.width, piece.edge_area)
    update = {
        "part": piece.part,
        "category": piece.category,
        "drawing": piece.drawing,
        "length": piece.length,
        "width": piece.width,
        "qty": piece.qty,
        "unit": piece.unit,
        "building": piece.building,
        "floor": piece.floor,
        "flat": piece.flat,
        "sink_type": piece.sink_type,
        "sink_cut": piece.sink_cut,
        "tap_holes": piece.tap_holes,
        "grooves": piece.grooves,
        "fragility": piece.fragility,
        "orientation": piece.orientation,
        "delivery_priority": piece.delivery_priority,
        "stack_preference": piece.stack_preference,
        "weight_override": piece.weight_override,
        "edge": piece.edge,
        "edge_area": piece.edge_area,
        "edge_polish_machine": edge_polish_machine,
        "radius": piece.radius,
        "notes": piece.notes,
    }
    pieces_col.update_one({"id": piece_id}, {"$set": update})
    clear_manual_container_plan(existing["project_id"])
    return {"message": "ok"}


def crate_serial_for_project(project_id: int) -> int:
    last_crate = crates_col.find_one(
        {"project_id": project_id},
        sort=[("id", -1)],
        projection={"crate_id": 1},
    )
    if not last_crate:
        return 1

    crate_id = str(last_crate.get("crate_id", ""))
    if crate_id.startswith("CR"):
        try:
            return int(crate_id[2:]) + 1
        except ValueError:
            return 1
    return 1


@app.get("/api/projects/{project_id}/crates/")
def get_crates(project_id: int):
    snapshot = project_planning_snapshot(project_id)
    return snapshot["crate_rows"]


@app.post("/api/projects/{project_id}/crates/")
def create_crate(project_id: int, data: Dict[str, Any]):
    serial = crate_serial_for_project(project_id)
    piece_ids = [int(piece_id) for piece_id in data.get("piece_ids", []) if str(piece_id).strip()]
    internal_length = float(data.get("internal_length", 0) or 0)
    internal_width = float(data.get("internal_width", 0) or 0)
    internal_height = float(data.get("internal_height", 0) or 0)
    external_length = float(data.get("external_length", 0) or 0)
    external_width = float(data.get("external_width", 0) or 0)
    external_height = float(data.get("external_height", 0) or 0)
    dimension_mode = data.get("dimension_mode") or (
        "manual" if any([internal_length, internal_width, internal_height, external_length, external_width, external_height]) else "auto"
    )
    crate = {
        "id": next_sequence("crate"),
        "project_id": project_id,
        "crate_id": f"CR{serial:04d}",
        "name": data.get("name") or f"Crate {serial}",
        "max_weight": float(data.get("max_weight", 1000) or 1000),
        "locked": bool(data.get("locked", False)),
        "custom": bool(data.get("custom", bool(piece_ids))),
        "reserved_space_pct": float(data.get("reserved_space_pct", 0) or 0),
        "planner_notes": str(data.get("planner_notes", "") or ""),
        "dimension_mode": dimension_mode,
        "stackable": data.get("stackable") if "stackable" in data else None,
        "forklift_entry": data.get("forklift_entry"),
        "reinforcement": data.get("reinforcement") if "reinforcement" in data else None,
        "wood_thickness": float(data.get("wood_thickness", 0) or 0),
        "internal_length": internal_length,
        "internal_width": internal_width,
        "internal_height": internal_height,
        "external_length": external_length,
        "external_width": external_width,
        "external_height": external_height,
        "sqft": float(data.get("sqft", 0) or 0),
        "weight": float(data.get("weight", 0) or 0),
        "created_at": utc_now(),
    }
    crates_col.insert_one(crate)

    if piece_ids:
        assignments_col.delete_many({"project_id": project_id, "piece_id": {"$in": piece_ids}})
        assignments_col.insert_many(
            [
                {
                    "id": next_sequence("assignment"),
                    "project_id": project_id,
                    "piece_id": piece_id,
                    "crate_id": crate["id"],
                    "assigned_at": utc_now(),
                }
                for piece_id in piece_ids
            ]
        )
    clear_manual_container_plan(project_id)
    return {"id": crate["id"], "crate_id": crate["crate_id"]}


@app.put("/api/projects/{project_id}/crates/{crate_id}")
def update_crate(project_id: int, crate_id: int, data: Dict[str, Any]):
    existing = crates_col.find_one({"project_id": project_id, "id": crate_id}, {"_id": 0})
    if not existing:
        return {"message": "ok"}

    update: Dict[str, Any] = {
        "name": data.get("name", existing.get("name", existing.get("crate_id", "Crate"))),
        "max_weight": float(data.get("max_weight", existing.get("max_weight", 1000)) or existing.get("max_weight", 1000)),
        "locked": bool(data.get("locked", existing.get("locked", False))),
        "custom": bool(data.get("custom", existing.get("custom", False))),
        "reserved_space_pct": float(data.get("reserved_space_pct", existing.get("reserved_space_pct", 0)) or 0),
        "planner_notes": str(data.get("planner_notes", existing.get("planner_notes", "")) or ""),
        "updated_at": utc_now(),
    }

    if "stackable" in data:
        update["stackable"] = data.get("stackable")
    if "forklift_entry" in data:
        update["forklift_entry"] = data.get("forklift_entry")
    if "reinforcement" in data:
        update["reinforcement"] = data.get("reinforcement")
    if "wood_thickness" in data:
        update["wood_thickness"] = float(data.get("wood_thickness", existing.get("wood_thickness", 0)) or 0)

    if data.get("reset_dimensions"):
        update.update(
            {
                "dimension_mode": "auto",
                "internal_length": 0.0,
                "internal_width": 0.0,
                "internal_height": 0.0,
                "external_length": 0.0,
                "external_width": 0.0,
                "external_height": 0.0,
            }
        )
    else:
        dimension_fields = [
            "internal_length",
            "internal_width",
            "internal_height",
            "external_length",
            "external_width",
            "external_height",
        ]
        manual_dimension_provided = False
        for field in dimension_fields:
            if field in data:
                update[field] = float(data.get(field, existing.get(field, 0)) or 0)
                manual_dimension_provided = True
        if "dimension_mode" in data:
            update["dimension_mode"] = data.get("dimension_mode") or existing.get("dimension_mode", "auto")
        elif manual_dimension_provided:
            update["dimension_mode"] = "manual"

    crates_col.update_one({"project_id": project_id, "id": crate_id}, {"$set": update})
    clear_manual_container_plan(project_id)
    return {"message": "ok"}


@app.post("/api/projects/{project_id}/crates/merge")
def merge_crates(project_id: int, data: Dict[str, Any]):
    crate_ids = [int(crate_id) for crate_id in data.get("crate_ids", []) if str(crate_id).strip()]
    if len(crate_ids) < 2:
        return {"message": "select at least two crates"}

    target_id = int(data.get("target_crate_id") or crate_ids[0])
    target = crates_col.find_one({"project_id": project_id, "id": target_id}, {"_id": 0})
    if not target:
        return {"message": "target not found"}

    source_ids = [crate_id for crate_id in crate_ids if crate_id != target_id]
    assignments = list(assignments_col.find({"project_id": project_id, "crate_id": {"$in": source_ids}}, {"_id": 0}))
    for assignment in assignments:
        assignments_col.update_one(
            {"id": assignment["id"]},
            {"$set": {"crate_id": target_id, "assigned_at": utc_now()}},
        )

    if data.get("name"):
        crates_col.update_one(
            {"project_id": project_id, "id": target_id},
            {"$set": {"name": data["name"], "updated_at": utc_now()}},
        )

    crates_col.delete_many({"project_id": project_id, "id": {"$in": source_ids}})
    clear_manual_container_plan(project_id)
    return {"message": "ok"}


@app.post("/api/projects/{project_id}/crates/split")
def split_crate(project_id: int, data: Dict[str, Any]):
    piece_ids = [int(piece_id) for piece_id in data.get("piece_ids", []) if str(piece_id).strip()]
    if not piece_ids:
        return {"message": "no pieces selected"}

    serial = crate_serial_for_project(project_id)
    crate_doc = {
        "id": next_sequence("crate"),
        "project_id": project_id,
        "crate_id": f"CR{serial:04d}",
        "name": data.get("name") or f"Crate {serial}",
        "max_weight": float(data.get("max_weight", 1000) or 1000),
        "locked": bool(data.get("locked", False)),
        "custom": True,
        "reserved_space_pct": float(data.get("reserved_space_pct", 0) or 0),
        "planner_notes": str(data.get("planner_notes", "") or ""),
        "dimension_mode": data.get("dimension_mode", "auto") or "auto",
        "internal_length": float(data.get("internal_length", 0) or 0),
        "internal_width": float(data.get("internal_width", 0) or 0),
        "internal_height": float(data.get("internal_height", 0) or 0),
        "external_length": float(data.get("external_length", 0) or 0),
        "external_width": float(data.get("external_width", 0) or 0),
        "external_height": float(data.get("external_height", 0) or 0),
        "sqft": 0.0,
        "weight": 0.0,
        "created_at": utc_now(),
    }
    crates_col.insert_one(crate_doc)

    assignments_col.delete_many({"project_id": project_id, "piece_id": {"$in": piece_ids}})
    assignments_col.insert_many(
        [
            {
                "id": next_sequence("assignment"),
                "project_id": project_id,
                "piece_id": piece_id,
                "crate_id": crate_doc["id"],
                "assigned_at": utc_now(),
            }
            for piece_id in piece_ids
        ]
    )
    clear_manual_container_plan(project_id)
    return {"id": crate_doc["id"], "crate_id": crate_doc["crate_id"]}


@app.post("/api/projects/{project_id}/crates/auto-generate")
def auto_generate(project_id: int, data: Dict[str, Any]):
    pieces = list(pieces_col.find({"project_id": project_id}, {"_id": 0}))
    if not pieces:
        return {"message": "no pieces"}

    project = projects_col.find_one({"id": project_id}, {"_id": 0})
    if not project:
        return {"message": "project not found"}

    existing_crates = list(crates_col.find({"project_id": project_id}, {"_id": 0}))
    locked_crates = [crate for crate in existing_crates if crate.get("locked")]
    locked_crate_ids = [crate["id"] for crate in locked_crates]
    locked_assignments = list(
        assignments_col.find({"project_id": project_id, "crate_id": {"$in": locked_crate_ids}}, {"_id": 0})
    ) if locked_crate_ids else []
    locked_piece_ids = {assignment["piece_id"] for assignment in locked_assignments}

    unlocked_crate_ids = [crate["id"] for crate in existing_crates if crate["id"] not in locked_crate_ids]
    if unlocked_crate_ids:
        assignments_col.delete_many({"project_id": project_id, "crate_id": {"$in": unlocked_crate_ids}})
        crates_col.delete_many({"project_id": project_id, "id": {"$in": unlocked_crate_ids}})

    strategy = data.get("group_by", "type")
    max_pieces = data.get("max_pieces")
    try:
        max_pieces = int(max_pieces) if max_pieces not in (None, "") else None
    except (TypeError, ValueError):
        max_pieces = None

    try:
        max_weight = float(data.get("max_weight", 1000) or 1000)
    except (TypeError, ValueError):
        max_weight = 1000.0

    generated = auto_generate_crates(
        pieces=[piece for piece in pieces if piece["id"] not in locked_piece_ids],
        strategy=strategy,
        max_pieces=max_pieces,
        max_weight=max_weight,
        material=project.get("material", "Granite"),
        thickness=project.get("thickness", "3CM"),
    )

    crate_docs = []
    assignment_docs = []
    next_serial = crate_serial_for_project(project_id)
    for crate in generated:
        dims = estimate_auto_dimensions(
            crate["pieces"],
            project.get("material", "Granite"),
            project.get("thickness", "3CM"),
            crate["max_weight"],
            preferred_wood_thickness=float(project.get("crate_wood_thickness", 0) or 0),
        )
        crate_doc = {
            "id": next_sequence("crate"),
            "project_id": project_id,
            "crate_id": f"CR{next_serial:04d}",
            "name": crate["name"],
            "max_weight": crate["max_weight"],
            "locked": False,
            "custom": False,
            "reserved_space_pct": 0.0,
            "planner_notes": "",
            "dimension_mode": "auto",
            "stackable": None,
            "forklift_entry": None,
            "reinforcement": None,
            "wood_type": project.get("crate_wood_type", "Pine"),
            "wood_thickness": dims.get("wood_thickness", 1.0),
            "internal_length": dims["internal_length"],
            "internal_width": dims["internal_width"],
            "internal_height": dims["internal_height"],
            "external_length": dims["external_length"],
            "external_width": dims["external_width"],
            "external_height": dims["external_height"],
            "sqft": dims["sqft"],
            "weight": dims["weight"],
            "crate_type": crate.get("crate_type", "Mixed / Other"),
            "packing_mode": crate.get("packing_mode", "category"),
            "primary_flat": crate.get("primary_flat", ""),
            "secondary_flats": crate.get("secondary_flats", []),
            "weight_band_status": crate.get("weight_band_status", ""),
            "grouping_reason": crate.get("grouping_reason", ""),
            "created_at": utc_now(),
        }
        next_serial += 1
        crate_docs.append(crate_doc)
        for piece in crate["pieces"]:
            assignment_docs.append(
                {
                    "id": next_sequence("assignment"),
                    "project_id": project_id,
                    "piece_id": piece["id"],
                    "crate_id": crate_doc["id"],
                    "assigned_at": utc_now(),
                }
            )

    if crate_docs:
        crates_col.insert_many(crate_docs)
    if assignment_docs:
        assignments_col.insert_many(assignment_docs)

    clear_manual_container_plan(project_id)
    return {"message": f"Created {len(crate_docs)} crates", "locked_preserved": len(locked_crates)}


@app.delete("/api/projects/{project_id}/crates/")
def delete_all_crates(project_id: int):
    crates = list(crates_col.find({"project_id": project_id}, {"id": 1}))
    crate_ids = [crate["id"] for crate in crates]
    if crate_ids:
        assignments_col.delete_many({"project_id": project_id, "crate_id": {"$in": crate_ids}})
    crates_col.delete_many({"project_id": project_id})
    clear_manual_container_plan(project_id)
    return {"message": "ok"}


@app.delete("/api/crates/{crate_id}")
def delete_crate(crate_id: int):
    crate = crates_col.find_one({"id": crate_id}, {"project_id": 1})
    if not crate:
        return {"message": "ok"}
    assignments_col.delete_many({"project_id": crate["project_id"], "crate_id": crate_id})
    crates_col.delete_one({"id": crate_id})
    clear_manual_container_plan(crate["project_id"])
    return {"message": "ok"}


@app.post("/api/crates/assign")
def assign_piece(data: Dict[str, Any]):
    piece = pieces_col.find_one({"id": int(data["piece_id"])}, {"project_id": 1})
    crate = crates_col.find_one({"id": int(data["crate_id"])}, {"project_id": 1})
    if not piece or not crate:
        return {"message": "ok"}

    project_id = piece["project_id"]
    existing = assignments_col.find_one({"project_id": project_id, "piece_id": piece["id"]})
    if existing:
        assignments_col.update_one(
            {"id": existing["id"]},
            {"$set": {"crate_id": crate["id"], "assigned_at": utc_now()}},
        )
    else:
        assignments_col.insert_one(
            {
                "id": next_sequence("assignment"),
                "project_id": project_id,
                "piece_id": piece["id"],
                "crate_id": crate["id"],
                "assigned_at": utc_now(),
            }
        )
    clear_manual_container_plan(project_id)
    return {"message": "ok"}


@app.post("/api/crates/unassign")
def unassign_piece(data: Dict[str, Any]):
    piece = pieces_col.find_one({"id": int(data["piece_id"])}, {"project_id": 1})
    if not piece:
        return {"message": "ok"}
    assignments_col.delete_many({"project_id": piece["project_id"], "piece_id": piece["id"]})
    clear_manual_container_plan(piece["project_id"])
    return {"message": "ok"}


@app.get("/api/projects/{project_id}/crates/assignments")
def get_assignments(project_id: int):
    assignments = sorted(
        assignments_col.find({"project_id": project_id}, {"_id": 0}),
        key=lambda doc: doc["id"],
    )
    return [assignment_response(assignment) for assignment in assignments]


@app.get("/api/projects/{project_id}/container-plan")
def get_manual_container_plan(project_id: int):
    project = projects_col.find_one({"id": project_id}, {"_id": 0})
    return (project or {}).get("manual_container_plan") or {"containers": []}


@app.put("/api/projects/{project_id}/container-plan")
def save_manual_container_plan(project_id: int, data: Dict[str, Any]):
    containers = data.get("containers", [])
    sanitized_containers = []
    for index, container in enumerate(containers):
        sanitized_containers.append(
            {
                "id": container.get("id") or f"MANUAL-{index + 1:03d}",
                "type": container.get("type", "40ft"),
                "placements": [
                    {
                        "crate_id": placement.get("crate_id"),
                        "x": float(placement.get("x", 0) or 0),
                        "y": float(placement.get("y", 0) or 0),
                        "rotated": bool(placement.get("rotated", False)),
                        "loading_order": int(placement.get("loading_order", placement_index + 1) or (placement_index + 1)),
                        "unload_order": int(placement.get("unload_order", placement_index + 1) or (placement_index + 1)),
                    }
                    for placement_index, placement in enumerate(container.get("placements", []))
                    if placement.get("crate_id")
                ],
            }
        )
    projects_col.update_one({"id": project_id}, {"$set": {"manual_container_plan": {"containers": sanitized_containers}, "updated_at": utc_now()}})
    return {"message": "ok"}


@app.delete("/api/projects/{project_id}/container-plan")
def delete_manual_container_plan(project_id: int):
    clear_manual_container_plan(project_id)
    return {"message": "ok"}


@app.get("/api/projects/{project_id}/crates/insights")
def get_crate_insights(project_id: int):
    try:
        return crate_insights(project_id)
    except Exception as e:
        print(f"INSIGHTS ERROR for project {project_id}: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to compute insights: {str(e)}")


@app.get("/api/projects/{project_id}/export-source-data")
def export_source_data(project_id: int):
    """Export source data (project info + pieces) as Excel for proforma invoices."""
    project = projects_col.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    pieces = sorted(pieces_col.find({"project_id": project_id}, {"_id": 0}), key=lambda doc: doc["id"])
    if not pieces:
        raise HTTPException(status_code=400, detail="No parts in this project yet.")

    try:
        import openpyxl
        wb = openpyxl.Workbook()

        ws1 = wb.active
        ws1.title = "Project Info"
        ws1.append(["StoneDesk — Source Data Export"])
        ws1.append([])
        ws1.append(["Project Name", project.get("name", "")])
        ws1.append(["Customer", project.get("customer", "")])
        ws1.append(["Job Number", project.get("job_number", "")])
        ws1.append(["Material", project.get("material", "Granite")])
        ws1.append(["Thickness", project.get("thickness", "3CM")])
        ws1.append(["Export Date", date.today().isoformat()])
        ws1.append([])
        total_qty = sum(int(p.get("qty", 1) or 1) for p in pieces)
        total_sqft = sum((float(p.get("length", 0)) * float(p.get("width", 0)) / 144.0) * int(p.get("qty", 1) or 1) for p in pieces)
        total_weight = sum(
            planning_piece_weight(p, project.get("material", "Granite"), project.get("thickness", "3CM")) * int(p.get("qty", 1) or 1)
            for p in pieces
        )
        ws1.append(["Total Parts", total_qty])
        ws1.append(["Total Sq Ft", round(total_sqft, 2)])
        ws1.append(["Total Weight (kg)", round(total_weight, 2)])

        ws2 = wb.create_sheet("Parts List")
        ws2.append([
            "Part", "Category", "Drawing", "Length", "Width", "Qty",
            "Sq Ft", "Weight (kg)", "Unit", "Building", "Floor", "Flat",
            "Sink Type", "Sink Cut", "Tap Holes", "Grooves",
            "Edge", "Edge Area", "Edge Polish Machine",
            "Fragility", "Delivery Priority", "Notes",
        ])
        mat = project.get("material", "Granite")
        thick = project.get("thickness", "3CM")
        for p in pieces:
            qty = int(p.get("qty", 1) or 1)
            sqft = round((float(p.get("length", 0)) * float(p.get("width", 0)) / 144.0) * qty, 2)
            wt = round(planning_piece_weight(p, mat, thick) * qty, 2)
            ws2.append([
                p.get("part", ""), p.get("category", ""), p.get("drawing", ""),
                p.get("length", 0), p.get("width", 0), qty,
                sqft, wt,
                p.get("unit", ""), p.get("building", ""), p.get("floor", ""), p.get("flat", ""),
                p.get("sink_type", "No Sink"), p.get("sink_cut", "-"),
                p.get("tap_holes", "-"), p.get("grooves", "-"),
                p.get("edge", "None"), p.get("edge_area", ""), p.get("edge_polish_machine", 0),
                p.get("fragility", "Standard"), p.get("delivery_priority", "Standard"),
                p.get("notes", ""),
            ])

        output = BytesIO()
        wb.save(output)
        output.seek(0)
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=SourceData_{project.get('name', 'Project')}_{date.today()}.xlsx"},
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"SOURCE DATA EXPORT ERROR: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Source data export failed: {str(e)}")


@app.get("/api/projects/{project_id}/export")
def export_excel(project_id: int):
    project = projects_col.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    pieces = sorted(pieces_col.find({"project_id": project_id}, {"_id": 0}), key=lambda doc: doc["id"])
    if not pieces:
        raise HTTPException(status_code=400, detail="Cannot export: no parts in this project. Add parts first.")

    crates_raw = list(crates_col.find({"project_id": project_id}, {"_id": 0}))
    if not crates_raw:
        raise HTTPException(status_code=400, detail="Cannot export: no crates generated. Generate a plan first.")

    try:
        assignments = list(assignments_col.find({"project_id": project_id}, {"_id": 0}))
        pieces_by_crate = pieces_grouped_by_crate(pieces, assignments)
        snapshot = project_planning_snapshot(project_id)
        loading_plan = build_container_plan(
            snapshot["crate_rows"],
            manual_plan=project.get("manual_container_plan"),
            preferred_mode=project.get("preferred_container_mode"),
        )

        import openpyxl
        wb = openpyxl.Workbook()

        ws1 = wb.active
        ws1.title = "Summary"
        ws1.append(["StoneDesk Planning Summary"])
        ws1.append([])
        ws1.append(["Project", project.get("name", "")])
        ws1.append(["Customer", project.get("customer", "")])
        ws1.append(["Job Number", project.get("job_number", "")])
        ws1.append(["Material", project.get("material", "Granite")])
        ws1.append(["Thickness", project.get("thickness", "3CM")])
        ws1.append(["Crate Wood Type", project.get("crate_wood_type", "Pine")])
        ws1.append(["Crate Wood Thickness (in)", project.get("crate_wood_thickness", 1.25)])
        ws1.append(["Export Date", date.today().isoformat()])
        ws1.append([])
        ws1.append(["KPI", "Value"])
        ws1.append(["Crates Created", len(snapshot["crate_rows"])])
        ws1.append(["Total Stone Weight (kg)", snapshot.get("total_weight", 0)])
        ws1.append(["Shipment Weight incl. Tare (kg)", snapshot.get("total_gross_weight", 0)])
        ws1.append(["Total Sq Ft", snapshot.get("total_sqft", 0)])
        ws1.append(["Average Fill %", snapshot.get("average_fill_percent", 0)])
        ws1.append(["Average Gross Weight Util %", snapshot.get("average_gross_utilization", 0)])

        recommendation = loading_plan.get("recommendation") or {}
        ws1.append(["Recommended Booking", recommendation.get("booking_action", "N/A")])
        ws1.append(["Recommended Mode", recommendation.get("mode_label", "N/A")])
        ws1.append(["Recommendation Reason", recommendation.get("reason", "")])
        ws1.append([])
        ws1.append(["Alternative Options"])
        for option in loading_plan.get("options", []):
            option_line = (
                f"{option.get('label', '?')} | feasible={option.get('feasible', False)} | "
                f"avg weight util {option.get('average_weight_utilization', 0):.0f}% | "
                f"avg length util {option.get('average_length_utilization', 0):.0f}% | "
                f"cost index {option.get('cost_index', 0):.2f}"
            )
            ws1.append([option_line])

        ws2 = wb.create_sheet("Crates")
        ws2.append(
            [
                "Crate ID",
                "Crate Name",
                "Destination Group",
                "Family Group",
                "Locked",
                "Custom",
                "Int L",
                "Int W",
                "Int H",
                "Ext L",
                "Ext W",
                "Ext H",
                "Wood Type",
                "Wood Thickness",
                "Tare Wt",
                "Net Wt",
                "Gross Wt",
                "Fill %",
                "Gross Util %",
                "Center of Gravity",
                "Forklift Entry",
                "Stackable",
                "Reinforcement",
                "Reserved Space %",
                "Status",
                "Handling Notes",
            ]
        )
        for crate in snapshot["crate_rows"]:
            cog = crate.get("center_of_gravity") or {"x": 0, "y": 0, "z": 0}
            ws2.append(
                [
                    crate.get("crate_id", ""),
                    crate.get("name", ""),
                    crate.get("destination_group", ""),
                    crate.get("family_group", ""),
                    crate.get("locked", False),
                    crate.get("custom", False),
                    crate.get("internal_length", 0),
                    crate.get("internal_width", 0),
                    crate.get("internal_height", 0),
                    crate.get("external_length", 0),
                    crate.get("external_width", 0),
                    crate.get("external_height", 0),
                    crate.get("wood_type", ""),
                    crate.get("wood_thickness", 0),
                    crate.get("tare_weight", 0),
                    crate.get("total_weight", 0),
                    crate.get("gross_weight", 0),
                    crate.get("fill_percent", 0),
                    crate.get("gross_utilization", 0),
                    f"{cog.get('x', 0)}, {cog.get('y', 0)}, {cog.get('z', 0)}",
                    crate.get("forklift_entry", ""),
                    crate.get("stackable", False),
                    crate.get("reinforcement", False),
                    crate.get("reserved_space_pct", 0),
                    crate.get("efficiency_status", ""),
                    crate.get("handling_notes", ""),
                ]
            )

        ws3 = wb.create_sheet("Crate Contents")
        ws3.append(
            [
                "Crate ID",
                "Crate Name",
                "Piece ID",
                "Part",
                "Category",
                "Drawing",
                "Unit",
                "Building",
                "Floor",
                "Flat",
                "Length",
                "Depth",
                "Qty",
                "Stone Wt (kg)",
                "Orientation",
                "Sink Type",
                "Cutouts",
                "Tap Holes",
                "Grooves",
                "Edge",
                "Notes",
            ]
        )
        for crate in snapshot["crate_rows"]:
            crate_pieces = pieces_by_crate.get(crate["id"], [])
            for piece in crate_pieces:
                ws3.append(
                    [
                        crate.get("crate_id", ""),
                        crate.get("name", ""),
                        piece.get("id", ""),
                        piece.get("part", ""),
                        piece.get("category", ""),
                        piece.get("drawing", ""),
                        piece.get("unit", ""),
                        piece.get("building", ""),
                        piece.get("floor", ""),
                        piece.get("flat", ""),
                        piece.get("length", 0),
                        piece.get("width", 0),
                        piece.get("qty", 1),
                        round(planning_piece_weight(piece, project.get("material", "Granite"), project.get("thickness", "3CM")), 2),
                        crate.get("orientation_constraints", ""),
                        piece.get("sink_type", "No Sink"),
                        piece.get("sink_cut", "-"),
                        piece.get("tap_holes", "-"),
                        piece.get("grooves", "-"),
                        piece.get("edge", "-"),
                        piece.get("notes", ""),
                    ]
                )

        ws4 = wb.create_sheet("Container Plan")
        ws4.append(
            [
                "Container ID",
                "Type",
                "Crate ID",
                "Crate Name",
                "Destination",
                "X",
                "Y",
                "Length",
                "Width",
                "Gross Wt",
                "Loading Order",
                "Unload Order",
                "Rotated",
                "Container Warnings",
            ]
        )
        for container in loading_plan.get("containers", []):
            warnings = "; ".join(container.get("warnings", []))
            for placement in container.get("placements", []):
                ws4.append(
                    [
                        container.get("id", ""),
                        container.get("type", ""),
                        placement.get("crate_id", ""),
                        placement.get("name", ""),
                        placement.get("destination_group", ""),
                        placement.get("x", 0),
                        placement.get("y", 0),
                        placement.get("length", 0),
                        placement.get("width", 0),
                        placement.get("weight", 0),
                        placement.get("loading_order", 0),
                        placement.get("unload_order", 0),
                        placement.get("rotated", False),
                        warnings,
                    ]
                )

        ws5 = wb.create_sheet("Exceptions - Warnings")
        ws5.append(["Scope", "ID", "Name", "Severity", "Message"])
        for row in snapshot.get("exception_rows", []):
            ws5.append([row.get("scope", ""), row.get("id", ""), row.get("name", ""), row.get("severity", ""), row.get("message", "")])
        for row in snapshot.get("underfilled_crates", []):
            ws5.append(["crate", row.get("crate_id", ""), row.get("name", ""), row.get("status", ""), row.get("suggestion", "")])
        for container in loading_plan.get("containers", []):
            for warning in container.get("warnings", []):
                ws5.append(["container", container.get("id", ""), container.get("type", ""), "yellow", warning])

        output = BytesIO()
        wb.save(output)
        output.seek(0)
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=StoneDesk_{date.today()}.xlsx"},
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"EXPORT ERROR: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")

