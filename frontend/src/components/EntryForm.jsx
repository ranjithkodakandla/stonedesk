
import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const EntryForm = ({ project, setProject, onDataChange }) => {
  const [formData, setFormData] = useState({
    part: '', category: 'Vanity', drawing: '', length: '', width: '', qty: 1,
    unit: '', building: '', floor: '', flat: '',
    sink_type: 'No Sink', sink_cut: '-', tap_holes: '-', grooves: '-',
    edge: 'None', radius: '-', notes: ''
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!formData.part || formData.length === '' || formData.width === '') { 
      alert('Please fill Part, Length, and Depth'); 
      return; 
    }
    
    const buildings = parseCommaList(formData.building);
    const floors = parseCommaList(formData.floor);
    const flats = parseCommaList(formData.flat);

    const piecesToCreate = [];
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
        radius: formData.radius || "-",
        notes: formData.notes || ""
    };
    
    for (const building of buildings) {
      for (const floor of floors) {
        for (const flat of flats) {
          for (let i = 0; i < formData.qty; i++) {
            piecesToCreate.push({ 
              ...basePiece, 
              qty: 1, 
              building, 
              floor, 
              flat 
            });
          }
        }
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
        tap_holes: '-', grooves: '-', edge: 'None', radius: '-', notes: '' 
      });
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
          <div className="p-5 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="col-span-2"><label className="label-text">Part Description</label><select name="part" value={formData.part} onChange={handleChange} className="input-field" required><option value="">Select...</option>{Object.entries(partOptions).map(([cat, parts]) => <optgroup label={cat} key={cat}>{parts.map(p => <option key={p}>{p}</option>)}</optgroup>)}</select></div>
            <div><label className="label-text">Category</label><select name="category" value={formData.category} onChange={handleChange} className="input-field"><option>Vanity</option><option>Kitchen</option><option>Laundry</option><option>Island</option><option>Splashes</option><option>Utility</option><option>Other</option></select></div>
            <div><label className="label-text">Drawing #</label><input name="drawing" value={formData.drawing} onChange={handleChange} className="input-field" /></div>
            <div><label className="label-text">Length (in)</label><input name="length" type="number" step="0.125" value={formData.length} onChange={handleChange} className="input-field" required /></div>
            <div><label className="label-text">Depth (in)</label><input name="width" type="number" step="0.125" value={formData.width} onChange={handleChange} className="input-field" required /></div>
            
            <div><label className="label-text">Qty</label><input name="qty" type="number" min="1" value={formData.qty} onChange={handleChange} className="input-field" /></div>
            <div><label className="label-text">Edge Polish</label><select name="edge" value={formData.edge} onChange={handleChange} className="input-field"><option>None</option><option>Machine</option><option>Manual</option><option>Both</option></select></div>
            <div><label className="label-text">Radius</label><select name="radius" value={formData.radius} onChange={handleChange} className="input-field"><option>-</option><option>1</option><option>2</option><option>3</option><option>4</option></select></div>
            <div><label className="label-text">Sink Type</label><select name="sink_type" value={formData.sink_type} onChange={handleChange} className="input-field"><option>No Sink</option><option>Single Bowl</option><option>Double Bowl</option><option>ADA</option><option>PL-VS3018</option><option>PL-3639</option></select></div>
            <div><label className="label-text">Cutouts</label><select name="sink_cut" value={formData.sink_cut} onChange={handleChange} className="input-field font-sans"><option value="-">-</option><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></div>
            <div><label className="label-text">Tap Holes</label><select name="tap_holes" value={formData.tap_holes} onChange={handleChange} className="input-field font-sans"><option value="-">-</option><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option></select></div>
            
            <div><label className="label-text">Grooves</label><select name="grooves" value={formData.grooves} onChange={handleChange} className="input-field font-sans"><option value="-">-</option><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></div>
            <div className="col-span-2"><label className="label-text">Unit Name</label><input name="unit" value={formData.unit} onChange={handleChange} className="input-field" /></div>
            <div className="col-span-3"><label className="label-text">Notes</label><input name="notes" value={formData.notes} onChange={handleChange} className="input-field" /></div>
            <div className="col-span-2"><label className="label-text">Building</label><input name="building" value={formData.building} onChange={handleChange} className="input-field" placeholder="e.g., 5,6" /></div>
            <div className="col-span-2"><label className="label-text">Floor</label><input name="floor" value={formData.floor} onChange={handleChange} className="input-field" placeholder="e.g., 2,3" /></div>
            <div className="col-span-2"><label className="label-text">Flat</label><input name="flat" value={formData.flat} onChange={handleChange} className="input-field" placeholder="e.g., 203,303" /></div>
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
