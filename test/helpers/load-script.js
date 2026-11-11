/**
 * load-script.js — test harness for loading the extension's classic (non-module) scripts.
 *
 * The service worker and the shared constants are plain scripts that declare top-level
 * `const`/`let` bindings. `vm.runInContext` evaluates them in their own lexical scope, so
 * the bindings are not reachable as properties of the sandbox object. To reach them we
 * append a small export statement to the source before running it.
 *
 * Mutable state (CONFIG, sessions, breakBlocks) is exposed through getter functions so
 * the test observes live values rather than a snapshot taken at load time.
 *
 * The chrome mock deliberately uses plain functions rather than `jest.fn()`: the project
 * sets `resetMocks: true` in jest.config.js, which strips mock implementations between
 * tests. Calls are recorded in plain arrays instead, so they survive the reset.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

/**
 * Build a minimal but complete `chrome` API mock.
 *
 * @param {object} [overrides] Shallow-merged into the returned `chrome` object
 * @returns {{chrome: object, store: object, calls: object, listeners: object}}
 */
function createChromeMock(overrides = {}) {
  const store = {};
  const calls = {
    storageGet: [],
    storageSet: [],
    storageRemove: [],
    tabsSendMessage: [],
    tabsQuery: [],
    alarmsCreate: []
  };
  const listeners = {
    onMessage: [],
    onRemoved: [],
    onAlarm: []
  };
  const consoleErrors = [];

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          calls.storageGet.push(keys);
          if (keys === undefined || keys === null) return { ...store };
          if (typeof keys === 'string') {
            return Object.prototype.hasOwnProperty.call(store, keys) ? { [keys]: store[keys] } : {};
          }
          if (Array.isArray(keys)) {
            const out = {};
            for (const key of keys) {
              if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = store[key];
            }
            return out;
          }
          if (typeof keys === 'object') {
            const out = {};
            for (const [key, fallback] of Object.entries(keys)) {
              out[key] = Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback;
            }
            return out;
          }
          return {};
        },
        async set(items) {
          calls.storageSet.push(items);
          Object.assign(store, items);
        },
        async remove(key) {
          calls.storageRemove.push(key);
          for (const k of Array.isArray(key) ? key : [key]) delete store[k];
        }
      }
    },
    runtime: {
      onMessage: {
        addListener(fn) {
          listeners.onMessage.push(fn);
        }
      },
      sendMessage() {}
    },
    tabs: {
      onRemoved: {
        addListener(fn) {
          listeners.onRemoved.push(fn);
        }
      },
      async query(queryInfo) {
        calls.tabsQuery.push(queryInfo);
        return [];
      },
      async sendMessage(tabId, message) {
        calls.tabsSendMessage.push({ tabId, message });
      }
    },
    alarms: {
      create(name, info) {
        calls.alarmsCreate.push({ name, info });
      },
      onAlarm: {
        addListener(fn) {
          listeners.onAlarm.push(fn);
        }
      }
    }
  };

  return { chrome: { ...chrome, ...overrides }, store, calls, listeners, consoleErrors };
}

/**
 * Load a classic script from the repository into a fresh VM context.
 *
 * @param {string} relativePath Path relative to the repository root
 * @param {object} [options]
 * @param {string} [options.exportBody] JavaScript object-literal body placed inside the
 *   generated `globalThis.__exports = { ... }` statement
 * @param {object} [options.globals] Extra globals made available to the script
 * @param {object} [options.chrome] Overrides merged into the mocked `chrome` API
 * @returns {{exports: object, chrome: object, store: object, calls: object,
 *            listeners: object, context: object}}
 */
function loadScript(relativePath, options = {}) {
  const { exportBody = '', globals = {}, chrome: chromeOverrides = {} } = options;

  const filePath = path.join(ROOT, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const { chrome, store, calls, listeners, consoleErrors } = createChromeMock(chromeOverrides);

  const sandbox = {
    structuredClone,
    chrome,
    console: {
      log() {},
      info() {},
      warn() {},
      error(...args) {
        consoleErrors.push(args);
      }
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    ...globals
  };

  const context = vm.createContext(sandbox);

  const exportStatement = `\n;globalThis.__exports = { ${exportBody} };\n`;

  vm.runInContext(source + exportStatement, context, { filename: filePath });

  return { exports: context.__exports || {}, chrome, store, calls, listeners, consoleErrors, context };
}

/**
 * Let pending promise callbacks inside the loaded script settle.
 *
 * The service worker loads its configuration through an async IIFE, so CONFIG is only
 * populated after the storage promise resolves.
 */
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

module.exports = { loadScript, createChromeMock, settle, ROOT };
