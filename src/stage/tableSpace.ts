/**
 * The table-space contract shared by every stage environment and every game Scene.
 *
 * Game scenes lay their props out in world units, centred on the origin, resting on the playing
 * surface at y = TABLE_Y (cards are 0.7 units wide, see src/three/cardGeometry.ts). Environments
 * modelled in metres (the baked Blender bar: table top at y = 0, ~1.3 × 0.9 m) are scaled by
 * ENV_SCALE about the table top, so props keep sitting exactly where they always have.
 */
export const TABLE_Y = 0;

/**
 * World units per metre for baked environments. Cards are drawn ~2.7× real size so they read on a
 * phone, so the bar is scaled up instead: its 1.3 × 0.9 m table becomes 5.2 × 3.6 units, the same
 * footprint as the procedural table the scenes were laid out on.
 */
export const ENV_SCALE = 4;

/** Felt play mat on the baked table (world units): a ~13 cm / 9 cm wood border stays visible. */
export const BAKED_FELT = { width: 4.0, depth: 2.9, radius: 0.24 } as const;

/**
 * Width (world units) every game keeps its props inside: Kings Cup's ring is the widest at ±1.11.
 * The camera rig always keeps this much of the table in frame horizontally.
 */
export const PLAY_W = 2.35;
