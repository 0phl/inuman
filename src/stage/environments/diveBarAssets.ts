import { useLoader } from '@react-three/fiber';
import {
  EquirectangularReflectionMapping,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  type DataTexture,
  type DataTextureLoaderTexData,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Tier } from '@/store/settings';

// Served from public/; runtime-cached by the service worker's /assets/*.glb|hdr rule (vite.config.ts).
const DIR = `${import.meta.env.BASE_URL}assets/env/dive-bar/`;

/** 1024² atlas on the low tier, 2048² everywhere else. */
export const diveBarUrl = (tier: Tier): string =>
  `${DIR}${tier === 'low' ? 'dive-bar-low.glb' : 'dive-bar.glb'}`;

/** Poly Haven "warm_bar" 1k: reflections on the high tier only. */
export const DIVE_BAR_HDR = `${DIR}env.hdr`;

const materialsOf = (mesh: Mesh): Material[] =>
  Array.isArray(mesh.material) ? mesh.material : [mesh.material];

/**
 * Linear multiplier on the realtime table's albedo. three's AgX desaturates bright oranges more
 * than Blender's, so under the same key light the wood read mauve-brown next to the baked room
 * instead of the golden orange of the Cycles previews. Solved against final_landscape.png for the
 * app's exposure and key gain (see DiveBarBaked); applied once at load.
 */
const TABLE_GRADE: readonly [number, number, number] = [1.05, 0.975, 0.15];

const sharpen = (t: Texture | null, anisotropy: number) => {
  if (t) t.anisotropy = anisotropy; // three clamps to the GPU's maximum
};

/**
 * One-time fix-up of the loaded bar (results are cached and shared, so this runs once per file):
 * - "Background" (KHR_materials_unlit → MeshBasicMaterial) carries fully baked lighting: its sRGB
 *   atlas stores linear radiance, so it renders unlit, tone mapped (AgX, like the Blender
 *   previews), without fog or shadows.
 * - "Table" is PBR and lit in realtime by the app (see DiveBarBaked).
 * Everything is static, so world matrices are computed once.
 */
function prepareDiveBar(gltf: GLTF): void {
  gltf.scene.traverse((o: Object3D) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    for (const m of materialsOf(mesh)) {
      if (m instanceof MeshBasicMaterial) {
        if (m.map) m.map.colorSpace = SRGBColorSpace;
        sharpen(m.map, 8); // the floor and table edge are seen at grazing angles
        m.toneMapped = true;
        m.fog = false;
      } else if (m instanceof MeshStandardMaterial) {
        if (m.map) m.map.colorSpace = SRGBColorSpace;
        m.color.setRGB(...TABLE_GRADE);
        for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap]) sharpen(t, 8);
        m.fog = false;
      }
    }
  });
}

interface Pending {
  promise: Promise<void>;
  resolve(): void;
  reject(err: unknown): void;
}

/** One settle-once promise per URL loaded through the loaders below (R3F loads each URL once). */
const pending = new Map<string, Pending>();
function pendingFor(url: string): Pending {
  let p = pending.get(url);
  if (!p) {
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => {}); // awaited only by preloaders, which handle it themselves
    p = { promise, resolve, reject };
    pending.set(url, p);
  }
  return p;
}

/** Resolves once `url` has been loaded (and prepared) through DiveBarLoader / ReflectionHdrLoader. */
export const whenLoaded = (url: string): Promise<void> => pendingFor(url).promise;

/** GLTFLoader with the meshopt decoder the bar needs (EXT_meshopt_compression). */
export class DiveBarLoader extends GLTFLoader {
  constructor() {
    super();
    this.setMeshoptDecoder(MeshoptDecoder);
  }

  override load(
    url: string,
    onLoad: (gltf: GLTF) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (err: unknown) => void,
  ): void {
    const done = pendingFor(url);
    super.load(
      url,
      (gltf) => {
        prepareDiveBar(gltf);
        done.resolve();
        onLoad(gltf);
      },
      onProgress,
      (err) => {
        done.reject(err);
        onError?.(err);
      },
    );
  }
}

/** HDRLoader whose result is ready to use as `scene.environment` (equirect → PMREM). */
export class ReflectionHdrLoader extends HDRLoader {
  override load(
    url: string,
    onLoad?: (texture: DataTexture, texData: DataTextureLoaderTexData) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (err: unknown) => void,
  ): DataTexture {
    const done = pendingFor(url);
    return super.load(
      url,
      (texture, texData) => {
        texture.mapping = EquirectangularReflectionMapping;
        done.resolve();
        onLoad?.(texture, texData);
      },
      onProgress,
      (err) => {
        done.reject(err);
        onError?.(err);
      },
    );
  }
}

/**
 * Starts fetching + decoding the bar (and, on high, the reflection HDRI) into R3F's loader cache,
 * so /play mounts them without a wait. Resolves when the bar is ready.
 */
export function preloadDiveBar(tier: Tier): Promise<void> {
  useLoader.preload(DiveBarLoader, diveBarUrl(tier));
  if (tier === 'high') useLoader.preload(ReflectionHdrLoader, DIVE_BAR_HDR);
  return whenLoaded(diveBarUrl(tier));
}
