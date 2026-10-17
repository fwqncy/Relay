import { Sparkles } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing';
import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';

type Mode = 'light' | 'dark';

const PALETTES = {
  dark: {
    fog: '#474960', fogDensity: 0.0046, skyTop: '#1b2034', horizon: '#857891', glow: '#ffdcae',
    ground: '#11182a', rock: '#2b2f40', moss: '#27352f', pine: '#141c29', mist: '#a7a3bd', mistOpacity: 0.2,
    stone: '#3b3e51', stoneLight: '#4a4d61', roof: '#262938', window: '#ffb35c', stairs: '#8e90a6', archRock: '#3d4255',
    rays: '#efe2ff', flowers: ['#2446d8', '#3d6cff', '#6f98ff', '#b8ccff', '#ffffff'], firefly: '#b8ceff',
    bloom: 1.2, additive: true, sun: '#ffd2a0', fill: 0.35,
  },
  light: {
    fog: '#bcc4ba', fogDensity: 0.0066, skyTop: '#8c9a97', horizon: '#e0e4d8', glow: '#fffbe9',
    ground: '#5b6958', rock: '#646b63', moss: '#5c6c4f', pine: '#3a473c', mist: '#f1f3ec', mistOpacity: 0.42,
    stone: '#7a8077', stoneLight: '#8b9187', roof: '#4f5752', window: '#ffc56a', stairs: '#c3c6bc', archRock: '#6a7268',
    rays: '#ffffff', flowers: ['#1f3fc4', '#3359e0', '#4f7cf2', '#8eaaff', '#e2e9ff'], firefly: '#ffffff',
    bloom: 0.55, additive: false, sun: '#fff4dc', fill: 0.55,
  },
} as const;
type Palette = (typeof PALETTES)[Mode];

function rand(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/* ───────────── Terrain ─────────────
   One height function shapes the meadow, the castle's mesa, the cliffs to
   the west and the ridge to the east. Everything that stands on the land
   (stairs, rocks, pines, flowers) samples it, so nothing floats. */

// The castle sits on a mesa; a staircase climbs its front face.
const CX = 14, CZ = -215, TOP = 32;
const STAIR_Z0 = -106, STAIR_Z1 = -177;

const meadowY = (x: number, z: number) =>
  Math.sin(x * 0.045) * 1.4 + Math.cos(z * 0.06 + x * 0.02) * 1.1 + Math.sin((x + z) * 0.11) * 0.35 - Math.max(0, -z - 60) * 0.02;

const STAIR_Y0 = meadowY(CX, STAIR_Z0);
const stairY = (z: number) => STAIR_Y0 + ((STAIR_Z0 - z) / (STAIR_Z0 - STAIR_Z1)) * (TOP - STAIR_Y0);

function terrainY(x: number, z: number) {
  let h = meadowY(x, z);
  // Mesa: steep sides, flat top.
  const d = Math.hypot((x - CX) / 1.15, z - CZ);
  h += smooth(64, 42, d) * (TOP + 2 - meadowY(x, z)) + Math.sin(x * 0.7 + z * 0.4) * 1.2 * smooth(62, 50, d) * smooth(40, 50, d);
  h = THREE.MathUtils.lerp(h, TOP, smooth(46, 36, d));
  // Western escarpment and an eastern ridge, both in the distance.
  h += smooth(-40, -95, x) * smooth(-40, -120, z) * (34 + Math.sin(z * 0.05) * 8 + Math.sin(z * 0.17) * 2);
  h += smooth(60, 115, x) * smooth(-120, -200, z) * (20 + Math.sin(x * 0.09 + z * 0.04) * 9);
  // The stairway cuts a notch up the mesa's face.
  if (z < STAIR_Z0 + 3 && z > STAIR_Z1 - 1) {
    const carve = smooth(11, 7, Math.abs(x - CX));
    h = THREE.MathUtils.lerp(h, Math.min(h, stairY(z) - 0.5), carve);
  }
  return h;
}

const slope = (x: number, z: number) => Math.hypot(terrainY(x + 1, z) - terrainY(x - 1, z), terrainY(x, z + 1) - terrainY(x, z - 1)) / 2;

function Terrain({ pal }: { pal: Palette }) {
  const geo = useMemo(() => {
    const g0 = new THREE.PlaneGeometry(620, 440, 190, 140);
    g0.rotateX(-Math.PI / 2);
    g0.translate(0, 0, -180);
    const p0 = g0.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p0.count; i++) p0.setY(i, terrainY(p0.getX(i), p0.getZ(i)));
    // Faceted, with each face coloured by how steep and how high it is.
    const g = g0.toNonIndexed();
    g0.dispose();
    g.computeVertexNormals();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const base = new THREE.Color(pal.ground), rock = new THREE.Color(pal.rock), moss = new THREE.Color(pal.moss), c = new THREE.Color();
    for (let i = 0; i < pos.count; i += 3) {
      const ny = nrm.getY(i);
      const h = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const steep = smooth(0.93, 0.62, ny);
      c.copy(base).lerp(moss, smooth(4, 14, h) * (1 - steep)).lerp(rock, steep);
      for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, [pal]);
  return <mesh geometry={geo}><meshLambertMaterial vertexColors flatShading /></mesh>;
}

/* ───────────── Sky and light ───────────── */

// Towards the castle's spires, where the sky glows behind it.
const GLOW_DIR = new THREE.Vector3(CX + 6, 70, CZ - 14).normalize();

function Sky({ pal }: { pal: Palette }) {
  const uniforms = useMemo(() => ({
    uTop: { value: new THREE.Color(pal.skyTop) },
    uHorizon: { value: new THREE.Color(pal.horizon) },
    uGlow: { value: new THREE.Color(pal.glow) },
    uGlowDir: { value: GLOW_DIR },
  }), [pal]);
  return (
    <mesh renderOrder={-10}>
      <sphereGeometry args={[700, 32, 16]} />
      <shaderMaterial side={THREE.BackSide} depthWrite={false} fog={false} uniforms={uniforms}
        vertexShader={`varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`}
        fragmentShader={`
          uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uGlowDir; varying vec3 vDir;
          void main(){
            float h = vDir.y;
            vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.55, h));
            float g = max(dot(normalize(vDir), uGlowDir), 0.0);
            col += uGlow * (pow(g, 22.0) * 0.5 + pow(g, 5.0) * 0.16);
            gl_FragColor = vec4(col, 1.0);
          }`} />
    </mesh>
  );
}

function LightRays({ pal, reduced }: { pal: Palette; reduced: boolean }) {
  const mat = useRef<THREE.ShaderMaterial[]>([]);
  const rays = useMemo(() => {
    const r = rand(7);
    return Array.from({ length: 6 }, (_, i) => ({
      x: CX + (i - 2.5) * 26 + (r() - 0.5) * 10, z: CZ - 50 - r() * 40, w: 14 + r() * 20, rot: (r() - 0.5) * 0.5, o: 0.05 + r() * 0.06, phase: r() * 6,
    }));
  }, []);
  useFrame(({ clock }) => {
    if (reduced) return;
    mat.current.forEach((m, i) => { if (m) m.uniforms.uOpacity.value = rays[i].o * (0.75 + 0.25 * Math.sin(clock.elapsedTime * 0.3 + rays[i].phase)); });
  });
  return (
    <group>
      {rays.map((ray, i) => (
        <mesh key={i} position={[ray.x, 95, ray.z]} rotation={[0, 0, ray.rot]}>
          <planeGeometry args={[ray.w, 190]} />
          <shaderMaterial ref={(m) => { if (m) mat.current[i] = m; }} transparent depthWrite={false} blending={THREE.AdditiveBlending} fog={false}
            uniforms={{ uColor: { value: new THREE.Color(pal.rays) }, uOpacity: { value: ray.o } }}
            vertexShader={`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
            fragmentShader={`uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
              void main(){ float edge = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
                float fade = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
                gl_FragColor = vec4(uColor, edge * fade * uOpacity); }`} />
        </mesh>
      ))}
    </group>
  );
}

/* ───────────── Castle ───────────── */

// A pointed (lancet) arch outline, for windows and doors.
function lancet(w: number, h: number) {
  const r = w / 2;
  const s = new THREE.Shape();
  s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, h - w);
  s.quadraticCurveTo(r, h - w * 0.2, 0, h);
  s.quadraticCurveTo(-r, h - w * 0.2, -r, h - w);
  s.lineTo(-r, 0);
  return s;
}

function prism(w: number, h: number, depth: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.lineTo(-w / 2, 0);
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
}

type V3 = [number, number, number];

function Castle({ pal }: { pal: Palette }) {
  const m = useMemo(() => ({
    stone: new THREE.MeshLambertMaterial({ color: pal.stone, flatShading: true }),
    light: new THREE.MeshLambertMaterial({ color: pal.stoneLight, flatShading: true }),
    roof: new THREE.MeshLambertMaterial({ color: pal.roof, flatShading: true }),
    moss: new THREE.MeshLambertMaterial({ color: pal.moss, flatShading: true }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.window).multiplyScalar(2.2), toneMapped: false }),
    dark: new THREE.MeshBasicMaterial({ color: '#0d0e14' }),
  }), [pal]);
  const g = useMemo(() => ({
    win: new THREE.ShapeGeometry(lancet(1.4, 4.2)),
    winSm: new THREE.ShapeGeometry(lancet(0.9, 2.6)),
    winTall: new THREE.ShapeGeometry(lancet(2.2, 9)),
    portal: new THREE.ShapeGeometry(lancet(5.2, 9.5)),
    gable: prism(24, 14, 2.2),
    navRoof: prism(23, 13, 46),
    gateArch: new THREE.ShapeGeometry(lancet(5, 7)),
  }), []);

  const Box = ({ s, p, mat = m.stone, r }: { s: V3; p: V3; mat?: THREE.Material; r?: V3 }) => (
    <mesh position={p} rotation={r} material={mat}><boxGeometry args={s} /></mesh>
  );
  const Spire = ({ p, r, h, sides = 4, mat = m.roof }: { p: V3; r: number; h: number; sides?: number; mat?: THREE.Material }) => (
    <mesh position={[p[0], p[1] + h / 2, p[2]]} rotation={[0, sides === 4 ? Math.PI / 4 : 0, 0]} material={mat}><coneGeometry args={[r, h, sides]} /></mesh>
  );
  const Win = ({ p, geo = g.win, ry = 0 }: { p: V3; geo?: THREE.BufferGeometry; ry?: number }) => (
    <mesh position={p} rotation={[0, ry, 0]} geometry={geo} material={m.glow} />
  );
  const Pinnacles = ({ x, y, z, half, h = 6 }: { x: number; y: number; z: number; half: number; h?: number }) => (
    <>{[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b], i) => <Spire key={i} p={[x + a * half, y, z + b * half]} r={0.9} h={h} sides={6} />)}</>
  );
  const RoundTower = ({ x, z, r, h, roof }: { x: number; z: number; r: number; h: number; roof: number }) => (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2, 0]} material={m.stone}><cylinderGeometry args={[r, r * 1.08, h, 14]} /></mesh>
      <mesh position={[0, h + 0.4, 0]} material={m.light}><cylinderGeometry args={[r * 1.12, r * 1.12, 0.8, 14]} /></mesh>
      <Spire p={[0, h + 0.8, 0]} r={r * 1.25} h={roof} sides={14} />
      <Win p={[0, h * 0.62, r + 0.02]} />
      <Win p={[0, h * 0.35, r + 0.05]} geo={g.winSm} />
    </group>
  );

  // Flying buttresses along both sides of the nave.
  const buttresses = [-14, -4, 6, 16].flatMap((z) => [1, -1].map((side) => ({ z, side })));

  return (
    <group position={[CX, TOP, CZ]}>
      {/* Nave and its roof */}
      <Box s={[22, 24, 46]} p={[0, 12, 2]} />
      <mesh geometry={g.navRoof} position={[0, 24, -21]} material={m.roof} />
      {[-10, -2, 6, 14].flatMap((z) => [11.05, -11.05].map((x) => <Win key={`${x}${z}`} p={[x, 9, z]} geo={g.winTall} ry={x > 0 ? Math.PI / 2 : -Math.PI / 2} />))}
      {buttresses.map(({ z, side }) => (
        <group key={`${z}${side}`}>
          <Box s={[2.2, 20, 2.6]} p={[side * 19, 10, z]} />
          <Spire p={[side * 19, 20, z]} r={1} h={6} sides={6} />
          <Box s={[9, 1.1, 1.3]} p={[side * 15, 21, z]} r={[0, 0, side * -0.46]} />
        </group>
      ))}

      {/* West front: gable, rose window, portal, twin spired towers */}
      <Box s={[24, 26, 2.2]} p={[0, 13, 25.2]} mat={m.light} />
      <mesh geometry={g.gable} position={[0, 26, 24.1]} material={m.light} />
      <mesh position={[0, 20, 26.4]} rotation={[Math.PI / 2, 0, 0]} material={m.glow}><cylinderGeometry args={[4.4, 4.4, 0.3, 24]} /></mesh>
      <mesh position={[0, 20, 26.6]} material={m.stone}><torusGeometry args={[4.6, 0.55, 6, 24]} /></mesh>
      {Array.from({ length: 6 }, (_, i) => <Box key={i} s={[0.35, 8.6, 0.3]} p={[0, 20, 26.7]} r={[0, 0, (i * Math.PI) / 6]} />)}
      <mesh geometry={g.portal} position={[0, 0.1, 26.35]} material={m.dark} />
      <Win p={[-6.5, 4, 26.35]} /><Win p={[6.5, 4, 26.35]} />
      {[-15.5, 15.5].map((x) => (
        <group key={x}>
          <Box s={[8.5, 46, 8.5]} p={[x, 23, 23]} />
          <Box s={[9.4, 1.2, 9.4]} p={[x, 46.6, 23]} mat={m.light} />
          <Win p={[x, 34, 27.3]} geo={g.winTall} />
          <Win p={[x, 16, 27.3]} />
          <Spire p={[x, 47.2, 23]} r={6.4} h={28} />
          <Pinnacles x={x} y={47.2} z={23} half={3.9} />
        </group>
      ))}

      {/* Crossing tower and the great tower behind */}
      <Box s={[12, 48, 12]} p={[0, 24, -6]} />
      <Win p={[0, 40, 0.05]} geo={g.winTall} />
      <Spire p={[0, 48, -6]} r={8.6} h={26} />
      <Pinnacles x={0} y={48} z={-6} half={5.4} />
      <Box s={[15, 82, 15]} p={[3, 41, -32]} />
      <Box s={[17, 1.6, 17]} p={[3, 82.8, -32]} mat={m.light} />
      <Win p={[3, 66, -24.45]} geo={g.winTall} />
      <Win p={[3, 50, -24.45]} />
      <Spire p={[3, 83.6, -32]} r={10.5} h={36} />
      <Pinnacles x={3} y={83.6} z={-32} half={7.2} h={9} />

      {/* Round towers with conical roofs, after the reference */}
      <RoundTower x={-33} z={12} r={6} h={34} roof={24} />
      <RoundTower x={34} z={8} r={5} h={28} roof={18} />
      <RoundTower x={-28} z={-22} r={4.6} h={42} roof={17} />
      <RoundTower x={31} z={-24} r={5.6} h={48} roof={21} />
      <RoundTower x={-42} z={-4} r={3.4} h={22} roof={12} />

      {/* Curtain walls with crenellations */}
      {[[-26.5, 16, 13], [26, 13, 12]].map(([x, z, w], i) => (
        <group key={i}>
          <Box s={[w, 14, 2]} p={[x, 7, z]} />
          {Array.from({ length: Math.floor(w / 2) }, (_, k) => <Box key={k} s={[1, 1.2, 2]} p={[x - w / 2 + 1 + k * 2, 14.6, z]} />)}
        </group>
      ))}

      {/* Gatehouse where the stairs arrive */}
      <group position={[0, 0, 37]}>
        {[-5.2, 5.2].map((x) => (
          <group key={x}>
            <Box s={[4, 13, 4]} p={[x, 6.5, 0]} />
            <Spire p={[x, 13, 0]} r={3} h={8} />
          </group>
        ))}
        <Box s={[6.4, 4, 3]} p={[0, 10, 0]} />
        <mesh geometry={g.gateArch} position={[0, 0, 1.55]} material={m.dark} />
      </group>

      {/* Moss and ivy clumps at the foot of the walls */}
      {([[-20, 1, 24], [14, 1.5, 27], [-36, 2, 16], [38, 1, 12], [-12, 26, 25.5], [22, 3, 20], [-30, 8, 4]] as V3[]).map((p, i) => (
        <mesh key={i} position={p} scale={[3 + (i % 3), 2 + (i % 2), 2.4]} material={m.moss}><dodecahedronGeometry args={[1, 0]} /></mesh>
      ))}
    </group>
  );
}

/* ───────────── Stairs, rock arch, aqueduct ───────────── */

function Stairs({ pal }: { pal: Palette }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = 46;
  const run = (STAIR_Z0 - STAIR_Z1) / n;
  const rise = (TOP - STAIR_Y0) / n;
  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const top = STAIR_Y0 + (i + 1) * rise;
      const bottom = STAIR_Y0 - 4;
      o.position.set(CX, (top + bottom) / 2, STAIR_Z0 - (i + 0.5) * run);
      o.scale.set(1, top - bottom, 1);
      o.updateMatrix();
      ref.current!.setMatrixAt(i, o.matrix);
    }
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [n, run, rise]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]}>
      <boxGeometry args={[9, 1, run + 0.25]} />
      <meshLambertMaterial color={pal.stairs} flatShading />
    </instancedMesh>
  );
}

// Lanterns up both sides of the stairway lead the eye to the gate.
function Lanterns({ pal }: { pal: Palette }) {
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.window).multiplyScalar(2.6), toneMapped: false }), [pal]);
  const post = useMemo(() => new THREE.MeshLambertMaterial({ color: '#1c1d24' }), []);
  const spots = useMemo(() => {
    const out: V3[] = [];
    for (let i = 0; i <= 8; i++) {
      const z = STAIR_Z0 - 2 - i * ((STAIR_Z0 - STAIR_Z1 - 4) / 8);
      for (const side of [-1, 1]) out.push([CX + side * 5.3, stairY(z), z]);
    }
    return out;
  }, []);
  return (
    <group>
      {spots.map(([x, y, z], i) => (
        <group key={i} position={[x, y, z]}>
          <mesh position={[0, 1.1, 0]} material={post}><cylinderGeometry args={[0.12, 0.16, 2.2, 5]} /></mesh>
          <mesh position={[0, 2.45, 0]} material={glow}><boxGeometry args={[0.55, 0.7, 0.55]} /></mesh>
        </group>
      ))}
    </group>
  );
}

// A natural rock arch the stairway passes through.
function RockArch({ pal }: { pal: Palette }) {
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    const pts: [number, number][] = [[-17, -30], [17, -30], [18, -8], [15, 5], [19, 14], [14, 22], [7, 26], [-3, 28], [-11, 24], [-18, 16], [-15, 4], [-19, -9]];
    s.moveTo(...pts[0]);
    pts.slice(1).forEach((p) => s.lineTo(...p));
    s.lineTo(...pts[0]);
    const hole = new THREE.Path();
    hole.moveTo(-6, -1); hole.lineTo(6, -1); hole.lineTo(6, 11); hole.absarc(0, 11, 6, 0, Math.PI, false); hole.lineTo(-6, -1);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: 9, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.2, bevelSegments: 1, curveSegments: 6 });
    g.translate(0, 0, -4.5);
    return g;
  }, []);
  const z = -158;
  return (
    <mesh geometry={geo} position={[CX, stairY(z) - 0.6, z]}>
      <meshLambertMaterial color={pal.archRock} flatShading />
    </mesh>
  );
}

// A two-tier arched aqueduct from the mesa to the western cliffs.
function Aqueduct({ pal }: { pal: Palette }) {
  const geo = useMemo(() => {
    const len = 72;
    const s = new THREE.Shape();
    s.moveTo(0, -48); s.lineTo(len, -48); s.lineTo(len, 0); s.lineTo(0, 0); s.lineTo(0, -48);
    for (let k = 0; k < 5; k++) {
      const cx = 7.2 + k * 14.4;
      const h = new THREE.Path();
      h.moveTo(cx - 5, -46); h.lineTo(cx + 5, -46); h.lineTo(cx + 5, -21); h.absarc(cx, -21, 5, 0, Math.PI, false); h.lineTo(cx - 5, -46);
      s.holes.push(h);
    }
    for (let k = 0; k < 9; k++) {
      const cx = 4 + k * 8;
      const h = new THREE.Path();
      h.moveTo(cx - 2, -13); h.lineTo(cx + 2, -13); h.lineTo(cx + 2, -6.5); h.absarc(cx, -6.5, 2, 0, Math.PI, false); h.lineTo(cx - 2, -13);
      s.holes.push(h);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: 4, bevelEnabled: false, curveSegments: 8 });
    g.translate(-len, 0, -2);
    return g;
  }, []);
  return (
    <mesh geometry={geo} position={[CX - 36, TOP - 1, CZ + 6]}>
      <meshLambertMaterial color={pal.stone} flatShading />
    </mesh>
  );
}

/* ───────────── Rocks, pines, mist ───────────── */

function Boulders({ pal }: { pal: Palette }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const rocks = useMemo(() => {
    const r = rand(99);
    const out: { x: number; z: number; s: number; rot: number }[] = [];
    // Crags lining the stairway.
    for (let i = 0; i < 26; i++) {
      const z = STAIR_Z0 - 4 - r() * (STAIR_Z0 - STAIR_Z1 - 6);
      out.push({ x: CX + (r() < 0.5 ? -1 : 1) * (7.5 + r() * 4), z, s: 1.8 + r() * 3.5, rot: r() * 6 });
    }
    // Scree around the foot of the mesa.
    for (let i = 0; i < 30; i++) {
      const a = r() * Math.PI * 2, rad = 58 + r() * 12;
      const x = CX + Math.cos(a) * rad * 1.15, z = CZ + Math.sin(a) * rad;
      if (z > STAIR_Z1 && Math.abs(x - CX) < 12) continue;
      out.push({ x, z, s: 2.5 + r() * 5, rot: r() * 6 });
    }
    return out;
  }, []);
  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    // Sunk a third into the ground so every rock rests on land.
    rocks.forEach((k, i) => {
      o.position.set(k.x, terrainY(k.x, k.z) + k.s * 0.35, k.z);
      o.rotation.set(k.rot * 0.3, k.rot, 0);
      o.scale.set(k.s * 1.2, k.s, k.s);
      o.updateMatrix();
      ref.current!.setMatrixAt(i, o.matrix);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [rocks]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, rocks.length]}>
      <dodecahedronGeometry args={[1, 0]} />
      <meshLambertMaterial color={pal.rock} flatShading />
    </instancedMesh>
  );
}

function Pines({ pal }: { pal: Palette }) {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const lower = useRef<THREE.InstancedMesh>(null);
  const upper = useRef<THREE.InstancedMesh>(null);
  const trees = useMemo(() => {
    const r = rand(5);
    const out: { x: number; y: number; z: number; s: number }[] = [];
    let tries = 0;
    while (out.length < 120 && tries++ < 8000) {
      const x = (r() - 0.5) * 420, z = -45 - r() * 260;
      const d = Math.hypot((x - CX) / 1.15, z - CZ);
      if (d < 47) continue; // the castle's mesa top
      if (Math.abs(x - CX) < 14 && z < STAIR_Z0 + 8 && z > STAIR_Z1 - 4) continue; // the stairway
      if (z < CZ + 12 && z > CZ - 2 && x < CX - 30 && x > CX - 112) continue; // under the aqueduct
      if (slope(x, z) > 0.75) continue; // no trees on cliff faces
      // Keep the view from the meadow up the stairway clear.
      const sight = CX * ((14 - z) / (14 - STAIR_Z1));
      if (z > STAIR_Z1 && Math.abs(x - sight) < 12 + (14 - z) * 0.08) continue;
      out.push({ x, y: terrainY(x, z), z, s: 1.7 + r() * 1.6 });
    }
    // A lone pine in the near meadow.
    out.push({ x: 7, y: terrainY(7, -16), z: -16, s: 1.15 });
    return out;
  }, []);
  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    trees.forEach((t, i) => {
      o.scale.setScalar(t.s);
      o.position.set(t.x, t.y + 0.6 * t.s, t.z); o.updateMatrix(); trunks.current!.setMatrixAt(i, o.matrix);
      o.position.set(t.x, t.y + 2.4 * t.s, t.z); o.updateMatrix(); lower.current!.setMatrixAt(i, o.matrix);
      o.position.set(t.x, t.y + 4.1 * t.s, t.z); o.updateMatrix(); upper.current!.setMatrixAt(i, o.matrix);
    });
    [trunks, lower, upper].forEach((m) => { m.current!.instanceMatrix.needsUpdate = true; });
  }, [trees]);
  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, undefined, trees.length]}>
        <cylinderGeometry args={[0.12, 0.2, 1.4, 5]} /><meshLambertMaterial color={pal.pine} />
      </instancedMesh>
      <instancedMesh ref={lower} args={[undefined, undefined, trees.length]}>
        <coneGeometry args={[1.5, 3.2, 7]} /><meshLambertMaterial color={pal.pine} />
      </instancedMesh>
      <instancedMesh ref={upper} args={[undefined, undefined, trees.length]}>
        <coneGeometry args={[1, 2.6, 7]} /><meshLambertMaterial color={pal.pine} />
      </instancedMesh>
    </group>
  );
}

function mistTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const grad = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = grad;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// Banks of mist around the foot of the mesa and up the stairway.
function Mist({ pal, reduced }: { pal: Palette; reduced: boolean }) {
  const tex = useMemo(mistTexture, []);
  const puffs = useMemo(() => {
    const r = rand(31);
    const out: { p: V3; s: number; o: number; phase: number }[] = [];
    for (let i = 0; i < 22; i++) {
      const a = Math.PI * (0.15 + r() * 0.7), rad = 52 + r() * 22;
      const x = CX + Math.cos(a) * rad * 1.3 * (r() < 0.5 ? -1 : 1), z = CZ + Math.sin(a) * rad;
      out.push({ p: [x, terrainY(x, z) + 6 + r() * 10, z], s: 40 + r() * 40, o: 0.6 + r() * 0.4, phase: r() * 6 });
    }
    for (let i = 0; i < 10; i++) {
      const z = STAIR_Z0 - r() * (STAIR_Z0 - STAIR_Z1);
      out.push({ p: [CX + (r() - 0.5) * 30, stairY(z) + 3 + r() * 5, z], s: 18 + r() * 18, o: 0.5 + r() * 0.4, phase: r() * 6 });
    }
    for (let i = 0; i < 10; i++) {
      const x = (r() - 0.5) * 260, z = -90 - r() * 60;
      out.push({ p: [x, terrainY(x, z) + 3 + r() * 4, z], s: 30 + r() * 30, o: 0.4 + r() * 0.4, phase: r() * 6 });
    }
    return out;
  }, []);
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (reduced || !group.current) return;
    group.current.children.forEach((s, i) => { s.position.x = puffs[i].p[0] + Math.sin(clock.elapsedTime * 0.04 + puffs[i].phase) * 8; });
  });
  return (
    <group ref={group}>
      {puffs.map((m, i) => (
        <sprite key={i} position={m.p} scale={[m.s, m.s * 0.45, 1]}>
          <spriteMaterial map={tex} color={pal.mist} transparent opacity={pal.mistOpacity * m.o} depthWrite={false} fog />
        </sprite>
      ))}
    </group>
  );
}

/* ───────────── Flower meadow ───────────── */

function FlowerField({ pal, reduced }: { pal: Palette; reduced: boolean }) {
  const { gl, size } = useThree();
  const count = size.width < 700 ? 9000 : 24000;
  const geo = useMemo(() => {
    const r = rand(1234);
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), sz = new Float32Array(count), ph = new Float32Array(count);
    const palette = pal.flowers.map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      const z = 13 - Math.pow(r(), 1.7) * 150;
      const x = (r() - 0.5) * (60 + (13 - z) * 1.4);
      pos.set([x, terrainY(x, z) + 0.12 + r() * 0.3, z], i * 3);
      // Drifts of colour: most flowers deep blue, some pale ones in clusters.
      const cluster = Math.sin(x * 0.18) * Math.cos(z * 0.21);
      const c = palette[Math.min(palette.length - 1, Math.floor(r() * 2.2 + (cluster > 0.45 ? 2 : 0) + (r() < 0.04 ? 2 : 0)))];
      col.set([c.r, c.g, c.b], i * 3);
      sz[i] = 0.55 + r() * 0.9;
      ph[i] = r();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    return g;
  }, [count, pal]);
  const uniforms = useMemo(() => ({
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 },
    uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
    uBright: { value: pal.additive ? 1.35 : 1.0 },
  }), [gl, pal]);
  const mat = useRef<THREE.ShaderMaterial>(null);
  useFrame((_, dt) => { if (mat.current && !reduced) mat.current.uniforms.uTime.value += dt; });
  return (
    <points geometry={geo} frustumCulled={false}>
      <shaderMaterial ref={mat} transparent depthWrite={false} fog uniforms={uniforms}
        blending={pal.additive ? THREE.AdditiveBlending : THREE.NormalBlending}
        vertexShader={`
          uniform float uTime; uniform float uPixelRatio;
          attribute vec3 aColor; attribute float aSize; attribute float aPhase;
          varying vec3 vColor; varying float vTw;
          #include <fog_pars_vertex>
          void main(){
            vec3 p = position;
            p.x += sin(uTime * 0.9 + aPhase * 6.283 + p.z * 0.15) * 0.06;
            vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            gl_PointSize = aSize * uPixelRatio * (210.0 / -mvPosition.z);
            vTw = 0.78 + 0.22 * sin(uTime * 1.6 + aPhase * 30.0);
            vColor = aColor;
            #include <fog_vertex>
          }`}
        fragmentShader={`
          uniform float uBright; varying vec3 vColor; varying float vTw;
          #include <fog_pars_fragment>
          void main(){
            vec2 uv = gl_PointCoord * 2.0 - 1.0;
            float r = length(uv);
            float a = atan(uv.y, uv.x);
            float petal = 0.5 + 0.5 * cos(5.0 * a);
            float shape = smoothstep(0.42 + petal * 0.5, 0.3 + petal * 0.42, r);
            float core = smoothstep(0.22, 0.0, r);
            float glow = exp(-r * r * 4.0) * 0.3;
            float alpha = max(shape, glow);
            if (alpha < 0.03) discard;
            vec3 col = vColor * (shape * 1.2 + glow) * uBright + vec3(1.0, 0.95, 0.78) * core * 0.7;
            gl_FragColor = vec4(col * vTw, alpha);
            #include <fog_fragment>
          }`} />
    </points>
  );
}

/* ───────────── Camera ───────────── */

function CameraRig({ scroll, reduced }: { scroll: MutableRefObject<number>; reduced: boolean }) {
  // Aim left of the castle so it sits beside the hero copy rather than behind it.
  const target = useMemo(() => new THREE.Vector3(CX - 22, 34, CZ + 5), []);
  useFrame(({ camera, pointer }, dt) => {
    const p = reduced ? 0 : scroll.current;
    const px = reduced ? 0 : pointer.x * 1.4;
    const py = reduced ? 0 : pointer.y * 0.5;
    const k = 1 - Math.exp(-dt * 2.5);
    camera.position.x += (px - camera.position.x) * k;
    camera.position.y += (2.4 + py + p * 4 - camera.position.y) * k;
    camera.position.z += (14 - p * 46 - camera.position.z) * k;
    camera.lookAt(target);
  });
  return null;
}

export default function LandingScene({ mode, reduced, scroll }: { mode: Mode; reduced: boolean; scroll: MutableRefObject<number> }) {
  const pal = PALETTES[mode];
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ fov: 50, position: [0, 2.4, 14], near: 0.1, far: 1200 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      frameloop={reduced ? 'demand' : 'always'}
      aria-hidden="true"
    >
      <color attach="background" args={[pal.fog]} />
      <fogExp2 attach="fog" args={[pal.fog, pal.fogDensity]} />
      <hemisphereLight args={[pal.horizon, pal.ground, 0.9]} />
      {/* Backlit from the sunset behind the castle, with a soft fill from the viewer. */}
      <directionalLight position={[CX + 20, 140, CZ - 160]} color={pal.sun} intensity={1.3} />
      <directionalLight position={[-40, 60, 80]} color={pal.horizon} intensity={pal.fill} />
      <Sky pal={pal} />
      <LightRays pal={pal} reduced={reduced} />
      <Terrain pal={pal} />
      <Castle pal={pal} />
      <Aqueduct pal={pal} />
      <Stairs pal={pal} />
      <RockArch pal={pal} />
      <Lanterns pal={pal} />
      <Boulders pal={pal} />
      <Pines pal={pal} />
      <Mist pal={pal} reduced={reduced} />
      <FlowerField pal={pal} reduced={reduced} />
      {!reduced && <Sparkles count={140} scale={[70, 12, 70]} position={[0, 5, -20]} size={4} speed={0.25} color={pal.firefly} opacity={0.8} />}
      <CameraRig scroll={scroll} reduced={reduced} />
      <EffectComposer multisampling={0}>
        <Bloom intensity={pal.bloom} luminanceThreshold={0.62} luminanceSmoothing={0.3} mipmapBlur />
        <Vignette offset={0.25} darkness={mode === 'dark' ? 0.7 : 0.45} />
        <Noise opacity={0.045} />
      </EffectComposer>
    </Canvas>
  );
}
