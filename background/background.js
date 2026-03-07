/**
 * background.js — Doom Scroll Blocker service worker.
 *
 * Responsibilities:
 *  1. Receive ACTIVITY_REPORT messages from content scripts.
 *  2. Run the doom-scroll scoring algorithm.
 *  3. Send SHOW_WARNING messages back when thresholds are crossed.
 *  4. Persist per-tab session data and aggregate statistics via chrome.storage.local.
 *  5. Use chrome.alarms for periodic cleanup of stale session data.
 */

'use strict';

/* ─── Inline constants (mirrored from utils/constants.js) ────────────────────
 * Service workers cannot load content-script files, so constants are duplicated
 * here. Keep in sync with utils/constants.js.
 * ─────────────────────────────────────────────────────────────────────────── */
const SCORE_THRESHOLDS = {
  SAFE: 40,
  WARNING: 60,
  STRONG_WARNING: 80
};

const MOTIVATIONAL_MESSAGES = [
  "Your future self will thank you for stopping now.",
  "Time is your most valuable asset. Invest it wisely.",
  "Every minute counts. What could you accomplish instead?",
  "Break the scroll cycle. Your mind deserves a rest.",
  "The feed will still be here later. Your time won't.",
  "Step away and stretch. Your body will thank you.",
  "Mindful browsing > mindless scrolling.",
  "You've consumed enough content. Time to create something.",
  "Take a deep breath. Is this scroll adding value to your life?",
  "Remember why you opened your browser. Was it for this?"
];

const SNOOZE_DURATION        = 300000; // 5 minutes in ms
const STRONG_WARNING_FOLLOWUP = 300;   // seconds after strong warning before "final reminder"

/* ─── In-memory session state (keyed by tabId) ───────────────────────────── */
// Persisted to chrome.storage.local on every update; restored on service-worker restart.
let sessions = {}; // { [tabId]: SessionState }

/**
 * @typedef {Object} SessionState
 * @property {number}  tabId
 * @property {string}  hostname
 * @property {string}  url
 * @property {number}  lastScore
 * @property {string}  lastWarningLevel   - 'none' | 'warning' | 'strong'
 * @property {number}  lastWarningTime    - ms since epoch
 * @property {boolean} snoozed
 * @property {number}  snoozeUntil        - ms since epoch
 * @property {number}  strongWarningTime  - ms since epoch (when strong warning fired)
 * @property {boolean} finalReminderSent
 * @property {number}  lastScrollCount    - scroll count from previous report (for delta)
 * @property {number}  lastKeyPressCount  - key count from previous report (for delta)
 * @property {number}  lastSessionTime    - session duration from previous report (for delta)
 */

/* ─── Scoring algorithm ──────────────────────────────────────────────────────
 *
 * Inputs come from the ACTIVITY_REPORT message sent by the content script.
 *
 * score = 0
 *  +30  sessionDuration > 600s   (>10 min on page)
 *  +25  scrollCount > 100        (heavy scrolling)
 *  +15  keyPressCount > 50       (repeated key presses)
 *  +20  bottomReachedCount > 5   (hitting bottom of infinite feed)
 *  +25  shortVideoCount > 10     (many short videos consumed)
 *  -10  idleTime < 30s           (constant engagement — low idle)
 *  -50  longVideoDetected        (watching long content — bypass)
 *
 * ─────────────────────────────────────────────────────────────────────────── */
function calculateScore(data) {
  let score = 0;

  if (data.sessionDuration > 600)    score += 30;
  if (data.scrollCount > 100)        score += 25;
  if (data.keyPressCount > 50)       score += 15;
  if (data.bottomReachedCount > 5)   score += 20;
  if (data.shortVideoCount > 10)     score += 25;
  if (data.idleTime < 30)            score -= 10;
  if (data.longVideoDetected)        score -= 50;

  return score;
}

/* ─── Pick a random motivational message ─────────────────────────────────── */
function randomMessage() {
  return MOTIVATIONAL_MESSAGES[
    Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length)
  ];
}

/* ─── Persist sessions to chrome.storage.local ───────────────────────────── */
async function persistSessions() {
  try {
    await chrome.storage.local.set({ dsbSessions: sessions });
  } catch (err) {
    console.error('[DSB] Failed to persist sessions:', err);
  }
}

/* ─── Restore sessions from chrome.storage.local on startup ─────────────── */
async function restoreSessions() {
  try {
    const result = await chrome.storage.local.get('dsbSessions');
    if (result.dsbSessions) {
      sessions = result.dsbSessions;
    }
  } catch (err) {
    console.error('[DSB] Failed to restore sessions:', err);
  }
}

/* ─── Update aggregate daily statistics ──────────────────────────────────── */
/**
 * Only the *incremental* counts since the last report are added to aggregate
 * stats to avoid double-counting the same activity across multiple 30-second reports.
 *
 * @param {object}  data            - Activity report data from content script
 * @param {object}  session         - Current in-memory session state (mutated for deltas)
 * @param {boolean} warningTriggered
 * @param {string}  hostname
 */
async function updateAggregateStats(data, session, warningTriggered, hostname) {
  try {
    const result = await chrome.storage.local.get('dsbStats');
    const stats = result.dsbStats || {
      totalScrollCount: 0,
      totalKeyPresses: 0,
      totalSessionTime: 0,
      totalWarningsTriggered: 0,
      doomScrollSessions: 0,
      siteBreakdown: {} // { [hostname]: { scrollCount, sessionTime, warningCount } }
    };

    // Compute incremental deltas since the last activity report for this tab
    const scrollDelta  = Math.max(0, (data.scrollCount    || 0) - (session.lastScrollCount   || 0));
    const keyDelta     = Math.max(0, (data.keyPressCount  || 0) - (session.lastKeyPressCount || 0));
    const timeDelta    = Math.max(0, (data.sessionDuration || 0) - (session.lastSessionTime  || 0));

    // Update the "last seen" baselines on the session so the next call computes a clean delta
    session.lastScrollCount   = data.scrollCount   || 0;
    session.lastKeyPressCount = data.keyPressCount || 0;
    session.lastSessionTime   = data.sessionDuration || 0;

    stats.totalScrollCount    += scrollDelta;
    stats.totalKeyPresses     += keyDelta;
    stats.totalSessionTime    += timeDelta;

    if (warningTriggered) {
      stats.totalWarningsTriggered += 1;
      stats.doomScrollSessions     += 1;
    }

    // Per-site breakdown
    if (hostname) {
      if (!stats.siteBreakdown[hostname]) {
        stats.siteBreakdown[hostname] = {
          scrollCount: 0,
          sessionTime: 0,
          warningCount: 0
        };
      }
      stats.siteBreakdown[hostname].scrollCount  += scrollDelta;
      stats.siteBreakdown[hostname].sessionTime  += timeDelta;
      if (warningTriggered) {
        stats.siteBreakdown[hostname].warningCount += 1;
      }
    }

    await chrome.storage.local.set({ dsbStats: stats });
  } catch (err) {
    console.error('[DSB] Failed to update aggregate stats:', err);
  }
}

/* ─── Send a warning message to the content script of a tab ─────────────── */
async function sendWarning(tabId, level, message) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'SHOW_WARNING',
      level,
      message
    });
  } catch (err) {
    // Tab may have been closed or navigated away — log and ignore.
    console.warn('[DSB] Could not send warning to tab', tabId, err.message);
  }
}

/* ─── Main activity report handler ───────────────────────────────────────── */
async function handleActivityReport(tabId, data) {
  // Check if extension is enabled
  try {
    const settings = await chrome.storage.local.get('dsbSettings');
    const cfg = settings.dsbSettings || {};
    if (cfg.enabled === false) return; // Extension disabled by user

    // Check whitelist
    const whitelist = cfg.whitelist || [];
    if (whitelist.some(domain => data.hostname && data.hostname.includes(domain))) {
      return; // Site is whitelisted
    }

    // Adjust thresholds based on sensitivity setting
    // sensitivity: 'low' = multiply thresholds by 1.5, 'high' = multiply by 0.7
    const sensitivity = cfg.sensitivity || 'medium';
    let thresholdMultiplier = 1.0;
    if (sensitivity === 'low')  thresholdMultiplier = 1.5;
    if (sensitivity === 'high') thresholdMultiplier = 0.7;

    const warnThreshold   = SCORE_THRESHOLDS.WARNING        * thresholdMultiplier;
    const strongThreshold = SCORE_THRESHOLDS.STRONG_WARNING * thresholdMultiplier;

    const score = calculateScore(data);

    // Initialise or update session state for this tab
    if (!sessions[tabId]) {
      sessions[tabId] = {
        tabId,
        hostname: data.hostname,
        url: data.url,
        lastScore: 0,
        lastWarningLevel: 'none',
        lastWarningTime: 0,
        snoozed: false,
        snoozeUntil: 0,
        strongWarningTime: 0,
        finalReminderSent: false,
        lastScrollCount: 0,
        lastKeyPressCount: 0,
        lastSessionTime: 0
      };
    }

    const session = sessions[tabId];
    session.lastScore = score;
    session.hostname  = data.hostname;
    session.url       = data.url;

    // ── Snooze check ──────────────────────────────────────────────────────
    // If the user clicked "Give me 5 more minutes", skip warnings until snooze expires.
    if (session.snoozed && Date.now() < session.snoozeUntil) {
      await persistSessions();
      return;
    } else {
      session.snoozed = false;
    }

    // ── Long-video bypass ─────────────────────────────────────────────────
    // When a long video is detected the score already has -50, but explicitly
    // skip warnings to avoid annoying users watching lectures or movies.
    if (data.longVideoDetected) {
      await persistSessions();
      return;
    }

    let warningTriggered = false;

    // ── Strong warning → final reminder check ────────────────────────────
    // After a strong warning, if the user continued scrolling for 5 more minutes
    // send one final (escalated) reminder.
    if (
      session.lastWarningLevel === 'strong' &&
      !session.finalReminderSent &&
      session.strongWarningTime > 0
    ) {
      const elapsed = (Date.now() - session.strongWarningTime) / 1000;
      if (elapsed >= STRONG_WARNING_FOLLOWUP) {
        session.finalReminderSent = true;
        warningTriggered = true;
        await sendWarning(tabId, 'strong', '🚨 Final reminder: ' + randomMessage());
        await updateAggregateStats(data, session, warningTriggered, data.hostname);
        await persistSessions();
        return;
      }
    }

    // ── Normal threshold checks ───────────────────────────────────────────
    if (score >= strongThreshold) {
      // Only send the strong warning once per session (unless the user snoozes and comes back)
      if (session.lastWarningLevel !== 'strong') {
        session.lastWarningLevel = 'strong';
        session.lastWarningTime  = Date.now();
        session.strongWarningTime = Date.now();
        warningTriggered = true;
        await sendWarning(tabId, 'strong', randomMessage());
      }
    } else if (score >= warnThreshold) {
      // Only send the warning once per level transition to avoid spam
      if (session.lastWarningLevel === 'none') {
        session.lastWarningLevel = 'warning';
        session.lastWarningTime  = Date.now();
        warningTriggered = true;
        await sendWarning(tabId, 'warning', randomMessage());
      }
    }

    await updateAggregateStats(data, session, warningTriggered, data.hostname);
    await persistSessions();

    // Also store the current session score so the popup can read it
    await chrome.storage.local.set({ [`dsbTabSession_${tabId}`]: session });

  } catch (err) {
    console.error('[DSB] Error in handleActivityReport:', err);
  }
}

/* ─── Handle snooze requests from content script ─────────────────────────── */
async function handleSnooze(tabId) {
  if (!sessions[tabId]) return;
  sessions[tabId].snoozed     = true;
  sessions[tabId].snoozeUntil = Date.now() + SNOOZE_DURATION;
  // Reset warning level so warnings can reappear after snooze expires
  sessions[tabId].lastWarningLevel = 'none';
  await persistSessions();
}

/* ─── Clean up stale session data for closed tabs ────────────────────────── */
async function cleanupStaleSessions() {
  try {
    const openTabs = await chrome.tabs.query({});
    const openTabIds = new Set(openTabs.map(t => t.id));

    let changed = false;
    for (const tabId of Object.keys(sessions)) {
      if (!openTabIds.has(Number(tabId))) {
        delete sessions[tabId];
        // Also remove the per-tab key from storage
        await chrome.storage.local.remove(`dsbTabSession_${tabId}`);
        changed = true;
      }
    }
    if (changed) await persistSessions();
  } catch (err) {
    console.error('[DSB] Error during session cleanup:', err);
  }
}

/* ─── Event listeners ────────────────────────────────────────────────────── */

// Restore persisted state when the service worker starts up
restoreSessions();

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId) return false;

  if (message.type === 'ACTIVITY_REPORT') {
    handleActivityReport(tabId, message.data).then(() => {
      sendResponse({ ok: true });
    });
    return true; // Keep the message channel open for async response
  }

  if (message.type === 'SNOOZE') {
    handleSnooze(tabId).then(() => sendResponse({ ok: true }));
    return true;
  }

  // Popup requesting the current session for the active tab
  if (message.type === 'GET_SESSION') {
    const session = sessions[message.tabId] || null;
    sendResponse({ session });
    return false;
  }

  return false;
});

// Clean up sessions when a tab is removed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (sessions[tabId]) {
    delete sessions[tabId];
    try {
      await chrome.storage.local.remove(`dsbTabSession_${tabId}`);
      await persistSessions();
    } catch (err) {
      console.error('[DSB] Error removing tab session:', err);
    }
  }
});

// Set up periodic cleanup alarm (runs every 5 minutes)
chrome.alarms.create('dsbCleanup', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dsbCleanup') {
    cleanupStaleSessions();
  }
});
