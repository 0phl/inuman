// Shared dice dimensions and tray shape. No Rapier here: rendering code imports this without
// pulling the physics chunk in.

/** Edge length of a die in world units (the felt is ~3 units wide, a card is 0.7 wide). */
export const DIE_SIZE = 0.26;
/** Corner/edge rounding, shared by the collider (roundCuboid) and the rendered mesh. */
export const DIE_RADIUS = 0.032;

/** A rectangular dice tray centred on the origin; its floor is the table top (y = 0). */
export interface TraySpec {
  /** Inner width along X, in world units. */
  width: number;
  /** Inner depth along Z (+Z is toward the player/camera). */
  depth: number;
  /** Height of the visible rim on the near and side walls. */
  wallHeight: number;
  /** Height of the far (-Z) backboard the throw bounces off; it never hides dice from the camera. */
  backHeight: number;
}

/**
 * The physics walls are taller than the visible rims (invisible above them) so a hard bounce never
 * leaves the tray; throws that touch a wall clearly above its rim are re-thrown instead.
 */
export const DEFAULT_TRAY: Readonly<TraySpec> = {
  width: 2.0,
  depth: 1.5,
  wallHeight: 0.2,
  backHeight: 0.5,
};

/** Floats per die per recorded presim frame: px, py, pz, qx, qy, qz, qw. */
export const FRAME_STRIDE = 7;
