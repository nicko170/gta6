import { Renderer, Mesh, RenderObject } from '../engine/renderer';
import { Vehicle, VehicleType } from '../vehicles/vehicle';
import { Vec3, mat4 } from '../engine/math';
import { createBox, mergeMeshes } from '../engine/meshgen';
import { CITY_X, CITY_Z, CITY_ROAD_X, CITY_ROAD_Z } from './terrain';

// ---- Road grid constants ----
const ROAD_WIDTH = 14;
const HALF_ROAD = ROAD_WIDTH / 2;
const LANE_OFFSET = 3; // offset from road center for lane driving
const SIDEWALK_WIDTH = 2;
const SIDEWALK_OFFSET = HALF_ROAD + SIDEWALK_WIDTH / 2; // 8 units from road center

// Use precomputed variable-width road positions from terrain.ts
const ROAD_POSITIONS_X = CITY_ROAD_X;
const ROAD_POSITIONS_Z = CITY_ROAD_Z;

// Road extent: cars should stay within the grid road area
const ROAD_MIN_X = CITY_ROAD_X[0] - HALF_ROAD;
const ROAD_MAX_X = CITY_ROAD_X[CITY_ROAD_X.length - 1] + HALF_ROAD;
const ROAD_MIN_Z = CITY_ROAD_Z[0] - HALF_ROAD;
const ROAD_MAX_Z = CITY_ROAD_Z[CITY_ROAD_Z.length - 1] + HALF_ROAD;

// ---- Seeded random ----
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ---- Direction helpers ----
// Direction: 0 = +X, 1 = +Z, 2 = -X, 3 = -Z
type Direction = 0 | 1 | 2 | 3;

function directionAngle(dir: Direction): number {
  switch (dir) {
    case 0: return -Math.PI / 2;  // +X
    case 1: return 0;              // +Z
    case 2: return Math.PI / 2;    // -X
    case 3: return Math.PI;        // -Z
  }
}

function directionVector(dir: Direction): [number, number] {
  switch (dir) {
    case 0: return [1, 0];
    case 1: return [0, 1];
    case 2: return [-1, 0];
    case 3: return [0, -1];
  }
}

function oppositeDir(dir: Direction): Direction {
  return ((dir + 2) % 4) as Direction;
}

// Lane offset perpendicular to travel direction (drive on the right side)
function laneOffset(dir: Direction): [number, number] {
  switch (dir) {
    case 0: return [0, -LANE_OFFSET];  // traveling +X, lane offset -Z
    case 1: return [LANE_OFFSET, 0];   // traveling +Z, lane offset +X
    case 2: return [0, LANE_OFFSET];   // traveling -X, lane offset +Z
    case 3: return [-LANE_OFFSET, 0];  // traveling -Z, lane offset -X
  }
}

// ---- AI Car state ----
interface AICarState {
  vehicle: Vehicle;
  roadIndex: number;       // index into ROAD_POSITIONS_X or _Z for the road we're on
  horizontal: boolean;     // true = traveling along X axis (road is at fixed Z)
  direction: Direction;
  speed: number;
  targetSpeed: number;
  nextDecisionDist: number; // distance to next intersection for decision
  waitTimer: number;        // > 0 if waiting at intersection
  turnCooldown: number;     // prevents immediate re-turning
}

// ---- AITraffic class ----
export class AITraffic {
  vehicles: Vehicle[] = [];
  private cars: AICarState[] = [];
  private spawned = false;

  constructor() {}

  spawn(renderer: Renderer): void {
    if (this.spawned) return;
    this.spawned = true;

    const rng = seededRandom(7777);
    const count = 20 + Math.floor(rng() * 11); // 20-30 cars
    const types: VehicleType[] = ['sedan', 'sports', 'truck'];

    for (let i = 0; i < count; i++) {
      const horizontal = rng() > 0.5;
      const roadIndex = Math.floor(rng() * ROAD_POSITIONS_X.length);

      // Pick a direction
      let dir: Direction;
      if (horizontal) {
        dir = rng() > 0.5 ? 0 : 2; // +X or -X
      } else {
        dir = rng() > 0.5 ? 1 : 3; // +Z or -Z
      }

      // Place car along the road at a random position
      const [lx, lz] = laneOffset(dir);

      let x: number, z: number;
      if (horizontal) {
        const roadPos = ROAD_POSITIONS_Z[roadIndex];
        const t = rng();
        x = ROAD_MIN_X + t * (ROAD_MAX_X - ROAD_MIN_X);
        z = roadPos + lz;
      } else {
        const roadPos = ROAD_POSITIONS_X[roadIndex];
        const t = rng();
        x = roadPos + lx;
        z = ROAD_MIN_Z + t * (ROAD_MAX_Z - ROAD_MIN_Z);
      }

      const type = types[Math.floor(rng() * types.length)];
      const vehicle = new Vehicle(type, [x, 0, z]);
      vehicle.body.rotation = directionAngle(dir);
      vehicle.createMesh(renderer);

      const targetSpeed = 10 + rng() * 15; // 10-25 units/sec

      this.vehicles.push(vehicle);
      this.cars.push({
        vehicle,
        roadIndex,
        horizontal,
        direction: dir,
        speed: targetSpeed * (0.5 + rng() * 0.5), // start at partial speed
        targetSpeed,
        nextDecisionDist: 0,
        waitTimer: 0,
        turnCooldown: 0,
      });
    }
  }

  update(dt: number, getGroundHeight: (x: number, z: number) => number): void {
    for (const car of this.cars) {
      this.updateCar(car, dt, getGroundHeight);
    }
  }

  private updateCar(car: AICarState, dt: number, getGroundHeight: (x: number, z: number) => number): void {
    const v = car.vehicle;
    const pos = v.body.position;

    // Decrease cooldowns
    if (car.turnCooldown > 0) car.turnCooldown -= dt;

    // Wait timer (stopped at intersection, e.g. simulating red light)
    if (car.waitTimer > 0) {
      car.waitTimer -= dt;
      car.speed *= 0.9; // decelerate while waiting
      if (car.speed < 0.5) car.speed = 0;
      // Still apply ground height
      pos[1] = getGroundHeight(pos[0], pos[2]);
      return;
    }

    // Accelerate/decelerate toward target speed
    if (car.speed < car.targetSpeed) {
      car.speed = Math.min(car.targetSpeed, car.speed + 12 * dt);
    } else {
      car.speed = Math.max(car.targetSpeed, car.speed - 8 * dt);
    }

    // Move along direction
    const [dx, dz] = directionVector(car.direction);
    pos[0] += dx * car.speed * dt;
    pos[2] += dz * car.speed * dt;

    // Keep car on the ground
    pos[1] = getGroundHeight(pos[0], pos[2]);

    // Smooth rotation toward desired angle
    const targetAngle = directionAngle(car.direction);
    let angleDiff = targetAngle - v.body.rotation;
    // Normalize to [-PI, PI]
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    v.body.rotation += angleDiff * Math.min(1, 5 * dt);

    // Lane correction: drift back toward the correct lane position
    const [lx, lz] = laneOffset(car.direction);

    if (car.horizontal) {
      const roadCenter = ROAD_POSITIONS_Z[car.roadIndex];
      const targetZ = roadCenter + lz;
      const zErr = targetZ - pos[2];
      pos[2] += zErr * Math.min(1, 3 * dt);
    } else {
      const roadCenter = ROAD_POSITIONS_X[car.roadIndex];
      const targetX = roadCenter + lx;
      const xErr = targetX - pos[0];
      pos[0] += xErr * Math.min(1, 3 * dt);
    }

    // Check for intersections and make decisions
    if (car.turnCooldown <= 0) {
      this.checkIntersection(car);
    }

    // Wrap around: if car goes beyond the road grid, teleport to the other end
    const margin = 20;
    if (car.horizontal) {
      if (car.direction === 0 && pos[0] > ROAD_MAX_X + margin) {
        pos[0] = ROAD_MIN_X - margin;
      } else if (car.direction === 2 && pos[0] < ROAD_MIN_X - margin) {
        pos[0] = ROAD_MAX_X + margin;
      }
    } else {
      if (car.direction === 1 && pos[2] > ROAD_MAX_Z + margin) {
        pos[2] = ROAD_MIN_Z - margin;
      } else if (car.direction === 3 && pos[2] < ROAD_MIN_Z - margin) {
        pos[2] = ROAD_MAX_Z + margin;
      }
    }

    // Simple collision avoidance with other AI cars
    for (const other of this.cars) {
      if (other === car) continue;
      const op = other.vehicle.body.position;
      const ddx = op[0] - pos[0];
      const ddz = op[2] - pos[2];
      const dist = Math.sqrt(ddx * ddx + ddz * ddz);

      if (dist < 8) {
        // Check if the other car is ahead of us in our travel direction
        const [fdx, fdz] = directionVector(car.direction);
        const dot = ddx * fdx + ddz * fdz;
        if (dot > 0 && dot < 12) {
          // Other car is ahead - slow down
          car.speed = Math.max(0, car.speed - 30 * dt);
        }
      }
    }
  }

  private checkIntersection(car: AICarState): void {
    const pos = car.vehicle.body.position;

    // Cross-road positions depending on orientation
    const crossPositions = car.horizontal ? ROAD_POSITIONS_X : ROAD_POSITIONS_Z;

    for (const crossPos of crossPositions) {
      let distToIntersection: number;

      if (car.horizontal) {
        distToIntersection = Math.abs(pos[0] - crossPos);
      } else {
        distToIntersection = Math.abs(pos[2] - crossPos);
      }

      if (distToIntersection < 2.0) {
        car.turnCooldown = 3.0;

        const rng = Math.random();

        if (rng < 0.15) {
          car.waitTimer = 1.5 + Math.random() * 3.0;
          return;
        }

        if (rng < 0.45) {
          const crossRoadIndex = crossPositions.indexOf(crossPos);
          if (crossRoadIndex === -1) return;

          const turnRight = Math.random() > 0.5;

          let newDir: Direction;
          if (car.horizontal) {
            if (car.direction === 0) {
              newDir = turnRight ? 3 : 1;
            } else {
              newDir = turnRight ? 1 : 3;
            }
          } else {
            if (car.direction === 1) {
              newDir = turnRight ? 0 : 2;
            } else {
              newDir = turnRight ? 2 : 0;
            }
          }

          const [newLx, newLz] = laneOffset(newDir);
          if (car.horizontal) {
            pos[0] = crossPos + newLx;
            car.roadIndex = crossRoadIndex;
          } else {
            pos[2] = crossPos + newLz;
            car.roadIndex = crossRoadIndex;
          }

          car.direction = newDir;
          car.horizontal = !car.horizontal;

          car.targetSpeed = 10 + Math.random() * 15;
          car.speed *= 0.6;
          return;
        }

        car.targetSpeed = 10 + Math.random() * 15;
      }
    }
  }

  getRenderObjects(): RenderObject[] {
    const objects: RenderObject[] = [];
    for (const v of this.vehicles) {
      objects.push(v.getRenderObject());
    }
    return objects;
  }
}

// ---- NPC pedestrian state ----
interface NPCState {
  position: Vec3;
  velocity: Vec3;
  rotation: number;
  speed: number;
  targetSpeed: number;
  roadIndex: number;        // which road they're walking along
  horizontal: boolean;      // walking along horizontal or vertical road
  side: number;             // -1 or +1 for which side of the road
  direction: Direction;
  stopTimer: number;        // > 0 means standing still
  turnCooldown: number;
  hitTimer: number;         // > 0 means ragdolling from vehicle hit
}

// ---- Pedestrians class ----
export class Pedestrians {
  npcs: NPCState[] = [];
  private sharedMesh!: Mesh;
  private spawned = false;

  constructor() {}

  spawn(renderer: Renderer): void {
    if (this.spawned) return;
    this.spawned = true;

    // Create a simple humanoid mesh: body + head + legs
    const torso = createBox(0.5, 0.7, 0.3, 0.2, 0.35, 0.6);    // blue-ish shirt
    const head = createBox(0.3, 0.3, 0.3, 0.85, 0.7, 0.55);     // skin tone
    const legL = createBox(0.18, 0.6, 0.22, 0.25, 0.25, 0.35);  // dark pants
    const legR = createBox(0.18, 0.6, 0.22, 0.25, 0.25, 0.35);
    const armL = createBox(0.15, 0.55, 0.18, 0.2, 0.35, 0.6);
    const armR = createBox(0.15, 0.55, 0.18, 0.2, 0.35, 0.6);

    const merged = mergeMeshes(
      { data: torso, offsetY: 0.65 },
      { data: head, offsetY: 1.15 },
      { data: legL, offsetX: -0.13, offsetY: 0 },
      { data: legR, offsetX: 0.13, offsetY: 0 },
      { data: armL, offsetX: -0.35, offsetY: 0.6 },
      { data: armR, offsetX: 0.35, offsetY: 0.6 },
    );

    this.sharedMesh = renderer.createMesh(merged.vertices, merged.indices, 'object');

    const rng = seededRandom(5555);
    const count = 40 + Math.floor(rng() * 21); // 40-60 NPCs

    for (let i = 0; i < count; i++) {
      const horizontal = rng() > 0.5;
      const roadIndex = Math.floor(rng() * ROAD_POSITIONS_X.length);
      const side = rng() > 0.5 ? 1 : -1;

      let dir: Direction;
      if (horizontal) {
        dir = rng() > 0.5 ? 0 : 2;
      } else {
        dir = rng() > 0.5 ? 1 : 3;
      }

      let x: number, z: number;
      if (horizontal) {
        const roadCenter = ROAD_POSITIONS_Z[roadIndex];
        const along = ROAD_MIN_X + rng() * (ROAD_MAX_X - ROAD_MIN_X);
        x = along;
        z = roadCenter + side * SIDEWALK_OFFSET;
      } else {
        const roadCenter = ROAD_POSITIONS_X[roadIndex];
        const along = ROAD_MIN_Z + rng() * (ROAD_MAX_Z - ROAD_MIN_Z);
        x = roadCenter + side * SIDEWALK_OFFSET;
        z = along;
      }

      const walkSpeed = 1.5 + rng() * 1.5; // 1.5-3 units/sec

      this.npcs.push({
        position: [x, 0, z],
        velocity: [0, 0, 0],
        rotation: directionAngle(dir),
        speed: walkSpeed,
        targetSpeed: walkSpeed,
        roadIndex,
        horizontal,
        side,
        direction: dir,
        stopTimer: rng() < 0.1 ? 2 + rng() * 5 : 0, // some start stopped
        turnCooldown: rng() * 5,
        hitTimer: 0,
      });
    }
  }

  update(dt: number): void {
    for (const npc of this.npcs) {
      this.updateNPC(npc, dt);
    }
  }

  private updateNPC(npc: NPCState, dt: number): void {
    // Ragdoll from vehicle hit
    if (npc.hitTimer > 0) {
      npc.hitTimer -= dt;
      npc.velocity[1] -= 15 * dt; // gravity
      npc.position[0] += npc.velocity[0] * dt;
      npc.position[1] += npc.velocity[1] * dt;
      npc.position[2] += npc.velocity[2] * dt;
      npc.rotation += 8 * dt; // spin
      // Ground bounce
      if (npc.position[1] < 0.05) {
        npc.position[1] = 0.05;
        npc.velocity[1] = Math.abs(npc.velocity[1]) * 0.3;
        npc.velocity[0] *= 0.7;
        npc.velocity[2] *= 0.7;
      }
      if (npc.hitTimer <= 0) {
        npc.velocity = [0, 0, 0];
        npc.speed = 0;
        npc.stopTimer = 3 + Math.random() * 3; // stunned
      }
      return;
    }

    // Decrease cooldowns
    if (npc.turnCooldown > 0) npc.turnCooldown -= dt;

    // Handle stopping
    if (npc.stopTimer > 0) {
      npc.stopTimer -= dt;
      npc.speed *= 0.85;
      if (npc.speed < 0.05) npc.speed = 0;
      return;
    }

    // Random chance to stop (idle behavior)
    if (Math.random() < 0.001) {
      npc.stopTimer = 2 + Math.random() * 6;
      return;
    }

    // Accelerate to target speed
    if (npc.speed < npc.targetSpeed) {
      npc.speed = Math.min(npc.targetSpeed, npc.speed + 2 * dt);
    }

    // Move
    const [dx, dz] = directionVector(npc.direction);
    npc.position[0] += dx * npc.speed * dt;
    npc.position[2] += dz * npc.speed * dt;

    // Keep on ground
    npc.position[1] = 0.05; // sidewalk height

    // Smooth rotation
    const targetAngle = directionAngle(npc.direction);
    let angleDiff = targetAngle - npc.rotation;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    npc.rotation += angleDiff * Math.min(1, 6 * dt);

    // Sidewalk correction: keep on the sidewalk
    if (npc.horizontal) {
      const roadCenter = ROAD_POSITIONS_Z[npc.roadIndex];
      const sidewalkTarget = roadCenter + npc.side * SIDEWALK_OFFSET;
      const zErr = sidewalkTarget - npc.position[2];
      npc.position[2] += zErr * Math.min(1, 3 * dt);
    } else {
      const roadCenter = ROAD_POSITIONS_X[npc.roadIndex];
      const sidewalkTarget = roadCenter + npc.side * SIDEWALK_OFFSET;
      const xErr = sidewalkTarget - npc.position[0];
      npc.position[0] += xErr * Math.min(1, 3 * dt);
    }

    // Check for intersections - turn at cross roads
    if (npc.turnCooldown <= 0) {
      this.checkPedestrianIntersection(npc);
    }

    // Wrap around at the edges
    const margin = 10;
    if (npc.horizontal) {
      if (npc.direction === 0 && npc.position[0] > ROAD_MAX_X + margin) {
        npc.position[0] = ROAD_MIN_X - margin;
      } else if (npc.direction === 2 && npc.position[0] < ROAD_MIN_X - margin) {
        npc.position[0] = ROAD_MAX_X + margin;
      }
    } else {
      if (npc.direction === 1 && npc.position[2] > ROAD_MAX_Z + margin) {
        npc.position[2] = ROAD_MIN_Z - margin;
      } else if (npc.direction === 3 && npc.position[2] < ROAD_MIN_Z - margin) {
        npc.position[2] = ROAD_MAX_Z + margin;
      }
    }
  }

  private checkPedestrianIntersection(npc: NPCState): void {
    const crossPositions = npc.horizontal ? ROAD_POSITIONS_X : ROAD_POSITIONS_Z;

    for (const crossPos of crossPositions) {
      let distToIntersection: number;

      if (npc.horizontal) {
        distToIntersection = Math.abs(npc.position[0] - crossPos);
      } else {
        distToIntersection = Math.abs(npc.position[2] - crossPos);
      }

      if (distToIntersection < 1.5) {
        npc.turnCooldown = 4.0;

        const rng = Math.random();

        if (rng < 0.20) {
          npc.stopTimer = 2 + Math.random() * 4;
          return;
        }

        if (rng < 0.55) {
          const crossRoadIndex = crossPositions.indexOf(crossPos);
          if (crossRoadIndex === -1) return;

          const turnRight = Math.random() > 0.5;
          let newDir: Direction;

          if (npc.horizontal) {
            if (npc.direction === 0) {
              newDir = turnRight ? 3 : 1;
            } else {
              newDir = turnRight ? 1 : 3;
            }
          } else {
            if (npc.direction === 1) {
              newDir = turnRight ? 0 : 2;
            } else {
              newDir = turnRight ? 2 : 0;
            }
          }

          const newSide = Math.random() > 0.5 ? 1 : -1;
          const newSidewalkPos = crossPos + newSide * SIDEWALK_OFFSET;

          if (npc.horizontal) {
            npc.position[0] = newSidewalkPos;
          } else {
            npc.position[2] = newSidewalkPos;
          }

          npc.direction = newDir;
          npc.horizontal = !npc.horizontal;
          npc.roadIndex = crossRoadIndex;
          npc.side = newSide;

          npc.targetSpeed = 1.5 + Math.random() * 1.5;
          npc.speed *= 0.7;
          return;
        }

        if (rng < 0.70) {
          npc.direction = oppositeDir(npc.direction);
          npc.speed *= 0.5;
          return;
        }
      }
    }
  }

  getRenderObjects(): RenderObject[] {
    const objects: RenderObject[] = [];
    for (const npc of this.npcs) {
      const t = mat4.translation(npc.position[0], npc.position[1], npc.position[2]);
      const r = mat4.rotationY(npc.rotation);
      const modelMatrix = mat4.multiply(t, r);
      objects.push({ mesh: this.sharedMesh, modelMatrix });
    }
    return objects;
  }
}
