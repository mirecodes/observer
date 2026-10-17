import { describe, expect, it } from "vitest";
import { parseListings } from "../src/parse";
import LIST from "./fixtures/list-20261017.html?raw";

const BASE = "https://www.woko.ch/unser-angebot/freie-objekte";

describe("parseListings on real fixture (2026-10-17)", () => {
  const listings = parseListings(LIST, BASE);

  it("finds every listing in oid-descending order", () => {
    expect(listings.map((l) => l.oid)).toEqual([586, 585, 584, 578, 562, 195, 186, 154, 124, 122, 121]);
  });

  it("parses all fields of the first listing (no Bewerben link)", () => {
    expect(listings[0]).toEqual({
      oid: 586,
      title: "tenant wanted (subtenant, then main tentant after)",
      badge: "Untermieter gesucht",
      availableFrom: "2026-11-03",
      availableRaw: "Ab 03.11.2026",
      address: "Am Wasser 6/15",
      place: "8600 Dübendorf",
      rentChf: 580,
      detailUrl: "https://www.woko.ch/unser-angebot/freie-objekte/detail?oid=586",
      applyUrl: undefined,
      category: "residential",
    });
  });

  it("resolves the Bewerben link and data-typ of a parking listing", () => {
    const l = listings[1]!;
    expect(l.category).toBe("parking");
    expect(l.badge).toBe("Nachmieter gesucht");
    expect(l.rentChf).toBe(30);
    expect(l.applyUrl).toBe(
      "https://www.woko.ch/service/mietservice/bewerbung-mietobjekt?oid=6056&aid=585&type=1&title=Tiefgaragen-Motorradparkplatz%20zu%20vermieten&d=2026-11-01&onr=",
    );
  });

  it("keeps umlauts from the source", () => {
    expect(listings.find((l) => l.oid === 121)?.title).toBe("Aussen Töffparkplatz zu vermieten");
  });
});

const block = (inner: string) => `<div class="crooms__elements"><div class="crooms__element js-hidden" data-typ="0">${inner}</div></div>`;

describe("parseListings edge cases", () => {
  it("decodes entities and normalizes whitespace", () => {
    const [l] = parseListings(
      block(`<h3 class="crooms__headline">\n  Gro&szlig;es Zimmer&nbsp;&amp;\n Balkon &#x28;Z&uuml;rich&#41;</h3>
        <strong> WG&nbsp;sucht </strong>
        <div class="crooms__text crooms__text--key">Wann</div><div class="crooms__text">\n Ab\n 01.02.2027 </div>
        <div class="crooms__text crooms__text--key">Ort</div><div class="crooms__text">8006 Z&uuml;rich</div>
        <span class="crooms__price crooms__price--value">1'250.-</span>
        <a href="detail?oid=900&amp;x=1" title="Detail">Detail</a>`),
      BASE,
    );
    expect(l).toMatchObject({
      oid: 900,
      title: "Großes Zimmer & Balkon (Zürich)",
      badge: "WG sucht",
      availableRaw: "Ab 01.02.2027",
      availableFrom: "2027-02-01",
      place: "8006 Zürich",
      rentChf: 1250,
      detailUrl: "https://www.woko.ch/unser-angebot/detail?oid=900&x=1",
    });
  });

  it("returns [] for a page without listings", () => {
    expect(parseListings("<html><body><p>Wartung</p></body></html>", BASE)).toEqual([]);
    expect(parseListings(LIST.slice(0, LIST.indexOf('<div class="crooms__elements">')), BASE)).toEqual([]);
  });

  it("skips broken blocks without failing the rest", () => {
    const html =
      block(`<h3 class="crooms__headline">no link</h3>`) +
      block(`<h3 class="crooms__headline">ok</h3><a href="detail?oid=7">Detail</a>`) +
      block(`<h3 class="crooms__headline">truncated <a href="detail?oid=`);
    expect(parseListings(html, BASE).map((l) => l.oid)).toEqual([7]);
  });

  it("ignores the no-data placeholder", () => {
    expect(parseListings(`<div class="crooms__element no-data js-hidden">Es wurde kein Eintrag gefunden.</div>`, BASE)).toEqual([]);
  });
});
