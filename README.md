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
- Bilibili URL / BV input through a thin Cloudflare Worker resolver/proxy
- direct HTMLAudioElement -> Web Audio analyser path for Bilibili audio
- play / pause / seek
- sensitivity, smoothing and playback volume controls
- 48-band spectrum display
- input-level and peak-frequency readouts
- radial frequency mapping: center low -> edge high

The renderer is now a real rigid-body scene:

- 709 fixed-length rods
- 708 guided rods are kinematic rigid bodies
- CH-418 starts guided, then can be released into a dynamic body
- launch applies linear + angular impulse
- gravity, friction, CCD and collisions remain active after release
- the displaced rod can fall across the still-moving guided array
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

GitHub Pages remains static. A small Cloudflare Worker in [worker/](worker/) resolves public Bilibili `bvid + p` metadata to a DASH audio track and proxies the Bilibili CDN stream with Range/CORS support.

The browser then plays the Worker stream through an `HTMLAudioElement`, routes it into the existing Web Audio analyser, and applies the normal playback-volume slider. No screen/tab capture is used.

The Bilibili panel accepts a Worker URL at runtime and stores it in localStorage, so the Pages site does not need to be rebuilt when the Worker endpoint changes.
