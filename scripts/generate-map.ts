// Generates a top-down map image of the game world
// Run: npx tsx scripts/generate-map.ts
// Output: map.png

import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import {
  getTerrainHeight, isWater, WATER_LEVEL,
  MT_AIRPORT_X, MT_AIRPORT_Z, MT_RUNWAY_LENGTH,
  LAKE_X, LAKE_Z, LAKE_RX, LAKE_RZ, RIVER_POINTS,
  CITY_X, CITY_Z, isOnMountainRoad, MT_ROAD_POINTS, LAKE_ROAD_POINTS,
  CITY_AIRPORT_X, CITY_AIRPORT_Z,
} from '../src/world/terrain.js';
import { isOnAnyRoad, getDistrictAt } from '../src/world/road-network.js';

const SIZE = 1024;
const WORLD_SIZE = 1000;

function isOnCityAirport(x: number, z: number): boolean {
  return Math.abs(x - CITY_AIRPORT_X) < 160 &&
         Math.abs(z - CITY_AIRPORT_Z) < 80;
}

function isOnMtAirport(x: number, z: number): boolean {
  return Math.abs(x - MT_AIRPORT_X) < 50 &&
         Math.abs(z - MT_AIRPORT_Z) < MT_RUNWAY_LENGTH / 2 + 10;
}

// Generate PPM image
const pixels = Buffer.alloc(SIZE * SIZE * 3);

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    const wx = (px / SIZE - 0.5) * WORLD_SIZE * 2;
    const wz = (py / SIZE - 0.5) * WORLD_SIZE * 2;
    const h = getTerrainHeight(wx, wz);
    const idx = (py * SIZE + px) * 3;

    let r: number, g: number, b: number;

    if (isWater(wx, wz)) {
      const depth = Math.max(0, WATER_LEVEL - h);
      const t = Math.min(1, depth / 4);
      r = Math.round(15 + (1 - t) * 30);
      g = Math.round(55 + (1 - t) * 40);
      b = Math.round(130 + (1 - t) * 30);
    } else if (isOnMountainRoad(wx, wz)) {
      r = 95; g = 90; b = 82;
    } else if (isOnAnyRoad(wx, wz)) {
      r = 85; g = 85; b = 88;
    } else if (isOnCityAirport(wx, wz)) {
      if (Math.abs(wx - CITY_AIRPORT_X) < 150 && Math.abs(wz - CITY_AIRPORT_Z) < 15) {
        r = 70; g = 70; b = 75;
      } else {
        r = 90; g = 92; b = 95;
      }
    } else if (isOnMtAirport(wx, wz)) {
      if (Math.abs(wx - MT_AIRPORT_X) < 10 && Math.abs(wz - MT_AIRPORT_Z) < MT_RUNWAY_LENGTH / 2) {
        r = 70; g = 70; b = 75;
      } else {
        r = 90; g = 92; b = 95;
      }
    } else if (h > 95) {
      const snowDetail = Math.sin(wx * 0.1) * Math.cos(wz * 0.1) * 8;
      r = Math.round(210 + snowDetail);
      g = Math.round(215 + snowDetail);
      b = Math.round(225 + snowDetail);
    } else if (h > 50) {
      const t = Math.min(1, (h - 50) / 45);
      const rockDetail = Math.sin(wx * 0.05) * Math.cos(wz * 0.07) * 10;
      r = Math.round(85 + t * 45 + rockDetail);
      g = Math.round(78 + t * 30 + rockDetail);
      b = Math.round(65 + t * 20 + rockDetail);
    } else if (h > 20) {
      const t = Math.min(1, (h - 20) / 30);
      r = Math.round(40 + t * 30);
      g = Math.round(75 - t * 5);
      b = Math.round(35 - t * 5);
    } else if (h > 3) {
      const hillShade = Math.min(15, h * 0.8);
      r = Math.round(38 + hillShade);
      g = Math.round(72 + hillShade * 0.5);
      b = Math.round(32 + hillShade * 0.3);
    } else {
      // Check district for city coloring
      const district = getDistrictAt(wx, wz);
      if (district.type === 'downtown' || district.type === 'midtown') {
        r = 42; g = 58; b = 42;
      } else if (district.type === 'residential') {
        r = 38; g = 62; b = 38;
      } else if (district.type === 'industrial') {
        r = 45; g = 55; b = 45;
      } else if (district.type === 'park') {
        r = 30; g = 72; b = 30;
      } else {
        r = 35; g = 68; b = 35;
      }
    }

    // Building-like shading for areas near roads in city districts
    if (!isOnAnyRoad(wx, wz) && !isWater(wx, wz) && h < 5) {
      const district = getDistrictAt(wx, wz);
      if (district.density > 0.3) {
        r = Math.round(r * 0.7 + 30);
        g = Math.round(g * 0.7 + 30);
        b = Math.round(b * 0.7 + 35);
      }
    }

    pixels[idx] = Math.max(0, Math.min(255, r));
    pixels[idx + 1] = Math.max(0, Math.min(255, g));
    pixels[idx + 2] = Math.max(0, Math.min(255, b));
  }
}

// Draw labels/markers
function drawCircle(cx: number, cz: number, radius: number, cr: number, cg: number, cb: number) {
  const px0 = Math.round((cx / (WORLD_SIZE * 2) + 0.5) * SIZE);
  const pz0 = Math.round((cz / (WORLD_SIZE * 2) + 0.5) * SIZE);
  const pr = Math.round(radius / (WORLD_SIZE * 2) * SIZE);
  for (let dy = -pr; dy <= pr; dy++) {
    for (let dx = -pr; dx <= pr; dx++) {
      if (dx * dx + dy * dy <= pr * pr) {
        const x = px0 + dx, y = pz0 + dy;
        if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) {
          const idx = (y * SIZE + x) * 3;
          pixels[idx] = cr;
          pixels[idx + 1] = cg;
          pixels[idx + 2] = cb;
        }
      }
    }
  }
}

// Mark player spawn
drawCircle(CITY_X - 160, CITY_Z - 155, 12, 255, 255, 255);

// Mark boat locations on lake
drawCircle(LAKE_X - 40, LAKE_Z, 8, 80, 150, 255);
drawCircle(LAKE_X + 30, LAKE_Z + 20, 8, 80, 150, 255);

// Write PPM file
const ppmPath = '/Users/nickp/code/gta6/map.ppm';
const pngPath = '/Users/nickp/code/gta6/map.png';
const header = `P6\n${SIZE} ${SIZE}\n255\n`;
const headerBuf = Buffer.from(header, 'ascii');
const ppmData = Buffer.concat([headerBuf, pixels]);
writeFileSync(ppmPath, ppmData);

// Convert to PNG using sips (macOS)
try {
  execSync(`sips -s format png "${ppmPath}" --out "${pngPath}" 2>/dev/null`);
  execSync(`rm "${ppmPath}"`);
  console.log(`Map generated: map.png (${SIZE}x${SIZE})`);
} catch {
  console.log(`PPM written to map.ppm - convert manually to PNG`);
}
