import { describe, it, expect } from 'vitest';
import { groupPiecesIntoRows, rowRawLength } from './rowPacking';

const referenceRows18 = () => {
  const pieces = [];
  for (let i = 0; i < 6; i += 1) pieces.push({ id: `single-${i}`, length: 79, width: 25.5, thickness: '3CM' });
  for (let i = 0; i < 6; i += 1) {
    pieces.push({ id: `pair-${i}-long`, length: 49, width: 25.5, thickness: '3CM' });
    pieces.push({ id: `pair-${i}-short`, length: 19, width: 25.5, thickness: '3CM' });
  }
  return pieces;
};

describe('groupPiecesIntoRows (mirrors backend group_main_pieces_into_rows)', () => {
  it('reproduces the reference 18-piece drawing: 6 single rows + 6 paired rows', () => {
    const pieces = referenceRows18();
    const rows = groupPiecesIntoRows(pieces, 85);
    expect(rows).toHaveLength(12);
    const singles = rows.filter((r) => r.length === 1);
    const doubles = rows.filter((r) => r.length === 2);
    expect(singles).toHaveLength(6);
    expect(doubles).toHaveLength(6);
    doubles.forEach((row) => {
      expect(row.map((p) => p.length).sort((a, b) => a - b)).toEqual([19, 49]);
    });
    const allIds = rows.flat().map((p) => p.id);
    expect(new Set(allIds).size).toBe(18);
  });

  it('consolidates three identical leftover pieces past the original cap (67 + 3x25)', () => {
    const pieces = [
      { id: 'big', length: 67 },
      { id: 'a', length: 25 },
      { id: 'b', length: 25 },
      { id: 'c', length: 25 },
    ];
    const rows = groupPiecesIntoRows(pieces, 73); // 67 + 6 clearance, matching backend's cap convention
    expect(rows).toHaveLength(2);
    const byLen = [...rows].sort((a, b) => a.length - b.length);
    expect(byLen[0]).toHaveLength(1);
    expect(byLen[0][0].id).toBe('big');
    expect(byLen[1]).toHaveLength(3);
    expect(byLen[1].map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
    expect(rowRawLength(byLen[1])).toBeCloseTo(77, 5); // 25*3 + 2 gaps of 1"
  });

  it('never merges identical pieces that each stayed singleton in Phase A (six 79s)', () => {
    const pieces = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, length: 79 }));
    const rows = groupPiecesIntoRows(pieces, 85);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.length === 1)).toBe(true);
  });

  it('never merges two dissimilar leftover singletons with each other', () => {
    const pieces = [{ id: 'big', length: 67 }, { id: 'odd', length: 19 }];
    const rows = groupPiecesIntoRows(pieces, 73);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.length === 1)).toBe(true);
  });

  it('returns an empty array for no pieces', () => {
    expect(groupPiecesIntoRows([], 100)).toEqual([]);
  });
});
