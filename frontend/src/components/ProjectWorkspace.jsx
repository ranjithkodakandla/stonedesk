import React, { useMemo, useState, useEffect } from 'react';
import axios from 'axios';
import Logo from './Logo';
import EntryForm from './EntryForm';
import PiecesTable from './PiecesTable';
import SummaryTab from './SummaryTab';
import CrateGrid from './CrateGrid';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const ProjectWorkspace = ({ projectId, goBack }) => {
   const [activeTab, setActiveTab] = useState('entry');
   const [project, setProject] = useState({ id: projectId, name: '', material: 'Granite', thickness: '3CM', customer: '', job_number: '', date: '' });
   const [pieces, setPieces] = useState([]);
   const [crates, setCrates] = useState([]);
   const [assignments, setAssignments] = useState({});

   const fetchData = async () => {
     try {
       const [projRes, pRes, cRes, aRes] = await Promise.all([ 
           axios.get(`${API_BASE}/projects/${projectId}`),
           axios.get(`${API_BASE}/projects/${projectId}/pieces/`), 
           axios.get(`${API_BASE}/projects/${projectId}/crates/`), 
           axios.get(`${API_BASE}/projects/${projectId}/crates/assignments`) 
       ]);
       if (projRes.data) setProject(projRes.data);
       setPieces(pRes.data); setCrates(cRes.data);
       const assignMap = {}; aRes.data.forEach(a => assignMap[a.piece_id] = a.crate_id);
       setAssignments(assignMap);
     } catch (e) { console.error("Error fetching data", e); alert('Failed to load project data.'); }
   };

   useEffect(() => { fetchData(); }, [projectId]);

   const getWeight = (p) => {
     const factors = { Granite: { '2CM': 5.5, '3CM': 7.5, 'Mixed': 6.5 }, Quartz: { '2CM': 4.75, '3CM': 6.75, 'Mixed': 5.75 }, Marble: { '2CM': 6.0, '3CM': 8.0, 'Mixed': 7.0 } };
     const factor = (factors[project.material] || factors['Granite'])[project.thickness] || 7.5;
     return ((p.length * p.width) / 144) * factor * p.qty;
   };

   const { totalSqFt, totalWeight, uniqueDrawings } = useMemo(() => {
     const sqFt = pieces.reduce((s, p) => s + ((p.length * p.width) / 144) * p.qty, 0);
     const weight = pieces.reduce((s, p) => s + getWeight(p), 0);
     const drawings = new Set(pieces.map(p => p.drawing).filter(Boolean)).size;
     return { totalSqFt: sqFt, totalWeight: weight, uniqueDrawings: drawings };
   }, [pieces, project.material, project.thickness]);

   const exportExcel = () => {
     if (pieces.length === 0) return alert("No pieces to export!");
     window.open(`${API_BASE}/projects/${projectId}/export`, '_blank');
   };

   const clearAll = async () => {
      if (window.confirm('Clear all pieces and crates?')) { 
          await axios.delete(`${API_BASE}/projects/${projectId}/crates/`); 
          await axios.delete(`${API_BASE}/projects/${projectId}/pieces/`); 
          fetchData();
          alert('Project data cleared!');
      }
   };

   return (
      <div className="min-h-screen bg-[#f8fafc] text-[#1e293b] font-sans p-6 max-w-[1400px] mx-auto">
         <div className="flex justify-between items-center mb-6 border-b border-[#e2e8f0] pb-4">
            <div className="flex items-center gap-6"><button onClick={goBack} className="text-[#475569] hover:text-[#0f172a] font-medium text-sm border border-[#cbd5e1] rounded-md bg-white px-3 py-1.5 transition-colors shadow-sm">← Back</button><Logo /></div>
         </div>
         <div className="bg-white border border-[#e2e8f0] rounded-lg p-4 mb-6 flex justify-between text-sm shadow-sm">
            <div><span className="text-[#64748b] mr-2">Drawings</span> <span className="text-[#2563eb] font-bold text-lg">{uniqueDrawings}</span></div>
            <div><span className="text-[#64748b] mr-2">Total Pieces</span> <span className="text-[#2563eb] font-bold text-lg">{pieces.reduce((s,p)=>s+p.qty, 0)}</span></div>
            <div><span className="text-[#64748b] mr-2">Total Sq Ft</span> <span className="text-[#2563eb] font-bold text-lg">{totalSqFt.toFixed(1)}</span></div>
            <div><span className="text-[#64748b] mr-2">Total Weight</span> <span className="text-[#2563eb] font-bold text-lg">{totalWeight.toFixed(0)} kg</span></div>
         </div>

         <div className="flex gap-2 mb-4 border-b border-[#e2e8f0]">
            {['Entry', 'Summary', 'Crate Plan'].map(tab => (<button key={tab.toLowerCase()} onClick={() => setActiveTab(tab.toLowerCase())} className={`px-6 py-2.5 text-sm font-medium transition-colors rounded-t-lg ${activeTab === tab.toLowerCase() ? 'bg-white border-t border-x border-[#e2e8f0] text-[#2563eb] shadow-sm relative top-[1px]' : 'text-[#64748b] hover:text-[#1e293b] hover:bg-[#f1f5f9]'}`}>{tab}</button>))}
         </div>
         {activeTab === 'entry' && <><EntryForm project={project} setProject={setProject} onDataChange={fetchData} /><PiecesTable pieces={pieces} project={project} onDelete={async (id) => { await axios.delete(`${API_BASE}/pieces/${id}`); fetchData(); alert('Piece deleted'); }} onDataChange={fetchData} /></>}
         {activeTab === 'summary' && <SummaryTab pieces={pieces} project={project} />}
         {activeTab === 'crate plan' && <CrateGrid pieces={pieces} crates={crates} assignments={assignments} project={project} onDataChange={fetchData} />}

         <div className="bg-white border border-[#e2e8f0] shadow-sm rounded-lg p-5 flex justify-between items-center mt-6">
            <span className="text-[#334155] font-medium">Export Project Data</span>
            <div className="flex gap-4">
              <button className="btn-danger" onClick={clearAll}>Clear All Data</button>
              <button 
                className={`btn-primary text-white border-none ${pieces.length > 0 ? 'bg-[#059669] hover:bg-[#047857]' : 'bg-gray-400 cursor-not-allowed'}`} 
                onClick={exportExcel}
                disabled={pieces.length === 0}
              >
                Export Excel
              </button>
            </div>
         </div>
      </div>
   );
};
export default ProjectWorkspace;
