import { describe, it, expect } from "vitest";
import {
  berechneTilgungsplan,
  darlehenStand,
  faelligkeit,
  gehoertInZahlungsplan,
  gleicheMitKontoauszugAb,
  leseKontoauszugRate,
  summiereDarlehen,
  zahlungsplan,
  type DarlehenKonditionen,
} from "./darlehenBerechnung";

// Annuitätendarlehen der Sparkasse, Restschuld nach der Rate per 28.02.2026. Die Sollwerte stammen aus
// einer unabhängigen Nachrechnung mit Dezimalarithmetik; die Monate März bis September stehen so im
// Kontoauszug (Februar- und Aprilbuchung fehlen im Import).
const annuitaet: DarlehenKonditionen = {
  restschuld: 1783443.22,
  restschuld_stichtag: "2026-02-28",
  zinssatz_prozent: 4.07,
  monatliche_rate: 8314.32,
};
const KONTOAUSZUG = [
  { faellig: "2026-03-30", zins: 6048.84, tilgung: 2265.48 },
  { faellig: "2026-05-30", zins: 6033.45, tilgung: 2280.87 },
  { faellig: "2026-06-30", zins: 6025.72, tilgung: 2288.6 },
  { faellig: "2026-07-30", zins: 6017.95, tilgung: 2296.37 },
  { faellig: "2026-08-30", zins: 6010.16, tilgung: 2304.16 },
  { faellig: "2026-09-30", zins: 6002.35, tilgung: 2311.97 },
];
// Zweites Darlehen desselben Objekts
const zweites: DarlehenKonditionen = {
  restschuld: 315122.37,
  restschuld_stichtag: "2026-02-28",
  zinssatz_prozent: 1.34,
  monatliche_rate: 1120,
};
const endfaellig: DarlehenKonditionen = {
  restschuld: 345000,
  restschuld_stichtag: "2026-02-28",
  zinssatz_prozent: 4.07,
  monatliche_rate: 1170.13,
};
const HEUTE = "2026-10-22";

describe("faelligkeit", () => {
  it("ist der 30., im Februar der letzte Tag", () => {
    expect(faelligkeit(2026, 9)).toBe("2026-09-30");
    expect(faelligkeit(2026, 10)).toBe("2026-10-30");
    expect(faelligkeit(2026, 2)).toBe("2026-02-28");
    expect(faelligkeit(2028, 2)).toBe("2028-02-29");
  });
});

describe("berechneTilgungsplan", () => {
  it("trifft jede Buchung des Kontoauszugs auf den Cent", () => {
    const { raten } = berechneTilgungsplan(annuitaet, "2026-02-28");
    for (const b of KONTOAUSZUG) {
      const r = raten.find((x) => x.faellig === b.faellig);
      expect(r, b.faellig).toMatchObject({ zins: b.zins, tilgung: b.tilgung, rate: 8314.32 });
    }
  });

  it("trifft auch ein KfW-Darlehen mit 0,76 %", () => {
    const { raten } = berechneTilgungsplan(
      { restschuld: 642397.05, restschuld_stichtag: "2026-02-28", zinssatz_prozent: 0.76, monatliche_rate: 3630.33 },
      "2026-02-28",
    );
    expect(raten[0]).toMatchObject({ faellig: "2026-03-30", zins: 406.85, tilgung: 3223.48 });
    expect(raten[6]).toMatchObject({ faellig: "2026-09-30", zins: 394.58, tilgung: 3235.75, restschuld: 619789.78 });
  });

  it("beginnt mit der ersten Rate nach dem Stichtag", () => {
    expect(berechneTilgungsplan(annuitaet, "2026-02-28").raten[0].faellig).toBe("2026-03-30");
    expect(berechneTilgungsplan(annuitaet, "2026-09-15").raten[0].faellig).toBe("2026-09-30");
    expect(berechneTilgungsplan(annuitaet, "2026-09-30").raten[0].faellig).toBe("2026-10-30");
    expect(berechneTilgungsplan(annuitaet, "2026-10-31").raten[0].faellig).toBe("2026-11-30");
  });

  it("endet mit einer kleineren Schlussrate", () => {
    const plan = berechneTilgungsplan(
      { restschuld: 10000, restschuld_stichtag: "2026-01-31", zinssatz_prozent: 6, monatliche_rate: 2000 },
      "2026-01-31",
    );
    expect(plan.status).toBe("tilgt");
    expect(plan.raten).toHaveLength(6);
    expect(plan.raten[0]).toMatchObject({ faellig: "2026-02-28", zins: 50, tilgung: 1950, restschuld: 8050 });
    expect(plan.raten[5]).toEqual({ faellig: "2026-07-30", rate: 152.77, zins: 0.76, tilgung: 152.01, restschuld: 0 });
    expect(plan.restschuldAmEnde).toBe(0);
  });

  it("erkennt ein endfälliges Darlehen: die Rate deckt genau die Zinsen", () => {
    const plan = berechneTilgungsplan(endfaellig, "2026-02-28");
    expect(plan.status).toBe("nur_zins");
    expect(plan.raten[0]).toMatchObject({ zins: 1170.13, tilgung: 0, restschuld: 345000 });
  });

  it("rechnet keinen Plan, wenn die Rate die Zinsen nicht deckt", () => {
    const plan = berechneTilgungsplan({ ...endfaellig, monatliche_rate: 1000 }, "2026-02-28");
    expect(plan).toMatchObject({ status: "zins_nicht_gedeckt", raten: [], restschuldAmEnde: 345000 });
  });

  it("meldet eine Tilgung, die in 50 Jahren nicht fertig wird", () => {
    // 4,069 statt 4,07 %: 29 Cent Tilgung im Monat
    const plan = berechneTilgungsplan({ ...endfaellig, zinssatz_prozent: 4.069 }, "2026-02-28");
    expect(plan.status).toBe("zu_lang");
    expect(plan.raten).toHaveLength(600);
    expect(plan.raten[0].tilgung).toBe(0.29);
    expect(plan.restschuldAmEnde).toBe(344428.87);
  });

  it("endet am Laufzeitende und nennt die Restschuld dort", () => {
    const plan = berechneTilgungsplan({ ...annuitaet, ende_datum: "2031-03-31" }, "2026-02-28");
    expect(plan.status).toBe("tilgt");
    expect(plan.endetAmLaufzeitende).toBe(true);
    expect(plan.raten).toHaveLength(61);
    expect(plan.raten[60]).toMatchObject({ faellig: "2031-03-30", restschuld: 1630202.1 });
  });

  it("verlangt Restschuld, Zinssatz und Rate", () => {
    expect(berechneTilgungsplan({ ...annuitaet, monatliche_rate: null }, "2026-02-28").status).toBe("unvollstaendig");
    expect(berechneTilgungsplan({ ...annuitaet, monatliche_rate: 0 }, "2026-02-28").status).toBe("unvollstaendig");
    expect(berechneTilgungsplan({ ...annuitaet, zinssatz_prozent: null }, "2026-02-28").status).toBe("unvollstaendig");
    expect(berechneTilgungsplan({ ...annuitaet, restschuld: null }, "2026-02-28").status).toBe("unvollstaendig");
    expect(berechneTilgungsplan({ ...annuitaet, restschuld: 0 }, "2026-02-28").status).toBe("getilgt");
    // Eine Rate unter einem halben Cent ist keine Rate
    expect(berechneTilgungsplan({ ...annuitaet, zinssatz_prozent: 0, monatliche_rate: 0.004 }, "2026-02-28").status).toBe(
      "unvollstaendig",
    );
  });
});

describe("darlehenStand", () => {
  it("schreibt die Restschuld vom Stichtag bis heute fort", () => {
    const s = darlehenStand(annuitaet, HEUTE);
    expect(s.status).toBe("tilgt");
    expect(s.ohneStichtag).toBe(false);
    expect(s.restschuld).toBe(1767422.61);
    expect(s.faelligeRaten).toHaveLength(7);
    expect(s.naechsteRate).toEqual({ faellig: "2026-10-30", rate: 8314.32, zins: 5994.51, tilgung: 2319.81, restschuld: 1765102.8 });
    expect(s.getilgtAm).toBe("2058-02-28");
    expect(s.zinsenBisEnde).toBe(1367072.31);
    expect(s.restschuldAmLaufzeitende).toBeNull();
  });

  it("zählt die Rate am Fälligkeitstag als gezahlt", () => {
    expect(darlehenStand(annuitaet, "2026-10-29").naechsteRate?.faellig).toBe("2026-10-30");
    expect(darlehenStand(annuitaet, "2026-10-30").naechsteRate?.faellig).toBe("2026-11-30");
  });

  it("nimmt eine Restschuld ohne Stichtag als heutigen Stand", () => {
    const s = darlehenStand({ ...annuitaet, restschuld_stichtag: null }, HEUTE);
    expect(s.ohneStichtag).toBe(true);
    expect(s.restschuld).toBe(1783443.22);
    expect(s.naechsteRate?.faellig).toBe("2026-10-30");
    expect(s.naechsteRate?.zins).toBe(6048.84);
  });

  it("lässt die Restschuld eines endfälligen Darlehens stehen", () => {
    const s = darlehenStand(endfaellig, HEUTE);
    expect(s.status).toBe("nur_zins");
    expect(s.restschuld).toBe(345000);
    expect(s.naechsteRate).toMatchObject({ zins: 1170.13, tilgung: 0 });
    expect(s.getilgtAm).toBeNull();
    expect(s.zinsenBisEnde).toBeNull();
    expect(gehoertInZahlungsplan(s)).toBe(false);
  });

  it("rechnet ein endfälliges Darlehen mit Laufzeitende bis dorthin", () => {
    const s = darlehenStand({ ...endfaellig, ende_datum: "2030-12-31" }, HEUTE);
    expect(s.kommendeRaten).toHaveLength(51);
    expect(s.zinsenBisEnde).toBe(59676.63);
    expect(s.restschuldAmLaufzeitende).toBe(345000);
    expect(gehoertInZahlungsplan(s)).toBe(true);
  });

  it("meldet ein inzwischen getilgtes Darlehen", () => {
    const s = darlehenStand(
      { restschuld: 10000, restschuld_stichtag: "2026-01-31", zinssatz_prozent: 6, monatliche_rate: 2000 },
      HEUTE,
    );
    expect(s).toMatchObject({ status: "getilgt", restschuld: 0, naechsteRate: null, getilgtAm: "2026-07-30" });
  });

  it("zeigt bei fehlenden Angaben die gespeicherte Restschuld", () => {
    const s = darlehenStand({ ...annuitaet, zinssatz_prozent: null }, HEUTE);
    expect(s).toMatchObject({ status: "unvollstaendig", restschuld: 1783443.22, naechsteRate: null, zinsenBisEnde: null });
  });

  it("meldet ein abgelaufenes Laufzeitende mit der Restschuld von damals", () => {
    // Plan März bis Juni 2026, danach wäre die Restschuld fällig gewesen
    const s = darlehenStand({ ...annuitaet, ende_datum: "2026-06-30" }, HEUTE);
    expect(s).toMatchObject({
      status: "tilgt",
      restschuld: 1774335.11,
      restschuldAmLaufzeitende: 1774335.11,
      laufzeitAbgelaufen: true,
      naechsteRate: null,
      zinsenBisEnde: 0,
    });
    expect(s.faelligeRaten).toHaveLength(4);
  });

  it("kennt die Restschuld am Laufzeitende auch, wenn es vor der ersten Rate liegt", () => {
    for (const ende of ["2026-01-31", "2026-02-28"]) {
      const s = darlehenStand({ ...annuitaet, ende_datum: ende }, HEUTE);
      expect(s, ende).toMatchObject({
        restschuld: 1783443.22,
        restschuldAmLaufzeitende: 1783443.22,
        laufzeitAbgelaufen: true,
        zinsenBisEnde: 0,
      });
    }
  });

  it("nennt ein künftiges Laufzeitende, ohne es als abgelaufen zu melden", () => {
    const s = darlehenStand({ ...annuitaet, ende_datum: "2031-03-31" }, HEUTE);
    expect(s).toMatchObject({ restschuldAmLaufzeitende: 1630202.1, laufzeitAbgelaufen: false, getilgtAm: null });
  });

  it("gibt einem von Anfang an getilgten Darlehen null Zinsen", () => {
    expect(darlehenStand({ ...annuitaet, restschuld: 0 }, HEUTE)).toMatchObject({ status: "getilgt", zinsenBisEnde: 0 });
  });
});

describe("summiereDarlehen", () => {
  it("summiert Restschuld und nächste Rate eines Objekts", () => {
    const summe = summiereDarlehen([
      { stand: darlehenStand(annuitaet, HEUTE), monatliche_rate: 8314.32 },
      { stand: darlehenStand(zweites, HEUTE), monatliche_rate: 1120 },
    ]);
    expect(summe).toEqual({
      restschuld: 2077150.15,
      rate: 9434.32,
      zins: 6340.37,
      tilgung: 3093.95,
      ohneAufteilung: 0,
      ohneRestschuld: 0,
    });
  });

  it("zählt die Rate unvollständiger Darlehen mit, ohne sie aufzuteilen", () => {
    const summe = summiereDarlehen([
      { stand: darlehenStand(endfaellig, HEUTE), monatliche_rate: 1170.13 },
      { stand: darlehenStand({ ...zweites, zinssatz_prozent: null }, HEUTE), monatliche_rate: 1120 },
    ]);
    expect(summe).toEqual({
      restschuld: 660122.37,
      rate: 2290.13,
      zins: 1170.13,
      tilgung: 0,
      ohneAufteilung: 1120,
      ohneRestschuld: 0,
    });
  });

  it("rechnet nach abgelaufener Laufzeit die hinterlegte Rate weiter ein", () => {
    const summe = summiereDarlehen([{ stand: darlehenStand({ ...annuitaet, ende_datum: "2026-06-30" }, HEUTE), monatliche_rate: 8314.32 }]);
    expect(summe).toMatchObject({ restschuld: 1774335.11, rate: 8314.32, zins: 0, tilgung: 0, ohneAufteilung: 8314.32 });
  });

  it("zählt Darlehen ohne Restschuld", () => {
    const summe = summiereDarlehen([
      { stand: darlehenStand(annuitaet, HEUTE), monatliche_rate: 8314.32 },
      { stand: darlehenStand({ ...zweites, restschuld: null }, HEUTE), monatliche_rate: 1120 },
    ]);
    expect(summe).toMatchObject({ restschuld: 1767422.61, ohneRestschuld: 1, ohneAufteilung: 1120 });
  });

  it("zählt getilgte Darlehen nicht mehr", () => {
    const getilgt = darlehenStand(
      { restschuld: 10000, restschuld_stichtag: "2026-01-31", zinssatz_prozent: 6, monatliche_rate: 2000 },
      HEUTE,
    );
    expect(summiereDarlehen([{ stand: getilgt, monatliche_rate: 2000 }])).toMatchObject({ restschuld: 0, rate: 0 });
  });
});

describe("zahlungsplan", () => {
  const staende = [darlehenStand(annuitaet, HEUTE), darlehenStand(zweites, HEUTE)];

  it("fasst die Darlehen eines Objekts je Jahr zusammen", () => {
    const jahre = zahlungsplan(staende, "jahr");
    expect(jahre[0]).toEqual({
      schluessel: "2026",
      von: "2026-10-30",
      bis: "2026-12-30",
      rate: 28302.96,
      zins: 18994.89,
      tilgung: 9308.07,
      restschuld: 2067842.08,
    });
    expect(jahre[1]).toMatchObject({ schluessel: "2027", rate: 113211.84, zins: 75181.07, tilgung: 38030.77, restschuld: 2029811.31 });
    // Das zweite Darlehen endet im April 2054, das erste im Februar 2058
    const letztes = jahre[jahre.length - 1];
    expect(letztes).toMatchObject({ schluessel: "2058", von: "2058-01-30", bis: "2058-02-28", restschuld: 0 });
    expect(jahre.find((j) => j.schluessel === "2055")?.rate).toBe(99771.84);
  });

  it("zeigt je Monat die Summe der Raten und Restschulden", () => {
    const monate = zahlungsplan(staende, "monat");
    expect(monate[0]).toEqual({
      schluessel: "2026-10",
      von: "2026-10-30",
      bis: "2026-10-30",
      rate: 9434.32,
      zins: 6340.37,
      tilgung: 3093.95,
      restschuld: 2074056.2,
    });
  });

  it("lässt endfällige Darlehen ohne Laufzeitende weg", () => {
    expect(zahlungsplan([darlehenStand(endfaellig, HEUTE)], "jahr")).toEqual([]);
  });
});

describe("leseKontoauszugRate", () => {
  it("liest Zins, Tilgung und Fälligkeit aus dem Verwendungszweck", () => {
    expect(
      leseKontoauszugRate({
        buchungsdatum: "2026-09-30",
        betrag: -8314.32,
        verwendungszweck: "IBAN DE00 0000 0000 0000 0000 00RECHN.ZINS 6.002,35 TILG./ENTG. 2.311,97 TILGUNG PER 30.09.2026",
      }),
    ).toEqual({ buchungsdatum: "2026-09-30", faellig: "2026-09-30", rate: 8314.32, zins: 6002.35, tilgung: 2311.97 });
  });

  it("macht aus dem 30.02. der Bank das Monatsende", () => {
    const r = leseKontoauszugRate({
      buchungsdatum: "2026-02-27",
      betrag: -1305,
      verwendungszweck: "RECHN.ZINS 745,03 TILG./ENTG. 559,97 TILGUNG PER 30.02.2026",
    });
    expect(r.faellig).toBe("2026-02-28");
    expect(r.zins).toBe(745.03);
  });

  it("nimmt bei einem endfälligen Darlehen nur den Betrag", () => {
    expect(leseKontoauszugRate({ buchungsdatum: "2026-08-28", betrag: -1170.13, verwendungszweck: "IBAN DE00" })).toEqual({
      buchungsdatum: "2026-08-28",
      faellig: null,
      rate: 1170.13,
      zins: null,
      tilgung: null,
    });
  });
});

describe("gleicheMitKontoauszugAb", () => {
  it("bestätigt den Plan mit allen Buchungen seit dem Stichtag", () => {
    const buchungen = KONTOAUSZUG.map((b) => ({ buchungsdatum: b.faellig, rate: 8314.32, ...b }));
    // Die Buchung vor dem Stichtag zählt nicht mit
    buchungen.push({ buchungsdatum: "2026-01-30", faellig: "2026-01-30", rate: 8314.32, zins: 6064.13, tilgung: 2250.19 });
    expect(gleicheMitKontoauszugAb(darlehenStand(annuitaet, HEUTE), buchungen)).toEqual({
      geprueft: 6,
      bis: "2026-09-30",
      abweichung: null,
    });
  });

  it("findet die erste Rate, an der die Bank anders rechnet", () => {
    // Variabler Zins: ab Juli 2026 verlangt die Bank 546,19 € statt 524 €
    const variabel: DarlehenKonditionen = {
      restschuld: 55306.85,
      restschuld_stichtag: "2026-02-28",
      zinssatz_prozent: 3.934,
      monatliche_rate: 524,
    };
    const buchungen = [
      { buchungsdatum: "2026-03-30", faellig: "2026-03-30", rate: 524, zins: 181.31, tilgung: 342.69 },
      { buchungsdatum: "2026-06-30", faellig: "2026-06-30", rate: 524, zins: 177.93, tilgung: 346.07 },
      { buchungsdatum: "2026-07-30", faellig: "2026-07-30", rate: 546.19, zins: 192.75, tilgung: 353.44 },
      { buchungsdatum: "2026-08-28", faellig: "2026-08-30", rate: 546.19, zins: 191.49, tilgung: 354.7 },
    ];
    const abgleich = gleicheMitKontoauszugAb(darlehenStand(variabel, HEUTE), buchungen);
    expect(abgleich.geprueft).toBe(4);
    expect(abgleich.abweichung?.buchung.faellig).toBe("2026-07-30");
    expect(abgleich.abweichung?.plan).toMatchObject({ rate: 524, zins: 176.8, tilgung: 347.2 });
  });

  it("lässt Buchungen ohne Vermerk außen vor, wenn das Konto ihn sonst trägt, und zählt jede Rate einmal", () => {
    const buchungen = KONTOAUSZUG.map((b) => ({ buchungsdatum: b.faellig, rate: 8314.32, ...b }));
    // Sondertilgung zwei Tage vor einer Fälligkeit und dieselbe Septemberrate doppelt importiert
    buchungen.push({ buchungsdatum: "2026-08-28", faellig: null, rate: 50000, zins: null, tilgung: null });
    buchungen.push({ ...buchungen[5] });
    expect(gleicheMitKontoauszugAb(darlehenStand(annuitaet, HEUTE), buchungen)).toEqual({
      geprueft: 6,
      bis: "2026-09-30",
      abweichung: null,
    });
  });

  it("ordnet Buchungen ohne Fälligkeitsvermerk über das Buchungsdatum zu", () => {
    const buchungen = [
      { buchungsdatum: "2026-08-28", faellig: null, rate: 1170.13, zins: null, tilgung: null },
      { buchungsdatum: "2026-09-30", faellig: null, rate: 1170.13, zins: null, tilgung: null },
      { buchungsdatum: "2026-10-12", faellig: null, rate: 50, zins: null, tilgung: null },
    ];
    expect(gleicheMitKontoauszugAb(darlehenStand(endfaellig, HEUTE), buchungen)).toEqual({
      geprueft: 2,
      bis: "2026-09-30",
      abweichung: null,
    });
  });
});
