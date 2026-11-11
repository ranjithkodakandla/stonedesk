import React, { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { buildSlab3DLayout } from '../../utils/crate3dLayout';
import { baseStoneColor, stoneFleckStyle, sinkCutoutRect, WOOD_BASE_COLOR, WOOD_GRAIN_COLOR } from '../../utils/stoneMaterial';

// Real 3D scene, built from the same row/thickness data as the 2D
// cross-section (CratePackingSchedule) — not an AI-generated image, so it
// always matches the actual plan: correct piece count, correct proportions,
// and a sink cutout only where a piece in the plan actually has one.
// Procedural canvas textures (wood grain, stone speckle/veining) stand in
// for photographic materials so there's no external asset or per-render
// generation involved.

const FOAM_IN = 1;
const WALL_IN = 3; // crate wall thickness, matches planner_v3/dimensions.py's _WALL

function useStoneTexture(material, stoneColor) {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const base = baseStoneColor(stoneColor);
    const style = stoneFleckStyle(material);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    if (style.veined) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i += 1) {
        ctx.beginPath();
        const y0 = Math.random() * 256;
        ctx.moveTo(0, y0);
        ctx.bezierCurveTo(80, y0 + (Math.random() - 0.5) * 60, 180, y0 + (Math.random() - 0.5) * 60, 256, y0 + (Math.random() - 0.5) * 60);
        ctx.stroke();
      }
    }
    for (let i = 0; i < style.speckleCount; i += 1) {
      const shade = Math.random() < 0.5 ? 'rgba(255,255,255,' : 'rgba(0,0,0,';
      ctx.fillStyle = `${shade}${(0.15 + Math.random() * style.speckleDensity).toFixed(2)})`;
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const r = 0.6 + Math.random() * 1.8;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return { texture, roughness: style.roughness, metalness: style.metalness };
  }, [material, stoneColor]);
}

function useWoodTexture() {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = WOOD_BASE_COLOR;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = WOOD_GRAIN_COLOR;
    for (let i = 0; i < 10; i += 1) {
      ctx.lineWidth = 0.8 + Math.random();
      ctx.beginPath();
      const y0 = (i / 10) * 128 + (Math.random() - 0.5) * 6;
      ctx.moveTo(0, y0);
      ctx.bezierCurveTo(40, y0 + (Math.random() - 0.5) * 8, 90, y0 + (Math.random() - 0.5) * 8, 128, y0 + (Math.random() - 0.5) * 6);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }, []);
}

function Slab({ slab, stone }) {
  const { xIn, zIn, lengthIn, thicknessIn, heightIn, piece } = slab;
  const cutout = sinkCutoutRect(piece, heightIn);
  return (
    <group position={[xIn + lengthIn / 2, heightIn / 2, zIn + thicknessIn / 2]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[lengthIn, heightIn, thicknessIn]} />
        <meshStandardMaterial map={stone.texture} roughness={stone.roughness} metalness={stone.metalness} />
      </mesh>
      {cutout && (
        // On the slab's -Z face — the one facing the camera (see the Canvas
        // comment: camera approaches from z < 0, looking toward +Z).
        <mesh position={[
          cutout.x + cutout.width / 2 - lengthIn / 2,
          cutout.y + cutout.height / 2 - heightIn / 2,
          -(thicknessIn / 2 + 0.05),
        ]}
        >
          <boxGeometry args={[cutout.width, cutout.height, 0.3]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>
      )}
    </group>
  );
}

function CrateFrame({ lengthIn, widthIn, heightIn, wood }) {
  const postSize = 2.5;
  const skirtH = Math.min(8, heightIn * 0.3);
  const positions = [
    [postSize / 2, heightIn / 2, postSize / 2],
    [lengthIn - postSize / 2, heightIn / 2, postSize / 2],
    [postSize / 2, heightIn / 2, widthIn - postSize / 2],
    [lengthIn - postSize / 2, heightIn / 2, widthIn - postSize / 2],
  ];
  return (
    <group>
      {/* Pallet base */}
      <mesh position={[lengthIn / 2, -1.5, widthIn / 2]} receiveShadow>
        <boxGeometry args={[lengthIn, 3, widthIn]} />
        <meshStandardMaterial map={wood} />
      </mesh>
      {/* Corner posts */}
      {positions.map((p, i) => (
        <mesh key={i} position={p} castShadow>
          <boxGeometry args={[postSize, heightIn, postSize]} />
          <meshStandardMaterial map={wood} />
        </mesh>
      ))}
      {/* Low skirting boards (front/back only, so the packed slabs stay visible) */}
      <mesh position={[lengthIn / 2, skirtH / 2, postSize / 2]}>
        <boxGeometry args={[lengthIn, skirtH, 1]} />
        <meshStandardMaterial map={wood} />
      </mesh>
      <mesh position={[lengthIn / 2, skirtH / 2, widthIn - postSize / 2]}>
        <boxGeometry args={[lengthIn, skirtH, 1]} />
        <meshStandardMaterial map={wood} />
      </mesh>
    </group>
  );
}

function FoamBand({ lengthIn, widthIn, y, heightIn }) {
  return (
    <mesh position={[lengthIn / 2, y, widthIn / 2]}>
      <boxGeometry args={[lengthIn, heightIn, widthIn]} />
      <meshStandardMaterial color="#f8fafc" transparent opacity={0.55} roughness={0.9} />
    </mesh>
  );
}

function DimLabel({ position, children }) {
  return (
    <Html position={position} center distanceFactor={14} zIndexRange={[50, 0]}>
      <div className="rounded bg-slate-900/85 px-1.5 py-0.5 text-[9px] font-semibold text-white whitespace-nowrap">
        {children}
      </div>
    </Html>
  );
}

export default function Crate3DPacking({ rows, internalLength, internalWidth, internalHeight, material, stoneColor }) {
  const { slabs, totalDepthIn } = useMemo(() => buildSlab3DLayout(rows || []), [rows]);
  const stone = useStoneTexture(material, stoneColor);
  const wood = useWoodTexture();

  const L = internalLength || Math.max(1, ...slabs.map((s) => s.xIn + s.lengthIn)) + 6;
  const W = internalWidth || totalDepthIn + 4;
  const H = internalHeight || Math.max(1, ...slabs.map((s) => s.heightIn)) + 2 * FOAM_IN + 4;
  const maxDim = Math.max(L, W, H);

  if (!slabs.length) {
    return <div className="p-4 text-sm text-slate-400">No packing schedule for this crate yet.</div>;
  }

  return (
    <div className="h-[340px] w-full overflow-hidden rounded-xl border border-[#e2e8f0] bg-[#0b1220]">
      {/* Camera sits in front of the row-1 end (z < 0), looking toward +Z —
          so the first slab in the packing sequence (and any sink cutout on
          it) is the one actually visible, with the rest receding behind it
          as thin edges, matching how the reference packing photo is framed. */}
      <Canvas shadows camera={{ position: [L * 0.6, H * 0.75, -W * 1.3], fov: 42, near: 0.1, far: 5000 }}>
        <Suspense fallback={null}>
          <color attach="background" args={['#0b1220']} />
          <ambientLight intensity={0.55} />
          <directionalLight castShadow position={[L * 0.6, H * 1.4, W * 1.2]} intensity={1.05} />
          <CrateFrame lengthIn={L} widthIn={W} heightIn={H} wood={wood} />
          <FoamBand lengthIn={L} widthIn={W} y={FOAM_IN / 2} heightIn={FOAM_IN} />
          <FoamBand lengthIn={L} widthIn={W} y={H - FOAM_IN / 2} heightIn={FOAM_IN} />
          {slabs.map((slab) => <Slab key={`${slab.row}-${slab.pieceId}`} slab={slab} stone={stone} />)}
          <DimLabel position={[L / 2, -4, 0]}>{L.toFixed(1)}"</DimLabel>
          <DimLabel position={[-4, H / 2, 0]}>{H.toFixed(1)}"</DimLabel>
          <DimLabel position={[0, -4, W / 2]}>{W.toFixed(1)}"</DimLabel>
          <OrbitControls enableDamping dampingFactor={0.08} target={[L / 2, H / 2, W / 2]} />
        </Suspense>
      </Canvas>
    </div>
  );
}
