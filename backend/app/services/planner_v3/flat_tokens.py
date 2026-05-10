"""
Alphanumeric flat labels: 101, 101A, 101B, 102, OVG1, OVG2, PH1, etc.
Used for sort order and adjacency (not numeric-only).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Optional, Tuple


@dataclass(frozen=True)
class FlatToken:
    """Canonical parsed flat id for sorting and adjacency."""

    prefix: str  # leading letters (upper), may be empty
    number: int  # primary numeric stem
    suffix: str  # trailing letters (upper), may be empty
    raw: str  # original trimmed string for tie-break / display


_FLAT_RE = re.compile(r"^\s*([A-Za-z]*)(\d+)([A-Za-z]*)\s*$")


def parse_flat_label(s: Any) -> Optional[FlatToken]:
    t = str(s or "").strip()
    if not t:
        return None
    m = _FLAT_RE.match(t)
    if m:
        return FlatToken(
            prefix=m.group(1).upper(),
            number=int(m.group(2)),
            suffix=m.group(3).upper(),
            raw=t,
        )
    # No clean stem+digits: treat whole token as opaque (still sortable)
    return FlatToken(prefix="", number=0, suffix="", raw=t.upper())


def flat_sort_key(s: Any) -> Tuple:
    tok = parse_flat_label(s)
    if not tok:
        return (2, "", 0, "", "")
    if tok.prefix == "" and tok.number == 0 and tok.suffix == "" and tok.raw:
        return (1, tok.raw, 0, "", "")
    return (0, tok.prefix, tok.number, tok.suffix, tok.raw)


def flats_are_adjacent(a: Any, b: Any) -> bool:
    """True when two flat labels are neighbors within the same letter+number series."""
    ta, tb = parse_flat_label(a), parse_flat_label(b)
    if not ta or not tb:
        return False
    # Opaque tokens: only exact match handled elsewhere; no adjacency inference
    if ta.prefix == "" and ta.number == 0 and ta.suffix == "":
        return False
    if tb.prefix == "" and tb.number == 0 and tb.suffix == "":
        return False
    if ta.prefix != tb.prefix:
        return False
    if ta.number == tb.number:
        if ta.suffix == tb.suffix:
            return False
        # 101 vs 101A
        if ta.suffix == "" and len(tb.suffix) == 1:
            return True
        if tb.suffix == "" and len(ta.suffix) == 1:
            return True
        # 101A vs 101B
        if len(ta.suffix) == 1 and len(tb.suffix) == 1:
            return abs(ord(ta.suffix) - ord(tb.suffix)) == 1
        # Longer suffixes: single-char edit adjacent (e.g. AA vs AB)
        if ta.suffix and tb.suffix and len(ta.suffix) == len(tb.suffix):
            diffs = sum(1 for x, y in zip(ta.suffix, tb.suffix) if x != y)
            if diffs == 1:
                i = next(i for i, (x, y) in enumerate(zip(ta.suffix, tb.suffix)) if x != y)
                return abs(ord(ta.suffix[i]) - ord(tb.suffix[i])) == 1
        return False
    # Different numbers, same prefix, no suffix on either → 101 vs 102, OVG1 vs OVG2
    if ta.suffix == "" and tb.suffix == "" and abs(ta.number - tb.number) == 1:
        return True
    return False
