import { describe, it, expect } from 'vitest';
import {
  estimateLeaningFamilyBundleDimensions,
  CRATE_INTERNAL_WIDTH_MIN_IN,
  CRATE_INTERNAL_WIDTH_MAX_IN,
  weightBatchParts,
  rebalanceBatchesEvenly,
} from './crateEstimator';

function main(length, width, thickness = '3CM') {
  return { length, width, thickness, part: 'Top' };
}

describe('estimateLeaningFamilyBundleDimensions width band', () => {
  it('floors internal width to 10" when the raw row-thickness stack is very thin', () => {
    const dims = estimateLeaningFamilyBundleDimensions([main(40, 20, '2CM')]);
    expect(dims.internal_width).toBe(CRATE_INTERNAL_WIDTH_MIN_IN);
  });

  it('grows the row-length budget to merge more pieces per row, pulling width down even when it cannot reach the band', () => {
    // 20 pieces of 29" plus one 30" piece. At the base row-length budget
    // (30"), two 29s don't fit a row together (29+1+29=59 > 30), so every
    // 29" piece gets its own row -> 21 rows. Growing the budget to the sum
    // of the two distinct lengths (30+1+29=60) lets pairs of 29s share a
    // row (10 pairs + the 30 = 11 rows), a real improvement even though
    // this crate's own foam-gap-per-row model still leaves width above 26"
    // here (reported honestly, with a warning, rather than clamped).
    const pieces = [main(30, 25, '4CM'), ...Array.from({ length: 20 }, () => main(29, 25, '4CM'))];
    const dims = estimateLeaningFamilyBundleDimensions(pieces);

    const noGrowthWidth = 21 * parseFloat((1.57).toFixed(2)) + 20 * 1 + 4; // 21 singleton rows, no merging
    expect(dims.internal_width).toBeLessThan(noGrowthWidth);
    expect(dims.warnings.some((w) => w.includes('26'))).toBe(true);
  });

  it('reports the true width with a warning instead of silently clamping when pieces cannot merge at all', () => {
    // 20 identical 90"-long pieces never share a row — there's no distinct
    // shorter length to combine them into, so growing the budget can't
    // reduce row count.
    const pieces = Array.from({ length: 20 }, () => main(90, 30, '4CM'));
    const dims = estimateLeaningFamilyBundleDimensions(pieces);
    expect(dims.internal_width).toBeGreaterThan(CRATE_INTERNAL_WIDTH_MAX_IN);
    expect(dims.warnings.some((w) => w.includes('26'))).toBe(true);
  });
});

describe('weightBatchParts evenly redistributes across however many crates the cap requires', () => {
  const piece = (id, weightKg) => ({ id, weight_kg: weightKg });

  it('splits 36 equal-weight pieces into four even crates of 9, not 10+10+10+6', () => {
    // Confirmed against the real packing list: a building with 36 island
    // pieces at ~257.5kg each needs 4 crates under a 2600kg cap (10/crate
    // max), and the fabricator spreads them evenly (9 each) rather than
    // maxing out the first three crates and leaving a small leftover.
    const parts = Array.from({ length: 36 }, (_, i) => piece(`p${i}`, 257.5));
    const batches = weightBatchParts(parts, 2600, 0);
    expect(batches.map((b) => b.length)).toEqual([9, 9, 9, 9]);
  });

  it('keeps the plain greedy result when only one crate is needed', () => {
    const parts = Array.from({ length: 10 }, (_, i) => piece(`p${i}`, 150));
    const batches = weightBatchParts(parts, 2600, 0);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(10);
  });

  it('falls back to the greedy split when an even split would breach the cap', () => {
    // One very heavy piece mixed with many light ones: an even 2-way split
    // would put the heavy piece in a group that overflows the cap, so the
    // original greedy batches (which never breach it) must be kept instead.
    const parts = [piece('heavy', 2000), ...Array.from({ length: 5 }, (_, i) => piece(`l${i}`, 400))];
    const cap = 2200;
    const batches = weightBatchParts(parts, cap, 0);
    for (const b of batches) {
      expect(b.reduce((s, p) => s + p.weight_kg, 0)).toBeLessThanOrEqual(cap);
    }
  });
});

describe('rebalanceBatchesEvenly', () => {
  it('returns null when only one batch is requested (nothing to rebalance)', () => {
    expect(rebalanceBatchesEvenly([{ id: 1 }], 1, () => true)).toBeNull();
  });

  it('returns null when there are fewer items than batches', () => {
    expect(rebalanceBatchesEvenly([{ id: 1 }], 2, () => true)).toBeNull();
  });

  it('distributes any remainder across the first few batches', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const batches = rebalanceBatchesEvenly(items, 3, () => true);
    expect(batches.map((b) => b.length)).toEqual([4, 3, 3]);
  });
});
