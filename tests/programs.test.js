'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');

function createHarness() {
  const sheets = new Map();
  const cache = new Map();
  const metrics = { reads: 0, fullReads: 0, writes: 0, writtenCells: 0, opens: 0, flushes: 0 };
  const properties = new Map([['QNA_ADMIN_PASSWORD', 'admin-test'], ['QNA_PASSWORD_SALT', 'test-salt']]);
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; }
    getName() { return this.name; }
    getLastRow() { return this.rows.length; }
    getLastColumn() { return Math.max(0, ...this.rows.map((row) => row.length)); }
    appendRow(row) { this.rows.push([...row]); }
    deleteRow(index) { this.rows.splice(index - 1, 1); }
    getDataRange() { return { getValues: () => { metrics.reads++; metrics.fullReads++; return this.rows.map((row) => [...row]); } }; }
    getRange(row, col, height = 1, width = 1) {
      return {
        setNumberFormat() { return this; },
        setNumberFormats() { return this; },
        getValue() { return this.getValues()[0][0]; },
        getValues: () => { metrics.reads++; return Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => this.rows[row - 1 + r]?.[col - 1 + c] ?? '')); },
        setValues: (values) => { metrics.writes++; metrics.writtenCells += values.reduce((sum, row) => sum + row.length, 0); values.forEach((cells, r) => cells.forEach((value, c) => {
          this.rows[row - 1 + r] ||= [];
          assert.ok(typeof value !== 'string' || !value.startsWith('='), 'Unescaped spreadsheet formula');
          this.rows[row - 1 + r][col - 1 + c] = typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value;
        })); },
        setValue(value) { this.setValues([[value]]); }
      };
    }
  }
  const book = { getSheetByName: (name) => sheets.get(name), insertSheet: (name) => { const sheet = new Sheet(name); sheets.set(name, sheet); return sheet; } };
  const context = vm.createContext({
    console, Date,
    SpreadsheetApp: { getActiveSpreadsheet: () => { metrics.opens++; return book; }, flush() { metrics.flushes++; } },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: (key) => cache.get(key), put: (key, value) => cache.set(key, value) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties.get(key) || null, setProperty: (key, value) => properties.set(key, value), deleteProperty: (key) => properties.delete(key) }) },
    Utilities: { getUuid: crypto.randomUUID, formatDate: (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date), parseDate: (date) => new Date(date + 'T00:00:00+09:00'), DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (algorithm, text) => [...crypto.createHash(algorithm).update(text).digest()] },
    ContentService: { MimeType: { JSON: 'json', JAVASCRIPT: 'js' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8'), context);
  const call = (action, params = {}, publicRequest = false) => {
    context.input = { action, params };
    return JSON.parse(vm.runInContext(publicRequest ? 'handleRequest_({parameter: Object.assign({}, input.params, {action: input.action})}).text' : 'JSON.stringify(handleBridgeRequest(input))', context));
  };
  return { call, sheets, cache, book, metrics, properties, evaluate: (source) => vm.runInContext(source, context) };
}
const example = {
  title: '학생 관리 도우미', category: '업무', version: '1.0.0', windows: 'Windows 10 / 11', summary: '학급 업무를 한곳에서 관리합니다.',
  body: '## 프로그램 소개\n학생 목록과 상담 기록을 정리합니다.\n![프로그램 화면](https://example.com/screen.png)',
  downloadUrl: 'https://github.com/example/tools/releases/download/v1.0/tool.zip', adminPassword: 'admin-test'
};

function run() {
  const { call, sheets } = createHarness();
  assert.equal(call('programList', {}, true).programs.length, 0);
  for (const action of ['programSave', 'programDelete', 'programCommentSave', 'programCommentDelete']) {
    assert.equal(call(action, example, true).ok, false, 'Mutations may not use the public endpoint');
  }
  assert.equal(call('programSave', { ...example, adminPassword: 'wrong' }).ok, false);
  for (const downloadUrl of ['javascript:alert(1)', 'https://github.com.evil.com/a', 'https://github.com@evil.com/a', 'https://evil.com/a', 'https://github.com/\\evil.com']) {
    assert.equal(call('programSave', { ...example, downloadUrl }).ok, false, downloadUrl);
  }
  const saved = call('programSave', example);
  assert.equal(saved.ok, true);
  const id = saved.program.id;
  assert.equal(saved.program.viewCount, 0);
  assert.equal(saved.program.downloadCount, 0);
  const view = { id, metric: 'view', eventId: crypto.randomUUID(), viewCount: 9999 };
  assert.deepEqual(call('programTrack', view, true).stats, { viewCount: 1, downloadCount: 0 });
  assert.deepEqual(call('programTrack', view, true).stats, { viewCount: 1, downloadCount: 0 }, 'Repeated event is not counted twice');
  assert.deepEqual(call('programTrack', { id, metric: 'download', eventId: crypto.randomUUID() }, true).stats, { viewCount: 1, downloadCount: 1 });
  assert.deepEqual(call('programTrack', { ...view, eventId: crypto.randomUUID() }, true).stats, { viewCount: 2, downloadCount: 1 });
  assert.equal(call('programDetail', { id }, true).program.updatedAt, saved.program.updatedAt, 'Counters do not change the release date');
  assert.equal(call('programTrack', { ...view, id: 'missing' }, true).ok, false);
  assert.equal(call('programTrack', { ...view, metric: 'anything' }, true).ok, false);
  assert.equal(call('programTrack', { ...view, eventId: '' }, true).ok, false);
  const edited = call('programSave', { ...example, id, viewCount: 0, downloadCount: 0 });
  assert.equal(edited.program.viewCount, 2, 'Editing a program preserves counts');
  assert.equal(edited.program.downloadCount, 1);
  assert.equal(call('programSave', { ...example, id: 'missing' }).ok, false);
  assert.equal(call('programSave', { ...example, id, summary: '업데이트', title: '=IMPORTXML("x")' }).ok, true);
  const listed = call('programList', {}, true).programs;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, '=IMPORTXML("x")');
  assert.equal(listed[0].summary, '업데이트');
  assert.equal(listed[0].viewCount, 2);
  assert.equal(listed[0].downloadCount, 1);
  assert.equal('body' in listed[0], false);
  const params = { programId: id, name: '방문자', text: '=댓글은 수식이 아닙니다', password: 'comment-secret', admin: true };
  const comment = call('programCommentSave', params).comment;
  assert.equal(comment.admin, false, 'Visitor cannot spoof admin badge');
  assert.equal('passwordHash' in comment, false);
  const detail = call('programDetail', { id }, true);
  assert.equal(detail.program.body, example.body);
  assert.equal(detail.comments.length, 1);
  assert.equal(JSON.stringify(detail).includes('comment-secret'), false);
  assert.equal(JSON.stringify(detail).includes('passwordHash'), false);
  assert.equal(call('programCommentSave', { ...params, id: comment.id, password: 'wrong' }).ok, false);
  assert.equal(call('programCommentSave', { ...params, id: comment.id, text: '수정한 댓글' }).ok, true);
  assert.equal(call('programCommentDelete', { id: comment.id, password: 'wrong' }).ok, false);
  assert.equal(call('programCommentDelete', { id: comment.id, password: params.password }).ok, true);
  assert.equal(call('programCommentSave', { ...params, programId: 'missing' }).ok, false);
  const adminComment = call('programCommentSave', { programId: id, text: '감사합니다.', adminPassword: 'admin-test' }).comment;
  assert.equal(adminComment.admin, true);
  assert.equal(adminComment.name, '관리자');
  assert.equal(call('programCommentSave', { programId: id, id: adminComment.id, text: '위조', password: 'x' }).ok, false);
  assert.equal(call('programDelete', { id, adminPassword: 'wrong' }).ok, false);
  assert.equal(call('programDelete', { id, adminPassword: 'admin-test' }).ok, true);
  assert.equal(call('programDetail', { id }, true).ok, false);
  assert.equal(call('programCommentDelete', { id: adminComment.id, adminPassword: 'admin-test' }).ok, false, 'Deleting a program removes its comments');
  // Simulate an existing sheet without the new column; old programs must survive migration.
  const sheet = sheets.get('프로그램 자료실');
  sheet.rows[0].splice(-3);
  const oldHeaders = [...sheet.rows[0]];
  sheet.appendRow(oldHeaders.map((key) => ({ ...example, id: 'legacy-program', createdAt: '2026-01-01', updatedAt: '2026-01-01' }[key] || '')));
  const migrated = call('programDetail', { id: 'legacy-program' }, true).program;
  assert.equal(migrated.title, example.title);
  assert.equal(migrated.viewCount, 0);
  assert.equal(migrated.downloadCount, 0);
  assert.equal(call('programTrack', { id: 'legacy-program', metric: 'view', eventId: crypto.randomUUID() }, true).stats.viewCount, 1);
  const legacy = call('programSave', example);
  assert.equal(legacy.ok, true);
  assert.equal(legacy.program.downloadName, '');
  assert.equal(legacy.program.viewCount, 0, 'Programs have independent counters');
  assert.ok(sheet.rows[0].includes('downloadName'));
  const localProgram = { ...example, downloadUrl: '/downloads/teacher-note-v1.0.zip', downloadName: '교무수첩.zip' };
  const local = call('programSave', localProgram);
  assert.equal(local.ok, true);
  assert.equal(call('programDetail', { id: local.program.id }, true).program.downloadName, '교무수첩.zip');
  const absolute = call('programSave', { ...localProgram, downloadUrl: 'https://rraphop.github.io/downloads/teacher-note-v1.0.zip' });
  assert.equal(absolute.program.downloadUrl, localProgram.downloadUrl);
  assert.equal(call('programSave', { ...example, downloadName: '교무수첩.zip' }).ok, false, 'Cross-origin filename claims are rejected');
  for (const downloadUrl of ['//evil.com/downloads/app.zip', '/downloads/../app.zip', '/downloads/%2e%2e/app.zip', '/downloads/app.html', 'https://evil.com/downloads/app.zip', '/downloads/app.zip?x=1', '/downloads/app.zip#x']) {
    assert.equal(call('programSave', { ...localProgram, downloadUrl }).ok, false, downloadUrl);
  }
  for (const downloadName of ['교무수첩.exe', '../교무수첩.zip', 'CON.zip', '교무:수첩.zip', '교무수첩.zip\u0000']) {
    assert.equal(call('programSave', { ...localProgram, downloadName }).ok, false, downloadName);
  }
  const rendering = { window: {}, document: { getElementById() { return null; } }, location: { origin: 'https://rraphop.github.io' }, URL };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'programs.js'), 'utf8'), rendering);
  const { bodyHtml, httpsUrl, downloadInfo, downloadNameError } = rendering.window.PROGRAM_RENDER;
  assert.ok(!bodyHtml('<script>alert(1)</script>').includes('<script>'));
  assert.ok(!bodyHtml('![x](javascript:alert(1))').includes('<img'));
  assert.ok(!bodyHtml('![x](https://user:password@example.com/image.png)').includes('<img'));
  assert.ok(bodyHtml('![설명](https://example.com/image.png)').includes('<img'));
  assert.equal(httpsUrl('https://github.com.evil.com/file', true), '');
  assert.equal(downloadInfo(localProgram.downloadUrl).local, true);
  assert.equal(downloadInfo('https://rraphop.github.io/downloads/teacher-note-v1.0.zip').url, localProgram.downloadUrl);
  assert.equal(downloadInfo('//evil.com/downloads/file.zip').url, '');
  assert.equal(downloadInfo('/downloads/../file.zip').url, '');
  assert.equal(downloadNameError('교무수첩.zip', downloadInfo(localProgram.downloadUrl)), '');
  assert.ok(downloadNameError('교무수첩.exe', downloadInfo(localProgram.downloadUrl)));
  assert.ok(downloadNameError('교무수첩.zip', downloadInfo(example.downloadUrl)));
  // Old rows remain readable; all new writes use the new category names.
  for (const [oldCategory, category] of [['교무업무', '업무'], ['학생관리', '업무'], ['주식', '기타'], ['수업', '수업'], ['업무', '업무'], ['기타', '기타']]) {
    const categoryHarness = createHarness();
    const created = categoryHarness.call('programSave', { ...example, category: oldCategory });
    assert.equal(created.program.category, category);
    const categorySheet = categoryHarness.sheets.get('프로그램 자료실');
    const categoryIndex = categorySheet.rows[0].indexOf('category');
    assert.equal(categorySheet.rows[1][categoryIndex], category);
    categorySheet.rows[1][categoryIndex] = oldCategory;
    assert.equal(categoryHarness.call('programList', {}, true).programs[0].category, category);
    assert.equal(categoryHarness.call('programDetail', { id: created.program.id }, true).program.category, category);
    assert.equal(rendering.window.PROGRAM_RENDER.programCategory(oldCategory), category);
  }
  assert.equal(call('programSave', { ...example, category: '없는 분류' }).ok, false);
  console.log('Program board tests passed.');
}
if (require.main === module) run();
module.exports = { createHarness, example };
