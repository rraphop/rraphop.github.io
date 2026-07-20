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
const styleCss = read("style.css");
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
    getUuid: () => "12345678-1234-1234-1234-123456789abc",
    formatDate: (date) => date.toISOString().slice(0, 10)
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

evaluate(`recordVisit_ = function () {
  return { success: true, today: 1, total: 282, date: "2026-07-13" };
}`);
const publicVisit = JSON.parse(evaluate(`handleRequest_({
  parameter: { action: "visit", date: "2026-07-13" }
}).text`));
assert.equal(publicVisit.ok, true);
assert.equal(publicVisit.today, 1);
assert.equal(publicVisit.total, 282);

const bridgeHtml = evaluate(`createDataBridgePage_({
  parameter: { channel: "bridge_test_channel" }
}).html`);
assert.match(bridgeHtml, /social-history-data-bridge-request/);
assert.match(bridgeHtml, /const channel = "bridge_test_channel";/);
assert.doesNotMatch(bridgeHtml, /window\.location\.hash/);
assert.match(bridgeHtml, /const hostWindow = window\.parent\.parent;/);
assert.match(bridgeHtml, /event\.source !== hostWindow/);
assert.doesNotMatch(bridgeHtml, /event\.source !== window\.top/);
assert.match(bridgeHtml, /https:\/\/rraphop\.github\.io/);
assert.match(bridgeHtml, /hostWindow\.postMessage/);

const dataApiClient = read("qna-config.js");
assert.match(dataApiClient, /bridgeWindow = event\.source/);
assert.match(dataApiClient, /googleusercontent/);
assert.match(dataApiClient, /url\.searchParams\.set\("channel", bridgeChannel\)/);
assert.doesNotMatch(dataApiClient, /url\.hash = bridgeChannel/);

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

assert.equal(evaluate('RANKING_DATE_HEADER'), "일자");
assert.deepEqual(
  JSON.parse(evaluate('JSON.stringify(ACID_RANKING_HEADERS)')),
  ["id", "일자", "name", "score", "level", "survivalMs"]
);
assert.deepEqual(
  JSON.parse(evaluate('JSON.stringify(HISTORY_CAUSE_RANKING_HEADERS)')),
  ["id", "일자", "nickname", "score", "area", "correctCount", "answeredCount", "maxCombo"]
);
assert.equal(evaluate('normalizeRankingDate_("2026-07-13T01:02:03.000Z")'), "2026-07-13");
assert.equal(evaluate('normalizeRankingDate_("")'), "");
assert.match(
  read("script.js"),
  /<th>순위<\/th>\s*<th>일자<\/th>\s*<th>이름<\/th>\s*<th>점수<\/th>\s*<th>생존시간<\/th>/
);
assert.match(
  historyHtml,
  /<th>순위<\/th>\s*<th>일자<\/th>\s*<th>닉네임<\/th>\s*<th>점수<\/th>\s*<th>영역<\/th>\s*<th>풀이 수<\/th>/
);
assert.match(styleCss, /\.acid-ranking-board table\s*{[^}]*table-layout:\s*fixed;/s);
assert.match(styleCss, /\.acid-ranking-board th:nth-child\(2\),[\s\S]*?width:\s*19%;/);
assert.match(styleCss, /\.acid-ranking-board th:nth-child\(3\),[\s\S]*?width:\s*30%;/);
assert.match(historyHtml, /\.ranking-grid\s*{[^}]*grid-template-columns:\s*repeat\(2,/s);
assert.match(historyHtml, /\.ranking-board:first-child\s*{[^}]*grid-column:\s*1\s*\/\s*-1;/s);

console.log("Internal review tests passed.");
