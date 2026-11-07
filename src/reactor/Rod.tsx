import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { ROD_LENGTH, ROD_WIDTH, type RodSpec } from "./layout";

interface RodProps {
  rod: RodSpec;
  launchToken: number;
}

function guidedHeight(radius: number, elapsed: number): number {
  const slow = Math.sin(elapsed * 1.55 + radius * 0.42);
  const fast = Math.sin(elapsed * 3.1 - radius * 0.18) * 0.2;
  return 0.34 + Math.max(0, slow * 0.28 + fast * 0.12);
}

export function Rod({ rod, launchToken }: RodProps) {
  const body = useRef<RapierRigidBody>(null);
  const launched = rod.channel === 418 && launchToken > 0;

  useEffect(() => {
    if (!launched) return;

    const frame = requestAnimationFrame(() => {
      body.current?.applyImpulse({ x: 2.6, y: 36, z: -1.7 }, true);
      body.current?.applyTorqueImpulse({ x: 2.8, y: 0.5, z: 3.6 }, true);
    });

    return () => cancelAnimationFrame(frame);
  }, [launched]);

  useFrame(({ clock }) => {
    if (launched || !body.current) return;

    const y = ROD_LENGTH / 2 + guidedHeight(rod.radius, clock.getElapsedTime());
    body.current.setNextKinematicTranslation({ x: rod.x, y, z: rod.z });
  });

  const startY = ROD_LENGTH / 2 + 0.34;

  return (
    <RigidBody
      key={rod.channel + "-" + (launched ? "dynamic" : "guided")}
      ref={body}
      type={launched ? "dynamic" : "kinematicPosition"}
      position={[rod.x, startY, rod.z]}
      colliders="cuboid"
      friction={0.72}
      restitution={0.18}
      linearDamping={0.08}
      angularDamping={0.08}
      ccd={launched}
    >
      <mesh castShadow receiveShadow>
        <boxGeometry args={[ROD_WIDTH, ROD_LENGTH, ROD_WIDTH]} />
        <meshStandardMaterial
          color={launched ? "#c47a58" : "#8f967c"}
          roughness={0.76}
          metalness={0.18}
        />
      </mesh>
    </RigidBody>
  );
}
