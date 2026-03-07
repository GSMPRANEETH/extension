/**
 * popup.js — Doom Scroll Blocker popup UI logic.
 *
 * Reads data from chrome.storage.local and the background service worker to
 * display the current session, aggregate statistics, and settings.
 */

'use strict';

/* ─── Sensitivity labels ─────────────────────────────────────────────────── */
const SENSITIVITY_LABELS = ['Low', 'Medium', 'High'];

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function formatSeconds(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

function formatMinutes(totalSeconds) {
  const m = Math.round(totalSeconds / 60);
  return `${m}m`;
}

function $ (id) { return document.getElementById(id); }

/* ─── Score display ──────────────────────────────────────────────────────── */
function renderScore(score) {
  const pill  = $('dsb-score-pill');
  const value = $('dsb-score-value');

  value.textContent = score !== null ? String(score) : '—';

  pill.classList.remove('dsb-score-safe', 'dsb-score-warn', 'dsb-score-danger');
  if (score === null) return;
  if (score >= 80)       pill.classList.add('dsb-score-danger');
  else if (score >= 60)  pill.classList.add('dsb-score-warn');
  else                   pill.classList.add('dsb-score-safe');
}

/* ─── Load and display current session ───────────────────────────────────── */
async function loadSession() {
  try {
    // Get the currently active tab
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) return;

    // Ask background for the session data for this tab
    chrome.runtime.sendMessage({ type: 'GET_SESSION', tabId: activeTab.id }, (resp) => {
      if (chrome.runtime.lastError) return;
      const session = resp?.session;

      if (session) {
        $('dsb-site').textContent = session.hostname || activeTab.url;
        renderScore(session.lastScore);
      } else {
        $('dsb-site').textContent = activeTab.url
          ? new URL(activeTab.url).hostname
          : 'No active doom-scroll site';
        renderScore(null);
      }
    });

    // Also pull the per-tab storage key directly for live metrics
    const key = `dsbTabSession_${activeTab.id}`;
    const stored = await chrome.storage.local.get(key);
    const tabData = stored[key];
    if (tabData) {
      renderScore(tabData.lastScore ?? null);
    }
  } catch (err) {
    console.error('[DSB Popup] loadSession error:', err);
  }
}

/* ─── Load and display aggregate statistics ──────────────────────────────── */
async function loadStats() {
  try {
    const result = await chrome.storage.local.get('dsbStats');
    const stats  = result.dsbStats || {};

    $('dsb-total-scrolls').textContent   = stats.totalScrollCount   || 0;
    $('dsb-total-time').textContent      = formatMinutes(stats.totalSessionTime || 0);
    $('dsb-total-warnings').textContent  = stats.totalWarningsTriggered || 0;
    $('dsb-doom-sessions').textContent   = stats.doomScrollSessions  || 0;

    // Top 3 doom-scroll sites by warning count
    const breakdown = stats.siteBreakdown || {};
    const sorted = Object.entries(breakdown)
      .sort((a, b) => (b[1].warningCount || 0) - (a[1].warningCount || 0))
      .slice(0, 3);

    const list = $('dsb-sites-list');
    list.innerHTML = '';
    if (sorted.length === 0) {
      list.innerHTML = '<li class="dsb-sites-empty">No data yet</li>';
    } else {
      sorted.forEach(([hostname, data]) => {
        const li = document.createElement('li');
        li.className = 'dsb-site-item';
        li.innerHTML = `
          <span class="dsb-site-name">${hostname}</span>
          <span class="dsb-site-warn">${data.warningCount || 0} warnings</span>
        `;
        list.appendChild(li);
      });
    }
  } catch (err) {
    console.error('[DSB Popup] loadStats error:', err);
  }
}

/* ─── Load and apply settings ───────────────────────────────────────────── */
async function loadSettings() {
  try {
    const result  = await chrome.storage.local.get('dsbSettings');
    const cfg     = result.dsbSettings || {};

    // Enabled toggle
    const enabled = cfg.enabled !== false;
    applyEnabledState(enabled);

    // Sensitivity slider
    const sensitivityMap = { low: 0, medium: 1, high: 2 };
    const sliderVal = sensitivityMap[cfg.sensitivity || 'medium'] ?? 1;
    $('dsb-sensitivity').value = sliderVal;
    $('dsb-sensitivity-hint').textContent = SENSITIVITY_LABELS[sliderVal];

    // Motivational messages
    $('dsb-motiv-toggle').checked = cfg.motivationalMessages !== false;

    // Whitelist
    renderWhitelist(cfg.whitelist || []);
  } catch (err) {
    console.error('[DSB Popup] loadSettings error:', err);
  }
}

/* ─── Save settings helper ───────────────────────────────────────────────── */
async function saveSettings(patch) {
  try {
    const result = await chrome.storage.local.get('dsbSettings');
    const cfg    = result.dsbSettings || {};
    const updated = Object.assign({}, cfg, patch);
    await chrome.storage.local.set({ dsbSettings: updated });
  } catch (err) {
    console.error('[DSB Popup] saveSettings error:', err);
  }
}

/* ─── Enable/disable UI state ────────────────────────────────────────────── */
function applyEnabledState(enabled) {
  const btn   = $('dsb-toggle-btn');
  const badge = $('dsb-status-badge');
  btn.setAttribute('aria-pressed', String(enabled));
  btn.classList.toggle('dsb-toggle-on', enabled);

  badge.textContent = enabled ? 'Active' : 'Paused';
  badge.classList.toggle('dsb-badge-active', enabled);
  badge.classList.toggle('dsb-badge-paused', !enabled);
}

/* ─── Render whitelist ───────────────────────────────────────────────────── */
function renderWhitelist(list) {
  const ul = $('dsb-whitelist-list');
  ul.innerHTML = '';
  list.forEach((domain, idx) => {
    const li = document.createElement('li');
    li.className = 'dsb-whitelist-item';
    li.innerHTML = `
      <span>${domain}</span>
      <button class="dsb-btn-remove" data-idx="${idx}" title="Remove">✕</button>
    `;
    ul.appendChild(li);
  });
}

/* ─── Wire up event listeners ────────────────────────────────────────────── */
function bindEvents() {
  /* Enable/disable toggle */
  $('dsb-toggle-btn').addEventListener('click', async () => {
    const result  = await chrome.storage.local.get('dsbSettings');
    const cfg     = result.dsbSettings || {};
    const nowOn   = cfg.enabled === false; // currently disabled → enable, and vice versa
    await saveSettings({ enabled: nowOn });
    applyEnabledState(nowOn);
  });

  /* Settings collapsible */
  $('dsb-settings-toggle').addEventListener('click', () => {
    const body     = $('dsb-settings-body');
    const toggle   = $('dsb-settings-toggle');
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    body.hidden = expanded;
    toggle.querySelector('.dsb-chevron').style.transform = expanded ? '' : 'rotate(180deg)';
  });

  /* Sensitivity slider */
  $('dsb-sensitivity').addEventListener('input', async (e) => {
    const idx = Number(e.target.value);
    const labels = ['low', 'medium', 'high'];
    $('dsb-sensitivity-hint').textContent = SENSITIVITY_LABELS[idx];
    await saveSettings({ sensitivity: labels[idx] });
  });

  /* Motivational messages toggle */
  $('dsb-motiv-toggle').addEventListener('change', async (e) => {
    await saveSettings({ motivationalMessages: e.target.checked });
  });

  /* Whitelist add */
  $('dsb-whitelist-add').addEventListener('click', async () => {
    const input  = $('dsb-whitelist-input');
    const domain = input.value.trim().toLowerCase();
    if (!domain) return;

    const result    = await chrome.storage.local.get('dsbSettings');
    const cfg       = result.dsbSettings || {};
    const whitelist = cfg.whitelist || [];
    if (!whitelist.includes(domain)) {
      whitelist.push(domain);
      await saveSettings({ whitelist });
      renderWhitelist(whitelist);
    }
    input.value = '';
  });

  /* Whitelist remove (delegated) */
  $('dsb-whitelist-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.dsb-btn-remove');
    if (!btn) return;
    const idx = Number(btn.dataset.idx);

    const result    = await chrome.storage.local.get('dsbSettings');
    const cfg       = result.dsbSettings || {};
    const whitelist = cfg.whitelist || [];
    whitelist.splice(idx, 1);
    await saveSettings({ whitelist });
    renderWhitelist(whitelist);
  });

  /* Reset statistics */
  $('dsb-reset-btn').addEventListener('click', async () => {
    if (!confirm('Reset all statistics? This cannot be undone.')) return;
    await chrome.storage.local.remove('dsbStats');
    loadStats();
  });
}

/* ─── Boot ───────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  loadSession();
  loadStats();
  loadSettings();
  bindEvents();
});
