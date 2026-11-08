/**
 * dates.js — Shared date-bucket helpers.
 *
 * The extension groups activity statistics into daily, weekly and monthly buckets.
 * The bucket keys must be identical everywhere they are produced or compared, so the
 * helpers live here and are inlined into the service worker at build time
 * (see scripts/build.js) and loaded directly by the popup.
 *
 * NOTE: This file is loaded as a plain script. It cannot use ES module syntax.
 */

/* exported getDateKey, getWeekKey, getMonthKey */

/**
 * Returns the daily bucket key (YYYY-MM-DD) for a timestamp.
 */
function getDateKey(timestamp) {
  const date = new Date(timestamp);
  return date.toISOString().split('T')[0];
}

/**
 * Returns the ISO-8601 weekly bucket key (YYYY-Www) for a timestamp.
 *
 * ISO 8601 weeks start on Monday, and week 1 is the week containing January 4th.
 * The Thursday of a week determines which ISO year that week belongs to, which is why
 * a date in late December can belong to week 1 of the following year.
 */
function getWeekKey(timestamp) {
  const date = new Date(timestamp);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7; // Monday = 0 … Sunday = 6
  target.setUTCDate(target.getUTCDate() - dayNumber + 3); // shift to the Thursday of this week

  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);

  const week =
    1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * Returns the monthly bucket key (YYYY-MM) for a timestamp.
 */
function getMonthKey(timestamp) {
  const date = new Date(timestamp);
  return date.toISOString().substring(0, 7);
}
