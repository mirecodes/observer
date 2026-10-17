# WOKO 새 매물 알림 Worker — 구현 지시서

이 문서는 Claude Code가 처음부터 끝까지 구현할 작업 지시서다. 끝까지 읽고 시작한다. 지시서와 실제 사이트·문서가 다르면 실제를 따르고, 무엇이 달랐는지 최종 보고에 적는다.

## 1. 목표

취리히 학생 주거 협동조합 WOKO의 매물 페이지를 5분마다 확인한다. 새 **거주용** 매물이 올라오면 사용자의 휴대폰으로 즉시 푸시 알림(ntfy)을 보낸다. WOKO는 사실상 선착순이라 속도와 신뢰성이 핵심이다.

- 대상 페이지: `https://www.woko.ch/unser-angebot/freie-objekte`
- 실행 환경: Cloudflare Workers 무료 플랜 + Cron Trigger + Workers KV
- 알림: ntfy (`https://ntfy.sh`, 공개 서버)
- 언어: TypeScript (strict). **React나 다른 UI 프레임워크는 쓰지 않는다.** 화면이 없는 백그라운드 작업이라 이점이 없고, 번들 크기와 CPU 시간만 늘어난다.

### 사용자 상황 (분류 기준의 근거)

현재 집 계약이 2027-01-28에 끝난다. 그래서 2027-01-01 ~ 2027-02-15에 입주 가능한 방이 핵심 타깃이다. 이 구간은 설정값으로 둔다(하드코딩 금지).

## 2. 범위 밖 (하지 말 것)

- UI, 대시보드, React, 프론트엔드 빌드
- 무거운 HTML 파서 런타임 의존성(cheerio, jsdom, linkedom 등). 무료 플랜의 Cron CPU 한도가 **호출당 10ms**라서 넘을 위험이 있다. 런타임 의존성은 0개가 목표다. `HTMLRewriter`(Workers 내장)나 범위를 좁힌 정규식을 쓴다.
- 매 실행마다 모든 상세 페이지를 가져오는 것. 목록 페이지 1회 요청이 기본이다.
- 5분보다 짧은 주기. 대상 서버에 부담을 주지 않는다.
- 자동 지원(폼 제출), 로그인, 개인정보 저장

## 3. 0단계 — 실제 마크업 조사 (코드 작성 전에 반드시)

추측으로 셀렉터를 만들지 않는다. 먼저 다음을 한다.

1. `curl`로 목록 페이지 원본 HTML을 받아 `test/fixtures/list-YYYYMMDD.html`로 저장한다. 하나 이상의 상세 페이지(`.../detail?oid=NNN`)도 `test/fixtures/detail-NNN.html`로 저장한다.
2. 다음을 확인하고 결과를 `docs/markup-notes.md`에 짧게 기록한다.
   - 매물 한 건을 감싸는 요소와 그 안의 필드 위치: 제목, 배지(예: "Untermieter gesucht", "Nachmieter gesucht"), `Wann`, `Adresse`, `Ort`, `Miete/Monat`, Detail 링크, Bewerben 링크(없는 매물도 있다)
   - **매물 종류(Zimmer / Parkplatz / Gewerbe)를 구조적으로 알 수 있는지**: data 속성, class, 필터 폼 값 등. 가능하면 그걸 쓰고, 불가능할 때만 키워드 휴리스틱으로 대체한다.
   - 하단의 **"Mehr anzeigen"(더 보기)**가 어떻게 동작하는지: 전부 HTML에 있고 CSS로 숨기는지, 추가 요청(XHR/쿼리 파라미터)으로 불러오는지. 추가 요청이면 그 엔드포인트로 전체 목록을 받을 수 있는지 확인한다. 첫 화면에만 의존한다면 새 매물이 항상 첫 화면에 나오는지(정렬 기준)를 근거와 함께 적는다.
   - 2026-10-16 기준 관찰: 목록은 Detail 링크의 `oid` 내림차순으로 보였다(586, 585, 584, 578, …). 날짜 표시는 `Ab 03.11.2026` 형식이다. Bewerben 링크의 쿼리에는 ISO 날짜(`d=2026-11-01`)가 있다. 이 관찰이 맞는지 원본으로 다시 확인한다.
3. 페이지 구조가 위 가정과 근본적으로 다르면(예: 클라이언트 렌더링이라 HTML에 매물이 없음) 구현을 멈추고 발견 내용과 대안을 보고한다.

## 4. 동작 명세

### 4.1 실행 흐름 (`scheduled` 핸들러, `*/5 * * * *`, UTC)

1. 목록 페이지를 가져온다. 15초 타임아웃(`AbortSignal.timeout`)을 걸고, 식별 가능한 `User-Agent`를 붙인다(예: `woko-watch/1.0 (personal notifier)`).
2. 파싱해서 `Listing[]`을 만든다.
3. KV에서 상태를 읽는다.
4. 처음 보는 `oid`를 골라내고 분류한다(4.3).
5. 알릴 매물에 대해 ntfy를 보낸다.
6. 상태를 갱신한다(4.4의 규칙을 반드시 지킨다).

### 4.2 데이터 모델

```ts
type Category = "residential" | "parking" | "commercial" | "unknown";
type Timing = "target" | "early" | "late" | "unknown";

interface Listing {
  oid: number; // Detail 링크의 oid. 고유 키
  title: string;
  badge?: string; // "Untermieter gesucht" 등
  availableFrom?: string; // ISO yyyy-mm-dd. 파싱 실패 시 undefined
  availableRaw: string; // "Ab 03.11.2026" 원문
  address?: string;
  place?: string; // "8600 Dübendorf"
  rentChf?: number; // "580.-" -> 580
  detailUrl: string; // 절대 URL
  applyUrl?: string; // Bewerben 링크(있을 때만), 절대 URL
  category: Category;
}
```

- HTML 엔티티와 공백을 정규화한다(`&amp;`, `&nbsp;`, 줄바꿈 등). 상대 URL은 절대 URL로 바꾼다.
- 필수 필드(`oid`, `detailUrl`, `title`)가 없는 블록은 버리고 경고 로그를 남긴다. 그 블록 때문에 실행 전체를 실패시키지 않는다.

### 4.3 분류

**종류(category)**

- 구조적 정보가 있으면 그것을 쓴다(0단계 결과).
- 없으면 제목과 배지로 판단하는 키워드 휴리스틱을 쓴다. 대소문자와 움라우트를 무시한다.
  - parking: `parkplatz`, `tiefgarage`, `garage`, `töff`/`toeff`, `motorrad`, `velo`
  - commercial: `gewerbe`, `büro`/`buero`, `lager`, `atelier`
  - 그 외는 `residential`
- **의심스러우면 알린다.** 거주용을 놓치는 비용(방을 놓침)이 잘못 알리는 비용(알림 1건)보다 훨씬 크다. `unknown`은 `residential`처럼 취급한다.

**입주 시기(timing)**: 설정값 `TARGET_FROM=2027-01-01`, `TARGET_TO=2027-02-15`(양 끝 포함)을 기준으로 한다.

- `availableFrom`이 구간 안이면 `target`, 이전이면 `early`, 이후면 `late`
- `Ab sofort`(즉시)는 `early`
- 날짜가 범위로 표기되면(예: `01.12.2026 - 31.01.2027`) 시작일 기준으로 판단하되, 원문을 알림에 그대로 보여준다.
- 파싱에 실패하면 `unknown`. 이때는 `target`과 같은 우선순위로 알리고 "날짜 확인 필요"를 표시한다.
- 날짜 계산은 문자열 `yyyy-mm-dd` 비교나 UTC 기준으로 한다. 로컬 타임존 때문에 하루가 밀리는 버그를 만들지 않는다.

### 4.4 상태와 중복 방지 (가장 결함이 생기기 쉬운 부분)

KV 키 하나(`state:v1`)에 JSON으로 저장한다.

```ts
interface State {
  version: 1;
  seen: Record<string, string>; // oid -> 처음 본 ISO 시각
  lastOkAt?: string;
  consecutiveFailures: number;
  lastHealthAlertAt?: string;
}
```

- **"최대 oid" 하나만 저장하는 방식은 쓰지 않는다.** 정렬이 바뀌거나 예전 oid가 다시 올라와도 동작하도록 본 oid 집합으로 관리한다.
- **첫 실행(상태 없음)**: 현재 목록 전체를 `seen`에 넣고, 매물별 알림은 보내지 않는다. 대신 "감시 시작: 현재 N건(거주용 M건)"이라는 낮은 우선순위 알림을 1건 보낸다.
- **알림 성공 후에만 seen에 추가한다.** ntfy 전송이 실패한 매물은 seen에 넣지 않아서 다음 실행에서 다시 시도되게 한다. 비거주용 매물은 알림 없이 바로 seen에 넣는다.
- **파싱 결과가 0건이면 상태를 절대 덮어쓰지 않는다.** 마크업이 바뀐 신호로 보고 실패로 처리한다(4.6). 빈 목록으로 seen을 정리하면, 나중에 기존 매물 전체를 새 매물로 오인해 알림이 폭주한다.
- 정리(prune): 목록에서 사라진 지 30일 넘은 oid만 seen에서 지운다. 목록에 아직 있는 oid는 지우지 않는다.
- KV 쓰기는 상태가 실제로 바뀐 실행에서만 한다. 무료 플랜의 쓰기 한도는 하루 1,000회이고, 5분 주기면 하루 288회 실행이다. `lastOkAt`만 바뀌는 경우에도 매번 쓰지 않도록, 예를 들어 1시간에 한 번만 갱신한다.
- KV는 최종 일관성(eventual consistency) 모델이라, 드물게 같은 매물 알림이 두 번 갈 수 있다. 이건 허용하고 README에 적는다. 놓치는 것보다 낫다.

### 4.5 알림 (ntfy)

- **JSON 방식으로 발행한다**: `POST {NTFY_SERVER}/`에 본문 `{ topic, title, message, priority, tags, click, actions }`를 보낸다. 제목에 한글과 움라우트가 들어가므로 HTTP 헤더 방식은 쓰지 않는다. 필드 이름은 공식 문서(docs.ntfy.sh/publish, "Publish as JSON")에서 확인한다.
- 매물 1건당 알림 1건을 보낸다. 그래야 탭했을 때 해당 Detail 페이지가 열린다. 한 실행에서 알릴 매물이 5건을 넘으면, 요약 알림 1건(목록 + 페이지 링크)으로 대신한다.
- 우선순위와 형식:
  - `target` / `unknown` → priority 5, 제목 `⭐ WOKO 새 매물 — 타이밍 맞음` (unknown이면 `⭐ WOKO 새 매물 — 날짜 확인 필요`)
  - `early` / `late` → priority 3, 제목 `🏠 WOKO 새 매물 (참고용)`. 본문 끝에 `입주일 협상 가능한지 문의해볼 만함` 한 줄을 붙인다.
  - 본문(줄 단위): 매물 제목 / 배지 / 📍 주소, 장소 / 💰 월세 CHF / 📅 입주 원문
  - `click`은 detailUrl로 한다. `actions`에는 `view` "상세" → detailUrl를 넣고, applyUrl이 있으면 `view` "지원하기" → applyUrl도 넣는다(최대 3개).
- 전송 실패(네트워크 오류, 2xx 아님)는 해당 매물만 실패로 처리하고 다음 매물로 넘어간다.

### 4.6 장애 감지

- 목록 요청 실패, 2xx가 아닌 응답, 파싱 결과 0건은 모두 "실패"로 처리한다. 이때 `consecutiveFailures`를 1 늘린다(이 증가분은 저장한다).
- 실패가 **연속 6회(약 30분)**에 이르면 장애 알림을 1건 보낸다(priority 4, `⚠️ WOKO 감시 이상`, 원인 요약 포함). 그 뒤로는 6시간에 한 번까지만 다시 보낸다.
- 성공하면 `consecutiveFailures`를 0으로 돌린다. 직전에 장애 알림을 보냈다면 `✅ WOKO 감시 복구` 알림을 1건 보낸다.
- 예외가 핸들러 밖으로 새어 나가지 않게 최상위에서 잡고, `console.error`로 남긴다.

### 4.7 HTTP 핸들러 (`fetch`)

- `GET /status`는 `{ lastOkAt, consecutiveFailures, seenCount }`만 JSON으로 돌려준다. 토픽 이름과 secret은 절대 노출하지 않는다.
- 그 외 경로는 404를 돌려준다. 외부에서 수동 실행을 트리거하는 엔드포인트는 만들지 않는다.

## 5. 설정

`wrangler.jsonc`(최신 Wrangler 형식)에 둔다.

- `triggers.crons: ["*/5 * * * *"]`
- KV 바인딩 `STATE`
- `vars`: `TARGET_FROM`, `TARGET_TO`, `NTFY_SERVER`(기본값 `https://ntfy.sh`), `LIST_URL`
- secret: `NTFY_TOPIC`. `wrangler secret put`으로만 설정한다. 로컬에서는 `.dev.vars`를 쓰고, 이 파일은 `.gitignore`에 넣는다. 토픽은 사실상 비밀번호라서 레포, 로그, 응답 어디에도 남기지 않는다.
- `compatibility_date`는 구현 당일 날짜로 한다.
- 설정값은 시작할 때 검증한다(날짜 형식, URL 형식). 잘못된 값이면 명확한 에러 로그를 남기고 종료한다.

## 6. 코드 구조

```
src/
  index.ts      # scheduled / fetch 핸들러. 조립만 담당
  config.ts     # env 검증 -> Config
  fetchList.ts  # 목록 요청 (타임아웃, UA)
  parse.ts      # HTML -> Listing[] (순수 함수)
  classify.ts   # category / timing (순수 함수)
  dates.ts      # "Ab 03.11.2026" 등 파싱 (순수 함수)
  state.ts      # KV 읽기·쓰기, diff, prune (KV 접근은 이 파일만)
  notify.ts     # ntfy 페이로드 생성(순수) + 전송
  types.ts
test/
  fixtures/     # 0단계에서 저장한 실제 HTML
  *.test.ts
README.md
docs/markup-notes.md
```

- 파싱, 분류, 날짜 처리, diff, 페이로드 생성은 I/O가 없는 순수 함수로 만들어서 단위 테스트한다.
- `tsconfig`은 `strict: true`, `noUncheckedIndexedAccess: true`로 한다. `any`는 쓰지 않는다. 타입은 `wrangler types`로 생성한 것을 쓴다.

## 7. 테스트 (모두 통과해야 완료)

Vitest와 `@cloudflare/vitest-pool-workers`를 쓴다(최신 설정 방법은 공식 문서에서 확인한다).

- **parse**: 실제 fixture에서 매물 수, 첫 매물의 모든 필드, Bewerben 링크가 없는 매물, 엔티티/움라우트 처리. 매물이 0건인 HTML, 깨진 HTML.
- **dates**: `Ab 03.11.2026`, `Ab sofort`, 범위 표기, 잘못된 날짜(31.02.2027), 공백·줄바꿈이 섞인 경우. 구간 경계일(01.01.2027, 15.02.2027, 16.02.2027).
- **classify**: 주차/상업/거주/애매한 제목
- **state 시나리오**(KV는 테스트 바인딩 사용, ntfy는 `fetch` 모킹):
  1. 첫 실행 → 매물별 알림 0건, 시작 알림 1건, seen 채워짐
  2. 변화 없음 → 알림 0건, KV 쓰기 없음
  3. 거주용 새 매물 1건(target) → priority 5 알림 1건, seen에 추가
  4. 주차장만 새로 생김 → 알림 0건, seen에 추가
  5. ntfy 실패 → seen에 추가되지 않음. 다음 실행에서 재전송되고 성공함
  6. 파싱 0건 → 상태가 보존되고 실패 카운트만 증가. 6회째에 장애 알림, 7회째엔 알림 없음, 이후 성공 시 복구 알림
  7. 새 매물 6건 → 요약 알림 1건
- `tsc --noEmit`, 테스트, `wrangler deploy --dry-run`이 모두 통과해야 한다.
- 로컬 통합 확인: `wrangler dev` 실행 후 `curl "http://localhost:8787/cdn-cgi/local/scheduled"`로 cron을 흉내 내서 실제 페이지로 한 번 돌려본다(엔드포인트는 현재 문서에서 확인).

## 8. README.md (사용자용, 한국어)

사용자는 Cloudflare를 처음 쓴다. 그대로 따라 하면 되도록 단계별로 쓴다.

1. Cloudflare 가입 → `npx wrangler login`
2. `npx wrangler kv namespace create STATE` → 출력된 id를 `wrangler.jsonc`에 넣는 방법
3. ntfy 앱 설치(iOS/Android) → 추측하기 어려운 토픽 이름 정하기(영문·숫자·`-`·`_`만, 64자 이하, 무작위 접미사) → 앱에서 구독
4. `npx wrangler secret put NTFY_TOPIC`
5. `npx wrangler deploy` → 첫 cron 실행 후 "감시 시작" 알림이 오는지 확인(트리거 반영에 최대 15분)
6. 확인 방법: `/status`, `npx wrangler tail`로 로그 보기
7. 설정 바꾸기: 타깃 기간 변경, 일시 정지(크론 비우고 배포), 삭제
8. 알려진 한계: KV 일관성 때문에 드문 중복 알림, 사이트 개편 시 파서 수정 필요(장애 알림으로 알 수 있음)

## 9. 완료 기준 체크리스트

- [ ] 0단계 조사 결과가 `docs/markup-notes.md`에 있고, fixture가 실제 HTML이다
- [ ] 런타임 의존성 0개, React 없음
- [ ] 7장의 모든 테스트 통과, `tsc` 에러 0개
- [ ] 4.4의 규칙 4개(seen 집합, 알림 성공 후 추가, 0건이면 덮어쓰지 않기, 변화 있을 때만 쓰기)를 지키고 테스트로 증명함
- [ ] secret이 레포, 로그, 응답에 없음 (`git grep`으로 확인)
- [ ] README만 보고 배포할 수 있음
- [ ] 최종 보고: 무엇을 만들었는지, 지시서와 다르게 한 점과 그 이유, 사용자가 해야 할 남은 단계
