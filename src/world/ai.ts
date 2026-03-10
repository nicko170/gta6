import { Renderer, Mesh, RenderObject } from '../engine/renderer';
import { Vehicle, VehicleType } from '../vehicles/vehicle';
import { Vec3, mat4 } from '../engine/math';
import { createBox, mergeMeshes } from '../engine/meshgen';

// ---- Road grid constants ----
const GRID_SIZE = 6;
const BLOCK_SIZE = 80;
const ROAD_WIDTH = 14;
const HALF_ROAD = ROAD_WIDTH / 2;
const START = -(GRID_SIZE * BLOCK_SIZE) / 2; // -240
const LANE_OFFSET = 3; // offset from road center for lane driving
const SIDEWALK_WIDTH = 2;
const SIDEWALK_OFFSET = HALF_ROAD + SIDEWALK_WIDTH / 2; // 8 units from road center

// Road center positions: -240, -160, -80, 0, 80, 160, 240
const ROAD_POSITIONS: number[] = [];
for (let i = 0; i <= GRID_SIZE; i++) {
  ROAD_POSITIONS.push(START + i * BLOCK_SIZE);
}

// Road extent: cars should stay within the grid road area
const ROAD_MIN = START - HALF_ROAD;
const ROAD_MAX = START + GRID_SIZE * BLOCK_SIZE + HALF_ROAD;

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
  // Returns rotation angle (Y-axis) so the vehicle faces the direction of travel
  // Vehicle model faces +Z by default
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
  // Right-hand traffic: offset to the right of the travel direction
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
  roadIndex: number;       // index into ROAD_POSITIONS for the road we're on
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
      const roadIndex = Math.floor(rng() * ROAD_POSITIONS.length);
      const roadPos = ROAD_POSITIONS[roadIndex];

      // Pick a direction
      let dir: Direction;
      if (horizontal) {
        dir = rng() > 0.5 ? 0 : 2; // +X or -X
      } else {
        dir = rng() > 0.5 ? 1 : 3; // +Z or -Z
      }

      // Place car along the road at a random position
      const t = rng();
      const along = ROAD_MIN + t * (ROAD_MAX - ROAD_MIN);
      const [lx, lz] = laneOffset(dir);

      let x: number, z: number;
      if (horizontal) {
        x = along;
        z = roadPos + lz;
      } else {
        x = roadPos + lx;
        z = along;
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
    const roadCenter = ROAD_POSITIONS[car.roadIndex];

    if (car.horizontal) {
      // Road is at fixed Z = roadCenter, car should be at Z = roadCenter + lz
      const targetZ = roadCenter + lz;
      const zErr = targetZ - pos[2];
      pos[2] += zErr * Math.min(1, 3 * dt);
    } else {
      // Road is at fixed X = roadCenter, car should be at X = roadCenter + lx
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
      if (car.direction === 0 && pos[0] > ROAD_MAX + margin) {
        pos[0] = ROAD_MIN - margin;
      } else if (car.direction === 2 && pos[0] < ROAD_MIN - margin) {
        pos[0] = ROAD_MAX + margin;
      }
    } else {
      if (car.direction === 1 && pos[2] > ROAD_MAX + margin) {
        pos[2] = ROAD_MIN - margin;
      } else if (car.direction === 3 && pos[2] < ROAD_MIN - margin) {
        pos[2] = ROAD_MAX + margin;
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

    // Find nearest cross-road intersection
    for (const crossPos of ROAD_POSITIONS) {
      let distToIntersection: number;

      if (car.horizontal) {
        // We're on a horizontal road (fixed Z), check if we're at an X intersection
        distToIntersection = Math.abs(pos[0] - crossPos);
      } else {
        // We're on a vertical road (fixed X), check if we're at a Z intersection
        distToIntersection = Math.abs(pos[2] - crossPos);
      }

      // At an intersection (within a tight window so we decide once)
      if (distToIntersection < 2.0) {
        car.turnCooldown = 3.0; // don't check again for 3 seconds

        const rng = Math.random();

        // 15% chance to stop briefly (simulating traffic light)
        if (rng < 0.15) {
          car.waitTimer = 1.5 + Math.random() * 3.0;
          return;
        }

        // 30% chance to turn
        if (rng < 0.45) {
          // Find the cross-road index
          const crossRoadIndex = ROAD_POSITIONS.indexOf(crossPos);
          if (crossRoadIndex === -1) return;

          // Decide turn direction
          const turnRight = Math.random() > 0.5;

          // Switch from horizontal to vertical or vice versa
          let newDir: Direction;
          if (car.horizontal) {
            // Was going along X, now go along Z
            if (car.direction === 0) {
              newDir = turnRight ? 3 : 1; // +X: right = -Z, left = +Z
            } else {
              newDir = turnRight ? 1 : 3; // -X: right = +Z, left = -Z
            }
          } else {
            // Was going along Z, now go along X
            if (car.direction === 1) {
              newDir = turnRight ? 0 : 2; // +Z: right = +X, left = -X
            } else {
              newDir = turnRight ? 2 : 0; // -Z: right = -X, left = +X
            }
          }

          // Snap to the cross road
          const [newLx, newLz] = laneOffset(newDir);
          if (car.horizontal) {
            // Was horizontal, snapping X to crossPos, keeping on new vertical road
            pos[0] = crossPos + newLx;
            car.roadIndex = crossRoadIndex;
          } else {
            // Was vertical, snapping Z to crossPos, keeping on new horizontal road
            pos[2] = crossPos + newLz;
            car.roadIndex = crossRoadIndex;
          }

          car.direction = newDir;
          car.horizontal = !car.horizontal;

          // Slight speed variation after turn
          car.targetSpeed = 10 + Math.random() * 15;
          car.speed *= 0.6; // slow down through the turn
          return;
        }

        // Otherwise go straight, maybe adjust speed
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
  rotation: number;
  speed: number;
  targetSpeed: number;
  roadIndex: number;        // which road they're walking along
  horizontal: boolean;      // walking along horizontal or vertical road
  side: number;             // -1 or +1 for which side of the road
  direction: Direction;
  stopTimer: number;        // > 0 means standing still
  turnCooldown: number;
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
      const roadIndex = Math.floor(rng() * ROAD_POSITIONS.length);
      const roadCenter = ROAD_POSITIONS[roadIndex];
      const side = rng() > 0.5 ? 1 : -1;

      let dir: Direction;
      if (horizontal) {
        dir = rng() > 0.5 ? 0 : 2;
      } else {
        dir = rng() > 0.5 ? 1 : 3;
      }

      // Position along the sidewalk
      const along = ROAD_MIN + rng() * (ROAD_MAX - ROAD_MIN);
      const sidewalkPos = roadCenter + side * SIDEWALK_OFFSET;

      let x: number, z: number;
      if (horizontal) {
        // Horizontal road: fixed Z, walk along X
        x = along;
        z = sidewalkPos;
      } else {
        // Vertical road: fixed X, walk along Z
        x = sidewalkPos;
        z = along;
      }

      const walkSpeed = 1.5 + rng() * 1.5; // 1.5-3 units/sec

      this.npcs.push({
        position: [x, 0, z],
        rotation: directionAngle(dir),
        speed: walkSpeed,
        targetSpeed: walkSpeed,
        roadIndex,
        horizontal,
        side,
        direction: dir,
        stopTimer: rng() < 0.1 ? 2 + rng() * 5 : 0, // some start stopped
        turnCooldown: rng() * 5,
      });
    }
  }

  update(dt: number): void {
    for (const npc of this.npcs) {
      this.updateNPC(npc, dt);
    }
  }

  private updateNPC(npc: NPCState, dt: number): void {
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
    const roadCenter = ROAD_POSITIONS[npc.roadIndex];
    const sidewalkTarget = roadCenter + npc.side * SIDEWALK_OFFSET;

    if (npc.horizontal) {
      const zErr = sidewalkTarget - npc.position[2];
      npc.position[2] += zErr * Math.min(1, 3 * dt);
    } else {
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
      if (npc.direction === 0 && npc.position[0] > ROAD_MAX + margin) {
        npc.position[0] = ROAD_MIN - margin;
      } else if (npc.direction === 2 && npc.position[0] < ROAD_MIN - margin) {
        npc.position[0] = ROAD_MAX + margin;
      }
    } else {
      if (npc.direction === 1 && npc.position[2] > ROAD_MAX + margin) {
        npc.position[2] = ROAD_MIN - margin;
      } else if (npc.direction === 3 && npc.position[2] < ROAD_MIN - margin) {
        npc.position[2] = ROAD_MAX + margin;
      }
    }
  }

  private checkPedestrianIntersection(npc: NPCState): void {
    for (const crossPos of ROAD_POSITIONS) {
      let distToIntersection: number;

      if (npc.horizontal) {
        distToIntersection = Math.abs(npc.position[0] - crossPos);
      } else {
        distToIntersection = Math.abs(npc.position[2] - crossPos);
      }

      if (distToIntersection < 1.5) {
        npc.turnCooldown = 4.0;

        const rng = Math.random();

        // 20% chance to stop at intersection
        if (rng < 0.20) {
          npc.stopTimer = 2 + Math.random() * 4;
          return;
        }

        // 35% chance to turn onto the cross-street sidewalk
        if (rng < 0.55) {
          const crossRoadIndex = ROAD_POSITIONS.indexOf(crossPos);
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

          // Pick a sidewalk side for the new road
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

          // Slight speed variation
          npc.targetSpeed = 1.5 + Math.random() * 1.5;
          npc.speed *= 0.7;
          return;
        }

        // 15% chance to turn around
        if (rng < 0.70) {
          npc.direction = oppositeDir(npc.direction);
          npc.speed *= 0.5;
          return;
        }

        // Otherwise keep going straight
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
