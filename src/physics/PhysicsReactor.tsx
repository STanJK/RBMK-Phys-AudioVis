import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import {
  Canvas,
  useFrame,
  useThree,
} from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  CuboidCollider,
  InstancedRigidBodies,
  TrimeshCollider,
  Physics,
  RigidBody,
  interactionGroups,
  useBeforePhysicsStep,
  useRapier,
  type InstancedRigidBodyProps,
  type RapierRigidBody,
} from "@react-three/rapier";
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  type InstancedMesh,
} from "three";
import type { AudioEngine } from "../audio/AudioEngine";
import {
  MAX_SENSITIVITY,
  sampleRodAmplitude,
  sampleRodBaseResponse,
  smoothRodHeight,
} from "../audio/rodResponse";
import {
  AZ5_MIN_LAUNCH_SPEED,
  AZ5_RAMP_SECONDS,
  CONTAINMENT_LOWER_WALL_HEIGHT,
  CONTAINMENT_WALL_HEIGHT,
  CONTAINMENT_WALL_RADIUS,
  CORE_TOP_Y,
  EXTERNAL_GRID_SPACING,
  EXTERNAL_GROUND_RADIUS,
  HEIGHT_LIMIT_Y,
  MAX_GUIDED_PROTRUSION,
  RANDOM_EJECTION_COOL_DELAY_SECONDS,
  RANDOM_EJECTION_COOL_DURATION_BIAS_SECONDS,
  RANDOM_EJECTION_COOL_DURATION_SECONDS,
  RANDOM_EJECTION_HEAT_SECONDS,
  RANDOM_EJECTION_INTERVAL_SECONDS,
  RANDOM_EJECTION_RECOVERY_COOL_SECONDS,
  RANDOM_EJECTION_RESPONSE_MAX,
  RANDOM_EJECTION_RESPONSE_MIN,
  RANDOM_EJECTION_UPWARD_MULTIPLIER,
  ROD_LAYOUT,
  ROD_LENGTH,
  ROD_WIDTH,
} from "../reactor/layout";

interface PhysicsReactorProps {
  engine: AudioEngine;
  sensitivity: number;
  smoothing: number;
  randomEjectionsEnabled: boolean;
  az5TriggerToken: number;
  resetViewToken: number;
  physicsEpoch: number;
}

interface ReactorSceneProps extends Omit<PhysicsReactorProps, "physicsEpoch"> {}

interface RodThermalState {
  phase: "heating" | "ejected" | "recovering";
  selectedAt: number;
  ejectAt: number;
  ejectedAt: number | null;
  landedAt: number | null;
  launchY: number | null;
  launchSpeed: number;
  predictedRise: number;
  recoverable: boolean;
  heatDuration: number;
  coolDuration: number;
}

const guidedRods = ROD_LAYOUT;

const WALL_SEGMENTS = 96;
const WALL_THICKNESS = 0.28;
const GRAVITY = 9.81;
const HEIGHT_LIMIT_HALF_SIZE = 18.4;
const HEIGHT_LIMIT_HALF_THICKNESS = 0.16;

const ROD_GUIDED_COLLISION_GROUPS = interactionGroups(0, [0]);
const ROD_RETURN_COLLISION_GROUPS = interactionGroups(0, [0, 1]);
const RETURN_FLOOR_COLLISION_GROUPS = interactionGroups(1, [0]);
const ROD_DISABLED_COLLISION_GROUPS = interactionGroups(15, []);

const MAX_REALTIME_COLLIDING_RODS = Math.floor(ROD_LAYOUT.length / 4);
const COLLISION_CULL_RADIUS =
  CONTAINMENT_WALL_RADIUS * 1.5;
const COLLISION_BUDGET_CHECK_SECONDS = 0.25;

const BEAT_VISUAL_BAR_INDICES = [2, 3] as const;
const BEAT_FEATURE_HZ = 30;
const BEAT_HISTORY_SECONDS = 6;
const BEAT_TEMPO_RECALC_SECONDS = 0.5;
const BEAT_MIN_BPM = 60;
const BEAT_MAX_BPM = 200;
const BEAT_PHASE_CORRECTION = 0.22;
const QUAKE_START_INTENSITY = 0.2;
const QUAKE_VERTICAL_AMPLITUDE = 1.15;
const QUAKE_LATERAL_AMPLITUDE = 0.275;
const QUAKE_DEFAULT_PULSE_SECONDS = 0.18;

const ROD_GREEN = new Color("#82956f");
const ROD_HOT = new Color("#d24f43");
const ROD_COLD_GRAY = new Color("#737876");

function randomGrayCoolDuration() {
  return Math.max(
    0.1,
    RANDOM_EJECTION_COOL_DURATION_SECONDS +
      (Math.random() * 2 - 1) *
        RANDOM_EJECTION_COOL_DURATION_BIAS_SECONDS,
  );
}

function spectrumBarToBin(index: number) {
  return Math.min(
    1023,
    Math.floor(Math.pow(index / 47, 2) * 700),
  );
}

function hzToBin(
  hz: number,
  sampleRate: number,
  fftSize: number,
  binCount: number,
) {
  return Math.max(
    1,
    Math.min(
      binCount - 1,
      Math.round(hz / (sampleRate / fftSize)),
    ),
  );
}

function positiveSpectralFlux(
  bins: Uint8Array,
  previous: Float32Array,
  start: number,
  end: number,
) {
  let flux = 0;
  const safeEnd = Math.min(end, bins.length - 1);
  const count = Math.max(1, safeEnd - start + 1);

  for (let index = start; index <= safeEnd; index += 1) {
    const current = bins[index] / 255;
    flux += Math.max(0, current - previous[index]);
  }

  return flux / count;
}

function estimateTempoFromOnsets(
  history: number[],
  currentBpm: number,
) {
  const minimumSamples = Math.round(BEAT_FEATURE_HZ * 2.5);
  if (history.length < minimumSamples) return null;

  const windowSize = Math.min(
    history.length,
    BEAT_FEATURE_HZ * BEAT_HISTORY_SECONDS,
  );
  const window = history.slice(-windowSize);
  const mean =
    window.reduce((sum, value) => sum + value, 0) /
    Math.max(1, window.length);
  const centered = window.map((value) =>
    Math.max(0, value - mean * 0.72),
  );

  const minimumLag = Math.max(
    2,
    Math.round((BEAT_FEATURE_HZ * 60) / BEAT_MAX_BPM),
  );
  const maximumLag = Math.min(
    centered.length - 2,
    Math.round((BEAT_FEATURE_HZ * 60) / BEAT_MIN_BPM),
  );

  let bestBpm = 0;
  let bestScore = 0;

  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    let numerator = 0;
    let energyA = 0;
    let energyB = 0;

    for (let index = lag; index < centered.length; index += 1) {
      const a = centered[index];
      const b = centered[index - lag];
      numerator += a * b;
      energyA += a * a;
      energyB += b * b;
    }

    const denominator = Math.sqrt(energyA * energyB);
    if (denominator <= 1e-9) continue;

    const bpm = (60 * BEAT_FEATURE_HZ) / lag;
    let score = numerator / denominator;

    const centerPreference = Math.exp(
      -Math.pow(Math.log2(bpm / 120), 2) / 0.7,
    );
    score *= 0.9 + centerPreference * 0.1;

    if (currentBpm > 0) {
      const continuity = Math.exp(
        -Math.abs(bpm - currentBpm) / 16,
      );
      score *= 0.88 + continuity * 0.12;
    }

    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }

  if (bestBpm <= 0 || bestScore < 0.08) return null;
  return { bpm: bestBpm, confidence: bestScore };
}

function CameraReset({ token }: { token: number }) {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(23, 17, 23);
    camera.lookAt(0, 1.2, 0);
    camera.updateProjectionMatrix();
  }, [camera, token]);

  return null;
}

function CylindricalContainmentWall({
  centerY,
  height,
}: {
  centerY: number;
  height: number;
}) {
  const colliders = useMemo(() => {
    const circumference =
      Math.PI * 2 * CONTAINMENT_WALL_RADIUS;
    const segmentLength =
      (circumference / WALL_SEGMENTS) * 1.18;

    return Array.from({ length: WALL_SEGMENTS }, (_, index) => {
      const angle = (index / WALL_SEGMENTS) * Math.PI * 2;

      return {
        key: index,
        position: [
          Math.cos(angle) * CONTAINMENT_WALL_RADIUS,
          centerY,
          Math.sin(angle) * CONTAINMENT_WALL_RADIUS,
        ] as [number, number, number],
        rotation: [
          0,
          -(angle + Math.PI / 2),
          0,
        ] as [number, number, number],
        segmentLength,
      };
    });
  }, [centerY, height]);

  return (
    <RigidBody type="fixed" colliders={false}>
      {colliders.map((segment) => (
        <CuboidCollider
          key={segment.key}
          args={[
            segment.segmentLength / 2,
            height / 2,
            WALL_THICKNESS / 2,
          ]}
          position={segment.position}
          rotation={segment.rotation}
          friction={0.74}
          restitution={0.12}
        />
      ))}
    </RigidBody>
  );
}

function LowerContainmentWall() {
  return (
    <CylindricalContainmentWall
      centerY={CORE_TOP_Y - CONTAINMENT_LOWER_WALL_HEIGHT / 2}
      height={CONTAINMENT_LOWER_WALL_HEIGHT}
    />
  );
}

function UpperContainmentWall() {
  return (
    <CylindricalContainmentWall
      centerY={CORE_TOP_Y + CONTAINMENT_WALL_HEIGHT / 2}
      height={CONTAINMENT_WALL_HEIGHT}
    />
  );
}

function buildExternalGroundCollider() {
  const segments = 192;
  const vertices = new Float32Array((segments + 1) * 2 * 3);
  const indices = new Uint32Array(segments * 6);

  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const vertexOffset = index * 6;

    vertices[vertexOffset] = cos * CONTAINMENT_WALL_RADIUS;
    vertices[vertexOffset + 1] = CORE_TOP_Y;
    vertices[vertexOffset + 2] = sin * CONTAINMENT_WALL_RADIUS;

    vertices[vertexOffset + 3] = cos * EXTERNAL_GROUND_RADIUS;
    vertices[vertexOffset + 4] = CORE_TOP_Y;
    vertices[vertexOffset + 5] = sin * EXTERNAL_GROUND_RADIUS;
  }

  for (let index = 0; index < segments; index += 1) {
    const inner = index * 2;
    const outer = inner + 1;
    const nextInner = inner + 2;
    const nextOuter = inner + 3;
    const triangleOffset = index * 6;

    indices[triangleOffset] = inner;
    indices[triangleOffset + 1] = nextOuter;
    indices[triangleOffset + 2] = outer;
    indices[triangleOffset + 3] = inner;
    indices[triangleOffset + 4] = nextInner;
    indices[triangleOffset + 5] = nextOuter;
  }

  return { vertices, indices };
}

function buildExternalGridGeometry() {
  const positions: number[] = [];
  const radius = EXTERNAL_GROUND_RADIUS;
  const innerRadius = CONTAINMENT_WALL_RADIUS;
  const spacing = EXTERNAL_GRID_SPACING;
  const limit = Math.floor(radius / spacing);

  const pushSegment = (
    x1: number,
    z1: number,
    x2: number,
    z2: number,
  ) => {
    const y = CORE_TOP_Y + 0.015;
    positions.push(x1, y, z1, x2, y, z2);
  };

  for (let step = -limit; step <= limit; step += 1) {
    const fixed = step * spacing;
    if (Math.abs(fixed) >= radius) continue;

    const outerSpan = Math.sqrt(
      Math.max(0, radius * radius - fixed * fixed),
    );

    if (Math.abs(fixed) < innerRadius) {
      const innerSpan = Math.sqrt(
        Math.max(
          0,
          innerRadius * innerRadius - fixed * fixed,
        ),
      );

      pushSegment(fixed, -outerSpan, fixed, -innerSpan);
      pushSegment(fixed, innerSpan, fixed, outerSpan);
      pushSegment(-outerSpan, fixed, -innerSpan, fixed);
      pushSegment(innerSpan, fixed, outerSpan, fixed);
    } else {
      pushSegment(fixed, -outerSpan, fixed, outerSpan);
      pushSegment(-outerSpan, fixed, outerSpan, fixed);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(positions, 3),
  );
  return geometry;
}

function GroundSystem({
  engine,
  az5TriggerToken,
}: {
  engine: AudioEngine;
  az5TriggerToken: number;
}) {
  const body = useRef<RapierRigidBody | null>(null);
  const collider = useMemo(() => buildExternalGroundCollider(), []);
  const gridGeometry = useMemo(() => buildExternalGridGeometry(), []);
  const elapsedSeconds = useRef(0);
  const lastAz5TriggerToken = useRef(az5TriggerToken);
  const quakeStartedAt = useRef<number | null>(null);

  const previousSpectrum = useRef(
    new Float32Array(engine.bins.length),
  );
  const onsetHistory = useRef<number[]>([]);
  const onsetMean = useRef(0);
  const onsetDeviation = useRef(0);
  const previousOnset = useRef(0);
  const previousPreviousOnset = useRef(0);
  const lastFeatureAt = useRef(-10);
  const lastTempoEstimateAt = useRef(-10);
  const lastStrongOnsetAt = useRef(-10);
  const bpm = useRef(0);
  const beatPeriod = useRef(0);
  const nextBeatAt = useRef<number | null>(null);

  const lastPulseAt = useRef(-10);
  const beatCount = useRef(0);
  const currentTranslation = useRef({ x: 0, y: 0, z: 0 });

  useEffect(() => () => gridGeometry.dispose(), [gridGeometry]);

  useEffect(() => {
    if (az5TriggerToken === lastAz5TriggerToken.current) return;
    lastAz5TriggerToken.current = az5TriggerToken;
    quakeStartedAt.current =
      az5TriggerToken > 0 ? elapsedSeconds.current : null;
  }, [az5TriggerToken]);

  useFrame(({ clock }, delta) => {
    const rb = body.current;
    if (!rb) return;

    const elapsed = clock.getElapsedTime();
    elapsedSeconds.current = elapsed;
    const state = engine.getState();

    if (
      state.playing &&
      elapsed - lastFeatureAt.current >= 1 / BEAT_FEATURE_HZ
    ) {
      lastFeatureAt.current = elapsed;

      const bins = engine.readFrequencyData();
      const previous = previousSpectrum.current;
      const sampleRate = engine.sampleRate;
      const fftSize = engine.fftSize;

      const lowStart = hzToBin(
        35,
        sampleRate,
        fftSize,
        bins.length,
      );
      const lowEnd = hzToBin(
        180,
        sampleRate,
        fftSize,
        bins.length,
      );
      const midStart = hzToBin(
        180,
        sampleRate,
        fftSize,
        bins.length,
      );
      const midEnd = hzToBin(
        2000,
        sampleRate,
        fftSize,
        bins.length,
      );
      const fullEnd = hzToBin(
        8000,
        sampleRate,
        fftSize,
        bins.length,
      );

      const lowFlux = positiveSpectralFlux(
        bins,
        previous,
        lowStart,
        lowEnd,
      );
      const midFlux = positiveSpectralFlux(
        bins,
        previous,
        midStart,
        midEnd,
      );
      const fullFlux = positiveSpectralFlux(
        bins,
        previous,
        lowStart,
        fullEnd,
      );

      let kickFlux = 0;
      for (const visualIndex of BEAT_VISUAL_BAR_INDICES) {
        const binIndex = spectrumBarToBin(visualIndex);
        const current = bins[binIndex] / 255;
        kickFlux += Math.max(
          0,
          current - previous[binIndex],
        );
      }
      kickFlux /= BEAT_VISUAL_BAR_INDICES.length;

      const onset =
        lowFlux * 0.4 +
        midFlux * 0.25 +
        fullFlux * 0.2 +
        kickFlux * 0.15;

      for (let index = 0; index <= fullEnd; index += 1) {
        previous[index] = bins[index] / 255;
      }

      const baselineAlpha = 0.045;
      onsetMean.current +=
        (onset - onsetMean.current) * baselineAlpha;
      onsetDeviation.current +=
        (Math.abs(onset - onsetMean.current) -
          onsetDeviation.current) *
        baselineAlpha;

      onsetHistory.current.push(onset);
      const maximumHistory = Math.round(
        BEAT_FEATURE_HZ * BEAT_HISTORY_SECONDS,
      );
      if (onsetHistory.current.length > maximumHistory) {
        onsetHistory.current.splice(
          0,
          onsetHistory.current.length - maximumHistory,
        );
      }

      const peakTime = elapsed - 1 / BEAT_FEATURE_HZ;
      const localPeak =
        previousOnset.current >
          previousPreviousOnset.current &&
        previousOnset.current >= onset;
      const onsetThreshold =
        onsetMean.current +
        Math.max(0.0025, onsetDeviation.current * 1.25);
      const strongOnset =
        localPeak &&
        previousOnset.current > onsetThreshold &&
        peakTime - lastStrongOnsetAt.current >= 0.16;

      if (strongOnset) {
        lastStrongOnsetAt.current = peakTime;

        if (
          beatPeriod.current > 0 &&
          nextBeatAt.current !== null
        ) {
          const period = beatPeriod.current;
          const nearestBeat =
            nextBeatAt.current +
            Math.round(
              (peakTime - nextBeatAt.current) / period,
            ) *
              period;
          const phaseError = peakTime - nearestBeat;

          if (Math.abs(phaseError) <= period * 0.3) {
            nextBeatAt.current +=
              phaseError * BEAT_PHASE_CORRECTION;
          }
        } else {
          lastPulseAt.current = peakTime;
          beatCount.current += 1;
        }
      }

      previousPreviousOnset.current = previousOnset.current;
      previousOnset.current = onset;

      if (
        elapsed - lastTempoEstimateAt.current >=
        BEAT_TEMPO_RECALC_SECONDS
      ) {
        lastTempoEstimateAt.current = elapsed;
        const estimate = estimateTempoFromOnsets(
          onsetHistory.current,
          bpm.current,
        );

        if (estimate) {
          const newBpm =
            bpm.current > 0
              ? bpm.current * 0.72 + estimate.bpm * 0.28
              : estimate.bpm;
          bpm.current = newBpm;
          beatPeriod.current = 60 / newBpm;

          if (nextBeatAt.current === null) {
            const anchor =
              elapsed - lastStrongOnsetAt.current <= 1.5
                ? lastStrongOnsetAt.current
                : elapsed;
            let next =
              anchor + beatPeriod.current;

            while (next <= elapsed) {
              next += beatPeriod.current;
            }
            nextBeatAt.current = next;
          }
        }
      }
    }

    if (!state.playing) {
      previousSpectrum.current.fill(0);
      onsetHistory.current = [];
      onsetMean.current = 0;
      onsetDeviation.current = 0;
      previousOnset.current = 0;
      previousPreviousOnset.current = 0;
      bpm.current = 0;
      beatPeriod.current = 0;
      nextBeatAt.current = null;
      lastStrongOnsetAt.current = -10;
    } else if (
      beatPeriod.current > 0 &&
      nextBeatAt.current !== null
    ) {
      let guard = 0;
      while (
        elapsed >= nextBeatAt.current &&
        guard < 4
      ) {
        lastPulseAt.current = nextBeatAt.current;
        beatCount.current += 1;
        nextBeatAt.current += beatPeriod.current;
        guard += 1;
      }
    }

    let targetX = 0;
    let targetY = 0;
    let targetZ = 0;

    if (quakeStartedAt.current !== null && state.playing) {
      const ramp = Math.min(
        1,
        Math.max(
          0,
          (elapsed - quakeStartedAt.current) / AZ5_RAMP_SECONDS,
        ),
      );
      const intensity =
        QUAKE_START_INTENSITY +
        (1 - QUAKE_START_INTENSITY) * ramp;

      const detectedPeriod = beatPeriod.current;
      const pulseSeconds = detectedPeriod
        ? Math.min(
            0.24,
            Math.max(0.12, detectedPeriod * 0.32),
          )
        : QUAKE_DEFAULT_PULSE_SECONDS;

      const pulseAge = elapsed - lastPulseAt.current;
      const pulse =
        pulseAge >= 0 && pulseAge < pulseSeconds
          ? Math.pow(1 - pulseAge / pulseSeconds, 2)
          : 0;

      if (pulse > 0) {
        const direction =
          beatCount.current * 2.399963229728653;
        targetY =
          QUAKE_VERTICAL_AMPLITUDE * intensity * pulse;
        targetX =
          Math.sin(direction) *
          QUAKE_LATERAL_AMPLITUDE *
          intensity *
          pulse;
        targetZ =
          Math.cos(direction) *
          QUAKE_LATERAL_AMPLITUDE *
          intensity *
          pulse;
      }
    }

    const settle = 1 - Math.exp(-delta * 18);
    currentTranslation.current.x +=
      (targetX - currentTranslation.current.x) * settle;
    currentTranslation.current.y +=
      (targetY - currentTranslation.current.y) * settle;
    currentTranslation.current.z +=
      (targetZ - currentTranslation.current.z) * settle;

    rb.setNextKinematicTranslation(currentTranslation.current);
  });

  return (
    <RigidBody
      ref={body}
      type="kinematicPosition"
      colliders={false}
      position={[0, 0, 0]}
    >
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, CORE_TOP_Y - 0.012, 0]}
      >
        <ringGeometry
          args={[
            CONTAINMENT_WALL_RADIUS,
            EXTERNAL_GROUND_RADIUS,
            192,
          ]}
        />
        <meshStandardMaterial
          color="#202522"
          roughness={0.96}
          metalness={0.04}
        />
      </mesh>

      <lineSegments geometry={gridGeometry}>
        <lineBasicMaterial
          color="#555d58"
          transparent
          opacity={0.72}
        />
      </lineSegments>

      <TrimeshCollider
        args={[collider.vertices, collider.indices]}
        friction={0.9}
        restitution={0.08}
      />

      <CuboidCollider
        args={[
          EXTERNAL_GROUND_RADIUS,
          0.75,
          EXTERNAL_GROUND_RADIUS,
        ]}
        position={[0, CORE_TOP_Y - 0.75, 0]}
        collisionGroups={RETURN_FLOOR_COLLISION_GROUPS}
        friction={0.9}
        restitution={0.08}
      />
    </RigidBody>
  );
}

function HeightLimitPlate() {
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider
        args={[
          HEIGHT_LIMIT_HALF_SIZE,
          HEIGHT_LIMIT_HALF_THICKNESS,
          HEIGHT_LIMIT_HALF_SIZE,
        ]}
        position={[0, HEIGHT_LIMIT_Y, 0]}
        friction={0.72}
        restitution={0.22}
      />
    </RigidBody>
  );
}

function CoreBase({
  upperWallEnabled,
}: {
  upperWallEnabled: boolean;
}) {
  return (
    <>
      <mesh receiveShadow position={[0, CORE_TOP_Y - 0.25, 0]}>
        <cylinderGeometry args={[16.9, 16.9, 0.5, 96]} />
        <meshStandardMaterial
          color="#222820"
          roughness={0.92}
          metalness={0.12}
        />
      </mesh>

      <mesh
        receiveShadow
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, CORE_TOP_Y, 0]}
      >
        <torusGeometry args={[16.2, 0.42, 12, 96]} />
        <meshStandardMaterial
          color="#5b6046"
          roughness={0.78}
          metalness={0.3}
        />
      </mesh>

      <LowerContainmentWall />
      {upperWallEnabled && <UpperContainmentWall />}
      <HeightLimitPlate />
    </>
  );
}

function GuidedRodField({
  engine,
  sensitivity,
  smoothing,
  randomEjectionsEnabled,
  az5TriggerToken,
}: Pick<
  ReactorSceneProps,
  | "engine"
  | "sensitivity"
  | "smoothing"
  | "randomEjectionsEnabled"
  | "az5TriggerToken"
>) {
  const rigidBodies = useRef<RapierRigidBody[]>([]);
  const mesh = useRef<InstancedMesh | null>(null);
  const heights = useRef<Float32Array>(
    new Float32Array(guidedRods.length).fill(0.07),
  );
  const verticalVelocities = useRef<Float32Array>(
    new Float32Array(guidedRods.length),
  );
  const baseResponses = useRef<Float32Array>(
    new Float32Array(guidedRods.length),
  );
  const detachedIndices = useRef<Set<number>>(new Set());
  const surfaceClearedIndices = useRef<Set<number>>(new Set());
  const collisionDisabledIndices = useRef<Set<number>>(new Set());
  const nextCollisionBudgetCheckAt = useRef(0);
  const thermalStates = useRef<Array<RodThermalState | null>>(
    Array.from({ length: guidedRods.length }, () => null),
  );
  const pendingEjection = useRef<number | null>(null);
  const nextRandomEjectionAt = useRef<number | null>(null);
  const az5EjectAt = useRef<number | null>(null);
  const az5StartAt = useRef<number | null>(null);
  const az5StartSensitivity = useRef(sensitivity);
  const lastAz5TriggerToken = useRef(az5TriggerToken);
  const elapsedSeconds = useRef(0);
  const scratchColor = useMemo(() => new Color(), []);
  const { rapier } = useRapier();

  const instances = useMemo<InstancedRigidBodyProps[]>(
    () =>
      guidedRods.map((rod) => ({
        key: `rod-${rod.channel}`,
        position: [
          rod.x,
          CORE_TOP_Y + 0.07 - ROD_LENGTH / 2,
          rod.z,
        ],
      })),
    [],
  );

  useLayoutEffect(() => {
    const colorMesh = mesh.current;
    if (!colorMesh) return;

    for (let index = 0; index < guidedRods.length; index += 1) {
      colorMesh.setColorAt(index, ROD_GREEN);
    }

    if (colorMesh.instanceColor) {
      colorMesh.instanceColor.needsUpdate = true;
    }
  }, []);

  useEffect(() => {
    if (az5TriggerToken === lastAz5TriggerToken.current) return;

    lastAz5TriggerToken.current = az5TriggerToken;
    const now = elapsedSeconds.current;
    const ejectAt = now + AZ5_RAMP_SECONDS;

    pendingEjection.current = null;
    nextRandomEjectionAt.current = ejectAt + RANDOM_EJECTION_INTERVAL_SECONDS;
    az5StartAt.current = now;
    az5StartSensitivity.current = sensitivity;
    az5EjectAt.current = ejectAt;

    for (let index = 0; index < guidedRods.length; index += 1) {
      thermalStates.current[index] = {
        phase: "heating",
        selectedAt: now,
        ejectAt,
        ejectedAt: null,
        landedAt: null,
        launchY: null,
        launchSpeed: AZ5_MIN_LAUNCH_SPEED,
        predictedRise: Number.POSITIVE_INFINITY,
        recoverable: false,
        heatDuration: AZ5_RAMP_SECONDS,
        coolDuration: randomGrayCoolDuration(),
      };
    }
  }, [az5TriggerToken, sensitivity]);

  useEffect(() => {
    nextRandomEjectionAt.current = null;

    if (!randomEjectionsEnabled && pendingEjection.current !== null) {
      const index = pendingEjection.current;
      const thermal = thermalStates.current[index];
      if (thermal?.phase === "heating") {
        thermalStates.current[index] = null;
      }
      pendingEjection.current = null;
    }
  }, [randomEjectionsEnabled]);

  const enableReturnFloorCollision = (rb: RapierRigidBody) => {
    for (
      let colliderIndex = 0;
      colliderIndex < rb.numColliders();
      colliderIndex += 1
    ) {
      rb.collider(colliderIndex).setCollisionGroups(
        ROD_RETURN_COLLISION_GROUPS,
      );
    }
  };

  const disableRodCollisions = (
    index: number,
    rb: RapierRigidBody,
  ) => {
    if (collisionDisabledIndices.current.has(index)) return;

    for (
      let colliderIndex = 0;
      colliderIndex < rb.numColliders();
      colliderIndex += 1
    ) {
      rb.collider(colliderIndex).setCollisionGroups(
        ROD_DISABLED_COLLISION_GROUPS,
      );
    }

    rb.enableCcd(false);
    collisionDisabledIndices.current.add(index);
  };

  const enforceCollisionBudget = (
    bodies: RapierRigidBody[],
    elapsed: number,
  ) => {
    if (elapsed < nextCollisionBudgetCheckAt.current) return;

    nextCollisionBudgetCheckAt.current =
      elapsed + COLLISION_BUDGET_CHECK_SECONDS;

    let collidableDynamicCount = 0;
    const farCandidates: number[] = [];

    for (
      let index = 0;
      index < guidedRods.length && index < bodies.length;
      index += 1
    ) {
      if (
        !detachedIndices.current.has(index) ||
        collisionDisabledIndices.current.has(index)
      ) {
        continue;
      }

      const rb = bodies[index];
      if (!rb || !rb.isDynamic()) continue;

      collidableDynamicCount += 1;

      const translation = rb.translation();
      const radialDistance = Math.hypot(
        translation.x,
        translation.z,
      );

      if (radialDistance > COLLISION_CULL_RADIUS) {
        farCandidates.push(index);
      }
    }

    let excess =
      collidableDynamicCount - MAX_REALTIME_COLLIDING_RODS;

    while (excess > 0 && farCandidates.length > 0) {
      const pick = Math.floor(
        Math.random() * farCandidates.length,
      );
      const index = farCandidates[pick];
      const last = farCandidates.pop()!;

      if (pick < farCandidates.length) {
        farCandidates[pick] = last;
      }

      const rb = bodies[index];
      if (!rb) continue;

      disableRodCollisions(index, rb);
      excess -= 1;
    }
  };

  useFrame(({ clock }, delta) => {
    const bodies = rigidBodies.current;
    if (!bodies || bodies.length === 0) return;

    const bins = engine.readFrequencyData();
    const state = engine.getState();
    const elapsed = clock.getElapsedTime();
    elapsedSeconds.current = elapsed;
    const safeDelta = Math.max(delta, 1 / 240);

    enforceCollisionBudget(bodies, elapsed);

    for (
      let index = 0;
      index < guidedRods.length && index < bodies.length;
      index += 1
    ) {
      const thermal = thermalStates.current[index];
      const rb = bodies[index];
      const rod = guidedRods[index];

      if (
        rb &&
        detachedIndices.current.has(index) &&
        !surfaceClearedIndices.current.has(index)
      ) {
        const translation = rb.translation();
        const bottomY = translation.y - ROD_LENGTH / 2;

        if (bottomY >= CORE_TOP_Y + 0.01) {
          surfaceClearedIndices.current.add(index);

          if (!collisionDisabledIndices.current.has(index)) {
            enableReturnFloorCollision(rb);
          }

          if (thermal) {
            thermal.recoverable = false;
          }
        }
      }

      if (thermal?.phase === "ejected" && thermal.recoverable && rb) {
        const translation = rb.translation();
        const velocity = rb.linvel();

        rb.setTranslation(
          {
            x: rod.x,
            y: translation.y,
            z: rod.z,
          },
          true,
        );
        rb.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        rb.setLinvel({ x: 0, y: velocity.y, z: 0 }, true);
        rb.setAngvel({ x: 0, y: 0, z: 0 }, true);

        if (
          thermal.launchY !== null &&
          thermal.ejectedAt !== null &&
          elapsed - thermal.ejectedAt > 0.08 &&
          translation.y <= thermal.launchY &&
          velocity.y <= 0
        ) {
          rb.setTranslation(
            { x: rod.x, y: thermal.launchY, z: rod.z },
            true,
          );
          rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
          rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
          rb.setBodyType(
            rapier.RigidBodyType.KinematicPositionBased,
            true,
          );
          rb.enableCcd(false);
          collisionDisabledIndices.current.delete(index);

          for (
            let colliderIndex = 0;
            colliderIndex < rb.numColliders();
            colliderIndex += 1
          ) {
            rb.collider(colliderIndex).setCollisionGroups(
              ROD_GUIDED_COLLISION_GROUPS,
            );
          }
          detachedIndices.current.delete(index);
          thermal.phase = "recovering";
          thermal.landedAt = elapsed;
        }
      }

      if (detachedIndices.current.has(index)) continue;

      const baseResponse = sampleRodBaseResponse(
        engine,
        state,
        bins,
        rod,
        elapsed,
      );
      baseResponses.current[index] = baseResponse;

      const az5Active =
        az5StartAt.current !== null &&
        az5EjectAt.current !== null &&
        elapsed < az5EjectAt.current;

      const az5Progress = az5Active
        ? Math.min(
            1,
            Math.max(
              0,
              (elapsed - az5StartAt.current!) / AZ5_RAMP_SECONDS,
            ),
          )
        : 0;

      const effectiveSensitivity = az5Active
        ? az5StartSensitivity.current +
          (MAX_SENSITIVITY - az5StartSensitivity.current) * az5Progress
        : sensitivity;

      const amplitude = state.playing
        ? baseResponse * effectiveSensitivity
        : sampleRodAmplitude(
            engine,
            state,
            bins,
            rod,
            elapsed,
            effectiveSensitivity,
          );

      const previousHeight = heights.current[index];
      const smoothedHeight = smoothRodHeight(
        previousHeight,
        amplitude,
        smoothing,
        delta,
      );
      const nextHeight = az5Active
        ? smoothedHeight
        : Math.min(MAX_GUIDED_PROTRUSION, smoothedHeight);

      heights.current[index] = nextHeight;
      verticalVelocities.current[index] =
        (nextHeight - previousHeight) / safeDelta;

      rb?.setNextKinematicTranslation({
        x: rod.x,
        y: CORE_TOP_Y + nextHeight - ROD_LENGTH / 2,
        z: rod.z,
      });
    }

    const colorMesh = mesh.current;
    if (colorMesh) {
      for (let index = 0; index < guidedRods.length; index += 1) {
        const thermal = thermalStates.current[index];

        if (!thermal) {
          scratchColor.copy(ROD_GREEN);
        } else if (thermal.phase === "heating") {
          const progress = Math.min(
            1,
            Math.max(
              0,
              (elapsed - thermal.selectedAt) /
                thermal.heatDuration,
            ),
          );
          scratchColor.copy(ROD_GREEN).lerp(ROD_HOT, progress);
        } else if (thermal.phase === "recovering") {
          const landedAt = thermal.landedAt ?? elapsed;
          const progress = Math.min(
            1,
            Math.max(
              0,
              (elapsed - landedAt) /
                RANDOM_EJECTION_RECOVERY_COOL_SECONDS,
            ),
          );
          scratchColor.copy(ROD_HOT).lerp(ROD_GREEN, progress);

          if (progress >= 1) {
            thermalStates.current[index] = null;
          }
        } else if (thermal.recoverable) {
          scratchColor.copy(ROD_HOT);
        } else {
          const ejectedAt = thermal.ejectedAt ?? elapsed;
          const coolingElapsed =
            elapsed -
            ejectedAt -
            RANDOM_EJECTION_COOL_DELAY_SECONDS;

          if (coolingElapsed <= 0) {
            scratchColor.copy(ROD_HOT);
          } else {
            const progress = Math.min(
              1,
              coolingElapsed / thermal.coolDuration,
            );
            scratchColor.copy(ROD_HOT).lerp(ROD_COLD_GRAY, progress);
          }
        }

        colorMesh.setColorAt(index, scratchColor);
      }

      if (colorMesh.instanceColor) {
        colorMesh.instanceColor.needsUpdate = true;
      }
    }

    if (!randomEjectionsEnabled || !state.playing) {
      nextRandomEjectionAt.current =
        elapsed + RANDOM_EJECTION_INTERVAL_SECONDS;
      return;
    }

    if (nextRandomEjectionAt.current === null) {
      nextRandomEjectionAt.current =
        elapsed + RANDOM_EJECTION_INTERVAL_SECONDS;
      return;
    }

    if (
      elapsed < nextRandomEjectionAt.current ||
      pendingEjection.current !== null
    ) {
      return;
    }

    nextRandomEjectionAt.current =
      elapsed + RANDOM_EJECTION_INTERVAL_SECONDS;

    const minimumGlobalResponse =
      MAX_SENSITIVITY * RANDOM_EJECTION_RESPONSE_MIN;
    const maximumGlobalResponse =
      MAX_SENSITIVITY * RANDOM_EJECTION_RESPONSE_MAX;
    const candidates: number[] = [];

    for (
      let index = 0;
      index < guidedRods.length && index < bodies.length;
      index += 1
    ) {
      if (
        detachedIndices.current.has(index) ||
        thermalStates.current[index] !== null
      ) {
        continue;
      }

      const globalResponse =
        baseResponses.current[index] * MAX_SENSITIVITY;

      if (
        globalResponse >= minimumGlobalResponse &&
        globalResponse <= maximumGlobalResponse &&
        verticalVelocities.current[index] > 0
      ) {
        candidates.push(index);
      }
    }

    if (candidates.length === 0) return;

    const index =
      candidates[Math.floor(Math.random() * candidates.length)];
    const launchSpeed =
      Math.max(0, verticalVelocities.current[index]) *
      RANDOM_EJECTION_UPWARD_MULTIPLIER;
    const predictedRise =
      (launchSpeed * launchSpeed) / (2 * GRAVITY);

    thermalStates.current[index] = {
      phase: "heating",
      selectedAt: elapsed,
      ejectAt: elapsed + RANDOM_EJECTION_HEAT_SECONDS,
      ejectedAt: null,
      landedAt: null,
      launchY: null,
      launchSpeed,
      predictedRise,
      recoverable: predictedRise <= ROD_LENGTH,
      heatDuration: RANDOM_EJECTION_HEAT_SECONDS,
      coolDuration: randomGrayCoolDuration(),
    };
    pendingEjection.current = index;
  });

  useBeforePhysicsStep(() => {
    const ejectAt = az5EjectAt.current;
    if (ejectAt === null || elapsedSeconds.current < ejectAt) return;

    az5EjectAt.current = null;
    az5StartAt.current = null;

    for (
      let index = 0;
      index < guidedRods.length && index < rigidBodies.current.length;
      index += 1
    ) {
      const rb = rigidBodies.current[index];
      const rod = guidedRods[index];
      const thermal = thermalStates.current[index];

      if (!rb || !rod || !thermal) continue;

      if (!detachedIndices.current.has(index)) {
        rb.setTranslation(
          {
            x: rod.x,
            y: CORE_TOP_Y + heights.current[index] - ROD_LENGTH / 2,
            z: rod.z,
          },
          true,
        );
      }

      detachedIndices.current.add(index);
      rb.setBodyType(rapier.RigidBodyType.Dynamic, true);
      rb.recomputeMassPropertiesFromColliders();
      rb.enableCcd(true);
      rb.resetForces(true);
      rb.resetTorques(true);
      const launchSpeed = Math.max(
        AZ5_MIN_LAUNCH_SPEED,
        Math.max(0, verticalVelocities.current[index]) *
          RANDOM_EJECTION_UPWARD_MULTIPLIER,
      );

      rb.setLinvel({ x: 0, y: launchSpeed, z: 0 }, true);
      rb.setAngvel(
        {
          x: (Math.random() - 0.5) * 1.8,
          y: (Math.random() - 0.5) * 0.5,
          z: (Math.random() - 0.5) * 1.8,
        },
        true,
      );

      thermal.phase = "ejected";
      thermal.ejectedAt = elapsedSeconds.current;
      thermal.launchY = rb.translation().y;
      thermal.launchSpeed = launchSpeed;
      thermal.predictedRise =
        (launchSpeed * launchSpeed) / (2 * GRAVITY);
      thermal.recoverable = false;

      rb.wakeUp();
    }
  });

  useBeforePhysicsStep(() => {
    const index = pendingEjection.current;
    if (index === null) return;

    const thermal = thermalStates.current[index];
    if (
      !thermal ||
      thermal.phase !== "heating" ||
      elapsedSeconds.current < thermal.ejectAt
    ) {
      return;
    }

    pendingEjection.current = null;

    if (detachedIndices.current.has(index)) return;

    const rb = rigidBodies.current[index];
    const rod = guidedRods[index];
    if (!rb || !rod) return;

    const launchY =
      CORE_TOP_Y +
      heights.current[index] -
      ROD_LENGTH / 2;

    detachedIndices.current.add(index);

    rb.setTranslation(
      {
        x: rod.x,
        y: launchY,
        z: rod.z,
      },
      true,
    );
    rb.setBodyType(rapier.RigidBodyType.Dynamic, true);
    rb.recomputeMassPropertiesFromColliders();
    rb.enableCcd(true);
    rb.resetForces(true);
    rb.resetTorques(true);

    rb.setLinvel(
      {
        x: 0,
        y: thermal.launchSpeed,
        z: 0,
      },
      true,
    );

    rb.setAngvel(
      thermal.recoverable
        ? { x: 0, y: 0, z: 0 }
        : {
            x: (Math.random() - 0.5) * 1.6,
            y: (Math.random() - 0.5) * 0.35,
            z: (Math.random() - 0.5) * 1.6,
          },
      true,
    );

    thermal.phase = "ejected";
    thermal.ejectedAt = elapsedSeconds.current;
    thermal.launchY = launchY;

    rb.wakeUp();
  });

  return (
    <InstancedRigidBodies
      ref={rigidBodies}
      type="kinematicPosition"
      instances={instances}
      colliders="cuboid"
      collisionGroups={ROD_GUIDED_COLLISION_GROUPS}
      friction={0.72}
      restitution={0.12}
    >
      <instancedMesh
        ref={mesh}
        args={[undefined, undefined, guidedRods.length]}
        count={guidedRods.length}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <boxGeometry args={[ROD_WIDTH, ROD_LENGTH, ROD_WIDTH]} />
        <meshStandardMaterial
          color="#ffffff"
          roughness={0.72}
          metalness={0.22}
        />
      </instancedMesh>
    </InstancedRigidBodies>
  );
}

function ReactorScene({
  engine,
  sensitivity,
  smoothing,
  randomEjectionsEnabled,
  az5TriggerToken,
  resetViewToken,
}: ReactorSceneProps) {
  return (
    <>
      <color attach="background" args={["#0c100d"]} />
      <fog attach="fog" args={["#0c100d", 68, 140]} />

      <ambientLight intensity={0.78} />
      <directionalLight
        castShadow
        position={[13, 26, 11]}
        intensity={2.1}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-EXTERNAL_GROUND_RADIUS - 8}
        shadow-camera-right={EXTERNAL_GROUND_RADIUS + 8}
        shadow-camera-top={EXTERNAL_GROUND_RADIUS + 8}
        shadow-camera-bottom={-EXTERNAL_GROUND_RADIUS - 8}
        shadow-camera-near={1}
        shadow-camera-far={260}
        shadow-bias={-0.00025}
        shadow-normalBias={0.025}
      />
      <pointLight
        position={[-11, 10, -8]}
        intensity={24}
        distance={40}
      />

      <Suspense fallback={null}>
        <Physics gravity={[0, -GRAVITY, 0]} colliders={false}>
          <CoreBase upperWallEnabled={az5TriggerToken === 0} />
          <GroundSystem
            engine={engine}
            az5TriggerToken={az5TriggerToken}
          />
          <GuidedRodField
            engine={engine}
            sensitivity={sensitivity}
            smoothing={smoothing}
            randomEjectionsEnabled={randomEjectionsEnabled}
            az5TriggerToken={az5TriggerToken}
          />
        </Physics>
      </Suspense>

      <CameraReset token={resetViewToken} />
      <OrbitControls
        makeDefault
        target={[0, 1.2, 0]}
        minDistance={18}
        maxDistance={58}
        maxPolarAngle={Math.PI * 0.49}
      />

    </>
  );
}

export function PhysicsReactor({
  physicsEpoch,
  ...sceneProps
}: PhysicsReactorProps) {
  return (
    <div className="three-core">
      <Canvas
        key={physicsEpoch}
        shadows
        dpr={[1, 1.6]}
        camera={{
          position: [23, 17, 23],
          fov: 38,
          near: 0.1,
          far: 240,
        }}
      >
        <ReactorScene {...sceneProps} />
      </Canvas>
    </div>
  );
}
