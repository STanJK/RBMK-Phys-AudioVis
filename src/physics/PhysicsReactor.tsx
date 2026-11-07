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
  LAUNCH_CHANNEL,
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

function CameraReset({ token }: { token: number }) {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(23, 20, 23);
    camera.lookAt(0, 2.4, 0);
    camera.updateProjectionMatrix();
  }, [camera, token]);

  return null;
}

function CoreBase() {
  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[18, 0.35, 18]}
          position={[0, -0.35, 0]}
          friction={0.85}
          restitution={0.08}
        />
      </RigidBody>

      <mesh receiveShadow position={[0, -0.26, 0]}>
        <cylinderGeometry args={[16.9, 16.9, 0.5, 96]} />
        <meshStandardMaterial
          color="#222820"
          roughness={0.92}
          metalness={0.12}
        />
      </mesh>

      <mesh receiveShadow rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <torusGeometry args={[16.2, 0.42, 12, 96]} />
        <meshStandardMaterial
          color="#5b6046"
          roughness={0.78}
          metalness={0.3}
        />
      </mesh>
    </>
  );
}

function GuidedRodField({
  engine,
  sensitivity,
  smoothing,
}: Pick<
  ReactorSceneProps,
  "engine" | "sensitivity" | "smoothing"
>) {
  const rigidBodies = useRef<RapierRigidBody[]>([]);
  const heights = useRef<Float32Array>(
    new Float32Array(guidedRods.length).fill(0.07),
  );

  const instances = useMemo<InstancedRigidBodyProps[]>(
    () =>
      guidedRods.map((rod) => ({
        key: `rod-${rod.channel}`,
        position: [
          rod.x,
          ROD_LENGTH / 2 + 0.07,
          rod.z,
        ],
      })),
    [],
  );

  useFrame(({ clock }, delta) => {
    const bodies = rigidBodies.current;
    if (!bodies || bodies.length === 0) return;

    const bins = engine.readFrequencyData();
    const state = engine.getState();
    const elapsed = clock.getElapsedTime();

    for (
      let index = 0;
      index < guidedRods.length && index < bodies.length;
      index += 1
    ) {
      const rod = guidedRods[index];
      const amplitude = sampleRodAmplitude(
        engine,
        state,
        bins,
        rod,
        elapsed,
        sensitivity,
      );

      const nextHeight = smoothRodHeight(
        heights.current[index],
        amplitude,
        smoothing,
        delta,
      );
      heights.current[index] = nextHeight;

      bodies[index].setNextKinematicTranslation({
        x: rod.x,
        y: ROD_LENGTH / 2 + nextHeight,
        z: rod.z,
      });
    }
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
  const hasLaunched = useRef(false);
  const { rapier } = useRapier();

  useFrame(({ clock }, delta) => {
    if (launch || hasLaunched.current || !body.current) return;

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

    height.current = smoothRodHeight(
      height.current,
      amplitude,
      smoothing,
      delta,
    );

    body.current.setNextKinematicTranslation({
      x: rod.x,
      y: ROD_LENGTH / 2 + height.current,
      z: rod.z,
    });
  });

  useEffect(() => {
    if (!launch || hasLaunched.current || !body.current) return;

    hasLaunched.current = true;
    body.current.setBodyType(
      rapier.RigidBodyType.Dynamic,
      true,
    );
    body.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.current.applyImpulse(
      { x: 3.2, y: 56, z: -2.4 },
      true,
    );
    body.current.applyTorqueImpulse(
      { x: 5.5, y: 0.8, z: 4.7 },
      true,
    );
  }, [launch, rapier]);

  return (
    <RigidBody
      ref={body}
      type="kinematicPosition"
      position={[
        rod.x,
        ROD_LENGTH / 2 + height.current,
        rod.z,
      ]}
      colliders="cuboid"
      friction={0.74}
      restitution={0.16}
      linearDamping={0.04}
      angularDamping={0.05}
      ccd
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
        target={[0, 2.4, 0]}
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
          position: [23, 20, 23],
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
