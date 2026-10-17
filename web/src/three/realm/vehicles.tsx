import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

// Shared materials. Models face +Z; y = 0 is the ground or waterline.
const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });
export const M = {
  wood: mat('#6e4a30'), darkWood: mat('#4a3020'), sail: mat('#efe4c8', { side: THREE.DoubleSide }), rope: mat('#c9b48a'),
  hull: mat('#2b2f36'), red: mat('#9c2f2a'), white: mat('#e9e7e1'), steel: mat('#7d848c'), black: mat('#1e2024'),
  glass: mat('#1d2a38', { roughness: 0.3, metalness: 0.3 }), blue: mat('#2f4f7a'), yellow: mat('#d6a23a'),
  horse: mat('#6b4426'), mane: mat('#2b1d14'), sack: mat('#c8b28a'), tyre: mat('#1a1a1a'),
  cream: mat('#e8dcc0'), shadow: new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.22, depthWrite: false }),
};
const CONTAINER_COLORS = ['#b5453a', '#3b6ea5', '#d1a23b', '#4f8a5b', '#8a5a9e', '#c4703a', '#2f7f86', '#9a9a9a'];

export function useAccent(color: string) {
  return useMemo(() => mat(color), [color]);
}

const Box = ({ s, p, m, r }: { s: [number, number, number]; p: [number, number, number]; m: THREE.Material; r?: [number, number, number] }) => (
  <mesh position={p} rotation={r} material={m}><boxGeometry args={s} /></mesh>
);
const Cyl = ({ r: rad, h, p, m, rot, seg = 10 }: { r: number | [number, number]; h: number; p: [number, number, number]; m: THREE.Material; rot?: [number, number, number]; seg?: number }) => (
  <mesh position={p} rotation={rot} material={m}><cylinderGeometry args={[Array.isArray(rad) ? rad[0] : rad, Array.isArray(rad) ? rad[1] : rad, h, seg]} /></mesh>
);
const Wheel = ({ p, r = 0.38 }: { p: [number, number, number]; r?: number }) => (
  <Cyl r={r} h={0.28} p={p} m={M.tyre} rot={[0, 0, Math.PI / 2]} seg={12} />
);
const Blob = ({ w, l }: { w: number; l: number }) => (
  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={M.shadow}><planeGeometry args={[w, l]} /></mesh>
);

/** Stacked containers in one draw call. */
function Containers({ rows, bays, tiers, origin, size = [1.15, 0.95, 2.3] as [number, number, number], seed = 1 }: {
  rows: number; bays: number; tiers: number; origin: [number, number, number]; size?: [number, number, number]; seed?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = rows * bays * tiers;
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    let i = 0, s = seed;
    for (let t = 0; t < tiers; t++) for (let b = 0; b < bays; b++) for (let r = 0; r < rows; r++) {
      m.setPosition(origin[0] + (r - (rows - 1) / 2) * (size[0] + 0.06), origin[1] + t * (size[1] + 0.03) + size[1] / 2, origin[2] + b * (size[2] + 0.1));
      ref.current!.setMatrixAt(i, m);
      s = (s * 9301 + 49297) % 233280;
      ref.current!.setColorAt(i, c.set(CONTAINER_COLORS[s % CONTAINER_COLORS.length]));
      i++;
    }
    ref.current!.instanceMatrix.needsUpdate = true;
    if (ref.current!.instanceColor) ref.current!.instanceColor.needsUpdate = true;
  }, [rows, bays, tiers, origin, size, seed]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <boxGeometry args={size} />
      <meshStandardMaterial flatShading roughness={0.8} />
    </instancedMesh>
  );
}

function triangleSail(h: number, w: number) {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(0, h); s.lineTo(-w, 0); s.lineTo(0, 0);
  const g = new THREE.ShapeGeometry(s);
  g.rotateY(Math.PI / 2);
  return g;
}

/* ───────────── Sea ───────────── */

export function Ship({ level, accent }: { level: number; accent: THREE.Material }) {
  const sailGeo = useMemo(() => triangleSail(3.2, 2.2), []);
  switch (level) {
    case 1:
      return (
        <group>
          <Box s={[1.2, 0.6, 3.2]} p={[0, 0.2, 0]} m={M.wood} />
          <Box s={[0.85, 0.6, 0.85]} p={[0, 0.2, 1.85]} m={M.wood} r={[0, Math.PI / 4, 0]} />
          <Cyl r={0.06} h={3.8} p={[0, 2.3, 0.3]} m={M.darkWood} />
          <mesh geometry={sailGeo} position={[0, 0.7, 0.3]} material={M.sail} />
          <Box s={[0.02, 0.35, 0.55]} p={[0, 4.1, 0.05]} m={accent} />
        </group>
      );
    case 2:
      return (
        <group>
          <Box s={[2.2, 1.3, 7]} p={[0, 0.35, 0]} m={M.wood} />
          <Box s={[1.6, 1.3, 1.6]} p={[0, 0.35, 3.9]} m={M.wood} r={[0, Math.PI / 4, 0]} />
          <Box s={[2.2, 1.1, 1.9]} p={[0, 1.5, -2.6]} m={M.darkWood} />
          <Cyl r={0.06} h={3} p={[0, 1.2, 5.4]} m={M.darkWood} rot={[Math.PI / 2.6, 0, 0]} />
          {[-1.9, 0.2, 2.2].map((z, i) => (
            <group key={z} position={[0, 0, z]}>
              <Cyl r={0.09} h={i === 1 ? 7 : 5.8} p={[0, i === 1 ? 4.3 : 3.7, 0]} m={M.darkWood} />
              <Box s={[2.6, 1.5, 0.06]} p={[0, 2.6, 0]} m={M.sail} />
              <Box s={[2.1, 1.3, 0.06]} p={[0, 4.4, 0]} m={M.sail} />
              {i === 1 && <Box s={[0.02, 0.5, 0.9]} p={[0, 7.9, -0.45]} m={accent} />}
            </group>
          ))}
        </group>
      );
    case 3:
      return (
        <group>
          <Box s={[2.4, 1.4, 8.4]} p={[0, 0.5, 0]} m={M.hull} />
          <Box s={[2.42, 0.35, 8.42]} p={[0, -0.05, 0]} m={M.red} />
          <Box s={[1.7, 1.4, 1.7]} p={[0, 0.5, 4.5]} m={M.hull} r={[0, Math.PI / 4, 0]} />
          <Box s={[1.8, 1, 3.4]} p={[0, 1.7, -0.6]} m={M.white} />
          <Box s={[1.5, 0.7, 1.2]} p={[0, 2.5, 0.4]} m={M.white} />
          {[-1.2, 0.4].map((z) => (
            <group key={z}>
              <Cyl r={0.36} h={2} p={[0, 3.1, z - 0.5]} m={M.black} />
              <Cyl r={0.37} h={0.35} p={[0, 3.6, z - 0.5]} m={accent} />
            </group>
          ))}
          <Cyl r={0.05} h={3} p={[0, 3.2, 2.6]} m={M.steel} />
        </group>
      );
    case 4:
      return (
        <group>
          <Box s={[3, 1.6, 11]} p={[0, 0.55, 0]} m={M.blue} />
          <Box s={[3.02, 0.4, 11.02]} p={[0, -0.05, 0]} m={M.red} />
          <Box s={[2.1, 1.6, 2.1]} p={[0, 0.55, 5.8]} m={M.blue} r={[0, Math.PI / 4, 0]} />
          <Box s={[2.8, 2.4, 1.8]} p={[0, 2.5, -4.4]} m={M.white} />
          <Box s={[2.9, 0.4, 0.9]} p={[0, 3.3, -3.6]} m={M.glass} />
          <Cyl r={0.3} h={1.4} p={[0, 4, -5]} m={accent} />
          <Containers rows={2} bays={4} tiers={2} origin={[0, 1.35, -2.4]} seed={4} />
        </group>
      );
    default:
      return (
        <group>
          <Box s={[4.4, 2.2, 21]} p={[0, 0.7, 0]} m={M.hull} />
          <Box s={[4.42, 0.5, 21.02]} p={[0, -0.1, 0]} m={M.red} />
          <Box s={[3, 2.2, 3]} p={[0, 0.7, 10.8]} m={M.hull} r={[0, Math.PI / 4, 0]} />
          <Box s={[4, 5, 2.2]} p={[0, 4.2, -8.6]} m={M.white} />
          <Box s={[4.1, 0.6, 1]} p={[0, 6.2, -7.6]} m={M.glass} />
          <Cyl r={0.5} h={2} p={[0, 7.4, -9.4]} m={accent} />
          <Containers rows={3} bays={7} tiers={3} origin={[0, 1.85, -6.4]} seed={9} />
        </group>
      );
  }
}

/* ───────────── Road ───────────── */

export function RoadVehicle({ level, accent }: { level: number; accent: THREE.Material }) {
  const legs = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (legs.current) legs.current.children.forEach((l, i) => { l.rotation.x = Math.sin(clock.elapsedTime * 8 + i * Math.PI) * 0.4; });
  });
  switch (level) {
    case 1:
      return (
        <group>
          <Blob w={1.6} l={4.2} />
          <group position={[0, 0, 1.4]}>
            <Box s={[0.55, 0.6, 1.3]} p={[0, 1.15, 0]} m={M.horse} />
            <Box s={[0.32, 0.75, 0.35]} p={[0, 1.6, 0.65]} m={M.horse} r={[0.5, 0, 0]} />
            <Box s={[0.3, 0.3, 0.6]} p={[0, 1.95, 0.95]} m={M.horse} />
            <Box s={[0.08, 0.5, 0.5]} p={[0, 1.75, 0.5]} m={M.mane} r={[0.5, 0, 0]} />
            <group ref={legs}>
              {[[-0.18, 0.4], [0.18, -0.4], [-0.18, -0.4], [0.18, 0.4]].map(([x, z], i) => (
                <group key={i} position={[x, 0.85, z]}><Cyl r={0.07} h={0.85} p={[0, -0.42, 0]} m={M.horse} /></group>
              ))}
            </group>
          </group>
          <Box s={[1.3, 0.5, 1.8]} p={[0, 0.8, -0.6]} m={M.wood} />
          <Box s={[0.06, 0.06, 1.4]} p={[0.3, 0.75, 0.9]} m={M.darkWood} />
          <Box s={[0.06, 0.06, 1.4]} p={[-0.3, 0.75, 0.9]} m={M.darkWood} />
          {[[-0.3, -0.4], [0.25, -0.9], [0.1, -0.2]].map(([x, z], i) => (
            <mesh key={i} position={[x, 1.2, z]} material={M.sack}><sphereGeometry args={[0.32, 6, 5]} /></mesh>
          ))}
          <Wheel p={[0.72, 0.45, -0.6]} r={0.45} />
          <Wheel p={[-0.72, 0.45, -0.6]} r={0.45} />
        </group>
      );
    case 2:
      return (
        <group>
          <Blob w={1.9} l={3.6} />
          <Box s={[1.5, 1.4, 2.4]} p={[0, 1.05, -0.3]} m={M.white} />
          <Box s={[1.5, 0.9, 0.9]} p={[0, 0.8, 1.35]} m={M.white} />
          <Box s={[1.45, 0.5, 0.06]} p={[0, 1.2, 1.15]} m={M.glass} r={[-0.4, 0, 0]} />
          <Box s={[1.52, 0.22, 2.4]} p={[0, 0.85, -0.3]} m={accent} />
          {[[0.7, 1.1], [-0.7, 1.1], [0.7, -0.9], [-0.7, -0.9]].map(([x, z], i) => <Wheel key={i} p={[x, 0.35, z]} r={0.33} />)}
        </group>
      );
    case 3:
      return (
        <group>
          <Blob w={2.1} l={5.6} />
          <Box s={[1.7, 1.6, 1.4]} p={[0, 1.15, 1.9]} m={accent} />
          <Box s={[1.6, 0.6, 0.06]} p={[0, 1.5, 2.62]} m={M.glass} />
          <Box s={[1.9, 2.1, 3.8]} p={[0, 1.55, -0.8]} m={M.white} />
          {[[0.8, 1.9], [-0.8, 1.9], [0.85, -1.5], [-0.85, -1.5], [0.85, -0.6], [-0.85, -0.6]].map(([x, z], i) => <Wheel key={i} p={[x, 0.4, z]} />)}
        </group>
      );
    case 4:
      return (
        <group>
          <Blob w={2.3} l={9.6} />
          <Box s={[1.9, 2.1, 1.9]} p={[0, 1.5, 3.4]} m={accent} />
          <Box s={[1.9, 0.9, 1.1]} p={[0, 0.9, 4.75]} m={accent} />
          <Box s={[1.8, 0.7, 0.06]} p={[0, 2, 4.36]} m={M.glass} />
          <Cyl r={0.12} h={1.6} p={[0.85, 2.6, 2.6]} m={M.steel} />
          <Box s={[2.1, 2.4, 6.8]} p={[0, 1.95, -1.4]} m={M.white} />
          {[[0.85, 4.5], [-0.85, 4.5], [0.9, 2.6], [-0.9, 2.6], [0.95, -3.6], [-0.95, -3.6], [0.95, -4.5], [-0.95, -4.5]].map(([x, z], i) => <Wheel key={i} p={[x, 0.42, z]} r={0.42} />)}
        </group>
      );
    default:
      return (
        <group>
          <Blob w={2.3} l={15} />
          <Box s={[2, 2.4, 2.1]} p={[0, 1.65, 6.3]} m={accent} />
          <Box s={[2, 1, 1.2]} p={[0, 0.95, 7.8]} m={accent} />
          <Box s={[1.9, 0.8, 0.06]} p={[0, 2.25, 7.36]} m={M.glass} />
          <Cyl r={0.12} h={1.8} p={[0.9, 2.9, 5.4]} m={M.steel} />
          <Cyl r={0.12} h={1.8} p={[-0.9, 2.9, 5.4]} m={M.steel} />
          <Box s={[2.1, 2.4, 5.6]} p={[0, 1.95, 2.0]} m={M.white} />
          <Box s={[2.1, 2.4, 5.6]} p={[0, 1.95, -4.2]} m={M.white} />
          <Box s={[2.12, 0.3, 5.6]} p={[0, 2.6, 2.0]} m={accent} />
          <Box s={[2.12, 0.3, 5.6]} p={[0, 2.6, -4.2]} m={accent} />
          {[7.6, 5.6, 3.6, 0.4, -2.6, -5.8].flatMap((z) => [0.95, -0.95].map((x) => <Wheel key={`${x}${z}`} p={[x, 0.42, z]} r={0.42} />))}
        </group>
      );
  }
}

/* ───────────── Rail ───────────── */

export const TRAIN_SPEC = [
  { cars: 2, carLen: 2.8, locoLen: 3.6, hover: 0 },
  { cars: 4, carLen: 3.2, locoLen: 4.4, hover: 0 },
  { cars: 6, carLen: 3.8, locoLen: 5.2, hover: 0 },
  { cars: 8, carLen: 4.6, locoLen: 5.4, hover: 0 },
  { cars: 6, carLen: 5.2, locoLen: 6.2, hover: 0.45 },
];

export function Locomotive({ level, accent }: { level: number; accent: THREE.Material }) {
  if (level <= 2) {
    const s = level === 1 ? 1 : 1.2;
    return (
      <group scale={s}>
        <Cyl r={0.62} h={2.4} p={[0, 1.25, 0.4]} m={M.black} rot={[Math.PI / 2, 0, 0]} />
        <Box s={[1.4, 1.5, 1.2]} p={[0, 1.35, -1.1]} m={M.darkWood} />
        <Box s={[1.5, 0.12, 1.4]} p={[0, 2.15, -1.1]} m={M.black} />
        <Cyl r={[0.28, 0.18]} h={0.9} p={[0, 2.25, 1.2]} m={M.black} />
        <Cyl r={0.2} h={0.4} p={[0, 1.95, 0.3]} m={accent} />
        <Box s={[1.4, 0.3, 3.4]} p={[0, 0.45, 0]} m={M.red} />
        {[1.1, 0.1, -0.9].map((z) => [0.62, -0.62].map((x) => <Wheel key={`${x}${z}`} p={[x, 0.42, z]} r={0.42} />))}
      </group>
    );
  }
  if (level === 5) {
    return (
      <group>
        <mesh position={[0, 1.2, 0]} rotation={[Math.PI / 2, 0, 0]} material={M.white}><capsuleGeometry args={[1, 4.2, 4, 10]} /></mesh>
        <mesh position={[0, 1.2, 3.2]} rotation={[Math.PI / 2, 0, 0]} material={M.white}><coneGeometry args={[1, 1.6, 10]} /></mesh>
        <Box s={[2.04, 0.25, 5.6]} p={[0, 1.0, 0]} m={accent} />
        <Box s={[1.4, 0.45, 0.6]} p={[0, 1.65, 2.6]} m={M.glass} r={[-0.5, 0, 0]} />
      </group>
    );
  }
  const body = level === 4 ? M.blue : accent;
  return (
    <group>
      <Box s={[1.8, 2.1, 5]} p={[0, 1.55, 0]} m={body} />
      <Box s={[1.82, 0.8, 0.06]} p={[0, 2.1, 2.52]} m={M.glass} />
      <Box s={[1.82, 0.8, 0.06]} p={[0, 2.1, -2.52]} m={M.glass} />
      <Box s={[1.84, 0.25, 5.02]} p={[0, 0.85, 0]} m={M.yellow} />
      <Box s={[1.2, 0.4, 2]} p={[0, 2.8, 0]} m={M.steel} />
      {[1.6, -1.6].map((z) => [0.7, -0.7].map((x) => <Wheel key={`${x}${z}`} p={[x, 0.4, z]} r={0.4} />))}
    </group>
  );
}

const CAR_COLORS = [mat('#7a3b2a'), mat('#5b6e4e'), mat('#3f5874'), mat('#8b6a3a')];

export function RailCar({ level, accent, index }: { level: number; accent: THREE.Material; index: number }) {
  const colors = CAR_COLORS;
  if (level === 1) {
    return (
      <group>
        <Box s={[1.4, 0.7, 2.4]} p={[0, 0.9, 0]} m={M.wood} />
        {index % 2 === 0
          ? <mesh position={[0, 1.4, 0]} material={M.sack}><sphereGeometry args={[0.5, 6, 5]} /></mesh>
          : <Box s={[1, 0.5, 1.6]} p={[0, 1.4, 0]} m={M.darkWood} />}
        {[0.8, -0.8].map((z) => [0.6, -0.6].map((x) => <Wheel key={`${x}${z}`} p={[x, 0.36, z]} r={0.32} />))}
      </group>
    );
  }
  if (level === 5) {
    return (
      <group>
        <mesh position={[0, 1.2, 0]} rotation={[Math.PI / 2, 0, 0]} material={M.white}><capsuleGeometry args={[1, 3.4, 4, 10]} /></mesh>
        <Box s={[2.04, 0.25, 4.6]} p={[0, 1.0, 0]} m={accent} />
      </group>
    );
  }
  if (level === 4) {
    return (
      <group>
        <Box s={[1.8, 0.35, 4.3]} p={[0, 0.75, 0]} m={M.steel} />
        <Containers rows={1} bays={1} tiers={index % 3 === 0 ? 2 : 1} origin={[0, 0.95, 0]} size={[1.7, 1.4, 4]} seed={index + 3} />
        {[1.5, -1.5].map((z) => [0.7, -0.7].map((x) => <Wheel key={`${x}${z}`} p={[x, 0.36, z]} r={0.34} />))}
      </group>
    );
  }
  const len = level === 2 ? 2.9 : 3.5;
  return (
    <group>
      <Box s={[1.6, 1.7, len]} p={[0, 1.4, 0]} m={colors[index % colors.length]} />
      <Box s={[1.65, 0.12, len + 0.05]} p={[0, 2.28, 0]} m={M.steel} />
      {[len / 2 - 0.5, -len / 2 + 0.5].map((z) => [0.65, -0.65].map((x) => <Wheel key={`${x}${z}`} p={[x, 0.36, z]} r={0.34} />))}
    </group>
  );
}

/* ───────────── Air ───────────── */

export function Aircraft({ level, accent }: { level: number; accent: THREE.Material }) {
  const props = useRef<THREE.Group>(null);
  useFrame((_, dt) => { props.current?.children.forEach((p) => { p.rotation.z += dt * 30; }); });
  switch (level) {
    case 1:
      return (
        <group>
          <mesh position={[0, 3.2, 0]} scale={[1, 1.22, 1]} material={accent}><sphereGeometry args={[2.2, 14, 12]} /></mesh>
          {[0.6, 0, -0.6].map((y) => (
            <mesh key={y} position={[0, 3.2 + y * 2, 0]} rotation={[Math.PI / 2, 0, 0]} material={M.cream}>
              <torusGeometry args={[Math.sqrt(Math.max(0.1, 2.2 ** 2 - (y * 2 / 1.22) ** 2)) + 0.01, 0.08, 6, 24]} />
            </mesh>
          ))}
          <Cyl r={[0.6, 1.1]} h={0.8} p={[0, 0.85, 0]} m={accent} />
          <Box s={[0.9, 0.7, 0.9]} p={[0, -0.2, 0]} m={M.wood} />
          {[[0.4, 0.4], [-0.4, 0.4], [0.4, -0.4], [-0.4, -0.4]].map(([x, z], i) => <Cyl key={i} r={0.02} h={1.1} p={[x, 0.55, z]} m={M.rope} />)}
        </group>
      );
    case 2:
      return (
        <group>
          <Box s={[0.8, 0.8, 4]} p={[0, 0, 0]} m={accent} />
          <Box s={[6.4, 0.08, 1.1]} p={[0, 0.55, 0.5]} m={M.cream} />
          <Box s={[6.4, 0.08, 1.1]} p={[0, -0.45, 0.5]} m={M.cream} />
          {[2.4, -2.4].map((x) => <Cyl key={x} r={0.04} h={1} p={[x, 0.05, 0.5]} m={M.darkWood} />)}
          <Box s={[2.2, 0.06, 0.8]} p={[0, 0.1, -1.8]} m={M.cream} />
          <Box s={[0.06, 0.9, 0.8]} p={[0, 0.5, -1.8]} m={accent} />
          <group ref={props} position={[0, 0, 2.05]}><Box s={[0.12, 1.8, 0.05]} p={[0, 0, 0]} m={M.darkWood} /></group>
          <Box s={[0.5, 0.25, 0.6]} p={[0, 0.5, 0]} m={M.glass} />
        </group>
      );
    case 3:
      return (
        <group>
          <Cyl r={0.9} h={7} p={[0, 0, 0]} m={M.white} rot={[Math.PI / 2, 0, 0]} />
          <mesh position={[0, 0, 3.9]} rotation={[Math.PI / 2, 0, 0]} material={M.white}><coneGeometry args={[0.9, 1, 12]} /></mesh>
          <Box s={[11, 0.2, 1.6]} p={[0, 0.75, 0.6]} m={M.white} />
          <Box s={[3.6, 0.12, 1]} p={[0, 0.3, -3.3]} m={M.white} />
          <Box s={[0.12, 2, 1.4]} p={[0, 1.3, -3.3]} m={accent} />
          <Box s={[1.82, 0.3, 7]} p={[0, -0.1, 0]} m={accent} />
          <group ref={props}>
            {[2.6, -2.6].map((x) => (
              <group key={x} position={[x, 0.5, 1.9]}><Box s={[0.12, 2.2, 0.05]} p={[0, 0, 0]} m={M.black} /></group>
            ))}
          </group>
          {[2.6, -2.6].map((x) => <Cyl key={x} r={0.38} h={2} p={[x, 0.5, 0.8]} m={M.steel} rot={[Math.PI / 2, 0, 0]} />)}
        </group>
      );
    case 4:
      return (
        <group>
          <Cyl r={1} h={10} p={[0, 0, 0]} m={M.white} rot={[Math.PI / 2, 0, 0]} />
          <mesh position={[0, 0, 5.6]} rotation={[Math.PI / 2, 0, 0]} material={M.white}><coneGeometry args={[1, 1.4, 14]} /></mesh>
          <mesh position={[0, 0.2, -5.6]} rotation={[-Math.PI / 2, 0, 0]} material={M.white}><coneGeometry args={[1, 1.6, 14]} /></mesh>
          {[1, -1].map((s) => <Box key={s} s={[6.4, 0.18, 1.8]} p={[s * 3.6, -0.3, 0]} m={M.white} r={[0, s * 0.42, 0]} />)}
          {[2.6, -2.6].map((x) => <Cyl key={x} r={0.45} h={1.8} p={[x, -0.95, 1]} m={M.steel} rot={[Math.PI / 2, 0, 0]} />)}
          <Box s={[0.15, 2.4, 1.8]} p={[0, 1.5, -4.6]} m={accent} r={[0.35, 0, 0]} />
          {[1, -1].map((s) => <Box key={s} s={[2.4, 0.12, 1]} p={[s * 1.3, 0.3, -4.8]} m={M.white} r={[0, s * 0.4, 0]} />)}
          <Box s={[2.02, 0.3, 8]} p={[0, -0.2, 0]} m={accent} />
        </group>
      );
    default:
      return (
        <group>
          <Cyl r={1.4} h={15} p={[0, 0, 0]} m={M.white} rot={[Math.PI / 2, 0, 0]} />
          <mesh position={[0, 0, 8.3]} rotation={[Math.PI / 2, 0, 0]} material={M.white}><coneGeometry args={[1.4, 1.8, 16]} /></mesh>
          <mesh position={[0, 0.3, -8.4]} rotation={[-Math.PI / 2, 0, 0]} material={M.white}><coneGeometry args={[1.4, 2.2, 16]} /></mesh>
          <mesh position={[0, 1.2, 4.8]} rotation={[Math.PI / 2, 0, 0]} scale={[0.8, 1, 0.6]} material={M.white}><capsuleGeometry args={[1, 3.2, 4, 10]} /></mesh>
          {[1, -1].map((s) => <Box key={s} s={[10, 0.22, 2.6]} p={[s * 5.6, -0.5, -0.4]} m={M.white} r={[0, s * 0.45, 0]} />)}
          {[2.8, 5.8, -2.8, -5.8].map((x) => <Cyl key={x} r={0.55} h={2.2} p={[x, -1.3, Math.abs(x) > 4 ? -0.8 : 1.4]} m={M.steel} rot={[Math.PI / 2, 0, 0]} />)}
          <Box s={[0.2, 3.6, 2.6]} p={[0, 2.2, -6.8]} m={accent} r={[0.35, 0, 0]} />
          {[1, -1].map((s) => <Box key={s} s={[3.6, 0.14, 1.4]} p={[s * 1.9, 0.4, -7.2]} m={M.white} r={[0, s * 0.4, 0]} />)}
          <Box s={[2.82, 0.4, 13]} p={[0, -0.4, 0]} m={accent} />
        </group>
      );
  }
}
