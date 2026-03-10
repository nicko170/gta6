import { Vec3, vec3, mat4, Mat4 } from '../engine/math';
import { PhysicsBody, createBody, updatePhysics } from '../engine/physics';
import { Renderer, Mesh, RenderObject } from '../engine/renderer';
import { Input } from '../engine/input';
import { Vehicle } from '../vehicles/vehicle';
import { createBox, createTaperedBox, createCylinder, createSphere, mergeMeshes } from '../engine/meshgen';
import { getTerrainHeight, isWater, WATER_LEVEL } from '../world/terrain';

export class Player {
  body: PhysicsBody;
  mesh!: Mesh;
  yaw = 0;
  pitch = 0;
  inVehicle: Vehicle | null = null;
  moveSpeed = 8;
  sprintSpeed = 14;

  // Camera
  cameraDistance = 8;
  cameraHeight = 4;
  cameraPitch = 0.3;

  constructor(position: Vec3) {
    this.body = createBody(position, 80, 0.4, 1.8);
    this.body.friction = 0.85;
  }

  createMesh(renderer: Renderer) {
    const skin = [0.82, 0.68, 0.52] as const;
    const shirt = [0.15, 0.25, 0.55] as const;
    const pants = [0.18, 0.18, 0.25] as const;
    const shoes = [0.12, 0.1, 0.08] as const;
    const hair = [0.15, 0.1, 0.06] as const;

    const merged = mergeMeshes(
      // Torso - tapered (wider at shoulders)
      { data: createTaperedBox(0.5, 0.55, 0.55, 0.3, 0.28, ...shirt), offsetY: 0.4 },
      // Hips
      { data: createTaperedBox(0.45, 0.5, 0.3, 0.28, 0.3, ...pants), offsetY: 0.05 },
      // Head
      { data: createSphere(0.18, 6, ...skin), offsetY: 1.08 },
      // Hair
      { data: createTaperedBox(0.34, 0.32, 0.12, 0.34, 0.3, ...hair), offsetY: 1.2 },
      // Neck
      { data: createCylinder(0.08, 0.12, 6, ...skin), offsetY: 0.85 },
      // Left arm (upper)
      { data: createTaperedBox(0.16, 0.14, 0.35, 0.16, 0.14, ...shirt), offsetX: -0.35, offsetY: 0.5 },
      // Left arm (lower / skin)
      { data: createTaperedBox(0.14, 0.12, 0.3, 0.14, 0.12, ...skin), offsetX: -0.35, offsetY: 0.15 },
      // Right arm (upper)
      { data: createTaperedBox(0.16, 0.14, 0.35, 0.16, 0.14, ...shirt), offsetX: 0.35, offsetY: 0.5 },
      // Right arm (lower / skin)
      { data: createTaperedBox(0.14, 0.12, 0.3, 0.14, 0.12, ...skin), offsetX: 0.35, offsetY: 0.15 },
      // Hands
      { data: createSphere(0.06, 4, ...skin), offsetX: -0.35, offsetY: -0.02 },
      { data: createSphere(0.06, 4, ...skin), offsetX: 0.35, offsetY: -0.02 },
      // Left leg (upper)
      { data: createTaperedBox(0.2, 0.18, 0.4, 0.2, 0.18, ...pants), offsetX: -0.14, offsetY: -0.3 },
      // Left leg (lower)
      { data: createTaperedBox(0.18, 0.16, 0.38, 0.18, 0.16, ...pants), offsetX: -0.14, offsetY: -0.7 },
      // Right leg (upper)
      { data: createTaperedBox(0.2, 0.18, 0.4, 0.2, 0.18, ...pants), offsetX: 0.14, offsetY: -0.3 },
      // Right leg (lower)
      { data: createTaperedBox(0.18, 0.16, 0.38, 0.18, 0.16, ...pants), offsetX: 0.14, offsetY: -0.7 },
      // Shoes
      { data: createBox(0.18, 0.08, 0.28, ...shoes), offsetX: -0.14, offsetY: -0.94, offsetZ: 0.04 },
      { data: createBox(0.18, 0.08, 0.28, ...shoes), offsetX: 0.14, offsetY: -0.94, offsetZ: 0.04 },
      // Belt
      { data: createBox(0.52, 0.06, 0.32, 0.2, 0.15, 0.08), offsetY: 0.08 },
      // Collar detail
      { data: createTaperedBox(0.28, 0.3, 0.06, 0.2, 0.22, ...skin), offsetY: 0.72 },
    );
    this.mesh = renderer.createMesh(merged.vertices, merged.indices, 'object');
  }

  update(dt: number, input: Input, getGroundHeight: (x: number, z: number) => number, nearbyVehicles: Vehicle[], checkBuilding?: (x: number, z: number, radius: number) => Vec3 | null) {
    // Camera rotation from mouse
    this.yaw -= input.mouseDX * 0.002;
    this.pitch -= input.mouseDY * 0.002;
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));

    // Vehicle enter/exit
    if (input.wasPressed('KeyF')) {
      if (this.inVehicle) {
        this.exitVehicle();
      } else {
        const nearest = this.findNearestVehicle(nearbyVehicles);
        if (nearest) {
          this.enterVehicle(nearest);
        }
      }
    }

    if (this.inVehicle) {
      this.updateInVehicle(dt, input, getGroundHeight, checkBuilding);
    } else {
      this.updateOnFoot(dt, input, getGroundHeight, checkBuilding);
    }
  }

  private updateOnFoot(dt: number, input: Input, getGroundHeight: (x: number, z: number) => number, checkBuilding?: (x: number, z: number, radius: number) => Vec3 | null) {
    const inWater = isWater(this.body.position[0], this.body.position[2]);
    const baseSpeed = input.isDown('ShiftLeft') ? this.sprintSpeed : this.moveSpeed;
    const speed = inWater ? baseSpeed * 0.45 : baseSpeed;
    const forward: Vec3 = [Math.sin(this.yaw), 0, Math.cos(this.yaw)];
    const right: Vec3 = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];

    let moveX = 0, moveZ = 0;

    if (input.isMobile) {
      // Joystick X = turn camera, Y = move forward/back
      const jx = input.getAxis('moveX');
      const jy = input.getAxis('moveY');
      this.yaw -= jx * 2.5 * dt;
      moveX = forward[0] * jy;
      moveZ = forward[2] * jy;
      const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
      if (len > 1) { moveX /= len; moveZ /= len; }
    } else {
      if (input.isDown('KeyW')) { moveX += forward[0]; moveZ += forward[2]; }
      if (input.isDown('KeyS')) { moveX -= forward[0]; moveZ -= forward[2]; }
      if (input.isDown('KeyA')) { moveX -= right[0]; moveZ -= right[2]; }
      if (input.isDown('KeyD')) { moveX += right[0]; moveZ += right[2]; }
      const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
      if (len > 0) { moveX /= len; moveZ /= len; }
    }

    this.body.velocity[0] = moveX * speed;
    this.body.velocity[2] = moveZ * speed;

    // Jump (not in water)
    if (!inWater && input.wasPressed('Space') && this.body.grounded) {
      this.body.velocity[1] = 8;
      this.body.grounded = false;
    }

    this.body.rotation = this.yaw;
    updatePhysics(this.body, dt, getGroundHeight);

    // Swimming: keep player on water surface
    if (inWater && this.body.position[1] < WATER_LEVEL) {
      this.body.position[1] = WATER_LEVEL;
      this.body.velocity[1] = 0;
      this.body.grounded = true;
    }

    // Building collision
    if (checkBuilding) {
      const push = checkBuilding(this.body.position[0], this.body.position[2], this.body.radius);
      if (push) {
        this.body.position[0] += push[0];
        this.body.position[2] += push[2];
      }
    }
  }

  private updateInVehicle(dt: number, input: Input, getGroundHeight: (x: number, z: number) => number, checkBuilding?: (x: number, z: number, radius: number) => Vec3 | null) {
    if (!this.inVehicle) return;
    this.inVehicle.update(dt, input, getGroundHeight);

    // Vehicle building collision
    if (checkBuilding && !this.inVehicle.config.isAircraft && !this.inVehicle.config.isWatercraft) {
      const push = checkBuilding(this.inVehicle.body.position[0], this.inVehicle.body.position[2], this.inVehicle.body.radius);
      if (push) {
        this.inVehicle.body.position[0] += push[0];
        this.inVehicle.body.position[2] += push[2];
        this.inVehicle.speed *= 0.5; // Lose speed on building hit
      }
    }

    this.body.position = vec3.copy(this.inVehicle.body.position);

    // Camera follows vehicle rotation
    const targetYaw = this.inVehicle.body.rotation;
    const diff = targetYaw - this.yaw;
    const wrapped = Math.atan2(Math.sin(diff), Math.cos(diff));
    const followRate = this.inVehicle.config.isAircraft ? 2 : 3;
    this.yaw += wrapped * followRate * dt;
  }

  private findNearestVehicle(vehicles: Vehicle[]): Vehicle | null {
    let nearest: Vehicle | null = null;
    let nearestDist = 5;

    for (const v of vehicles) {
      if (v.occupied) continue;
      const maxDist = v.config.isWatercraft ? 8 : 5;
      const dist = vec3.distance(this.body.position, v.body.position);
      if (dist < maxDist && dist < nearestDist) {
        nearestDist = dist;
        nearest = v;
      }
    }
    return nearest;
  }

  enterVehicle(vehicle: Vehicle) {
    this.inVehicle = vehicle;
    vehicle.occupied = true;
    if (vehicle.config.isAircraft) {
      this.cameraDistance = 20;
      this.cameraHeight = 8;
    } else if (vehicle.config.isWatercraft) {
      this.cameraDistance = 12;
      this.cameraHeight = 5;
    } else {
      this.cameraDistance = 10;
      this.cameraHeight = 5;
    }
  }

  exitVehicle() {
    if (!this.inVehicle) return;
    this.inVehicle.occupied = false;
    this.inVehicle.speed = 0;
    this.inVehicle.throttle = 0;
    this.inVehicle.flaps = 0;

    if (this.inVehicle.config.isWatercraft) {
      // Find nearest shore position
      const vx = this.inVehicle.body.position[0];
      const vz = this.inVehicle.body.position[2];
      const offsets = [[4,0],[-4,0],[0,4],[0,-4],[6,0],[-6,0],[0,6],[0,-6],[4,4],[-4,-4]];
      let placed = false;
      for (const [dx, dz] of offsets) {
        const tx = vx + dx, tz = vz + dz;
        if (!isWater(tx, tz)) {
          this.body.position = [tx, getTerrainHeight(tx, tz), tz];
          placed = true;
          break;
        }
      }
      if (!placed) {
        this.body.position = [vx, getTerrainHeight(vx, vz) + 1, vz];
      }
    } else {
      const exitOffset: Vec3 = [
        this.inVehicle.body.position[0] + Math.cos(this.inVehicle.body.rotation) * 3,
        this.inVehicle.body.position[1],
        this.inVehicle.body.position[2] - Math.sin(this.inVehicle.body.rotation) * 3,
      ];
      this.body.position = exitOffset;
    }

    this.inVehicle = null;
    this.cameraDistance = 8;
    this.cameraHeight = 4;
  }

  getViewMatrix(): Mat4 {
    const target = vec3.copy(this.body.position);
    target[1] += 1.5; // Head height

    // Camera position behind and above player
    const camDir: Vec3 = [
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    ];

    const cameraPos: Vec3 = [
      target[0] + camDir[0] * this.cameraDistance,
      target[1] + this.cameraHeight + camDir[1] * this.cameraDistance,
      target[2] + camDir[2] * this.cameraDistance,
    ];

    return mat4.lookAt(cameraPos, target, [0, 1, 0]);
  }

  getCameraPosition(): Vec3 {
    const target = vec3.copy(this.body.position);
    target[1] += 1.5;
    const camDir: Vec3 = [
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    ];
    return [
      target[0] + camDir[0] * this.cameraDistance,
      target[1] + this.cameraHeight + camDir[1] * this.cameraDistance,
      target[2] + camDir[2] * this.cameraDistance,
    ];
  }

  getNearestVehiclePrompt(vehicles: Vehicle[], isMobile = false): string | null {
    if (this.inVehicle) return isMobile ? null : 'Press F to exit vehicle';
    const nearest = this.findNearestVehicle(vehicles);
    if (nearest) {
      const typeName = nearest.type.charAt(0).toUpperCase() + nearest.type.slice(1);
      return isMobile ? null : `Press F to enter ${typeName}`;
    }
    return null;
  }

  getRenderObject(): RenderObject | null {
    if (this.inVehicle) return null; // Don't render player when in vehicle
    const t = mat4.translation(this.body.position[0], this.body.position[1] + 0.9, this.body.position[2]);
    const r = mat4.rotationY(this.body.rotation);
    return { mesh: this.mesh, modelMatrix: mat4.multiply(t, r) };
  }
}
