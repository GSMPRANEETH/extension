# Build Process

This extension uses a simple build process to solve the constant duplication issue between `utils/constants.js` and `background/background.js`.

## Problem
In Manifest V3 Chrome Extensions, service workers (like `background.js`) cannot import external JavaScript files the same way content scripts can. This required duplicating constants in both files, creating a maintenance burden.

## Solution
1. **Single Source of Truth**: `utils/constants.js` contains all constants
2. **Build Process**: A Node.js script reads `utils/constants.js` and generates `background/background.js` with the constants inlined
3. **Template Approach**: `background/background.template.js` contains the background service worker code with a placeholder where constants should be inlined

## Files
- `utils/constants.js` - Single source of truth for all constants
- `background/background.template.js` - Template for background.js with `/* CONSTANTS_PLACEHOLDER */`
- `background/background.js` - Generated file (do not edit directly)
- `build/build.js` - Script that generates background.js
- `package.json` - Defines build scripts

## Commands
```bash
# Generate background.js with constants inlined
npm run build

# Watch for changes and rebuild automatically (development)
npm run watch
```

## How It Works
1. The build script reads the constants from `utils/constants.js`
2. It reads the template from `background/background.template.js`
3. It replaces `/* CONSTANTS_PLACEHOLDER */` with the constants content
4. It writes the result to `background/background.js`

## Important Notes
- Never edit `background/background.js` directly - your changes will be overwritten
- Edit `utils/constants.js` to change constants
- Edit `background/background.template.js` to change the background service worker logic
- Always run `npm run build` after making changes to see them in effect