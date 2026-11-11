import { describe, it, expect } from 'vitest';
import { fmtDim, layerLabel, buildCrossSectionLayout } from './CratePackingSchedule';

describe('CratePackingSchedule formatting helpers', () => {
  it('formats a piece dimension as length x width x thickness', () => {
    expect(fmtDim({ length: 79, width: 25.5, thickness: '3CM' })).toBe('79.0" × 25.5" × 3CM');
  });

  it('omits thickness when not provided', () => {
    expect(fmtDim({ length: 49, width: 25.5 })).toBe('49.0" × 25.5"');
  });

  it('falls back to an em dash for missing dimensions', () => {
    expect(fmtDim({})).toBe('— × —');
  });

  it('labels the main layer as Countertop', () => {
    expect(layerLabel('main')).toBe('Countertop');
  });

  it('labels numbered splash layers', () => {
    expect(layerLabel('splash_1')).toBe('Splash (layer 1)');
    expect(layerLabel('splash_2')).toBe('Splash (layer 2)');
  });
});

describe('buildCrossSectionLayout (upright slabs, matching the real packing drawing)', () => {
  const scenarioGRows = [
    ...Array.from({ length: 6 }, (_, i) => ({
      row: i + 1, layer: 'main',
      dimensions: [{ piece_id: `s${i}`, length: 79, width: 25.5 }],
      slot_thickness_in: 1.18, standing_height_in: 25.5,
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      row: i + 7, layer: 'main',
      dimensions: [{ piece_id: `l${i}`, length: 49, width: 25.5 }, { piece_id: `t${i}`, length: 19, width: 25.5 }],
      slot_thickness_in: 1.18, standing_height_in: 25.5,
    })),
  ];

  it('places one slab per row, in sequence, with no overlap', () => {
    const layout = buildCrossSectionLayout(scenarioGRows, 26.4, 31.5, 8);
    expect(layout.slabs).toHaveLength(12);
    // Each slab starts exactly where the previous one (plus gap) ended.
    for (let i = 1; i < layout.slabs.length; i += 1) {
      expect(layout.slabs[i].xPx).toBeGreaterThan(layout.slabs[i - 1].xPx);
    }
  });

  it('every slab is bottom-aligned just above the bottom foam band', () => {
    const layout = buildCrossSectionLayout(scenarioGRows, 26.4, 31.5, 8);
    for (const slab of layout.slabs) {
      expect(slab.yPx + slab.heightPx).toBeCloseTo(layout.totalHeightPx - layout.foamPx, 1);
    }
  });

  it('labels a shared row with both piece lengths', () => {
    const layout = buildCrossSectionLayout(scenarioGRows, 26.4, 31.5, 8);
    const pairedSlab = layout.slabs.find((s) => s.row === 7);
    expect(pairedSlab.label).toBe('49"+19"');
  });

  it('enforces a minimum slab width so a thin slot stays legible', () => {
    const layout = buildCrossSectionLayout(scenarioGRows, 26.4, 31.5, 1); // tiny scale
    expect(layout.slabs[0].widthPx).toBeGreaterThanOrEqual(26);
  });
});
