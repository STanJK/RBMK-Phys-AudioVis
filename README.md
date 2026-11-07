# RBMK-Phys-AudioVis

Physics-first RBMK-inspired audio visualizer.

This project is a clean React/TypeScript implementation built around:

- React 19 + Vite
- React Three Fiber / Three.js
- Rapier 3D rigid-body physics
- Web Audio API for future FFT / phase / transient analysis

## Core idea

Normal rods remain guided/kinematic and respond to audio. Selected channels can lose their guide constraint, become dynamic rigid bodies, launch out of the core, collide with other rods, fall across the array, and remain displaced.

The first debug target is deliberately simple:

> **CH-418: LAUNCH**

The long-term audio mapping will experiment with frequency, phase, transient detection, stereo phase difference, and irreversible physical state.

## Inspiration

The radial audio-mapping idea is inspired by the MIT-licensed project:

- https://github.com/wzk112/reactor-audio-visualizer

This repository is a clean implementation with a different rendering/physics architecture; it does not copy the original Canvas implementation.

## Development

```bash
npm install
npm run dev
```

Cloud CI runs type-checking and production builds on GitHub Actions.

## Status

Initial scaffold / physics PoC.

This is an audiovisual toy, not a reactor simulation.
