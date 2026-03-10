// Shared terrain height function and water detection
// CPU-side noise must match terrain.wgsl exactly for physics/rendering consistency

import { isOnAnyRoad, CITY_ROAD_X as _CITY_ROAD_X, CITY_ROAD_Z as _CITY_ROAD_Z } from './road-network';

export const WATER_LEVEL = -1;

// City center offset (city pushed south)
export const CITY_X = 0;
export const CITY_Z = 280;

// Mountain airport (in the northern mountains)
export const MT_AIRPORT_X = -350;
export const MT_AIRPORT_Z = -620;
export const MT_AIRPORT_Y = 55;
export const MT_RUNWAY_LENGTH = 200;

// Lake (nestled in the northern foothills)
export const LAKE_X = -200;
export const LAKE_Z = -480;
export const LAKE_RX = 110;
export const LAKE_RZ = 75;

// River path: flows from northern mountains, curves east around the city, heads south
export const RIVER_POINTS: [number, number][] = [
  [100, -750],
  [140, -620],
  [180, -480],
  [240, -350],
  [310, -200],
  [360, -50],
  [390, 100],
  [380, 250],
  [350, 400],
  [300, 550],
  [240, 700],
  [180, 850],
];

// Winding mountain road: city north edge up to mountain airport
export const MT_ROAD_POINTS: [number, number][] = [
  [CITY_X, CITY_Z - 250],       // exits city north edge
  [-20, -10],
  [-60, -100],
  [-30, -200],
  [-80, -290],
  [-150, -360],
  [-220, -420],
  [-280, -500],
  [-320, -560],
  [MT_AIRPORT_X, MT_AIRPORT_Z], // arrives at mountain airport
];

// Scenic lake road: branches off main mountain road toward the lake
export const LAKE_ROAD_POINTS: [number, number][] = [
  [-150, -360],      // branches from main road
  [-130, -400],
  [-140, -440],
  [-170, -470],
  [LAKE_X + LAKE_RX + 15, LAKE_Z], // lake eastern shore
];

export const MT_ROAD_WIDTH = 8;

// City airport (south of city, E-W runway)
export const CITY_AIRPORT_X = 0;
export const CITY_AIRPORT_Z = 680;

// Road positions derived from road network (backward compat)
export const CITY_ROAD_X: number[] = _CITY_ROAD_X;
export const CITY_ROAD_Z: number[] = _CITY_ROAD_Z;

// --- CPU noise functions matching terrain.wgsl ---

function hash2(px: number, py: number): number {
  const h = px * 127.1 + py * 311.7;
  return fract(Math.sin(h) * 43758.5453123);
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function valueNoise(px: number, py: number): number {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return mix(mix(a, b, ux), mix(c, d, ux), uy);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function fbm(px: number, py: number, octaves: number): number {
  let val = 0, amp = 0.5, freq = 1;
  let x = px, y = py;
  for (let i = 0; i < octaves; i++) {
    val += valueNoise(x * freq, y * freq) * amp;
    freq *= 2.17;
    amp *= 0.48;
    const nx = x * 0.866 - y * 0.5;
    const ny = x * 0.5 + y * 0.866;
    x = nx;
    y = ny;
  }
  return val;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Distance from point to nearest segment in a path, returns [dist, t_along_path (0-1)]
function distanceToPath(x: number, z: number, points: [number, number][]): [number, number] {
  let minDist = Infinity;
  let bestT = 0;
  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    const dz = points[i + 1][1] - points[i][1];
    segLens.push(Math.sqrt(dx * dx + dz * dz));
    totalLen += segLens[i];
  }
  let cumLen = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = ((x - ax) * dx + (z - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx, pz = az + t * dz;
    const dist = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
    if (dist < minDist) {
      minDist = dist;
      bestT = (cumLen + t * segLens[i]) / totalLen;
    }
    cumLen += segLens[i];
  }
  return [minDist, bestT];
}

function distanceToRiverPath(x: number, z: number): number {
  return distanceToPath(x, z, RIVER_POINTS)[0];
}

// Mountain road: returns [distance, elevation_at_nearest_point]
function distanceToMountainRoad(x: number, z: number): [number, number] {
  // Check both road segments
  const [d1, t1] = distanceToPath(x, z, MT_ROAD_POINTS);
  const [d2, t2] = distanceToPath(x, z, LAKE_ROAD_POINTS);

  // Road elevation interpolates from 0 (city) to MT_AIRPORT_Y
  const elev1 = t1 * MT_AIRPORT_Y;
  // Lake road goes from ~mid-elevation to lake level
  const elev2 = mix(MT_ROAD_POINTS[0][1] < -300 ? 20 : 0, 15, t2);

  if (d1 < d2) return [d1, elev1];
  return [d2, elev2];
}

export function isOnMountainRoad(x: number, z: number): boolean {
  const [dist] = distanceToMountainRoad(x, z);
  return dist < MT_ROAD_WIDTH / 2;
}

export function getMountainRoadHeight(x: number, z: number): number {
  const [dist, elev] = distanceToMountainRoad(x, z);
  if (dist < MT_ROAD_WIDTH / 2) return elev + 0.02;
  return -999; // not on road
}

export function isOnBoulevard(x: number, z: number): boolean {
  return isOnAnyRoad(x, z);
}

export function getTerrainHeight(x: number, z: number): number {
  // 1. City flat mask centered on CITY_X, CITY_Z
  const dxCity = x - CITY_X, dzCity = z - CITY_Z;
  const distFromCity = Math.sqrt(dxCity * dxCity + dzCity * dzCity);
  const cityMask = smoothstep(280, 420, distFromCity);

  // 2. Mountains concentrated in the NORTH (negative Z)
  const northness = smoothstep(0, -500, z);
  const distFromCenter = Math.sqrt(x * x + z * z);
  const mountainMask = smoothstep(350, 650, distFromCenter) * northness;
  const ridgeBias = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(x * 0.005 + 1.3));

  // 3. Mountain height from FBM
  const mountainNoise = fbm(x * 0.003, z * 0.003, 6);
  const mountainHeight = mountainMask * ridgeBias * mountainNoise * 170;

  // 4. Northern foothills
  const foothillMask = smoothstep(300, 450, distFromCenter) * smoothstep(-100, -350, z) * (1 - mountainMask);
  const hillNoise = fbm(x * 0.008, z * 0.008, 4);
  const foothillHeight = foothillMask * hillNoise * 20;

  // 5. Gentle southern countryside
  const southMask = smoothstep(distFromCity > 300 ? 300 : 9999, 500, distFromCity) * smoothstep(CITY_Z + 50, CITY_Z + 300, z);
  const southHills = southMask * fbm(x * 0.006, z * 0.006, 3) * 8;

  // 6. Combine
  let height = (mountainHeight + foothillHeight + southHills) * cityMask;

  // 7. Mountain road: flatten terrain along the road with gradual elevation
  const [mtRoadDist, mtRoadElev] = distanceToMountainRoad(x, z);
  if (mtRoadDist < MT_ROAD_WIDTH / 2 + 20) {
    const roadFlatten = smoothstep(MT_ROAD_WIDTH / 2 + 20, MT_ROAD_WIDTH / 2, mtRoadDist);
    height = mix(height, mtRoadElev, roadFlatten);
  }

  // 8. River valley carving
  const riverDist = distanceToRiverPath(x, z);
  const riverWidth = 14;
  const riverValley = smoothstep(riverWidth + 25, riverWidth, riverDist) * 8;
  const riverBed = smoothstep(riverWidth, riverWidth - 6, riverDist) * 4;
  height -= riverValley;
  height -= riverBed;

  // 9. Lake depression
  const lakeNormDist = Math.sqrt(
    ((x - LAKE_X) / LAKE_RX) ** 2 +
    ((z - LAKE_Z) / LAKE_RZ) ** 2
  );
  if (lakeNormDist < 1.5) {
    const lakeDip = smoothstep(1.4, 0.0, lakeNormDist) * 10;
    height -= lakeDip;
  }

  // 10. Mountain airport plateau
  const apDx = Math.abs(x - MT_AIRPORT_X) / 110;
  const apDz = Math.abs(z - MT_AIRPORT_Z) / 160;
  const apDist = Math.max(apDx, apDz);
  if (apDist < 1.3) {
    const flattenAmount = smoothstep(1.3, 0.85, apDist);
    height = mix(height, MT_AIRPORT_Y, flattenAmount);
  }

  // 11. City airport flattening (south of city, E-W runway)
  const cityApDist = Math.max(
    Math.abs(x - CITY_AIRPORT_X) / 210,
    Math.abs(z - CITY_AIRPORT_Z) / 130
  );
  if (cityApDist < 1.3) {
    const flattenAmount = smoothstep(1.3, 0.85, cityApDist);
    height = mix(height, 0, flattenAmount);
  }

  return height;
}

export function isWater(x: number, z: number): boolean {
  const riverDist = distanceToRiverPath(x, z);
  if (riverDist < 12) {
    const h = getTerrainHeight(x, z);
    if (h < WATER_LEVEL + 0.5) return true;
  }

  const lakeNormDist = Math.sqrt(
    ((x - LAKE_X) / LAKE_RX) ** 2 +
    ((z - LAKE_Z) / LAKE_RZ) ** 2
  );
  if (lakeNormDist < 1.0) return true;

  return false;
}
