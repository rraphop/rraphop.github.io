const SHEET_NAME = 'QNA';
const COUNT_SHEET_NAME = 'count';
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
const COUNT_HEADERS = [
  'date',
  'today',
  'total',
  'updatedAt'
];
const COUNT_CACHE_KEY = 'visitorCountSummary';
const COUNT_CACHE_SECONDS = 300;

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  const params = getParams_(e);
  const action = params.action || 'list';

  try {
    let result;
    if (action === 'list') result = listQuestions_();
    else if (action === 'create') result = createQuestion_(params);
    else if (action === 'update') result = updateQuestion_(params);
    else if (action === 'answer') result = answerQuestion_(params);
    else if (action === 'delete') result = deleteQuestion_(params);
    else if (action === 'visit') result = recordVisit_(params);
    else if (action === 'count') result = getVisitorCount_(params);
    else if (action === 'ping') result = { message: 'QNA Apps Script is ready.' };
    else throw new Error('알 수 없는 요청입니다.');

    return output_({ ok: true, ...result }, params.callback);
  } catch (error) {
    return output_({ ok: false, message: error.message || '요청 처리 중 오류가 발생했습니다.' }, params.callback);
  }
}

function getParams_(e) {
  const params = { ...(e && e.parameter ? e.parameter : {}) };
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
    return { question: publicQuestion_({ ...question, text: params.text, private: toBoolean_(params.private) }) };
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
    return { question: publicQuestion_({ ...question, answer: params.answer, answeredAt }) };
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
  const dateKey = normalizeDateKey_(params.date);
  const cached = getCachedCount_(dateKey);
  if (cached) return cached;

  const sheet = getCountSheet_();
  const map = getHeaderMap_(sheet);
  const summary = getCountSummary_(sheet, map, dateKey);
  const result = {
    date: dateKey,
    today: summary.today,
    total: summary.total
  };
  cacheCount_(result);
  return result;
}

function recordVisit_(params) {
  const dateKey = normalizeDateKey_(params.date);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getCountSheet_();
    const map = getHeaderMap_(sheet);
    const found = findCountRow_(sheet, map, dateKey);
    const summary = getCountSummary_(sheet, map, dateKey);
    const updatedAt = new Date().toISOString();
    const today = summary.today + 1;
    const total = summary.total + 1;

    if (found) {
      setCell_(sheet, found.rowIndex, map, 'today', today);
      setCell_(sheet, found.rowIndex, map, 'total', total);
      setCell_(sheet, found.rowIndex, map, 'updatedAt', updatedAt);
    } else {
      const rowObject = { date: dateKey, today, total, updatedAt };
      sheet.appendRow(COUNT_HEADERS.map((header) => rowObject[header] ?? ''));
    }

    const result = { date: dateKey, today, total, updatedAt };
    cacheCount_(result);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty('QNA_SPREADSHEET_ID');
  const spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error('스프레드시트를 찾을 수 없습니다. QNA_SPREADSHEET_ID 스크립트 속성을 설정하세요.');
  }

  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  ensureHeaders_(sheet);
  return sheet;
}

function getCountSheet_() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty('QNA_SPREADSHEET_ID');
  const spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error('스프레드시트를 찾을 수 없습니다. QNA_SPREADSHEET_ID 스크립트 속성을 설정하세요.');
  }

  const sheet = spreadsheet.getSheetByName(COUNT_SHEET_NAME) || spreadsheet.insertSheet(COUNT_SHEET_NAME);
  ensureHeaders_(sheet, COUNT_HEADERS);
  return sheet;
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

function findCountRow_(sheet, map, dateKey) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return null;
  for (let i = 1; i < values.length; i += 1) {
    if (String(values[i][map.date] || '') === String(dateKey)) {
      return { rowIndex: i + 1, row: values[i], map };
    }
  }
  return null;
}

function getCountSummary_(sheet, map, dateKey) {
  const values = sheet.getDataRange().getValues();
  let today = 0;
  let total = 0;

  if (values.length <= 1) return { today, total };

  values.slice(1).forEach((row) => {
    const rowDate = String(row[map.date] || '');
    const rowToday = Number(row[map.today]) || 0;
    total += rowToday;
    if (rowDate === dateKey) today = rowToday;
  });

  return { today, total };
}

function getCachedCount_(dateKey) {
  try {
    const saved = CacheService.getScriptCache().get(COUNT_CACHE_KEY);
    if (!saved) return null;

    const parsed = JSON.parse(saved);
    const total = Number(parsed.total);
    if (!Number.isFinite(total)) return null;

    return {
      date: dateKey,
      today: String(parsed.date || '') === dateKey ? Number(parsed.today) || 0 : 0,
      total,
      updatedAt: parsed.updatedAt || ''
    };
  } catch (error) {
    return null;
  }
}

function cacheCount_(payload) {
  try {
    CacheService.getScriptCache().put(COUNT_CACHE_KEY, JSON.stringify({
      date: payload.date || '',
      today: Number(payload.today) || 0,
      total: Number(payload.total) || 0,
      updatedAt: payload.updatedAt || new Date().toISOString()
    }), COUNT_CACHE_SECONDS);
  } catch (error) {
    // 캐시 실패 시에도 시트 저장 결과는 그대로 반환합니다.
  }
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

function normalizeDateKey_(value) {
  const dateKey = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  const timezone = Session.getScriptTimeZone() || 'Asia/Seoul';
  return Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
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
