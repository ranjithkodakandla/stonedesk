import React from 'react';

const SummaryTab = ({ pieces, project }) => {
  const getWeight = (p) => {
     const factors = { Granite: { '2CM': 5.5, '3CM': 7.5, 'Mixed': 6.5 }, Quartz: { '2CM': 4.75, '3CM': 6.75, 'Mixed': 5.75 }, Marble: { '2CM': 6.0, '3CM': 8.0, 'Mixed': 7.0 } };
     const factor = (factors[project.material] || factors['Granite'])[project.thickness] || 7.5;
     return ((p.length * p.width) / 144) * factor * p.qty;
  };

  const groups = {};
  pieces.forEach(p => {
     const key = `${p.part}|${p.category}`;
     if (!groups[key]) groups[key] = { part: p.part, category: p.category, drawings: new Set(), qty: 0, sqft: 0, weight: 0 };
     if (p.drawing) groups[key].drawings.add(p.drawing);
     groups[key].qty += p.qty;
     groups[key].sqft += ((p.length * p.width) / 144) * p.qty;
     groups[key].weight += getWeight(p);
  });

  const rows = Object.values(groups);
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalSqft = rows.reduce((s, r) => s + r.sqft, 0);
  const totalWeight = rows.reduce((s, r) => s + r.weight, 0);

  return (
    <div className="mt-6 bg-white border border-[#e2e8f0] shadow-sm rounded-lg overflow-x-auto">
       <table className="w-full text-left text-sm text-[#475569]">
         <thead className="bg-[#f1f5f9] text-[#334155] text-sm font-semibold border-b border-[#e2e8f0]">
           <tr>
             <th className="p-4">Part Description</th><th className="p-4">Category</th><th className="p-4 text-center">Material</th><th className="p-4 text-center">Thickness</th>
             <th className="p-4 text-center">Drawings</th><th className="p-4 text-right">Total Pieces</th><th className="p-4 text-right">Total Sq Ft</th><th className="p-4 text-right">Total Weight (kg)</th>
           </tr>
         </thead>
         <tbody>
           {rows.map((r, i) => (
             <tr key={i} className="border-b border-[#f1f5f9] hover:bg-[#f8fafc] transition-colors">
               <td className="p-4 font-semibold text-[#1e293b]">{r.part}</td><td className="p-4 text-[#64748b]">{r.category}</td><td className="p-4 text-center">{project.material}</td><td className="p-4 text-center">{project.thickness}</td>
               <td className="p-4 text-center text-[#2563eb] font-medium">{r.drawings.size}</td><td className="p-4 text-right font-bold">{r.qty}</td><td className="p-4 text-right">{r.sqft.toFixed(2)}</td><td className="p-4 text-right text-[#1e293b] font-bold">{r.weight.toFixed(1)}</td>
             </tr>
           ))}
           {rows.length > 0 && (
             <tr className="bg-[#f8fafc] font-bold border-t border-[#e2e8f0] text-[#1e293b]">
               <td className="p-4 text-right" colSpan="5">Grand Total</td><td className="p-4 text-right text-lg">{totalQty}</td><td className="p-4 text-right text-lg">{totalSqft.toFixed(2)}</td><td className="p-4 text-right text-lg">{totalWeight.toFixed(1)}</td>
             </tr>
           )}
           {rows.length === 0 && <tr><td colSpan="8" className="p-8 text-center text-[#64748b] italic">No data to summarize.</td></tr>}
         </tbody>
       </table>
    </div>
  );
};
export default SummaryTab;