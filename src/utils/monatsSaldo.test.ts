import { describe, expect, it } from 'vitest';
import { monatsSaldo } from './monatsSaldo';
import { berechneMietkontostand } from './rueckstandsberechnung';

const vertraege = [
  { id: 'a', status: 'aktiv', start_datum: '2024-01-01', kaltmiete: 400, betriebskosten: 100 },
  { id: 'b', status: 'aktiv', start_datum: '2024-01-01', kaltmiete: 400, betriebskosten: 100 },
];
const miete = (id: string, monat: string, betrag = 500) => ({
  mietvertrag_id: id, sollmonat: `${monat}-01`, sollbetrag: betrag, faelligkeitsdatum: `${monat}-08`, typ: 'Miete',
});
const zahlung = (id: string | null, betrag: number, buchungsdatum: string, kategorie = 'Miete') => ({
  mietvertrag_id: id, betrag, buchungsdatum, kategorie, zugeordneter_monat: buchungsdatum.slice(0, 7),
});
const am10Okt = new Date(2026, 9, 10);
const am3Okt = new Date(2026, 9, 3);

describe('monatsSaldo', () => {
  it('ergibt Eingang + Noch offen = Soll-Miete', () => {
    const r = monatsSaldo(vertraege, [miete('a', '2026-10'), miete('b', '2026-10')], [zahlung('a', 300, '2026-10-02')], am10Okt);
    expect(r).toMatchObject({ soll: 1000, eingang: 300, offen: 700, aelter: 0, vertraegeOffen: 2 });
    expect(r.eingang + r.offen).toBe(r.soll);
  });

  it('verrechnet die Überzahlung eines Mieters nicht mit dem Rückstand eines anderen', () => {
    // 27.10.2026: Gesamt-Soll minus Gesamt-Eingang zeigte „Mehr eingegangen“ trotz Rückständen
    const r = monatsSaldo(vertraege, [miete('a', '2026-10'), miete('b', '2026-10')], [zahlung('a', 1000, '2026-10-01')], am10Okt);
    expect(r).toMatchObject({ soll: 1000, eingang: 500, offen: 500, vertraegeOffen: 1 });
  });

  it('zählt die im Vormonat vorausgezahlte Miete als Eingang', () => {
    // 29.10.2026: Am 26.09. gezahlt, von der DB dem September zugeordnet — bis dahin „offen“
    const r = monatsSaldo([vertraege[0]], [miete('a', '2026-09'), miete('a', '2026-10')], [
      zahlung('a', 500, '2026-08-26'),
      zahlung('a', 500, '2026-09-26'),
    ], am3Okt);
    expect(r).toMatchObject({ soll: 500, eingang: 500, offen: 0, aelter: 0 });
  });

  it('lässt eine Nachzahlung zuerst den älteren Rückstand tilgen (§ 366 Abs. 2 BGB)', () => {
    const r = monatsSaldo([vertraege[0]], [miete('a', '2026-08'), miete('a', '2026-09'), miete('a', '2026-10')], [
      zahlung('a', 500, '2026-10-02'),
    ], am10Okt);
    // August und September offen (1.000), Oktober bezahlt 500 → Oktober bleibt offen, August/September 500 älter
    expect(r).toMatchObject({ soll: 500, eingang: 0, offen: 500, aelter: 500, vertraegeAelter: 1 });
  });

  it('nimmt als Soll die Forderungen des Monats (ohne BKA), sonst die Sollstellung des Vertrags', () => {
    // a: anteiliger Einzugsmonat und Gebühr; b: Sollstellung noch nicht gelaufen (1. vor 05:00 UTC)
    const r = monatsSaldo(
      vertraege,
      [
        { mietvertrag_id: 'a', sollmonat: '2026-10-01', sollbetrag: '258.06', faelligkeitsdatum: '2026-10-16', typ: 'Miete' },
        { mietvertrag_id: 'a', sollmonat: '2026-10-01', sollbetrag: 7.5, faelligkeitsdatum: '2026-10-02', typ: 'Miete' },
        { mietvertrag_id: 'a', sollmonat: '2025-12-01', sollbetrag: 300, faelligkeitsdatum: '2026-11-20', typ: 'BKA' },
      ],
      [],
      new Date(2026, 9, 1, 3)
    );
    expect(r.soll).toBe(765.56);
    expect(r.offen).toBe(765.56);
    expect(r.aelter).toBe(0);
  });

  it('zählt Rücklastschriften mindernd, Kaution und fremde Verträge nicht', () => {
    const r = monatsSaldo(vertraege, [miete('a', '2026-10'), miete('b', '2026-10')], [
      zahlung('a', 500, '2026-10-01'),
      zahlung('a', -500, '2026-10-05', 'Rücklastschrift'),
      zahlung('b', 1500, '2026-10-01', 'Mietkaution'),
      zahlung('x', 999, '2026-10-01'),
      zahlung(null, 50, '2026-10-01'),
    ], am10Okt);
    expect(r).toMatchObject({ soll: 1000, eingang: 0, offen: 1000, vertraegeOffen: 2, zahlungenImMonat: 2 });
  });

  it('rechnet Cent-genau ohne Fließkommareste', () => {
    const r = monatsSaldo([vertraege[0]], [
      { mietvertrag_id: 'a', sollmonat: '2026-10-01', sollbetrag: 0.1, faelligkeitsdatum: '2026-10-08' },
      { mietvertrag_id: 'a', sollmonat: '2026-10-01', sollbetrag: 0.2, faelligkeitsdatum: '2026-10-08' },
    ], [zahlung('a', 0.3, '2026-10-01')], am10Okt);
    expect(r).toMatchObject({ soll: 0.3, eingang: 0.3, offen: 0, vertraegeOffen: 0 });
  });

  it('ergibt ab dem 8. mit den älteren Rückständen genau den Rückstand der Liste', () => {
    const faelle: Array<{ forderungen: ReturnType<typeof miete>[]; zahlungen: ReturnType<typeof zahlung>[] }> = [
      { forderungen: [miete('a', '2026-09'), miete('a', '2026-10')], zahlungen: [] },
      { forderungen: [miete('a', '2026-09'), miete('a', '2026-10')], zahlungen: [zahlung('a', 700, '2026-10-02')] },
      { forderungen: [miete('a', '2026-09'), miete('a', '2026-10')], zahlungen: [zahlung('a', 1200, '2026-10-02')] },
      { forderungen: [miete('a', '2026-08'), miete('a', '2026-09'), miete('a', '2026-10')], zahlungen: [zahlung('a', 200, '2026-09-30')] },
    ];
    for (const { forderungen, zahlungen } of faelle) {
      const r = monatsSaldo([vertraege[0]], forderungen, zahlungen, am10Okt);
      const liste = Math.max(0, berechneMietkontostand(vertraege[0], forderungen, zahlungen, am10Okt).rueckstand);
      expect(Math.round((r.offen + r.aelter) * 100) / 100).toBe(liste);
    }
  });

  it('ergibt vor dem 8. als ältere Rückstände den Rückstand der Liste', () => {
    const forderungen = [miete('a', '2026-08'), miete('a', '2026-09'), miete('a', '2026-10')];
    const zahlungen = [zahlung('a', 200, '2026-09-30')];
    const r = monatsSaldo([vertraege[0]], forderungen, zahlungen, am3Okt);
    expect(r).toMatchObject({ offen: 500, aelter: 800 });
    expect(berechneMietkontostand(vertraege[0], forderungen, zahlungen, am3Okt).rueckstand).toBe(800);
  });
});

describe('monatsSaldo — Review 29.10.2026', () => {
  it('zählt eine vorab bezahlte BKA-Nachzahlung nicht als Eingang auf die Miete', () => {
    const bka = { mietvertrag_id: 'a', sollmonat: '2025-12-01', sollbetrag: 300, faelligkeitsdatum: '2026-11-20', typ: 'BKA' };
    const r = monatsSaldo([vertraege[0]], [miete('a', '2026-10'), bka], [zahlung('a', 300, '2026-10-05', 'Betriebskostenabrechnung')], am10Okt);
    expect(r).toMatchObject({ soll: 500, eingang: 0, offen: 500, aelter: 0 });
  });

  it('nimmt vor der Sollstellung die Vertragsmiete auch dann, wenn schon eine Gebühr im Monat steht', () => {
    const gebuehr = { mietvertrag_id: 'a', sollmonat: '2026-10-01', sollbetrag: 7.5, faelligkeitsdatum: '2026-10-01', ruecklastschrift_am: '2026-10-01' };
    const r = monatsSaldo([vertraege[0]], [gebuehr], [], new Date(2026, 9, 1, 3));
    expect(r.soll).toBe(507.5);
  });
});

describe('monatsSaldo — Review 29.10.2026, zweite Runde', () => {
  it('setzt für eine erlassene Monatsmiete (0 €) keine Vertragsmiete ein', () => {
    const erlassen = { mietvertrag_id: 'a', sollmonat: '2026-10-01', sollbetrag: 0, faelligkeitsdatum: '2026-10-08', typ: 'Miete' };
    const r = monatsSaldo([vertraege[0]], [erlassen], [], am10Okt);
    expect(r).toMatchObject({ soll: 0, eingang: 0, offen: 0, aelter: 0 });
  });
});

describe('monatsSaldo — Überleitung Kaltmiete + Betriebskosten → Soll-Miete', () => {
  it('erklärt den Unterschied: anteilige Monate, abweichende Monatsmieten, Gebühren', () => {
    // Live 29.10.2026: 63.276,01 € Vertragsmiete, Soll 62.271,63 €: −722,58 € Einzug am 15.10., −281,80 € fünf
    // Mieterhöhungen ab November
    const einzug = { id: 'e', status: 'aktiv', start_datum: '2026-10-15', kaltmiete: 1400, betriebskosten: 200 };
    const erhoeht = { id: 'h', status: 'aktiv', start_datum: '2024-01-01', kaltmiete: 426, betriebskosten: 0 };
    const gebuehr = { id: 'g', status: 'aktiv', start_datum: '2024-01-01', kaltmiete: 500, betriebskosten: 0 };
    const r = monatsSaldo([einzug, erhoeht, gebuehr], [
      { mietvertrag_id: 'e', sollmonat: '2026-10-01', sollbetrag: 877.42, faelligkeitsdatum: '2026-10-15', typ: 'Miete' },
      { mietvertrag_id: 'h', sollmonat: '2026-10-01', sollbetrag: 375, faelligkeitsdatum: '2026-10-08', typ: 'Miete' },
      { mietvertrag_id: 'g', sollmonat: '2026-10-01', sollbetrag: 500, faelligkeitsdatum: '2026-10-08', typ: 'Miete' },
      { mietvertrag_id: 'g', sollmonat: '2026-10-01', sollbetrag: 7.5, faelligkeitsdatum: '2026-10-03', typ: 'Miete', ruecklastschrift_am: '2026-10-03' },
    ], [], am10Okt);
    expect(r.ueberleitung).toEqual({ vertragsmiete: 2526, anteilig: -722.58, abweichend: -51, gebuehren: 7.5 });
    const { vertragsmiete, anteilig, abweichend, gebuehren } = r.ueberleitung;
    expect(Math.round((vertragsmiete + anteilig + abweichend + gebuehren) * 100) / 100).toBe(r.soll);
  });
});

describe('monatsSaldo — Aufteilung der Soll-Miete in Kaltmiete und Betriebskosten', () => {
  // Kundenfrage 29.10.2026: Die Faktenzeile zeigte die Vertragswerte (63.276,01 €), oben stand die Soll-Miete
  // (62.271,63 €). Jetzt ergeben Kaltmiete + Betriebskosten die Soll-Miete.
  const einzug = { id: 'e', status: 'aktiv', start_datum: '2026-10-15', kaltmiete: 1400, betriebskosten: 200 };
  const erhoeht = { id: 'h', status: 'aktiv', start_datum: '2011-05-01', kaltmiete: 469.3, betriebskosten: 284 };
  const gebuehr = { id: 'g', status: 'aktiv', start_datum: '2024-01-01', kaltmiete: 500, betriebskosten: 0 };
  const forderungen = [
    { mietvertrag_id: 'a', sollmonat: '2026-10-01', sollbetrag: 500, faelligkeitsdatum: '2026-10-08', typ: 'Miete' },
    { mietvertrag_id: 'e', sollmonat: '2026-10-01', sollbetrag: 877.42, faelligkeitsdatum: '2026-10-15', typ: 'Miete' },
    // Erhöhung der Kaltmiete am 28.10. um 52,80 €, gilt erst ab November
    { mietvertrag_id: 'h', sollmonat: '2026-10-01', sollbetrag: 700.5, faelligkeitsdatum: '2026-10-08', typ: 'Miete' },
    { mietvertrag_id: 'g', sollmonat: '2026-10-01', sollbetrag: 500, faelligkeitsdatum: '2026-10-08', typ: 'Miete' },
    { mietvertrag_id: 'g', sollmonat: '2026-10-01', sollbetrag: 7.5, faelligkeitsdatum: '2026-10-03', typ: 'Miete', ruecklastschrift_am: '2026-10-03' },
  ];

  it('teilt anteilige Monate anteilig und rechnet eine abweichende Monatsmiete der Kaltmiete zu', () => {
    const r = monatsSaldo([vertraege[0], einzug, erhoeht, gebuehr], forderungen, [], am10Okt);
    // Kaltmiete 400 + 767,74 + 416,50 + 500; Betriebskosten 100 + 109,68 + 284 + 0 (Einzug: 17 von 31 Tagen)
    expect(r.aufteilung).toEqual({ kaltmiete: 2084.24, betriebskosten: 493.68, vertragKaltmiete: 2769.3, vertragBetriebskosten: 584 });
  });

  it('ergibt Kaltmiete + Betriebskosten + Gebühren genau die Soll-Miete', () => {
    const r = monatsSaldo([vertraege[0], einzug, erhoeht, gebuehr], forderungen, [], am10Okt);
    const { kaltmiete, betriebskosten } = r.aufteilung;
    expect(kaltmiete + betriebskosten + r.ueberleitung.gebuehren).toBeCloseTo(r.soll, 10);
  });

  it('geht auch mit Gebühr bei erlassener Monatsmiete genau auf', () => {
    const r = monatsSaldo([vertraege[0]], [
      { mietvertrag_id: 'a', sollmonat: '2026-10-01', sollbetrag: 0, faelligkeitsdatum: '2026-10-08', typ: 'Miete' },
      { mietvertrag_id: 'a', sollmonat: '2026-10-01', sollbetrag: 7.5, faelligkeitsdatum: '2026-10-03', typ: 'Miete', ruecklastschrift_am: '2026-10-03' },
    ], [], am10Okt);
    expect(r.soll).toBe(7.5);
    expect(r.aufteilung).toMatchObject({ kaltmiete: 0, betriebskosten: 0 });
    expect(r.ueberleitung.gebuehren).toBe(7.5);
  });

  it('teilt vor der Sollstellung die nachgebildete Monatsmiete ebenso auf', () => {
    // Am 1. vor 05:00 UTC: b voller Monat, Einzug am 15. anteilig (17 von 31 Tagen)
    const r = monatsSaldo([vertraege[1], einzug], [], [], new Date(2026, 9, 1, 3));
    expect(r.soll).toBe(1377.42);
    expect(r.aufteilung).toMatchObject({ kaltmiete: 1167.74, betriebskosten: 209.68 });
  });

  it('setzt für eine erlassene Monatsmiete weder Kaltmiete noch Betriebskosten an', () => {
    const erlassen = { mietvertrag_id: 'a', sollmonat: '2026-10-01', sollbetrag: 0, faelligkeitsdatum: '2026-10-08', typ: 'Miete' };
    const r = monatsSaldo([vertraege[0]], [erlassen], [], am10Okt);
    expect(r.aufteilung).toMatchObject({ kaltmiete: 0, betriebskosten: 0, vertragKaltmiete: 400, vertragBetriebskosten: 100 });
  });
});
