import { describe, it, expect } from 'vitest';
import { baseStoneColor, stoneFleckStyle, sinkCutoutRect } from './stoneMaterial';

describe('baseStoneColor (deterministic, no AI/image generation)', () => {
  it('picks a dark tone for black-named colors', () => {
    expect(baseStoneColor('Absolute Black')).toBe('#2e2d2f');
    expect(baseStoneColor('Black Galaxy')).toBe('#2e2d2f');
  });

  it('picks a light tone for white-named colors', () => {
    expect(baseStoneColor('Kashmir White')).toBe('#e9e7e2');
    expect(baseStoneColor('Carrara White')).toBe('#e9e7e2');
  });

  it('picks a warm tone for brown/gold-named colors', () => {
    expect(baseStoneColor('Baltic Brown')).toBe('#b9a079');
  });

  it('falls back to a generic gray for an unrecognized or missing color', () => {
    expect(baseStoneColor('')).toBe('#9a9ca2');
    expect(baseStoneColor(undefined)).toBe('#9a9ca2');
    expect(baseStoneColor('Some Unknown Stone')).toBe('#9a9ca2');
  });

  it('is case-insensitive', () => {
    expect(baseStoneColor('ABSOLUTE BLACK')).toBe(baseStoneColor('absolute black'));
  });
});

describe('stoneFleckStyle (granite vs quartz, driven by project material)', () => {
  it('gives granite a coarse, dense speckle with no veining', () => {
    const g = stoneFleckStyle('Granite');
    expect(g.veined).toBe(false);
    expect(g.speckleCount).toBeGreaterThan(1000);
  });

  it('gives quartz a smoother, sparser, veined look', () => {
    const q = stoneFleckStyle('Quartz');
    expect(q.veined).toBe(true);
    expect(q.speckleCount).toBeLessThan(stoneFleckStyle('Granite').speckleCount);
  });

  it('defaults to granite-style for an unrecognized material', () => {
    expect(stoneFleckStyle('Marble')).toEqual(stoneFleckStyle('Granite'));
  });
});

describe('sinkCutoutRect', () => {
  it('returns null when the piece has no sink', () => {
    expect(sinkCutoutRect({ sink_type: 'No Sink' }, 25.5)).toBeNull();
    expect(sinkCutoutRect({}, 25.5)).toBeNull();
    expect(sinkCutoutRect(null, 25.5)).toBeNull();
  });

  it('returns null when sink dimensions are missing even if sink_type is set', () => {
    expect(sinkCutoutRect({ sink_type: 'Single Bowl' }, 25.5)).toBeNull();
  });

  it('places the cutout at the given offset, vertically centered on the standing height', () => {
    const rect = sinkCutoutRect({ sink_type: 'Single Bowl', sink_offset_left: 20, sink_length: 30, sink_width: 18 }, 25.5);
    expect(rect).toEqual({ x: 20, y: (25.5 - 18) / 2, width: 30, height: 18 });
  });

  it('clamps a negative offset to zero instead of placing the cutout off the slab', () => {
    const rect = sinkCutoutRect({ sink_type: 'Single Bowl', sink_offset_left: -5, sink_length: 30, sink_width: 18 }, 25.5);
    expect(rect.x).toBe(0);
  });
});
