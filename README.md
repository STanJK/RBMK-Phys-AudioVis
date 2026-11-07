# RBMK-Phys-AudioVis

Physics-first RBMK-inspired audio visualizer.

## Current milestone: React parity baseline

Before adding Three.js / Rapier, the project first reproduces the reference visualizer in a clean React + TypeScript architecture:

- Web Audio API
- Built-in demo signal
- Microphone capture
- Local audio file import
- Play / pause / seek
- Sensitivity, motion smoothing and playback volume controls
- 709-channel radial Canvas visualizer
- 48-band spectrum display
- Input level and peak-frequency readouts
- Pointer rotation, wheel zoom and view reset

The current radial mapping follows the reference behavior:

```text
core center -> low frequencies
core edge   -> high frequencies
```

The next milestone replaces the fake-3D Canvas rods with real Three.js geometry and Rapier rigid bodies, while preserving the React audio/control layer.

## Run locally

```bash
npm install
npm run dev
```

## CI

GitHub Actions runs:

```bash
npm install
npm run typecheck
npm run build
```

## Reference implementation

The interaction model and substantial portions of the initial Canvas/audio behavior are adapted from the MIT-licensed project:

- https://github.com/wzk112/reactor-audio-visualizer

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Disclaimer

This is an audiovisual toy, not a reactor simulation.
