
import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const EntryForm = ({ project, setProject, onDataChange }) => {
  const [entryMode, setEntryMode] = useState('simple');
  const [formData, setFormData] = useState({
    part: '', category: 'Vanity', drawing: '', length: '', width: '', qty: 1,
    unit: '', building: '', floor: '', flat: '',
    sink_type: 'No Sink', sink_cut: '-', tap_holes: '-', grooves: '-',
    edge: 'None', edge_area: '', radius: '-', notes: ''
  });
  const [matrixData, setMatrixData] = useState({
    buildings: '',
    floors: '',
    cells: {},
  });
  const [liveCalc, setLiveCalc] = useState({ sqft: 0, kg: 0 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);
  const spinnerTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (spinnerTimerRef.current) {
        clearTimeout(spinnerTimerRef.current);
      }
    };
  }, []);

  const partOptions = { 
    Vanity: ['Vanity Top', 'Back Splash', 'Side Splash', 'Main Top'], 
    Kitchen: ['Kitchen Perimeter', 'Kitchen Others', 'Island', 'Range Tops', 'Window Sills'], 
    Other: ['Laundry Top', 'Bar Top', 'Other'] 
  };

  const partCategoryMap = Object.entries(partOptions).reduce((acc, [category, parts]) => {
    parts.forEach((part) => {
      acc[part] = category;
    });
    return acc;
  }, {});

  const handleChange = (e) => {
    let value = e.target.value;
    if (e.target.type === 'number') {
      value = value === '' ? '' : parseFloat(value);
    }

    if (e.target.name === 'part') {
      const derivedCategory = partCategoryMap[value] || formData.category;
      setFormData({ ...formData, part: value, category: derivedCategory });
      return;
    }

    setFormData({ ...formData, [e.target.name]: value });
    
    if (e.target.name === 'length' || e.target.name === 'width') {
      const length = e.target.name === 'length' ? value : formData.length;
      const width = e.target.name === 'width' ? value : formData.width;
      if (length !== '' && width !== '' && !isNaN(length) && !isNaN(width)) {
        const sqft = (length * width) / 144;
        const factors = { Granite: { '2CM': 5.5, '3CM': 7.5, 'Mixed': 6.5 }, Quartz: { '2CM': 4.75, '3CM': 6.75, 'Mixed': 5.75 }, Marble: { '2CM': 6.0, '3CM': 8.0, 'Mixed': 7.0 } };
        const factor = (factors[project.material] || factors['Granite'])[project.thickness] || 7.5;
        setLiveCalc({ sqft: sqft, kg: sqft * factor });
      } else {
        setLiveCalc({ sqft: 0, kg: 0 });
      }
    }
  };

  const handleProjectChange = (e) => {
    setProject({ ...project, [e.target.name]: e.target.value });
  };
  
  const handleProjectBlur = async (e) => {
    if (!project.id) return;
    try {
      await axios.put(`${API_BASE}/projects/${project.id}`, {
        ...project,
        [e.target.name]: e.target.value
      });
      console.log("Project details auto-saved.");
    } catch (err) {
      console.error("Failed to save project details", err);
    }
  };

  const parseCommaList = (str) => {
    const parts = (str || "").toString().split(',').map(s => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : [''];
  };

  const normalizeCellKey = (building, floor) => `${String(building).trim()}__${String(floor).trim()}`;

  const parseFlatFloor = (flat) => {
    const digits = String(flat || '').replace(/\D/g, '');
    if (digits.length < 3) return '';
    return digits.slice(0, -2).replace(/^0+/, '');
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

  const buildDestinationPairs = (floors, flats) => {
    if (!floors.length || !flats.length) {
      return floors.flatMap((floor) => flats.map((flat) => ({ floor, flat })));
    }

    const groupedFlats = new Map();
    flats.forEach((flat) => {
      const inferredFloor = parseFlatFloor(flat);
      if (!inferredFloor) return;
      if (!groupedFlats.has(inferredFloor)) {
        groupedFlats.set(inferredFloor, []);
      }
      groupedFlats.get(inferredFloor).push(flat);
    });

    const hasFloorMatches = floors.some((floor) => groupedFlats.has(String(floor).trim()));
    if (!hasFloorMatches) {
      return floors.flatMap((floor) => flats.map((flat) => ({ floor, flat })));
    }

    return floors.flatMap((floor) => {
      const floorKey = String(floor).trim();
      return (groupedFlats.get(floorKey) || []).map((flat) => ({ floor: floorKey, flat }));
    });
  };

  const destinationPreview = useMemo(() => {
    if (entryMode !== 'simple') return [];
    const floors = parseCommaList(formData.floor);
    const flats = parseCommaList(formData.flat);
    const pairs = buildDestinationPairs(floors, flats);
    if (!pairs.length || (pairs.length === 1 && !pairs[0].floor && !pairs[0].flat)) {
      return [];
    }

    const byFloor = new Map();
    pairs.forEach(({ floor, flat }) => {
      const floorKey = floor || 'Unassigned';
      if (!byFloor.has(floorKey)) {
        byFloor.set(floorKey, []);
      }
      if (flat && !byFloor.get(floorKey).includes(flat)) {
        byFloor.get(floorKey).push(flat);
      }
    });

    return Array.from(byFloor.entries()).map(([floor, flatList]) => ({ floor, flats: flatList }));
  }, [entryMode, formData.floor, formData.flat]);

  const edgePolishMachine = useMemo(() => {
    return calculateEdgePolishMachine(formData.length, formData.width, formData.edge_area);
  }, [formData.length, formData.width, formData.edge_area]);

  const matrixConfig = useMemo(() => {
    const buildings = parseCommaList(matrixData.buildings).filter(Boolean);
    const floors = parseCommaList(matrixData.floors).filter(Boolean);
    return { buildings, floors };
  }, [matrixData.buildings, matrixData.floors]);

  const matrixPreview = useMemo(() => {
    if (entryMode !== 'matrix') return [];
    const rows = [];
    matrixConfig.floors.forEach((floor) => {
      const cells = [];
      matrixConfig.buildings.forEach((building) => {
        const key = normalizeCellKey(building, floor);
        const flats = parseCommaList(matrixData.cells[key] || '').filter(Boolean);
        if (flats.length > 0) {
          cells.push({ building, flats });
        }
      });
      if (cells.length > 0) {
        rows.push({ floor, cells });
      }
    });
    return rows;
  }, [entryMode, matrixConfig, matrixData.cells]);

  const handleMatrixCellChange = (building, floor, value) => {
    const key = normalizeCellKey(building, floor);
    setMatrixData((prev) => ({
      ...prev,
      cells: {
        ...prev.cells,
        [key]: value,
      },
    }));
  };

  const handleMatrixPaste = (startBuildingIdx, startFloorIdx, text) => {
    const rows = String(text || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((row) => row.split('\t'));

    if (!rows.length) return;

    setMatrixData((prev) => {
      const nextCells = { ...prev.cells };
      rows.forEach((row, rowOffset) => {
        const floor = matrixConfig.floors[startFloorIdx + rowOffset];
        if (!floor) return;
        row.forEach((value, colOffset) => {
          const building = matrixConfig.buildings[startBuildingIdx + colOffset];
          if (!building) return;
          nextCells[normalizeCellKey(building, floor)] = value.trim();
        });
      });
      return { ...prev, cells: nextCells };
    });
  };

  const addMatrixItem = (field, value = '') => {
    setMatrixData((prev) => {
      const current = parseCommaList(prev[field]).filter(Boolean);
      const nextValue = value || `${field === 'buildings' ? 1 : 1}`;
      if (current.includes(nextValue)) {
        return prev;
      }
      return { ...prev, [field]: [...current, nextValue].join(', ') };
    });
  };

  const removeMatrixItem = (field, value) => {
    setMatrixData((prev) => {
      const current = parseCommaList(prev[field]).filter(Boolean);
      const next = current.filter((item) => item !== value);
      const nextCells = { ...prev.cells };
      Object.keys(nextCells).forEach((key) => {
        if ((field === 'buildings' && key.startsWith(`${value}__`)) || (field === 'floors' && key.endsWith(`__${value}`))) {
          delete nextCells[key];
        }
      });
      return { ...prev, [field]: next.join(', '), cells: nextCells };
    });
  };

  const buildMatrixPieces = () => {
    const pieces = [];
    const buildings = matrixConfig.buildings;
    const floors = matrixConfig.floors;

    if (buildings.length === 0 && floors.length === 0) {
      for (let i = 0; i < formData.qty; i++) {
        pieces.push({
          part: formData.part,
          category: formData.category,
          drawing: formData.drawing || "",
          length: formData.length,
          width: formData.width,
          unit: formData.unit || "",
          sink_type: formData.sink_type || "No Sink",
          sink_cut: formData.sink_cut || "-",
          tap_holes: formData.tap_holes || "-",
          grooves: formData.grooves || "-",
          edge: formData.edge || "None",
          edge_area: formData.edge_area || "",
          edge_polish_machine: edgePolishMachine,
          radius: formData.radius || "-",
          notes: formData.notes || "",
          qty: 1,
          building: "",
          floor: "",
          flat: "",
        });
      }
      return pieces;
    }

    buildings.forEach((building) => {
      floors.forEach((floor) => {
        const key = normalizeCellKey(building, floor);
        const flats = parseCommaList(matrixData.cells[key] || '');
        flats.forEach((flat) => {
          for (let i = 0; i < formData.qty; i++) {
            pieces.push({
              part: formData.part,
              category: formData.category,
              drawing: formData.drawing || "",
              length: formData.length,
              width: formData.width,
              unit: formData.unit || "",
              sink_type: formData.sink_type || "No Sink",
              sink_cut: formData.sink_cut || "-",
              tap_holes: formData.tap_holes || "-",
              grooves: formData.grooves || "-",
              edge: formData.edge || "None",
              edge_area: formData.edge_area || "",
              edge_polish_machine: edgePolishMachine,
              radius: formData.radius || "-",
              notes: formData.notes || "",
              qty: 1,
              building,
              floor,
              flat,
            });
          }
        });
      });
    });
    return pieces;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!formData.part || formData.length === '' || formData.width === '') { 
      alert('Please fill Part, Length, and Depth'); 
      return; 
    }
    
    const piecesToCreate = entryMode === 'matrix'
      ? buildMatrixPieces()
      : (() => {
          const buildings = parseCommaList(formData.building);
          const floors = parseCommaList(formData.floor);
          const flats = parseCommaList(formData.flat);
          const destinationPairs = buildDestinationPairs(floors, flats);

          const pieces = [];
          const basePiece = {
              part: formData.part,
              category: formData.category,
              drawing: formData.drawing || "",
              length: formData.length,
              width: formData.width,
              unit: formData.unit || "",
              sink_type: formData.sink_type || "No Sink",
              sink_cut: formData.sink_cut || "-",
              tap_holes: formData.tap_holes || "-",
              grooves: formData.grooves || "-",
              edge: formData.edge || "None",
              edge_area: formData.edge_area || "",
              edge_polish_machine: edgePolishMachine,
              radius: formData.radius || "-",
              notes: formData.notes || ""
          };

          for (const building of buildings) {
            for (const destination of destinationPairs) {
              for (let i = 0; i < formData.qty; i++) {
                pieces.push({
                  ...basePiece,
                  qty: 1,
                  building,
                  floor: destination.floor,
                  flat: destination.flat
                });
              }
            }
          }
          return pieces;
        })();

    if (entryMode === 'matrix' && piecesToCreate.length === 0) {
      for (let i = 0; i < formData.qty; i++) {
        piecesToCreate.push({
          part: formData.part,
          category: formData.category,
          drawing: formData.drawing || "",
          length: formData.length,
          width: formData.width,
          unit: formData.unit || "",
          sink_type: formData.sink_type || "No Sink",
          sink_cut: formData.sink_cut || "-",
          tap_holes: formData.tap_holes || "-",
          grooves: formData.grooves || "-",
          edge: formData.edge || "None",
          edge_area: formData.edge_area || "",
          edge_polish_machine: edgePolishMachine,
          radius: formData.radius || "-",
          notes: formData.notes || "",
          qty: 1,
          building: formData.building || "",
          floor: formData.floor || "",
          flat: formData.flat || "",
        });
      }
    }
    
    try {
      setIsSubmitting(true);
      setShowSpinner(false);
      spinnerTimerRef.current = setTimeout(() => {
        setShowSpinner(true);
      }, 3000);
      await axios.post(`${API_BASE}/projects/${project.id}/pieces/batch`, piecesToCreate);
      setFormData({ 
        part: '', category: 'Vanity', drawing: '', length: '', width: '', qty: 1, unit: '', 
        building: '', floor: '', flat: '', sink_type: 'No Sink', sink_cut: '-', 
        tap_holes: '-', grooves: '-', edge: 'None', edge_area: '', edge_polish_machine: 0, radius: '-', notes: '' 
      });
      setMatrixData({ buildings: '', floors: '', cells: {} });
      setLiveCalc({ sqft: 0, kg: 0 });
      alert('Pieces added successfully!');
      onDataChange();
    } catch (error) { 
      console.error(error); 
      alert('Error adding pieces'); 
    } finally {
      if (spinnerTimerRef.current) {
        clearTimeout(spinnerTimerRef.current);
        spinnerTimerRef.current = null;
      }
      setShowSpinner(false);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mb-6">
      <div className="bg-white shadow-sm rounded-lg border border-[#e2e8f0] p-5 mb-6">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-[#1e293b]">Project Details</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <div><label className="label-text">Project Name</label><input name="name" value={project.name || ''} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field" /></div>
          <div><label className="label-text">Material</label><select name="material" value={project.material} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field"><option>Granite</option><option>Quartz</option><option>Marble</option></select></div>
          <div><label className="label-text">Thickness</label><select name="thickness" value={project.thickness} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field"><option>2CM</option><option>3CM</option><option>Mixed</option></select></div>
          <div><label className="label-text">Customer</label><input name="customer" value={project.customer || ''} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field" /></div>
          <div><label className="label-text">Job #</label><input name="job_number" value={project.job_number || ''} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field" /></div>
          <div><label className="label-text">Date</label><input type="date" name="date" value={project.date || ''} onChange={handleProjectChange} onBlur={handleProjectBlur} className="input-field" /></div>
        </div>
      </div>

      <div className="bg-white shadow-sm rounded-lg border border-[#e2e8f0]">
        <form onSubmit={handleSubmit}>
          <div className="flex gap-2 px-5 pt-5">
            <button type="button" onClick={() => setEntryMode('simple')} className={`px-4 py-2 rounded-t-md border ${entryMode === 'simple' ? 'bg-[#1e293b] text-white border-[#1e293b]' : 'bg-white text-[#475569] border-[#cbd5e1]'}`}>
              Simple Entry
            </button>
            <button type="button" onClick={() => setEntryMode('matrix')} className={`px-4 py-2 rounded-t-md border ${entryMode === 'matrix' ? 'bg-[#1e293b] text-white border-[#1e293b]' : 'bg-white text-[#475569] border-[#cbd5e1]'}`}>
              Matrix Entry
            </button>
          </div>
          <div className="px-5 pb-2 text-xs text-[#64748b]">
            {entryMode === 'simple'
              ? 'Use the quick form when the job does not follow a strict building/floor matrix.'
              : 'Use the matrix when the drawing lists buildings across the top and floors down the side. Leave it blank if no destination structure exists.'}
          </div>
          <div className="p-5 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="col-span-2"><label className="label-text">Part Description</label><select name="part" value={formData.part} onChange={handleChange} className="input-field" required><option value="">Select...</option>{Object.entries(partOptions).map(([cat, parts]) => <optgroup label={cat} key={cat}>{parts.map(p => <option key={p}>{p}</option>)}</optgroup>)}</select></div>
            <div><label className="label-text">Category</label><select name="category" value={formData.category} onChange={handleChange} className="input-field"><option>Vanity</option><option>Kitchen</option><option>Laundry</option><option>Island</option><option>Splashes</option><option>Utility</option><option>Other</option></select></div>
            <div><label className="label-text">Drawing #</label><input name="drawing" value={formData.drawing} onChange={handleChange} className="input-field" /></div>
            <div><label className="label-text">Length (in)</label><input name="length" type="number" step="0.125" value={formData.length} onChange={handleChange} className="input-field" required /></div>
            <div><label className="label-text">Depth (in)</label><input name="width" type="number" step="0.125" value={formData.width} onChange={handleChange} className="input-field" required /></div>
            
            <div><label className="label-text">Qty</label><input name="qty" type="number" min="1" value={formData.qty} onChange={handleChange} className="input-field" /></div>
            <div><label className="label-text">Edge Polish</label><select name="edge" value={formData.edge} onChange={handleChange} className="input-field"><option>None</option><option>Machine</option><option>Manual</option><option>Both</option></select></div>
            <div><label className="label-text">Edge Polish area</label><select name="edge_area" value={formData.edge_area} onChange={handleChange} className="input-field"><option value="">None</option><option>4 Sides</option><option>3 Sides</option><option>2 Sides</option><option>1 Side</option></select></div>
            <div><label className="label-text">Radius</label><select name="radius" value={formData.radius} onChange={handleChange} className="input-field"><option>-</option><option>1</option><option>2</option><option>3</option><option>4</option></select></div>
            <div><label className="label-text">Sink Type</label><select name="sink_type" value={formData.sink_type} onChange={handleChange} className="input-field"><option>No Sink</option><option>Single Bowl</option><option>Double Bowl</option><option>ADA</option><option>PL-VS3018</option><option>PL-3639</option></select></div>
            <div><label className="label-text">Cutouts</label><select name="sink_cut" value={formData.sink_cut} onChange={handleChange} className="input-field font-sans"><option value="-">-</option><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></div>
            <div><label className="label-text">Tap Holes</label><select name="tap_holes" value={formData.tap_holes} onChange={handleChange} className="input-field font-sans"><option value="-">-</option><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option></select></div>
            
            <div><label className="label-text">Grooves</label><select name="grooves" value={formData.grooves} onChange={handleChange} className="input-field font-sans"><option value="-">-</option><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></div>
            <div className="col-span-2"><label className="label-text">Unit Name</label><input name="unit" value={formData.unit} onChange={handleChange} className="input-field" /></div>
            <div className="col-span-3"><label className="label-text">Notes</label><input name="notes" value={formData.notes} onChange={handleChange} className="input-field" /></div>
            {entryMode === 'simple' && (
              <>
                <div className="col-span-2"><label className="label-text">Building</label><input name="building" value={formData.building} onChange={handleChange} className="input-field" placeholder="e.g., 5,6" /></div>
                <div className="col-span-2"><label className="label-text">Floor</label><input name="floor" value={formData.floor} onChange={handleChange} className="input-field" placeholder="e.g., 1,2,3" /></div>
                <div className="col-span-2"><label className="label-text">Flat</label><input name="flat" value={formData.flat} onChange={handleChange} className="input-field" placeholder="e.g., 101,102,201,202" /></div>
              </>
            )}
            {entryMode === 'matrix' && (
              <>
                <div className="col-span-6 rounded-md border border-[#dbe4f0] bg-[#f8fafc] p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="label-text">Buildings</label>
                      <input
                        value={matrixData.buildings}
                        onChange={(e) => setMatrixData((prev) => ({ ...prev, buildings: e.target.value }))}
                        className="input-field"
                        placeholder="10,13,14,15,16,17"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        {matrixConfig.buildings.map((building) => (
                          <button
                            key={building}
                            type="button"
                            onClick={() => removeMatrixItem('buildings', building)}
                            className="rounded-full border border-[#cbd5e1] bg-white px-2.5 py-1 text-[11px] text-[#475569] hover:bg-[#f1f5f9]"
                          >
                            {building} ×
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => addMatrixItem('buildings', String(matrixConfig.buildings.length + 1))}
                          className="rounded-full border border-dashed border-[#94a3b8] bg-transparent px-2.5 py-1 text-[11px] text-[#334155] hover:bg-[#e2e8f0]"
                        >
                          + Add building
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="label-text">Floors</label>
                      <input
                        value={matrixData.floors}
                        onChange={(e) => setMatrixData((prev) => ({ ...prev, floors: e.target.value }))}
                        className="input-field"
                        placeholder="1,2,3"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        {matrixConfig.floors.map((floor) => (
                          <button
                            key={floor}
                            type="button"
                            onClick={() => removeMatrixItem('floors', floor)}
                            className="rounded-full border border-[#cbd5e1] bg-white px-2.5 py-1 text-[11px] text-[#475569] hover:bg-[#f1f5f9]"
                          >
                            Floor {floor} ×
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => addMatrixItem('floors', String(matrixConfig.floors.length + 1))}
                          className="rounded-full border border-dashed border-[#94a3b8] bg-transparent px-2.5 py-1 text-[11px] text-[#334155] hover:bg-[#e2e8f0]"
                        >
                          + Add floor
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 overflow-x-auto rounded-md border border-[#cbd5e1] bg-white">
                    {matrixConfig.buildings.length > 0 && matrixConfig.floors.length > 0 ? (
                      <table className="w-full text-xs">
                        <thead className="bg-[#f8fafc]">
                          <tr>
                            <th className="p-2 text-left sticky left-0 bg-[#f8fafc] z-10">Floor / Building</th>
                            {matrixConfig.buildings.map((building) => (
                              <th key={building} className="p-2 text-left">{building}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {matrixConfig.floors.map((floor) => (
                            <tr key={floor} className="border-t border-[#e2e8f0]">
                              <td className="p-2 font-semibold text-[#1e293b] sticky left-0 bg-white">Floor {floor}</td>
                              {matrixConfig.buildings.map((building) => {
                                const key = normalizeCellKey(building, floor);
                                return (
                                  <td key={key} className="p-2 align-top min-w-[140px]">
                                    <textarea
                                      rows={3}
                                      value={matrixData.cells[key] || ''}
                                      onChange={(e) => handleMatrixCellChange(building, floor, e.target.value)}
                                      onPaste={(e) => {
                                        const pasteText = e.clipboardData.getData('text');
                                        if (!pasteText.includes('\n') && !pasteText.includes('\t')) return;
                                        e.preventDefault();
                                        handleMatrixPaste(
                                          matrixConfig.buildings.indexOf(building),
                                          matrixConfig.floors.indexOf(floor),
                                          pasteText
                                        );
                                      }}
                                      className="input-field min-h-[72px] resize-y"
                                      placeholder="101, 103, 105"
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-6 text-sm text-[#64748b]">
                        No matrix structure yet. Add buildings and floors to start, or leave everything blank and save a non-location piece quantity.
                      </div>
                    )}
                  </div>
                  {matrixPreview.length > 0 && (
                    <div className="mt-4 rounded-md border border-[#cbd5e1] bg-white p-4">
                      <div className="text-sm font-semibold text-[#1e293b] mb-2">Print preview</div>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr>
                              <th className="border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-left sticky left-0">Floor</th>
                              {matrixConfig.buildings.map((building) => (
                                <th key={building} className="border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-left">{building}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {matrixConfig.floors.map((floor) => (
                              <tr key={floor}>
                                <td className="border border-[#cbd5e1] px-3 py-2 font-semibold sticky left-0 bg-white">Floor {floor}</td>
                                {matrixConfig.buildings.map((building) => {
                                  const key = normalizeCellKey(building, floor);
                                  const flats = parseCommaList(matrixData.cells[key] || '').filter(Boolean);
                                  return (
                                    <td key={key} className="border border-[#cbd5e1] px-3 py-2 align-top min-w-[120px]">
                                      {flats.length > 0 ? flats.join(', ') : <span className="text-[#cbd5e1]">—</span>}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
            {entryMode === 'simple' && destinationPreview.length > 0 && (
              <div className="col-span-6 rounded-md border border-[#dbe4f0] bg-[#f8fafc] p-3 text-xs text-[#475569]">
                <div className="font-semibold text-[#334155] mb-1">Destination preview</div>
                <div className="flex flex-wrap gap-2">
                  {destinationPreview.map((item) => (
                    <span key={item.floor} className="rounded-full border border-[#cbd5e1] bg-white px-3 py-1">
                      Floor {item.floor}: {item.flats.join(', ')}
                    </span>
                  ))}
                </div>
                <div className="mt-2">Flats are matched to the floor prefix first, so 101/102 stay under Floor 1 and 201/202 stay under Floor 2.</div>
              </div>
            )}
            {entryMode === 'matrix' && matrixPreview.length > 0 && (
              <div className="col-span-6 rounded-md border border-[#dbe4f0] bg-[#f8fafc] p-3 text-xs text-[#475569]">
                <div className="font-semibold text-[#334155] mb-1">Matrix preview</div>
                <div className="space-y-1">
                  {matrixPreview.map((row) => (
                    <div key={row.floor}>
                      <span className="font-semibold">Floor {row.floor}:</span>{' '}
                      {row.cells.map((cell) => `${cell.building} -> ${cell.flats.join(', ')}`).join(' | ')}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="col-span-6 rounded-md border border-[#dbe4f0] bg-[#f8fafc] p-3 text-xs text-[#475569]">
              <div className="font-semibold text-[#334155] mb-1">Edge Polish area</div>
              <div>{edgePolishMachine ? `${edgePolishMachine.toFixed(2)} in` : '—'}</div>
              <div className="mt-1">Calculated from Length x Depth and the selected edge polish type.</div>
            </div>
          </div>
          <div className="relative border-t border-[#e2e8f0] px-5 py-4 bg-[#f8fafc] rounded-b-lg flex justify-between items-center">
            <div className="text-sm text-[#475569] font-medium">Live Calculation: <span className={liveCalc.sqft ? 'text-[#2563eb] font-bold ml-2' : 'text-[#94a3b8] ml-2'}>{liveCalc.sqft ? `${liveCalc.sqft.toFixed(2)} sq ft / ${liveCalc.kg.toFixed(1)} kg` : '— sq ft / — kg'}</span></div>
            <button type="submit" disabled={isSubmitting} className={`btn-primary inline-flex items-center gap-2 ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}`}>
              {showSpinner && (
                <span className="inline-flex h-4 w-4 items-center justify-center">
                  <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                </span>
              )}
              <span>{showSpinner ? 'Saving...' : '+ Add Piece'}</span>
            </button>
            {showSpinner && (
              <div className="absolute right-5 -top-10 rounded-md border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs text-[#475569] shadow-sm">
                Saving piece data...
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default EntryForm;
