const SHEET_NAME = 'QNA';
const COUNTER_SHEET_NAME = 'count';
const DAILY_SHEET_NAME = 'daily_count';
const MONTHLY_SHEET_NAME = 'monthly_count';
const ACID_RANKING_SHEET_NAMES = {
  social: '사회 산성비 랭킹',
  history: '역사 산성비 랭킹'
};
const HEADERS = [
  'id',
  'createdAt',
  'affiliation',
  'grade',
  'name',
  'text',
  'private',
  'passwordHash',
  'answer',
  'answeredAt',
  'status'
];
const COUNTER_HEADERS = ['date', 'count'];
const COUNTER_TODAY_CELL = 'I1';
const COUNTER_TODAY_COUNT_CELL = 'J1';
const COUNTER_TODAY_FORMULA = '=TODAY()';
const COUNTER_TODAY_COUNT_FORMULA = '=IFERROR(SUM(FILTER(B:B, TEXT(A:A,"yyyy-mm-dd")=TEXT(I1,"yyyy-mm-dd"))),0)';
const COUNTER_TOTAL_OFFSET_PROPERTY = 'VISITOR_COUNTER_TOTAL_OFFSET';
const COUNTER_DEBUG_VERSION = 'counter-daily-rollup-2026-05-23-01';
const COUNTER_LAYOUT_VERSION_PROPERTY = 'VISITOR_COUNTER_LAYOUT_VERSION';
const COUNTER_MIGRATION_VERSION_PROPERTY = 'VISITOR_COUNTER_MIGRATION_VERSION';
const DAILY_HEADERS = ['date', 'count'];
const MONTHLY_HEADERS = ['month', 'count'];
const COUNT_TIMEZONE = 'Asia/Seoul';
const DAILY_KEEP_DAYS = 40;
const RANKING_DATE_HEADER = '일자';
const ACID_RANKING_HEADERS = [
  'id',
  RANKING_DATE_HEADER,
  'name',
  'score',
  'level',
  'survivalMs'
];
const ACID_RANKING_LIMIT = 10;
const HISTORY_CAUSE_RANKING_SHEET_NAME = '역사 추리왕 랭킹';
const HISTORY_CAUSE_RANKING_HEADERS = [
  'id',
  RANKING_DATE_HEADER,
  'nickname',
  'score',
  'area',
  'correctCount',
  'answeredCount',
  'maxCombo'
];
const HISTORY_CAUSE_RANKING_LIMIT = 10;
const WEB_ALLOWED_ORIGINS_PROPERTY = 'WEB_ALLOWED_ORIGINS';
const DEFAULT_WEB_ALLOWED_ORIGIN = 'https://rraphop.github.io';
const GAME_SESSION_TTL_SECONDS = 21600;
const GAME_SESSION_CACHE_PREFIX = 'GAME_SESSION_V1_';
const QNA_TEXT_MAX_LENGTH = 5000;
const QNA_ANSWER_MAX_LENGTH = 5000;
const QNA_PASSWORD_MAX_LENGTH = 128;

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'bridge') {
    return createDataBridgePage_();
  }
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function setupSheets() {
  return setupSheets_();
}

function initializeCounter() {
  return initializeCounterSheets();
}

function initializeCounterSheets() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return initializeCounterSheets_();
  } finally {
    lock.releaseLock();
  }
}

function rebuildMonthlyCounts() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return rebuildMonthlyCounts_();
  } finally {
    lock.releaseLock();
  }
}

function cleanupOldDailyCounts() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return cleanupOldDailyCounts_();
  } finally {
    lock.releaseLock();
  }
}

function getParams_(e) {
  const params = Object.assign({}, e && e.parameter ? e.parameter : {});
  const contents = e && e.postData && e.postData.contents;
  if (contents) {
    try {
      Object.assign(params, JSON.parse(contents));
    } catch (error) {
      // Form/query requests do not need JSON parsing.
    }
  }
  return params;
}

function createDataBridgePage_() {
  const allowedOriginsJson = JSON.stringify(getAllowedWebOrigins_()).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"></head><body><script>
(function () {
  "use strict";
  const allowedOrigins = ${allowedOriginsJson};
  const channel = decodeURIComponent(window.location.hash.slice(1));

  function isAllowedOrigin(origin) {
    return allowedOrigins.includes(origin)
      || /^http:\\/\\/(?:127\\.0\\.0\\.1|localhost)(?::\\d+)?$/.test(origin);
  }

  function respond(origin, id, payload) {
    window.top.postMessage({
      type: "social-history-data-bridge-response",
      channel: channel,
      id: id,
      payload: payload
    }, origin);
  }

  window.addEventListener("message", function (event) {
    const message = event.data;
    if (event.source !== window.top || !isAllowedOrigin(event.origin)) return;
    if (!message || message.type !== "social-history-data-bridge-request") return;
    if (message.channel !== channel || !message.id) return;

    const requestOrigin = event.origin;
    const requestId = message.id;
    google.script.run
      .withSuccessHandler(function (payload) {
        respond(requestOrigin, requestId, payload);
      })
      .withFailureHandler(function (error) {
        respond(requestOrigin, requestId, {
          ok: false,
          message: error && error.message ? error.message : "데이터 요청을 처리하지 못했습니다."
        });
      })
      .handleBridgeRequest({ action: message.action, params: message.params || {} });
  });

  window.top.postMessage({
    type: "social-history-data-bridge-ready",
    channel: channel
  }, "*");
}());
</script></body></html>`;

  return HtmlService.createHtmlOutput(html)
    .setTitle('')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getAllowedWebOrigins_() {
  const configured = PropertiesService.getScriptProperties().getProperty(WEB_ALLOWED_ORIGINS_PROPERTY);
  const origins = String(configured || DEFAULT_WEB_ALLOWED_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(origin));
  return origins.length > 0 ? Array.from(new Set(origins)) : [DEFAULT_WEB_ALLOWED_ORIGIN];
}

function handleBridgeRequest(request) {
  const action = String(request && request.action || '');
  const params = Object.assign({}, request && request.params ? request.params : {});

  try {
    let result;
    switch (action) {
      case 'create':
        result = createQuestion_(params);
        break;
      case 'privateQuestion':
        result = getPrivateQuestion_(params);
        break;
      case 'update':
        result = updateQuestion_(params);
        break;
      case 'answer':
        result = answerQuestion_(params);
        break;
      case 'delete':
        result = deleteQuestion_(params);
        break;
      case 'visit':
        result = recordVisit_(params);
        break;
      case 'acidRankingSession':
        result = createGameSession_('acid', params);
        break;
      case 'acidRankingCreate':
        result = createAcidRanking_(params);
        break;
      case 'historyCauseRankingSession':
        result = createGameSession_('historyCause', params);
        break;
      case 'historyCauseRankingCreate':
        result = createHistoryCauseRanking_(params);
        break;
      default:
        throw new Error('허용되지 않은 데이터 변경 요청입니다.');
    }

    result.ok = true;
    return result;
  } catch (error) {
    return { ok: false, message: error.message || '요청 처리 중 오류가 발생했습니다.' };
  }
}

function handleRequest_(e) {
  const params = getParams_(e);
  const action = params.action || 'list';

  try {
    let result;
    switch (action) {
      case 'list':
        result = listQuestions_();
        break;
      case 'count':
        result = getVisitorCount_(params);
        break;
      case 'visit':
        // 방문자 카운터는 민감 정보가 없는 공개 집계이므로 모든 브라우저에서 동작하는 JSONP 요청을 허용합니다.
        result = recordVisit_(params);
        break;
      case 'acidRankings':
        result = listAcidRankings_();
        break;
      case 'historyCauseRankings':
        result = listHistoryCauseRankings_();
        break;
      case 'ping':
        result = { message: 'QNA data API is ready.' };
        break;
      default:
        throw new Error('알 수 없는 요청입니다.');
    }

    result.ok = true;
    return output_(result, params.callback);
  } catch (error) {
    return output_({ ok: false, message: error.message || '요청 처리 중 오류가 발생했습니다.' }, params.callback);
  }
}

function listQuestions_() {
  const sheet = getSheet_();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { questions: [] };

  const map = getHeaderMap_(sheet);
  const questions = rows
    .slice(1)
    .map((row) => rowToQuestion_(row, map))
    .filter((item) => item.id && item.status !== 'deleted')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(publicQuestion_);

  return { questions };
}

function createQuestion_(params) {
  requireValue_(params.text, '질문 내용을 입력하세요.');
  requireValue_(params.password, '수정 비밀번호를 입력하세요.');
  requireTextLength_(params.text, QNA_TEXT_MAX_LENGTH, '질문 내용');
  requireTextLength_(params.password, QNA_PASSWORD_MAX_LENGTH, '수정 비밀번호');
  requireTextLength_(params.affiliation, 80, '소속');
  requireTextLength_(params.grade, 20, '학년');
  requireTextLength_(params.name, 40, '이름');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const now = new Date().toISOString();
    const id = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const rowObject = {
      id,
      createdAt: now,
      affiliation: params.affiliation || '미기재',
      grade: params.grade || '미기재',
      name: params.name || '익명',
      text: params.text || '',
      private: toBoolean_(params.private),
      passwordHash: passwordHash_(params.password),
      answer: '',
      answeredAt: '',
      status: 'active'
    };
    sheet.appendRow(HEADERS.map((header) => rowObject[header] ?? ''));
    return { question: publicQuestion_(rowObject) };
  } finally {
    lock.releaseLock();
  }
}

function getPrivateQuestion_(params) {
  requireValue_(params.id, '질문 ID가 없습니다.');
  requireValue_(params.password, '수정 비밀번호를 입력하세요.');
  requireTextLength_(params.password, QNA_PASSWORD_MAX_LENGTH, '수정 비밀번호');

  const sheet = getSheet_();
  const found = findQuestionRow_(sheet, params.id);
  if (!found) throw new Error('질문을 찾을 수 없습니다.');
  const question = rowToQuestion_(found.row, found.map, true);
  if (question.status === 'deleted') throw new Error('삭제된 질문입니다.');
  if (passwordHash_(params.password) !== question.passwordHash) {
    throw new Error('수정 비밀번호가 맞지 않습니다.');
  }
  return {
    question: {
      id: question.id,
      text: question.text,
      private: toBoolean_(question.private)
    }
  };
}

function updateQuestion_(params) {
  requireValue_(params.id, '질문 ID가 없습니다.');
  requireValue_(params.password, '수정 비밀번호를 입력하세요.');
  requireValue_(params.text, '질문 내용을 입력하세요.');
  requireTextLength_(params.password, QNA_PASSWORD_MAX_LENGTH, '수정 비밀번호');
  requireTextLength_(params.text, QNA_TEXT_MAX_LENGTH, '질문 내용');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const found = findQuestionRow_(sheet, params.id);
    if (!found) throw new Error('질문을 찾을 수 없습니다.');
    const question = rowToQuestion_(found.row, found.map, true);
    if (question.status === 'deleted') throw new Error('삭제된 질문입니다.');
    if (passwordHash_(params.password) !== question.passwordHash) {
      throw new Error('수정 비밀번호가 맞지 않습니다.');
    }

    setCell_(sheet, found.rowIndex, found.map, 'text', params.text);
    setCell_(sheet, found.rowIndex, found.map, 'private', toBoolean_(params.private));
    question.text = params.text;
    question.private = toBoolean_(params.private);
    return { question: publicQuestion_(question) };
  } finally {
    lock.releaseLock();
  }
}

function answerQuestion_(params) {
  requireTextLength_(params.adminPassword, QNA_PASSWORD_MAX_LENGTH, '관리자 비밀번호');
  requireAdmin_(params.adminPassword);
  requireValue_(params.id, '질문 ID가 없습니다.');
  requireValue_(params.answer, '답변 내용을 입력하세요.');
  requireTextLength_(params.answer, QNA_ANSWER_MAX_LENGTH, '답변 내용');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const found = findQuestionRow_(sheet, params.id);
    if (!found) throw new Error('질문을 찾을 수 없습니다.');
    const question = rowToQuestion_(found.row, found.map, true);
    if (question.status === 'deleted') throw new Error('삭제된 질문입니다.');

    const answeredAt = new Date().toISOString();
    setCell_(sheet, found.rowIndex, found.map, 'answer', params.answer);
    setCell_(sheet, found.rowIndex, found.map, 'answeredAt', answeredAt);
    question.answer = params.answer;
    question.answeredAt = answeredAt;
    return { question: publicQuestion_(question) };
  } finally {
    lock.releaseLock();
  }
}

function deleteQuestion_(params) {
  requireTextLength_(params.adminPassword, QNA_PASSWORD_MAX_LENGTH, '관리자 비밀번호');
  requireAdmin_(params.adminPassword);
  requireValue_(params.id, '질문 ID가 없습니다.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const found = findQuestionRow_(sheet, params.id);
    if (!found) throw new Error('질문을 찾을 수 없습니다.');
    sheet.deleteRow(found.rowIndex);
    return { deletedId: params.id };
  } finally {
    lock.releaseLock();
  }
}

function getVisitorCount_(params) {
  const currentDate = getTodayDateKey_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getCounterSheet_();
    const total = readCounterTotal_(sheet);
    const todayInfo = readCounterToday_(sheet);
    return buildCounterResponse_(total, todayInfo, currentDate);
  } finally {
    lock.releaseLock();
  }
}

function recordVisit() {
  return recordVisit_({});
}

function recordVisit_(params) {
  const currentDate = getTodayDateKey_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getCounterSheet_();
    incrementCounterVisit_(sheet, currentDate);
    const total = readCounterTotal_(sheet);
    const todayInfo = readCounterToday_(sheet);
    return buildCounterResponse_(total, todayInfo, currentDate);
  } finally {
    lock.releaseLock();
  }
}

function getTodayVisitCount(todayDate) {
  const sheet = getCounterSheet_();
  const targetDate = normalizeCounterDateKey_(todayDate || getTodayDateKey_());
  if (targetDate === getTodayDateKey_()) return readCounterToday_(sheet).today;
  return readCounterDateTotal_(sheet, targetDate);
}

function initializeCounterSheets_() {
  const spreadsheet = getSpreadsheet_();
  const currentDate = getTodayDateKey_();
  let sheet = spreadsheet.getSheetByName(COUNTER_SHEET_NAME);
  let backupSheetName = '';

  if (sheet) {
    backupSheetName = backupCounterSheet_(spreadsheet, sheet);
    sheet.clear();
  } else {
    sheet = spreadsheet.insertSheet(COUNTER_SHEET_NAME);
  }

  PropertiesService.getScriptProperties().deleteProperty(COUNTER_TOTAL_OFFSET_PROPERTY);
  ensureCounterHeaders_(sheet);
  const dailySheet = getDailySheet_();
  const monthlySheet = getMonthlySheet_();
  return {
    success: true,
    sheets: [sheet.getName(), dailySheet.getName(), monthlySheet.getName()],
    backup: backupSheetName,
    total: 0,
    today: 0,
    date: currentDate
  };
}

function backupCounterSheet_(spreadsheet, sheet) {
  try {
    const timestamp = Utilities.formatDate(new Date(), COUNT_TIMEZONE, 'yyyyMMdd_HHmmss');
    const backupName = getUniqueSheetName_(spreadsheet, `${COUNTER_SHEET_NAME}_backup_${timestamp}`);
    const backupSheet = sheet.copyTo(spreadsheet);
    backupSheet.setName(backupName);
    return backupSheet.getName();
  } catch (error) {
    Logger.log(`VisitorCounter backup failed: ${error.message || error}`);
    return '';
  }
}

function getUniqueSheetName_(spreadsheet, baseName) {
  if (!spreadsheet.getSheetByName(baseName)) return baseName;
  for (let index = 2; index < 100; index += 1) {
    const name = `${baseName}_${index}`;
    if (!spreadsheet.getSheetByName(name)) return name;
  }
  return `${baseName}_${Date.now()}`;
}

function incrementCounterVisit_(sheet, currentDate) {
  const rowIndex = findCounterDateRow_(sheet, currentDate);
  if (rowIndex) {
    const nextCount = normalizeCounterNumber_(sheet.getRange(rowIndex, 2).getValue(), 0) + 1;
    sheet.getRange(rowIndex, 1).setValue(Utilities.parseDate(currentDate, COUNT_TIMEZONE, 'yyyy-MM-dd'));
    sheet.getRange(rowIndex, 2).setValue(nextCount);
    sheet.getRange(rowIndex, 1).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(rowIndex, 2).setNumberFormat('0');
    SpreadsheetApp.flush();
    return { date: currentDate, count: nextCount, rowIndex };
  }

  const recordDate = Utilities.parseDate(currentDate, COUNT_TIMEZONE, 'yyyy-MM-dd');
  sheet.appendRow([recordDate, 1]);
  const newRowIndex = sheet.getLastRow();
  sheet.getRange(newRowIndex, 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(newRowIndex, 2).setNumberFormat('0');
  SpreadsheetApp.flush();
  return { date: currentDate, count: 1, rowIndex: newRowIndex };
}

function readCounterToday_(sheet) {
  SpreadsheetApp.flush();
  // 오늘 방문자 수: count!J1 공식이 오늘 날짜 행의 count 값을 계산한 결과를 읽습니다.
  const j1Value = sheet.getRange(COUNTER_TODAY_COUNT_CELL).getValue();
  return {
    today: normalizeCounterNumber_(j1Value, 0),
    j1Value
  };
}

function readCounterTotal_(sheet) {
  // 총 방문자 수: count 시트의 날짜별 count 합계를 기준으로 계산합니다.
  return getCounterTotalOffset_() + readCounterRecordTotal_(sheet);
}

function readCounterRecordTotal_(sheet) {
  const values = sheet.getDataRange().getValues();
  let total = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (!normalizeCounterDateKey_(values[index][0])) continue;
    total += normalizeCounterNumber_(values[index][1], 0);
  }
  return total;
}

function readCounterDateTotal_(sheet, targetDate) {
  const values = sheet.getDataRange().getValues();
  let total = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (normalizeCounterDateKey_(values[index][0]) !== targetDate) continue;
    total += normalizeCounterNumber_(values[index][1], 0);
  }
  return total;
}

function getCounterTotalOffset_() {
  const props = PropertiesService.getScriptProperties();
  return normalizeCounterNumber_(props.getProperty(COUNTER_TOTAL_OFFSET_PROPERTY), 0);
}

function findCounterDateRow_(sheet, dateKey) {
  const targetDate = normalizeCounterDateKey_(dateKey);
  if (!targetDate) return null;

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let index = 0; index < values.length; index += 1) {
    if (normalizeCounterDateKey_(values[index][0]) === targetDate) return index + 2;
  }
  return null;
}

function setCounterDateTotal_(sheet, dateKey, count) {
  const value = normalizeCounterNumber_(count, 0);
  const recordDate = Utilities.parseDate(dateKey, COUNT_TIMEZONE, 'yyyy-MM-dd');
  const rowIndex = findCounterDateRow_(sheet, dateKey);

  if (rowIndex) {
    sheet.getRange(rowIndex, 1, 1, COUNTER_HEADERS.length).setValues([[recordDate, value]]);
    sheet.getRange(rowIndex, 1).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(rowIndex, 2).setNumberFormat('0');
    return rowIndex;
  }

  sheet.appendRow([recordDate, value]);
  const newRowIndex = sheet.getLastRow();
  sheet.getRange(newRowIndex, 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(newRowIndex, 2).setNumberFormat('0');
  return newRowIndex;
}

function compactCounterSheetRecords_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { compacted: false, dates: 0, total: 0 };

  const rows = sheet.getRange(2, 1, lastRow - 1, COUNTER_HEADERS.length).getValues();
  const countsByDate = {};
  let originalRecordCount = 0;
  let needsCompaction = false;

  rows.forEach((row) => {
    const dateKey = normalizeCounterDateKey_(row[0]);
    const value = normalizeCounterNumber_(row[1], 0);
    const hasAnyValue = String(row[0] || '').trim() !== '' || String(row[1] || '').trim() !== '';

    if (!dateKey || value <= 0) {
      if (hasAnyValue) needsCompaction = true;
      return;
    }

    if (countsByDate[dateKey] != null) needsCompaction = true;
    countsByDate[dateKey] = (countsByDate[dateKey] || 0) + value;
    originalRecordCount += 1;
  });

  const dates = Object.keys(countsByDate).sort();
  if (dates.length !== originalRecordCount) needsCompaction = true;
  if (!needsCompaction) {
    return {
      compacted: false,
      dates: dates.length,
      total: dates.reduce((sum, dateKey) => sum + countsByDate[dateKey], 0)
    };
  }

  // 마이그레이션: 기존 방문 1회 1행 데이터를 날짜별 1행 합계로 접어 누적 total을 보존합니다.
  sheet.getRange(2, 1, lastRow - 1, COUNTER_HEADERS.length).clearContent();
  if (dates.length > 0) {
    const values = dates.map((dateKey) => [
      Utilities.parseDate(dateKey, COUNT_TIMEZONE, 'yyyy-MM-dd'),
      countsByDate[dateKey]
    ]);
    sheet.getRange(2, 1, values.length, COUNTER_HEADERS.length).setValues(values);
    sheet.getRange(2, 1, values.length, 1).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(2, 2, values.length, 1).setNumberFormat('0');
  }
  SpreadsheetApp.flush();

  return {
    compacted: true,
    dates: dates.length,
    total: dates.reduce((sum, dateKey) => sum + countsByDate[dateKey], 0)
  };
}

function migrateCounterOffsetIntoSheet_(sheet) {
  const offset = getCounterTotalOffset_();
  if (offset <= 0) return { migrated: false, offset: 0 };

  const currentDate = getTodayDateKey_();
  const currentCount = readCounterDateTotal_(sheet, currentDate);
  setCounterDateTotal_(sheet, currentDate, currentCount + offset);
  PropertiesService.getScriptProperties().deleteProperty(COUNTER_TOTAL_OFFSET_PROPERTY);
  SpreadsheetApp.flush();
  return { migrated: true, offset };
}

function shouldRunCounterMaintenance_(propertyName) {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty(propertyName) !== COUNTER_DEBUG_VERSION;
}

function markCounterMaintenanceDone_(propertyName) {
  PropertiesService.getScriptProperties().setProperty(propertyName, COUNTER_DEBUG_VERSION);
}

function buildCounterResponse_(total, todayInfo, currentDate) {
  return {
    success: true,
    total,
    today: todayInfo.today,
    date: currentDate
  };
}

function migrateLegacyCounterSheet_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length === 0) return;

  const firstHeader = String(values[0][0] || '').trim().toLowerCase();
  const secondHeader = String(values[0][1] || '').trim().toLowerCase();
  if (firstHeader !== 'key' || secondHeader !== 'value') return;

  let legacyTotal = 0;
  values.slice(1).forEach((row) => {
    if (String(row[0] || '').trim() === 'total') {
      legacyTotal = normalizeCounterNumber_(row[1], 0);
    }
  });

  const currentDate = getTodayDateKey_();
  if (legacyTotal > 0) {
    sheet.clear();
    sheet.getRange(1, 1, 1, COUNTER_HEADERS.length).setValues([COUNTER_HEADERS]);
    sheet.appendRow([Utilities.parseDate(currentDate, COUNT_TIMEZONE, 'yyyy-MM-dd'), legacyTotal]);
    sheet.getRange(2, 1).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(2, 2).setNumberFormat('0');
    SpreadsheetApp.flush();
    return;
  }

  sheet.clear();
}

function normalizeCounterDateKey_(value, fallback) {
  const dateKey = normalizeDate(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  return fallback || '';
}

function rebuildMonthlyCounts_() {
  const dailySheet = getDailySheet_();
  const values = dailySheet.getDataRange().getValues();
  const monthlyCounts = {};

  values.slice(1).forEach((row) => {
    const dateKey = normalizeCounterDateKey_(row[0]);
    const value = normalizeCounterNumber_(row[1], 0);
    if (!dateKey || value <= 0) return;
    const monthKey = dateKey.slice(0, 7);
    monthlyCounts[monthKey] = (monthlyCounts[monthKey] || 0) + value;
  });

  const monthlySheet = getMonthlySheet_();
  monthlySheet.clear();
  monthlySheet.getRange(1, 1, 1, MONTHLY_HEADERS.length).setValues([MONTHLY_HEADERS]);

  const rows = Object.keys(monthlyCounts)
    .sort()
    .map((month) => [month, monthlyCounts[month]]);
  if (rows.length > 0) {
    monthlySheet.getRange(2, 1, rows.length, MONTHLY_HEADERS.length).setValues(rows);
  }

  return { success: true, months: rows.length };
}

function cleanupOldDailyRecords() {
  return cleanupOldDailyCounts();
}

function cleanupOldRecords() {
  return cleanupOldDailyCounts();
}

function cleanupOldDailyCounts_() {
  const rebuildResult = rebuildMonthlyCounts_();
  const sheet = getDailySheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return { success: true, deleted: 0, monthlyRebuild: rebuildResult };
  }

  const cutoffKey = getDateKeyDaysAgo_(DAILY_KEEP_DAYS);
  const rowsToDelete = [];

  values.slice(1).forEach((row, index) => {
    const dateKey = normalizeDate(row[0]);
    if (!dateKey || dateKey >= cutoffKey) return;
    rowsToDelete.push(index + 2);
  });

  rowsToDelete.sort((a, b) => b - a).forEach((rowIndex) => sheet.deleteRow(rowIndex));
  return {
    success: true,
    cutoffDate: cutoffKey,
    deleted: rowsToDelete.length,
    monthlyRebuild: rebuildResult
  };
}

function normalizeCounterNumber_(value, fallback) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const sheetEpoch = Date.UTC(1899, 11, 30);
    const serialDateNumber = Math.round((value.getTime() - sheetEpoch) / 86400000);
    return Math.max(0, serialDateNumber);
  }

  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.round(number));
}

function getDateKeyDaysAgo_(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return Utilities.formatDate(date, COUNT_TIMEZONE, 'yyyy-MM-dd');
}

function setupSheets_() {
  const qnaSheet = getSheet_();
  const counterSheet = getCounterSheet_();
  const dailySheet = getDailySheet_();
  const monthlySheet = getMonthlySheet_();
  const socialRankingSheet = getAcidRankingSheet_('social');
  const historyRankingSheet = getAcidRankingSheet_('history');
  const historyCauseRankingSheet = getHistoryCauseRankingSheet_();
  return {
    sheets: [
      qnaSheet.getName(),
      counterSheet.getName(),
      dailySheet.getName(),
      monthlySheet.getName(),
      socialRankingSheet.getName(),
      historyRankingSheet.getName(),
      historyCauseRankingSheet.getName()
    ]
  };
}

function listAcidRankings_() {
  return { rankings: getAcidRankingGroups_() };
}

function createGameSession_(type, params) {
  const session = {
    type,
    createdAt: Date.now()
  };

  if (type === 'acid') {
    session.group = normalizeAcidGroup_(params.group);
  } else if (type === 'historyCause') {
    session.area = normalizeHistoryCauseArea_(params.area);
  } else {
    throw new Error('게임 세션 종류가 올바르지 않습니다.');
  }

  const token = Utilities.getUuid().replace(/[^A-Za-z0-9-]/g, '');
  CacheService.getScriptCache().put(
    `${GAME_SESSION_CACHE_PREFIX}${token}`,
    JSON.stringify(session),
    GAME_SESSION_TTL_SECONDS
  );
  return { token };
}

function consumeGameSession_(token, expectedType) {
  const normalizedToken = String(token || '').trim();
  if (!/^[A-Za-z0-9-]{20,80}$/.test(normalizedToken)) {
    throw new Error('유효한 랭킹 등록 세션이 없습니다.');
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = `${GAME_SESSION_CACHE_PREFIX}${normalizedToken}`;
  const raw = cache.get(cacheKey);
  if (!raw) throw new Error('랭킹 등록 세션이 만료되었습니다. 게임을 다시 시작하세요.');

  const session = JSON.parse(raw);
  if (session.type !== expectedType) throw new Error('랭킹 등록 세션이 올바르지 않습니다.');
  if (!Number.isFinite(Number(session.createdAt))) throw new Error('랭킹 등록 세션 시간이 올바르지 않습니다.');
  cache.remove(cacheKey);
  return session;
}

function validateAcidRankingEntry_(entry, session, group) {
  if (session.group !== group) throw new Error('게임 항목과 랭킹 항목이 일치하지 않습니다.');
  if (entry.score % 2 !== 0) throw new Error('산성비 게임 점수가 올바르지 않습니다.');

  const expectedLevel = Math.min(9, Math.floor(entry.score / 50) + 1);
  if (entry.level !== expectedLevel) throw new Error('산성비 게임 단계가 점수와 일치하지 않습니다.');

  const serverElapsed = Math.max(0, Date.now() - Number(session.createdAt));
  const elapsedTolerance = 30000;
  if (entry.survivalMs > serverElapsed + elapsedTolerance) {
    throw new Error('산성비 게임 생존시간이 올바르지 않습니다.');
  }

  const maximumDrops = Math.floor((serverElapsed + elapsedTolerance) / 750) + 2;
  if (entry.score > maximumDrops * 10) {
    throw new Error('산성비 게임 점수가 진행시간 범위를 벗어났습니다.');
  }
}

function validateHistoryCauseRankingEntry_(entry, session) {
  if (session.area !== entry.area) throw new Error('게임 영역과 랭킹 영역이 일치하지 않습니다.');
  if (entry.answeredCount < 1 || entry.answeredCount > 10000) {
    throw new Error('역사 추리왕 풀이 수가 올바르지 않습니다.');
  }
  if (entry.correctCount > entry.answeredCount - 1) {
    throw new Error('역사 추리왕 정답 수가 올바르지 않습니다.');
  }
  if (entry.maxCombo > entry.correctCount) {
    throw new Error('역사 추리왕 최고 콤보가 올바르지 않습니다.');
  }

  const maximumScore = 23 * Math.max(0, entry.answeredCount - 1) - 10;
  if (entry.score < -10 || entry.score > maximumScore) {
    throw new Error('역사 추리왕 점수가 풀이 기록과 일치하지 않습니다.');
  }

  const serverElapsed = Math.max(0, Date.now() - Number(session.createdAt));
  const maximumAnswers = Math.floor((serverElapsed + 30000) / 250) + 1;
  if (entry.answeredCount > maximumAnswers) {
    throw new Error('역사 추리왕 풀이 수가 진행시간 범위를 벗어났습니다.');
  }
}

function createAcidRanking_(params) {
  const group = normalizeAcidGroup_(params.group);
  const rankingDate = getTodayDateKey_();
  const entry = {
    id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    date: rankingDate,
    name: sanitizePlayerName_(params.name),
    score: normalizeRankingNumber_(params.score, 0),
    level: normalizeRankingNumber_(params.level, 1),
    survivalMs: normalizeRankingNumber_(params.survivalMs, 0)
  };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const session = consumeGameSession_(params.sessionToken, 'acid');
    validateAcidRankingEntry_(entry, session, group);
    const sheet = getAcidRankingSheet_(group);
    appendRankingEntry_(sheet, ACID_RANKING_HEADERS, entry);
    const groupEntries = listAcidRankingEntries_(group);
    const rankIndex = groupEntries.findIndex((item) => item.id === entry.id);
    return {
      entry: publicAcidRankingEntry_(entry),
      rank: rankIndex >= 0 && rankIndex < ACID_RANKING_LIMIT ? rankIndex + 1 : null,
      rankings: getAcidRankingGroups_()
    };
  } finally {
    lock.releaseLock();
  }
}

function listHistoryCauseRankings_() {
  return { rankings: getHistoryCauseRankingGroups_() };
}

function createHistoryCauseRanking_(params) {
  const rankingDate = getTodayDateKey_();
  const entry = {
    id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    date: rankingDate,
    nickname: sanitizePlayerName_(params.nickname || params.name),
    score: normalizeSignedRankingNumber_(params.score, 0),
    area: normalizeHistoryCauseArea_(params.area),
    correctCount: normalizeRankingNumber_(params.correctCount, 0),
    answeredCount: normalizeRankingNumber_(params.answeredCount, 0),
    maxCombo: normalizeRankingNumber_(params.maxCombo, 0)
  };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const session = consumeGameSession_(params.sessionToken, 'historyCause');
    validateHistoryCauseRankingEntry_(entry, session);
    const sheet = getHistoryCauseRankingSheet_();
    appendRankingEntry_(sheet, HISTORY_CAUSE_RANKING_HEADERS, entry);
    const entries = listHistoryCauseRankingEntries_();
    const rankIndex = entries.findIndex((item) => item.id === entry.id);
    return {
      entry: publicHistoryCauseRankingEntry_(entry),
      rank: rankIndex >= 0 && rankIndex < HISTORY_CAUSE_RANKING_LIMIT ? rankIndex + 1 : null,
      rankings: getHistoryCauseRankingGroups_()
    };
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  ensureHeaders_(sheet);
  return sheet;
}

function getCounterSheet_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(COUNTER_SHEET_NAME) || spreadsheet.insertSheet(COUNTER_SHEET_NAME);
  ensureCounterHeaders_(sheet);
  return sheet;
}

function getDailySheet_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(DAILY_SHEET_NAME) || spreadsheet.insertSheet(DAILY_SHEET_NAME);
  ensureHeaders_(sheet, DAILY_HEADERS);
  return sheet;
}

function getMonthlySheet_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(MONTHLY_SHEET_NAME) || spreadsheet.insertSheet(MONTHLY_SHEET_NAME);
  ensureHeaders_(sheet, MONTHLY_HEADERS);
  return sheet;
}

function getAcidRankingSheet_(group) {
  const spreadsheet = getSpreadsheet_();
  const sheetName = ACID_RANKING_SHEET_NAMES[group];
  const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  ensureRankingHeaders_(sheet, ACID_RANKING_HEADERS);
  return sheet;
}

function getHistoryCauseRankingSheet_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(HISTORY_CAUSE_RANKING_SHEET_NAME) || spreadsheet.insertSheet(HISTORY_CAUSE_RANKING_SHEET_NAME);
  ensureRankingHeaders_(sheet, HISTORY_CAUSE_RANKING_HEADERS);
  return sheet;
}

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty('QNA_SPREADSHEET_ID');
  const spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error('데이터 저장소를 찾을 수 없습니다. 데이터 연결 설정을 확인하세요.');
  }

  return spreadsheet;
}

function ensureHeaders_(sheet, headers = HEADERS) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return;
  }

  const lastColumn = Math.max(sheet.getLastColumn(), headers.length);
  const current = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].filter(String);
  if (current.length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }

  headers.forEach((header) => {
    if (!current.includes(header)) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
    }
  });
}

function ensureRankingHeaders_(sheet, headers) {
  if (sheet.getLastRow() > 0 && sheet.getLastColumn() > 0) {
    const current = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (!current.includes(RANKING_DATE_HEADER)) {
      const legacyDateIndex = current.findIndex((header) => header === 'createdAt' || header === 'date');
      if (legacyDateIndex >= 0) {
        sheet.getRange(1, legacyDateIndex + 1).setValue(RANKING_DATE_HEADER);
      }
    }
  }

  ensureHeaders_(sheet, headers);
}

function appendRankingEntry_(sheet, headers, entry) {
  const map = getHeaderMap_(sheet);
  const row = Array(sheet.getLastColumn()).fill('');
  headers.forEach((header) => {
    const columnIndex = map[header];
    if (columnIndex == null) return;
    row[columnIndex] = header === RANKING_DATE_HEADER ? entry.date || '' : entry[header] ?? '';
  });
  sheet.appendRow(row);
}

function ensureCounterHeaders_(sheet) {
  migrateLegacyCounterSheet_(sheet);
  const currentHeaders = sheet.getRange(1, 1, 1, COUNTER_HEADERS.length).getValues()[0];
  if (currentHeaders.some((value, index) => String(value) !== COUNTER_HEADERS[index])) {
    sheet.getRange(1, 1, 1, COUNTER_HEADERS.length).setValues([COUNTER_HEADERS]);
  }

  const todayCell = sheet.getRange(COUNTER_TODAY_CELL);
  if (todayCell.getFormula() !== COUNTER_TODAY_FORMULA) {
    todayCell.setFormula(COUNTER_TODAY_FORMULA);
  }

  const todayCountCell = sheet.getRange(COUNTER_TODAY_COUNT_CELL);
  if (todayCountCell.getFormula() !== COUNTER_TODAY_COUNT_FORMULA) {
    todayCountCell.setFormula(COUNTER_TODAY_COUNT_FORMULA);
  }

  if (shouldRunCounterMaintenance_(COUNTER_LAYOUT_VERSION_PROPERTY)) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('B:B').setNumberFormat('0');
    sheet.getRange(COUNTER_TODAY_CELL).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(COUNTER_TODAY_COUNT_CELL).setNumberFormat('0');
    markCounterMaintenanceDone_(COUNTER_LAYOUT_VERSION_PROPERTY);
  }

  if (shouldRunCounterMaintenance_(COUNTER_MIGRATION_VERSION_PROPERTY)) {
    compactCounterSheetRecords_(sheet);
    markCounterMaintenanceDone_(COUNTER_MIGRATION_VERSION_PROPERTY);
  }

  migrateCounterOffsetIntoSheet_(sheet);
}

function getHeaderMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.reduce((map, header, index) => {
    if (header) map[header] = index;
    return map;
  }, {});
}

function findQuestionRow_(sheet, id) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return null;
  const map = getHeaderMap_(sheet);
  for (let i = 1; i < values.length; i += 1) {
    if (String(values[i][map.id] || '') === String(id)) {
      return { rowIndex: i + 1, row: values[i], map };
    }
  }
  return null;
}

function getAcidRankingGroups_() {
  return {
    social: listAcidRankingEntries_('social'),
    history: listAcidRankingEntries_('history')
  };
}

function listAcidRankingEntries_(group) {
  const sheet = getAcidRankingSheet_(group);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const map = getHeaderMap_(sheet);
  return sortAcidRankingEntries_(values
    .slice(1)
    .map((row) => rowToAcidRankingEntry_(row, map))
    .filter((entry) => entry.id))
    .slice(0, ACID_RANKING_LIMIT);
}

function rowToAcidRankingEntry_(row, map) {
  return publicAcidRankingEntry_({
    id: String(row[map.id] || ''),
    date: getRankingDateFromRow_(row, map),
    name: row[map.name] || '익명',
    score: row[map.score],
    level: row[map.level],
    survivalMs: row[map.survivalMs]
  });
}

function publicAcidRankingEntry_(entry) {
  return {
    id: String(entry.id || ''),
    date: normalizeRankingDate_(entry.date || entry.createdAt),
    name: sanitizePlayerName_(entry.name),
    score: normalizeRankingNumber_(entry.score, 0),
    level: normalizeRankingNumber_(entry.level, 1),
    survivalMs: normalizeRankingNumber_(entry.survivalMs, 0)
  };
}

function sortAcidRankingEntries_(entries) {
  return entries.slice().sort((a, b) => (
    Number(b.score || 0) - Number(a.score || 0)
    || Number(b.level || 0) - Number(a.level || 0)
    || Number(b.survivalMs || 0) - Number(a.survivalMs || 0)
    || getRankingDateValue_(a.date) - getRankingDateValue_(b.date)
  ));
}

function listHistoryCauseRankingEntries_() {
  const sheet = getHistoryCauseRankingSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const map = getHeaderMap_(sheet);
  return sortHistoryCauseRankingEntries_(values
    .slice(1)
    .map((row) => rowToHistoryCauseRankingEntry_(row, map))
    .filter((entry) => entry.id));
}

function getHistoryCauseRankingGroups_() {
  const entries = listHistoryCauseRankingEntries_();
  return {
    overall: entries.slice(0, HISTORY_CAUSE_RANKING_LIMIT),
    korean: entries.filter((entry) => entry.area === '한국사').slice(0, HISTORY_CAUSE_RANKING_LIMIT),
    world: entries.filter((entry) => entry.area === '세계사').slice(0, HISTORY_CAUSE_RANKING_LIMIT)
  };
}

function rowToHistoryCauseRankingEntry_(row, map) {
  return publicHistoryCauseRankingEntry_({
    id: String(row[map.id] || ''),
    date: getRankingDateFromRow_(row, map),
    nickname: row[map.nickname] || '익명',
    score: row[map.score],
    area: row[map.area] || '전체',
    correctCount: row[map.correctCount],
    answeredCount: row[map.answeredCount],
    maxCombo: row[map.maxCombo]
  });
}

function publicHistoryCauseRankingEntry_(entry) {
  return {
    id: String(entry.id || ''),
    date: normalizeRankingDate_(entry.date || entry.createdAt),
    nickname: sanitizePlayerName_(entry.nickname || entry.name),
    score: normalizeSignedRankingNumber_(entry.score, 0),
    area: normalizeHistoryCauseArea_(entry.area),
    correctCount: normalizeRankingNumber_(entry.correctCount, 0),
    answeredCount: normalizeRankingNumber_(entry.answeredCount, 0),
    maxCombo: normalizeRankingNumber_(entry.maxCombo, 0)
  };
}

function sortHistoryCauseRankingEntries_(entries) {
  return entries.slice().sort((a, b) => (
    Number(b.score || 0) - Number(a.score || 0)
    || Number(b.correctCount || 0) - Number(a.correctCount || 0)
    || Number(b.answeredCount || 0) - Number(a.answeredCount || 0)
    || Number(b.maxCombo || 0) - Number(a.maxCombo || 0)
    || getRankingDateValue_(a.date) - getRankingDateValue_(b.date)
  ));
}

function getRankingDateFromRow_(row, map) {
  const dateIndex = map[RANKING_DATE_HEADER] ?? map.createdAt ?? map.date;
  return dateIndex == null ? '' : row[dateIndex];
}

function normalizeRankingDate_(value) {
  const dateKey = normalizeCountDateValue_(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : '';
}

function getRankingDateValue_(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAcidGroup_(value) {
  const group = String(value || '').trim();
  if (group === 'social' || group === 'history') return group;
  throw new Error('산성비 랭킹 항목이 올바르지 않습니다.');
}

function sanitizePlayerName_(value) {
  const name = String(value || '').trim();
  return (name || '익명').slice(0, 12);
}

function normalizeHistoryCauseArea_(value) {
  const area = String(value || '').trim();
  if (area === '한국사' || area === '세계사' || area === '전체') return area;
  return '전체';
}

function normalizeRankingNumber_(value, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(fallback, Math.round(number));
}

function normalizeSignedRankingNumber_(value, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(number);
}

function rowToQuestion_(row, map, includePrivateFields) {
  const question = {
    id: String(row[map.id] || ''),
    createdAt: row[map.createdAt] || '',
    affiliation: row[map.affiliation] || '미기재',
    grade: row[map.grade] || '미기재',
    name: row[map.name] || '익명',
    text: row[map.text] || '',
    private: toBoolean_(row[map.private]),
    answer: row[map.answer] || '',
    answeredAt: row[map.answeredAt] || '',
    status: row[map.status] || 'active'
  };
  if (includePrivateFields) question.passwordHash = row[map.passwordHash] || '';
  return question;
}

function publicQuestion_(question) {
  const isPrivate = toBoolean_(question.private);
  return {
    id: question.id,
    createdAt: question.createdAt,
    affiliation: question.affiliation,
    grade: question.grade,
    name: question.name,
    text: isPrivate ? '' : question.text,
    private: isPrivate,
    answer: question.answer || '',
    answeredAt: question.answeredAt || ''
  };
}

function setCell_(sheet, rowIndex, map, header, value) {
  sheet.getRange(rowIndex, map[header] + 1).setValue(value);
}

function requireValue_(value, message) {
  if (value == null || String(value).trim() === '') throw new Error(message);
}

function requireTextLength_(value, maxLength, label) {
  if (value == null) return;
  if (String(value).length > maxLength) {
    throw new Error(`${label}은(는) ${maxLength}자 이내로 입력하세요.`);
  }
}

function normalizeDate(value) {
  const dateKey = normalizeCountDateValue_(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  return '';
}

function normalizeCountDateValue_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, COUNT_TIMEZONE, 'yyyy-MM-dd');
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Utilities.formatDate(date, COUNT_TIMEZONE, 'yyyy-MM-dd');
  }

  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const looseDateMatch = raw.match(/^(\d{4})\s*[./\-년]\s*(\d{1,2})\s*[./\-월]\s*(\d{1,2})/);
  if (looseDateMatch) {
    const year = looseDateMatch[1];
    const month = looseDateMatch[2].padStart(2, '0');
    const day = looseDateMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, COUNT_TIMEZONE, 'yyyy-MM-dd');
  }

  return raw;
}

function getTodayDateKey_() {
  return Utilities.formatDate(new Date(), COUNT_TIMEZONE, 'yyyy-MM-dd');
}

function requireAdmin_(adminPassword) {
  const savedPassword = PropertiesService.getScriptProperties().getProperty('QNA_ADMIN_PASSWORD');
  if (!savedPassword) {
    throw new Error('관리자 비밀번호 설정을 먼저 확인하세요.');
  }
  if (String(adminPassword || '') !== savedPassword) {
    throw new Error('관리자 비밀번호가 맞지 않습니다.');
  }
}

function passwordHash_(password) {
  const props = PropertiesService.getScriptProperties();
  const salt = props.getProperty('QNA_PASSWORD_SALT') || ScriptApp.getScriptId();
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    `${salt}:${password}`,
    Utilities.Charset.UTF_8
  );
  return bytes.map((byte) => {
    const value = byte < 0 ? byte + 256 : byte;
    return value.toString(16).padStart(2, '0');
  }).join('');
}

function toBoolean_(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value).toUpperCase() === 'TRUE';
}

function output_(payload, callback) {
  const json = JSON.stringify(payload);
  const isValidCallback = callback && /^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(callback);
  const output = isValidCallback ? `${callback}(${json});` : json;
  const mimeType = isValidCallback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON;
  return ContentService.createTextOutput(output).setMimeType(mimeType);
}
