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
  SAFE: 25,
  WARNING: 40,
  STRONG_WARNING: 65
};

const CONTEXT_MULTIPLIERS = {
  'short_form_feed':  1.5,
  'social_feed':      1.2,
  'comments_section': 0.8,
  'news_feed':        1.0,
  'video_player':     0.3,
  'search':           0.2,
  'productive':       0.0,
  'unknown':          0.5
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

const SNOOZE_DURATION         = 300000; // 5 minutes in ms
const STRONG_WARNING_FOLLOWUP = 300;    // seconds after strong warning before "final reminder"
const CONTINUE_REARM_DELAY    = 180;    // seconds after "Continue Scrolling" before re-arming
const BREAK_DURATION          = 600000; // 10 minutes in ms
const BREAK_MIN_DURATION      = 120000; // 2 minutes — minimum break before "I'm back" is enabled
const VIDEO_SCROLL_THRESHOLD  = 0.2;    // fraction of viewport — player is "past" if bottom < 20%
const MIN_CODE_BLOCKS_PRODUCTIVE = 3;   // minimum code blocks to classify page as productive

/* ─── In-memory session state (keyed by tabId) ───────────────────────────── */
// Persisted to chrome.storage.local on every update; restored on service-worker restart.
let sessions = {}; // { [tabId]: SessionState }

// Hostnames currently on a "take a break" block, mapped to expiry timestamp
let breakBlocks = {}; // { [hostname]: expiryMs }

/**
 * @typedef {Object} SessionState
 * @property {number}  tabId
 * @property {string}  hostname
 * @property {string}  url
 * @property {string}  pageContext         - last reported page context
 * @property {string}  currentSection      - current section key
 * @property {number}  lastScore
 * @property {string}  lastWarningLevel    - 'none' | 'warning' | 'strong'
 * @property {number}  lastWarningTime     - ms since epoch
 * @property {boolean} snoozed
 * @property {number}  snoozeUntil         - ms since epoch
 * @property {number}  strongWarningTime   - ms since epoch (when strong warning fired)
 * @property {boolean} finalReminderSent
 * @property {number}  continueClickedAt   - ms since epoch (when "Continue Scrolling" was clicked)
 * @property {number}  lastScrollCount     - scroll count from previous report (for delta)
 * @property {number}  lastKeyPressCount   - key count from previous report (for delta)
 * @property {number}  lastSessionTime     - session duration from previous report (for delta)
 */

/* ─── Scoring algorithm ──────────────────────────────────────────────────────
 *
 * Inputs come from the ACTIVITY_REPORT message sent by the content script.
 *
 * rawScore = 0
 *  +10  sessionDuration > 60s
 *  +15  sessionDuration > 180s
 *  +15  sessionDuration > 300s
 *  +10  scrollCount > 10
 *  +10  scrollCount > 30
 *  +10  scrollCount > 60
 *  +10  keyPressCount > 10
 *  +10  keyPressCount > 30
 *  +15  bottomReachedCount > 3
 *  +10  shortVideoCount > 3
 *  +10  shortVideoCount > 8
 *  +5   idleTime < 10s
 *  -50  longVideoDetected
 *
 * finalScore = rawScore * CONTEXT_MULTIPLIERS[pageContext]
 *
 * ─────────────────────────────────────────────────────────────────────────── */
function calculateScore(data) {
  let score = 0;

  if (data.sessionDuration > 60)  score += 10;
  if (data.sessionDuration > 180) score += 15;
  if (data.sessionDuration > 300) score += 15;

  if (data.scrollCount > 10)      score += 10;
  if (data.scrollCount > 30)      score += 10;
  if (data.scrollCount > 60)      score += 10;

  if (data.keyPressCount > 10)    score += 10;
  if (data.keyPressCount > 30)    score += 10;

  if (data.bottomReachedCount > 3) score += 15;

  if (data.shortVideoCount > 3)   score += 10;
  if (data.shortVideoCount > 8)   score += 10;

  if (data.idleTime < 10)         score += 5;

  if (data.longVideoDetected)     score -= 50;

  // Apply context multiplier
  const context    = data.pageContext || 'unknown';
  const multiplier = CONTEXT_MULTIPLIERS[context] ?? CONTEXT_MULTIPLIERS['unknown'];
  return Math.round(score * multiplier);
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
    if (cfg.enabled === false) return;

    // Check whitelist
    const whitelist = cfg.whitelist || [];
    if (whitelist.some(domain => data.hostname && data.hostname.includes(domain))) {
      return;
    }

    // Skip entirely for productive pages
    if (data.pageContext === 'productive') return;

    // Check if this hostname is currently on a break block
    const now = Date.now();
    const blockExpiry = breakBlocks[data.hostname];
    if (blockExpiry && now < blockExpiry) {
      // Site is blocked during a break — tell the content script to show the break screen
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'SHOW_BREAK_REDIRECT',
          remainingMs: blockExpiry - now
        });
      } catch (_) {}
      return;
    } else if (blockExpiry) {
      // Block has expired
      delete breakBlocks[data.hostname];
    }

    // Adjust thresholds based on sensitivity setting
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
        pageContext: data.pageContext || 'unknown',
        currentSection: '',
        lastScore: 0,
        lastWarningLevel: 'none',
        lastWarningTime: 0,
        snoozed: false,
        snoozeUntil: 0,
        strongWarningTime: 0,
        finalReminderSent: false,
        continueClickedAt: 0,
        lastScrollCount: 0,
        lastKeyPressCount: 0,
        lastSessionTime: 0
      };
    }

    const session = sessions[tabId];
    session.lastScore   = score;
    session.hostname    = data.hostname;
    session.url         = data.url;
    session.pageContext = data.pageContext || 'unknown';

    // Store latest raw activity data so the popup can show live metrics
    session.latestScrollCount        = data.scrollCount;
    session.latestKeyPressCount      = data.keyPressCount;
    session.latestSessionDuration    = data.sessionDuration;
    session.latestBottomReachedCount = data.bottomReachedCount;
    session.latestShortVideoCount    = data.shortVideoCount;
    session.latestLongVideoDetected  = data.longVideoDetected;
    session.latestPageContext        = data.pageContext;

    // ── Snooze check ──────────────────────────────────────────────────────
    if (session.snoozed && Date.now() < session.snoozeUntil) {
      await persistSessions();
      return;
    } else {
      session.snoozed = false;
    }

    // ── "Continue Scrolling" re-arm delay ────────────────────────────────
    // After clicking "Continue", suppress new warnings for CONTINUE_REARM_DELAY seconds.
    if (session.continueClickedAt > 0) {
      const elapsed = (Date.now() - session.continueClickedAt) / 1000;
      if (elapsed < CONTINUE_REARM_DELAY) {
        await persistSessions();
        return;
      } else {
        // Re-arm: allow warnings to fire again
        session.continueClickedAt = 0;
        session.lastWarningLevel  = 'none';
      }
    }

    // ── Long-video bypass ─────────────────────────────────────────────────
    // The context multiplier already handles this (video_player = 0.3), but for
    // a pure long-video watch (not comments) the score will stay very low anyway.
    // We only skip entirely if the score would not reach any threshold.
    // (No hard bypass needed; the multiplier handles it.)

    let warningTriggered = false;

    // ── Strong warning → final reminder check ────────────────────────────
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
      if (session.lastWarningLevel !== 'strong') {
        session.lastWarningLevel  = 'strong';
        session.lastWarningTime   = Date.now();
        session.strongWarningTime = Date.now();
        warningTriggered = true;
        await sendWarning(tabId, 'strong', randomMessage());
      }
    } else if (score >= warnThreshold) {
      if (session.lastWarningLevel === 'none') {
        session.lastWarningLevel = 'warning';
        session.lastWarningTime  = Date.now();
        warningTriggered = true;
        await sendWarning(tabId, 'warning', randomMessage());
      }
    }

    await updateAggregateStats(data, session, warningTriggered, data.hostname);
    await persistSessions();

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
        await chrome.storage.local.remove(`dsbTabSession_${tabId}`);
        changed = true;
      }
    }
    if (changed) await persistSessions();

    // Also clean up expired break blocks
    const now = Date.now();
    for (const hostname of Object.keys(breakBlocks)) {
      if (breakBlocks[hostname] <= now) {
        delete breakBlocks[hostname];
      }
    }
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
    return true;
  }

  if (message.type === 'SNOOZE') {
    handleSnooze(tabId).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'SECTION_CHANGE') {
    // Reset session scoring metrics when the user navigates to a new section
    const session = sessions[tabId];
    if (session) {
      session.lastScore         = 0;
      session.lastWarningLevel  = 'none';
      session.lastWarningTime   = 0;
      session.snoozed           = false;
      session.snoozeUntil       = 0;
      session.strongWarningTime = 0;
      session.finalReminderSent = false;
      session.continueClickedAt = 0;
      session.currentSection    = message.data?.newSection || '';
      session.hostname          = message.data?.hostname   || session.hostname;
      session.url               = message.data?.url        || session.url;
      session.latestScrollCount        = 0;
      session.latestKeyPressCount      = 0;
      session.latestSessionDuration    = 0;
      persistSessions().then(() => {
        chrome.storage.local.set({ [`dsbTabSession_${tabId}`]: session });
      });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'TAKE_BREAK') {
    // Block the hostname for the break duration
    const hostname = message.hostname;
    const duration = message.duration || BREAK_DURATION;
    if (hostname) {
      breakBlocks[hostname] = Date.now() + duration;
    }
    // Reset session for this tab so scores start fresh after the break
    const session = sessions[tabId];
    if (session) {
      session.lastScore         = 0;
      session.lastWarningLevel  = 'none';
      session.lastWarningTime   = 0;
      session.snoozed           = false;
      session.snoozeUntil       = 0;
      session.strongWarningTime = 0;
      session.finalReminderSent = false;
      session.continueClickedAt = 0;
      persistSessions();
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'CONTINUE_SCROLLING') {
    // User dismissed the strong warning — re-arm after CONTINUE_REARM_DELAY seconds
    const session = sessions[tabId];
    if (session) {
      session.continueClickedAt = Date.now();
      session.lastWarningLevel  = 'none'; // allow next threshold to re-trigger
      persistSessions();
    }
    sendResponse({ ok: true });
    return false;
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
