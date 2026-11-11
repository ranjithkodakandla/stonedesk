import { describe, it, expect } from 'vitest';
import { buildSlab3DLayout, PIECE_GAP_IN, ROW_GAP_IN } from './crate3dLayout';

const scenarioGRows = [
  ...Array.from({ length: 6 }, (_, i) => ({
    row: i + 1,
    dimensions: [{ piece_id: `s${i}`, length: 79 }],
    slot_thickness_in: 1.18, standing_height_in: 25.5,
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    row: i + 7,
    dimensions: [{ piece_id: `l${i}`, length: 49 }, { piece_id: `t${i}`, length: 19 }],
    slot_thickness_in: 1.18, standing_height_in: 25.5,
  })),
];

describe('buildSlab3DLayout', () => {
  it('produces one slab box per piece (18 total for the reference fixture)', () => {
    const { slabs } = buildSlab3DLayout(scenarioGRows);
    expect(slabs).toHaveLength(18);
  });

  it('places single-piece rows at X=0, and a shared row\'s two pieces end to end along X', () => {
    const { slabs } = buildSlab3DLayout(scenarioGRows);
    const row7 = slabs.filter((s) => s.row === 7);
    expect(row7).toHaveLength(2);
    expect(row7[0].xIn).toBe(0);
    expect(row7[1].xIn).toBe(row7[0].lengthIn + PIECE_GAP_IN);
  });

  it('stacks rows along Z in sequence, each at the previous Z plus its thickness and a gap', () => {
    const { slabs } = buildSlab3DLayout(scenarioGRows);
    const byRow = {};
    slabs.forEach((s) => { byRow[s.row] = s.zIn; });
    expect(byRow[1]).toBe(0);
    expect(byRow[2]).toBeCloseTo(1.18 + ROW_GAP_IN, 5);
    expect(byRow[3]).toBeCloseTo(2 * (1.18 + ROW_GAP_IN), 5);
  });

  it('computes total depth as the sum of all row thicknesses and gaps minus the trailing gap', () => {
    const { totalDepthIn } = buildSlab3DLayout(scenarioGRows);
    expect(totalDepthIn).toBeCloseTo(12 * 1.18 + 11 * ROW_GAP_IN, 5);
  });

  it('returns an empty layout for no rows', () => {
    expect(buildSlab3DLayout([])).toEqual({ slabs: [], totalDepthIn: 0 });
  });
});
