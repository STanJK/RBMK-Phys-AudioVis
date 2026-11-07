import type { AudioEngine, AudioEngineState } from "./AudioEngine";
import type { RodSpec } from "../reactor/layout";

export function sampleRodAmplitude(
  engine: AudioEngine,
  state: AudioEngineState,
  bins: Uint8Array,
  rod: RodSpec,
  elapsedSeconds: number,
  sensitivity: number,
): number {
  if (state.playing) {
    const hz = 45 * Math.pow(320, rod.radius / 15);
    const resolution = engine.sampleRate / engine.fftSize;
    const index = Math.max(
      1,
      Math.min(bins.length - 2, Math.round(hz / resolution)),
    );

    const normalized =
      (bins[index] + bins[index - 1] + bins[index + 1]) / 765;

    return Math.pow(normalized, 1.7) * sensitivity;
  }

  if (state.mode === "demo") {
    return (
      0.1 +
      0.2 *
        (0.5 +
          0.5 *
            Math.sin(
              rod.radius * 0.6 -
                elapsedSeconds * 0.7 +
                rod.gridX * 0.1,
            ))
    );
  }

  return 0;
}

export function smoothRodHeight(
  current: number,
  amplitude: number,
  smoothingPercent: number,
  deltaSeconds: number,
): number {
  const target = 0.07 + amplitude * 4.8;
  const smoothing = smoothingPercent / 100;
  const frameUnits = Math.min(deltaSeconds * 60, 3);
  const response = 1 - Math.pow(0.45 + smoothing * 0.53, frameUnits);

  return current + (target - current) * response;
}
