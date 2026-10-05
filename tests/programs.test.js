'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');

function createHarness() {
  const sheets = new Map();
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; }
    getName() { return this.name; }
    getLastRow() { return this.rows.length; }
    getLastColumn() { return Math.max(0, ...this.rows.map((row) => row.length)); }
    appendRow(row) { this.rows.push([...row]); }
    deleteRow(index) { this.rows.splice(index - 1, 1); }
    getDataRange() { return { getValues: () => this.rows.map((row) => [...row]) }; }
    getRange(row, col, height = 1, width = 1) {
      return {
        setNumberFormat() { return this; },
        getValues: () => Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => this.rows[row - 1 + r]?.[col - 1 + c] ?? '')),
        setValues: (values) => values.forEach((cells, r) => cells.forEach((value, c) => {
          this.rows[row - 1 + r] ||= [];
          assert.ok(typeof value !== 'string' || !value.startsWith('='), 'Unescaped spreadsheet formula');
          this.rows[row - 1 + r][col - 1 + c] = typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value;
        })),
        setValue(value) { this.setValues([[value]]); }
      };
    }
  }
  const book = { getSheetByName: (name) => sheets.get(name), insertSheet: (name) => { const sheet = new Sheet(name); sheets.set(name, sheet); return sheet; } };
  const context = vm.createContext({
    console, Date,
    SpreadsheetApp: { getActiveSpreadsheet: () => book },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => ({ QNA_ADMIN_PASSWORD: 'admin-test', QNA_PASSWORD_SALT: 'test-salt' }[key] || null) }) },
    Utilities: { getUuid: crypto.randomUUID, DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (algorithm, text) => [...crypto.createHash(algorithm).update(text).digest()] },
    ContentService: { MimeType: { JSON: 'json', JAVASCRIPT: 'js' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8'), context);
  const call = (action, params = {}, publicRequest = false) => {
    context.input = { action, params };
    return JSON.parse(vm.runInContext(publicRequest ? 'handleRequest_({parameter: Object.assign({}, input.params, {action: input.action})}).text' : 'JSON.stringify(handleBridgeRequest(input))', context));
  };
  return { call, sheets };
}
const example = {
  title: '학생 관리 도우미', category: '학생관리', version: '1.0.0', windows: 'Windows 10 / 11', summary: '학급 업무를 한곳에서 관리합니다.',
  body: '## 프로그램 소개\n학생 목록과 상담 기록을 정리합니다.\n![프로그램 화면](https://example.com/screen.png)',
  downloadUrl: 'https://github.com/example/tools/releases/download/v1.0/tool.zip', adminPassword: 'admin-test'
};

function run() {
  const { call } = createHarness();
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
  assert.equal(call('programSave', { ...example, id: 'missing' }).ok, false);
  assert.equal(call('programSave', { ...example, id, summary: '업데이트', title: '=IMPORTXML("x")' }).ok, true);
  const listed = call('programList', {}, true).programs;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, '=IMPORTXML("x")');
  assert.equal(listed[0].summary, '업데이트');
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
  const rendering = { window: {}, document: { getElementById() { return null; } }, URL };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'programs.js'), 'utf8'), rendering);
  const { bodyHtml, httpsUrl } = rendering.window.PROGRAM_RENDER;
  assert.ok(!bodyHtml('<script>alert(1)</script>').includes('<script>'));
  assert.ok(!bodyHtml('![x](javascript:alert(1))').includes('<img'));
  assert.ok(!bodyHtml('![x](https://user:password@example.com/image.png)').includes('<img'));
  assert.ok(bodyHtml('![설명](https://example.com/image.png)').includes('<img'));
  assert.equal(httpsUrl('https://github.com.evil.com/file', true), '');
  console.log('Program board tests passed.');
}
if (require.main === module) run();
module.exports = { createHarness, example };
