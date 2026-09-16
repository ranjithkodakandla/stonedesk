import React from 'react';

const Logo = ({ dark = false }) => (
  <div className="flex items-center gap-4">
    <img
      src="/logo.png"
      alt="Virgin Surfaces"
      className={`h-9 object-contain ${dark ? 'bg-white rounded p-0.5' : ''}`}
    />
    <div className={`h-8 w-px ${dark ? 'bg-white/20' : 'bg-[#cbd5e1]'}`}></div>
    <div>
      <div className={`text-xl font-bold tracking-tight ${dark ? 'text-white' : 'text-[#1e293b]'}`}>StoneDesk</div>
      {dark && <div className="text-[11px] font-medium text-slate-400 -mt-0.5">Stone Fabrication Manager</div>}
    </div>
  </div>
);
export default Logo;