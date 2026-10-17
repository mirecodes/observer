# woko-watch

WOKO [Freie Objekte](https://www.woko.ch/unser-angebot/freie-objekte) 페이지를 5분마다 확인해서, 새 **거주용** 매물이 올라오면 휴대폰으로 ntfy 푸시를 보내는 Cloudflare Worker입니다. Cloudflare 서버에서 돌기 때문에 내 컴퓨터를 꺼도 계속 동작합니다. 무료 플랜으로 충분합니다.

- 입주 희망 구간(기본 2027-01-01 ~ 2027-02-15)에 맞는 방 → ⭐ 우선순위 최고(5) 알림
- 구간 밖 방 → 🏠 일반(3) 알림 (“입주일 협상 가능한지 문의해볼 만함”)
- 날짜를 못 읽은 방 → ⭐ 우선순위 5, “날짜 확인 필요”
- 주차장·상업 공간 → 알림 없음
- 30분 넘게 사이트를 못 읽으면 ⚠️ 장애 알림, 복구되면 ✅ 복구 알림

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

이 `id` 값을 복사해서 `wrangler.jsonc`의 `REPLACE_WITH_KV_NAMESPACE_ID` 자리에 붙여 넣습니다:

```jsonc
"kv_namespaces": [
  { "binding": "STATE", "id": "0123456789abcdef0123456789abcdef" }
],
```

## 3. ntfy 앱 + 토픽 정하기

1. 휴대폰에 ntfy 앱 설치: [iOS](https://apps.apple.com/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)
2. 토픽 이름 정하기. **토픽 이름이 곧 비밀번호**입니다(ntfy.sh는 공개 서버라 이름을 아는 사람은 누구나 구독할 수 있음).
   - 영문·숫자·`-`·`_`만, 64자 이하
   - 추측하기 어려운 무작위 접미사를 붙이세요. 예를 들어 터미널에서:
     ```sh
     echo "woko-$(openssl rand -hex 12)"
     ```
     → `woko-3f9a1c...` 같은 값이 나옵니다. 이 값을 메모해 둡니다.
3. 앱에서 **+** (Subscribe to topic) → 위 토픽 이름 입력 → Subscribe.
   - iOS: 알림 권한 허용. 중요한 알림을 놓치지 않으려면 ntfy 앱 알림 설정에서 “시간 민감 알림”도 켜 두세요.

## 4. 토픽을 secret으로 등록

```sh
npx wrangler secret put NTFY_TOPIC
```

명령어의 `NTFY_TOPIC`은 secret **이름**이니 그대로 두고, `Enter a secret value` 프롬프트에 토픽 이름(값)을 붙여 넣고 Enter. (처음이면 Worker를 만들지 묻는데 `Y`.) 토픽은 코드·레포에 절대 적지 마세요.

### 4-1. ntfy 액세스 토큰 (필수에 가까움)

ntfy.sh는 익명 요청을 IP 단위로 제한하는데, Cloudflare Workers는 여러 사용자가 IP를 공유해서 **토큰 없이는 `HTTP 429`로 알림이 막힙니다.**

1. https://ntfy.sh/signup 에서 무료 계정 만들기 → 로그인
2. https://ntfy.sh/account → **Access tokens** → **Create access token** (만료: Never) → `tk_...` 값 복사
3. 등록:
   ```sh
   npx wrangler secret put NTFY_TOKEN
   ```
   프롬프트에 `tk_...` 값을 붙여 넣기. 재배포는 필요 없습니다.

## 5. 배포

```sh
npx wrangler deploy
```

출력에 `https://woko-watch.<내-서브도메인>.workers.dev` 주소와 `schedule: */5 * * * *`가 보이면 성공입니다.
크론 반영까지 최대 15분 걸릴 수 있습니다. 첫 실행 때 **“👀 WOKO 감시 시작: 현재 N건(거주용 M건)”** 알림이 오면 정상입니다. 이때 이미 올라와 있던 매물은 알리지 않고, 그 뒤로 새로 올라오는 것만 알립니다.

## 6. 잘 돌고 있는지 확인

- 상태: 브라우저에서 `https://woko-watch.<내-서브도메인>.workers.dev/status`
  ```json
  { "lastOkAt": "2026-10-17T10:00:00.000Z", "consecutiveFailures": 0, "seenCount": 11 }
  ```
  `lastOkAt`은 마지막 정상 확인 시각(UTC, KV 쓰기를 아끼려고 1시간 단위로만 갱신), `consecutiveFailures`가 0이면 정상.
- 실시간 로그: `npx wrangler tail` (Ctrl+C로 종료). 5분마다 실행 기록이 보입니다.
- 대시보드: Cloudflare 대시보드 → Workers & Pages → woko-watch → Logs / Metrics.

## 7. 설정 바꾸기

모두 `wrangler.jsonc`를 고친 뒤 `npx wrangler deploy`로 반영합니다.

- **타깃 기간 변경**: `vars`의 `TARGET_FROM`, `TARGET_TO` (`yyyy-mm-dd`, 양 끝 포함).
- **일시 정지**: `"crons": []`로 바꾸고 배포. 재개는 `["*/5 * * * *"]`로 되돌리고 배포. (5분보다 짧게는 하지 마세요 — 상대 서버 부담)
- **토픽 변경**: `npx wrangler secret put NTFY_TOPIC` 다시 실행 (재배포 불필요). 앱에서 새 토픽 구독.
- **완전 삭제**: `npx wrangler delete` 후 `npx wrangler kv namespace delete --binding STATE` (또는 대시보드에서 KV 삭제).

로컬에서 시험해 보려면: `cp .dev.vars.example .dev.vars`(토픽 수정) → `npx wrangler dev` → 다른 터미널에서 `curl "http://localhost:8787/cdn-cgi/local/scheduled"`.

## 8. 알려진 한계

- **드물게 같은 매물 알림이 두 번** 올 수 있습니다. Cloudflare KV가 최종 일관성 모델이라 직전 실행의 저장이 아직 안 보일 수 있기 때문입니다. 놓치는 것보다 낫다고 보고 허용합니다.
- **사이트가 개편되면 파서를 고쳐야** 합니다. 이 경우 매물을 0건으로 읽게 되고, 30분 뒤 ⚠️ 장애 알림이 옵니다(이후 6시간마다 재알림). 이때 기존 기록은 지우지 않으므로, 고친 뒤에 기존 매물 알림이 쏟아지지 않습니다.
- 5분 주기라 최대 5분(+ntfy 전달 지연) 늦게 알 수 있습니다.
- 알림 전송이 실패한 매물은 다음 실행(5분 뒤)에 다시 보냅니다.

## 개발

```sh
npm run check   # 타입 체크 + 테스트 + wrangler deploy --dry-run
```

마크업 조사 메모는 [docs/markup-notes.md](docs/markup-notes.md).
