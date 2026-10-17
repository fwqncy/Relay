import * as THREE from 'three';

// World layout (units ≈ metres at map scale). Sea to the west, town and
// keep in the middle, airfield to the east, a railway around everything.
export const GROUND = { x0: -32, x1: 92, z0: -72, z1: 72 };
export const KEEP = new THREE.Vector3(12, 0, 0);
export const QUAY_X = -32;
export const RUNWAY = { x: 70, z0: -26, z1: 26, width: 7 };

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function roundedRect(x0: number, x1: number, z0: number, z1: number, r: number, y = 0, steps = 6) {
  const pts: THREE.Vector3[] = [];
  const corner = (cx: number, cz: number, a0: number) => {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      pts.push(v(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r));
    }
  };
  corner(x1 - r, z1 - r, 0);
  corner(x0 + r, z1 - r, Math.PI / 2);
  corner(x0 + r, z0 + r, Math.PI);
  corner(x1 - r, z0 + r, Math.PI * 1.5);
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
}

export const ROAD = roundedRect(-22, 50, -34, 34, 10, 0.06);
export const RAIL = roundedRect(-27, 86, -58, 58, 18, 0.12, 8);

// Ships come in past the piers and loop out to sea.
export const SEA = new THREE.CatmullRomCurve3([
  v(-50, 0, -30), v(-62, 0, -78), v(-110, 0, -110), v(-170, 0, -70), v(-185, 0, 10),
  v(-160, 0, 90), v(-105, 0, 115), v(-62, 0, 80), v(-50, 0, 30), v(-47, 0, 0),
], true, 'centripetal');

// Take off down the runway, climb out, circle the realm, land again.
export const AIR = new THREE.CatmullRomCurve3([
  v(RUNWAY.x, 0.9, -20), v(RUNWAY.x, 1.2, 10), v(RUNWAY.x, 9, 40), v(80, 24, 85), v(20, 32, 110), v(-80, 34, 90),
  v(-130, 32, 0), v(-80, 32, -95), v(10, 30, -110), v(78, 22, -85), v(RUNWAY.x, 8, -50), v(RUNWAY.x, 1.2, -32),
], true, 'centripetal');

export const BALLOON_RING = { center: v(14, 0, 4), radius: 46 };

/** A flat strip of `width` following a curve, for roads and rails. */
export function ribbon(curve: THREE.Curve<THREE.Vector3>, width: number, segments = 400, lift = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const side = new THREE.Vector3().crossVectors(up, tan).normalize().multiplyScalar(width / 2);
    pos.push(p.x + side.x, p.y + lift, p.z + side.z, p.x - side.x, p.y + lift, p.z - side.z);
    if (i < segments) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Points spaced `every` units along a curve, with their tangents. */
export function along(curve: THREE.Curve<THREE.Vector3>, every: number) {
  const n = Math.floor(curve.getLength() / every);
  return Array.from({ length: n }, (_, i) => ({ p: curve.getPointAt(i / n), t: curve.getTangentAt(i / n) }));
}

export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const distToCurve = (curve: THREE.Curve<THREE.Vector3>, p: THREE.Vector3, samples: THREE.Vector3[]) => {
  void curve;
  let d = Infinity;
  for (const s of samples) d = Math.min(d, (s.x - p.x) ** 2 + (s.z - p.z) ** 2);
  return Math.sqrt(d);
};

const roadSamples = ROAD.getSpacedPoints(160);
const railSamples = RAIL.getSpacedPoints(220);

/** Is a ground spot free of roads, rails, the keep and the airfield? */
export function isFree(x: number, z: number, margin = 0) {
  const p = new THREE.Vector3(x, 0, z);
  if (x < GROUND.x0 + 3 || x > GROUND.x1 - 2 || z < GROUND.z0 + 2 || z > GROUND.z1 - 2) return false;
  if (p.distanceTo(KEEP) < 15 + margin) return false;
  if (x > RUNWAY.x - 10 && x < RUNWAY.x + 14 && z > RUNWAY.z0 - 8 && z < RUNWAY.z1 + 8) return false;
  if (distToCurve(ROAD, p, roadSamples) < 3.2 + margin) return false;
  if (distToCurve(RAIL, p, railSamples) < 3 + margin) return false;
  if (x < -10 && z > -40 && z < 40 && x > -30) return false; // warehouse strip
  return true;
}
