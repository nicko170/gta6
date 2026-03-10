import { Vec3, vec3 } from '../engine/math';
import { PhysicsBody, createBody, updatePhysics } from '../engine/physics';
import { Renderer, Mesh, RenderObject } from '../engine/renderer';
import { createBox, createTaperedBox, createCylinder, createCylinderX, createSphere, mergeMeshes } from '../engine/meshgen';
import { mat4 } from '../engine/math';
import { Input } from '../engine/input';

import { WATER_LEVEL, isWater as checkIsWater } from '../world/terrain';

export type VehicleType = 'sedan' | 'sports' | 'truck' | 'plane' | 'boat';

interface VehicleConfig {
  maxSpeed: number;
  acceleration: number;
  braking: number;
  turnSpeed: number;
  bodyW: number;
  bodyH: number;
  bodyL: number;
  color: [number, number, number];
  mass: number;
  isAircraft: boolean;
  isWatercraft: boolean;
}

const CONFIGS: Record<VehicleType, VehicleConfig> = {
  sedan: { maxSpeed: 35, acceleration: 25, braking: 40, turnSpeed: 2.5, bodyW: 2.2, bodyH: 1.4, bodyL: 4.5, color: [0.8, 0.2, 0.2], mass: 1500, isAircraft: false, isWatercraft: false },
  sports: { maxSpeed: 90, acceleration: 65, braking: 70, turnSpeed: 3.0, bodyW: 2.0, bodyH: 1.1, bodyL: 4.2, color: [0.9, 0.6, 0.0], mass: 1200, isAircraft: false, isWatercraft: false },
  truck: { maxSpeed: 25, acceleration: 15, braking: 30, turnSpeed: 1.8, bodyW: 2.8, bodyH: 2.5, bodyL: 6.0, color: [0.3, 0.4, 0.6], mass: 3000, isAircraft: false, isWatercraft: false },
  plane: { maxSpeed: 80, acceleration: 20, braking: 15, turnSpeed: 1.5, bodyW: 2.0, bodyH: 2.5, bodyL: 10.0, color: [0.92, 0.92, 0.96], mass: 5000, isAircraft: true, isWatercraft: false },
  boat: { maxSpeed: 30, acceleration: 18, braking: 25, turnSpeed: 2.0, bodyW: 2.5, bodyH: 1.0, bodyL: 5.0, color: [0.9, 0.9, 0.95], mass: 2000, isAircraft: false, isWatercraft: true },
};

export class Vehicle {
  body: PhysicsBody;
  mesh!: Mesh;
  type: VehicleType;
  config: VehicleConfig;
  speed = 0;
  occupied = false;
  enginePower = 0;
  altitude = 0; // for planes
  pitch = 0;
  roll = 0;
  throttle = 0;
  flaps = 0; // 0-1, increases lift at cost of drag
  stalling = false;

  constructor(type: VehicleType, position: Vec3) {
    this.type = type;
    this.config = CONFIGS[type];
    const radius = this.config.isAircraft ? this.config.bodyW : Math.max(this.config.bodyW, this.config.bodyL) / 2;
    this.body = createBody(position, this.config.mass, radius, this.config.bodyH);
    this.body.friction = 0.92;
  }

  createMesh(renderer: Renderer) {
    const c = this.config;
    const [r, g, b] = c.color;

    if (this.type === 'plane') {
      const merged = mergeMeshes(
        // Fuselage - straight box (no taper = clean rectangular tube)
        { data: createBox(1.4, 1.5, 10, r, g, b) },
        // Nose - sphere for smooth rounded front
        { data: createSphere(0.72, 8, r, g, b), offsetZ: 5.2 },
        // Tail taper - stacked boxes getting smaller (tapers along Z)
        { data: createBox(1.3, 1.4, 1.5, r*0.97, g*0.97, b*0.97), offsetZ: -5.7 },
        { data: createBox(1.0, 1.1, 1.5, r*0.95, g*0.95, b*0.95), offsetZ: -7.0 },
        { data: createBox(0.5, 0.6, 1.5, r*0.93, g*0.93, b*0.93), offsetZ: -8.2 },
        // Main wings - flat slab (taper in Y barely visible at 0.15m thick)
        { data: createTaperedBox(16, 14, 0.15, 2.8, 1.0, r*0.97, g*0.97, b*0.97), offsetY: -0.1, offsetZ: -0.5 },
        // Winglets
        { data: createBox(0.1, 0.5, 0.3, r*0.9, g*0.9, b*0.9), offsetX: -7.8, offsetY: 0.2, offsetZ: -0.7 },
        { data: createBox(0.1, 0.5, 0.3, r*0.9, g*0.9, b*0.9), offsetX: 7.8, offsetY: 0.2, offsetZ: -0.7 },
        // Vertical stabilizer (taper in Y is correct here - tall thin fin)
        { data: createTaperedBox(0.1, 0.06, 2.2, 2.0, 0.8, r*0.95, g*0.95, b*0.95), offsetY: 1.85, offsetZ: -6.5 },
        // Horizontal stabilizers (thin, taper barely visible)
        { data: createTaperedBox(5.0, 3.5, 0.08, 1.4, 0.6, r*0.95, g*0.95, b*0.95), offsetY: 0.3, offsetZ: -7.2 },
        // Cockpit glass - subtle dome
        { data: createTaperedBox(1.0, 0.7, 0.45, 2.2, 1.2, 0.3, 0.5, 0.75), offsetY: 0.82, offsetZ: 2.0 },
        // Engine nacelles (under wings) - lighter color boxes
        { data: createBox(0.65, 0.65, 2.0, 0.72, 0.72, 0.75), offsetX: -3.8, offsetY: -0.6, offsetZ: 0.2 },
        { data: createBox(0.65, 0.65, 2.0, 0.72, 0.72, 0.75), offsetX: 3.8, offsetY: -0.6, offsetZ: 0.2 },
        // Engine intake rings
        { data: createBox(0.7, 0.7, 0.1, 0.58, 0.58, 0.6), offsetX: -3.8, offsetY: -0.6, offsetZ: 1.25 },
        { data: createBox(0.7, 0.7, 0.1, 0.58, 0.58, 0.6), offsetX: 3.8, offsetY: -0.6, offsetZ: 1.25 },
        // Front landing gear
        { data: createBox(0.06, 0.5, 0.06, 0.45, 0.45, 0.47), offsetY: -1.0, offsetZ: 3.5 },
        { data: createCylinderX(0.18, 0.1, 6, 0.2, 0.2, 0.22), offsetY: -1.25, offsetZ: 3.5 },
        // Rear landing gear
        { data: createBox(0.06, 0.5, 0.06, 0.45, 0.45, 0.47), offsetX: -1.0, offsetY: -1.0, offsetZ: -1.0 },
        { data: createBox(0.06, 0.5, 0.06, 0.45, 0.45, 0.47), offsetX: 1.0, offsetY: -1.0, offsetZ: -1.0 },
        { data: createCylinderX(0.22, 0.12, 6, 0.2, 0.2, 0.22), offsetX: -1.0, offsetY: -1.25, offsetZ: -1.0 },
        { data: createCylinderX(0.22, 0.12, 6, 0.2, 0.2, 0.22), offsetX: 1.0, offsetY: -1.25, offsetZ: -1.0 },
      );
      this.mesh = renderer.createMesh(merged.vertices, merged.indices, 'object');
    } else if (this.type === 'sports') {
      // Low-slung sports car
      const merged = mergeMeshes(
        // Lower body - wide and low
        { data: createTaperedBox(c.bodyW, c.bodyW*0.95, c.bodyH*0.35, c.bodyL, c.bodyL*0.92, r, g, b) },
        // Upper body / cabin - sleek taper
        { data: createTaperedBox(c.bodyW*0.88, c.bodyW*0.75, c.bodyH*0.3, c.bodyL*0.5, c.bodyL*0.35, r*0.9, g*0.9, b*0.9), offsetY: c.bodyH*0.32, offsetZ: -c.bodyL*0.05 },
        // Nose slope
        { data: createTaperedBox(c.bodyW*0.9, c.bodyW*0.7, c.bodyH*0.15, c.bodyL*0.2, c.bodyL*0.05, r, g, b), offsetY: c.bodyH*0.1, offsetZ: c.bodyL*0.45 },
        // Rear spoiler
        { data: createBox(c.bodyW*0.85, 0.05, 0.3, r*0.3, g*0.3, b*0.3), offsetY: c.bodyH*0.42, offsetZ: -c.bodyL*0.42 },
        { data: createBox(0.08, 0.2, 0.08, r*0.3, g*0.3, b*0.3), offsetX: -c.bodyW*0.35, offsetY: c.bodyH*0.32, offsetZ: -c.bodyL*0.42 },
        { data: createBox(0.08, 0.2, 0.08, r*0.3, g*0.3, b*0.3), offsetX: c.bodyW*0.35, offsetY: c.bodyH*0.32, offsetZ: -c.bodyL*0.42 },
        // Windshield
        { data: createTaperedBox(c.bodyW*0.82, c.bodyW*0.72, c.bodyH*0.25, 0.06, 0.06, 0.2, 0.4, 0.65), offsetY: c.bodyH*0.35, offsetZ: c.bodyL*0.2 },
        // Rear window
        { data: createTaperedBox(c.bodyW*0.72, c.bodyW*0.6, c.bodyH*0.18, 0.05, 0.05, 0.2, 0.4, 0.65), offsetY: c.bodyH*0.35, offsetZ: -c.bodyL*0.2 },
        // Headlights
        { data: createBox(0.25, 0.1, 0.08, 1.0, 1.0, 0.9), offsetX: -c.bodyW*0.35, offsetY: c.bodyH*0.05, offsetZ: c.bodyL*0.5 },
        { data: createBox(0.25, 0.1, 0.08, 1.0, 1.0, 0.9), offsetX: c.bodyW*0.35, offsetY: c.bodyH*0.05, offsetZ: c.bodyL*0.5 },
        // Taillights
        { data: createBox(0.3, 0.08, 0.06, 0.9, 0.1, 0.1), offsetX: -c.bodyW*0.32, offsetY: c.bodyH*0.1, offsetZ: -c.bodyL*0.49 },
        { data: createBox(0.3, 0.08, 0.06, 0.9, 0.1, 0.1), offsetX: c.bodyW*0.32, offsetY: c.bodyH*0.1, offsetZ: -c.bodyL*0.49 },
        // Wheels - cylindrical
        ...this.makeWheels(c, 0.28, 0.42),
        // Side skirts
        { data: createBox(0.06, c.bodyH*0.12, c.bodyL*0.6, r*0.3, g*0.3, b*0.3), offsetX: -c.bodyW*0.5, offsetY: -c.bodyH*0.12 },
        { data: createBox(0.06, c.bodyH*0.12, c.bodyL*0.6, r*0.3, g*0.3, b*0.3), offsetX: c.bodyW*0.5, offsetY: -c.bodyH*0.12 },
      );
      this.mesh = renderer.createMesh(merged.vertices, merged.indices, 'object');
    } else if (this.type === 'truck') {
      // Big truck / pickup
      const merged = mergeMeshes(
        // Chassis - thick
        { data: createBox(c.bodyW, c.bodyH*0.3, c.bodyL, r*0.85, g*0.85, b*0.85) },
        // Hood
        { data: createTaperedBox(c.bodyW*0.95, c.bodyW*0.9, c.bodyH*0.25, c.bodyL*0.35, c.bodyL*0.3, r, g, b), offsetY: c.bodyH*0.28, offsetZ: c.bodyL*0.3 },
        // Cabin
        { data: createBox(c.bodyW*0.92, c.bodyH*0.45, c.bodyL*0.3, r, g, b), offsetY: c.bodyH*0.52, offsetZ: c.bodyL*0.1 },
        // Bed
        { data: createBox(c.bodyW*0.95, c.bodyH*0.25, c.bodyL*0.4, r*0.7, g*0.7, b*0.7), offsetY: c.bodyH*0.27, offsetZ: -c.bodyL*0.28 },
        // Bed walls
        { data: createBox(c.bodyW*0.95, c.bodyH*0.15, 0.08, r*0.75, g*0.75, b*0.75), offsetY: c.bodyH*0.47, offsetZ: -c.bodyL*0.48 },
        { data: createBox(0.08, c.bodyH*0.15, c.bodyL*0.4, r*0.75, g*0.75, b*0.75), offsetX: -c.bodyW*0.47, offsetY: c.bodyH*0.47, offsetZ: -c.bodyL*0.28 },
        { data: createBox(0.08, c.bodyH*0.15, c.bodyL*0.4, r*0.75, g*0.75, b*0.75), offsetX: c.bodyW*0.47, offsetY: c.bodyH*0.47, offsetZ: -c.bodyL*0.28 },
        // Windshield
        { data: createTaperedBox(c.bodyW*0.85, c.bodyW*0.82, c.bodyH*0.32, 0.06, 0.06, 0.25, 0.45, 0.7), offsetY: c.bodyH*0.55, offsetZ: c.bodyL*0.25 },
        // Bumpers
        { data: createBox(c.bodyW*1.02, c.bodyH*0.12, 0.2, 0.35, 0.35, 0.38), offsetY: -c.bodyH*0.1, offsetZ: c.bodyL*0.52 },
        { data: createBox(c.bodyW*1.02, c.bodyH*0.12, 0.2, 0.35, 0.35, 0.38), offsetY: -c.bodyH*0.1, offsetZ: -c.bodyL*0.52 },
        // Headlights
        { data: createBox(0.3, 0.18, 0.08, 1.0, 1.0, 0.85), offsetX: -c.bodyW*0.35, offsetY: c.bodyH*0.15, offsetZ: c.bodyL*0.5 },
        { data: createBox(0.3, 0.18, 0.08, 1.0, 1.0, 0.85), offsetX: c.bodyW*0.35, offsetY: c.bodyH*0.15, offsetZ: c.bodyL*0.5 },
        // Taillights
        { data: createBox(0.25, 0.15, 0.06, 0.9, 0.15, 0.1), offsetX: -c.bodyW*0.38, offsetY: c.bodyH*0.15, offsetZ: -c.bodyL*0.5 },
        { data: createBox(0.25, 0.15, 0.06, 0.9, 0.15, 0.1), offsetX: c.bodyW*0.38, offsetY: c.bodyH*0.15, offsetZ: -c.bodyL*0.5 },
        // Wheels - bigger for truck
        ...this.makeWheels(c, 0.35, 0.55),
        // Roof rack
        { data: createBox(c.bodyW*0.7, 0.04, c.bodyL*0.22, 0.3, 0.3, 0.32), offsetY: c.bodyH*0.76 , offsetZ: c.bodyL*0.1 },
      );
      this.mesh = renderer.createMesh(merged.vertices, merged.indices, 'object');
    } else if (this.type === 'boat') {
      const merged = mergeMeshes(
        // Hull - tapered V-shape bottom
        { data: createTaperedBox(c.bodyW, c.bodyW * 0.5, c.bodyH * 0.5, c.bodyL, c.bodyL * 0.6, r, g, b) },
        // Deck
        { data: createBox(c.bodyW * 0.9, 0.08, c.bodyL * 0.8, r * 0.95, g * 0.95, b * 0.92), offsetY: c.bodyH * 0.25 },
        // Bow taper
        { data: createTaperedBox(c.bodyW * 0.5, 0.1, c.bodyH * 0.35, c.bodyL * 0.2, 0.05, r, g, b), offsetZ: c.bodyL * 0.52, offsetY: -c.bodyH * 0.05 },
        // Windshield
        { data: createTaperedBox(c.bodyW * 0.65, c.bodyW * 0.5, c.bodyH * 0.4, 0.06, 0.06, 0.2, 0.4, 0.7), offsetY: c.bodyH * 0.5, offsetZ: c.bodyL * 0.15 },
        // Console
        { data: createBox(c.bodyW * 0.35, c.bodyH * 0.3, 0.4, 0.3, 0.3, 0.35), offsetY: c.bodyH * 0.4, offsetZ: c.bodyL * 0.1 },
        // Outboard motor
        { data: createBox(0.4, 0.6, 0.5, 0.25, 0.25, 0.28), offsetZ: -c.bodyL * 0.48, offsetY: -c.bodyH * 0.05 },
        // Motor leg
        { data: createBox(0.12, 0.4, 0.12, 0.2, 0.2, 0.22), offsetZ: -c.bodyL * 0.48, offsetY: -c.bodyH * 0.45 },
        // Left railing
        { data: createBox(0.05, 0.25, c.bodyL * 0.5, 0.5, 0.5, 0.52), offsetX: -c.bodyW * 0.44, offsetY: c.bodyH * 0.4 },
        // Right railing
        { data: createBox(0.05, 0.25, c.bodyL * 0.5, 0.5, 0.5, 0.52), offsetX: c.bodyW * 0.44, offsetY: c.bodyH * 0.4 },
        // Seats
        { data: createBox(c.bodyW * 0.35, 0.25, 0.3, 0.7, 0.7, 0.72), offsetY: c.bodyH * 0.35, offsetZ: -c.bodyL * 0.05 },
        { data: createBox(c.bodyW * 0.35, 0.25, 0.3, 0.7, 0.7, 0.72), offsetY: c.bodyH * 0.35, offsetZ: -c.bodyL * 0.2 },
        // Stern transom
        { data: createBox(c.bodyW * 0.9, c.bodyH * 0.35, 0.08, r * 0.9, g * 0.9, b * 0.88), offsetZ: -c.bodyL * 0.42, offsetY: c.bodyH * 0.15 },
      );
      this.mesh = renderer.createMesh(merged.vertices, merged.indices, 'object');
    } else {
      // Sedan - default
      const merged = mergeMeshes(
        // Lower body
        { data: createTaperedBox(c.bodyW, c.bodyW*0.95, c.bodyH*0.4, c.bodyL, c.bodyL*0.95, r, g, b) },
        // Cabin - tapered greenhouse
        { data: createTaperedBox(c.bodyW*0.9, c.bodyW*0.78, c.bodyH*0.32, c.bodyL*0.52, c.bodyL*0.4, r*0.88, g*0.88, b*0.88), offsetY: c.bodyH*0.36, offsetZ: -c.bodyL*0.02 },
        // Hood
        { data: createTaperedBox(c.bodyW*0.95, c.bodyW*0.88, c.bodyH*0.08, c.bodyL*0.28, c.bodyL*0.22, r*1.02, g*1.02, b*1.02), offsetY: c.bodyH*0.22, offsetZ: c.bodyL*0.32 },
        // Trunk
        { data: createTaperedBox(c.bodyW*0.95, c.bodyW*0.88, c.bodyH*0.08, c.bodyL*0.22, c.bodyL*0.18, r*0.98, g*0.98, b*0.98), offsetY: c.bodyH*0.22, offsetZ: -c.bodyL*0.35 },
        // Windshield
        { data: createTaperedBox(c.bodyW*0.84, c.bodyW*0.76, c.bodyH*0.27, 0.06, 0.06, 0.22, 0.42, 0.68), offsetY: c.bodyH*0.38, offsetZ: c.bodyL*0.2 },
        // Rear window
        { data: createTaperedBox(c.bodyW*0.78, c.bodyW*0.72, c.bodyH*0.22, 0.05, 0.05, 0.22, 0.42, 0.68), offsetY: c.bodyH*0.38, offsetZ: -c.bodyL*0.2 },
        // Side windows
        { data: createBox(0.04, c.bodyH*0.2, c.bodyL*0.2, 0.22, 0.42, 0.68), offsetX: -c.bodyW*0.45, offsetY: c.bodyH*0.38 },
        { data: createBox(0.04, c.bodyH*0.2, c.bodyL*0.2, 0.22, 0.42, 0.68), offsetX: c.bodyW*0.45, offsetY: c.bodyH*0.38 },
        // Front bumper
        { data: createBox(c.bodyW*1.0, c.bodyH*0.1, 0.18, r*0.5, g*0.5, b*0.5), offsetY: -c.bodyH*0.12, offsetZ: c.bodyL*0.5 },
        // Rear bumper
        { data: createBox(c.bodyW*1.0, c.bodyH*0.1, 0.18, r*0.5, g*0.5, b*0.5), offsetY: -c.bodyH*0.12, offsetZ: -c.bodyL*0.5 },
        // Headlights
        { data: createBox(0.28, 0.12, 0.06, 1.0, 1.0, 0.88), offsetX: -c.bodyW*0.34, offsetY: c.bodyH*0.08, offsetZ: c.bodyL*0.5 },
        { data: createBox(0.28, 0.12, 0.06, 1.0, 1.0, 0.88), offsetX: c.bodyW*0.34, offsetY: c.bodyH*0.08, offsetZ: c.bodyL*0.5 },
        // Taillights
        { data: createBox(0.22, 0.1, 0.06, 0.9, 0.1, 0.08), offsetX: -c.bodyW*0.36, offsetY: c.bodyH*0.1, offsetZ: -c.bodyL*0.5 },
        { data: createBox(0.22, 0.1, 0.06, 0.9, 0.1, 0.08), offsetX: c.bodyW*0.36, offsetY: c.bodyH*0.1, offsetZ: -c.bodyL*0.5 },
        // Grill
        { data: createBox(c.bodyW*0.5, c.bodyH*0.12, 0.04, 0.15, 0.15, 0.18), offsetY: c.bodyH*0.02, offsetZ: c.bodyL*0.51 },
        // Wheels
        ...this.makeWheels(c, 0.28, 0.45),
        // Door handles
        { data: createBox(0.18, 0.04, 0.04, 0.7, 0.7, 0.72), offsetX: -c.bodyW*0.46, offsetY: c.bodyH*0.22, offsetZ: c.bodyL*0.05 },
        { data: createBox(0.18, 0.04, 0.04, 0.7, 0.7, 0.72), offsetX: c.bodyW*0.46, offsetY: c.bodyH*0.22, offsetZ: c.bodyL*0.05 },
        // Side mirrors
        { data: createBox(0.15, 0.1, 0.08, r*0.9, g*0.9, b*0.9), offsetX: -c.bodyW*0.52, offsetY: c.bodyH*0.38, offsetZ: c.bodyL*0.18 },
        { data: createBox(0.15, 0.1, 0.08, r*0.9, g*0.9, b*0.9), offsetX: c.bodyW*0.52, offsetY: c.bodyH*0.38, offsetZ: c.bodyL*0.18 },
      );
      this.mesh = renderer.createMesh(merged.vertices, merged.indices, 'object');
    }
  }

  private makeWheels(c: VehicleConfig, wheelWidth: number, wheelRadius: number): { data: import('../engine/meshgen').MeshData; offsetX: number; offsetY: number; offsetZ: number }[] {
    const wheelOffset = c.bodyW / 2 + wheelWidth / 2 - 0.05;
    const wheelZ = c.bodyL * 0.32;
    const wheelY = -c.bodyH * 0.2;
    const tire = () => createCylinderX(wheelRadius, wheelWidth, 10, 0.12, 0.12, 0.14);
    const hubcap = () => createCylinderX(wheelRadius * 0.55, wheelWidth + 0.02, 6, 0.55, 0.55, 0.6);
    return [
      { data: tire(), offsetX: -wheelOffset, offsetY: wheelY, offsetZ: wheelZ },
      { data: hubcap(), offsetX: -wheelOffset, offsetY: wheelY, offsetZ: wheelZ },
      { data: tire(), offsetX: wheelOffset, offsetY: wheelY, offsetZ: wheelZ },
      { data: hubcap(), offsetX: wheelOffset, offsetY: wheelY, offsetZ: wheelZ },
      { data: tire(), offsetX: -wheelOffset, offsetY: wheelY, offsetZ: -wheelZ },
      { data: hubcap(), offsetX: -wheelOffset, offsetY: wheelY, offsetZ: -wheelZ },
      { data: tire(), offsetX: wheelOffset, offsetY: wheelY, offsetZ: -wheelZ },
      { data: hubcap(), offsetX: wheelOffset, offsetY: wheelY, offsetZ: -wheelZ },
    ];
  }

  update(dt: number, input: Input | null, getGroundHeight: (x: number, z: number) => number) {
    if (this.occupied && input) {
      if (this.config.isAircraft) {
        this.updateAircraft(dt, input, getGroundHeight);
      } else if (this.config.isWatercraft) {
        this.updateBoat(dt, input);
      } else {
        this.updateCar(dt, input, getGroundHeight);
      }
    } else {
      if (this.config.isWatercraft) {
        // Boats just bob on water
        const bob = Math.sin(performance.now() * 0.0015 + this.body.position[0]) * 0.1;
        this.body.position[1] = WATER_LEVEL + bob;
      } else {
        updatePhysics(this.body, dt, getGroundHeight);
      }
      this.speed *= 0.98;
    }
  }

  private updateCar(dt: number, input: Input, getGroundHeight: (x: number, z: number) => number) {
    let accel = 0;
    if (input.isDown('KeyW')) accel = this.config.acceleration;
    if (input.isDown('KeyS')) accel = -this.config.braking;
    if (input.isDown('ShiftLeft')) accel *= 1.5; // Boost

    // Analog throttle on mobile
    if (input.isMobile) {
      const ay = input.getAxis('moveY');
      if (ay > 0.1) accel = this.config.acceleration * ay;
      else if (ay < -0.1) accel = this.config.braking * ay;
      if (input.touchSprint) accel *= 1.5;
    }

    this.speed += accel * dt;
    this.speed *= 0.98; // drag

    // Clamp speed
    const maxSpd = input.isDown('ShiftLeft') ? this.config.maxSpeed * 1.3 : this.config.maxSpeed;
    this.speed = Math.max(-maxSpd * 0.3, Math.min(maxSpd, this.speed));

    // Steering
    if (Math.abs(this.speed) > 0.5) {
      const turnFactor = Math.min(1, Math.abs(this.speed) / 10);
      // Analog steering on mobile
      if (input.isMobile) {
        const steer = -input.getAxis('steerX');
        this.body.rotation += steer * this.config.turnSpeed * turnFactor * dt * Math.sign(this.speed);
      } else {
        if (input.isDown('KeyA')) this.body.rotation += this.config.turnSpeed * turnFactor * dt * Math.sign(this.speed);
        if (input.isDown('KeyD')) this.body.rotation -= this.config.turnSpeed * turnFactor * dt * Math.sign(this.speed);
      }
    }

    // Handbrake
    if (input.isDown('Space') || input.touchBrake) {
      this.speed *= 0.95;
      // Drift effect
      if (Math.abs(this.speed) > 5) {
        if (input.isMobile) {
          const steer = -input.getAxis('steerX');
          this.body.rotation += steer * this.config.turnSpeed * 1.5 * dt;
        } else {
          if (input.isDown('KeyA')) this.body.rotation += this.config.turnSpeed * 1.5 * dt;
          if (input.isDown('KeyD')) this.body.rotation -= this.config.turnSpeed * 1.5 * dt;
        }
      }
    }

    // Apply velocity in facing direction
    const forward: Vec3 = [Math.sin(this.body.rotation), 0, Math.cos(this.body.rotation)];
    this.body.velocity[0] = forward[0] * this.speed;
    this.body.velocity[2] = forward[2] * this.speed;

    updatePhysics(this.body, dt, getGroundHeight);
  }

  private updateAircraft(dt: number, input: Input, getGroundHeight: (x: number, z: number) => number) {
    // === CONTROLS ===
    // Throttle: W/S on keyboard, buttons on mobile (joystick Y is pitch on mobile)
    if (input.isMobile) {
      if (input.touchThrottleUp) this.throttle = Math.min(1, this.throttle + dt * 0.5);
      if (input.touchThrottleDown) this.throttle = Math.max(0, this.throttle - dt * 0.5);
    } else {
      if (input.isDown('KeyW')) this.throttle = Math.min(1, this.throttle + dt * 0.5);
      if (input.isDown('KeyS')) this.throttle = Math.max(0, this.throttle - dt * 0.5);
    }

    // A/D: Ailerons (roll) - also pitches nose via bank
    const rollRate = 2.0;
    if (input.isMobile) {
      const steer = input.getAxis('steerX');
      if (Math.abs(steer) > 0.15) this.roll += steer * rollRate * dt;
      else this.roll *= (1 - 1.0 * dt);
    } else {
      if (input.isDown('KeyA')) this.roll -= rollRate * dt;
      else if (input.isDown('KeyD')) this.roll += rollRate * dt;
      else this.roll *= (1 - 1.0 * dt); // slow auto-level
    }
    this.roll = Math.max(-1.2, Math.min(1.2, this.roll));

    // ArrowUp/ArrowDown: Flaps (0 to 1)
    if (input.isDown('ArrowUp')) this.flaps = Math.min(1, this.flaps + dt * 1.5);
    if (input.isDown('ArrowDown')) this.flaps = Math.max(0, this.flaps - dt * 1.5);

    // === PHYSICS STATE ===
    const groundY = getGroundHeight(this.body.position[0], this.body.position[2]);
    const isOnGround = this.body.position[1] <= groundY + 0.5;

    // Aerodynamic constants
    const maxThrust = 40;
    const baseDragCoeff = 0.005;
    const baseLiftCoeff = 0.012;
    const stallSpeed = 18;
    const gravity = 12;

    // Flaps increase both lift and drag
    const flapLiftBonus = this.flaps * 0.008; // significant extra lift
    const flapDragPenalty = this.flaps * 0.003; // drag penalty
    const liftCoeff = baseLiftCoeff + flapLiftBonus;
    const dragCoeff = baseDragCoeff + flapDragPenalty;

    // Flaps lower stall speed (easier takeoff/landing)
    const effectiveStallSpeed = stallSpeed * (1 - this.flaps * 0.35);

    // === THRUST & DRAG ===
    const thrust = this.throttle * maxThrust;
    const drag = dragCoeff * this.speed * this.speed;
    this.speed += (thrust - drag) * dt;
    if (isOnGround && this.throttle < 0.1) this.speed -= 3 * dt;
    this.speed = Math.max(0, Math.min(this.config.maxSpeed, this.speed));

    // === RUDDER (ArrowLeft/ArrowRight) ===
    // On ground: nosewheel steering (works at any speed)
    // In air: yaw control
    const rudderInput = (input.isDown('ArrowLeft') ? 1 : 0) - (input.isDown('ArrowRight') ? 1 : 0);
    if (isOnGround) {
      // Nosewheel steering - effective even at low taxi speeds
      const steerRate = this.speed > 15 ? 0.8 : 1.5; // tighter turns at low speed
      this.body.rotation += rudderInput * steerRate * dt;
    } else {
      // Air rudder - yaw
      this.body.rotation += rudderInput * 1.0 * dt;
    }

    // === BANKING TURNS (from roll/ailerons) ===
    if (!isOnGround) {
      // Roll causes yaw (coordinated turn)
      this.body.rotation -= Math.sin(this.roll) * 1.5 * dt;
      // Roll also induces pitch-down (need to pull up in turns)
      this.pitch -= Math.abs(this.roll) * 0.15 * dt;
    }

    // === PITCH ===
    // In air: pitch from roll-induced nose drop + gravity balance
    // Pitch slowly returns toward 0 (trim) when not stalling
    if (!isOnGround && !this.stalling) {
      this.pitch *= (1 - 0.2 * dt);
    }
    // Pitch: joystick Y on mobile, Space/Ctrl on keyboard
    if (input.isMobile) {
      const pitchInput = -input.getAxis('moveY');
      if (Math.abs(pitchInput) > 0.15) this.pitch += pitchInput * 1.2 * dt;
    } else {
      if (input.isDown('Space')) this.pitch += 1.2 * dt;
      if (input.isDown('ControlLeft') || input.isDown('ControlRight')) this.pitch -= 1.2 * dt;
    }
    this.pitch = Math.max(-0.7, Math.min(0.7, this.pitch));

    // === FORWARD DIRECTION ===
    const forward: Vec3 = [
      Math.sin(this.body.rotation) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.body.rotation) * Math.cos(this.pitch)
    ];

    // === VELOCITY ===
    this.body.velocity[0] = forward[0] * this.speed;
    this.body.velocity[1] = forward[1] * this.speed;
    this.body.velocity[2] = forward[2] * this.speed;

    // === LIFT ===
    if (!isOnGround) {
      let lift = 0;
      if (this.speed > effectiveStallSpeed * 0.5) {
        const speedFactor = Math.min(1, (this.speed - effectiveStallSpeed * 0.5) / (effectiveStallSpeed * 0.5));
        lift = Math.min(gravity * 1.5, liftCoeff * this.speed * this.speed) * speedFactor;
      }
      this.body.velocity[1] += (lift - gravity) * dt;
    }

    // === STALL ===
    this.stalling = !isOnGround && this.speed < effectiveStallSpeed;
    if (this.stalling) {
      this.pitch = Math.max(-0.7, this.pitch - 0.5 * dt); // nose drops hard
      this.roll += (Math.random() - 0.5) * 0.8 * dt; // buffeting
    }

    // === GROUND CONSTRAINTS ===
    if (isOnGround) {
      this.pitch = Math.max(0, this.pitch);
      this.roll *= 0.9;
      this.body.velocity[1] = Math.max(0, this.body.velocity[1]);
    }

    // === UPDATE POSITION ===
    this.body.position = vec3.add(this.body.position, vec3.scale(this.body.velocity, dt));

    // === GROUND COLLISION ===
    if (this.body.position[1] < groundY) {
      this.body.position[1] = groundY;
      const impactSpeed = Math.abs(this.body.velocity[1]);
      if (impactSpeed > 10) {
        this.speed *= 0.15;
        this.throttle = 0;
        this.pitch = 0;
        this.roll = 0;
      } else if (impactSpeed > 4) {
        this.speed *= 0.6;
      }
      this.body.velocity[1] = 0;
    }

    // === WORLD BOUNDS ===
    const WORLD_HALF = 900;
    this.body.position[0] = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, this.body.position[0]));
    this.body.position[2] = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, this.body.position[2]));
    this.body.position[1] = Math.max(groundY, Math.min(500, this.body.position[1]));
  }

  private updateBoat(dt: number, input: Input) {
    let accel = 0;
    if (input.isDown('KeyW')) accel = this.config.acceleration;
    if (input.isDown('KeyS')) accel = -this.config.braking * 0.5;

    if (input.isMobile) {
      const ay = input.getAxis('moveY');
      if (ay > 0.1) accel = this.config.acceleration * ay;
      else if (ay < -0.1) accel = this.config.braking * 0.5 * ay;
    }

    this.speed += accel * dt;
    this.speed *= 0.97; // Water drag
    this.speed = Math.max(-this.config.maxSpeed * 0.2, Math.min(this.config.maxSpeed, this.speed));

    // Steering
    if (Math.abs(this.speed) > 0.5) {
      const turnFactor = Math.min(1, Math.abs(this.speed) / 8);
      if (input.isMobile) {
        const steer = -input.getAxis('steerX');
        this.body.rotation += steer * this.config.turnSpeed * turnFactor * dt * Math.sign(this.speed);
      } else {
        if (input.isDown('KeyA')) this.body.rotation += this.config.turnSpeed * turnFactor * dt * Math.sign(this.speed);
        if (input.isDown('KeyD')) this.body.rotation -= this.config.turnSpeed * turnFactor * dt * Math.sign(this.speed);
      }
    }

    // Movement
    const forward: Vec3 = [Math.sin(this.body.rotation), 0, Math.cos(this.body.rotation)];
    const newX = this.body.position[0] + forward[0] * this.speed * dt;
    const newZ = this.body.position[2] + forward[2] * this.speed * dt;

    // Prevent going on land
    if (checkIsWater(newX, newZ)) {
      this.body.position[0] = newX;
      this.body.position[2] = newZ;
      this.body.velocity[0] = forward[0] * this.speed;
      this.body.velocity[2] = forward[2] * this.speed;
    } else {
      this.speed *= 0.3;
      this.body.velocity[0] = 0;
      this.body.velocity[2] = 0;
    }

    // Bobbing on water
    const bob = Math.sin(performance.now() * 0.002 + this.body.position[0] * 0.1) * 0.15;
    this.body.position[1] = WATER_LEVEL + bob;

    // World bounds
    const WORLD_HALF = 900;
    this.body.position[0] = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, this.body.position[0]));
    this.body.position[2] = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, this.body.position[2]));
  }

  getRenderObject(): RenderObject {
    let model: Float32Array;

    if (this.config.isAircraft) {
      const t = mat4.translation(this.body.position[0], this.body.position[1] + this.config.bodyH / 2, this.body.position[2]);
      const ry = mat4.rotationY(this.body.rotation);
      const rx = mat4.rotationX(-this.pitch);
      const rz = mat4.rotationZ(this.roll);
      model = mat4.multiply(t, mat4.multiply(ry, mat4.multiply(rx, rz)));
    } else if (this.config.isWatercraft) {
      const t = mat4.translation(this.body.position[0], this.body.position[1] + this.config.bodyH / 2, this.body.position[2]);
      const ry = mat4.rotationY(this.body.rotation);
      const now = performance.now();
      const rollAngle = Math.sin(now * 0.0015 + this.body.position[2] * 0.1) * 0.06;
      const pitchAngle = Math.sin(now * 0.001 + this.body.position[0] * 0.1) * 0.04;
      const rx = mat4.rotationX(pitchAngle);
      const rz = mat4.rotationZ(rollAngle);
      model = mat4.multiply(t, mat4.multiply(ry, mat4.multiply(rx, rz)));
    } else {
      const t = mat4.translation(this.body.position[0], this.body.position[1] + this.config.bodyH / 2, this.body.position[2]);
      const r = mat4.rotationY(this.body.rotation);
      model = mat4.multiply(t, r);
    }

    return { mesh: this.mesh, modelMatrix: model };
  }
}
