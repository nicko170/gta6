// Road network graph: replaces the rigid grid with an organic city layout
// Nodes = intersections, Segments = roads between them
// Downtown has a perturbed grid, outer areas have curves, cul-de-sacs, variety

// --- Types ---

export interface RoadNode {
  id: string;
  x: number;
  z: number;
  connections: string[]; // segment ids
}

export interface RoadSegment {
  id: string;
  from: string;
  to: string;
  waypoints: [number, number][]; // intermediate curve points (empty = straight line)
  width: number;
  isCulDeSac: boolean;
}

export type DistrictType = 'downtown' | 'midtown' | 'residential' | 'waterfront' | 'industrial' | 'park';

export interface District {
  type: DistrictType;
  center: [number, number];
  radius: number;
  minHeight: number;
  maxHeight: number;
  density: number; // 0-1
  hasYards: boolean;
}

// --- City center (same as terrain.ts, duplicated to avoid circular deps) ---
const CX = 0;
const CZ = 280;

// --- Seeded random ---
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// --- Distance to polyline path (duplicated from terrain.ts to avoid circular deps) ---
function distToPath(x: number, z: number, points: [number, number][]): [number, number] {
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
    if (len2 < 0.001) { cumLen += segLens[i]; continue; }
    let t = ((x - ax) * dx + (z - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx, pz = az + t * dz;
    const dist = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
    if (dist < minDist) {
      minDist = dist;
      bestT = totalLen > 0 ? (cumLen + t * segLens[i]) / totalLen : 0;
    }
    cumLen += segLens[i];
  }
  return [minDist, bestT];
}

// --- Build the road network ---

const nodes: Map<string, RoadNode> = new Map();
const segments: Map<string, RoadSegment> = new Map();
let segCounter = 0;

function addNode(id: string, x: number, z: number): RoadNode {
  const node: RoadNode = { id, x, z, connections: [] };
  nodes.set(id, node);
  return node;
}

function addSeg(fromId: string, toId: string, width: number, waypoints: [number, number][] = [], culDeSac = false): RoadSegment {
  const id = `seg_${segCounter++}`;
  const seg: RoadSegment = { id, from: fromId, to: toId, waypoints, width, isCulDeSac: culDeSac };
  segments.set(id, seg);
  const fromNode = nodes.get(fromId)!;
  const toNode = nodes.get(toId)!;
  fromNode.connections.push(id);
  toNode.connections.push(id);
  return seg;
}

function generate() {
  const rng = seededRandom(314);
  const perturb = (base: number, amount: number) => base + (rng() - 0.5) * amount;

  // ========================================
  // DOWNTOWN CORE - 5x5 perturbed grid
  // ========================================
  const dtX = [-120, -58, 0, 58, 120];
  const dtZ = [185, 232, 280, 328, 375];
  const dtIds: string[][] = [];

  for (let row = 0; row < 5; row++) {
    dtIds[row] = [];
    for (let col = 0; col < 5; col++) {
      // Perturb inner nodes more, keep edges more regular
      const isEdge = row === 0 || row === 4 || col === 0 || col === 4;
      const amt = isEdge ? 8 : 14;
      const id = `dt_${row}_${col}`;
      addNode(id, perturb(dtX[col], amt), perturb(dtZ[row], amt));
      dtIds[row][col] = id;
    }
  }

  // Downtown horizontal connections
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 4; col++) {
      // Skip one to create a larger block (park area)
      if (row === 1 && col === 1) continue;
      addSeg(dtIds[row][col], dtIds[row][col + 1], 14);
    }
  }

  // Downtown vertical connections
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      // Skip a couple to create irregular blocks
      if (row === 0 && col === 1) continue; // merges with park
      if (row === 3 && col === 3) continue; // creates T-intersection
      addSeg(dtIds[row][col], dtIds[row + 1][col], 14);
    }
  }

  // ========================================
  // DIAGONAL BOULEVARDS through downtown
  // ========================================
  // Main boulevard: SW to NE through city center
  const blvdSW = addNode('blvd_sw', CX - 260, CZ + 220);
  const blvdNE = addNode('blvd_ne', CX + 230, CZ - 220);
  // Connect through existing downtown nodes near center
  addSeg('blvd_sw', dtIds[3][0], 18);
  addSeg(dtIds[3][0], dtIds[2][2], 18); // cuts diagonal through grid
  addSeg(dtIds[2][2], dtIds[1][4], 18);
  addSeg(dtIds[1][4], 'blvd_ne', 18);

  // Secondary avenue: SE to NW
  const aveSE = addNode('ave_se', CX + 240, CZ + 190);
  const aveNW = addNode('ave_nw', CX - 230, CZ - 140);
  addSeg('ave_se', dtIds[3][4], 16);
  addSeg(dtIds[3][4], dtIds[2][2], 16);
  addSeg(dtIds[2][2], dtIds[1][0], 16);
  addSeg(dtIds[1][0], 'ave_nw', 16);

  // ========================================
  // MIDTOWN RING - extends from downtown edges
  // ========================================

  // West midtown
  const mw0 = addNode('mw_0', perturb(-195, 10), perturb(175, 8));
  const mw1 = addNode('mw_1', perturb(-195, 10), perturb(250, 8));
  const mw2 = addNode('mw_2', perturb(-195, 10), perturb(330, 8));
  const mw3 = addNode('mw_3', perturb(-190, 10), perturb(410, 8));
  addSeg('mw_0', 'mw_1', 12);
  addSeg('mw_1', 'mw_2', 12);
  addSeg('mw_2', 'mw_3', 12);
  // Connect to downtown west edge
  addSeg('mw_0', dtIds[0][0], 12);
  addSeg('mw_1', dtIds[1][0], 12);
  addSeg('mw_2', dtIds[3][0], 12);
  addSeg('mw_3', dtIds[4][0], 12);

  // East midtown
  const me0 = addNode('me_0', perturb(195, 10), perturb(175, 8));
  const me1 = addNode('me_1', perturb(195, 10), perturb(250, 8));
  const me2 = addNode('me_2', perturb(195, 10), perturb(330, 8));
  const me3 = addNode('me_3', perturb(190, 10), perturb(410, 8));
  addSeg('me_0', 'me_1', 12);
  addSeg('me_1', 'me_2', 12);
  addSeg('me_2', 'me_3', 12);
  // Connect to downtown east edge
  addSeg('me_0', dtIds[0][4], 12);
  addSeg('me_1', dtIds[1][4], 12);
  addSeg('me_2', dtIds[3][4], 12);
  addSeg('me_3', dtIds[4][4], 12);

  // North midtown
  const mn0 = addNode('mn_0', perturb(-120, 8), perturb(120, 8));
  const mn1 = addNode('mn_1', perturb(-30, 8), perturb(115, 8));
  const mn2 = addNode('mn_2', perturb(50, 8), perturb(118, 8));
  const mn3 = addNode('mn_3', perturb(125, 8), perturb(122, 8));
  addSeg('mn_0', 'mn_1', 12);
  addSeg('mn_1', 'mn_2', 12);
  addSeg('mn_2', 'mn_3', 12);
  // Connect to downtown north edge
  addSeg('mn_0', dtIds[0][0], 12);
  addSeg('mn_1', dtIds[0][1], 12);
  addSeg('mn_2', dtIds[0][3], 12);
  addSeg('mn_3', dtIds[0][4], 12);
  // Connect midtown corners
  addSeg('mn_0', 'mw_0', 12);
  addSeg('mn_3', 'me_0', 12);

  // South midtown
  const ms0 = addNode('ms_0', perturb(-120, 8), perturb(435, 8));
  const ms1 = addNode('ms_1', perturb(-30, 8), perturb(440, 8));
  const ms2 = addNode('ms_2', perturb(50, 8), perturb(438, 8));
  const ms3 = addNode('ms_3', perturb(125, 8), perturb(432, 8));
  addSeg('ms_0', 'ms_1', 12);
  addSeg('ms_1', 'ms_2', 12);
  addSeg('ms_2', 'ms_3', 12);
  addSeg('ms_0', dtIds[4][0], 12);
  addSeg('ms_1', dtIds[4][1], 12);
  addSeg('ms_2', dtIds[4][3], 12);
  addSeg('ms_3', dtIds[4][4], 12);
  addSeg('ms_0', 'mw_3', 12);
  addSeg('ms_3', 'me_3', 12);

  // ========================================
  // RESIDENTIAL NW - curved streets
  // ========================================
  const rnw_entry = addNode('rnw_entry', perturb(-210, 6), perturb(140, 6));
  const rnw_col1 = addNode('rnw_col1', perturb(-250, 8), perturb(110, 8));
  const rnw_col2 = addNode('rnw_col2', perturb(-280, 8), perturb(70, 8));
  const rnw_col3 = addNode('rnw_col3', perturb(-300, 8), perturb(30, 8));

  // Collector road curves from midtown NW corner
  addSeg('mw_0', 'rnw_entry', 10);
  addSeg('rnw_entry', 'rnw_col1', 9, [[-230, 125]]);
  addSeg('rnw_col1', 'rnw_col2', 9, [[-268, 88]]);
  addSeg('rnw_col2', 'rnw_col3', 9, [[-295, 48]]);

  // Branch streets off collector
  const rnw_b1a = addNode('rnw_b1a', perturb(-220, 6), perturb(80, 6));
  const rnw_b1b = addNode('rnw_b1b', perturb(-210, 6), perturb(50, 6));
  addSeg('rnw_col1', 'rnw_b1a', 8, [[-235, 95]]);
  addSeg('rnw_b1a', 'rnw_b1b', 8);

  const rnw_b2a = addNode('rnw_b2a', perturb(-310, 6), perturb(100, 6));
  const rnw_b2b = addNode('rnw_b2b', perturb(-330, 6), perturb(120, 6)); // cul-de-sac
  addSeg('rnw_col2', 'rnw_b2a', 8, [[-298, 88]]);
  addSeg('rnw_b2a', 'rnw_b2b', 8, [], true);

  const rnw_b3a = addNode('rnw_b3a', perturb(-265, 6), perturb(20, 6));
  const rnw_b3b = addNode('rnw_b3b', perturb(-240, 6), perturb(-10, 6)); // cul-de-sac
  addSeg('rnw_col3', 'rnw_b3a', 8);
  addSeg('rnw_b3a', 'rnw_b3b', 8, [], true);

  // Loop street connecting back
  const rnw_loop = addNode('rnw_loop', perturb(-235, 6), perturb(140, 6));
  addSeg('rnw_entry', 'rnw_loop', 8);
  addSeg('rnw_loop', 'rnw_b1a', 8, [[-225, 110]]);

  // Another small residential area north of midtown
  const rnw_n1 = addNode('rnw_n1', perturb(-70, 6), perturb(75, 6));
  const rnw_n2 = addNode('rnw_n2', perturb(-100, 6), perturb(50, 6));
  const rnw_n3 = addNode('rnw_n3', perturb(-50, 6), perturb(45, 6)); // cul-de-sac
  addSeg('mn_0', 'rnw_n1', 9, [[-95, 100]]);
  addSeg('rnw_n1', 'rnw_n2', 8);
  addSeg('rnw_n1', 'rnw_n3', 8, [], true);

  // ========================================
  // RESIDENTIAL SE - curved streets
  // ========================================
  const rse_entry = addNode('rse_entry', perturb(155, 6), perturb(450, 6));
  const rse_col1 = addNode('rse_col1', perturb(190, 8), perturb(480, 8));
  const rse_col2 = addNode('rse_col2', perturb(210, 8), perturb(510, 8));

  addSeg('me_3', 'rse_entry', 10);
  addSeg('rse_entry', 'rse_col1', 9, [[-173 + 345, 465]]);
  addSeg('rse_col1', 'rse_col2', 9, [[200, 498]]);

  // Branch streets
  const rse_b1a = addNode('rse_b1a', perturb(230, 6), perturb(470, 6));
  const rse_b1b = addNode('rse_b1b', perturb(260, 6), perturb(458, 6)); // cul-de-sac
  addSeg('rse_col1', 'rse_b1a', 8);
  addSeg('rse_b1a', 'rse_b1b', 8, [], true);

  const rse_b2a = addNode('rse_b2a', perturb(175, 6), perturb(520, 6));
  const rse_b2b = addNode('rse_b2b', perturb(150, 6), perturb(545, 6)); // cul-de-sac
  addSeg('rse_col2', 'rse_b2a', 8);
  addSeg('rse_b2a', 'rse_b2b', 8, [], true);

  // Loop back from col2 toward midtown south
  const rse_loop = addNode('rse_loop', perturb(130, 6), perturb(490, 6));
  addSeg('rse_col2', 'rse_loop', 8, [[170, 505]]);
  addSeg('rse_loop', 'ms_3', 9, [[128, 460]]);

  // ========================================
  // WATERFRONT - promenade along east side
  // ========================================
  const wf0 = addNode('wf_0', perturb(250, 6), perturb(150, 6));
  const wf1 = addNode('wf_1', perturb(260, 6), perturb(220, 6));
  const wf2 = addNode('wf_2', perturb(255, 6), perturb(290, 6));
  const wf3 = addNode('wf_3', perturb(260, 6), perturb(360, 6));
  const wf4 = addNode('wf_4', perturb(250, 6), perturb(420, 6));

  // Promenade (gentle curves following river direction)
  addSeg('wf_0', 'wf_1', 12, [[258, 185]]);
  addSeg('wf_1', 'wf_2', 12, [[262, 255]]);
  addSeg('wf_2', 'wf_3', 12, [[260, 325]]);
  addSeg('wf_3', 'wf_4', 12, [[258, 390]]);

  // Access roads connecting promenade to east midtown
  addSeg('wf_0', 'me_0', 10);
  addSeg('wf_1', 'me_1', 10);
  addSeg('wf_3', 'me_2', 10);
  addSeg('wf_4', 'me_3', 10);

  // ========================================
  // INDUSTRIAL - south, near airport
  // ========================================
  const ind0 = addNode('ind_0', perturb(-100, 6), perturb(510, 6));
  const ind1 = addNode('ind_1', perturb(40, 6), perturb(515, 6));
  const ind2 = addNode('ind_2', perturb(-100, 6), perturb(580, 6));
  const ind3 = addNode('ind_3', perturb(40, 6), perturb(585, 6));
  const ind4 = addNode('ind_4', perturb(-30, 6), perturb(630, 6));

  // Industrial grid (sparse, wide roads)
  addSeg('ind_0', 'ind_1', 16);
  addSeg('ind_0', 'ind_2', 16);
  addSeg('ind_1', 'ind_3', 16);
  addSeg('ind_2', 'ind_3', 16);
  addSeg('ind_2', 'ind_4', 14);
  addSeg('ind_3', 'ind_4', 14);

  // Connect to midtown south
  addSeg('ms_0', 'ind_0', 14);
  addSeg('ms_2', 'ind_1', 14);

  // ========================================
  // CENTRAL PARK connections
  // Park is the merged block at downtown row 0-1, col 1-2
  // The missing segments there (dt row 1 col 1-2 horizontal, dt row 0-1 col 1 vertical)
  // already create a larger open block. Add a road around it.
  // ========================================
  // The park is bounded by dt_0_0, dt_0_2, dt_1_0, dt_1_2 (since dt_0_1 to dt_1_1
  // and dt_1_1 to dt_1_2 segments are missing, creating one big block)
  // We connect dt_0_2 to dt_1_2 to close the park boundary on the east
  addSeg(dtIds[0][2], dtIds[1][2], 12);
}

generate();

// ========================================
// DISTRICTS
// ========================================
export const DISTRICTS: District[] = [
  {
    type: 'downtown',
    center: [CX, CZ],
    radius: 110,
    minHeight: 25, maxHeight: 95,
    density: 0.9,
    hasYards: false,
  },
  {
    type: 'midtown',
    center: [CX, CZ],
    radius: 220,
    minHeight: 10, maxHeight: 35,
    density: 0.7,
    hasYards: false,
  },
  {
    type: 'residential',
    center: [-260, 80],
    radius: 120,
    minHeight: 3, maxHeight: 8,
    density: 0.5,
    hasYards: true,
  },
  {
    type: 'residential',
    center: [-70, 55],
    radius: 70,
    minHeight: 3, maxHeight: 8,
    density: 0.5,
    hasYards: true,
  },
  {
    type: 'residential',
    center: [190, 490],
    radius: 100,
    minHeight: 3, maxHeight: 8,
    density: 0.5,
    hasYards: true,
  },
  {
    type: 'waterfront',
    center: [255, 280],
    radius: 80,
    minHeight: 8, maxHeight: 25,
    density: 0.4,
    hasYards: false,
  },
  {
    type: 'industrial',
    center: [-30, 560],
    radius: 110,
    minHeight: 6, maxHeight: 15,
    density: 0.5,
    hasYards: false,
  },
  {
    type: 'park',
    center: [-60, 208],
    radius: 55,
    minHeight: 0, maxHeight: 0,
    density: 0,
    hasYards: false,
  },
];

export function getDistrictAt(x: number, z: number): District {
  // Park has highest priority (smallest, most specific)
  const parkDist = DISTRICTS.find(d => d.type === 'park')!;
  const dpx = x - parkDist.center[0], dpz = z - parkDist.center[1];
  if (Math.sqrt(dpx * dpx + dpz * dpz) < parkDist.radius) return parkDist;

  // Check specific districts (residential, waterfront, industrial) before midtown fallback
  let best: District | null = null;
  let bestScore = Infinity;

  for (const d of DISTRICTS) {
    if (d.type === 'park') continue;
    if (d.type === 'midtown') continue; // midtown is fallback
    const dx = x - d.center[0], dz = z - d.center[1];
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < d.radius) {
      // Closer to center = higher priority
      const score = dist / d.radius;
      if (score < bestScore) {
        bestScore = score;
        best = d;
      }
    }
  }

  if (best) return best;

  // Fallback to midtown if within midtown radius
  const midtown = DISTRICTS.find(d => d.type === 'midtown')!;
  const mdx = x - midtown.center[0], mdz = z - midtown.center[1];
  if (Math.sqrt(mdx * mdx + mdz * mdz) < midtown.radius) return midtown;

  // Outside all districts
  return midtown; // default
}

// ========================================
// SPATIAL HASH for fast isOnAnyRoad queries
// ========================================

const CELL_SIZE = 25;
let hashMinX = 0, hashMinZ = 0, hashCols = 0, hashRows = 0;
const spatialHash: number[][] = []; // cell index -> segment indices
const segmentArray: RoadSegment[] = [];
const nodeArray: RoadNode[] = [];

function buildSpatialHash() {
  // Collect all segments and nodes into arrays
  for (const seg of segments.values()) segmentArray.push(seg);
  for (const node of nodes.values()) nodeArray.push(node);

  // Find bounds from all node positions + waypoints
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const node of nodes.values()) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minZ = Math.min(minZ, node.z);
    maxZ = Math.max(maxZ, node.z);
  }
  for (const seg of segments.values()) {
    for (const [wx, wz] of seg.waypoints) {
      minX = Math.min(minX, wx);
      maxX = Math.max(maxX, wx);
      minZ = Math.min(minZ, wz);
      maxZ = Math.max(maxZ, wz);
    }
  }

  // Add padding for road width
  minX -= 20; minZ -= 20;
  maxX += 20; maxZ += 20;

  hashMinX = minX;
  hashMinZ = minZ;
  hashCols = Math.ceil((maxX - minX) / CELL_SIZE);
  hashRows = Math.ceil((maxZ - minZ) / CELL_SIZE);

  for (let i = 0; i < hashCols * hashRows; i++) {
    spatialHash.push([]);
  }

  // For each segment, find which cells it overlaps
  for (let si = 0; si < segmentArray.length; si++) {
    const seg = segmentArray[si];
    const pts = getSegmentPoints(seg);

    // Get AABB of segment
    let sMinX = Infinity, sMaxX = -Infinity, sMinZ = Infinity, sMaxZ = -Infinity;
    for (const [px, pz] of pts) {
      sMinX = Math.min(sMinX, px);
      sMaxX = Math.max(sMaxX, px);
      sMinZ = Math.min(sMinZ, pz);
      sMaxZ = Math.max(sMaxZ, pz);
    }
    // Expand by road half-width
    const hw = seg.width / 2 + 2;
    sMinX -= hw; sMaxX += hw;
    sMinZ -= hw; sMaxZ += hw;

    const c0 = Math.max(0, Math.floor((sMinX - hashMinX) / CELL_SIZE));
    const c1 = Math.min(hashCols - 1, Math.floor((sMaxX - hashMinX) / CELL_SIZE));
    const r0 = Math.max(0, Math.floor((sMinZ - hashMinZ) / CELL_SIZE));
    const r1 = Math.min(hashRows - 1, Math.floor((sMaxZ - hashMinZ) / CELL_SIZE));

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        spatialHash[r * hashCols + c].push(si);
      }
    }
  }
}

buildSpatialHash();

// ========================================
// QUERY FUNCTIONS
// ========================================

export function getSegmentPoints(seg: RoadSegment): [number, number][] {
  const fromNode = nodes.get(seg.from)!;
  const toNode = nodes.get(seg.to)!;
  return [[fromNode.x, fromNode.z], ...seg.waypoints, [toNode.x, toNode.z]];
}

export function getSegmentLength(seg: RoadSegment): number {
  const pts = getSegmentPoints(seg);
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dz = pts[i + 1][1] - pts[i][1];
    len += Math.sqrt(dx * dx + dz * dz);
  }
  return len;
}

/** Get position at progress t (0-1) along segment */
export function getPointAlongSegment(seg: RoadSegment, t: number): [number, number] {
  const pts = getSegmentPoints(seg);
  const totalLen = getSegmentLength(seg);
  const targetDist = t * totalLen;

  let cumDist = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dz = pts[i + 1][1] - pts[i][1];
    const segLen = Math.sqrt(dx * dx + dz * dz);
    if (cumDist + segLen >= targetDist && segLen > 0) {
      const localT = (targetDist - cumDist) / segLen;
      return [pts[i][0] + dx * localT, pts[i][1] + dz * localT];
    }
    cumDist += segLen;
  }
  return [pts[pts.length - 1][0], pts[pts.length - 1][1]];
}

/** Get tangent direction (unit vector) at progress t along segment */
export function getTangentAlongSegment(seg: RoadSegment, t: number): [number, number] {
  const pts = getSegmentPoints(seg);
  const totalLen = getSegmentLength(seg);
  const targetDist = t * totalLen;

  let cumDist = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dz = pts[i + 1][1] - pts[i][1];
    const segLen = Math.sqrt(dx * dx + dz * dz);
    if (cumDist + segLen >= targetDist && segLen > 0) {
      return [dx / segLen, dz / segLen];
    }
    cumDist += segLen;
  }
  // Fallback: use last sub-segment direction
  const n = pts.length;
  if (n >= 2) {
    const dx = pts[n - 1][0] - pts[n - 2][0];
    const dz = pts[n - 1][1] - pts[n - 2][1];
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0) return [dx / len, dz / len];
  }
  return [1, 0];
}

/** Check if a point is on any road in the network */
export function isOnAnyRoad(x: number, z: number): boolean {
  const col = Math.floor((x - hashMinX) / CELL_SIZE);
  const row = Math.floor((z - hashMinZ) / CELL_SIZE);
  if (col < 0 || col >= hashCols || row < 0 || row >= hashRows) return false;

  const cell = spatialHash[row * hashCols + col];
  for (const si of cell) {
    const seg = segmentArray[si];
    const pts = getSegmentPoints(seg);
    const [dist] = distToPath(x, z, pts);
    if (dist < seg.width / 2) return true;
  }
  return false;
}

/** Get the road segment and distance for a point (for ground height calculations) */
export function getNearestRoad(x: number, z: number): { segment: RoadSegment; dist: number; t: number } | null {
  const col = Math.floor((x - hashMinX) / CELL_SIZE);
  const row = Math.floor((z - hashMinZ) / CELL_SIZE);
  if (col < 0 || col >= hashCols || row < 0 || row >= hashRows) return null;

  let best: { segment: RoadSegment; dist: number; t: number } | null = null;
  const cell = spatialHash[row * hashCols + col];
  for (const si of cell) {
    const seg = segmentArray[si];
    const pts = getSegmentPoints(seg);
    const [dist, t] = distToPath(x, z, pts);
    if (dist < seg.width / 2 && (!best || dist < best.dist)) {
      best = { segment: seg, dist, t };
    }
  }
  return best;
}

// ========================================
// EXPORTED DATA
// ========================================

export const ROAD_NODES: RoadNode[] = nodeArray;
export const ROAD_SEGMENTS: RoadSegment[] = segmentArray;

export function getNodeById(id: string): RoadNode | undefined {
  return nodes.get(id);
}

export function getSegmentById(id: string): RoadSegment | undefined {
  return segments.get(id);
}

/** Get all segments connected to a node */
export function getConnectedSegments(nodeId: string): RoadSegment[] {
  const node = nodes.get(nodeId);
  if (!node) return [];
  return node.connections.map(sid => segments.get(sid)!).filter(Boolean);
}

/** Get the other node at the end of a segment */
export function getOtherNode(seg: RoadSegment, nodeId: string): RoadNode | undefined {
  const otherId = seg.from === nodeId ? seg.to : seg.from;
  return nodes.get(otherId);
}

/** Get all non-dead-end segments (for AI car spawning) */
export function getNonDeadEndSegments(): RoadSegment[] {
  return segmentArray.filter(s => !s.isCulDeSac);
}

// ========================================
// BACKWARD COMPATIBILITY
// Derive approximate CITY_ROAD_X/Z from downtown grid nodes
// ========================================
export const CITY_ROAD_X: number[] = [];
export const CITY_ROAD_Z: number[] = [];

{
  // Collect unique X and Z positions from downtown nodes
  const xs = new Set<number>();
  const zs = new Set<number>();
  for (const [id, node] of nodes) {
    if (id.startsWith('dt_')) {
      xs.add(Math.round(node.x));
      zs.add(Math.round(node.z));
    }
  }
  CITY_ROAD_X.push(...Array.from(xs).sort((a, b) => a - b));
  CITY_ROAD_Z.push(...Array.from(zs).sort((a, b) => a - b));
}
