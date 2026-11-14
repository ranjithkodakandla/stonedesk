// Pieces stand upright, leaning side by side in a "row" (one thickness-slot);
// a row can hold more than one piece. Confirmed against the real packing
// list across 8 crates / 336 physical rows, zero exceptions:
//   - a row never holds more than MAX_PIECES_PER_ROW pieces
//   - every multi-piece row either pairs two pieces of matching length, or
//     (only once nothing else was left to pair with) groups leftover pieces
//     of one shared length together
//   - a piece already identified as filler/companion material (see
//     withIslandFamilyOverrides' _crateBucketOverride) is used to top off
//     an existing row before it's ever paired with another piece of its own
//     kind — it's leftover accessory stock, not the primary product
export const ROW_PIECE_GAP_IN = 1.0;   // clearance between two pieces sharing one row
export const ROW_SEPARATOR_IN = 0.75;  // foam between rows stacked along the crate's width
export const MAX_PIECES_PER_ROW = 3;

// A real structural limit on a single row's raw length (sum of piece
// lengths plus the gaps between them), separate from the piece-count cap —
// two 79" pieces sharing a row would be a 159" row, which is never built
// even though it's only 2 pieces. Pairing/chunking below never crosses it.
export const ROW_RAW_LENGTH_MAX_IN = 100.0;

const pieceLength = (p) => Number(p.length) || 0;
const roundLen = (n) => Math.round(n * 1000) / 1000;
const isFillerPiece = (p) => p._crateBucketOverride != null;

export const rowRawLength = (row) => {
  const total = row.reduce((s, p) => s + pieceLength(p), 0);
  return total + Math.max(0, row.length - 1) * ROW_PIECE_GAP_IN;
};

// Crate internal width must stay within the fabricator's standard crate
// stock — mirrors CRATE_INTERNAL_WIDTH_MIN_IN / CRATE_INTERNAL_WIDTH_MAX_IN
// in backend/app/services/planner_v3/dimensions.py.
export const CRATE_INTERNAL_WIDTH_MIN_IN = 10.0;
export const CRATE_INTERNAL_WIDTH_MAX_IN = 26.0;

// Groups pieces by exact length, then chunks each length's own pieces into
// rows of at most `chunkSize` — never crossing two different lengths into
// the same chunk, and never letting a row's raw length exceed
// ROW_RAW_LENGTH_MAX_IN even if `chunkSize` would otherwise allow more
// pieces in (two 79" pieces make a 159" row — too long — so they stay
// singletons even though chunkSize would allow a pair). A leftover group
// with fewer pieces than fit a full chunk becomes a smaller row.
function chunkByLength(source, chunkSize, rows, openRows) {
  const byLength = new Map();
  for (const p of [...source].sort((a, b) => pieceLength(b) - pieceLength(a))) {
    const len = roundLen(pieceLength(p));
    if (!byLength.has(len)) byLength.set(len, []);
    byLength.get(len).push(p);
  }
  for (const group of byLength.values()) {
    let i = 0;
    while (i < group.length) {
      const row = [group[i]];
      i += 1;
      while (row.length < chunkSize && i < group.length
        && rowRawLength([...row, group[i]]) <= ROW_RAW_LENGTH_MAX_IN) {
        row.push(group[i]);
        i += 1;
      }
      rows.push(row);
      if (row.length < MAX_PIECES_PER_ROW) openRows.push(row);
    }
  }
}

export const groupPiecesIntoRows = (pieces) => {
  if (!pieces || !pieces.length) return [];
  const primary = pieces.filter((p) => !isFillerPiece(p));
  const filler = pieces.filter(isFillerPiece);

  const rows = [];
  const openRows = []; // FIFO — rows with < MAX_PIECES_PER_ROW pieces

  // Pass 1: primary pieces pair with their own kind, 2 at a time — never
  // more, and a leftover odd one out never grabs a piece of a different
  // length to fill its row; it just starts a smaller, still-open row.
  chunkByLength(primary, 2, rows, openRows);

  // Pass 2: filler pieces (companion/accessory material, see
  // withIslandFamilyOverrides) top off those open primary rows first,
  // oldest row first — never paired with each other while there's still an
  // open primary row to fill.
  const fillerQueue = [...filler].sort((a, b) => pieceLength(b) - pieceLength(a));
  while (fillerQueue.length && openRows.length) {
    const piece = fillerQueue[0];
    // Oldest row that can accept this filler without breaching the 100"
    // row-length cap — not always the very oldest, if that one's already
    // close to the limit.
    const idx = openRows.findIndex((row) => rowRawLength([...row, piece]) <= ROW_RAW_LENGTH_MAX_IN);
    if (idx === -1) break; // no open row can take any more filler
    const row = openRows[idx];
    row.push(fillerQueue.shift());
    if (row.length >= MAX_PIECES_PER_ROW) openRows.splice(idx, 1);
  }
  // Only once nothing is left to top off does leftover filler material
  // group among itself — up to the full row cap, not just pairs, since
  // it's no longer backing a primary piece.
  chunkByLength(fillerQueue, MAX_PIECES_PER_ROW, rows, openRows);

  return rows;
};
