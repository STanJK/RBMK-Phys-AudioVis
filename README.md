# RBMK-Phys-AudioVis

RBMK-inspired audio visualizer with a deliberately irreversible rigid-body failure mode.

## Current architecture

- React 19 + TypeScript + Vite
- Web Audio API
- React Three Fiber / Three.js
- Rapier 3D via @react-three/rapier
- GitHub Actions CI
- GitHub Pages deployment workflow

The React audio/control layer preserves the reference visualizer's behavior:

- built-in demo signal
- microphone capture
- local audio file import
- Bilibili URL / BV input through a thin Cloudflare Worker adapter
- play / pause / seek
- sensitivity, smoothing and playback volume controls
- 48-band spectrum display
- input-level and peak-frequency readouts
- radial frequency mapping: center low -> edge high

The renderer is now a real rigid-body scene:

- 709 fixed-length rods
- all 709 rods begin as guided kinematic rigid bodies
- gravity, friction, CCD and collisions remain active after release
- the displaced rod can fall across the still-moving guided array
- an invisible cylindrical containment wall rises two rod lengths above the core ring
- a fixed collision plate sits five rod lengths above the core and knocks ejected rods back down
- random overdrive is enabled by default; every 3 seconds it selects an upward-moving 40%-70% global-response rod, heats it from green to red for 3 seconds, then ejects it at 10× its precomputed upward velocity
- ejections predicted to rise no more than one rod length remain vertical, return to their original channel, and cool back to green over 5 seconds; stronger ejections stay red for 15 seconds and then cool linearly to gray
- released random rods remain dynamic and are never auto-cleaned until physics reset
- physics reset remounts the world

## Development

```bash
npm install
npm run dev
```

## CI

```bash
npm run typecheck
npm run build
```

## Reference implementation

The initial control-surface styling and Web Audio behavior were adapted from the MIT-licensed project:

- https://github.com/wzk112/reactor-audio-visualizer

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Disclaimer

This is an audiovisual toy, not a reactor simulation.

### Bilibili source

GitHub Pages stays static. Bilibili resolution has a single production path:

1. the browser sends BV + page to the embedded Cloudflare Worker;
2. the Worker calls the Squidtail Bili2VRC parsing API;
3. Squidtail returns a playable MP4 URL to the Worker;
4. the Worker exposes that media only through its restricted `/stream` proxy with Range/CORS handling.

The project no longer calls Bilibili metadata, WBI, pagelist, or playurl APIs directly from either the browser or the Worker. The browser also does not connect directly to the returned media CDN URL.

Production resolver:

```
https://rbmk-bili-audio-proxy.stanjk24.workers.dev
```

Upstream parser:

```
https://api.squidtail.com/bili2vrc/parse/
```
