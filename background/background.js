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

/* ─── Load configuration from storage with defaults ────────────────────────────────────── */
// Default configuration (matches utils/constants.js)
const DEFAULT_CONFIG = {
  /* ─── Sites monitored by this extension ─────────────────────────────────────── */
  doomScrollSites: [
    'youtube.com', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com',
    'reddit.com', 'facebook.com', 'linkedin.com', 'pinterest.com',
    'tumblr.com', '9gag.com', 'buzzfeed.com', 'imgur.com',
    'news.ycombinator.com', 'digg.com', 'quora.com'
  ],
  /* ─── Sites that should NEVER be blocked ─────────────────────────────────────── */
  productiveSites: [
    'github.com', 'gitlab.com', 'bitbucket.org',
    'stackoverflow.com', 'stackexchange.com',
    'developer.mozilla.org', 'w3schools.com',
    'docs.google.com', 'drive.google.com',
    'notion.so', 'trello.com', 'asana.com',
    'wikipedia.org', 'wikimedia.org',
    'arxiv.org', 'scholar.google.com',
    'coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org',
    'leetcode.com', 'hackerrank.com', 'codeforces.com',
    'geeksforgeeks.org', 'freecodecamp.org',
    'mail.google.com', 'outlook.live.com',
    'calendar.google.com', 'slack.com',
    'teams.microsoft.com', 'zoom.us'
  ],
  /* ─── Context multipliers applied to raw doom scores ─────────────────────── */
  contextMultipliers: {
    'short_form_feed':  1.5,  // Shorts / Reels / TikTok — maximum weight
    'social_feed':      1.2,  // Twitter/Reddit/Facebook feed — high weight
    'comments_section': 0.8,  // Comments — moderate
    'news_feed':        1.0,  // News — normal weight
    'video_player':     0.3,  // Watching long videos — very low
    'search':           0.2,  // Search results — very low
    'productive':       0.0,  // Educational/work — NEVER trigger
    'unknown':          0.5   // Unknown sites — cautious, low weight
  },
  /* ─── Score thresholds for the doom-scroll detection algorithm ───────────── */
  scoreThresholds: {
    SAFE: 25,
    WARNING: 40,
    STRONG_WARNING: 65
  },
  /* ─── Motivational messages shown in overlays (randomly selected) ─────────── */
  motivationalMessages: [
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
  ],
  /* ─── Timing constants (all values in milliseconds unless stated) ─────────── */
  activityReportInterval: 15000, // Send activity report every 15 seconds
  idleThreshold:             120000, // 2 minutes — stop tracking when idle
  scrollThrottle:            200,    // Throttle scroll events to once per 200ms
  snoozeDuration:            300000, // 5 minutes — "Give me 5 more minutes" snooze
  longVideoThreshold:        600,    // 10 minutes in seconds — bypass warnings
  shortVideoThreshold:       120,    // 2 minutes in seconds — counts as short video
  bottomDetectionThreshold:  150,    // px from bottom to count as "reached bottom"
  wheelDeltaThreshold:       30,     // minimum wheel deltaY to count as a scroll
  swipeThreshold:            50,     // minimum touch distance (px) to count as a swipe
  popupRefreshInterval:      5000,   // Popup auto-refresh interval (5 seconds)
  breakDuration:             600000, // 10 minutes — default break duration
  breakMinDuration:          120000, // 2 minutes — minimum break before "I'm back" is enabled
  continueRearmDelay:        180,    // seconds after "Continue Scrolling" before warnings re-trigger
  sectionCheckInterval:      1000,   // 1 second — how often to poll for URL/section changes
  videoScrollThreshold:      0.2,    // fraction of viewport height — player is "past" if bottom < 20%
  minCodeBlocksProductive:   3,      // minimum <pre code> blocks to classify page as productive
  /* ─── Customizable settings (exposed in UI) ──────────────────────── */
  motivationalMessageFrequency: 1.0, // Probability of showing a motivational message (0-1),
  STRONG_WARNING_FOLLOWUP: 300    // 5 minutes — time after strong warning before final reminder
};

let CONFIG = structuredClone(DEFAULT_CONFIG);

async function loadConfig() {
  const stored = await chrome.storage.local.get('dsbCustomConfig');
  const custom = stored.dsbCustomConfig || {};
  CONFIG = {
    ...DEFAULT_CONFIG, ...custom,
    contextMultipliers: { ...DEFAULT_CONFIG.contextMultipliers, ...custom.contextMultipliers },
    scoreThresholds: { ...DEFAULT_CONFIG.scoreThresholds, ...custom.scoreThresholds }
  };
}

// Load config before proceeding using IIFE to avoid top-level await
(async () => {
  await loadConfig();
})();

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
 * finalScore = rawScore * contextMultipliers[pageContext]
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
  const multiplier = CONFIG.contextMultipliers[context] ?? CONFIG.contextMultipliers['unknown'];
  return Math.round(score * multiplier);
}

/* ─── Pick a random motivational message ─────────────────────────────────── */
function randomMessage() {
  return CONFIG.motivationalMessages[
    Math.floor(Math.random() * CONFIG.motivationalMessages.length)
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

/* ─── Date helper functions for time-based statistics ───────────────────── */
/**
 * Returns date string in YYYY-MM-DD format from timestamp
 */
function getDateKey(timestamp) {
  const date = new Date(timestamp);
  return date.toISOString().split('T')[0];
}

/**
 * Returns week string in YYYY-WW format from timestamp
 * Using ISO week date format
 */
function getWeekKey(timestamp) {
  const date = new Date(timestamp);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Returns month string in YYYY-MM format from timestamp
 */
function getMonthKey(timestamp) {
  const date = new Date(timestamp);
  return date.toISOString().substring(0, 7); // YYYY-MM
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
      // Lifetime totals (existing)
      totalScrollCount: 0,
      totalKeyPresses: 0,
      totalSessionTime: 0,
      totalWarningsTriggered: 0,
      doomScrollSessions: 0,
      siteBreakdown: {}, // { [hostname]: { scrollCount, sessionTime, warningCount } }

      // Time-based tracking (new)
      dailyStats: {},    // { "YYYY-MM-DD": { scrollCount, sessionTime, warnings, etc. } }
      weeklyStats: {},   // { "YYYY-WW": { ... } }
      monthlyStats: {}   // { "YYYY-MM": { ... } }
    };

    // Existing installations have lifetime totals but no period buckets.
    stats.dailyStats ??= {};
    stats.weeklyStats ??= {};
    stats.monthlyStats ??= {};

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

    // Get current timestamp for time-based aggregation
    const now = Date.now();
    const dateKey = getDateKey(now);
    const weekKey = getWeekKey(now);
    const monthKey = getMonthKey(now);

    // Update time-based statistics
    // Daily stats
    if (!stats.dailyStats[dateKey]) {
      stats.dailyStats[dateKey] = {
        scrollCount: 0,
        keyPressCount: 0,
        sessionTime: 0,
        warningsTriggered: 0,
        doomSessions: 0
      };
    }
    stats.dailyStats[dateKey].scrollCount += scrollDelta;
    stats.dailyStats[dateKey].keyPressCount += keyDelta;
    stats.dailyStats[dateKey].sessionTime += timeDelta;
    if (warningTriggered) {
      stats.dailyStats[dateKey].warningsTriggered += 1;
      stats.dailyStats[dateKey].doomSessions += 1;
    }

    // Weekly stats
    if (!stats.weeklyStats[weekKey]) {
      stats.weeklyStats[weekKey] = {
        scrollCount: 0,
        keyPressCount: 0,
        sessionTime: 0,
        warningsTriggered: 0,
        doomSessions: 0
      };
    }
    stats.weeklyStats[weekKey].scrollCount += scrollDelta;
    stats.weeklyStats[weekKey].keyPressCount += keyDelta;
    stats.weeklyStats[weekKey].sessionTime += timeDelta;
    if (warningTriggered) {
      stats.weeklyStats[weekKey].warningsTriggered += 1;
      stats.weeklyStats[weekKey].doomSessions += 1;
    }

    // Monthly stats
    if (!stats.monthlyStats[monthKey]) {
      stats.monthlyStats[monthKey] = {
        scrollCount: 0,
        keyPressCount: 0,
        sessionTime: 0,
        warningsTriggered: 0,
        doomSessions: 0
      };
    }
    stats.monthlyStats[monthKey].scrollCount += scrollDelta;
    stats.monthlyStats[monthKey].keyPressCount += keyDelta;
    stats.monthlyStats[monthKey].sessionTime += timeDelta;
    if (warningTriggered) {
      stats.monthlyStats[monthKey].warningsTriggered += 1;
      stats.monthlyStats[monthKey].doomSessions += 1;
    }

    await chrome.storage.local.set({ dsbStats: stats });
  } catch (err) {
    console.error('[DSB] Failed to update aggregate stats:', err);
  }
}

/* ─── Send a warning message to the content script of a tab ─────────────── */
async function sendWarning(tabId, level, message) {
  // Check if we should show a motivational message based on frequency
  const showMessage = Math.random() < CONFIG.motivationalMessageFrequency;
  const finalMessage = showMessage ? message : '';

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'SHOW_WARNING',
      level,
      message: finalMessage
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
      } catch (_) {
      }
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

    const warnThreshold   = CONFIG.scoreThresholds.WARNING        * thresholdMultiplier;
    const strongThreshold = CONFIG.scoreThresholds.STRONG_WARNING * thresholdMultiplier;

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
      if (elapsed < CONFIG.continueRearmDelay) {
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
      if (elapsed >= CONFIG.STRONG_WARNING_FOLLOWUP) {
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
  sessions[tabId].snoozeUntil = Date.now() + CONFIG.snoozeDuration;
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
  if (message.type === 'GET_SESSION') {
    sendResponse({ session: sessions[message.tabId] || null });
    return false;
  }
  if (message.type === 'CONFIG_UPDATED') {
    loadConfig().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  const tabId = sender.tab?.id;
  if (tabId === undefined) return false;

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
    const duration = CONFIG.breakDuration;
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
    sendResponse({ ok: true, duration });
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