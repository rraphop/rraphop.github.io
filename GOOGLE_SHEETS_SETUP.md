# Google Sheets + Apps Script Q&A 게시판 설정

현재 `qna.html`의 디자인과 게시판 구성은 그대로 두고, 질문/답변 데이터만 Google Sheets에 저장하도록 연결합니다.

## 1. Google Sheets 만들기

1. Google Drive에서 새 스프레드시트를 만듭니다.
2. 문서 이름은 예를 들어 `사회역사 QNA 게시판`으로 정합니다.
3. 시트 탭 이름은 직접 만들 필요가 없습니다. Apps Script가 `QNA` 시트를 자동으로 만들고 헤더를 추가합니다.

자동 생성되는 헤더:

```text
id, createdAt, affiliation, grade, name, text, private, passwordHash, answer, answeredAt, status
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
```

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

## 5. qna-config.js 확인

`qna-config.js`의 URL이 배포된 웹앱 `/exec` URL과 같아야 합니다.

```js
const QNA_API_URL = "https://script.google.com/macros/s/배포ID/exec";
```

현재 파일은 아래 구조로 동작합니다.

```js
window.QNA_CONFIG = {
  apiUrl: QNA_API_URL,
  pageSize: 10,
  timeoutMs: 15000
};
```

## 6. 동작 흐름

```text
학생 질문 등록
→ Apps Script
→ Google Sheets 저장
→ 모든 학생/선생님이 같은 질문 목록 확인
→ 관리자 답변 등록
→ 학생이 답변 확인
```

## 참고 사항

- 정적 HTML에서도 동작하도록 `script.js`는 Apps Script를 JSONP 방식으로 호출합니다.
- 질문 수정 비밀번호는 Google Sheets에 원문이 아니라 해시로 저장됩니다.
- 관리자 비밀번호는 홈페이지 JS에 넣지 않고 Apps Script 스크립트 속성 `QNA_ADMIN_PASSWORD`에서 검증합니다.
- Apps Script를 새 버전으로 수정한 뒤에는 `배포 관리`에서 새 버전을 배포해야 홈페이지에 반영됩니다.
- 매우 민감한 개인정보를 받는 게시판이라면 Apps Script보다 인증이 있는 별도 백엔드를 쓰는 편이 안전합니다.
