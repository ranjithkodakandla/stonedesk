import React, { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Edges, Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { inferIslandZoneDepthIn } from '../../utils/plannerDisplay';

const CLASS_COLORS = {
  A: '#2563eb',
  B: '#059669',
  C: '#d97706',
  D: '#7c3aed',
};

function ZoneFloors({ L, W, linearHorizEndX, linearIslandStartX, islandDepth, zone2Start }) {
  const useLinear =
    linearHorizEndX != null &&
    linearIslandStartX != null &&
    L > 0 &&
    !Number.isNaN(Number(linearHorizEndX)) &&
    !Number.isNaN(Number(linearIslandStartX));

  if (useLinear) {
    const he = Math.max(0, Math.min(Number(linearHorizEndX), L));
    const is0 = Math.max(0, Math.min(Number(linearIslandStartX), L));
    return (
      <group position={[0, 0.06, 0]}>
        {he > 1 && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[he / 2, 0, W / 2]}>
            <planeGeometry args={[he, W]} />
            <meshStandardMaterial color="#22c55e" transparent opacity={0.12} depthWrite={false} />
          </mesh>
        )}
        {L - is0 > 1 && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(is0 + L) / 2, 0, W / 2]}>
            <planeGeometry args={[L - is0, W]} />
            <meshStandardMaterial color="#3b82f6" transparent opacity={0.14} depthWrite={false} />
          </mesh>
        )}
        {he > 1 && (
          <Html position={[he * 0.35, 2, W * 0.82]} transform occlude>
            <div className="pointer-events-none rounded bg-emerald-700/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow">
              Back wall · B / C / D
            </div>
          </Html>
        )}
        {L - is0 > 1 && (
          <Html position={[(is0 + L) / 2, 2, W * 0.82]} transform occlude>
            <div className="pointer-events-none rounded bg-blue-600/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow">
              Door end · Islands (A)
            </div>
          </Html>
        )}
      </group>
    );
  }

  const d = Math.max(0, Math.min(islandDepth, L));
  const x2 = Math.max(d, Math.min(zone2Start || d, L));
  return (
    <group position={[0, 0.06, 0]}>
      {d > 1 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[d / 2, 0, W / 2]}>
          <planeGeometry args={[d, W]} />
          <meshStandardMaterial color="#3b82f6" transparent opacity={0.14} depthWrite={false} />
        </mesh>
      )}
      {L - x2 > 1 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(x2 + L) / 2, 0, W / 2]}>
          <planeGeometry args={[L - x2, W]} />
          <meshStandardMaterial color="#22c55e" transparent opacity={0.1} depthWrite={false} />
        </mesh>
      )}
      {d > 1 && (
        <Html position={[d * 0.35, 2, W * 0.82]} transform occlude>
          <div className="pointer-events-none rounded bg-blue-600/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow">
            Zone 1 · Islands (A)
          </div>
        </Html>
      )}
      {L - x2 > 1 && (
        <Html position={[(x2 + L) / 2, 2, W * 0.82]} transform occlude>
          <div className="pointer-events-none rounded bg-emerald-700/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow">
            Zone 2 · B / C / D
          </div>
        </Html>
      )}
    </group>
  );
}

function ContainerShell({ L, W, H }) {
  const t = 0.35;
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#94a3b8',
        transparent: true,
        opacity: 0.22,
        metalness: 0.05,
        roughness: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [],
  );
  return (
    <group>
      <lineSegments position={[L / 2, H / 2, W / 2]}>
        <edgesGeometry attach="geometry" args={[new THREE.BoxGeometry(L, H, W)]} />
        <lineBasicMaterial attach="material" color="#94a3b8" transparent opacity={0.9} />
      </lineSegments>
      {/* Back wall z=0 */}
      <mesh position={[L / 2, H / 2, -t / 2]} material={mat}>
        <boxGeometry args={[L, H, t]} />
      </mesh>
      {/* Left wall x=0 */}
      <mesh position={[-t / 2, H / 2, W / 2]} material={mat}>
        <boxGeometry args={[t, H, W]} />
      </mesh>
      {/* Right wall x=L */}
      <mesh position={[L + t / 2, H / 2, W / 2]} material={mat}>
        <boxGeometry args={[t, H, W]} />
      </mesh>
      {/* Top (light) */}
      <mesh position={[L / 2, H + t / 2, W / 2]} material={mat}>
        <boxGeometry args={[L, t, W]} />
      </mesh>
      {/* Front opening at z=W — no wall for cutaway */}
    </group>
  );
}

function CrateMesh({ p, selected, onSelect }) {
  const { x, y, floor_l: fl, floor_w: fw, height_in: h, elevation_in: el, crate_class: cls } = p;
  const color = CLASS_COLORS[cls] || '#64748b';
  const cx = x + fl / 2;
  const cy = el + h / 2;
  const cz = y + fw / 2;
  const isSel = selected && p.crate_id === selected;
  const wkg = Math.round(Number(p.weight_kg) || 0);

  return (
    <group position={[cx, cy, cz]}>
      <mesh
        castShadow
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(p.crate_id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'default';
        }}
      >
        <boxGeometry args={[fl, h, fw]} />
        <meshStandardMaterial
          color={color}
          metalness={0.06}
          roughness={0.62}
          transparent
          opacity={0.93}
          emissive={isSel ? '#ffffff' : '#000000'}
          emissiveIntensity={isSel ? 0.35 : 0}
        />
        <Edges
          color={isSel ? '#f8fafc' : '#0f172a'}
          opacity={isSel ? 0.95 : 0.45}
          transparent
          threshold={12}
        />
      </mesh>
      <Html position={[0, h / 2 + 4, 0]} center distanceFactor={6} zIndexRange={[100, 0]}>
        <div className="pointer-events-none flex flex-col items-center gap-0.5">
          <div className="rounded border border-white/20 bg-black/85 px-2 py-0.5 font-mono text-[10px] font-semibold text-white shadow-lg">
            {p.crate_id}
          </div>
          <div className="rounded bg-amber-500/95 px-1.5 py-0.5 text-[9px] font-bold text-amber-950 shadow">
            {wkg} kg
          </div>
          <div className="text-[8px] font-semibold uppercase tracking-wide text-slate-200">
            {cls || '?'}-type
          </div>
        </div>
      </Html>
    </group>
  );
}

function Deck({ L, W }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[L / 2, 0, W / 2]} receiveShadow>
      <planeGeometry args={[L, W]} />
      <meshStandardMaterial color="#1e293b" />
    </mesh>
  );
}

function Scene({
  placements,
  L,
  W,
  H,
  islandZoneDepthIn,
  horizontalZoneStartX,
  linearHorizEndX,
  linearIslandStartX,
  selectedCrateId,
  onSelectCrate,
}) {
  const islandDepth = useMemo(() => {
    if (islandZoneDepthIn != null && islandZoneDepthIn > 0) return Number(islandZoneDepthIn);
    return inferIslandZoneDepthIn(placements);
  }, [islandZoneDepthIn, placements]);

  const zone2 = useMemo(() => {
    if (horizontalZoneStartX != null && horizontalZoneStartX > 0) return Number(horizontalZoneStartX);
    return islandDepth;
  }, [horizontalZoneStartX, islandDepth]);

  return (
    <>
      <color attach="background" args={['#0b1220']} />
      <ambientLight intensity={0.42} />
      <directionalLight castShadow position={[L * 0.7, H * 1.1, W * 0.4]} intensity={1.05} />
      <directionalLight position={[-L * 0.2, H * 0.5, W * 1.1]} intensity={0.35} />
      <Deck L={L} W={W} />
      <ZoneFloors
        L={L}
        W={W}
        linearHorizEndX={linearHorizEndX}
        linearIslandStartX={linearIslandStartX}
        islandDepth={islandDepth}
        zone2Start={zone2}
      />
      <ContainerShell L={L} W={W} H={H} />
      {placements.map((p, i) => (
        <CrateMesh key={p.crate_id || i} p={p} selected={selectedCrateId} onSelect={onSelectCrate} />
      ))}
      <OrbitControls enableDamping dampingFactor={0.08} target={[L / 2, H * 0.25, W / 2]} maxPolarAngle={Math.PI / 2 - 0.08} />
    </>
  );
}

export default function Container3DPreview({
  placements,
  lengthIn = 233,
  widthIn = 92,
  clearHeightIn = 100,
  islandZoneDepthIn,
  horizontalZoneStartX,
  linearHorizEndX,
  linearIslandStartX,
  maxWeightKg = 24000,
  totalWeightKg,
  selectedCrateId,
  onSelectCrate,
  hudTitle = '20ft dry · interior (in)',
}) {
  const sumKg = useMemo(() => {
    if (totalWeightKg != null) return Number(totalWeightKg);
    return (placements || []).reduce((s, p) => s + (Number(p.weight_kg) || 0), 0);
  }, [placements, totalWeightKg]);

  const util = maxWeightKg > 0 ? Math.min(100, Math.round((sumKg / maxWeightKg) * 1000) / 10) : 0;

  if (!placements?.length) {
    return (
      <div className="flex h-[360px] items-center justify-center rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] text-sm text-[#64748b]">
        No placement data — generate a crate plan or add crates to the container.
      </div>
    );
  }

  const L = Number(lengthIn) || 233;
  const W = Number(widthIn) || 92;
  const H = Number(clearHeightIn) || 100;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-[#1e293b] bg-[#0b1220] shadow-inner">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0f172a] px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">{hudTitle}</div>
        <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
          <span>
            <span className="text-slate-500">Stone est. </span>
            <strong className="text-amber-200">{Math.round(sumKg).toLocaleString()} kg</strong>
          </span>
          <span>
            <span className="text-slate-500">Cap </span>
            <strong className="text-slate-200">{Math.round(maxWeightKg).toLocaleString()} kg</strong>
          </span>
          <span>
            <span className="text-slate-500">Wt util. </span>
            <strong className={util > 95 ? 'text-amber-300' : 'text-emerald-300'}>{util}%</strong>
          </span>
          <span className="text-slate-500">{placements.length} crates</span>
        </div>
      </div>
      <div className="h-[400px] w-full">
        <Canvas shadows camera={{ position: [L * 0.95, H * 0.72, W * 1.45], fov: 42, near: 0.1, far: 5000 }}>
          <Suspense fallback={null}>
            <Scene
              placements={placements}
              L={L}
              W={W}
              H={H}
              islandZoneDepthIn={islandZoneDepthIn}
              horizontalZoneStartX={horizontalZoneStartX}
              linearHorizEndX={linearHorizEndX}
              linearIslandStartX={linearIslandStartX}
              selectedCrateId={selectedCrateId}
              onSelectCrate={onSelectCrate}
            />
          </Suspense>
        </Canvas>
      </div>
      <div className="border-t border-white/10 bg-[#0f172a] px-3 py-2 text-[10px] leading-relaxed text-slate-400">
        <strong className="text-slate-300">Orbit</strong> drag · scroll zoom ·{' '}
        <strong className="text-slate-300">Click crate</strong> to select (pairs with 2D plan). Adjust positions on the
        container canvas — this view updates after you move crates (live draft) or when the plan syncs.
      </div>
    </div>
  );
}
