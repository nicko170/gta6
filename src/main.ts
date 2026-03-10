import { Renderer } from './engine/renderer';
import { Input } from './engine/input';
import { Player } from './player/player';
import { City } from './world/city';
import { Minimap } from './world/minimap';
import { NetworkManager } from './network/network';
import { AITraffic, Pedestrians } from './world/ai';
import { vec3 } from './engine/math';
import { checkCollision, resolveCollision } from './engine/physics';
import { CITY_X, CITY_Z } from './world/terrain';

async function main() {
  const loadBar = document.getElementById('load-bar') as HTMLElement;
  const loadingScreen = document.getElementById('loading') as HTMLElement;
  const infoEl = document.getElementById('info') as HTMLElement;
  const speedEl = document.getElementById('speed') as HTMLElement;
  const vehiclePromptEl = document.getElementById('vehicle-prompt') as HTMLElement;

  // Flight HUD elements
  const flightHud = document.getElementById('flight-hud') as HTMLElement;
  const flightSpeedEl = document.getElementById('flight-speed') as HTMLElement;
  const flightAltEl = document.getElementById('flight-alt') as HTMLElement;
  const flightHdgEl = document.getElementById('flight-hdg') as HTMLElement;
  const flightThrottleFill = document.getElementById('flight-throttle-fill') as HTMLElement;
  const flightHorizonInner = document.getElementById('flight-horizon-inner') as HTMLElement;
  const flightStallEl = document.getElementById('flight-stall') as HTMLElement;
  const flightFlapsEl = document.getElementById('flight-flaps') as HTMLElement;

  const setStatus = (window as any)._setLoadingStatus || (() => {});

  loadBar.style.width = '5%';
  setStatus('Initializing WebGPU');

  // Init renderer
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  const success = await renderer.init();
  if (!success) return;

  loadBar.style.width = '20%';
  setStatus('Generating terrain');
  await new Promise(r => setTimeout(r, 50));

  // Init input
  const input = new Input(canvas);

  // Wire up mobile touch buttons
  (window as any)._touchBtn = (name: string, pressed: boolean) => {
    input.setTouchButton(name, pressed);
  };

  // Request fullscreen on first touch (mobile)
  if (input.isMobile) {
    const requestFS = () => {
      const d = document.documentElement as any;
      if (d.requestFullscreen) d.requestFullscreen().catch(() => {});
      else if (d.webkitRequestFullscreen) d.webkitRequestFullscreen();
      document.removeEventListener('touchstart', requestFS);
    };
    document.addEventListener('touchstart', requestFS, { once: true });
  }

  // Generate city
  const city = new City();
  city.generate(renderer);

  loadBar.style.width = '50%';
  setStatus('Building city');
  await new Promise(r => setTimeout(r, 50));

  // Generate minimap terrain
  const minimap = new Minimap();
  minimap.generateTerrainMap();

  loadBar.style.width = '60%';
  setStatus('Rendering minimap');
  await new Promise(r => setTimeout(r, 50));

  // Create player - spawn on a road intersection near city center
  const player = new Player([CITY_X - 160, 0, CITY_Z - 155]);
  player.yaw = Math.PI * 0.25; // Face diagonally into the city
  player.createMesh(renderer);

  loadBar.style.width = '70%';
  setStatus('Spawning traffic');
  await new Promise(r => setTimeout(r, 50));

  // Spawn AI traffic and pedestrians
  const aiTraffic = new AITraffic();
  aiTraffic.spawn(renderer);

  const pedestrians = new Pedestrians();
  pedestrians.spawn(renderer);

  loadBar.style.width = '85%';
  setStatus('Connecting to server');
  await new Promise(r => setTimeout(r, 50));

  // Init networking
  const network = new NetworkManager();
  network.createMeshes(renderer);
  network.connect();
  network.startSending(() => ({
    position: player.body.position,
    rotation: player.yaw,
    inVehicle: !!player.inVehicle,
    vehicleType: player.inVehicle?.type,
  }));

  loadBar.style.width = '100%';
  setStatus('Ready');

  // Show start button and wait for click
  const startBtn = document.getElementById('start-btn') as HTMLElement;
  const progressEl = document.getElementById('loading-progress') as HTMLElement;
  progressEl.style.display = 'none';
  startBtn.style.display = 'flex';

  await new Promise<void>(resolve => {
    startBtn.addEventListener('click', resolve, { once: true });
    startBtn.addEventListener('touchend', resolve, { once: true });
  });

  // Hide loading screen
  loadingScreen.style.opacity = '0';
  loadingScreen.style.transition = 'opacity 0.8s ease-out';
  await new Promise(r => setTimeout(r, 800));
  loadingScreen.style.display = 'none';

  // Handle resize
  window.addEventListener('resize', () => renderer.resize());

  // Game loop
  let lastTime = performance.now();
  let frameCount = 0;
  let fps = 0;
  let fpsTimer = 0;

  function gameLoop() {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05); // cap delta
    lastTime = now;

    // FPS counter
    frameCount++;
    fpsTimer += dt;
    if (fpsTimer >= 1) {
      fps = frameCount;
      frameCount = 0;
      fpsTimer = 0;
    }

    // Update
    const getGroundHeight = (x: number, z: number) => city.getGroundHeight(x, z);
    const checkBuilding = (x: number, z: number, r: number) => city.checkBuildingCollision(x, z, r);
    const allVehicles = [...city.vehicles, ...aiTraffic.vehicles];
    player.update(dt, input, getGroundHeight, allVehicles, checkBuilding);

    // Update parked vehicles
    for (const v of city.vehicles) {
      if (!v.occupied) {
        v.update(dt, null, getGroundHeight);
      }
    }

    // Vehicle-to-vehicle collision detection
    if (player.inVehicle) {
      const pv = player.inVehicle;
      for (const v of allVehicles) {
        if (v === pv || v.occupied) continue;
        if (checkCollision(pv.body, v.body)) {
          resolveCollision(pv.body, v.body);
          // Impact: both vehicles lose speed
          const impactSpeed = Math.abs(pv.speed);
          pv.speed *= 0.6;
          // Knock the parked/AI car
          const dx = v.body.position[0] - pv.body.position[0];
          const dz = v.body.position[2] - pv.body.position[2];
          const dist = Math.sqrt(dx * dx + dz * dz) || 1;
          v.body.velocity[0] += (dx / dist) * impactSpeed * 0.5;
          v.body.velocity[2] += (dz / dist) * impactSpeed * 0.5;
        }
      }
    }

    // Player-on-foot vs vehicle collision (get hit by cars)
    if (!player.inVehicle) {
      for (const v of allVehicles) {
        if (checkCollision(player.body, v.body)) {
          resolveCollision(player.body, v.body);
          // Knock the player back
          const dx = player.body.position[0] - v.body.position[0];
          const dz = player.body.position[2] - v.body.position[2];
          const dist = Math.sqrt(dx * dx + dz * dz) || 1;
          const knockSpeed = Math.abs(v.speed || 0) * 0.4 + 2;
          player.body.velocity[0] = (dx / dist) * knockSpeed;
          player.body.velocity[2] = (dz / dist) * knockSpeed;
          player.body.velocity[1] = 3; // bounce up
        }
      }
    }

    // Melee punch (left click when on foot)
    if (!player.inVehicle && input.mouseClicked) {
      const punchRange = 2.5;
      const fwd: [number, number, number] = [Math.sin(player.yaw), 0, Math.cos(player.yaw)];
      let bestNpc = null;
      let bestDist = punchRange;
      for (const npc of pedestrians.npcs) {
        if (npc.hitTimer > 0) continue;
        const dx = npc.position[0] - player.body.position[0];
        const dz = npc.position[2] - player.body.position[2];
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > punchRange) continue;
        // Check if in front of player (dot product with facing direction)
        const dot = (dx * fwd[0] + dz * fwd[2]) / (dist || 1);
        if (dot > 0.3 && dist < bestDist) {
          bestDist = dist;
          bestNpc = npc;
        }
      }
      if (bestNpc) {
        const dx = bestNpc.position[0] - player.body.position[0];
        const dz = bestNpc.position[2] - player.body.position[2];
        const dist = Math.sqrt(dx * dx + dz * dz) || 1;
        bestNpc.velocity[0] = (dx / dist) * 6 + fwd[0] * 4;
        bestNpc.velocity[1] = 3;
        bestNpc.velocity[2] = (dz / dist) * 6 + fwd[2] * 4;
        bestNpc.hitTimer = 1.5 + Math.random() * 0.5;
      }
    }

    // Vehicle vs pedestrian collision
    for (const npc of pedestrians.npcs) {
      if (npc.hitTimer > 0) continue;
      for (const v of allVehicles) {
        const dx = npc.position[0] - v.body.position[0];
        const dz = npc.position[2] - v.body.position[2];
        const dist = Math.sqrt(dx * dx + dz * dz);
        const hitRadius = v.config.isAircraft ? 1.5 : Math.max(v.config.bodyW, v.config.bodyL) * 0.4;
        if (dist < hitRadius && Math.abs(v.speed) > 2) {
          const knockDir = dist > 0.1 ? 1 / dist : 1;
          const impactSpeed = Math.abs(v.speed);
          npc.velocity[0] = dx * knockDir * impactSpeed * 0.6 + (Math.random() - 0.5) * 3;
          npc.velocity[1] = 4 + impactSpeed * 0.2;
          npc.velocity[2] = dz * knockDir * impactSpeed * 0.6 + (Math.random() - 0.5) * 3;
          npc.hitTimer = 2 + Math.random();
          break;
        }
      }
    }

    // Update AI traffic and pedestrians
    aiTraffic.update(dt, getGroundHeight);
    pedestrians.update(dt);

    // Update network
    network.update();

    // Collect render objects
    const objects = [
      ...city.getRenderObjects(),
      ...aiTraffic.getRenderObjects(),
      ...pedestrians.getRenderObjects(),
      ...network.getRenderObjects(),
    ];

    const playerObj = player.getRenderObject();
    if (playerObj) objects.push(playerObj);

    // Render
    const viewMatrix = player.getViewMatrix();
    const cameraPos = player.getCameraPosition();
    const time = now / 1000;

    renderer.render(objects, viewMatrix, cameraPos, time);

    // Update minimap
    minimap.render(player, city);

    // Update HUD
    const pos = player.body.position;
    const speed = player.inVehicle ? Math.abs(player.inVehicle.speed) : vec3.length([player.body.velocity[0], 0, player.body.velocity[2]]);
    const speedMph = Math.round(speed * 2.237);

    let infoText = `FPS: ${fps}\n`;
    infoText += `Players: ${network.getPlayerCount()}\n`;
    infoText += `${network.connected ? 'ONLINE' : 'OFFLINE'}\n`;
    infoText += `\nPos: ${Math.round(pos[0])}, ${Math.round(pos[1])}, ${Math.round(pos[2])}\n`;

    if (player.inVehicle) {
      const v = player.inVehicle;
      infoText += `\nVehicle: ${v.type.toUpperCase()}`;
    }

    infoEl.innerText = infoText;

    // Flight HUD
    const isInAircraft = player.inVehicle?.config.isAircraft;
    if (isInAircraft) {
      const v = player.inVehicle!;
      flightHud.style.display = 'block';
      speedEl.innerText = '';

      // Speed in knots (1 m/s = 1.944 knots)
      const kts = Math.round(v.speed * 1.944);
      flightSpeedEl.innerText = String(kts);

      // Altitude in feet (1m = 3.281ft)
      const altFt = Math.round(v.body.position[1] * 3.281);
      flightAltEl.innerText = String(altFt);

      // Heading (0-360)
      let hdg = Math.round((-v.body.rotation * 180 / Math.PI) % 360);
      if (hdg < 0) hdg += 360;
      flightHdgEl.innerText = String(hdg).padStart(3, '0');

      // Throttle bar
      flightThrottleFill.style.height = `${v.throttle * 100}%`;

      // Artificial horizon (pitch + roll)
      const pitchOffset = v.pitch * 60; // pixels
      const rollDeg = -v.roll * (180 / Math.PI);
      flightHorizonInner.style.transform = `translateY(${-pitchOffset}px) rotate(${rollDeg}deg)`;

      // Flaps
      flightFlapsEl.innerText = `${Math.round(v.flaps * 100)}%`;

      // Stall warning
      flightStallEl.style.display = v.stalling ? 'block' : 'none';
    } else {
      flightHud.style.display = 'none';
      flightStallEl.style.display = 'none';
      if (player.inVehicle) {
        speedEl.innerText = `${speedMph} MPH`;
      } else {
        speedEl.innerText = '';
      }
    }

    // Vehicle prompt
    const prompt = player.getNearestVehiclePrompt(allVehicles, input.isMobile);
    if (prompt) {
      vehiclePromptEl.style.display = 'block';
      vehiclePromptEl.innerText = prompt;
    } else {
      vehiclePromptEl.style.display = 'none';
    }

    // Update mobile touch button visibility
    if (input.isMobile) {
      updateMobileButtons(player, isInAircraft || false);
    }

    input.endFrame();
    requestAnimationFrame(gameLoop);
  }

  // Mobile button visibility based on game state
  const touchOnFoot = document.getElementById('touch-onfoot');
  const touchVehicle = document.getElementById('touch-vehicle');
  const touchFlight = document.getElementById('touch-flight');

  function updateMobileButtons(p: Player, isFlying: boolean) {
    if (!touchOnFoot) return;
    if (p.inVehicle) {
      touchOnFoot!.style.display = 'none';
      if (isFlying) {
        touchVehicle!.style.display = 'none';
        touchFlight!.style.display = 'flex';
      } else {
        touchVehicle!.style.display = 'flex';
        touchFlight!.style.display = 'none';
      }
    } else {
      touchOnFoot!.style.display = 'flex';
      touchVehicle!.style.display = 'none';
      touchFlight!.style.display = 'none';
    }
  }

  requestAnimationFrame(gameLoop);
}

main().catch(console.error);
