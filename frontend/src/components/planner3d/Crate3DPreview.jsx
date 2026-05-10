import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

const CLASS_COLORS = {
  A: '#2563eb',
  B: '#059669',
  C: '#d97706',
  D: '#7c3aed',
};

function Box({ el, ew, eh, cls }) {
  const color = CLASS_COLORS[cls] || '#64748b';
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[el, eh, ew]} />
      <meshStandardMaterial color={color} metalness={0.08} roughness={0.55} />
    </mesh>
  );
}

export default function Crate3DPreview({ externalLength, externalWidth, externalHeight, crateClass }) {
  const el = Number(externalLength) || 48;
  const ew = Number(externalWidth) || 40;
  const eh = Number(externalHeight) || 32;
  const max = Math.max(el, ew, eh);

  return (
    <div className="h-[220px] w-full overflow-hidden rounded-xl border border-[#e2e8f0] bg-[#0b1220]">
      <Canvas camera={{ position: [max * 1.2, max * 0.9, max * 1.1], fov: 45 }}>
        <Suspense fallback={null}>
          <color attach="background" args={['#0b1220']} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[max, max * 2, max]} intensity={1} />
          <Box el={el} ew={ew} eh={eh} cls={crateClass} />
          <OrbitControls enableDamping />
        </Suspense>
      </Canvas>
    </div>
  );
}
