// Procedural mesh generation utilities

export interface MeshData {
  vertices: Float32Array;
  indices: Uint32Array;
}

// vertex: [px, py, pz, nx, ny, nz, u, v, r, g, b, a]
function vertex(px: number, py: number, pz: number, nx: number, ny: number, nz: number, u: number, v: number, r: number, g: number, b: number, a = 1): number[] {
  return [px, py, pz, nx, ny, nz, u, v, r, g, b, a];
}

export function createBox(w: number, h: number, d: number, r: number, g: number, b: number): MeshData {
  const hw = w/2, hh = h/2, hd = d/2;
  const verts: number[] = [];
  const idx: number[] = [];

  const faces: [number,number,number, number,number,number, number,number,number, number,number,number, number,number,number][] = [
    // front
    [-hw,-hh,hd, hw,-hh,hd, hw,hh,hd, -hw,hh,hd, 0,0,1],
    // back
    [hw,-hh,-hd, -hw,-hh,-hd, -hw,hh,-hd, hw,hh,-hd, 0,0,-1],
    // top
    [-hw,hh,hd, hw,hh,hd, hw,hh,-hd, -hw,hh,-hd, 0,1,0],
    // bottom
    [-hw,-hh,-hd, hw,-hh,-hd, hw,-hh,hd, -hw,-hh,hd, 0,-1,0],
    // right
    [hw,-hh,hd, hw,-hh,-hd, hw,hh,-hd, hw,hh,hd, 1,0,0],
    // left
    [-hw,-hh,-hd, -hw,-hh,hd, -hw,hh,hd, -hw,hh,-hd, -1,0,0],
  ];

  for (const f of faces) {
    const base = verts.length / 12;
    const [x0,y0,z0, x1,y1,z1, x2,y2,z2, x3,y3,z3, nx,ny,nz] = f;
    verts.push(...vertex(x0,y0,z0, nx,ny,nz, 0,0, r,g,b));
    verts.push(...vertex(x1,y1,z1, nx,ny,nz, 1,0, r,g,b));
    verts.push(...vertex(x2,y2,z2, nx,ny,nz, 1,1, r,g,b));
    verts.push(...vertex(x3,y3,z3, nx,ny,nz, 0,1, r,g,b));
    idx.push(base, base+1, base+2, base, base+2, base+3);
  }

  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

export function createPlane(w: number, d: number, r: number, g: number, b: number, segsX = 1, segsZ = 1): MeshData {
  const verts: number[] = [];
  const idx: number[] = [];
  const hw = w/2, hd = d/2;

  for (let iz = 0; iz <= segsZ; iz++) {
    for (let ix = 0; ix <= segsX; ix++) {
      const x = (ix / segsX - 0.5) * w;
      const z = (iz / segsZ - 0.5) * d;
      const u = ix / segsX;
      const v = iz / segsZ;
      verts.push(...vertex(x, 0, z, 0, 1, 0, u, v, r, g, b));
    }
  }

  for (let iz = 0; iz < segsZ; iz++) {
    for (let ix = 0; ix < segsX; ix++) {
      const a = iz * (segsX + 1) + ix;
      const b2 = a + 1;
      const c = a + segsX + 1;
      const d2 = c + 1;
      idx.push(a, c, b2, b2, c, d2);
    }
  }

  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

export function applyHeightmap(
  mesh: MeshData,
  getHeight: (x: number, z: number) => number,
  getColor?: (x: number, z: number, h: number, slopeX: number, slopeZ: number) => [number, number, number] | null
): void {
  const v = mesh.vertices;
  const stride = 12;
  const eps = 1.0;

  // Pass 1: Set heights and optionally colors
  for (let i = 0; i < v.length; i += stride) {
    const px = v[i], pz = v[i + 2];
    const h = getHeight(px, pz);
    v[i + 1] = h;

    if (getColor) {
      const hpx = getHeight(px + eps, pz);
      const hmx = getHeight(px - eps, pz);
      const hpz = getHeight(px, pz + eps);
      const hmz = getHeight(px, pz - eps);
      const slopeX = (hpx - hmx) / (2 * eps);
      const slopeZ = (hpz - hmz) / (2 * eps);
      const c = getColor(px, pz, h, slopeX, slopeZ);
      if (c) {
        v[i + 8] = c[0];
        v[i + 9] = c[1];
        v[i + 10] = c[2];
      }
    }
  }

  // Pass 2: Recompute normals via finite differences
  for (let i = 0; i < v.length; i += stride) {
    const px = v[i], pz = v[i + 2];
    const hpx = getHeight(px + eps, pz);
    const hmx = getHeight(px - eps, pz);
    const hpz = getHeight(px, pz + eps);
    const hmz = getHeight(px, pz - eps);
    // Tangent vectors
    const tx = 2 * eps, ty1 = hpx - hmx, tz1 = 0;
    const tx2 = 0, ty2 = hpz - hmz, tz2 = 2 * eps;
    // Normal = cross(tangentZ, tangentX) — up-facing for flat terrain
    let nx = tz1 * ty2 - ty1 * tz2;
    let ny = tx * tz2 - tz1 * tx2;
    let nz = ty1 * tx2 - tx * ty2;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    v[i + 3] = nx / len;
    v[i + 4] = ny / len;
    v[i + 5] = nz / len;
  }
}

export function createCylinder(radius: number, height: number, segments: number, r: number, g: number, b: number): MeshData {
  const verts: number[] = [];
  const idx: number[] = [];
  const hh = height / 2;

  // Side
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const u = i / segments;
    verts.push(...vertex(x, -hh, z, nx, 0, nz, u, 0, r, g, b));
    verts.push(...vertex(x, hh, z, nx, 0, nz, u, 1, r, g, b));
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    idx.push(a, a+2, a+1, a+1, a+2, a+3);
  }

  // Top and bottom caps
  const topCenter = verts.length / 12;
  verts.push(...vertex(0, hh, 0, 0, 1, 0, 0.5, 0.5, r, g, b));
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    verts.push(...vertex(Math.cos(angle)*radius, hh, Math.sin(angle)*radius, 0, 1, 0, 0.5+Math.cos(angle)*0.5, 0.5+Math.sin(angle)*0.5, r, g, b));
  }
  for (let i = 0; i < segments; i++) {
    idx.push(topCenter, topCenter+1+i, topCenter+2+i);
  }

  const botCenter = verts.length / 12;
  verts.push(...vertex(0, -hh, 0, 0, -1, 0, 0.5, 0.5, r, g, b));
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    verts.push(...vertex(Math.cos(angle)*radius, -hh, Math.sin(angle)*radius, 0, -1, 0, 0.5+Math.cos(angle)*0.5, 0.5+Math.sin(angle)*0.5, r, g, b));
  }
  for (let i = 0; i < segments; i++) {
    idx.push(botCenter, botCenter+2+i, botCenter+1+i);
  }

  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

// Cylinder along X axis (for wheels) - height runs left-right
export function createCylinderX(radius: number, width: number, segments: number, r: number, g: number, b: number): MeshData {
  const verts: number[] = [];
  const idx: number[] = [];
  const hw = width / 2;

  // Side
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const y = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const ny = Math.cos(angle);
    const nz = Math.sin(angle);
    const u = i / segments;
    verts.push(...vertex(-hw, y, z, 0, ny, nz, u, 0, r, g, b));
    verts.push(...vertex(hw, y, z, 0, ny, nz, u, 1, r, g, b));
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    idx.push(a, a+2, a+1, a+1, a+2, a+3);
  }

  // Right cap (+X)
  const rightCenter = verts.length / 12;
  verts.push(...vertex(hw, 0, 0, 1, 0, 0, 0.5, 0.5, r, g, b));
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    verts.push(...vertex(hw, Math.cos(angle)*radius, Math.sin(angle)*radius, 1, 0, 0, 0.5+Math.cos(angle)*0.5, 0.5+Math.sin(angle)*0.5, r, g, b));
  }
  for (let i = 0; i < segments; i++) {
    idx.push(rightCenter, rightCenter+1+i, rightCenter+2+i);
  }

  // Left cap (-X)
  const leftCenter = verts.length / 12;
  verts.push(...vertex(-hw, 0, 0, -1, 0, 0, 0.5, 0.5, r, g, b));
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    verts.push(...vertex(-hw, Math.cos(angle)*radius, Math.sin(angle)*radius, -1, 0, 0, 0.5+Math.cos(angle)*0.5, 0.5+Math.sin(angle)*0.5, r, g, b));
  }
  for (let i = 0; i < segments; i++) {
    idx.push(leftCenter, leftCenter+2+i, leftCenter+1+i);
  }

  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

// Tapered box - wider at bottom, narrower at top. Great for car bodies, rooflines
export function createTaperedBox(
  wBot: number, wTop: number, h: number, dBot: number, dTop: number,
  r: number, g: number, b: number
): MeshData {
  const verts: number[] = [];
  const idx: number[] = [];
  const hh = h / 2;
  const hwb = wBot/2, hwt = wTop/2, hdb = dBot/2, hdt = dTop/2;

  // Front
  let base = 0;
  const nf = [0, 0, 1]; // approximate
  verts.push(...vertex(-hwb,-hh,hdb, 0,(hdb-hdt)/h,1, 0,0, r,g,b));
  verts.push(...vertex(hwb,-hh,hdb, 0,(hdb-hdt)/h,1, 1,0, r,g,b));
  verts.push(...vertex(hwt,hh,hdt, 0,(hdb-hdt)/h,1, 1,1, r,g,b));
  verts.push(...vertex(-hwt,hh,hdt, 0,(hdb-hdt)/h,1, 0,1, r,g,b));
  idx.push(base, base+1, base+2, base, base+2, base+3); base += 4;
  // Back
  verts.push(...vertex(hwb,-hh,-hdb, 0,(hdb-hdt)/h,-1, 0,0, r,g,b));
  verts.push(...vertex(-hwb,-hh,-hdb, 0,(hdb-hdt)/h,-1, 1,0, r,g,b));
  verts.push(...vertex(-hwt,hh,-hdt, 0,(hdb-hdt)/h,-1, 1,1, r,g,b));
  verts.push(...vertex(hwt,hh,-hdt, 0,(hdb-hdt)/h,-1, 0,1, r,g,b));
  idx.push(base, base+1, base+2, base, base+2, base+3); base += 4;
  // Top
  verts.push(...vertex(-hwt,hh,hdt, 0,1,0, 0,0, r,g,b));
  verts.push(...vertex(hwt,hh,hdt, 0,1,0, 1,0, r,g,b));
  verts.push(...vertex(hwt,hh,-hdt, 0,1,0, 1,1, r,g,b));
  verts.push(...vertex(-hwt,hh,-hdt, 0,1,0, 0,1, r,g,b));
  idx.push(base, base+1, base+2, base, base+2, base+3); base += 4;
  // Bottom
  verts.push(...vertex(-hwb,-hh,-hdb, 0,-1,0, 0,0, r,g,b));
  verts.push(...vertex(hwb,-hh,-hdb, 0,-1,0, 1,0, r,g,b));
  verts.push(...vertex(hwb,-hh,hdb, 0,-1,0, 1,1, r,g,b));
  verts.push(...vertex(-hwb,-hh,hdb, 0,-1,0, 0,1, r,g,b));
  idx.push(base, base+1, base+2, base, base+2, base+3); base += 4;
  // Right
  verts.push(...vertex(hwb,-hh,hdb, 1,(hwb-hwt)/h,0, 0,0, r,g,b));
  verts.push(...vertex(hwb,-hh,-hdb, 1,(hwb-hwt)/h,0, 1,0, r,g,b));
  verts.push(...vertex(hwt,hh,-hdt, 1,(hwb-hwt)/h,0, 1,1, r,g,b));
  verts.push(...vertex(hwt,hh,hdt, 1,(hwb-hwt)/h,0, 0,1, r,g,b));
  idx.push(base, base+1, base+2, base, base+2, base+3); base += 4;
  // Left
  verts.push(...vertex(-hwb,-hh,-hdb, -1,(hwb-hwt)/h,0, 0,0, r,g,b));
  verts.push(...vertex(-hwb,-hh,hdb, -1,(hwb-hwt)/h,0, 1,0, r,g,b));
  verts.push(...vertex(-hwt,hh,hdt, -1,(hwb-hwt)/h,0, 1,1, r,g,b));
  verts.push(...vertex(-hwt,hh,-hdt, -1,(hwb-hwt)/h,0, 0,1, r,g,b));
  idx.push(base, base+1, base+2, base, base+2, base+3);

  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

// Sphere approximation using subdivided icosphere
export function createSphere(radius: number, subdivisions: number, r: number, g: number, b: number): MeshData {
  const verts: number[] = [];
  const idx: number[] = [];
  const segs = Math.max(4, subdivisions);

  for (let lat = 0; lat <= segs; lat++) {
    const theta = (lat / segs) * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let lon = 0; lon <= segs; lon++) {
      const phi = (lon / segs) * Math.PI * 2;
      const nx = sinT * Math.cos(phi);
      const ny = cosT;
      const nz = sinT * Math.sin(phi);
      const u = lon / segs;
      const v2 = lat / segs;
      verts.push(...vertex(nx * radius, ny * radius, nz * radius, nx, ny, nz, u, v2, r, g, b));
    }
  }

  for (let lat = 0; lat < segs; lat++) {
    for (let lon = 0; lon < segs; lon++) {
      const a = lat * (segs + 1) + lon;
      const b2 = a + segs + 1;
      idx.push(a, b2, a + 1, a + 1, b2, b2 + 1);
    }
  }

  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

export function mergeMeshes(...meshes: { data: MeshData; offsetX?: number; offsetY?: number; offsetZ?: number }[]): MeshData {
  let totalVerts = 0;
  let totalIdx = 0;
  for (const m of meshes) {
    totalVerts += m.data.vertices.length;
    totalIdx += m.data.indices.length;
  }

  const vertices = new Float32Array(totalVerts);
  const indices = new Uint32Array(totalIdx);
  let vOffset = 0;
  let iOffset = 0;
  let vertexCount = 0;

  for (const m of meshes) {
    const v = new Float32Array(m.data.vertices);
    // Apply offset to positions
    if (m.offsetX || m.offsetY || m.offsetZ) {
      for (let i = 0; i < v.length; i += 12) {
        v[i] += (m.offsetX || 0);
        v[i+1] += (m.offsetY || 0);
        v[i+2] += (m.offsetZ || 0);
      }
    }
    vertices.set(v, vOffset);

    const baseVertex = vertexCount;
    for (let i = 0; i < m.data.indices.length; i++) {
      indices[iOffset + i] = m.data.indices[i] + baseVertex;
    }

    vOffset += m.data.vertices.length;
    iOffset += m.data.indices.length;
    vertexCount += m.data.vertices.length / 12;
  }

  return { vertices, indices };
}
