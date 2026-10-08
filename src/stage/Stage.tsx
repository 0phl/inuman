import { Suspense, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AgXToneMapping, type PerspectiveCamera, type Fog } from 'three';
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { useSettings, type Tier } from '@/store/settings';
import { CAMERA_CONTRACT, rigPose } from './cameraRig';
import { StageEnvironment } from './environments/StageEnvironment';
import { detectTier } from './detectTier';
import { lowerTier, TIER_SPEC, useTier } from './stageStore';
import { sceneTunnel } from './tunnel';

/**
 * Fixed rig on the baked bar's contract cameras (portrait: table in the lower ~70%, wall neon above;
 * landscape/tablet: the wider room), blended by aspect and pulled back only if the play area would
 * be cropped. No orbit controls during play. See cameraRig.ts.
 */
function CameraRig() {
  const size = useThree((s) => s.size);
  const get = useThree((s) => s.get);

  useLayoutEffect(() => {
    if (!size.width || !size.height) return;
    const { scene, invalidate } = get();
    const camera = get().camera as PerspectiveCamera;
    const pose = rigPose(size.width / size.height);
    const dist = pose.distance;
    camera.fov = pose.fov;
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    // Nothing comes within ~2 units of the camera; a far-out near plane keeps depth precision for
    // the felt and the shadow decals, which sit a millimetre apart. The baked room's far corners
    // are ~19 units from the landscape camera.
    camera.near = 0.5;
    camera.far = dist + 30;
    camera.updateProjectionMatrix();
    const fog = scene.fog as Fog | null;
    if (fog) {
      fog.near = dist + 1.5;
      fog.far = dist + 9;
    }
    invalidate();
  }, [size, get]);

  return null;
}

/** Renders continuously while mounted (used only for the short perf calibration window). */
function KeepRendering() {
  useFrame(({ invalidate }) => invalidate());
  return null;
}

/**
 * The frame loop is on demand, so fps is only meaningful while frames are forced. When a scene is
 * first shown at a given tier we render continuously for a few seconds under drei's
 * PerformanceMonitor and step the tier down if it declines.
 */
function PerfCalibration({ tier }: { tier: Tier }) {
  const setDetected = useSettings((s) => s.setDetectedTier);
  const [running, setRunning] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setRunning(false), 3500);
    return () => window.clearTimeout(t);
  }, []);
  if (!running) return null;
  return (
    <PerformanceMonitor
      ms={250}
      iterations={8}
      onDecline={() => {
        if (tier !== 'low') setDetected(lowerTier(tier));
        setRunning(false);
      }}
    >
      <KeepRendering />
    </PerformanceMonitor>
  );
}

function InvalidateOn({ value }: { value: unknown }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [value, invalidate]);
  return null;
}

export default function Stage({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const tier = useTier();
  const quality = useSettings((s) => s.quality);
  const detected = useSettings((s) => s.detectedTier);
  const setDetected = useSettings((s) => s.setDetectedTier);
  const [epoch, setEpoch] = useState(0);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    if (detected !== null) return;
    let cancelled = false;
    void detectTier().then((t) => {
      if (!cancelled) setDetected(t);
    });
    return () => {
      cancelled = true;
    };
  }, [detected, setDetected]);

  const onCreated = useCallback((state: RootState) => {
    const el = state.gl.domElement;
    el.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      setLost(true);
    });
    el.addEventListener('webglcontextrestored', () => setLost(false));
  }, []);

  if (!tier) return null;
  const spec = TIER_SPEC[tier];

  return (
    <>
      <Canvas
        // MSAA is a context-creation flag: switching it (or restoring a lost context) needs a new Canvas.
        key={`${epoch}:${spec.msaa ? 'aa' : 'no-aa'}`}
        frameloop="demand"
        dpr={[1, spec.dpr]}
        gl={{
          antialias: spec.msaa,
          toneMapping: AgXToneMapping,
          toneMappingExposure: 1.15,
          powerPreference: 'high-performance',
        }}
        camera={{ fov: CAMERA_CONTRACT.fov, near: 0.5, far: 40, position: [0, 4, 3.6] }}
        style={{ touchAction: 'none' }}
        onCreated={onCreated}
        data-testid="stage-canvas"
      >
        <CameraRig />
        <StageEnvironment tier={tier} />
        <Suspense fallback={null}>
          <sceneTunnel.Out />
        </Suspense>
        {active && quality === 'auto' && tier !== 'low' && (
          <PerfCalibration key={tier} tier={tier} />
        )}
        <InvalidateOn value={active} />
      </Canvas>
      {lost && (
        <button
          type="button"
          data-testid="restore-gl"
          className="anim-fade fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-narra-950/90 px-8 text-center"
          onClick={() => {
            setLost(false);
            setEpoch((e) => e + 1);
          }}
        >
          <span className="font-sign text-2xl text-brass-300">{t('stage.lost.title')}</span>
          <span className="text-capiz-300">{t('stage.lost.body')}</span>
        </button>
      )}
    </>
  );
}
