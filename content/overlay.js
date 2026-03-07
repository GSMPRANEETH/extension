/**
 * overlay.js — Doom Scroll Blocker warning overlay.
 *
 * Exposes a single global function `showDoomScrollWarning(level, message, stats)`
 * called by content.js when the background script requests a warning.
 *
 * All DOM is mounted inside a Shadow DOM host to avoid CSS conflicts with the
 * host page. CSS class names are prefixed with `dsb-` for extra safety.
 *
 * Constants are provided by utils/constants.js which is loaded first.
 */

'use strict';

/* ─── Snooze state ───────────────────────────────────────────────────────── */
let snoozedUntil = 0; // epoch ms — skip showing overlays during snooze

/* ─── Overlay host element (Shadow DOM container) ───────────────────────── */
let shadowHost = null;
let shadowRoot = null;

/**
 * Inject the shadow host into the page once and return the shadow root.
 * Subsequent calls reuse the existing shadow root.
 */
function getShadowRoot() {
  if (shadowRoot) return shadowRoot;

  shadowHost = document.createElement('div');
  shadowHost.id = 'dsb-shadow-host';
  // Position the host so it doesn't disrupt page layout
  shadowHost.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 0 !important;
    height: 0 !important;
    z-index: 2147483647 !important;
    pointer-events: none !important;
  `;
  document.documentElement.appendChild(shadowHost);

  shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

  // Inject overlay CSS into the shadow root
  const style = document.createElement('style');
  style.textContent = getDSBStyles();
  shadowRoot.appendChild(style);

  return shadowRoot;
}

/* ─── Overlay styles (injected into shadow root) ─────────────────────────── */
function getDSBStyles() {
  // Styles are also in overlay.css (loaded by manifest) but shadow DOM requires
  // styles to be injected directly. The overlay.css in the manifest ensures
  // the @font-face declarations (if any) are available at the document level.
  return `
    :host { all: initial; }

    .dsb-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2147483647;
      pointer-events: all;
      animation: dsb-fade-in 0.35s ease forwards;
    }

    .dsb-backdrop.dsb-strong {
      background: rgba(30, 0, 0, 0.85);
    }

    @keyframes dsb-fade-in {
      from { opacity: 0; transform: scale(0.97); }
      to   { opacity: 1; transform: scale(1); }
    }

    .dsb-card {
      --dsb-accent: #00bcd4;
      --dsb-bg: #1a1a2e;
      --dsb-surface: #16213e;
      --dsb-text: #e0e0e0;
      --dsb-text-muted: #9e9e9e;
      --dsb-border: rgba(255,255,255,0.08);
      --dsb-shadow: 0 24px 64px rgba(0,0,0,0.6);

      background: var(--dsb-bg);
      color: var(--dsb-text);
      border-radius: 16px;
      padding: 32px;
      max-width: 460px;
      width: calc(100vw - 48px);
      box-shadow: var(--dsb-shadow);
      border: 1px solid var(--dsb-border);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.5;
      text-align: center;
    }

    .dsb-card.dsb-strong {
      --dsb-accent: #f44336;
    }

    .dsb-icon {
      font-size: 48px;
      margin-bottom: 12px;
    }

    .dsb-title {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 8px;
      color: var(--dsb-accent);
    }

    .dsb-message {
      color: var(--dsb-text-muted);
      margin-bottom: 20px;
    }

    .dsb-stats {
      display: flex;
      gap: 16px;
      justify-content: center;
      margin-bottom: 24px;
    }

    .dsb-stat {
      background: var(--dsb-surface);
      border-radius: 10px;
      padding: 10px 18px;
      flex: 1;
    }

    .dsb-stat-value {
      font-size: 22px;
      font-weight: 700;
      color: var(--dsb-accent);
    }

    .dsb-stat-label {
      font-size: 11px;
      color: var(--dsb-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 2px;
    }

    .dsb-timer {
      font-size: 36px;
      font-weight: 700;
      color: var(--dsb-accent);
      margin-bottom: 16px;
      font-variant-numeric: tabular-nums;
    }

    .dsb-timer-label {
      font-size: 12px;
      color: var(--dsb-text-muted);
      margin-bottom: 20px;
    }

    .dsb-actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .dsb-btn {
      padding: 12px 20px;
      border-radius: 10px;
      border: none;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.1s;
    }

    .dsb-btn:hover  { opacity: 0.9; transform: translateY(-1px); }
    .dsb-btn:active { transform: translateY(0); }

    .dsb-btn-primary {
      background: var(--dsb-accent);
      color: #fff;
    }

    .dsb-btn-secondary {
      background: var(--dsb-surface);
      color: var(--dsb-text);
      border: 1px solid var(--dsb-border);
    }

    .dsb-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      transform: none;
    }

    .dsb-divider {
      height: 1px;
      background: var(--dsb-border);
      margin: 16px 0;
    }
  `;
}

/* ─── Format seconds as "Xm Ys" ─────────────────────────────────────────── */
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/* ─── Remove any existing overlay ───────────────────────────────────────── */
function removeOverlay() {
  const root = getShadowRoot();
  const existing = root.querySelector('.dsb-backdrop');
  if (existing) existing.remove();
  if (shadowHost) shadowHost.style.pointerEvents = 'none';
}

/* ─── Build and show the overlay ─────────────────────────────────────────── */
/**
 * @param {'warning'|'strong'} level
 * @param {string} motivationalMessage
 * @param {{ scrollCount: number, sessionDuration: number }} stats
 */
function showDoomScrollWarning(level, motivationalMessage, stats) {
  // Respect snooze
  if (Date.now() < snoozedUntil) return;

  // Remove any pre-existing overlay
  removeOverlay();

  const isStrong = level === 'strong';
  const root     = getShadowRoot();

  // Make the host element interactive while the overlay is open
  shadowHost.style.pointerEvents = 'all';
  shadowHost.style.width  = '100vw';
  shadowHost.style.height = '100vh';

  /* ── Backdrop ── */
  const backdrop = document.createElement('div');
  backdrop.className = 'dsb-backdrop' + (isStrong ? ' dsb-strong' : '');

  /* ── Card ── */
  const card = document.createElement('div');
  card.className = 'dsb-card' + (isStrong ? ' dsb-strong' : '');

  /* ── Icon ── */
  const icon = document.createElement('div');
  icon.className = 'dsb-icon';
  icon.textContent = isStrong ? '🚨' : '⚠️';
  card.appendChild(icon);

  /* ── Title ── */
  const title = document.createElement('div');
  title.className = 'dsb-title';
  const minutes = Math.round(stats.sessionDuration / 60);
  title.textContent = isStrong
    ? `⛔ Serious Doom Scroll Alert`
    : `⚠️ You've been doom scrolling for ${minutes} min`;
  card.appendChild(title);

  /* ── Motivational message ── */
  const msg = document.createElement('div');
  msg.className = 'dsb-message';
  msg.textContent = motivationalMessage;
  card.appendChild(msg);

  /* ── Stats row ── */
  const statsRow = document.createElement('div');
  statsRow.className = 'dsb-stats';
  statsRow.innerHTML = `
    <div class="dsb-stat">
      <div class="dsb-stat-value">${stats.scrollCount}</div>
      <div class="dsb-stat-label">Scrolls</div>
    </div>
    <div class="dsb-stat">
      <div class="dsb-stat-value">${formatDuration(stats.sessionDuration)}</div>
      <div class="dsb-stat-label">Time Spent</div>
    </div>
  `;
  card.appendChild(statsRow);

  /* ── Countdown timer (strong warning only) ── */
  let continueBtn;
  if (isStrong) {
    const timerEl = document.createElement('div');
    timerEl.className = 'dsb-timer';
    timerEl.textContent = '60';
    card.appendChild(timerEl);

    const timerLabel = document.createElement('div');
    timerLabel.className = 'dsb-timer-label';
    timerLabel.textContent = 'seconds before you can continue';
    card.appendChild(timerLabel);

    // Start the countdown; enable the continue button when it reaches 0
    let remaining = 60;
    const countdownId = setInterval(() => {
      remaining--;
      timerEl.textContent = String(remaining);
      if (remaining <= 0) {
        clearInterval(countdownId);
        timerLabel.textContent = 'You may now continue';
        if (continueBtn) continueBtn.disabled = false;
      }
    }, 1000);
  }

  const divider = document.createElement('div');
  divider.className = 'dsb-divider';
  card.appendChild(divider);

  /* ── Action buttons ── */
  const actions = document.createElement('div');
  actions.className = 'dsb-actions';

  // "Take a Break" — close the tab
  const breakBtn = document.createElement('button');
  breakBtn.className = 'dsb-btn dsb-btn-primary';
  breakBtn.textContent = '🌿 Take a Break';
  breakBtn.addEventListener('click', () => {
    removeOverlay();
    window.close(); // closes the tab (works when opened by a script); falls back gracefully
  });
  actions.appendChild(breakBtn);

  // "Give me 5 more minutes" — snooze
  const snoozeBtn = document.createElement('button');
  snoozeBtn.className = 'dsb-btn dsb-btn-secondary';
  snoozeBtn.textContent = '⏱ Give me 5 more minutes';
  snoozeBtn.addEventListener('click', () => {
    snoozedUntil = Date.now() + SNOOZE_DURATION;
    // Notify background to track the snooze
    try {
      chrome.runtime.sendMessage({ type: 'SNOOZE' });
    } catch (_) { /* ignore if context is invalidated */ }
    removeOverlay();
  });
  actions.appendChild(snoozeBtn);

  // "Continue Scrolling" — strong warning only, initially disabled
  if (isStrong) {
    continueBtn = document.createElement('button');
    continueBtn.className = 'dsb-btn dsb-btn-secondary';
    continueBtn.textContent = 'Continue Scrolling';
    continueBtn.disabled = true;
    continueBtn.addEventListener('click', () => removeOverlay());
    actions.appendChild(continueBtn);
  }

  card.appendChild(actions);
  backdrop.appendChild(card);
  root.appendChild(backdrop);
}

/* ─── Expose to content.js ───────────────────────────────────────────────── */
// content.js checks `typeof showDoomScrollWarning === 'function'` before calling.
window.showDoomScrollWarning = showDoomScrollWarning;
