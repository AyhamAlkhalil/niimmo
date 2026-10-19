import { describe, it, expect } from "vitest";
import { versandAuswerten } from "./uebergabeMail";

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
