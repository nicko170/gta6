import { Vec3, vec3 } from '../engine/math';
import { Renderer, Mesh, RenderObject } from '../engine/renderer';
import { createBox, mergeMeshes } from '../engine/meshgen';
import { mat4 } from '../engine/math';

// Network state for other players
export interface RemotePlayer {
  id: string;
  position: Vec3;
  rotation: number;
  inVehicle: boolean;
  vehicleType?: string;
  lastUpdate: number;
}

export class NetworkManager {
  playerId: string;
  remotePlayers: Map<string, RemotePlayer> = new Map();
  playerMesh!: Mesh;
  connected = false;
  ws: WebSocket | null = null;
  serverUrl: string;

  private sendInterval: ReturnType<typeof setInterval> | null = null;

  constructor(serverUrl = 'ws://localhost:8080') {
    this.playerId = 'player_' + Math.random().toString(36).substr(2, 9);
    this.serverUrl = serverUrl;
  }

  createMeshes(renderer: Renderer) {
    // Remote player mesh (different color)
    const torso = createBox(0.6, 0.8, 0.35, 0.7, 0.2, 0.2);
    const head = createBox(0.35, 0.35, 0.35, 0.85, 0.7, 0.55);
    const legs = createBox(0.55, 0.8, 0.3, 0.2, 0.2, 0.3);
    const arms = createBox(0.9, 0.25, 0.25, 0.7, 0.2, 0.2);

    const merged = mergeMeshes(
      { data: torso, offsetY: 0.4 },
      { data: head, offsetY: 1.0 },
      { data: legs, offsetY: -0.4 },
      { data: arms, offsetY: 0.35 },
    );
    this.playerMesh = renderer.createMesh(merged.vertices, merged.indices, 'object');
  }

  connect() {
    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        this.connected = true;
        console.log('Connected to game server');
        this.ws!.send(JSON.stringify({ type: 'join', id: this.playerId }));
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch {}
      };

      this.ws.onclose = () => {
        this.connected = false;
        console.log('Disconnected from server');
        // Attempt reconnect
        setTimeout(() => this.connect(), 3000);
      };

      this.ws.onerror = () => {
        // Server not available - that's fine, run in single player
        this.connected = false;
      };
    } catch {
      // No server available, single player mode
      this.connected = false;
    }
  }

  private handleMessage(data: any) {
    switch (data.type) {
      case 'players':
        // Full state update
        for (const p of data.players) {
          if (p.id === this.playerId) continue;
          this.remotePlayers.set(p.id, {
            ...p,
            lastUpdate: performance.now(),
          });
        }
        break;
      case 'update':
        if (data.id === this.playerId) return;
        this.remotePlayers.set(data.id, {
          id: data.id,
          position: data.position,
          rotation: data.rotation,
          inVehicle: data.inVehicle,
          vehicleType: data.vehicleType,
          lastUpdate: performance.now(),
        });
        break;
      case 'leave':
        this.remotePlayers.delete(data.id);
        break;
    }
  }

  sendUpdate(position: Vec3, rotation: number, inVehicle: boolean, vehicleType?: string) {
    if (!this.connected || !this.ws) return;
    try {
      this.ws.send(JSON.stringify({
        type: 'update',
        id: this.playerId,
        position,
        rotation,
        inVehicle,
        vehicleType,
      }));
    } catch {}
  }

  startSending(getState: () => { position: Vec3; rotation: number; inVehicle: boolean; vehicleType?: string }) {
    this.sendInterval = setInterval(() => {
      const state = getState();
      this.sendUpdate(state.position, state.rotation, state.inVehicle, state.vehicleType);
    }, 50); // 20 updates per second
  }

  update() {
    // Remove stale players (no update in 5 seconds)
    const now = performance.now();
    for (const [id, player] of this.remotePlayers) {
      if (now - player.lastUpdate > 5000) {
        this.remotePlayers.delete(id);
      }
    }
  }

  getRenderObjects(): RenderObject[] {
    const objects: RenderObject[] = [];
    for (const [_, player] of this.remotePlayers) {
      if (player.inVehicle) continue; // Vehicle handles rendering
      const t = mat4.translation(player.position[0], player.position[1] + 0.9, player.position[2]);
      const r = mat4.rotationY(player.rotation);
      objects.push({ mesh: this.playerMesh, modelMatrix: mat4.multiply(t, r) });
    }
    return objects;
  }

  getPlayerCount(): number {
    return this.remotePlayers.size + 1;
  }

  destroy() {
    if (this.sendInterval) clearInterval(this.sendInterval);
    if (this.ws) this.ws.close();
  }
}
