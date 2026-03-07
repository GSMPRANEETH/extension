# 🛡️ Doom Scroll Blocker

A Chrome Extension that helps you break the doom-scrolling habit on YouTube Shorts, Instagram Reels, TikTok, and Twitter/X — while **never** interrupting long videos like lectures or movies.

---

## ✨ Features

- **Smart Doom-Scroll Detection** — a weighted scoring algorithm that analyses scroll depth, key presses, infinite-feed triggers, and short-video consumption to detect problematic browsing patterns.
- **Long-Video Bypass** — automatically suppresses all warnings when a video longer than 10 minutes is playing (lectures, movies, documentaries).
- **Idle Detection** — pauses tracking when you walk away from your desk (2-minute idle threshold), avoiding false positives.
- **Two Warning Levels**
  - ⚠️ *Warning* — gentle overlay with motivational message, stats, and a 5-minute snooze option.
  - 🚨 *Strong Warning* — red overlay with a mandatory 60-second countdown before you can dismiss it.
- **Final Reminder** — if you dismiss a strong warning and keep scrolling for 5 more minutes, a final reminder fires.
- **Popup Dashboard** — view your current session score (colour-coded green/yellow/red), scroll counts, aggregate daily stats, and top doom-scroll sites.
- **Configurable Sensitivity** — Low / Medium / High sensitivity slider adjusts all score thresholds.
- **Whitelist** — add any domain to never trigger warnings on that site.
- **Motivational Messages** — a pool of 10 messages randomly shown in overlays (can be toggled off).
- **Shadow DOM Isolation** — overlay UI is rendered inside a Shadow DOM to avoid any conflicts with host-page styles.

---

## 🚀 Installation (Load Unpacked)

1. Clone or download this repository.
2. Open **Chrome** and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the root folder of this repository (the one containing `manifest.json`).
5. The 🛡️ Doom Scroll Blocker icon will appear in your toolbar.

> **Note:** Because PNG icons are minimal placeholders, the toolbar icon will appear as a teal square. Replace the files in `icons/` with proper artwork for production use. The `icons/icon.svg` file contains a reference SVG design.

---

## ⚙️ How It Works

### Architecture

```
extension/
├── manifest.json             # Manifest V3 — declares permissions, content scripts, service worker
├── utils/constants.js        # Shared constants loaded before all content scripts
├── background/background.js  # Service worker — scoring, state management, alarms
├── content/
│   ├── content.js            # Tracks scroll, key presses, video duration; sends activity reports
│   ├── overlay.js            # Renders warning overlays inside a Shadow DOM
│   └── overlay.css           # Minimal document-level styles for the shadow host
├── popup/
│   ├── popup.html            # Popup layout
│   ├── popup.js              # Reads storage, renders stats & settings
│   └── popup.css             # Dark-theme popup styles
└── icons/
    ├── icon.svg              # Reference SVG design
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Doom-Scroll Scoring Algorithm

Every 30 seconds the content script sends an `ACTIVITY_REPORT` to the background service worker. The worker computes a score:

| Condition | Points |
|-----------|--------|
| Session > 10 minutes | +30 |
| > 100 scroll events | +25 |
| > 50 doom-scroll key presses | +15 |
| Hit feed bottom > 5 times | +20 |
| > 10 short videos (< 2 min) | +25 |
| Idle time < 30 s (constant engagement) | −10 |
| Long video (> 10 min) playing | −50 |

**Thresholds:**
- Score ≥ 60 → Warning overlay
- Score ≥ 80 → Strong warning overlay
- Score < 40 → Safe, no action

### Supported Sites

- YouTube (`youtube.com`)
- Instagram (`instagram.com`)
- TikTok (`tiktok.com`)
- Twitter (`twitter.com`)
- X (`x.com`)

---

## 🔧 Configuration

Open the extension popup and expand **⚙️ Settings**:

| Setting | Description |
|---------|-------------|
| Enable/Disable | Master toggle to pause all tracking |
| Detection Sensitivity | Low / Medium / High — scales all score thresholds |
| Motivational Messages | Toggle the motivational quote in overlays on/off |
| Whitelist | Add domains that should never trigger warnings |

Click **Reset Statistics** in the footer to clear all accumulated data.

---

## 📸 Screenshots

> _Screenshots will be added once the extension UI is fully polished._

---

## 🛠 Tech Stack

- **Manifest V3** Chrome Extension API
- Vanilla **JavaScript** (no dependencies)
- **Shadow DOM** for style isolation
- **CSS Custom Properties** for theming
- `chrome.storage.local`, `chrome.alarms`, `chrome.tabs`

---

## 🤝 Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/my-feature`.
3. Commit your changes: `git commit -m "feat: add my feature"`.
4. Push to the branch: `git push origin feature/my-feature`.
5. Open a Pull Request.

Please keep PRs focused and include a clear description of the change.

---

## 📄 License

MIT © GSMPRANEETH