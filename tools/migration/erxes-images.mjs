#!/usr/bin/env node
// Product photos from the Erxes master (ADR-0098), in two phases:
//   node tools/migration/erxes-images.mjs --dir tmp/erxes/<day> --phase download
//     Fetches every link of images.json into <dir>/images/ (GET only, at most 2 at a time with a
//     pause, so the Erxes server is never strained; a file already there is never fetched again).
//   node tools/migration/erxes-images.mjs --dir tmp/erxes/<day> --phase attach --user <admin>
//     Uploads each downloaded photo to Bto and attaches it to its product (skipped when the product
//     already has a photo). The 256 px thumbnail is the photo itself when it is at most 512 KB, else
//     a scaled copy made with jimp-compact; without it such a photo is skipped and counted.
// Broken links and skipped photos are counted in <dir>/images-result.json; nothing is printed per row.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BtoApi, readLogin } from './bto-api.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const CONCURRENCY = 2;
const PAUSE_MS = 500;
const IMAGE_MAX = 5 * 1024 * 1024;
const THUMB_MAX = 512 * 1024;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((arg, i, all) => (arg.startsWith('--') ? [arg.slice(2), all[i + 1]] : null))
    .filter(Boolean),
);
if (!args.dir || !['download', 'attach'].includes(args.phase)) {
  console.error(
    'usage: erxes-images.mjs --dir <converted dir> --phase download|attach [--user <admin>]',
  );
  process.exit(1);
}
const dir = resolve(args.dir);
const folder = join(dir, 'images');
mkdirSync(folder, { recursive: true });
const links = JSON.parse(readFileSync(join(dir, 'images.json'), 'utf8'));
const resultFile = join(dir, 'images-result.json');
const result = existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, 'utf8')) : {};
const save = () => writeFileSync(resultFile, JSON.stringify(result, null, 2));

/** The image type by its first bytes (the api checks the same magic numbers). */
function typeOf(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { ext: 'jpg', mime: 'image/jpeg' };
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

const fileOf = (sku) =>
  ['jpg', 'png', 'webp'].map((ext) => join(folder, `${sku}.${ext}`)).find(existsSync);

async function download() {
  const broken = new Set(result.broken ?? []);
  const queue = links.filter(({ sku }) => !fileOf(sku) && !broken.has(sku));
  let fetched = 0;
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        const response = await fetch(next.url, { signal: AbortSignal.timeout(30_000) });
        const bytes = response.ok ? Buffer.from(await response.arrayBuffer()) : null;
        const type = bytes && bytes.length > 0 ? typeOf(bytes) : null;
        if (type && bytes.length <= IMAGE_MAX) {
          writeFileSync(join(folder, `${next.sku}.${type.ext}`), bytes);
          fetched += 1;
        } else {
          broken.add(next.sku);
        }
      } catch {
        broken.add(next.sku);
      }
      if ((fetched + broken.size) % 200 === 0) {
        result.broken = [...broken];
        save();
        console.log(`downloaded ${fetched}, broken ${broken.size}, left ${queue.length}`);
      }
      await sleep(PAUSE_MS);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  result.broken = [...broken];
  result.downloaded = links.filter(({ sku }) => fileOf(sku)).length;
  save();
  console.log(`links ${links.length}, on disk ${result.downloaded}, broken ${broken.size}`);
}

async function thumbnailOf(bytes) {
  if (bytes.length <= THUMB_MAX) return bytes;
  try {
    const Jimp = createRequire(join(ROOT, 'package.json'))('jimp-compact');
    const image = await Jimp.read(bytes);
    image.scaleToFit(256, 256);
    return await image.quality(85).getBufferAsync('image/jpeg');
  } catch {
    return null;
  }
}

async function attach() {
  if (!args.user) throw new Error('--user is required for attach');
  const api = new BtoApi({
    base: args.api ?? 'http://localhost:3300',
    user: args.user,
    password: readLogin(resolve(args.logins ?? join(ROOT, 'tmp', 'dev-logins.txt')), args.user),
  });
  const products = new Map((await api.all('/api/v1/products')).map((p) => [p.sku, p]));
  const counts = {
    attached: 0,
    alreadyHadPhoto: 0,
    notDownloaded: 0,
    noProduct: 0,
    noThumbnail: 0,
    failed: 0,
  };
  for (const { sku } of links) {
    const file = fileOf(sku);
    const product = products.get(sku);
    if (!file) counts.notDownloaded += 1;
    else if (!product) counts.noProduct += 1;
    else if (product.thumbUrl) counts.alreadyHadPhoto += 1;
    else {
      try {
        const bytes = readFileSync(file);
        const thumb = await thumbnailOf(bytes);
        if (!thumb) {
          counts.noThumbnail += 1;
          continue;
        }
        const imageFileId = await api.upload('catalog.product_image', typeOf(bytes).mime, bytes);
        const thumbFileId = await api.upload('catalog.product_thumb', typeOf(thumb).mime, thumb);
        await api.call('POST', `/api/v1/products/${product.id}/images`, {
          imageFileId,
          thumbFileId,
        });
        counts.attached += 1;
      } catch {
        counts.failed += 1;
      }
    }
    const done = Object.values(counts).reduce((a, b) => a + b, 0);
    if (done % 500 === 0) console.log(JSON.stringify(counts));
  }
  result.attach = counts;
  save();
  console.log(JSON.stringify(counts));
}

if (args.phase === 'download') await download();
else await attach();
