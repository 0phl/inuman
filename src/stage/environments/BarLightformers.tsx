import { Environment, Lightformer } from '@react-three/drei';

/**
 * A tiny generated environment map for reflections: a warm pendant panel overhead, a pink neon ring,
 * a cool videoke-screen glow and a dim fill from the room. Rendered once (frames=1), no downloads.
 */
export function BarLightformers({ intensity = 1 }: { intensity?: number }) {
  return (
    <Environment resolution={256} frames={1} environmentIntensity={intensity}>
      <color attach="background" args={['#120a06']} />
      <Lightformer
        form="rect"
        color="#ffd8a0"
        intensity={3}
        position={[0, 5, 0]}
        rotation-x={Math.PI / 2}
        scale={[4, 2, 1]}
      />
      <Lightformer form="ring" color="#ff3d6e" intensity={4} position={[-4, 2, -4]} scale={2} />
      <Lightformer
        form="rect"
        color="#3fb6c9"
        intensity={1.2}
        position={[5, 2, 2]}
        rotation-y={-Math.PI / 2}
        scale={[2, 3, 1]}
      />
      <Lightformer
        form="rect"
        color="#ffb066"
        intensity={0.8}
        position={[0, 1.5, 6]}
        rotation-y={Math.PI}
        scale={[6, 1, 1]}
      />
    </Environment>
  );
}
