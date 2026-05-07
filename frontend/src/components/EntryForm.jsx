import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import PiecesGrid, { newRow, calcEdge } from './PiecesGrid';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const parseCommaList = (str) => {
  const parts = (str || '').toString().split(',').map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [''];
};

const normalizeCellKey = (building, floor) => `${String(building).trim()}__${String(floor).trim()}`;

const EntryForm = ({ project, setProject, onDataChange }) => {
  // ── Drawing Context (shared metadata) ──
  const [drawingCtx, setDrawingCtx] = useState({
    drawing: '', unit: '', category: 'Vanity', building: '', floor: '', flat: '', notes: '',
    fragility: 'Standard', orientation: 'Auto', delivery_priority: 'Standard',
    stack_preference: 'Auto', weight_override: '',
  });

  // ── Pieces Grid rows ──
  const [pieceRows, setPieceRows] = useState([newRow()]);

  // ── Destination Mode ──
  const [destMode, setDestMode] = useState('single'); // 'single' | 'matrix'
  const [matrixData, setMatrixData] = useState({ buildings: '', floors: '', cells: {} });

  // ── UI state ──
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);
  const spinnerTimerRef = useRef(null);

  useEffect(() => () => { if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current); }, []);

  // ── Handlers ──
  const handleCtx = (e) => {
    setDrawingCtx(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleProjectChange = (e) => setProject({ ...project, [e.target.name]: e.target.value });

  const handleProjectBlur = async (e) => {
    if (!project.id) return;
    try {
      await axios.put(`${API_BASE}/projects/${project.id}`, { ...project, [e.target.name]: e.target.value });
      onDataChange?.();
    } catch (err) { console.error('Failed to save project details', err); }
  };

  // ── Matrix helpers ──
  const matrixConfig = useMemo(() => ({
    buildings: parseCommaList(matrixData.buildings).filter(Boolean),
    floors: parseCommaList(matrixData.floors).filter(Boolean),
  }), [matrixData.buildings, matrixData.floors]);

  const handleMatrixCellChange = (building, floor, value) => {
    const key = normalizeCellKey(building, floor);
    setMatrixData(prev => ({ ...prev, cells: { ...prev.cells, [key]: value } }));
  };

  const handleMatrixPaste = (startBldgIdx, startFloorIdx, text) => {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map(r => r.split('\t'));
    if (!lines.length) return;
    setMatrixData(prev => {
      const nextCells = { ...prev.cells };
      lines.forEach((row, ri) => {
        const floor = matrixConfig.floors[startFloorIdx + ri];
        if (!floor) return;
        row.forEach((val, ci) => {
          const building = matrixConfig.buildings[startBldgIdx + ci];
          if (!building) return;
          nextCells[normalizeCellKey(building, floor)] = val.trim();
        });
      });
      return { ...prev, cells: nextCells };
    });
  };

  // ── Build destinations ──
  const buildDestinations = () => {
    if (destMode === 'single') {
      const buildings = parseCommaList(drawingCtx.building).filter(Boolean);
      const floors = parseCommaList(drawingCtx.floor).filter(Boolean);
      const flats = parseCommaList(drawingCtx.flat).filter(Boolean);
      if (!buildings.length && !floors.length && !flats.length) return [{ building: '', floor: '', flat: '' }];
      const dests = [];
      for (const b of (buildings.length ? buildings : [''])) {
        for (const fl of (floors.length ? floors : [''])) {
          for (const ft of (flats.length ? flats : [''])) {
            dests.push({ building: b, floor: fl, flat: ft });
          }
        }
      }
      return dests;
    }
    // Matrix mode
    const dests = [];
    matrixConfig.buildings.forEach(building => {
      matrixConfig.floors.forEach(floor => {
        const key = normalizeCellKey(building, floor);
        const flats = parseCommaList(matrixData.cells[key] || '').filter(Boolean);
        flats.forEach(flat => dests.push({ building, floor, flat }));
      });
    });
    return dests.length ? dests : [{ building: '', floor: '', flat: '' }];
  };

  // ── Destination count for preview ──
  const destCount = useMemo(() => {
    const d = buildDestinations();
    return d.filter(dd => dd.building || dd.floor || dd.flat).length || 1;
  }, [destMode, drawingCtx.building, drawingCtx.floor, drawingCtx.flat, matrixData, matrixConfig]);

  const validRows = pieceRows.filter(r => r.part && r.length && r.width);
  const totalPieces = validRows.reduce((s, r) => s + (Number(r.qty) || 1), 0) * destCount;

  // ── Submit ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!validRows.length) { alert('Add at least one piece with Part, Length, and Depth filled.'); return; }

    const destinations = buildDestinations();
    const piecesToCreate = [];

    for (const dest of destinations) {
      for (const row of validRows) {
        for (let i = 0; i < (Number(row.qty) || 1); i++) {
          piecesToCreate.push({
            part: row.part,
            category: drawingCtx.category,
            drawing: drawingCtx.drawing || '',
            length: row.length,
            width: row.width,
            unit: drawingCtx.unit || '',
            sink_type: row.sink_type || 'No Sink',
            sink_cut: row.sink_cut || '-',
            tap_holes: row.tap_holes || '-',
            grooves: row.grooves || '-',
            fragility: drawingCtx.fragility || 'Standard',
            orientation: drawingCtx.orientation || 'Auto',
            delivery_priority: drawingCtx.delivery_priority || 'Standard',
            stack_preference: drawingCtx.stack_preference || 'Auto',
            weight_override: Number(drawingCtx.weight_override) || 0,
            edge: row.edge || 'None',
            edge_area: row.edge_area || '',
            edge_polish_machine: calcEdge(row.length, row.width, row.edge_area),
            radius: row.radius || '-',
            notes: row.notes || '',
            qty: 1,
            building: dest.building,
            floor: dest.floor,
            flat: dest.flat,
          });
        }
      }
    }

    try {
      setIsSubmitting(true);
      setShowSpinner(false);
      spinnerTimerRef.current = setTimeout(() => setShowSpinner(true), 2000);
      await axios.post(`${API_BASE}/projects/${project.id}/pieces/batch`, piecesToCreate);
      // Clear pieces, keep drawing context for next drawing
      setPieceRows([newRow()]);
      alert(`${piecesToCreate.length} pieces saved successfully!`);
      onDataChange();
    } catch (error) {
      console.error(error);
      alert('Error adding pieces');
    } finally {
      if (spinnerTimerRef.current) { clearTimeout(spinnerTimerRef.current); spinnerTimerRef.current = null; }
      setShowSpinner(false);
      setIsSubmitting(false);
    }
  };

  const clearDrawing = () => {
    setDrawingCtx({ drawing: '', unit: '', category: 'Vanity', building: '', floor: '', flat: '', notes: '',
      fragility: 'Standard', orientation: 'Auto', delivery_priority: 'Standard', stack_preference: 'Auto', weight_override: '' });
    setPieceRows([newRow()]);
    setMatrixData({ buildings: '', floors: '', cells: {} });
  };

  // ── Render ──
  return (
    <div className="mb-6">
      {/* ── Project Details ── */}
      <div className="bg-white shadow-sm rounded-lg border border-[#e2e8f0] p-5 mb-6">
        <h2 className="text-lg font-bold text-[#1e293b] mb-4">Project Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-8 gap-4">
          <div><label className="label-text">Project Name</label><input name="name" value={project.name || ''} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field" /></div>
          <div><label className="label-text">Material</label><select name="material" value={project.material} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field"><option>Granite</option><option>Quartz</option><option>Marble</option></select></div>
          <div><label className="label-text">Thickness</label><select name="thickness" value={project.thickness} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field"><option>2CM</option><option>3CM</option><option>Mixed</option></select></div>
          <div><label className="label-text">Crate Wood</label><select name="crate_wood_type" value={project.crate_wood_type || 'Pine'} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field"><option>Pine</option><option>Rubberwood</option><option>Plywood</option><option>Hardwood</option></select></div>
          <div><label className="label-text">Wood Thick. (in)</label><input type="number" step="0.125" min="0.5" name="crate_wood_thickness" value={project.crate_wood_thickness ?? 1.25} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field" /></div>
          <div><label className="label-text">Customer</label><input name="customer" value={project.customer || ''} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field" /></div>
          <div><label className="label-text">Job #</label><input name="job_number" value={project.job_number || ''} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field" /></div>
          <div><label className="label-text">Date</label><input type="date" name="date" value={project.date || ''} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field" /></div>
        </div>
      </div>

      {/* ── Drawing Workspace ── */}
      <div className="bg-white shadow-sm rounded-lg border border-[#e2e8f0]">
        <form onSubmit={handleSubmit}>

          {/* Drawing Header */}
          <div className="px-5 pt-5 pb-3 border-b border-[#edf2f7]">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-base font-bold text-[#0f172a]">Drawing Workspace</h3>
                <p className="text-xs text-[#64748b]">Enter drawing-level info once, then add all pieces below. All pieces inherit these shared fields.</p>
              </div>
              <button type="button" onClick={clearDrawing} className="text-xs text-[#64748b] hover:text-[#1e293b] underline">Clear Drawing</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 lg:grid-cols-8 gap-3">
              <div><label className="label-text">Drawing #</label><input name="drawing" value={drawingCtx.drawing} onChange={handleCtx} className="input-field" placeholder="1041-01" /></div>
              <div><label className="label-text">Unit Name</label><input name="unit" value={drawingCtx.unit} onChange={handleCtx} className="input-field" placeholder="1A Unit" /></div>
              <div><label className="label-text">Category</label>
                <select name="category" value={drawingCtx.category} onChange={handleCtx} className="input-field">
                  <option>Vanity</option><option>Kitchen</option><option>Laundry</option><option>Island</option><option>Splashes</option><option>Utility</option><option>Other</option>
                </select>
              </div>
              <div><label className="label-text">Fragility</label><select name="fragility" value={drawingCtx.fragility} onChange={handleCtx} className="input-field"><option>Standard</option><option>Fragile</option><option>High</option></select></div>
              <div><label className="label-text">Orientation</label><select name="orientation" value={drawingCtx.orientation} onChange={handleCtx} className="input-field"><option>Auto</option><option>No Rotate</option><option>Long Edge Vertical</option><option>Finished Face Protected</option></select></div>
              <div><label className="label-text">Priority</label><select name="delivery_priority" value={drawingCtx.delivery_priority} onChange={handleCtx} className="input-field"><option>Standard</option><option>First Off</option><option>Last Off</option><option>Rush</option></select></div>
              <div><label className="label-text">Stacking</label><select name="stack_preference" value={drawingCtx.stack_preference} onChange={handleCtx} className="input-field"><option>Auto</option><option>No Stack</option><option>Stack Allowed</option></select></div>
              <div><label className="label-text">Wt Override (kg)</label><input name="weight_override" type="number" step="0.1" value={drawingCtx.weight_override} onChange={handleCtx} className="input-field" placeholder="Optional" /></div>
            </div>
          </div>

          {/* Destination Section */}
          <div className="px-5 py-3 border-b border-[#edf2f7] bg-[#f8fafc]">
            <div className="flex items-center gap-4 mb-3">
              <span className="text-sm font-semibold text-[#334155]">Destination</span>
              <div className="flex gap-1">
                <button type="button" onClick={() => setDestMode('single')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${destMode === 'single' ? 'bg-[#1e293b] text-white' : 'bg-white border border-[#cbd5e1] text-[#475569]'}`}>
                  Single / Comma-List
                </button>
                <button type="button" onClick={() => setDestMode('matrix')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${destMode === 'matrix' ? 'bg-[#1e293b] text-white' : 'bg-white border border-[#cbd5e1] text-[#475569]'}`}>
                  Matrix Grid
                </button>
              </div>
            </div>

            {destMode === 'single' && (
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label-text">Building</label><input name="building" value={drawingCtx.building} onChange={handleCtx} className="input-field" placeholder="e.g., 13 or A,B" /></div>
                <div><label className="label-text">Floor</label><input name="floor" value={drawingCtx.floor} onChange={handleCtx} className="input-field" placeholder="e.g., 1,2,3" /></div>
                <div><label className="label-text">Flat</label><input name="flat" value={drawingCtx.flat} onChange={handleCtx} className="input-field" placeholder="e.g., 101,102,201" /></div>
              </div>
            )}

            {destMode === 'matrix' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label-text">Buildings (comma-separated)</label><input value={matrixData.buildings} onChange={e => setMatrixData(p => ({ ...p, buildings: e.target.value }))} className="input-field" placeholder="1,2,3,4" /></div>
                  <div><label className="label-text">Floors (comma-separated)</label><input value={matrixData.floors} onChange={e => setMatrixData(p => ({ ...p, floors: e.target.value }))} className="input-field" placeholder="1,2,3" /></div>
                </div>
                {matrixConfig.buildings.length > 0 && matrixConfig.floors.length > 0 && (
                  <div className="overflow-x-auto rounded-md border border-[#cbd5e1] bg-white">
                    <table className="w-full text-xs">
                      <thead className="bg-[#f1f5f9]">
                        <tr>
                          <th className="p-2 text-left sticky left-0 bg-[#f1f5f9] z-10">Floor / Bldg</th>
                          {matrixConfig.buildings.map(b => <th key={b} className="p-2 text-left min-w-[120px]">Bldg {b}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {matrixConfig.floors.map(floor => (
                          <tr key={floor} className="border-t border-[#e2e8f0]">
                            <td className="p-2 font-semibold text-[#1e293b] sticky left-0 bg-white">Floor {floor}</td>
                            {matrixConfig.buildings.map(building => {
                              const key = normalizeCellKey(building, floor);
                              return (
                                <td key={key} className="p-1 align-top">
                                  <textarea rows={2} value={matrixData.cells[key] || ''}
                                    onChange={e => handleMatrixCellChange(building, floor, e.target.value)}
                                    onPaste={e => {
                                      const t = e.clipboardData.getData('text');
                                      if (!t.includes('\n') && !t.includes('\t')) return;
                                      e.preventDefault();
                                      handleMatrixPaste(matrixConfig.buildings.indexOf(building), matrixConfig.floors.indexOf(floor), t);
                                    }}
                                    className="input-field min-h-[48px] resize-y text-xs" placeholder="101, 102" />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="text-[10px] text-[#94a3b8]">Paste flat numbers from Excel — rows map to floors, columns to buildings.</div>
              </div>
            )}
          </div>

          {/* Pieces Grid */}
          <div className="px-5 py-4">
            <PiecesGrid
              rows={pieceRows}
              setRows={setPieceRows}
              material={project.material}
              thickness={project.thickness}
              onCategoryDetected={(cat) => setDrawingCtx(prev => ({ ...prev, category: cat }))}
            />
          </div>

          {/* Footer */}
          <div className="border-t border-[#edf2f7] px-5 py-4 bg-[#f8fafc] rounded-b-lg flex justify-between items-center flex-wrap gap-3">
            <div className="text-sm text-[#475569] font-medium">
              {validRows.length > 0 ? (
                <>
                  <span className="text-[#2563eb] font-bold">{validRows.length}</span> piece type{validRows.length !== 1 ? 's' : ''}
                  {destCount > 1 && <> × <span className="text-[#2563eb] font-bold">{destCount}</span> flat{destCount !== 1 ? 's' : ''}</>}
                  {' = '}
                  <span className="text-[#059669] font-bold">{totalPieces}</span> total records
                </>
              ) : (
                <span className="text-[#94a3b8]">Add pieces above to save</span>
              )}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={clearDrawing} className="rounded-full border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-medium text-[#334155] hover:bg-[#f1f5f9]">
                Clear All
              </button>
              <button type="submit" disabled={isSubmitting || !validRows.length}
                className={`btn-primary inline-flex items-center gap-2 ${isSubmitting || !validRows.length ? 'opacity-60 cursor-not-allowed' : ''}`}>
                {showSpinner && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                {showSpinner ? 'Saving...' : `Save Drawing (${totalPieces} pcs)`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EntryForm;
