import { Renderer, Mesh, RenderObject } from '../engine/renderer';
import { createBox, createPlane, mergeMeshes, MeshData, createCylinder, createTaperedBox, createSphere } from '../engine/meshgen';
import { mat4, vec3, Vec3 } from '../engine/math';
import { Vehicle } from '../vehicles/vehicle';

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

  buildings: Building[] = [];
  vehicles: Vehicle[] = [];

  // Road grid
  readonly ROAD_WIDTH = 14;
  readonly BLOCK_SIZE = 80;
  readonly GRID_SIZE = 6; // 6x6 grid of blocks
  readonly WORLD_SIZE = 1000;

  // Airport location
  readonly AIRPORT_X = 350;
  readonly AIRPORT_Z = -350;
  readonly RUNWAY_LENGTH = 300;
  readonly RUNWAY_WIDTH = 30;

  generate(renderer: Renderer) {
    this.generateGround(renderer);
    this.generateRoads(renderer);
    this.generateBuildings(renderer);
    this.generateAirport(renderer);
    this.generateTrees(renderer);
    this.spawnVehicles(renderer);
  }

  private generateGround(renderer: Renderer) {
    // Main ground plane
    const ground = createPlane(this.WORLD_SIZE * 2, this.WORLD_SIZE * 2, 0.25, 0.35, 0.2);
    this.groundMesh = renderer.createMesh(ground.vertices, ground.indices, 'terrain');
  }

  private generateRoads(renderer: Renderer) {
    const roads: { data: MeshData; offsetX?: number; offsetY?: number; offsetZ?: number }[] = [];
    const startX = -(this.GRID_SIZE * this.BLOCK_SIZE) / 2;
    const startZ = -(this.GRID_SIZE * this.BLOCK_SIZE) / 2;

    // Horizontal roads
    for (let i = 0; i <= this.GRID_SIZE; i++) {
      const z = startZ + i * this.BLOCK_SIZE;
      const road = createPlane(this.GRID_SIZE * this.BLOCK_SIZE + this.ROAD_WIDTH, this.ROAD_WIDTH, 0.3, 0.3, 0.32);
      roads.push({ data: road, offsetY: 0.02, offsetZ: z });

      // Road markings - white dashed center line
      const marking = createPlane(this.GRID_SIZE * this.BLOCK_SIZE, 0.15, 0.95, 0.95, 0.9);
      roads.push({ data: marking, offsetY: 0.04, offsetZ: z });
    }

    // Vertical roads
    for (let i = 0; i <= this.GRID_SIZE; i++) {
      const x = startX + i * this.BLOCK_SIZE;
      const road = createPlane(this.ROAD_WIDTH, this.GRID_SIZE * this.BLOCK_SIZE + this.ROAD_WIDTH, 0.3, 0.3, 0.32);
      roads.push({ data: road, offsetY: 0.02, offsetX: x });

      const marking = createPlane(0.15, this.GRID_SIZE * this.BLOCK_SIZE, 0.95, 0.95, 0.9);
      roads.push({ data: marking, offsetY: 0.04, offsetX: x });
    }

    // Sidewalks along roads
    for (let i = 0; i <= this.GRID_SIZE; i++) {
      const z = startZ + i * this.BLOCK_SIZE;
      const sidewalkW = 2;
      // Sidewalks on both sides of horizontal roads
      const sw1 = createPlane(this.GRID_SIZE * this.BLOCK_SIZE + this.ROAD_WIDTH, sidewalkW, 0.55, 0.55, 0.52);
      roads.push({ data: sw1, offsetY: 0.05, offsetZ: z - this.ROAD_WIDTH / 2 - sidewalkW / 2 });
      const sw2 = createPlane(this.GRID_SIZE * this.BLOCK_SIZE + this.ROAD_WIDTH, sidewalkW, 0.55, 0.55, 0.52);
      roads.push({ data: sw2, offsetY: 0.05, offsetZ: z + this.ROAD_WIDTH / 2 + sidewalkW / 2 });

      const x = startX + i * this.BLOCK_SIZE;
      const sw3 = createPlane(sidewalkW, this.GRID_SIZE * this.BLOCK_SIZE + this.ROAD_WIDTH, 0.55, 0.55, 0.52);
      roads.push({ data: sw3, offsetY: 0.05, offsetX: x - this.ROAD_WIDTH / 2 - sidewalkW / 2 });
      const sw4 = createPlane(sidewalkW, this.GRID_SIZE * this.BLOCK_SIZE + this.ROAD_WIDTH, 0.55, 0.55, 0.52);
      roads.push({ data: sw4, offsetY: 0.05, offsetX: x + this.ROAD_WIDTH / 2 + sidewalkW / 2 });
    }

    // Merge all roads into one mesh
    const merged = mergeMeshes(...roads);
    this.roadMeshes.push(renderer.createMesh(merged.vertices, merged.indices, 'terrain'));
  }

  private generateBuildings(renderer: Renderer) {
    const rng = seededRandom(42);
    const startX = -(this.GRID_SIZE * this.BLOCK_SIZE) / 2;
    const startZ = -(this.GRID_SIZE * this.BLOCK_SIZE) / 2;
    const margin = this.ROAD_WIDTH / 2 + 2;

    for (let gz = 0; gz < this.GRID_SIZE; gz++) {
      for (let gx = 0; gx < this.GRID_SIZE; gx++) {
        const blockX = startX + gx * this.BLOCK_SIZE + this.BLOCK_SIZE / 2;
        const blockZ = startZ + gz * this.BLOCK_SIZE + this.BLOCK_SIZE / 2;

        // Skip blocks near airport
        if (Math.abs(blockX - this.AIRPORT_X) < 200 && Math.abs(blockZ - this.AIRPORT_Z) < 200) continue;

        // Downtown = taller buildings near center
        const distFromCenter = Math.sqrt(blockX * blockX + blockZ * blockZ);
        const downtownFactor = Math.max(0, 1 - distFromCenter / 300);

        // Generate 2-6 buildings per block
        const numBuildings = 2 + Math.floor(rng() * 4);
        for (let i = 0; i < numBuildings; i++) {
          const w = 8 + rng() * 20;
          const d = 8 + rng() * 20;
          const minH = 5;
          const maxH = 15 + downtownFactor * 80;
          const h = minH + rng() * (maxH - minH);

          // Random position within block
          const halfBlock = this.BLOCK_SIZE / 2 - margin;
          const bx = blockX + (rng() - 0.5) * (halfBlock * 2 - w);
          const bz = blockZ + (rng() - 0.5) * (halfBlock * 2 - d);

          // Building color
          const shade = 0.4 + rng() * 0.35;
          const tint = rng();
          let cr: number, cg: number, cb: number;
          if (tint < 0.3) { // Concrete grey
            cr = shade; cg = shade * 0.95; cb = shade * 0.9;
          } else if (tint < 0.5) { // Blue glass
            cr = shade * 0.6; cg = shade * 0.7; cb = shade;
          } else if (tint < 0.7) { // Warm
            cr = shade; cg = shade * 0.85; cb = shade * 0.7;
          } else { // Brown/brick
            cr = shade * 0.9; cg = shade * 0.65; cb = shade * 0.5;
          }

          this.buildings.push({ x: bx, z: bz, w, d, h, r: cr, g: cg, b: cb });

          // Main building box
          const meshParts: { data: MeshData; offsetX?: number; offsetY?: number; offsetZ?: number }[] = [];
          meshParts.push({ data: createBox(w, h, d, cr, cg, cb) });

          // Window rows
          if (h > 10) {
            const windowRows = Math.floor(h / 4);
            for (let wy = 0; wy < windowRows; wy++) {
              const windowStrip = createBox(w + 0.1, 1.5, d + 0.1, cr * 0.5 + 0.2, cg * 0.5 + 0.25, cb * 0.5 + 0.35);
              meshParts.push({ data: windowStrip, offsetY: -h/2 + 3 + wy * 4 });
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

  private generateAirport(renderer: Renderer) {
    const ax = this.AIRPORT_X;
    const az = this.AIRPORT_Z;

    // Runway
    const runway = createPlane(this.RUNWAY_WIDTH, this.RUNWAY_LENGTH, 0.25, 0.25, 0.28);
    const runwayMesh = renderer.createMesh(runway.vertices, runway.indices, 'terrain');
    this.airportMeshes.push({ mesh: runwayMesh, modelMatrix: mat4.translation(ax, 0.03, az) });

    // Runway markings
    for (let i = -5; i <= 5; i++) {
      const mark = createPlane(1, 8, 0.95, 0.95, 0.9);
      const markMesh = renderer.createMesh(mark.vertices, mark.indices, 'terrain');
      this.airportMeshes.push({ mesh: markMesh, modelMatrix: mat4.translation(ax, 0.05, az + i * 25) });
    }

    // Threshold markings
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 4; i++) {
        const thresh = createPlane(1.5, 15, 0.95, 0.95, 0.9);
        const threshMesh = renderer.createMesh(thresh.vertices, thresh.indices, 'terrain');
        this.airportMeshes.push({
          mesh: threshMesh,
          modelMatrix: mat4.translation(ax + (i - 1.5) * 3, 0.05, az + side * (this.RUNWAY_LENGTH / 2 - 12))
        });
      }
    }

    // Taxiway
    const taxiway = createPlane(12, 100, 0.28, 0.28, 0.3);
    const taxiMesh = renderer.createMesh(taxiway.vertices, taxiway.indices, 'terrain');
    this.airportMeshes.push({ mesh: taxiMesh, modelMatrix: mat4.translation(ax + 40, 0.03, az) });

    // Connecting taxiway
    const connector = createPlane(50, 12, 0.28, 0.28, 0.3);
    const connMesh = renderer.createMesh(connector.vertices, connector.indices, 'terrain');
    this.airportMeshes.push({ mesh: connMesh, modelMatrix: mat4.translation(ax + 20, 0.03, az) });

    // Terminal building
    const terminal = createBox(60, 15, 30, 0.7, 0.72, 0.75);
    const termMesh = renderer.createMesh(terminal.vertices, terminal.indices, 'object');
    this.airportMeshes.push({ mesh: termMesh, modelMatrix: mat4.translation(ax + 70, 7.5, az) });

    // Terminal windows
    const termWindows = createBox(60.2, 8, 30.2, 0.4, 0.55, 0.75);
    const termWinMesh = renderer.createMesh(termWindows.vertices, termWindows.indices, 'object');
    this.airportMeshes.push({ mesh: termWinMesh, modelMatrix: mat4.translation(ax + 70, 10, az) });

    // Control tower
    const towerBase = createBox(8, 25, 8, 0.65, 0.65, 0.68);
    const towerTop = createBox(12, 5, 12, 0.4, 0.5, 0.6);
    const towerBaseMesh = renderer.createMesh(towerBase.vertices, towerBase.indices, 'object');
    const towerTopMesh = renderer.createMesh(towerTop.vertices, towerTop.indices, 'object');
    this.airportMeshes.push({ mesh: towerBaseMesh, modelMatrix: mat4.translation(ax + 90, 12.5, az + 30) });
    this.airportMeshes.push({ mesh: towerTopMesh, modelMatrix: mat4.translation(ax + 90, 27.5, az + 30) });

    // Hangars
    for (let i = 0; i < 3; i++) {
      const hangar = createBox(25, 12, 20, 0.5, 0.52, 0.55);
      const hangarMesh = renderer.createMesh(hangar.vertices, hangar.indices, 'object');
      this.airportMeshes.push({ mesh: hangarMesh, modelMatrix: mat4.translation(ax + 60, 6, az - 60 - i * 30) });
    }

    // Apron (parking area for planes)
    const apron = createPlane(80, 80, 0.32, 0.32, 0.34);
    const apronMesh = renderer.createMesh(apron.vertices, apron.indices, 'terrain');
    this.airportMeshes.push({ mesh: apronMesh, modelMatrix: mat4.translation(ax + 60, 0.02, az) });
  }

  private generateTrees(renderer: Renderer) {
    const rng = seededRandom(1337);

    // Create a few tree variants
    const treeVariants: ReturnType<typeof renderer.createMesh>[] = [];

    // Type 1: Round deciduous tree
    const t1 = mergeMeshes(
      { data: createCylinder(0.15, 3.5, 6, 0.4, 0.28, 0.15) },
      { data: createSphere(1.8, 6, 0.22, 0.5, 0.18), offsetY: 3.5 },
      { data: createSphere(1.4, 5, 0.18, 0.55, 0.2), offsetY: 4.5 },
      { data: createSphere(1.0, 5, 0.25, 0.52, 0.22), offsetY: 3.0, offsetX: 0.8 },
    );
    treeVariants.push(renderer.createMesh(t1.vertices, t1.indices, 'object'));

    // Type 2: Tall palm-like tree
    const t2 = mergeMeshes(
      { data: createTaperedBox(0.25, 0.15, 5, 0.25, 0.15, 0.45, 0.32, 0.18) },
      { data: createBox(3.5, 0.15, 1.2, 0.15, 0.52, 0.15), offsetY: 4.8 },
      { data: createBox(1.2, 0.15, 3.5, 0.15, 0.52, 0.15), offsetY: 4.8 },
      { data: createSphere(0.6, 4, 0.12, 0.45, 0.1), offsetY: 5.0 },
    );
    treeVariants.push(renderer.createMesh(t2.vertices, t2.indices, 'object'));

    // Type 3: Bushy conifer
    const t3 = mergeMeshes(
      { data: createCylinder(0.12, 2.5, 5, 0.38, 0.25, 0.12) },
      { data: createTaperedBox(2.4, 0.3, 2.0, 2.4, 0.3, 0.12, 0.42, 0.1), offsetY: 2.5 },
      { data: createTaperedBox(2.0, 0.2, 1.6, 2.0, 0.2, 0.14, 0.45, 0.12), offsetY: 3.8 },
      { data: createTaperedBox(1.4, 0.1, 1.2, 1.4, 0.1, 0.16, 0.48, 0.14), offsetY: 4.8 },
    );
    treeVariants.push(renderer.createMesh(t3.vertices, t3.indices, 'object'));

    for (let i = 0; i < 600; i++) {
      const x = (rng() - 0.5) * this.WORLD_SIZE * 1.6;
      const z = (rng() - 0.5) * this.WORLD_SIZE * 1.6;

      if (this.isOnRoad(x, z)) continue;
      if (this.isOnBuilding(x, z)) continue;
      if (Math.abs(x - this.AIRPORT_X) < 120 && Math.abs(z - this.AIRPORT_Z) < 200) continue;

      const scale = 0.7 + rng() * 0.8;
      const variant = Math.floor(rng() * treeVariants.length);
      const rotY = rng() * Math.PI * 2;
      const model = mat4.multiply(
        mat4.translation(x, 0, z),
        mat4.multiply(mat4.rotationY(rotY), mat4.scaling(scale, scale, scale))
      );
      this.treeMeshes.push({ mesh: treeVariants[variant], modelMatrix: model });
    }
  }

  spawnVehicles(renderer: Renderer) {
    // Spawn cars along roads
    const rng = seededRandom(999);
    const startX = -(this.GRID_SIZE * this.BLOCK_SIZE) / 2;
    const startZ = -(this.GRID_SIZE * this.BLOCK_SIZE) / 2;

    const types: ('sedan' | 'sports' | 'truck')[] = ['sedan', 'sports', 'truck'];

    for (let i = 0; i <= this.GRID_SIZE; i++) {
      // Cars on horizontal roads
      const z = startZ + i * this.BLOCK_SIZE;
      for (let j = 0; j < 3; j++) {
        const x = startX + rng() * this.GRID_SIZE * this.BLOCK_SIZE;
        const type = types[Math.floor(rng() * types.length)];
        const car = new Vehicle(type, [x, 0, z + 3]);
        car.body.rotation = Math.PI / 2 * (rng() > 0.5 ? 1 : -1);
        car.createMesh(renderer);
        this.vehicles.push(car);
      }

      // Cars on vertical roads
      const x = startX + i * this.BLOCK_SIZE;
      for (let j = 0; j < 3; j++) {
        const zz = startZ + rng() * this.GRID_SIZE * this.BLOCK_SIZE;
        const type = types[Math.floor(rng() * types.length)];
        const car = new Vehicle(type, [x + 3, 0, zz]);
        car.body.rotation = rng() > 0.5 ? 0 : Math.PI;
        car.createMesh(renderer);
        this.vehicles.push(car);
      }
    }

    // Planes at airport
    const planePositions: Vec3[] = [
      [this.AIRPORT_X + 45, 0, this.AIRPORT_Z - 20],
      [this.AIRPORT_X + 45, 0, this.AIRPORT_Z + 20],
      [this.AIRPORT_X, 0, this.AIRPORT_Z + this.RUNWAY_LENGTH / 2 - 20],
    ];
    for (const pos of planePositions) {
      const plane = new Vehicle('plane', pos);
      plane.body.rotation = Math.PI;
      plane.createMesh(renderer);
      this.vehicles.push(plane);
    }
  }

  isOnRoad(x: number, z: number): boolean {
    const startX = -(this.GRID_SIZE * this.BLOCK_SIZE) / 2;
    const startZ = -(this.GRID_SIZE * this.BLOCK_SIZE) / 2;
    const halfRoad = this.ROAD_WIDTH / 2;

    for (let i = 0; i <= this.GRID_SIZE; i++) {
      if (Math.abs(z - (startZ + i * this.BLOCK_SIZE)) < halfRoad) return true;
      if (Math.abs(x - (startX + i * this.BLOCK_SIZE)) < halfRoad) return true;
    }
    return false;
  }

  isOnBuilding(x: number, z: number): boolean {
    for (const b of this.buildings) {
      if (Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1) return true;
    }
    return false;
  }

  getGroundHeight(x: number, z: number): number {
    if (this.isOnRoad(x, z)) return 0.02;
    if (Math.abs(x - this.AIRPORT_X) < 60 && Math.abs(z - this.AIRPORT_Z) < this.RUNWAY_LENGTH / 2) return 0.03;
    return 0;
  }

  // Returns a push-out vector if (x,z) with given radius collides with a building, else null
  checkBuildingCollision(x: number, z: number, radius: number): Vec3 | null {
    for (const b of this.buildings) {
      const hw = b.w / 2 + radius;
      const hd = b.d / 2 + radius;
      const dx = x - b.x;
      const dz = z - b.z;

      if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
        // Inside building AABB, push out along shortest axis
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

    // Ground
    objects.push({ mesh: this.groundMesh, modelMatrix: mat4.create() });

    // Roads
    for (const road of this.roadMeshes) {
      objects.push({ mesh: road, modelMatrix: mat4.create() });
    }

    // Buildings
    for (const b of this.buildingMeshes) {
      objects.push({ mesh: b.mesh, modelMatrix: b.modelMatrix });
    }

    // Airport
    for (const a of this.airportMeshes) {
      objects.push({ mesh: a.mesh, modelMatrix: a.modelMatrix });
    }

    // Trees
    for (const t of this.treeMeshes) {
      objects.push({ mesh: t.mesh, modelMatrix: t.modelMatrix });
    }

    // Vehicles
    for (const v of this.vehicles) {
      objects.push(v.getRenderObject());
    }

    return objects;
  }
}
