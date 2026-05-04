import React from 'react';

const PiecesTable = ({ pieces, project, onDelete }) => {
  const getWeight = (p) => {
     const factors = { Granite: { '2CM': 5.5, '3CM': 7.5, 'Mixed': 6.5 }, Quartz: { '2CM': 4.75, '3CM': 6.75, 'Mixed': 5.75 }, Marble: { '2CM': 6.0, '3CM': 8.0, 'Mixed': 7.0 } };
     const factor = (factors[project.material] || factors['Granite'])[project.thickness] || 7.5;
     return ((p.length * p.width) / 144) * factor;
  };

  return (
    <div className="overflow-auto max-h-[500px] mt-6 bg-white border border-[#e2e8f0] shadow-sm rounded-lg relative">
       <table className="w-full text-left text-sm text-[#475569]">
         <thead className="bg-[#f1f5f9] text-[#334155] text-xs font-semibold sticky top-0 z-10 shadow-sm border-b border-[#e2e8f0]">
           <tr>
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
             <th className="p-3">Edge</th>
             <th className="p-3 text-right">SqFt ea</th>
             <th className="p-3 text-right">kg ea</th>
             <th className="p-3">Building</th>
             <th className="p-3">Floor</th>
             <th className="p-3">Flat</th>
             <th className="p-3 text-center">Actions</th>
           </tr>
         </thead>
         <tbody>
           {pieces.map(p => {
             const sqft = (p.length * p.width) / 144;
             const wt = getWeight(p);
             return (
               <tr key={p.id} className="border-b border-[#f1f5f9] hover:bg-[#f8fafc] transition-colors">
                 <td className="p-3 font-semibold text-[#1e293b]">{p.part}</td><td className="p-3">{p.category}</td>
                 <td className="p-3">{p.drawing}</td><td className="p-3">{p.unit}</td>
                 <td className="p-3 text-right">{p.length.toFixed(2)}</td><td className="p-3 text-right">{p.width.toFixed(2)}</td>
                 <td className="p-3 text-center text-[#2563eb] font-bold">{p.qty}</td><td className="p-3">{p.sink_type}</td>
                 <td className="p-3 text-center">{p.sink_cut}</td><td className="p-3 text-center">{p.tap_holes}</td><td className="p-3">{p.edge}</td>
                 <td className="p-3 text-right text-[#64748b]">{sqft.toFixed(2)}</td>
                 <td className="p-3 text-right text-[#64748b]">{wt.toFixed(1)}</td>
                 <td className="p-3 text-[#64748b]">{p.building}</td>
                 <td className="p-3 text-[#64748b]">{p.floor}</td>
                 <td className="p-3 text-[#64748b]">{p.flat}</td>
                 <td className="p-3 text-center"><button onClick={() => onDelete(p.id)} className="text-[#dc2626] hover:text-[#991b1b] font-medium text-xs px-3 py-1 bg-[#fef2f2] hover:bg-[#fee2e2] rounded-md border border-[#fecaca] transition-colors">Delete</button></td>
               </tr>
             );
           })}
           {pieces.length === 0 && <tr><td colSpan="17" className="p-8 text-center text-[#64748b] italic">No pieces added to this project yet.</td></tr>}
         </tbody>
       </table>
    </div>
  );
};
export default PiecesTable;