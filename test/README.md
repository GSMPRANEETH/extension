# Doom Scroll Blocker Extension Tests

This directory contains unit tests for the Doom Scroll Blocker Chrome extension.

## Running Tests

To run the tests, you'll need to have Node.js installed (version 14 or higher recommended).

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the tests:
   ```bash
   npm test
   ```

## Test Files

- `constants.test.js` - Tests for the constants.js file
- `background.test.js` - Tests for the background.js logic

## What These Tests Cover

The tests focus on:
1. Verifying that all required constants are defined and have appropriate values
2. Testing the scoring algorithm calculations
3. Testing the warning logic, specifically the fix for the missing `STRONG_WARNING_FOLLOWUP` constant that was causing the extension to freeze

## Important Note About Testing Browser Extensions

Since this is a Chrome extension that relies on Chrome APIs (chrome.storage, chrome.tabs, etc.), the tests mock these APIs using Jest's mocking functionality. The tests focus on the business logic that can be tested without requiring a browser environment.

The most critical test verifies that the `strongWarningFollowup` constant is properly defined, which was the root cause of the freezing issue reported in Opera.