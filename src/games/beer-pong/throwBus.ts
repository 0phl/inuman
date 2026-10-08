import { create } from 'zustand';
import { simulateThrow } from '@/physics/loadThrowSim';
import { lookAtCamera, type AssistedThrow, type CameraLike } from '@/physics/throwMath';
import { rigPose } from '@/stage/cameraRig';
// Types only: the Rapier chunk is loaded on demand through loadThrowSim().
import type { PresimThrowInput, PresimThrowOutput } from '@/physics/throwSim';

// The link between a skill game's Hud (DOM: gestures, buttons, dispatch) and its Scene (inside the
// Canvas: the replay, the aim arc). The Hud owns the throw; the Scene registers the replay that
// shows it. No three here, so the Hud can import it. One game is on screen at a time, so one bus
// serves Beer Pong and Quarters (and Flip Cup's camera).

export interface ThrowRunner {
  /** Pre-simulates and replays a throw; resolves once the replay has shown its last frame. */
  run(input: PresimThrowInput): Promise<PresimThrowOutput>;
  /** Back to idle: the projectile returns to the hand. */
  clear(): void;
}

interface ThrowBus {
  /** The throw the current drag (or held "Tumira") would make, for the aim arc. */
  aim: AssistedThrow | null;
  /** Registered by the Scene while it is mounted. */
  runner: ThrowRunner | null;
  /** The live scene camera (falls back to the camera rig's pose when the Scene isn't running). */
  camera: CameraLike | null;
  /** The Scene is animating something the next throw has to wait for (racks swapping, a cup out). */
  sceneBusy: boolean;
  /** A player highlighted in a HUD picker, mirrored onto their plaque (Quarters' "Sino iinom?"). */
  picked: string | null;
  setAim(aim: AssistedThrow | null): void;
  setRunner(runner: ThrowRunner | null): void;
  setCamera(camera: CameraLike | null): void;
  setSceneBusy(busy: boolean): void;
  setPicked(id: string | null): void;
}

export const useThrowBus = create<ThrowBus>()((set) => ({
  aim: null,
  runner: null,
  camera: null,
  sceneBusy: false,
  picked: null,
  setAim: (aim) => set((s) => (s.aim === aim ? {} : { aim })),
  setRunner: (runner) => set({ runner }),
  setCamera: (camera) => set({ camera }),
  setSceneBusy: (sceneBusy) => set((s) => (s.sceneBusy === sceneBusy ? {} : { sceneBusy })),
  setPicked: (picked) => set((s) => (s.picked === picked ? {} : { picked })),
}));

/**
 * Runs a throw through the Scene's replay, or, if no Scene is running (lost WebGL, a failed
 * stage), simulates it headless so the game still goes on.
 */
export function runThrow(input: PresimThrowInput): Promise<PresimThrowOutput> {
  const runner = useThrowBus.getState().runner;
  return runner ? runner.run(input) : simulateThrow(input);
}

export const clearThrow = (): void => useThrowBus.getState().runner?.clear();

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

/** The stage camera rig's pose for a viewport aspect (what CameraRig sets the camera to). */
export function rigCamera(aspect: number): CameraLike {
  const pose = rigPose(aspect);
  return lookAtCamera([...pose.position], [...pose.target], pose.fov);
}

/** The scene camera for flick → world mapping: the live one, else the camera rig's pose. */
export function sceneCamera(): CameraLike {
  return (
    useThrowBus.getState().camera ?? rigCamera(window.innerWidth / Math.max(1, window.innerHeight))
  );
}
