from typing import List, Dict, Tuple
from ..models import Piece
from .calculator import calculate_weight

def estimate_crate_dimensions(pieces: List[Piece], material: str, thickness: str, max_weight: float) -> Dict[str, float]:
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

    lengths = [float(piece.length or 0) for piece in pieces]
    widths = [float(piece.width or 0) for piece in pieces]
    total_sqft = sum(((float(piece.length or 0) * float(piece.width or 0)) / 144.0) * int(piece.qty or 1) for piece in pieces)
    total_weight = sum(calculate_weight(piece.length, piece.width, material, thickness) * int(piece.qty or 1) for piece in pieces)
    total_qty = sum(int(piece.qty or 1) for piece in pieces)

    longest_piece = max(lengths) if lengths else 0.0
    widest_piece = max(widths) if widths else 0.0

    internal_length = max(longest_piece + 6.0, 0.0)
    internal_width = max(widest_piece + 6.0, 0.0)
    internal_height = max(
        24.0,
        18.0 + (total_qty * 1.25),
        18.0 + (total_weight / 75.0 if total_weight else 0.0),
        18.0 + (total_sqft / 18.0 if total_sqft else 0.0),
    )
    internal_height = min(internal_height, 60.0)

    return {
        "internal_length": round(internal_length, 1),
        "internal_width": round(internal_width, 1),
        "internal_height": round(internal_height, 1),
        "external_length": round(internal_length + 3.0, 1),
        "external_width": round(internal_width + 3.0, 1),
        "external_height": round(internal_height + 6.0, 1),
        "sqft": round(total_sqft, 2),
        "weight": round(total_weight, 2),
    }

def group_by_type(pieces: List[Piece], material: str, thickness: str) -> Dict[str, List[Piece]]:
    groups = {}
    for piece in pieces:
        category = piece.category
        if category not in groups:
            groups[category] = []
        groups[category].append(piece)
    return groups

def group_by_flat(pieces: List[Piece]) -> Dict[str, List[Piece]]:
    groups = {}
    for piece in pieces:
        key = f"{piece.building}-{piece.floor}-{piece.flat}"
        if key not in groups:
            groups[key] = []
        groups[key].append(piece)
    return groups

def distribute_into_crates(pieces: List[Piece], max_pieces: int = None, max_weight: float = None,
                           material: str = "Granite", thickness: str = "3CM") -> List[List[Piece]]:
    if not pieces:
        return []
    crates = []
    current_crate = []
    current_weight = 0
    for piece in pieces:
        piece_weight = calculate_weight(piece.length, piece.width, material, thickness) * piece.qty
        would_exceed_pieces = max_pieces and len(current_crate) + 1 > max_pieces
        would_exceed_weight = max_weight and current_weight + piece_weight > max_weight
        if would_exceed_pieces or would_exceed_weight:
            if current_crate:
                crates.append(current_crate)
            current_crate = [piece]
            current_weight = piece_weight
        else:
            current_crate.append(piece)
            current_weight += piece_weight
    if current_crate:
        crates.append(current_crate)
    return crates

def auto_generate_crates(pieces: List[Piece], strategy: str, max_pieces: int = None,
                         max_weight: float = None, material: str = "Granite",
                         thickness: str = "3CM") -> List[Tuple[str, List[Piece]]]:
    if strategy == "type":
        groups = group_by_type(pieces, material, thickness)
    else:
        groups = group_by_flat(pieces)
    
    all_crates = []
    for group_name, group_pieces in groups.items():
        crate_batches = distribute_into_crates(group_pieces, max_pieces, max_weight, material, thickness)
        for batch_idx, batch in enumerate(crate_batches, 1):
            if len(crate_batches) > 1:
                crate_name = f"{group_name} Batch {batch_idx}"
            else:
                crate_name = group_name
            all_crates.append((crate_name, batch))
    return all_crates
