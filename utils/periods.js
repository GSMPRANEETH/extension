/**
 * periods.js — Period arithmetic for the popup's daily / weekly / monthly selectors.
 *
 * The statistics are stored in per-period buckets ("2026-01-15", "2026-W03", "2026-01").
 * This file turns a calendar timestamp into the bucket keys for a window of periods,
 * so the popup can compare "the last 7 periods" against "the 7 periods before that"
 * even when the user did not use the extension on every single day.
 *
 * NOTE: This file is loaded as a plain script. It cannot use ES module syntax.
 * It is popup-only — the service worker never needs to look backwards.
 */

/* exported getPeriodKey, getPeriodKeys */

/**
 * Returns the bucket key for a period, shifted `offset` periods into the past.
 *
 * @param {'daily'|'weekly'|'monthly'} period Which bucket series to use
 * @param {number} timestamp Timestamp to anchor the calculation on
 * @param {number} offset How many periods to go back (0 = the current period)
 * @returns {string} The bucket key
 */
function getPeriodKey(period, timestamp, offset) {
  if (period === 'weekly') {
    return getWeekKey(timestamp - offset * 7 * 24 * 60 * 60 * 1000);
  }

  if (period === 'monthly') {
    const date = new Date(timestamp);
    // Clamp to the first of the month before shifting, so the day of the month
    // can never overflow into the next month.
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - offset);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  return getDateKey(timestamp - offset * 24 * 60 * 60 * 1000);
}

/**
 * Returns the bucket keys of the `count` periods ending with the current one,
 * newest first.
 *
 * @param {'daily'|'weekly'|'monthly'} period Which bucket series to use
 * @param {number} timestamp Timestamp to anchor the calculation on
 * @param {number} count How many periods to include
 * @returns {string[]} The bucket keys, newest first
 */
function getPeriodKeys(period, timestamp, count) {
  const keys = [];
  for (let offset = 0; offset < count; offset++) {
    keys.push(getPeriodKey(period, timestamp, offset));
  }
  return keys;
}
