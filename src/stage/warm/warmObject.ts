import type { Camera, Material, Mesh, Object3D, Scene, Texture, WebGLRenderer } from 'three';

// Precompiling and pre-uploading before something is shown. Without it, the first frame that draws
// a new material blocks the main thread until its shader has compiled and linked (three asks for
// the link status on first use) and uploads every new texture in that same frame: ~1 s frozen at 4×
// CPU on a desktop GPU, which is where a phone's "tap Start, nothing happens" comes from.

/** Main-thread budget per frame for texture uploads while warming (ms). */
const UPLOAD_SLICE_MS = 6;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Every texture a subtree's materials use (maps of all kinds), once each. */
export function texturesOf(root: Object3D): Texture[] {
  const out = new Set<Texture>();
  root.traverse((o) => {
    const material = (o as Mesh).material as Material | Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      for (const v of Object.values(m)) {
        if (v && typeof v === 'object' && (v as Texture).isTexture) out.add(v as Texture);
      }
    }
  });
  return [...out];
}

/**
 * Compiles every material under `root` against `scene`'s lights and environment, off the main
 * thread where KHR_parallel_shader_compile exists (three's compileAsync polls for completion), then
 * uploads its textures a few per frame. `root` may be hidden or detached: nothing is drawn.
 */
export async function warmObject(
  gl: WebGLRenderer,
  root: Object3D,
  camera: Camera,
  scene: Scene,
  isLive: () => boolean = () => true,
): Promise<void> {
  try {
    await gl.compileAsync(root, camera, scene);
  } catch (err) {
    // A shader that fails here fails the same way when drawn; let the first render report it.
    console.warn('[stage] precompile skipped:', err);
  }
  let sliceStart = performance.now();
  for (const tex of texturesOf(root)) {
    if (!isLive()) return;
    const image = tex.image as { width?: number } | null | undefined;
    // Not loaded yet (or a render target's texture): it uploads whenever it's ready.
    if (
      !image ||
      !image.width ||
      (tex as Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture
    )
      continue;
    if (performance.now() - sliceStart > UPLOAD_SLICE_MS) {
      await frame();
      sliceStart = performance.now();
    }
    gl.initTexture(tex);
  }
}
