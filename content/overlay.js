/**
 * overlay.js — Doom Scroll Blocker warning overlay.
 *
 * Exposes global functions:
 *  - `showDoomScrollWarning(level, message, stats)` — called by content.js
 *  - `showBreakScreen(remainingMs)` — called when a break block is active
 *
 * All DOM is mounted inside a Shadow DOM host to avoid CSS conflicts with the
 * host page. CSS class names are prefixed with `dsb-` for extra safety.
 *
 * Constants are provided by utils/constants.js which is loaded first.
 */

'use strict';

/* ─── Snooze state ───────────────────────────────────────────────────────── */
let snoozedUntil = 0;

/* ─── Active break screen interval handles (for cleanup) ────────────────── */
let activeBreathInterval = null;
let activeBreakTimerInterval = null;

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

  const style = document.createElement('style');
  style.textContent = getDSBStyles();
  shadowRoot.appendChild(style);

  return shadowRoot;
}

/* ─── Overlay styles ──────────────────────────────────────────────────────── */
function getDSBStyles() {
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

    .dsb-backdrop.dsb-break {
      background: linear-gradient(135deg, #0f2027, #203a43, #2c5364);
      animation: dsb-fade-in 0.5s ease forwards;
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

    .dsb-card.dsb-break-card {
      --dsb-accent: #4caf50;
      --dsb-bg: rgba(15, 32, 39, 0.95);
      max-width: 520px;
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

    /* Breathing animation for break screen */
    .dsb-breathe-container {
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 20px 0;
    }

    .dsb-breathe-circle {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: radial-gradient(circle, #4caf50 0%, #087f23 100%);
      box-shadow: 0 0 30px rgba(76, 175, 80, 0.4);
      animation: dsb-breathe 4s ease-in-out infinite;
    }

    @keyframes dsb-breathe {
      0%, 100% { transform: scale(1);    opacity: 0.7; }
      50%       { transform: scale(1.4); opacity: 1;   }
    }

    .dsb-breathe-label {
      font-size: 13px;
      color: var(--dsb-text-muted);
      margin-top: 10px;
      animation: dsb-breathe-text 4s ease-in-out infinite;
    }

    @keyframes dsb-breathe-text {
      0%, 45%  { content: 'Breathe in...'; opacity: 1; }
      50%, 95% { opacity: 0.6; }
      100%     { opacity: 1; }
    }

    .dsb-break-timer {
      font-size: 48px;
      font-weight: 700;
      color: var(--dsb-accent);
      margin: 12px 0 4px;
      font-variant-numeric: tabular-nums;
    }

    .dsb-break-timer-label {
      font-size: 13px;
      color: var(--dsb-text-muted);
      margin-bottom: 20px;
    }

    .dsb-quote {
      font-style: italic;
      color: var(--dsb-text-muted);
      font-size: 14px;
      margin: 16px 0;
      padding: 0 8px;
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

  // Clean up any running break screen intervals
  if (activeBreathInterval !== null) {
    clearInterval(activeBreathInterval);
    activeBreathInterval = null;
  }
  if (activeBreakTimerInterval !== null) {
    clearInterval(activeBreakTimerInterval);
    activeBreakTimerInterval = null;
  }
}

/* ─── Show the break screen ──────────────────────────────────────────────── */
/**
 * Replaces current overlay with a full-screen break experience.
 * @param {number} remainingMs - milliseconds remaining on the break
 */
function showBreakScreen(remainingMs) {
  removeOverlay();

  const root = getShadowRoot();
  shadowHost.style.pointerEvents = 'all';
  shadowHost.style.width  = '100vw';
  shadowHost.style.height = '100vh';

  const breakStartMs = Date.now();
  const minDurationMs = BREAK_MIN_DURATION;

  const backdrop = document.createElement('div');
  backdrop.className = 'dsb-backdrop dsb-break';

  const card = document.createElement('div');
  card.className = 'dsb-card dsb-break-card';

  const icon = document.createElement('div');
  icon.className = 'dsb-icon';
  icon.textContent = '🌿';
  card.appendChild(icon);

  const title = document.createElement('div');
  title.className = 'dsb-title';
  title.textContent = 'Time for a Break';
  card.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'dsb-message';
  subtitle.textContent = 'Step away, relax, and let your mind reset.';
  card.appendChild(subtitle);

  // Breathing animation
  const breatheContainer = document.createElement('div');
  breatheContainer.className = 'dsb-breathe-container';
  breatheContainer.innerHTML = `
    <div>
      <div class="dsb-breathe-circle"></div>
      <div class="dsb-breathe-label">Breathe in...</div>
    </div>
  `;
  card.appendChild(breatheContainer);

  // Breathing label alternates text
  const breatheLabel = breatheContainer.querySelector('.dsb-breathe-label');
  let breathePhase = 0;
  activeBreathInterval = setInterval(() => {
    breathePhase = (breathePhase + 1) % 2;
    breatheLabel.textContent = breathePhase === 0 ? 'Breathe in...' : 'Breathe out...';
  }, 2000);

  // Countdown timer
  const timerEl = document.createElement('div');
  timerEl.className = 'dsb-break-timer';

  const timerLabelEl = document.createElement('div');
  timerLabelEl.className = 'dsb-break-timer-label';
  timerLabelEl.textContent = 'remaining on your break';
  card.appendChild(timerEl);
  card.appendChild(timerLabelEl);

  function updateTimer() {
    const elapsed   = Date.now() - breakStartMs;
    const remaining = Math.max(0, remainingMs - elapsed);
    const totalSecs = Math.ceil(remaining / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    return remaining;
  }
  updateTimer();

  // Random motivational quote
  const quotes = MOTIVATIONAL_MESSAGES;
  const quote = document.createElement('div');
  quote.className = 'dsb-quote';
  quote.textContent = `"${quotes[Math.floor(Math.random() * quotes.length)]}"`;
  card.appendChild(quote);

  const divider = document.createElement('div');
  divider.className = 'dsb-divider';
  card.appendChild(divider);

  // "I'm refreshed" button — enabled only after BREAK_MIN_DURATION
  const refreshedBtn = document.createElement('button');
  refreshedBtn.className = 'dsb-btn dsb-btn-primary';
  refreshedBtn.textContent = "I'm refreshed, let me back";
  refreshedBtn.disabled = true;

  const btnLabel = document.createElement('div');
  btnLabel.className = 'dsb-timer-label';
  btnLabel.style.marginTop = '8px';
  card.appendChild(refreshedBtn);
  card.appendChild(btnLabel);

  let timerInterval;
  function tick() {
    const rem = updateTimer();
    const elapsed = Date.now() - breakStartMs;

    if (elapsed >= minDurationMs && refreshedBtn.disabled) {
      refreshedBtn.disabled = false;
      btnLabel.textContent = '';
    } else if (refreshedBtn.disabled) {
      const waitRemaining = Math.ceil((minDurationMs - elapsed) / 1000);
      const wm = Math.floor(waitRemaining / 60);
      const ws = waitRemaining % 60;
      btnLabel.textContent = `Available in ${wm > 0 ? wm + 'm ' : ''}${ws}s`;
    }

    if (rem <= 0) {
      clearInterval(timerInterval);
      activeBreakTimerInterval = null;
      if (activeBreathInterval !== null) {
        clearInterval(activeBreathInterval);
        activeBreathInterval = null;
      }
      timerLabelEl.textContent = 'Break complete!';
      refreshedBtn.disabled = false;
      btnLabel.textContent = '';
    }
  }

  timerInterval = setInterval(tick, 500);
  activeBreakTimerInterval = timerInterval;
  tick();

  refreshedBtn.addEventListener('click', () => {
    removeOverlay(); // removeOverlay handles clearing all intervals
  });

  backdrop.appendChild(card);
  root.appendChild(backdrop);
}

/* ─── Build and show the warning overlay ─────────────────────────────────── */
/**
 * @param {'warning'|'strong'} level
 * @param {string} motivationalMessage
 * @param {{ scrollCount: number, keyPressCount: number, sessionDuration: number }} stats
 */
function showDoomScrollWarning(level, motivationalMessage, stats) {
  if (Date.now() < snoozedUntil) return;

  removeOverlay();

  const isStrong = level === 'strong';
  const root     = getShadowRoot();

  shadowHost.style.pointerEvents = 'all';
  shadowHost.style.width  = '100vw';
  shadowHost.style.height = '100vh';

  const backdrop = document.createElement('div');
  backdrop.className = 'dsb-backdrop' + (isStrong ? ' dsb-strong' : '');

  const card = document.createElement('div');
  card.className = 'dsb-card' + (isStrong ? ' dsb-strong' : '');

  const icon = document.createElement('div');
  icon.className = 'dsb-icon';
  icon.textContent = isStrong ? '🚨' : '⚠️';
  card.appendChild(icon);

  const title = document.createElement('div');
  title.className = 'dsb-title';
  const minutes = Math.round(stats.sessionDuration / 60);
  title.textContent = isStrong
    ? '⛔ Serious Doom Scroll Alert'
    : `⚠️ You've been doom scrolling for ${minutes} min`;
  card.appendChild(title);

  const msg = document.createElement('div');
  msg.className = 'dsb-message';
  msg.textContent = motivationalMessage;
  card.appendChild(msg);

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
    <div class="dsb-stat">
      <div class="dsb-stat-value">${stats.keyPressCount || 0}</div>
      <div class="dsb-stat-label">Key Presses</div>
    </div>
  `;
  card.appendChild(statsRow);

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

  const actions = document.createElement('div');
  actions.className = 'dsb-actions';

  // "Take a Break" — show the break screen instead of closing the tab
  const breakBtn = document.createElement('button');
  breakBtn.className = 'dsb-btn dsb-btn-primary';
  breakBtn.textContent = '🌿 Take a Break';
  breakBtn.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({
        type: 'TAKE_BREAK',
        hostname: window.location.hostname,
        duration: BREAK_DURATION
      });
    } catch (_) {}
    removeOverlay();
    showBreakScreen(BREAK_DURATION);
  });
  actions.appendChild(breakBtn);

  // "Give me 5 more minutes" — snooze
  const snoozeBtn = document.createElement('button');
  snoozeBtn.className = 'dsb-btn dsb-btn-secondary';
  snoozeBtn.textContent = '⏱ Give me 5 more minutes';
  snoozeBtn.addEventListener('click', () => {
    snoozedUntil = Date.now() + SNOOZE_DURATION;
    try {
      chrome.runtime.sendMessage({ type: 'SNOOZE' });
    } catch (_) {}
    removeOverlay();
  });
  actions.appendChild(snoozeBtn);

  // "Continue Scrolling" — strong warning only, initially disabled
  if (isStrong) {
    continueBtn = document.createElement('button');
    continueBtn.className = 'dsb-btn dsb-btn-secondary';
    continueBtn.textContent = 'Continue Scrolling';
    continueBtn.disabled = true;
    continueBtn.addEventListener('click', () => {
      // Notify background to re-arm warnings after CONTINUE_REARM_DELAY
      try {
        chrome.runtime.sendMessage({ type: 'CONTINUE_SCROLLING' });
      } catch (_) {}
      removeOverlay();
    });
    actions.appendChild(continueBtn);
  }

  card.appendChild(actions);
  backdrop.appendChild(card);
  root.appendChild(backdrop);
}

/* ─── Expose to content.js ───────────────────────────────────────────────── */
window.showDoomScrollWarning = showDoomScrollWarning;
window.showBreakScreen       = showBreakScreen;
