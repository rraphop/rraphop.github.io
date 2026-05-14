const currentPage = location.pathname.split("/").pop() || "index.html";

document.querySelectorAll(".site-nav a").forEach((link) => {
  if (link.getAttribute("href") === currentPage) {
    link.classList.add("active");
  }
});

const menuButton = document.querySelector(".menu-button");
const siteNav = document.querySelector(".site-nav");

if (menuButton && siteNav) {
  menuButton.addEventListener("click", () => {
    const isOpen = siteNav.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
  });
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function normalizeAnswer(value) {
  return String(value)
    .toLowerCase()
    .replace(/[()\[\]{}.,·ㆍ\s~!@#$%^&*_\-+=:;'"?\\/|<>]/g, "");
}

function shuffle(items) {
  return items
    .map((item) => ({ item, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ item }) => item);
}

const visitorCounter = document.querySelector("#visitorCounter");
const visitorSessionKey = "socialHistoryVisitorCountedDate";
const visitorCacheKey = "socialHistoryVisitorCountCacheV2";
const sheetApiUrl = window.QNA_CONFIG?.apiUrl
  || window.QNA_API_URL
  || "";
const sheetRequestTimeout = Number(window.QNA_CONFIG?.timeoutMs) || 15000;
const visitorCountBaseSize = 1.16;
const visitorCountMinSize = 0.62;

function getVisitorDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSheetsApiConfigured() {
  return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(sheetApiUrl);
}

function sheetsApiRequest(action, params = {}, options = {}) {
  return new Promise((resolve, reject) => {
    if (!isSheetsApiConfigured()) {
      reject(new Error(options.notConfiguredMessage || "Apps Script 웹앱 URL을 설정하세요."));
      return;
    }

    const callbackPrefix = options.callbackPrefix || "__sheetsCallback";
    const callbackName = `${callbackPrefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(options.timeoutMessage || "Google Sheets 응답 시간이 초과되었습니다."));
    }, sheetRequestTimeout);

    function cleanup() {
      window.clearTimeout(timeoutId);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (payload) => {
      cleanup();
      if (payload?.ok) {
        resolve(payload);
      } else {
        reject(new Error(payload?.message || options.defaultErrorMessage || "Google Sheets 요청을 처리하지 못했습니다."));
      }
    };

    const url = new URL(sheetApiUrl);
    url.searchParams.set("callback", callbackName);
    url.searchParams.set("action", action);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value == null ? "" : String(value));
    });

    script.async = true;
    script.onerror = () => {
      cleanup();
      reject(new Error(options.connectionErrorMessage || "Google Sheets에 연결하지 못했습니다."));
    };
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

function getCachedVisitorCounter(todayKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(visitorCacheKey) || "{}");
    const total = Number(saved.total);
    if (!Number.isFinite(total)) return null;
    return {
      date: String(saved.date || ""),
      today: String(saved.date || "") === todayKey ? Number(saved.today) || 0 : 0,
      total
    };
  } catch {
    return null;
  }
}

function saveCachedVisitorCounter(payload, fallbackDate) {
  try {
    localStorage.setItem(visitorCacheKey, JSON.stringify({
      date: payload.date || fallbackDate,
      today: Number(payload.today) || 0,
      total: Number(payload.total) || 0,
      updatedAt: new Date().toISOString()
    }));
  } catch {
    // 실제 방문자 수 저장은 Google Sheets에서 처리합니다.
  }
}

function visitorApiRequest(action, params = {}) {
  return sheetsApiRequest(action, params, {
    callbackPrefix: "__visitorCallback",
    notConfiguredMessage: "Apps Script 웹앱 URL을 설정하세요.",
    timeoutMessage: "방문자 카운터 응답 시간이 초과되었습니다.",
    defaultErrorMessage: "방문자 카운터 요청을 처리하지 못했습니다.",
    connectionErrorMessage: "방문자 카운터에 연결하지 못했습니다."
  });
}

function fitVisitorCountElement(element) {
  if (!element) return;

  const countRow = element.closest("dd");
  if (!countRow || countRow.clientWidth <= 0) return;

  let fontSize = visitorCountBaseSize;
  element.style.fontSize = `${fontSize}rem`;

  while (countRow.scrollWidth > countRow.clientWidth + 1 && fontSize > visitorCountMinSize) {
    fontSize = Math.max(visitorCountMinSize, fontSize - 0.06);
    element.style.fontSize = `${fontSize.toFixed(2)}rem`;
  }
}

function fitVisitorCounts() {
  if (!visitorCounter) return;
  visitorCounter
    .querySelectorAll("[data-visitor-today], [data-visitor-total]")
    .forEach(fitVisitorCountElement);
}

function renderVisitorCounter(todayCount, totalCount) {
  if (!visitorCounter) return;

  const todayElement = visitorCounter.querySelector("[data-visitor-today]");
  const totalElement = visitorCounter.querySelector("[data-visitor-total]");
  if (todayElement) todayElement.textContent = (Number(todayCount) || 0).toLocaleString("ko-KR");
  if (totalElement) totalElement.textContent = (Number(totalCount) || 0).toLocaleString("ko-KR");
  requestAnimationFrame(fitVisitorCounts);
}

function renderCachedVisitorCounter(todayKey) {
  const cached = getCachedVisitorCounter(todayKey);
  if (!cached) return false;

  renderVisitorCounter(cached.today, cached.total);
  return true;
}

async function updateVisitorCounter() {
  if (!visitorCounter) return;

  const todayKey = getVisitorDateKey();
  let shouldCountVisit = true;

  try {
    shouldCountVisit = sessionStorage.getItem(visitorSessionKey) !== todayKey;
  } catch {
    shouldCountVisit = true;
  }

  const renderedCache = renderCachedVisitorCounter(todayKey);

  try {
    const payload = await visitorApiRequest(shouldCountVisit ? "visit" : "count", { date: todayKey });
    if (shouldCountVisit) {
      try {
        sessionStorage.setItem(visitorSessionKey, todayKey);
      } catch {
        // 카운트 저장은 Google Sheets에서 처리하므로 세션 표시 실패는 무시합니다.
      }
    }
    saveCachedVisitorCounter(payload, todayKey);
    renderVisitorCounter(payload.today, payload.total);
  } catch (error) {
    console.warn(error);
    if (!renderedCache) requestAnimationFrame(fitVisitorCounts);
  }
}

updateVisitorCounter();
window.addEventListener("resize", fitVisitorCounts);

const subjectSelect = document.querySelector("#subjectSelect");
const unitSelect = document.querySelector("#unitSelect");
const startQuizButton = document.querySelector("#startQuiz");
const quizForm = document.querySelector("#quizForm");
const gradeQuiz = document.querySelector("#gradeQuiz");
const nextRound = document.querySelector("#nextRound");
const restartQuiz = document.querySelector("#restartQuiz");
const quizResult = document.querySelector("#quizResult");
const quizStatus = document.querySelector("#quizStatus");

let quizState = null;

function createTermQuestion(unit, termEntry, termIndex, variantIndex) {
  const [term, clue, sentence, aliases = []] = termEntry;
  const answers = [term, ...aliases];
  const base = {
    id: `${unit.id}-${termIndex}-${variantIndex}`,
    term,
    answers,
    explanation: `${term}: ${clue}`
  };

  const templates = [
    {
      type: "단답형",
      question: `${clue}에 해당하는 용어를 쓰시오.`
    },
    {
      type: "괄호 넣기",
      question: sentence.replace("____", "(        )")
    },
    {
      type: "단답형",
      question: `다음 설명에 알맞은 용어를 쓰시오. ${clue}`
    },
    {
      type: "괄호 넣기",
      question: `빈칸에 들어갈 핵심 용어를 쓰시오. ${sentence}`
    },
    {
      type: "단답형",
      question: `설명을 읽고 알맞은 개념을 쓰시오. ${clue}`
    },
    {
      type: "괄호 넣기",
      question: sentence.replace("____", "[          ]")
    },
    {
      type: "단답형",
      question: `다음 내용이 가리키는 말을 쓰시오. ${clue}`
    },
    {
      type: "괄호 넣기",
      question: `문장의 빈칸을 완성하시오. ${sentence.replace("____", "(          )")}`
    }
  ];

  return {
    ...base,
    ...templates[variantIndex % templates.length]
  };
}

function createQuestionPool(unit) {
  const maxQuestions = 30;
  if (!unit.terms.length) return [];

  const pool = [];
  let variantIndex = 0;

  while (pool.length < maxQuestions) {
    const questionRound = shuffle(unit.terms.map((termEntry, termIndex) => (
      createTermQuestion(unit, termEntry, termIndex, variantIndex)
    )));
    pool.push(...questionRound.slice(0, maxQuestions - pool.length));
    variantIndex += 1;
  }

  return pool;
}

function getAvailableQuizSubjects() {
  if (typeof QUIZ_BANK === "undefined") return [];
  const filter = subjectSelect?.dataset.subjectFilter || "all";
  if (filter === "social") {
    return QUIZ_BANK.filter((subject) => subject.id.startsWith("social"));
  }
  if (filter === "history") {
    return QUIZ_BANK.filter((subject) => subject.id.startsWith("history"));
  }
  return QUIZ_BANK;
}

function populateSubjects() {
  if (!subjectSelect || typeof QUIZ_BANK === "undefined") return;

  const subjects = getAvailableQuizSubjects();
  subjectSelect.innerHTML = subjects.map((subject) => (
    `<option value="${subject.id}">${subject.title}</option>`
  )).join("");
  populateUnits();
}

function populateUnits() {
  const subject = getAvailableQuizSubjects().find((item) => item.id === subjectSelect.value);
  if (!subject) return;

  unitSelect.innerHTML = subject.units.map((unit) => (
    `<option value="${unit.id}">${unit.title}</option>`
  )).join("");

  clearCurrentQuiz(`${subject.title}의 단원을 선택한 뒤 시작하세요.`);
}

function getSelectedUnit() {
  const subject = getAvailableQuizSubjects().find((item) => item.id === subjectSelect.value);
  const unit = subject.units.find((item) => item.id === unitSelect.value);
  return { subject, unit };
}

function updateQuizStatus() {
  if (!quizState) return;
  const remaining = quizState.maxQuestions - quizState.totalAnswered;
  quizStatus.innerHTML = `
    <strong>${quizState.subject.title}</strong>
    <span>${quizState.unit.title}</span>
    <span>누적 ${quizState.totalAnswered}/${quizState.maxQuestions}문항</span>
    <span>현재 점수 ${quizState.totalCorrect}/${quizState.totalAnswered || 0}</span>
    <span>남은 문항 ${remaining}</span>
  `;
}

function clearCurrentQuiz(message) {
  if (!quizForm) return;
  quizForm.innerHTML = "";
  quizResult.classList.remove("show");
  quizResult.textContent = "";
  gradeQuiz.disabled = true;
  nextRound.disabled = true;
  restartQuiz.disabled = true;
  quizStatus.innerHTML = `<span>${message}</span>`;
}

function startQuiz() {
  const { subject, unit } = getSelectedUnit();
  const pool = createQuestionPool(unit);

  quizState = {
    subject,
    unit,
    pool,
    usedIds: new Set(),
    currentQuestions: [],
    totalAnswered: 0,
    totalCorrect: 0,
    round: 0,
    maxQuestions: 30
  };

  restartQuiz.disabled = false;
  renderNextRound();
}

function renderNextRound() {
  if (!quizState) return;

  const remainingCount = quizState.maxQuestions - quizState.totalAnswered;
  if (remainingCount <= 0) {
    showFinalResult();
    return;
  }

  const available = quizState.pool.filter((item) => !quizState.usedIds.has(item.id));
  const roundSize = Math.min(5, remainingCount, available.length);
  quizState.currentQuestions = available.slice(0, roundSize);
  quizState.currentQuestions.forEach((item) => quizState.usedIds.add(item.id));
  quizState.round += 1;

  quizForm.innerHTML = quizState.currentQuestions.map((item, index) => `
    <article class="question-card short-answer-card">
      <div class="question-meta">
        <span>${quizState.round}회차</span>
        <span>${item.type}</span>
      </div>
      <label for="answer-${index}">
        <strong>${quizState.totalAnswered + index + 1}. ${escapeHTML(item.question)}</strong>
      </label>
      <input id="answer-${index}" name="answer-${index}" type="text" autocomplete="off" placeholder="정답 입력">
    </article>
  `).join("");

  quizResult.classList.remove("show");
  quizResult.textContent = "";
  gradeQuiz.disabled = false;
  nextRound.disabled = true;
  restartQuiz.disabled = false;
  updateQuizStatus();
}

function isCorrectAnswer(userAnswer, answers) {
  const normalizedUserAnswer = normalizeAnswer(userAnswer);
  return answers.some((answer) => normalizeAnswer(answer) === normalizedUserAnswer);
}

function gradeCurrentRound(event) {
  event.preventDefault();
  if (!quizState || quizState.currentQuestions.length === 0) return;

  let roundCorrect = 0;
  const rows = quizState.currentQuestions.map((item, index) => {
    const input = quizForm.elements[`answer-${index}`];
    const userAnswer = input.value.trim();
    const correct = isCorrectAnswer(userAnswer, item.answers);
    if (correct) roundCorrect += 1;
    input.disabled = true;

    return `
      <li class="${correct ? "correct" : "wrong"}">
        <strong>${index + 1}번 ${correct ? "정답" : "오답"}</strong>
        <span>입력: ${escapeHTML(userAnswer || "미입력")}</span>
        <span>정답: ${escapeHTML(item.answers.join(" / "))}</span>
        <small>${escapeHTML(item.explanation)}</small>
      </li>
    `;
  });

  quizState.totalCorrect += roundCorrect;
  quizState.totalAnswered += quizState.currentQuestions.length;

  const finished = quizState.totalAnswered >= quizState.maxQuestions;
  quizResult.classList.add("show");
  quizResult.innerHTML = `
    <p>${quizState.round}회차 결과: ${quizState.currentQuestions.length}문항 중 ${roundCorrect}문항 정답입니다.</p>
    <p>누적 결과: ${quizState.totalAnswered}문항 중 ${quizState.totalCorrect}문항 정답</p>
    <ul class="answer-review">${rows.join("")}</ul>
    ${finished ? "<p>이 단원의 최대 30문항 풀이가 끝났습니다. 처음부터 다시 시작할 수 있습니다.</p>" : ""}
  `;

  gradeQuiz.disabled = true;
  nextRound.disabled = finished;
  restartQuiz.disabled = false;
  updateQuizStatus();
}

function showFinalResult() {
  quizResult.classList.add("show");
  quizResult.innerHTML = `
    <p>최종 결과: ${quizState.totalAnswered}문항 중 ${quizState.totalCorrect}문항 정답입니다.</p>
    <p>같은 단원을 다시 풀려면 처음부터를 누르세요.</p>
  `;
  gradeQuiz.disabled = true;
  nextRound.disabled = true;
  restartQuiz.disabled = false;
  updateQuizStatus();
}

if (subjectSelect && unitSelect && startQuizButton && quizForm) {
  populateSubjects();
  subjectSelect.addEventListener("change", populateUnits);
  unitSelect.addEventListener("change", () => {
    const { subject, unit } = getSelectedUnit();
    clearCurrentQuiz(`${subject.title} - ${unit.title} 선택됨. 퀴즈 시작을 누르세요.`);
  });
  startQuizButton.addEventListener("click", startQuiz);
  quizForm.addEventListener("submit", gradeCurrentRound);
  nextRound.addEventListener("click", renderNextRound);
  restartQuiz.addEventListener("click", startQuiz);
}

const timelineEventBank = [
  { title: "농경과 목축 시작", year: "기원전 8000년경", order: -8000, unit: "역사1 II" },
  { title: "메소포타미아 문명 발생", year: "기원전 3500년경", order: -3500, unit: "역사1 II" },
  { title: "이집트 문명 발생", year: "기원전 3000년경", order: -3000, unit: "역사1 II" },
  { title: "고조선 건국", year: "기원전 2333년경", order: -2333, unit: "역사2 I" },
  { title: "함무라비 법전 편찬", year: "기원전 18세기경", order: -1750, unit: "역사1 II" },
  { title: "춘추 전국 시대 시작", year: "기원전 770년", order: -770, unit: "역사1 II" },
  { title: "페르시아 제국 형성", year: "기원전 6세기", order: -550, unit: "역사1 II" },
  { title: "마라톤 전투", year: "기원전 490년", order: -490, unit: "역사1 II" },
  { title: "알렉산드로스의 동방 원정 시작", year: "기원전 334년", order: -334, unit: "역사1 II" },
  { title: "진의 중국 통일", year: "기원전 221년", order: -221, unit: "역사1 II" },
  { title: "한 건국", year: "기원전 202년", order: -202, unit: "역사1 II" },
  { title: "로마 제국 성립", year: "기원전 27년", order: -27, unit: "역사1 II" },
  { title: "크리스트교 공인", year: "313년", order: 313, unit: "역사1 III" },
  { title: "고구려의 불교 수용", year: "372년", order: 372, unit: "역사2 I" },
  { title: "서로마 제국 멸망", year: "476년", order: 476, unit: "역사1 III" },
  { title: "신라의 불교 공인", year: "527년", order: 527, unit: "역사2 I" },
  { title: "수의 중국 통일", year: "589년", order: 589, unit: "역사1 III" },
  { title: "무함마드의 메카 탈출", year: "622년", order: 622, unit: "역사1 III" },
  { title: "당 건국", year: "618년", order: 618, unit: "역사1 III" },
  { title: "신라의 삼국 통일", year: "676년", order: 676, unit: "역사2 II" },
  { title: "발해 건국", year: "698년", order: 698, unit: "역사2 II" },
  { title: "프랑크 왕국의 카롤루스 대제 즉위", year: "768년", order: 768, unit: "역사1 III" },
  { title: "후삼국 성립", year: "900년대 초", order: 900, unit: "역사2 III" },
  { title: "고려 건국", year: "918년", order: 918, unit: "역사2 III" },
  { title: "고려의 후삼국 통일", year: "936년", order: 936, unit: "역사2 III" },
  { title: "고려 과거제 실시", year: "958년", order: 958, unit: "역사2 III" },
  { title: "십자군 전쟁 시작", year: "1096년", order: 1096, unit: "역사1 III" },
  { title: "고려 무신 정변", year: "1170년", order: 1170, unit: "역사2 III" },
  { title: "몽골 제국 성립", year: "1206년", order: 1206, unit: "역사1 IV" },
  { title: "몽골의 고려 침입 시작", year: "1231년", order: 1231, unit: "역사2 III" },
  { title: "원의 중국 통일", year: "1279년", order: 1279, unit: "역사1 IV" },
  { title: "오스만 제국 건국", year: "1299년", order: 1299, unit: "역사1 IV" },
  { title: "명 건국", year: "1368년", order: 1368, unit: "역사1 IV" },
  { title: "조선 건국", year: "1392년", order: 1392, unit: "역사2 IV" },
  { title: "훈민정음 창제", year: "1443년", order: 1443, unit: "역사2 IV" },
  { title: "훈민정음 반포", year: "1446년", order: 1446, unit: "역사2 IV" },
  { title: "비잔티움 제국 멸망", year: "1453년", order: 1453, unit: "역사1 IV" },
  { title: "콜럼버스의 아메리카 도착", year: "1492년", order: 1492, unit: "역사1 IV" },
  { title: "루터의 종교 개혁 시작", year: "1517년", order: 1517, unit: "역사1 IV" },
  { title: "임진왜란 발발", year: "1592년", order: 1592, unit: "역사2 IV" },
  { title: "후금 건국", year: "1616년", order: 1616, unit: "역사1 IV" },
  { title: "병자호란 발발", year: "1636년", order: 1636, unit: "역사2 IV" },
  { title: "영국 명예혁명", year: "1688년", order: 1688, unit: "역사1 V" },
  { title: "미국 독립 선언", year: "1776년", order: 1776, unit: "역사1 V" },
  { title: "프랑스 혁명 발발", year: "1789년", order: 1789, unit: "역사1 V" },
  { title: "나폴레옹 황제 즉위", year: "1804년", order: 1804, unit: "역사1 V" },
  { title: "홍경래의 난", year: "1811년", order: 1811, unit: "역사2 V" },
  { title: "아편 전쟁 발발", year: "1840년", order: 1840, unit: "역사1 V" },
  { title: "인도 세포이 항쟁", year: "1857년", order: 1857, unit: "역사1 V" },
  { title: "미국 남북 전쟁 발발", year: "1861년", order: 1861, unit: "역사1 V" },
  { title: "메이지 유신", year: "1868년", order: 1868, unit: "역사1 V" },
  { title: "독일 제국 성립", year: "1871년", order: 1871, unit: "역사1 V" },
  { title: "강화도 조약 체결", year: "1876년", order: 1876, unit: "역사2 VI" },
  { title: "갑신정변", year: "1884년", order: 1884, unit: "역사2 VI" },
  { title: "동학 농민 운동", year: "1894년", order: 1894, unit: "역사2 VI" },
  { title: "청일 전쟁 발발", year: "1894년", order: 1894.1, unit: "역사1 V" },
  { title: "대한 제국 선포", year: "1897년", order: 1897, unit: "역사2 VI" },
  { title: "러일 전쟁 발발", year: "1904년", order: 1904, unit: "역사1 V" },
  { title: "을사늑약 체결", year: "1905년", order: 1905, unit: "역사2 VI" },
  { title: "국권 피탈", year: "1910년", order: 1910, unit: "역사2 VI" },
  { title: "제1차 세계 대전 발발", year: "1914년", order: 1914, unit: "역사1 VI" },
  { title: "러시아 혁명", year: "1917년", order: 1917, unit: "역사1 VI" },
  { title: "3·1 운동", year: "1919년", order: 1919, unit: "역사2 VI" },
  { title: "대한민국 임시 정부 수립", year: "1919년", order: 1919.1, unit: "역사2 VI" },
  { title: "대공황 시작", year: "1929년", order: 1929, unit: "역사1 VI" },
  { title: "만주 사변", year: "1931년", order: 1931, unit: "역사1 VI" },
  { title: "제2차 세계 대전 발발", year: "1939년", order: 1939, unit: "역사1 VI" },
  { title: "광복", year: "1945년", order: 1945, unit: "역사2 VI" },
  { title: "국제 연합 창설", year: "1945년", order: 1945.1, unit: "역사1 VI" },
  { title: "대한민국 정부 수립", year: "1948년", order: 1948, unit: "역사2 VI" },
  { title: "6·25 전쟁 발발", year: "1950년", order: 1950, unit: "역사2 VI" },
  { title: "4·19 혁명", year: "1960년", order: 1960, unit: "역사2 VI" },
  { title: "베를린 장벽 건설", year: "1961년", order: 1961, unit: "역사1 VII" },
  { title: "5·18 민주화 운동", year: "1980년", order: 1980, unit: "역사2 VI" },
  { title: "6월 민주 항쟁", year: "1987년", order: 1987, unit: "역사2 VI" },
  { title: "베를린 장벽 붕괴", year: "1989년", order: 1989, unit: "역사1 VII" },
  { title: "소련 해체", year: "1991년", order: 1991, unit: "역사1 VII" },
  { title: "남북 정상 회담", year: "2000년", order: 2000, unit: "역사2 VI" }
];

const timelineRoundSize = 10;
let timelineTarget = [];
let timelineOrder = [];
let timelineInitialized = false;
const timelineList = document.querySelector("#timelineList");
const timelineResultModal = document.querySelector("#timelineResultModal");
const timelineResultTitle = document.querySelector("#timelineResultTitle");
const timelineResultSummary = document.querySelector("#timelineResultSummary");
const timelineResultAnswer = document.querySelector("#timelineResultAnswer");
const restartTimelineResult = document.querySelector("#restartTimelineResult");
const timelineStatus = document.querySelector("#timelineStatus");
const timelineBankList = document.querySelector("#timelineBankList");
const timelineModeButtons = document.querySelectorAll("[data-timeline-mode]");
const gameChoices = document.querySelectorAll("[data-game-choice]");
const gamePanels = document.querySelectorAll("[data-game-panel]");
let timelineMode = "korean";

function showGamePanel(gameName, updateHash = false) {
  gameChoices.forEach((button) => {
    button.classList.toggle("active", button.dataset.gameChoice === gameName);
  });
  gamePanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.gamePanel === gameName);
  });
  if (gameName === "timeline") ensureTimelineRound();
  if (updateHash) {
    const panel = document.querySelector(`[data-game-panel="${gameName}"]`);
    if (panel?.id) history.replaceState(null, "", `#${panel.id}`);
  }
}

if (gameChoices.length > 0) {
  gameChoices.forEach((button) => {
    button.addEventListener("click", () => showGamePanel(button.dataset.gameChoice, true));
  });

  const hashTarget = location.hash ? decodeURIComponent(location.hash.slice(1)) : "";
  const panelAliases = {
    socialAcidRainGame: "acid",
    historyAcidRainGame: "acid",
    "social-acid": "acid",
    "history-acid": "acid"
  };
  const requestedPanel = hashTarget
    ? document.getElementById(hashTarget)
    : null;
  if (requestedPanel?.dataset.gamePanel) {
    showGamePanel(requestedPanel.dataset.gamePanel);
  } else if (panelAliases[hashTarget]) {
    showGamePanel(panelAliases[hashTarget]);
  }
}

function renderTimeline() {
  if (!timelineList) return;
  timelineList.innerHTML = timelineOrder.map((item, index) => `
    <li class="timeline-card" data-index="${index}">
      <button class="timeline-title" type="button">${item.title}</button>
      <span class="move-buttons">
        <button type="button" data-move="up" aria-label="${item.title} 위로 이동">↑</button>
        <button type="button" data-move="down" aria-label="${item.title} 아래로 이동">↓</button>
      </span>
    </li>
  `).join("");
}

function renderTimelineStatus() {
  if (!timelineStatus) return;
  const events = getTimelineEvents();
  const modeLabel = timelineMode === "korean" ? "한국사" : "세계사";
  timelineStatus.innerHTML = `
    <span>${modeLabel}</span>
    <span>사건 은행 ${events.length}개</span>
    <span>이번 문제 ${timelineRoundSize}개</span>
    <span>오래된 사건 → 최근 사건 순서</span>
  `;
}

function getTimelineEvents() {
  const unitPrefix = timelineMode === "korean" ? "역사2" : "역사1";
  return timelineEventBank.filter((event) => event.unit.startsWith(unitPrefix));
}

function renderTimelineBank() {
  if (!timelineBankList) return;
  const sortedEvents = getTimelineEvents().sort((a, b) => a.order - b.order);
  timelineBankList.innerHTML = sortedEvents.map((event) => (
    `<span>${event.year} · ${event.title}</span>`
  )).join("");
}

function drawTimelineRound() {
  const events = getTimelineEvents();
  timelineTarget = shuffle(events).slice(0, timelineRoundSize);
  timelineOrder = shuffle(timelineTarget);
  timelineInitialized = true;
  closeTimelineResult();
  renderTimelineStatus();
  renderTimelineBank();
  renderTimeline();
}

function ensureTimelineRound() {
  if (!timelineList) return;
  if (!timelineInitialized || timelineList.children.length === 0) {
    drawTimelineRound();
  }
}

function correctTimelineMarkup() {
  return [...timelineTarget]
    .sort((a, b) => a.order - b.order)
    .map((event) => `<li>${escapeHTML(event.year)} - ${escapeHTML(event.title)}</li>`)
    .join("");
}

function closeTimelineResult() {
  if (!timelineResultModal) return;
  timelineResultModal.hidden = true;
  timelineResultModal.classList.remove("pass", "fail");
}

function showTimelineResult(isCorrect) {
  if (!timelineResultModal || !timelineResultTitle || !timelineResultSummary || !timelineResultAnswer) return;

  timelineResultModal.hidden = false;
  timelineResultModal.classList.toggle("pass", isCorrect);
  timelineResultModal.classList.toggle("fail", !isCorrect);
  timelineResultTitle.textContent = isCorrect ? "합격입니다" : "불합격입니다";
  timelineResultSummary.textContent = isCorrect
    ? "10개 사건의 시간 순서를 모두 맞혔습니다."
    : "사건이 일어난 시기를 다시 확인하세요.";
  timelineResultAnswer.innerHTML = correctTimelineMarkup();
  requestAnimationFrame(() => {
    timelineResultModal.querySelector(".timeline-result-panel")?.focus();
  });
}

function moveTimelineItem(index, direction) {
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= timelineOrder.length) return;
  [timelineOrder[index], timelineOrder[nextIndex]] = [timelineOrder[nextIndex], timelineOrder[index]];
  renderTimeline();
}

if (timelineList) {
  ensureTimelineRound();
  window.addEventListener("pageshow", ensureTimelineRound);

  timelineModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      timelineMode = button.dataset.timelineMode;
      timelineModeButtons.forEach((item) => item.classList.toggle("active", item === button));
      drawTimelineRound();
    });
  });

  timelineList.addEventListener("click", (event) => {
    const card = event.target.closest(".timeline-card");
    if (!card) return;
    document.querySelectorAll(".timeline-card").forEach((item) => item.classList.remove("selected"));
    card.classList.add("selected");
    const move = event.target.dataset.move;
    if (move) moveTimelineItem(Number(card.dataset.index), move);
  });

  document.querySelector("#shuffleTimeline").addEventListener("click", () => {
    drawTimelineRound();
  });

  document.querySelector("#checkTimeline").addEventListener("click", () => {
    const isCorrect = timelineOrder.every((item, index, array) => index === 0 || array[index - 1].order <= item.order);
    showTimelineResult(isCorrect);
  });

  timelineResultModal?.addEventListener("click", (event) => {
    if (event.target.closest("#restartTimelineResult")) return;
    drawTimelineRound();
  });

  restartTimelineResult?.addEventListener("click", (event) => {
    event.stopPropagation();
    drawTimelineRound();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !timelineResultModal?.hidden) {
      drawTimelineRound();
    }
  });
}

const socialTerms = [
  "인권", "기본권", "평등권", "자유권", "사회권", "헌법", "국회", "대통령",
  "사법부", "민주주의", "주권", "정당", "여론", "시민 참여", "법", "계약",
  "희소성", "기회비용", "합리적 선택", "시장", "수요", "공급", "균형 가격",
  "국내 총생산", "물가", "실업", "환율", "무역", "국제기구", "세계화",
  "다국적 기업", "도시화", "환경 문제", "지속가능한 발전", "문화", "사회화"
];

const historyTerms = [
  "사료", "연표", "문명", "농경", "도시 국가", "왕권", "제국", "불교",
  "크리스트교", "이슬람교", "봉건제", "비잔티움 제국", "몽골 제국",
  "실크로드", "르네상스", "신항로 개척", "제국주의", "민족주의",
  "시민 혁명", "산업 혁명", "국민 국가", "제1차 세계 대전", "전체주의",
  "대공황", "제2차 세계 대전", "국제 연합", "냉전", "탈냉전", "고조선",
  "삼국", "통일 신라", "발해", "고려", "조선", "훈민정음", "실학",
  "동학 농민 운동", "3·1 운동", "대한민국 정부 수립"
];

function normalizedTerm(value) {
  return normalizeAnswer(value);
}

function uniqueTerms(terms) {
  const seen = new Set();
  return terms.filter((term) => {
    const key = normalizedTerm(term);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function termsFromQuizBank(subjectPrefix, fallbackTerms) {
  if (typeof QUIZ_BANK === "undefined") return fallbackTerms;
  const terms = QUIZ_BANK
    .filter((subject) => subject.id.startsWith(subjectPrefix))
    .flatMap((subject) => subject.units)
    .flatMap((unit) => unit.terms)
    .map(([term]) => term);
  return uniqueTerms(terms.length ? terms : fallbackTerms);
}

function getAcidTermBank(termGroup) {
  if (termGroup === "history") return termsFromQuizBank("history", historyTerms);
  return termsFromQuizBank("social", socialTerms);
}

function getAcidTermLabel(termGroup) {
  return termGroup === "history" ? "역사 용어" : "사회 용어";
}

function getAcidRankingTitle(termGroup) {
  return termGroup === "history" ? "역사 산성비 랭킹" : "사회 산성비 랭킹";
}

function formatAcidTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((milliseconds % 1000) / 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function createAcidState() {
  return {
    running: false,
    score: 0,
    lives: 5,
    level: 1,
    elapsedMs: 0,
    startedAt: 0,
    terms: [],
    nextDropAt: 0,
    lastFrameAt: 0,
    animationId: null,
    timerId: null,
    rankingSaved: false
  };
}

function initAcidRainGame(root) {
  const acidArena = root.querySelector("[data-acid-arena]");
  const acidReady = root.querySelector("[data-acid-ready]");
  const acidForm = root.querySelector("[data-acid-form]");
  const acidAnswer = root.querySelector("[data-acid-answer]");
  const acidSubmit = root.querySelector("[data-acid-submit]");
  const acidStatus = root.querySelector(".acid-status");
  const acidScore = root.querySelector("[data-acid-score]");
  const acidLives = root.querySelector("[data-acid-lives]");
  const acidLevel = root.querySelector("[data-acid-level]");
  const acidTime = root.querySelector("[data-acid-time]");
  const acidResult = root.querySelector("[data-acid-result]");
  const acidResultSummary = root.querySelector("[data-acid-result-summary]");
  const acidRankForm = root.querySelector("[data-acid-rank-form]");
  const acidRankName = root.querySelector("[data-acid-rank-name]");
  const acidRankSubmit = root.querySelector("[data-acid-rank-submit]");
  const acidRankMessage = root.querySelector("[data-acid-rank-message]");
  const acidRankings = root.querySelector("[data-acid-rankings]");
  const startAcidRain = root.querySelector("[data-acid-start]");
  const resetAcidRain = root.querySelector("[data-acid-reset]");
  const acidTitle = root.querySelector("[data-acid-title]");
  const acidModeStatus = root.querySelector("[data-acid-mode-status]");
  const acidModeButtons = root.querySelectorAll("[data-acid-mode]");
  const rankingStorageKey = "socialHistoryAcidRainRankings";
  const emptyRankings = { social: [], history: [] };
  const hashTarget = location.hash ? decodeURIComponent(location.hash.slice(1)) : "";
  let currentTermGroup = hashTarget.toLowerCase().includes("history")
    ? "history"
    : root.dataset.acidTerms || "social";
  let termBank = getAcidTermBank(currentTermGroup);
  let acidState = createAcidState();
  let acidRankingsState = getStoredRankings();
  let acidRankingStatus = "";
  let acidRankingLoadId = 0;
  const touchStartQuery = window.matchMedia?.("(hover: none), (pointer: coarse)");
  const mobileLayoutQuery = window.matchMedia?.("(max-width: 820px)");

  function isAcidMobileLayout() {
    const userAgent = navigator.userAgent || "";
    const isPhoneOrAndroid = /Mobi|Android|iPhone|iPod/i.test(userAgent);
    const isIPad = /iPad/i.test(userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1 && "ontouchend" in document);
    return Boolean(
      mobileLayoutQuery?.matches
      || window.innerWidth <= 820
      || isPhoneOrAndroid
      || isIPad
    );
  }

  function isAcidTouchStartDevice() {
    return isAcidMobileLayout();
  }

  function getReadyMessage() {
    const startAction = isAcidTouchStartDevice() ? "터치하면" : "스페이스바를 누르면";
    return `${startAction} ${getAcidTermLabel(currentTermGroup)}가 떨어집니다.`;
  }

  function refreshReadyMessageForInputMode() {
    if (!acidState.running && !acidReady.hidden) {
      acidReady.textContent = getReadyMessage();
    }
  }

  function syncAcidMobileLayout() {
    root.classList.toggle("acid-mobile-layout", isAcidMobileLayout());
    refreshReadyMessageForInputMode();
    updateAcidViewportMetrics();
  }

  function updateAcidViewportMetrics() {
    // visualViewport API를 우선 사용: 키보드가 올라왔을 때 실제 보이는 영역 높이를 반영
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const viewportTop = window.visualViewport?.offsetTop || 0;
    const inputHeight = Math.ceil(acidForm?.offsetHeight || 68);
    const statusHeight = Math.ceil(acidStatus?.offsetHeight || 38);
    const inputTop = Math.max(viewportTop + statusHeight, viewportTop + viewportHeight - inputHeight);
    const arenaHeight = Math.max(80, inputTop - viewportTop - statusHeight);

    root.style.setProperty("--acid-visual-height", `${viewportHeight}px`);
    root.style.setProperty("--acid-visual-top", `${viewportTop}px`);
    root.style.setProperty("--acid-input-height", `${inputHeight}px`);
    root.style.setProperty("--acid-status-height", `${statusHeight}px`);
    root.style.setProperty("--acid-input-top", `${inputTop}px`);
    root.style.setProperty("--acid-arena-height", `${arenaHeight}px`);
    // 낙하 영역과 입력칸은 visualViewport 기준으로 키보드 위에 상대 배치

    if (!window.visualViewport) return;
    const viewportInset = Math.max(
      0,
      window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop
    );
    const keyboardInset = viewportInset > 80 ? viewportInset : 0;
    root.style.setProperty("--acid-keyboard-inset", `${keyboardInset}px`);
  }

  function syncAcidModeUI() {
    const termLabel = getAcidTermLabel(currentTermGroup);
    root.dataset.acidTerms = currentTermGroup;
    if (acidTitle) acidTitle.textContent = `${termLabel} 산성비 게임`;
    if (acidModeStatus) acidModeStatus.textContent = currentTermGroup === "history" ? "역사" : "사회";
    if (acidArena) acidArena.setAttribute("aria-label", `${termLabel} 산성비 게임장`);
    acidModeButtons.forEach((button) => {
      const isActive = button.dataset.acidMode === currentTermGroup;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  function getStoredRankings() {
    try {
      const saved = JSON.parse(localStorage.getItem(rankingStorageKey) || "{}");
      return normalizeAcidRankings(saved);
    } catch (error) {
      return { ...emptyRankings };
    }
  }

  function getAcidCreatedAtValue(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sortAcidRankings(entries) {
    return [...entries].sort((a, b) => (
      Number(b.score || 0) - Number(a.score || 0)
      || Number(b.level || 0) - Number(a.level || 0)
      || Number(b.survivalMs || 0) - Number(a.survivalMs || 0)
      || getAcidCreatedAtValue(a.createdAt) - getAcidCreatedAtValue(b.createdAt)
    ));
  }

  function normalizeAcidRankingEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    return {
      id: String(entry.id || ""),
      createdAt: entry.createdAt || "",
      name: getPlayerName(entry.name).slice(0, 12),
      score: Math.max(0, Math.round(Number(entry.score) || 0)),
      level: Math.max(1, Math.round(Number(entry.level) || 1)),
      survivalMs: Math.max(0, Math.round(Number(entry.survivalMs) || 0))
    };
  }

  function normalizeAcidRankingList(entries) {
    if (!Array.isArray(entries)) return [];
    return sortAcidRankings(entries
      .map(normalizeAcidRankingEntry)
      .filter(Boolean))
      .slice(0, 10);
  }

  function normalizeAcidRankings(rankings) {
    return {
      social: normalizeAcidRankingList(rankings?.social),
      history: normalizeAcidRankingList(rankings?.history)
    };
  }

  function saveStoredRankings(rankings) {
    try {
      localStorage.setItem(rankingStorageKey, JSON.stringify(normalizeAcidRankings(rankings)));
    } catch {
      // 기준 랭킹 저장은 Google Sheets에서 처리합니다.
    }
  }

  function getPlayerName(value) {
    const name = String(value || "").trim();
    return name || "익명";
  }

  function renderRankingTable(termGroup, entries) {
    const sortedEntries = sortAcidRankings(entries).slice(0, 10);
    const rows = sortedEntries.length > 0
      ? sortedEntries.map((entry, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHTML(entry.name || "익명")}</td>
            <td>${Number(entry.score || 0)}</td>
            <td>${Number(entry.level || 1)}</td>
            <td>${formatAcidTime(Number(entry.survivalMs || 0))}</td>
          </tr>
        `).join("")
      : '<tr><td colspan="5">아직 등록된 기록이 없습니다.</td></tr>';

    return `
      <section class="acid-ranking-board ${termGroup === currentTermGroup ? "active" : ""}">
        <h4>${getAcidRankingTitle(termGroup)}</h4>
        <table>
          <thead>
            <tr>
              <th>순위</th>
              <th>이름</th>
              <th>점수</th>
              <th>단계</th>
              <th>생존시간</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `;
  }

  function renderAcidRankings(statusMessage = acidRankingStatus) {
    if (!acidRankings) return;
    const rankings = normalizeAcidRankings(acidRankingsState);
    const statusMarkup = statusMessage
      ? `<p class="acid-ranking-status">${escapeHTML(statusMessage)}</p>`
      : "";
    acidRankings.innerHTML = `
      ${renderRankingTable("social", rankings.social)}
      ${renderRankingTable("history", rankings.history)}
      ${statusMarkup}
    `;
  }

  async function loadAcidRankings() {
    const requestId = acidRankingLoadId + 1;
    acidRankingLoadId = requestId;

    if (!isSheetsApiConfigured()) {
      acidRankingStatus = "Google Sheets 웹앱 URL을 설정하면 공유 랭킹이 표시됩니다.";
      renderAcidRankings();
      return;
    }

    acidRankingStatus = "Google Sheets 랭킹을 불러오는 중입니다.";
    renderAcidRankings();

    try {
      const payload = await sheetsApiRequest("acidRankings", {}, {
        callbackPrefix: "__acidRankingCallback",
        timeoutMessage: "산성비 랭킹 응답 시간이 초과되었습니다.",
        defaultErrorMessage: "산성비 랭킹 요청을 처리하지 못했습니다.",
        connectionErrorMessage: "산성비 랭킹에 연결하지 못했습니다."
      });
      if (requestId !== acidRankingLoadId) return;
      acidRankingsState = normalizeAcidRankings(payload.rankings);
      saveStoredRankings(acidRankingsState);
      acidRankingStatus = "";
    } catch (error) {
      if (requestId !== acidRankingLoadId) return;
      console.warn(error);
      acidRankingStatus = "Google Sheets 랭킹을 불러오지 못해 마지막 기록을 표시합니다.";
    }

    renderAcidRankings();
  }

  async function saveAcidRanking(name) {
    if (acidState.rankingSaved) return null;
    if (!isSheetsApiConfigured()) {
      throw new Error("Google Sheets 웹앱 URL을 설정하세요.");
    }

    const payload = await sheetsApiRequest("acidRankingCreate", {
      group: currentTermGroup,
      name: getPlayerName(name).slice(0, 12),
      score: acidState.score,
      level: acidState.level,
      survivalMs: Math.round(acidState.elapsedMs)
    }, {
      callbackPrefix: "__acidRankingCallback",
      timeoutMessage: "산성비 랭킹 등록 응답 시간이 초과되었습니다.",
      defaultErrorMessage: "산성비 랭킹을 등록하지 못했습니다.",
      connectionErrorMessage: "산성비 랭킹에 연결하지 못했습니다."
    });

    acidState.rankingSaved = true;
    acidRankingsState = normalizeAcidRankings(payload.rankings);
    saveStoredRankings(acidRankingsState);
    acidRankingStatus = "";
    return Number(payload.rank) || null;
  }

  function changeAcidMode(termGroup) {
    if (!["social", "history"].includes(termGroup) || termGroup === currentTermGroup) return;
    currentTermGroup = termGroup;
    termBank = getAcidTermBank(currentTermGroup);
    syncAcidModeUI();
    resetAcidGame();
    renderAcidRankings();
  }

  function updateAcidStatus() {
    acidScore.textContent = acidState.score;
    acidLives.textContent = acidState.lives;
    acidLevel.textContent = acidState.level;
    if (acidTime) acidTime.textContent = formatAcidTime(acidState.elapsedMs);
  }

  function updateAcidElapsedTime() {
    if (!acidState.running || !acidState.startedAt) return;
    acidState.elapsedMs = performance.now() - acidState.startedAt;
    updateAcidStatus();
  }

  function stopAcidTimers() {
    if (acidState.animationId) cancelAnimationFrame(acidState.animationId);
    if (acidState.timerId) clearInterval(acidState.timerId);
    acidState.animationId = null;
    acidState.timerId = null;
  }

  function resetAcidGame(message = getReadyMessage()) {
    stopAcidTimers();
    acidState = createAcidState();
    root.classList.remove("acid-game-running");
    root.classList.remove("acid-game-ended");
    acidArena.querySelectorAll(".acid-drop").forEach((item) => item.remove());
    acidReady.textContent = message;
    acidReady.hidden = false;
    acidAnswer.value = "";
    acidAnswer.blur();
    acidAnswer.disabled = true;
    acidSubmit.disabled = true;
    acidResult.classList.remove("show");
    if (acidResultSummary) acidResultSummary.textContent = "";
    if (acidRankName) {
      acidRankName.value = "";
      acidRankName.disabled = false;
    }
    if (acidRankSubmit) acidRankSubmit.disabled = false;
    if (acidRankMessage) acidRankMessage.textContent = "";
    if (acidRankForm) acidRankForm.hidden = true;
    updateAcidStatus();
  }

  function createAcidDrop() {
    const term = termBank[Math.floor(Math.random() * termBank.length)];
    const element = document.createElement("button");
    const left = 4 + Math.random() * 76;
    element.type = "button";
    element.className = "acid-drop";
    element.textContent = term;
    element.style.left = `${left}%`;
    element.style.top = "0px";
    acidArena.appendChild(element);
    acidState.terms.push({
      term,
      element,
      y: 0,
      speed: 32 + acidState.level * 10 + Math.random() * 18
    });
  }

  function endAcidGame() {
    const termLabel = getAcidTermLabel(currentTermGroup);
    acidState.running = false;
    root.classList.remove("acid-game-running");
    root.classList.add("acid-game-ended");
    if (acidState.startedAt) {
      acidState.elapsedMs = Math.max(acidState.elapsedMs, performance.now() - acidState.startedAt);
    }
    stopAcidTimers();
    acidAnswer.blur();
    acidAnswer.disabled = true;
    acidSubmit.disabled = true;
    updateAcidStatus();
    acidResult.classList.add("show");
    if (acidResultSummary) {
      acidResultSummary.innerHTML = `
      <p>게임 종료: ${acidState.score}점을 획득했습니다.</p>
      <p>단계 ${acidState.level}, 생존시간 ${formatAcidTime(acidState.elapsedMs)}</p>
      <p>${acidState.score >= 120 ? `${termLabel} 반응 속도가 좋습니다.` : "다시 시작해서 더 많은 용어를 막아 보세요."}</p>
      `;
    }
    if (acidRankName) {
      acidRankName.value = "";
      acidRankName.disabled = false;
    }
    if (acidRankSubmit) acidRankSubmit.disabled = false;
    if (acidRankMessage) acidRankMessage.textContent = "";
    if (acidRankForm) acidRankForm.hidden = false;
    updateAcidViewportMetrics();
    requestAnimationFrame(() => {
      if (acidRankName) {
        try {
          acidRankName.focus({ preventScroll: true });
        } catch {
          acidRankName.focus();
        }
      }
      updateAcidViewportMetrics();
    });
    setTimeout(updateAcidViewportMetrics, 350);
  }

  function updateAcidFrame(timestamp) {
    if (!acidState.running) return;

    if (!acidState.lastFrameAt) acidState.lastFrameAt = timestamp;
    const delta = Math.min((timestamp - acidState.lastFrameAt) / 1000, 0.05);
    acidState.lastFrameAt = timestamp;
    acidState.elapsedMs = performance.now() - acidState.startedAt;
    updateAcidStatus();

    if (timestamp >= acidState.nextDropAt) {
      createAcidDrop();
      acidState.nextDropAt = timestamp + Math.max(750, 1600 - acidState.level * 120);
    }

    const arenaHeight = acidArena.clientHeight;
    acidState.terms = acidState.terms.filter((item) => {
      item.y += item.speed * delta;
      item.element.style.top = `${item.y}px`;
      if (item.y > arenaHeight - 42) {
        item.element.remove();
        acidState.lives -= 1;
        updateAcidStatus();
        return false;
      }
      return true;
    });

    if (acidState.lives <= 0) {
      endAcidGame();
      return;
    }

    acidState.animationId = requestAnimationFrame(updateAcidFrame);
  }

  function startAcidGame() {
    if (acidState.running) return;
    if (termBank.length === 0) {
      resetAcidGame(`${getAcidTermLabel(currentTermGroup)} 은행을 불러오지 못했습니다.`);
      return;
    }
    resetAcidGame("");
    acidState.running = true;
    root.classList.add("acid-game-running");
    updateAcidViewportMetrics();
    acidState.startedAt = performance.now();
    acidReady.hidden = true;
    acidAnswer.disabled = false;
    acidSubmit.disabled = false;
    if (isAcidMobileLayout()) {
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      try {
        acidAnswer.focus({ preventScroll: true });
      } catch (error) {
        acidAnswer.focus();
      }
      // 키보드가 올라온 직후 visualViewport가 업데이트되도록 여러 번 메트릭 갱신
      requestAnimationFrame(() => {
        updateAcidViewportMetrics();
        window.scrollTo(scrollX, scrollY);
      });
      // 키보드 애니메이션 완료 후 추가 업데이트 (iOS/Android 키보드 애니메이션 시간 고려)
      setTimeout(() => {
        updateAcidViewportMetrics();
        window.scrollTo(scrollX, scrollY);
      }, 350);
    } else {
      acidAnswer.focus();
    }
    acidState.nextDropAt = acidState.startedAt;
    acidState.timerId = setInterval(updateAcidElapsedTime, 250);
    updateAcidElapsedTime();
    acidState.animationId = requestAnimationFrame(updateAcidFrame);
  }

  function handleAcidArenaPointerStart(event) {
    if (!isAcidTouchStartDevice() || acidState.running) return;
    if (root.classList.contains("acid-game-ended")) return;
    if (event.target.closest("[data-acid-rank-form]")) return;
    if (event.target.closest(".acid-drop")) return;
    startAcidGame();
  }

  function handleAcidAnswer(event) {
    event.preventDefault();
    if (!acidState.running) return;
    const answer = normalizedTerm(acidAnswer.value);
    if (!answer) return;

    const hitIndex = acidState.terms.findIndex((item) => normalizedTerm(item.term) === answer);
    if (hitIndex >= 0) {
      const [hit] = acidState.terms.splice(hitIndex, 1);
      hit.element.remove();
      acidState.score += 10;
      acidState.level = Math.min(9, Math.floor(acidState.score / 50) + 1);
      updateAcidStatus();
    }
    acidAnswer.value = "";
  }

  async function handleAcidRankSubmit(event) {
    event.preventDefault();
    if (acidRankName) acidRankName.disabled = true;
    if (acidRankSubmit) acidRankSubmit.disabled = true;
    if (acidRankMessage) acidRankMessage.textContent = "Google Sheets에 랭킹을 등록하는 중입니다.";

    try {
      const savedRank = await saveAcidRanking(acidRankName?.value);
      renderAcidRankings();
      const rankingMessage = savedRank
        ? `${getAcidRankingTitle(currentTermGroup)} ${savedRank}위에 등록되었습니다.`
        : "Google Sheets에 등록되었습니다. 현재 상위 10위에는 표시되지 않습니다.";
      if (acidRankMessage) acidRankMessage.textContent = rankingMessage;
    } catch (error) {
      console.warn(error);
      if (acidRankName) acidRankName.disabled = false;
      if (acidRankSubmit) acidRankSubmit.disabled = false;
      if (acidRankMessage) acidRankMessage.textContent = "랭킹 등록에 실패했습니다. 잠시 후 다시 시도하세요.";
    }
  }

  function handleAcidKeydown(event) {
    const activeElement = document.activeElement;
    const isTyping = activeElement?.matches("input, textarea, select");
    if (event.code !== "Space" || isTyping || !root.classList.contains("active")) return;
    event.preventDefault();
    startAcidGame();
  }

  if (acidArena && acidForm) {
    syncAcidModeUI();
    syncAcidMobileLayout();
    resetAcidGame();
    renderAcidRankings();
    loadAcidRankings();
    root.addEventListener("click", (event) => {
      const modeButton = event.target.closest("[data-acid-mode]");
      if (!modeButton || !root.contains(modeButton)) return;
      changeAcidMode(modeButton.dataset.acidMode);
    });
    startAcidRain.addEventListener("click", startAcidGame);
    resetAcidRain.addEventListener("click", () => resetAcidGame());
    acidForm.addEventListener("submit", handleAcidAnswer);
    acidRankForm?.addEventListener("submit", handleAcidRankSubmit);
    acidArena.addEventListener("pointerdown", handleAcidArenaPointerStart);
    document.addEventListener("keydown", handleAcidKeydown);
    touchStartQuery?.addEventListener?.("change", refreshReadyMessageForInputMode);
    touchStartQuery?.addListener?.(refreshReadyMessageForInputMode);
    mobileLayoutQuery?.addEventListener?.("change", syncAcidMobileLayout);
    mobileLayoutQuery?.addListener?.(syncAcidMobileLayout);
    window.addEventListener("resize", syncAcidMobileLayout);
    window.visualViewport?.addEventListener("resize", updateAcidViewportMetrics);
    window.visualViewport?.addEventListener("scroll", updateAcidViewportMetrics);
    updateAcidViewportMetrics();
  }
}

document.querySelectorAll("[data-acid-game]").forEach(initAcidRainGame);

const qnaForm = document.querySelector("#qnaForm");
const qnaFormMessage = document.querySelector("#qnaFormMessage");
const questionBoard = document.querySelector("#questionBoard");
const qnaBoardSection = document.querySelector("#qnaBoardSection");
const questionDetail = document.querySelector("#questionDetail");
const questionPagination = document.querySelector("#questionPagination");
const questionCount = document.querySelector("#questionCount");
const qnaConfig = window.QNA_CONFIG || {};
const qnaApiUrl = qnaConfig.apiUrl || window.QNA_API_URL || "";
const qnaPageSize = 10;
const qnaRequestTimeout = Number(qnaConfig.timeoutMs) || 15000;
let qnaCurrentPage = 1;
let activeQuestionId = null;
let qnaQuestions = [];
let qnaBusy = false;

function isQnaApiConfigured() {
  return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(qnaApiUrl);
}

function normalizeQnaBoolean(value) {
  return value === true || String(value).toLowerCase() === "true" || String(value).toUpperCase() === "TRUE";
}

function normalizeRemoteQuestion(item) {
  return {
    id: String(item.id || ""),
    createdAt: item.createdAt || "",
    affiliation: item.affiliation || "미기재",
    grade: item.grade || "미기재",
    name: item.name || "익명",
    text: item.text || "",
    private: normalizeQnaBoolean(item.private),
    answer: item.answer || "",
    answeredAt: item.answeredAt || ""
  };
}

function qnaApiRequest(action, params = {}) {
  return new Promise((resolve, reject) => {
    if (!isQnaApiConfigured()) {
      reject(new Error("qna-config.js에 Apps Script 웹앱 URL을 설정하세요."));
      return;
    }

    const callbackName = `__qnaCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Google Sheets 게시판 응답 시간이 초과되었습니다."));
    }, qnaRequestTimeout);

    function cleanup() {
      window.clearTimeout(timeoutId);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (payload) => {
      cleanup();
      if (payload?.ok) {
        resolve(payload);
      } else {
        reject(new Error(payload?.message || "게시판 요청을 처리하지 못했습니다."));
      }
    };

    const url = new URL(qnaApiUrl);
    url.searchParams.set("callback", callbackName);
    url.searchParams.set("action", action);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value == null ? "" : String(value));
    });

    script.async = true;
    script.onerror = () => {
      cleanup();
      reject(new Error("Google Sheets 게시판에 연결하지 못했습니다."));
    };
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

function getQuestions() {
  return qnaQuestions;
}

function getQuestionId(item, index) {
  return item.id || `legacy-question-${index}`;
}

function getQuestionTitle(item) {
  if (item.private) return "비공개 질문입니다.";
  const title = (item.text || "").replace(/\s+/g, " ").trim();
  if (!title) return "제목 없는 질문";
  return title.length > 140 ? `${title.slice(0, 140)}...` : title;
}

function formatQuestionDate(value) {
  if (!value) return "작성일 미기재";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "작성일 미기재";
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function setQnaFormMessage(message, type = "info") {
  if (!qnaFormMessage) return;
  qnaFormMessage.textContent = message;
  qnaFormMessage.className = `board-message ${type}`;
}

function setQnaBusy(isBusy) {
  qnaBusy = isBusy;
  qnaForm?.querySelectorAll("button, input, textarea").forEach((control) => {
    control.disabled = isBusy;
  });
}

function renderQuestionTools(item, index) {
  return `
    <div class="question-tools">
      <details>
        <summary>질문 수정</summary>
        <form class="board-form edit-question-form" data-index="${index}" data-question-id="${escapeHTML(getQuestionId(item, index))}">
          <label>수정 비밀번호</label>
          <input type="password" name="editPassword" placeholder="등록할 때 설정한 비밀번호" required>
          <label>질문 내용 수정</label>
          <textarea name="editText" rows="4" required>${escapeHTML(item.text || "")}</textarea>
          <label class="anonymous-check">
            <input type="checkbox" name="editPrivate" ${item.private ? "checked" : ""}>
            비공개
          </label>
          <button class="button secondary small" type="submit">수정 저장</button>
        </form>
      </details>
      <details>
        <summary>관리자 답변</summary>
        <form class="board-form admin-answer-form" data-index="${index}" data-question-id="${escapeHTML(getQuestionId(item, index))}">
          <label>관리자 비밀번호</label>
          <input type="password" name="adminPassword" placeholder="관리자만 답변할 수 있습니다" required>
          <label>답변 내용</label>
          <textarea name="answerText" rows="4" required>${item.answer ? escapeHTML(item.answer) : ""}</textarea>
          <button class="button primary small" type="submit">답변 저장</button>
        </form>
      </details>
      <details>
        <summary>관리자 삭제</summary>
        <form class="board-form admin-delete-form" data-index="${index}" data-question-id="${escapeHTML(getQuestionId(item, index))}">
          <label>관리자 비밀번호</label>
          <input type="password" name="deletePassword" placeholder="삭제 권한 확인" required>
          <p class="delete-warning">삭제하면 이 질문과 답변은 게시판에서 사라집니다.</p>
          <button class="button danger small" type="submit">질문 삭제</button>
        </form>
      </details>
    </div>
    <p class="board-message" data-message-index="${index}" aria-live="polite"></p>
  `;
}

function renderQuestionDetail(questions) {
  if (!questionDetail) return;

  const selectedIndex = questions.findIndex((item, index) => getQuestionId(item, index) === activeQuestionId);
  if (selectedIndex < 0) {
    activeQuestionId = null;
    questionDetail.hidden = true;
    questionDetail.innerHTML = "";
    return;
  }

  const item = questions[selectedIndex];
  const answerStatus = item.answer ? "답변 완료" : "답변 대기";
  questionDetail.hidden = false;
  questionDetail.innerHTML = `
    <article class="question-detail-card">
      <div class="question-detail-top">
        <button class="button secondary small" type="button" data-back-to-list>목록으로</button>
        <span class="answer-state ${item.answer ? "answered" : "pending"}">${answerStatus}</span>
      </div>
      <div class="question-author">
        <span>소속: ${escapeHTML(item.affiliation || "미기재")}</span>
        <span>학년: ${escapeHTML(item.grade || "미기재")}</span>
        <span>이름: ${escapeHTML(item.name || "익명")}</span>
        <span>${formatQuestionDate(item.createdAt)}</span>
      </div>
      <div class="question-body">
        <strong>질문</strong>
        <p class="${item.private ? "private-question" : ""}">${item.private ? "비공개 질문입니다." : escapeHTML(item.text || "")}</p>
      </div>
      <div class="answer-panel">
        <strong>답변</strong>
        <p>${item.answer ? escapeHTML(item.answer) : "아직 등록된 답변이 없습니다."}</p>
      </div>
      ${renderQuestionTools(item, selectedIndex)}
    </article>
  `;
}

function renderQuestionPagination(totalPages) {
  if (!questionPagination) return;
  if (totalPages <= 1) {
    questionPagination.innerHTML = "";
    return;
  }

  questionPagination.innerHTML = Array.from({ length: totalPages }, (_, index) => {
    const page = index + 1;
    return `
      <button type="button" data-qna-page="${page}" aria-label="${page}페이지" ${page === qnaCurrentPage ? 'aria-current="page"' : ""}>
        ${page}
      </button>
    `;
  }).join("");
}

function renderQuestions(message = "") {
  if (!questionBoard) return;
  const questions = getQuestions();
  const totalPages = Math.max(1, Math.ceil(questions.length / qnaPageSize));
  qnaCurrentPage = Math.min(Math.max(qnaCurrentPage, 1), totalPages);

  if (message) {
    if (questionCount) questionCount.textContent = "";
    if (questionDetail) {
      questionDetail.hidden = true;
      questionDetail.innerHTML = "";
    }
    if (questionPagination) questionPagination.innerHTML = "";
    questionBoard.innerHTML = `<p class="empty-state">${escapeHTML(message)}</p>`;
    return;
  }

  if (questions.length === 0) {
    if (questionCount) questionCount.textContent = "등록된 질문 0개";
    if (questionDetail) {
      questionDetail.hidden = true;
      questionDetail.innerHTML = "";
    }
    if (questionPagination) questionPagination.innerHTML = "";
    questionBoard.innerHTML = '<p class="empty-state">아직 등록된 질문이 없습니다.</p>';
    return;
  }

  const startIndex = (qnaCurrentPage - 1) * qnaPageSize;
  const pageQuestions = questions.slice(startIndex, startIndex + qnaPageSize);
  const pageStart = startIndex + 1;
  const pageEnd = startIndex + pageQuestions.length;

  if (questionCount) {
    questionCount.textContent = `총 ${questions.length}개 질문 · 페이지당 ${qnaPageSize}개 · ${pageStart}-${pageEnd}번째 표시`;
  }

  renderQuestionDetail(questions);
  renderQuestionPagination(totalPages);

  questionBoard.innerHTML = pageQuestions.map((item, offset) => {
    const index = startIndex + offset;
    const questionId = getQuestionId(item, index);
    const isActive = questionId === activeQuestionId;
    return `
      <article class="question-list-item ${isActive ? "selected" : ""}">
        <button class="question-open" type="button" data-index="${index}" data-question-id="${escapeHTML(questionId)}" aria-expanded="${isActive}">
          <span class="question-number">${questions.length - index}</span>
          <span class="question-list-main">
            <strong>${escapeHTML(getQuestionTitle(item))}</strong>
            <small>${escapeHTML(item.name || "익명")} · ${formatQuestionDate(item.createdAt)}</small>
          </span>
          <span class="answer-state ${item.answer ? "answered" : "pending"}">${item.answer ? "답변 완료" : "답변 대기"}</span>
        </button>
      </article>
    `;
  }).join("");
}

function showBoardMessage(index, message, type = "info") {
  const messageBox = (qnaBoardSection || questionBoard)?.querySelector(`[data-message-index="${index}"]`);
  if (!messageBox) return;
  messageBox.textContent = message;
  messageBox.className = `board-message ${type}`;
}

async function refreshQuestions(options = {}) {
  if (!questionBoard) return;
  const { keepActive = true } = options;
  if (!isQnaApiConfigured()) {
    qnaQuestions = [];
    renderQuestions("qna-config.js에 Apps Script 웹앱 URL을 설정하면 공개 질문 목록을 불러옵니다.");
    return;
  }

  renderQuestions("질문 목록을 불러오는 중입니다.");

  try {
    const payload = await qnaApiRequest("list");
    qnaQuestions = (payload.questions || []).map(normalizeRemoteQuestion);
    if (!keepActive) activeQuestionId = null;
    renderQuestions();
  } catch (error) {
    qnaQuestions = [];
    renderQuestions(error.message || "질문 목록을 불러오지 못했습니다.");
  }
}

if (qnaForm && questionBoard) {
  const anonymousCheckboxes = qnaForm.querySelectorAll("[data-anonymous-target]");
  const qnaBoardContainer = qnaBoardSection || questionBoard;

  function syncAnonymousInputs() {
    anonymousCheckboxes.forEach((checkbox) => {
      const input = document.querySelector(`#${checkbox.dataset.anonymousTarget}`);
      input.disabled = qnaBusy || checkbox.checked;
      if (checkbox.checked) input.value = "";
    });
  }

  anonymousCheckboxes.forEach((checkbox) => {
    const input = document.querySelector(`#${checkbox.dataset.anonymousTarget}`);
    checkbox.addEventListener("change", () => {
      input.disabled = checkbox.checked;
      if (checkbox.checked) input.value = "";
    });
  });

  refreshQuestions();

  qnaBoardContainer.addEventListener("click", (event) => {
    const openButton = event.target.closest(".question-open");
    const pageButton = event.target.closest("[data-qna-page]");

    if (openButton) {
      activeQuestionId = openButton.dataset.questionId;
      renderQuestions();
      questionDetail?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (pageButton) {
      qnaCurrentPage = Number(pageButton.dataset.qnaPage);
      activeQuestionId = null;
      renderQuestions();
      questionBoard.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (event.target.closest("[data-back-to-list]")) {
      activeQuestionId = null;
      renderQuestions();
      questionBoard.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  qnaBoardContainer.addEventListener("submit", async (event) => {
    const editForm = event.target.closest(".edit-question-form");
    const answerForm = event.target.closest(".admin-answer-form");
    const deleteForm = event.target.closest(".admin-delete-form");
    if (!editForm && !answerForm && !deleteForm) return;

    event.preventDefault();
    if (!isQnaApiConfigured()) {
      setQnaFormMessage("qna-config.js에 Apps Script 웹앱 URL을 설정하세요.", "error");
      return;
    }

    const form = editForm || answerForm || deleteForm;
    const index = Number(form.dataset.index);
    const id = form.dataset.questionId;
    const formData = new FormData(form);
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;

    try {
      if (editForm) {
        await qnaApiRequest("update", {
          id,
          password: String(formData.get("editPassword") || ""),
          text: String(formData.get("editText") || "").trim(),
          private: Boolean(formData.get("editPrivate"))
        });
        showBoardMessage(index, "질문이 수정되었습니다.");
        await refreshQuestions();
        return;
      }

      if (answerForm) {
        await qnaApiRequest("answer", {
          id,
          adminPassword: String(formData.get("adminPassword") || ""),
          answer: String(formData.get("answerText") || "").trim()
        });
        showBoardMessage(index, "답변이 저장되었습니다.");
        await refreshQuestions();
      }

      if (deleteForm) {
        await qnaApiRequest("delete", {
          id,
          adminPassword: String(formData.get("deletePassword") || "")
        });
        activeQuestionId = null;
        await refreshQuestions({ keepActive: false });
      }
    } catch (error) {
      showBoardMessage(index, error.message || "요청을 처리하지 못했습니다.", "error");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  qnaForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isQnaApiConfigured()) {
      setQnaFormMessage("qna-config.js에 Apps Script 웹앱 URL을 설정하세요.", "error");
      return;
    }

    const formData = new FormData(qnaForm);
    const affiliation = formData.get("anonymousAffiliation")
      ? "익명"
      : String(formData.get("studentAffiliation") || "").trim() || "미기재";
    const grade = formData.get("anonymousGrade")
      ? "익명"
      : String(formData.get("studentGrade") || "").trim() || "미기재";
    const name = formData.get("anonymousName")
      ? "익명"
      : String(formData.get("studentName") || "").trim() || "익명";
    const text = String(formData.get("questionText") || "").trim();
    const privateQuestion = Boolean(formData.get("privateQuestion"));
    const password = String(formData.get("questionPassword") || "");
    if (!text || !password) return;

    setQnaBusy(true);
    setQnaFormMessage("질문을 등록하는 중입니다.");

    try {
      await qnaApiRequest("create", {
        affiliation,
        grade,
        name,
        text,
        private: privateQuestion,
        password
      });
      qnaForm.reset();
      qnaCurrentPage = 1;
      activeQuestionId = null;
      setQnaFormMessage("질문이 등록되었습니다.");
      await refreshQuestions({ keepActive: false });
    } catch (error) {
      setQnaFormMessage(error.message || "질문을 등록하지 못했습니다.", "error");
    } finally {
      setQnaBusy(false);
      syncAnonymousInputs();
    }
  });
}
