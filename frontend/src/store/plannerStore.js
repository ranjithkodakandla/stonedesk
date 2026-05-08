import { create } from 'zustand';
import axios from 'axios';
import {
  API_BASE,
  buildAssignmentMap,
  buildEditableContainersFromPlan,
  createManualContainerDraft,
  emptyProject,
} from '../utils/plannerUtils';

let containerPersistTimer = null;

const withSelectedContainer = (manualContainers, currentId) => {
  if (currentId && manualContainers.some((container) => container.id === currentId)) return currentId;
  return manualContainers[0]?.id || null;
};

const withSelectedCrate = (crates, insightsCrates, currentId) => {
  const available = insightsCrates?.length ? insightsCrates : crates;
  if (currentId && available.some((crate) => crate.id === currentId)) return currentId;
  return available[0]?.id || null;
};

const triggerBrowserDownload = (url, filename) => {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || '';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1500);
};

export const usePlannerStore = create((set, get) => ({
  projectId: null,
  project: emptyProject,
  pieces: [],
  crates: [],
  assignments: {},
  insights: null,
  activeTab: 'summary',
  sourceDataOpen: false,
  isWorkspaceLoading: false,
  isRefreshing: false,
  selectedCrateId: null,
  selectedContainerId: null,
  selectedPlacementCrateId: null,
  manualContainers: [],
  manualContainerDirty: false,

  initialize: async (projectId) => {
    set({ projectId, isWorkspaceLoading: true });
    await get().refreshWorkspace({ firstLoad: true });
    set({ isWorkspaceLoading: false });
  },

  refreshWorkspace: async ({ firstLoad = false } = {}) => {
    const projectId = get().projectId;
    if (!projectId) return;
    set(firstLoad ? { isWorkspaceLoading: true } : { isRefreshing: true });
    try {
      const [projectRes, piecesRes, cratesRes, assignmentsRes] = await Promise.all([
        axios.get(`${API_BASE}/projects/${projectId}`),
        axios.get(`${API_BASE}/projects/${projectId}/pieces/`),
        axios.get(`${API_BASE}/projects/${projectId}/crates/`),
        axios.get(`${API_BASE}/projects/${projectId}/crates/assignments`),
      ]);

      // Insights fetch is non-fatal — workspace must still load if this fails
      let insightsData = null;
      try {
        const insightsRes = await axios.get(`${API_BASE}/projects/${projectId}/crates/insights`);
        insightsData = insightsRes.data;
      } catch (err) {
        console.warn('Insights fetch failed (non-fatal):', err.message);
      }

      const manualContainers = buildEditableContainersFromPlan(
        insightsData?.container_loading_plan?.containers || []
      );

      set((state) => ({
        project: { ...emptyProject, ...projectRes.data },
        pieces: piecesRes.data || [],
        crates: cratesRes.data || [],
        assignments: buildAssignmentMap(assignmentsRes.data || []),
        insights: insightsData,
        manualContainers,
        manualContainerDirty: false,
        selectedContainerId: withSelectedContainer(manualContainers, state.selectedContainerId),
        selectedPlacementCrateId: null,
        selectedCrateId: withSelectedCrate(cratesRes.data || [], insightsData?.crates || [], state.selectedCrateId),
      }));
    } catch (err) {
      console.error('Workspace refresh failed:', err);
    } finally {
      set({ isWorkspaceLoading: false, isRefreshing: false });
    }
  },

  setActiveTab: (activeTab) => set({ activeTab }),
  openSourceData: () => set({ sourceDataOpen: true }),
  closeSourceData: () => set({ sourceDataOpen: false }),
  setProjectDraft: (project) => set((state) => ({
    project: typeof project === 'function' ? project(state.project) : project,
  })),
  setSelectedCrateId: (selectedCrateId) => set({ selectedCrateId }),
  setSelectedContainerId: (selectedContainerId) => set({ selectedContainerId, selectedPlacementCrateId: null }),
  setSelectedPlacementCrateId: (selectedPlacementCrateId) => set({ selectedPlacementCrateId }),

  updateProject: async (patch) => {
    const projectId = get().projectId;
    const nextProject = { ...get().project, ...patch };
    set({ project: nextProject });
    await axios.put(`${API_BASE}/projects/${projectId}`, nextProject);
    await get().refreshWorkspace();
  },

  setPreferredContainerMode: async (mode) => {
    await get().updateProject({ preferred_container_mode: mode });
  },

  autoGenerateCrates: async (payload) => {
    await axios.post(`${API_BASE}/projects/${get().projectId}/crates/auto-generate`, payload);
    await get().refreshWorkspace();
  },

  generatePlan: async (packingMode = 'category') => {
    set({ isRefreshing: true });
    try {
      await axios.post(`${API_BASE}/projects/${get().projectId}/crates/auto-generate`, {
        group_by: packingMode,
        max_weight: 1000,
      });
      await get().refreshWorkspace();
      set({ activeTab: 'summary' });
    } finally {
      set({ isRefreshing: false });
    }
  },

  regenerateWithStrategy: async (strategy, weights = {}) => {
    set({ isRefreshing: true });
    try {
      await axios.post(`${API_BASE}/projects/${get().projectId}/crates/auto-generate`, {
        group_by: strategy,
        max_weight: 1000,
        weights,
      });
      await get().refreshWorkspace();
    } finally {
      set({ isRefreshing: false });
    }
  },

  splitCrate: async (crateId, pieceIds, name) => {
    await axios.post(`${API_BASE}/projects/${get().projectId}/crates/split`, {
      crate_id: crateId,
      piece_ids: pieceIds,
      name: name || 'Split Crate',
    });
    await get().refreshWorkspace();
  },

  updateCrate: async (crateId, payload) => {
    await axios.put(`${API_BASE}/projects/${get().projectId}/crates/${crateId}`, payload);
    await get().refreshWorkspace();
  },

  mergeCrates: async (crateIds, targetCrateId) => {
    await axios.post(`${API_BASE}/projects/${get().projectId}/crates/merge`, {
      crate_ids: crateIds,
      target_crate_id: targetCrateId,
    });
    await get().refreshWorkspace();
  },

  deleteCrate: async (crateId) => {
    await axios.delete(`${API_BASE}/crates/${crateId}`);
    await get().refreshWorkspace();
  },

  createCustomCrate: async (payload) => {
    await axios.post(`${API_BASE}/projects/${get().projectId}/crates/`, payload);
    await get().refreshWorkspace();
  },

  assignPiece: async (pieceId, crateId) => {
    await axios.post(`${API_BASE}/crates/assign`, { piece_id: pieceId, crate_id: crateId });
    await get().refreshWorkspace();
  },

  unassignPiece: async (pieceId) => {
    await axios.post(`${API_BASE}/crates/unassign`, { piece_id: pieceId });
    await get().refreshWorkspace();
  },

  deletePiece: async (pieceId) => {
    await axios.delete(`${API_BASE}/pieces/${pieceId}`);
    await get().refreshWorkspace();
  },

  scheduleManualContainerPersist: () => {
    if (containerPersistTimer) clearTimeout(containerPersistTimer);
    containerPersistTimer = setTimeout(async () => {
      await get().persistManualContainers();
    }, 700);
  },

  replaceManualContainers: (manualContainers) => {
    set({
      manualContainers,
      manualContainerDirty: true,
      selectedContainerId: withSelectedContainer(manualContainers, get().selectedContainerId),
    });
    get().scheduleManualContainerPersist();
  },

  addManualContainer: (type) => {
    const manualContainers = [...get().manualContainers, createManualContainerDraft(type)];
    get().replaceManualContainers(manualContainers);
  },

  removeManualContainer: (containerId) => {
    const manualContainers = get().manualContainers.filter((container) => container.id !== containerId);
    get().replaceManualContainers(manualContainers);
  },

  updateManualContainerType: (containerId, type) => {
    const manualContainers = get().manualContainers.map((container) =>
      container.id === containerId ? { ...container, type } : container
    );
    get().replaceManualContainers(manualContainers);
  },

  addCrateToManualContainer: (containerId, placement) => {
    const manualContainers = get().manualContainers.map((container) => {
      const nextPlacements = (container.placements || []).filter((item) => item.crate_id !== placement.crate_id);
      if (container.id !== containerId) return { ...container, placements: nextPlacements };
      return {
        ...container,
        placements: [
          ...nextPlacements,
          {
            ...placement,
            loading_order: Number(placement.loading_order || nextPlacements.length + 1),
            unload_order: Number(placement.unload_order || nextPlacements.length + 1),
          },
        ],
      };
    });
    get().replaceManualContainers(manualContainers);
  },

  updateManualPlacement: (containerId, crateId, patch) => {
    const manualContainers = get().manualContainers.map((container) =>
      container.id === containerId
        ? {
            ...container,
            placements: (container.placements || []).map((placement) =>
              placement.crate_id === crateId ? { ...placement, ...patch } : placement
            ),
          }
        : container
    );
    get().replaceManualContainers(manualContainers);
  },

  removeManualPlacement: (containerId, crateId) => {
    const manualContainers = get().manualContainers.map((container) =>
      container.id === containerId
        ? {
            ...container,
            placements: (container.placements || []).filter((placement) => placement.crate_id !== crateId),
          }
        : container
    );
    get().replaceManualContainers(manualContainers);
  },

  persistManualContainers: async () => {
    const projectId = get().projectId;
    const manualContainers = get().manualContainers
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

    if (manualContainers.length === 0) {
      await axios.delete(`${API_BASE}/projects/${projectId}/container-plan`);
    } else {
      await axios.put(`${API_BASE}/projects/${projectId}/container-plan`, { containers: manualContainers });
    }
    await get().refreshWorkspace();
  },

  resetManualContainerPlan: async () => {
    if (containerPersistTimer) clearTimeout(containerPersistTimer);
    await axios.delete(`${API_BASE}/projects/${get().projectId}/container-plan`);
    await get().refreshWorkspace();
  },

  exportWorkbook: async () => {
    const projectId = get().projectId;
    if (!projectId) return;
    try {
      const response = await fetch(`${API_BASE}/projects/${projectId}/export`);
      if (!response.ok) {
        let message = 'Export failed.';
        try {
          const errorData = await response.json();
          message = errorData.detail || message;
        } catch (_) { /* not json */ }
        alert(message);
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const disposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename=([^;]+)/);
      triggerBrowserDownload(url, filenameMatch ? filenameMatch[1] : `StoneDesk_export.xlsx`);
    } catch (err) {
      console.error('Export error:', err);
      alert('Export failed. Please regenerate plan or contact support.');
    }
  },

  exportSourceData: async () => {
    const projectId = get().projectId;
    if (!projectId) return;
    try {
      const response = await fetch(`${API_BASE}/projects/${projectId}/export-source-data`);
      if (!response.ok) {
        let message = 'Source data export failed.';
        try {
          const errorData = await response.json();
          message = errorData.detail || message;
        } catch (_) { /* not json */ }
        alert(message);
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const disposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename=([^;]+)/);
      triggerBrowserDownload(url, filenameMatch ? filenameMatch[1] : `SourceData_export.xlsx`);
    } catch (err) {
      console.error('Source data export error:', err);
      alert('Source data export failed.');
    }
  },

  clearAllProjectData: async () => {
    const projectId = get().projectId;
    await axios.delete(`${API_BASE}/projects/${projectId}/crates/`);
    await axios.delete(`${API_BASE}/projects/${projectId}/pieces/`);
    await get().refreshWorkspace();
  },
}));
