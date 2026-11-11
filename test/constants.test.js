/**
 * constants.test.js — tests for the shared constants file.
 *
 * utils/constants.js is the single source of truth for every threshold, timer and site
 * list in the extension. The background worker gets a copy inlined at build time; the
 * content scripts and the popup get the file loaded directly. These tests make sure the
 * file stays complete and that every consumer really does read from it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { loadScript, ROOT } = require('./helpers/load-script.js');

const CONSTANT_NAMES = [
  'DOOM_SCROLL_SITES',
  'PRODUCTIVE_SITES',
  'CONTEXT_MULTIPLIERS',
  'SCORE_THRESHOLDS',
  'MOTIVATIONAL_MESSAGES',
  'ACTIVITY_REPORT_INTERVAL',
  'IDLE_THRESHOLD',
  'SCROLL_THROTTLE',
  'SNOOZE_DURATION',
  'LONG_VIDEO_THRESHOLD',
  'SHORT_VIDEO_THRESHOLD',
  'BOTTOM_DETECTION_THRESHOLD',
  'WHEEL_DELTA_THRESHOLD',
  'SWIPE_THRESHOLD',
  'POPUP_REFRESH_INTERVAL',
  'BREAK_DURATION',
  'BREAK_MIN_DURATION',
  'CONTINUE_REARM_DELAY',
  'SECTION_CHECK_INTERVAL',
  'VIDEO_SCROLL_THRESHOLD',
  'MIN_CODE_BLOCKS_PRODUCTIVE',
  'STRONG_WARNING_FOLLOWUP'
];

const loaded = loadScript('utils/constants.js', { exportBody: CONSTANT_NAMES.join(', ') });
const constants = loaded.exports;

describe('utils/constants.js', () => {
  it('exports every shared constant', () => {
    for (const name of CONSTANT_NAMES) {
      expect(constants[name]).toBeDefined();
    }
  });

  it('keeps the freeze-fix follow-up delay at five minutes', () => {
    expect(constants.STRONG_WARNING_FOLLOWUP).toBe(300);
  });

  it('keeps the score thresholds consistent with the warning levels', () => {
    expect(constants.SCORE_THRESHOLDS).toEqual({ SAFE: 25, WARNING: 40, STRONG_WARNING: 65 });
    expect(constants.SCORE_THRESHOLDS.SAFE).toBeLessThan(constants.SCORE_THRESHOLDS.WARNING);
    expect(constants.SCORE_THRESHOLDS.WARNING).toBeLessThan(constants.SCORE_THRESHOLDS.STRONG_WARNING);
  });

  it('never weights productive pages above zero', () => {
    expect(constants.CONTEXT_MULTIPLIERS.productive).toBe(0);
    expect(constants.CONTEXT_MULTIPLIERS.search).toBeLessThan(1);
    expect(constants.CONTEXT_MULTIPLIERS.video_player).toBeLessThan(1);
    expect(constants.CONTEXT_MULTIPLIERS.short_form_feed).toBeGreaterThan(1);
  });

  it('lists the sites the extension is meant to guard against', () => {
    expect(constants.DOOM_SCROLL_SITES).toContain('youtube.com');
    expect(constants.DOOM_SCROLL_SITES).toContain('tiktok.com');
    expect(constants.PRODUCTIVE_SITES).toContain('github.com');
    expect(constants.PRODUCTIVE_SITES).toContain('stackoverflow.com');
  });

  it('keeps the two site lists disjoint', () => {
    const overlap = constants.DOOM_SCROLL_SITES.filter((site) =>
      constants.PRODUCTIVE_SITES.includes(site)
    );
    expect(overlap).toEqual([]);
  });
});

describe('consumers of the shared constants', () => {
  it('loads the constants in every content script context', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const scripts = manifest.content_scripts.flatMap((entry) => entry.js);

    expect(scripts[0]).toBe('utils/constants.js');
    expect(scripts).toContain('content/content.js');
    expect(scripts).toContain('content/overlay.js');
  });

  it('loads every shared source in the popup before popup.js', () => {
    const html = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');
    const popupAt = html.indexOf('src="popup.js"');

    expect(popupAt).toBeGreaterThan(-1);
    for (const shared of ['constants.js', 'dates.js', 'periods.js', 'insights.js']) {
      const at = html.indexOf(`../utils/${shared}`);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(popupAt);
    }
  });

  it('does not duplicate threshold values in the popup', () => {
    const source = fs.readFileSync(path.join(ROOT, 'popup', 'popup.js'), 'utf8');

    expect(source).toContain('...CONTEXT_MULTIPLIERS');
    expect(source).toContain('...SCORE_THRESHOLDS');
    expect(source).not.toMatch(/const POPUP_REFRESH_INTERVAL\s*=/);
  });
});
