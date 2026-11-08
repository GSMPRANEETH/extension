/**
 * insights.test.js — tests for the popup's insight calculations.
 *
 * The insights panel used to show placeholders ("—") and a hard-coded daily limit, and
 * the Daily / Weekly / Monthly buttons changed nothing but the button styling. These
 * tests pin down that the panel now reports the selected period and that the numbers
 * come from the stored buckets rather than from a constant.
 */

'use strict';

const { loadScript } = require('./helpers/load-script.js');

// utils/insights.js calls into utils/periods.js, which calls into utils/dates.js.
const dates = loadScript('utils/dates.js', {
  exportBody: 'getDateKey, getWeekKey, getMonthKey'
}).exports;

const periods = loadScript('utils/periods.js', {
  exportBody: 'getPeriodKey, getPeriodKeys',
  globals: { ...dates }
}).exports;

const insights = loadScript('utils/insights.js', {
  exportBody: [
    'PERIOD_STAT_KEYS',
    'PERIOD_UNIT_LABELS',
    'TREND_WINDOW',
    'getPeriodWindows',
    'sumBucketField',
    'calculateFocusSessions',
    'calculateTimeSaved',
    'calculateImprovementTrend'
  ].join(', '),
  globals: { ...dates, ...periods }
}).exports;

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0); // Thursday 2026-01-15

/** Builds a statistics object with one bucket per supplied key. */
function makeStats(series, buckets) {
  return { [series]: buckets };
}

describe('period arithmetic', () => {
  it('steps one day back for the daily series', () => {
    expect(periods.getPeriodKey('daily', NOW, 0)).toBe('2026-01-15');
    expect(periods.getPeriodKey('daily', NOW, 1)).toBe('2026-01-14');
    expect(periods.getPeriodKey('daily', NOW, 7)).toBe('2026-01-08');
  });

  it('steps one ISO week back for the weekly series', () => {
    expect(periods.getPeriodKey('weekly', NOW, 0)).toBe('2026-W03');
    expect(periods.getPeriodKey('weekly', NOW, 1)).toBe('2026-W02');
  });

  it('steps one month back for the monthly series', () => {
    expect(periods.getPeriodKey('monthly', NOW, 0)).toBe('2026-01');
    expect(periods.getPeriodKey('monthly', NOW, 1)).toBe('2025-12');
    expect(periods.getPeriodKey('monthly', NOW, 3)).toBe('2025-10');
  });

  it('never overflows when shifting months from a late-month date', () => {
    const endOfMonth = Date.UTC(2026, 0, 31, 12, 0, 0);

    expect(periods.getPeriodKey('monthly', endOfMonth, 1)).toBe('2025-12');
  });

  it('returns the requested number of keys, newest first', () => {
    const keys = periods.getPeriodKeys('daily', NOW, 3);

    expect(keys).toEqual(['2026-01-15', '2026-01-14', '2026-01-13']);
  });
});

describe('getPeriodWindows', () => {
  it('splits the timeline into the current and the previous window', () => {
    const { currentKeys, previousKeys } = insights.getPeriodWindows({}, 'daily', NOW);

    expect(currentKeys).toHaveLength(insights.TREND_WINDOW);
    expect(previousKeys).toHaveLength(insights.TREND_WINDOW);
    expect(currentKeys[0]).toBe('2026-01-15');
    expect(previousKeys[0]).toBe('2026-01-08');
  });

  it('reads the bucket series that matches the selected period', () => {
    const stats = makeStats('weeklyStats', { '2026-W03': { sessionTime: 10 } });

    expect(insights.getPeriodWindows(stats, 'weekly', NOW).buckets['2026-W03']).toEqual({
      sessionTime: 10
    });
    expect(insights.getPeriodWindows(stats, 'daily', NOW).buckets).toEqual({});
  });
});

describe('calculateFocusSessions', () => {
  it('counts the periods with activity and no warning', () => {
    const stats = makeStats('dailyStats', {
      '2026-01-15': { sessionTime: 120, warningsTriggered: 0 },
      '2026-01-14': { sessionTime: 300, warningsTriggered: 2 },
      '2026-01-13': { sessionTime: 60, warningsTriggered: 0 }
    });

    expect(insights.calculateFocusSessions(stats, 'daily', NOW)).toBe(2);
  });

  it('does not count periods without any activity', () => {
    const stats = makeStats('dailyStats', {
      '2026-01-15': { sessionTime: 0, warningsTriggered: 0 }
    });

    expect(insights.calculateFocusSessions(stats, 'daily', NOW)).toBe(0);
  });
});

describe('calculateTimeSaved', () => {
  it('reports the difference against the previous window', () => {
    const stats = makeStats('dailyStats', {
      '2026-01-15': { sessionTime: 100 },
      '2026-01-08': { sessionTime: 400 }
    });

    expect(insights.calculateTimeSaved(stats, 'daily', NOW)).toBe(300);
  });

  it('never reports a negative amount of saved time', () => {
    const stats = makeStats('dailyStats', {
      '2026-01-15': { sessionTime: 900 },
      '2026-01-08': { sessionTime: 100 }
    });

    expect(insights.calculateTimeSaved(stats, 'daily', NOW)).toBe(0);
  });

  it('reports nothing when there is no previous window to compare against', () => {
    expect(insights.calculateTimeSaved({}, 'daily', NOW)).toBe(0);
  });
});

describe('calculateImprovementTrend', () => {
  it('reports fewer warnings as an improvement', () => {
    const stats = makeStats('dailyStats', {
      '2026-01-15': { warningsTriggered: 2 },
      '2026-01-08': { warningsTriggered: 4 }
    });

    expect(insights.calculateImprovementTrend(stats, 'daily', NOW)).toBe('↓ 50%');
  });

  it('reports more warnings as a regression', () => {
    const stats = makeStats('dailyStats', {
      '2026-01-15': { warningsTriggered: 6 },
      '2026-01-08': { warningsTriggered: 4 }
    });

    expect(insights.calculateImprovementTrend(stats, 'daily', NOW)).toBe('↑ 50%');
  });

  it('reports no change as 0%', () => {
    const stats = makeStats('dailyStats', {
      '2026-01-15': { warningsTriggered: 3 },
      '2026-01-08': { warningsTriggered: 3 }
    });

    expect(insights.calculateImprovementTrend(stats, 'daily', NOW)).toBe('0%');
  });

  it('reports nothing when the previous window has no data', () => {
    expect(insights.calculateImprovementTrend({}, 'daily', NOW)).toBe('—');
  });
});
