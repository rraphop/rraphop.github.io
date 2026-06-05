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
const ACID_RANKING_HEADERS = [
  'id',
  'createdAt',
  'name',
  'score',
  'level',
  'survivalMs'
];
const ACID_RANKING_LIMIT = 10;
const HISTORY_CAUSE_RANKING_SHEET_NAME = '역사 추리왕 랭킹';
const HISTORY_CAUSE_RANKING_HEADERS = [
  'id',
  'createdAt',
  'nickname',
  'score',
  'area',
  'correctCount',
  'answeredCount',
  'maxCombo'
];
const HISTORY_CAUSE_RANKING_LIMIT = 10;

function doGet(e) {
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

function handleRequest_(e) {
  const params = getParams_(e);
  const action = params.action || 'list';

  try {
    let result;
    switch (action) {
      case 'list':
        result = listQuestions_();
        break;
      case 'create':
        result = createQuestion_(params);
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
      case 'count':
        result = getVisitorCount_(params);
        break;
      case 'acidRankings':
        result = listAcidRankings_();
        break;
      case 'acidRankingCreate':
        result = createAcidRanking_(params);
        break;
      case 'historyCauseRankings':
        result = listHistoryCauseRankings_();
        break;
      case 'historyCauseRankingCreate':
        result = createHistoryCauseRanking_(params);
        break;
      case 'setupSheets':
        result = setupSheets_();
        break;
      case 'initializeCounterSheets':
        result = initializeCounterSheets();
        break;
      case 'rebuildMonthlyCounts':
        result = rebuildMonthlyCounts();
        break;
      case 'cleanupOldDailyCounts':
        result = cleanupOldDailyCounts();
        break;
      case 'cleanupOldDailyRecords':
        result = cleanupOldDailyRecords();
        break;
      case 'cleanupOldRecords':
        result = cleanupOldRecords();
        break;
      case 'ping':
        result = setupSheets_();
        result.message = 'QNA data API is ready.';
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
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return { questions };
}

function createQuestion_(params) {
  requireValue_(params.text, '질문 내용을 입력하세요.');
  requireValue_(params.password, '수정 비밀번호를 입력하세요.');

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

function updateQuestion_(params) {
  requireValue_(params.id, '질문 ID가 없습니다.');
  requireValue_(params.password, '수정 비밀번호를 입력하세요.');
  requireValue_(params.text, '질문 내용을 입력하세요.');

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
  requireAdmin_(params.adminPassword);
  requireValue_(params.id, '질문 ID가 없습니다.');
  requireValue_(params.answer, '답변 내용을 입력하세요.');

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
  const currentMonth = getCurrentMonthKey_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getCounterSheet_();
    const total = readCounterTotal_(sheet);
    const todayInfo = readCounterToday_(sheet);
    const response = buildCounterResponse_(sheet, total, todayInfo, currentDate);
    logVisitorCounterDebug_('count', {
      currentDate,
      currentMonth,
      total,
      todayInfo,
      responseJson: response
    });
    return response;
  } finally {
    lock.releaseLock();
  }
}

function recordVisit() {
  return recordVisit_({});
}

function recordVisit_(params) {
  const currentDate = getTodayDateKey_();
  const currentMonth = getCurrentMonthKey_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getCounterSheet_();
    const beforeTotal = readCounterTotal_(sheet);
    incrementCounterVisit_(sheet, currentDate);
    const total = readCounterTotal_(sheet);
    const todayInfo = readCounterToday_(sheet);
    const response = buildCounterResponse_(sheet, total, todayInfo, currentDate);
    logVisitorCounterDebug_('visit', {
      currentDate,
      currentMonth,
      beforeTotal,
      afterTotal: total,
      todayInfo,
      responseJson: response
    });
    return response;
  } finally {
    lock.releaseLock();
  }
}

function getTotalCounter_() {
  const sheet = getCounterSheet_();
  return readCounterTotal_(sheet);
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

function buildCounterResponse_(sheet, total, todayInfo, currentDate) {
  return {
    success: true,
    total,
    today: todayInfo.today,
    date: currentDate,
    debug: {
      version: COUNTER_DEBUG_VERSION,
      source: 'apps-script',
      readTodayFrom: COUNTER_TODAY_COUNT_CELL,
      j1Value: todayInfo.j1Value,
      sheetName: sheet.getName()
    }
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

function saveDailyCount(date, count) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return saveDailyCount_(date, count);
  } finally {
    lock.releaseLock();
  }
}

function saveDailyCount_(date, count) {
  const dateKey = normalizeCounterDateKey_(date);
  const value = normalizeCounterNumber_(count, 0);
  if (!dateKey || value <= 0) {
    return { success: true, saved: false, date: dateKey, count: value, delta: 0 };
  }

  const sheet = getDailySheet_();
  const rowIndex = findTwoColumnRow_(sheet, dateKey);
  const previousCount = rowIndex
    ? normalizeCounterNumber_(sheet.getRange(rowIndex, 2).getValue(), 0)
    : 0;

  if (rowIndex) {
    sheet.getRange(rowIndex, 2).setValue(value);
  } else {
    sheet.appendRow([dateKey, value]);
  }

  return {
    success: true,
    saved: true,
    date: dateKey,
    count: value,
    previousCount,
    delta: value - previousCount
  };
}

function saveMonthlyCount(date, count) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return saveMonthlyCount_(date, count);
  } finally {
    lock.releaseLock();
  }
}

function saveMonthlyCount_(date, count, dailyResult) {
  const dateKey = normalizeCounterDateKey_(date);
  const value = normalizeCounterNumber_(count, 0);
  if (!dateKey || value <= 0) {
    return { success: true, saved: false, month: '', count: value, delta: 0 };
  }

  if (!dailyResult) return rebuildMonthlyCounts_();

  const monthKey = dateKey.slice(0, 7);
  const delta = Number(dailyResult.delta) || 0;
  if (delta === 0) {
    return { success: true, saved: false, month: monthKey, count: value, delta };
  }

  const sheet = getMonthlySheet_();
  const rowIndex = findTwoColumnRow_(sheet, monthKey);
  const previousCount = rowIndex
    ? normalizeCounterNumber_(sheet.getRange(rowIndex, 2).getValue(), 0)
    : 0;
  const nextCount = Math.max(0, previousCount + delta);

  if (rowIndex) {
    sheet.getRange(rowIndex, 2).setValue(nextCount);
  } else {
    sheet.appendRow([monthKey, nextCount]);
  }

  return {
    success: true,
    saved: true,
    month: monthKey,
    previousCount,
    count: nextCount,
    delta
  };
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

function logVisitorCounterDebug_(action, payload) {
  Logger.log(`VisitorCounter ${JSON.stringify(Object.assign({ action }, payload))}`);
}

function upsertDailyRecord_(date, count) {
  return saveDailyCount_(date, count);
}

function cleanupOldDailyRecords() {
  return cleanupOldDailyCounts();
}

function cleanupOldRecords() {
  return cleanupOldDailyCounts();
}

function cleanupOldDailyRecords_() {
  return cleanupOldDailyCounts_();
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

function findTwoColumnRow_(sheet, key) {
  const values = sheet.getDataRange().getValues();
  const shouldNormalizeDate = /^\d{4}-\d{2}-\d{2}$/.test(key);
  for (let i = 1; i < values.length; i += 1) {
    const rowKey = shouldNormalizeDate
      ? normalizeDate(values[i][0])
      : String(values[i][0] || '').trim();
    if (rowKey === key) return i + 1;
  }
  return null;
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

function createAcidRanking_(params) {
  const group = normalizeAcidGroup_(params.group);
  const now = new Date().toISOString();
  const entry = {
    id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    createdAt: now,
    name: sanitizePlayerName_(params.name),
    score: normalizeRankingNumber_(params.score, 0),
    level: normalizeRankingNumber_(params.level, 1),
    survivalMs: normalizeRankingNumber_(params.survivalMs, 0)
  };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getAcidRankingSheet_(group);
    sheet.appendRow(ACID_RANKING_HEADERS.map((header) => entry[header] ?? ''));
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
  const now = new Date().toISOString();
  const entry = {
    id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    createdAt: now,
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
    const sheet = getHistoryCauseRankingSheet_();
    sheet.appendRow(HISTORY_CAUSE_RANKING_HEADERS.map((header) => entry[header] ?? ''));
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
  ensureHeaders_(sheet, ACID_RANKING_HEADERS);
  return sheet;
}

function getHistoryCauseRankingSheet_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(HISTORY_CAUSE_RANKING_SHEET_NAME) || spreadsheet.insertSheet(HISTORY_CAUSE_RANKING_SHEET_NAME);
  ensureHeaders_(sheet, HISTORY_CAUSE_RANKING_HEADERS);
  removeHeaderColumn_(sheet, 'date');
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

function removeHeaderColumn_(sheet, headerName) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn <= 0) return;
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  for (let index = headers.length - 1; index >= 0; index -= 1) {
    if (String(headers[index] || '') === headerName) {
      sheet.deleteColumn(index + 1);
    }
  }
}

function ensureCounterHeaders_(sheet) {
  migrateLegacyCounterSheet_(sheet);
  sheet.getRange(1, 1, 1, COUNTER_HEADERS.length).setValues([COUNTER_HEADERS]);
  sheet.getRange(COUNTER_TODAY_CELL).setFormula(COUNTER_TODAY_FORMULA);
  sheet.getRange(COUNTER_TODAY_COUNT_CELL).setFormula(COUNTER_TODAY_COUNT_FORMULA);

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
    createdAt: row[map.createdAt] || '',
    name: row[map.name] || '익명',
    score: row[map.score],
    level: row[map.level],
    survivalMs: row[map.survivalMs]
  });
}

function publicAcidRankingEntry_(entry) {
  return {
    id: String(entry.id || ''),
    createdAt: entry.createdAt || '',
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
    || getRankingCreatedAtValue_(a.createdAt) - getRankingCreatedAtValue_(b.createdAt)
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
    createdAt: row[map.createdAt] || '',
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
    createdAt: entry.createdAt || '',
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
    || getRankingCreatedAtValue_(a.createdAt) - getRankingCreatedAtValue_(b.createdAt)
  ));
}

function getRankingCreatedAtValue_(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
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
  return {
    id: question.id,
    createdAt: question.createdAt,
    affiliation: question.affiliation,
    grade: question.grade,
    name: question.name,
    text: question.text,
    private: toBoolean_(question.private),
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

function normalizeDateKey_(value, fallback) {
  const dateKey = normalizeDate(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  return fallback || getTodayDateKey_();
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

function getCurrentMonthKey_() {
  return Utilities.formatDate(new Date(), COUNT_TIMEZONE, 'yyyy-MM');
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
