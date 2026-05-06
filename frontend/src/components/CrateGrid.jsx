import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const DESTINATION_PALETTE = [
  '#1d4ed8',
  '#0f766e',
  '#c2410c',
  '#7c3aed',
  '#be123c',
  '#0284c7',
  '#3f6212',
  '#b45309',
];

const CONTAINER_SPECS = {
  '20ft': { max_length: 233, max_width: 92, max_weight: 28130 },
  '40ft': { max_length: 470, max_width: 92, max_weight: 28750 },
};

const blankCustomDraft = {
  name: '',
  max_weight: 1000,
  reserved_space_pct: 0,
  planner_notes: '',
  locked: false,
};

const statusMeta = {
  green: {
    label: 'Efficient',
    badge: 'bg-emerald-100 text-emerald-700',
    border: 'border-emerald-200',
    surface: 'from-emerald-50 to-white',
    text: 'text-emerald-700',
    bar: 'from-emerald-500 to-lime-400',
  },
  yellow: {
    label: 'Acceptable',
    badge: 'bg-amber-100 text-amber-800',
    border: 'border-amber-200',
    surface: 'from-amber-50 to-white',
    text: 'text-amber-700',
    bar: 'from-amber-500 to-orange-400',
  },
  red: {
    label: 'Inefficient',
    badge: 'bg-rose-100 text-rose-700',
    border: 'border-rose-200',
    surface: 'from-rose-50 to-white',
    text: 'text-rose-700',
    bar: 'from-rose-500 to-pink-400',
  },
};

const defaultContainerView = {
  zoom: 1,
  x: 0,
  y: 0,
  rotation: 0,
};

const getStatusMeta = (status) => statusMeta[status] || statusMeta.yellow;

const formatNumber = (value, digits = 1) => Number(value || 0).toFixed(digits);

const buildEditableContainersFromPlan = (containers = []) =>
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

const createManualContainerDraft = (type = '40ft') => ({
  id: `MANUAL-${type.toUpperCase()}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
  type,
  placements: [],
});

const placementDimensionsForDraft = (crate, rotated) => {
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

const placementsOverlap = (a, b) =>
  !(
    a.x + a.length <= b.x ||
    b.x + b.length <= a.x ||
    a.y + a.width <= b.y ||
    b.y + b.width <= a.y
  );

const buildBalanceFromPlacements = (placements, maxLength, maxWidth, usedWeight) => {
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

const buildContainerPreview = (containerDraft, crateByCode) => {
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

  const tailGap = spec.max_length - usedLength;

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
    zones: {
      front_wall: { x: 0, label: 'Front wall' },
      door_zone: { x: Number((spec.max_length - 12).toFixed(1)), length: 12, label: 'Door working zone' },
      centerline: Number((spec.max_width / 2).toFixed(1)),
    },
    empty_spaces: tailGap > 2
      ? [{ x: usedLength, y: 0, length: Number(tailGap.toFixed(1)), width: spec.max_width }]
      : [],
    placements,
  };
};

const summarizeDraftContainers = (containers) => {
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

const CrateGrid = ({ pieces, crates, assignments, project, onDataChange }) => {
  const [strategy, setStrategy] = useState('smart');
  const [maxWeight, setMaxWeight] = useState(1000);
  const [insights, setInsights] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);
  const [selectedCrateId, setSelectedCrateId] = useState(null);
  const [selectedCrateIds, setSelectedCrateIds] = useState([]);
  const [selectedPieceIds, setSelectedPieceIds] = useState([]);
  const [crateDraft, setCrateDraft] = useState(null);
  const [customDraft, setCustomDraft] = useState(blankCustomDraft);
  const [containerViews, setContainerViews] = useState({});
  const [dragState, setDragState] = useState(null);
  const [manualContainers, setManualContainers] = useState([]);
  const [manualPlanDirty, setManualPlanDirty] = useState(false);
  const [containerAddDrafts, setContainerAddDrafts] = useState({});
  const spinnerTimerRef = useRef(null);

  const getWeight = (piece) => {
    const override = Number(piece.weight_override || 0);
    if (override > 0) return override * (Number(piece.qty) || 1);
    const factors = {
      Granite: { '2CM': 5.5, '3CM': 7.5, Mixed: 6.5 },
      Quartz: { '2CM': 4.75, '3CM': 6.75, Mixed: 5.75 },
      Marble: { '2CM': 6.0, '3CM': 8.0, Mixed: 7.0 },
    };
    const factor = (factors[project.material] || factors.Granite)[project.thickness] || 6.5;
    return ((piece.length * piece.width) / 144) * factor * piece.qty;
  };

  const destinationColorMap = useMemo(() => {
    const destinations = Array.from(
      new Set((crates || []).map((crate) => crate.destination_group).filter(Boolean))
    );
    return destinations.reduce((map, destination, index) => {
      map[destination] = DESTINATION_PALETTE[index % DESTINATION_PALETTE.length];
      return map;
    }, {});
  }, [crates]);

  const { pieceWeights, unassigned, cratesWithItems, pieceById } = useMemo(() => {
    const nextPieceWeights = {};
    const nextPieceById = {};
    const piecesByCrate = {};
    const nextUnassigned = [];

    crates.forEach((crate) => {
      piecesByCrate[crate.id] = [];
    });

    pieces.forEach((piece) => {
      nextPieceById[piece.id] = piece;
      nextPieceWeights[piece.id] = getWeight(piece);
      const crateId = assignments[piece.id];
      if (crateId && piecesByCrate[crateId]) {
        piecesByCrate[crateId].push(piece);
      } else {
        nextUnassigned.push(piece);
      }
    });

    const nextCratesWithItems = crates.map((crate) => {
      const items = (piecesByCrate[crate.id] || []).sort((a, b) => a.id - b.id);
      return {
        ...crate,
        items,
      };
    });

    return {
      pieceWeights: nextPieceWeights,
      unassigned: nextUnassigned.sort((a, b) => a.id - b.id),
      cratesWithItems: nextCratesWithItems,
      pieceById: nextPieceById,
    };
  }, [assignments, crates, pieces, project.material, project.thickness]);

  const cratesById = useMemo(
    () => cratesWithItems.reduce((map, crate) => ({ ...map, [crate.id]: crate }), {}),
    [cratesWithItems]
  );
  const crateByCode = useMemo(
    () => cratesWithItems.reduce((map, crate) => ({ ...map, [crate.crate_id]: crate }), {}),
    [cratesWithItems]
  );

  const selectedCrate = selectedCrateId ? cratesById[selectedCrateId] : null;
  const hasCrates = cratesWithItems.length > 0;
  const selectedCrates = selectedCrateIds.map((id) => cratesById[id]).filter(Boolean);
  const anyLockedSelection = selectedCrates.some((crate) => crate.locked);
  const containerDraftSummary = useMemo(() => summarizeDraftContainers(manualContainers), [manualContainers]);
  const manualContainerPreview = useMemo(
    () => manualContainers.map((container) => buildContainerPreview(container, crateByCode)),
    [manualContainers, crateByCode]
  );
  const placedCrateIds = useMemo(
    () => new Set(manualContainers.flatMap((container) => (container.placements || []).map((placement) => placement.crate_id))),
    [manualContainers]
  );
  const unplacedCratesForContainerPlan = useMemo(
    () => cratesWithItems.filter((crate) => !placedCrateIds.has(crate.crate_id)),
    [cratesWithItems, placedCrateIds]
  );
  const manualPlanWarningsCount = useMemo(
    () => manualContainerPreview.reduce((sum, container) => sum + (container.warnings || []).length, 0),
    [manualContainerPreview]
  );

  const syncDraftFromCrate = (crate) => {
    if (!crate) {
      setCrateDraft(null);
      return;
    }
    setCrateDraft({
      name: crate.name || '',
      max_weight: crate.max_weight ?? 1000,
      reserved_space_pct: crate.reserved_space_pct ?? 0,
      planner_notes: crate.planner_notes || '',
      locked: Boolean(crate.locked),
      custom: Boolean(crate.custom),
      dimension_mode: crate.dimension_mode || 'auto',
      internal_length: crate.internal_length ?? '',
      internal_width: crate.internal_width ?? '',
      internal_height: crate.internal_height ?? '',
      external_length: crate.external_length ?? '',
      external_width: crate.external_width ?? '',
      external_height: crate.external_height ?? '',
    });
  };

  useEffect(() => {
    return () => {
      if (spinnerTimerRef.current) {
        clearTimeout(spinnerTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (selectedCrateId && !cratesById[selectedCrateId]) {
      setSelectedCrateId(null);
      setCrateDraft(null);
    }
  }, [cratesById, selectedCrateId]);

  useEffect(() => {
    setSelectedCrateIds((prev) => prev.filter((id) => cratesById[id]));
    setSelectedPieceIds((prev) => prev.filter((id) => pieceById[id]));
  }, [cratesById, pieceById]);

  useEffect(() => {
    if (selectedCrate) {
      syncDraftFromCrate(selectedCrate);
    }
  }, [selectedCrate?.id, selectedCrate?.locked, selectedCrate?.fill_percent, selectedCrate?.dimension_mode]);

  useEffect(() => {
    if (!insights?.container_loading_plan?.containers) {
      setManualContainers([]);
      setManualPlanDirty(false);
      setContainerAddDrafts({});
      return;
    }
    setManualContainers(buildEditableContainersFromPlan(insights.container_loading_plan.containers));
    setManualPlanDirty(false);
    setContainerAddDrafts({});
  }, [insights]);

  const fetchInsights = async () => {
    try {
      const response = await axios.get(`${API_BASE}/projects/${project.id}/crates/insights`);
      setInsights(response.data);
    } catch (error) {
      console.error('Failed to load crate insights', error);
    }
  };

  useEffect(() => {
    if (hasCrates) {
      fetchInsights();
    } else {
      setInsights(null);
    }
  }, [project.id, hasCrates, crates, assignments, pieces]);

  const refreshWorkspace = async () => {
    await onDataChange?.();
  };

  const autoGenerate = async () => {
    if (isGenerating) return;
    try {
      setIsGenerating(true);
      setShowSpinner(false);
      spinnerTimerRef.current = setTimeout(() => {
        setShowSpinner(true);
      }, 3000);
      await axios.post(`${API_BASE}/projects/${project.id}/crates/auto-generate`, {
        group_by: strategy,
        max_weight: maxWeight,
      });
      await refreshWorkspace();
    } catch (error) {
      console.error(error);
      alert('Error generating crates');
    } finally {
      if (spinnerTimerRef.current) {
        clearTimeout(spinnerTimerRef.current);
        spinnerTimerRef.current = null;
      }
      setShowSpinner(false);
      setIsGenerating(false);
    }
  };

  const updateContainerView = (containerId, patch) => {
    setContainerViews((prev) => ({
      ...prev,
      [containerId]: { ...defaultContainerView, ...(prev[containerId] || {}), ...patch },
    }));
  };

  const loadRecommendedContainerDraft = () => {
    setManualContainers(buildEditableContainersFromPlan(insights?.container_loading_plan?.containers || []));
    setManualPlanDirty(false);
    setContainerAddDrafts({});
  };

  const addManualContainer = (type) => {
    setManualContainers((prev) => [...prev, createManualContainerDraft(type)]);
    setManualPlanDirty(true);
  };

  const removeManualContainer = (containerId) => {
    setManualContainers((prev) => prev.filter((container) => container.id !== containerId));
    setContainerAddDrafts((prev) => {
      const next = { ...prev };
      delete next[containerId];
      return next;
    });
    setManualPlanDirty(true);
  };

  const updateManualContainerType = (containerId, type) => {
    setManualContainers((prev) =>
      prev.map((container) => (container.id === containerId ? { ...container, type } : container))
    );
    setManualPlanDirty(true);
  };

  const suggestPlacementForContainer = (containerId, crateId, rotated = false) => {
    const containerDraft = manualContainers.find((container) => container.id === containerId);
    const preview = manualContainerPreview.find((container) => container.id === containerId);
    const crate = crateByCode[crateId];
    const spec = CONTAINER_SPECS[containerDraft?.type] || CONTAINER_SPECS['40ft'];
    const dims = placementDimensionsForDraft(crate, rotated);
    const nextX = preview?.placements?.reduce((max, placement) => Math.max(max, placement.x + placement.length), 0) || 0;
    return {
      x: Number(Math.min(nextX, Math.max(0, spec.max_length - dims.length)).toFixed(1)),
      y: 0,
    };
  };

  const addCrateToManualContainer = (containerId, crateId) => {
    if (!crateId) return;
    const suggested = suggestPlacementForContainer(containerId, crateId);
    setManualContainers((prev) =>
      prev.map((container) => {
        const placements = (container.placements || []).filter((placement) => placement.crate_id !== crateId);
        if (container.id !== containerId) {
          return { ...container, placements };
        }
        return {
          ...container,
          placements: [
            ...placements,
            {
              crate_id: crateId,
              x: suggested.x,
              y: suggested.y,
              rotated: false,
              loading_order: placements.length + 1,
              unload_order: placements.length + 1,
            },
          ],
        };
      })
    );
    setContainerAddDrafts((prev) => ({ ...prev, [containerId]: '' }));
    setManualPlanDirty(true);
  };

  const updateManualPlacement = (containerId, crateId, patch) => {
    setManualContainers((prev) =>
      prev.map((container) =>
        container.id === containerId
          ? {
              ...container,
              placements: (container.placements || []).map((placement) =>
                placement.crate_id === crateId ? { ...placement, ...patch } : placement
              ),
            }
          : container
      )
    );
    setManualPlanDirty(true);
  };

  const removeManualPlacement = (containerId, crateId) => {
    setManualContainers((prev) =>
      prev.map((container) =>
        container.id === containerId
          ? {
              ...container,
              placements: (container.placements || []).filter((placement) => placement.crate_id !== crateId),
            }
          : container
      )
    );
    setManualPlanDirty(true);
  };

  const saveManualContainerPlan = async () => {
    const activeContainers = manualContainers
      .filter((container) => (container.placements || []).length > 0)
      .map((container) => ({
        id: container.id,
        type: container.type,
        placements: (container.placements || []).map((placement, index) => ({
          crate_id: placement.crate_id,
          x: Number(placement.x || 0),
          y: Number(placement.y || 0),
          rotated: Boolean(placement.rotated),
          loading_order: Number(placement.loading_order || index + 1),
          unload_order: Number(placement.unload_order || index + 1),
        })),
      }));

    if (activeContainers.length === 0) {
      await axios.delete(`${API_BASE}/projects/${project.id}/container-plan`);
    } else {
      await axios.put(`${API_BASE}/projects/${project.id}/container-plan`, { containers: activeContainers });
    }
    setManualPlanDirty(false);
    await refreshWorkspace();
  };

  const resetManualContainerPlan = async () => {
    await axios.delete(`${API_BASE}/projects/${project.id}/container-plan`);
    setManualPlanDirty(false);
    await refreshWorkspace();
  };

  const deleteCrate = async (crateId) => {
    if (!window.confirm('Delete this crate and unassign its pieces?')) return;
    await axios.delete(`${API_BASE}/crates/${crateId}`);
    setSelectedCrateIds((prev) => prev.filter((id) => id !== crateId));
    if (selectedCrateId === crateId) {
      setSelectedCrateId(null);
      setCrateDraft(null);
    }
    await refreshWorkspace();
  };

  const toggleCrateSelection = (crateId) => {
    setSelectedCrateIds((prev) =>
      prev.includes(crateId) ? prev.filter((id) => id !== crateId) : [...prev, crateId]
    );
  };

  const togglePieceSelection = (pieceId) => {
    setSelectedPieceIds((prev) =>
      prev.includes(pieceId) ? prev.filter((id) => id !== pieceId) : [...prev, pieceId]
    );
  };

  const assignPiece = async (pieceId, crateId) => {
    await axios.post(`${API_BASE}/crates/assign`, { piece_id: pieceId, crate_id: crateId });
    await refreshWorkspace();
  };

  const unassignPiece = async (pieceId) => {
    await axios.post(`${API_BASE}/crates/unassign`, { piece_id: pieceId });
    await refreshWorkspace();
  };

  const handlePieceDrop = async (crate) => {
    if (!dragState || crate.locked || dragState.sourceCrateId === crate.id) return;
    await assignPiece(dragState.pieceId, crate.id);
    setDragState(null);
  };

  const handleUnassignedDrop = async () => {
    if (!dragState) return;
    await unassignPiece(dragState.pieceId);
    setDragState(null);
  };

  const saveCrateDraft = async () => {
    if (!selectedCrate || !crateDraft) return;
    const payload = {
      name: crateDraft.name,
      max_weight: Number(crateDraft.max_weight) || 1000,
      reserved_space_pct: Number(crateDraft.reserved_space_pct) || 0,
      planner_notes: crateDraft.planner_notes || '',
      locked: Boolean(crateDraft.locked),
      custom: Boolean(crateDraft.custom),
      dimension_mode: crateDraft.dimension_mode,
    };

    if (crateDraft.dimension_mode === 'manual') {
      payload.internal_length = Number(crateDraft.internal_length) || 0;
      payload.internal_width = Number(crateDraft.internal_width) || 0;
      payload.internal_height = Number(crateDraft.internal_height) || 0;
      payload.external_length = Number(crateDraft.external_length) || 0;
      payload.external_width = Number(crateDraft.external_width) || 0;
      payload.external_height = Number(crateDraft.external_height) || 0;
    }

    await axios.put(`${API_BASE}/projects/${project.id}/crates/${selectedCrate.id}`, payload);
    await refreshWorkspace();
  };

  const resetCrateSize = async () => {
    if (!selectedCrate) return;
    await axios.put(`${API_BASE}/projects/${project.id}/crates/${selectedCrate.id}`, {
      reset_dimensions: true,
      name: crateDraft?.name || selectedCrate.name,
      max_weight: Number(crateDraft?.max_weight || selectedCrate.max_weight) || 1000,
      reserved_space_pct: Number(crateDraft?.reserved_space_pct || selectedCrate.reserved_space_pct) || 0,
      planner_notes: crateDraft?.planner_notes || selectedCrate.planner_notes || '',
      locked: Boolean(crateDraft?.locked ?? selectedCrate.locked),
      custom: Boolean(crateDraft?.custom ?? selectedCrate.custom),
    });
    await refreshWorkspace();
  };

  const toggleLock = async (crate) => {
    await axios.put(`${API_BASE}/projects/${project.id}/crates/${crate.id}`, {
      name: crate.name,
      max_weight: crate.max_weight,
      reserved_space_pct: crate.reserved_space_pct || 0,
      planner_notes: crate.planner_notes || '',
      locked: !crate.locked,
      custom: crate.custom,
      dimension_mode: crate.dimension_mode,
    });
    await refreshWorkspace();
  };

  const mergeSelectedCrates = async () => {
    if (selectedCrateIds.length < 2 || anyLockedSelection) return;
    const targetCrateId = selectedCrateIds.includes(selectedCrateId) ? selectedCrateId : selectedCrateIds[0];
    await axios.post(`${API_BASE}/projects/${project.id}/crates/merge`, {
      crate_ids: selectedCrateIds,
      target_crate_id: targetCrateId,
    });
    setSelectedCrateIds([targetCrateId]);
    setSelectedCrateId(targetCrateId);
    await refreshWorkspace();
  };

  const createCustomCrate = async () => {
    const payload = {
      ...customDraft,
      name: customDraft.name || `Custom ${crates.length + 1}`,
      max_weight: Number(customDraft.max_weight) || 1000,
      reserved_space_pct: Number(customDraft.reserved_space_pct) || 0,
      locked: Boolean(customDraft.locked),
      custom: true,
      piece_ids: selectedPieceIds,
    };
    const response = await axios.post(`${API_BASE}/projects/${project.id}/crates/`, payload);
    setCustomDraft(blankCustomDraft);
    setSelectedPieceIds([]);
    setSelectedCrateId(response.data.id);
    await refreshWorkspace();
  };

  const moveSelectedPiecesToCrate = async () => {
    if (!selectedCrate || selectedPieceIds.length === 0 || selectedCrate.locked) return;
    await Promise.all(
      selectedPieceIds.map((pieceId) =>
        axios.post(`${API_BASE}/crates/assign`, { piece_id: pieceId, crate_id: selectedCrate.id })
      )
    );
    setSelectedPieceIds([]);
    await refreshWorkspace();
  };

  const clearSelections = () => {
    setSelectedCrateIds([]);
    setSelectedPieceIds([]);
  };

  const destinationLegend = useMemo(
    () =>
      Object.entries(destinationColorMap).slice(0, 8).map(([destination, color]) => ({ destination, color })),
    [destinationColorMap]
  );

  return (
    <div className="mt-6 text-[#334155]">
      <div className="rounded-3xl border border-[#d7e0ea] bg-[radial-gradient(circle_at_top_left,_rgba(29,78,216,0.08),_transparent_32%),linear-gradient(135deg,_#f8fbff,_#f6f8fc)] p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="label-text">Packing Mode</label>
            <select className="input-field w-60" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              <option value="smart">Smart Destination Pack</option>
              <option value="apartment">Strict Destination Grouping</option>
              <option value="family">Family First Grouping</option>
            </select>
          </div>
          <div>
            <label className="label-text">Gross Limit / Crate (kg)</label>
            <input
              type="number"
              className="input-field w-36"
              value={maxWeight}
              onChange={(e) => setMaxWeight(Number(e.target.value))}
            />
          </div>
          <div className="relative">
            <button
              onClick={autoGenerate}
              disabled={isGenerating}
              className={`btn-primary inline-flex items-center gap-2 ${isGenerating ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {showSpinner && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
              {showSpinner ? 'Engineering Crates...' : 'Auto-Generate Crates'}
            </button>
            {showSpinner && (
              <div className="absolute left-0 top-full mt-2 rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-xs text-[#475569] shadow-sm">
                Rebuilding crate engineering and container plan...
              </div>
            )}
          </div>
          <button
            type="button"
            className={`btn-primary ${selectedCrateIds.length < 2 || anyLockedSelection ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={mergeSelectedCrates}
            disabled={selectedCrateIds.length < 2 || anyLockedSelection}
          >
            Merge Selected Crates
          </button>
          <button
            type="button"
            className={`btn-primary ${selectedPieceIds.length === 0 || !selectedCrateId || selectedCrate?.locked ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={moveSelectedPiecesToCrate}
            disabled={selectedPieceIds.length === 0 || !selectedCrateId || selectedCrate?.locked}
          >
            Move Selected Parts Here
          </button>
          <button type="button" className="btn-primary" onClick={refreshWorkspace}>
            Recalculate View
          </button>
          <button type="button" className="btn-danger" onClick={clearSelections}>
            Clear Planner Selection
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-[#475569]">
          <div className="rounded-full bg-white/80 px-3 py-1 shadow-sm">Selected crates: {selectedCrateIds.length}</div>
          <div className="rounded-full bg-white/80 px-3 py-1 shadow-sm">Selected parts: {selectedPieceIds.length}</div>
          <div className="rounded-full bg-white/80 px-3 py-1 shadow-sm">Locked crates stay untouched on auto-generate</div>
        </div>
      </div>

      {insights && (
        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr,0.95fr]">
          <div className="rounded-3xl border border-[#dbe4f0] bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-[#64748b]">1. Summary Of Crate Plan</div>
                <div className="mt-2 text-2xl font-semibold text-[#0f172a]">
                  {insights.summary?.recommended_containers || 'No recommendation'}
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[#475569]">
                  {insights.container_plan?.reason}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                  <div className="text-[#64748b]">Crates</div>
                  <div className="mt-1 text-xl font-semibold text-[#0f172a]">{insights.summary?.crates_created || 0}</div>
                </div>
                <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                  <div className="text-[#64748b]">Shipment Wt</div>
                  <div className="mt-1 text-xl font-semibold text-[#0f172a]">
                    {formatNumber(insights.summary?.shipment_weight, 0)} kg
                  </div>
                </div>
                <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                  <div className="text-[#64748b]">Avg Fill</div>
                  <div className="mt-1 text-xl font-semibold text-[#0f172a]">
                    {formatNumber(insights.efficiency_kpis?.average_fill_percent, 1)}%
                  </div>
                </div>
                <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                  <div className="text-[#64748b]">Avg Gross Util</div>
                  <div className="mt-1 text-xl font-semibold text-[#0f172a]">
                    {formatNumber(insights.efficiency_kpis?.average_weight_utilization, 1)}%
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {(insights.container_options || []).map((option) => (
                <div
                  key={option.mode}
                  className={`rounded-2xl border p-4 ${
                    option.label === insights.container_plan?.mode_label
                      ? 'border-[#1d4ed8] bg-[#eff6ff]'
                      : 'border-[#e2e8f0] bg-[#f8fafc]'
                  }`}
                >
                  <div className="text-xs uppercase tracking-[0.18em] text-[#64748b]">{option.mode}</div>
                  <div className="mt-1 text-lg font-semibold text-[#0f172a]">{option.label}</div>
                  <div className="mt-2 text-xs text-[#475569]">Feasible: {option.feasible ? 'Yes' : 'No'}</div>
                  <div className="text-xs text-[#475569]">Avg weight util: {formatNumber(option.average_weight_utilization, 0)}%</div>
                  <div className="text-xs text-[#475569]">Avg floor util: {formatNumber(option.average_length_utilization, 0)}%</div>
                  <div className="text-xs text-[#475569]">Cost index: {formatNumber(option.cost_index, 2)}</div>
                </div>
              ))}
            </div>

            {(insights.underfilled_crates || []).length > 0 && (
              <div className="mt-5 grid gap-3">
                {insights.underfilled_crates.map((crate) => {
                  const meta = getStatusMeta(crate.status);
                  return (
                    <div
                      key={crate.crate_id}
                      className={`rounded-2xl border bg-gradient-to-br ${meta.surface} ${meta.border} p-4`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-[#0f172a]">{crate.crate_id}</div>
                          <div className="text-sm text-[#475569]">{crate.name}</div>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${meta.badge}`}>
                          Fill {formatNumber(crate.utilization, 0)}%
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[#475569]">{crate.suggestion}</p>
                      {crate.merge_candidates?.length > 0 && (
                        <div className="mt-2 text-xs text-[#1d4ed8]">
                          Merge candidates: {crate.merge_candidates.join(', ')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-[#dbe4f0] bg-white p-5 shadow-sm">
            <div className="text-xs uppercase tracking-[0.2em] text-[#64748b]">Exceptions / Warnings</div>
            <div className="mt-4 space-y-3">
              {(insights.exceptions || []).length === 0 && (
                <div className="rounded-2xl border border-[#dcfce7] bg-[#f0fdf4] px-4 py-5 text-sm text-[#166534]">
                  No open crate or container exceptions right now.
                </div>
              )}
              {(insights.exceptions || []).map((row, index) => {
                const meta = getStatusMeta(row.severity);
                return (
                  <div key={`${row.scope}-${row.id}-${index}`} className={`rounded-2xl border ${meta.border} bg-white px-4 py-3`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-[#0f172a]">
                        {row.scope === 'crate' ? row.id : `${row.id} ${row.name}`}
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.badge}`}>
                        {row.severity}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-[#475569]">{row.message}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.55fr,1fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-[#dbe4f0] bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-[#64748b]">2. Crate Onboarding To Container</div>
                <div className="mt-1 text-lg font-semibold text-[#0f172a]">
                  Review the recommendation, then add, move, rotate, and save crate positions
                </div>
              </div>
              {destinationLegend.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {destinationLegend.map((item) => (
                    <div key={item.destination} className="inline-flex items-center gap-2 rounded-full border border-[#e2e8f0] px-3 py-1 text-xs text-[#475569]">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                      {item.destination}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-5 rounded-3xl border border-[#dbe4f0] bg-[#f8fafc] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-[#e2e8f0] bg-white px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Draft Mix</div>
                    <div className="mt-1 text-base font-semibold text-[#0f172a]">{containerDraftSummary.label}</div>
                  </div>
                  <div className="rounded-2xl border border-[#e2e8f0] bg-white px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Placed Crates</div>
                    <div className="mt-1 text-base font-semibold text-[#0f172a]">
                      {placedCrateIds.size} / {cratesWithItems.length}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#e2e8f0] bg-white px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Unplaced Crates</div>
                    <div className="mt-1 text-base font-semibold text-[#0f172a]">{unplacedCratesForContainerPlan.length}</div>
                  </div>
                  <div className="rounded-2xl border border-[#e2e8f0] bg-white px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Live Warnings</div>
                    <div className="mt-1 text-base font-semibold text-[#0f172a]">{manualPlanWarningsCount}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary !px-3 !py-2" onClick={() => addManualContainer('20ft')}>
                    + Add 20ft
                  </button>
                  <button type="button" className="btn-primary !px-3 !py-2" onClick={() => addManualContainer('40ft')}>
                    + Add 40ft
                  </button>
                  <button type="button" className="btn-primary !px-3 !py-2" onClick={loadRecommendedContainerDraft}>
                    Reload Active Plan
                  </button>
                  <button type="button" className="btn-primary !px-3 !py-2" onClick={saveManualContainerPlan}>
                    Save Container Overrides
                  </button>
                  <button type="button" className="btn-danger !px-3 !py-2" onClick={resetManualContainerPlan}>
                    Reset Saved Plan
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-[#475569]">
                <div className="rounded-full bg-white px-3 py-1 shadow-sm">
                  Empty draft containers are ignored until at least one crate is added.
                </div>
                <div className="rounded-full bg-white px-3 py-1 shadow-sm">
                  {manualPlanDirty ? 'Unsaved container edits present' : 'Container draft matches the latest saved/recommended state'}
                </div>
              </div>
            </div>

            {unplacedCratesForContainerPlan.length > 0 && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <div className="font-semibold">Crates waiting for onboarding</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {unplacedCratesForContainerPlan.map((crate) => (
                    <span key={crate.id} className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs text-amber-900">
                      {crate.crate_id} · {formatNumber(crate.gross_weight, 0)} kg
                    </span>
                  ))}
                </div>
              </div>
            )}

            {manualContainerPreview.length > 0 ? (
              <div className="mt-5 space-y-6">
                {manualContainerPreview.map((container) => {
                  const draftContainer = manualContainers.find((item) => item.id === container.id) || { placements: [] };
                  const view = { ...defaultContainerView, ...(containerViews[container.id] || {}) };
                  return (
                    <div key={container.id} className="rounded-3xl border border-[#e2e8f0] bg-[#f8fafc] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="text-lg font-semibold text-[#0f172a]">{container.id}</div>
                            <select
                              className="input-field !w-28"
                              value={container.type}
                              onChange={(e) => updateManualContainerType(container.id, e.target.value)}
                            >
                              <option value="20ft">20ft</option>
                              <option value="40ft">40ft</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => removeManualContainer(container.id)}
                              className="rounded-full border border-[#fecaca] bg-[#fff1f2] px-3 py-1 text-[11px] font-semibold text-[#be123c]"
                            >
                              Remove Container
                            </button>
                          </div>
                          <div className="mt-1 text-sm text-[#475569]">
                            Gross {formatNumber(container.used_weight, 0)} / {formatNumber(container.max_weight, 0)} kg ·
                            Floor {formatNumber(container.used_length, 1)} / {formatNumber(container.max_length, 1)} in
                          </div>
                          <div className="mt-1 text-xs text-[#64748b]">
                            Balance L/R {formatNumber(container.balance?.left_right_delta_pct, 1)}% ·
                            F/R {formatNumber(container.balance?.front_rear_delta_pct, 1)}%
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <button className="btn-primary !px-3 !py-1.5" onClick={() => updateContainerView(container.id, { zoom: view.zoom + 0.15 })}>Zoom +</button>
                          <button className="btn-primary !px-3 !py-1.5" onClick={() => updateContainerView(container.id, { zoom: Math.max(0.7, view.zoom - 0.15) })}>Zoom -</button>
                          <button className="btn-primary !px-3 !py-1.5" onClick={() => updateContainerView(container.id, { x: view.x - 12 })}>Pan ←</button>
                          <button className="btn-primary !px-3 !py-1.5" onClick={() => updateContainerView(container.id, { x: view.x + 12 })}>Pan →</button>
                          <button className="btn-primary !px-3 !py-1.5" onClick={() => updateContainerView(container.id, { y: view.y - 8 })}>Pan ↑</button>
                          <button className="btn-primary !px-3 !py-1.5" onClick={() => updateContainerView(container.id, { y: view.y + 8 })}>Pan ↓</button>
                          <button className="btn-primary !px-3 !py-1.5" onClick={() => updateContainerView(container.id, { rotation: (view.rotation + 90) % 360 })}>Rotate</button>
                          <button className="btn-danger !px-3 !py-1.5" onClick={() => updateContainerView(container.id, defaultContainerView)}>Reset</button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr),auto]">
                        <select
                          className="input-field"
                          value={containerAddDrafts[container.id] || ''}
                          onChange={(e) => setContainerAddDrafts((prev) => ({ ...prev, [container.id]: e.target.value }))}
                        >
                          <option value="">Add or move crate to this container...</option>
                          {cratesWithItems
                            .filter((crate) => !draftContainer.placements.some((placement) => placement.crate_id === crate.crate_id))
                            .map((crate) => (
                            <option key={crate.id} value={crate.crate_id}>
                              {crate.crate_id} · {crate.destination_group} · {formatNumber(crate.gross_weight, 0)} kg
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className={`btn-primary ${!(containerAddDrafts[container.id] || '') ? 'opacity-50 cursor-not-allowed' : ''}`}
                          disabled={!(containerAddDrafts[container.id] || '')}
                          onClick={() => addCrateToManualContainer(container.id, containerAddDrafts[container.id])}
                        >
                          Add / Move Crate
                        </button>
                      </div>

                      <div className="mt-4 overflow-hidden rounded-2xl border border-[#cbd5e1] bg-white">
                        <svg viewBox={`0 0 ${container.max_length} ${container.max_width}`} className="w-full min-h-[220px]">
                          <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom}) rotate(${view.rotation} ${container.max_length / 2} ${container.max_width / 2})`}>
                            <rect x="0" y="0" width={container.max_length} height={container.max_width} fill="#f8fafc" stroke="#64748b" strokeWidth="1.8" rx="2" />
                            <rect
                              x={container.zones?.door_zone?.x || container.max_length - 12}
                              y="0"
                              width={container.zones?.door_zone?.length || 12}
                              height={container.max_width}
                              fill="rgba(245,158,11,0.12)"
                            />
                            <line
                              x1="0"
                              y1={container.zones?.centerline || container.max_width / 2}
                              x2={container.max_length}
                              y2={container.zones?.centerline || container.max_width / 2}
                              stroke="#94a3b8"
                              strokeDasharray="6 5"
                            />
                            {(container.empty_spaces || []).map((space, index) => (
                              <rect
                                key={`space-${index}`}
                                x={space.x}
                                y={space.y}
                                width={space.length}
                                height={space.width}
                                fill="rgba(148,163,184,0.18)"
                                stroke="rgba(148,163,184,0.35)"
                                strokeDasharray="4 4"
                              />
                            ))}
                            {(container.placements || []).map((placement) => {
                              const color = destinationColorMap[placement.destination_group] || '#1d4ed8';
                              return (
                                <g key={`${container.id}-${placement.crate_id}`}>
                                  <rect
                                    x={placement.x}
                                    y={placement.y}
                                    width={placement.length}
                                    height={placement.width}
                                    fill={color}
                                    fillOpacity="0.88"
                                    stroke="#ffffff"
                                    strokeWidth="1"
                                    rx="1.5"
                                  />
                                  <text
                                    x={placement.x + placement.length / 2}
                                    y={placement.y + placement.width / 2}
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    fontSize="5.5"
                                    fill="#ffffff"
                                    fontWeight="700"
                                  >
                                    {placement.crate_id}
                                  </text>
                                  <text
                                    x={placement.x + placement.length / 2}
                                    y={placement.y + placement.width / 2 + 6}
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    fontSize="4"
                                    fill="#eff6ff"
                                  >
                                    {Math.round(placement.weight)}kg
                                  </text>
                                </g>
                              );
                            })}
                          </g>
                        </svg>
                      </div>

                      <div className="mt-3 grid gap-2 text-xs text-[#475569] md:grid-cols-2">
                        <div>Front wall at x=0, doors at far right, centerline shown dashed.</div>
                        <div>Adjust `x`, `y`, rotation, and load order below. Save to make this the active container plan.</div>
                      </div>
                      {(container.warnings || []).length > 0 && (
                        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                          {container.warnings.join(' · ')}
                        </div>
                      )}

                      <div className="mt-4 overflow-x-auto rounded-2xl border border-[#e2e8f0] bg-white">
                        <table className="w-full text-left text-xs text-[#475569]">
                          <thead className="bg-[#f8fafc] text-[#334155]">
                            <tr>
                              <th className="px-3 py-2">Crate</th>
                              <th className="px-3 py-2">X</th>
                              <th className="px-3 py-2">Y</th>
                              <th className="px-3 py-2">Rotate</th>
                              <th className="px-3 py-2">Load</th>
                              <th className="px-3 py-2">Unload</th>
                              <th className="px-3 py-2">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {draftContainer.placements.length === 0 && (
                              <tr>
                                <td colSpan="7" className="px-3 py-5 text-center text-sm text-[#64748b]">
                                  No crates in this container yet. Add one from the unplaced list above.
                                </td>
                              </tr>
                            )}
                            {draftContainer.placements.map((placement) => {
                              const placementPreview = container.placements.find((item) => item.crate_id === placement.crate_id);
                              return (
                                <tr key={`${container.id}-${placement.crate_id}`} className="border-t border-[#f1f5f9]">
                                  <td className="px-3 py-2">
                                    <div className="font-semibold text-[#0f172a]">{placement.crate_id}</div>
                                    <div className="text-[11px] text-[#64748b]">
                                      {placementPreview?.destination_group || 'No destination'} · {formatNumber(placementPreview?.weight, 0)} kg
                                    </div>
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="number"
                                      step="0.1"
                                      className="input-field !w-24"
                                      value={placement.x}
                                      onChange={(e) => updateManualPlacement(container.id, placement.crate_id, { x: Number(e.target.value) || 0 })}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="number"
                                      step="0.1"
                                      className="input-field !w-24"
                                      value={placement.y}
                                      onChange={(e) => updateManualPlacement(container.id, placement.crate_id, { y: Number(e.target.value) || 0 })}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <label className="inline-flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(placement.rotated)}
                                        onChange={(e) => updateManualPlacement(container.id, placement.crate_id, { rotated: e.target.checked })}
                                      />
                                      <span>{placement.rotated ? 'Yes' : 'No'}</span>
                                    </label>
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="number"
                                      min="1"
                                      className="input-field !w-20"
                                      value={placement.loading_order}
                                      onChange={(e) => updateManualPlacement(container.id, placement.crate_id, { loading_order: Number(e.target.value) || 1 })}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="number"
                                      min="1"
                                      className="input-field !w-20"
                                      value={placement.unload_order}
                                      onChange={(e) => updateManualPlacement(container.id, placement.crate_id, { unload_order: Number(e.target.value) || 1 })}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <button
                                      type="button"
                                      className="rounded-full border border-[#fecaca] bg-[#fff1f2] px-3 py-1 text-[11px] font-semibold text-[#be123c]"
                                      onClick={() => removeManualPlacement(container.id, placement.crate_id)}
                                    >
                                      Remove
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-[#cbd5e1] px-5 py-10 text-center text-sm text-[#64748b]">
                Generate crates to build the container blueprint.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-[#dbe4f0] bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-[#64748b]">3. Crate Sizing And Balancing</div>
                <div className="mt-1 text-lg font-semibold text-[#0f172a]">
                  Move parts, merge crates, reserve space, and rebalance heavy/light mixes
                </div>
              </div>
              <div className="text-sm text-[#64748b]">
                Drag a part card into another crate or back to the unassigned lane.
              </div>
            </div>

            <div
              className="mt-5 rounded-3xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-4"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleUnassignedDrop}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-[#0f172a]">Unassigned Pieces ({unassigned.length})</div>
                <div className="text-xs text-[#64748b]">Drop here to remove a piece from any crate</div>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {unassigned.length === 0 && (
                  <div className="rounded-2xl border border-[#e2e8f0] bg-white px-4 py-5 text-sm text-[#64748b]">
                    No unassigned parts.
                  </div>
                )}
                {unassigned.map((piece) => (
                  <div
                    key={piece.id}
                    draggable
                    onDragStart={() => setDragState({ pieceId: piece.id, sourceCrateId: null })}
                    onDragEnd={() => setDragState(null)}
                    className="rounded-2xl border border-[#e2e8f0] bg-white p-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4"
                          checked={selectedPieceIds.includes(piece.id)}
                          onChange={() => togglePieceSelection(piece.id)}
                        />
                        <div>
                          <div className="font-medium text-[#0f172a]">{piece.part}</div>
                          <div className="text-xs text-[#64748b]">
                            {piece.drawing || 'No drawing'} · {piece.building || 'B?'} / {piece.floor || 'F?'} / {piece.flat || 'Unit?'}
                          </div>
                        </div>
                      </label>
                      <div className="text-sm font-semibold text-[#475569]">{formatNumber(pieceWeights[piece.id], 1)} kg</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {cratesWithItems.map((crate) => {
                const meta = getStatusMeta(crate.efficiency_status);
                const destinationColor = destinationColorMap[crate.destination_group] || '#1d4ed8';
                return (
                  <div
                    key={crate.id}
                    onClick={() => setSelectedCrateId(crate.id)}
                    onDragOver={(event) => {
                      if (!crate.locked) event.preventDefault();
                    }}
                    onDrop={() => handlePieceDrop(crate)}
                    className={`cursor-pointer rounded-3xl border bg-gradient-to-br p-4 shadow-sm transition-all ${
                      selectedCrateId === crate.id
                        ? 'border-[#1d4ed8] shadow-[0_0_0_3px_rgba(29,78,216,0.12)]'
                        : `border-[#dbe4f0] ${meta.border}`
                    } ${meta.surface}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4"
                          checked={selectedCrateIds.includes(crate.id)}
                          onChange={(event) => {
                            event.stopPropagation();
                            toggleCrateSelection(crate.id);
                          }}
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="font-semibold text-[#0f172a]">{crate.crate_id}</div>
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.badge}`}>{meta.label}</span>
                          </div>
                          <div className="mt-1 text-sm text-[#475569]">{crate.name}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleLock(crate);
                          }}
                          className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                            crate.locked
                              ? 'border-[#1d4ed8] bg-[#dbeafe] text-[#1d4ed8]'
                              : 'border-[#cbd5e1] bg-white text-[#475569]'
                          }`}
                        >
                          {crate.locked ? 'Locked' : 'Lock'}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteCrate(crate.id);
                          }}
                          className="rounded-full border border-[#fecaca] bg-[#fff1f2] px-3 py-1 text-[11px] font-semibold text-[#be123c]"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center gap-3 text-xs">
                      <span className="inline-flex items-center gap-2 rounded-full border border-[#dbe4f0] bg-white px-3 py-1">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: destinationColor }} />
                        {crate.destination_group}
                      </span>
                      <span className="rounded-full border border-[#dbe4f0] bg-white px-3 py-1">{crate.family_group}</span>
                    </div>

                    <div className="mt-4">
                      <div className="h-2.5 overflow-hidden rounded-full bg-white/70">
                        <div
                          className={`h-full bg-gradient-to-r ${meta.bar}`}
                          style={{ width: `${Math.min(crate.fill_percent || 0, 100)}%` }}
                        />
                      </div>
                      <div className="mt-2 flex justify-between text-xs font-medium text-[#475569]">
                        <span>Fill {formatNumber(crate.fill_percent, 1)}%</span>
                        <span>Gross util {formatNumber(crate.gross_utilization, 1)}%</span>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[#475569]">
                      <div className="rounded-2xl bg-white/80 px-3 py-2">Net {formatNumber(crate.total_weight, 1)} kg</div>
                      <div className="rounded-2xl bg-white/80 px-3 py-2">Gross {formatNumber(crate.gross_weight, 1)} kg</div>
                      <div className="rounded-2xl bg-white/80 px-3 py-2">Tare {formatNumber(crate.tare_weight, 1)} kg</div>
                      <div className="rounded-2xl bg-white/80 px-3 py-2">{crate.wood_type} {formatNumber(crate.wood_thickness, 2)} in</div>
                      <div className="rounded-2xl bg-white/80 px-3 py-2">{crate.stackable ? 'Stackable' : 'Single layer'}</div>
                      <div className="rounded-2xl bg-white/80 px-3 py-2">Forklift {crate.forklift_entry}</div>
                      <div className="rounded-2xl bg-white/80 px-3 py-2">
                        Reserve {formatNumber(crate.reserved_space_pct, 0)}%
                      </div>
                    </div>

                    <div className="mt-4 text-[11px] leading-5 text-[#64748b]">
                      Int {formatNumber(crate.internal_length)} × {formatNumber(crate.internal_width)} × {formatNumber(crate.internal_height)} in
                      <br />
                      Ext {formatNumber(crate.external_length)} × {formatNumber(crate.external_width)} × {formatNumber(crate.external_height)} in
                    </div>

                    {(crate.warnings || []).length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {crate.warnings.slice(0, 3).map((warning) => (
                          <span key={warning} className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${meta.badge}`}>
                            {warning}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 max-h-52 space-y-2 overflow-y-auto pr-1">
                      {crate.items.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-white px-3 py-4 text-xs text-[#64748b]">
                          Empty custom crate. Drop parts here or create a reserved-space hold.
                        </div>
                      )}
                      {crate.items.map((piece) => (
                        <div
                          key={piece.id}
                          draggable={!crate.locked}
                          onDragStart={() => setDragState({ pieceId: piece.id, sourceCrateId: crate.id })}
                          onDragEnd={() => setDragState(null)}
                          className={`rounded-2xl border border-[#e2e8f0] bg-white px-3 py-3 text-sm shadow-sm ${crate.locked ? 'cursor-not-allowed opacity-80' : 'cursor-grab'}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <label className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4"
                                checked={selectedPieceIds.includes(piece.id)}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  togglePieceSelection(piece.id);
                                }}
                                disabled={crate.locked}
                              />
                              <div>
                                <div className="font-medium text-[#0f172a]">{piece.part}</div>
                                <div className="text-xs text-[#64748b]">
                                  {piece.drawing || 'No drawing'} · {piece.building || 'B?'} / {piece.floor || 'F?'} / {piece.flat || 'Unit?'}
                                </div>
                              </div>
                            </label>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                unassignPiece(piece.id);
                              }}
                              className="rounded-full border border-[#dbe4f0] px-2.5 py-1 text-[11px] text-[#475569]"
                              disabled={crate.locked}
                            >
                              Unassign
                            </button>
                          </div>
                          <div className="mt-2 flex justify-between text-xs text-[#475569]">
                            <span>{formatNumber(piece.length)} × {formatNumber(piece.width)} in</span>
                            <span>{formatNumber(pieceWeights[piece.id], 1)} kg</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {!hasCrates && (
              <div className="mt-5 rounded-2xl border border-dashed border-[#cbd5e1] px-5 py-8 text-center text-sm text-[#64748b]">
                Generate crates to start the planner board.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-[#dbe4f0] bg-white p-5 shadow-sm">
            <div className="text-xs uppercase tracking-[0.2em] text-[#64748b]">3.1 Crate Build Plan</div>
            <div className="mt-1 text-lg font-semibold text-[#0f172a]">
              {selectedCrate ? `${selectedCrate.crate_id} · ${selectedCrate.name}` : 'Select a crate to edit'}
            </div>

            {selectedCrate && crateDraft ? (
              <div className="mt-5 space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="label-text">Crate Name</label>
                    <input
                      className="input-field"
                      value={crateDraft.name}
                      onChange={(e) => setCrateDraft((prev) => ({ ...prev, name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label-text">Gross Limit (kg)</label>
                    <input
                      type="number"
                      className="input-field"
                      value={crateDraft.max_weight}
                      onChange={(e) => setCrateDraft((prev) => ({ ...prev, max_weight: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label-text">Reserved Space %</label>
                    <input
                      type="number"
                      className="input-field"
                      value={crateDraft.reserved_space_pct}
                      onChange={(e) => setCrateDraft((prev) => ({ ...prev, reserved_space_pct: e.target.value }))}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="label-text">Planner Notes</label>
                    <textarea
                      className="input-field min-h-[88px] resize-y"
                      value={crateDraft.planner_notes}
                      onChange={(e) => setCrateDraft((prev) => ({ ...prev, planner_notes: e.target.value }))}
                    />
                  </div>
                  <label className="col-span-2 inline-flex items-center gap-3 rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-sm text-[#334155]">
                    <input
                      type="checkbox"
                      checked={Boolean(crateDraft.locked)}
                      onChange={(e) => setCrateDraft((prev) => ({ ...prev, locked: e.target.checked }))}
                    />
                    Lock this crate so future auto-generation preserves it.
                  </label>
                </div>

                <div className="rounded-3xl border border-[#e2e8f0] bg-[#f8fafc] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-[#0f172a]">Resize Crate</div>
                    <select
                      className="input-field max-w-[180px]"
                      value={crateDraft.dimension_mode}
                      onChange={(e) => setCrateDraft((prev) => ({ ...prev, dimension_mode: e.target.value }))}
                    >
                      <option value="auto">Auto Dimensions</option>
                      <option value="manual">Manual Dimensions</option>
                    </select>
                  </div>

                  {crateDraft.dimension_mode === 'manual' && (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div><label className="label-text">Int L</label><input type="number" className="input-field" value={crateDraft.internal_length} onChange={(e) => setCrateDraft((prev) => ({ ...prev, internal_length: e.target.value }))} /></div>
                      <div><label className="label-text">Int W</label><input type="number" className="input-field" value={crateDraft.internal_width} onChange={(e) => setCrateDraft((prev) => ({ ...prev, internal_width: e.target.value }))} /></div>
                      <div><label className="label-text">Int H</label><input type="number" className="input-field" value={crateDraft.internal_height} onChange={(e) => setCrateDraft((prev) => ({ ...prev, internal_height: e.target.value }))} /></div>
                      <div><label className="label-text">Ext L</label><input type="number" className="input-field" value={crateDraft.external_length} onChange={(e) => setCrateDraft((prev) => ({ ...prev, external_length: e.target.value }))} /></div>
                      <div><label className="label-text">Ext W</label><input type="number" className="input-field" value={crateDraft.external_width} onChange={(e) => setCrateDraft((prev) => ({ ...prev, external_width: e.target.value }))} /></div>
                      <div><label className="label-text">Ext H</label><input type="number" className="input-field" value={crateDraft.external_height} onChange={(e) => setCrateDraft((prev) => ({ ...prev, external_height: e.target.value }))} /></div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-3">
                  <button className="btn-primary" onClick={saveCrateDraft}>Save Crate Overrides</button>
                  <button className="btn-danger" onClick={resetCrateSize}>Reset Auto Size</button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                    <div className="text-[#64748b]">Gross Weight</div>
                    <div className="mt-1 font-semibold text-[#0f172a]">{formatNumber(selectedCrate.gross_weight, 1)} kg</div>
                  </div>
                  <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                    <div className="text-[#64748b]">Fill</div>
                    <div className="mt-1 font-semibold text-[#0f172a]">{formatNumber(selectedCrate.fill_percent, 1)}%</div>
                  </div>
                  <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                    <div className="text-[#64748b]">Center of Gravity</div>
                    <div className="mt-1 font-semibold text-[#0f172a]">
                      {formatNumber(selectedCrate.center_of_gravity?.x)} / {formatNumber(selectedCrate.center_of_gravity?.y)} / {formatNumber(selectedCrate.center_of_gravity?.z)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                    <div className="text-[#64748b]">Forklift Entry</div>
                    <div className="mt-1 font-semibold text-[#0f172a]">{selectedCrate.forklift_entry}</div>
                  </div>
                  <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                    <div className="text-[#64748b]">Wood Standard</div>
                    <div className="mt-1 font-semibold text-[#0f172a]">
                      {selectedCrate.wood_type} · {formatNumber(selectedCrate.wood_thickness, 2)} in
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                    <div className="text-[#64748b]">Destination</div>
                    <div className="mt-1 font-semibold text-[#0f172a]">{selectedCrate.destination_group}</div>
                  </div>
                </div>

                <div className="rounded-3xl border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm leading-6 text-[#475569]">
                  <div className="font-semibold text-[#0f172a]">Handling Notes</div>
                  <div className="mt-2">{selectedCrate.handling_notes || 'No special handling notes on this crate.'}</div>
                </div>

                <div className="rounded-3xl border border-[#e2e8f0] bg-[#f8fafc] p-4">
                  <div className="font-semibold text-[#0f172a]">Contents</div>
                  <div className="mt-3 space-y-2">
                    {selectedCrate.items.map((piece) => (
                      <div key={piece.id} className="rounded-2xl border border-[#e2e8f0] bg-white px-3 py-3 text-sm">
                        <div className="font-medium text-[#0f172a]">{piece.part}</div>
                        <div className="text-xs text-[#64748b]">
                          {piece.drawing || 'No drawing'} · {piece.building || 'B?'} / {piece.floor || 'F?'} / {piece.flat || 'Unit?'}
                        </div>
                      </div>
                    ))}
                    {selectedCrate.items.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-white px-3 py-5 text-sm text-[#64748b]">
                        This crate is currently empty.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-3xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-4 py-8 text-center text-sm text-[#64748b]">
                Click any crate card to open its build plan, contents, and manual override controls.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-[#dbe4f0] bg-white p-5 shadow-sm">
            <div className="text-xs uppercase tracking-[0.2em] text-[#64748b]">3.2 Custom Crate</div>
            <div className="mt-1 text-lg font-semibold text-[#0f172a]">
              {selectedPieceIds.length > 0
                ? `Create crate from ${selectedPieceIds.length} selected part${selectedPieceIds.length > 1 ? 's' : ''}`
                : 'Create empty buffer / custom hold crate'}
            </div>
            <div className="mt-5 grid gap-3">
              <div>
                <label className="label-text">Crate Name</label>
                <input
                  className="input-field"
                  value={customDraft.name}
                  onChange={(e) => setCustomDraft((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-text">Gross Limit (kg)</label>
                  <input
                    type="number"
                    className="input-field"
                    value={customDraft.max_weight}
                    onChange={(e) => setCustomDraft((prev) => ({ ...prev, max_weight: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label-text">Reserved Space %</label>
                  <input
                    type="number"
                    className="input-field"
                    value={customDraft.reserved_space_pct}
                    onChange={(e) => setCustomDraft((prev) => ({ ...prev, reserved_space_pct: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="label-text">Planner Notes</label>
                <textarea
                  className="input-field min-h-[88px] resize-y"
                  value={customDraft.planner_notes}
                  onChange={(e) => setCustomDraft((prev) => ({ ...prev, planner_notes: e.target.value }))}
                />
              </div>
              <label className="inline-flex items-center gap-3 rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-sm text-[#334155]">
                <input
                  type="checkbox"
                  checked={Boolean(customDraft.locked)}
                  onChange={(e) => setCustomDraft((prev) => ({ ...prev, locked: e.target.checked }))}
                />
                Lock the crate immediately after creation.
              </label>
              <button className="btn-primary" onClick={createCustomCrate}>
                {selectedPieceIds.length > 0 ? 'Create Crate From Selected Parts' : 'Create Empty Custom Crate'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CrateGrid;
