# Checkyeerang UI 2.0 — 도서관 출석 화면의 시각 체계

## 원칙

이 화면은 일반 SaaS 대시보드가 아닌 **학교 도서관의 공용 출석 PC**에서 사용한다.

- 학생 출석은 이름을 빠르게 찾아 누르는 것이 목적이다. 학생 계정 로그인과 보충 출석 승인 절차는 추가하지 않는다.
- 관리자는 이름, 학년, 요일, 시간과 변경 결과를 잘못 인식하지 않아야 한다.
- 화면은 과도한 그림자, 반복된 큰 둥근 카드, 장식적인 배지 대신 정보의 순서와 여백으로 구조를 만든다.
- 16기 안준표의 로고·개발 표기와 기존 기능을 보존한다.
- 이 디자인 브랜치는 운영용 `pugmy/checkyeerang:main`과 별개다.

## 한글 서체 검토

| 서체 | 특징 | 적용 방침 |
| --- | --- | --- |
| SUIT Variable | 한국어 UI 본문용, 가변 굵기, WOFF2 제공, SIL OFL | **UI 2.0 기본 글꼴** |
| Pretendard | 한글·영문 수치의 높은 일관성, 여러 굵기, SIL OFL | 검토 대상 및 대체 후보 |
| Noto Sans KR | 오랜 사용 이력, 안정적인 한글 자형 | 이전 화면에서 사용하던 기본 글꼴 |

출처:
- SUIT 공식 저장소: https://github.com/sun-typeface/SUIT
- Pretendard 공식 저장소: https://github.com/orioncactus/pretendard
- Noto Sans KR: https://fonts.google.com/noto/specimen/Noto+Sans+KR

현재는 공식 SUIT 2.x CSS를 jsDelivr에서 로드한다:
`https://cdn.jsdelivr.net/gh/sun-typeface/SUIT@2/fonts/variable/woff2/SUIT-Variable.css`.

인터넷이 끊어지거나 CDN 접속이 막히면 macOS와 Windows의 시스템 한글 글꼴로 표시되도록 CSS 폴백을 지정한다. 글꼴을 Git에 첨부하거나 재배포하지 않는다. 실제 도서관 PC에서는 **초기 화면 로딩과 폰트 교체에 따른 레이아웃 흔들림**을 확인해야 한다.

## 디자인 규칙

- 본문은 중립적인 차콜과 회녹색, 동작 강조는 청록색으로 통일한다.
- 카드는 역할이 분명할 때만 사용하고 기본 그림자를 제거한다.
- 날짜를 먼저 보여준 다음 당번 시간과 출석 대상자를 보여준다.
- 일반 출석 버튼은 큰 클릭 영역을 유지한다.
- 모바일에서는 좁은 화면에 맞춰 상단 메뉴와 출석 카드를 재배치한다.
- 기존 다크 모드, 키보드 포커스, `prefers-reduced-motion`을 유지한다.
- 사용자 이름과 특이사항은 `textContent`와 DOM API로 삽입하고 HTML 문자열로 해석하지 않는다.

## 실제 화면을 로컬에서 확인

Node.js 20 이상, 별도 패키지 설치 없이:

```powershell
git switch 15th-Gen-Kim-Woojun
git pull --ff-only mine 15th-Gen-Kim-Woojun
node --test
node scripts/build-ui-preview.cjs
start .\preview-ui.html
```

미리보기는 프로젝트의 **실제 `Index.html`과 `Logo.html`**을 사용한다. 브라우저에서 출석, 보충 출석, 관리자 로그인, 출석관리, 부원관리를 누를 수 있도록 임의 예시 학생 정보와 모의 서버 응답을 넣는다. 관리자 로그인에는 임의의 글자를 입력해도 된다. 이것은 미리보기에서만 허용되는 기능이다.

- 파일 이름: `preview-ui.html` (Git에 올리지 않음).
- Google Sheets, Apps Script, 실제 학교 데이터 및 네트워크 API 호출 없음. 단, SUIT 웹폰트를 가져오려면 CDN 네트워크 요청이 발생할 수 있다.
- 예시 부원은 전부 가상이며 모든 저장·변경은 운영 기록에 반영되지 않는다.
- 실제 Apps Script 권한, 배포, 반응 속도 및 키오스크 브라우저 호환성은 로컬 미리보기로 검증할 수 없다.

### 검토할 화면

1. 가로 1920px 또는 도서관 PC 실제 해상도의 출석 화면에서 이름과 버튼 크기.
2. 1366px 노트북, 390px 스마트폰에서의 오버플로·메뉴 줄바꿈.
3. 관리자 로그인 후 출석관리·부원관리에서 검색, 진급 미리보기, 이력 점검.
4. 밝은 테마와 OS 다크 테마 각각에서 입력칸·표시 문구의 대비.
5. 폰트 로딩 실패 시에도 행 높이·버튼 폭이 비정상적으로 변하지 않는지.
6. 키보드 Tab 이동 및 모달 닫기 동작.

## 구현 상태

**1차 디자인 패스**다. 로컬 미리보기 생성·정적 구문 검사는 수행했지만 실제 Chrome/Edge 렌더링을 비교한 스크린샷 감사와 Apps Script 테스트 배포는 아직 해야 한다. 사용자의 시각적 피드백을 받은 다음 학생 메인 화면과 관리자 화면을 순차적으로 조정한다.
