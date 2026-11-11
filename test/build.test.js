/**
 * build.test.js — tests for the service worker build step.
 *
 * The build used to be a silent no-op when the template was missing the constants
 * placeholder, which let `npm run build` overwrite background.js with a stale template
 * and reintroduced the "extension freezes" bug. These tests pin that down.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  renderServiceWorker,
  REQUIRED_CONFIG_KEYS,
  REQUIRED_DATE_HELPERS,
  INLINED_SOURCES,
  PLACEHOLDER
} = require('../scripts/build.js');
const { ROOT } = require('./helpers/load-script.js');

const TEMPLATE_PATH = path.join(ROOT, 'background', 'background.template.js');
const OUTPUT_PATH = path.join(ROOT, 'background', 'background.js');

const readTemplate = () => fs.readFileSync(TEMPLATE_PATH, 'utf8');
const readSources = () => {
  const sources = {};
  for (const source of INLINED_SOURCES) {
    sources[source.file] = fs.readFileSync(path.join(ROOT, source.file), 'utf8');
  }
  return sources;
};

describe('renderServiceWorker', () => {
  it('inlines the shared constants into the generated worker', () => {
    const output = renderServiceWorker(readTemplate(), readSources());

    expect(output).toContain('const DOOM_SCROLL_SITES = [');
    expect(output).toContain('const CONTEXT_MULTIPLIERS = {');
    expect(output).toContain('const STRONG_WARNING_FOLLOWUP    = 300;');
    expect(output).not.toContain(PLACEHOLDER);
  });

  it('inlines the shared date helpers into the generated worker', () => {
    const output = renderServiceWorker(readTemplate(), readSources());

    for (const helper of REQUIRED_DATE_HELPERS) {
      expect(output).toMatch(new RegExp(`function\\s+${helper}\\s*\\(`));
    }
    expect(output).not.toContain('/* DATES_PLACEHOLDER */');
  });

  it('wires every required config key to the shared constants', () => {
    const output = renderServiceWorker(readTemplate(), readSources());

    for (const key of REQUIRED_CONFIG_KEYS) {
      expect(output).toMatch(new RegExp(`\\b${key}\\s*:`));
    }
    expect(output).toContain('strongWarningFollowup: STRONG_WARNING_FOLLOWUP');
  });

  it('throws when the template is missing the constants placeholder', () => {
    const template = readTemplate().replace(PLACEHOLDER, '');

    expect(() => renderServiceWorker(template, readSources())).toThrow(/placeholder/i);
  });

  it('throws when the template is missing the dates placeholder', () => {
    const template = readTemplate().replace('/* DATES_PLACEHOLDER */', '');

    expect(() => renderServiceWorker(template, readSources())).toThrow(/placeholder/i);
  });

  it('throws when the shared constants no longer define STRONG_WARNING_FOLLOWUP', () => {
    const sources = readSources();
    sources['utils/constants.js'] = sources['utils/constants.js'].replace(
      'const STRONG_WARNING_FOLLOWUP',
      'const REMOVED_FOLLOWUP'
    );

    expect(() => renderServiceWorker(readTemplate(), sources)).toThrow(/STRONG_WARNING_FOLLOWUP/);
  });

  it('throws when a required config key is dropped from the template', () => {
    const template = readTemplate().replace('strongWarningFollowup: STRONG_WARNING_FOLLOWUP', '');

    expect(() => renderServiceWorker(template, readSources())).toThrow(/strongWarningFollowup/);
  });

  it('throws when contextMultipliers is dropped from DEFAULT_CONFIG even if referenced elsewhere', () => {
    const template = readTemplate().replace('contextMultipliers: { ...CONTEXT_MULTIPLIERS },', '');

    expect(() => renderServiceWorker(template, readSources())).toThrow(/contextMultipliers/);
  });

  it('throws when a required date helper is missing from the shared source', () => {
    const sources = readSources();
    sources['utils/dates.js'] = sources['utils/dates.js'].replace(
      /function getWeekKey[\s\S]*?\r?\n}\r?\n/,
      ''
    );

    expect(() => renderServiceWorker(readTemplate(), sources)).toThrow(/getWeekKey/);
  });

  it('throws when the generated worker is not valid JavaScript', () => {
    const template = readTemplate().replace('const DEFAULT_CONFIG = {', 'const DEFAULT_CONFIG = {,,,');

    expect(() => renderServiceWorker(template, readSources())).toThrow(/not valid JavaScript/);
  });
});

describe('committed build artifact', () => {
  it('background/background.js is in sync with the template and shared sources', () => {
    const committed = fs.readFileSync(OUTPUT_PATH, 'utf8');
    const expected = renderServiceWorker(readTemplate(), readSources());

    expect(committed).toBe(expected);
  });

  it('the committed worker keeps the freeze fix that the old build dropped', () => {
    const committed = fs.readFileSync(OUTPUT_PATH, 'utf8');

    expect(committed).toContain('strongWarningFollowup: STRONG_WARNING_FOLLOWUP');
    expect(committed).toContain('elapsed >= CONFIG.strongWarningFollowup');
    expect(committed).not.toContain('CONFIG.STRONG_WARNING_FOLLOWUP');
  });
});
