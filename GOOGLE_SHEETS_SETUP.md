# Google Sheets + Apps Script Q&A/방문자 카운터/랭킹 설정

현재 `qna.html`의 디자인과 게시판 구성은 그대로 두고, 질문/답변 데이터, `index.html` 방문자 카운터, `game.html` 산성비 게임 랭킹, `history-cause-effect-game.html` 역사 추리왕 랭킹을 Google Sheets에 저장하도록 연결합니다.

## 1. Google Sheets 만들기

1. Google Drive에서 새 스프레드시트를 만듭니다.
2. 문서 이름은 예를 들어 `사회역사 QNA 게시판`으로 정합니다.
3. 시트 탭 이름은 직접 만들 필요가 없습니다. Apps Script가 `QNA`, `count`, `daily_count`, `monthly_count`, `사회 산성비 랭킹`, `역사 산성비 랭킹`, `역사 추리왕 랭킹` 시트를 자동으로 만들고 헤더를 추가합니다.

자동 생성되는 `QNA` 시트 헤더:

```text
id, createdAt, affiliation, grade, name, text, private, passwordHash, answer, answeredAt, status
```

자동 생성되는 `count` 시트 헤더:

```text
A1: date
B1: count
I1: =TODAY()
J1: =IFERROR(SUM(FILTER(B:B, TEXT(A:A,"yyyy-mm-dd")=TEXT(I1,"yyyy-mm-dd"))),0)
```

`count` 시트는 날짜별 1행만 유지합니다. 같은 날짜의 방문은 해당 날짜 행의 `count` 값을 1씩 올리고, API의 `today` 값은 `J1` 값을 읽어 반환합니다.
방문자 날짜 기준은 Apps Script의 `Asia/Seoul` 기준 하루(00:00:00~23:59:59)입니다.

자동 생성되는 `daily_count` 시트 헤더:

```text
date, count
```

자동 생성되는 `monthly_count` 시트 헤더:

```text
month, count
```

`daily_count`, `monthly_count` 시트는 과거 보조 함수와 정리 작업을 위한 시트이며, 홈페이지 방문자 카운터 표시는 `count` 시트의 `J1` 값을 기준으로 합니다.

자동 생성되는 `사회 산성비 랭킹`, `역사 산성비 랭킹` 시트 헤더:

```text
id, 일자, name, score, level, survivalMs
```

자동 생성되는 `역사 추리왕 랭킹` 시트 헤더:

```text
id, 일자, nickname, score, area, correctCount, answeredCount, maxCombo
```

기존 랭킹 시트의 `createdAt` 또는 `date` 열은 자동으로 `일자` 열로 전환됩니다. 기존 행에 날짜 값이 없으면 빈 값을 유지하고, 새로 등록되는 기록부터 한국 시간 기준 `yyyy-MM-dd` 형식으로 저장합니다.

## 2. Apps Script 붙여넣기

1. 스프레드시트에서 `확장 프로그램 > Apps Script`를 엽니다.
2. 기본 `Code.gs` 내용을 지우고, 이 프로젝트의 `apps-script/Code.gs` 내용을 붙여넣습니다.
3. 저장합니다.

## 3. 스크립트 속성 설정

Apps Script 편집기 왼쪽의 `프로젝트 설정`에서 `스크립트 속성`을 추가합니다.

필수:

```text
QNA_ADMIN_PASSWORD = 선생님이 사용할 관리자 비밀번호
```

선택:

```text
QNA_PASSWORD_SALT = 임의의 긴 문자열
WEB_ALLOWED_ORIGINS = https://rraphop.github.io
```

`WEB_ALLOWED_ORIGINS`에는 홈페이지를 제공하는 HTTPS 출처를 쉼표로 구분해 입력합니다. 설정하지 않으면 `https://rraphop.github.io`만 허용됩니다.

Standalone Apps Script로 만들었거나 스프레드시트에 바인딩하지 않은 경우에는 아래도 설정합니다.

```text
QNA_SPREADSHEET_ID = Google Sheets 주소의 /d/ 와 /edit 사이에 있는 ID
```

## 4. 웹앱 배포

1. Apps Script 오른쪽 위 `배포 > 새 배포`를 누릅니다.
2. 유형은 `웹 앱`을 선택합니다.
3. 실행 권한은 `나`로 설정합니다.
4. 액세스 권한은 공개 게시판으로 쓰려면 `모든 사용자`로 설정합니다.
5. 배포 후 나오는 `/exec` URL을 복사합니다.

## 5. 시트 초기화

Apps Script 편집기 상단의 함수 선택 메뉴에서 `setupSheets`를 선택하고 실행합니다. 권한 승인 후 아래 시트가 만들어졌는지 확인합니다.

```text
QNA
count
daily_count
monthly_count
사회 산성비 랭킹
역사 산성비 랭킹
역사 추리왕 랭킹
```

시트 초기화와 방문자 데이터 재구축 함수는 보안을 위해 공개 웹 주소에서 실행할 수 없습니다. 반드시 Apps Script 편집기의 함수 실행 메뉴에서 직접 실행합니다.

## 6. qna-config.js 확인

`qna-config.js`의 URL이 배포된 웹앱 `/exec` URL과 같아야 합니다. 이 파일은 Q&A, 방문자 카운터, 산성비 랭킹, 역사 추리왕 랭킹이 같은 Google Sheets 웹앱을 바라보도록 공유됩니다.

```js
const QNA_API_URL = "여기에 Apps Script 웹앱 /exec URL";
```

현재 파일은 아래 구조로 동작합니다.

```js
window.QNA_CONFIG = {
  apiUrl: QNA_API_URL,
  pageSize: 10,
  timeoutMs: 15000
};
```

## 7. 동작 흐름

```text
학생 질문 등록 → Apps Script → Google Sheets `QNA` 시트 저장
메인 페이지 방문 → Apps Script → Google Sheets `count` 시트 갱신
산성비 게임 종료 후 랭킹 등록 → Apps Script → Google Sheets `사회 산성비 랭킹` 또는 `역사 산성비 랭킹` 시트 저장
역사 추리왕 종료 후 랭킹 등록 → Apps Script → Google Sheets `역사 추리왕 랭킹` 시트 저장
모든 학생/선생님이 같은 질문 목록, 방문자 수, 산성비 랭킹, 역사 추리왕 랭킹 확인
관리자 답변 등록 → 학생이 답변 확인
```

## 참고 사항

- 정적 HTML에서도 동작하도록 공개 조회는 JSONP를 사용하고, 비밀번호와 저장 데이터는 허용된 홈페이지 출처의 보안 브리지를 통해 전달합니다.
- 방문자 카운터 숫자는 Google Sheets 응답 값만 표시하고, 브라우저에는 중복 계수 방지용 날짜만 저장합니다.
- 예전 `key/value` 구조나 방문 1회당 1행 구조의 `count` 시트가 남아 있으면 Apps Script가 기존 누적값을 날짜별 `date/count` 구조로 합산 정리합니다.
- 산성비 랭킹은 Google Sheets의 `사회 산성비 랭킹`, `역사 산성비 랭킹` 시트에 각각 저장되며 홈페이지에는 상위 10개 기록이 표시됩니다.
- 역사 추리왕 랭킹은 Google Sheets의 `역사 추리왕 랭킹` 시트에 저장되며 게임 안에는 전체, 한국사, 세계사 상위 10개 기록이 한 번에 표시됩니다.
- 같은 브라우저/기기에서 같은 날 새로고침하거나 다시 방문해도 중복 카운트되지 않도록 `localStorage`에 오늘 계수 여부만 저장합니다.
- 질문 수정 비밀번호는 Google Sheets에 원문이 아니라 해시로 저장됩니다.
- 관리자 비밀번호는 홈페이지 JS에 넣지 않고 Apps Script 스크립트 속성 `QNA_ADMIN_PASSWORD`에서 검증합니다.
- Apps Script를 새 버전으로 수정한 뒤에는 `배포 관리`에서 새 버전을 먼저 배포한 다음 홈페이지 파일을 배포해야 안전한 저장 요청이 정상 동작합니다.
- 매우 민감한 개인정보를 받는 게시판이라면 Apps Script보다 인증이 있는 별도 백엔드를 쓰는 편이 안전합니다.

## 오류 해결

`SyntaxError: Unexpected token 'else'` 또는 `SyntaxError: Illegal return statement`가 나오면 대부분 `apps-script/Code.gs` 파일 전체가 아니라 일부 줄만 붙여넣었거나, 줄 번호/diff 표시까지 함께 붙여넣은 경우입니다.

1. Apps Script 편집기에서 `Code.gs` 안의 내용을 전체 선택합니다.
2. 모두 삭제합니다.
3. 이 프로젝트의 `apps-script/Code.gs` 파일 원문을 1라인부터 끝까지 그대로 붙여넣습니다.
4. 저장한 뒤 함수 선택 메뉴에 `setupSheets`가 보이는지 확인합니다.

정상 파일의 앞부분은 아래처럼 시작해야 합니다.

```js
const SHEET_NAME = 'QNA';
const COUNTER_SHEET_NAME = 'count';
const ACID_RANKING_SHEET_NAMES = {
  social: '사회 산성비 랭킹',
  history: '역사 산성비 랭킹'
};
const HISTORY_CAUSE_RANKING_SHEET_NAME = '역사 추리왕 랭킹';
```

## 프로그램 자료실 추가 (2026-10-06)

`programs.html`에서 관리자 게시글, 이미지가 포함된 소개글, GitHub 다운로드 링크, 방문자 댓글을 제공합니다. 소개글과 댓글은 Sheets에 저장하고, 실행 파일과 이미지는 URL만 저장합니다.

### 기존 사이트에 적용하기

1. Apps Script 편집기의 `Code.gs`를 이 프로젝트의 최신 `apps-script/Code.gs`로 교체하고 저장합니다.
2. 기존 `QNA_ADMIN_PASSWORD`를 그대로 사용합니다. 별도의 비밀번호나 GitHub 토큰은 필요하지 않습니다.
3. `setupSheets`를 실행합니다. 기존 시트는 유지되고 `프로그램 자료실`, `프로그램 댓글` 시트가 추가됩니다. 새 기능의 첫 요청에서도 이 두 시트는 자동 생성됩니다.
4. **배포 > 배포 관리 > 기존 웹 앱 수정 > 새 버전 > 배포** 순서로 업데이트합니다. 기존 배포를 수정하면 `/exec` 주소를 유지할 수 있습니다.
5. 홈페이지의 변경 파일과 새 `programs.html`, `programs.css`, `programs.js`를 함께 배포합니다. `qna-config.js`에도 자료실 읽기 요청이 추가되어 있으므로 포함해야 합니다.
6. 자료실에서 글 등록, 이미지 미리보기, 다운로드, 댓글 등록을 확인합니다. 로컬 테스트는 메모리 저장소로 검증했으며, 실제 저장소 연결은 Apps Script 배포 이후 확인해야 합니다.

### 글과 그림 올리기

1. 공개 GitHub 저장소의 Releases에 EXE 또는 ZIP을 첨부하고 배포합니다. 첨부 파일의 링크 주소를 복사합니다.
2. 홈페이지에서 `프로그램 자료실 > 관리자 글쓰기`를 누릅니다.
3. 프로그램 이름, 분류, 한 줄 소개, 버전, 지원 환경을 입력하고 다운로드 주소를 붙여 넣습니다.
4. 소개 내용을 입력합니다. `## 사용 방법`처럼 쓰면 소제목으로 표시됩니다.
5. 그림은 공개된 HTTPS 이미지 주소와 설명을 입력한 뒤 `그림 삽입`을 누릅니다. 소개글 커서 위치에 `![설명](주소)`가 삽입됩니다. 여러 장을 글 사이에 넣을 수 있습니다.
6. GitHub 저장소의 이미지라면 파일 화면의 Raw 주소를 사용합니다. 공개 이미지 첨부 주소도 가능합니다. 비공개 저장소의 그림이나 이미지 보기 페이지 주소는 사용하지 않습니다.
7. `소개글 미리보기`로 확인하고 기존 관리자 비밀번호로 저장합니다.

이미지 파일을 홈페이지에서 직접 업로드하는 방식은 지원하지 않습니다. 이미지와 프로그램 파일을 먼저 GitHub 등에 올리고 공개 링크를 입력합니다. HTML 태그는 실행되지 않고 일반 글자로 표시됩니다. 소개글 최대 20,000자, 한 줄 소개 240자, 댓글 2,000자입니다.

### 댓글 운영

- 방문자는 별도 가입 없이 닉네임·댓글·수정 비밀번호를 입력합니다. 비밀번호는 해시로 저장되며 공개 응답에 포함되지 않습니다.
- 댓글의 `수정`·`삭제` 버튼에서 작성 시 비밀번호를 사용합니다.
- `관리자 답글 / 관리`를 체크하면 입력란이 관리자 비밀번호로 전환됩니다. 인증된 관리자 답글에는 관리자 표시가 붙습니다.
- 관리자는 댓글을 수정·삭제할 수 있습니다. 기존 방문자 댓글을 수정해도 원래 작성자와 관리자 표시 여부를 유지합니다.
- 게시글을 삭제하면 해당 댓글도 삭제됩니다. GitHub에 올린 원본 파일은 그대로 유지됩니다.

### 개발 검증

```sh
node tests/internal-review.test.js
node tests/programs.test.js
node tests/programs-browser.test.js
```

브라우저 검사는 `playwright` 패키지와 Google Chrome을 사용합니다. 테스트는 임시 로컬 서버와 메모리 기반 Sheets 모형을 사용하며 실제 게시판에 글을 작성하지 않습니다.

### 한글 다운로드 파일명 지정

32MB처럼 웹 업로드 한도(25MiB)를 넘는 파일은 로컬 Git 또는 GitHub Desktop을 사용해 저장소의 `downloads` 폴더에 올립니다. 저장소의 파일 이름은 `teacher-note-v1.0.zip`처럼 영문으로 정합니다.

홈페이지 배포가 완료된 뒤 자료실 글을 수정합니다.

- 다운로드 주소: `/downloads/teacher-note-v1.0.zip`
- 다운로드 파일명: `교무수첩.zip`

방문자는 다운로드 버튼을 누르면 한글 이름으로 저장할 수 있습니다. EXE를 배포한다면 주소와 다운로드 파일명의 확장자를 모두 `.exe`로 지정합니다. 파일을 올리지 않고 주소만 등록하면 다운로드가 실패합니다.

이 기능을 적용할 때는 최신 `apps-script/Code.gs`를 기존 웹 앱의 새 버전으로 배포하고, `programs.html`, `programs.js`도 홈페이지에 반영해야 합니다. `프로그램 자료실` 시트의 `downloadName` 열은 자동 추가되며 기존 게시글은 유지됩니다.

기존 Releases 링크는 계속 사용할 수 있지만, 다른 도메인의 파일이므로 다운로드 파일명 항목을 비워 둡니다. 이 기능은 다운로드 파일을 메모리로 읽어 다시 저장하거나 별도 서버로 중계하지 않습니다.
