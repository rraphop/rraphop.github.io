'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '..', 'qna-config.js'), 'utf8');
function harness(storage = new Map()) {
  const timers = new Set(), messages = [], scripts = [], frames = [], listeners = new Map();
  let now = Date.now();
  let onScript = (script) => reply(script, { ok: true, questions: [] });
  let onWrite = (request) => respond(request, { ok: true });
  const window = {
    crypto: webcrypto,
    setTimeout(fn, delay) { const timer = setTimeout(() => { timers.delete(timer); fn(); }, delay); timers.add(timer); return timer; },
    clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
    sessionStorage: { get length() { return storage.size; }, key: (i) => [...storage.keys()][i], getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((item) => item !== fn)); }
  };
  function emit(type, data) { for (const fn of [...(listeners.get(type) || [])]) fn(data); }
  const bridge = { postMessage(request) { messages.push(request); queueMicrotask(() => onWrite(request)); } };
  function respond(request, payload) { emit('message', { origin: 'https://script.google.com', source: bridge, data: { type: 'social-history-data-bridge-response', channel: request.channel, id: request.id, payload } }); }
  const document = {
    createElement(tag) { return { tag, style: {}, setAttribute() {}, remove() { this.removed = true; } }; },
    head: { appendChild(script) { scripts.push(script); queueMicrotask(() => onScript(script)); } },
    body: { appendChild(frame) { frames.push(frame); queueMicrotask(() => emit('message', { origin: 'https://script.google.com', source: bridge, data: { type: 'social-history-data-bridge-ready', channel: new URL(frame.src).searchParams.get('channel') } })); } },
    addEventListener: (type, fn) => window.addEventListener(type, fn)
  };
  function reply(script, payload) { window[new URL(script.src).searchParams.get('callback')](payload); }
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(source, { window, document, URL, Date: Clock, console });
  Object.assign(window.QNA_CONFIG, { timeoutMs: 15, writeTimeoutMs: 15, retryDelayMs: 1 });
  return { api: window.DATA_API, scripts, messages, storage, frames, reply, respond, emit, advance: (ms) => { now += ms; }, setScript: (fn) => { onScript = fn; }, setWrite: (fn) => { onWrite = fn; }, close: () => timers.forEach(clearTimeout) };
}
(async () => {
  const h = harness();
  try {
    const p1 = h.api.request('list'), p2 = h.api.request('list');
    assert.equal(p1, p2, 'Simultaneous identical reads share one request');
    await p1;
    assert.equal(h.scripts.length, 1);
    await h.api.request('list');
    assert.equal(h.scripts.length, 1, 'Fresh cache avoids network');
    h.advance(11000);
    await h.api.request('list');
    assert.equal(h.scripts.length, 2, 'Expired cache is refreshed');
    const reopened = harness(h.storage);
    try { await reopened.api.request('list'); assert.equal(reopened.scripts.length, 0, 'Same-tab navigation uses short-lived cache'); }
    finally { reopened.close(); }
    // Prepare the write connection while the user is filling the form.
    h.emit('focusin', { target: { closest: () => true } });
    await Promise.resolve();
    await h.api.request('create', { text: 'new', password: 'PRIVATE_PASSWORD' });
    assert.equal(h.frames.length, 1);
    await h.api.request('list');
    assert.equal(h.scripts.length, 3, 'Successful mutation invalidates lists');
    assert.ok(![...h.storage.values()].join('').includes('PRIVATE_PASSWORD'));
  } finally { h.close(); }
  const retry = harness();
  try {
    retry.setScript((script) => {
      if (retry.scripts.length === 1) script.onerror();
      else retry.reply(script, { ok: true, programs: [] });
    });
    await retry.api.request('programList');
    assert.equal(retry.scripts.length, 2, 'Transient read error gets one retry');
  } finally { retry.close(); }
  const late = harness();
  try {
    late.setScript((script) => { if (late.scripts.length > 1) late.reply(script, { ok: true, programs: [] }); });
    await late.api.request('programList');
    assert.equal(late.scripts.length, 2);
    assert.doesNotThrow(() => late.reply(late.scripts[0], { ok: true, programs: ['late'] }), 'Timed-out callbacks cannot crash the page');
    assert.equal((await late.api.request('programList')).programs.length, 0, 'Late response cannot overwrite newer data');
  } finally { late.close(); }
  const failure = harness();
  try {
    failure.setScript((script) => failure.reply(script, { ok: false, message: '알 수 없는 요청입니다.' }));
    await assert.rejects(failure.api.request('programList'));
    assert.equal(failure.scripts.length, 1, 'Application errors are not retried');
    failure.setScript(() => {});
    await assert.rejects(failure.api.request('visit'));
    assert.equal(failure.scripts.length, 2, 'Visit mutations must not be retried');
    failure.setWrite(() => {});
    await assert.rejects(failure.api.request('programSave', { adminPassword: 'secret' }), /반영 여부/);
    assert.equal(failure.messages.length, 1, 'A timed-out save is never automatically duplicated');
  } finally { failure.close(); }
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
  const counterSource = mainSource.slice(mainSource.indexOf('async function updateVisitorCounter()'), mainSource.indexOf('\nupdateVisitorCounter();'));
  for (const scenario of ['new', 'already-counted', 'visit-failed', 'all-failed']) {
    const actions = [], rendered = [], marked = [];
    let errors = 0;
    const context = vm.createContext({
      visitorCounter: {}, getVisitorDateKey: () => '2026-10-06',
      hasCountedVisitorToday: () => scenario === 'already-counted',
      visitorApiRequest: async (action) => {
        actions.push(action);
        if (scenario === 'all-failed' || (scenario === 'visit-failed' && action === 'visit')) throw new Error('offline');
        return { today: 3, total: 100, date: '2026-10-06' };
      },
      markVisitorCounted: (value) => marked.push(value), renderVisitorCounter: (...value) => rendered.push(value),
      renderVisitorCounterError: () => errors++, console: { warn() {} }
    });
    vm.runInContext(counterSource, context);
    await vm.runInContext('updateVisitorCounter()', context);
    assert.deepEqual(actions, scenario === 'new' ? ['visit'] : scenario === 'already-counted' ? ['count'] : ['visit', 'count']);
    assert.equal(marked.length, scenario === 'new' ? 1 : 0);
    assert.equal(errors, scenario === 'all-failed' ? 1 : 0);
    if (scenario !== 'all-failed') assert.deepEqual(rendered, [[3, 100]]);
  }
  console.log('Data API tests passed: deduplication, cache expiry/invalidation, read retry, late responses, write prewarming, no mutation retries.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
