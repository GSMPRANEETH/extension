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

for (const file of WATCHED) {
  fs.watch(path.join(ROOT, file), { persistent: true }, () => scheduleBuild(file));
}

console.log(`👀 Watching ${WATCHED.join(', ')}. Press Ctrl+C to stop.`);
