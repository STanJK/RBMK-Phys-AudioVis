import { useEffect, useRef } from "react";
import type { AudioEngine } from "../audio/AudioEngine";

interface ReactorVisualizerProps {
  engine: AudioEngine;
  sensitivity: number;
  smoothing: number;
  resetViewToken: number;
  onMetrics: (levelDb: number | null, peakHz: number | null) => void;
}

interface Rod {
  x: number;
  z: number;
  r: number;
  h: number;
  seed: number;
}

const rods: Rod[] = [];

for (let x = -15; x <= 15; x += 1) {
  for (let z = -15; z <= 15; z += 1) {
    const r = Math.hypot(x, z);
    if (r <= 15) {
      rods.push({
        x,
        z,
        r,
        h: 0,
        seed: Math.abs(Math.sin(x * 127.1 + z * 311.7)),
      });
    }
  }
}

export const REACTOR_CHANNEL_COUNT = rods.length;

export function ReactorVisualizer({
  engine,
  sensitivity,
  smoothing,
  resetViewToken,
  onMetrics,
}: ReactorVisualizerProps) {
  const coreRef = useRef<HTMLCanvasElement>(null);
  const sensitivityRef = useRef(sensitivity);
  const smoothingRef = useRef(smoothing);
  const metricsRef = useRef(onMetrics);
  const viewRef = useRef({ angle: -0.32, tilt: 0.58, zoom: 1 });

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  useEffect(() => {
    smoothingRef.current = smoothing;
  }, [smoothing]);

  useEffect(() => {
    metricsRef.current = onMetrics;
  }, [onMetrics]);

  useEffect(() => {
    viewRef.current = { angle: -0.32, tilt: 0.58, zoom: 1 };
  }, [resetViewToken]);

  useEffect(() => {
    const canvas = coreRef.current;
    const spectrum = document.getElementById("spectrum") as HTMLCanvasElement | null;
    if (!canvas || !spectrum) return;

    const g = canvas.getContext("2d");
    const sg = spectrum.getContext("2d");
    if (!g || !sg) return;

    const resizeCanvas = (target: HTMLCanvasElement) => {
      const rect = target.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      target.width = Math.round(rect.width * dpr);
      target.height = Math.round(rect.height * dpr);
      target.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas(canvas);
      resizeCanvas(spectrum);
    });

    resizeObserver.observe(canvas);
    resizeObserver.observe(spectrum);
    resizeCanvas(canvas);
    resizeCanvas(spectrum);

    let drag: { x: number; y: number } | null = null;
    let raf = 0;
    let lastFrame = 0;
    let lastMetrics = 0;

    const onPointerDown = (event: PointerEvent) => {
      drag = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drag) return;
      const view = viewRef.current;
      view.angle += (event.clientX - drag.x) * 0.006;
      view.tilt = Math.max(
        0.25,
        Math.min(0.85, view.tilt + (event.clientY - drag.y) * 0.002),
      );
      drag = { x: event.clientX, y: event.clientY };
    };

    const endDrag = () => {
      drag = null;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const view = viewRef.current;
      view.zoom = Math.max(0.65, Math.min(1.5, view.zoom - event.deltaY * 0.001));
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const frame = (time: number) => {
      const dt = Math.min((time - lastFrame) / 16.67, 3) || 1;
      lastFrame = time;

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const view = viewRef.current;
      const audioState = engine.getState();
      const bins = engine.readFrequencyData();
      const wave = engine.readWaveform();

      g.clearRect(0, 0, width, height);

      let peak = 0;
      let peakIndex = 0;
      if (audioState.playing) {
        for (let index = 0; index < bins.length; index += 1) {
          if (bins[index] > peak) {
            peak = bins[index];
            peakIndex = index;
          }
        }
      }

      let energy = 0;
      if (audioState.playing) {
        for (const value of wave) energy += value * value;
        energy = Math.sqrt(energy / wave.length);
      }

      const point = (x: number, z: number, h = 0): [number, number] => {
        const scale = Math.min(width / 45, height / 37) * view.zoom;
        const rx = x * Math.cos(view.angle) - z * Math.sin(view.angle);
        const rz = x * Math.sin(view.angle) + z * Math.cos(view.angle);
        return [
          width / 2 + rx * scale,
          height * 0.55 + rz * scale * view.tilt - h * scale,
        ];
      };

      const poly = (
        points: [number, number][],
        fill: string,
        stroke?: string,
      ) => {
        g.beginPath();
        points.forEach((p, index) => {
          if (index === 0) g.moveTo(...p);
          else g.lineTo(...p);
        });
        g.closePath();
        g.fillStyle = fill;
        g.fill();

        if (stroke) {
          g.strokeStyle = stroke;
          g.lineWidth = 0.55;
          g.stroke();
        }
      };

      const ring = (radius: number, color: string, ringWidth: number) => {
        g.beginPath();
        for (let index = 0; index <= 100; index += 1) {
          const angle = (index / 100) * Math.PI * 2;
          const p = point(Math.cos(angle) * radius, Math.sin(angle) * radius);
          if (index === 0) g.moveTo(...p);
          else g.lineTo(...p);
        }
        g.strokeStyle = color;
        g.lineWidth = ringWidth;
        g.stroke();
      };

      ring(16.4, "#060b07", 20);
      ring(16.5, "#505948", 2);
      ring(16, "#878969", 1);
      ring(17.3, "#303a2d", 1);

      for (let index = 0; index < 80; index += 1) {
        const angle = (index / 80) * Math.PI * 2;
        poly(
          [
            point(Math.cos(angle) * 15.7, Math.sin(angle) * 15.7),
            point(Math.cos(angle + 0.034) * 15.7, Math.sin(angle + 0.034) * 15.7),
            point(Math.cos(angle + 0.034) * 16.15, Math.sin(angle + 0.034) * 16.15),
            point(Math.cos(angle) * 16.15, Math.sin(angle) * 16.15),
          ],
          index % 2 ? "#484d31" : "#adac64",
        );
      }

      const sorted = [...rods].sort(
        (a, b) =>
          a.x * Math.sin(view.angle) +
          a.z * Math.cos(view.angle) -
          (b.x * Math.sin(view.angle) + b.z * Math.cos(view.angle)),
      );

      for (const rod of sorted) {
        let amp = 0;

        if (audioState.playing) {
          const hz = 45 * Math.pow(320, rod.r / 15);
          const resolution = engine.sampleRate / engine.fftSize;
          const index = Math.max(
            1,
            Math.min(bins.length - 2, Math.round(hz / resolution)),
          );

          amp = (bins[index] + bins[index - 1] + bins[index + 1]) / 765;
          amp = Math.pow(amp, 1.7) * sensitivityRef.current;
        } else if (audioState.mode === "demo") {
          amp =
            0.1 +
            0.2 *
              (0.5 +
                0.5 * Math.sin(rod.r * 0.6 - time * 0.0007 + rod.x * 0.1));
        }

        const target = 0.07 + amp * 4.8;
        const smooth = smoothingRef.current / 100;
        rod.h +=
          (target - rod.h) * (1 - Math.pow(0.45 + smooth * 0.53, dt));

        const scale = Math.min(width / 45, height / 37) * view.zoom;
        const a = point(rod.x - 0.44, rod.z - 0.44, rod.h);
        const b = point(rod.x + 0.44, rod.z - 0.44, rod.h);
        const c = point(rod.x + 0.44, rod.z + 0.44, rod.h);
        const d = point(rod.x - 0.44, rod.z + 0.44, rod.h);
        const a0 = point(rod.x - 0.44, rod.z - 0.44);
        const b0 = point(rod.x + 0.44, rod.z - 0.44);
        const c0 = point(rod.x + 0.44, rod.z + 0.44);
        const d0 = point(rod.x - 0.44, rod.z + 0.44);

        poly([a, a0, b0, b], "#424838", "#111910");
        poly(
          [b, b0, c0, c],
          `rgb(${55 + amp * 30},${62 + amp * 30},${44 + amp * 20})`,
          "#141b12",
        );
        poly([c, c0, d0, d], "#333c2b", "#131b11");
        poly([d, d0, a0, a], "#39432f", "#111910");

        const base =
          rod.seed > 0.92
            ? [143, 109, 81]
            : rod.seed > 0.85
              ? [97, 118, 104]
              : [
                  139 + rod.seed * 29,
                  148 + rod.seed * 22,
                  119 + rod.seed * 21,
                ];

        poly(
          [a, b, c, d],
          `rgb(${base[0] + amp * 43},${base[1] + amp * 40},${base[2] + amp * 24})`,
          "#232d20",
        );

        const p = point(rod.x, rod.z, rod.h + 0.01);
        g.beginPath();
        g.ellipse(p[0], p[1], scale * 0.12, scale * 0.12 * view.tilt, 0, 0, Math.PI * 2);
        g.fillStyle = "#404735";
        g.fill();

        if (scale > 13 && rod.seed > 0.6) {
          g.fillStyle = "#c3c7a3";
          g.fillRect(p[0] - scale * 0.3, p[1] - scale * 0.19, 1, 1);
        }
      }

      const spectrumWidth = spectrum.clientWidth;
      const spectrumHeight = spectrum.clientHeight;
      sg.clearRect(0, 0, spectrumWidth, spectrumHeight);

      for (let index = 0; index < 48; index += 1) {
        const binIndex = Math.min(
          bins.length - 1,
          Math.floor(Math.pow(index / 47, 2) * 700),
        );
        const value = audioState.playing ? bins[binIndex] / 255 : 0;
        sg.fillStyle = index < 12 ? "#d8b975" : index < 30 ? "#c3cf87" : "#95b1a1";
        const barHeight = Math.max(2, value * spectrumHeight);
        sg.fillRect(
          (index * spectrumWidth) / 48,
          spectrumHeight - barHeight,
          spectrumWidth / 48 - 3,
          barHeight,
        );
      }

      if (time - lastMetrics > 150) {
        lastMetrics = time;
        metricsRef.current(
          audioState.playing ? 20 * Math.log10(Math.max(energy, 0.001)) : null,
          audioState.playing && peak > 0
            ? peakIndex * (engine.sampleRate / engine.fftSize)
            : null,
        );
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("pointercancel", endDrag);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [engine]);

  return (
    <canvas
      ref={coreRef}
      id="core"
      aria-label="圆形控制棒阵列，随音频频谱起伏的三维可视化"
    />
  );
}
