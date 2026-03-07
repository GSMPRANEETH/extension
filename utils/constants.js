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
  'youtube.com',
  'instagram.com',
  'tiktok.com',
  'twitter.com',
  'x.com'
];

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
