/**
 * content.js — Doom Scroll Blocker content script.
 *
 * Tracks user behaviour on doom-scroll sites and periodically sends an
 * ACTIVITY_REPORT to the background service worker. Also listens for
 * SHOW_WARNING messages to display overlays via overlay.js.
 *
 * Constants are provided by utils/constants.js which is loaded first.
 */

'use strict';

/* ─── Guard: prevent double-injection ───────────────────────────────────── */
if (window.__dsbContentLoaded) {
  // Already running on this page, bail out silently.
  console.warn('[DSB] Content script already loaded on this page.');
} else {
window.__dsbContentLoaded = true;

/* ─── State ──────────────────────────────────────────────────────────────── */
let scrollCount       = 0;   // Total throttled scroll events
let keyPressCount     = 0;   // Total doom-scroll key presses
let bottomReachedCount = 0;  // How many times user hit the bottom of the feed
let shortVideoCount   = 0;   // Videos shorter than SHORT_VIDEO_THRESHOLD
let longVideoDetected = false; // True when a long video is actively playing

const sessionStartTime = Date.now(); // When the content script first loaded

let lastMouseMove  = Date.now(); // For idle detection
let lastKeyAction  = Date.now();
let lastScrollTime = 0;          // For scroll throttle

/* ─── Idle time calculation ──────────────────────────────────────────────── */
function getIdleTime() {
  const lastActivity = Math.max(lastMouseMove, lastKeyAction);
  return (Date.now() - lastActivity) / 1000; // seconds
}

/* ─── Session duration ───────────────────────────────────────────────────── */
function getSessionDuration() {
  return (Date.now() - sessionStartTime) / 1000; // seconds
}

/* ─── Scroll event handler (throttled) ───────────────────────────────────── */
function onScroll() {
  const now = Date.now();
  if (now - lastScrollTime < SCROLL_THROTTLE) return; // throttle
  lastScrollTime = now;

  // Update idle tracking
  lastMouseMove = now;

  scrollCount++;

  // Detect if the user has reached the bottom of the page (infinite scroll)
  const distanceFromBottom =
    document.documentElement.scrollHeight -
    (window.scrollY + window.innerHeight);

  if (distanceFromBottom < 100) { // within 100px of the bottom
    bottomReachedCount++;
  }
}

/* ─── Key press event handler ────────────────────────────────────────────── */
// Track only keys that are typically used for doom-scrolling
const DOOM_SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', ' ', 'j', 'k']);

function onKeyDown(event) {
  lastKeyAction = Date.now();
  if (DOOM_SCROLL_KEYS.has(event.key)) {
    keyPressCount++;
  }
}

/* ─── Mouse move handler (for idle detection) ────────────────────────────── */
function onMouseMove() {
  lastMouseMove = Date.now();
}

/* ─── Video detection helpers ────────────────────────────────────────────── */

/**
 * Analyse a single <video> element.
 * - If it is currently playing and its duration > LONG_VIDEO_THRESHOLD → set longVideoDetected.
 * - If its duration is between 1s and SHORT_VIDEO_THRESHOLD → increment shortVideoCount.
 */
function analyseVideo(videoEl) {
  const duration = videoEl.duration;
  if (!duration || isNaN(duration) || duration === Infinity) return;

  if (!videoEl.paused && !videoEl.ended && duration > LONG_VIDEO_THRESHOLD) {
    longVideoDetected = true;
  }

  if (duration > 1 && duration < SHORT_VIDEO_THRESHOLD) {
    shortVideoCount++;
  }
}

/**
 * Scan all current <video> elements on the page.
 * Called initially and whenever the DOM changes.
 */
function scanVideos() {
  // Reset long-video flag before each scan so it reflects current state
  longVideoDetected = false;

  const videos = document.querySelectorAll('video');
  videos.forEach(analyseVideo);
}

/* ─── MutationObserver to handle dynamically loaded videos ──────────────── */
const videoObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      // Check if the added node itself is a video
      if (node.tagName === 'VIDEO') analyseVideo(node);
      // Or if it contains video elements
      node.querySelectorAll?.('video').forEach(analyseVideo);
    }
  }
  // Also re-scan for long-video state (playing status may have changed)
  scanVideos();
});

videoObserver.observe(document.documentElement, {
  childList: true,
  subtree: true
});

/* ─── Build and send ACTIVITY_REPORT ─────────────────────────────────────── */
function sendActivityReport() {
  const idleTime = getIdleTime();

  // If the user has been idle for longer than IDLE_THRESHOLD, skip reporting
  // to avoid false positives (user may have walked away from the desk).
  if (idleTime > IDLE_THRESHOLD / 1000) return;

  // Refresh video state just before reporting
  scanVideos();

  const report = {
    type: 'ACTIVITY_REPORT',
    data: {
      url:               window.location.href,
      hostname:          window.location.hostname,
      scrollCount,
      keyPressCount,
      bottomReachedCount,
      shortVideoCount,
      longVideoDetected,
      sessionDuration:   getSessionDuration(),
      idleTime,
      timestamp:         Date.now()
    }
  };

  try {
    chrome.runtime.sendMessage(report, (response) => {
      // Handle extension context invalidation gracefully
      if (chrome.runtime.lastError) {
        console.warn('[DSB] Message error:', chrome.runtime.lastError.message);
      }
    });
  } catch (err) {
    console.warn('[DSB] Could not send activity report:', err.message);
  }
}

/* ─── Listen for messages from background ────────────────────────────────── */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SHOW_WARNING') {
    // overlay.js exposes showDoomScrollWarning on the global scope
    if (typeof showDoomScrollWarning === 'function') {
      showDoomScrollWarning(
        message.level,
        message.message,
        {
          scrollCount,
          sessionDuration: Math.round(getSessionDuration())
        }
      );
    }
    sendResponse({ ok: true });
  }
  return false;
});

/* ─── Attach event listeners ─────────────────────────────────────────────── */
window.addEventListener('scroll', onScroll, { passive: true });
document.addEventListener('keydown', onKeyDown, { passive: true });
document.addEventListener('mousemove', onMouseMove, { passive: true });

/* ─── Initial video scan ─────────────────────────────────────────────────── */
scanVideos();

/* ─── Periodic activity reporting ───────────────────────────────────────── */
const reportIntervalId = setInterval(sendActivityReport, ACTIVITY_REPORT_INTERVAL);

/* ─── Clean up on page unload ────────────────────────────────────────────── */
window.addEventListener('beforeunload', () => {
  clearInterval(reportIntervalId);
  videoObserver.disconnect();
  window.removeEventListener('scroll', onScroll);
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('mousemove', onMouseMove);
});

} // end guard: if (!window.__dsbContentLoaded)
