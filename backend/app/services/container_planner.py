from typing import Any, Dict, List


CONTAINER_LIBRARY: Dict[str, Dict[str, float]] = {
    "20ft": {
        "max_length": 233.0,
        "max_width": 92.0,
        "max_weight": 24000.0,
        "cost_index": 1.0,
    },
    "40ft": {
        "max_length": 470.0,
        "max_width": 92.0,
        "max_weight": 28750.0,
        "cost_index": 1.55,
    },
}


class Rect:
    def __init__(self, x: float, y: float, w: float, l: float, crate: Dict[str, Any], rotated: bool):
        self.x = x
        self.y = y
        self.w = w
        self.l = l
        self.crate = crate
        self.rotated = rotated


class Container:
    def __init__(self, id_str: str, type_key: str):
        spec = CONTAINER_LIBRARY[type_key]
        self.id = id_str
        self.type = type_key
        self.max_length = spec["max_length"]
        self.max_width = spec["max_width"]
        self.max_weight = spec["max_weight"]
        self.cost_index = spec["cost_index"]
        self.current_weight = 0.0
        self.placements: List[Rect] = []
        self.shelves: List[Dict[str, Any]] = []

    def can_fit_shelf(self, shelf: Dict[str, Any], w: float, l: float) -> bool:
        remaining_width = self.max_width - shelf["left_used"] - shelf["right_used"]
        return remaining_width >= w and l <= shelf["length"]

    def pick_side(self, shelf: Dict[str, Any], crate_weight: float) -> str:
        left_delta = abs((shelf["left_weight"] + crate_weight) - shelf["right_weight"])
        right_delta = abs(shelf["left_weight"] - (shelf["right_weight"] + crate_weight))
        if right_delta < left_delta:
            return "right"
        if left_delta < right_delta:
            return "left"
        return "left" if shelf["left_used"] <= shelf["right_used"] else "right"

    def add_to_shelf(self, shelf: Dict[str, Any], w: float, l: float, crate: Dict[str, Any], rotated: bool) -> Rect:
        crate_weight = float(crate.get("gross_weight", crate.get("total_weight", 0.0)) or 0.0)
        side = self.pick_side(shelf, crate_weight)
        if side == "left":
            y = shelf["left_used"]
            shelf["left_used"] += w
            shelf["left_weight"] += crate_weight
        else:
            y = self.max_width - shelf["right_used"] - w
            shelf["right_used"] += w
            shelf["right_weight"] += crate_weight

        rect = Rect(shelf["x_start"], y, w, l, crate, rotated)
        self.placements.append(rect)
        self.current_weight += crate_weight
        return rect

    def try_add(self, crate: Dict[str, Any]) -> bool:
        crate_weight = float(crate.get("gross_weight", crate.get("total_weight", 0.0)) or 0.0)
        if self.current_weight + crate_weight > self.max_weight:
            return False

        ext_l = float(crate.get("external_length", 0.0) or 0.0)
        ext_w = float(crate.get("external_width", 0.0) or 0.0)
        if ext_l <= 0 or ext_w <= 0:
            return False

        orientations = [
            {"l": ext_l, "w": ext_w, "rotated": False},
            {"l": ext_w, "w": ext_l, "rotated": True},
        ]

        for shelf in self.shelves:
            for orientation in orientations:
                if self.can_fit_shelf(shelf, orientation["w"], orientation["l"]):
                    self.add_to_shelf(shelf, orientation["w"], orientation["l"], crate, orientation["rotated"])
                    return True

        current_x = sum(shelf["length"] for shelf in self.shelves)
        for orientation in orientations:
            if current_x + orientation["l"] <= self.max_length and orientation["w"] <= self.max_width:
                new_shelf = {
                    "x_start": current_x,
                    "length": orientation["l"],
                    "left_used": 0.0,
                    "right_used": 0.0,
                    "left_weight": 0.0,
                    "right_weight": 0.0,
                }
                self.shelves.append(new_shelf)
                self.add_to_shelf(new_shelf, orientation["w"], orientation["l"], crate, orientation["rotated"])
                return True
        return False

    def used_length(self) -> float:
        return round(sum(shelf["length"] for shelf in self.shelves), 1)

    def length_utilization(self) -> float:
        return round((self.used_length() / self.max_length) * 100.0, 1) if self.max_length else 0.0

    def weight_utilization(self) -> float:
        return round((self.current_weight / self.max_weight) * 100.0, 1) if self.max_weight else 0.0

    def build_empty_spaces(self) -> List[Dict[str, Any]]:
        empty_spaces: List[Dict[str, Any]] = []
        for shelf in self.shelves:
            center_gap = self.max_width - shelf["left_used"] - shelf["right_used"]
            if center_gap > 2:
                empty_spaces.append(
                    {
                        "x": round(shelf["x_start"], 1),
                        "y": round(shelf["left_used"], 1),
                        "length": round(shelf["length"], 1),
                        "width": round(center_gap, 1),
                    }
                )

        tail_gap = self.max_length - sum(shelf["length"] for shelf in self.shelves)
        if tail_gap > 2:
            empty_spaces.append(
                {
                    "x": round(sum(shelf["length"] for shelf in self.shelves), 1),
                    "y": 0.0,
                    "length": round(tail_gap, 1),
                    "width": round(self.max_width, 1),
                }
            )
        return empty_spaces

    def build_balance(self) -> Dict[str, float]:
        if not self.placements or self.current_weight <= 0:
            return {
                "left_right_delta_pct": 0.0,
                "front_rear_delta_pct": 0.0,
                "left_weight": 0.0,
                "right_weight": 0.0,
                "front_weight": 0.0,
                "rear_weight": 0.0,
            }

        left_weight = 0.0
        right_weight = 0.0
        front_weight = 0.0
        rear_weight = 0.0

        for placement in self.placements:
            weight = float(placement.crate.get("gross_weight", placement.crate.get("total_weight", 0.0)) or 0.0)
            center_x = placement.x + (placement.l / 2.0)
            center_y = placement.y + (placement.w / 2.0)
            if center_y <= self.max_width / 2.0:
                left_weight += weight
            else:
                right_weight += weight
            if center_x <= self.max_length / 2.0:
                front_weight += weight
            else:
                rear_weight += weight

        return {
            "left_right_delta_pct": round(abs(left_weight - right_weight) / self.current_weight * 100.0, 1),
            "front_rear_delta_pct": round(abs(front_weight - rear_weight) / self.current_weight * 100.0, 1),
            "left_weight": round(left_weight, 1),
            "right_weight": round(right_weight, 1),
            "front_weight": round(front_weight, 1),
            "rear_weight": round(rear_weight, 1),
        }

    def build_warnings(self) -> List[str]:
        warnings: List[str] = []
        balance = self.build_balance()
        if balance["left_right_delta_pct"] > 15:
            warnings.append("Left/right balance needs adjustment")
        if balance["front_rear_delta_pct"] > 18:
            warnings.append("Front/rear balance needs adjustment")
        if self.weight_utilization() < 45:
            warnings.append("Container weight utilization is low")
        if self.length_utilization() < 45:
            warnings.append("Container floor utilization is low")
        return warnings

    def get_placements_data(self) -> List[Dict[str, Any]]:
        placements = sorted(self.placements, key=lambda item: (item.x, item.y))
        unload_sequence = sorted(placements, key=lambda item: (item.crate.get("delivery_rank", 999), -item.x, item.y))
        unload_order_map = {id(item): idx + 1 for idx, item in enumerate(unload_sequence)}
        loading_sequence = list(reversed(unload_sequence))
        loading_order_map = {id(item): idx + 1 for idx, item in enumerate(loading_sequence)}

        data: List[Dict[str, Any]] = []
        for placement in placements:
            data.append(
                {
                    "crate_id": placement.crate.get("crate_id"),
                    "name": placement.crate.get("name"),
                    "x": round(placement.x, 1),
                    "y": round(placement.y, 1),
                    "width": round(placement.w, 1),
                    "length": round(placement.l, 1),
                    "weight": round(float(placement.crate.get("gross_weight", placement.crate.get("total_weight", 0.0)) or 0.0), 1),
                    "net_weight": round(float(placement.crate.get("total_weight", 0.0) or 0.0), 1),
                    "rotated": placement.rotated,
                    "destination_group": placement.crate.get("destination_group"),
                    "fill_percent": placement.crate.get("fill_percent"),
                    "efficiency_status": placement.crate.get("efficiency_status"),
                    "loading_order": loading_order_map[id(placement)],
                    "unload_order": unload_order_map[id(placement)],
                    "stackable": placement.crate.get("stackable", False),
                    "locked": placement.crate.get("locked", False),
                }
            )
        return data

    def as_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "used_weight": round(self.current_weight, 1),
            "max_weight": self.max_weight,
            "used_length": self.used_length(),
            "max_length": self.max_length,
            "max_width": self.max_width,
            "weight_utilization": self.weight_utilization(),
            "length_utilization": self.length_utilization(),
            "balance": self.build_balance(),
            "warnings": self.build_warnings(),
            "empty_spaces": self.build_empty_spaces(),
            "zones": {
                "front_wall": {"x": 0.0, "label": "Front wall"},
                "door_zone": {"x": round(self.max_length - 12.0, 1), "length": 12.0, "label": "Door working zone"},
                "centerline": round(self.max_width / 2.0, 1),
            },
            "placements": self.get_placements_data(),
        }


def choose_container_type_for_mixed(crate: Dict[str, Any], remaining: List[Dict[str, Any]]) -> str:
    max_length = float(crate.get("external_length", 0.0) or 0.0)
    remaining_weight = sum(float(item.get("gross_weight", item.get("total_weight", 0.0)) or 0.0) for item in remaining)
    remaining_count = len(remaining)
    if max_length <= CONTAINER_LIBRARY["20ft"]["max_length"] and remaining_weight <= 15000 and remaining_count <= 10:
        return "20ft"
    return "40ft"


def pack_option(crates: List[Dict[str, Any]], mode: str) -> Dict[str, Any]:
    allowed = [mode] if mode in {"20ft", "40ft"} else ["20ft", "40ft"]
    sorted_crates = sorted(
        crates,
        key=lambda crate: (
            -(int(crate.get("delivery_rank", 999) or 999)),
            -(float(crate.get("gross_weight", crate.get("total_weight", 0.0)) or 0.0)),
            -(
                float(crate.get("external_length", 0.0) or 0.0)
                * float(crate.get("external_width", 0.0) or 0.0)
            ),
        ),
    )

    containers: List[Container] = []
    unplaced: List[str] = []
    for idx, crate in enumerate(sorted_crates):
        placed = False
        for container in containers:
            if container.try_add(crate):
                placed = True
                break

        if not placed:
            container_type = mode
            if mode == "mixed":
                container_type = choose_container_type_for_mixed(crate, sorted_crates[idx:])
            if container_type not in allowed:
                container_type = allowed[-1]

            new_container = Container(id_str=f"{container_type.upper()}-{len(containers) + 1:03d}", type_key=container_type)
            if not new_container.try_add(crate):
                if container_type != "40ft":
                    fallback = Container(id_str=f"40FT-{len(containers) + 1:03d}", type_key="40ft")
                    if fallback.try_add(crate):
                        containers.append(fallback)
                        placed = True
                if not placed:
                    unplaced.append(crate.get("crate_id", crate.get("name", f"crate-{idx}")))
                    continue
            else:
                containers.append(new_container)
                placed = True

    container_dicts = [container.as_dict() for container in containers]
    total_cost_index = round(sum(CONTAINER_LIBRARY[container["type"]]["cost_index"] for container in container_dicts), 2)
    avg_weight_util = round(
        sum(container["weight_utilization"] for container in container_dicts) / len(container_dicts),
        1,
    ) if container_dicts else 0.0
    avg_length_util = round(
        sum(container["length_utilization"] for container in container_dicts) / len(container_dicts),
        1,
    ) if container_dicts else 0.0
    imbalance_penalty = round(
        sum(container["balance"]["left_right_delta_pct"] + container["balance"]["front_rear_delta_pct"] for container in container_dicts) / max(len(container_dicts), 1),
        1,
    )

    score = total_cost_index + (len(container_dicts) * 0.14) + (imbalance_penalty / 100.0)
    low_util_containers = [container for container in container_dicts if container["weight_utilization"] < 45 or container["length_utilization"] < 45]
    score += len(low_util_containers) * 0.22

    counts = {"20ft": 0, "40ft": 0}
    for container in container_dicts:
        counts[container["type"]] += 1

    if counts["20ft"] and counts["40ft"]:
        label = f"{counts['40ft']} x 40ft + {counts['20ft']} x 20ft"
        recommended_key = "mixed"
    elif counts["20ft"]:
        label = f"{counts['20ft']} x 20ft"
        recommended_key = "20ft"
    else:
        label = f"{counts['40ft']} x 40ft"
        recommended_key = "40ft"

    return {
        "mode": mode,
        "label": label,
        "recommended_key": recommended_key,
        "feasible": len(unplaced) == 0,
        "score": round(score, 2),
        "unplaced": unplaced,
        "counts": counts,
        "average_weight_utilization": avg_weight_util,
        "average_length_utilization": avg_length_util,
        "imbalance_penalty": imbalance_penalty,
        "total_cost_index": total_cost_index,
        "containers": container_dicts,
    }


def build_reason(option: Dict[str, Any]) -> str:
    if option["recommended_key"] == "mixed":
        return (
            "Mixed mode gives the best balance between paid container space and realistic floor loading. "
            "The lighter remainder can move in a 20ft while the dense crate set stays in a 40ft."
        )
    if option["recommended_key"] == "20ft":
        return (
            "The crate footprint and gross weight fit efficiently in 20ft equipment, which keeps spend lower "
            "without forcing unsafe stacking."
        )
    return (
        "A 40ft plan gives more working floor length, lower congestion at the doors, and safer balance for mixed stone crates."
    )


def build_booking_action(option: Dict[str, Any]) -> str:
    counts = option["counts"]
    actions: List[str] = []
    if counts["40ft"]:
        actions.append(f"{counts['40ft']} x 40ft")
    if counts["20ft"]:
        actions.append(f"{counts['20ft']} x 20ft")
    return "Book " + " + ".join(actions) if actions else "Review container mix"


def build_auto_container_plan(crates: List[Dict[str, Any]], preferred_mode: str | None = None) -> Dict[str, Any]:
    if not crates:
        return {
            "summary": {
                "total_20ft": 0,
                "total_40ft": 0,
                "total_containers": 0,
            },
            "recommendation": {
                "recommended": "none",
                "booking_action": "No containers required",
                "reason": "Generate crates first to evaluate a container plan.",
                "alternatives": [],
                "cost_index": 0.0,
                "mode_label": "",
            },
            "options": [],
            "containers": [],
        }

    options = [pack_option(crates, "20ft"), pack_option(crates, "40ft"), pack_option(crates, "mixed")]
    feasible_options = [option for option in options if option["feasible"]]

    preferred = None
    if preferred_mode in {"20ft", "40ft", "mixed"}:
        preferred = next((option for option in options if option["mode"] == preferred_mode and option["feasible"]), None)
    if preferred is None:
        preferred = min(feasible_options or options, key=lambda option: option["score"])

    alternatives = []
    for option in options:
        if option is preferred:
            continue
        if option["feasible"]:
            alternatives.append(
                f"{option['label']} | avg weight util {option['average_weight_utilization']:.0f}% | "
                f"avg length util {option['average_length_utilization']:.0f}% | cost index {option['total_cost_index']:.2f}"
            )
        else:
            alternatives.append(f"{option['label']} | not feasible for all crate footprints")

    return {
        "summary": {
            "total_20ft": preferred["counts"]["20ft"],
            "total_40ft": preferred["counts"]["40ft"],
            "total_containers": len(preferred["containers"]),
            "average_weight_utilization": preferred["average_weight_utilization"],
            "average_length_utilization": preferred["average_length_utilization"],
        },
        "recommendation": {
            "recommended": preferred["recommended_key"],
            "booking_action": build_booking_action(preferred),
            "reason": build_reason(preferred),
            "alternatives": alternatives,
            "cost_index": preferred["total_cost_index"],
            "mode_label": preferred["label"],
        },
        "options": [
            {
                "mode": option["mode"],
                "label": option["label"],
                "feasible": option["feasible"],
                "score": option["score"],
                "average_weight_utilization": option["average_weight_utilization"],
                "average_length_utilization": option["average_length_utilization"],
                "cost_index": option["total_cost_index"],
                "counts": option["counts"],
                "unplaced": option["unplaced"],
                "containers": option["containers"],
            }
            for option in options
        ],
        "containers": preferred["containers"],
    }


def placement_dimensions(crate: Dict[str, Any], rotated: bool) -> Dict[str, float]:
    if rotated:
        return {
            "length": float(crate.get("external_width", 0.0) or 0.0),
            "width": float(crate.get("external_length", 0.0) or 0.0),
        }
    return {
        "length": float(crate.get("external_length", 0.0) or 0.0),
        "width": float(crate.get("external_width", 0.0) or 0.0),
    }


def overlaps(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    return not (
        a["x"] + a["length"] <= b["x"]
        or b["x"] + b["length"] <= a["x"]
        or a["y"] + a["width"] <= b["y"]
        or b["y"] + b["width"] <= a["y"]
    )


def build_balance_from_placements(placements: List[Dict[str, Any]], max_length: float, max_width: float, used_weight: float) -> Dict[str, float]:
    if not placements or used_weight <= 0:
        return {
            "left_right_delta_pct": 0.0,
            "front_rear_delta_pct": 0.0,
            "left_weight": 0.0,
            "right_weight": 0.0,
            "front_weight": 0.0,
            "rear_weight": 0.0,
        }

    left_weight = right_weight = front_weight = rear_weight = 0.0
    for placement in placements:
        center_x = placement["x"] + placement["length"] / 2.0
        center_y = placement["y"] + placement["width"] / 2.0
        weight = placement["weight"]
        if center_y <= max_width / 2.0:
            left_weight += weight
        else:
            right_weight += weight
        if center_x <= max_length / 2.0:
            front_weight += weight
        else:
            rear_weight += weight

    return {
        "left_right_delta_pct": round(abs(left_weight - right_weight) / used_weight * 100.0, 1),
        "front_rear_delta_pct": round(abs(front_weight - rear_weight) / used_weight * 100.0, 1),
        "left_weight": round(left_weight, 1),
        "right_weight": round(right_weight, 1),
        "front_weight": round(front_weight, 1),
        "rear_weight": round(rear_weight, 1),
    }


def container_shape_from_manual(container_data: Dict[str, Any], crate_map: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    type_key = container_data.get("type", "40ft")
    if type_key not in CONTAINER_LIBRARY:
        type_key = "40ft"
    spec = CONTAINER_LIBRARY[type_key]
    placements: List[Dict[str, Any]] = []
    warnings: List[str] = []
    seen_crates = set()

    raw_placements = sorted(container_data.get("placements", []), key=lambda row: row.get("loading_order", 999))
    for index, raw in enumerate(raw_placements):
        crate_id = raw.get("crate_id")
        crate = crate_map.get(crate_id)
        if not crate:
            warnings.append(f"{crate_id or 'Unknown crate'} is not available in the current crate plan")
            continue
        if crate_id in seen_crates:
            warnings.append(f"{crate_id} is listed more than once in manual onboarding")
            continue

        rotated = bool(raw.get("rotated", False))
        dims = placement_dimensions(crate, rotated)
        stack_level = int(raw.get("stack_level", 0) or 0)
        placement = {
            "crate_id": crate["crate_id"],
            "name": crate["name"],
            "destination_group": crate.get("destination_group"),
            "x": round(float(raw.get("x", 0.0) or 0.0), 1),
            "y": round(float(raw.get("y", 0.0) or 0.0), 1),
            "length": round(dims["length"], 1),
            "width": round(dims["width"], 1),
            "weight": round(float(crate.get("gross_weight", crate.get("total_weight", 0.0)) or 0.0), 1),
            "net_weight": round(float(crate.get("total_weight", 0.0) or 0.0), 1),
            "rotated": rotated,
            "fill_percent": crate.get("fill_percent"),
            "efficiency_status": crate.get("efficiency_status"),
            "loading_order": int(raw.get("loading_order", index + 1) or (index + 1)),
            "unload_order": int(raw.get("unload_order", max(1, len(raw_placements) - index)) or max(1, len(raw_placements) - index)),
            "stackable": crate.get("stackable", False),
            "locked": crate.get("locked", False),
            "stack_level": stack_level,
        }

        if placement["x"] < 0 or placement["y"] < 0 or placement["x"] + placement["length"] > spec["max_length"] or placement["y"] + placement["width"] > spec["max_width"]:
            warnings.append(f"{crate_id} is outside {type_key} bounds")

        for other in placements:
            if placement["stack_level"] != other.get("stack_level", 0):
                continue
            if overlaps(placement, other):
                warnings.append(f"{crate_id} overlaps {other['crate_id']}")

        seen_crates.add(crate_id)
        placements.append(placement)

    used_weight = round(sum(placement["weight"] for placement in placements), 1)
    used_length = round(max((placement["x"] + placement["length"]) for placement in placements), 1) if placements else 0.0
    weight_utilization = round((used_weight / spec["max_weight"]) * 100.0, 1) if spec["max_weight"] else 0.0
    length_utilization = round((used_length / spec["max_length"]) * 100.0, 1) if spec["max_length"] else 0.0
    balance = build_balance_from_placements(placements, spec["max_length"], spec["max_width"], used_weight)
    if weight_utilization > 100:
        warnings.append("Container is overweight")
    if balance["left_right_delta_pct"] > 15:
        warnings.append("Left/right balance needs adjustment")
    if balance["front_rear_delta_pct"] > 18:
        warnings.append("Front/rear balance needs adjustment")

    return {
        "id": container_data.get("id") or f"MANUAL-{type_key.upper()}",
        "type": type_key,
        "used_weight": used_weight,
        "max_weight": spec["max_weight"],
        "used_length": used_length,
        "max_length": spec["max_length"],
        "max_width": spec["max_width"],
        "weight_utilization": weight_utilization,
        "length_utilization": length_utilization,
        "balance": balance,
        "warnings": warnings,
        "empty_spaces": [],
        "zones": {
            "front_wall": {"x": 0.0, "label": "Front wall"},
            "door_zone": {"x": round(spec["max_length"] - 12.0, 1), "length": 12.0, "label": "Door working zone"},
            "centerline": round(spec["max_width"] / 2.0, 1),
        },
        "placements": placements,
    }


def summarize_containers(containers: List[Dict[str, Any]]) -> Dict[str, Any]:
    counts = {"20ft": 0, "40ft": 0}
    for container in containers:
        counts[container["type"]] += 1

    if counts["20ft"] and counts["40ft"]:
        mode_label = f"{counts['40ft']} x 40ft + {counts['20ft']} x 20ft"
        recommended_key = "mixed"
    elif counts["20ft"]:
        mode_label = f"{counts['20ft']} x 20ft"
        recommended_key = "20ft"
    elif counts["40ft"]:
        mode_label = f"{counts['40ft']} x 40ft"
        recommended_key = "40ft"
    else:
        mode_label = "No containers"
        recommended_key = "none"

    average_weight_utilization = round(
        sum(container.get("weight_utilization", 0.0) for container in containers) / len(containers),
        1,
    ) if containers else 0.0
    average_length_utilization = round(
        sum(container.get("length_utilization", 0.0) for container in containers) / len(containers),
        1,
    ) if containers else 0.0
    total_cost_index = round(
        sum(CONTAINER_LIBRARY.get(container["type"], CONTAINER_LIBRARY["40ft"])["cost_index"] for container in containers),
        2,
    )
    return {
        "counts": counts,
        "mode_label": mode_label,
        "recommended_key": recommended_key,
        "average_weight_utilization": average_weight_utilization,
        "average_length_utilization": average_length_utilization,
        "cost_index": total_cost_index,
    }


def build_manual_container_plan(crates: List[Dict[str, Any]], manual_plan: Dict[str, Any], preferred_mode: str | None = None) -> Dict[str, Any]:
    crate_map = {crate["crate_id"]: crate for crate in crates}
    manual_containers = [container_shape_from_manual(container, crate_map) for container in manual_plan.get("containers", [])]
    placed_crate_ids = {placement["crate_id"] for container in manual_containers for placement in container.get("placements", [])}
    remaining_crates = [crate for crate in crates if crate["crate_id"] not in placed_crate_ids]
    auto_remaining = build_auto_container_plan(remaining_crates, preferred_mode=preferred_mode) if remaining_crates else {
        "summary": {"total_20ft": 0, "total_40ft": 0, "total_containers": 0},
        "recommendation": {"recommended": "none", "booking_action": "", "reason": "", "alternatives": [], "cost_index": 0.0, "mode_label": ""},
        "options": [],
        "containers": [],
    }

    combined_containers = manual_containers + auto_remaining["containers"]
    summary = summarize_containers(combined_containers)
    unplaced = [crate["crate_id"] for crate in remaining_crates if all(
        crate["crate_id"] != placement["crate_id"]
        for container in auto_remaining["containers"]
        for placement in container.get("placements", [])
    )]

    recommendation_reason = (
        "Manual container onboarding overrides are active. Review placement warnings, balance, and any auto-added overflow containers before releasing to labour."
    )
    alternatives = auto_remaining["recommendation"].get("alternatives", [])
    if unplaced:
        alternatives = [f"Unplaced crates need review: {', '.join(unplaced)}"] + alternatives

    return {
        "summary": {
            "total_20ft": summary["counts"]["20ft"],
            "total_40ft": summary["counts"]["40ft"],
            "total_containers": len(combined_containers),
            "average_weight_utilization": summary["average_weight_utilization"],
            "average_length_utilization": summary["average_length_utilization"],
        },
        "recommendation": {
            "recommended": "manual",
            "booking_action": build_booking_action({"counts": summary["counts"]}),
            "reason": recommendation_reason,
            "alternatives": alternatives,
            "cost_index": summary["cost_index"],
            "mode_label": summary["mode_label"],
        },
        "options": [
            {
                "mode": "manual",
                "label": summary["mode_label"],
                "feasible": len(unplaced) == 0 and not any(container["warnings"] for container in manual_containers),
                "score": 0,
                "average_weight_utilization": summary["average_weight_utilization"],
                "average_length_utilization": summary["average_length_utilization"],
                "cost_index": summary["cost_index"],
                "counts": summary["counts"],
                "unplaced": unplaced,
            }
        ] + auto_remaining["options"],
        "containers": combined_containers,
    }


def build_container_plan(
    crates: List[Dict[str, Any]],
    manual_plan: Dict[str, Any] | None = None,
    preferred_mode: str | None = None,
) -> Dict[str, Any]:
    if manual_plan and manual_plan.get("containers"):
        return build_manual_container_plan(crates, manual_plan, preferred_mode=preferred_mode)
    return build_auto_container_plan(crates, preferred_mode=preferred_mode)
