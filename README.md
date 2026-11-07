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
- Bilibili URL / BV input via the official external player
- browser tab-audio capture into the same Web Audio analyser
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

The static GitHub Pages build does not resolve Bilibili CDN media URLs directly. Instead it uses Bilibili's official external iframe player and the browser's display-capture audio track. In Chrome/Edge, choose the current tab and enable tab-audio sharing when prompted.
