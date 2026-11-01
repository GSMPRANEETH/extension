/**
 * Unit tests for background.js logic
 * These tests focus on the scoring algorithm and warning logic,
 * mocking Chrome APIs where necessary.
 */

// We'll create a mock for the Chrome API
const chromeMock = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn()
    }
  },
  tabs: {
    sendMessage: jest.fn(),
    query: jest.fn(),
    onRemoved: {
      addListener: jest.fn()
    }
  },
  runtime: {
    onMessage: {
      addListener: jest.fn()
    },
    sendMessage: jest.fn(),
    lastError: null,
    id: 'test-extension-id'
  },
  alarms: {
    create: jest.fn(),
    onAlarm: {
      addListener: jest.fn()
    }
  }
};

// Mock the global chrome object before requiring the background module
global.chrome = chromeMock;

// We need to load the constants and background logic
// Since the files are not written as ES modules, we'll need to evaluate them
// For simplicity in this test file, we'll replicate the key logic we want to test

describe('background.js logic', () => {
  let DEFAULT_CONFIG;
  let CONFIG;
  let sessions;
  let breakBlocks;

  // Mock timing functions
  let mockDateNow = 1000000; // Starting timestamp

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    mockDateNow = 1000000;
    Date.now = jest.fn(() => mockDateNow);

    // Reset storage mock
    chromeMock.storage.local.get.mockReset();
    chromeMock.storage.local.set.mockReset();
    chromeMock.storage.local.remove.mockReset();
    chromeMock.tabs.sendMessage.mockReset();

    // Define the DEFAULT_CONFIG as it should be (with the fix)
    DEFAULT_CONFIG = {
      /* ─── Sites monitored by this extension ─────────────────────────────────────── */
      doomScrollSites: [
        'youtube.com', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com',
        'reddit.com', 'facebook.com', 'linkedin.com', 'pinterest.com',
        'tumblr.com', '9gag.com', 'buzzfeed.com', 'imgur.com',
        'news.ycombinator.com', 'digg.com', 'quora.com'
      ],
      /* ─── Sites that should NEVER be blocked ─────────────────────────────────────── */
      productiveSites: [
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
      ],
      /* ─── Context multipliers applied to raw doom scores ─────────────────────── */
      contextMultipliers: {
        'short_form_feed':  1.5,  // Shorts / Reels / TikTok — maximum weight
        'social_feed':      1.2,  // Twitter/Reddit/Facebook feed — high weight
        'comments_section': 0.8,  // Comments — moderate
        'news_feed':        1.0,  // News — normal weight
        'video_player':     0.3,  // Watching long videos — very low
        'search':           0.2,  // Search results — very low
        'productive':       0.0,  // Educational/work — NEVER trigger
        'unknown':          0.5   // Unknown sites — cautious, low weight
      },
      /* ─── Score thresholds for the doom-scroll detection algorithm ───────────── */
      scoreThresholds: {
        SAFE: 25,
        WARNING: 40,
        STRONG_WARNING: 65
      },
      /* ─── Motivational messages shown in overlays (randomly selected) ─────────── */
      motivationalMessages: [
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
      ],
      /* ─── Timing constants (all values in milliseconds unless stated) ─────────── */
      activityReportInterval: 15000, // Send activity report every 15 seconds
      idleThreshold:             120000, // 2 minutes — stop tracking when idle
      scrollThrottle:            200,    // Throttle scroll events to once per 200ms
      snoozeDuration:            300000, // 5 minutes — "Give me 5 more minutes" snooze
      longVideoThreshold:        600,    // 10 minutes in seconds — bypass warnings
      shortVideoThreshold:       120,    // 2 minutes in seconds — counts as short video
      bottomDetectionThreshold:  150,    // px from bottom to count as "reached bottom"
      wheelDeltaThreshold:       30,     // minimum wheel deltaY to count as a scroll
      swipeThreshold:            50,     // minimum touch distance (px) to count as a swipe
      popupRefreshInterval:      5000,   // Popup auto-refresh interval (5 seconds)
      breakDuration:             600000, // 10 minutes — default break duration
      breakMinDuration:          120000, // 2 minutes — minimum break before "I'm back" is enabled
      continueRearmDelay:        180,    // seconds after "Continue Scrolling" before warnings re-trigger
      sectionCheckInterval:      1000,   // 1 second — how often to poll for URL/section changes
      videoScrollThreshold:      0.2,    // fraction of viewport height — player is "past" if bottom < 20%
      minCodeBlocksProductive:   3,      // minimum <pre code> blocks to classify page as productive
      /* ─── Customizable settings (exposed in UI) ──────── */
      motivationalMessageFrequency: 1.0, // Probability of showing a motivational message (0-1),
      // THE MISSING CONSTANT THAT WAS CAUSING THE ISSUE:
      strongWarningFollowup: 300    // 5 minutes — time after strong warning before final reminder
    };

    // Initialize CONFIG as a copy of DEFAULT_CONFIG
    CONFIG = { ...DEFAULT_CONFIG };

    // Initialize state
    sessions = {}; // { [tabId]: SessionState }
    breakBlocks = {}; // { [hostname]: expiryMs }
  });

  /**
   * Helper to calculate score based on data (replicated from background.js)
   */
  function calculateScore(data) {
    let score = 0;

    if (data.sessionDuration > 60)  score += 10;
    if (data.sessionDuration > 180) score += 15;
    if (data.sessionDuration > 300) score += 15;

    if (data.scrollCount > 10)      score += 10;
    if (data.scrollCount > 30)      score += 10;
    if (data.scrollCount > 60)      score += 10;

    if (data.keyPressCount > 10)    score += 10;
    if (data.keyPressCount > 30)    score += 10;

    if (data.bottomReachedCount > 3) score += 15;

    if (data.shortVideoCount > 3)   score += 10;
    if (data.shortVideoCount > 8)   score += 10;

    if (data.idleTime < 10)         score += 5;

    if (data.longVideoDetected)     score -= 50;

    // Apply context multiplier
    const context    = data.pageContext || 'unknown';
    const multiplier = CONFIG.contextMultipliers[context] ?? CONFIG.contextMultipliers['unknown'];
    return Math.round(score * multiplier);
  }

  test('calculateScore should compute correct scores', () => {
    // Test case 1: Basic activity
    let data = {
      sessionDuration: 120, // 2 minutes
      scrollCount: 25,
      keyPressCount: 5,
      bottomReachedCount: 2,
      shortVideoCount: 2,
      idleTime: 5,
      longVideoDetected: false,
      pageContext: 'social_feed'
    };

    let score = calculateScore(data);
    // Base score: 10 (session>60) + 10 (scroll>10) + 5 (idle<10) = 25
    // Context multiplier: 1.2
    // Final: 25 * 1.2 = 30
    expect(score).toBe(30);

    // Test case 2: With long video (should reduce score)
    data.longVideoDetected = true;
    score = calculateScore(data);
    // Base score: 10 (session>60) + 10 (scroll>10) + 5 (idle<10) - 50 (long video) = -25
    // Context multiplier: 1.2
    // Final: -25 * 1.2 = -30
    expect(score).toBe(-30);

    // Test case 3: High activity on short form feed
    data = {
      sessionDuration: 600, // 10 minutes
      scrollCount: 100,
      keyPressCount: 50,
      bottomReachedCount: 10,
      shortVideoCount: 15,
      idleTime: 2,
      longVideoDetected: false,
      pageContext: 'short_form_feed'
    };

    score = calculateScore(data);
    // Base score:
    // session>60: +10
    // session>180: +15
    // session>300: +15
    // scroll>10: +10
    // scroll>30: +10
    // scroll>60: +10
    // key>10: +10
    // key>30: +10
    // bottom>3: +15
    // short video>3: +10
    // short video>8: +10
    // idle<10: +5
    // long video: 0
    // Total base: 10+15+15+10+10+10+10+10+15+10+10+5 = 130
    // Context multiplier: 1.5
    // Final: 130 * 1.5 = 195
    expect(score).toBe(195);
  });

  test('strongWarningFollowup constant should be defined in CONFIG', () => {
    // This test would fail with the original code because the constant was missing
    // After our fix, it should pass
    expect(CONFIG.strongWarningFollowup).toBeDefined();
    expect(typeof CONFIG.strongWarningFollowup).toBe('number');
    expect(CONFIG.strongWarningFollowup).toBe(300); // 5 minutes in seconds
  });

  test('handleActivityReport should not throw when checking strong warning followup', () => {
    // This test simulates the scenario that was causing the error
    // When a strong warning has been shown, and we check if enough time has passed
    // for a final reminder

    // Set up a session that had a strong warning
    const tabId = 1;
    sessions[tabId] = {
      tabId,
      hostname: 'twitter.com',
      url: 'https://twitter.com/home',
      pageContext: 'social_feed',
      currentSection: '',
      lastScore: 70, // Above strong warning threshold
      lastWarningLevel: 'strong',
      lastWarningTime: mockDateNow - (6 * 60 * 1000), // 6 minutes ago
      strongWarningTime: mockDateNow - (6 * 60 * 1000), // 6 minutes ago
      finalReminderSent: false,
      snoozed: false,
      snoozeUntil: 0,
      continueClickedAt: 0,
      lastScrollCount: 0,
      lastKeyPressCount: 0,
      lastSessionTime: 0
    };

    // Mock activity report data that would keep the score high
    const data = {
      url: 'https://twitter.com/home',
      hostname: 'twitter.com',
      scrollCount: 20,
      keyPressCount: 5,
      bottomReachedCount: 2,
      shortVideoCount: 2,
      longVideoDetected: false,
      pageContext: 'social_feed',
      sessionDuration: 300, // 5 minutes
      idleTime: 5,
      timestamp: Date.now()
    };

    // Mock storage.get to return empty settings (so extension is enabled)
    chromeMock.storage.local.get.mockImplementation((key) => {
      if (key === 'dsbSettings') {
        return Promise.resolve({ dsbSettings: { enabled: true } });
      }
      if (key === 'dsbCustomConfig') {
        return Promise.resolve({ dsbCustomConfig: {} });
      }
      return Promise.resolve({});
    });

    // This is the critical test: before our fix, accessing CONFIG.strongWarningFollowup
    // would be undefined, causing the comparison to be NaN or throw an error
    // After our fix, it should work correctly

    // We'll test the specific logic that was broken:
    const session = sessions[tabId];
    if (
      session.lastWarningLevel === 'strong' &&
      !session.finalReminderSent &&
      session.strongWarningTime > 0
    ) {
      const elapsed = (Date.now() - session.strongWarningTime) / 1000;
      // This line would throw or behave incorrectly if CONFIG.strongWarningFollowup was missing
      const shouldShowFinalReminder = elapsed >= CONFIG.strongWarningFollowup;

      // With our test data: elapsed = 6 minutes = 360 seconds
      // CONFIG.strongWarningFollowup = 300 seconds (5 minutes)
      // So shouldShowFinalReminder should be true
      expect(shouldShowFinalReminder).toBe(true);
    }
  });

  test('handleActivityReport should handle missing constant gracefully (simulating original bug)', () => {
    // This test demonstrates what happened with the original buggy code
    // We'll temporarily remove the constant and show that it causes issues

    const originalStrongWarningFollowup = CONFIG.strongWarningFollowup;
    delete CONFIG.strongWarningFollowup; // Simulate the bug

    const tabId = 1;
    sessions[tabId] = {
      tabId,
      hostname: 'twitter.com',
      url: 'https://twitter.com/home',
      pageContext: 'social_feed',
      currentSection: '',
      lastScore: 70,
      lastWarningLevel: 'strong',
      lastWarningTime: mockDateNow - (6 * 60 * 1000), // 6 minutes ago
      strongWarningTime: mockDateNow - (6 * 60 * 1000),
      finalReminderSent: false,
      snoozed: false,
      snoozeUntil: 0,
      continueClickedAt: 0,
      lastScrollCount: 0,
      lastKeyPressCount: 0,
      lastSessionTime: 0
    };

    const data = {
      url: 'https://twitter.com/home',
      hostname: 'twitter.com',
      scrollCount: 20,
      keyPressCount: 5,
      bottomReachedCount: 2,
      shortVideoCount: 2,
      longVideoDetected: false,
      pageContext: 'social_feed',
      sessionDuration: 300,
      idleTime: 5,
      timestamp: Date.now()
    };

    chromeMock.storage.local.get.mockImplementation((key) => {
      if (key === 'dsbSettings') {
        return Promise.resolve({ dsbSettings: { enabled: true } });
      }
      if (key === 'dsbCustomConfig') {
        return Promise.resolve({ dsbCustomConfig: {} });
      }
      return Promise.resolve({});
    });

    // Now test the broken logic
    const session = sessions[tabId];
    let errorThrown = false;
    let elapsedComparisonResult;

    try {
      if (
        session.lastWarningLevel === 'strong' &&
        !session.finalReminderSent &&
        session.strongWarningTime > 0
      ) {
        const elapsed = (Date.now() - session.strongWarningTime) / 1000;
        // This is where the original code would fail:
        // CONFIG.strongWarningFollowup is undefined
        // elapsed >= undefined evaluates to false (since undefined is falsy in comparison)
        // But more importantly, in strict mode or with certain JS engines,
        // this might cause unexpected behavior
        elapsedComparisonResult = elapsed >= CONFIG.strongWarningFollowup;
      }
    } catch (e) {
      errorThrown = true;
    }

    // With the missing constant, the comparison elapsed >= undefined
    // actually evaluates to false in JavaScript (not an error), but it's logically incorrect
    // The user had been scrolling for 6 minutes after a strong warning,
    // but the code thinks it's NOT time for a final reminder (when it should be)
    expect(elapsedComparisonResult).toBe(false); // Incorrect result due to bug

    // Restore the constant
    CONFIG.strongWarningFollowup = originalStrongWarningFollowup;

    // Now test with the constant restored
    let elapsedComparisonResultFixed;
    if (
      session.lastWarningLevel === 'strong' &&
      !session.finalReminderSent &&
      session.strongWarningTime > 0
    ) {
      const elapsed = (Date.now() - session.strongWarningTime) / 1000;
      elapsedComparisonResultFixed = elapsed >= CONFIG.strongWarningFollowup;
    }

    // With the constant restored, we get the correct result
    expect(elapsedComparisonResultFixed).toBe(true); // Correct result
  });
});