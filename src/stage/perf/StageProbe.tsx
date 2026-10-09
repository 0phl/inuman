import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { setStageHandles } from './probe';

/** Inside the Canvas: hands the live renderer, scene and camera to the perf probe (no per-frame work). */
export function StageProbe() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    setStageHandles({ gl, scene, camera });
    return () => setStageHandles(null);
  }, [gl, scene, camera]);
  return null;
}
