import { Player } from '../player/player';
import { City } from './city';
import {
  getTerrainHeight, isWater,
  MT_AIRPORT_X, MT_AIRPORT_Z, MT_RUNWAY_LENGTH,
  CITY_X, CITY_Z, MT_ROAD_POINTS, LAKE_ROAD_POINTS,
  CITY_AIRPORT_X, CITY_AIRPORT_Z,
} from './terrain';
import {
  ROAD_SEGMENTS, getSegmentPoints, getDistrictAt,
} from './road-network';

export class Minimap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  size = 200;
  scale = 0.2;
  terrainCanvas: HTMLCanvasElement | null = null;

  constructor() {
    this.canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
  }

  generateTerrainMap() {
    const res = 512;
    this.terrainCanvas = document.createElement('canvas');
    this.terrainCanvas.width = res;
    this.terrainCanvas.height = res;
    const tctx = this.terrainCanvas.getContext('2d')!;
    const imageData = tctx.createImageData(res, res);
    const data = imageData.data;
    const worldSize = 1000;

    for (let py = 0; py < res; py++) {
      for (let px = 0; px < res; px++) {
        const wx = (px / res - 0.5) * worldSize * 2;
        const wz = (py / res - 0.5) * worldSize * 2;
        const h = getTerrainHeight(wx, wz);
        const idx = (py * res + px) * 4;

        if (isWater(wx, wz)) {
          data[idx] = 15;
          data[idx + 1] = 50;
          data[idx + 2] = 120;
        } else if (h > 90) {
          data[idx] = 210;
          data[idx + 1] = 215;
          data[idx + 2] = 220;
        } else if (h > 40) {
          const t = Math.min(1, (h - 40) / 60);
          data[idx] = Math.round(45 + t * 50);
          data[idx + 1] = Math.round(65 - t * 10);
          data[idx + 2] = Math.round(35 - t * 10);
        } else if (h > 5) {
          data[idx] = 35;
          data[idx + 1] = 70;
          data[idx + 2] = 35;
        } else {
          data[idx] = 30;
          data[idx + 1] = 61;
          data[idx + 2] = 30;
        }
        data[idx + 3] = 255;
      }
    }
    tctx.putImageData(imageData, 0, 0);
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

    ctx.fillStyle = '#1e3d1e';
    ctx.fillRect(0, 0, this.size, this.size);

    // Transform: center on player, rotate so forward is UP
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(player.yaw - Math.PI);

    // Draw pre-rendered terrain map
    if (this.terrainCanvas) {
      const worldSize = 1000;
      const mapScale = this.scale;
      const mapSize = worldSize * 2 * mapScale;
      ctx.drawImage(
        this.terrainCanvas,
        (-worldSize - px) * mapScale,
        (-worldSize - pz) * mapScale,
        mapSize,
        mapSize
      );
    }

    const s = this.scale;

    // Draw all road segments as polylines
    for (const seg of ROAD_SEGMENTS) {
      const pts = getSegmentPoints(seg);
      ctx.strokeStyle = seg.width >= 16 ? '#505050' : '#484848';
      ctx.lineWidth = seg.width * s;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const sx = (pts[i][0] - px) * s;
        const sz = (pts[i][1] - pz) * s;
        if (i === 0) ctx.moveTo(sx, sz);
        else ctx.lineTo(sx, sz);
      }
      ctx.stroke();

      // Center line for wider roads
      if (seg.width >= 12) {
        ctx.strokeStyle = '#777';
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const sx = (pts[i][0] - px) * s;
          const sz = (pts[i][1] - pz) * s;
          if (i === 0) ctx.moveTo(sx, sz);
          else ctx.lineTo(sx, sz);
        }
        ctx.stroke();
      }
    }

    // Mountain roads
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    const drawRoadPath = (points: [number, number][]) => {
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const rx = (points[i][0] - px) * s;
        const rz = (points[i][1] - pz) * s;
        if (i === 0) ctx.moveTo(rx, rz);
        else ctx.lineTo(rx, rz);
      }
      ctx.stroke();
    };
    drawRoadPath(MT_ROAD_POINTS);
    drawRoadPath(LAKE_ROAD_POINTS);

    // Buildings - colored by district
    for (const b of city.buildings) {
      const bx = (b.x - px) * s;
      const bz = (b.z - pz) * s;
      if (Math.abs(bx) > cx + 20 || Math.abs(bz) > cy + 20) continue;

      const district = getDistrictAt(b.x, b.z);
      switch (district.type) {
        case 'downtown': ctx.fillStyle = '#999'; break;
        case 'midtown': ctx.fillStyle = '#888'; break;
        case 'residential': ctx.fillStyle = '#a97'; break;
        case 'waterfront': ctx.fillStyle = '#9ab'; break;
        case 'industrial': ctx.fillStyle = '#776'; break;
        default: ctx.fillStyle = '#777'; break;
      }
      ctx.fillRect(bx - b.w * s / 2, bz - b.d * s / 2, b.w * s, b.d * s);
    }

    // City airport runway (E-W orientation)
    ctx.fillStyle = '#555';
    const rw = city.RUNWAY_WIDTH * s;
    const rl = city.RUNWAY_LENGTH * s;
    ctx.fillRect((CITY_AIRPORT_X - px) * s - rl / 2, (CITY_AIRPORT_Z - pz) * s - rw / 2, rl, rw);

    ctx.fillStyle = '#888';
    ctx.fillRect((CITY_AIRPORT_X - 30 - px) * s, (CITY_AIRPORT_Z + 40 - pz) * s, 60 * s, 30 * s);

    // Mountain airport
    ctx.fillStyle = '#555';
    const mrl = MT_RUNWAY_LENGTH * s;
    ctx.fillRect((MT_AIRPORT_X - px) * s - 10 * s, (MT_AIRPORT_Z - pz) * s - mrl / 2, 20 * s, mrl);
    ctx.fillStyle = '#888';
    ctx.fillRect((MT_AIRPORT_X + 20 - px) * s, (MT_AIRPORT_Z - 9 - pz) * s, 30 * s, 18 * s);

    // Vehicles
    for (const v of city.vehicles) {
      const vx = (v.body.position[0] - px) * s;
      const vz = (v.body.position[2] - pz) * s;
      if (Math.abs(vx) > cx + 10 || Math.abs(vz) > cy + 10) continue;
      if (v.type === 'plane') {
        ctx.fillStyle = v.occupied ? '#5f5' : '#88f';
        ctx.fillRect(vx - 3, vz - 3, 6, 6);
      } else if (v.type === 'boat') {
        ctx.fillStyle = v.occupied ? '#5f5' : '#48f';
        ctx.fillRect(vx - 2, vz - 3, 4, 6);
      } else {
        ctx.fillStyle = v.occupied ? '#5f5' : '#fa0';
        ctx.fillRect(vx - 2, vz - 2, 4, 4);
      }
    }

    ctx.restore(); // rotation transform

    // Player indicator
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx - 5, cy + 5);
    ctx.lineTo(cx, cy + 2);
    ctx.lineTo(cx + 5, cy + 5);
    ctx.closePath();
    ctx.fill();

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
