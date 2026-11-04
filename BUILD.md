# Build

`npm run build` copies the canonical `background/background.template.js` to the shipped `background/background.js`. Edit the template and run this command before loading the unpacked extension. Content-script constants remain in `utils/constants.js`; the service worker uses its own default configuration because it does not import those scripts.
