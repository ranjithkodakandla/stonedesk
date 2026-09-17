// Client-side mirror of backend/app/services/drawing_templates.py — kept in
// lock-step with the same parameter defaults/constraints/geometry/assembly
// formulas so the live preview updates instantly with no network round
// trip. The server remains the source of truth: validation and canonical
// piece fields are re-computed server-side on every "Add to Project" /
// "Download PDF" call.
//
// Vanity and kitchen tops bundle backsplash + side splash as accessory
// pieces (matching real StoneDesk fab drawings) rather than as separate
// templates — include_backsplash / include_side_splash let the user drop
// either one per job.

const num = (params, key, fallback = 0) => {
  const v = params[key];
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : fallback;
};

const bool = (params, key, fallback = true) => {
  const v = params[key];
  if (v === undefined || v === null) return fallback;
  return !!v;
};

const checkRange = (errors, label, value, lo, hi) => {
  if (value < lo || value > hi) errors.push(`${label} must be between ${lo}" and ${hi}".`);
};

export const SINK_SHAPES = ['oval', 'round', 'rectangle'];

// Sink SHAPE (not dimension) is what actually distinguishes the same
// countertop category across real fab drawings — Concord uses an oval
// undermount, Saltwell a round one, Haven/Deforest a rectangular one, all
// at different sizes. Mirrors drawing_templates.py::_sink_cutout.
const sinkCutout = (shape, x, y, w, h) => {
  if (shape === 'round') {
    const d = Math.max(w, h);
    const cx = x + w / 2, cy = y + h / 2;
    return { type: 'sink', shape: 'oval', rect: [cx - d / 2, cy - d / 2, d, d], label: 'Polish' };
  }
  return { type: 'sink', shape: shape === 'oval' ? 'oval' : 'rounded_rect', rect: [x, y, w, h], label: 'Polish' };
};

// A cooktop cutout is a separate, real capability from a sink — sharp
// corners, solid line (not the dashed "cut by template" sink convention).
// Mirrors drawing_templates.py::_cooktop_cutout.
const cooktopCutout = (x, y, w, d) => ({ type: 'cooktop', shape: 'rect', rect: [x, y, w, d], label: 'Cooktop' });

const islandStandardGeometry = (params) => {
  const length = num(params, 'length', 96);
  const width = num(params, 'width', 42);
  const overhang = num(params, 'overhang', 12);
  const includeCooktop = bool(params, 'include_cooktop', false);
  const dimensions = [
    { from: [0, 0], to: [length, 0], label: `${length}"`, side: 'top' },
    { from: [0, 0], to: [0, width], label: `${width}"`, side: 'left' },
  ];
  const cutouts = [];
  if (includeCooktop) {
    const cooktopW = num(params, 'cooktop_width', 30);
    const cooktopD = num(params, 'cooktop_depth', 21);
    const cooktopOffsetLeft = params.cooktop_offset_left !== '' && params.cooktop_offset_left != null
      ? num(params, 'cooktop_offset_left', (length - cooktopW) / 2)
      : (length - cooktopW) / 2;
    const cooktopY = (width - cooktopD) / 2;
    cutouts.push(cooktopCutout(cooktopOffsetLeft, cooktopY, cooktopW, cooktopD));
    dimensions.push(
      { from: [0, cooktopY + cooktopD], to: [cooktopOffsetLeft, cooktopY + cooktopD], label: `${cooktopOffsetLeft}"`, side: 'bottom' },
      { from: [cooktopOffsetLeft, cooktopY + cooktopD], to: [cooktopOffsetLeft + cooktopW, cooktopY + cooktopD], label: `${cooktopW}"`, side: 'bottom' },
    );
  }
  return {
    width_in: length,
    height_in: width,
    outline: [[0, 0], [length, 0], [length, width], [0, width]],
    cutouts,
    dimensions,
    notes: overhang ? [`Overhang: ${overhang}" (relative to cabinet base, not part of cut size)`] : [],
    accessories: [],
    edgeMarks: ['top', 'left', 'right', 'bottom'],
    cornerRadius: 0.5,
  };
};

const islandStandardConstraints = (params) => {
  const errors = [];
  const length = num(params, 'length', 96);
  const width = num(params, 'width', 42);
  checkRange(errors, 'Length', length, 24, 180);
  checkRange(errors, 'Width', width, 18, 60);
  checkRange(errors, 'Overhang', num(params, 'overhang', 12), 0, 18);
  if (bool(params, 'include_cooktop', false)) {
    const cooktopW = num(params, 'cooktop_width', 30);
    const cooktopD = num(params, 'cooktop_depth', 21);
    const cooktopOffsetLeft = params.cooktop_offset_left !== '' && params.cooktop_offset_left != null
      ? num(params, 'cooktop_offset_left', (length - cooktopW) / 2)
      : (length - cooktopW) / 2;
    const minClear = 3;
    if (cooktopW <= 0 || cooktopD <= 0) {
      errors.push('Cooktop dimensions must be greater than zero.');
    } else if (cooktopOffsetLeft < minClear || cooktopOffsetLeft + cooktopW > length - minClear) {
      errors.push(`Cooktop is too close to an edge. Leave at least ${minClear}" on each side.`);
    } else if (cooktopD > width - 2 * minClear) {
      errors.push(`Cooktop is too deep for this countertop. Leave at least ${minClear}" front and back.`);
    }
  }
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
    cutouts: [sinkCutout(params.sink_shape || 'oval', sinkX, sinkY, sinkLength, sinkWidth)],
    dimensions: [
      { from: [0, 0], to: [length, 0], label: `${length}"`, side: 'top' },
      { from: [0, 0], to: [0, width], label: `${width}"`, side: 'left' },
      { from: [0, width], to: [sinkX, width], label: `${sinkOffsetLeft.toFixed(1)}"`, side: 'bottom' },
      { from: [sinkX, width], to: [sinkX + sinkLength, width], label: `${sinkLength}"`, side: 'bottom' },
    ],
    notes: [],
    accessories: [],
    edgeMarks: ['top', 'left', 'right', 'bottom'],
    cornerRadius: 0.5,
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

const vanityTopGeometry = (params) => {
  const length = num(params, 'length', 55);
  const depth = num(params, 'depth', 22.5);
  const sinkLength = num(params, 'sink_length', 21.625);
  const sinkWidth = num(params, 'sink_width', 15);
  const sinkOffsetLeft = params.sink_offset_left !== '' && params.sink_offset_left != null
    ? num(params, 'sink_offset_left', (length - sinkLength) / 2)
    : (length - sinkLength) / 2;
  const splashHeight = num(params, 'splash_height', 4);
  const sinkX = sinkOffsetLeft;
  const sinkY = (depth - sinkWidth) / 2;
  const includeSink = bool(params, 'include_sink', true);
  const accessories = [];
  if (bool(params, 'include_backsplash', true)) {
    accessories.push({ role: 'backsplash', label: `Backsplash ${length}" x ${splashHeight}"`, w: length, h: splashHeight });
  }
  if (bool(params, 'include_side_splash', true)) {
    accessories.push({ role: 'side_splash_left', label: `Side Splash ${depth}" x ${splashHeight}"`, w: depth, h: splashHeight });
    accessories.push({ role: 'side_splash_right', label: `Side Splash ${depth}" x ${splashHeight}"`, w: depth, h: splashHeight });
  }
  return {
    width_in: length,
    height_in: depth,
    outline: [[0, 0], [length, 0], [length, depth], [0, depth]],
    // "ISLAND/VANITY BLANKS" in real fab drawings are the same top with no
    // sink cutout — include_sink=false renders exactly that, not a
    // separate template.
    cutouts: includeSink ? [sinkCutout(params.sink_shape || 'oval', sinkX, sinkY, sinkLength, sinkWidth)] : [],
    dimensions: [
      { from: [0, 0], to: [length, 0], label: `${length}"`, side: 'top' },
      { from: [0, 0], to: [0, depth], label: `${depth}"`, side: 'left' },
    ],
    notes: [],
    accessories,
    edgeMarks: ['top', 'left', 'right', 'bottom'],
    cornerRadius: 0.5,
  };
};

const vanityTopConstraints = (params) => {
  const errors = [];
  const length = num(params, 'length', 55);
  const depth = num(params, 'depth', 22.5);
  checkRange(errors, 'Length', length, 24, 120);
  checkRange(errors, 'Depth', depth, 18, 30);
  if (!bool(params, 'include_sink', true)) return errors;
  const sinkLength = num(params, 'sink_length', 21.625);
  const sinkWidth = num(params, 'sink_width', 15);
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
  if (sinkWidth > depth - 2 * minClear) errors.push(`Sink is too wide for this vanity depth. Leave at least ${minClear}" front and back.`);
  return errors;
};

const kitchenLTopGeometry = (params) => {
  const leftRun = num(params, 'left_run', 63);
  const rightRun = num(params, 'right_run', 49);
  const depth = num(params, 'depth', 44);
  const notchDepth = num(params, 'notch_depth', 25.5);
  const sinkLength = num(params, 'sink_length', 33);
  const sinkWidth = num(params, 'sink_width', 21);
  const sinkOffsetLeft = params.sink_offset_left !== '' && params.sink_offset_left != null
    ? num(params, 'sink_offset_left', leftRun / 2 - sinkLength / 2)
    : leftRun / 2 - sinkLength / 2;
  const splashHeight = num(params, 'splash_height', 4);
  const totalLength = leftRun + rightRun;
  const sinkX = sinkOffsetLeft;
  const sinkY = (depth - sinkWidth) / 2;
  const accessories = [];
  if (bool(params, 'include_backsplash', true)) {
    accessories.push({ role: 'backsplash', label: `Backsplash ${leftRun}" x ${splashHeight}"`, w: leftRun, h: splashHeight });
    accessories.push({ role: 'backsplash_right', label: `Backsplash ${rightRun}" x ${splashHeight}"`, w: rightRun, h: splashHeight });
  }
  if (bool(params, 'include_side_splash', true)) {
    accessories.push({ role: 'side_splash_left', label: `Side Splash ${depth}" x ${depth}"`, w: depth, h: depth });
    accessories.push({ role: 'side_splash_right', label: `Side Splash ${notchDepth}" x ${notchDepth}"`, w: notchDepth, h: notchDepth });
  }
  return {
    width_in: totalLength,
    height_in: depth,
    outline: [
      [0, 0], [totalLength, 0], [totalLength, notchDepth],
      [leftRun, notchDepth], [leftRun, depth], [0, depth],
    ],
    cutouts: [sinkCutout(params.sink_shape || 'rectangle', sinkX, sinkY, sinkLength, sinkWidth)],
    dimensions: [
      { from: [0, 0], to: [totalLength, 0], label: `${totalLength}"`, side: 'top' },
      { from: [0, 0], to: [0, depth], label: `${depth}"`, side: 'left' },
    ],
    notes: [],
    accessories,
    edgeMarks: ['top', 'left', 'right', 'bottom'],
    cornerRadius: 0.5,
  };
};

const kitchenLTopConstraints = (params) => {
  const errors = [];
  const leftRun = num(params, 'left_run', 63);
  const rightRun = num(params, 'right_run', 49);
  const depth = num(params, 'depth', 44);
  const sinkLength = num(params, 'sink_length', 33);
  const sinkWidth = num(params, 'sink_width', 21);
  const sinkOffsetLeft = params.sink_offset_left !== '' && params.sink_offset_left != null
    ? num(params, 'sink_offset_left', leftRun / 2 - sinkLength / 2)
    : leftRun / 2 - sinkLength / 2;
  const minClear = 3;
  checkRange(errors, 'Left Run', leftRun, 24, 180);
  checkRange(errors, 'Right Run', rightRun, 18, 120);
  checkRange(errors, 'Depth', depth, 24, 48);
  if (sinkLength <= 0 || sinkWidth <= 0) {
    errors.push('Sink dimensions must be greater than zero.');
    return errors;
  }
  if (sinkOffsetLeft < minClear) errors.push(`Sink is too close to the left edge. Move the sink at least ${minClear}".`);
  if (sinkOffsetLeft + sinkLength > leftRun - minClear) errors.push(`Sink does not fit on the left run — move it or shorten the sink at least ${minClear}" from the corner.`);
  if (sinkWidth > depth - 2 * minClear) errors.push(`Sink is too wide for this countertop depth. Leave at least ${minClear}" front and back.`);
  return errors;
};

export const DRAWING_TEMPLATES = [
  {
    id: 'island_standard',
    name: 'Standard Island',
    category: 'island',
    pieceCategory: 'Kitchen - Island Tops',
    parameters: [
      { id: 'length', label: 'Length', unit: 'in', default: 96, min: 24, max: 180 },
      { id: 'width', label: 'Width', unit: 'in', default: 42, min: 18, max: 60 },
      { id: 'overhang', label: 'Overhang', unit: 'in', default: 12, min: 0, max: 18 },
      { id: 'include_cooktop', label: 'Include Cooktop Cutout', type: 'boolean', default: false },
      { id: 'cooktop_width', label: 'Cooktop Width', unit: 'in', default: 30, min: 15, max: 48 },
      { id: 'cooktop_depth', label: 'Cooktop Depth', unit: 'in', default: 21, min: 15, max: 30 },
      { id: 'cooktop_offset_left', label: 'Cooktop Offset (from left edge)', unit: 'in', default: '', min: 0, max: 180, optional: true },
    ],
    geometry: islandStandardGeometry,
    constraints: islandStandardConstraints,
    matchesPiece: (p) => p.part === 'Kitchen - Island Tops' && (!p.sink_type || p.sink_type === 'No Sink'),
    paramsFromPiece: (p) => ({ length: p.length, width: p.width }),
  },
  {
    id: 'island_with_sink',
    name: 'Island With Sink',
    category: 'island',
    pieceCategory: 'Kitchen - Island Tops',
    parameters: [
      { id: 'length', label: 'Length', unit: 'in', default: 96, min: 24, max: 180 },
      { id: 'width', label: 'Width', unit: 'in', default: 42, min: 18, max: 60 },
      { id: 'overhang', label: 'Overhang', unit: 'in', default: 12, min: 0, max: 18 },
      { id: 'sink_length', label: 'Sink Length', unit: 'in', default: 30, min: 12, max: 48 },
      { id: 'sink_width', label: 'Sink Width', unit: 'in', default: 18, min: 10, max: 30 },
      { id: 'sink_offset_left', label: 'Sink Offset (from left edge)', unit: 'in', default: '', min: 0, max: 180, optional: true },
      { id: 'sink_shape', label: 'Sink Shape', type: 'select', options: SINK_SHAPES, default: 'oval' },
    ],
    geometry: islandSinkGeometry,
    constraints: islandSinkConstraints,
    matchesPiece: (p) => p.part === 'Kitchen - Island Tops' && p.sink_type && p.sink_type !== 'No Sink',
    paramsFromPiece: (p) => ({
      length: p.length, width: p.width, sink_length: p.sink_length, sink_width: p.sink_width,
      sink_offset_left: p.sink_offset_left,
    }),
  },
  {
    id: 'vanity_top',
    name: 'Vanity Top',
    category: 'vanity',
    pieceCategory: 'Vanity - Top',
    parameters: [
      { id: 'length', label: 'Length', unit: 'in', default: 55, min: 24, max: 120 },
      { id: 'depth', label: 'Depth', unit: 'in', default: 22.5, min: 18, max: 30 },
      { id: 'sink_length', label: 'Sink Length', unit: 'in', default: 21.625, min: 12, max: 48 },
      { id: 'sink_width', label: 'Sink Width', unit: 'in', default: 15, min: 10, max: 24 },
      { id: 'sink_offset_left', label: 'Sink Offset (from left edge)', unit: 'in', default: '', min: 0, max: 120, optional: true },
      { id: 'splash_height', label: 'Splash Height', unit: 'in', default: 4, min: 2, max: 6 },
      { id: 'sink_shape', label: 'Sink Shape', type: 'select', options: SINK_SHAPES, default: 'oval' },
      { id: 'include_sink', label: 'Include Sink', type: 'boolean', default: true },
      { id: 'include_backsplash', label: 'Include Backsplash', type: 'boolean', default: true },
      { id: 'include_side_splash', label: 'Include Side Splashes', type: 'boolean', default: true },
    ],
    geometry: vanityTopGeometry,
    constraints: vanityTopConstraints,
    paramsFromPiece: (p) => ({
      length: p.length, depth: p.width, sink_length: p.sink_length, sink_width: p.sink_width,
      sink_offset_left: p.sink_offset_left,
    }),
  },
  {
    id: 'kitchen_l_top',
    name: 'Kitchen Top (L-Shape)',
    category: 'kitchen',
    pieceCategory: 'Kitchen - Perimeter Tops',
    parameters: [
      { id: 'left_run', label: 'Left Run', unit: 'in', default: 63, min: 24, max: 180 },
      { id: 'right_run', label: 'Right Run', unit: 'in', default: 49, min: 18, max: 120 },
      { id: 'depth', label: 'Depth', unit: 'in', default: 44, min: 24, max: 48 },
      { id: 'notch_depth', label: 'Notch Depth', unit: 'in', default: 25.5, min: 12, max: 48 },
      { id: 'sink_length', label: 'Sink Length', unit: 'in', default: 33, min: 18, max: 48 },
      { id: 'sink_width', label: 'Sink Width', unit: 'in', default: 21, min: 14, max: 30 },
      { id: 'sink_offset_left', label: 'Sink Offset (from left corner)', unit: 'in', default: '', min: 0, max: 180, optional: true },
      { id: 'splash_height', label: 'Splash Height', unit: 'in', default: 4, min: 2, max: 6 },
      { id: 'sink_shape', label: 'Sink Shape', type: 'select', options: SINK_SHAPES, default: 'rectangle' },
      { id: 'include_backsplash', label: 'Include Backsplash', type: 'boolean', default: true },
      { id: 'include_side_splash', label: 'Include Side Splashes', type: 'boolean', default: true },
    ],
    geometry: kitchenLTopGeometry,
    constraints: kitchenLTopConstraints,
    paramsFromPiece: (p) => ({
      left_run: p.length ? p.length * 0.56 : 63, right_run: p.length ? p.length * 0.44 : 49,
      depth: p.width, sink_length: p.sink_length, sink_width: p.sink_width, sink_offset_left: p.sink_offset_left,
    }),
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

// Reverse-maps an existing canonical piece (from Source Data, manual or
// generated) back onto a template + params, so the Drawing Generator can
// load and let a user view/edit dimensions already entered rather than
// forcing re-entry of the same numbers.
export const templateForPiece = (piece) => {
  if (!piece) return null;
  const byCategory = DRAWING_TEMPLATES.filter((t) => t.pieceCategory === piece.part);
  if (!byCategory.length) return null;
  const specific = byCategory.find((t) => t.matchesPiece && t.matchesPiece(piece));
  return specific || byCategory[0];
};

export const paramsFromPiece = (template, piece) =>
  template && template.paramsFromPiece ? { ...defaultParams(template), ...template.paramsFromPiece(piece) } : defaultParams(template);
