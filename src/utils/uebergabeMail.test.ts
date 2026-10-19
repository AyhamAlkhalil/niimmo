import { describe, it, expect } from "vitest";
import { istMailadresse, versandAuswerten } from "./uebergabeMail";

describe("versandAuswerten", () => {
  it("trennt angenommene von abgelehnten Adressen", () => {
    const antwort = { success: true, sentEmails: ["a@x.de"], failedEmails: [{ email: "b@x.de", error: "nicht zugestellt" }] };
    expect(versandAuswerten(antwort, ["a@x.de", "b@x.de"])).toEqual({ gesendet: ["a@x.de"], fehlgeschlagen: ["b@x.de"] });
  });

  it("meldet einen vollständigen Versand ohne Fehlschläge", () => {
    expect(versandAuswerten({ sentEmails: ["a@x.de", "b@x.de"], failedEmails: [] }, ["a@x.de", "b@x.de"])).toEqual({
      gesendet: ["a@x.de", "b@x.de"],
      fehlgeschlagen: [],
    });
  });

  it("nimmt bei einer Antwort ohne Liste alle nicht gescheiterten Adressen als versendet", () => {
    expect(versandAuswerten(null, ["a@x.de"])).toEqual({ gesendet: ["a@x.de"], fehlgeschlagen: [] });
    expect(versandAuswerten({ failedEmails: ["b@x.de"] }, ["a@x.de", "b@x.de"])).toEqual({
      gesendet: ["a@x.de"],
      fehlgeschlagen: ["b@x.de"],
    });
  });

  it("überspringt unbrauchbare Einträge", () => {
    expect(versandAuswerten({ sentEmails: ["a@x.de", 3, null], failedEmails: [{}, 7, { email: "b@x.de" }] }, [])).toEqual({
      gesendet: ["a@x.de"],
      fehlgeschlagen: ["b@x.de"],
    });
  });
});

describe("istMailadresse", () => {
  it.each(["a@b.de", " mieter.name@web.de ", "x+y@sub.firma.de"])("nimmt %s an", (a) => {
    expect(istMailadresse(a)).toBe(true);
  });

  it.each(["", "   ", "a@b", "@b.de", "a b@c.de", "a@b.de, c@d.de", "a@b.de\r\nBcc: x@y.de", null, undefined])(
    "lehnt %j ab",
    (a) => {
      expect(istMailadresse(a)).toBe(false);
    }
  );
});
