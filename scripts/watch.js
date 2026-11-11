#!/usr/bin/env node
/**
 * watch.js — rebuilds the service worker whenever a shared source changes.
 *
 * Uses Node's built-in fs.watch so the repository does not need a file-watching
 * dependency. The build itself lives in scripts/build.js and reports its own errors.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD_SCRIPT = path.join(__dirname, 'build.js');

/** Files that feed into the generated service worker. */
const WATCHED = ['utils/constants.js', 'utils/dates.js', 'background/background.template.js'];

const DEBOUNCE_MS = 100;

let pending = null;

function build() {
  try {
    execFileSync(process.execPath, [BUILD_SCRIPT], { stdio: 'inherit' });
  } catch (err) {
    // scripts/build.js already printed the reason — keep watching so the next
    // edit can fix it.
  }
}

function scheduleBuild(file) {
  clearTimeout(pending);
  pending = setTimeout(() => {
    console.log(`\n🔁 ${file} changed — rebuilding…`);
    build();
  }, DEBOUNCE_MS);
}

build();

// Watch parent directories instead of individual file paths so atomic saves
// (temp-file + rename on Linux/macOS) cannot orphan the watcher on a stale inode.
const watchedByDir = new Map();
for (const file of WATCHED) {
  const absPath = path.join(ROOT, file);
  const dir = path.dirname(absPath);
  const base = path.basename(absPath);
  if (!watchedByDir.has(dir)) {
    watchedByDir.set(dir, new Map());
  }
  watchedByDir.get(dir).set(base, file);
}

for (const [dir, targets] of watchedByDir.entries()) {
  fs.watch(dir, { persistent: true }, (_eventType, filename) => {
    if (!filename) {
      scheduleBuild(Array.from(targets.values()).join(', '));
      return;
    }
    const matched = targets.get(filename.toString());
    if (matched) {
      scheduleBuild(matched);
    }
  });
}

console.log(`👀 Watching ${WATCHED.join(', ')}. Press Ctrl+C to stop.`);
