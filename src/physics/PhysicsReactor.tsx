import {
  Suspense,
  useEffect,
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
import type { AudioEngine } from "../audio/AudioEngine";
import {
  sampleRodAmplitude,
  smoothRodHeight,
} from "../audio/rodResponse";
import {
  CONTAINMENT_WALL_HEIGHT,
  CONTAINMENT_WALL_RADIUS,
  CORE_TOP_Y,
  LAUNCH_CHANNEL,
  MAX_GUIDED_PROTRUSION,
  RANDOM_EJECTION_INTERVAL_SECONDS,
  RANDOM_EJECTION_THRESHOLD,
  RANDOM_EJECTION_UPWARD_MULTIPLIER,
  ROD_LAYOUT,
  ROD_LENGTH,
  ROD_WIDTH,
  type RodSpec,
} from "../reactor/layout";

interface PhysicsReactorProps {
  engine: AudioEngine;
  sensitivity: number;
  smoothing: number;
  launch418: boolean;
  randomEjectionsEnabled: boolean;
  onRandomEjection?: (channel: number) => void;
  resetViewToken: number;
  physicsEpoch: number;
}

interface ReactorSceneProps extends Omit<PhysicsReactorProps, "physicsEpoch"> {}

const guidedRods = ROD_LAYOUT.filter(
  (rod) => rod.channel !== LAUNCH_CHANNEL,
);
const launchRod = ROD_LAYOUT.find(
  (rod) => rod.channel === LAUNCH_CHANNEL,
)!;

const WALL_SEGMENTS = 96;
const WALL_THICKNESS = 0.28;

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

function CoreBase() {
  return (
    <>
      {/*
        y=0 is the core top plane. The plate is visual only so guided rods can
        remain inserted below it without starting inside a giant floor collider.
      */}
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

      {/* Catch anything that falls completely through the channel field. */}
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
  onRandomEjection,
}: Pick<
  ReactorSceneProps,
  | "engine"
  | "sensitivity"
  | "smoothing"
  | "randomEjectionsEnabled"
  | "onRandomEjection"
>) {
  const rigidBodies = useRef<RapierRigidBody[]>([]);
  const heights = useRef<Float32Array>(
    new Float32Array(guidedRods.length).fill(0.07),
  );
  const verticalVelocities = useRef<Float32Array>(
    new Float32Array(guidedRods.length),
  );
  const detachedIndices = useRef<Set<number>>(new Set());
  const pendingEjection = useRef<number | null>(null);
  const nextRandomEjectionAt = useRef<number | null>(null);
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

  useEffect(() => {
    nextRandomEjectionAt.current = null;
  }, [randomEjectionsEnabled]);

  useFrame(({ clock }, delta) => {
    const bodies = rigidBodies.current;
    if (!bodies || bodies.length === 0) return;

    const bins = engine.readFrequencyData();
    const state = engine.getState();
    const elapsed = clock.getElapsedTime();
    const safeDelta = Math.max(delta, 1 / 240);

    for (
      let index = 0;
      index < guidedRods.length && index < bodies.length;
      index += 1
    ) {
      if (detachedIndices.current.has(index)) continue;

      const rod = guidedRods[index];
      const amplitude = sampleRodAmplitude(
        engine,
        state,
        bins,
        rod,
        elapsed,
        sensitivity,
      );

      const previousHeight = heights.current[index];
      const nextHeight = Math.min(
        MAX_GUIDED_PROTRUSION,
        smoothRodHeight(
          previousHeight,
          amplitude,
          smoothing,
          delta,
        ),
      );

      heights.current[index] = nextHeight;
      verticalVelocities.current[index] =
        (nextHeight - previousHeight) / safeDelta;

      bodies[index]?.setNextKinematicTranslation({
        x: rod.x,
        y: CORE_TOP_Y + nextHeight - ROD_LENGTH / 2,
        z: rod.z,
      });
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

    const minimumHeight =
      MAX_GUIDED_PROTRUSION * RANDOM_EJECTION_THRESHOLD;
    const candidates: number[] = [];

    for (
      let index = 0;
      index < guidedRods.length && index < bodies.length;
      index += 1
    ) {
      if (detachedIndices.current.has(index)) continue;

      if (
        heights.current[index] >= minimumHeight &&
        verticalVelocities.current[index] > 0
      ) {
        candidates.push(index);
      }
    }

    if (candidates.length === 0) return;

    pendingEjection.current =
      candidates[Math.floor(Math.random() * candidates.length)];
  });

  useBeforePhysicsStep(() => {
    const index = pendingEjection.current;
    if (index === null) return;

    pendingEjection.current = null;

    if (detachedIndices.current.has(index)) return;

    const rb = rigidBodies.current[index];
    const rod = guidedRods[index];
    if (!rb || !rod) return;

    const upwardVelocity = Math.max(
      0,
      verticalVelocities.current[index],
    );

    detachedIndices.current.add(index);

    rb.setTranslation(
      {
        x: rod.x,
        y:
          CORE_TOP_Y +
          heights.current[index] -
          ROD_LENGTH / 2,
        z: rod.z,
      },
      true,
    );
    rb.setBodyType(
      rapier.RigidBodyType.Dynamic,
      true,
    );
    rb.recomputeMassPropertiesFromColliders();
    rb.enableCcd(true);
    rb.resetForces(true);
    rb.resetTorques(true);

    rb.setLinvel(
      {
        x: 0,
        y:
          upwardVelocity *
          RANDOM_EJECTION_UPWARD_MULTIPLIER,
        z: 0,
      },
      true,
    );

    rb.setAngvel(
      {
        x: (Math.random() - 0.5) * 1.6,
        y: (Math.random() - 0.5) * 0.35,
        z: (Math.random() - 0.5) * 1.6,
      },
      true,
    );

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
        args={[undefined, undefined, guidedRods.length]}
        count={guidedRods.length}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <boxGeometry args={[ROD_WIDTH, ROD_LENGTH, ROD_WIDTH]} />
        <meshStandardMaterial
          color="#8f967c"
          roughness={0.72}
          metalness={0.22}
        />
      </instancedMesh>
    </InstancedRigidBodies>
  );
}

function LaunchRod({
  rod,
  engine,
  sensitivity,
  smoothing,
  launch,
}: {
  rod: RodSpec;
  engine: AudioEngine;
  sensitivity: number;
  smoothing: number;
  launch: boolean;
}) {
  const body = useRef<RapierRigidBody | null>(null);
  const height = useRef(0.07);
  const launchApplied = useRef(false);

  useFrame(({ clock }, delta) => {
    if (launch || launchApplied.current || !body.current) return;

    const bins = engine.readFrequencyData();
    const state = engine.getState();
    const amplitude = sampleRodAmplitude(
      engine,
      state,
      bins,
      rod,
      clock.getElapsedTime(),
      sensitivity,
    );

    height.current = Math.min(
      MAX_GUIDED_PROTRUSION,
      smoothRodHeight(
        height.current,
        amplitude,
        smoothing,
        delta,
      ),
    );

    body.current.setNextKinematicTranslation({
      x: rod.x,
      y: CORE_TOP_Y + height.current - ROD_LENGTH / 2,
      z: rod.z,
    });
  });

  useBeforePhysicsStep(() => {
    const rb = body.current;

    if (
      !launch ||
      launchApplied.current ||
      !rb ||
      !rb.isDynamic()
    ) {
      return;
    }

    launchApplied.current = true;

    rb.recomputeMassPropertiesFromColliders();
    rb.resetForces(true);
    rb.resetTorques(true);
    rb.setLinvel(
      {
        x: 1.15,
        y: 24,
        z: -0.85,
      },
      true,
    );
    rb.setAngvel(
      {
        x: 0.9,
        y: 0.12,
        z: 1.15,
      },
      true,
    );
    rb.wakeUp();
  });

  return (
    <RigidBody
      ref={body}
      type={launch ? "dynamic" : "kinematicPosition"}
      position={[
        rod.x,
        CORE_TOP_Y + height.current - ROD_LENGTH / 2,
        rod.z,
      ]}
      colliders="cuboid"
      density={1}
      friction={0.74}
      restitution={0.16}
      linearDamping={0.04}
      angularDamping={0.05}
      ccd={launch}
      canSleep
    >
      <mesh castShadow receiveShadow>
        <boxGeometry args={[ROD_WIDTH, ROD_LENGTH, ROD_WIDTH]} />
        <meshStandardMaterial
          color={launch ? "#c57955" : "#a59d75"}
          roughness={0.65}
          metalness={0.28}
        />
      </mesh>
    </RigidBody>
  );
}

function ReactorScene({
  engine,
  sensitivity,
  smoothing,
  launch418,
  randomEjectionsEnabled,
  onRandomEjection,
  resetViewToken,
}: ReactorSceneProps) {
  return (
    <>
      <color attach="background" args={["#0c100d"]} />
      <fog attach="fog" args={["#0c100d", 34, 70]} />

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
        <Physics gravity={[0, -9.81, 0]} colliders={false}>
          <CoreBase />
          <GuidedRodField
            engine={engine}
            sensitivity={sensitivity}
            smoothing={smoothing}
            randomEjectionsEnabled={randomEjectionsEnabled}
            onRandomEjection={onRandomEjection}
          />
          <LaunchRod
            rod={launchRod}
            engine={engine}
            sensitivity={sensitivity}
            smoothing={smoothing}
            launch={launch418}
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
          far: 120,
        }}
      >
        <ReactorScene {...sceneProps} />
      </Canvas>
    </div>
  );
}
