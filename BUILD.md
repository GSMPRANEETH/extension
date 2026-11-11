# Build

`npm run build` (`scripts/build.js`) generates the shipped `background/background.js` from `background/background.template.js` by inlining the shared sources listed in `INLINED_SOURCES`:

- `utils/constants.js` at `/* CONSTANTS_PLACEHOLDER */`
- `utils/dates.js` at `/* DATES_PLACEHOLDER */`

Most worker defaults in `DEFAULT_CONFIG` come directly from those shared constants (which the popup and content scripts also load), so update `utils/constants.js` or `utils/dates.js` for shared thresholds, timers, site lists, or date helpers rather than assuming `background/background.template.js` maintains independent defaults. Edit `background/background.template.js` for service-worker logic and run `npm run build` before loading the unpacked extension.
