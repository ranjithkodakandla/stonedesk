// Client-side mirror of backend/app/services/drawing_templates.py — kept in
// lock-step with the same parameter defaults/constraints/geometry formulas so
// the live preview updates instantly with no network round trip. The server
// remains the source of truth: validation and canonical piece fields are
// re-computed server-side on every "Add to Project" / "Download PDF" call.

const num = (params, key, fallback = 0) => {
  const v = params[key];
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : fallback;
};

const checkRange = (errors, label, value, lo, hi) => {
  if (value < lo || value > hi) errors.push(`${label} must be between ${lo}" and ${hi}".`);
};

const islandStandardGeometry = (params) => {
  const length = num(params, 'length', 96);
  const width = num(params, 'width', 42);
  const overhang = num(params, 'overhang', 12);
  return {
    width_in: length,
    height_in: width,
    outline: [[0, 0], [length, 0], [length, width], [0, width]],
    cutouts: [],
    dimensions: [
      { from: [0, 0], to: [length, 0], label: `${length}"`, side: 'top' },
      { from: [0, 0], to: [0, width], label: `${width}"`, side: 'left' },
    ],
    notes: overhang ? [`Overhang: ${overhang}" (relative to cabinet base, not part of cut size)`] : [],
  };
};

const islandStandardConstraints = (params) => {
  const errors = [];
  checkRange(errors, 'Length', num(params, 'length', 96), 24, 180);
  checkRange(errors, 'Width', num(params, 'width', 42), 18, 60);
  checkRange(errors, 'Overhang', num(params, 'overhang', 12), 0, 18);
  return errors;
};

const islandSinkGeometry = (params) => {
  const length = num(params, 'length', 96);
  const width = num(params, 'width', 42);
  const sinkLength = num(params, 'sink_length', 30);
  const sinkWidth = num(params, 'sink_width', 18);
  const sinkOffsetLeft = params.sink_offset_left !== '' && params.sink_offset_left != null
    ? num(params, 'sink_offset_left', (length - sinkLength) / 2)
    : (length - sinkLength) / 2;
  const sinkX = sinkOffsetLeft;
  const sinkY = (width - sinkWidth) / 2;
  return {
    width_in: length,
    height_in: width,
    outline: [[0, 0], [length, 0], [length, width], [0, width]],
    cutouts: [{ type: 'sink', rect: [sinkX, sinkY, sinkLength, sinkWidth], label: 'Sink' }],
    dimensions: [
      { from: [0, 0], to: [length, 0], label: `${length}"`, side: 'top' },
      { from: [0, 0], to: [0, width], label: `${width}"`, side: 'left' },
      { from: [0, width], to: [sinkX, width], label: `${sinkOffsetLeft.toFixed(1)}"`, side: 'bottom' },
      { from: [sinkX, width], to: [sinkX + sinkLength, width], label: `${sinkLength}"`, side: 'bottom' },
    ],
    notes: [],
  };
};

const islandSinkConstraints = (params) => {
  const errors = islandStandardConstraints(params);
  const length = num(params, 'length', 96);
  const width = num(params, 'width', 42);
  const sinkLength = num(params, 'sink_length', 30);
  const sinkWidth = num(params, 'sink_width', 18);
  const sinkOffsetLeft = params.sink_offset_left !== '' && params.sink_offset_left != null
    ? num(params, 'sink_offset_left', (length - sinkLength) / 2)
    : (length - sinkLength) / 2;
  const minClear = 3;
  if (sinkLength <= 0 || sinkWidth <= 0) {
    errors.push('Sink dimensions must be greater than zero.');
    return errors;
  }
  if (sinkOffsetLeft < minClear) errors.push(`Sink is too close to the left edge. Move the sink at least ${minClear}".`);
  if (sinkOffsetLeft + sinkLength > length - minClear) errors.push(`Sink is too close to the right edge. Move the sink at least ${minClear}" from the right.`);
  if (sinkWidth > width - 2 * minClear) errors.push(`Sink is too wide for this countertop depth. Leave at least ${minClear}" front and back.`);
  return errors;
};

export const DRAWING_TEMPLATES = [
  {
    id: 'island_standard',
    name: 'Standard Island',
    category: 'island',
    parameters: [
      { id: 'length', label: 'Length', unit: 'in', default: 96, min: 24, max: 180 },
      { id: 'width', label: 'Width', unit: 'in', default: 42, min: 18, max: 60 },
      { id: 'overhang', label: 'Overhang', unit: 'in', default: 12, min: 0, max: 18 },
    ],
    geometry: islandStandardGeometry,
    constraints: islandStandardConstraints,
  },
  {
    id: 'island_with_sink',
    name: 'Island With Sink',
    category: 'island',
    parameters: [
      { id: 'length', label: 'Length', unit: 'in', default: 96, min: 24, max: 180 },
      { id: 'width', label: 'Width', unit: 'in', default: 42, min: 18, max: 60 },
      { id: 'overhang', label: 'Overhang', unit: 'in', default: 12, min: 0, max: 18 },
      { id: 'sink_length', label: 'Sink Length', unit: 'in', default: 30, min: 12, max: 48 },
      { id: 'sink_width', label: 'Sink Width', unit: 'in', default: 18, min: 10, max: 30 },
      { id: 'sink_offset_left', label: 'Sink Offset (from left edge)', unit: 'in', default: '', min: 0, max: 180, optional: true },
    ],
    geometry: islandSinkGeometry,
    constraints: islandSinkConstraints,
  },
];

export const getTemplate = (id) => DRAWING_TEMPLATES.find((t) => t.id === id) || DRAWING_TEMPLATES[0];

export const defaultParams = (template) =>
  Object.fromEntries(template.parameters.map((p) => [p.id, p.default]));

export const computePreview = (templateId, params) => {
  const template = getTemplate(templateId);
  return {
    geometry: template.geometry(params),
    errors: template.constraints(params),
  };
};
