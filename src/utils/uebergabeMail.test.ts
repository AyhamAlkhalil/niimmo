import { describe, it, expect } from "vitest";
import { funktionsFehlertext, istMailadresse, mailadressen, versandAuswerten } from "./uebergabeMail";

describe("versandAuswerten", () => {
  it("trennt angenommene von abgelehnten Adressen", () => {
    const antwort = { success: true, sentEmails: ["a@x.de"], failedEmails: [{ email: "b@x.de", error: "nicht zugestellt" }] };
    expect(versandAuswerten(antwort, ["a@x.de", "b@x.de"])).toEqual({ gesendet: ["a@x.de"], fehlgeschlagen: ["b@x.de"], gruende: { "b@x.de": "nicht zugestellt" } });
  });

  it("meldet einen vollständigen Versand ohne Fehlschläge", () => {
    expect(versandAuswerten({ sentEmails: ["a@x.de", "b@x.de"], failedEmails: [] }, ["a@x.de", "b@x.de"])).toEqual({
      gesendet: ["a@x.de", "b@x.de"],
      fehlgeschlagen: [],
      gruende: {},
    });
  });

  it("nimmt bei einer Antwort ohne Liste alle nicht gescheiterten Adressen als versendet", () => {
    expect(versandAuswerten(null, ["a@x.de"])).toEqual({ gesendet: ["a@x.de"], fehlgeschlagen: [], gruende: {} });
    expect(versandAuswerten({ failedEmails: ["b@x.de"] }, ["a@x.de", "b@x.de"])).toEqual({
      gesendet: ["a@x.de"],
      fehlgeschlagen: ["b@x.de"],
      gruende: {},
    });
  });

  it("überspringt unbrauchbare Einträge", () => {
    expect(versandAuswerten({ sentEmails: ["a@x.de", 3, null], failedEmails: [{}, 7, { email: "b@x.de" }] }, [])).toEqual({
      gesendet: ["a@x.de"],
      fehlgeschlagen: ["b@x.de"],
      gruende: {},
    });
  });

  it("übernimmt den Grund je Adresse", () => {
    const antwort = { sentEmails: [], failedEmails: [{ email: "a@x.de", error: "Mailserver nicht erreichbar" }] };
    expect(versandAuswerten(antwort, ["a@x.de"]).gruende).toEqual({ "a@x.de": "Mailserver nicht erreichbar" });
  });
});

describe("istMailadresse", () => {
  it.each(["a@b.de", " mieter.name@web.de ", "x+y@sub.firma.de"])("nimmt %s an", (a) => {
    expect(istMailadresse(a)).toBe(true);
  });

  it.each(["", "   ", "a@b", "@b.de", "a b@c.de", "a@b.de, c@d.de", "a@b.de\r\nBcc: x@y.de", "bcc:b@y.de", "a@b.de(kommentar)", "a\u0000@x.de", null, undefined])(
    "lehnt %j ab",
    (a) => {
      expect(istMailadresse(a)).toBe(false);
    }
  );
});

describe("mailadressen", () => {
  it("teilt ein Feld mit mehreren Adressen auf", () => {
    expect(mailadressen("a@x.de, b@y.de")).toEqual(["a@x.de", "b@y.de"]);
    expect(mailadressen("a@x.de;b@y.de")).toEqual(["a@x.de", "b@y.de"]);
    expect(mailadressen(" a@x.de ")).toEqual(["a@x.de"]);
  });

  it("nimmt doppelte Adressen nur einmal", () => {
    expect(mailadressen("a@x.de, A@X.de")).toEqual(["a@x.de"]);
  });

  it.each(["", "  , ", "a@x.de, kaputt", "a@b.de\r\nBcc: x@y.de", "<a@x.de>", null, undefined])("lehnt %j ab", (feld) => {
    expect(mailadressen(feld)).toBeNull();
  });
});

describe("funktionsFehlertext", () => {
  it("liest die Meldung aus dem Body der Antwort", async () => {
    const fehler = { message: "non-2xx", context: { json: async () => ({ error: "Protokoll zu groß" }) } };
    expect(await funktionsFehlertext(fehler, "Ersatz")).toBe("Protokoll zu groß");
  });

  it("fällt ohne lesbaren Body auf den Ersatztext zurück", async () => {
    expect(await funktionsFehlertext({ context: { json: async () => { throw new Error("kein JSON"); } } }, "Ersatz")).toBe("Ersatz");
    expect(await funktionsFehlertext(null, "Ersatz")).toBe("Ersatz");
    expect(await funktionsFehlertext({ context: { json: async () => ({}) } }, "Ersatz")).toBe("Ersatz");
  });
});
