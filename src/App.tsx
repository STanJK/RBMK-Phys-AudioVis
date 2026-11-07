import { Suspense, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { createRodLayout } from "./reactor/layout";
import { RodField } from "./reactor/RodField";

const rods = createRodLayout();

function ReactorScene({ launchToken }: { launchToken: number }) {
  const layout = useMemo(() => rods, []);

  return (
    <>
      <color attach="background" args={["#090c0a"]} />
      <fog attach="fog" args={["#090c0a", 30, 72]} />

      <ambientLight intensity={0.7} />
      <directionalLight
        castShadow
        position={[12, 26, 8]}
        intensity={2.3}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <pointLight position={[-12, 10, -8]} intensity={30} distance={45} />

      <Suspense fallback={null}>
        <Physics gravity={[0, -9.81, 0]}>
          <RodField rods={layout} launchToken={launchToken} />
        </Physics>
      </Suspense>

      <OrbitControls
        makeDefault
        target={[0, 2.2, 0]}
        minDistance={16}
        maxDistance={58}
        maxPolarAngle={Math.PI * 0.49}
      />
    </>
  );
}

export default function App() {
  const [launchToken, setLaunchToken] = useState(0);
  const launched = launchToken > 0;

  return (
    <main className="app-shell">
      <section className="hud">
        <div>
          <p className="eyebrow">RBMK-PHYS-AUDIOVIS / POC-0</p>
          <h1>709-channel rigid-body core</h1>
          <p className="subtle">
            Guided rods currently run on a demo actuator waveform. Web Audio mapping comes next.
          </p>
        </div>

        <dl className="readout">
          <div>
            <dt>Channels</dt>
            <dd>{rods.length}</dd>
          </div>
          <div>
            <dt>CH-418</dt>
            <dd>{launched ? "DYNAMIC / DISPLACED" : "GUIDED"}</dd>
          </div>
          <div>
            <dt>Physics</dt>
            <dd>RAPIER 3D</dd>
          </div>
        </dl>

        <button
          className="launch"
          type="button"
          disabled={launched}
          onClick={() => setLaunchToken((value) => value + 1)}
        >
          {launched ? "CH-418 RELEASED" : "LAUNCH CH-418"}
        </button>
      </section>

      <section className="viewport" aria-label="RBMK inspired rigid-body visualizer">
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [23, 20, 23], fov: 38, near: 0.1, far: 120 }}
        >
          <ReactorScene launchToken={launchToken} />
        </Canvas>
      </section>
    </main>
  );
}
