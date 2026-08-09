# 문제 출처 · 법령 관리 원칙

이 문서는 문제은행에 무엇을 넣을 수 있고 무엇을 넣을 수 없는지에 대한 규칙이다.
CI(`npm run validate:questions`)가 이 규칙 중 기계적으로 검사 가능한 항목을 강제한다.

## 1. 절대 하지 않는 것

- **상업용 문제집·학원 교재·유료 문제은행의 문제나 해설을 복제하지 않는다.**
  구조나 개념을 참고하는 것과 문장을 옮기는 것은 다르다.
- **검증되지 않은 문항을 `official_past_exam`으로 표시하지 않는다.**
  이는 CI 오류(`official-verified`)로 차단된다.
- **법령이 바뀌었을 가능성이 있는데 그대로 두지 않는다.**
  자동 수정보다 `needsReview` 표시가 우선이다.

## 2. `sourceType` 의미

| 값 | 화면 표기 | 조건 |
| --- | --- | --- |
| `official_past_exam` | `기출` | 공식 기출을 그대로 옮긴 것. `verified: true`, `sourceExamYear`/`sourceExamRound`/`sourceQuestionNumber`/`sourceReference` 모두 필수 |
| `adapted_past_exam` | `기출 변형` | 공식 기출의 구조·아이디어만 차용하고 문장을 새로 쓴 것 |
| `generated` | `AI 생성` | 시험 유형에 맞춰 새로 작성한 것 |
| `generated_current_affairs` | `AI 생성 · 최신개정` | 최근 법령·판례 변경을 반영해 새로 작성한 것 |

현재 저장소의 모든 seed 문항은 `generated`이며 `verified: false`다.
정답·해설은 표준적인 교과 내용에 기초해 작성했으나 **1차 검증만 거친 상태**이므로,
특히 법령 숫자와 판례 법리는 반드시 원문을 대조한 뒤 `verified`/`verifiedAt`을 채운다.

## 3. 공식 출처 우선순위

1. **국가법령정보센터** (https://www.law.go.kr) — 법령 조문의 최종 근거
2. **대법원 종합법률정보** (https://glaw.scourt.go.kr) — 판례 식별정보와 법리
3. **Q-Net** (https://www.q-net.or.kr) — 시험 일정·과목·문항수·합격기준
4. 필요한 경우 그 밖의 정부기관 공식자료

블로그, 학원 요약글, 커뮤니티 게시물은 **법적 사실의 최종 근거로 사용하지 않는다.**
참고는 가능하지만 최종 확인은 반드시 위 1~4에서 한다.

## 4. 법령 문항에 반드시 남기는 것

```jsonc
{
  "lawReferences": [{ "law": "주택임대차보호법", "article": "제3조" }],
  "lawAsOf": "2026-08-09",   // 이 조문을 원문에서 확인한 날짜 (필수)
  "verified": false,          // 사람이 대조를 마치면 true
  "verifiedAt": "2026-08-09"  // verified가 true면 필수
}
```

`lawReferences`가 있는데 `lawAsOf`가 없으면 CI가 실패한다(`law-as-of`).
`questionType`이 `statute` 또는 `precedent`인데 근거가 없어도 실패한다(`law-reference`).

### 자주 개정되는 값은 문항으로 만들지 않는다

주택임대차보호법 시행령의 소액임차인 범위·최우선변제 금액,
상가건물 임대차보호법의 환산보증금 기준 등 **대통령령으로 정해지는 금액**은
개정이 잦다. 이런 숫자를 직접 묻는 문항을 추가할 때는 시행령 최신 개정본을 확인하고
`lawAsOf`를 갱신해야 하며, `law-sources.json`에도 해당 시행령을 등록한다.

## 5. 법령 변경 감지 흐름

```
law-sources.json (사람이 확인한 버전 기록)
        │
        ▼
scripts/check-law-updates.ts  ← 주 1회 GitHub Actions(law-check.yml)
        │
        ├─ 버전 변경 감지 → data/exams/<id>/updates/ 에 이벤트 기록
        │                   + 관련 문항 needsReview = true
        └─ 확인 기한 초과   → GitHub Issue로 재확인 요청
        │
        ▼
사람이 원문 대조 → 문항 수정 + lawAsOf 갱신 → needsReview 해제
```

`needsReview`가 켜진 문항은 앱의 오늘의 세트와 모의시험에서 **자동 제외**된다.
잘못된 법령을 가르치는 것보다 그 문항을 잠시 빼는 편이 낫기 때문이다.

기본 어댑터는 `manual`이며 네트워크에 접근하지 않는다. 공식 포털은 사용자별 API 키를
요구하므로, 실제 자동 조회를 붙이려면 `scripts/check-law-updates.ts`의
`LawSourceAdapter` 인터페이스만 구현하면 된다. 다른 파일은 고칠 필요가 없다.

## 6. AI 생성 파이프라인 (선택)

`npm run generate:questions`는 2패스 구조다.

1. **Generator** — 문항·선택지·정답·해설·개념·출처 작성
2. **Reviewer** — 다른 프롬프트로 독립 검토. 정답 오류, 복수정답 가능성,
   법령 outdated, 계산 오류, 애매한 지문, 기출 출처 허위표기, 지나치게 쉬움, 중복 확인

두 패스의 **정답 인덱스가 일치하지 않으면 자동으로 탈락**한다.
통과한 문항도 `data/`가 아니라 `staging/questions/`에 쌓이며,
사람이 법령 원문을 대조한 뒤에야 문제은행으로 옮긴다.

API 키는 프론트엔드에 넣지 않는다. 로컬 환경변수 또는 GitHub Actions Secret으로만 주입한다.

## 7. 중복 처리 기준

- **같은 지문 반복** → 제거 대상. `npm run check:duplicates`가 CI를 실패시킨다.
- **같은 개념을 다른 형태로 묻는 문항** → 적극 권장. 취약개념을 여러 각도에서
  드릴하는 것이 이 서비스의 핵심이므로 절대 제거하지 않는다.

판정은 같은 소분류 안에서 지문+선택지의 문자 bigram Dice 계수로 한다
(0.85 이상 = 중복, 0.72~0.85 = 확인 권장).
