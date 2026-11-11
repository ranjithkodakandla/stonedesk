// Mirrors backend/app/services/planner_v3/dimensions.py's
// group_main_pieces_into_rows + _consolidate_same_length_leftovers exactly
// — keep both in sync manually. Pieces stand upright, leaning side by side
// in a "row" (one thickness-slot); a row can hold more than one piece when
// they fit end to end within the row's usable length.
export const ROW_PIECE_GAP_IN = 1.0;   // clearance between two pieces sharing one row
export const ROW_SEPARATOR_IN = 0.75;  // foam between rows stacked along the crate's width

const pieceLength = (p) => Number(p.length) || 0;
const roundLen = (n) => Math.round(n * 1000) / 1000;

export const rowRawLength = (row) => {
  const total = row.reduce((s, p) => s + pieceLength(p), 0);
  return total + Math.max(0, row.length - 1) * ROW_PIECE_GAP_IN;
};

const isHomogeneous = (row) => new Set(row.map((p) => roundLen(pieceLength(p)))).size === 1;

// Phase B: a piece left alone in its own row (because the Phase-A cap
// blocked it from joining pieces of its own exact length) folds into an
// existing row made ENTIRELY of that same length, even past the cap —
// three identical 25" pieces become one row of 75" instead of a pair plus
// an awkward leftover single. This never merges rows just to cut the row
// count: it only extends a row that ALREADY combined >=2 pieces of one
// exact length with another piece of that same length. Six identical 79"
// pieces that never paired up in Phase A (each already its own singleton)
// stay six separate rows — there's no multi-piece 79" row to extend them
// into, so nothing here merges them.
const consolidateSameLengthLeftovers = (rowsIn) => {
  const rows = rowsIn.map((r) => [...r]);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.length !== 1) continue;
      const singletonLen = roundLen(pieceLength(row[0]));
      const targetIdx = rows.findIndex((other, j) => (
        j !== i && other.length >= 2 && isHomogeneous(other) && roundLen(pieceLength(other[0])) === singletonLen
      ));
      if (targetIdx !== -1) {
        rows[targetIdx] = [...rows[targetIdx], row[0]];
        rows.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return rows;
};

// Greedy largest-first (Phase A), then same-length-leftover consolidation
// (Phase B). See the backend docstring for the full reasoning.
export const groupPiecesIntoRows = (pieces, usableLength) => {
  if (!pieces || !pieces.length) return [];
  const remaining = [...pieces].sort((a, b) => pieceLength(b) - pieceLength(a));
  const rows = [];
  while (remaining.length) {
    const row = [remaining.shift()];
    let rowLength = pieceLength(row[0]);
    let i = 0;
    while (i < remaining.length) {
      const candidateLength = pieceLength(remaining[i]);
      if (rowLength + ROW_PIECE_GAP_IN + candidateLength <= usableLength) {
        row.push(remaining.splice(i, 1)[0]);
        rowLength += ROW_PIECE_GAP_IN + candidateLength;
      } else {
        i += 1;
      }
    }
    rows.push(row);
  }
  return consolidateSameLengthLeftovers(rows);
};
