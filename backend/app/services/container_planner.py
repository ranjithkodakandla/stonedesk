from typing import List, Dict, Any

class Rect:
    def __init__(self, x: float, y: float, w: float, l: float, crate: Dict[str, Any]):
        self.x = x
        self.y = y
        self.w = w  # Width (along y-axis)
        self.l = l  # Length (along x-axis)
        self.crate = crate

class Container:
    def __init__(self, id_str: str, max_length: float = 470.0, max_width: float = 92.0, max_weight: float = 28000.0):
        self.id = id_str
        self.max_length = max_length
        self.max_width = max_width
        self.max_weight = max_weight
        self.current_weight = 0.0
        self.placements: List[Rect] = []
        self.type = "40ft"
        
        # A simple shelf packing approach
        self.shelves = [] # list of dicts: {'x_start': float, 'width_used': float, 'length': float}

    def can_fit_in_shelf(self, shelf: dict, w: float, l: float) -> bool:
        if shelf['width_used'] + w <= self.max_width and l <= shelf['length']:
            return True
        return False
        
    def add_to_shelf(self, shelf: dict, w: float, l: float, crate: Dict[str, Any]) -> Rect:
        rect = Rect(shelf['x_start'], shelf['width_used'], w, l, crate)
        shelf['width_used'] += w
        self.placements.append(rect)
        self.current_weight += crate.get('total_weight', 0)
        return rect

    def try_add(self, crate: Dict[str, Any]) -> bool:
        weight = crate.get('total_weight', 0)
        if self.current_weight + weight > self.max_weight:
            return False

        ext_l = float(crate.get('external_length', 0))
        ext_w = float(crate.get('external_width', 0))

        # Try both orientations (l x w) and (w x l)
        orientations = [(ext_l, ext_w), (ext_w, ext_l)]
        
        for shelf in self.shelves:
            for l, w in orientations:
                if self.can_fit_in_shelf(shelf, w, l):
                    self.add_to_shelf(shelf, w, l, crate)
                    return True
                    
        # If no shelf can fit, try to create a new shelf
        current_x = sum(s['length'] for s in self.shelves)
        
        for l, w in orientations:
            if current_x + l <= self.max_length and w <= self.max_width:
                # Create new shelf
                new_shelf = {'x_start': current_x, 'width_used': w, 'length': l}
                self.shelves.append(new_shelf)
                self.add_to_shelf(new_shelf, w, l, crate)
                return True

        return False

    def finalize_type(self):
        # Check if it fits in 20ft
        total_length_used = sum(s['length'] for s in self.shelves)
        if total_length_used <= 232.0 and self.current_weight <= 28000.0:
            self.type = "20ft"
            self.max_length = 232.0

    def get_placements_data(self) -> List[Dict[str, Any]]:
        return [
            {
                "crate_id": p.crate.get("crate_id"),
                "name": p.crate.get("name"),
                "x": round(p.x, 1),
                "y": round(p.y, 1),
                "width": round(p.w, 1),
                "length": round(p.l, 1),
                "weight": round(p.crate.get("total_weight", 0), 1),
                "rotated": p.w != p.crate.get("external_width")
            } for p in self.placements
        ]

def build_container_plan(crates: List[Dict[str, Any]]) -> Dict[str, Any]:
    # Sort crates by length descending to optimize packing
    sorted_crates = sorted(crates, key=lambda c: max(c.get('external_length', 0), c.get('external_width', 0)), reverse=True)
    
    containers: List[Container] = []
    
    for crate in sorted_crates:
        placed = False
        for container in containers:
            if container.try_add(crate):
                placed = True
                break
        
        if not placed:
            new_container = Container(id_str=f"CONT-{len(containers)+1:03d}")
            if not new_container.try_add(crate):
                # If a single crate is larger than 40ft container limits, we just have to log/ignore it, but for now we push it anyway for edge case
                pass
            containers.append(new_container)
            
    # Finalize types
    for container in containers:
        container.finalize_type()
        
    total_20ft = sum(1 for c in containers if c.type == "20ft")
    total_40ft = sum(1 for c in containers if c.type == "40ft")
    
    return {
        "summary": {
            "total_20ft": total_20ft,
            "total_40ft": total_40ft,
            "total_containers": len(containers)
        },
        "containers": [
            {
                "id": c.id,
                "type": c.type,
                "used_weight": round(c.current_weight, 1),
                "max_weight": c.max_weight,
                "used_length": round(sum(s['length'] for s in c.shelves), 1),
                "max_length": c.max_length,
                "max_width": c.max_width,
                "placements": c.get_placements_data()
            }
            for c in containers
        ]
    }
