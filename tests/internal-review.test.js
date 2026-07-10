"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

for (const file of ["script.js", "quiz-data.js", "qna-config.js"]) {
  assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }));
}

const historyHtml = read("history-cause-effect-game.html");
let inlineScriptCount = 0;
for (const match of historyHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  inlineScriptCount += 1;
  assert.doesNotThrow(() => new vm.Script(match[1], {
    filename: `history-cause-effect-game.html#script${inlineScriptCount}`
  }));
}
assert.equal(inlineScriptCount, 4);

for (const file of fs.readdirSync(root).filter((name) => name.endsWith(".html"))) {
  const html = read(file);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${file} contains duplicate ids`);

  for (const match of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
    const reference = match[1];
    if (/^(?:https?:|mailto:|javascript:)/.test(reference)) continue;
    const localPath = reference.replace(/^\//, "");
    assert.ok(fs.existsSync(path.join(root, localPath)), `${file} references missing ${localPath}`);
  }
}

const cache = new Map();
const properties = new Map([
  ["WEB_ALLOWED_ORIGINS", "https://rraphop.github.io"]
]);
const appsContext = vm.createContext({
  console,
  Date,
  JSON,
  Math,
  Number,
  String,
  Array,
  Object,
  RegExp,
  Error,
  CacheService: {
    getScriptCache() {
      return {
        get: (key) => cache.get(key) || null,
        put: (key, value) => cache.set(key, value),
        remove: (key) => cache.delete(key)
      };
    }
  },
  ContentService: {
    MimeType: { JAVASCRIPT: "js", JSON: "json" },
    createTextOutput(text) {
      return {
        text,
        setMimeType(mimeType) {
          this.mimeType = mimeType;
          return this;
        }
      };
    }
  },
  HtmlService: {
    XFrameOptionsMode: { ALLOWALL: "ALLOWALL" },
    createHtmlOutput(html) {
      return {
        html,
        setTitle() { return this; },
        setXFrameOptionsMode() { return this; }
      };
    }
  },
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty: (key) => properties.get(key) || null,
        setProperty: (key, value) => properties.set(key, value),
        deleteProperty: (key) => properties.delete(key)
      };
    }
  },
  ScriptApp: { getScriptId: () => "test-script-id" },
  Utilities: {
    getUuid: () => "12345678-1234-1234-1234-123456789abc"
  }
});

vm.runInContext(read("apps-script/Code.gs"), appsContext, { filename: "apps-script/Code.gs" });
const evaluate = (source) => vm.runInContext(source, appsContext);

const privateQuestion = JSON.parse(evaluate(`JSON.stringify(publicQuestion_({
  id: "q1",
  createdAt: "2026-01-01",
  affiliation: "학교",
  grade: "2학년",
  name: "학생",
  text: "비공개 원문",
  private: true,
  answer: "답변"
}))`));
assert.equal(privateQuestion.text, "");
assert.equal(privateQuestion.private, true);

for (const action of [
  "create",
  "update",
  "answer",
  "delete",
  "visit",
  "acidRankingCreate",
  "historyCauseRankingCreate",
  "setupSheets",
  "initializeCounterSheets",
  "cleanupOldDailyCounts"
]) {
  const publicMutation = JSON.parse(evaluate(`handleRequest_({
    parameter: { action: "${action}", text: "질문", password: "secret" }
  }).text`));
  assert.equal(publicMutation.ok, false, `${action} must not be publicly callable`);
}

const bridgeHtml = evaluate("createDataBridgePage_().html");
assert.match(bridgeHtml, /social-history-data-bridge-request/);
assert.match(bridgeHtml, /https:\/\/rraphop\.github\.io/);
assert.match(bridgeHtml, /window\.top\.postMessage/);
assert.doesNotMatch(bridgeHtml, /window\.parent\.postMessage/);

const dataApiClient = read("qna-config.js");
assert.match(dataApiClient, /bridgeWindow = event\.source/);
assert.match(dataApiClient, /googleusercontent/);

const sessionToken = JSON.parse(evaluate(
  'JSON.stringify(createGameSession_("acid", { group: "social" }))'
)).token;
assert.ok(sessionToken);
assert.equal(evaluate(`consumeGameSession_("${sessionToken}", "acid").group`), "social");
assert.throws(() => evaluate(`consumeGameSession_("${sessionToken}", "acid")`));

assert.doesNotThrow(() => evaluate(`validateAcidRankingEntry_(
  { score: 50, level: 2, survivalMs: 1000 },
  { group: "social", createdAt: Date.now() - 10000 },
  "social"
)`));
assert.throws(() => evaluate(`validateAcidRankingEntry_(
  { score: 51, level: 2, survivalMs: 1000 },
  { group: "social", createdAt: Date.now() - 10000 },
  "social"
)`));

assert.doesNotThrow(() => evaluate(`validateHistoryCauseRankingEntry_(
  { area: "전체", score: -10, correctCount: 0, answeredCount: 1, maxCombo: 0 },
  { area: "전체", createdAt: Date.now() - 1000 }
)`));

console.log("Internal review tests passed.");
