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
- an invisible cylindrical containment wall rises two rod lengths above the core ring and is open at the top
- optional random overdrive mode checks every 5 seconds for guided rods above 30% travel and moving upward, releases one at random, and multiplies its instantaneous upward velocity by 10
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

GitHub Pages remains static. Bilibili resolution is browser-first:

1. the page directly tries the public Bilibili `view -> playurl` APIs;
2. it first attempts the returned CDN audio URL directly;
3. if browser API access is blocked by CORS/HTTP 412, an optional Cloudflare Worker can resolve the same request;
4. if the direct CDN media request fails, the same Worker `/stream` endpoint is used as the media fallback with Range/CORS support.

The browser plays the chosen stream through an `HTMLAudioElement`, routes it into the existing Web Audio analyser, and applies the normal playback-volume slider. No screen/tab capture is used.

The Worker is therefore optional when both direct API access and direct CDN CORS work in the current browser/network, and acts as a fallback otherwise. Its URL is stored in localStorage so changing the endpoint does not require a Pages rebuild.
