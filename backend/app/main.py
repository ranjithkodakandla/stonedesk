from copy import deepcopy
from datetime import date, datetime
from io import BytesIO
import os
from typing import Any, Dict, List, Optional

import openpyxl
import certifi
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pymongo import MongoClient, ReturnDocument
from pydantic import BaseModel

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/stonedesk")
MONGODB_DB = os.getenv("MONGODB_DB", "stonedesk")
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
        mongo_client = MongoClient(
            MONGODB_URI,
            serverSelectionTimeoutMS=1500,
            tlsCAFile=certifi.where(),
        )
        mongo_client.admin.command("ping")
        mongo_db = mongo_client[MONGODB_DB]
        store = {
            "projects": mongo_db["projects"],
            "pieces": mongo_db["pieces"],
            "crates": mongo_db["crates"],
            "assignments": mongo_db["assignments"],
            "counters": mongo_db["counters"],
        }
        return store, "mongo"
    except Exception:
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


def group_pieces(pieces: List[Dict[str, Any]], strategy: str) -> Dict[str, List[Dict[str, Any]]]:
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for piece in pieces:
        if strategy in {"unit", "apartment", "destination"}:
            building = str(piece.get("building", "")).strip()
            floor = str(piece.get("floor", "")).strip()
            flat = str(piece.get("flat", "")).strip()
            key = " / ".join(part for part in [building, f"Floor {floor}" if floor else "", f"Flat {flat}" if flat else ""] if part)
            if not key:
                key = "Uncategorized Unit"
        elif strategy in {"family", "type"}:
            key = piece.get("category") or "Uncategorized Family"
        elif strategy == "smart":
            destination_parts = [
                str(piece.get("building", "")).strip(),
                str(piece.get("floor", "")).strip(),
                str(piece.get("flat", "")).strip(),
            ]
            destination = "-".join(part for part in destination_parts if part)
            if destination:
                key = f"{destination}"
            else:
                key = piece.get("category") or "Smart Mixed"
        else:
            key = piece.get("category") or "Uncategorized Type"
        groups.setdefault(key, []).append(piece)
    return groups


def distribute_into_crates(
    pieces: List[Dict[str, Any]],
    max_pieces: Optional[int],
    max_weight: float,
    material: str,
    thickness: str,
) -> List[List[Dict[str, Any]]]:
    if not pieces:
        return []

    sorted_pieces = sorted(
        pieces,
        key=lambda piece: (
            piece_weight(piece, material, thickness),
            float(piece.get("length", 0)) * float(piece.get("width", 0)),
        ),
        reverse=True,
    )

    crates: List[List[Dict[str, Any]]] = []
    current_crate: List[Dict[str, Any]] = []
    current_weight = 0.0

    for piece in sorted_pieces:
        p_weight = piece_weight(piece, material, thickness)
        would_exceed_pieces = max_pieces is not None and len(current_crate) + 1 > max_pieces
        would_exceed_weight = current_weight + p_weight > max_weight

        if current_crate and (would_exceed_pieces or would_exceed_weight):
            crates.append(current_crate)
            current_crate = [piece]
            current_weight = p_weight
            continue

        current_crate.append(piece)
        current_weight += p_weight

    if current_crate:
        crates.append(current_crate)

    return crates


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
    groups = group_pieces(pieces, strategy)

    generated: List[Dict[str, Any]] = []
    serial = 1
    for group_name, group_pieces_list in groups.items():
        batches = distribute_into_crates(
            group_pieces_list,
            max_pieces=max_pieces,
            max_weight=effective_max_weight,
            material=material,
            thickness=thickness,
        )
        for batch in batches:
            generated.append(
                {
                    "serial": serial,
                    "crate_id": f"CR{serial:04d}",
                    "name": f"{group_name}-{serial}",
                    "pieces": batch,
                    "max_weight": effective_max_weight,
                }
            )
            serial += 1

    return generated


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
    project = projects_col.find_one({"id": project_id}, {"_id": 0})
    crates = sorted(crates_col.find({"project_id": project_id}, {"_id": 0}), key=lambda doc: doc["id"])
    pieces = sorted(pieces_col.find({"project_id": project_id}, {"_id": 0}), key=lambda doc: doc["id"])
    assignments = list(assignments_col.find({"project_id": project_id}, {"_id": 0}))
    pieces_by_crate = pieces_grouped_by_crate(pieces, assignments)

    material = project.get("material", "Granite") if project else "Granite"
    thickness = project.get("thickness", "3CM") if project else "3CM"

    crate_rows = []
    total_weight = 0.0
    for crate in crates:
        crate_pieces = pieces_by_crate.get(crate["id"], [])
        crate_weight = sum(piece_weight(piece, material, thickness) for piece in crate_pieces)
        dims = estimate_crate_dimensions(crate_pieces, material, thickness, crate.get("max_weight", 1000))
        utilization = (crate_weight / crate.get("max_weight", 1)) * 100 if crate.get("max_weight", 0) else 0
        total_weight += crate_weight
        crate_rows.append(
            {
                "id": crate["id"],
                "crate_id": crate["crate_id"],
                "name": crate["name"],
                "group_name": crate_group_name(crate["name"]),
                "max_weight": crate.get("max_weight", 1000),
                "total_weight": round(crate_weight, 2),
                "utilization": round(utilization, 1),
                "items": len(crate_pieces),
                "internal_length": dims["internal_length"],
                "internal_width": dims["internal_width"],
                "internal_height": dims["internal_height"],
                "external_length": dims["external_length"],
                "external_width": dims["external_width"],
                "external_height": dims["external_height"],
                "sqft": dims["sqft"],
            }
        )

    distinct_families = len({piece.get("category") or "Uncategorized" for piece in pieces})
    distinct_destinations = len({
        "-".join(part for part in [
            str(piece.get("building", "")).strip(),
            str(piece.get("floor", "")).strip(),
            str(piece.get("flat", "")).strip(),
        ] if part)
        or "Unassigned"
        for piece in pieces
    })

    rows_by_group: Dict[str, List[Dict[str, Any]]] = {}
    for row in crate_rows:
        rows_by_group.setdefault(row["group_name"], []).append(row)

    underfilled = []
    for crate in crate_rows:
        spare = round(crate["max_weight"] - crate["total_weight"], 2)
        if crate["utilization"] >= 85:
            continue

        merge_candidates = []
        for other in rows_by_group.get(crate["group_name"], []):
            if other["id"] == crate["id"]:
                continue
            combined = crate["total_weight"] + other["total_weight"]
            if combined <= crate["max_weight"]:
                merge_candidates.append(other["name"])

        underfilled.append(
            {
                "crate_id": crate["crate_id"],
                "name": crate["name"],
                "utilization": crate["utilization"],
                "spare_capacity": spare,
                "suggestion": (
                    f"This crate is at {crate['utilization']:.0f}% fill. "
                    f"You can still add about {spare:.0f} kg. "
                    f"Try moving lighter items from the next crate or merge with same-destination crate(s) if handling allows."
                ),
                "merge_candidates": merge_candidates[:3],
            }
        )

    average_utilization = round(
        sum(crate["utilization"] for crate in crate_rows) / len(crate_rows), 1
    ) if crate_rows else 0

    recommended_target = 90 if any(crate["utilization"] < 85 for crate in crate_rows) else 95
    adjusted_target = round(sum(crate["total_weight"] for crate in crate_rows) / len(crate_rows), 0) if crate_rows else 0
    plan = container_plan(
        total_weight,
        len(crate_rows),
        average_utilization,
        distinct_families,
        distinct_destinations,
        len(underfilled),
    )

    from .services.container_planner import build_container_plan
    loading_plan = build_container_plan(crate_rows)

    return {
        "total_weight": round(total_weight, 2),
        "crate_count": len(crate_rows),
        "average_utilization": average_utilization,
        "recommended_utilization_target": recommended_target,
        "adjusted_target_weight": adjusted_target,
        "distinct_families": distinct_families,
        "distinct_destinations": distinct_destinations,
        "container_plan": plan,
        "container_loading_plan": loading_plan,
        "crates": crate_rows,
        "underfilled_crates": underfilled,
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
    edge: str = "None"
    edge_area: str = ""
    edge_polish_machine: float = 0.0
    radius: str = "-"
    notes: str = ""


class ProjectUpdate(BaseModel):
    name: str
    material: str
    thickness: str
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
        "customer": data.customer,
        "job_number": data.job_number,
        "date": data.date,
        "updated_at": utc_now(),
    }
    projects_col.update_one({"id": project_id}, {"$set": update})
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
        "edge": piece.edge,
        "edge_area": piece.edge_area,
        "edge_polish_machine": edge_polish_machine,
        "radius": piece.radius,
        "notes": piece.notes,
        "created_at": utc_now(),
    }
    pieces_col.insert_one(doc)
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
    return {"message": f"Created {len(docs)} pieces"}


@app.delete("/api/projects/{project_id}/pieces/")
def delete_all_pieces(project_id: int):
    pieces = list(pieces_col.find({"project_id": project_id}, {"id": 1}))
    piece_ids = [piece["id"] for piece in pieces]
    if piece_ids:
        assignments_col.delete_many({"project_id": project_id, "piece_id": {"$in": piece_ids}})
    pieces_col.delete_many({"project_id": project_id})
    return {"message": "ok"}


@app.delete("/api/pieces/{piece_id}")
def delete_piece(piece_id: int):
    piece = pieces_col.find_one({"id": piece_id}, {"project_id": 1})
    if piece:
        assignments_col.delete_many({"project_id": piece["project_id"], "piece_id": piece_id})
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
        "edge": piece.edge,
        "edge_area": piece.edge_area,
        "edge_polish_machine": edge_polish_machine,
        "radius": piece.radius,
        "notes": piece.notes,
    }
    pieces_col.update_one({"id": piece_id}, {"$set": update})
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
    crates = sorted(crates_col.find({"project_id": project_id}, {"_id": 0}), key=lambda doc: doc["id"])
    return [crate_response(crate) for crate in crates]


@app.post("/api/projects/{project_id}/crates/")
def create_crate(project_id: int, data: Dict[str, Any]):
    serial = crate_serial_for_project(project_id)
    internal_length = float(data.get("internal_length", 0) or 0)
    internal_width = float(data.get("internal_width", 0) or 0)
    internal_height = float(data.get("internal_height", 0) or 0)
    external_length = float(data.get("external_length", 0) or 0)
    external_width = float(data.get("external_width", 0) or 0)
    external_height = float(data.get("external_height", 0) or 0)
    crate = {
        "id": next_sequence("crate"),
        "project_id": project_id,
        "crate_id": f"CR{serial:04d}",
        "name": data.get("name") or f"Crate {serial}",
        "max_weight": float(data.get("max_weight", 1000) or 1000),
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
    return {"id": crate["id"], "crate_id": crate["crate_id"]}


@app.post("/api/projects/{project_id}/crates/auto-generate")
def auto_generate(project_id: int, data: Dict[str, Any]):
    pieces = list(pieces_col.find({"project_id": project_id}, {"_id": 0}))
    if not pieces:
        return {"message": "no pieces"}

    project = projects_col.find_one({"id": project_id}, {"_id": 0})
    if not project:
        return {"message": "project not found"}

    crates_col.delete_many({"project_id": project_id})
    assignments_col.delete_many({"project_id": project_id})

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
        pieces=pieces,
        strategy=strategy,
        max_pieces=max_pieces,
        max_weight=max_weight,
        material=project.get("material", "Granite"),
        thickness=project.get("thickness", "3CM"),
    )

    crate_docs = []
    assignment_docs = []
    for crate in generated:
        dims = estimate_crate_dimensions(
            crate["pieces"],
            project.get("material", "Granite"),
            project.get("thickness", "3CM"),
            crate["max_weight"],
        )
        crate_doc = {
            "id": next_sequence("crate"),
            "project_id": project_id,
            "crate_id": crate["crate_id"],
            "name": crate["name"],
            "max_weight": crate["max_weight"],
            "internal_length": dims["internal_length"],
            "internal_width": dims["internal_width"],
            "internal_height": dims["internal_height"],
            "external_length": dims["external_length"],
            "external_width": dims["external_width"],
            "external_height": dims["external_height"],
            "sqft": dims["sqft"],
            "weight": dims["weight"],
            "created_at": utc_now(),
        }
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

    return {"message": f"Created {len(crate_docs)} crates"}


@app.delete("/api/projects/{project_id}/crates/")
def delete_all_crates(project_id: int):
    crates = list(crates_col.find({"project_id": project_id}, {"id": 1}))
    crate_ids = [crate["id"] for crate in crates]
    if crate_ids:
        assignments_col.delete_many({"project_id": project_id, "crate_id": {"$in": crate_ids}})
    crates_col.delete_many({"project_id": project_id})
    return {"message": "ok"}


@app.delete("/api/crates/{crate_id}")
def delete_crate(crate_id: int):
    crate = crates_col.find_one({"id": crate_id}, {"project_id": 1})
    if not crate:
        return {"message": "ok"}
    assignments_col.delete_many({"project_id": crate["project_id"], "crate_id": crate_id})
    crates_col.delete_one({"id": crate_id})
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
    return {"message": "ok"}


@app.get("/api/projects/{project_id}/crates/assignments")
def get_assignments(project_id: int):
    assignments = sorted(
        assignments_col.find({"project_id": project_id}, {"_id": 0}),
        key=lambda doc: doc["id"],
    )
    return [assignment_response(assignment) for assignment in assignments]


@app.get("/api/projects/{project_id}/crates/insights")
def get_crate_insights(project_id: int):
    return crate_insights(project_id)


@app.get("/api/projects/{project_id}/export")
def export_excel(project_id: int):
    project = projects_col.find_one({"id": project_id}, {"_id": 0})
    if not project:
        return {"message": "project not found"}

    pieces = sorted(pieces_col.find({"project_id": project_id}, {"_id": 0}), key=lambda doc: doc["id"])
    crates = sorted(crates_col.find({"project_id": project_id}, {"_id": 0}), key=lambda doc: doc["id"])
    assignments = list(assignments_col.find({"project_id": project_id}, {"_id": 0}))
    pieces_by_crate = pieces_grouped_by_crate(pieces, assignments)
    factor = weight_factor(project.get("material", "Granite"), project.get("thickness", "3CM"))

    wb = openpyxl.Workbook()

    ws1 = wb.active
    ws1.title = "Line Items"
    ws1.append(
        [
            "#",
            "Part Description",
            "Category",
            "Material",
            "Thickness",
            "Drawing #",
            "Unit Name",
            "Length (in)",
            "Depth (in)",
            "Qty",
            "Sink Type",
            "Cutouts",
            "Tap Holes",
            "Grooves",
            "Edge Polish",
            "Radius",
            "Sq Ft (ea)",
            "Sq Ft (tot)",
            "Wt ea (kg)",
            "Wt tot (kg)",
            "Building",
            "Floor",
            "Flat",
            "Notes",
        ]
    )
    for i, piece in enumerate(pieces, 1):
        sqft = (piece["length"] * piece["width"]) / 144
        ws1.append(
            [
                i,
                piece["part"],
                piece["category"],
                project.get("material", "Granite"),
                project.get("thickness", "3CM"),
                piece.get("drawing", ""),
                piece.get("unit", ""),
                piece["length"],
                piece["width"],
                piece["qty"],
                piece.get("sink_type", "No Sink"),
                piece.get("sink_cut", "-"),
                piece.get("tap_holes", "-"),
                piece.get("grooves", "-"),
                piece.get("edge", "-"),
                piece.get("radius", "-"),
                round(sqft, 2),
                round(sqft * piece["qty"], 2),
                round(sqft * factor, 2),
                round(sqft * factor * piece["qty"], 2),
                piece.get("building", ""),
                piece.get("floor", ""),
                piece.get("flat", ""),
                piece.get("notes", ""),
            ]
        )

    ws2 = wb.create_sheet("Aggregated Summary")
    ws2.append(["Part Description", "Category", "Material", "Thickness", "Drawings", "Total Pieces", "Total Sq Ft", "Total Weight (kg)"])
    groups: Dict[tuple, Dict[str, Any]] = {}
    for piece in pieces:
        key = (piece["part"], piece["category"])
        if key not in groups:
            groups[key] = {"drawings": set(), "qty": 0, "sqft": 0.0, "weight": 0.0}
        if piece.get("drawing"):
            groups[key]["drawings"].add(piece["drawing"])
        groups[key]["qty"] += piece["qty"]
        sq = (piece["length"] * piece["width"]) / 144
        groups[key]["sqft"] += sq * piece["qty"]
        groups[key]["weight"] += sq * factor * piece["qty"]
    for (part, category), summary in groups.items():
        ws2.append(
            [
                part,
                category,
                project.get("material", "Granite"),
                project.get("thickness", "3CM"),
                len(summary["drawings"]),
                summary["qty"],
                round(summary["sqft"], 2),
                round(summary["weight"], 2),
            ]
        )

    ws3 = wb.create_sheet("Crate_Plan")
    ws3.append([
        "Crate #",
        "Crate Name",
        "Project",
        "Int L",
        "Int W",
        "Int H",
        "Ext L",
        "Ext W",
        "Ext H",
        "Max Kg",
        "Total Kg",
        "Sq Ft",
        "Items",
        "Assigned By",
        "Date",
    ])
    for crate in crates:
        c_pieces = pieces_by_crate.get(crate["id"], [])
        total_kg = sum(piece_weight(piece, project.get("material", "Granite"), project.get("thickness", "3CM")) for piece in c_pieces)
        ws3.append(
            [
                crate["crate_id"],
                crate["name"],
                project.get("name", ""),
                crate.get("internal_length", 0),
                crate.get("internal_width", 0),
                crate.get("internal_height", 0),
                crate.get("external_length", 0),
                crate.get("external_width", 0),
                crate.get("external_height", 0),
                crate.get("max_weight", 1000),
                round(total_kg, 2),
                round(sum((piece["length"] * piece["width"]) / 144 * piece["qty"] for piece in c_pieces), 2),
                len(c_pieces),
                "System",
                date.today().isoformat(),
            ]
        )

    ws4 = wb.create_sheet("Crate Items")
    ws4.append(["Crate #", "Crate Name", "Record ID", "Project", "Drawing", "Part #", "Description", "Building", "Floor", "Flat", "Qty", "Wt ea (kg)", "Line Wt (kg)"])
    for crate in crates:
        c_pieces = pieces_by_crate.get(crate["id"], [])
        for piece in c_pieces:
            wt_ea = piece_weight(piece, project.get("material", "Granite"), project.get("thickness", "3CM")) / max(int(piece.get("qty", 1)), 1)
            ws4.append(
                [
                    crate["crate_id"],
                    crate["name"],
                    piece["id"],
                    project.get("name", ""),
                    piece.get("drawing", ""),
                    piece.get("part", ""),
                    piece.get("category", ""),
                    piece.get("building", ""),
                    piece.get("floor", ""),
                    piece.get("flat", ""),
                    piece.get("qty", 1),
                    round(wt_ea, 2),
                    round(wt_ea * piece.get("qty", 1), 2),
                ]
            )

    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=StoneDesk_{date.today()}.xlsx"},
    )
