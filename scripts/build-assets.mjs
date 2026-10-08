#!/usr/bin/env node
// Optimise the baked environment GLBs with gltf-transform and enforce the asset budgets.
// Fails (exit 1) when any budget or contract check is violated.
//
//   pnpm assets            optimise + check every environment
//   pnpm assets --check    only check the files already in public/ (no rebuild)
//
// Inputs come from assets-src/blender/export/*.raw.glb, produced by
// `scripts/blender-run.sh assets-src/blender/build_dive_bar.py` (Blender bake + export).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'gltf-transform.cmd' : 'gltf-transform');
const MB = 1000 * 1000; // budgets use decimal megabytes (stricter than MiB)

const ENVIRONMENTS = [
  {
    id: 'dive-bar',
    source: 'assets-src/blender/export/dive-bar.raw.glb',
    outDir: 'public/assets/env/dive-bar',
    requiredNodes: ['Background', 'Table'],
    unlitNode: 'Background',
    maxTriangles: 60_000,
    maxDrawCalls: 8,
    hdr: {
      file: 'env.hdr',
      source: 'assets-src/blender/downloads/hdris/warm_bar_1k.hdr',
      maxBytes: 1.6 * MB,
    },
    variants: [
      {
        file: 'dive-bar.glb',
        maxBytes: 2.5 * MB,
        maxTexture: 2048, // baked atlas
        tableMaxTexture: 1024,
        atlasQuality: 95, // dark gradients band at lower WebP quality
        quality: 90,
      },
      {
        file: 'dive-bar-low.glb',
        maxBytes: 1.2 * MB,
        maxTexture: 1024,
        tableMaxTexture: 512,
        atlasQuality: 90,
        quality: 85,
      },
    ],
  },
];

// The gltf-transform SDK ships inside @gltf-transform/cli (not a direct dependency): load it from there.
async function loadSdk() {
  const gt = path.dirname(fs.realpathSync(path.join(ROOT, 'node_modules', '@gltf-transform', 'cli')));
  const load = (rel) => import(pathToFileURL(path.join(gt, rel)).href);
  const [core, extensions, functions, meshopt] = await Promise.all([
    load('core/dist/index.js'),
    load('extensions/dist/index.js'),
    load('functions/dist/index.js'),
    load('../meshoptimizer/index.js'),
  ]);
  await meshopt.MeshoptEncoder.ready;
  return { core, extensions, functions, MeshoptEncoder: meshopt.MeshoptEncoder };
}

/**
 * Meshopt compression that keeps every node transform at identity: positions stay float (meshopt
 * still compresses them losslessly) and only TEXCOORDs in [0,1] are quantised (normalised uint16,
 * core glTF, no extension). gltf-transform's stock `meshopt` quantises POSITION, which moves a
 * dequantisation translate/scale onto the "Background" and "Table" nodes, a trap for app code
 * that reuses `nodes.Table.geometry` without the node's transform.
 */
async function meshoptKeepTransforms(sdk, input, output) {
  const { core, extensions, functions, MeshoptEncoder } = sdk;
  const io = new core.NodeIO().registerExtensions(extensions.ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(input);
  await doc.transform(
    functions.reorder({ encoder: MeshoptEncoder, target: 'size' }),
    functions.quantize({ pattern: /^TEXCOORD_\d+$/, quantizeTexcoord: 14 }),
  );
  doc.createExtension(extensions.EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: extensions.EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(output, doc);
}

const checkOnly = process.argv.includes('--check');
const failures = [];
const fail = (msg) => failures.push(msg);

function run(args) {
  execFileSync(BIN, args, { stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
}

/** Run gltf-transform steps in sequence through temp files. */
async function pipeline(input, output, steps) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inuman-assets-'));
  let current = input;
  for (const [i, step] of steps.entries()) {
    const next = i === steps.length - 1 ? output : path.join(tmp, `step${i}.glb`);
    if (typeof step === 'function') await step(current, next);
    else run([step[0], current, next, ...step.slice(1)]);
    current = next;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function optimise(sdk, env, variant) {
  const src = path.join(ROOT, env.source);
  const out = path.join(ROOT, env.outDir, variant.file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const size = String(variant.maxTexture);
  const tableSize = String(variant.tableMaxTexture);
  await pipeline(src, out, [
    ['dedup'],
    ['prune'], // also drops attributes no material needs (e.g. NORMAL on the unlit Background)
    ['weld'],
    ['resize', '--width', size, '--height', size],
    ['resize', '--width', tableSize, '--height', tableSize, '--pattern', 'Table_*'],
    // normal map first at higher quality, then everything still PNG/JPEG at the variant quality
    ['webp', '--quality', '92', '--effort', '90', '--pattern', 'Table_Normal'],
    ['webp', '--quality', String(variant.atlasQuality), '--effort', '90', '--pattern', 'dive-bar_atlas'],
    ['webp', '--quality', String(variant.quality), '--effort', '90', '--formats', 'png'],
    ['webp', '--quality', String(variant.quality), '--effort', '90', '--formats', 'jpeg'],
    // 14-bit UVs: the 2048 atlas needs sub-texel precision. Positions stay float (identity nodes).
    (i, o) => meshoptKeepTransforms(sdk, i, o),
  ]);
}

// ---------------------------------------------------------------------------------------------
// GLB parsing (no dependencies): JSON chunk + image headers, enough for budget checks.
function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB`);
  let offset = 12;
  let json;
  let bin;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    offset += 8 + len;
  }
  return { json, bin, bytes: buf.length };
}

function imageSize(data, mime) {
  if (mime === 'image/png') return { w: data.readUInt32BE(16), h: data.readUInt32BE(20) };
  if (mime === 'image/webp') {
    const chunk = data.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { w: 1 + data.readUIntLE(24, 3), h: 1 + data.readUIntLE(27, 3) };
    if (chunk === 'VP8L') {
      const b = data.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ') return { w: data.readUInt16LE(26) & 0x3fff, h: data.readUInt16LE(28) & 0x3fff };
  }
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i < data.length) {
      const marker = data[i + 1];
      const len = data.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { w: data.readUInt16BE(i + 7), h: data.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return { w: NaN, h: NaN };
}

function analyse(file) {
  const { json, bin, bytes } = readGlb(file);
  const accessors = json.accessors ?? [];
  const meshes = json.meshes ?? [];
  const nodes = json.nodes ?? [];
  const scene = json.scenes?.[json.scene ?? 0];
  let triangles = 0;
  let drawCalls = 0;
  const perNode = {};
  const visit = (ni, top) => {
    const node = nodes[ni];
    if (node.mesh !== undefined) {
      for (const prim of meshes[node.mesh].primitives) {
        const mode = prim.mode ?? 4;
        const count = prim.indices !== undefined ? accessors[prim.indices].count : accessors[prim.attributes.POSITION].count;
        const tris = mode === 4 ? count / 3 : mode === 5 || mode === 6 ? count - 2 : 0;
        triangles += tris;
        drawCalls += 1;
        perNode[top] = perNode[top] ?? { triangles: 0, drawCalls: 0, attributes: new Set() };
        perNode[top].triangles += tris;
        perNode[top].drawCalls += 1;
        Object.keys(prim.attributes).forEach((a) => perNode[top].attributes.add(a));
      }
    }
    (node.children ?? []).forEach((c) => visit(c, top));
  };
  const roots = scene?.nodes ?? [];
  roots.forEach((ni) => visit(ni, nodes[ni].name ?? `#${ni}`));
  const textures = (json.images ?? []).map((img) => {
    const view = json.bufferViews[img.bufferView];
    const data = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    return { name: img.name ?? '', mime: img.mimeType, bytes: view.byteLength, ...imageSize(data, img.mimeType) };
  });
  return { json, bytes, triangles, drawCalls, perNode, roots: roots.map((ni) => nodes[ni].name), textures };
}

// ---------------------------------------------------------------------------------------------
const fmtMB = (b) => `${(b / MB).toFixed(2)} MB`;

for (const env of ENVIRONMENTS) {
  console.log(`\n▸ ${env.id}`);
  const outDir = path.join(ROOT, env.outDir);
  if (!checkOnly) {
    if (!fs.existsSync(path.join(ROOT, env.source))) {
      fail(`${env.id}: missing ${env.source} (run the Blender bake: scripts/blender-run.sh assets-src/blender/build_dive_bar.py)`);
      continue;
    }
    const sdk = await loadSdk();
    for (const variant of env.variants) await optimise(sdk, env, variant);
    const hdrSrc = path.join(ROOT, env.hdr.source);
    if (fs.existsSync(hdrSrc)) fs.copyFileSync(hdrSrc, path.join(outDir, env.hdr.file));
  }

  for (const variant of env.variants) {
    const file = path.join(outDir, variant.file);
    if (!fs.existsSync(file)) {
      fail(`${variant.file}: missing`);
      continue;
    }
    const a = analyse(file);
    const label = `${env.id}/${variant.file}`;
    console.log(`  ${variant.file}: ${fmtMB(a.bytes)} (≤ ${fmtMB(variant.maxBytes)}), ${a.triangles} tris (≤ ${env.maxTriangles}), ${a.drawCalls} draw calls (≤ ${env.maxDrawCalls})`);
    for (const [name, n] of Object.entries(a.perNode)) {
      console.log(`    node ${name}: ${n.triangles} tris, ${n.drawCalls} draw call(s), attributes ${[...n.attributes].join(' ')}`);
    }
    for (const t of a.textures) {
      console.log(`    texture ${t.name || '(unnamed)'}: ${t.w}×${t.h} ${t.mime} ${(t.bytes / 1024).toFixed(0)} KB`);
    }
    if (a.bytes > variant.maxBytes) fail(`${label}: ${fmtMB(a.bytes)} exceeds ${fmtMB(variant.maxBytes)}`);
    if (a.triangles > env.maxTriangles) fail(`${label}: ${a.triangles} triangles exceeds ${env.maxTriangles}`);
    if (a.drawCalls > env.maxDrawCalls) fail(`${label}: ${a.drawCalls} draw calls exceeds ${env.maxDrawCalls}`);
    for (const t of a.textures) {
      const limit = t.name.startsWith('Table_') ? variant.tableMaxTexture : variant.maxTexture;
      if (!(t.w <= limit && t.h <= limit)) fail(`${label}: texture ${t.name} is ${t.w}×${t.h}, limit ${limit}`);
    }
    for (const name of env.requiredNodes) {
      if (!a.roots.includes(name)) fail(`${label}: top-level node "${name}" missing (have ${a.roots.join(', ')})`);
      const node = a.json.nodes.find((n) => n.name === name);
      if (node && (node.matrix || node.translation || node.rotation || node.scale)) {
        fail(`${label}: node "${name}" must keep an identity transform`);
      }
    }
    const unlit = a.json.nodes.find((n) => n.name === env.unlitNode);
    const mats = unlit ? a.json.meshes[unlit.mesh].primitives.map((p) => a.json.materials[p.material]) : [];
    if (!mats.length || !mats.every((m) => m.extensions?.KHR_materials_unlit)) {
      fail(`${label}: ${env.unlitNode} must use KHR_materials_unlit`);
    }
  }

  const hdr = path.join(outDir, env.hdr.file);
  if (!fs.existsSync(hdr)) fail(`${env.id}: missing ${env.hdr.file}`);
  else {
    const bytes = fs.statSync(hdr).size;
    console.log(`  ${env.hdr.file}: ${fmtMB(bytes)} (≤ ${fmtMB(env.hdr.maxBytes)})`);
    if (bytes > env.hdr.maxBytes) fail(`${env.id}/${env.hdr.file}: ${fmtMB(bytes)} exceeds ${fmtMB(env.hdr.maxBytes)}`);
  }
}

if (failures.length) {
  console.error(`\n✗ asset budget check failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('\n✓ all asset budgets met');
