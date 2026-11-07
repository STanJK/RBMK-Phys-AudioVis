import { useEffect, useRef } from "react";
import type { AudioEngine } from "../audio/AudioEngine";

interface SpectrumAnalyzerProps {
  engine: AudioEngine;
  onMetrics: (levelDb: number | null, peakHz: number | null) => void;
}

export function SpectrumAnalyzer({
  engine,
  onMetrics,
}: SpectrumAnalyzerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const metricsRef = useRef(onMetrics);

  useEffect(() => {
    metricsRef.current = onMetrics;
  }, [onMetrics]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let frameId = 0;
    let lastMetrics = 0;

    const frame = (time: number) => {
      const bins = engine.readFrequencyData();
      const wave = engine.readWaveform();
      const state = engine.getState();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      context.clearRect(0, 0, width, height);

      for (let index = 0; index < 48; index += 1) {
        const binIndex = Math.min(
          bins.length - 1,
          Math.floor(Math.pow(index / 47, 2) * 700),
        );
        const value = state.playing ? bins[binIndex] / 255 : 0;
        const barHeight = Math.max(2, value * height);

        context.fillStyle =
          index < 12 ? "#d8b975" : index < 30 ? "#c3cf87" : "#95b1a1";
        context.fillRect(
          (index * width) / 48,
          height - barHeight,
          width / 48 - 3,
          barHeight,
        );
      }

      if (time - lastMetrics >= 150) {
        lastMetrics = time;

        if (!state.playing) {
          metricsRef.current(null, null);
        } else {
          let energy = 0;
          for (const value of wave) energy += value * value;
          energy = Math.sqrt(energy / wave.length);

          let peak = 0;
          let peakIndex = 0;
          for (let index = 0; index < bins.length; index += 1) {
            if (bins[index] > peak) {
              peak = bins[index];
              peakIndex = index;
            }
          }

          metricsRef.current(
            20 * Math.log10(Math.max(energy, 0.001)),
            peak > 0
              ? peakIndex * (engine.sampleRate / engine.fftSize)
              : null,
          );
        }
      }

      frameId = requestAnimationFrame(frame);
    };

    frameId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [engine]);

  return <canvas ref={canvasRef} id="spectrum" aria-label="实时频谱" />;
}
