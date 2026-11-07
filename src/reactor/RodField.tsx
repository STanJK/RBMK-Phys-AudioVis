import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { Rod } from "./Rod";
import type { RodSpec } from "./layout";

interface RodFieldProps {
  rods: RodSpec[];
  launchToken: number;
}

export function RodField({ rods, launchToken }: RodFieldProps) {
  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[18, 0.25, 18]} position={[0, -0.25, 0]} />
      </RigidBody>

      <mesh receiveShadow position={[0, -0.26, 0]}>
        <cylinderGeometry args={[16.8, 16.8, 0.5, 96]} />
        <meshStandardMaterial color="#222820" roughness={0.95} />
      </mesh>

      {rods.map((rod) => (
        <Rod key={rod.channel} rod={rod} launchToken={launchToken} />
      ))}
    </>
  );
}
