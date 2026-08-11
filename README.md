# STUDY — 적응형 자격시험 학습 플랫폼

문제를 많이 보여주는 사이트가 아니다.
**왜 틀리는지 찾아내고, 같은 개념을 다시 틀리지 않게 만드는 것**이 이 서비스의 목적이다.

매일 문제를 풀면 시스템이 풀이기록·정답률·풀이속도·확신도·반복학습 성과를 분석해
취약영역을 찾아내고, 다음 날 출제를 그 취약영역에 맞춰 자동으로 조정한다.

> **현재 지원 시험**: 제37회 공인중개사 제1차 (부동산학개론 / 민법 및 민사특별법)
> 2차·주택관리사 등으로 확장할 수 있도록 학습엔진과 시험 데이터를 분리해 두었다.

---

## 목차

- [핵심 개념](#핵심-개념)
- [기술 스택](#기술-스택)
- [실행 방법](#실행-방법)
- [화면 구성](#화면-구성)
- [학습 엔진](#학습-엔진)
- [데이터 구조](#데이터-구조)
- [기출·출처 관리 원칙](#기출출처-관리-원칙)
- [법령 업데이트 원칙](#법령-업데이트-원칙)
- [백업과 데이터 안전](#백업과-데이터-안전)
- [GitHub Pages 배포](#github-pages-배포)
- [시험 추가하기](#시험-추가하기)
- [로드맵](#로드맵)

---

## 핵심 개념

### 1. 정답률은 숙련도가 아니다

같은 "정답"이라도 의미가 다르다.

| 상황 | 시스템의 해석 |
| --- | --- |
| 확실함 + 정답 + 빠름 + 반복 성공 | 강한 숙련도 상승 |
| 찍음 + 정답 | 약한 보상. 복습 간격도 3일 이내로 묶어 둔다 |
| 헷갈림 + 오답 | 일반적인 오답 |
| **확실함 + 오답** | **가장 위험한 신호.** 점수에서 음수로 반영되고 복습 큐 최상단으로 올라간다 |

그래서 답을 고른 직후 확신도를 한 번 누르게 한다. 이 한 번의 탭이 취약영역 판정의 핵심 입력이다.

### 2. 세 개의 원이 모두 커야 합격이다

- **개념 이해** — 지금 아는가 (정답률)
- **장기 기억** — 시간이 지나도 남는가 (반복 정답률 · 기억 유지)
- **실전 대응** — 시험장 속도로 풀 수 있는가 (풀이속도 · 확신도 보정 · 모의고사)

세 영역이 모두 70점을 넘을 때만 "합격 안정영역"으로 표시한다.
정답률 80%에 기억 유지 40점이면 합격권이 아니다.

### 3. 문제는 매일 새로 생성하지 않는다

접속할 때마다 AI가 100문제를 즉석 생성하면 hallucination, 중복, 오답, 판례 왜곡,
법령 버전 오류가 그대로 학습자에게 간다.
대신 **검증된 문제은행에서** 그날의 학습 상태에 맞춰 100문제를 조합한다.
새 문제 생성은 브라우저가 아니라 별도의 content pipeline에서만 일어난다.

---

## 기술 스택

| 영역 | 선택 | 이유 |
| --- | --- | --- |
| UI | React 18 + TypeScript | |
| 빌드 | Vite 5 | |
| 라우팅 | React Router 6 (**hash 라우팅**) | GitHub Pages에 SPA rewrite가 없어 `/practice` 새로고침이 404가 된다 |
| 저장소 | IndexedDB (Dexie 4) | 서버·로그인 없이 오프라인에서 기록 유지 |
| 차트 | 의존성 없는 직접 작성 SVG | 번들 크기와 다크모드 제어 |
| PWA | vite-plugin-pwa (Workbox) | 오프라인 문제풀이 |
| 테스트 | Vitest + Testing Library + fake-indexeddb | |
| CI/CD | GitHub Actions → GitHub Pages | |

서버와 로그인은 MVP에 없다. 다만 `src/storage/types.ts`의 `StudyStorage` 인터페이스가
유일한 저장 경로이므로, 나중에 클라우드 동기화를 붙일 때 이 인터페이스만 구현하면 된다.

---

## 실행 방법

```bash
npm install

npm run dev          # 개발 서버 (http://localhost:5173)
npm run build        # 타입 검사 + 프로덕션 빌드 → dist/
npm run preview      # 빌드 결과 미리보기

npm run lint         # ESLint (경고도 실패로 처리)
npm run typecheck    # tsc --noEmit
npm run test         # Vitest (단위 + 사용자 플로우)

npm run validate:questions   # 문제은행 스키마·출처·법령 메타데이터 검사
npm run check:duplicates     # 동일 지문 중복 검사
npm run check:law-updates    # 법령 변경 감지 (기본은 리포트만)
npm run generate:daily-set   # 오늘의 세트 구성 미리보기 (CLI)

npm run verify       # lint + test + validate + duplicates + build 를 한 번에
```

빌드 시 `BASE_PATH` 환경변수로 배포 경로를 바꿀 수 있다(기본 `/study/`).

```bash
BASE_PATH=/ npm run build   # 루트 도메인에 배포할 때
```

---

## 화면 구성

| 경로 | 화면 | 핵심 |
| --- | --- | --- |
| `/` | 학습 Dashboard | D-Day, 오늘 진행률, 과목별 mastery, 3-circle 다이어그램, Topic Heatmap, 모의고사 추이, 오답 원인 분포, 오늘의 추천 한 문장 |
| `/practice` | 오늘의 100문제 | 세트 구성(버킷별 문항수) 표시, 집중 연습(취약개념/계산문제/확신 오답) |
| `/practice/:sessionId` | 문제풀이 | 진행률, 과목·대분류·소분류·난이도·출제형태·출처, 확신도, 즉시 채점, **선지별 해설(모든 선택지)**, 오답 원인, 암기카드 저장 |
| `/review` | 오답노트 · 암기카드 | 확신 오답 / 반복 오답 / 최근 오답 / 북마크 / 법령 검토 대상 필터, 목록 그대로 재도전 |
| `/weakness` | 취약영역 분석 | 우선순위 랭킹, 단원별 상세(정답률·최근 정답률·평균 풀이시간·틀린 횟수·복습일), 단원 집중 연습 |
| `/mock` | 실전 모의시험 | 과목별·전체 추이, 최근 3회/5회/전체 평균, 안정권 판정 |
| `/mock/:sessionId` | 실전 모드 | 타이머, 마킹, 답안지, 이전/다음, 즉시 채점·해설 **금지**, 종료 후 일괄 채점 |
| `/questions` | 문제은행 | 지문·선택지·해설·개념·법조문 전체 검색 |
| `/notes` | 개념노트 | 118개 개념 전체를 **짧은 버전 / 긴 버전** 두 길이로 열람, 과목 필터·전문 검색 |
| `/notes/:conceptId` | 개념 상세 | 해설의 `관련 개념`을 누르면 열린다. 한 줄 정의·요약·전문·비교표·함정·암기문장·법조문 + 내 정답률·확신 오답 + 이 개념 문항 목록 + 개념 집중 드릴 |
| `/updates` | 업데이트 | 법령·판례·시험정보 변경 이력, 검증 상태, 검토 대상 문항 |
| `/settings` | 설정 | 하루 목표, 확신도/오답원인 입력, 테마, **백업·복원·초기화** |

문제풀이와 모의시험 화면은 상·하단 내비게이션을 숨긴 집중 모드다.
선택지는 한 손으로 누를 수 있는 높이(최소 52px)이고, `선택 → 확신도 → 다음`이 3탭 안에 끝난다.

---

## 학습 엔진

모든 계산은 `src/learning/` 아래의 순수 함수다. ML은 쓰지 않는다 —
사용자에게 설명할 수 없는 점수는 학습에 쓸모가 없기 때문이다.

### Mastery Score (`learning/mastery/masteryScore.ts`)

```
숙련도 = 0.45 × 최근 정답률
       + 0.20 × 반복 복습 성공률
       + 0.10 × 풀이속도
       + 0.10 × 확신도 보정(calibration)
       + 0.15 × 최근성/기억유지
```

- 최근 8문항마다 가중치가 절반으로 줄어든다.
- 답 하나의 값: `확실함+정답 1.0` / `헷갈림+정답 0.85` / `찍음+정답 0.55` /
  `찍음+오답 0.05` / `헷갈림+오답 0.0` / **`확실함+오답 −0.35`**
- 표본이 적으면 점수를 보수적으로 축소한다. 한 문제 맞혔다고 80점이 되지 않는다.

가중치를 바꾸려면 `MASTERY_WEIGHTS` 한 곳만 고치면 된다.

### Spaced Repetition (`learning/spacedRepetition/schedule.ts`)

- 틀림 → 당일 4시간 뒤 재출제
- 맞힘 → `1 → 3 → 7 → 14 → 30 → 60`일 (ease로 후반 간격 조정)
- 다시 틀리면 사다리 맨 아래로. 누적 lapse가 있으면 이후 간격도 짧게 유지한다.
- 찍어서 맞힌 문제는 간격을 3일 이내로 묶는다.
- **시험일을 넘는 복습 일정은 만들지 않는다** (남은 기간의 절반으로 캡).

### 오늘의 세트 (`learning/scheduler/dailySet.ts`)

기본 비율(`exam.json`의 `selectionMix`):

| 버킷 | 비율 | 내용 |
| --- | --- | --- |
| 취약영역 | 40% | 숙련도가 낮은 개념을 가중 샘플링 |
| 복습 예정 | 25% | SRS 만기 도래 문항 (확신 오답이 큐 앞으로) |
| 전체 범위 | 15% | 최근 덜 다룬 단원부터 |
| 최근 오답 변형 | 10% | 틀린 문제 자체가 아니라 **같은 개념의 다른 문제** |
| 신규 문제 | 10% | 미출제 문항, 최신 법령 관련 우선 |

- 과목 배분은 50:50을 유지한다. 한 과목이 크게 약해도 과락은 항상 낮은 과목에서 나오기 때문이다.
  취약 가중치는 **각 과목 안에서** 작동한다.
- 같은 날 같은 세트가 나오도록 `(examId, 날짜, 사용자 salt)`로 시드를 고정한다.
  새로고침해도 100문제가 다시 섞이지 않는다.
- 과목을 번갈아 배치해 민법 50문제가 연속으로 나오지 않게 한다.
- `needsReview` 문항은 자동 제외된다.

### 시험 직전 모드 (`exam.json`의 `phases`)

| 구간 | 전략 |
| --- | --- |
| D-60 이상 | 개념 coverage + 신규 학습 |
| D-30 | 취약점 + 기출 비중 강화 |
| D-14 | 오답 + 빈출개념 + 계산문제, 신규 10문항 이하 |
| D-7 | 새 어려운 개념 최소화, 신규 5문항 이하, 난이도 4 이하 |
| D-3 | 최종 암기 · 반복 오답 · 법령 숫자 · 판례 키워드, 신규 0 |
| D-1 | 새 문제 없음, 핵심 오답노트 중심 |

임계값은 전부 데이터(`exam.json`)에 있다. 코드에 흩어진 숫자는 없다.

### 합격 판정 (`learning/scoring/mock.ts`)

`passRule` 기준: 과목별 40점 미만이면 과락, 전체 평균 60점 이상이어야 합격.
**평균이 높아도 한 과목이 과락이면 불합격**으로 판정한다.
"안정권"은 최근 3회가 모두 합격 기준을 넘고 3회 평균이 합격선+5점 이상일 때만 인정한다.
한 번 80점 맞았다고 안정권이 되지 않는다.

---

## 데이터 구조

```
src/
  app/          StudyProvider(전역 상태), AppShell, router
  components/   ThreeCircleDiagram, TopicHeatmap, LineChart, QuestionCard, ui
  features/     dashboard · practice · review · weakness · mock · questions · updates · settings
  learning/
    mastery/            masteryScore.ts, threeCircles.ts
    spacedRepetition/   schedule.ts
    scheduler/          dailySet.ts, phase.ts
    scoring/            mock.ts
    analytics/          stats.ts, weakness.ts
    recommendation.ts
    utils/              date.ts, random.ts
  storage/      StudyStorage 인터페이스 · Dexie 구현 · 메모리 구현 · 백업 마이그레이션
  exam/         types.ts, registry.ts, validation.ts

data/exams/real-estate-agent-1/
  exam.json          시험일·과목·문항수·시험시간·합격기준·출제비율·시험직전 전략
  taxonomy.json      과목 → 대분류 → 소분류 → 개념
  law-sources.json   추적 중인 법령과 마지막 확인 시점
  questions/*.json     문제은행 (주제별 분할)
  concept-notes/*.json 개념노트 (짧은 버전 + 긴 버전, 주제별 분할)
  updates/*.json     법령·판례·시험정보 변경 이벤트

scripts/
  validate-questions.ts   스키마·출처·법령 메타데이터 검증 (CI 게이트)
  check-duplicates.ts     동일 지문 중복 검사 (CI 게이트)
  check-law-updates.ts    법령 변경 감지 → needsReview 표시
  generate-daily-set.ts   세트 구성 CLI 미리보기
  generate-questions.ts   선택적 2패스 AI 생성 파이프라인

tests/          mastery · spacedRepetition · dailySet · mock · storage · questionBank · flow(E2E)
staging/        AI 생성 결과 대기 공간 (앱에 로드되지 않음)
```

### Question 스키마

```jsonc
{
  "id": "civ-gen-001",
  "examId": "real-estate-agent-1",
  "subjectId": "civil-law",
  "majorTopicId": "civ-general",
  "minorTopicId": "civ-gen-declaration",
  "conceptIds": ["c-fictitious", "c-third-party-bona-fide"],

  "question": "...",
  "passage": "...",              // 선택: 공통 지문
  "choices": ["...", "...", "...", "...", "..."],
  "answer": 3,                   // 0-based

  "explanation": "3~8줄. 이 문항이 무엇을 묻는지와 정답의 근거",
  "choiceExplanations": [        // 선택지와 같은 개수·같은 순서. 정답만이 아니라 모든 선지를 설명한다
    "① ...", "② ...", "③ ...", "④ ...", "⑤ ..."
  ],
  "memoryTip": "통정허위표시의 무효는 선의의 제3자에게 대항하지 못한다",
  "trap": "'선의 + 무과실'을 요구하는 선지는 오답",
  "calculationSteps": [          // 계산형 필수: 공식 → 대입 → 계산 → 시험장 요령
    { "label": "공식", "detail": "..." }
  ],

  "difficulty": 3,               // 1~5
  "questionType": "concept | case | calculation | precedent | statute | count",

  "sourceType": "generated",     // official_past_exam | adapted_past_exam | generated | generated_current_affairs
  "sourceExamYear": 2024,
  "sourceExamRound": 35,
  "sourceQuestionNumber": 12,
  "sourceTitle": "...",
  "sourceReference": "확인한 출처 URL 또는 인용",

  "verified": false,
  "verifiedAt": "2026-08-09",

  "lawReferences": [{ "law": "민법", "article": "제108조" }],
  "precedents": [{ "citation": "...", "holding": "..." }],
  "lawAsOf": "2026-08-09",
  "needsReview": false,
  "needsReviewReason": "...",

  "createdAt": "2026-08-09",
  "updatedAt": "2026-08-09"
}
```

CI가 강제하는 규칙: id 유일성, 선택지 4~6개·중복 없음, `answer` 범위, 해설 존재,
taxonomy 연결 정상, `sourceType` 유효, 공식 기출이면 출처 메타데이터 완비,
법령 문항이면 `lawReferences` + `lawAsOf` 존재, `choiceExplanations`가 있으면 선택지와 개수 일치,
**공식 기출은 모든 선지의 해설이 필수**이며 하나라도 빠지면 오류, JSON 스키마 오류 없음,
동일 지문 중복 없음, 지나치게 유사한 문항은 경고.
**검증 실패 시 배포되지 않는다.**

### ConceptNote 스키마

```jsonc
{
  "examId": "real-estate-agent-1",
  "conceptId": "c-apparent-agency",
  "headline": "한 문장 정의 — 이 개념이 무엇을 결정하는가",
  "summary": ["짧은 버전. 3~6줄, 각 줄이 따로 기억될 것"],
  "sections": [{ "heading": "제126조의 기본대리권", "body": ["긴 버전 본문"] }],
  "comparison": { "title": "...", "columns": ["구분", "A", "B"], "rows": [["...", "...", "..."]] },
  "traps": ["시험에 나오는 함정"],
  "mnemonics": ["암기 문장"],
  "lawReferences": [{ "law": "민법", "article": "제126조" }],
  "lawAsOf": "2026-08-09",
  "relatedConceptIds": ["c-unauthorized-agency"],
  "updatedAt": "2026-08-09"
}
```

짧은 버전과 긴 버전은 **각각 따로 작성한다.** 긴 노트를 줄이면 요약이 무의미해지고,
짧은 노트를 부풀리면 핵심이 묻히기 때문에 앱은 둘 사이를 자동 변환하지 않는다.
CI는 `conceptId`의 taxonomy 존재, 두 길이의 존재, 비교표의 열 수 일치,
법조문 인용 시 `lawAsOf` 존재, `relatedConceptIds` 링크 유효성을 검사하고,
**문항은 있는데 노트가 없는 개념**을 경고한다.

---

## 기출·출처 관리 원칙

전체 규칙은 [`docs/SOURCING.md`](docs/SOURCING.md)에 있다. 요약하면:

- Q-Net에서 공공누리 제1유형으로 개방한 공식 기출을 **AI 생성 문항보다 먼저 확충한다.**
- 공식 기출은 `2025년 기출`처럼 연도·회차·문항번호와 Q-Net 원문을 함께 표시한다.
- 학원·블로그·무료 문제은행은 누락 탐지와 교차검증에 활용하되, 별도 허락이 없는 자체 해설은 복제하지 않는다.
- 출처가 검증되지 않은 문항을 **절대 `기출`로 표시하지 않는다.** CI가 차단한다.
- 생성 문항은 화면에 **`AI 생성`**으로 명확히 표시한다.

> 현재 문제은행은 **166문항(2021~2025년 공식 기출 18문항 + 기존 AI 생성 148문항)**이다.
> 각 연도별 Q-Net 원문·최종정답 시드를 확보했으며, 2025년부터 최신순으로 회차별 80문항 완성을 진행한다.
> 수집 현황과 조사한 무료 공개 경로는 [`docs/PAST_EXAM_SOURCES.md`](docs/PAST_EXAM_SOURCES.md)에 기록한다.

---

## 법령 업데이트 원칙

민법 계열 문제의 가장 중요한 품질관리 지점이다.

**공식 출처 우선순위**
1. 국가법령정보센터 → 2. 대법원 종합법률정보 → 3. Q-Net → 4. 그 밖의 정부기관 공식자료

블로그·학원 자료는 법적 사실의 최종 근거로 사용하지 않는다.

**원칙: 자동 반영보다 검토 표시가 우선이다.**

```
law-sources.json → check-law-updates.ts → 변경 감지
                                        ├→ updates/ 에 이벤트 기록
                                        └→ 관련 문항 needsReview = true → 출제에서 자동 제외
                                                    ↓
                                        사람이 원문 대조 → 수정 → lawAsOf 갱신
```

`.github/workflows/law-check.yml`이 주 1회 실행되어 재확인이 필요하면 GitHub Issue를 연다.
기본 어댑터는 네트워크에 접근하지 않는 `manual` 모드다. 실제 자동 조회를 붙이려면
`scripts/check-law-updates.ts`의 `LawSourceAdapter` 인터페이스만 구현하면 된다.

---

## 백업과 데이터 안전

학습기록은 **이 브라우저의 IndexedDB에만** 저장된다. 브라우저 데이터를 지우면 사라진다.
`/settings`에서:

- **JSON 백업 내려받기** — 풀이기록·복습일정·모의시험·암기카드·설정 전부
- **복원** — 병합(기존 유지, 없는 것만 추가) 또는 덮어쓰기 선택
- **전체 초기화** — 확인 절차 후 삭제

백업 파일에는 `schemaVersion`이 들어 있고, 구버전 백업은 복원 시 자동 마이그레이션된다
(`src/storage/schema.ts`의 `BACKUP_MIGRATIONS`). 앱보다 최신 버전의 백업은
데이터 손실을 막기 위해 거부한다.

주기적으로 백업을 받아 두는 것을 권한다. 시험까지 몇 달치 기록이 쌓이는 데이터다.

---

## GitHub Pages 배포

1. **최초 1회는 사람이 켜야 한다.** 저장소 **Settings → Pages → Source**를
   **GitHub Actions**로 설정한다.

   워크플로에 `enablement: true`가 들어 있지만 `GITHUB_TOKEN`으로는 Pages 사이트를
   *생성*할 수 없다(`Create Pages site failed: Resource not accessible by integration`).
   토큰의 `pages: write`는 배포 권한이지 사이트 생성 권한이 아니다. 한 번 켜 두면
   이후 `configure-pages`는 기존 사이트를 그대로 사용하므로 다시 만질 일이 없다.

2. **기본 브랜치**에 push하면 `.github/workflows/deploy.yml`이 실행된다.
   lint → typecheck → test → 문제은행 검증 → 중복 검사 → build 순으로 진행되며,
   **하나라도 실패하면 배포되지 않는다.**
   (워크플로는 브랜치 이름을 고정하지 않고 `github.event.repository.default_branch`와
   비교하므로, 나중에 기본 브랜치를 `main`으로 바꿔도 수정할 필요가 없다.)
3. 배포 주소: `https://<owner>.github.io/<repo>/`

`BASE_PATH`는 워크플로에서 저장소 이름으로 자동 설정된다.
라우팅은 hash 방식이라 `#/practice` 같은 딥링크를 새로고침해도 404가 나지 않는다.

PWA로 설치하면 문제은행과 UI가 오프라인에서 동작하고, 학습기록도 오프라인에서 유지된다.

---

## 시험 추가하기

학습엔진은 시험을 모른다. 데이터만 추가하면 된다.

```
data/exams/real-estate-agent-2/
  exam.json         # 과목, 문항수, 시험시간, 합격기준, 출제비율, phases
  taxonomy.json     # 과목 → 대분류 → 소분류 → 개념
  law-sources.json  # 추적할 법령
  questions/*.json
  updates/*.json
```

`src/exam/registry.ts`가 `data/exams/*`를 자동으로 읽으므로 코드 수정은 필요 없다.
추가한 뒤 `/settings`에서 시험을 전환할 수 있다.

---

## 로드맵

**완료 (MVP)**
- 적응형 오늘의 100문제, 확신도 기반 mastery, spaced repetition
- 3-circle 다이어그램, Topic Heatmap, 취약영역 랭킹, 오답 원인 분석
- 실전 모의시험(타이머·마킹·일괄채점·과락 판정·추이)
- 오답노트, 암기카드, 문제은행 검색
- 모든 선택지에 대한 선지별 해설, 개념노트(짧은 버전/긴 버전) + 개념 상세 페이지
- IndexedDB 저장 + 백업/복원/초기화/마이그레이션, PWA, CI/CD

**다음**
1. **공식 기출 확충** — 현재 166문항 중 공식 기출 18문항(2021~2025). 각 연도의 1차 80문항을 Q-Net 문제지·최종정답으로 대조하며 최신순으로 완성한다.
2. **seed 문항 법령 검증** — 148문항의 조문 번호·판례 법리를 원문 대조하고 `verified`로 승격.
3. **법령 자동 조회 어댑터** — `LawSourceAdapter` 구현으로 수동 확인을 대체.
4. 문항별 학습 로그 CSV 내보내기, 클라우드 동기화(`StudyStorage` 구현 추가)

**하지 않을 것**
회원가입, 결제, SNS, 랭킹, 커뮤니티, 광고, 학습을 방해하는 게이미피케이션.
목표는 하나다 — 2026년 공인중개사 1차 합격. 서비스 개발이 공부 시간을 잡아먹지 않게 한다.
