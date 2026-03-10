import { Vec3, vec3 } from './math';

export interface PhysicsBody {
  position: Vec3;
  velocity: Vec3;
  rotation: number; // Y-axis rotation in radians
  angularVelocity: number;
  grounded: boolean;
  mass: number;
  friction: number;
  radius: number; // collision radius
  height: number;
}

export function createBody(pos: Vec3, mass = 1, radius = 1, height = 2): PhysicsBody {
  return {
    position: vec3.copy(pos),
    velocity: [0, 0, 0],
    rotation: 0,
    angularVelocity: 0,
    grounded: false,
    mass,
    friction: 0.95,
    radius,
    height,
  };
}

const GRAVITY = -20;
const GROUND_LEVEL = 0;

export function updatePhysics(body: PhysicsBody, dt: number, getGroundHeight?: (x: number, z: number) => number) {
  // Gravity
  if (!body.grounded) {
    body.velocity[1] += GRAVITY * dt;
  }

  // Update position
  body.position = vec3.add(body.position, vec3.scale(body.velocity, dt));
  body.rotation += body.angularVelocity * dt;

  // Ground collision
  const groundY = getGroundHeight ? getGroundHeight(body.position[0], body.position[2]) : GROUND_LEVEL;
  if (body.position[1] <= groundY) {
    body.position[1] = groundY;
    body.velocity[1] = 0;
    body.grounded = true;

    // Ground friction
    body.velocity[0] *= body.friction;
    body.velocity[2] *= body.friction;
    body.angularVelocity *= body.friction;
  } else {
    body.grounded = false;
  }

  // Clamp to world bounds
  const WORLD_HALF = 900;
  body.position[0] = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, body.position[0]));
  body.position[2] = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, body.position[2]));
}

export function checkCollision(a: PhysicsBody, b: PhysicsBody): boolean {
  const dx = a.position[0] - b.position[0];
  const dz = a.position[2] - b.position[2];
  const dist = Math.sqrt(dx * dx + dz * dz);
  return dist < (a.radius + b.radius);
}

export function resolveCollision(a: PhysicsBody, b: PhysicsBody) {
  const dx = a.position[0] - b.position[0];
  const dz = a.position[2] - b.position[2];
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 0.001) return;

  const overlap = (a.radius + b.radius) - dist;
  if (overlap <= 0) return;

  const nx = dx / dist;
  const nz = dz / dist;

  // Separate
  const totalMass = a.mass + b.mass;
  const aRatio = b.mass / totalMass;
  const bRatio = a.mass / totalMass;
  a.position[0] += nx * overlap * aRatio;
  a.position[2] += nz * overlap * aRatio;
  b.position[0] -= nx * overlap * bRatio;
  b.position[2] -= nz * overlap * bRatio;

  // Impulse
  const dvx = a.velocity[0] - b.velocity[0];
  const dvz = a.velocity[2] - b.velocity[2];
  const dvDotN = dvx * nx + dvz * nz;
  if (dvDotN > 0) return; // moving apart

  const restitution = 0.3;
  const j = -(1 + restitution) * dvDotN / totalMass;

  a.velocity[0] += j * b.mass * nx;
  a.velocity[2] += j * b.mass * nz;
  b.velocity[0] -= j * a.mass * nx;
  b.velocity[2] -= j * a.mass * nz;
}
