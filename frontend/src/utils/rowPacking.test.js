import { describe, it, expect } from 'vitest';
import { groupPiecesIntoRows, rowRawLength, MAX_PIECES_PER_ROW } from './rowPacking';

const referenceRows18 = () => {
  const pieces = [];
  for (let i = 0; i < 6; i += 1) pieces.push({ id: `single-${i}`, length: 79, width: 25.5, thickness: '3CM' });
  for (let i = 0; i < 6; i += 1) {
    pieces.push({ id: `pair-${i}-long`, length: 49, width: 25.5, thickness: '3CM' });
    pieces.push({ id: `pair-${i}-short`, length: 19, width: 25.5, thickness: '3CM' });
  }
  return pieces;
};

const filler = (p) => ({ ...p, _crateBucketOverride: 1 });

describe('groupPiecesIntoRows (pair-by-matching-length, filler-tops-off, cap 3 per row)', () => {
  // Confirmed against the real packing list across 8 crates / 336 physical
  // rows: no row ever exceeds 3 pieces, and every multi-piece row either
  // pairs two pieces of matching length or (only once nothing else is left)
  // groups leftover same-length pieces together.

  it('pairs the 6 identical 79" pieces among themselves (no partner of any other length)', () => {
    const pieces = referenceRows18();
    const rows = groupPiecesIntoRows(pieces);
    // 6x79 pair up into 3 rows of [79,79]; 6x49 + 6x19 pair up by matching
    // length into 6 rows of [49,49] and ... wait, 49 and 19 are different
    // lengths, so 49s pair with 49s (3 rows) and 19s pair with 19s (3 rows).
    const allIds = rows.flat().map((p) => p.id);
    expect(new Set(allIds).size).toBe(18);
    expect(rows.every((r) => r.length <= MAX_PIECES_PER_ROW)).toBe(true);
    // No row mixes a 79 with a 49 or 19 — none of them are marked as filler,
    // so they only ever pair with their own exact length.
    rows.forEach((row) => {
      const lengths = new Set(row.map((p) => p.length));
      expect(lengths.size).toBe(1);
    });
  });

  it('a filler piece tops off an open pair-row before pairing with its own kind', () => {
    // Mirrors the real case: two 24.5" pieces pair up (primary), leaving an
    // open row needing one more; an 18.5" filler (demoted companion) tops
    // it off instead of waiting to pair with another 18.5" filler.
    const pieces = [
      { id: 'a', length: 24.5 }, { id: 'b', length: 24.5 },
      filler({ id: 'c', length: 18.5 }),
    ];
    const rows = groupPiecesIntoRows(pieces);
    expect(rows).toHaveLength(1);
    expect(rows[0].map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('reproduces the real crate-3 pattern: 2 big pairs use up fillers one each, leftover fillers group by threes', () => {
    // 4 pairs of a big length (8 pieces) each need 1 filler; 10 filler
    // pieces of a smaller length are available — 4 get used as toppers,
    // 6 remain and group into 2 rows of 3.
    const big = Array.from({ length: 8 }, (_, i) => ({ id: `big${i}`, length: 24.5 }));
    const small = Array.from({ length: 10 }, (_, i) => filler({ id: `small${i}`, length: 18.5 }));
    const rows = groupPiecesIntoRows([...big, ...small]);
    expect(rows.every((r) => r.length <= MAX_PIECES_PER_ROW)).toBe(true);
    const threes = rows.filter((r) => r.length === 3);
    expect(threes).toHaveLength(4 + 2); // 4 topped-off big pairs + 2 leftover filler triples
    const allIds = rows.flat().map((p) => p.id);
    expect(new Set(allIds).size).toBe(18);
  });

  it('never merges two dissimilar pieces with each other when neither is marked filler', () => {
    const pieces = [{ id: 'big', length: 67 }, { id: 'odd', length: 19 }];
    const rows = groupPiecesIntoRows(pieces);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.length === 1)).toBe(true);
  });

  it('groups many identical non-filler pieces 2 at a time, never 3+, when nothing marks them as filler', () => {
    // Without an explicit filler marker, same-length pieces only pair (cap
    // 2) — they don't greedily batch into triples just because they share
    // a length; a triple only happens via the filler-topping path.
    const pieces = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, length: 15 }));
    const rows = groupPiecesIntoRows(pieces);
    expect(rows).toHaveLength(3); // 2 pairs + 1 singleton
    const sizes = rows.map((r) => r.length).sort();
    expect(sizes).toEqual([1, 2, 2]);
  });

  it('never exceeds the 3-piece cap even with many filler pieces available', () => {
    const big = [{ id: 'a', length: 30 }, { id: 'b', length: 30 }];
    const fillers = Array.from({ length: 10 }, (_, i) => filler({ id: `f${i}`, length: 5 }));
    const rows = groupPiecesIntoRows([...big, ...fillers]);
    expect(rows.every((r) => r.length <= MAX_PIECES_PER_ROW)).toBe(true);
  });

  it('computes raw row length as the sum of piece lengths plus a 1" gap between each', () => {
    const pieces = [{ id: 'a', length: 24.5 }, { id: 'b', length: 24.5 }, filler({ id: 'c', length: 18.5 })];
    const rows = groupPiecesIntoRows(pieces);
    expect(rowRawLength(rows[0])).toBeCloseTo(24.5 + 1 + 24.5 + 1 + 18.5, 5); // 69.5
  });

  it('returns an empty array for no pieces', () => {
    expect(groupPiecesIntoRows([])).toEqual([]);
  });
});
