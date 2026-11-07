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
  Physics,
  RigidBody,
  useBeforePhysicsStep,
  useRapier,
  type InstancedRigidBodyProps,
  type RapierRigidBody,
} from "@react-three/rapier";
import { Color, type InstancedMesh } from "three";
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
  CONTAINMENT_WALL_HEIGHT,
  CONTAINMENT_WALL_RADIUS,
  CORE_TOP_Y,
  HEIGHT_LIMIT_Y,
  MAX_GUIDED_PROTRUSION,
  RANDOM_EJECTION_COOL_DELAY_SECONDS,
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
  onRandomEjection?: (channel: number) => void;
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
}

const guidedRods = ROD_LAYOUT;

const WALL_SEGMENTS = 96;
const WALL_THICKNESS = 0.28;
const GRAVITY = 9.81;
const HEIGHT_LIMIT_HALF_SIZE = 18.4;
const HEIGHT_LIMIT_HALF_THICKNESS = 0.16;

const ROD_GREEN = new Color("#82956f");
const ROD_HOT = new Color("#d24f43");
const ROD_COLD_GRAY = new Color("#737876");

function CameraReset({ token }: { token: number }) {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(23, 17, 23);
    camera.lookAt(0, 1.2, 0);
    camera.updateProjectionMatrix();
  }, [camera, token]);

  return null;
}

function ContainmentWall() {
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
          CORE_TOP_Y + CONTAINMENT_WALL_HEIGHT / 2,
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
  }, []);

  return (
    <RigidBody type="fixed" colliders={false}>
      {colliders.map((segment) => (
        <CuboidCollider
          key={segment.key}
          args={[
            segment.segmentLength / 2,
            CONTAINMENT_WALL_HEIGHT / 2,
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

function CoreBase() {
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

      <ContainmentWall />
      <HeightLimitPlate />

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[18, 0.25, 18]}
          position={[0, CORE_TOP_Y - ROD_LENGTH - 1.25, 0]}
          friction={0.9}
          restitution={0.06}
        />
      </RigidBody>
    </>
  );
}

function GuidedRodField({
  engine,
  sensitivity,
  smoothing,
  randomEjectionsEnabled,
  az5TriggerToken,
  onRandomEjection,
}: Pick<
  ReactorSceneProps,
  | "engine"
  | "sensitivity"
  | "smoothing"
  | "randomEjectionsEnabled"
  | "az5TriggerToken"
  | "onRandomEjection"
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

  useFrame(({ clock }, delta) => {
    const bodies = rigidBodies.current;
    if (!bodies || bodies.length === 0) return;

    const bins = engine.readFrequencyData();
    const state = engine.getState();
    const elapsed = clock.getElapsedTime();
    elapsedSeconds.current = elapsed;
    const safeDelta = Math.max(delta, 1 / 240);

    for (
      let index = 0;
      index < guidedRods.length && index < bodies.length;
      index += 1
    ) {
      const thermal = thermalStates.current[index];
      const rb = bodies[index];
      const rod = guidedRods[index];

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
          rb.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
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
              coolingElapsed /
                RANDOM_EJECTION_COOL_DURATION_SECONDS,
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
    onRandomEjection?.(rod.channel);
  });

  return (
    <InstancedRigidBodies
      ref={rigidBodies}
      type="kinematicPosition"
      instances={instances}
      colliders="cuboid"
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
  onRandomEjection,
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
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <pointLight
        position={[-11, 10, -8]}
        intensity={24}
        distance={40}
      />

      <Suspense fallback={null}>
        <Physics gravity={[0, -GRAVITY, 0]} colliders={false}>
          <CoreBase />
          <GuidedRodField
            engine={engine}
            sensitivity={sensitivity}
            smoothing={smoothing}
            randomEjectionsEnabled={randomEjectionsEnabled}
            az5TriggerToken={az5TriggerToken}
            onRandomEjection={onRandomEjection}
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
