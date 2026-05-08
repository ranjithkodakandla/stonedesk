import React, { useMemo, useState } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const PiecesTable = ({ pieces, project, onDelete, onDataChange, onLoadDrawing }) => {
  const [selectedIds, setSelectedIds] = useState([]);
  const [editMode, setEditMode] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingPartNo, setEditingPartNo] = useState(null); // { id, value }

  const COLOR_DENSITIES = {
    Granite: {
      'Kashmir White': 2600, 'Moon White': 2580, 'River White': 2600, 'Colonial White': 2590,
      'Bianco Romano': 2610, 'White Galaxy': 2590, 'Crystal White': 2600,
      'Giallo Ornamental': 2660, 'Venetian Gold': 2660, 'Santa Cecilia': 2650,
      'Caledonia': 2660, 'Crema Pearl': 2650, 'Tiger Skin': 2660,
      'Tan Brown': 2680, 'Silver Pearl': 2680, 'Verde Butterfly': 2690,
      'Uba Tuba': 2700, 'Steel Grey': 2700, 'Sapphire Blue': 2700,
      'Vizag Blue': 2700, 'New Kashmir White': 2680,
      'Baltic Brown': 2750, 'Imperial Red': 2750, 'Labrador Antique': 2760,
      'Volga Blue': 2760, 'Impala': 2750, 'Dakota Mahogany': 2750, 'Black Pearl': 2780,
      'Absolute Black': 2900, 'Black Galaxy': 2950, 'Angola Black': 2900,
      'Zimbabwe Black': 2880, 'Star Galaxy': 2930,
    },
    Marble: {
      'Carrara White': 2720, 'Calacatta Gold': 2710, 'Statuario': 2720,
      'Bianco Venatino': 2700, 'Volakas': 2690, 'White Onyx': 2680,
      'Crema Marfil': 2720, 'Botticino': 2740, 'Emperador Light': 2740,
      'Ottoman Grey': 2720, 'Grey Armani': 2740, 'Panda White': 2730,
      'Nero Marquina': 2800, 'Emperador Dark': 2780, 'Forest Green': 2790,
      'Bardiglio': 2760, 'Black & Gold': 2820, 'Portoro': 2830,
    },
  };
  const THICKNESS_M = { '2CM': 0.02, '3CM': 0.03, 'Mixed': 0.025 };
  const FALLBACK_FACTORS = {
    Granite: { '2CM': 5.5, '3CM': 7.5, 'Mixed': 6.5 },
    Quartz: { '2CM': 4.75, '3CM': 6.75, 'Mixed': 5.75 },
    Marble: { '2CM': 6.0, '3CM': 8.0, 'Mixed': 7.0 },
  };

  const getWeightFactor = () => {
    const color = project.stone_color || '';
    const mat = project.material || 'Granite';
    const thick = project.thickness || '3CM';
    if (color && COLOR_DENSITIES[mat]?.[color]) {
      const density = COLOR_DENSITIES[mat][color];
      const tM = THICKNESS_M[thick] || 0.025;
      return density * tM * 0.0929;
    }
    return (FALLBACK_FACTORS[mat] || FALLBACK_FACTORS.Granite)[thick] || 7.5;
  };

  const getWeight = (p) => {
    const override = Number(p.weight_override || 0);
    if (override > 0) return override;
    return ((p.length * p.width) / 144) * getWeightFactor();
  };

  const calculateEdgePolishMachine = (length, width, edgeArea) => {
    const l = Number(length);
    const w = Number(width);
    if (!l || !w || !edgeArea) return 0;

    const perimeter = 2 * (l + w);
    const longerSide = 2 * Math.max(l, w) + Math.min(l, w);

    switch (edgeArea) {
      case '4 Sides':
      case 'Perimeter':
        return perimeter;
      case '3 Sides':
        return longerSide;
      case '2 Sides':
        return 2 * Math.max(l, w);
      case '1 Side':
        return Math.max(l, w);
      default:
        return 0;
    }
  };

  const openEdit = (piece) => {
    setEditMode('single');
    setEditDraft({
      id: piece.id,
      part: piece.part || '',
      category: piece.category || '',
      drawing: piece.drawing || '',
      length: piece.length ?? '',
      width: piece.width ?? '',
      qty: piece.qty ?? 1,
      unit: piece.unit || '',
      building: piece.building || '',
      floor: piece.floor || '',
      flat: piece.flat || '',
      sink_type: piece.sink_type || 'No Sink',
      sink_cut: piece.sink_cut || '-',
      tap_holes: piece.tap_holes || '-',
      grooves: piece.grooves || '-',
      fragility: piece.fragility || 'Standard',
      orientation: piece.orientation || 'Auto',
      delivery_priority: piece.delivery_priority || 'Standard',
      stack_preference: piece.stack_preference || 'Auto',
      weight_override: piece.weight_override ?? '',
      edge: piece.edge || 'None',
      edge_area: piece.edge_area || '',
      edge_polish_machine: piece.edge_polish_machine || 0,
      radius: piece.radius || '-',
      notes: piece.notes || '',
    });
  };

  const openSelectedEdit = () => {
    const selectedPieces = pieces.filter((piece) => selectedIds.includes(piece.id));
    if (selectedPieces.length === 0) return;
    if (onLoadDrawing) {
      onLoadDrawing(selectedPieces);
      return;
    }
    if (selectedPieces.length === 1) {
      openEdit(selectedPieces[0]);
      return;
    }
    setEditMode('bulk');
    setEditDraft({
      part: { enabled: false, value: '' },
      category: { enabled: false, value: '' },
      drawing: { enabled: false, value: '' },
      length: { enabled: false, value: '' },
      width: { enabled: false, value: '' },
      qty: { enabled: false, value: '' },
      unit: { enabled: false, value: '' },
      building: { enabled: false, value: '' },
      floor: { enabled: false, value: '' },
      flat: { enabled: false, value: '' },
      sink_type: { enabled: false, value: 'No Sink' },
      sink_cut: { enabled: false, value: '-' },
      tap_holes: { enabled: false, value: '-' },
      grooves: { enabled: false, value: '-' },
      fragility: { enabled: false, value: 'Standard' },
      orientation: { enabled: false, value: 'Auto' },
      delivery_priority: { enabled: false, value: 'Standard' },
      stack_preference: { enabled: false, value: 'Auto' },
      weight_override: { enabled: false, value: '' },
      edge: { enabled: false, value: 'None' },
      edge_area: { enabled: false, value: '' },
      radius: { enabled: false, value: '-' },
      notes: { enabled: false, value: '' },
    });
  };

  const closeEdit = () => {
    if (isSaving) return;
    setEditMode(null);
    setEditDraft(null);
  };

  const handleEditChange = (field, value, mode = editMode) => {
    if (mode === 'bulk') {
      setEditDraft((prev) => (prev ? { ...prev, [field]: { ...(prev[field] || {}), value } } : prev));
      return;
    }
    setEditDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const saveEdit = async () => {
    if (!editDraft) return;
    setIsSaving(true);
    try {
      const numericFields = new Set(['length', 'width', 'qty', 'weight_override']);
      const targetPieces = editMode === 'bulk'
        ? pieces.filter((piece) => selectedIds.includes(piece.id))
        : pieces.filter((piece) => piece.id === editDraft.id);

      await Promise.all(targetPieces.map((piece) => {
        const payload = {
          part: editMode === 'bulk' ? piece.part : (editDraft.part || ''),
          category: editMode === 'bulk' ? piece.category : (editDraft.category || ''),
          drawing: editMode === 'bulk' ? piece.drawing : (editDraft.drawing || ''),
          length: editMode === 'bulk' ? piece.length : (Number(editDraft.length) || 0),
          width: editMode === 'bulk' ? piece.width : (Number(editDraft.width) || 0),
          qty: editMode === 'bulk' ? piece.qty : (Number(editDraft.qty) || 1),
          unit: editMode === 'bulk' ? piece.unit : (editDraft.unit || ''),
          building: editMode === 'bulk' ? piece.building : (editDraft.building || ''),
          floor: editMode === 'bulk' ? piece.floor : (editDraft.floor || ''),
          flat: editMode === 'bulk' ? piece.flat : (editDraft.flat || ''),
          sink_type: editMode === 'bulk' ? piece.sink_type : (editDraft.sink_type || 'No Sink'),
          sink_cut: editMode === 'bulk' ? piece.sink_cut : (editDraft.sink_cut || '-'),
          tap_holes: editMode === 'bulk' ? piece.tap_holes : (editDraft.tap_holes || '-'),
          grooves: editMode === 'bulk' ? piece.grooves : (editDraft.grooves || '-'),
          fragility: editMode === 'bulk' ? piece.fragility : (editDraft.fragility || 'Standard'),
          orientation: editMode === 'bulk' ? piece.orientation : (editDraft.orientation || 'Auto'),
          delivery_priority: editMode === 'bulk' ? piece.delivery_priority : (editDraft.delivery_priority || 'Standard'),
          stack_preference: editMode === 'bulk' ? piece.stack_preference : (editDraft.stack_preference || 'Auto'),
          weight_override: editMode === 'bulk' ? (Number(piece.weight_override) || 0) : (Number(editDraft.weight_override) || 0),
          edge: editMode === 'bulk' ? piece.edge : (editDraft.edge || 'None'),
          edge_area: editMode === 'bulk' ? piece.edge_area : (editDraft.edge_area || ''),
          edge_polish_machine: editMode === 'bulk'
            ? (piece.edge_polish_machine || 0)
            : calculateEdgePolishMachine(editDraft.length, editDraft.width, editDraft.edge_area),
          radius: editMode === 'bulk' ? piece.radius : (editDraft.radius || '-'),
          notes: editMode === 'bulk' ? piece.notes : (editDraft.notes || ''),
          // Preserve fields managed by the entry-form drawer — never wiped by this editor
          part_no: piece.part_no || '',
          edge_map: piece.edge_map || {},
          edge_polish_manual: piece.edge_polish_manual || '',
          radius_value: piece.radius_value || '',
          radius_corners: piece.radius_corners || {},
          shape_type: piece.shape_type || '',
        };

        if (editMode === 'bulk') {
          Object.entries(editDraft).forEach(([field, config]) => {
            if (!config?.enabled) return;
            if (config.value === '' && config.value !== 0) return;
            payload[field] = numericFields.has(field)
              ? Number(config.value)
              : config.value;
          });
          payload.edge_polish_machine = calculateEdgePolishMachine(payload.length, payload.width, payload.edge_area);
        }

        return axios.put(`${API_BASE}/pieces/${piece.id}`, payload);
      }));

      setEditMode(null);
      setEditDraft(null);
      setSelectedIds([]);
      onDataChange?.();
    } finally {
      setIsSaving(false);
    }
  };

  const pieceFormOptions = useMemo(() => ({
    sinkTypes: ['No Sink', 'Single Bowl', 'Double Bowl', 'ADA', 'PL-VS3018', 'PL-3639'],
    edgeTypes: ['None', 'Machine', 'Manual', 'Both'],
    edgeAreas: ['', '4 Sides', '3 Sides', '2 Sides', '1 Side'],
    cutouts: ['-', '0', '1', '2', '3'],
    tapHoles: ['-', '0', '1', '2', '3', '4', '5', '6'],
    grooves: ['-', '0', '1', '2', '3', '4'],
    radius: ['-', '1', '2', '3', '4'],
    fragility: ['Standard', 'Fragile', 'High'],
    orientation: ['Auto', 'No Rotate', 'Long Edge Vertical', 'Finished Face Protected'],
    deliveryPriority: ['Standard', 'First Off', 'Last Off', 'Rush'],
    stacking: ['Auto', 'No Stack', 'Stack Allowed'],
  }), []);

  const toggleSelection = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleAllSelection = () => {
    if (selectedIds.length === pieces.length) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(pieces.map((piece) => piece.id));
  };

  const selectedPieces = pieces.filter((piece) => selectedIds.includes(piece.id));
  const setBulkEnabled = (field, enabled) => {
    setEditDraft((prev) => (prev ? { ...prev, [field]: { ...(prev[field] || {}), enabled } } : prev));
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedIds.length} selected piece(s)? This cannot be undone.`)) return;
    try {
      await Promise.all(selectedIds.map(id => axios.delete(`${API_BASE}/pieces/${id}`)));
      setSelectedIds([]);
      onDataChange?.();
    } catch (err) {
      console.error('Bulk delete failed', err);
      alert('Some pieces could not be deleted. Please try again.');
    }
  };

  const setBulkValue = (field, value) => {
    setEditDraft((prev) => (prev ? { ...prev, [field]: { ...(prev[field] || {}), value, enabled: true } } : prev));
  };

  const renderBulkField = (field, label, control) => (
    <div className="rounded-lg border border-[#e2e8f0] bg-white p-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-2 h-4 w-4"
          checked={Boolean(editDraft?.[field]?.enabled)}
          onChange={(e) => setBulkEnabled(field, e.target.checked)}
        />
        <div className="flex-1">
          <label className="label-text">{label}</label>
          {control}
        </div>
      </div>
    </div>
  );

  const savePartNo = async (pieceId, value) => {
    setEditingPartNo(null);
    const piece = pieces.find(p => p.id === pieceId);
    if (!piece || piece.part_no === value) return;
    try {
      await axios.put(`${API_BASE}/pieces/${pieceId}`, {
        part: piece.part || '',
        part_no: value,
        category: piece.category || '',
        drawing: piece.drawing || '',
        length: piece.length || 0,
        width: piece.width || 0,
        qty: piece.qty || 1,
        unit: piece.unit || '',
        building: piece.building || '',
        floor: piece.floor || '',
        flat: piece.flat || '',
        sink_type: piece.sink_type || 'No Sink',
        sink_cut: piece.sink_cut || '-',
        tap_holes: piece.tap_holes || '-',
        grooves: piece.grooves || '-',
        fragility: piece.fragility || 'Standard',
        orientation: piece.orientation || 'Auto',
        delivery_priority: piece.delivery_priority || 'Standard',
        stack_preference: piece.stack_preference || 'Auto',
        weight_override: Number(piece.weight_override) || 0,
        edge: piece.edge || 'None',
        edge_area: piece.edge_area || '',
        edge_polish_machine: piece.edge_polish_machine || 0,
        edge_map: piece.edge_map || {},
        edge_polish_manual: piece.edge_polish_manual || '',
        radius: piece.radius || '-',
        radius_value: piece.radius_value || '',
        radius_corners: piece.radius_corners || {},
        shape_type: piece.shape_type || '',
        notes: piece.notes || '',
      });
      onDataChange?.();
    } catch (err) {
      console.error('Failed to save Part #', err);
    }
  };

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-[#64748b]">
          {selectedIds.length > 0 ? `${selectedIds.length} selected` : 'Select rows to edit them together'}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openSelectedEdit}
            disabled={selectedIds.length === 0}
            className={`btn-primary ${selectedIds.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Edit
          </button>
          {selectedIds.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleBulkDelete}
                className="btn-danger"
              >
                Delete Selected ({selectedIds.length})
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="btn-primary bg-white text-[#334155] border border-[#cbd5e1] hover:bg-[#f8fafc]"
              >
                Clear Selection
              </button>
            </>
          )}
        </div>
      </div>

      <div className="overflow-auto max-h-[500px] bg-white border border-[#e2e8f0] shadow-sm rounded-lg relative">
        <table className="w-full text-left text-sm text-[#475569]">
          <thead className="bg-[#f1f5f9] text-[#334155] text-xs font-semibold sticky top-0 z-10 shadow-sm border-b border-[#e2e8f0]">
            <tr>
              <th className="p-3 w-10 sticky left-0 z-20 bg-[#f1f5f9]">
                <input
                  type="checkbox"
                  checked={pieces.length > 0 && selectedIds.length === pieces.length}
                  onChange={toggleAllSelection}
                  className="h-4 w-4"
                />
              </th>
              <th className="p-3 sticky left-10 z-20 bg-[#f1f5f9] min-w-[120px] whitespace-nowrap border-r border-[#e2e8f0]">Part #</th>
              <th className="p-3">Part</th>
              <th className="p-3">Category</th>
              <th className="p-3">Drawing</th>
              <th className="p-3">Unit</th>
              <th className="p-3 text-right">Length"</th>
              <th className="p-3 text-right">Depth"</th>
              <th className="p-3 text-center">Qty</th>
              <th className="p-3">Sink</th>
              <th className="p-3 text-center">Cuts</th>
              <th className="p-3 text-center">Tap</th>
              <th className="p-3">Edge Finish</th>
              <th className="p-3">Edge Polish area</th>
              <th className="p-3 text-right">SqFt ea</th>
              <th className="p-3 text-right">kg ea</th>
              <th className="p-3">Building</th>
              <th className="p-3">Floor</th>
              <th className="p-3">Flat</th>
              <th className="p-3">Planner</th>
              <th className="p-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pieces.map((p) => {
              const sqft = (p.length * p.width) / 144;
              const wt = getWeight(p);
              return (
                <tr key={p.id} className={`border-b border-[#f1f5f9] transition-colors ${selectedIds.includes(p.id) ? 'bg-[#eff6ff]' : 'hover:bg-[#f8fafc]'}`}>
                  <td className={`p-3 sticky left-0 z-[2] border-r border-[#f1f5f9] ${selectedIds.includes(p.id) ? 'bg-[#eff6ff]' : 'bg-white'}`}>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selectedIds.includes(p.id)}
                      onChange={() => toggleSelection(p.id)}
                    />
                  </td>
                  <td className={`p-2 sticky left-10 z-[2] min-w-[120px] border-r border-[#e2e8f0] ${selectedIds.includes(p.id) ? 'bg-[#eff6ff]' : 'bg-white'}`}>
                    {editingPartNo?.id === p.id ? (
                      <input
                        autoFocus
                        value={editingPartNo.value}
                        onChange={e => setEditingPartNo({ id: p.id, value: e.target.value })}
                        onBlur={() => savePartNo(p.id, editingPartNo.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') savePartNo(p.id, editingPartNo.value);
                          if (e.key === 'Escape') setEditingPartNo(null);
                        }}
                        className="font-mono text-xs border border-[#2563eb] rounded px-1.5 py-0.5 w-full outline-none bg-white"
                      />
                    ) : (
                      <span
                        className="font-mono text-xs font-semibold text-[#1e293b] cursor-text hover:bg-[#f1f5f9] rounded px-1 py-0.5 block"
                        onClick={() => setEditingPartNo({ id: p.id, value: p.part_no || '' })}
                        title="Click to edit Part #"
                      >
                        {p.part_no || <span className="text-[#cbd5e1] font-normal not-italic">—</span>}
                      </span>
                    )}
                  </td>
                  <td className="p-3 font-semibold text-[#1e293b] text-left">{p.part}</td>
                  <td className="p-3 text-left">{p.category}</td>
                  <td className="p-3 text-left">{p.drawing}</td>
                  <td className="p-3 text-left">{p.unit}</td>
                  <td className="p-3 text-right">{Number(p.length || 0).toFixed(2)}</td>
                  <td className="p-3 text-right">{Number(p.width || 0).toFixed(2)}</td>
                  <td className="p-3 text-center text-[#2563eb] font-bold">{p.qty}</td>
                  <td className="p-3">{p.sink_type}</td>
                  <td className="p-3 text-center">{p.sink_cut}</td>
                  <td className="p-3 text-center">{p.tap_holes}</td>
                  <td className="p-3">{p.edge}</td>
                  <td className="p-3">{typeof p.edge_polish_machine === 'number' && p.edge_polish_machine > 0 ? p.edge_polish_machine.toFixed(2) : '-'}</td>
                  <td className="p-3 text-right text-[#64748b]">{sqft.toFixed(2)}</td>
                  <td className="p-3 text-right text-[#64748b]">{wt.toFixed(1)}</td>
                  <td className="p-3 text-left text-[#64748b]">{p.building}</td>
                  <td className="p-3 text-left text-[#64748b]">{p.floor}</td>
                  <td className="p-3 text-left text-[#64748b]">{p.flat}</td>
                  <td className="p-3 text-xs text-[#64748b]">
                    <div>{p.delivery_priority || 'Standard'} · {p.fragility || 'Standard'}</div>
                    <div>{p.stack_preference || 'Auto'}{p.weight_override ? ` · ${Number(p.weight_override).toFixed(1)}kg ea` : ''}</div>
                  </td>
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => (onLoadDrawing ? onLoadDrawing(p.drawing) : openEdit(p))}
                        className="text-[#2563eb] hover:text-[#1d4ed8] font-medium text-xs px-3 py-1 bg-[#eff6ff] hover:bg-[#dbeafe] rounded-md border border-[#bfdbfe] transition-colors"
                      >
                        Edit
                      </button>
                      <button onClick={() => onDelete(p.id)} className="text-[#dc2626] hover:text-[#991b1b] font-medium text-xs px-3 py-1 bg-[#fef2f2] hover:bg-[#fee2e2] rounded-md border border-[#fecaca] transition-colors">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {pieces.length === 0 && <tr><td colSpan="21" className="p-8 text-center text-[#64748b] italic">No pieces added to this project yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {editMode && editDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-5xl rounded-xl bg-white shadow-2xl border border-[#e2e8f0] max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e2e8f0] bg-white px-5 py-4">
              <div>
                <div className="text-sm text-[#64748b]">{editMode === 'bulk' ? 'Bulk Edit' : 'Edit Piece'}</div>
                <div className="text-lg font-bold text-[#1e293b]">
                  {editMode === 'bulk'
                    ? `${selectedPieces.length} pieces selected`
                    : editDraft.part || 'Piece'}
                </div>
              </div>
              <button type="button" onClick={closeEdit} className="text-sm text-[#475569] hover:text-[#0f172a]">Close</button>
            </div>

            <div className="p-5">
              {editMode === 'single' ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div><label className="label-text">Part Description</label><input value={editDraft.part || ''} onChange={(e) => handleEditChange('part', e.target.value)} className="input-field" /></div>
                  <div><label className="label-text">Category</label><input value={editDraft.category || ''} onChange={(e) => handleEditChange('category', e.target.value)} className="input-field" /></div>
                  <div><label className="label-text">Drawing #</label><input value={editDraft.drawing || ''} onChange={(e) => handleEditChange('drawing', e.target.value)} className="input-field" /></div>
                  <div><label className="label-text">Length (in)</label><input type="number" step="0.125" value={editDraft.length || ''} onChange={(e) => handleEditChange('length', e.target.value)} className="input-field" /></div>
                  <div><label className="label-text">Depth (in)</label><input type="number" step="0.125" value={editDraft.width || ''} onChange={(e) => handleEditChange('width', e.target.value)} className="input-field" /></div>
                  <div><label className="label-text">Qty</label><input type="number" min="1" value={editDraft.qty || 1} onChange={(e) => handleEditChange('qty', e.target.value)} className="input-field" /></div>
                  <div><label className="label-text">Unit</label><input value={editDraft.unit || ''} onChange={(e) => handleEditChange('unit', e.target.value)} className="input-field" /></div>
                  <div><label className="label-text">Sink Type</label><select value={editDraft.sink_type || 'No Sink'} onChange={(e) => handleEditChange('sink_type', e.target.value)} className="input-field">{pieceFormOptions.sinkTypes.map((item) => <option key={item}>{item}</option>)}</select></div>
                  <div><label className="label-text">Edge Finish</label><select value={editDraft.edge || 'None'} onChange={(e) => handleEditChange('edge', e.target.value)} className="input-field">{pieceFormOptions.edgeTypes.map((item) => <option key={item}>{item}</option>)}</select></div>
                  <div><label className="label-text">Edge Polish area</label><select value={editDraft.edge_area || ''} onChange={(e) => handleEditChange('edge_area', e.target.value)} className="input-field">{pieceFormOptions.edgeAreas.map((item) => <option key={item} value={item}>{item || 'None'}</option>)}</select></div>
                  <div><label className="label-text">Radius</label><select value={editDraft.radius || '-'} onChange={(e) => handleEditChange('radius', e.target.value)} className="input-field">{pieceFormOptions.radius.map((item) => <option key={item}>{item}</option>)}</select></div>
                  <div><label className="label-text">Cutouts</label><select value={editDraft.sink_cut || '-'} onChange={(e) => handleEditChange('sink_cut', e.target.value)} className="input-field">{pieceFormOptions.cutouts.map((item) => <option key={item}>{item}</option>)}</select></div>
                  <div><label className="label-text">Tap Holes</label><select value={editDraft.tap_holes || '-'} onChange={(e) => handleEditChange('tap_holes', e.target.value)} className="input-field">{pieceFormOptions.tapHoles.map((item) => <option key={item}>{item}</option>)}</select></div>
                  <div><label className="label-text">Grooves</label><select value={editDraft.grooves || '-'} onChange={(e) => handleEditChange('grooves', e.target.value)} className="input-field">{pieceFormOptions.grooves.map((item) => <option key={item}>{item}</option>)}</select></div>
                  <div><label className="label-text">Fragility</label><select value={editDraft.fragility || 'Standard'} onChange={(e) => handleEditChange('fragility', e.target.value)} className="input-field">{pieceFormOptions.fragility.map((item) => <option key={item}>{item}</option>)}</select></div>
                  <div><label className="label-text">Orientation</label><select value={editDraft.orientation || 'Auto'} onChange={(e) => handleEditChange('orientation', e.target.value)} className="input-field">{pieceFormOptions.orientation.map((item) => <option key={item}>{item}</option>)}</select></div>
                  <div><label className="label-text">Delivery Priority</label><select value={editDraft.delivery_priority || 'Standard'} onChange={(e) => handleEditChange('delivery_priority', e.target.value)} className="input-field">{pieceFormOptions.deliveryPriority.map((item) => <option key={item}>{item}</option>)}</select></div>
                  <div><label className="label-text">Stacking</label><select value={editDraft.stack_preference || 'Auto'} onChange={(e) => handleEditChange('stack_preference', e.target.value)} className="input-field">{pieceFormOptions.stacking.map((item) => <option key={item}>{item}</option>)}</select></div>
                  <div><label className="label-text">Weight Override (kg ea)</label><input type="number" step="0.1" value={editDraft.weight_override || ''} onChange={(e) => handleEditChange('weight_override', e.target.value)} className="input-field" /></div>
                  <div><label className="label-text">Building</label><input value={editDraft.building || ''} onChange={(e) => handleEditChange('building', e.target.value)} className="input-field" /></div>
                  <div><label className="label-text">Floor</label><input value={editDraft.floor || ''} onChange={(e) => handleEditChange('floor', e.target.value)} className="input-field" /></div>
                  <div><label className="label-text">Flat</label><input value={editDraft.flat || ''} onChange={(e) => handleEditChange('flat', e.target.value)} className="input-field" /></div>
                  <div className="md:col-span-3"><label className="label-text">Notes</label><input value={editDraft.notes || ''} onChange={(e) => handleEditChange('notes', e.target.value)} className="input-field" /></div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2 text-sm text-[#64748b] bg-[#f8fafc] border border-[#e2e8f0] rounded-lg p-3">
                    Only checked fields will be applied to all selected rows.
                  </div>
                  {renderBulkField('part', 'Part Description', <input value={editDraft.part.value} onChange={(e) => setBulkValue('part', e.target.value)} className="input-field" />)}
                  {renderBulkField('category', 'Category', <input value={editDraft.category.value} onChange={(e) => setBulkValue('category', e.target.value)} className="input-field" />)}
                  {renderBulkField('drawing', 'Drawing #', <input value={editDraft.drawing.value} onChange={(e) => setBulkValue('drawing', e.target.value)} className="input-field" />)}
                  {renderBulkField('length', 'Length (in)', <input type="number" step="0.125" value={editDraft.length.value} onChange={(e) => setBulkValue('length', e.target.value)} className="input-field" />)}
                  {renderBulkField('width', 'Depth (in)', <input type="number" step="0.125" value={editDraft.width.value} onChange={(e) => setBulkValue('width', e.target.value)} className="input-field" />)}
                  {renderBulkField('qty', 'Qty', <input type="number" min="1" value={editDraft.qty.value} onChange={(e) => setBulkValue('qty', e.target.value)} className="input-field" />)}
                  {renderBulkField('unit', 'Unit', <input value={editDraft.unit.value} onChange={(e) => setBulkValue('unit', e.target.value)} className="input-field" />)}
                  {renderBulkField('sink_type', 'Sink Type', <select value={editDraft.sink_type.value} onChange={(e) => setBulkValue('sink_type', e.target.value)} className="input-field">{pieceFormOptions.sinkTypes.map((item) => <option key={item}>{item}</option>)}</select>)}
                  {renderBulkField('edge', 'Edge Finish', <select value={editDraft.edge.value} onChange={(e) => setBulkValue('edge', e.target.value)} className="input-field">{pieceFormOptions.edgeTypes.map((item) => <option key={item}>{item}</option>)}</select>)}
                  {renderBulkField('edge_area', 'Edge Polish area', <select value={editDraft.edge_area.value} onChange={(e) => setBulkValue('edge_area', e.target.value)} className="input-field">{pieceFormOptions.edgeAreas.map((item) => <option key={item} value={item}>{item || 'None'}</option>)}</select>)}
                  {renderBulkField('radius', 'Radius', <select value={editDraft.radius.value} onChange={(e) => setBulkValue('radius', e.target.value)} className="input-field">{pieceFormOptions.radius.map((item) => <option key={item}>{item}</option>)}</select>)}
                  {renderBulkField('sink_cut', 'Cutouts', <select value={editDraft.sink_cut.value} onChange={(e) => setBulkValue('sink_cut', e.target.value)} className="input-field">{pieceFormOptions.cutouts.map((item) => <option key={item}>{item}</option>)}</select>)}
                  {renderBulkField('tap_holes', 'Tap Holes', <select value={editDraft.tap_holes.value} onChange={(e) => setBulkValue('tap_holes', e.target.value)} className="input-field">{pieceFormOptions.tapHoles.map((item) => <option key={item}>{item}</option>)}</select>)}
                  {renderBulkField('grooves', 'Grooves', <select value={editDraft.grooves.value} onChange={(e) => setBulkValue('grooves', e.target.value)} className="input-field">{pieceFormOptions.grooves.map((item) => <option key={item}>{item}</option>)}</select>)}
                  {renderBulkField('fragility', 'Fragility', <select value={editDraft.fragility.value} onChange={(e) => setBulkValue('fragility', e.target.value)} className="input-field">{pieceFormOptions.fragility.map((item) => <option key={item}>{item}</option>)}</select>)}
                  {renderBulkField('orientation', 'Orientation', <select value={editDraft.orientation.value} onChange={(e) => setBulkValue('orientation', e.target.value)} className="input-field">{pieceFormOptions.orientation.map((item) => <option key={item}>{item}</option>)}</select>)}
                  {renderBulkField('delivery_priority', 'Delivery Priority', <select value={editDraft.delivery_priority.value} onChange={(e) => setBulkValue('delivery_priority', e.target.value)} className="input-field">{pieceFormOptions.deliveryPriority.map((item) => <option key={item}>{item}</option>)}</select>)}
                  {renderBulkField('stack_preference', 'Stacking', <select value={editDraft.stack_preference.value} onChange={(e) => setBulkValue('stack_preference', e.target.value)} className="input-field">{pieceFormOptions.stacking.map((item) => <option key={item}>{item}</option>)}</select>)}
                  {renderBulkField('weight_override', 'Weight Override (kg ea)', <input type="number" step="0.1" value={editDraft.weight_override.value} onChange={(e) => setBulkValue('weight_override', e.target.value)} className="input-field" />)}
                  {renderBulkField('building', 'Building', <input value={editDraft.building.value} onChange={(e) => setBulkValue('building', e.target.value)} className="input-field" />)}
                  {renderBulkField('floor', 'Floor', <input value={editDraft.floor.value} onChange={(e) => setBulkValue('floor', e.target.value)} className="input-field" />)}
                  {renderBulkField('flat', 'Flat', <input value={editDraft.flat.value} onChange={(e) => setBulkValue('flat', e.target.value)} className="input-field" />)}
                  {renderBulkField('notes', 'Notes', <input value={editDraft.notes.value} onChange={(e) => setBulkValue('notes', e.target.value)} className="input-field" />)}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[#e2e8f0] px-5 py-4 bg-[#f8fafc]">
              <button type="button" onClick={closeEdit} className="btn-primary bg-white text-[#334155] border border-[#cbd5e1] hover:bg-[#f8fafc]">
                Cancel
              </button>
              <button type="button" onClick={saveEdit} disabled={isSaving} className="btn-primary">
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default PiecesTable;
