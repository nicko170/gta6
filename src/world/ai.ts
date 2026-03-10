import { Renderer, Mesh, RenderObject } from '../engine/renderer';
import { Vehicle, VehicleType } from '../vehicles/vehicle';
import { Vec3, mat4 } from '../engine/math';
import { createBox, mergeMeshes } from '../engine/meshgen';
import {
  ROAD_SEGMENTS, ROAD_NODES, RoadSegment,
  getSegmentPoints, getPointAlongSegment, getTangentAlongSegment,
  getSegmentLength, getNonDeadEndSegments, getConnectedSegments,
  getOtherNode, getNodeById, isOnAnyRoad,
} from './road-network';

// Seeded random
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const LANE_OFFSET = 3;

// ---- AI Car state ----
interface AICarState {
  vehicle: Vehicle;
  currentSegment: RoadSegment;
  segmentProgress: number;  // 0-1 along segment
  forward: boolean;          // true = from->to, false = to->from
  speed: number;
  targetSpeed: number;
  waitTimer: number;
  decisionMade: boolean;     // already chose at current node endpoint?
}

// ---- AITraffic class ----
export class AITraffic {
  vehicles: Vehicle[] = [];
  private cars: AICarState[] = [];
  private spawned = false;
  private drivableSegments: RoadSegment[] = [];

  constructor() {}

  spawn(renderer: Renderer): void {
    if (this.spawned) return;
    this.spawned = true;

    this.drivableSegments = getNonDeadEndSegments();
    if (this.drivableSegments.length === 0) return;

    const rng = seededRandom(7777);
    const count = 20 + Math.floor(rng() * 11); // 20-30 cars
    const types: VehicleType[] = ['sedan', 'sports', 'truck'];

    for (let i = 0; i < count; i++) {
      const seg = this.drivableSegments[Math.floor(rng() * this.drivableSegments.length)];
      const progress = 0.1 + rng() * 0.8;
      const forward = rng() > 0.5;

      const [px, pz] = getPointAlongSegment(seg, progress);
      const [tx, tz] = getTangentAlongSegment(seg, progress);

      // Lane offset (drive on right side)
      const dir = forward ? 1 : -1;
      const perpX = -tz * dir;
      const perpZ = tx * dir;
      const x = px + perpX * LANE_OFFSET;
      const z = pz + perpZ * LANE_OFFSET;

      const angle = Math.atan2(tx * dir, tz * dir);

      const type = types[Math.floor(rng() * types.length)];
      const vehicle = new Vehicle(type, [x, 0, z]);
      vehicle.body.rotation = angle;
      vehicle.createMesh(renderer);

      const targetSpeed = 10 + rng() * 15;

      this.vehicles.push(vehicle);
      this.cars.push({
        vehicle,
        currentSegment: seg,
        segmentProgress: progress,
        forward,
        speed: targetSpeed * (0.5 + rng() * 0.5),
        targetSpeed,
        waitTimer: 0,
        decisionMade: false,
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

    // Wait timer
    if (car.waitTimer > 0) {
      car.waitTimer -= dt;
      car.speed *= 0.9;
      if (car.speed < 0.5) car.speed = 0;
      pos[1] = getGroundHeight(pos[0], pos[2]);
      return;
    }

    // Accelerate/decelerate
    if (car.speed < car.targetSpeed) {
      car.speed = Math.min(car.targetSpeed, car.speed + 12 * dt);
    } else {
      car.speed = Math.max(car.targetSpeed, car.speed - 8 * dt);
    }

    // Advance along segment
    const segLen = getSegmentLength(car.currentSegment);
    if (segLen > 0) {
      const progressDelta = (car.speed * dt) / segLen;
      car.segmentProgress += car.forward ? progressDelta : -progressDelta;
    }

    // Check if reached segment end
    if (car.segmentProgress >= 1 || car.segmentProgress <= 0) {
      this.handleNodeTransition(car);
    }

    // Clamp progress
    car.segmentProgress = Math.max(0.001, Math.min(0.999, car.segmentProgress));

    // Compute position from segment
    const [px, pz] = getPointAlongSegment(car.currentSegment, car.segmentProgress);
    const [tx, tz] = getTangentAlongSegment(car.currentSegment, car.segmentProgress);

    const dir = car.forward ? 1 : -1;
    const perpX = -tz * dir;
    const perpZ = tx * dir;

    const targetX = px + perpX * LANE_OFFSET;
    const targetZ = pz + perpZ * LANE_OFFSET;

    // Smooth position toward target (avoids teleporting on transitions)
    pos[0] += (targetX - pos[0]) * Math.min(1, 8 * dt);
    pos[2] += (targetZ - pos[2]) * Math.min(1, 8 * dt);
    pos[1] = getGroundHeight(pos[0], pos[2]);

    // Smooth rotation
    const targetAngle = Math.atan2(tx * dir, tz * dir);
    let angleDiff = targetAngle - v.body.rotation;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    v.body.rotation += angleDiff * Math.min(1, 5 * dt);

    // Collision avoidance
    for (const other of this.cars) {
      if (other === car) continue;
      const op = other.vehicle.body.position;
      const ddx = op[0] - pos[0];
      const ddz = op[2] - pos[2];
      const dist = Math.sqrt(ddx * ddx + ddz * ddz);

      if (dist < 8) {
        const fdx = Math.sin(v.body.rotation);
        const fdz = Math.cos(v.body.rotation);
        const dot = ddx * fdx + ddz * fdz;
        if (dot > 0 && dot < 12) {
          car.speed = Math.max(0, car.speed - 30 * dt);
        }
      }
    }
  }

  private handleNodeTransition(car: AICarState): void {
    const atEnd = car.segmentProgress >= 1;
    const nodeId = atEnd
      ? (car.forward ? car.currentSegment.to : car.currentSegment.from)
      : (car.forward ? car.currentSegment.from : car.currentSegment.to);

    const node = getNodeById(nodeId);
    if (!node) {
      // Reverse direction
      car.forward = !car.forward;
      car.segmentProgress = car.forward ? 0.01 : 0.99;
      return;
    }

    // Get connected segments (excluding current)
    const connected = getConnectedSegments(nodeId)
      .filter(s => s.id !== car.currentSegment.id && !s.isCulDeSac);

    if (connected.length === 0) {
      // Dead end - reverse
      car.forward = !car.forward;
      car.segmentProgress = car.forward ? 0.01 : 0.99;
      car.speed *= 0.4;
      return;
    }

    // Random wait chance (simulate traffic light)
    if (Math.random() < 0.15) {
      car.waitTimer = 1.5 + Math.random() * 3;
    }

    // Pick random connected segment
    const nextSeg = connected[Math.floor(Math.random() * connected.length)];
    car.currentSegment = nextSeg;
    // Determine direction: if this node is the 'from' node, go forward
    car.forward = nextSeg.from === nodeId;
    car.segmentProgress = car.forward ? 0.01 : 0.99;
    car.targetSpeed = 10 + Math.random() * 15;
    car.speed *= 0.6;
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
  currentSegment: RoadSegment;
  segmentProgress: number;
  forward: boolean;
  sidewalkSide: number;     // -1 or +1 for which side of the road
  stopTimer: number;
  transitionCooldown: number;
  hitTimer: number;
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

    const torso = createBox(0.5, 0.7, 0.3, 0.2, 0.35, 0.6);
    const head = createBox(0.3, 0.3, 0.3, 0.85, 0.7, 0.55);
    const legL = createBox(0.18, 0.6, 0.22, 0.25, 0.25, 0.35);
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

    const drivableSegments = getNonDeadEndSegments();
    if (drivableSegments.length === 0) return;

    const rng = seededRandom(5555);
    const count = 40 + Math.floor(rng() * 21); // 40-60 NPCs

    for (let i = 0; i < count; i++) {
      const seg = drivableSegments[Math.floor(rng() * drivableSegments.length)];
      // Only put pedestrians on narrower roads (sidewalks)
      if (seg.width > 14) {
        // Try again with different segment
        continue;
      }

      const progress = rng();
      const forward = rng() > 0.5;
      const side = rng() > 0.5 ? 1 : -1;

      const [px, pz] = getPointAlongSegment(seg, progress);
      const [tx, tz] = getTangentAlongSegment(seg, progress);

      const dir = forward ? 1 : -1;
      const perpX = -tz;
      const perpZ = tx;
      const sidewalkOffset = seg.width / 2 + 1.5; // on sidewalk
      const x = px + perpX * side * sidewalkOffset;
      const z = pz + perpZ * side * sidewalkOffset;

      const angle = Math.atan2(tx * dir, tz * dir);
      const walkSpeed = 1.5 + rng() * 1.5;

      this.npcs.push({
        position: [x, 0.05, z],
        velocity: [0, 0, 0],
        rotation: angle,
        speed: walkSpeed,
        targetSpeed: walkSpeed,
        currentSegment: seg,
        segmentProgress: progress,
        forward,
        sidewalkSide: side,
        stopTimer: rng() < 0.1 ? 2 + rng() * 5 : 0,
        transitionCooldown: rng() * 5,
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
      npc.velocity[1] -= 15 * dt;
      npc.position[0] += npc.velocity[0] * dt;
      npc.position[1] += npc.velocity[1] * dt;
      npc.position[2] += npc.velocity[2] * dt;
      npc.rotation += 8 * dt;
      if (npc.position[1] < 0.05) {
        npc.position[1] = 0.05;
        npc.velocity[1] = Math.abs(npc.velocity[1]) * 0.3;
        npc.velocity[0] *= 0.7;
        npc.velocity[2] *= 0.7;
      }
      if (npc.hitTimer <= 0) {
        npc.velocity = [0, 0, 0];
        npc.speed = 0;
        npc.stopTimer = 3 + Math.random() * 3;
      }
      return;
    }

    if (npc.transitionCooldown > 0) npc.transitionCooldown -= dt;

    // Handle stopping
    if (npc.stopTimer > 0) {
      npc.stopTimer -= dt;
      npc.speed *= 0.85;
      if (npc.speed < 0.05) npc.speed = 0;
      return;
    }

    // Random chance to stop
    if (Math.random() < 0.001) {
      npc.stopTimer = 2 + Math.random() * 6;
      return;
    }

    // Accelerate
    if (npc.speed < npc.targetSpeed) {
      npc.speed = Math.min(npc.targetSpeed, npc.speed + 2 * dt);
    }

    // Advance along segment
    const segLen = getSegmentLength(npc.currentSegment);
    if (segLen > 0) {
      const progressDelta = (npc.speed * dt) / segLen;
      npc.segmentProgress += npc.forward ? progressDelta : -progressDelta;
    }

    // Segment endpoint transition
    if (npc.segmentProgress >= 1 || npc.segmentProgress <= 0) {
      this.handlePedestrianTransition(npc);
    }

    npc.segmentProgress = Math.max(0.001, Math.min(0.999, npc.segmentProgress));

    // Compute position
    const [px, pz] = getPointAlongSegment(npc.currentSegment, npc.segmentProgress);
    const [tx, tz] = getTangentAlongSegment(npc.currentSegment, npc.segmentProgress);

    const perpX = -tz;
    const perpZ = tx;
    const sidewalkOffset = npc.currentSegment.width / 2 + 1.5;
    const targetX = px + perpX * npc.sidewalkSide * sidewalkOffset;
    const targetZ = pz + perpZ * npc.sidewalkSide * sidewalkOffset;

    npc.position[0] += (targetX - npc.position[0]) * Math.min(1, 4 * dt);
    npc.position[2] += (targetZ - npc.position[2]) * Math.min(1, 4 * dt);
    npc.position[1] = 0.05;

    // Smooth rotation
    const dir = npc.forward ? 1 : -1;
    const targetAngle = Math.atan2(tx * dir, tz * dir);
    let angleDiff = targetAngle - npc.rotation;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    npc.rotation += angleDiff * Math.min(1, 6 * dt);
  }

  private handlePedestrianTransition(npc: NPCState): void {
    const atEnd = npc.segmentProgress >= 1;
    const nodeId = atEnd
      ? (npc.forward ? npc.currentSegment.to : npc.currentSegment.from)
      : (npc.forward ? npc.currentSegment.from : npc.currentSegment.to);

    const node = getNodeById(nodeId);
    if (!node) {
      npc.forward = !npc.forward;
      npc.segmentProgress = npc.forward ? 0.01 : 0.99;
      return;
    }

    const connected = getConnectedSegments(nodeId)
      .filter(s => s.id !== npc.currentSegment.id);

    const rng = Math.random();

    // Chance to stop at intersection
    if (rng < 0.2) {
      npc.stopTimer = 2 + Math.random() * 4;
      npc.forward = !npc.forward;
      npc.segmentProgress = npc.forward ? 0.01 : 0.99;
      return;
    }

    // Chance to reverse
    if (rng < 0.3 || connected.length === 0) {
      npc.forward = !npc.forward;
      npc.segmentProgress = npc.forward ? 0.01 : 0.99;
      npc.speed *= 0.5;
      return;
    }

    // Turn onto connected segment
    const nextSeg = connected[Math.floor(Math.random() * connected.length)];
    npc.currentSegment = nextSeg;
    npc.forward = nextSeg.from === nodeId;
    npc.segmentProgress = npc.forward ? 0.01 : 0.99;
    npc.sidewalkSide = Math.random() > 0.5 ? 1 : -1;
    npc.targetSpeed = 1.5 + Math.random() * 1.5;
    npc.speed *= 0.7;
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
