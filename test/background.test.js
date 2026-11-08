/**
 * background.test.js — tests for the service worker.
 *
 * These tests exercise the *shipped* artifact (background/background.js) rather than a
 * re-implementation, so a regression in the real file fails the suite. The file is a
 * classic (non-module) service worker script, so it is loaded into a VM context with a
 * mocked `chrome` API and the top-level bindings are pulled out with an export statement.
 */

'use strict';

const { loadScript, settle } = require('./helpers/load-script.js');

/* ─── Controllable clock ─────────────────────────────────────────────────── */
// The worker reads Date.now() to decide when a follow-up reminder is due, so the tests
// need to move time forward deterministically.
let currentTime = Date.UTC(2026, 0, 15, 12, 0, 0);

class ControllableDate extends Date {
  constructor(...args) {
    super(...(args.length > 0 ? args : [currentTime]));
  }

  static now() {
    return currentTime;
  }
}

const setTime = (timestamp) => {
  currentTime = timestamp;
};

const advance = (seconds) => {
  currentTime += seconds * 1000;
};

// The worker exposes mutable state through `let` bindings that are reassigned at
// runtime, so they are pulled out through getter functions rather than snapshots.
const EXPORTS = [
  'DEFAULT_CONFIG',
  'getConfig: () => CONFIG',
  'getSessions: () => sessions',
  'calculateScore',
  'getDateKey',
  'getWeekKey',
  'getMonthKey',
  'handleActivityReport'
].join(', ');

/**
 * Load the service worker and wait for its async configuration load to finish.
 */
async function loadWorker() {
  const loaded = loadScript('background/background.js', {
    exportBody: EXPORTS,
    globals: { Date: ControllableDate }
  });
  await settle();
  return loaded;
}

/**
 * A report that produces a raw score of 45 before the context multiplier is applied
 * (200s of session time + 40 scrolls), which lands in the "warning" band.
 */
const warningReport = (overrides = {}) => ({
  hostname: 'example.com',
  url: 'https://example.com/feed',
  pageContext: 'news_feed',
  sessionDuration: 200,
  scrollCount: 40,
  keyPressCount: 0,
  bottomReachedCount: 0,
  shortVideoCount: 0,
  idleTime: 100,
  longVideoDetected: false,
  ...overrides
});

/**
 * A report that produces a raw score of 130, which is above the strong-warning band.
 */
const strongReport = (overrides = {}) => ({
  hostname: 'example.com',
  url: 'https://example.com/feed',
  pageContext: 'news_feed',
  sessionDuration: 400,
  scrollCount: 70,
  keyPressCount: 40,
  bottomReachedCount: 5,
  shortVideoCount: 10,
  idleTime: 0,
  longVideoDetected: false,
  ...overrides
});

describe('service worker configuration', () => {
  let worker;

  beforeEach(async () => {
    worker = await loadWorker();
  });

  it('loads the shared thresholds rather than private copies', () => {
    const config = worker.exports.getConfig();

    expect(config.scoreThresholds).toEqual({ SAFE: 25, WARNING: 40, STRONG_WARNING: 65 });
    expect(config.contextMultipliers.short_form_feed).toBe(1.5);
    expect(config.contextMultipliers.productive).toBe(0);
  });

  it('keeps the freeze-fix follow-up delay', () => {
    // The old build dropped this key, which made `elapsed >= undefined` always false
    // and left the extension stuck on the strong-warning overlay.
    expect(worker.exports.getConfig().strongWarningFollowup).toBe(300);
  });

  it('mirrors the shared site lists', () => {
    const config = worker.exports.getConfig();

    expect(config.doomScrollSites).toEqual(expect.arrayContaining(['youtube.com', 'tiktok.com']));
    expect(config.productiveSites).toEqual(expect.arrayContaining(['github.com']));
  });

  it('uses the shared timing constants', () => {
    const config = worker.exports.getConfig();

    expect(config.activityReportInterval).toBe(15000);
    expect(config.breakDuration).toBe(600000);
    expect(config.continueRearmDelay).toBe(180);
    expect(config.popupRefreshInterval).toBe(5000);
  });
});

describe('calculateScore', () => {
  let worker;

  beforeEach(async () => {
    worker = await loadWorker();
  });

  it('applies the context multiplier to the raw score', () => {
    const raw = worker.exports.calculateScore(strongReport({ pageContext: 'news_feed' }));
    const boosted = worker.exports.calculateScore(strongReport({ pageContext: 'short_form_feed' }));

    expect(raw).toBe(130);
    expect(boosted).toBe(195);
  });

  it('never scores a productive page above zero', () => {
    expect(worker.exports.calculateScore(strongReport({ pageContext: 'productive' }))).toBe(0);
  });

  it('falls back to the unknown multiplier for unrecognised contexts', () => {
    const unknown = worker.exports.calculateScore(strongReport({ pageContext: 'mystery' }));
    const explicit = worker.exports.calculateScore(strongReport({ pageContext: 'unknown' }));

    expect(unknown).toBe(explicit);
    expect(unknown).toBe(65);
  });

  it('penalises long-form video watching', () => {
    const withLongVideo = worker.exports.calculateScore(
      strongReport({ pageContext: 'news_feed', longVideoDetected: true })
    );
    const withoutLongVideo = worker.exports.calculateScore(
      strongReport({ pageContext: 'news_feed', longVideoDetected: false })
    );

    expect(withLongVideo).toBeLessThan(withoutLongVideo);
  });
});

describe('date bucket keys', () => {
  let worker;

  beforeEach(async () => {
    worker = await loadWorker();
  });

  it('formats daily keys as YYYY-MM-DD', () => {
    expect(worker.exports.getDateKey(Date.UTC(2026, 0, 5))).toBe('2026-01-05');
  });

  it('formats monthly keys as YYYY-MM', () => {
    expect(worker.exports.getMonthKey(Date.UTC(2026, 0, 5))).toBe('2026-01');
  });

  it('formats weekly keys as ISO-8601 YYYY-Www', () => {
    expect(worker.exports.getWeekKey(Date.UTC(2026, 10, 8))).toBe('2026-W45');
    expect(worker.exports.getWeekKey(Date.UTC(2026, 0, 1))).toBe('2026-W01');
    expect(worker.exports.getWeekKey(Date.UTC(2026, 11, 31))).toBe('2026-W53');
  });

  it('rolls the ISO year over for dates at the end of December', () => {
    // 2018-12-31 is a Monday, which belongs to ISO week 1 of 2019.
    expect(worker.exports.getWeekKey(Date.UTC(2018, 11, 31))).toBe('2019-W01');
    // 2020-12-31 is a Thursday and still belongs to 2020.
    expect(worker.exports.getWeekKey(Date.UTC(2020, 11, 31))).toBe('2020-W53');
  });

  it('handles the first days of January that belong to the previous ISO year', () => {
    expect(worker.exports.getWeekKey(Date.UTC(2021, 0, 1))).toBe('2020-W53');
    expect(worker.exports.getWeekKey(Date.UTC(2016, 0, 1))).toBe('2015-W53');
  });
});

describe('handleActivityReport', () => {
  let worker;

  beforeEach(async () => {
    setTime(Date.UTC(2026, 0, 15, 12, 0, 0));
    worker = await loadWorker();
  });

  it('warns when the score crosses the warning threshold', async () => {
    await worker.exports.handleActivityReport(1, warningReport());

    expect(worker.calls.tabsSendMessage).toHaveLength(1);
    expect(worker.calls.tabsSendMessage[0].message).toMatchObject({
      type: 'SHOW_WARNING',
      level: 'warning'
    });
  });

  it('escalates to a strong warning when the score crosses the strong threshold', async () => {
    await worker.exports.handleActivityReport(2, strongReport());

    expect(worker.calls.tabsSendMessage).toHaveLength(1);
    expect(worker.calls.tabsSendMessage[0].message.level).toBe('strong');
  });

  it('does not warn on productive pages', async () => {
    await worker.exports.handleActivityReport(3, strongReport({ pageContext: 'productive' }));

    expect(worker.calls.tabsSendMessage).toHaveLength(0);
  });

  it('does not warn when the extension is disabled', async () => {
    await worker.chrome.storage.local.set({ dsbSettings: { enabled: false } });

    await worker.exports.handleActivityReport(4, strongReport());

    expect(worker.calls.tabsSendMessage).toHaveLength(0);
  });

  it('does not warn for whitelisted domains', async () => {
    await worker.chrome.storage.local.set({ dsbSettings: { whitelist: ['example.com'] } });

    await worker.exports.handleActivityReport(5, strongReport());

    expect(worker.calls.tabsSendMessage).toHaveLength(0);
  });

  it('sends a final reminder once the follow-up delay has elapsed', async () => {
    await worker.exports.handleActivityReport(6, strongReport());
    expect(worker.calls.tabsSendMessage).toHaveLength(1);
    expect(worker.calls.tabsSendMessage[0].message.level).toBe('strong');

    advance(299);
    await worker.exports.handleActivityReport(6, strongReport());
    expect(worker.calls.tabsSendMessage).toHaveLength(1);

    advance(1);
    await worker.exports.handleActivityReport(6, strongReport());

    expect(worker.calls.tabsSendMessage).toHaveLength(2);
    expect(worker.calls.tabsSendMessage[1].message.message).toMatch(/Final reminder/);
  });

  it('aggregates statistics into daily, weekly and monthly buckets', async () => {
    await worker.exports.handleActivityReport(7, warningReport());

    const statsCall = worker.calls.storageSet.find((entry) => entry.dsbStats);
    expect(statsCall).toBeDefined();

    const { dailyStats, weeklyStats, monthlyStats } = statsCall.dsbStats;
    expect(Object.keys(dailyStats)).toEqual(['2026-01-15']);
    expect(Object.keys(weeklyStats)).toEqual(['2026-W03']);
    expect(Object.keys(monthlyStats)).toEqual(['2026-01']);
    expect(dailyStats['2026-01-15'].scrollCount).toBe(40);
  });
});
