#!/usr/bin/env node
/**
 * build.js — generates background/background.js from background/background.template.js.
 *
 * The template is the source of truth for the service worker. This script inlines the
 * shared sources from utils/ at the placeholder markers declared below, so the service
 * worker, the content scripts and the popup all read the same constants and date helpers.
 *
 * The previous version of this script silently no-op'd when the marker was missing, so a
 * build overwrote background.js with a stale copy of the template and reintroduced the
 * "extension freezes" bug — STRONG_WARNING_FOLLOWUP went missing and the final-reminder
 * check compared against `undefined`. It now fails loudly and validates its output.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'background', 'background.template.js');
const OUTPUT_PATH = path.join(ROOT, 'background', 'background.js');

/**
 * Shared sources inlined into the service worker, in the order they are substituted.
 * The popup loads these same files directly via <script> tags; the content scripts load
 * utils/constants.js through the manifest.
 */
const INLINED_SOURCES = [
  { placeholder: '/* CONSTANTS_PLACEHOLDER */', file: 'utils/constants.js', label: 'constants' },
  { placeholder: '/* DATES_PLACEHOLDER */', file: 'utils/dates.js', label: 'date helpers' }
];

const PLACEHOLDER = INLINED_SOURCES[0].placeholder;

/**
 * Keys the generated service worker must expose on CONFIG. A missing key means the
 * extension misbehaves at runtime, so the build fails instead of shipping it.
 */
const REQUIRED_CONFIG_KEYS = [
  'doomScrollSites',
  'productiveSites',
  'contextMultipliers',
  'scoreThresholds',
  'motivationalMessages',
  'activityReportInterval',
  'idleThreshold',
  'scrollThrottle',
  'snoozeDuration',
  'longVideoThreshold',
  'shortVideoThreshold',
  'bottomDetectionThreshold',
  'wheelDeltaThreshold',
  'swipeThreshold',
  'popupRefreshInterval',
  'breakDuration',
  'breakMinDuration',
  'continueRearmDelay',
  'sectionCheckInterval',
  'videoScrollThreshold',
  'minCodeBlocksProductive',
  'motivationalMessageFrequency',
  'strongWarningFollowup'
];

/**
 * Date helpers the generated service worker must define. The popup depends on the same
 * bucket keys, so a rename here has to be a build failure rather than a silent mismatch.
 */
const REQUIRED_DATE_HELPERS = ['getDateKey', 'getWeekKey', 'getMonthKey'];

/**
 * Render the service worker source from the template and the shared sources.
 *
 * Throws instead of returning a broken file — the build is a gate, not a best-effort
 * transform. `template` and `sources` are injected so this is unit-testable without
 * touching the filesystem.
 *
 * @param {string} template Contents of background/background.template.js
 * @param {Record<string, string>} sources Map of relative file path -> file contents
 * @returns {string} The generated service worker source
 */
function renderServiceWorker(template, sources) {
  for (const source of INLINED_SOURCES) {
    if (!template.includes(source.placeholder)) {
      throw new Error(
        `background/background.template.js does not contain the ${source.label} placeholder marker. ` +
          `The build inlines ${source.file} at that marker; without it the generated ` +
          'background.js would be a stale copy of the template.'
      );
    }
  }

  if (!sources['utils/constants.js'].includes('const STRONG_WARNING_FOLLOWUP')) {
    throw new Error('utils/constants.js no longer defines STRONG_WARNING_FOLLOWUP.');
  }

  let output = template;
  for (const source of INLINED_SOURCES) {
    output = output.replace(source.placeholder, sources[source.file]);
  }

  const missing = REQUIRED_CONFIG_KEYS.filter((key) => !new RegExp(`\\b${key}\\s*:`).test(output));
  if (missing.length > 0) {
    throw new Error(
      'generated background.js is missing required config keys:\n   - ' + missing.join('\n   - ')
    );
  }

  // Guard the exact regression this script used to hide.
  if (!output.includes('strongWarningFollowup: STRONG_WARNING_FOLLOWUP')) {
    throw new Error(
      'generated background.js does not wire strongWarningFollowup to STRONG_WARNING_FOLLOWUP.'
    );
  }

  const missingHelpers = REQUIRED_DATE_HELPERS.filter(
    (name) => !new RegExp(`function\\s+${name}\\s*\\(`).test(output)
  );
  if (missingHelpers.length > 0) {
    throw new Error(
      'generated background.js is missing required date helpers:\n   - ' +
        missingHelpers.join('\n   - ')
    );
  }

  // The template used to drift out of sync with the generated file — a missing object
  // separator made the template a syntax error, and the stale build script shipped the
  // template anyway. Compiling the output catches that class of mistake before it ships.
  try {
    new vm.Script(output, { filename: 'background/background.js' });
  } catch (err) {
    throw new Error(`generated background.js is not valid JavaScript: ${err.message}`);
  }

  return output;
}

function main() {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const sources = {};
  for (const source of INLINED_SOURCES) {
    sources[source.file] = fs.readFileSync(path.join(ROOT, source.file), 'utf8');
  }

  let output;
  try {
    output = renderServiceWorker(template, sources);
  } catch (err) {
    console.error(`\n❌ Build failed: ${err.message}\n`);
    process.exit(1);
  }

  fs.writeFileSync(OUTPUT_PATH, output);

  console.log('✅ background/background.js generated from background/background.template.js');
  for (const source of INLINED_SOURCES) {
    console.log(`   ${source.label} inlined from ${source.file}`);
  }
  console.log(`   ${REQUIRED_CONFIG_KEYS.length} required config keys verified`);
  console.log(`   ${REQUIRED_DATE_HELPERS.length} required date helpers verified`);
}

if (require.main === module) {
  main();
}

module.exports = {
  renderServiceWorker,
  REQUIRED_CONFIG_KEYS,
  REQUIRED_DATE_HELPERS,
  INLINED_SOURCES,
  PLACEHOLDER
};
