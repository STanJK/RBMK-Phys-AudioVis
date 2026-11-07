# RBMK-Phys-AudioVis

**English** | [简体中文](README.zh-CN.md)

An RBMK-inspired audio visualizer turned into a deliberately absurd rigid-body accident sandbox.

> “以切尔诺贝利反应堆堆芯的控制棒阵列为视觉原型的实时音频可视化实验。”
>
> — Original project README, Andy Wang / [wzk112](https://github.com/wzk112)

This project is based on the MIT-licensed
[reactor-audio-visualizer](https://github.com/wzk112/reactor-audio-visualizer)
by **Andy Wang (wzk112)**.

The original project established the core idea and interaction model: 709 reactor-inspired rods driven by browser-side Web Audio analysis, with radial frequency mapping, demo/file/microphone input, camera controls, and sensitivity/smoothing/volume controls.

This fork keeps that foundation and then takes it in a much more destructive direction.

## What this version adds

### Real rigid-body rod physics

The original visual motion has been rebuilt as a Rapier 3D physics scene:

- 709 fixed-length rods.
- Guided rods begin as kinematic rigid bodies.
- Ejected rods become real dynamic rigid bodies.
- Gravity, friction, angular velocity, CCD and collision response are applied after release.
- Rods can fall back through the scene, collide with the environment, and accumulate on the ground.
- The core has containment walls, an external collision ground, a return floor and an upper height limit.
- Physics reset remounts the world and clears accident history.

### Random overdrive accidents

Random overdrive is enabled by default.

Every few seconds the system can select an upward-moving rod in a defined response range and run a staged failure:

1. the rod heats from green to red;
2. its current upward velocity is sampled;
3. it is ejected at a multiplied launch velocity;
4. low-energy ejections can remain guided and recover;
5. rods that fully clear the core plane become permanently non-recoverable for that physics session.

Recoverable rods return vertically to their channel and cool back to green.

Non-recoverable rods remain hot for 15 seconds and then fade from red to gray over a randomized **10 ± 5 second** cooling interval, so large accidents do not cool in perfect synchronization.

### AZ5 catastrophe mode

The AZ5 button is intentionally not a realistic reactor SCRAM simulation.

In this toy, AZ5 starts a five-second escalation sequence:

- remaining eligible rods heat from green to red;
- effective response ramps toward maximum sensitivity;
- the normal guided-height cap is bypassed during the ramp;
- after five seconds, rods that have **not previously fully escaped the core** are launched as dynamic rigid bodies;
- launch velocity is derived from current upward motion with a minimum launch speed;
- the upper containment wall is removed after AZ5 until physics reset.

A rod is only considered permanently “already ejected” after its entire body has actually cleared the core plane. A rod that merely overshoots, fails to escape completely, and returns can still participate in a later AZ5 event.

### Beat-driven ground motion

AZ5 also enables a music-driven ground-quake system.

The first prototype used a pair of low-frequency FFT bins. The current implementation instead uses a lightweight beat tracker:

- low-band positive spectral flux;
- mid-band positive spectral flux;
- full-band positive spectral flux;
- additional kick weighting from the low visual spectrum bars;
- a rolling onset envelope;
- short-window autocorrelation for approximate tempo detection;
- a phase predictor that continues the beat grid between strong onsets.

The ground is a kinematic Rapier body, so the beat pulse moves the actual collision surface rather than only the camera or renderer.

Current maximum quake displacement:

- vertical: **1.15 units**;
- lateral: **0.275 units**.

### Collision-budget performance control

Launching hundreds of dynamic rods at once is expensive, so the physics scene uses two levels of degradation.

**Immediate rod-pair budget**

- At most half of all rods keep rod-to-rod collision after a mass launch.
- With 709 rods, the maximum is **354** rods with full rod-pair interaction.
- Excess rods are randomly changed to environment-only collision.
- They still collide with the ground, walls, return floor and height limit.

The pair-collision budget is applied before the first AZ5 dynamic physics step, avoiding a one-frame spike where all 709 rods collide with one another.

**Far-field collision budget**

- The full real-time collision budget is one quarter of all rods: **177**.
- When that budget is exceeded, rods beyond approximately **1.5× the containment radius** become candidates for further degradation.
- Far-field candidates are randomly selected and can have collision response disabled entirely.
- Rendering and rigid-body motion remain active even after collision is removed.
- CCD is disabled for fully culled far-field rods.

This keeps the visually important near-core accident relatively intact while sacrificing distant collision accuracy.

### Bilibili audio source

Bilibili is the default source mode.

The browser still does not call Bilibili playurl/WBI APIs directly. Resolution now uses a direct-first fallback chain:

1. the browser first calls the Squidtail Bili2VRC parser directly;
2. the direct request has a hard **10 second timeout**;
3. network/CORS/API failures fall back immediately, while a stalled request falls back after 10 seconds;
4. if direct parsing succeeds, the returned CDN media URL is tried first and a Worker `/stream` URL is prebuilt as media fallback;
5. if direct parsing fails, the browser calls the Cloudflare Worker `/resolve` endpoint;
6. the Worker calls Squidtail from Cloudflare, validates the returned CDN host, and returns its restricted Range/CORS-capable `/stream` URL.

This keeps the fast path direct when Squidtail is reachable, while giving networks that cannot reliably reach the parser a Cloudflare-assisted fallback.

The Worker uses an allowlist for known Bilibili CDN hosts instead of acting as a general-purpose proxy.

Production resolver:

```text
https://rbmk-bili-audio-proxy.stanjk24.workers.dev
```

Upstream parser:

```text
https://api.squidtail.com/bili2vrc/parse/
```

The UI also includes a small built-in preset list for quick testing.

### Lightweight loudness normalization

Bilibili and local-file sources pass through a small browser-side automatic gain stage before spectrum analysis.

It deliberately avoids a full LUFS implementation and uses smoothed RMS as a cheap loudness proxy:

- target: approximately **-16 dBFS RMS**;
- smoothing window: about **3 seconds**;
- silence gate: **-35 dB**;
- deadband: **±1 dB**;
- maximum boost: **+8 dB**;
- maximum attenuation: **-12 dB**;
- faster attenuation and slower gain recovery.

The normalization stage sits before the main analyser, so the audible level, rod response and beat detector all see the same normalized signal.

## Current stack

- React 19
- TypeScript
- Vite
- Web Audio API
- Three.js / React Three Fiber
- `@react-three/rapier`
- Cloudflare Workers
- GitHub Actions
- GitHub Pages

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

## Attribution and license

Original project:

- **Reactor Audio Visualizer**
- Author: **Andy Wang / wzk112**
- Repository: https://github.com/wzk112/reactor-audio-visualizer
- License: MIT

This repository contains substantial modifications and additional code built on top of that work.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the retained third-party attribution and license notice.

## Disclaimer

This is an audiovisual toy and physics sandbox.

It is **not** a reactor simulator, safety model, neutronics model, thermal-hydraulics model, or representation of real RBMK accident behavior.

The fact that the button says **AZ5** should not be interpreted as evidence of engineering seriousness.
