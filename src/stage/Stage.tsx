import { Suspense, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AgXToneMapping, type PerspectiveCamera, type Fog } from 'three';
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import { useSettings, type Tier } from '@/store/settings';
import { CAMERA_CONTRACT, rigPose } from './cameraRig';
import { StageEnvironment } from './environments/StageEnvironment';
import { detectTier } from './detectTier';
import { PerfOverlay } from './perf/PerfOverlay';
import { subscribeFrames } from './perf/probe';
import { StageProbe } from './perf/StageProbe';
import { calibrationVerdict } from './perf/stats';
import { latchMsaa, lowerTier, TIER_SPEC, useStage, useTier } from './stageStore';
import { PropWarmup } from './warm/PropWarmup';
import { SceneGate } from './warm/SceneGate';

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

/** Renders continuously while mounted (the perf calibration window, and /bench while it measures). */
function KeepRendering() {
  useFrame(({ invalidate }) => invalidate());
  return null;
}

/** Calibration starts this long after the scene is shown, once its first frames are behind it. */
const CALIBRATION_DELAY_MS = 750;

/**
 * Auto quality: once per visit to /play, after the scene gate has shown the scene (shader compiles
 * and texture uploads must not read as a slow device), frames are forced for a moment and the
 * median frame time decides (calibrationVerdict). Slower than CALIBRATION_FPS steps the tier down
 * one notch, in place: the Canvas and the game scene stay mounted (see latchMsaa).
 *
 * This replaced drei's PerformanceMonitor, which needs 8 windows of 250 ms each: a phone drawing
 * 4 fps never completed them in the window and was never stepped down, and its default bounds
 * scale with the refresh rate, so a steady 55 fps on a 120 Hz screen counted as slow.
 */
function PerfCalibration({ tier }: { tier: Tier }) {
  const setDetected = useSettings((s) => s.setDetectedTier);
  const [phase, setPhase] = useState<'waiting' | 'running' | 'done'>('waiting');
  useEffect(() => {
    const t = window.setTimeout(() => setPhase('running'), CALIBRATION_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (phase !== 'running') return;
    const intervals: number[] = [];
    const t0 = performance.now();
    const off = subscribeFrames((f) => intervals.push(f.interval));
    // A tab sent to the background mid-sample measures nothing useful: give up for this visit.
    const onHidden = () => {
      if (document.hidden) setPhase('done');
    };
    document.addEventListener('visibilitychange', onHidden);
    const timer = window.setInterval(() => {
      const verdict = calibrationVerdict(intervals, performance.now() - t0);
      if (verdict === 'wait') return;
      if (verdict === 'slow' && tier !== 'low') setDetected(lowerTier(tier));
      setPhase('done');
    }, 200);
    return () => {
      off();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [phase, tier, setDetected]);
  return phase === 'running' ? <KeepRendering /> : null;
}

function InvalidateOn({ value }: { value: unknown }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [value, invalidate]);
  return null;
}

interface StageProps {
  /** The stage is on screen (a stage route). */
  active: boolean;
  /** Run the auto-quality calibration when a scene is first shown (real play only, never /bench). */
  calibrate: boolean;
  /** The ?perf=1 overlay. */
  perf: boolean;
  /** On /bench: never detect or step down the tier (the bench sets its own). */
  benchRoute: boolean;
}

export default function Stage({ active, calibrate, perf, benchRoute }: StageProps) {
  const { t } = useTranslation();
  const tier = useTier();
  const quality = useSettings((s) => s.quality);
  const detected = useSettings((s) => s.detectedTier);
  const setDetected = useSettings((s) => s.setDetectedTier);
  // /bench picks its own tier and must not write the user's settings.
  const benching = useStage((s) => s.bench !== null) || benchRoute;
  const keepRendering = useStage((s) => s.bench?.keepRendering ?? false);
  const warm = useStage((s) => s.warm);
  const [epoch, setEpoch] = useState(0);
  const [lost, setLost] = useState(false);
  // MSAA is the one setting that needs a new WebGL context (a remount of the Canvas, which would
  // also remount the game scene and drop whatever it was animating). It is latched when the Canvas
  // is created and only re-applied while no game is on screen (or on /bench, which switches tiers
  // on purpose); every other tier setting (DPR, environment, prop detail) changes in place.
  const wantMsaa = tier ? TIER_SPEC[tier].msaa : false;
  const [msaa, setMsaa] = useState<boolean | null>(null);
  const latched = latchMsaa(msaa, wantMsaa, !active || benchRoute);
  // Calibrate once per visit to a stage route, after a scene has been shown in that visit.
  const revealed = useStage((s) => s.revealed);
  const [activeSince, setActiveSince] = useState<number | null>(null);
  if (active && activeSince === null) setActiveSince(revealed);
  if (!active && activeSince !== null) setActiveSince(null);
  const sceneShown = activeSince !== null && revealed > activeSince;
  if (tier && latched !== msaa) setMsaa(latched);

  useEffect(() => {
    if (detected !== null || benching) return;
    let cancelled = false;
    void detectTier().then((t) => {
      if (!cancelled) setDetected(t);
    });
    return () => {
      cancelled = true;
    };
  }, [detected, setDetected, benching]);

  const onCreated = useCallback((state: RootState) => {
    // three's shader error check reads every new program's info logs on its first draw: a
    // synchronous round trip to the GPU process that waits out the whole compile queue (the bulk of
    // a scene's first-frame stall). Dev builds keep it for the diagnostics.
    state.gl.debug.checkShaderErrors = import.meta.env.DEV;
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
        // Only a lost context or an MSAA change (latched above, never mid-game) makes a new Canvas.
        key={`${epoch}:${latched ? 'aa' : 'no-aa'}`}
        frameloop="demand"
        dpr={[1, spec.dpr]}
        gl={{
          antialias: latched,
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
        <StageProbe />
        <StageEnvironment tier={tier} />
        <Suspense fallback={null}>
          <SceneGate />
        </Suspense>
        {warm && <PropWarmup key={warm.nonce} request={warm} />}
        {sceneShown && calibrate && !benching && quality === 'auto' && tier !== 'low' && (
          <PerfCalibration key={activeSince} tier={tier} />
        )}
        {keepRendering && <KeepRendering />}
        <InvalidateOn value={active} />
      </Canvas>
      {perf && <PerfOverlay tier={tier} visible={active} />}
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
