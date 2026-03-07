/**
 * content.js — Doom Scroll Blocker content script.
 *
 * Tracks user behaviour on all websites and periodically sends an
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

/* ─── Page context classification ───────────────────────────────────────── */
/**
 * Classify the current page into one of these contexts:
 *  - 'short_form_feed': YouTube Shorts, Instagram Reels, TikTok
 *  - 'social_feed':     Twitter/X timeline, Reddit feed, Facebook feed, LinkedIn feed
 *  - 'video_player':    YouTube watch page (long video), Vimeo, Netflix
 *  - 'comments_section': YouTube comments scroll, Reddit comment threads
 *  - 'news_feed':       News sites, blogs with infinite scroll
 *  - 'productive':      Docs, GitHub, Wikipedia, edu sites — NEVER trigger
 *  - 'search':          Google/Bing/DDG search results
 *  - 'unknown':         Everything else
 */
function classifyPage() {
  const url      = window.location.href.toLowerCase();
  const hostname = window.location.hostname.toLowerCase();
  const pathname = window.location.pathname.toLowerCase();

  /**
   * Safely check if `hostname` is exactly `domain` or a subdomain of it.
   * Prevents spoofing via hostnames like `evil-youtube.com.attacker.com`.
   */
  function matchHost(domain) {
    return hostname === domain || hostname.endsWith('.' + domain);
  }

  // ── PRODUCTIVE / EXEMPT — Never trigger warnings ──────────────────────
  const productivePatterns = [
    // Educational institutions
    /\.edu$/,
    /scholar\.google/,
    /arxiv\.org/,
    /researchgate\.net/,
    /academia\.edu/,
    /coursera\.org/,
    /udemy\.com/,
    /edx\.org/,
    /khanacademy\.org/,
    /brilliant\.org/,
    /leetcode\.com/,
    /hackerrank\.com/,
    /codeforces\.com/,
    /freecodecamp\.org/,

    // Documentation / Reference
    /developer\.mozilla\.org/,
    /docs\./,
    /stackoverflow\.com/,
    /stackexchange\.com/,
    /github\.com(?!\/(explore|trending))/,
    /gitlab\.com/,
    /bitbucket\.org/,
    /wikipedia\.org/,
    /wikimedia\.org/,
    /w3schools\.com/,
    /geeksforgeeks\.org/,

    // Work tools
    /docs\.google\.com/,
    /drive\.google\.com/,
    /sheets\.google\.com/,
    /slides\.google\.com/,
    /notion\.so/,
    /confluence/,
    /jira/,
    /trello\.com/,
    /asana\.com/,
    /slack\.com/,
    /teams\.microsoft\.com/,
    /mail\.google\.com/,
    /outlook\.live\.com/,
    /calendar\.google\.com/,
    /zoom\.us/,

    // File types
    /\.pdf(\?|$)/
  ];

  for (const pattern of productivePatterns) {
    if (pattern.test(hostname) || pattern.test(url)) {
      return 'productive';
    }
  }

  // Check page content — long articles or code-heavy pages without social signals
  const hasCodeBlocks = document.querySelectorAll('pre code, .highlight, .codehilite').length > MIN_CODE_BLOCKS_PRODUCTIVE;
  const articleEl = document.querySelector('article');
  const hasLongArticle = articleEl !== null &&
    (articleEl.innerText?.length || 0) > 3000;

  if (hasCodeBlocks || hasLongArticle) {
    const socialIndicators = ['feed', 'timeline', 'reel', 'shorts', 'trending'];
    const isSocial = socialIndicators.some(s => url.includes(s) || pathname.includes(s));
    if (!isSocial) return 'productive';
  }

  // ── SHORT FORM FEED — Highest doom score weight ──────────────────────
  if (matchHost('youtube.com') && pathname.includes('/shorts')) return 'short_form_feed';
  if (matchHost('instagram.com') && (pathname.includes('/reels') || pathname.includes('/reel'))) return 'short_form_feed';
  if (matchHost('tiktok.com')) return 'short_form_feed';

  // ── VIDEO PLAYER — Low weight (watching long content is fine) ─────────
  if (matchHost('youtube.com') && pathname.includes('/watch')) {
    // If user has scrolled past the video into comments, treat as comments_section
    if (isScrolledPastVideo()) return 'comments_section';
    return 'video_player';
  }
  if (matchHost('vimeo.com')) return 'video_player';
  if (matchHost('netflix.com') && pathname.includes('/watch')) return 'video_player';
  if (matchHost('primevideo.com') && pathname.includes('/detail')) return 'video_player';

  // ── SOCIAL FEED — Medium-high weight ──────────────────────────────────
  const socialFeedSites = [
    { host: 'twitter.com',   paths: ['/', '/home', '/explore'] },
    { host: 'x.com',         paths: ['/', '/home', '/explore'] },
    { host: 'reddit.com',    paths: ['/', '/r/', '/popular', '/all'] },
    { host: 'facebook.com',  paths: ['/', '/watch'] },
    { host: 'linkedin.com',  paths: ['/feed'] },
    { host: 'instagram.com', paths: ['/', '/explore'] },
    { host: 'pinterest.com', paths: ['/', '/search'] },
    { host: 'tumblr.com',    paths: ['/dashboard'] },
    { host: '9gag.com',      paths: ['/'] }
  ];

  for (const site of socialFeedSites) {
    if (matchHost(site.host)) {
      if (site.paths.some(p => pathname === p || pathname.startsWith(p))) {
        return 'social_feed';
      }
    }
  }

  // YouTube home / subscriptions / trending
  if (matchHost('youtube.com') &&
    (pathname === '/' || pathname.startsWith('/feed/'))) {
    return 'social_feed';
  }

  // ── COMMENTS SECTION ──────────────────────────────────────────────────
  if (matchHost('reddit.com') && pathname.includes('/comments/')) return 'comments_section';

  // ── NEWS FEED ──────────────────────────────────────────────────────────
  const newsSites = [
    'cnn.com', 'bbc.com', 'bbc.co.uk', 'foxnews.com', 'nytimes.com',
    'washingtonpost.com', 'theguardian.com', 'buzzfeed.com', 'huffpost.com',
    'vice.com', 'mashable.com', 'techcrunch.com', 'theverge.com',
    'engadget.com', 'gizmodo.com', 'kotaku.com', 'ign.com',
    'news.google.com', 'news.ycombinator.com'
  ];
  if (newsSites.some(s => matchHost(s))) return 'news_feed';

  // ── SEARCH ────────────────────────────────────────────────────────────
  if (matchHost('google.com') && pathname.startsWith('/search')) return 'search';
  if (matchHost('bing.com')   && pathname.startsWith('/search')) return 'search';
  if (matchHost('duckduckgo.com')) return 'search';

  // ── Infinite scroll indicators on unknown pages ───────────────────────
  const hasInfiniteScroll = document.querySelector(
    '[data-infinite-scroll], [infinite-scroll], .infinite-scroll, [data-page], .load-more, .infinite-loader'
  ) !== null;
  if (hasInfiniteScroll) return 'news_feed';

  return 'unknown';
}

/**
 * Returns true when the YouTube video player has scrolled above the viewport
 * (i.e. the user is now reading comments below the video).
 */
function isScrolledPastVideo() {
  if (!window.location.pathname.includes('/watch')) return false;
  const player = document.querySelector('#movie_player, .html5-video-player, video');
  if (!player) return false;
  const rect = player.getBoundingClientRect();
  return rect.bottom < window.innerHeight * VIDEO_SCROLL_THRESHOLD;
}

/* ─── Section detection (for session reset on navigation) ───────────────── */
function getSection() {
  const pathname = window.location.pathname.toLowerCase();
  const hostname = window.location.hostname.toLowerCase();

  function matchHost(domain) {
    return hostname === domain || hostname.endsWith('.' + domain);
  }

  if (matchHost('youtube.com')) {
    if (pathname.includes('/shorts'))               return 'yt-shorts';
    if (pathname.includes('/watch'))                return 'yt-watch';
    if (pathname === '/' || pathname === '')         return 'yt-home';
    if (pathname.includes('/feed/subscriptions'))   return 'yt-subscriptions';
    if (pathname.includes('/feed/trending'))        return 'yt-trending';
    if (pathname.includes('/results'))              return 'yt-search';
    if (pathname.includes('/@') || pathname.includes('/channel/') || pathname.includes('/c/')) return 'yt-channel';
    return 'yt-other';
  }

  if (matchHost('reddit.com')) {
    if (pathname === '/' || pathname === '/popular' || pathname === '/all') return 'reddit-feed';
    if (pathname.includes('/comments/'))            return 'reddit-comments';
    if (pathname.startsWith('/r/') && !pathname.includes('/comments/')) return 'reddit-subreddit';
    return 'reddit-other';
  }

  if (matchHost('instagram.com')) {
    if (pathname.includes('/reels') || pathname.includes('/reel')) return 'ig-reels';
    if (pathname === '/' || pathname === '')         return 'ig-feed';
    if (pathname.includes('/explore'))              return 'ig-explore';
    if (pathname.includes('/stories'))              return 'ig-stories';
    return 'ig-profile';
  }

  if (matchHost('twitter.com') || matchHost('x.com')) {
    if (pathname === '/' || pathname === '/home')   return 'tw-home';
    if (pathname.includes('/explore') || pathname.includes('/search')) return 'tw-explore';
    if (pathname.includes('/status/'))              return 'tw-thread';
    return 'tw-other';
  }

  // Generic: hostname + first path segment
  const firstSegment = pathname.split('/')[1] || '';
  return `${hostname}/${firstSegment}`;
}

/* ─── State ──────────────────────────────────────────────────────────────── */
let scrollCount        = 0;
let keyPressCount      = 0;
let bottomReachedCount = 0;
let shortVideoCount    = 0;
let longVideoDetected  = false;

let currentSection     = getSection();
let lastUrl            = window.location.href;

const sessionStartTime = Date.now();

let lastMouseMove  = Date.now();
let lastKeyAction  = Date.now();
let lastScrollTime = 0;

// Classified once per section, re-evaluated after section changes
let pageContext = classifyPage();

/* ─── Idle time calculation ──────────────────────────────────────────────── */
function getIdleTime() {
  const lastActivity = Math.max(lastMouseMove, lastKeyAction);
  return (Date.now() - lastActivity) / 1000;
}

/* ─── Session duration ───────────────────────────────────────────────────── */
function getSessionDuration() {
  return (Date.now() - sessionStartTime) / 1000;
}

/* ─── Scroll event handler (throttled) ───────────────────────────────────── */
function onScroll(event) {
  const now = Date.now();
  if (now - lastScrollTime < SCROLL_THROTTLE) return;
  lastScrollTime = now;
  lastMouseMove  = now;
  scrollCount++;

  const target = event.target;
  let distanceFromBottom;
  if (target === document || target === document.documentElement || target === document.body) {
    distanceFromBottom = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
  } else if (target.scrollHeight) {
    distanceFromBottom = target.scrollHeight - (target.scrollTop + target.clientHeight);
  } else {
    distanceFromBottom = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
  }

  if (distanceFromBottom < BOTTOM_DETECTION_THRESHOLD) {
    bottomReachedCount++;
  }
}

/* ─── Key press event handler ────────────────────────────────────────────── */
const DOOM_SCROLL_KEYS  = new Set(['ArrowDown', 'ArrowUp', ' ', 'Space', 'j', 'k']);
const DOOM_SCROLL_CODES = new Set(['ArrowDown', 'ArrowUp', 'Space', 'KeyJ', 'KeyK']);

function onKeyDown(event) {
  lastKeyAction = Date.now();
  if (DOOM_SCROLL_KEYS.has(event.key) || DOOM_SCROLL_CODES.has(event.code)) {
    keyPressCount++;
  }
}

/* ─── Mouse move handler (for idle detection) ────────────────────────────── */
function onMouseMove() {
  lastMouseMove = Date.now();
}

/* ─── Video detection helpers ────────────────────────────────────────────── */
// Use let so it can be reassigned on section change
let countedShortVideos = new WeakSet();

function analyseVideo(videoEl) {
  const duration = videoEl.duration;
  if (!duration || isNaN(duration) || duration === Infinity) return;

  // Only set longVideoDetected when the video is actually playing and user has
  // NOT scrolled past it (on YouTube watch page scrolled-to-comments we want
  // the comments_section context to apply instead).
  if (!videoEl.paused && !videoEl.ended && duration > LONG_VIDEO_THRESHOLD) {
    if (!isScrolledPastVideo()) {
      longVideoDetected = true;
    }
  }

  if (duration > 1 && duration < SHORT_VIDEO_THRESHOLD && !countedShortVideos.has(videoEl)) {
    countedShortVideos.add(videoEl);
    shortVideoCount++;
  }
}

function scanVideos() {
  longVideoDetected = false;
  const videos = document.querySelectorAll('video');
  videos.forEach(analyseVideo);
}

/* ─── MutationObserver to handle dynamically loaded videos ──────────────── */
const videoObserver = new MutationObserver(() => {
  // Re-scan the whole list; new nodes are handled implicitly
  scanVideos();
});

videoObserver.observe(document.documentElement, { childList: true, subtree: true });

/* ─── Wheel event handler ────────────────────────────────────────────────── */
function onWheel(event) {
  const now = Date.now();
  if (now - lastScrollTime < SCROLL_THROTTLE) return;
  lastScrollTime = now;
  lastMouseMove  = now;
  if (Math.abs(event.deltaY) > WHEEL_DELTA_THRESHOLD) {
    scrollCount++;
  }
}

/* ─── Touch handlers ─────────────────────────────────────────────────────── */
let touchStartY = 0;

function onTouchStart(e) {
  touchStartY = e.touches[0]?.clientY || 0;
}

function onTouchEnd(e) {
  const touchEndY = e.changedTouches[0]?.clientY || 0;
  const diff = Math.abs(touchStartY - touchEndY);
  if (diff > SWIPE_THRESHOLD) {
    scrollCount++;
    lastMouseMove = Date.now();
  }
}

/* ─── URL-change observer (YouTube Shorts changes URL on each swipe) ─────── */
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    scrollCount++;
    lastMouseMove = Date.now();
  }
});
urlObserver.observe(document.documentElement, { subtree: true, childList: true });

/* ─── Section-change detector (polls every SECTION_CHECK_INTERVAL ms) ───── */
// Uses pathname+hostname (not full href) to avoid resets on hash/query-only changes.
let sectionCheckLastPath = window.location.hostname + window.location.pathname;

const sectionCheckInterval = setInterval(() => {
  const currentPath = window.location.hostname + window.location.pathname;
  if (currentPath === sectionCheckLastPath) return;
  sectionCheckLastPath = currentPath;

  const newSection = getSection();
  if (newSection !== currentSection) {
    currentSection = newSection;

    // Reset all per-section counters
    scrollCount        = 0;
    keyPressCount      = 0;
    bottomReachedCount = 0;
    shortVideoCount    = 0;
    longVideoDetected  = false;
    countedShortVideos = new WeakSet();

    // Re-classify the page context for the new section
    pageContext = classifyPage();

    // Notify background to reset the session scores for this tab
    try {
      chrome.runtime.sendMessage({
        type: 'SECTION_CHANGE',
        data: {
          newSection,
          hostname: window.location.hostname,
          url: window.location.href
        }
      });
    } catch (_) {}
  }
}, SECTION_CHECK_INTERVAL);

/* ─── Build and send ACTIVITY_REPORT ─────────────────────────────────────── */
function sendActivityReport() {
  // Skip entirely for productive pages — zero false positives
  if (pageContext === 'productive') return;

  const idleTime = getIdleTime();
  if (idleTime > IDLE_THRESHOLD / 1000) return;

  // Refresh video state and re-evaluate context (in case user scrolled past video)
  scanVideos();
  pageContext = classifyPage();

  if (pageContext === 'productive') return;

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
      pageContext,
      sessionDuration:   getSessionDuration(),
      idleTime,
      timestamp:         Date.now()
    }
  };

  try {
    chrome.runtime.sendMessage(report, (response) => {
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
    if (typeof showDoomScrollWarning === 'function') {
      showDoomScrollWarning(
        message.level,
        message.message,
        {
          scrollCount,
          keyPressCount,
          sessionDuration: Math.round(getSessionDuration())
        }
      );
    }
    sendResponse({ ok: true });
  }

  if (message.type === 'SHOW_BREAK_REDIRECT') {
    // Background tells us this site is blocked during a break
    if (typeof showBreakScreen === 'function') {
      showBreakScreen(message.remainingMs || BREAK_DURATION);
    }
    sendResponse({ ok: true });
  }

  return false;
});

/* ─── Attach event listeners ─────────────────────────────────────────────── */
document.addEventListener('scroll',    onScroll,    { passive: true, capture: true });
window.addEventListener('keydown',     onKeyDown,   { capture: true, passive: true });
document.addEventListener('mousemove', onMouseMove, { passive: true });
document.addEventListener('wheel',     onWheel,     { passive: true, capture: true });
document.addEventListener('touchstart',onTouchStart,{ passive: true, capture: true });
document.addEventListener('touchend',  onTouchEnd,  { passive: true, capture: true });

/* ─── Initial scans ──────────────────────────────────────────────────────── */
scanVideos();

/* ─── Periodic activity reporting ───────────────────────────────────────── */
const reportIntervalId = setInterval(sendActivityReport, ACTIVITY_REPORT_INTERVAL);

/* ─── Clean up on page unload ────────────────────────────────────────────── */
window.addEventListener('beforeunload', () => {
  clearInterval(reportIntervalId);
  clearInterval(sectionCheckInterval);
  videoObserver.disconnect();
  urlObserver.disconnect();
  document.removeEventListener('scroll',    onScroll,    { capture: true });
  window.removeEventListener('keydown',     onKeyDown,   { capture: true });
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('wheel',     onWheel,     { capture: true });
  document.removeEventListener('touchstart',onTouchStart,{ capture: true });
  document.removeEventListener('touchend',  onTouchEnd,  { capture: true });
});

} // end guard: if (!window.__dsbContentLoaded)
