import { Suspense, useLayoutEffect, useMemo } from 'react';
import { Object3D } from 'three';
import { useLoader, useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import type { Tier } from '@/store/settings';
import { BAKED_FELT, ENV_SCALE, TABLE_Y } from '../tableSpace';
import { BarLightformers } from './BarLightformers';
import { DIVE_BAR_HDR, DiveBarLoader, diveBarUrl, ReflectionHdrLoader } from './diveBarAssets';
import { EnvFallback } from './EnvFallback';
import { FeltMat } from './FeltMat';

/*
 * Look calibration, measured against the Blender previews (final_landscape.png / final_portrait.png)
 * from the contract cameras with the HUD hidden:
 * - The previews use Blender's AgX at exposure 0. three's AgX curve is a little brighter in the
 *   mid-tones, so 0.9 lands the baked room (neon, chairs, crates, videoke screen) within a few
 *   sRGB levels of the previews; the deepest shadows come out slightly darker.
 * - The key light is the GLB's Cycles-calibrated pendant, run at 0.8 so cards and felt are less
 *   blown out; the table's albedo grade (TABLE_GRADE in diveBarAssets.ts) is solved for this gain,
 *   so the wood still matches the Cycles table.
 * - The fill stands in for the room's bounce light, tuned per tier so the table's shadowed edges
 *   match as well.
 */
const EXPOSURE = 0.9;
const KEY_GAIN = 0.8;
const FILL = {
  /** No IBL on the low tier: a warm hemisphere light. */
  lowHemisphere: 1.7,
  /** scene.environmentIntensity of the generated Lightformer map (mid). */
  midIbl: 0.75,
  /** scene.environmentIntensity of Poly Haven warm_bar (high). */
  highIbl: 0.5,
} as const;

interface KeyLight {
  position: [number, number, number];
  target: [number, number, number];
  color: string;
  intensity: number;
  angle: number;
  penumbra: number;
  decay: number;
}

/** Calibrated in Cycles against the bake; also shipped in the GLB as Background.userData.keyLight. */
const DEFAULT_KEY: KeyLight = {
  position: [0, 0.744, 0],
  target: [0, 0, 0],
  color: '#ffac59',
  intensity: 6.91,
  angle: 1.0297,
  penumbra: 0.55,
  decay: 2,
};

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Reads the pendant's key light from the GLB extras (metres), falling back to the calibrated values. */
function keyLightOf(scene: Object3D): KeyLight {
  const raw = scene.getObjectByName('Background')?.userData.keyLight as
    { position?: unknown; target?: unknown; three?: Record<string, unknown> } | undefined;
  const t = raw?.three ?? {};
  return {
    position: isVec3(raw?.position) ? raw.position : DEFAULT_KEY.position,
    target: isVec3(raw?.target) ? raw.target : DEFAULT_KEY.target,
    color: typeof t.color === 'string' ? t.color : DEFAULT_KEY.color,
    intensity: num(t.intensity, DEFAULT_KEY.intensity),
    angle: num(t.angle, DEFAULT_KEY.angle),
    penumbra: num(t.penumbra, DEFAULT_KEY.penumbra),
    decay: num(t.decay, DEFAULT_KEY.decay),
  };
}

const toWorld = (v: readonly number[]): [number, number, number] => [
  v[0]! * ENV_SCALE,
  TABLE_Y + v[1]! * ENV_SCALE,
  v[2]! * ENV_SCALE,
];

function HdrReflections({ intensity }: { intensity: number }) {
  const map = useLoader(ReflectionHdrLoader, DIVE_BAR_HDR);
  return <Environment map={map} environmentIntensity={intensity} />;
}

/** Image-based fill per tier: none on low, generated Lightformers on mid, the warm_bar HDRI on high. */
function Fill({ tier }: { tier: Tier }) {
  if (tier === 'low') return <hemisphereLight args={['#ffcf9a', '#24130a', FILL.lowHemisphere]} />;
  const lightformers = <BarLightformers intensity={FILL.midIbl} />;
  if (tier === 'mid') return lightformers;
  return (
    <EnvFallback fallback={lightformers} label="warm_bar HDRI">
      <Suspense fallback={lightformers}>
        <HdrReflections intensity={FILL.highIbl} />
      </Suspense>
    </EnvFallback>
  );
}

/**
 * The baked Blender dive bar ('dive-bar'): one unlit draw call for the whole room (lighting baked
 * into a 2048² atlas, 1024² on low), plus the realtime PBR table under the pendant's key light,
 * with the theme's felt mat on top. Metres in the GLB, scaled by ENV_SCALE about the table top.
 */
export function DiveBarBaked({ tier }: { tier: Tier }) {
  const gltf = useLoader(DiveBarLoader, diveBarUrl(tier));
  const key = useMemo(() => keyLightOf(gltf.scene), [gltf]);
  const target = useMemo(() => new Object3D(), []);
  const get = useThree((s) => s.get);

  useLayoutEffect(() => {
    const { gl, invalidate } = get();
    const previous = gl.toneMappingExposure;
    gl.toneMappingExposure = EXPOSURE;
    invalidate();
    return () => {
      gl.toneMappingExposure = previous;
      invalidate();
    };
  }, [get]);

  return (
    <>
      <color attach="background" args={['#050302']} />
      <group position-y={TABLE_Y} scale={ENV_SCALE}>
        <primitive object={gltf.scene} />
      </group>

      <primitive object={target} position={toWorld(key.target)} />
      <spotLight
        position={toWorld(key.position)}
        target={target}
        color={key.color}
        // Inverse-square falloff: the same illuminance at ENV_SCALE× the distance needs ENV_SCALE² the intensity.
        intensity={key.intensity * ENV_SCALE * ENV_SCALE * KEY_GAIN}
        angle={key.angle}
        penumbra={key.penumbra}
        decay={key.decay}
        distance={0}
      />
      <Fill tier={tier} />

      <FeltMat
        width={BAKED_FELT.width}
        depth={BAKED_FELT.depth}
        radius={BAKED_FELT.radius}
        ibl={tier !== 'low'}
      />
    </>
  );
}
