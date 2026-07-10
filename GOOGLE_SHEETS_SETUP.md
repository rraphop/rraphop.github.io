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
id, createdAt, name, score, level, survivalMs
```

자동 생성되는 `역사 추리왕 랭킹` 시트 헤더:

```text
id, createdAt, nickname, score, area, correctCount, answeredCount, maxCombo
```

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
