#!/usr/bin/env node
// Re-download every third-party audio source listed in assets-src/audio/recipes.json into
// assets-src/audio/downloads/ (gitignored). Idempotent: existing files are kept.
//
//   node assets-src/audio/fetch.mjs            fetch what's missing
//   node assets-src/audio/fetch.mjs --force    re-fetch everything
//   node assets-src/audio/fetch.mjs --verify   also re-check each source page still shows its licence
//
// Sources: Freesound (CC0; the public HQ preview MP3s on cdn.freesound.org need no login),
// Kenney audio packs (CC0 zips, extracted with the tiny unzip below), incompetech (CC-BY 4.0).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DL = path.join(HERE, 'downloads');
const FORCE = process.argv.includes('--force');
const VERIFY = process.argv.includes('--verify');
const UA = { 'User-Agent': 'Mozilla/5.0 (inuman audio pipeline)' };

const recipes = JSON.parse(fs.readFileSync(path.join(HERE, 'recipes.json'), 'utf8'));

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: UA });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`${res.status} ${url}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

/** Minimal ZIP reader: stored + deflate entries via the central directory. */
function unzip(buf, outDir) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    const target = path.resolve(outDir, name);
    if (!target.startsWith(path.resolve(outDir) + path.sep)) throw new Error(`zip entry escapes: ${name}`);
    if (name.endsWith('/')) continue;
    const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
    const content = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null;
    if (!content) throw new Error(`unsupported zip method ${method} for ${name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

const LICENCE_MARK = {
  'CC0 1.0': /creativecommons\.org\/publicdomain\/zero\/1\.0|Creative Commons CC0|CC0/,
  'CC-BY 4.0': /creativecommons\.org\/licenses\/by\/4\.0/,
};

let fetched = 0;
for (const [id, s] of Object.entries(recipes.sources)) {
  if (s.kind === 'kenney') {
    const dir = path.join(DL, s.dir);
    if (FORCE || !fs.existsSync(dir)) {
      console.log(`↓ ${id}  ${s.zip}`);
      fs.rmSync(dir, { recursive: true, force: true });
      unzip(await get(s.zip), dir);
      fetched++;
    }
  } else if (s.download) {
    const file = path.join(DL, s.file);
    if (FORCE || !fs.existsSync(file)) {
      console.log(`↓ ${id}  ${s.download}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, await get(s.download));
      fetched++;
      if (s.kind === 'freesound') await new Promise((r) => setTimeout(r, 300)); // be polite
    }
  }
  if (VERIFY && s.url) {
    const page = (await get(s.url)).toString('utf8');
    const mark = LICENCE_MARK[s.license];
    if (!mark || !mark.test(page)) {
      console.error(`✗ ${id}: licence "${s.license}" not found on ${s.url}`);
      process.exitCode = 1;
    } else console.log(`✓ ${id}: ${s.license}`);
  }
}
console.log(fetched ? `fetched ${fetched} source(s) into ${path.relative(path.resolve(HERE, '../..'), DL)}` : 'all sources present');
