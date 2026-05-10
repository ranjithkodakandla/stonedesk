from typing import Any, Dict, List, Tuple

from ..planning_engine import sortable_token


def _negate_token(tok: Tuple[int, Any]) -> Tuple[int, Any]:
    kind, val = tok
    if kind == 0 and isinstance(val, int):
        return (0, -val)
    if kind == 1 and isinstance(val, str):
        return (1, "".join(chr(max(0, 0x10FFFF - ord(c))) for c in val[:20]))
    return tok


def sort_pieces_by_dispatch(
    pieces: List[Dict[str, Any]],
    dispatch_selection: Dict[str, Any],
) -> List[Dict[str, Any]]:
    if not dispatch_selection:
        return sorted(
            pieces,
            key=lambda p: (
                sortable_token(p.get("building")),
                sortable_token(p.get("floor")),
                sortable_token(p.get("flat")),
            ),
        )

    buildings = dispatch_selection.get("buildings") or ["all"]
    floors = dispatch_selection.get("floors") or ["all"]
    flats = dispatch_selection.get("flats") or ["all"]
    ordering = dispatch_selection.get("ordering") or {}
    b_ord = ordering.get("building", "asc")
    f_ord = ordering.get("floor", "asc")
    fl_ord = ordering.get("flat", "asc")

    def passes_filter(p: Dict[str, Any]) -> bool:
        b = str(p.get("building", "") or "").strip()
        f = str(p.get("floor", "") or "").strip()
        fl = str(p.get("flat", "") or "").strip()
        if "all" not in buildings and b not in set(buildings):
            return False
        if "all" not in floors and f not in set(floors):
            return False
        if "all" not in flats and fl not in set(flats):
            return False
        return True

    filtered = [p for p in pieces if passes_filter(p)]

    def sort_key(p: Dict[str, Any]) -> Tuple:
        bt = sortable_token(p.get("building"))
        ft = sortable_token(p.get("floor"))
        flt = sortable_token(p.get("flat"))
        if b_ord == "desc":
            bt = _negate_token(bt)
        if f_ord == "desc":
            ft = _negate_token(ft)
        if fl_ord == "desc":
            flt = _negate_token(flt)
        return (bt, ft, flt)

    return sorted(filtered, key=sort_key)


def dispatch_group_label(piece: Dict[str, Any], basis: str) -> str:
    b = str(piece.get("building", "") or "").strip()
    f = str(piece.get("floor", "") or "").strip()
    fl = str(piece.get("flat", "") or "").strip()
    if basis == "building":
        return b or "Unassigned"
    if basis == "floor":
        return " / ".join(x for x in [b, f] if x) or "Unassigned"
    return " / ".join(x for x in [b, f, fl] if x) or "Unassigned"
