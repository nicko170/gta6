import { Player } from '../player/player';
import { City } from './city';

export class Minimap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  size = 200;
  scale = 0.2;

  constructor() {
    this.canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
  }

  render(player: Player, city: City) {
    const ctx = this.ctx;
    const cx = this.size / 2;
    const cy = this.size / 2;
    const px = player.body.position[0];
    const pz = player.body.position[2];

    ctx.clearRect(0, 0, this.size, this.size);

    // Clip to circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, cx, 0, Math.PI * 2);
    ctx.clip();

    // Background - dark green ground
    ctx.fillStyle = '#1e3d1e';
    ctx.fillRect(0, 0, this.size, this.size);

    // Transform: center on player, rotate so player's forward is UP
    ctx.save();
    ctx.translate(cx, cy);
    // In our world: yaw=0 means facing +Z. On canvas, +Y is down.
    // We want forward (+Z relative to player) to point UP (-Y on canvas).
    // So rotate by -yaw + PI to flip Z to -Y
    ctx.rotate(player.yaw - Math.PI);

    const s = this.scale;
    const startGrid = -(city.GRID_SIZE * city.BLOCK_SIZE) / 2;
    const gridSpan = city.GRID_SIZE * city.BLOCK_SIZE;

    // Draw road fills (wider, filled rectangles)
    ctx.fillStyle = '#484848';
    const roadHalf = city.ROAD_WIDTH / 2 * s;
    for (let i = 0; i <= city.GRID_SIZE; i++) {
      // Horizontal roads
      const rz = (startGrid + i * city.BLOCK_SIZE - pz) * s;
      ctx.fillRect((startGrid - px) * s, rz - roadHalf, gridSpan * s, roadHalf * 2);
      // Vertical roads
      const rx = (startGrid + i * city.BLOCK_SIZE - px) * s;
      ctx.fillRect(rx - roadHalf, (startGrid - pz) * s, roadHalf * 2, gridSpan * s);
    }

    // Road center lines
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= city.GRID_SIZE; i++) {
      const rz = (startGrid + i * city.BLOCK_SIZE - pz) * s;
      ctx.beginPath();
      ctx.moveTo((startGrid - px) * s, rz);
      ctx.lineTo((startGrid + gridSpan - px) * s, rz);
      ctx.stroke();

      const rx = (startGrid + i * city.BLOCK_SIZE - px) * s;
      ctx.beginPath();
      ctx.moveTo(rx, (startGrid - pz) * s);
      ctx.lineTo(rx, (startGrid + gridSpan - pz) * s);
      ctx.stroke();
    }

    // Buildings - filled blocks
    ctx.fillStyle = '#777';
    for (const b of city.buildings) {
      const bx = (b.x - px) * s;
      const bz = (b.z - pz) * s;
      // Skip if off screen
      if (Math.abs(bx) > cx + 20 || Math.abs(bz) > cy + 20) continue;
      ctx.fillRect(bx - b.w * s / 2, bz - b.d * s / 2, b.w * s, b.d * s);
    }

    // Airport runway
    ctx.fillStyle = '#555';
    const rw = city.RUNWAY_WIDTH * s;
    const rl = city.RUNWAY_LENGTH * s;
    ctx.fillRect((city.AIRPORT_X - px) * s - rw / 2, (city.AIRPORT_Z - pz) * s - rl / 2, rw, rl);

    // Terminal
    ctx.fillStyle = '#888';
    ctx.fillRect((city.AIRPORT_X + 40 - px) * s, (city.AIRPORT_Z - 15 - pz) * s, 60 * s, 30 * s);

    // Vehicles
    for (const v of city.vehicles) {
      const vx = (v.body.position[0] - px) * s;
      const vz = (v.body.position[2] - pz) * s;
      if (Math.abs(vx) > cx + 10 || Math.abs(vz) > cy + 10) continue;
      if (v.type === 'plane') {
        ctx.fillStyle = v.occupied ? '#5f5' : '#88f';
        ctx.fillRect(vx - 3, vz - 3, 6, 6);
      } else {
        ctx.fillStyle = v.occupied ? '#5f5' : '#fa0';
        ctx.fillRect(vx - 2, vz - 2, 4, 4);
      }
    }

    ctx.restore(); // rotation transform

    // Player indicator - always centered, arrow pointing UP
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx - 5, cy + 5);
    ctx.lineTo(cx, cy + 2);
    ctx.lineTo(cx + 5, cy + 5);
    ctx.closePath();
    ctx.fill();

    // White outline for player dot
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore(); // clip

    // Circle border
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, cx - 1, 0, Math.PI * 2);
    ctx.stroke();
  }
}
