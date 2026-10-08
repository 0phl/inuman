import { ENV_SCALE, PLAY_W } from './tableSpace';

export type Vec3 = readonly [number, number, number];

/**
 * The cameras the baked bar was composed for, in metres (Y-up, table top at y = 0). Portrait
 * phones get the table in the lower ~70% with the wall neon above; landscape pulls back and up to
 * show the chairs and the videoke corner.
 */
export const CAMERA_CONTRACT = {
  fov: 50,
  target: [0, 0, -0.05] as Vec3,
  portrait: { aspect: 9 / 20, position: [0, 0.95, 0.85] as Vec3 },
  landscape: { aspect: 16 / 10, position: [0, 1.0, 1.1] as Vec3 },
} as const;

export interface RigPose {
  position: Vec3;
  target: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Camera-to-target distance (world units). */
  distance: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Fixed camera for a viewport aspect (width / height): blends the portrait and landscape contract
 * cameras by aspect, then dollies back along the view direction if the play area would be cropped
 * horizontally (very tall phones). Pure, so it can be unit tested.
 */
export function rigPose(aspect: number, scale: number = ENV_SCALE): RigPose {
  const { fov, target, portrait, landscape } = CAMERA_CONTRACT;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : portrait.aspect;
  const t = smoothstep(portrait.aspect, landscape.aspect, safeAspect);
  const tg = target.map((v) => v * scale) as unknown as Vec3;
  const offset = [0, 1, 2].map(
    (i) =>
      (portrait.position[i]! + (landscape.position[i]! - portrait.position[i]!) * t) * scale -
      tg[i]!,
  );
  const base = Math.hypot(offset[0]!, offset[1]!, offset[2]!);
  const halfWidthTan = Math.tan((fov * Math.PI) / 360) * safeAspect;
  const fit = PLAY_W / 2 / halfWidthTan;
  const distance = Math.max(base, fit);
  const k = distance / base;
  return {
    position: [tg[0] + offset[0]! * k, tg[1] + offset[1]! * k, tg[2] + offset[2]! * k],
    target: tg,
    fov,
    distance,
  };
}
