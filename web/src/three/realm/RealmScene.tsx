import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import gsap from 'gsap';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { RealmData, RealmMode, RealmVehicle, TransportMode } from '../../lib/types';
import { AIR, BALLOON_RING, GROUND, KEEP, QUAY_X, RAIL, ROAD, RUNWAY, SEA, along, isFree, ribbon, seeded } from './layout';
import { Aircraft, Locomotive, M, RailCar, RoadVehicle, Ship, TRAIN_SPEC, useAccent } from './vehicles';

export type Lighting = 'live' | 'day' | 'dusk' | 'night';
export type CameraRequest = { kind: 'preset'; name: Preset; nonce: number } | { kind: 'vehicle'; id: number; nonce: number };
export type Preset = 'overview' | 'harbour' | 'town' | 'railway' | 'airfield';

const PRESETS: Record<Preset, { pos: [number, number, number]; target: [number, number, number] }> = {
  overview: { pos: [92, 96, 128], target: [10, 0, 2] },
  harbour: { pos: [4, 52, 78], target: [-46, 0, 2] },
  town: { pos: [44, 34, 50], target: [12, 0, 0] },
  railway: { pos: [70, 30, -104], target: [32, 0, -52] },
  airfield: { pos: [36, 46, 66], target: [RUNWAY.x + 4, 2, 0] },
};

interface SceneProps {
  data: RealmData;
  accent: string;
  lighting: Lighting;
  paused: boolean;
  selected: number | null;
  onSelect: (v: { vehicle: RealmVehicle; mode: TransportMode } | null) => void;
  camera: CameraRequest | null;
}

type Registry = MutableRefObject<Map<number, THREE.Object3D>>;

/* ───────────── Day and night ───────────── */

const DAY = { sky: '#a7bcc2', hemi: '#e3ece6', hemiGround: '#55634c', sun: '#fff0d4', sunI: 2.4, hemiI: 1.0, grass: '#5d7849', water: '#3e6c80' };
// Moonlit rather than black, so the map stays readable at night.
const NIGHT = { sky: '#1b2643', hemi: '#8798cc', hemiGround: '#2a3142', sun: '#c2d0ff', sunI: 1.15, hemiI: 1.05, grass: '#37492d', water: '#1f3d57' };
const DUSK = { sky: '#8a7486', hemi: '#e8c9b8', hemiGround: '#3d3d40', sun: '#ffb07a', sunI: 1.5, hemiI: 0.75, grass: '#4b5c3c', water: '#36506a' };

function daylight(l: Lighting, now = new Date()) {
  if (l === 'day') return { day: 1, dusk: 0 };
  if (l === 'night') return { day: 0, dusk: 0 };
  if (l === 'dusk') return { day: 0.5, dusk: 1 };
  const h = now.getHours() + now.getMinutes() / 60;
  const day = THREE.MathUtils.clamp((Math.sin(((h - 6) / 12) * Math.PI) + 0.12) / 0.6, 0, 1);
  const dusk = Math.max(0, 1 - Math.abs(h - 19) / 1.6, 1 - Math.abs(h - 6.5) / 1.4);
  return { day, dusk: THREE.MathUtils.clamp(dusk, 0, 1) };
}

function mix(a: string, b: string, t: number) { return new THREE.Color(a).lerp(new THREE.Color(b), t); }

function useLight(l: Lighting) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(id); }, []);
  return useMemo(() => {
    const { day, dusk } = daylight(l);
    const base = (k: keyof typeof DAY) => {
      const c = mix(NIGHT[k] as string, DAY[k] as string, day);
      return dusk > 0 ? c.lerp(new THREE.Color(DUSK[k] as string), dusk * 0.6) : c;
    };
    return {
      day, sky: base('sky'), hemi: base('hemi'), hemiGround: base('hemiGround'), sun: base('sun'), grass: base('grass'), water: base('water'),
      sunI: THREE.MathUtils.lerp(NIGHT.sunI, DAY.sunI, day), hemiI: THREE.MathUtils.lerp(NIGHT.hemiI, DAY.hemiI, day),
      windows: THREE.MathUtils.clamp(1 - day * 1.4, 0, 1),
    };
  }, [l, tick]);
}

type Light = ReturnType<typeof useLight>;

/* ───────────── Terrain ───────────── */

function Water({ color, paused }: { color: THREE.Color; paused: boolean }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(320, 460, 90, 130);
    g.rotateX(-Math.PI / 2);
    g.translate(QUAY_X - 160, -0.6, 0);
    return g;
  }, []);
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array as Float32Array), [geo]);
  useFrame(({ clock }) => {
    if (paused) return;
    const p = geo.attributes.position as THREE.BufferAttribute;
    const t = clock.elapsedTime;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3], z = base[i * 3 + 2];
      p.setY(i, -0.6 + Math.sin(x * 0.12 + t * 0.9) * 0.18 + Math.cos(z * 0.09 + t * 0.7) * 0.15);
    }
    p.needsUpdate = true;
  });
  return <mesh geometry={geo} receiveShadow><meshStandardMaterial color={color} flatShading roughness={0.35} metalness={0.1} /></mesh>;
}

function Ground({ light }: { light: Light }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(GROUND.x0 + GROUND.x1) / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[GROUND.x1 - GROUND.x0, GROUND.z1 - GROUND.z0]} />
        <meshStandardMaterial color={light.grass} roughness={1} />
      </mesh>
      {/* Earth skirt so the island has depth from low angles */}
      <mesh position={[(GROUND.x0 + GROUND.x1) / 2, -2.1, 0]}>
        <boxGeometry args={[GROUND.x1 - GROUND.x0, 4, GROUND.z1 - GROUND.z0]} />
        <meshStandardMaterial color="#4a3f33" flatShading />
      </mesh>
      <mesh position={[QUAY_X + 0.6, 0.35, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 1.6, GROUND.z1 - GROUND.z0]} />
        <meshStandardMaterial color="#8a877d" flatShading />
      </mesh>
    </group>
  );
}

function Roads({ roadLevel, light }: { roadLevel: number; light: Light }) {
  const road = useMemo(() => ribbon(ROAD, roadLevel >= 3 ? 3.4 : 2.8, 400, 0.02), [roadLevel]);
  const dashes = useMemo(() => (roadLevel >= 3 ? along(ROAD, 3.2) : []), [roadLevel]);
  const lamps = useMemo(() => along(ROAD, 16), []);
  const color = roadLevel <= 1 ? '#8b7656' : roadLevel === 2 ? '#8f8a80' : '#3d4146';
  return (
    <group>
      <mesh geometry={road} receiveShadow><meshStandardMaterial color={color} roughness={1} /></mesh>
      {dashes.map(({ p, t }, i) => i % 2 === 0 && (
        <mesh key={i} position={[p.x, 0.1, p.z]} rotation={[0, Math.atan2(t.x, t.z), 0]}><boxGeometry args={[0.16, 0.02, 1.2]} /><meshBasicMaterial color="#e9e2c8" /></mesh>
      ))}
      {lamps.map(({ p, t }, i) => {
        const side = new THREE.Vector3(t.z, 0, -t.x).multiplyScalar(2.6);
        return (
          <group key={i} position={[p.x + side.x, 0, p.z + side.z]}>
            <mesh position={[0, 1.4, 0]} material={M.black}><cylinderGeometry args={[0.07, 0.09, 2.8, 6]} /></mesh>
            <mesh position={[0, 2.95, 0]}><boxGeometry args={[0.38, 0.45, 0.38]} />
              <meshStandardMaterial color="#ffd38a" emissive="#ffb84d" emissiveIntensity={0.2 + light.windows * 2.4} /></mesh>
          </group>
        );
      })}
    </group>
  );
}

function Railway({ level }: { level: number }) {
  const ties = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => along(RAIL, 1.3), []);
  const rails = useMemo(() => {
    const up = new THREE.Vector3(0, 1, 0);
    const mk = (off: number) => {
      const pts = RAIL.getSpacedPoints(500).map((p, i, arr) => {
        const t = arr[(i + 1) % arr.length].clone().sub(p).normalize();
        const side = new THREE.Vector3().crossVectors(up, t).normalize().multiplyScalar(off);
        return p.clone().add(side).setY(0.32);
      });
      return ribbon(new THREE.CatmullRomCurve3(pts, true), 0.14, 500);
    };
    return [mk(0.72), mk(-0.72)];
  }, []);
  useLayoutEffect(() => {
    const m = new THREE.Object3D();
    spots.forEach(({ p, t }, i) => {
      m.position.set(p.x, 0.14, p.z);
      m.rotation.set(0, Math.atan2(t.x, t.z) + Math.PI / 2, 0);
      m.updateMatrix();
      ties.current!.setMatrixAt(i, m.matrix);
    });
    ties.current!.instanceMatrix.needsUpdate = true;
  }, [spots]);
  return (
    <group>
      <mesh geometry={ribbon(RAIL, 3.2, 500, 0.03)} receiveShadow><meshStandardMaterial color="#6f675c" roughness={1} /></mesh>
      <instancedMesh ref={ties} args={[undefined, undefined, spots.length]} receiveShadow>
        <boxGeometry args={[2.3, 0.18, 0.42]} />
        <meshStandardMaterial color={level >= 3 ? '#7b7b78' : '#5a4330'} flatShading />
      </instancedMesh>
      {rails.map((g, i) => <mesh key={i} geometry={g}><meshStandardMaterial color="#b8bcc2" metalness={0.6} roughness={0.4} /></mesh>)}
      {/* Station */}
      <group position={[34, 0, -62.5]}>
        <mesh position={[0, 0.5, 0]} castShadow receiveShadow><boxGeometry args={[22, 1, 3]} /><meshStandardMaterial color="#9c968a" flatShading /></mesh>
        <mesh position={[0, 3.6, 0.6]} castShadow><boxGeometry args={[18, 0.3, 4]} /><meshStandardMaterial color="#6e3b33" flatShading /></mesh>
        {[-8, -3, 2, 7].map((x) => <mesh key={x} position={[x, 2.2, 1.4]}><cylinderGeometry args={[0.12, 0.12, 3, 6]} /><meshStandardMaterial color="#3a3a3a" /></mesh>)}
      </group>
    </group>
  );
}

function Airfield({ level, accent }: { level: number; accent: THREE.Material }) {
  const len = RUNWAY.z1 - RUNWAY.z0 + 12;
  return (
    <group>
      <mesh position={[RUNWAY.x, 0.04, 0]} receiveShadow>
        <boxGeometry args={[RUNWAY.width + (level >= 3 ? 2 : 0), 0.08, len]} />
        <meshStandardMaterial color={level <= 1 ? '#7d8a5c' : level === 2 ? '#8b8270' : '#3a3d42'} roughness={1} />
      </mesh>
      {level >= 2 && Array.from({ length: 10 }, (_, i) => (
        <mesh key={i} position={[RUNWAY.x, 0.1, RUNWAY.z0 - 4 + i * 6.2]}><boxGeometry args={[0.4, 0.02, 2.6]} /><meshBasicMaterial color="#efe8d0" /></mesh>
      ))}
      {Array.from({ length: Math.min(level, 3) }, (_, i) => i).map((i) => (
        <group key={i} position={[RUNWAY.x + 13, 0, -14 + i * 13]}>
          <mesh position={[0, 2.4, 0]} castShadow receiveShadow><boxGeometry args={[9, 4.8, 10]} /><meshStandardMaterial color="#8f8b82" flatShading /></mesh>
          <mesh position={[0, 4.9, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[5, 5, 10, 12, 1, false, 0, Math.PI]} /><meshStandardMaterial color="#5d6b78" flatShading side={THREE.DoubleSide} /></mesh>
        </group>
      ))}
      <group position={[RUNWAY.x - 9, 0, 18]}>
        <mesh position={[0, 4, 0]} castShadow><cylinderGeometry args={[0.9, 1.2, 8, 8]} /><meshStandardMaterial color="#a39d90" flatShading /></mesh>
        <mesh position={[0, 8.6, 0]}><cylinderGeometry args={[1.8, 1.4, 1.4, 8]} /><meshStandardMaterial color="#1d2a38" roughness={0.3} /></mesh>
        <mesh position={[0, 9.6, 0]} material={accent}><coneGeometry args={[2, 0.8, 8]} /></mesh>
      </group>
    </group>
  );
}

function Harbour({ berths, level, light }: { berths: number; level: number; light: Light }) {
  const zs = Array.from({ length: berths }, (_, i) => (i - (berths - 1) / 2) * 11);
  const pierColor = level <= 2 ? '#6d5038' : level === 3 ? '#8c8578' : '#9fa1a0';
  return (
    <group>
      {zs.map((z) => (
        <group key={z} position={[QUAY_X - 8, 0, z]}>
          <mesh position={[0, 0.25, 0]} castShadow receiveShadow><boxGeometry args={[16, 0.5, 2.6]} /><meshStandardMaterial color={pierColor} flatShading /></mesh>
          {[-6, -2, 2, 6].map((x) => <mesh key={x} position={[x, 0.75, 1.15]} material={M.black}><cylinderGeometry args={[0.16, 0.2, 0.5, 6]} /></mesh>)}
          {level >= 4 && (
            <group position={[2, 0, 0]}>
              {[-1.9, 1.9].map((zz) => <mesh key={zz} position={[0, 4, zz]} castShadow><boxGeometry args={[0.5, 8, 0.5]} /><meshStandardMaterial color="#d3a033" flatShading /></mesh>)}
              <mesh position={[-3, 8.2, 0]} castShadow><boxGeometry args={[14, 0.7, 4.3]} /><meshStandardMaterial color="#d3a033" flatShading /></mesh>
              <mesh position={[-6.5, 7.4, 0]}><boxGeometry args={[1.4, 1, 1.4]} /><meshStandardMaterial color="#3b3b3b" /></mesh>
            </group>
          )}
          {level <= 2 && (
            <mesh position={[5.5, 1.1, -0.8]}><boxGeometry args={[0.35, 0.5, 0.35]} />
              <meshStandardMaterial color="#ffd38a" emissive="#ffae42" emissiveIntensity={light.windows * 2.5} /></mesh>
          )}
        </group>
      ))}
    </group>
  );
}

function Warehouses({ count, light }: { count: number; light: Light }) {
  return (
    <group>
      {Array.from({ length: count }, (_, i) => {
        const z = (i - (count - 1) / 2) * 9.5;
        return (
          <group key={i} position={[-20, 0, z]}>
            <mesh position={[0, 2.2, 0]} castShadow receiveShadow><boxGeometry args={[10, 4.4, 7.4]} /><meshStandardMaterial color="#8e8270" flatShading /></mesh>
            <mesh position={[0, 4.4, 0]} rotation={[0, 0, Math.PI / 4]} scale={[1, 1, 7.6 / 5.4]} castShadow>
              <boxGeometry args={[5.4, 5.4, 5.4]} /><meshStandardMaterial color="#5b3a30" flatShading /></mesh>
            <mesh position={[-5.05, 1.6, 0]}><boxGeometry args={[0.1, 3, 3]} /><meshStandardMaterial color="#3d332b" emissive="#ffb85a" emissiveIntensity={light.windows * 0.7} /></mesh>
          </group>
        );
      })}
    </group>
  );
}

function Keep({ accent, light }: { accent: THREE.Material; light: Light }) {
  const stone = useMemo(() => new THREE.MeshStandardMaterial({ color: '#9a978c', flatShading: true }), []);
  const roof = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3d4a5a', flatShading: true }), []);
  const win = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2622', emissive: '#ffb04d', emissiveIntensity: 0 }), []);
  win.emissiveIntensity = light.windows * 2.2;
  const flag = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { flag.current?.children.forEach((f, i) => { f.rotation.y = Math.sin(clock.elapsedTime * 2 + i) * 0.25; }); });
  const corners: [number, number][] = [[-8, -8], [8, -8], [-8, 8], [8, 8]];
  return (
    <group position={KEEP}>
      <mesh position={[0, 0.7, 0]} receiveShadow><cylinderGeometry args={[14, 15.5, 1.4, 24]} /><meshStandardMaterial color="#6c7a58" flatShading /></mesh>
      {[[0, -8, 16, 0], [0, 8, 16, 0], [-8, 0, 16, Math.PI / 2], [8, 0, 16, Math.PI / 2]].map(([x, z, w, r], i) => (
        <group key={i} position={[x, 1.4, z]} rotation={[0, r, 0]}>
          <mesh position={[0, 2, 0]} material={stone} castShadow receiveShadow><boxGeometry args={[w, 4, 1.4]} /></mesh>
          {Array.from({ length: 7 }, (_, k) => <mesh key={k} position={[-6.6 + k * 2.2, 4.35, 0]} material={stone} castShadow><boxGeometry args={[1, 0.7, 1.4]} /></mesh>)}
        </group>
      ))}
      {corners.map(([x, z], i) => (
        <group key={i} position={[x, 1.4, z]}>
          <mesh position={[0, 3.6, 0]} material={stone} castShadow><cylinderGeometry args={[1.8, 2, 7.2, 10]} /></mesh>
          <mesh position={[0, 8.6, 0]} material={roof} castShadow><coneGeometry args={[2.3, 3.4, 10]} /></mesh>
          <mesh position={[0, 4.8, 1.85]} material={win}><boxGeometry args={[0.5, 0.9, 0.2]} /></mesh>
        </group>
      ))}
      <group position={[0, 1.4, 0]}>
        <mesh position={[0, 6, 0]} material={stone} castShadow><boxGeometry args={[7, 12, 7]} /></mesh>
        <mesh position={[0, 14.2, 0]} material={roof} castShadow><coneGeometry args={[5.4, 5, 4]} /></mesh>
        <mesh position={[3.4, 15, 3.4]} material={stone} castShadow><cylinderGeometry args={[1, 1.1, 6, 8]} /></mesh>
        <mesh position={[3.4, 19.4, 3.4]} material={roof}><coneGeometry args={[1.4, 3, 8]} /></mesh>
        {[[0, 8, 3.55], [0, 4, 3.55], [3.55, 8, 0], [-3.55, 6, 0]].map(([x, y, z], i) => (
          <mesh key={i} position={[x, y, z]} material={win}><boxGeometry args={[x ? 0.2 : 0.8, 1.4, z ? 0.2 : 0.8]} /></mesh>
        ))}
        <group ref={flag}>
          {[[0, 16.7, 0], [3.4, 20.9, 3.4]].map(([x, y, z], i) => (
            <group key={i} position={[x, y, z]}>
              <mesh position={[0, 1.2, 0]} material={M.black}><cylinderGeometry args={[0.06, 0.06, 2.4, 5]} /></mesh>
              <mesh position={[0.8, 1.9, 0]} material={accent}><boxGeometry args={[1.6, 0.9, 0.05]} /></mesh>
            </group>
          ))}
        </group>
      </group>
    </group>
  );
}

function Houses({ count, light }: { count: number; light: Light }) {
  const houses = useMemo(() => {
    const r = seeded(77);
    const out: { x: number; z: number; rot: number; w: number; d: number; h: number; c: string }[] = [];
    const walls = ['#cdbf9f', '#b9a888', '#d8cfb8', '#a99a80', '#c4b494'];
    let tries = 0;
    while (out.length < count && tries++ < 4000) {
      const a = r() * Math.PI * 2, rad = 17 + r() * 13;
      const x = KEEP.x + Math.cos(a) * rad, z = KEEP.z + Math.sin(a) * rad;
      if (!isFree(x, z, 1)) continue;
      if (out.some((h) => Math.hypot(h.x - x, h.z - z) < 5.2)) continue;
      out.push({ x, z, rot: -a, w: 3 + r() * 1.6, d: 3.4 + r() * 1.5, h: 2.4 + r() * 1.4, c: walls[Math.floor(r() * walls.length)] });
    }
    return out;
  }, [count]);
  const roof = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7a3e2f', flatShading: true }), []);
  const win = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2622', emissive: '#ffb04d', emissiveIntensity: 0 }), []);
  win.emissiveIntensity = light.windows * 2;
  return (
    <group>
      {houses.map((h, i) => (
        <group key={i} position={[h.x, 0, h.z]} rotation={[0, h.rot, 0]}>
          <mesh position={[0, h.h / 2, 0]} castShadow receiveShadow><boxGeometry args={[h.w, h.h, h.d]} /><meshStandardMaterial color={h.c} flatShading /></mesh>
          <mesh position={[0, h.h + 1, 0]} rotation={[0, Math.PI / 4, 0]} scale={[h.w / 2.8, 1, h.d / 2.8]} material={roof} castShadow>
            <coneGeometry args={[2.1, 2, 4]} /></mesh>
          <mesh position={[h.w / 2 + 0.01, h.h * 0.55, 0]} material={win}><boxGeometry args={[0.05, 0.7, 0.6]} /></mesh>
        </group>
      ))}
    </group>
  );
}

function Forest() {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const crowns = useRef<THREE.InstancedMesh>(null);
  const trees = useMemo(() => {
    const r = seeded(3);
    const out: { x: number; z: number; s: number }[] = [];
    let tries = 0;
    while (out.length < 170 && tries++ < 6000) {
      const x = GROUND.x0 + r() * (GROUND.x1 - GROUND.x0), z = GROUND.z0 + r() * (GROUND.z1 - GROUND.z0);
      if (!isFree(x, z, 1.5) || Math.hypot(x - KEEP.x, z - KEEP.z) < 32) continue;
      out.push({ x, z, s: 0.8 + r() * 0.9 });
    }
    return out;
  }, []);
  useLayoutEffect(() => {
    const m = new THREE.Object3D();
    const c = new THREE.Color();
    trees.forEach((t, i) => {
      m.position.set(t.x, 0.8 * t.s, t.z); m.scale.setScalar(t.s); m.updateMatrix();
      trunks.current!.setMatrixAt(i, m.matrix);
      m.position.set(t.x, 3.4 * t.s, t.z); m.updateMatrix();
      crowns.current!.setMatrixAt(i, m.matrix);
      crowns.current!.setColorAt(i, c.set(i % 3 === 0 ? '#2f4a33' : i % 3 === 1 ? '#3a5638' : '#26402d'));
    });
    trunks.current!.instanceMatrix.needsUpdate = true;
    crowns.current!.instanceMatrix.needsUpdate = true;
    if (crowns.current!.instanceColor) crowns.current!.instanceColor.needsUpdate = true;
  }, [trees]);
  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, undefined, trees.length]} castShadow>
        <cylinderGeometry args={[0.18, 0.26, 1.6, 5]} /><meshStandardMaterial color="#4a3526" flatShading />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[undefined, undefined, trees.length]} castShadow>
        <coneGeometry args={[1.5, 4.6, 7]} /><meshStandardMaterial flatShading />
      </instancedMesh>
    </group>
  );
}

// Glowing blue meadows, after the flower field in the reference art.
function Meadows({ glow, paused }: { glow: number; paused: boolean }) {
  const geo = useMemo(() => {
    const r = seeded(11);
    const pos: number[] = [], col: number[] = [], ph: number[] = [];
    const patches: [number, number, number][] = [[-6, 52, 12], [56, 50, 10], [30, -44, 8], [-12, -54, 9], [84, -10, 6]];
    const palette = ['#2446d8', '#3d6cff', '#7aa0ff', '#d6e2ff'].map((c) => new THREE.Color(c));
    for (const [cx, cz, rad] of patches) {
      for (let i = 0; i < 700; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
        const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        if (!isFree(x, z)) continue;
        pos.push(x, 0.12 + r() * 0.2, z);
        const c = palette[Math.floor(Math.pow(r(), 1.8) * palette.length)];
        col.push(c.r, c.g, c.b);
        ph.push(r());
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(ph, 1));
    return g;
  }, []);
  const mat = useRef<THREE.ShaderMaterial>(null);
  const { gl } = useThree();
  useFrame((_, dt) => {
    if (!mat.current) return;
    if (!paused) mat.current.uniforms.uTime.value += dt;
    mat.current.uniforms.uGlow.value = glow;
  });
  return (
    <points geometry={geo}>
      <shaderMaterial ref={mat} transparent depthWrite={false}
        uniforms={{ uTime: { value: 0 }, uGlow: { value: glow }, uPx: { value: Math.min(2, gl.getPixelRatio()) } }}
        vertexShader={`uniform float uTime; uniform float uPx; attribute vec3 aColor; attribute float aPhase; varying vec3 vC; varying float vT;
          void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
            gl_PointSize = uPx * 90.0 / -mv.z; vC = aColor; vT = 0.75 + 0.25 * sin(uTime * 1.5 + aPhase * 30.0); }`}
        fragmentShader={`uniform float uGlow; varying vec3 vC; varying float vT;
          void main(){ vec2 uv = gl_PointCoord * 2.0 - 1.0; float r = length(uv); float a = atan(uv.y, uv.x);
            float petal = 0.5 + 0.5 * cos(5.0 * a); float s = smoothstep(0.42 + petal * 0.5, 0.3 + petal * 0.42, r);
            float core = smoothstep(0.25, 0.0, r); if (s < 0.05) discard;
            gl_FragColor = vec4(vC * (1.0 + uGlow * 1.4) * vT + vec3(1.0, 0.95, 0.8) * core * 0.6, s); }`} />
    </points>
  );
}

/* ───────────── Moving vehicles ───────────── */

interface MoverProps {
  vehicle: RealmVehicle;
  mode: TransportMode;
  selected: boolean;
  registry: Registry;
  onSelect: SceneProps['onSelect'];
  children: ReactNode;
  place: (g: THREE.Group, elapsed: number) => void;
  paused: boolean;
  labelY: number;
}

function Mover({ vehicle, mode, selected, registry, onSelect, children, place, paused, labelY }: MoverProps) {
  const ref = useRef<THREE.Group>(null);
  const clock = useRef(0);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const g = ref.current!;
    registry.current.set(vehicle.id, g);
    place(g, 0);
    return () => { registry.current.delete(vehicle.id); };
  }, [vehicle.id, registry, place]);
  useFrame((_, dt) => {
    if (!paused) clock.current += Math.min(dt, 0.1);
    if (ref.current) place(ref.current, clock.current);
  });
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  return (
    <group ref={ref}
      onClick={(e) => { e.stopPropagation(); onSelect({ vehicle, mode }); }}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }}>
      {children}
      {(hover || selected) && (
        <Html position={[0, labelY, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`realm-tag ${selected ? 'selected' : ''}`}>{vehicle.reference}</div>
        </Html>
      )}
      {selected && <mesh position={[0, 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[2.6, 3.1, 32]} /><meshBasicMaterial color="#f2c46d" toneMapped={false} /></mesh>}
    </group>
  );
}

const SPEEDS: Record<TransportMode, number[]> = {
  road: [2.2, 4.5, 5.5, 6.5, 7.5],
  sea: [2.4, 3, 3.6, 4.2, 4.8],
  rail: [3.5, 4.5, 6, 7, 11],
  air: [1.4, 9, 11, 13, 15],
};

function useFollower(curve: THREE.Curve<THREE.Vector3>, offset: number, speed: number, side = 0, yOff = 0) {
  const len = useMemo(() => curve.getLength(), [curve]);
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), q: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }), []);
  return useMemo(() => (g: THREE.Group, elapsed: number) => {
    const t = (((offset + (elapsed * speed) / len) % 1) + 1) % 1;
    curve.getPointAt(t, tmp.p);
    curve.getPointAt((t + 0.004) % 1, tmp.q);
    if (side) {
      tmp.s.subVectors(tmp.q, tmp.p).normalize().cross(tmp.up).multiplyScalar(side);
      tmp.p.add(tmp.s); tmp.q.add(tmp.s);
    }
    g.position.set(tmp.p.x, tmp.p.y + yOff, tmp.p.z);
    g.lookAt(tmp.q.x, tmp.q.y + yOff, tmp.q.z);
  }, [curve, offset, speed, len, side, yOff, tmp]);
}

function RoadCar(props: Omit<MoverProps, 'place' | 'children' | 'labelY'> & { level: number; index: number; total: number; accent: THREE.Material }) {
  const place = useFollower(ROAD, props.index / props.total + props.vehicle.progress * 0.05, SPEEDS.road[props.level - 1], 0.85);
  return <Mover {...props} place={place} labelY={4}><RoadVehicle level={props.level} accent={props.accent} /></Mover>;
}

function SailingShip(props: Omit<MoverProps, 'place' | 'children' | 'labelY'> & { level: number; index: number; total: number; accent: THREE.Material }) {
  const place = useFollower(SEA, props.index / props.total + props.vehicle.progress * 0.05, SPEEDS.sea[props.level - 1]);
  return <Mover {...props} place={place} labelY={props.level >= 4 ? 10 : 7}><Ship level={props.level} accent={props.accent} /></Mover>;
}

function MooredShip(props: Omit<MoverProps, 'place' | 'children' | 'labelY'> & { level: number; z: number; accent: THREE.Material }) {
  const { z } = props;
  const place = useMemo(() => (g: THREE.Group, e: number) => {
    g.position.set(QUAY_X - 8, Math.sin(e * 1.1 + z) * 0.12, z + (props.level >= 4 ? 4.6 : 3.4));
    g.rotation.set(Math.sin(e * 0.9 + z) * 0.02, -Math.PI / 2, 0);
  }, [z, props.level]);
  return <Mover {...props} place={place} labelY={props.level >= 4 ? 10 : 7}><Ship level={props.level} accent={props.accent} /></Mover>;
}

function Plane(props: Omit<MoverProps, 'place' | 'children' | 'labelY'> & { level: number; index: number; total: number; accent: THREE.Material }) {
  const place = useFollower(AIR, props.index / props.total + props.vehicle.progress * 0.05, SPEEDS.air[props.level - 1]);
  return <Mover {...props} place={place} labelY={4}><Aircraft level={props.level} accent={props.accent} /></Mover>;
}

function Balloon(props: Omit<MoverProps, 'place' | 'children' | 'labelY'> & { index: number; total: number; accent: THREE.Material }) {
  const { index, total } = props;
  const place = useMemo(() => (g: THREE.Group, e: number) => {
    const a = (index / total) * Math.PI * 2 + e * 0.035;
    const rad = BALLOON_RING.radius + Math.sin(index * 2.1) * 12;
    g.position.set(BALLOON_RING.center.x + Math.cos(a) * rad, 15 + index * 2.2 + Math.sin(e * 0.6 + index) * 1.2, BALLOON_RING.center.z + Math.sin(a) * rad);
    g.rotation.y = -a;
  }, [index, total]);
  return <Mover {...props} place={place} labelY={7}><Aircraft level={1} accent={props.accent} /></Mover>;
}

function Train(props: Omit<MoverProps, 'place' | 'children' | 'labelY'> & { level: number; index: number; total: number; accent: THREE.Material }) {
  const spec = TRAIN_SPEC[props.level - 1];
  const len = useMemo(() => RAIL.getLength(), []);
  const start = props.index / props.total;
  const speed = SPEEDS.rail[props.level - 1];
  const cars = useRef<(THREE.Group | null)[]>([]);
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), q: new THREE.Vector3() }), []);
  const placeAt = (g: THREE.Group, t: number) => {
    RAIL.getPointAt(((t % 1) + 1) % 1, tmp.p);
    RAIL.getPointAt((((t + 0.003) % 1) + 1) % 1, tmp.q);
    g.position.set(tmp.p.x, tmp.p.y + 0.2 + spec.hover, tmp.p.z);
    g.lookAt(tmp.q.x, tmp.q.y + 0.2 + spec.hover, tmp.q.z);
  };
  const place = useMemo(() => (g: THREE.Group, e: number) => {
    const t = start + (e * speed) / len;
    placeAt(g, t);
    cars.current.forEach((c, i) => {
      if (!c) return;
      const back = (spec.locoLen / 2 + spec.carLen * (i + 0.5) + 0.35 * (i + 1)) / len;
      placeAt(c, t - back);
    });
  }, [start, speed, len, spec]);
  return (
    <>
      <Mover {...props} place={place} labelY={5}><Locomotive level={props.level} accent={props.accent} /></Mover>
      {Array.from({ length: spec.cars }, (_, i) => (
        <group key={i} ref={(g) => { cars.current[i] = g; }}><RailCar level={props.level} accent={props.accent} index={i} /></group>
      ))}
    </>
  );
}

function Fleets({ data, accent, paused, selected, onSelect, registry }: Omit<SceneProps, 'lighting' | 'camera' | 'accent'> & { accent: THREE.Material; registry: Registry }) {
  const byMode = Object.fromEntries(data.modes.map((m) => [m.mode, m])) as Record<TransportMode, RealmMode>;
  const common = { paused, registry, onSelect };
  const sea = byMode.sea, road = byMode.road, rail = byMode.rail, air = byMode.air;
  const berths = Math.max(2, Math.min(8, data.town.docks));
  const moored = sea.vehicles.slice(0, Math.min(Math.ceil(sea.vehicles.length / 3), berths));
  const sailing = sea.vehicles.slice(moored.length);
  const berthZ = (i: number) => (i - (berths - 1) / 2) * 11;
  // Longer road vehicles need more road each, so fewer fit on the ring.
  const cars = road.vehicles.slice(0, [14, 14, 13, 11, 8][road.level - 1]);
  const trains = rail.vehicles.slice(0, 4);
  const planes = air.vehicles.slice(0, air.level === 1 ? 6 : 8);
  return (
    <group>
      {cars.map((v, i) => <RoadCar key={v.id} vehicle={v} mode="road" selected={selected === v.id} level={road.level} index={i} total={cars.length} accent={accent} {...common} />)}
      {moored.map((v, i) => <MooredShip key={v.id} vehicle={v} mode="sea" selected={selected === v.id} level={sea.level} z={berthZ(i * 2 % berths)} accent={accent} {...common} />)}
      {sailing.map((v, i) => <SailingShip key={v.id} vehicle={v} mode="sea" selected={selected === v.id} level={sea.level} index={i} total={sailing.length} accent={accent} {...common} />)}
      {trains.map((v, i) => <Train key={v.id} vehicle={v} mode="rail" selected={selected === v.id} level={rail.level} index={i} total={trains.length} accent={accent} {...common} />)}
      {air.level === 1
        ? planes.map((v, i) => <Balloon key={v.id} vehicle={v} mode="air" selected={selected === v.id} index={i} total={planes.length} accent={accent} {...common} />)
        : planes.map((v, i) => <Plane key={v.id} vehicle={v} mode="air" selected={selected === v.id} level={air.level} index={i} total={planes.length} accent={accent} {...common} />)}
    </group>
  );
}

/* ───────────── Camera ───────────── */

function CameraDirector({ request, registry, controls, follow }: { request: CameraRequest | null; registry: Registry; controls: MutableRefObject<OrbitControlsImpl | null>; follow: MutableRefObject<number | null> }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    const c = controls.current;
    if (!request || !c) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let pos: THREE.Vector3, target: THREE.Vector3;
    if (request.kind === 'preset') {
      follow.current = null;
      pos = new THREE.Vector3(...PRESETS[request.name].pos);
      target = new THREE.Vector3(...PRESETS[request.name].target);
    } else {
      const obj = registry.current.get(request.id);
      if (!obj) return;
      target = obj.getWorldPosition(new THREE.Vector3());
      const dir = camera.position.clone().sub(c.target).normalize();
      pos = target.clone().addScaledVector(dir, 42).setY(Math.max(target.y + 20, 20));
      follow.current = request.id;
    }
    gsap.killTweensOf([camera.position, c.target]);
    const d = reduced ? 0 : 1.4;
    // invalidate() keeps the fly-to rendering when motion is paused (frameloop="demand").
    gsap.to(camera.position, { x: pos.x, y: pos.y, z: pos.z, duration: d, ease: 'power3.inOut', onUpdate: invalidate });
    gsap.to(c.target, { x: target.x, y: target.y, z: target.z, duration: d, ease: 'power3.inOut', onUpdate: () => { c.update(); invalidate(); } });
    if (!d) { c.update(); invalidate(); }
  }, [request, camera, controls, registry, follow, invalidate]);
  // Keep a selected vehicle centred until the user takes over.
  useFrame(() => {
    const c = controls.current;
    if (!c || follow.current == null || gsap.isTweening(c.target)) return;
    const obj = registry.current.get(follow.current);
    if (!obj) return;
    const p = obj.getWorldPosition(new THREE.Vector3());
    const delta = p.clone().sub(c.target);
    c.target.add(delta);
    camera.position.add(delta);
    c.update();
  });
  return null;
}

/* ───────────── Scene ───────────── */

function World({ data, accent: accentColor, lighting, paused, selected, onSelect, camera }: SceneProps) {
  const light = useLight(lighting);
  const accent = useAccent(accentColor);
  const registry = useRef(new Map<number, THREE.Object3D>());
  const controls = useRef<OrbitControlsImpl | null>(null);
  const follow = useRef<number | null>(null);
  const { scene } = useThree();
  const level = (m: TransportMode) => data.modes.find((x) => x.mode === m)?.level ?? 1;
  useEffect(() => {
    scene.background = light.sky;
    scene.fog = new THREE.Fog(light.sky, 160, 420);
  }, [scene, light]);
  const houses = Math.max(6, Math.min(30, data.town.staff * 2));
  const warehouses = Math.max(1, Math.min(8, Math.ceil(data.town.skus / 3)));
  const berths = Math.max(2, Math.min(8, data.town.docks));
  const sunPos: [number, number, number] = light.day > 0.15 ? [80, 120, 60] : [-60, 90, -80];
  return (
    <>
      <hemisphereLight args={[light.hemi, light.hemiGround, light.hemiI]} />
      <directionalLight position={sunPos} color={light.sun} intensity={light.sunI} castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-130} shadow-camera-right={130} shadow-camera-top={130} shadow-camera-bottom={-130} shadow-bias={-0.0004} />
      <Water color={light.water} paused={paused} />
      <Ground light={light} />
      <Roads roadLevel={level('road')} light={light} />
      <Railway level={level('rail')} />
      <Airfield level={level('air')} accent={accent} />
      <Harbour berths={berths} level={level('sea')} light={light} />
      <Warehouses count={warehouses} light={light} />
      <Keep accent={accent} light={light} />
      <Houses count={houses} light={light} />
      <Forest />
      <Meadows glow={light.windows} paused={paused} />
      <Fleets data={data} accent={accent} paused={paused} selected={selected} onSelect={onSelect} registry={registry} />
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} target={[12, 0, 0]} minDistance={18} maxDistance={260}
        maxPolarAngle={1.32} onStart={() => { follow.current = null; }} />
      <CameraDirector request={camera} registry={registry} controls={controls} follow={follow} />
    </>
  );
}

export default function RealmScene(props: SceneProps) {
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ fov: 40, position: PRESETS.overview.pos, near: 0.5, far: 1200 }}
      frameloop={props.paused ? 'demand' : 'always'} onPointerMissed={() => props.onSelect(null)}
      gl={{ antialias: true, powerPreference: 'high-performance' }}>
      <World {...props} />
    </Canvas>
  );
}
