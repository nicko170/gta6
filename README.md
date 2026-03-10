# GTA6 — WebGPU Edition

> Because Rockstar has been "working on it" since the Obama administration.

## What is this?

We got tired of waiting. Seriously. GTA V came out in **2013**. That's not a release date, that's a historical event. Kids born when GTA V launched are now old enough to be disappointed by the lack of GTA VI themselves.

So instead of refreshing the Rockstar Newswire for the 47th time this week, we built our own. **In a browser. With WebGPU. For free.** You're welcome.

## Features

- **Driveable cars** — Sports cars, sedans, trucks. They go vroom. No Shark Cards required.
- **Flyable planes** — Full flight physics with ailerons, rudder, flaps, stall mechanics, and everything. Took us mass 2 weeks, not 12 years.
- **A whole city** — Procedurally generated with buildings, roads, sidewalks, trees, and an airport. No 200GB download.
- **Multiplayer** — WebSocket-based online play. No loading into a lobby for 4 minutes just to get griefed by a flying motorcycle.
- **AI Traffic** — Cars actually drive around on the roads. Following lanes. Stopping at intersections. Revolutionary, apparently.
- **NPC Pedestrians** — They walk. On sidewalks. Groundbreaking stuff.
- **Day/night cycle** — Atmospheric scattering, volumetric clouds, stars, sunset. The sky alone has more shader code than some entire games.
- **Flight HUD** — Altitude, airspeed, artificial horizon, throttle, flaps, stall warning. Because we're not animals.
- **Minimap** — It rotates and everything. Eat your heart out, Rockstar.
- **Vehicle collisions** — Ram into parked cars. Get hit by traffic. Physics. Fun.

## Tech Stack

- **TypeScript** — Because we have standards
- **WebGPU** — The future of browser graphics (sorry WebGL, it's been real)
- **Vite** — Sub-second hot reload, unlike Rockstar's sub-decade release cycle
- **WGSL Shaders** — Custom terrain, object, and sky shaders with PBR-inspired lighting
- **Zero dependencies** — No React. No Three.js. No 400MB of node_modules. Just vibes and math.

## Controls

### On Foot
| Key | Action |
|-----|--------|
| WASD | Move |
| Mouse | Look around |
| Shift | Sprint |
| F | Enter/exit vehicle |

### Driving
| Key | Action |
|-----|--------|
| W/S | Accelerate / Brake |
| A/D | Steer |
| Space | Handbrake |
| Shift | Boost |

### Flying
| Key | Action |
|-----|--------|
| W/S | Throttle up/down |
| A/D | Ailerons (roll) |
| Arrow L/R | Rudder / nosewheel steering |
| Arrow U/D | Flaps |
| Space | Elevator up (nose up) |
| Ctrl | Elevator down (nose down) |

## Running It

```bash
npm install
npm run dev
```

That's it. No Epic Games launcher. No 97GB patch. No "installing... 2 hours remaining."

## Building

```bash
npm run build
```

Outputs to `dist/`. Deploy anywhere. It's a website. Remember those?

## The Math

- **Rockstar's GTA VI development time:** ~12 years (and counting)
- **Budget:** Reportedly $1-2 billion
- **Our development time:** Mass couple of evenings
- **Our budget:** $0 and mass caffeine
- **Our polygon count:** Low. Our ambition? Also low. Our delivery speed? Immeasurable.

## FAQ

**Q: Is this actually GTA VI?**
A: No. But it exists, which is more than we can say for the real one.

**Q: Will this have flying motorcycles with homing missiles?**
A: Absolutely not. We have dignity.

**Q: Can I buy Shark Cards?**
A: There is no monetisation. We are not Take-Two Interactive. We have souls.

**Q: Does it run on my browser?**
A: If your browser supports WebGPU (Chrome 113+, Edge 113+), yes. If not, you'll have to wait — but still less time than waiting for GTA VI.

**Q: Is the netcode good?**
A: It's WebSocket-based and works. Which already puts it ahead of GTA Online's peer-to-peer nightmare from 2013.

## Contributing

Open a PR. We'll merge it faster than Rockstar releases a trailer.

## License

Do whatever you want with it. It's not like Rockstar is going to sue us for making a browser game with colored boxes.

---

*Built with mass frustration and mass TypeScript by people who just wanted to play GTA VI.*
