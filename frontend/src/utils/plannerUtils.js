export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export const emptyProject = {
  id: null,
  name: '',
  material: 'Granite',
  thickness: '3CM',
  crate_wood_type: 'Pine',
  crate_wood_thickness: 1.25,
  preferred_container_mode: 'recommended',
  customer: '',
  job_number: '',
  date: '',
};

export const DESTINATION_PALETTE = [
  '#1d4ed8',
  '#0f766e',
  '#c2410c',
  '#7c3aed',
  '#be123c',
  '#0284c7',
  '#3f6212',
  '#b45309',
];

export const CONTAINER_SPECS = {
  '20ft': { max_length: 233, max_width: 92, max_weight: 28130 },
  '40ft': { max_length: 470, max_width: 92, max_weight: 28750 },
};

export const formatNumber = (value, digits = 1) => Number(value || 0).toFixed(digits);

export const getPieceWeight = (piece, project) => {
  const qty = Number(piece.qty) || 1;
  const override = Number(piece.weight_override || 0);
  if (override > 0) return override * qty;
  const factors = {
    Granite: { '2CM': 5.5, '3CM': 7.5, Mixed: 6.5 },
    Quartz: { '2CM': 4.75, '3CM': 6.75, Mixed: 5.75 },
    Marble: { '2CM': 6.0, '3CM': 8.0, Mixed: 7.0 },
  };
  const factor = (factors[project.material] || factors.Granite)[project.thickness] || 6.5;
  return ((Number(piece.length || 0) * Number(piece.width || 0)) / 144) * factor * qty;
};

export const buildAssignmentMap = (rows = []) => rows.reduce((map, row) => {
  map[row.piece_id] = row.crate_id;
  return map;
}, {});

export const buildPiecesByCrate = (pieces = [], crates = [], assignments = {}) => {
  const grouped = {};
  crates.forEach((crate) => {
    grouped[crate.id] = [];
  });
  const unassigned = [];
  pieces.forEach((piece) => {
    const crateId = assignments[piece.id];
    if (crateId && grouped[crateId]) grouped[crateId].push(piece);
    else unassigned.push(piece);
  });
  Object.values(grouped).forEach((items) => items.sort((a, b) => a.id - b.id));
  return { grouped, unassigned: unassigned.sort((a, b) => a.id - b.id) };
};

export const getDestinationColorMap = (crates = []) => {
  const destinations = Array.from(new Set(crates.map((crate) => crate.destination_group).filter(Boolean)));
  return destinations.reduce((map, destination, index) => {
    map[destination] = DESTINATION_PALETTE[index % DESTINATION_PALETTE.length];
    return map;
  }, {});
};

export const buildEditableContainersFromPlan = (containers = []) =>
  containers.map((container, containerIndex) => ({
    id: container.id || `MANUAL-${containerIndex + 1}`,
    type: container.type || '40ft',
    placements: (container.placements || []).map((placement, placementIndex) => ({
      crate_id: placement.crate_id,
      x: Number(placement.x || 0),
      y: Number(placement.y || 0),
      rotated: Boolean(placement.rotated),
      loading_order: Number(placement.loading_order || placementIndex + 1),
      unload_order: Number(placement.unload_order || placementIndex + 1),
    })),
  }));

export const createManualContainerDraft = (type = '40ft') => ({
  id: `MANUAL-${type.toUpperCase()}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
  type,
  placements: [],
});

export const placementDimensionsForDraft = (crate, rotated) => {
  if (!crate) return { length: 0, width: 0 };
  if (rotated) {
    return {
      length: Number(crate.external_width || 0),
      width: Number(crate.external_length || 0),
    };
  }
  return {
    length: Number(crate.external_length || 0),
    width: Number(crate.external_width || 0),
  };
};

export const placementsOverlap = (a, b) =>
  !(
    a.x + a.length <= b.x ||
    b.x + b.length <= a.x ||
    a.y + a.width <= b.y ||
    b.y + b.width <= a.y
  );

export const buildBalanceFromPlacements = (placements, maxLength, maxWidth, usedWeight) => {
  if (!placements.length || usedWeight <= 0) {
    return {
      left_right_delta_pct: 0,
      front_rear_delta_pct: 0,
      left_weight: 0,
      right_weight: 0,
      front_weight: 0,
      rear_weight: 0,
    };
  }

  let leftWeight = 0;
  let rightWeight = 0;
  let frontWeight = 0;
  let rearWeight = 0;

  placements.forEach((placement) => {
    const centerX = placement.x + placement.length / 2;
    const centerY = placement.y + placement.width / 2;
    const weight = Number(placement.weight || 0);
    if (centerY <= maxWidth / 2) leftWeight += weight;
    else rightWeight += weight;
    if (centerX <= maxLength / 2) frontWeight += weight;
    else rearWeight += weight;
  });

  return {
    left_right_delta_pct: Number(((Math.abs(leftWeight - rightWeight) / usedWeight) * 100 || 0).toFixed(1)),
    front_rear_delta_pct: Number(((Math.abs(frontWeight - rearWeight) / usedWeight) * 100 || 0).toFixed(1)),
    left_weight: Number(leftWeight.toFixed(1)),
    right_weight: Number(rightWeight.toFixed(1)),
    front_weight: Number(frontWeight.toFixed(1)),
    rear_weight: Number(rearWeight.toFixed(1)),
  };
};

export const buildContainerPreview = (containerDraft, crateByCode) => {
  const spec = CONTAINER_SPECS[containerDraft.type] || CONTAINER_SPECS['40ft'];
  const warnings = [];
  const placements = [];
  const seenCrates = new Set();

  [...(containerDraft.placements || [])]
    .sort((a, b) => Number(a.loading_order || 0) - Number(b.loading_order || 0))
    .forEach((placement, index) => {
      const crate = crateByCode[placement.crate_id];
      if (!crate) {
        warnings.push(`${placement.crate_id || 'Unknown crate'} is no longer available`);
        return;
      }
      if (seenCrates.has(placement.crate_id)) {
        warnings.push(`${placement.crate_id} is listed more than once`);
        return;
      }

      const dims = placementDimensionsForDraft(crate, placement.rotated);
      const nextPlacement = {
        crate_id: crate.crate_id,
        name: crate.name,
        destination_group: crate.destination_group,
        x: Number(placement.x || 0),
        y: Number(placement.y || 0),
        length: Number(dims.length || 0),
        width: Number(dims.width || 0),
        weight: Number(crate.gross_weight || crate.total_weight || 0),
        net_weight: Number(crate.total_weight || 0),
        rotated: Boolean(placement.rotated),
        fill_percent: crate.fill_percent,
        efficiency_status: crate.efficiency_status,
        loading_order: Number(placement.loading_order || index + 1),
        unload_order: Number(placement.unload_order || index + 1),
        stackable: Boolean(crate.stackable),
        locked: Boolean(crate.locked),
      };

      if (
        nextPlacement.x < 0 ||
        nextPlacement.y < 0 ||
        nextPlacement.x + nextPlacement.length > spec.max_length ||
        nextPlacement.y + nextPlacement.width > spec.max_width
      ) {
        warnings.push(`${crate.crate_id} is outside ${containerDraft.type} bounds`);
      }

      placements.forEach((other) => {
        if (placementsOverlap(nextPlacement, other)) {
          warnings.push(`${crate.crate_id} overlaps ${other.crate_id}`);
        }
      });

      placements.push(nextPlacement);
      seenCrates.add(placement.crate_id);
    });

  const usedWeight = Number(placements.reduce((sum, placement) => sum + Number(placement.weight || 0), 0).toFixed(1));
  const usedLength = placements.length
    ? Number(Math.max(...placements.map((placement) => placement.x + placement.length)).toFixed(1))
    : 0;
  const weightUtilization = Number((((usedWeight / spec.max_weight) * 100) || 0).toFixed(1));
  const lengthUtilization = Number((((usedLength / spec.max_length) * 100) || 0).toFixed(1));
  const balance = buildBalanceFromPlacements(placements, spec.max_length, spec.max_width, usedWeight);
  const activeWarnings = [...warnings];

  if (weightUtilization > 100) activeWarnings.push('Container is overweight');
  if (balance.left_right_delta_pct > 15) activeWarnings.push('Left/right balance needs adjustment');
  if (balance.front_rear_delta_pct > 18) activeWarnings.push('Front/rear balance needs adjustment');
  if (weightUtilization > 0 && weightUtilization < 45) activeWarnings.push('Container weight utilization is low');
  if (lengthUtilization > 0 && lengthUtilization < 45) activeWarnings.push('Container floor utilization is low');

  return {
    id: containerDraft.id,
    type: containerDraft.type,
    max_length: spec.max_length,
    max_width: spec.max_width,
    max_weight: spec.max_weight,
    used_weight: usedWeight,
    used_length: usedLength,
    weight_utilization: weightUtilization,
    length_utilization: lengthUtilization,
    balance,
    warnings: Array.from(new Set(activeWarnings)),
    placements,
  };
};

export const summarizeDraftContainers = (containers) => {
  const counts = { '20ft': 0, '40ft': 0 };
  containers.forEach((container) => {
    if ((container.placements || []).length > 0) counts[container.type] += 1;
  });
  const totalContainers = counts['20ft'] + counts['40ft'];
  const label = counts['20ft'] && counts['40ft']
    ? `${counts['40ft']} x 40ft + ${counts['20ft']} x 20ft`
    : counts['20ft']
      ? `${counts['20ft']} x 20ft`
      : counts['40ft']
        ? `${counts['40ft']} x 40ft`
        : 'No active containers';

  return { counts, totalContainers, label };
};

export const summarizeWarnings = (exceptions = []) => {
  const rules = [
    { key: 'underloaded', label: 'underloaded crates', match: /low fill|poor weight utilization|underloaded/i },
    { key: 'overweight', label: 'overweight crates', match: /over max weight|overweight/i },
    { key: 'balance', label: 'balance warnings', match: /balance/i },
    { key: 'grouping', label: 'grouping warnings', match: /mixed destinations|heavy parts grouped|light parts grouped|rebalance/i },
    { key: 'oversized', label: 'oversized crates', match: /oversized/i },
  ];

  const counts = rules.map((rule) => ({
    ...rule,
    count: exceptions.filter((item) => rule.match.test(item.message || '')).length,
  })).filter((item) => item.count > 0);

  const remainingCount = Math.max(0, exceptions.length - counts.reduce((sum, item) => sum + item.count, 0));
  if (remainingCount > 0) counts.push({ key: 'other', label: 'other warnings', count: remainingCount });

  return counts.slice(0, 5);
};

export const buildRecommendationReasons = (insights) => {
  const reasons = [];
  const options = insights?.container_options || [];
  const recommended = insights?.container_plan;
  if (!recommended) return ['Planner recommendation based on current crate mix and loading feasibility.'];

  const recommendedOption = options.find((option) => option.label === recommended.mode_label) || options[0];
  const feasible = options.filter((option) => option.feasible);
  const bestCost = feasible.length ? Math.min(...feasible.map((option) => option.cost_index || 0)) : null;
  const bestWeightUtil = feasible.length ? Math.max(...feasible.map((option) => option.average_weight_utilization || 0)) : null;
  const bestLengthUtil = feasible.length ? Math.max(...feasible.map((option) => option.average_length_utilization || 0)) : null;

  if (recommendedOption && bestCost !== null && recommendedOption.cost_index === bestCost) {
    reasons.push('Lowest freight cost among feasible options');
  }
  if (recommendedOption && bestWeightUtil !== null && recommendedOption.average_weight_utilization === bestWeightUtil) {
    reasons.push('Best weight utilization');
  }
  if (recommendedOption && bestLengthUtil !== null && recommendedOption.average_length_utilization === bestLengthUtil) {
    reasons.push('Best floor utilization');
  }
  if ((insights?.exceptions || []).filter((row) => /balance/i.test(row.message || '')).length === 0) {
    reasons.push('Safest load balance at current packing state');
  }
  if ((insights?.underfilled_crates || []).length <= 3) {
    reasons.push('Lower crate waste and fewer underloaded crates');
  }

  return reasons.slice(0, 4);
};

export const groupCratesForWorkflow = (crates = []) => {
  const groups = {
    Efficient: [],
    'Needs Review': [],
    Underloaded: [],
    Locked: [],
  };

  crates.forEach((crate) => {
    if (crate.locked) {
      groups.Locked.push(crate);
    } else if (crate.underloaded || crate.fill_percent < 70 || crate.gross_utilization < 60) {
      groups.Underloaded.push(crate);
    } else if (crate.efficiency_status !== 'green' || (crate.warnings || []).length > 0) {
      groups['Needs Review'].push(crate);
    } else {
      groups.Efficient.push(crate);
    }
  });

  return groups;
};
