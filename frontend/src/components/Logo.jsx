import React from 'react';

const Logo = () => (
  <div className="flex items-center gap-4">
    <img 
      src="https://www.virginsurfaces.com/assets/img/logo.png" 
      alt="Virgin Surfaces" 
      className="h-10 object-contain"
      onError={(e) => {
        e.target.onerror = null;
        e.target.src = "https://www.virginsurfaces.com/wp-content/uploads/2021/08/Virgin-Surfaces-logo-black.png";
      }}
    />
    <div className="h-8 w-px bg-[#cbd5e1]"></div>
    <div>
      <div className="text-2xl font-bold tracking-tight text-[#1e293b]">StoneDesk</div>
    </div>
  </div>
);
export default Logo;