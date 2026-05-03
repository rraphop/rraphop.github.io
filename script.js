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
      type: "용어 질문",
      question: `${clue}에 해당하는 용어를 쓰시오.`
    },
    {
      type: "빈칸 채우기",
      question: `빈칸에 들어갈 알맞은 용어를 쓰시오. ${sentence}`
    },
    {
      type: "단어 질문",
      question: `다음 설명의 핵심 단어를 쓰시오. ${clue}`
    },
    {
      type: "시험 대비",
      question: `${unit.title} 단원의 핵심 개념입니다. ${clue} 이 용어는 무엇인가?`
    },
    {
      type: "중간 용어 넣기",
      question: sentence.replace("____", "(        )")
    },
    {
      type: "개념 확인",
      question: `교과서 핵심어 확인: ${clue} 한 단어 또는 짧은 용어로 쓰시오.`
    }
  ];

  return {
    ...base,
    ...templates[variantIndex]
  };
}

function createQuestionPool(unit) {
  return unit.terms.flatMap((termEntry, termIndex) => (
    Array.from({ length: 6 }, (_, variantIndex) => (
      createTermQuestion(unit, termEntry, termIndex, variantIndex)
    ))
  ));
}

function populateSubjects() {
  if (!subjectSelect || typeof QUIZ_BANK === "undefined") return;

  subjectSelect.innerHTML = QUIZ_BANK.map((subject) => (
    `<option value="${subject.id}">${subject.title}</option>`
  )).join("");
  populateUnits();
}

function populateUnits() {
  const subject = QUIZ_BANK.find((item) => item.id === subjectSelect.value);
  if (!subject) return;

  unitSelect.innerHTML = subject.units.map((unit) => (
    `<option value="${unit.id}">${unit.title}</option>`
  )).join("");

  clearCurrentQuiz(`${subject.title}의 단원을 선택한 뒤 시작하세요.`);
}

function getSelectedUnit() {
  const subject = QUIZ_BANK.find((item) => item.id === subjectSelect.value);
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
  const pool = shuffle(createQuestionPool(unit));

  quizState = {
    subject,
    unit,
    pool,
    usedIds: new Set(),
    currentQuestions: [],
    totalAnswered: 0,
    totalCorrect: 0,
    round: 0,
    maxQuestions: Math.min(30, pool.length)
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
const timelineList = document.querySelector("#timelineList");
const timelineResult = document.querySelector("#timelineResult");
const timelineStatus = document.querySelector("#timelineStatus");
const timelineBankList = document.querySelector("#timelineBankList");
const timelineModeButtons = document.querySelectorAll("[data-timeline-mode]");
const gameChoices = document.querySelectorAll("[data-game-choice]");
const gamePanels = document.querySelectorAll("[data-game-panel]");
let timelineMode = "korean";

function showGamePanel(gameName) {
  gameChoices.forEach((button) => {
    button.classList.toggle("active", button.dataset.gameChoice === gameName);
  });
  gamePanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.gamePanel === gameName);
  });
}

if (gameChoices.length > 0) {
  gameChoices.forEach((button) => {
    button.addEventListener("click", () => showGamePanel(button.dataset.gameChoice));
  });
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
  timelineResult.classList.remove("show");
  timelineResult.textContent = "";
  renderTimelineStatus();
  renderTimelineBank();
  renderTimeline();
}

function correctTimelineMarkup() {
  return [...timelineTarget]
    .sort((a, b) => a.order - b.order)
    .map((event, index) => `<li>${index + 1}. ${event.year} - ${event.title}</li>`)
    .join("");
}

function moveTimelineItem(index, direction) {
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= timelineOrder.length) return;
  [timelineOrder[index], timelineOrder[nextIndex]] = [timelineOrder[nextIndex], timelineOrder[index]];
  renderTimeline();
}

if (timelineList) {
  drawTimelineRound();

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
    timelineResult.classList.add("show");
    timelineResult.innerHTML = isCorrect
      ? "<p>합격입니다. 10개 사건의 시간 순서를 모두 맞혔습니다.</p>"
      : `<p>불합격입니다. 사건이 일어난 시기를 다시 확인하세요.</p><p>정답 순서</p><ol class="timeline-answer">${correctTimelineMarkup()}</ol>`;
  });
}

const socialTerms = [
  "인권", "기본권", "평등권", "자유권", "사회권", "헌법", "국회", "대통령",
  "사법부", "민주주의", "주권", "정당", "여론", "시민 참여", "법", "계약",
  "희소성", "기회비용", "합리적 선택", "시장", "수요", "공급", "균형 가격",
  "국내 총생산", "물가", "실업", "환율", "무역", "국제기구", "세계화",
  "다국적 기업", "도시화", "환경 문제", "지속가능한 발전", "문화", "사회화"
];

const acidArena = document.querySelector("#acidArena");
const acidReady = document.querySelector("#acidReady");
const acidForm = document.querySelector("#acidForm");
const acidAnswer = document.querySelector("#acidAnswer");
const acidSubmit = document.querySelector("#acidSubmit");
const acidScore = document.querySelector("#acidScore");
const acidLives = document.querySelector("#acidLives");
const acidLevel = document.querySelector("#acidLevel");
const acidResult = document.querySelector("#acidResult");
const startAcidRain = document.querySelector("#startAcidRain");
const resetAcidRain = document.querySelector("#resetAcidRain");

let acidState = {
  running: false,
  score: 0,
  lives: 5,
  level: 1,
  terms: [],
  nextDropAt: 0,
  lastFrameAt: 0,
  animationId: null
};

function normalizedTerm(value) {
  return normalizeAnswer(value);
}

function updateAcidStatus() {
  if (!acidScore) return;
  acidScore.textContent = acidState.score;
  acidLives.textContent = acidState.lives;
  acidLevel.textContent = acidState.level;
}

function clearAcidTerms() {
  acidState.terms.forEach((term) => term.element.remove());
  acidState.terms = [];
}

function resetAcidGame(message = "시작 버튼을 누르면 사회 용어가 떨어집니다.") {
  if (!acidArena) return;
  if (acidState.animationId) cancelAnimationFrame(acidState.animationId);
  acidState = {
    running: false,
    score: 0,
    lives: 5,
    level: 1,
    terms: [],
    nextDropAt: 0,
    lastFrameAt: 0,
    animationId: null
  };
  acidArena.querySelectorAll(".acid-drop").forEach((item) => item.remove());
  acidReady.textContent = message;
  acidReady.hidden = false;
  acidAnswer.value = "";
  acidAnswer.disabled = true;
  acidSubmit.disabled = true;
  acidResult.classList.remove("show");
  acidResult.textContent = "";
  updateAcidStatus();
}

function createAcidDrop() {
  const term = socialTerms[Math.floor(Math.random() * socialTerms.length)];
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
  acidState.running = false;
  if (acidState.animationId) cancelAnimationFrame(acidState.animationId);
  acidAnswer.disabled = true;
  acidSubmit.disabled = true;
  acidResult.classList.add("show");
  acidResult.innerHTML = `
    <p>게임 종료: ${acidState.score}점을 획득했습니다.</p>
    <p>${acidState.score >= 120 ? "사회 용어 반응 속도가 좋습니다." : "다시 시작해서 더 많은 용어를 막아 보세요."}</p>
  `;
}

function updateAcidFrame(timestamp) {
  if (!acidState.running) return;

  if (!acidState.lastFrameAt) acidState.lastFrameAt = timestamp;
  const delta = Math.min((timestamp - acidState.lastFrameAt) / 1000, 0.05);
  acidState.lastFrameAt = timestamp;

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
  if (!acidArena) return;
  resetAcidGame("");
  acidState.running = true;
  acidReady.hidden = true;
  acidAnswer.disabled = false;
  acidSubmit.disabled = false;
  acidAnswer.focus();
  acidState.nextDropAt = performance.now();
  acidState.animationId = requestAnimationFrame(updateAcidFrame);
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

if (acidArena && acidForm) {
  resetAcidGame();
  startAcidRain.addEventListener("click", startAcidGame);
  resetAcidRain.addEventListener("click", () => resetAcidGame());
  acidForm.addEventListener("submit", handleAcidAnswer);
}

const qnaForm = document.querySelector("#qnaForm");
const questionBoard = document.querySelector("#questionBoard");
const storageKey = "socialHistoryQuestions";
const qnaAdminPassword = "teacher1234";

function getQuestions() {
  return JSON.parse(localStorage.getItem(storageKey) || "[]");
}

function saveQuestions(questions) {
  localStorage.setItem(storageKey, JSON.stringify(questions));
}

function renderQuestions() {
  if (!questionBoard) return;
  const questions = getQuestions();
  if (questions.length === 0) {
    questionBoard.innerHTML = '<p class="empty-state">아직 등록된 질문이 없습니다.</p>';
    return;
  }
  questionBoard.innerHTML = questions.map((item, index) => `
    <article class="question-item">
      <div class="question-author">
        <span>소속: ${escapeHTML(item.affiliation || "미기재")}</span>
        <span>학년: ${escapeHTML(item.grade || "미기재")}</span>
        <span>이름: ${escapeHTML(item.name || "익명")}</span>
      </div>
      <p class="${item.private ? "private-question" : ""}">${item.private ? "비공개 질문입니다." : escapeHTML(item.text)}</p>
      <div class="answer-panel">
        <strong>답변</strong>
        <p>${item.answer ? escapeHTML(item.answer) : "아직 등록된 답변이 없습니다."}</p>
      </div>
      <div class="question-tools">
        <details>
          <summary>질문 수정</summary>
          <form class="board-form edit-question-form" data-index="${index}">
            <label>수정 비밀번호</label>
            <input type="password" name="editPassword" placeholder="등록할 때 설정한 비밀번호" required>
            <label>질문 내용 수정</label>
            <textarea name="editText" rows="4" required>${escapeHTML(item.text)}</textarea>
            <label class="anonymous-check">
              <input type="checkbox" name="editPrivate" ${item.private ? "checked" : ""}>
              비공개
            </label>
            <button class="button secondary small" type="submit">수정 저장</button>
          </form>
        </details>
        <details>
          <summary>관리자 답변</summary>
          <form class="board-form admin-answer-form" data-index="${index}">
            <label>관리자 비밀번호</label>
            <input type="password" name="adminPassword" placeholder="관리자만 답변할 수 있습니다" required>
            <label>답변 내용</label>
            <textarea name="answerText" rows="4" required>${item.answer ? escapeHTML(item.answer) : ""}</textarea>
            <button class="button primary small" type="submit">답변 저장</button>
          </form>
        </details>
        <details>
          <summary>관리자 삭제</summary>
          <form class="board-form admin-delete-form" data-index="${index}">
            <label>관리자 비밀번호</label>
            <input type="password" name="deletePassword" placeholder="삭제 권한 확인" required>
            <p class="delete-warning">삭제하면 이 질문과 답변은 게시판에서 사라집니다.</p>
            <button class="button danger small" type="submit">질문 삭제</button>
          </form>
        </details>
      </div>
      <p class="board-message" data-message-index="${index}" aria-live="polite"></p>
    </article>
  `).join("");
}

function showBoardMessage(index, message, type = "info") {
  const messageBox = questionBoard.querySelector(`[data-message-index="${index}"]`);
  if (!messageBox) return;
  messageBox.textContent = message;
  messageBox.className = `board-message ${type}`;
}

if (qnaForm) {
  const anonymousCheckboxes = qnaForm.querySelectorAll("[data-anonymous-target]");

  function syncAnonymousInputs() {
    anonymousCheckboxes.forEach((checkbox) => {
      const input = document.querySelector(`#${checkbox.dataset.anonymousTarget}`);
      input.disabled = checkbox.checked;
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

  renderQuestions();

  questionBoard.addEventListener("submit", (event) => {
    const editForm = event.target.closest(".edit-question-form");
    const answerForm = event.target.closest(".admin-answer-form");
    const deleteForm = event.target.closest(".admin-delete-form");
    if (!editForm && !answerForm && !deleteForm) return;

    event.preventDefault();
    const questions = getQuestions();
    const form = editForm || answerForm || deleteForm;
    const index = Number(form.dataset.index);
    const item = questions[index];
    if (!item) return;

    const formData = new FormData(form);

    if (editForm) {
      const savedPassword = item.password || "";
      const inputPassword = formData.get("editPassword").toString();
      if (!savedPassword || inputPassword !== savedPassword) {
        showBoardMessage(index, "수정 비밀번호가 맞지 않습니다.", "error");
        return;
      }
      item.text = formData.get("editText").toString().trim();
      item.private = Boolean(formData.get("editPrivate"));
      saveQuestions(questions);
      renderQuestions();
      return;
    }

    if (answerForm) {
      const inputPassword = formData.get("adminPassword").toString();
      if (inputPassword !== qnaAdminPassword) {
        showBoardMessage(index, "관리자 비밀번호가 맞지 않습니다.", "error");
        return;
      }
      item.answer = formData.get("answerText").toString().trim();
      item.answeredAt = new Date().toISOString();
      saveQuestions(questions);
      renderQuestions();
    }

    if (deleteForm) {
      const inputPassword = formData.get("deletePassword").toString();
      if (inputPassword !== qnaAdminPassword) {
        showBoardMessage(index, "관리자 비밀번호가 맞지 않습니다.", "error");
        return;
      }
      questions.splice(index, 1);
      saveQuestions(questions);
      renderQuestions();
    }
  });

  qnaForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(qnaForm);
    const affiliation = formData.get("anonymousAffiliation")
      ? "익명"
      : formData.get("studentAffiliation").toString().trim() || "미기재";
    const grade = formData.get("anonymousGrade")
      ? "익명"
      : formData.get("studentGrade").toString().trim() || "미기재";
    const name = formData.get("anonymousName")
      ? "익명"
      : formData.get("studentName").toString().trim() || "익명";
    const text = formData.get("questionText").toString().trim();
    const privateQuestion = Boolean(formData.get("privateQuestion"));
    const password = formData.get("questionPassword").toString();
    if (!text || !password) return;
    const questions = getQuestions();
    questions.unshift({
      id: Date.now().toString(),
      affiliation,
      grade,
      name,
      text,
      private: privateQuestion,
      password,
      answer: "",
      createdAt: new Date().toISOString()
    });
    saveQuestions(questions);
    qnaForm.reset();
    syncAnonymousInputs();
    renderQuestions();
  });
}
