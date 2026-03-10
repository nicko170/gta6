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
  BOULEVARD_POINTS, AVENUE_POINTS, BOULEVARD_WIDTH,
  BLOCK_WIDTHS, BLOCK_DEPTHS, CITY_ROAD_X, CITY_ROAD_Z,
  isOnBoulevard,
} from './terrain';

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

  // Road grid
  readonly ROAD_WIDTH = 14;
  readonly GRID_COLS = BLOCK_WIDTHS.length;
  readonly GRID_ROWS = BLOCK_DEPTHS.length;
  readonly WORLD_SIZE = 1000;

  // Airport location (south, E-W runway)
  readonly AIRPORT_X = CITY_AIRPORT_X;
  readonly AIRPORT_Z = CITY_AIRPORT_Z;
  readonly RUNWAY_LENGTH = 300;
  readonly RUNWAY_WIDTH = 30;

  // Computed grid spans
  readonly gridSpanX = CITY_ROAD_X[CITY_ROAD_X.length - 1] - CITY_ROAD_X[0];
  readonly gridSpanZ = CITY_ROAD_Z[CITY_ROAD_Z.length - 1] - CITY_ROAD_Z[0];

  generate(renderer: Renderer) {
    this.generateGround(renderer);
    this.generateRoads(renderer);
    this.generateBuildings(renderer);
    this.generateAirport(renderer);
    this.generateMountainAirport(renderer);
    this.generateMountainRoads(renderer);
    this.generateBoulevards(renderer);
    this.generateWater(renderer);
    this.generateTrees(renderer);
    this.spawnVehicles(renderer);
  }

  private generateGround(renderer: Renderer) {
    const ground = createPlane(this.WORLD_SIZE * 2, this.WORLD_SIZE * 2, 0.25, 0.35, 0.2, 200, 200);
    applyHeightmap(ground, getTerrainHeight, (x, z, h, slopeX, slopeZ) => {
      const slope = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);
      if (h > 100 && slope < 0.5) return [0.88 + slope * 0.1, 0.89 + slope * 0.1, 0.92];
      if (h > 30 && slope > 0.6) return [0.35, 0.32, 0.28];
      if (h > 40) {
        const t = Math.min(1, (h - 40) / 60);
        return [0.25 + t * 0.12, 0.35 - t * 0.05, 0.2 - t * 0.08];
      }
      if (isWater(x, z)) return [0.12, 0.22, 0.15];
      return null;
    });
    this.groundMesh = renderer.createMesh(ground.vertices, ground.indices, 'terrain');
  }

  private generateRoads(renderer: Renderer) {
    const roads: { data: MeshData; offsetX?: number; offsetY?: number; offsetZ?: number }[] = [];
    const roadW = this.ROAD_WIDTH;

    // Horizontal roads (run along X, at each Z position)
    for (let i = 0; i < CITY_ROAD_Z.length; i++) {
      const z = CITY_ROAD_Z[i];
      const road = createPlane(this.gridSpanX + roadW, roadW, 0.3, 0.3, 0.32);
      roads.push({ data: road, offsetY: 0.02, offsetX: CITY_X, offsetZ: z });

      const marking = createPlane(this.gridSpanX, 0.15, 0.95, 0.95, 0.9);
      roads.push({ data: marking, offsetY: 0.04, offsetX: CITY_X, offsetZ: z });
    }

    // Vertical roads (run along Z, at each X position)
    for (let i = 0; i < CITY_ROAD_X.length; i++) {
      const x = CITY_ROAD_X[i];
      const road = createPlane(roadW, this.gridSpanZ + roadW, 0.3, 0.3, 0.32);
      roads.push({ data: road, offsetY: 0.02, offsetX: x, offsetZ: CITY_Z });

      const marking = createPlane(0.15, this.gridSpanZ, 0.95, 0.95, 0.9);
      roads.push({ data: marking, offsetY: 0.04, offsetX: x, offsetZ: CITY_Z });
    }

    // Sidewalks
    const sidewalkW = 2;
    for (let i = 0; i < CITY_ROAD_Z.length; i++) {
      const z = CITY_ROAD_Z[i];
      const sw1 = createPlane(this.gridSpanX + roadW, sidewalkW, 0.55, 0.55, 0.52);
      roads.push({ data: sw1, offsetY: 0.05, offsetX: CITY_X, offsetZ: z - roadW / 2 - sidewalkW / 2 });
      const sw2 = createPlane(this.gridSpanX + roadW, sidewalkW, 0.55, 0.55, 0.52);
      roads.push({ data: sw2, offsetY: 0.05, offsetX: CITY_X, offsetZ: z + roadW / 2 + sidewalkW / 2 });
    }
    for (let i = 0; i < CITY_ROAD_X.length; i++) {
      const x = CITY_ROAD_X[i];
      const sw3 = createPlane(sidewalkW, this.gridSpanZ + roadW, 0.55, 0.55, 0.52);
      roads.push({ data: sw3, offsetY: 0.05, offsetX: x - roadW / 2 - sidewalkW / 2, offsetZ: CITY_Z });
      const sw4 = createPlane(sidewalkW, this.gridSpanZ + roadW, 0.55, 0.55, 0.52);
      roads.push({ data: sw4, offsetY: 0.05, offsetX: x + roadW / 2 + sidewalkW / 2, offsetZ: CITY_Z });
    }

    const merged = mergeMeshes(...roads);
    this.roadMeshes.push(renderer.createMesh(merged.vertices, merged.indices, 'terrain'));
  }

  private generateBoulevards(renderer: Renderer) {
    const buildRoad = (points: [number, number][], width: number) => {
      for (let i = 0; i < points.length - 1; i++) {
        const [ax, az] = points[i];
        const [bx, bz] = points[i + 1];
        const dx = bx - ax, dz = bz - az;
        const length = Math.sqrt(dx * dx + dz * dz);
        const angle = Math.atan2(dx, dz);
        const cx = (ax + bx) / 2;
        const cz = (az + bz) / 2;

        // Road surface
        const seg = createPlane(width, length + width, 0.32, 0.32, 0.34);
        const segMesh = renderer.createMesh(seg.vertices, seg.indices, 'terrain');
        this.airportMeshes.push({
          mesh: segMesh,
          modelMatrix: mat4.multiply(mat4.translation(cx, 0.025, cz), mat4.rotationY(angle))
        });

        // Center divider
        const divider = createPlane(0.4, length + width - 2, 0.9, 0.9, 0.8);
        const divMesh = renderer.createMesh(divider.vertices, divider.indices, 'terrain');
        this.airportMeshes.push({
          mesh: divMesh,
          modelMatrix: mat4.multiply(mat4.translation(cx, 0.045, cz), mat4.rotationY(angle))
        });

        // Side markings
        for (const side of [-1, 1]) {
          const edge = createPlane(0.2, length + width - 2, 0.95, 0.95, 0.85);
          const edgeMesh = renderer.createMesh(edge.vertices, edge.indices, 'terrain');
          this.airportMeshes.push({
            mesh: edgeMesh,
            modelMatrix: mat4.multiply(
              mat4.translation(cx, 0.045, cz),
              mat4.multiply(mat4.rotationY(angle), mat4.translation(side * (width / 2 - 1), 0, 0))
            )
          });
        }
      }
    };

    buildRoad(BOULEVARD_POINTS, BOULEVARD_WIDTH);
    buildRoad(AVENUE_POINTS, BOULEVARD_WIDTH);
  }

  private generateBuildings(renderer: Renderer) {
    const rng = seededRandom(42);
    const margin = this.ROAD_WIDTH / 2 + 2;

    // Designate park blocks
    const parkRng = seededRandom(123);
    for (let gz = 0; gz < this.GRID_ROWS; gz++) {
      for (let gx = 0; gx < this.GRID_COLS; gx++) {
        if (parkRng() < 0.18) {
          this.parkBlocks.add(`${gx},${gz}`);
        }
      }
    }

    for (let gz = 0; gz < this.GRID_ROWS; gz++) {
      for (let gx = 0; gx < this.GRID_COLS; gx++) {
        const blockX = (CITY_ROAD_X[gx] + CITY_ROAD_X[gx + 1]) / 2;
        const blockZ = (CITY_ROAD_Z[gz] + CITY_ROAD_Z[gz + 1]) / 2;
        const blockW = BLOCK_WIDTHS[gx];
        const blockD = BLOCK_DEPTHS[gz];

        // Skip blocks near airport
        if (Math.abs(blockX - this.AIRPORT_X) < 200 && Math.abs(blockZ - this.AIRPORT_Z) < 200) continue;

        // Park blocks
        if (this.parkBlocks.has(`${gx},${gz}`)) {
          this.generatePark(renderer, blockX, blockZ, blockW, blockD, rng);
          continue;
        }

        // Downtown factor
        const dxC = blockX - CITY_X, dzC = blockZ - CITY_Z;
        const distFromCenter = Math.sqrt(dxC * dxC + dzC * dzC);
        const downtownFactor = Math.max(0, 1 - distFromCenter / 300);

        // Generate buildings per block (scale count with block area)
        const blockArea = blockW * blockD;
        const numBuildings = Math.max(1, Math.floor(blockArea / 1600) + Math.floor(rng() * 3));
        for (let i = 0; i < numBuildings; i++) {
          const maxBuildW = Math.min(28, blockW * 0.4);
          const maxBuildD = Math.min(28, blockD * 0.4);
          const w = 8 + rng() * (maxBuildW - 8);
          const d = 8 + rng() * (maxBuildD - 8);
          const minH = 5;
          const maxH = 15 + downtownFactor * 80;
          const h = minH + rng() * (maxH - minH);

          const halfBlockW = blockW / 2 - margin;
          const halfBlockD = blockD / 2 - margin;
          const bx = blockX + (rng() - 0.5) * Math.max(0, halfBlockW * 2 - w);
          const bz = blockZ + (rng() - 0.5) * Math.max(0, halfBlockD * 2 - d);

          // Skip if overlapping a boulevard
          if (isOnBoulevard(bx, bz)) continue;

          // Building color
          const shade = 0.4 + rng() * 0.35;
          const tint = rng();
          let cr: number, cg: number, cb: number;
          if (tint < 0.3) {
            cr = shade; cg = shade * 0.95; cb = shade * 0.9;
          } else if (tint < 0.5) {
            cr = shade * 0.6; cg = shade * 0.7; cb = shade;
          } else if (tint < 0.7) {
            cr = shade; cg = shade * 0.85; cb = shade * 0.7;
          } else {
            cr = shade * 0.9; cg = shade * 0.65; cb = shade * 0.5;
          }

          this.buildings.push({ x: bx, z: bz, w, d, h, r: cr, g: cg, b: cb });

          const meshParts: { data: MeshData; offsetX?: number; offsetY?: number; offsetZ?: number }[] = [];
          meshParts.push({ data: createBox(w, h, d, cr, cg, cb) });

          if (h > 10) {
            const windowRows = Math.floor(h / 4);
            for (let wy = 0; wy < windowRows; wy++) {
              const windowStrip = createBox(w + 0.1, 1.5, d + 0.1, cr * 0.5 + 0.2, cg * 0.5 + 0.25, cb * 0.5 + 0.35);
              meshParts.push({ data: windowStrip, offsetY: -h / 2 + 3 + wy * 4 });
            }
          }

          const merged = mergeMeshes(...meshParts);
          const mesh = renderer.createMesh(merged.vertices, merged.indices, 'object');
          const model = mat4.translation(bx, h / 2, bz);
          this.buildingMeshes.push({ mesh, modelMatrix: model });
        }
      }
    }
  }

  private generatePark(renderer: Renderer, cx: number, cz: number, blockW: number, blockD: number, rng: () => number) {
    const halfW = blockW / 2 - this.ROAD_WIDTH / 2 - 2;
    const halfD = blockD / 2 - this.ROAD_WIDTH / 2 - 2;

    const parkGround = createPlane(halfW * 2, halfD * 2, 0.2, 0.45, 0.18);
    const parkMesh = renderer.createMesh(parkGround.vertices, parkGround.indices, 'terrain');
    this.airportMeshes.push({ mesh: parkMesh, modelMatrix: mat4.translation(cx, 0.01, cz) });

    // Walking paths
    const pathW = createPlane(halfW * 1.6, 2, 0.5, 0.48, 0.42);
    const pathD = createPlane(2, halfD * 1.6, 0.5, 0.48, 0.42);
    const pMesh1 = renderer.createMesh(pathW.vertices, pathW.indices, 'terrain');
    const pMesh2 = renderer.createMesh(pathD.vertices, pathD.indices, 'terrain');
    this.airportMeshes.push({ mesh: pMesh1, modelMatrix: mat4.translation(cx, 0.02, cz) });
    this.airportMeshes.push({ mesh: pMesh2, modelMatrix: mat4.translation(cx, 0.02, cz) });

    if (rng() > 0.5) {
      const pond = createPlane(8, 8, 0.1, 0.25, 0.55, 4, 4);
      const pondMesh = renderer.createMesh(pond.vertices, pond.indices, 'terrain');
      this.airportMeshes.push({ mesh: pondMesh, modelMatrix: mat4.translation(cx, 0.01, cz) });
    }

    const treeVariants = this.parkTreeMeshes(renderer);
    const numTrees = 5 + Math.floor(rng() * 6);
    for (let i = 0; i < numTrees; i++) {
      const tx = cx + (rng() - 0.5) * halfW * 1.6;
      const tz = cz + (rng() - 0.5) * halfD * 1.6;
      if (Math.abs(tx - cx) < 2 && Math.abs(tz - cz) < 2) continue;
      const scale = 0.8 + rng() * 0.5;
      const variant = Math.floor(rng() * treeVariants.length);
      const rotY = rng() * Math.PI * 2;
      const model = mat4.multiply(
        mat4.translation(tx, 0, tz),
        mat4.multiply(mat4.rotationY(rotY), mat4.scaling(scale, scale, scale))
      );
      this.treeMeshes.push({ mesh: treeVariants[variant], modelMatrix: model });
    }

    const benchCount = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < benchCount; i++) {
      const side = rng() > 0.5 ? 1 : -1;
      const along = (rng() - 0.5) * Math.min(halfW, halfD) * 1.2;
      const bx = cx + (rng() > 0.5 ? along : side * 3);
      const bz = cz + (rng() > 0.5 ? side * 3 : along);
      const bench = createBox(2, 0.8, 0.6, 0.45, 0.3, 0.15);
      const benchMesh = renderer.createMesh(bench.vertices, bench.indices, 'object');
      this.airportMeshes.push({ mesh: benchMesh, modelMatrix: mat4.translation(bx, 0.4, bz) });
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

    // E-W Runway (length along X)
    const runway = createPlane(this.RUNWAY_LENGTH, this.RUNWAY_WIDTH, 0.25, 0.25, 0.28);
    const runwayMesh = renderer.createMesh(runway.vertices, runway.indices, 'terrain');
    this.airportMeshes.push({ mesh: runwayMesh, modelMatrix: mat4.translation(ax, 0.03, az) });

    // Runway markings
    for (let i = -5; i <= 5; i++) {
      const mark = createPlane(8, 1, 0.95, 0.95, 0.9);
      const markMesh = renderer.createMesh(mark.vertices, mark.indices, 'terrain');
      this.airportMeshes.push({ mesh: markMesh, modelMatrix: mat4.translation(ax + i * 25, 0.05, az) });
    }

    // Threshold markings
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

    // Taxiway (parallel, south of runway)
    const taxiway = createPlane(100, 12, 0.28, 0.28, 0.3);
    const taxiMesh = renderer.createMesh(taxiway.vertices, taxiway.indices, 'terrain');
    this.airportMeshes.push({ mesh: taxiMesh, modelMatrix: mat4.translation(ax, 0.03, az + 40) });

    // Connecting taxiway
    const connector = createPlane(12, 50, 0.28, 0.28, 0.3);
    const connMesh = renderer.createMesh(connector.vertices, connector.indices, 'terrain');
    this.airportMeshes.push({ mesh: connMesh, modelMatrix: mat4.translation(ax, 0.03, az + 20) });

    // Terminal building (south of runway)
    const terminal = createBox(60, 15, 30, 0.7, 0.72, 0.75);
    const termMesh = renderer.createMesh(terminal.vertices, terminal.indices, 'object');
    this.airportMeshes.push({ mesh: termMesh, modelMatrix: mat4.translation(ax, 7.5, az + 70) });

    // Terminal windows
    const termWindows = createBox(60.2, 8, 30.2, 0.4, 0.55, 0.75);
    const termWinMesh = renderer.createMesh(termWindows.vertices, termWindows.indices, 'object');
    this.airportMeshes.push({ mesh: termWinMesh, modelMatrix: mat4.translation(ax, 10, az + 70) });

    // Control tower
    const towerBase = createBox(8, 25, 8, 0.65, 0.65, 0.68);
    const towerTop = createBox(12, 5, 12, 0.4, 0.5, 0.6);
    const towerBaseMesh = renderer.createMesh(towerBase.vertices, towerBase.indices, 'object');
    const towerTopMesh = renderer.createMesh(towerTop.vertices, towerTop.indices, 'object');
    this.airportMeshes.push({ mesh: towerBaseMesh, modelMatrix: mat4.translation(ax + 50, 12.5, az + 70) });
    this.airportMeshes.push({ mesh: towerTopMesh, modelMatrix: mat4.translation(ax + 50, 27.5, az + 70) });

    // Hangars
    for (let i = 0; i < 3; i++) {
      const hangar = createBox(25, 12, 20, 0.5, 0.52, 0.55);
      const hangarMesh = renderer.createMesh(hangar.vertices, hangar.indices, 'object');
      this.airportMeshes.push({ mesh: hangarMesh, modelMatrix: mat4.translation(ax - 60 - i * 30, 6, az + 60) });
    }

    // Apron
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

    // Cars on horizontal roads
    for (let i = 0; i < CITY_ROAD_Z.length; i++) {
      const z = CITY_ROAD_Z[i];
      for (let j = 0; j < 3; j++) {
        const t = rng();
        const x = CITY_ROAD_X[0] + t * this.gridSpanX;
        const type = types[Math.floor(rng() * types.length)];
        const car = new Vehicle(type, [x, 0, z + 3]);
        car.body.rotation = Math.PI / 2 * (rng() > 0.5 ? 1 : -1);
        car.createMesh(renderer);
        this.vehicles.push(car);
      }
    }

    // Cars on vertical roads
    for (let i = 0; i < CITY_ROAD_X.length; i++) {
      const x = CITY_ROAD_X[i];
      for (let j = 0; j < 3; j++) {
        const t = rng();
        const zz = CITY_ROAD_Z[0] + t * this.gridSpanZ;
        const type = types[Math.floor(rng() * types.length)];
        const car = new Vehicle(type, [x + 3, 0, zz]);
        car.body.rotation = rng() > 0.5 ? 0 : Math.PI;
        car.createMesh(renderer);
        this.vehicles.push(car);
      }
    }

    // Planes at city airport (E-W orientation)
    const planePositions: Vec3[] = [
      [this.AIRPORT_X - 20, 0, this.AIRPORT_Z + 45],
      [this.AIRPORT_X + 20, 0, this.AIRPORT_Z + 45],
      [this.AIRPORT_X + this.RUNWAY_LENGTH / 2 - 20, 0, this.AIRPORT_Z],
    ];
    for (const pos of planePositions) {
      const plane = new Vehicle('plane', pos);
      plane.body.rotation = Math.PI / 2; // face along runway (E-W)
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
    const halfRoad = this.ROAD_WIDTH / 2;

    // Check city grid bounds
    if (x >= CITY_ROAD_X[0] - halfRoad && x <= CITY_ROAD_X[CITY_ROAD_X.length - 1] + halfRoad &&
        z >= CITY_ROAD_Z[0] - halfRoad && z <= CITY_ROAD_Z[CITY_ROAD_Z.length - 1] + halfRoad) {
      for (const rz of CITY_ROAD_Z) {
        if (Math.abs(z - rz) < halfRoad) return true;
      }
      for (const rx of CITY_ROAD_X) {
        if (Math.abs(x - rx) < halfRoad) return true;
      }
    }

    // Check boulevards
    if (isOnBoulevard(x, z)) return true;

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
