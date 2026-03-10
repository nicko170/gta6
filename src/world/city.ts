import { Renderer, Mesh, RenderObject } from '../engine/renderer';
import { createBox, createPlane, mergeMeshes, MeshData, createCylinder, createTaperedBox, createSphere, applyHeightmap } from '../engine/meshgen';
import { mat4, vec3, Vec3 } from '../engine/math';
import { Vehicle } from '../vehicles/vehicle';
import {
  getTerrainHeight, isWater, WATER_LEVEL,
  MT_AIRPORT_X, MT_AIRPORT_Z, MT_AIRPORT_Y, MT_RUNWAY_LENGTH,
  LAKE_X, LAKE_Z, LAKE_RX, LAKE_RZ, RIVER_POINTS,
  CITY_X, CITY_Z, isOnMountainRoad, getMountainRoadHeight,
  MT_ROAD_POINTS, LAKE_ROAD_POINTS, MT_ROAD_WIDTH,
  CITY_AIRPORT_X, CITY_AIRPORT_Z,
  isOnBoulevard,
} from './terrain';
import {
  ROAD_SEGMENTS, ROAD_NODES, getSegmentPoints, getDistrictAt,
  isOnAnyRoad, getPointAlongSegment, getTangentAlongSegment,
  getNonDeadEndSegments, getSegmentLength,
  DistrictType, RoadNode,
} from './road-network';

// Seeded random for deterministic city generation
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  r: number;
  g: number;
  b: number;
}

export class City {
  groundMesh!: Mesh;
  roadMeshes: Mesh[] = [];
  buildingMeshes: { mesh: Mesh; modelMatrix: Float32Array }[] = [];
  airportMeshes: { mesh: Mesh; modelMatrix: Float32Array }[] = [];
  treeMeshes: { mesh: Mesh; modelMatrix: Float32Array }[] = [];
  waterMeshes: { mesh: Mesh; modelMatrix: Float32Array }[] = [];

  buildings: Building[] = [];
  vehicles: Vehicle[] = [];
  parkBlocks: Set<string> = new Set();

  readonly ROAD_WIDTH = 14;
  readonly WORLD_SIZE = 1000;

  // Airport location (south, E-W runway)
  readonly AIRPORT_X = CITY_AIRPORT_X;
  readonly AIRPORT_Z = CITY_AIRPORT_Z;
  readonly RUNWAY_LENGTH = 300;
  readonly RUNWAY_WIDTH = 30;

  generate(renderer: Renderer) {
    this.generateGround(renderer);
    this.generateRoads(renderer);
    this.generateBuildings(renderer);
    this.generateAirport(renderer);
    this.generateMountainAirport(renderer);
    this.generateMountainRoads(renderer);
    this.generateWater(renderer);
    this.generateTrees(renderer);
    this.spawnVehicles(renderer);
  }

  private generateGround(renderer: Renderer) {
    const ground = createPlane(this.WORLD_SIZE * 2, this.WORLD_SIZE * 2, 0.25, 0.35, 0.2, 200, 200);
    applyHeightmap(ground, getTerrainHeight, (x, z, h, slopeX, slopeZ) => {
      const slope = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);
      if (isWater(x, z)) return [0.12, 0.22, 0.15];
      if (h > 95 && slope < 0.6) {
        const snowT = Math.min(1, (h - 95) / 25);
        return [0.85 + snowT * 0.07, 0.86 + snowT * 0.07, 0.90 + snowT * 0.05];
      }
      if (h > 20 && slope > 0.5) {
        const rockT = Math.min(1, slope - 0.5);
        return [0.50 + rockT * 0.05, 0.47 + rockT * 0.04, 0.42 + rockT * 0.03];
      }
      if (h > 60) {
        const t = Math.min(1, (h - 60) / 35);
        return [0.42 + t * 0.12, 0.44 - t * 0.02, 0.18 + t * 0.06];
      }
      if (h > 25) {
        const t = Math.min(1, (h - 25) / 35);
        return [0.28 + t * 0.14, 0.38 - t * 0.02, 0.15 + t * 0.03];
      }
      if (h > 5) {
        const t = Math.min(1, (h - 5) / 20);
        return [0.22 + t * 0.06, 0.36 + t * 0.02, 0.14 + t * 0.01];
      }
      return null;
    });
    this.groundMesh = renderer.createMesh(ground.vertices, ground.indices, 'terrain');
  }

  // ========================================
  // ROADS - rendered from road network segments
  // ========================================
  private generateRoads(renderer: Renderer) {
    // Render each road segment as rotated planes (same technique as old boulevard/mountain road rendering)
    for (const seg of ROAD_SEGMENTS) {
      const pts = getSegmentPoints(seg);
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const dx = bx - ax, dz = bz - az;
        const length = Math.sqrt(dx * dx + dz * dz);
        if (length < 0.1) continue;
        const angle = Math.atan2(dx, dz);
        const cx = (ax + bx) / 2;
        const cz = (az + bz) / 2;

        // Road surface
        const road = createPlane(seg.width, length + seg.width, 0.3, 0.3, 0.32);
        const roadMesh = renderer.createMesh(road.vertices, road.indices, 'terrain');
        this.airportMeshes.push({
          mesh: roadMesh,
          modelMatrix: mat4.multiply(mat4.translation(cx, 0.02, cz), mat4.rotationY(angle))
        });

        // Center line marking
        const markWidth = seg.width >= 16 ? 0.4 : 0.2;
        const marking = createPlane(markWidth, length + seg.width - 2, 0.9, 0.9, 0.8);
        const markMesh = renderer.createMesh(marking.vertices, marking.indices, 'terrain');
        this.airportMeshes.push({
          mesh: markMesh,
          modelMatrix: mat4.multiply(mat4.translation(cx, 0.04, cz), mat4.rotationY(angle))
        });

        // Edge markings for wider roads
        if (seg.width >= 12) {
          for (const side of [-1, 1]) {
            const edge = createPlane(0.15, length + seg.width - 2, 0.95, 0.95, 0.85);
            const edgeMesh = renderer.createMesh(edge.vertices, edge.indices, 'terrain');
            this.airportMeshes.push({
              mesh: edgeMesh,
              modelMatrix: mat4.multiply(
                mat4.translation(cx, 0.04, cz),
                mat4.multiply(mat4.rotationY(angle), mat4.translation(side * (seg.width / 2 - 1), 0, 0))
              )
            });
          }
        }

        // Sidewalks for non-industrial roads
        if (seg.width <= 14) {
          const swW = 2;
          for (const side of [-1, 1]) {
            const sw = createPlane(swW, length + seg.width, 0.55, 0.55, 0.52);
            const swMesh = renderer.createMesh(sw.vertices, sw.indices, 'terrain');
            this.airportMeshes.push({
              mesh: swMesh,
              modelMatrix: mat4.multiply(
                mat4.translation(cx, 0.05, cz),
                mat4.multiply(mat4.rotationY(angle), mat4.translation(side * (seg.width / 2 + swW / 2), 0, 0))
              )
            });
          }
        }
      }
    }

    // Fill intersections at nodes to cover gaps between road segments
    for (const node of ROAD_NODES) {
      if (node.connections.length >= 2) {
        let maxW = 0;
        for (const segId of node.connections) {
          const seg = ROAD_SEGMENTS.find(s => s.id === segId);
          if (seg) maxW = Math.max(maxW, seg.width);
        }
        // Use a larger fill to cover angled intersections
        const fillSize = maxW + 6;
        const fill = createPlane(fillSize, fillSize, 0.3, 0.3, 0.32);
        const fillMesh = renderer.createMesh(fill.vertices, fill.indices, 'terrain');
        this.airportMeshes.push({
          mesh: fillMesh,
          modelMatrix: mat4.translation(node.x, 0.019, node.z)
        });
        // Add a rotated fill for better coverage at angled intersections
        if (node.connections.length >= 3) {
          const fill2 = createPlane(fillSize, fillSize, 0.3, 0.3, 0.32);
          const fill2Mesh = renderer.createMesh(fill2.vertices, fill2.indices, 'terrain');
          this.airportMeshes.push({
            mesh: fill2Mesh,
            modelMatrix: mat4.multiply(
              mat4.translation(node.x, 0.019, node.z),
              mat4.rotationY(Math.PI / 4)
            )
          });
        }
      }
    }
  }

  // ========================================
  // BUILDINGS - district-aware generation
  // ========================================
  private generateBuildings(renderer: Renderer) {
    const rng = seededRandom(42);

    // Sample the city area on a grid and place buildings based on district
    // Cover area from roughly (-350, -10) to (280, 600)
    const SAMPLE_STEP = 22;
    const MIN_X = -340, MAX_X = 280;
    const MIN_Z = -10, MAX_Z = 610;

    for (let gz = MIN_Z; gz < MAX_Z; gz += SAMPLE_STEP) {
      for (let gx = MIN_X; gx < MAX_X; gx += SAMPLE_STEP) {
        const sx = gx + (rng() - 0.5) * SAMPLE_STEP * 0.6;
        const sz = gz + (rng() - 0.5) * SAMPLE_STEP * 0.6;

        // Skip if on a road
        if (isOnAnyRoad(sx, sz)) continue;

        // Skip if near airports
        if (Math.abs(sx - this.AIRPORT_X) < 200 && Math.abs(sz - this.AIRPORT_Z) < 200) continue;
        if (Math.abs(sx - MT_AIRPORT_X) < 120 && Math.abs(sz - MT_AIRPORT_Z) < 180) continue;

        // Skip if water
        if (isWater(sx, sz)) continue;

        // Skip if terrain is too high (mountains)
        const terrH = getTerrainHeight(sx, sz);
        if (terrH > 8) continue;

        const district = getDistrictAt(sx, sz);

        // Skip parks and areas with no density (outside city)
        if (district.type === 'park') continue;
        if (district.density <= 0) continue;

        // Density check
        if (rng() > district.density) continue;

        switch (district.type) {
          case 'downtown':
            this.generateDowntownBuilding(renderer, sx, sz, rng);
            break;
          case 'midtown':
            this.generateMidtownBuilding(renderer, sx, sz, rng);
            break;
          case 'residential':
            this.generateResidentialHouse(renderer, sx, sz, rng);
            break;
          case 'waterfront':
            this.generateWaterfrontBuilding(renderer, sx, sz, rng);
            break;
          case 'industrial':
            this.generateIndustrialBuilding(renderer, sx, sz, rng);
            break;
        }
      }
    }

    // Generate central park
    this.generateCentralPark(renderer);
  }

  private generateDowntownBuilding(renderer: Renderer, bx: number, bz: number, rng: () => number) {
    // Downtown factor: taller near center
    const dxC = bx - CITY_X, dzC = bz - CITY_Z;
    const distFromCenter = Math.sqrt(dxC * dxC + dzC * dzC);
    const downtownFactor = Math.max(0, 1 - distFromCenter / 150);

    const w = 10 + rng() * 16;
    const d = 10 + rng() * 16;
    const minH = 20;
    const maxH = 25 + downtownFactor * 70;
    const h = minH + rng() * (maxH - minH);

    // Verify no road overlap with full footprint
    if (isOnAnyRoad(bx - w / 2, bz) || isOnAnyRoad(bx + w / 2, bz) ||
        isOnAnyRoad(bx, bz - d / 2) || isOnAnyRoad(bx, bz + d / 2)) return;

    // Glass/steel colors
    const shade = 0.35 + rng() * 0.35;
    const tint = rng();
    let cr: number, cg: number, cb: number;
    if (tint < 0.3) {
      // Blue glass
      cr = shade * 0.55; cg = shade * 0.65; cb = shade * 1.0;
    } else if (tint < 0.55) {
      // Steel gray
      cr = shade * 0.85; cg = shade * 0.85; cb = shade * 0.9;
    } else if (tint < 0.75) {
      // Dark glass
      cr = shade * 0.45; cg = shade * 0.5; cb = shade * 0.55;
    } else {
      // Warm concrete
      cr = shade; cg = shade * 0.92; cb = shade * 0.85;
    }

    this.buildings.push({ x: bx, z: bz, w, d, h, r: cr, g: cg, b: cb });

    const meshParts: { data: MeshData; offsetX?: number; offsetY?: number; offsetZ?: number }[] = [];
    meshParts.push({ data: createBox(w, h, d, cr, cg, cb) });

    // Window strips
    if (h > 12) {
      const windowRows = Math.floor(h / 4);
      for (let wy = 0; wy < windowRows; wy++) {
        const windowStrip = createBox(w + 0.1, 1.5, d + 0.1,
          cr * 0.4 + 0.25, cg * 0.4 + 0.3, cb * 0.4 + 0.4);
        meshParts.push({ data: windowStrip, offsetY: -h / 2 + 3 + wy * 4 });
      }
    }

    const merged = mergeMeshes(...meshParts);
    const mesh = renderer.createMesh(merged.vertices, merged.indices, 'object');
    this.buildingMeshes.push({ mesh, modelMatrix: mat4.translation(bx, h / 2, bz) });
  }

  private generateMidtownBuilding(renderer: Renderer, bx: number, bz: number, rng: () => number) {
    const w = 8 + rng() * 14;
    const d = 8 + rng() * 14;
    const h = 8 + rng() * 25;

    if (isOnAnyRoad(bx - w / 2, bz) || isOnAnyRoad(bx + w / 2, bz) ||
        isOnAnyRoad(bx, bz - d / 2) || isOnAnyRoad(bx, bz + d / 2)) return;

    // Mixed warm/cool colors
    const shade = 0.4 + rng() * 0.3;
    const tint = rng();
    let cr: number, cg: number, cb: number;
    if (tint < 0.3) {
      cr = shade; cg = shade * 0.95; cb = shade * 0.88;
    } else if (tint < 0.55) {
      cr = shade * 0.65; cg = shade * 0.72; cb = shade;
    } else if (tint < 0.75) {
      cr = shade; cg = shade * 0.85; cb = shade * 0.72;
    } else {
      cr = shade * 0.88; cg = shade * 0.68; cb = shade * 0.55;
    }

    this.buildings.push({ x: bx, z: bz, w, d, h, r: cr, g: cg, b: cb });

    const meshParts: { data: MeshData; offsetX?: number; offsetY?: number; offsetZ?: number }[] = [];
    meshParts.push({ data: createBox(w, h, d, cr, cg, cb) });

    if (h > 10) {
      const windowRows = Math.floor(h / 4);
      for (let wy = 0; wy < windowRows; wy++) {
        const windowStrip = createBox(w + 0.1, 1.5, d + 0.1,
          cr * 0.5 + 0.2, cg * 0.5 + 0.25, cb * 0.5 + 0.35);
        meshParts.push({ data: windowStrip, offsetY: -h / 2 + 3 + wy * 4 });
      }
    }

    const merged = mergeMeshes(...meshParts);
    const mesh = renderer.createMesh(merged.vertices, merged.indices, 'object');
    this.buildingMeshes.push({ mesh, modelMatrix: mat4.translation(bx, h / 2, bz) });
  }

  private generateResidentialHouse(renderer: Renderer, bx: number, bz: number, rng: () => number) {
    const houseW = 6 + rng() * 5;
    const houseD = 7 + rng() * 5;
    const houseH = 3 + rng() * 4;

    if (isOnAnyRoad(bx - houseW / 2 - 1, bz) || isOnAnyRoad(bx + houseW / 2 + 1, bz) ||
        isOnAnyRoad(bx, bz - houseD / 2 - 1) || isOnAnyRoad(bx, bz + houseD / 2 + 1)) return;

    // Warm residential colors
    const colorIdx = Math.floor(rng() * 5);
    const shade = 0.7 + rng() * 0.2;
    let cr: number, cg: number, cb: number;
    switch (colorIdx) {
      case 0: cr = 0.85 * shade; cg = 0.82 * shade; cb = 0.75 * shade; break; // cream
      case 1: cr = 0.75 * shade; cg = 0.68 * shade; cb = 0.6 * shade; break;  // tan
      case 2: cr = 0.7 * shade; cg = 0.4 * shade; cb = 0.35 * shade; break;  // brick
      case 3: cr = 0.65 * shade; cg = 0.72 * shade; cb = 0.6 * shade; break;  // sage
      default: cr = 0.8 * shade; cg = 0.78 * shade; cb = 0.72 * shade; break; // beige
    }

    this.buildings.push({ x: bx, z: bz, w: houseW, d: houseD, h: houseH, r: cr, g: cg, b: cb });

    const meshParts: { data: MeshData; offsetX?: number; offsetY?: number; offsetZ?: number }[] = [];

    // House body
    meshParts.push({ data: createBox(houseW, houseH, houseD, cr, cg, cb) });

    // Roof (slightly wider, darker)
    const roofH = 1.5 + rng() * 1.5;
    const roofCr = cr * 0.5, roofCg = cg * 0.45, roofCb = cb * 0.4;
    meshParts.push({
      data: createTaperedBox(houseW + 1, houseW * 0.3, roofH, houseD + 1, houseD * 0.3, roofCr, roofCg, roofCb),
      offsetY: houseH / 2 + roofH / 2
    });

    // Door (front face)
    meshParts.push({
      data: createBox(1.2, 2.2, 0.2, 0.35, 0.25, 0.15),
      offsetY: -houseH / 2 + 1.1, offsetZ: houseD / 2
    });

    // Windows
    if (houseW > 7) {
      for (const sx of [-1, 1]) {
        meshParts.push({
          data: createBox(1.0, 1.0, 0.15, 0.5, 0.65, 0.8),
          offsetX: sx * (houseW / 2 - 1.8), offsetY: 0.3, offsetZ: houseD / 2
        });
      }
    }

    const merged = mergeMeshes(...meshParts);
    const mesh = renderer.createMesh(merged.vertices, merged.indices, 'object');
    this.buildingMeshes.push({ mesh, modelMatrix: mat4.translation(bx, houseH / 2, bz) });

    // Yard (green ground around house)
    const yardSize = 18;
    const yard = createPlane(yardSize, yardSize, 0.22, 0.45, 0.2);
    const yardMesh = renderer.createMesh(yard.vertices, yard.indices, 'terrain');
    this.airportMeshes.push({ mesh: yardMesh, modelMatrix: mat4.translation(bx, 0.005, bz) });

    // Yard tree (50% chance)
    if (rng() > 0.5) {
      const treeVariants = this.parkTreeMeshes(renderer);
      const tx = bx + (rng() - 0.5) * 8;
      const tz = bz + (rng() - 0.5) * 8;
      if (!isOnAnyRoad(tx, tz)) {
        const scale = 0.6 + rng() * 0.4;
        const variant = Math.floor(rng() * treeVariants.length);
        this.treeMeshes.push({
          mesh: treeVariants[variant],
          modelMatrix: mat4.multiply(
            mat4.translation(tx, 0, tz),
            mat4.multiply(mat4.rotationY(rng() * Math.PI * 2), mat4.scaling(scale, scale, scale))
          )
        });
      }
    }

    // Fence (30% chance)
    if (rng() > 0.7) {
      const fenceH = 0.8;
      const fenceColor: [number, number, number] = [0.6, 0.55, 0.45];
      // Front and back fences
      for (const side of [-1, 1]) {
        const fence = createBox(yardSize - 2, fenceH, 0.15, ...fenceColor);
        const fMesh = renderer.createMesh(fence.vertices, fence.indices, 'object');
        this.airportMeshes.push({
          mesh: fMesh,
          modelMatrix: mat4.translation(bx, fenceH / 2, bz + side * (yardSize / 2 - 1))
        });
      }
    }
  }

  private generateWaterfrontBuilding(renderer: Renderer, bx: number, bz: number, rng: () => number) {
    const w = 10 + rng() * 12;
    const d = 8 + rng() * 12;
    const h = 8 + rng() * 17;

    if (isOnAnyRoad(bx - w / 2, bz) || isOnAnyRoad(bx + w / 2, bz) ||
        isOnAnyRoad(bx, bz - d / 2) || isOnAnyRoad(bx, bz + d / 2)) return;

    // Light, airy colors
    const shade = 0.6 + rng() * 0.25;
    const tint = rng();
    let cr: number, cg: number, cb: number;
    if (tint < 0.4) {
      cr = shade; cg = shade; cb = shade * 1.05; // light blue-white
    } else if (tint < 0.7) {
      cr = shade * 0.95; cg = shade; cb = shade * 0.9; // warm white
    } else {
      cr = shade * 0.85; cg = shade * 0.9; cb = shade; // cool white
    }

    this.buildings.push({ x: bx, z: bz, w, d, h, r: cr, g: cg, b: cb });

    const meshParts: { data: MeshData; offsetX?: number; offsetY?: number; offsetZ?: number }[] = [];
    meshParts.push({ data: createBox(w, h, d, cr, cg, cb) });

    // Large windows
    if (h > 8) {
      const windowRows = Math.floor(h / 3.5);
      for (let wy = 0; wy < windowRows; wy++) {
        const windowStrip = createBox(w + 0.1, 1.8, d + 0.1,
          0.35, 0.5, 0.7);
        meshParts.push({ data: windowStrip, offsetY: -h / 2 + 2.5 + wy * 3.5 });
      }
    }

    const merged = mergeMeshes(...meshParts);
    const mesh = renderer.createMesh(merged.vertices, merged.indices, 'object');
    this.buildingMeshes.push({ mesh, modelMatrix: mat4.translation(bx, h / 2, bz) });
  }

  private generateIndustrialBuilding(renderer: Renderer, bx: number, bz: number, rng: () => number) {
    const w = 18 + rng() * 25;
    const d = 15 + rng() * 20;
    const h = 6 + rng() * 10;

    if (isOnAnyRoad(bx - w / 2, bz) || isOnAnyRoad(bx + w / 2, bz) ||
        isOnAnyRoad(bx, bz - d / 2) || isOnAnyRoad(bx, bz + d / 2)) return;

    // Industrial muted colors
    const shade = 0.35 + rng() * 0.25;
    const tint = rng();
    let cr: number, cg: number, cb: number;
    if (tint < 0.35) {
      cr = shade; cg = shade * 0.95; cb = shade * 0.9; // gray
    } else if (tint < 0.6) {
      cr = shade * 1.1; cg = shade * 0.7; cb = shade * 0.5; // rust
    } else {
      cr = shade * 0.8; cg = shade * 0.9; cb = shade * 0.7; // olive
    }

    this.buildings.push({ x: bx, z: bz, w, d, h, r: cr, g: cg, b: cb });

    const meshParts: { data: MeshData; offsetX?: number; offsetY?: number; offsetZ?: number }[] = [];
    meshParts.push({ data: createBox(w, h, d, cr, cg, cb) });

    // Loading dock door
    meshParts.push({
      data: createBox(4, 4, 0.2, shade * 0.4, shade * 0.4, shade * 0.45),
      offsetY: -h / 2 + 2, offsetZ: d / 2
    });

    const merged = mergeMeshes(...meshParts);
    const mesh = renderer.createMesh(merged.vertices, merged.indices, 'object');
    this.buildingMeshes.push({ mesh, modelMatrix: mat4.translation(bx, h / 2, bz) });

    // Shipping containers nearby (30% chance)
    if (rng() > 0.7) {
      for (let c = 0; c < 2; c++) {
        const cx = bx + (rng() - 0.5) * (w + 10);
        const cz = bz + (rng() - 0.5) * (d + 10);
        if (isOnAnyRoad(cx, cz)) continue;
        const containerColors: [number, number, number][] = [
          [0.6, 0.2, 0.15], [0.15, 0.3, 0.55], [0.55, 0.5, 0.15], [0.2, 0.45, 0.2]
        ];
        const cc = containerColors[Math.floor(rng() * containerColors.length)];
        const container = createBox(6, 3, 2.5, cc[0], cc[1], cc[2]);
        const cMesh = renderer.createMesh(container.vertices, container.indices, 'object');
        this.buildingMeshes.push({
          mesh: cMesh,
          modelMatrix: mat4.multiply(
            mat4.translation(cx, 1.5, cz),
            mat4.rotationY(rng() * Math.PI)
          )
        });
      }
    }
  }

  private generateCentralPark(renderer: Renderer) {
    // Park centered on the district center
    const parkCx = -60, parkCz = 208;
    const parkW = 90, parkD = 80;
    const rng = seededRandom(123);

    // Green ground
    const parkGround = createPlane(parkW, parkD, 0.2, 0.48, 0.18);
    const parkMesh = renderer.createMesh(parkGround.vertices, parkGround.indices, 'terrain');
    this.airportMeshes.push({ mesh: parkMesh, modelMatrix: mat4.translation(parkCx, 0.01, parkCz) });

    // Walking paths (cross pattern + diagonal)
    const pathParts: { data: MeshData; offsetX?: number; offsetY?: number; offsetZ?: number }[] = [];
    pathParts.push({ data: createPlane(parkW * 0.8, 2.5, 0.5, 0.48, 0.42) });
    pathParts.push({ data: createPlane(2.5, parkD * 0.8, 0.5, 0.48, 0.42) });
    const pathMerged = mergeMeshes(...pathParts);
    const pathMesh = renderer.createMesh(pathMerged.vertices, pathMerged.indices, 'terrain');
    this.airportMeshes.push({ mesh: pathMesh, modelMatrix: mat4.translation(parkCx, 0.02, parkCz) });

    // Diagonal path
    const diagPath = createPlane(2, parkW * 1.0, 0.5, 0.48, 0.42);
    const diagMesh = renderer.createMesh(diagPath.vertices, diagPath.indices, 'terrain');
    this.airportMeshes.push({
      mesh: diagMesh,
      modelMatrix: mat4.multiply(mat4.translation(parkCx, 0.02, parkCz), mat4.rotationY(Math.PI * 0.25))
    });

    // Pond
    const pond = createPlane(18, 14, 0.1, 0.25, 0.55, 6, 6);
    const pondMesh = renderer.createMesh(pond.vertices, pond.indices, 'terrain');
    this.airportMeshes.push({ mesh: pondMesh, modelMatrix: mat4.translation(parkCx + 12, 0.01, parkCz - 8) });

    // Gazebo
    const gazeboParts: { data: MeshData; offsetX?: number; offsetY?: number; offsetZ?: number }[] = [];
    gazeboParts.push({ data: createCylinder(0.15, 3, 6, 0.55, 0.45, 0.35) });
    gazeboParts.push({ data: createCylinder(0.15, 3, 6, 0.55, 0.45, 0.35), offsetX: 3 });
    gazeboParts.push({ data: createCylinder(0.15, 3, 6, 0.55, 0.45, 0.35), offsetX: -3 });
    gazeboParts.push({ data: createCylinder(0.15, 3, 6, 0.55, 0.45, 0.35), offsetZ: 3 });
    gazeboParts.push({ data: createBox(7, 0.3, 7, 0.5, 0.35, 0.2), offsetY: 3 });
    const gazeboMerged = mergeMeshes(...gazeboParts);
    const gazeboMesh = renderer.createMesh(gazeboMerged.vertices, gazeboMerged.indices, 'object');
    this.airportMeshes.push({ mesh: gazeboMesh, modelMatrix: mat4.translation(parkCx - 15, 0, parkCz + 10) });

    // Trees
    const treeVariants = this.parkTreeMeshes(renderer);
    for (let i = 0; i < 25; i++) {
      const tx = parkCx + (rng() - 0.5) * parkW * 0.85;
      const tz = parkCz + (rng() - 0.5) * parkD * 0.85;
      // Skip near paths
      if (Math.abs(tx - parkCx) < 3 || Math.abs(tz - parkCz) < 3) continue;
      const scale = 0.7 + rng() * 0.6;
      const variant = Math.floor(rng() * treeVariants.length);
      this.treeMeshes.push({
        mesh: treeVariants[variant],
        modelMatrix: mat4.multiply(
          mat4.translation(tx, 0, tz),
          mat4.multiply(mat4.rotationY(rng() * Math.PI * 2), mat4.scaling(scale, scale, scale))
        )
      });
    }

    // Benches along paths
    for (let i = 0; i < 8; i++) {
      const side = rng() > 0.5 ? 1 : -1;
      const along = (rng() - 0.5) * parkW * 0.6;
      const benchX = parkCx + (i % 2 === 0 ? along : side * 4);
      const benchZ = parkCz + (i % 2 === 0 ? side * 4 : along);
      const bench = createBox(2, 0.8, 0.6, 0.45, 0.3, 0.15);
      const benchMesh = renderer.createMesh(bench.vertices, bench.indices, 'object');
      this.airportMeshes.push({ mesh: benchMesh, modelMatrix: mat4.translation(benchX, 0.4, benchZ) });
    }
  }

  private _parkTreeCache: Mesh[] | null = null;
  private parkTreeMeshes(renderer: Renderer): Mesh[] {
    if (this._parkTreeCache) return this._parkTreeCache;
    const t1 = mergeMeshes(
      { data: createCylinder(0.15, 3.5, 6, 0.4, 0.28, 0.15) },
      { data: createSphere(1.8, 6, 0.22, 0.5, 0.18), offsetY: 3.5 },
      { data: createSphere(1.4, 5, 0.18, 0.55, 0.2), offsetY: 4.5 },
    );
    const t2 = mergeMeshes(
      { data: createCylinder(0.12, 2.5, 5, 0.38, 0.25, 0.12) },
      { data: createSphere(2.2, 6, 0.2, 0.52, 0.16), offsetY: 3.0 },
    );
    this._parkTreeCache = [
      renderer.createMesh(t1.vertices, t1.indices, 'object'),
      renderer.createMesh(t2.vertices, t2.indices, 'object'),
    ];
    return this._parkTreeCache;
  }

  private generateAirport(renderer: Renderer) {
    const ax = this.AIRPORT_X;
    const az = this.AIRPORT_Z;

    const runway = createPlane(this.RUNWAY_LENGTH, this.RUNWAY_WIDTH, 0.25, 0.25, 0.28);
    const runwayMesh = renderer.createMesh(runway.vertices, runway.indices, 'terrain');
    this.airportMeshes.push({ mesh: runwayMesh, modelMatrix: mat4.translation(ax, 0.03, az) });

    for (let i = -5; i <= 5; i++) {
      const mark = createPlane(8, 1, 0.95, 0.95, 0.9);
      const markMesh = renderer.createMesh(mark.vertices, mark.indices, 'terrain');
      this.airportMeshes.push({ mesh: markMesh, modelMatrix: mat4.translation(ax + i * 25, 0.05, az) });
    }

    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 4; i++) {
        const thresh = createPlane(15, 1.5, 0.95, 0.95, 0.9);
        const threshMesh = renderer.createMesh(thresh.vertices, thresh.indices, 'terrain');
        this.airportMeshes.push({
          mesh: threshMesh,
          modelMatrix: mat4.translation(ax + side * (this.RUNWAY_LENGTH / 2 - 12), 0.05, az + (i - 1.5) * 3)
        });
      }
    }

    const taxiway = createPlane(100, 12, 0.28, 0.28, 0.3);
    const taxiMesh = renderer.createMesh(taxiway.vertices, taxiway.indices, 'terrain');
    this.airportMeshes.push({ mesh: taxiMesh, modelMatrix: mat4.translation(ax, 0.03, az + 40) });

    const connector = createPlane(12, 50, 0.28, 0.28, 0.3);
    const connMesh = renderer.createMesh(connector.vertices, connector.indices, 'terrain');
    this.airportMeshes.push({ mesh: connMesh, modelMatrix: mat4.translation(ax, 0.03, az + 20) });

    const terminal = createBox(60, 15, 30, 0.7, 0.72, 0.75);
    const termMesh = renderer.createMesh(terminal.vertices, terminal.indices, 'object');
    this.airportMeshes.push({ mesh: termMesh, modelMatrix: mat4.translation(ax, 7.5, az + 70) });

    const termWindows = createBox(60.2, 8, 30.2, 0.4, 0.55, 0.75);
    const termWinMesh = renderer.createMesh(termWindows.vertices, termWindows.indices, 'object');
    this.airportMeshes.push({ mesh: termWinMesh, modelMatrix: mat4.translation(ax, 10, az + 70) });

    const towerBase = createBox(8, 25, 8, 0.65, 0.65, 0.68);
    const towerTop = createBox(12, 5, 12, 0.4, 0.5, 0.6);
    const towerBaseMesh = renderer.createMesh(towerBase.vertices, towerBase.indices, 'object');
    const towerTopMesh = renderer.createMesh(towerTop.vertices, towerTop.indices, 'object');
    this.airportMeshes.push({ mesh: towerBaseMesh, modelMatrix: mat4.translation(ax + 50, 12.5, az + 70) });
    this.airportMeshes.push({ mesh: towerTopMesh, modelMatrix: mat4.translation(ax + 50, 27.5, az + 70) });

    for (let i = 0; i < 3; i++) {
      const hangar = createBox(25, 12, 20, 0.5, 0.52, 0.55);
      const hangarMesh = renderer.createMesh(hangar.vertices, hangar.indices, 'object');
      this.airportMeshes.push({ mesh: hangarMesh, modelMatrix: mat4.translation(ax - 60 - i * 30, 6, az + 60) });
    }

    const apron = createPlane(80, 80, 0.32, 0.32, 0.34);
    const apronMesh = renderer.createMesh(apron.vertices, apron.indices, 'terrain');
    this.airportMeshes.push({ mesh: apronMesh, modelMatrix: mat4.translation(ax, 0.02, az + 50) });
  }

  private generateMountainAirport(renderer: Renderer) {
    const ax = MT_AIRPORT_X;
    const az = MT_AIRPORT_Z;
    const ay = MT_AIRPORT_Y;

    const runway = createPlane(20, MT_RUNWAY_LENGTH, 0.25, 0.25, 0.28);
    const runwayMesh = renderer.createMesh(runway.vertices, runway.indices, 'terrain');
    this.airportMeshes.push({ mesh: runwayMesh, modelMatrix: mat4.translation(ax, ay + 0.03, az) });

    for (let i = -4; i <= 4; i++) {
      const mark = createPlane(1, 6, 0.95, 0.95, 0.9);
      const markMesh = renderer.createMesh(mark.vertices, mark.indices, 'terrain');
      this.airportMeshes.push({ mesh: markMesh, modelMatrix: mat4.translation(ax, ay + 0.05, az + i * 22) });
    }

    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 3; i++) {
        const thresh = createPlane(1.2, 12, 0.95, 0.95, 0.9);
        const threshMesh = renderer.createMesh(thresh.vertices, thresh.indices, 'terrain');
        this.airportMeshes.push({
          mesh: threshMesh,
          modelMatrix: mat4.translation(ax + (i - 1) * 3, ay + 0.05, az + side * (MT_RUNWAY_LENGTH / 2 - 10))
        });
      }
    }

    const terminal = createBox(30, 10, 18, 0.65, 0.67, 0.7);
    const termMesh = renderer.createMesh(terminal.vertices, terminal.indices, 'object');
    this.airportMeshes.push({ mesh: termMesh, modelMatrix: mat4.translation(ax + 35, ay + 5, az) });

    const termWin = createBox(30.2, 5, 18.2, 0.35, 0.5, 0.7);
    const termWinMesh = renderer.createMesh(termWin.vertices, termWin.indices, 'object');
    this.airportMeshes.push({ mesh: termWinMesh, modelMatrix: mat4.translation(ax + 35, ay + 7, az) });

    const hangar = createBox(20, 10, 16, 0.48, 0.5, 0.53);
    const hangarMesh = renderer.createMesh(hangar.vertices, hangar.indices, 'object');
    this.airportMeshes.push({ mesh: hangarMesh, modelMatrix: mat4.translation(ax + 35, ay + 5, az - 35) });

    const apron = createPlane(50, 50, 0.3, 0.3, 0.32);
    const apronMesh = renderer.createMesh(apron.vertices, apron.indices, 'terrain');
    this.airportMeshes.push({ mesh: apronMesh, modelMatrix: mat4.translation(ax + 30, ay + 0.02, az) });
  }

  private generateMountainRoads(renderer: Renderer) {
    const buildRoadPath = (points: [number, number][]) => {
      for (let i = 0; i < points.length - 1; i++) {
        const [ax, az] = points[i];
        const [bx, bz] = points[i + 1];
        const dx = bx - ax, dz = bz - az;
        const length = Math.sqrt(dx * dx + dz * dz);
        const angle = Math.atan2(dx, dz);
        const cx = (ax + bx) / 2;
        const cz = (az + bz) / 2;
        const roadH = getMountainRoadHeight(cx, cz);
        const elev = roadH > -900 ? roadH : getTerrainHeight(cx, cz);

        const seg = createPlane(MT_ROAD_WIDTH, length + MT_ROAD_WIDTH, 0.35, 0.33, 0.3);
        const segMesh = renderer.createMesh(seg.vertices, seg.indices, 'terrain');
        this.airportMeshes.push({
          mesh: segMesh,
          modelMatrix: mat4.multiply(mat4.translation(cx, elev + 0.02, cz), mat4.rotationY(angle))
        });

        const marking = createPlane(0.3, length + MT_ROAD_WIDTH - 2, 0.85, 0.85, 0.7);
        const markMesh = renderer.createMesh(marking.vertices, marking.indices, 'terrain');
        this.airportMeshes.push({
          mesh: markMesh,
          modelMatrix: mat4.multiply(mat4.translation(cx, elev + 0.04, cz), mat4.rotationY(angle))
        });
      }
    };

    buildRoadPath(MT_ROAD_POINTS);
    buildRoadPath(LAKE_ROAD_POINTS);
  }

  private generateWater(renderer: Renderer) {
    const lake = createPlane(LAKE_RX * 2, LAKE_RZ * 2, 0.05, 0.15, 0.65, 12, 12);
    const lakeMesh = renderer.createMesh(lake.vertices, lake.indices, 'terrain');
    this.waterMeshes.push({ mesh: lakeMesh, modelMatrix: mat4.translation(LAKE_X, WATER_LEVEL, LAKE_Z) });

    for (let i = 0; i < RIVER_POINTS.length - 1; i++) {
      const [ax, az] = RIVER_POINTS[i];
      const [bx, bz] = RIVER_POINTS[i + 1];
      const dx = bx - ax, dz = bz - az;
      const length = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dx, dz);
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;

      const seg = createPlane(28, length + 14, 0.05, 0.15, 0.65);
      const segMesh = renderer.createMesh(seg.vertices, seg.indices, 'terrain');
      this.waterMeshes.push({
        mesh: segMesh,
        modelMatrix: mat4.multiply(mat4.translation(cx, WATER_LEVEL, cz), mat4.rotationY(angle))
      });
    }
  }

  private generateTrees(renderer: Renderer) {
    const rng = seededRandom(1337);
    const treeVariants: ReturnType<typeof renderer.createMesh>[] = [];

    const t1 = mergeMeshes(
      { data: createCylinder(0.15, 3.5, 6, 0.4, 0.28, 0.15) },
      { data: createSphere(1.8, 6, 0.22, 0.5, 0.18), offsetY: 3.5 },
      { data: createSphere(1.4, 5, 0.18, 0.55, 0.2), offsetY: 4.5 },
      { data: createSphere(1.0, 5, 0.25, 0.52, 0.22), offsetY: 3.0, offsetX: 0.8 },
    );
    treeVariants.push(renderer.createMesh(t1.vertices, t1.indices, 'object'));

    const t2 = mergeMeshes(
      { data: createTaperedBox(0.25, 0.15, 5, 0.25, 0.15, 0.45, 0.32, 0.18) },
      { data: createBox(3.5, 0.15, 1.2, 0.15, 0.52, 0.15), offsetY: 4.8 },
      { data: createBox(1.2, 0.15, 3.5, 0.15, 0.52, 0.15), offsetY: 4.8 },
      { data: createSphere(0.6, 4, 0.12, 0.45, 0.1), offsetY: 5.0 },
    );
    treeVariants.push(renderer.createMesh(t2.vertices, t2.indices, 'object'));

    const t3 = mergeMeshes(
      { data: createCylinder(0.12, 2.5, 5, 0.38, 0.25, 0.12) },
      { data: createTaperedBox(2.4, 0.3, 2.0, 2.4, 0.3, 0.12, 0.42, 0.1), offsetY: 2.5 },
      { data: createTaperedBox(2.0, 0.2, 1.6, 2.0, 0.2, 0.14, 0.45, 0.12), offsetY: 3.8 },
      { data: createTaperedBox(1.4, 0.1, 1.2, 1.4, 0.1, 0.16, 0.48, 0.14), offsetY: 4.8 },
    );
    treeVariants.push(renderer.createMesh(t3.vertices, t3.indices, 'object'));

    for (let i = 0; i < 800; i++) {
      const x = (rng() - 0.5) * this.WORLD_SIZE * 1.8;
      const z = (rng() - 0.5) * this.WORLD_SIZE * 1.8;

      if (this.isOnRoad(x, z)) continue;
      if (this.isOnBuilding(x, z)) continue;
      if (Math.abs(x - this.AIRPORT_X) < 180 && Math.abs(z - this.AIRPORT_Z) < 120) continue;
      if (Math.abs(x - MT_AIRPORT_X) < 120 && Math.abs(z - MT_AIRPORT_Z) < 180) continue;
      if (isWater(x, z)) continue;

      const y = getTerrainHeight(x, z);
      if (y > 120) continue;

      const scale = 0.7 + rng() * 0.8;
      const variant = y > 35 ? 2 : Math.floor(rng() * treeVariants.length);
      const rotY = rng() * Math.PI * 2;
      const model = mat4.multiply(
        mat4.translation(x, y, z),
        mat4.multiply(mat4.rotationY(rotY), mat4.scaling(scale, scale, scale))
      );
      this.treeMeshes.push({ mesh: treeVariants[variant], modelMatrix: model });
    }
  }

  spawnVehicles(renderer: Renderer) {
    const rng = seededRandom(999);
    const types: ('sedan' | 'sports' | 'truck')[] = ['sedan', 'sports', 'truck'];

    // Spawn parked cars along road segments
    const drivableSegs = getNonDeadEndSegments();
    const numParked = 35;
    for (let i = 0; i < numParked; i++) {
      const seg = drivableSegs[Math.floor(rng() * drivableSegs.length)];
      const t = 0.15 + rng() * 0.7; // avoid endpoints
      const [px, pz] = getPointAlongSegment(seg, t);
      const [tx, tz] = getTangentAlongSegment(seg, t);
      const angle = Math.atan2(tx, tz);

      // Offset to right side of road
      const perpX = -tz, perpZ = tx;
      const laneOff = seg.width / 2 - 2;
      const cx = px + perpX * laneOff;
      const cz = pz + perpZ * laneOff;

      const type = types[Math.floor(rng() * types.length)];
      const car = new Vehicle(type, [cx, 0, cz]);
      car.body.rotation = angle + (rng() > 0.5 ? 0 : Math.PI);
      car.createMesh(renderer);
      this.vehicles.push(car);
    }

    // Planes at city airport (E-W orientation)
    const planePositions: Vec3[] = [
      [this.AIRPORT_X - 20, 0, this.AIRPORT_Z + 45],
      [this.AIRPORT_X + 20, 0, this.AIRPORT_Z + 45],
      [this.AIRPORT_X + this.RUNWAY_LENGTH / 2 - 20, 0, this.AIRPORT_Z],
    ];
    for (const pos of planePositions) {
      const plane = new Vehicle('plane', pos);
      plane.body.rotation = Math.PI / 2;
      plane.createMesh(renderer);
      this.vehicles.push(plane);
    }

    // Planes at mountain airport
    const mtPlanePositions: Vec3[] = [
      [MT_AIRPORT_X + 30, MT_AIRPORT_Y, MT_AIRPORT_Z - 10],
      [MT_AIRPORT_X, MT_AIRPORT_Y, MT_AIRPORT_Z + MT_RUNWAY_LENGTH / 2 - 20],
    ];
    for (const pos of mtPlanePositions) {
      const plane = new Vehicle('plane', pos);
      plane.body.rotation = Math.PI;
      plane.createMesh(renderer);
      this.vehicles.push(plane);
    }

    // Boats at lake
    const boatPositions: Vec3[] = [
      [LAKE_X - 35, WATER_LEVEL, LAKE_Z],
      [LAKE_X + 25, WATER_LEVEL, LAKE_Z + 20],
      [LAKE_X - 5, WATER_LEVEL, LAKE_Z - 25],
      [LAKE_X + 45, WATER_LEVEL, LAKE_Z - 10],
    ];
    for (const pos of boatPositions) {
      const boat = new Vehicle('boat', pos);
      boat.body.rotation = rng() * Math.PI * 2;
      boat.createMesh(renderer);
      this.vehicles.push(boat);
    }

    // Boats along river
    const riverBoatPositions: Vec3[] = [
      [350, WATER_LEVEL, -100],
      [370, WATER_LEVEL, 50],
    ];
    for (const pos of riverBoatPositions) {
      const boat = new Vehicle('boat', pos);
      boat.body.rotation = rng() * Math.PI * 2;
      boat.createMesh(renderer);
      this.vehicles.push(boat);
    }
  }

  isOnRoad(x: number, z: number): boolean {
    // Check city road network
    if (isOnAnyRoad(x, z)) return true;

    // Check mountain roads (not part of city network)
    if (isOnMountainRoad(x, z)) return true;

    return false;
  }

  isOnBuilding(x: number, z: number): boolean {
    for (const b of this.buildings) {
      if (Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1) return true;
    }
    return false;
  }

  isOnMountainAirport(x: number, z: number): boolean {
    return Math.abs(x - MT_AIRPORT_X) < 50 && Math.abs(z - MT_AIRPORT_Z) < MT_RUNWAY_LENGTH / 2;
  }

  getGroundHeight(x: number, z: number): number {
    if (this.isOnRoad(x, z)) return Math.max(getTerrainHeight(x, z), 0) + 0.02;
    if (Math.abs(x - this.AIRPORT_X) < this.RUNWAY_LENGTH / 2 && Math.abs(z - this.AIRPORT_Z) < 60) return 0.03;
    if (this.isOnMountainAirport(x, z)) return MT_AIRPORT_Y + 0.03;
    const mtRoad = getMountainRoadHeight(x, z);
    if (mtRoad > -900) return mtRoad;
    return getTerrainHeight(x, z);
  }

  checkBuildingCollision(x: number, z: number, radius: number): Vec3 | null {
    for (const b of this.buildings) {
      const hw = b.w / 2 + radius;
      const hd = b.d / 2 + radius;
      const dx = x - b.x;
      const dz = z - b.z;

      if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
        const overlapX = hw - Math.abs(dx);
        const overlapZ = hd - Math.abs(dz);

        if (overlapX < overlapZ) {
          return [Math.sign(dx) * overlapX, 0, 0];
        } else {
          return [0, 0, Math.sign(dz) * overlapZ];
        }
      }
    }
    return null;
  }

  getRenderObjects(): RenderObject[] {
    const objects: RenderObject[] = [];

    objects.push({ mesh: this.groundMesh, modelMatrix: mat4.create() });

    for (const road of this.roadMeshes) {
      objects.push({ mesh: road, modelMatrix: mat4.create() });
    }

    for (const b of this.buildingMeshes) {
      objects.push({ mesh: b.mesh, modelMatrix: b.modelMatrix });
    }

    for (const a of this.airportMeshes) {
      objects.push({ mesh: a.mesh, modelMatrix: a.modelMatrix });
    }

    for (const t of this.treeMeshes) {
      objects.push({ mesh: t.mesh, modelMatrix: t.modelMatrix });
    }

    for (const w of this.waterMeshes) {
      objects.push({ mesh: w.mesh, modelMatrix: w.modelMatrix });
    }

    for (const v of this.vehicles) {
      objects.push(v.getRenderObject());
    }

    return objects;
  }
}
