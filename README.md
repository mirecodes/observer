# woko-watch

여러 사이트를 5분마다 확인해서 새 항목이 올라오면 휴대폰으로 푸시(ntfy 또는 Pushover)를 보내는 Cloudflare Worker입니다. Cloudflare 서버에서 돌기 때문에 내 컴퓨터를 꺼도 계속 동작합니다. Cloudflare는 무료 플랜으로 충분합니다.

| 모듈 | 감시 대상 | 소스 | 알림 |
|---|---|---|---|
| `woko` | WOKO [Freie Objekte](https://www.woko.ch/unser-angebot/freie-objekte) | 목록 HTML | 새 거주용 매물 (아래 규칙) |
| `amiv` | [AMIV events](https://amiv.ethz.ch/en/events) | 공개 API | 🎉 새 이벤트: 제목·일시·장소·가격·신청 시작 시각 |
| `vis` | [VIS events](https://vis.ethz.ch/en/events/) | RSS | 🎉 새 이벤트: 제목·일시·장소 |

모듈마다 상태를 따로 저장하므로 한 사이트가 고장 나도 나머지는 계속 돕니다. 모듈별로 켜고 끄거나, **알림만 끄고 감지·상태 점검은 계속**하게 할 수 있습니다([7. 설정](#7-설정-바꾸기)).

WOKO 규칙:

- 입주 희망 구간에 맞는 방 → ⭐ 우선순위 최고(5) 알림
- 구간 밖 방 → 🏠 일반(3) 알림 (“입주일 협상 가능한지 문의해볼 만함”)
- 날짜를 못 읽은 방 → ⭐ 우선순위 5, “날짜 확인 필요”
- 주차장·상업 공간 → 알림 없음

### 🛠 점검 요청

정상 동작이 아니라고 판단되면 모듈별로 **🛠 점검 요청** 알림이 옵니다. 알림을 꺼 둔 모듈도 마찬가지입니다.

| 상황 | 언제 | 다시 요청 |
|---|---|---|
| 사이트 응답 오류, 파싱 결과 이상(WOKO 0건, 피드 형식 아님 등) | 연속 6회(약 30분) 실패 | 계속 실패하면 6시간마다 |
| 모듈 오류(잘못된 `cfg.yml` 값, 코드 버그) | 위와 같음 | 위와 같음 |
| 목록은 읽히는데 **새 항목이 `staleDays`일 동안 하나도 없음** (사이트가 바뀌어 새 항목을 놓치는 경우) | `staleDays` 경과 | `staleDays`마다 |

복구되면 **✅ 정상화** 알림이 옵니다. 기준값은 `cfgs/modules.yml`에서 바꿉니다.

## 준비물

- Node.js 20 이상 (`node -v`로 확인)
- 이 폴더에서 한 번: `npm install`

## 1. Cloudflare 가입 + 로그인

1. https://dash.cloudflare.com/sign-up 에서 무료 가입 (이메일 인증까지).
2. 터미널에서 이 폴더로 이동 후:
   ```sh
   npx wrangler login
   ```
   브라우저가 열리면 **Allow**를 누릅니다. `npx wrangler whoami`로 로그인 확인.

## 2. 상태 저장용 KV 만들기

```sh
npx wrangler kv namespace create STATE
```

출력에 이런 부분이 있습니다:

```
{
  "kv_namespaces": [
    { "binding": "STATE", "id": "0123456789abcdef0123456789abcdef" }
  ]
}
```

이 `id` 값을 복사해서 `wrangler.jsonc`의 `kv_namespaces` → `id` 자리에 붙여 넣습니다:

```jsonc
"kv_namespaces": [
  { "binding": "STATE", "id": "0123456789abcdef0123456789abcdef" }
],
```

## 3. 알림 채널 고르기

`cfgs/notifier.yml`의 `provider`로 고릅니다. 둘 중 하나만 설정하면 됩니다.

```yaml
provider: ntfy   # ntfy | pushover
```

| | ntfy | Pushover |
|---|---|---|
| 비용 | 무료 | 앱 1회 구매 $5 (플랫폼별, 30일 무료 체험) |
| 안정성 | 공개 서버, Workers IP 공유 때문에 토큰 필요 | 유료 서비스라 전달이 안정적 |
| 필요한 secret | `NTFY_TOPIC`, `NTFY_TOKEN` | `PUSHOVER_TOKEN`, `PUSHOVER_USER` |

비밀값은 `cfgs/`나 코드에 적지 말고 `npx wrangler secret put <이름>`으로만 넣습니다. 프롬프트 `Enter a secret value`에 값을 붙여 넣고 Enter. (처음이면 Worker를 만들지 묻는데 `Y`.) secret 등록은 재배포가 필요 없지만, `provider`를 바꾸면 배포해야 합니다.

### 3-A. ntfy

1. 휴대폰에 ntfy 앱 설치: [iOS](https://apps.apple.com/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)
2. 토픽 이름 정하기. **토픽 이름이 곧 비밀번호**입니다(ntfy.sh는 공개 서버라 이름을 아는 사람은 누구나 구독할 수 있음). 영문·숫자·`-`·`_`만, 64자 이하. 예:
   ```sh
   echo "woko-$(openssl rand -hex 12)"
   ```
3. 앱에서 **+** (Subscribe to topic) → 위 토픽 이름 입력 → Subscribe. iOS는 “시간 민감 알림”도 켜 두세요.
4. `npx wrangler secret put NTFY_TOPIC` → 토픽 이름 입력
5. **액세스 토큰 (필수에 가까움)**: ntfy.sh는 익명 요청을 IP 단위로 제한하는데, Workers는 IP를 공유해서 **토큰 없이는 `HTTP 429`로 막힙니다.**
   https://ntfy.sh/signup 에서 무료 계정 → https://ntfy.sh/account → **Access tokens** → **Create access token** (만료: Never) → `npx wrangler secret put NTFY_TOKEN` → `tk_...` 입력

### 3-B. Pushover

1. 휴대폰에 Pushover 앱 설치하고 https://pushover.net 에 가입·로그인 (같은 계정으로 앱 로그인).
2. 대시보드 첫 화면의 **Your User Key**(30자) 복사 → `npx wrangler secret put PUSHOVER_USER`
3. 대시보드 아래 **Create an Application/API Token** → 이름(예: woko-watch) 입력 → 생성된 **API Token/Key**(30자) 복사 → `npx wrangler secret put PUSHOVER_TOKEN`
4. `cfgs/notifier.yml`에서 `provider: pushover`로 바꾸고 배포.

우선순위는 자동 변환됩니다: 5·4 → Pushover high(1, 무음 시간 무시), 3 → normal(0), 2 → low(-1), 1 → lowest(-2). 알림음은 `pushover.sound`로 바꿀 수 있습니다. 링크 버튼이 하나뿐이라 WOKO의 “지원하기” 링크는 본문 끝에 붙습니다.

## 4. 배포

```sh
npx wrangler deploy
```

배포 때 `cfgs/*.yml`과 `src/modules/*/cfg.yml`을 검사해서 `gen/config.json`으로 묶어 넣습니다(`[custom build]` 줄). **설정이 잘못되면 배포가 멈추고** `config: ...` 오류로 어디가 틀렸는지 알려줍니다.

출력에 `https://woko-watch.<내-서브도메인>.workers.dev` 주소와 `schedule: */5 * * * *`가 보이면 성공입니다.
크론 반영까지 최대 15분 걸릴 수 있습니다. 처음 켜진 모듈마다 **“👀 <모듈> 감시 시작: 현재 N건”** 알림이 오면 정상입니다. 이때 이미 올라와 있던 항목은 알리지 않고, 그 뒤로 새로 올라오는 것만 알립니다. (이미 돌고 있던 WOKO는 기존 상태를 이어 쓰므로 시작 알림이 다시 오지 않습니다.)

## 5. 잘 돌고 있는지 확인

- 상태: 브라우저에서 `https://woko-watch.<내-서브도메인>.workers.dev/status`
  ```json
  {
    "WOKO": { "enabled": true, "notify": true, "ok": true, "lastOkAt": "2026-11-02T12:00:00.000Z", "lastNewAt": "2026-11-01T08:05:00.000Z", "consecutiveFailures": 0, "seenCount": 18, "unsent": 0 },
    "AMIV": { "...": "..." },
    "VIS":  { "...": "..." }
  }
  ```
  - `ok`: 켜진 모듈이 최근 2시간 안에 정상 확인됐고 실패가 쌓이지 않았으면 `true`. **하나라도 `false`면 HTTP 503**을 돌려줍니다.
  - `lastOkAt`: 마지막 정상 확인 시각(UTC, KV 쓰기를 아끼려고 1시간 단위로만 갱신). `lastNewAt`: 마지막으로 새 항목을 본 시각.
  - `unsent`: 알림 전송이 거부·실패해 재시도를 기다리는 항목 수. 0이 아니면 알림 채널이 막힌 상태이니 `npx wrangler tail`로 원인(예: `HTTP 401` → 토큰 재발급)을 확인하세요. 점검 요청도 같은 채널로 가기 때문에 이 경우는 푸시로 알려줄 수 없습니다.
- **크론 자체가 멈추는 경우**는 Worker가 스스로 알릴 수 없습니다. 필요하면 UptimeRobot 같은 무료 외부 모니터에 `/status` 주소를 등록하세요(503이면 알림).
- 실시간 로그: `npx wrangler tail` (Ctrl+C로 종료). 5분마다 실행 기록이 보입니다.
- 대시보드: Cloudflare 대시보드 → Workers & Pages → woko-watch → Logs / Metrics.

## 6. 폴더 구조

```
cfgs/                     전역 설정
  modules.yml             모듈 켜기/끄기, 알림 on/off, staleDays, 점검 기준
  notifier.yml            알림 채널(ntfy | pushover)과 채널 설정
src/
  index.ts                진입점: 켜진 모듈 실행, /status
  observers/              공통 코드
    observer.ts           엔진: 새 항목 판별, 상태 저장, 점검 요청·정상화, 요약 알림
    notify.ts             알림 형식 + 채널 스위치 (ntfy.ts, pushover.ts)
    state.ts  config.ts  fetchText.ts  html.ts
  modules/                감시 대상. 폴더 하나 = 모듈 하나
    index.ts              모듈 목록
    woko/  index.ts  cfg.yml  (+ 파서 등 전용 코드)
    amiv/  index.ts  cfg.yml
    vis/   index.ts  cfg.yml
scripts/build-config.mjs  yml 검사 → gen/config.json (배포·테스트 때 자동 실행)
```

## 7. 설정 바꾸기

모두 파일을 고친 뒤 `npx wrangler deploy`로 반영합니다.

- **모듈 켜기/끄기**: `cfgs/modules.yml`의 `modules.<이름>.enabled`.
- **알림만 끄기**: `notify: false`. 새 항목 감지·기록과 🛠 점검 요청은 계속됩니다.
- **새 항목 없음 점검 기준**: `staleDays` (빼면 끔).
- **점검 요청 기준**: `health.failuresBeforeAlert`, `health.realertHours`.
- **알림 채널 변경**: `cfgs/notifier.yml`의 `provider` ([3. 알림 채널](#3-알림-채널-고르기)).
- **WOKO 타깃 기간**: `src/modules/woko/cfg.yml`의 `targetFrom`, `targetTo` (`yyyy-mm-dd`, 양 끝 포함).
- **AMIV/VIS 알림 우선순위**: 각 `cfg.yml`의 `priority` (1~5).
- **실행 주기·일시 정지**: `wrangler.jsonc`의 `"crons"`. 정지는 `[]`, 재개는 `["*/5 * * * *"]`. (5분보다 짧게는 하지 마세요 — 상대 서버 부담)
- **비밀값 변경**: `npx wrangler secret put <이름>` 다시 실행 (재배포 불필요).
- **완전 삭제**: `npx wrangler delete` 후 `npx wrangler kv namespace delete --binding STATE` (또는 대시보드에서 KV 삭제).

로컬에서 시험해 보려면: `cp .dev.vars.example .dev.vars`(비밀값 수정) → `npx wrangler dev` → 다른 터미널에서 `curl "http://localhost:8787/cdn-cgi/local/scheduled"`.

### 새 모듈 추가

1. `src/modules/<이름>/index.ts`에서 `Module`을 default export: `name`, 겹치지 않는 `stateKey`, `create(cfg)` → 목록 가져오기(`fetch`), 고유 키(`id`), 알림 내용(`message`). `amiv/`가 가장 짧은 예시입니다.
2. 필요한 매개변수는 같은 폴더의 `cfg.yml`에.
3. `src/modules/index.ts`의 `MODULES`와 `cfgs/modules.yml`의 `modules`에 추가. (빠뜨리면 빌드·테스트가 실패해서 알려줍니다.)

## 8. 알려진 한계

- AMIV/VIS는 **새로 공개된 이벤트**만 알립니다. 이미 알린 이벤트의 시간·장소가 바뀌어도 다시 알리지 않습니다.
- **드물게 같은 알림이 두 번** 올 수 있습니다. Cloudflare KV가 최종 일관성 모델이라 직전 실행의 저장이 아직 안 보일 수 있기 때문입니다. 놓치는 것보다 낫다고 보고 허용합니다.
- **사이트가 개편되면 파서를 고쳐야** 합니다. 🛠 점검 요청이 오고, 기존 기록은 지우지 않으므로 고친 뒤에 기존 항목 알림이 쏟아지지 않습니다.
- 5분 주기라 최대 5분(+전달 지연) 늦게 알 수 있습니다.
- 알림 전송이 실패한 항목은 다음 실행(5분 뒤)에 다시 보냅니다.

## 개발

```sh
npm run check   # 설정 빌드 + 타입 체크 + 테스트 + wrangler deploy --dry-run
```

소스 조사 메모는 [docs/markup-notes.md](docs/markup-notes.md).
