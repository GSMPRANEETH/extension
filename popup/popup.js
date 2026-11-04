/**
 * popup.js — Doom Scroll Blocker popup UI logic.
 *
 * Reads data from chrome.storage.local and the background service worker to
 * display the current session, aggregate statistics, and settings.
 */

'use strict';

/* ─── Sensitivity labels ─────────────────────────────────────────────────── */
const SENSITIVITY_LABELS = ['Low', 'Medium', 'High'];
const ONBOARDING_KEY = 'dsbHasSeenOnboarding';
const CUSTOM_CONFIG_KEY = 'dsbCustomConfig';

// Default values for UI controls (matches the defaults in background template)
const UI_DEFAULTS = {
  contextMultipliers: {
    'short_form_feed': 1.5,
    'social_feed': 1.2,
    'comments_section': 0.8,
    'news_feed': 1.0,
    'video_player': 0.3,
    'search': 0.2,
    'productive': 0.0,
    'unknown': 0.5
  },
  scoreThresholds: {
    SAFE: 25,
    WARNING: 40,
    STRONG_WARNING: 65
  },
  motivationalMessageFrequency: 1.0,
  breakDuration: 600000 // 10 minutes in milliseconds
};

const POPUP_REFRESH_INTERVAL = 5000; // Auto-refresh session and stats every 5 seconds

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

function $(id) { return document.getElementById(id); }

/* ─── Context label helpers ──────────────────────────────────────────────── */
const CONTEXT_LABELS = {
  'short_form_feed':  'Short-form Feed 🎬',
  'social_feed':      'Social Feed 📱',
  'comments_section': 'Comments 💬',
  'news_feed':        'News Feed 📰',
  'video_player':     'Video Player ▶️',
  'search':           'Search 🔍',
  'productive':       'Productive ✅ (exempt)',
  'unknown':          'Unknown'
};

function getContextLabel(context) {
  return CONTEXT_LABELS[context] || context || '—';
}

function renderPageContext(context) {
  const row   = $('dsb-page-type-row');
  const badge = $('dsb-page-type');
  if (!row || !badge) return;

  if (!context || context === 'unknown') {
    row.style.display = 'none';
    return;
  }
  row.style.display = '';
  badge.textContent = getContextLabel(context);
  badge.className = 'dsb-page-type-badge';
  if (context === 'productive') {
    badge.classList.add('dsb-page-type-productive');
  } else if (context === 'short_form_feed' || context === 'social_feed') {
    badge.classList.add('dsb-page-type-high');
  }
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
        $('dsb-session-time').textContent = formatSeconds(session.latestSessionDuration || 0);
        $('dsb-scroll-count').textContent = session.latestScrollCount || 0;
        $('dsb-key-count').textContent    = session.latestKeyPressCount || 0;
        renderPageContext(session.latestPageContext);
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
      if (tabData.latestSessionDuration !== undefined) {
        $('dsb-session-time').textContent = formatSeconds(tabData.latestSessionDuration || 0);
      }
      if (tabData.latestScrollCount !== undefined) {
        $('dsb-scroll-count').textContent = tabData.latestScrollCount || 0;
      }
      if (tabData.latestKeyPressCount !== undefined) {
        $('dsb-key-count').textContent = tabData.latestKeyPressCount || 0;
      }
      if (tabData.latestPageContext !== undefined) {
        renderPageContext(tabData.latestPageContext);
      }
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

    // Load custom settings and populate advanced UI
    await loadCustomSettings();
  } catch (err) {
    console.error('[DSB Popup] loadSettings error:', err);
  }
}

/* ─── Load custom settings ──────────────────────────────────────────────── */
async function loadCustomSettings() {
  try {
    const result = await chrome.storage.local.get(CUSTOM_CONFIG_KEY);
    const customConfig = result.dsbCustomConfig || {};

    // Populate advanced settings UI if it exists
    if ($('dsb-advanced-settings')) {
      await populateAdvancedUI(customConfig);
    }
  } catch (err) {
    console.error('[DSB Popup] loadCustomSettings error:', err);
  }
}

/* ─── Save custom settings ──────────────────────────────────────────────── */
let settingsUpdate = Promise.resolve();
function saveCustomSettings(patch) {
  settingsUpdate = settingsUpdate.catch(() => {}).then(async () => {
    const result = await chrome.storage.local.get(CUSTOM_CONFIG_KEY);
    const config = result.dsbCustomConfig || {};
    const updated = {
      ...config, ...patch,
      contextMultipliers: { ...config.contextMultipliers, ...patch.contextMultipliers },
      scoreThresholds: { ...config.scoreThresholds, ...patch.scoreThresholds }
    };
    await chrome.storage.local.set({ dsbCustomConfig: updated });

    // Also update the background page so it uses the new settings immediately
    chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED' });
  }).catch((err) => {
    console.error('[DSB Popup] saveCustomSettings error:', err);
  });
  return settingsUpdate;
}

/* ─── Populate advanced settings UI ─────────────────────────────────────── */
async function populateAdvancedUI(customConfig) {
  // Populate context multipliers
  const contextMultipliersContainer = $('dsb-context-multipliers');
  if (contextMultipliersContainer) {
    contextMultipliersContainer.innerHTML = ''; // Clear existing

    const contexts = [
      { id: 'short_form_feed', label: 'Short-form Feed' },
      { id: 'social_feed', label: 'Social Feed' },
      { id: 'comments_section', label: 'Comments Section' },
      { id: 'news_feed', label: 'News Feed' },
      { id: 'video_player', label: 'Video Player' },
      { id: 'search', label: 'Search' },
      { id: 'productive', label: 'Productive' },
      { id: 'unknown', label: 'Unknown' }
    ];

    contexts.forEach(ctx => {
      const value = customConfig.contextMultipliers?.[ctx.id] ?? UI_DEFAULTS.contextMultipliers[ctx.id];
      const container = document.createElement('div');
      container.className = 'dsb-field-row';
      container.innerHTML = `
        <label class="dsb-field-label" for="dsb-context-${ctx.id}">${ctx.label} Multiplier</label>
        <input type="range" id="dsb-context-${ctx.id}" min="0" max="3" step="0.1" value="${value}" class="dsb-slider" />
        <span id="dsb-context-${ctx.id}-value">${value.toFixed(1)}</span>
      `;
      contextMultipliersContainer.appendChild(container);

      // Add event listener for this slider
      const slider = $(`dsb-context-${ctx.id}`);
      const valueSpan = $(`dsb-context-${ctx.id}-value`);
      slider.addEventListener('input', () => {
        valueSpan.textContent = slider.value;
        saveCustomSettings({
          contextMultipliers: {
            [ctx.id]: parseFloat(slider.value)
          }
        });
      });
    });
  }

  // Populate score thresholds
  const scoreThresholdsContainer = $('dsb-score-thresholds');
  if (scoreThresholdsContainer) {
    scoreThresholdsContainer.innerHTML = ''; // Clear existing

    const thresholds = [
      { id: 'SAFE', label: 'Safe Threshold' },
      { id: 'WARNING', label: 'Warning Threshold' },
      { id: 'STRONG_WARNING', label: 'Strong Warning Threshold' }
    ];

    thresholds.forEach(th => {
      const value = customConfig.scoreThresholds?.[th.id] ?? UI_DEFAULTS.scoreThresholds[th.id];
      const container = document.createElement('div');
      container.className = 'dsb-field-row';
      container.innerHTML = `
        <label class="dsb-field-label" for="dsb-threshold-${th.id}">${th.label}</label>
        <input type="range" id="dsb-threshold-${th.id}" min="0" max="100" step="1" value="${value}" class="dsb-slider" />
        <span id="dsb-threshold-${th.id}-value">${value}</span>
      `;
      scoreThresholdsContainer.appendChild(container);

      // Add event listener for this slider
      const slider = $(`dsb-threshold-${th.id}`);
      const valueSpan = $(`dsb-threshold-${th.id}-value`);
      slider.addEventListener('input', () => {
        valueSpan.textContent = slider.value;
        saveCustomSettings({
          scoreThresholds: {
            [th.id]: parseInt(slider.value)
          }
        });
      });
    });
  }

  // Set motivational message frequency
  const motivFrequencySlider = $('dsb-motiv-frequency');
  if (motivFrequencySlider) {
    const frequency = customConfig.motivationalMessageFrequency ?? UI_DEFAULTS.motivationalMessageFrequency;
    motivFrequencySlider.value = frequency;
    $('dsb-motiv-frequency-value').textContent = `${(frequency * 100).toFixed(0)}%`;

    motivFrequencySlider.oninput = () => {
      const value = motivFrequencySlider.value;
      $('dsb-motiv-frequency-value').textContent = `${(value * 100).toFixed(0)}%`;
      saveCustomSettings({ motivationalMessageFrequency: parseFloat(value) });
    };
  }

  // Set break duration
  const breakDurationSlider = $('dsb-break-duration');
  if (breakDurationSlider) {
    const duration = customConfig.breakDuration ?? UI_DEFAULTS.breakDuration;
    const durationInMinutes = duration / 60000; // Convert milliseconds to minutes
    breakDurationSlider.value = durationInMinutes;
    $('dsb-break-duration-value').textContent = durationInMinutes;

    breakDurationSlider.oninput = () => {
      const value = breakDurationSlider.value;
      $('dsb-break-duration-value').textContent = value;
      saveCustomSettings({ breakDuration: parseInt(value) * 60000 }); // Convert minutes to milliseconds
    };
  }
}

/* ─── Data Export/Import ───────────────────────────────────────────── */
async function exportSettings() {
  try {
    // Gather all settings to export
    const settingsResult = await chrome.storage.local.get(null);

    // Filter out internal keys if needed
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      settings: {
        dsbSettings: settingsResult.dsbSettings || {},
        dsbCustomConfig: settingsResult.dsbCustomConfig || {},
        dsbHasSeenOnboarding: settingsResult.dsbHasSeenOnboarding || false
      }
    };

    // Create blob and trigger download
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);

    // Create a temporary link and click it
    const a = document.createElement('a');
    a.href = url;
    a.download = `doom-scroll-blocker-settings-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();

    // Clean up
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Show success message
    showImportStatus('Settings exported successfully!', 'success');
  } catch (err) {
    console.error('[DSB Popup] exportSettings error:', err);
    showImportStatus('Failed to export settings', 'error');
  }
}

function validateImportedSettings(data) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const numeric = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  if (!object(data) || data.version !== '1.0' || !object(data.settings)) throw new Error('Invalid settings file');
  const settings = data.settings;
  const allowed = ['dsbSettings', CUSTOM_CONFIG_KEY, ONBOARDING_KEY];
  if (Object.keys(settings).some(key => !allowed.includes(key))) throw new Error('Unknown settings key');
  if ('dsbSettings' in settings) {
    const cfg = settings.dsbSettings;
    if (!object(cfg) || Object.keys(cfg).some(key => !['enabled', 'motivationalMessages', 'sensitivity', 'whitelist'].includes(key))) throw new Error('Invalid main settings');
    for (const key of ['enabled', 'motivationalMessages']) {
      if (key in cfg && typeof cfg[key] !== 'boolean') throw new Error('Invalid toggle');
    }
    if ('sensitivity' in cfg && !['low', 'medium', 'high'].includes(cfg.sensitivity)) throw new Error('Invalid sensitivity');
    if ('whitelist' in cfg && (!Array.isArray(cfg.whitelist) || cfg.whitelist.some(domain => typeof domain !== 'string' || domain.length > 253 || !/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain)))) throw new Error('Invalid whitelist');
  }
  if (CUSTOM_CONFIG_KEY in settings) {
    const cfg = settings[CUSTOM_CONFIG_KEY];
    if (!object(cfg) || Object.keys(cfg).some(key => !Object.hasOwn(UI_DEFAULTS, key))) throw new Error('Invalid custom settings');
    for (const [key, max] of [['contextMultipliers', 3], ['scoreThresholds', 100]]) {
      if (key in cfg && (!object(cfg[key]) || Object.entries(cfg[key]).some(([name, value]) => !Object.hasOwn(UI_DEFAULTS[key], name) || !numeric(value, 0, max)))) throw new Error('Invalid scoring settings');
    }
    if ('motivationalMessageFrequency' in cfg && !numeric(cfg.motivationalMessageFrequency, 0, 1)) throw new Error('Invalid message frequency');
    if ('breakDuration' in cfg && !numeric(cfg.breakDuration, 60000, 1800000)) throw new Error('Invalid break duration');
  }
  if (ONBOARDING_KEY in settings && typeof settings[ONBOARDING_KEY] !== 'boolean') throw new Error('Invalid onboarding status');
  return settings;
}

async function importSettings() {
  try {
    const fileInput = $('dsb-import-input');
    if (!fileInput.files || fileInput.files.length === 0) {
      showImportStatus('Please select a file to import', 'error');
      return;
    }

    const file = fileInput.files[0];
    const text = await file.text();
    const importData = JSON.parse(text);

    const settings = validateImportedSettings(importData);
    settingsUpdate = settingsUpdate.catch(() => {}).then(() => chrome.storage.local.set(settings));
    await settingsUpdate;

    // Notify background page to reload settings
    chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED' });

    // Show success message
    showImportStatus('Settings imported successfully!', 'success');

    // Reload UI to reflect new settings
    loadSettings();

    // Reset file input
    fileInput.value = '';
  } catch (err) {
    console.error('[DSB Popup] importSettings error:', err);
    showImportStatus('Failed to import settings: Invalid file or format', 'error');
  }
}

async function resetAllSettings() {
  if (!confirm('Are you sure you want to reset all settings to defaults? This cannot be undone.')) {
    return;
  }

  try {
    settingsUpdate = settingsUpdate.catch(() => {}).then(() => chrome.storage.local.remove(['dsbSettings', CUSTOM_CONFIG_KEY, ONBOARDING_KEY]));
    await settingsUpdate;

    // Reset UI to defaults
    loadSettings();

    // Notify background page
    chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED' });

    showImportStatus('All settings reset to defaults!', 'success');
  } catch (err) {
    console.error('[DSB Popup] resetAllSettings error:', err);
    showImportStatus('Failed to reset settings', 'error');
  }
}

function showImportStatus(message, type = 'info') {
  const statusEl = $('dsb-import-status');
  statusEl.textContent = message;
  statusEl.className = `dsb-import-status dsb-import-status-${type}`;

  // Hide after 3 seconds for success/error, keep info messages visible
  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      statusEl.textContent = '';
      statusEl.className = 'dsb-import-status';
    }, 3000);
  }
}

/* ─── Save settings helper ───────────────────────────────────────────────── */
function saveSettings(patch) {
  settingsUpdate = settingsUpdate.catch(() => {}).then(async () => {
    const result = await chrome.storage.local.get('dsbSettings');
    const updated = { ...result.dsbSettings, ...patch };
    await chrome.storage.local.set({ dsbSettings: updated });
  }).catch((err) => {
    console.error('[DSB Popup] saveSettings error:', err);
  });
  return settingsUpdate;
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

/* ─── Onboarding functions ──────────────────────────────────────────────── */
async function hasSeenOnboarding() {
  const result = await chrome.storage.local.get(ONBOARDING_KEY);
  return result[ONBOARDING_KEY] === true;
}

async function setOnboardingSeen() {
  await chrome.storage.local.set({ [ONBOARDING_KEY]: true });
}

function showOnboarding() {
  const onboarding = $('dsb-onboarding');
  const sessionPanel = $('dsb-session-panel');
  const statsPanel = $('dsb-stats-panel');
  const settingsPanel = $('dsb-settings-panel');
  const footer = $('dsb-footer');
  const insights = $('dsb-insights-panel');
  if (onboarding) onboarding.style.display = 'block';
  if (insights) insights.style.display = 'none';
  $('dsb-toggle-btn').disabled = true;
  if (sessionPanel) sessionPanel.style.display = 'none';
  if (statsPanel) statsPanel.style.display = 'none';
  if (settingsPanel) settingsPanel.style.display = 'none';
  if (footer) footer.style.display = 'none';
}

function hideOnboarding() {
  const onboarding = $('dsb-onboarding');
  const sessionPanel = $('dsb-session-panel');
  const statsPanel = $('dsb-stats-panel');
  const settingsPanel = $('dsb-settings-panel');
  const footer = $('dsb-footer');
  const insights = $('dsb-insights-panel');
  if (onboarding) onboarding.style.display = 'none';
  if (insights) insights.style.display = '';
  $('dsb-toggle-btn').disabled = false;
  if (sessionPanel) sessionPanel.style.display = 'block';
  if (statsPanel) statsPanel.style.display = 'block';
  if (settingsPanel) settingsPanel.style.display = 'block';
  if (footer) footer.style.display = 'block';
}

/* ─── Onboarding navigation ─────────────────────────────────────────────── */
function initOnboarding() {
  const steps = $$('.dsb-onboarding-step');
  let currentStep = 0;

  function showStep(index) {
    steps.forEach((step, i) => {
      if (step) {
        step.style.display = i === index ? 'block' : 'none';
      }
    });
    const prevBtn = $('dsb-onboarding-prev');
    const nextBtn = $('dsb-onboarding-next');
    if (prevBtn) prevBtn.disabled = index === 0;
    if (nextBtn) {
      if (index === steps.length - 1) {
        nextBtn.textContent = 'Finish';
        nextBtn.classList.add('dsb-btn-success');
      } else {
        nextBtn.textContent = 'Next';
        nextBtn.classList.remove('dsb-btn-success');
      }
    }
  }

  function nextStep() {
    if (currentStep < steps.length - 1) {
      currentStep++;
      showStep(currentStep);
    } else {
      // Finish onboarding
      setOnboardingSeen().then(() => {
        hideOnboarding();
        loadSession();
        loadStats();
        loadSettings();
        loadAndDisplayInsights();
        bindEvents();
        startRefreshInterval();
      });
    }
  }

  function prevStep() {
    if (currentStep > 0) {
      currentStep--;
      showStep(currentStep);
    }
  }

  const nextBtn = $('dsb-onboarding-next');
  const prevBtn = $('dsb-onboarding-prev');
  if (nextBtn) nextBtn.addEventListener('click', nextStep);
  if (prevBtn) prevBtn.addEventListener('click', prevStep);

  showStep(currentStep);
}

/* ─── Score rendering ──────────────────────────────────────────────────── */
function renderScore(score) {
  const pill  = $('dsb-score-pill');
  const value = $('dsb-score-value');

  value.textContent = score !== null ? String(score) : '—';

  pill.classList.remove('dsb-score-safe', 'dsb-score-warn', 'dsb-score-danger');
  if (score === null) return;
  if (score >= 65)       pill.classList.add('dsb-score-danger');
  else if (score >= 40)  pill.classList.add('dsb-score-warn');
  else                   pill.classList.add('dsb-score-safe');
}

/* ─── Wire up event listeners ───────────────────────────────────────────── */
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
    const chevron = toggle.querySelector('.dsb-chevron');
    if (chevron) {
      chevron.style.transform = expanded ? '' : 'rotate(180deg)';
    }
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

  /* Advanced customization checkbox */
  $('dsb-advanced-checkbox').addEventListener('change', async (e) => {
    const advancedSettings = $('dsb-advanced-settings');
    if (advancedSettings) {
      if (e.target.checked) {
        advancedSettings.style.display = 'block';
      } else {
        advancedSettings.style.display = 'none';
      }
    }
  });

  /* Data Export/Import */
  $('dsb-export-btn').addEventListener('click', exportSettings);
  $('dsb-import-trigger').addEventListener('click', () => {
    $('dsb-import-input').click();
  });
  $('dsb-import-input').addEventListener('change', importSettings);
  $('dsb-reset-all-btn').addEventListener('click', resetAllSettings);

  /* Reset statistics */
  $('dsb-reset-btn').addEventListener('click', async () => {
    if (!confirm('Reset all statistics? This cannot be undone.')) return;
    await chrome.storage.local.remove('dsbStats');
    loadStats();
  });

  /* Insights panel collapsible */
  const insightsToggle = $('dsb-insights-toggle');
  const insightsBody   = $('dsb-insights-body');
  if (insightsToggle && insightsBody) {
    insightsToggle.addEventListener('click', () => {
      const expanded = insightsToggle.getAttribute('aria-expanded') === 'true';
      insightsToggle.setAttribute('aria-expanded', String(!expanded));
      insightsBody.hidden = expanded;
      const chevron = insightsToggle.querySelector('.dsb-chevron');
      if (chevron) {
        chevron.style.transform = expanded ? '' : 'rotate(180deg)';
      }
    });
  }

  /* Period selector buttons */
  const periodDaily = $('dsb-period-daily');
  const periodWeekly = $('dsb-period-weekly');
  const periodMonthly = $('dsb-period-monthly');
  const exportStatsBtn = $('dsb-export-stats-btn');

  if (periodDaily && periodWeekly && periodMonthly && exportStatsBtn) {
    periodDaily.addEventListener('click', () => {
      setActivePeriod('daily');
      loadAndDisplayInsights();
    });
    periodWeekly.addEventListener('click', () => {
      setActivePeriod('weekly');
      loadAndDisplayInsights();
    });
    periodMonthly.addEventListener('click', () => {
      setActivePeriod('monthly');
      loadAndDisplayInsights();
    });

    /* Export statistics */
    exportStatsBtn.addEventListener('click', exportStatistics);
  }
}

/* ─── Refresh interval ─────────────────────────────────────────────────── */
let refreshIntervalId = null;

function startRefreshInterval() {
  refreshIntervalId = setInterval(() => {
    loadSession();
    loadStats();
    loadAndDisplayInsights();
  }, POPUP_REFRESH_INTERVAL);
}

function stopRefreshInterval() {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
}

/* ─── Helper to get all elements matching a selector ────────────────────── */
function $$(selector) {
  return Array.from(document.querySelectorAll(selector));
}

/* ─── Insights helper functions ─────────────────────────────────────────── */
/**
 * Sets the active period button and stores the selected period
 */
let activePeriod = 'daily'; // Default to daily

function setActivePeriod(period) {
  activePeriod = period;
  // Update button styles
  $('dsb-period-daily').classList.toggle('dsb-period-active', period === 'daily');
  $('dsb-period-weekly').classList.toggle('dsb-period-active', period === 'weekly');
  $('dsb-period-monthly').classList.toggle('dsb-period-active', period === 'monthly');
}

/**
 * Loads statistics data and updates the insights display
 */
async function loadAndDisplayInsights() {
  try {
    // Fetch all stats from storage
    const result = await chrome.storage.local.get('dsbStats');
    const stats = result.dsbStats || {};

    // Update insights display based on active period
    await updateInsightsDisplay(stats);

    // Render charts
    renderCharts(stats);
  } catch (err) {
    console.error('[DSB Popup] loadAndDisplayInsights error:', err);
  }
}

/**
 * Updates the insights panel with calculated metrics
 */
async function updateInsightsDisplay(stats) {
  // Update focus sessions
  const focusSessions = calculateFocusSessions(stats);
  const focusSessionsEl = $('dsb-focus-sessions');
  if (focusSessionsEl) {
    focusSessionsEl.textContent = focusSessions;
  }

  // Update time saved (placeholder - would need baseline comparison)
  const timeSaved = calculateTimeSaved(stats);
  const timeSavedEl = $('dsb-time-saved');
  if (timeSavedEl) {
    timeSavedEl.textContent = timeSaved === null ? '—' : formatMinutes(timeSaved);
  }

  // Update improvement trend
  const improvementTrend = calculateImprovementTrend(stats);
  const improvementTrendEl = $('dsb-improvement-trend');
  if (improvementTrendEl) {
    improvementTrendEl.textContent = improvementTrend;
  }
}

/**
 * Calculates focus sessions (sessions that ended without warnings)
 * This is a simplified implementation - in reality we'd need to track session outcomes
 */
function calculateFocusSessions(stats) {
  // Session outcomes are not recorded, so do not invent a focus-session count.
  return '—';
}

/**
 * Calculates estimated time saved compared to a baseline
 * This would need user-defined goals or historical averages
 */
function calculateTimeSaved(stats) {
  // Time saved requires a measured baseline that this version does not collect.
  return null;
}

/**
 * Calculates improvement trend compared to previous period
 */
function calculateImprovementTrend(stats) {
  const periods = stats[`${activePeriod}Stats`] || {};
  const keys = Object.keys(periods).sort();
  if (keys.length < 2) return '—';
  const previous = periods[keys[keys.length - 2]].sessionTime || 0;
  const current = periods[keys[keys.length - 1]].sessionTime || 0;
  if (!previous) return '—';
  // shortcut: raw recorded periods can be partial, normalize complete periods before claiming a rate trend.
  const change = Math.round((previous - current) / previous * 100);
  return `${Math.abs(change)}% ${change >= 0 ? 'less' : 'more'} time`;

}

/**
 * Renders charts using Canvas API
 */
function renderCharts(stats) {
  try {
    // Render trends chart (line chart showing daily activity over time)
    const trendsChart = $('dsb-trends-chart');
    if (trendsChart) {
      renderTrendsChart(stats, trendsChart);
    }

    // Render sites chart (pie chart showing distribution of activity by site)
    const sitesChart = $('dsb-sites-chart');
    if (sitesChart) {
      renderSitesChart(stats, sitesChart);
    }
  } catch (err) {
    console.error('[DSB Popup] renderCharts error:', err);
  }
}

/**
 * Renders a line chart showing daily scrolling trends
 */
function renderTrendsChart(stats, canvas) {
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d');

  // Get daily stats for the last 7 days
  const dailyStats = stats[`${activePeriod}Stats`] || {};
  const dates = Object.keys(dailyStats).sort().slice(-7);

  const data = dates.map(date => {
    const dayStats = dailyStats[date] || {};
    return (dayStats.sessionTime || 0) / 60; // Minutes, matching the axis label
  });

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Simple line chart rendering
  if (data.length === 0) {
    ctx.fillStyle = '#666';
    ctx.font = '14px Arial';
    ctx.fillText('No data available', 50, 100);
    return;
  }

  // Chart configuration
  const padding = 40;
  const chartWidth = canvas.width - 2 * padding;
  const chartHeight = canvas.height - 2 * padding;
  const maxValue = Math.max(...data) || 1;

  // Draw axes
  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padding, chartHeight + padding);
  ctx.lineTo(padding, padding); // Y-axis
  ctx.lineTo(padding + chartWidth, chartHeight + padding); // X-axis
  ctx.stroke();

  // Draw data points and line
  ctx.strokeStyle = '#ff6b6b';
  ctx.lineWidth = 3;
  ctx.beginPath();

  data.forEach((value, index) => {
    const x = padding + (index * (chartWidth / Math.max(data.length - 1, 1)));
    const y = chartHeight + padding - (value / maxValue) * chartHeight;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }

  });
  ctx.stroke();
  data.forEach((value, index) => {
    const x = padding + (index * (chartWidth / Math.max(data.length - 1, 1)));
    const y = chartHeight + padding - (value / maxValue) * chartHeight;
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw labels (simplified)
  ctx.fillStyle = '#333';
  ctx.font = '12px Arial';
  ctx.textAlign = 'center';
  dates.forEach((date, index) => {
    const x = padding + (index * (chartWidth / Math.max(data.length - 1, 1)));
    const y = chartHeight + padding + 20;
    // Show just month-day for brevity
    const label = date.substring(5); // MM-DD
    ctx.fillText(label, x, y);
  });

  // Y-axis label
  ctx.save();
  ctx.translate(15, chartHeight / 2 + padding);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('Minutes', 0, 0);
  ctx.restore();
}

/**
 * Renders a pie chart showing site distribution
 */
function renderSitesChart(stats, canvas) {
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d');

  // Get site breakdown stats
  const siteBreakdown = stats.siteBreakdown || {};

  // Convert to array and sort by session time
  const sites = Object.entries(siteBreakdown)
    .map(([hostname, data]) => ({
      hostname: hostname.length > 15 ? hostname.substring(0, 12) + '...' : hostname,
      time: data.sessionTime || 0
    }))
    .filter(site => site.time > 0)
    .sort((a, b) => b.time - a.time)
    .slice(0, 5); // Top 5 sites

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (sites.length === 0) {
    ctx.fillStyle = '#666';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('No site data available', canvas.width / 2, canvas.height / 2);
    return;
  }

  // Calculate total time for percentages
  const totalTime = sites.reduce((sum, site) => sum + site.time, 0);

  // Draw pie chart
  let startAngle = 0;
  const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7'];

  sites.forEach((site, index) => {
    const endAngle = startAngle + (site.time / totalTime) * 2 * Math.PI;

    ctx.fillStyle = colors[index % colors.length];
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, canvas.height / 2);
    ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.4, startAngle, endAngle);
    ctx.closePath();
    ctx.fill();

    // Add label
    const labelAngle = startAngle + (endAngle - startAngle) / 2;
    const labelX = canvas.width / 2 + Math.cos(labelAngle) * (Math.min(canvas.width, canvas.height) * 0.6);
    const labelY = canvas.height / 2 + Math.sin(labelAngle) * (Math.min(canvas.width, canvas.height) * 0.6);

    ctx.fillStyle = '#333';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    const percentage = ((site.time / totalTime) * 100).toFixed(1) + '%';
    ctx.fillText(`${site.hostname}\n${percentage}`, labelX, labelY);

    startAngle = endAngle;
  });
}

/**
 * Exports statistics data as CSV
 */
async function exportStatistics() {
  try {
    // Fetch all stats from storage
    const result = await chrome.storage.local.get(null);

    // Prepare CSV data
    const csvRows = [];

    // Add header
    csvRows.push(['Doom Scroll Blocker Statistics Export']);
    csvRows.push([`Export Date: ${new Date().toISOString()}`]);
    csvRows.push([]); // Empty row

    // Add lifetime totals
    csvRows.push(['Lifetime Statistics']);
    csvRows.push(['Metric', 'Value']);
    const stats = result.dsbStats || {};
    csvRows.push(['Total Scrolls', stats.totalScrollCount || 0]);
    csvRows.push(['Total Key Presses', stats.totalKeyPresses || 0]);
    csvRows.push(['Total Session Time (seconds)', stats.totalSessionTime || 0]);
    csvRows.push(['Total Warnings Triggered', stats.totalWarningsTriggered || 0]);
    csvRows.push(['Doom Sessions', stats.doomScrollSessions || 0]);
    csvRows.push([]); // Empty row

    // Add daily stats if available
    if (stats.dailyStats && Object.keys(stats.dailyStats).length > 0) {
      csvRows.push(['Daily Statistics (Last 30 Days)']);
      csvRows.push(['Date', 'Scrolls', 'Key Presses', 'Session Time (s)', 'Warnings', 'Doom Sessions']);

      // Sort dates descending and take last 30 days
      const sortedDates = Object.keys(stats.dailyStats).sort().slice(-30);
      sortedDates.forEach(date => {
        const dayStats = stats.dailyStats[date] || {};
        csvRows.push([
          date,
          dayStats.scrollCount || 0,
          dayStats.keyPressCount || 0,
          dayStats.sessionTime || 0,
          dayStats.warningsTriggered || 0,
          dayStats.doomSessions || 0
        ]);
      });
      csvRows.push([]); // Empty row
    }

    // Add site breakdown
    if (stats.siteBreakdown && Object.keys(stats.siteBreakdown).length > 0) {
      csvRows.push(['Site Breakdown']);
      csvRows.push(['Site', 'Scrolls', 'Session Time (s)', 'Warnings']);

      // Sort by warning count descending
      const sortedSites = Object.entries(stats.siteBreakdown)
        .sort((a, b) => (b[1].warningCount || 0) - (a[1].warningCount || 0))
        .slice(0, 20); // Top 20 sites

      sortedSites.forEach(([hostname, data]) => {
        csvRows.push([
          hostname,
          data.scrollCount || 0,
          data.sessionTime || 0,
          data.warningCount || 0
        ]);
      });
    }

    // Create blob and trigger download
    const csvContent = csvRows.map(row => row.map(value => {
      let field = String(value);
      if (typeof value === 'string' && /^[=+\-@\t\r]/.test(field)) field = "'" + field;
      return '"' + field.replaceAll('"', '""') + '"';
    }).join(',')).join('\n');
    const blob = new Blob([csvContent], {type: 'text/csv'});
    const url = URL.createObjectURL(blob);

    // Create a temporary link and click it
    const a = document.createElement('a');
    a.href = url;
    a.download = `doom-scroll-blocker-statistics-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();

    // Clean up
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Show success message
    showImportStatus('Statistics exported successfully!', 'success');
  } catch (err) {
    console.error('[DSB Popup] exportStatistics error:', err);
    showImportStatus('Failed to export statistics', 'error');
  }
}

/* ─── Boot ───────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  const seen = await hasSeenOnboarding();
  if (!seen) {
    showOnboarding();
    initOnboarding();
  } else {
    loadSession();
    loadStats();
    loadSettings();
    loadAndDisplayInsights(); // Initialize insights panel
    bindEvents();
    startRefreshInterval();
  }

  // Clean up interval when popup closes
  window.addEventListener('unload', () => {
    stopRefreshInterval();
  });
});