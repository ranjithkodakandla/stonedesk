from typing import List, Dict, Tuple
from ..models import Piece
from .calculator import calculate_weight

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