const SHEET_NAME = 'QNA';
const LEGACY_COUNT_SHEET_NAME = 'count';
const COUNTER_SHEET_NAME = 'Counter';
const DAILY_SHEET_NAME = 'Daily';
const MONTHLY_SHEET_NAME = 'Monthly';
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
const COUNTER_HEADERS = ['key', 'value'];
const COUNTER_KEYS = ['total', 'todayDate', 'todayCount'];
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

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function setupSheets() {
  return setupSheets_();
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
      case 'setupSheets':
        result = setupSheets_();
        break;
      case 'cleanupOldDailyRecords':
        result = cleanupOldDailyRecords();
        break;
      case 'cleanupOldRecords':
        result = cleanupOldRecords();
        break;
      case 'ping':
        result = setupSheets_();
        result.message = 'QNA Apps Script is ready.';
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
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const total = getTotalCounter_();
    const todayInfo = getTodayVisitCountInfo_(currentDate);
    syncCounterToday_(currentDate, todayInfo.today);
    logTodayVisitDebug_('count', currentDate, todayInfo, total);
    return {
      success: true,
      date: currentDate,
      today: todayInfo.today,
      total
    };
  } finally {
    lock.releaseLock();
  }
}

function recordVisit_(params) {
  const currentDate = getTodayDateKey_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const total = incrementTotalCounter_(currentDate);
    appendVisitLog_(currentDate, total);
    const todayInfo = getTodayVisitCountInfo_(currentDate);
    syncCounterToday_(currentDate, todayInfo.today);
    logTodayVisitDebug_('visit', currentDate, todayInfo, total);
    return {
      success: true,
      date: currentDate,
      today: todayInfo.today,
      total
    };
  } finally {
    lock.releaseLock();
  }
}

function getTotalCounter_() {
  initializeCounterFromLegacy_();
  const sheet = getCounterSheet_();
  return normalizeCounterNumber_(getCounterValue_(sheet, 'total'), 0);
}

function incrementTotalCounter_(currentDate) {
  initializeCounterFromLegacy_();
  const sheet = getCounterSheet_();
  const total = normalizeCounterNumber_(getCounterValue_(sheet, 'total'), 0) + 1;
  setCounterValue_(sheet, 'total', total);
  setCounterValue_(sheet, 'todayDate', currentDate);
  return total;
}

function syncCounterToday_(todayDate, today) {
  const sheet = getCounterSheet_();
  setCounterValue_(sheet, 'todayDate', todayDate);
  setCounterValue_(sheet, 'todayCount', normalizeCounterNumber_(today, 0));
}

function getTodayVisitCount(todayDate) {
  return getTodayVisitCountInfo_(todayDate || getTodayDateKey_()).today;
}

function getTodayVisitCountInfo_(todayDate) {
  const normalizedToday = normalizeDateKey_(todayDate, getTodayDateKey_());
  const logInfos = getVisitLogSheetInfos_();
  const sheetNames = [];
  let readRowCount = 0;
  let matchedRows = 0;
  let today = 0;

  logInfos.forEach((logInfo) => {
    const sheet = logInfo.sheet;
    const values = sheet.getDataRange().getValues();
    const dataRows = values.length > 1 ? values.slice(1) : [];
    sheetNames.push(sheet.getName());
    readRowCount += dataRows.length;

    dataRows.forEach((row) => {
      const rowDate = normalizeDate(row[logInfo.dateColumnIndex]);
      if (rowDate !== normalizedToday) return;

      matchedRows += 1;
      today += getVisitLogRowCount_(row, logInfo.countColumnIndex);
    });
  });

  return {
    today,
    todayDate: normalizedToday,
    readRowCount,
    matchedRows,
    sheetName: sheetNames.join(', ')
  };
}

function appendVisitLog_(dateKey, total) {
  const logInfo = getVisitLogSheetInfo_(dateKey);
  const sheet = logInfo.sheet;
  const columnCount = Math.max(sheet.getLastColumn(), logInfo.totalColumnIndex == null ? 0 : logInfo.totalColumnIndex + 1, 2);
  const row = Array(columnCount).fill('');

  row[logInfo.dateColumnIndex] = dateKey;
  if (logInfo.countColumnIndex != null) row[logInfo.countColumnIndex] = 1;
  if (logInfo.totalColumnIndex != null) row[logInfo.totalColumnIndex] = total;

  sheet.appendRow(row);
}

function getVisitLogSheetInfos_() {
  const spreadsheet = getSpreadsheet_();
  const infos = [];

  [LEGACY_COUNT_SHEET_NAME, DAILY_SHEET_NAME].forEach((sheetName) => {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) return;

    const info = getVisitLogSheetInfoFromSheet_(sheet);
    if (info.hasDateColumn) infos.push(info);
  });

  if (infos.length > 0) return infos;

  const dailySheet = getDailySheet_();
  return [getVisitLogSheetInfoFromSheet_(dailySheet)];
}

function getVisitLogSheetInfo_(targetDate) {
  const spreadsheet = getSpreadsheet_();
  const candidates = [LEGACY_COUNT_SHEET_NAME, DAILY_SHEET_NAME];
  let fallbackInfo = null;
  let populatedInfo = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const sheet = spreadsheet.getSheetByName(candidates[index]);
    if (!sheet) continue;

    const info = getVisitLogSheetInfoFromSheet_(sheet);
    if (!fallbackInfo) fallbackInfo = info;
    if (sheet.getLastRow() <= 1 || !info.hasDateColumn) continue;

    if (!populatedInfo) populatedInfo = info;
    if (targetDate && countMatchingVisitRows_(info, targetDate) > 0) return info;
  }

  if (populatedInfo) return populatedInfo;
  if (fallbackInfo) return fallbackInfo;

  const dailySheet = getDailySheet_();
  return getVisitLogSheetInfoFromSheet_(dailySheet);
}

function getVisitLogSheetInfoFromSheet_(sheet) {
  const headerMap = getVisitLogHeaderMap_(sheet);
  const values = sheet.getDataRange().getValues();
  const dateColumnIndex = headerMap.date != null
    ? headerMap.date
    : inferDateColumnIndex_(values);
  const countColumnIndex = headerMap.count;

  return {
    sheet,
    dateColumnIndex: dateColumnIndex == null ? 0 : dateColumnIndex,
    countColumnIndex,
    totalColumnIndex: headerMap.total,
    hasDateColumn: dateColumnIndex != null
  };
}

function getVisitLogHeaderMap_(sheet) {
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    return { date: 0, count: 1, total: null };
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map((header) => String(header || '').trim().toLowerCase());

  return {
    date: findHeaderIndex_(headers, ['date', 'todaydate', '날짜', '일자']),
    count: findHeaderIndex_(headers, ['count', 'today', 'todaycount', 'visits', '방문수', '방문자수']),
    total: findHeaderIndex_(headers, ['total', 'totalcount', '누적', '전체'])
  };
}

function findHeaderIndex_(headers, names) {
  for (let index = 0; index < headers.length; index += 1) {
    if (names.includes(headers[index])) return index;
  }
  return null;
}

function inferDateColumnIndex_(values) {
  if (values.length <= 1) return null;
  const maxColumn = values.reduce((max, row) => Math.max(max, row.length), 0);
  for (let columnIndex = 0; columnIndex < maxColumn; columnIndex += 1) {
    const found = values.slice(1, Math.min(values.length, 8)).some((row) => Boolean(normalizeDate(row[columnIndex])));
    if (found) return columnIndex;
  }
  return null;
}

function countMatchingVisitRows_(logInfo, targetDate) {
  const normalizedTargetDate = normalizeDateKey_(targetDate, getTodayDateKey_());
  const values = logInfo.sheet.getDataRange().getValues();
  return values.slice(1).reduce((count, row) => (
    normalizeDate(row[logInfo.dateColumnIndex]) === normalizedTargetDate ? count + 1 : count
  ), 0);
}

function getVisitLogRowCount_(row, countColumnIndex) {
  if (countColumnIndex == null) return 1;

  return normalizeCounterNumber_(row[countColumnIndex], 0);
}

function logTodayVisitDebug_(action, todayDate, todayInfo, total) {
  const payload = {
    action,
    todayDate,
    logSheetName: todayInfo.sheetName,
    readRowCount: todayInfo.readRowCount,
    matchedRows: todayInfo.matchedRows,
    summedToday: todayInfo.today,
    total,
    today: todayInfo.today
  };
  Logger.log(`VisitorCounter ${JSON.stringify(payload)}`);
}

function saveCounterState_(state) {
  const sheet = getCounterSheet_();
  setCounterValues_(sheet, {
    total: Math.max(0, Math.round(Number(state.total) || 0)),
    todayDate: normalizeDateKey_(state.todayDate, getTodayDateKey_()),
    todayCount: Math.max(0, Math.round(Number(state.todayCount) || 0))
  });
}

function initializeCounterFromLegacy_() {
  const counterSheet = getCounterSheet_();
  const values = getCounterValues_(counterSheet);
  if (values.total !== '' && values.todayDate !== '' && values.todayCount !== '') return;

  const dateKey = getTodayDateKey_();
  const legacySummary = getLegacyCountSummary_(dateKey);
  const initialState = {
    total: legacySummary.total,
    todayDate: dateKey,
    todayCount: legacySummary.today
  };

  saveCounterState_(initialState);
  Object.keys(legacySummary.daily).forEach((date) => {
    if (date !== dateKey) upsertDailyRecord_(date, legacySummary.daily[date]);
  });
}

function getLegacyCountSummary_(dateKey) {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(LEGACY_COUNT_SHEET_NAME);
  const summary = { total: 0, today: 0, daily: {} };
  if (!sheet || sheet.getLastRow() <= 1) return summary;

  const map = getHeaderMap_(sheet);
  if (map.date == null || map.today == null || map.total == null) return summary;

  const values = sheet.getDataRange().getValues().slice(1);
  let todayTotal = 0;
  let previousTotal = 0;
  values.forEach((row) => {
    const rowDate = normalizeDate(row[map.date]);
    const rowToday = normalizeCounterNumber_(row[map.today], 0);
    const rowTotal = normalizeCounterNumber_(row[map.total], 0);
    const rowStartTotal = map.startTotal == null ? null : Number(row[map.startTotal]);
    if (rowDate) {
      summary.daily[rowDate] = (summary.daily[rowDate] || 0) + rowToday;
      if (rowDate === dateKey) summary.today += rowToday;
      if (rowDate === dateKey) todayTotal = Math.max(todayTotal, rowTotal);
      if (rowDate < dateKey) previousTotal = Math.max(previousTotal, rowTotal);
      if (rowDate === dateKey && Number.isFinite(rowStartTotal)) {
        summary.today = Math.max(summary.today, rowTotal - rowStartTotal);
      }
    }
    summary.total = Math.max(summary.total, rowTotal);
  });

  if (todayTotal > previousTotal) {
    summary.today = Math.max(summary.today, todayTotal - previousTotal);
  }
  if (summary.total === 0) {
    summary.total = Object.values(summary.daily).reduce((sum, count) => sum + count, 0);
  }
  return summary;
}

function getCounterValues_(sheet) {
  return COUNTER_KEYS.reduce((values, key) => {
    values[key] = getCounterValue_(sheet, key);
    return values;
  }, {});
}

function setCounterValues_(sheet, values) {
  COUNTER_KEYS.forEach((key) => setCounterValue_(sheet, key, values[key]));
}

function getCounterValue_(sheet, key) {
  const rowIndexes = findCounterKeyRows_(sheet, key);
  if (rowIndexes.length === 0) return '';
  return sheet.getRange(rowIndexes[0], 2).getValue();
}

function setCounterValue_(sheet, key, value) {
  const rowIndexes = findCounterKeyRows_(sheet, key);
  if (rowIndexes.length === 0) {
    sheet.appendRow([key, value]);
    return;
  }

  sheet.getRange(rowIndexes[0], 1, 1, COUNTER_HEADERS.length).setValues([[key, value]]);
  rowIndexes
    .slice(1)
    .sort((a, b) => b - a)
    .forEach((rowIndex) => sheet.deleteRow(rowIndex));
}

function findCounterKeyRows_(sheet, key) {
  const values = sheet.getDataRange().getValues();
  const targetKey = String(key || '').trim();
  const rowIndexes = [];
  for (let index = 1; index < values.length; index += 1) {
    const rowKey = String(values[index][0] || '').trim();
    if (rowKey === targetKey) rowIndexes.push(index + 1);
  }
  return rowIndexes;
}

function upsertDailyRecord_(date, count) {
  const dateKey = normalizeDate(date);
  const value = normalizeCounterNumber_(count, 0);
  if (!dateKey || value <= 0) return;

  const sheet = getDailySheet_();
  const rowIndex = findTwoColumnRow_(sheet, dateKey);
  if (rowIndex) {
    sheet.getRange(rowIndex, 2).setValue(value);
  } else {
    sheet.appendRow([dateKey, value]);
  }
}

function addMonthlyRecord_(month, count) {
  const monthKey = String(month || '').trim();
  const value = normalizeCounterNumber_(count, 0);
  if (!/^\d{4}-\d{2}$/.test(monthKey) || value <= 0) return;

  const sheet = getMonthlySheet_();
  const rowIndex = findTwoColumnRow_(sheet, monthKey);
  if (rowIndex) {
    const current = normalizeCounterNumber_(sheet.getRange(rowIndex, 2).getValue(), 0);
    sheet.getRange(rowIndex, 2).setValue(current + value);
  } else {
    sheet.appendRow([monthKey, value]);
  }
}

function cleanupOldDailyRecords() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return cleanupOldDailyRecords_();
  } finally {
    lock.releaseLock();
  }
}

function cleanupOldRecords() {
  return cleanupOldDailyRecords();
}

function cleanupOldDailyRecords_() {
  const sheet = getDailySheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return { archived: 0 };

  const cutoffKey = getDateKeyDaysAgo_(DAILY_KEEP_DAYS);
  const monthlyCounts = {};
  const rowsToDelete = [];

  values.slice(1).forEach((row, index) => {
    const dateKey = normalizeDate(row[0]);
    if (!dateKey || dateKey >= cutoffKey) return;
    const count = normalizeCounterNumber_(row[1], 0);
    if (count > 0) {
      const monthKey = dateKey.slice(0, 7);
      monthlyCounts[monthKey] = (monthlyCounts[monthKey] || 0) + count;
    }
    rowsToDelete.push(index + 2);
  });

  Object.keys(monthlyCounts).forEach((month) => addMonthlyRecord_(month, monthlyCounts[month]));
  rowsToDelete.sort((a, b) => b - a).forEach((rowIndex) => sheet.deleteRow(rowIndex));
  return { archived: rowsToDelete.length };
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
  return {
    sheets: [
      qnaSheet.getName(),
      counterSheet.getName(),
      dailySheet.getName(),
      monthlySheet.getName(),
      socialRankingSheet.getName(),
      historyRankingSheet.getName()
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

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty('QNA_SPREADSHEET_ID');
  const spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error('스프레드시트를 찾을 수 없습니다. QNA_SPREADSHEET_ID 스크립트 속성을 설정하세요.');
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

function ensureCounterHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, COUNTER_HEADERS.length).setValues([COUNTER_HEADERS]);
    return;
  }

  sheet.getRange(1, 1, 1, COUNTER_HEADERS.length).setValues([COUNTER_HEADERS]);
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

function normalizeRankingNumber_(value, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(fallback, Math.round(number));
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

function requireAdmin_(adminPassword) {
  const savedPassword = PropertiesService.getScriptProperties().getProperty('QNA_ADMIN_PASSWORD');
  if (!savedPassword) {
    throw new Error('Apps Script 속성 QNA_ADMIN_PASSWORD를 먼저 설정하세요.');
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
