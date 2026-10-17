import { describe, expect, it } from "vitest";
import { classifyCategory } from "../src/classify";

describe("classifyCategory", () => {
  it("uses data-typ when present", () => {
    expect(classifyCategory("0", "Tiefgaragenparkplatz")).toBe("residential"); // 구조 정보가 우선
    expect(classifyCategory("1", "Zimmer frei")).toBe("parking");
    expect(classifyCategory("2", "Zimmer")).toBe("commercial");
  });

  it("falls back to keywords without data-typ", () => {
    expect(classifyCategory(undefined, "Tiefgaragenparkplatz zu vermieten")).toBe("parking");
    expect(classifyCategory(undefined, "4 Aussen Töffparkplätze")).toBe("parking");
    expect(classifyCategory(undefined, "TOEFF Platz")).toBe("parking");
    expect(classifyCategory(undefined, "Veloraum")).toBe("parking");
    expect(classifyCategory(undefined, "Büro im EG")).toBe("commercial");
    expect(classifyCategory(undefined, "Atelier", "Nachmieter gesucht")).toBe("commercial");
    expect(classifyCategory(undefined, "Lagerraum")).toBe("commercial");
    expect(classifyCategory(undefined, "WG-Zimmer in Oerlikon", "Untermieter gesucht")).toBe("residential");
  });

  it("does not misfire on words that merely contain a keyword", () => {
    expect(classifyCategory(undefined, "Room near ETH, great for development students")).toBe("residential");
    expect(classifyCategory(undefined, "Zimmer, Schlager-Fan gesucht")).toBe("residential");
  });

  it("marks unknown data-typ without keywords as unknown (still notified)", () => {
    expect(classifyCategory("9", "Studio")).toBe("unknown");
    expect(classifyCategory("9", "Parkplatz")).toBe("parking");
  });
});
