/**
 * constants.js — Shared constants for the Doom Scroll Blocker extension.
 *
 * NOTE: This file is loaded as a content script before content.js and overlay.js
 * so that all constants are available globally. In the background service worker
 * the constants are duplicated inline (Manifest V3 service workers support ES modules
 * but content scripts do not, so we use a simple IIFE assignment to window/globalThis).
 */

/* ─── Sites monitored by this extension ─────────────────────────────────── */
const DOOM_SCROLL_SITES = [
  'youtube.com', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com',
  'reddit.com', 'facebook.com', 'linkedin.com', 'pinterest.com',
  'tumblr.com', '9gag.com', 'buzzfeed.com', 'imgur.com',
  'news.ycombinator.com', 'digg.com', 'quora.com'
];

/* ─── Sites that should NEVER be blocked ─────────────────────────────────── */
const PRODUCTIVE_SITES = [
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
];

/* ─── Context multipliers applied to raw doom scores ─────────────────────── */
const CONTEXT_MULTIPLIERS = {
  'short_form_feed':  1.5,  // Shorts / Reels / TikTok — maximum weight
  'social_feed':      1.2,  // Twitter/Reddit/Facebook feed — high weight
  'comments_section': 0.8,  // Comments — moderate
  'news_feed':        1.0,  // News — normal weight
  'video_player':     0.3,  // Watching long videos — very low
  'search':           0.2,  // Search results — very low
  'productive':       0.0,  // Educational/work — NEVER trigger
  'unknown':          0.5   // Unknown sites — cautious, low weight
};

/* ─── Score thresholds for the doom-scroll detection algorithm ───────────── */
const SCORE_THRESHOLDS = {
  SAFE: 25,
  WARNING: 40,
  STRONG_WARNING: 65
};

/* ─── Motivational messages shown in overlays (randomly selected) ─────────── */
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

/* ─── Timing constants (all values in milliseconds unless stated) ─────────── */
const ACTIVITY_REPORT_INTERVAL  = 15000; // Send activity report every 15 seconds
const IDLE_THRESHOLD             = 120000; // 2 minutes — stop tracking when idle
const SCROLL_THROTTLE            = 200;    // Throttle scroll events to once per 200ms
const SNOOZE_DURATION            = 300000; // 5 minutes — "Give me 5 more minutes" snooze
const LONG_VIDEO_THRESHOLD       = 600;    // 10 minutes in seconds — bypass warnings
const SHORT_VIDEO_THRESHOLD      = 120;    // 2 minutes in seconds — counts as short video
const BOTTOM_DETECTION_THRESHOLD = 150;    // px from bottom to count as "reached bottom"
const WHEEL_DELTA_THRESHOLD      = 30;     // minimum wheel deltaY to count as a scroll
const SWIPE_THRESHOLD            = 50;     // minimum touch distance (px) to count as a swipe
const POPUP_REFRESH_INTERVAL     = 5000;   // Popup auto-refresh interval (5 seconds)
const BREAK_DURATION             = 600000; // 10 minutes — default break duration
const BREAK_MIN_DURATION         = 120000; // 2 minutes — minimum break before "I'm back" is enabled
const CONTINUE_REARM_DELAY       = 180;    // seconds after "Continue Scrolling" before warnings re-trigger
const SECTION_CHECK_INTERVAL     = 1000;   // 1 second — how often to poll for URL/section changes
const VIDEO_SCROLL_THRESHOLD     = 0.2;    // fraction of viewport height — player is "past" if bottom < 20%
const MIN_CODE_BLOCKS_PRODUCTIVE = 3;      // minimum <pre code> blocks to classify page as productive
