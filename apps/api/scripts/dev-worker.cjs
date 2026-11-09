'use strict';
// `pnpm dev`'s worker without a compiler of its own (owner 2026-11-09: one compiler instead of two,
// about 1.3 GB less memory). The api's `nest start --watch` already compiles all of src/, worker.ts
// included, into dist/; this runs dist/worker.js and restarts it once dist/ has been quiet for a
// moment after a change, so a compile that rewrites many files gives one restart, not one per file.
// Spawned without a shell, so the spaces in the repository path are safe.
const { spawn } = require('node:child_process');
const { existsSync, statSync, watch } = require('node:fs');
const { join } = require('node:path');

const dist = join(__dirname, '..', 'dist');
const entry = join(dist, 'worker.js');
const QUIET_MS = 1500;

let child = null;
let timer = null;
let stopping = false;

function log(message) {
  console.log(`[dev-worker] ${message}`);
}

function start() {
  if (!existsSync(entry)) {
    log('waiting for the api compile to write dist/worker.js');
    return;
  }
  child = spawn(process.execPath, ['--enable-source-maps', entry], { stdio: 'inherit' });
  const current = child;
  current.on('exit', (code, signal) => {
    if (child === current) {
      child = null;
      if (!stopping) log(`worker exited (${signal ?? code}); waiting for the next change`);
    }
  });
}

function restart() {
  timer = null;
  if (stopping) return;
  if (child) {
    const old = child;
    child = null;
    old.once('exit', start);
    old.kill();
  } else {
    start();
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(restart, QUIET_MS);
}

// dist/ is deleted and recreated whenever the api's compiler starts (deleteOutDir). On Windows a watch
// on the deleted folder goes silent without an error, so the folder's identity is checked every second
// and a new folder is watched anew.
let watcher = null;
let watchedId = null;

function folderId() {
  try {
    const s = statSync(dist);
    return `${s.ino}:${s.birthtimeMs}`;
  } catch {
    return null;
  }
}

function checkFolder() {
  const id = folderId();
  if (id === watchedId) return;
  if (watcher) watcher.close();
  watcher = null;
  watchedId = id;
  if (id === null) return;
  try {
    watcher = watch(dist, { recursive: true }, (_event, file) => {
      if (file && /\.(js|json)$/.test(file)) schedule();
    });
    watcher.on('error', () => {
      watcher?.close();
      watcher = null;
      watchedId = null;
    });
  } catch {
    watchedId = null;
    return;
  }
  schedule();
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(signal, () => {
    stopping = true;
    if (child) child.kill();
    process.exit(0);
  });
}

checkFolder();
setInterval(checkFolder, 1000);
