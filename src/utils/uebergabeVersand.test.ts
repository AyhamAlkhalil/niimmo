import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  protokolleEinesVertrags,
  uebergabeDatumFuer,
  versandStand,
  versorgerStaende,
  type ProtokollAblesung,
  type VersandMail,
} from "./uebergabeVersand";

const V = "11111111-1111-4111-8111-111111111111";
const pdf = (titel: string | null, pfad: string, hochgeladen_am: string | null, dateityp: string | null = "application/pdf") => ({
  mietvertrag_id: V,
  titel,
  pfad,
  dateityp,
  hochgeladen_am,
});

describe("protokolleEinesVertrags", () => {
  const zeilen = [
    pdf("Übergabeprotokoll (Einzug) – 01.04.2026", `uebergabeprotokolle/${V}/Uebergabeprotokoll_Einzug_2026-04-01_100000.pdf`, "2026-04-01T10:00:00Z"),
    pdf("Übergabeprotokoll (Auszug) – 30.09.2026", `uebergabeprotokolle/${V}/Uebergabeprotokoll_Auszug_2026-10-01_120000.pdf`, "2026-10-01T12:00:00Z"),
    pdf("Übergabeprotokoll (Auszug) – 30.09.2026", `uebergabeprotokolle/${V}/Uebergabeprotokoll_Auszug_2026-10-02_090000.pdf`, "2026-10-02T09:00:00Z"),
    pdf("Zähler Strom (Auszug) – 30.09.2026", `zaehlerfotos/${V}/strom.jpg`, "2026-10-02T09:00:00Z", null),
    pdf("20250601 Protokoll.pdf", "1754000000000_20250601 Protokoll.pdf", "2025-08-04T09:00:00Z", null),
  ];

  it("listet nur PDFs, das zuletzt hochgeladene zuerst", () => {
    const { liste } = protokolleEinesVertrags(zeilen, null);
    expect(liste.map((p) => p.pfad)).toEqual([
      `uebergabeprotokolle/${V}/Uebergabeprotokoll_Auszug_2026-10-02_090000.pdf`,
      `uebergabeprotokolle/${V}/Uebergabeprotokoll_Auszug_2026-10-01_120000.pdf`,
      `uebergabeprotokolle/${V}/Uebergabeprotokoll_Einzug_2026-04-01_100000.pdf`,
      "1754000000000_20250601 Protokoll.pdf",
    ]);
    expect(liste[3].art).toBeNull();
  });

  it("wählt das jüngste der gewünschten Art vor — wie der Listenhinweis", () => {
    expect(protokolleEinesVertrags(zeilen, "auszug").vorauswahl).toBe(`uebergabeprotokolle/${V}/Uebergabeprotokoll_Auszug_2026-10-02_090000.pdf`);
    expect(protokolleEinesVertrags(zeilen, "einzug").vorauswahl).toBe(`uebergabeprotokolle/${V}/Uebergabeprotokoll_Einzug_2026-04-01_100000.pdf`);
  });

  it("nimmt ein ausdrücklich gewünschtes Protokoll, sonst das jüngste der Art", () => {
    expect(protokolleEinesVertrags(zeilen, "auszug", "1754000000000_20250601 Protokoll.pdf").vorauswahl).toBe("1754000000000_20250601 Protokoll.pdf");
    expect(protokolleEinesVertrags(zeilen, "auszug", "gibt-es-nicht.pdf").vorauswahl).toBe(`uebergabeprotokolle/${V}/Uebergabeprotokoll_Auszug_2026-10-02_090000.pdf`);
    expect(protokolleEinesVertrags([], "einzug")).toEqual({ liste: [], vorauswahl: null });
  });

  it("wählt keine andere Art vor, wenn die verlangte fehlt", () => {
    // Nur Einzug und Scan vorhanden, Auszug verlangt: nichts vorgewählt
    expect(protokolleEinesVertrags([zeilen[0], zeilen[4]], "auszug").vorauswahl).toBeNull();
    // Ein Scan ohne Art wird nicht stillschweigend als Einzug genommen
    expect(protokolleEinesVertrags([zeilen[4]], "einzug").vorauswahl).toBeNull();
    // Ohne verlangte Art: das jüngste
    expect(protokolleEinesVertrags(zeilen, null).vorauswahl).toBe(`uebergabeprotokolle/${V}/Uebergabeprotokoll_Auszug_2026-10-02_090000.pdf`);
  });

  it("zeigt eine doppelt eingetragene Datei einmal", () => {
    const doppelt = [zeilen[0], { ...zeilen[0], hochgeladen_am: "2026-04-02T10:00:00Z" }];
    const { liste } = protokolleEinesVertrags(doppelt, "einzug");
    expect(liste).toHaveLength(1);
    expect(liste[0].hochgeladenAm).toBe("2026-04-02T10:00:00Z");
  });
});

const ablesung = (zaehler_typ: string, stand: number | string | null, datum: string, protokoll_pfad: string | null, mietvertrag_id: string | null = V): ProtokollAblesung => ({
  zaehler_typ,
  stand,
  datum,
  protokoll_pfad,
  mietvertrag_id,
});

describe("uebergabeDatumFuer", () => {
  const p = { pfad: "a.pdf", titel: "Übergabeprotokoll (Auszug) – 30.09.2026", hochgeladenAm: "2026-10-01T12:00:00Z" };

  it("nimmt den Tag der Ablesungen dieses Protokolls", () => {
    expect(uebergabeDatumFuer(p, [ablesung("strom", 1, "2026-09-29", "a.pdf"), ablesung("gas", 2, "2026-09-29", "a.pdf")])).toEqual({ datum: "2026-09-29", quelle: "historie" });
  });

  it("nimmt den Titel, wenn die Ablesungen fehlen oder sich widersprechen", () => {
    expect(uebergabeDatumFuer(p, [])).toEqual({ datum: "2026-09-30", quelle: "titel" });
    expect(uebergabeDatumFuer(p, [ablesung("strom", 1, "2026-09-29", "a.pdf"), ablesung("gas", 2, "2026-09-28", "a.pdf")])).toEqual({ datum: "2026-09-30", quelle: "titel" });
    // Ablesungen eines anderen Protokolls zählen nicht
    expect(uebergabeDatumFuer(p, [ablesung("strom", 1, "2026-01-01", "b.pdf")]).quelle).toBe("titel");
  });

  it("fällt auf den Kalendertag des Hochladens in Ortszeit zurück, nicht auf den UTC-Tag", () => {
    // 23:30 UTC ist in Berlin schon der nächste Tag
    expect(uebergabeDatumFuer({ pfad: "x.pdf", titel: "Protokoll.pdf", hochgeladenAm: "2026-10-01T23:30:00Z" }, [])).toEqual({ datum: "2026-10-02", quelle: "hochgeladen" });
    expect(uebergabeDatumFuer({ pfad: "x.pdf", titel: null, hochgeladenAm: null }, [])).toBeNull();
  });
});

describe("versorgerStaende", () => {
  it("liest Strom, Gas und Kaltwasser des Protokolls mit Dezimalkomma ohne Tausenderpunkt", () => {
    const staende = versorgerStaende(
      [
        ablesung("strom", 15800.5, "2026-09-30", "a.pdf"),
        ablesung("kaltwasser", "456.20", "2026-09-30", "a.pdf"),
        ablesung("warmwasser", 12, "2026-09-30", "a.pdf"),
        ablesung("gas", 999, "2026-09-30", "anderes.pdf"),
      ],
      "a.pdf",
      V
    );
    expect(staende).toEqual({ strom: "15800,5", wasser: "456,2" });
  });

  it("nimmt bei mehreren Verträgen am Protokoll die Stände des eigenen", () => {
    const fremd = "22222222-2222-4222-8222-222222222222";
    expect(versorgerStaende([ablesung("strom", 1, "2026-09-30", "a.pdf", fremd), ablesung("strom", 2, "2026-09-30", "a.pdf", V)], "a.pdf", V)).toEqual({ strom: "2" });
  });

  it("lässt unlesbare und leere Stände weg — auch nur Leerzeichen, das wäre sonst 0", () => {
    expect(versorgerStaende([ablesung("strom", null, "2026-09-30", "a.pdf"), ablesung("gas", "x", "2026-09-30", "a.pdf")], "a.pdf", V)).toEqual({});
    expect(versorgerStaende([ablesung("strom", "   ", "2026-09-30", "a.pdf"), ablesung("gas", "", "2026-09-30", "a.pdf")], "a.pdf", V)).toEqual({});
  });

  it("übergeht Zählertypen, die wie Objekt-Schlüssel des Prototyps heißen", () => {
    const staende = versorgerStaende(
      [ablesung("__proto__", 1, "2026-09-30", "a.pdf"), ablesung("constructor", 2, "2026-09-30", "a.pdf"), ablesung("toString", 3, "2026-09-30", "a.pdf")],
      "a.pdf",
      V
    );
    expect(staende).toEqual({});
    expect(Object.keys(staende)).toEqual([]);
  });
});

describe("versandStand", () => {
  const versorger = [
    { typ: "strom", email: "strom@versorger.example" },
    { typ: "wasser", email: "wasser@versorger.example, zweite@versorger.example" },
  ];
  const mail = (teil: Partial<VersandMail>): VersandMail => ({
    status: "gesendet",
    empfaenger: [],
    gesendet_am: "2026-10-01T12:00:00Z",
    erstellt_am: "2026-10-01T11:59:00Z",
    fehler: null,
    nutzlast: null,
    ...teil,
  });

  it("liest Rollen und Ergebnis aus der nutzlast", () => {
    const s = versandStand(
      [
        mail({
          empfaenger: ["mieter@example.de", "kopie@example.de"],
          nutzlast: {
            empfaenger: [
              { email: "mieter@example.de", rolle: "mieter" },
              { email: "kopie@example.de", rolle: "cc" },
            ],
            zugestellt: ["mieter@example.de", "kopie@example.de"],
            abgelehnt: [],
          },
        }),
      ],
      ["mieter@example.de"],
      versorger
    );
    expect(s.mieter.adressen).toEqual(["mieter@example.de", "kopie@example.de"]);
    expect(s.mieter.beliefert).toBe(true);
    expect(s.mieter.am?.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    expect(s.benachrichtigt.size).toBe(0);
  });

  it("zählt eine angekommene CC-Kopie nicht als informierten Mieter", () => {
    const s = versandStand(
      [
        mail({
          empfaenger: ["mieter@example.de", "kopie@example.de"],
          fehler: "mieter@example.de: 550 mailbox unavailable",
          nutzlast: {
            empfaenger: [
              { email: "mieter@example.de", rolle: "mieter" },
              { email: "kopie@example.de", rolle: "cc" },
            ],
            zugestellt: ["kopie@example.de"],
            abgelehnt: ["mieter@example.de"],
          },
        }),
      ],
      ["mieter@example.de"],
      versorger
    );
    expect(s.mieter.adressen).toEqual(["kopie@example.de"]);
    expect(s.mieter.beliefert).toBe(false);
  });

  it("ordnet Altzeilen ohne nutzlast über die Adresse zu und liest den Fehlertext", () => {
    const s = versandStand(
      [
        mail({ empfaenger: ["Strom@Versorger.example"] }),
        mail({ empfaenger: ["wasser@versorger.example", "zweite@versorger.example"], fehler: "zweite@versorger.example: Mailbox full" }),
      ],
      [],
      versorger
    );
    expect(s.versorger.strom.adressen).toEqual(["Strom@Versorger.example"]);
    // Teilversand: Wasser ist erst benachrichtigt, wenn beide Adressen die Mail haben
    expect(s.versorger.wasser.adressen).toEqual(["wasser@versorger.example"]);
    expect([...s.benachrichtigt]).toEqual(["strom"]);
    expect(s.mieter.adressen).toEqual([]);
  });

  it("liest im Fehlertext nur ganze Adressen, keine Endstücke längerer", () => {
    const s = versandStand(
      [
        mail({
          empfaenger: ["mueller@x.de", "hans.mueller@x.de", "c@x.de"],
          fehler: "hans.mueller@x.de: 550 mailbox unavailable; C@X.DE: Mailbox full",
        }),
      ],
      ["mueller@x.de", "hans.mueller@x.de", "c@x.de"],
      []
    );
    // mueller@x.de ist zugestellt, obwohl „hans.mueller@x.de:“ im Fehlertext auf „mueller@x.de:“ endet
    expect(s.mieter.adressen).toEqual(["mueller@x.de"]);
    expect(s.mieter.beliefert).toBe(false);
  });

  it("sammelt über mehrere Versandläufe und nimmt den letzten Zeitpunkt", () => {
    const s = versandStand(
      [
        mail({ empfaenger: ["zweite@versorger.example"], gesendet_am: "2026-10-03T08:00:00Z", nutzlast: { empfaenger: [{ email: "zweite@versorger.example", rolle: "wasser" }], zugestellt: ["zweite@versorger.example"] } }),
        mail({ empfaenger: ["wasser@versorger.example"], gesendet_am: "2026-10-01T08:00:00Z", nutzlast: { empfaenger: [{ email: "wasser@versorger.example", rolle: "wasser" }], zugestellt: ["wasser@versorger.example"] } }),
      ],
      [],
      versorger
    );
    expect(s.benachrichtigt.has("wasser")).toBe(true);
    expect(s.versorger.wasser.am?.toISOString()).toBe("2026-10-03T08:00:00.000Z");
  });

  it("meldet abgebrochene Läufe als unklar und übergeht gescheiterte", () => {
    const s = versandStand(
      [mail({ status: "entwurf", empfaenger: ["mieter@example.de"] }), mail({ status: "fehler", empfaenger: ["mieter@example.de"] })],
      ["mieter@example.de"],
      versorger
    );
    expect(s.unklar).toBe(1);
    expect(s.mieter.adressen).toEqual([]);
    expect(s.mieter.beliefert).toBe(false);
  });
});

// ── send-uebergabe-email: Erlaubnisliste aus dem Bestand (28.10.2026) ─────────
const FUNCTION = readFileSync("supabase/functions/send-uebergabe-email/index.ts", "utf-8");

/** Holt eine Funktion samt Konstanten aus dem Deno-Quelltext, ohne Typangaben in der Signatur */
function ausQuelltext<T>(name: string, parameter: string, konstanten: string[]): T {
  const kopf = new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{`);
  const start = FUNCTION.search(kopf);
  expect(start).toBeGreaterThan(-1);
  const rumpfStart = FUNCTION.indexOf("{", start) + 1;
  const rumpfEnde = FUNCTION.indexOf("\n}\n", rumpfStart);
  const rumpf = FUNCTION.slice(rumpfStart, rumpfEnde);
  const kopfzeilen = konstanten.map((k) => {
    const zeile = FUNCTION.match(new RegExp(`const ${k} = (.+);`));
    expect(zeile, k).not.toBeNull();
    return `const ${k} = ${zeile![1]};`;
  });
  return new Function(`${kopfzeilen.join("\n")}\nreturn function ${name}(${parameter}) {${rumpf}\n};`)() as T;
}

describe("send-uebergabe-email: Anhang", () => {
  const anhangFormOk = ausQuelltext<(pfad: string) => boolean>("anhangFormOk", "pfad", ["PFAD_ZEICHEN"]);

  it("lässt die Pfadformen des Bestands zu — auch Scans und alte Namen mit Komma", () => {
    expect(anhangFormOk(`uebergabeprotokolle/${V}/Uebergabeprotokoll_Auszug_2026-10-01_142233.pdf`)).toBe(true);
    expect(anhangFormOk(`uebergabeprotokolle/${V}/Uebergabeprotokoll_Einzug_A_B, C_D_17-04-2026.pdf`)).toBe(true);
    expect(anhangFormOk("1754000000000_20250601 Protokoll Einzug.pdf")).toBe(true);
    expect(anhangFormOk(`${V}/1754000000000_Protokoll.PDF`)).toBe(true);
  });

  it("sperrt Pfadtricks, fremde Zeichen und andere Dateiarten", () => {
    for (const pfad of [
      "../geheim.pdf",
      `uebergabeprotokolle/${V}/../../mahnungen/x.pdf`,
      `uebergabeprotokolle/${V}/%2e%2e/x.pdf`,
      "a\\b.pdf",
      "/absolut.pdf",
      "a//b.pdf",
      "a/./b.pdf",
      "a/ /b.pdf",
      "bild.jpg",
      "umlaut-ü.pdf",
      "zeile\n.pdf",
      `${"a".repeat(510)}.pdf`,
      "",
    ]) {
      expect(anhangFormOk(pfad), pfad).toBe(false);
    }
  });

  it("prüft den Pfad gegen dokumente, bevor er heruntergeladen wird", () => {
    expect(FUNCTION).not.toMatch(/PROTOKOLL_PFAD|protokollErlaubt/);
    expect(FUNCTION).toMatch(/\.from\('dokumente'\)\s*\.select\('mietvertrag_id'\)\s*\.eq\('pfad', pfad\)\s*\.eq\('kategorie', 'Übergabeprotokoll'\)\s*\.eq\('geloescht', false\)\s*\.in\('mietvertrag_id', vertragIds\)/);
    const pruefung = FUNCTION.indexOf("await protokollVertrag(rollenClient, pdfPath, contractIds)");
    const download = FUNCTION.indexOf(".download(pdfPath)");
    expect(pruefung).toBeGreaterThan(-1);
    expect(download).toBeGreaterThan(pruefung);
    expect(FUNCTION).toMatch(/if \(!protokollVertragId\) return json\(\{ error: ANHANG_UNZULAESSIG \}, 403\);/);
  });

  it("hält Vertrag, Rollen und Ergebnis je Adresse im Mail-Protokoll fest", () => {
    expect(FUNCTION).toMatch(/mietvertrag_id: protokollVertragId,\s*nutzlast,/);
    expect(FUNCTION).toMatch(/\{ \.\.\.nutzlast, zugestellt: sentEmails, abgelehnt: failedEmails\.map\(\(f\) => f\.email\) \}/);
  });

  const rolleAus = ausQuelltext<(id: unknown, mieter: Set<string>) => string>("rolleAus", "mieterId, vertragsMieter", ["UUID"]);

  it("zählt eine Mieter-ID nur, wenn der Mieter zum Vertrag gehört", () => {
    const m = "33333333-3333-4333-8333-333333333333";
    expect(rolleAus(m, new Set([m]))).toBe("mieter");
    expect(rolleAus(m.toUpperCase(), new Set([m]))).toBe("mieter");
    expect(rolleAus(m, new Set())).toBe("unbekannt");
    expect(rolleAus("cc", new Set())).toBe("cc");
    expect(rolleAus("wasser", new Set())).toBe("wasser");
    expect(rolleAus("<script>", new Set())).toBe("unbekannt");
  });
});
