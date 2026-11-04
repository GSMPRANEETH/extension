const fs = require('fs');
const vm = require('vm');
const path = require('path');

function load(file, store = {}, elements = {}) {
  const listeners = {};
  const chrome = {
    storage: { local: {
      get: jest.fn(async key => key === null ? structuredClone(store) : { [key]: structuredClone(store[key]) }),
      set: jest.fn(async patch => Object.assign(store, structuredClone(patch))),
      remove: jest.fn(async keys => keys.forEach(key => delete store[key])),
    } },
    runtime: { sendMessage: jest.fn(), onMessage: { addListener: fn => { listeners.message = fn; } } },
    tabs: { onRemoved: { addListener() {} }, sendMessage: jest.fn() },
    alarms: { create() {}, onAlarm: { addListener() {} } },
  };
  const context = vm.createContext({ chrome, console, Date, Math, structuredClone,
    document: { addEventListener() {}, getElementById: id => elements[id] },
    window: { addEventListener() {} }, confirm: () => true, setTimeout: () => 0,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return { context, chrome, listeners, run: code => vm.runInContext(code, context) };
}

test('legacy lifetime stats survive an upgrade and get period buckets', async () => {
  const store = { dsbStats: { totalScrollCount: 10, totalKeyPresses: 2, totalSessionTime: 100,
    totalWarningsTriggered: 1, doomScrollSessions: 1, siteBreakdown: {} } };
  const { run } = load('background/background.js', store);
  await run("updateAggregateStats({scrollCount:3,keyPressCount:1,sessionDuration:15}, {}, false, 'example.com')");
  expect(store.dsbStats.totalScrollCount).toBe(13);
  expect(Object.keys(store.dsbStats.dailyStats)).toHaveLength(1);
  expect(Object.keys(store.dsbStats.weeklyStats)[0]).toMatch(/^\d{4}-W\d{2}$/);
  expect(Object.keys(store.dsbStats.monthlyStats)).toHaveLength(1);
});

test('ISO weeks group dates together and handle the year boundary', () => {
  const { run } = load('background/background.js');
  expect(run("getWeekKey(Date.parse('2026-11-02T12:00Z'))")).toBe(run("getWeekKey(Date.parse('2026-11-03T12:00Z'))"));
  expect(run("getWeekKey(Date.parse('2021-01-01T12:00Z'))")).toBe('2020-W53');
  expect(run("getWeekKey(Date.parse('2021-01-04T12:00Z'))")).toBe('2021-W01');
});

test('popup config and session messages work without sender.tab', async () => {
  const { listeners, run } = load('background/background.js');
  const reply = jest.fn();
  expect(listeners.message({type:'CONFIG_UPDATED'}, {}, reply)).toBe(true);
  await new Promise(resolve => setImmediate(resolve));
  expect(reply).toHaveBeenCalledWith(expect.objectContaining({ok:true}));
  run('sessions[5] = {hostname:"example.com"}');
  listeners.message({type:'GET_SESSION',tabId:5}, {}, reply);
  expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({session:expect.objectContaining({hostname:'example.com'})}));
});

test('nested defaults and repeated slider edits retain sibling values', async () => {
  const store = { dsbCustomConfig: { contextMultipliers: {search:0.7} } };
  const background = load('background/background.js', store);
  await background.run('loadConfig()');
  expect(background.run('CONFIG.contextMultipliers.social_feed')).toBe(1.2);
  const popup = load('popup/popup.js', store);
  await Promise.all([popup.run('saveCustomSettings({contextMultipliers:{search:0.8}})'), popup.run('saveCustomSettings({contextMultipliers:{social_feed:1.8}})')]);
  expect(store.dsbCustomConfig.contextMultipliers).toEqual({search:0.8,social_feed:1.8});
});

test('import validates before any write and rejects malformed or injected values', async () => {
  const file = { text: async () => JSON.stringify({version:'1.0',settings:{dsbSettings:{enabled:false},dsbCustomConfig:{contextMultipliers:null}}}) };
  const store = { dsbSettings:{enabled:true} };
  const { run, chrome } = load('popup/popup.js', store, {'dsb-import-input':{files:[file]},'dsb-import-status':{}});
  await run('importSettings()');
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
  expect(store.dsbSettings.enabled).toBe(true);
  for (const settings of [ {dsbCustomConfig:{contextMultipliers:{search:'bad'}}}, {dsbSettings:{whitelist:['<img src=x onerror=alert(1)>']}}, {dsbHasSeenOnboarding:'yes'}, {dsbCustomConfig:{breakDuration:0}} ]) {
    expect(() => run(`validateImportedSettings(${JSON.stringify({version:'1.0',settings})})`)).toThrow();
  }
  expect(() => run('validateImportedSettings({version:"1.0", settings:{dsbSettings:{enabled:true,whitelist:["example.com"]}}})')).not.toThrow();
});

test('settings reset preserves historical stats and sessions', async () => {
  const store = {dsbSettings:{enabled:false},dsbStats:{totalScrollCount:42},dsbSessions:{1:{hostname:'example.com'}}};
  const { run } = load('popup/popup.js',store,{'dsb-import-status':{}});
  await run('resetAllSettings()');
  expect(store.dsbStats.totalScrollCount).toBe(42);
  expect(store.dsbSessions[1].hostname).toBe('example.com');
  expect(store.dsbSettings).toBeUndefined();
});

test('weekly selector reads weekly buckets and unsupported estimates are not fabricated', () => {
  const labels=[];const ctx={clearRect(){},fillText:text=>labels.push(text),beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){},save(){},restore(){},translate(){},rotate(){}};
  const {run,context}=load('popup/popup.js');context.canvas={width:300,height:200,getContext:()=>ctx};
  run('activePeriod="weekly";renderTrendsChart({weeklyStats:{"2026-W44":{sessionTime:12}}},canvas)');
  expect(labels).toContain('W44');
  expect(run('calculateTimeSaved({})')).toBeNull();
  expect(run('calculateFocusSessions({totalSessionTime:100000})')).toBe('—');
});
