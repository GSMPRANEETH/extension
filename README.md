# 🛡️ Doom Scroll Blocker

A Chrome extension that helps you break the doom-scrolling habit on YouTube Shorts, Instagram Reels, TikTok and Twitter/X — while **never** interrupting long videos like lectures or movies.

---

## ✨ Features

- **Smart doom-scroll detection** — a weighted scoring algorithm that analyses session length, scroll depth, key presses, infinite-feed triggers and short-video consumption.
- **Context-aware scoring** — the raw score is scaled by the kind of page you are on, so a short-form feed counts far more than a search results page, and productive pages never trigger a warning.
- **Long-video bypass** — warnings are suppressed automatically while a video longer than 10 minutes is playing (lectures, movies, documentaries).
- **Idle detection** — tracking pauses after 2 minutes of inactivity, which avoids false positives when you walk away from your desk.
- **Two warning levels**
  - ⚠️ *Warning* — overlay with a motivational message, live statistics and a 5-minute snooze.
  - 🚨 *Strong warning* — red overlay with a mandatory countdown before it can be dismissed.
- **Final reminder** — dismissing a strong warning and scrolling for 5 more minutes triggers one last reminder.
- **Take-a-break mode** — the overlay can block a site for a configurable break (10 minutes by default) and shows a full-screen break card until the break is over.
- **Insights dashboard** — daily / weekly / monthly selectors, a trends chart, a per-site breakdown, and three headline metrics (focus periods, time saved, warning trend).
- **Statistics export** — download the accumulated statistics as a CSV file.
- **First-run onboarding** — a four-step introduction shown the first time the popup is opened.
- **Whitelist** — never trigger warnings on the domains you choose.
- **Motivational messages** — a pool of 10 messages, randomly shown in overlays, can be switched off.
- **Settings export / import** — back up or move your settings, whitelist and preferences as a JSON file.
- **Shadow DOM isolation** — the overlay UI is rendered inside a Shadow DOM so it never conflicts with the host page's styles.

---

## 🚀 Installation (Load Unpacked)

1. Clone or download this repository.
2. Open **Chrome** and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the root folder of this repository (the one containing `manifest.json`).
5. Build the service worker first (see [Development](#-development)) — `background/background.js` is generated from a template.

---

## 🧮 Doom-scroll scoring algorithm

Every 15 seconds the content script sends an `ACTIVITY_REPORT` to the background service worker. The worker adds up the raw score and then multiplies it by a context multiplier.

**Raw score:**

| Condition | Points |
|-----------|--------|
| Session longer than 60 s | +10 |
| Session longer than 180 s | +15 |
| Session longer than 300 s | +15 |
| More than 10 scroll events | +10 |
| More than 30 scroll events | +10 |
| More than 60 scroll events | +10 |
| More than 10 key presses | +10 |
| More than 30 key presses | +10 |
| Reached the feed bottom more than 3 times | +15 |
| More than 3 short videos (under 2 min) | +10 |
| More than 8 short videos (under 2 min) | +10 |
| Idle for less than 10 s (constant engagement) | +5 |
| Long video (over 10 min) playing | −50 |

**Context multipliers** (`utils/constants.js`):

| Page context | Multiplier |
|--------------|-----------|
| Short-form feed (Shorts / Reels / TikTok) | ×1.5 |
| Social feed (Twitter / Reddit / Facebook) | ×1.2 |
| Comments section | ×0.8 |
| News feed | ×1.0 |
| Video player | ×0.3 |
| Search results | ×0.2 |
| Productive page | ×0.0 — never triggers |
| Unknown | ×0.5 |

**Thresholds** (`SCORE_THRESHOLDS` in `utils/constants.js`):

| Score | Result |
|-------|--------|
| `< 25` | Safe — no action |
| `≥ 25` | Warning overlay |
| `≥ 40` | Strong warning overlay |
| `≥ 65` | Critical — treated as a strong warning |

### Monitored sites

The extension watches **16 sites** by default: YouTube, Instagram, TikTok, Twitter, X, Reddit, Facebook, LinkedIn, Pinterest, Tumblr, 9GAG, BuzzFeed, Imgur, Hacker News, Digg and Quora.

**33 sites are never blocked**, including GitHub, GitLab, Stack Overflow, MDN, Google Docs, Notion, Wikipedia, arXiv, Coursera, LeetCode, FreeCodeCamp, Gmail, Outlook, Google Calendar, Slack, Teams and Zoom. The two lists are kept separate in `utils/constants.js`.

---

## 🔧 Configuration

Open the extension popup and expand **⚙️ Settings**:

| Setting | Description |
|---------|-------------|
| Enable / Disable | Master toggle that pauses all tracking |
| Detection sensitivity | Low / Medium / High — scales the score thresholds |
| Motivational messages | Show the motivational quote in overlays |
| Whitelist | Domains that should never trigger a warning |
| Data export / import | Save your settings as a JSON file, or restore a previous export |
| Advanced customization | Context multipliers, break duration, snooze duration, warning follow-up delay |
| Export statistics | Download the accumulated statistics as CSV |

Click **Reset Statistics** in the footer to clear all accumulated data.

---

## 🛠 Development

The extension has no runtime dependencies. The tooling is plain Node.

```bash
npm install          # install the dev dependencies (ESLint, Jest)
npm run build        # generate background/background.js from the template
npm run watch        # rebuild automatically when a shared source changes
npm test             # run the Jest test suite
npm run lint         # run ESLint over the whole repository
```

### How the code is organised

| Path | Purpose |
|------|---------|
| `utils/constants.js` | **Single source of truth** for every threshold, timer and site list |
| `utils/dates.js` | Daily / ISO-weekly / monthly bucket keys, shared by the worker and the popup |
| `utils/periods.js` | Period arithmetic for the popup's window comparisons |
| `utils/insights.js` | Pure calculations behind the insights panel |
| `background/background.template.js` | Source of the service worker |
| `background/background.js` | **Generated** — do not edit by hand, run `npm run build` |
| `content/content.js` | Activity tracking in the page |
| `content/overlay.js` | Shadow DOM overlays (warnings, break screen) |
| `popup/` | The popup dashboard |
| `scripts/build.js` | The build step that generates the service worker |

The build inlines `utils/constants.js` and `utils/dates.js` into the service worker and **fails loudly** if a placeholder is missing, if a required config key was dropped, or if the generated file is not valid JavaScript. The committed `background/background.js` is checked against a fresh build by the test suite, so a stale service worker can never ship.

---

## 📸 Screenshots

> _Screenshots will be added once the extension UI is fully polished._

---

## 🛠 Tech stack

- **Manifest V3** Chrome extension APIs
- Vanilla **JavaScript** (no runtime dependencies)
- **Shadow DOM** for style isolation
- **CSS custom properties** for theming
- `chrome.storage.local`, `chrome.alarms`, `chrome.tabs`
- **Jest** and **ESLint** for testing and linting

---

## 🤝 Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/my-feature`.
3. Run `npm run build && npm test && npm run lint`.
4. Commit your changes: `git commit -m "feat: add my feature"`.
5. Push to the branch: `git push origin feature/my-feature`.
6. Open a pull request.

Please keep pull requests focused and include a clear description of the change.

---

## 📄 License

MIT © GSMPRANEETH

### Analytics limits

Daily, ISO-week and monthly charts use recorded UTC activity. The insight cards compare
the current seven calendar periods against the seven before them, so a period without
any recorded activity counts as zero rather than disappearing from the comparison. A
period that is still in progress is partial, so the comparison against it is
provisional. Settings imports are validated before a single storage write, and
resetting the settings preserves the recorded activity history.

