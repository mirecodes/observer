# WOKO 목록 페이지 마크업 메모 (2026-10-17 조사)

원본: `test/fixtures/list-20261017.html` (`https://www.woko.ch/unser-angebot/freie-objekte`, HTTP 200, 43 KB),
상세: `test/fixtures/detail-586.html`.

## 렌더링 방식
서버 렌더링. 매물은 전부 HTML 안에 있다(클라이언트 렌더링 아님). 매물 11건(Zimmer 1, Parkplatz 10, Gewerbe 0).

## 매물 한 건의 구조
```html
<div class="crooms__elements">
  <div class="crooms__element js-hidden"
       data-region="Region&#x20;Z&uuml;rich" data-typ="0" data-property="5792"
       data-title="..." data-price="580" data-index="1">
    <h3 class="crooms__headline">제목</h3>
    <strong>Untermieter gesucht</strong>                       <!-- 배지 -->
    <div class="crooms__text crooms__text--key">Wann</div><div class="crooms__text">Ab 03.11.2026</div>
    <div class="crooms__text crooms__text--key">Adresse</div><div class="crooms__text">Am Wasser 6/15</div>
    <div class="crooms__text crooms__text--key">Ort</div><div class="crooms__text">8600 Dübendorf</div>
    <span class="crooms__price crooms__price--value">580.-</span>
    <a href="../unser-angebot/freie-objekte/detail?oid=586" title="Detail">Detail</a>
    <a href="../service/mietservice/bewerbung-mietobjekt?oid=6056&aid=585&type=1&title=...&d=2026-11-01&onr=" title="Bewerben">Bewerben</a>  <!-- 없을 수 있음 -->
  </div>
  ...
  <div class="crooms__element no-data js-hidden">Es wurde kein Eintrag gefunden für diese Suche.</div>  <!-- 자리표시, 무시 -->
</div>
<div class="crooms__paging">...</div>
```
- 링크는 `../` 상대 경로 → `LIST_URL` 기준으로 절대 URL 변환.
- Bewerben 링크 쿼리에는 공백·움라우트가 인코딩 없이 들어있다(`URL`이 인코딩해 줌). `aid`가 Detail의 `oid`와 같고, Bewerben의 `oid`는 건물(property) id다.
- `data-title` 등 속성값은 `&#x20;` 같은 엔티티로 인코딩되어 있고, 본문 텍스트는 UTF-8 그대로다.

## 매물 종류 — 구조적으로 알 수 있음
`data-typ` 속성 = 필터 폼 `<select name="so_typ">` 값: `0`=Zimmer, `1`=Parkplatz, `2`=Gewerbe.
→ 이것을 우선 사용. 속성이 없을 때만 키워드 휴리스틱. 알 수 없는 값(예: 3)이면 키워드로 판정, 안 걸리면 `unknown`(=알림).

## "Mehr anzeigen"
순수 클라이언트 페이징. 인라인 스크립트가 `new SearchObjects({ pageSize: 12, pageAppend: true, ... })`를 호출하고,
`searchObjects.min.js`(2.0)는 이미 HTML에 있는 `.crooms__element`를 보이기/숨기기만 한다(ajax/fetch/XHR 없음 확인).
모든 매물이 `js-hidden` 클래스로 들어있음 → **목록 페이지 1회 요청으로 전체 목록을 받는다.** 정렬에 의존하지 않는다.

## 지시서 관찰(2026-10-16) 재확인
- 정렬: Detail `oid` 내림차순 맞음 (586, 585, 584, 578, 562, 195, 186, 154, 124, 122, 121). 단, 구현은 정렬에 의존하지 않고 seen 집합을 쓴다.
- 날짜: `Ab dd.mm.yyyy` 맞음. Bewerben 링크의 `d=2026-11-01` ISO 날짜 맞음(Bewerben 없는 매물이 있어 `Wann`을 기준으로 씀).

## 상세 페이지 (참고)
`Wann` / `Bis`(종료일) / `Adresse` / `Miete` / 크기 / 연락처 등. 목록에 필요한 정보가 다 있어 매 실행 상세 요청은 하지 않는다.
상세 fixture에는 게시자 연락처(공개 게시물)가 들어있다 — 공개 저장소에 올릴 거면 지우거나 가린다(테스트에서 쓰지 않음).
