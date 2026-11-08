/**
 * insights.js — Pure calculations behind the popup's insights panel.
 *
 * These functions turn the raw statistics buckets into the three headline metrics
 * (focus periods, time saved, improvement trend). They are deliberately free of DOM
 * access so they can be unit tested directly, and free of hard-coded thresholds so
 * they follow the period the user selected in the popup.
 *
 * NOTE: This file is loaded as a plain script. It cannot use ES module syntax.
 */

/* exported PERIOD_STAT_KEYS, PERIOD_UNIT_LABELS, TREND_WINDOW, getPeriodWindows, sumBucketField, calculateFocusSessions, calculateTimeSaved, calculateImprovementTrend */

/**
 * The statistics bucket that backs each period selector option.
 */
const PERIOD_STAT_KEYS = {
  daily: 'dailyStats',
  weekly: 'weeklyStats',
  monthly: 'monthlyStats'
};

/**
 * Singular label for one unit of the active period.
 */
const PERIOD_UNIT_LABELS = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month'
};

/**
 * How many periods make up one comparison window (7 days / weeks / months).
 */
const TREND_WINDOW = 7;

/**
 * Builds the comparison windows for a period: the current window of TREND_WINDOW
 * periods and the TREND_WINDOW periods before it.
 *
 * The windows are anchored on the calendar rather than on the buckets that happen to
 * exist, so a day without activity counts as a day without activity instead of
 * silently disappearing from the comparison.
 *
 * @param {object} stats The full statistics object from chrome.storage
 * @param {'daily'|'weekly'|'monthly'} period Which bucket series to use
 * @param {number} now Timestamp to anchor the calculation on
 * @returns {{buckets: object, currentKeys: string[], previousKeys: string[]}}
 */
function getPeriodWindows(stats, period, now) {
  const buckets = (stats && stats[PERIOD_STAT_KEYS[period]]) || {};
  return {
    buckets,
    currentKeys: getPeriodKeys(period, now, TREND_WINDOW),
    previousKeys: getPeriodKeys(period, now, TREND_WINDOW * 2).slice(TREND_WINDOW)
  };
}

/**
 * Sums one numeric field across a list of buckets.
 */
function sumBucketField(buckets, keys, field) {
  return keys.reduce((total, key) => total + (buckets[key]?.[field] || 0), 0);
}

/**
 * Counts the periods in the current window that had browsing activity but never
 * triggered a warning.
 */
function calculateFocusSessions(stats, period, now) {
  const { buckets, currentKeys } = getPeriodWindows(stats, period, now);
  return currentKeys.filter((key) => {
    const bucket = buckets[key] || {};
    return (bucket.sessionTime || 0) > 0 && (bucket.warningsTriggered || 0) === 0;
  }).length;
}

/**
 * Estimates the browsing time reclaimed by using less time than in the previous window.
 */
function calculateTimeSaved(stats, period, now) {
  const { buckets, currentKeys, previousKeys } = getPeriodWindows(stats, period, now);
  if (previousKeys.length === 0) return 0;

  const current = sumBucketField(buckets, currentKeys, 'sessionTime');
  const previous = sumBucketField(buckets, previousKeys, 'sessionTime');
  return Math.max(0, previous - current);
}

/**
 * Compares the number of warnings in the current window with the previous one.
 * A negative percentage means fewer warnings, which is an improvement.
 */
function calculateImprovementTrend(stats, period, now) {
  const { buckets, currentKeys, previousKeys } = getPeriodWindows(stats, period, now);
  if (previousKeys.length === 0) return '—';

  const before = sumBucketField(buckets, previousKeys, 'warningsTriggered');
  const after = sumBucketField(buckets, currentKeys, 'warningsTriggered');

  if (before === 0) return after === 0 ? '—' : '↑ new';
  const percent = Math.round(((after - before) / before) * 100);
  if (percent === 0) return '0%';
  return percent < 0 ? `↓ ${Math.abs(percent)}%` : `↑ ${percent}%`;
}
