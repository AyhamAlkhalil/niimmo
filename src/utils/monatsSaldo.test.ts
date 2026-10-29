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
  it('teilt eine Teilzahlung in Eingang und Noch offen', () => {
    const r = monatsSaldo(vertraege, [miete('a', '2026-10'), miete('b', '2026-10')], [zahlung('a', 300, '2026-10-02')], am10Okt);
    expect(r).toMatchObject({ soll: 1000, eingang: 300, offen: 700, aelter: 0, vertraegeOffen: 2 });
    expect(r.eingang + r.offen).toBe(r.soll);
  });

  it('verrechnet die Überzahlung eines Mieters nicht mit dem Rückstand eines anderen', () => {
    // 27.10.2026: Gesamt-Soll minus Gesamt-Eingang zeigte „Mehr eingegangen“ trotz Rückständen. Seit 29.10.2026
    // zählt der Eingang alle Zahlungen (Kundenvorgabe), b bleibt trotzdem offen
    const r = monatsSaldo(vertraege, [miete('a', '2026-10'), miete('b', '2026-10')], [zahlung('a', 1000, '2026-10-01')], am10Okt);
    expect(r).toMatchObject({ soll: 1000, eingang: 1000, offen: 500, vertraegeOffen: 1 });
  });

  it('zählt eine im Vormonat vorausgezahlte Miete im Vormonat, im Oktober ist sie nicht offen', () => {
    // 29.10.2026: Am 26.09. gezahlt, von der DB dem September zugeordnet — bis zum 28.10. „offen“. Eingang sind
    // die dem Monat zugeordneten Zahlungen (Kundenvorgabe 29.10.2026)
    const r = monatsSaldo([vertraege[0]], [miete('a', '2026-09'), miete('a', '2026-10')], [
      zahlung('a', 500, '2026-08-26'),
      zahlung('a', 500, '2026-09-26'),
    ], am3Okt);
    expect(r).toMatchObject({ soll: 500, eingang: 0, offen: 0, aelter: 0 });
  });

  it('zählt die Oktoberzahlung für den Oktober, auch wenn ältere Monate offen sind (Kundenmeldung 29.10.2026)', () => {
    const forderungen = [miete('a', '2026-04'), miete('a', '2026-05'), miete('a', '2026-10')];
    // April ausgelassen, Mai und Oktober gezahlt: Der Oktober ist bezahlt, der April ist älterer Rückstand
    const r = monatsSaldo([vertraege[0]], forderungen, [zahlung('a', 500, '2026-05-04'), zahlung('a', 500, '2026-10-06')], am10Okt);
    expect(r).toMatchObject({ soll: 500, eingang: 500, offen: 0, aelter: 500, vertraegeOffen: 0, vertraegeAelter: 1 });
    expect(r.offeneVertraege).toEqual([]);
  });

  it('lässt eine Nachzahlung mit zugeordnetem älterem Monat den älteren Rückstand tilgen', () => {
    const forderungen = [miete('a', '2026-08'), miete('a', '2026-09'), miete('a', '2026-10')];
    const nachzahlung = { ...zahlung('a', 500, '2026-10-02'), zugeordneter_monat: '2026-08' };
    const r = monatsSaldo([vertraege[0]], forderungen, [nachzahlung], am10Okt);
    expect(r).toMatchObject({ soll: 500, eingang: 0, offen: 500, aelter: 500 });
    // Ohne Zuordnung gilt sie für den Buchungsmonat Oktober; offen bleiben August und September
    const ohne = monatsSaldo([vertraege[0]], forderungen, [zahlung('a', 500, '2026-10-02')], am10Okt);
    expect(ohne).toMatchObject({ soll: 500, eingang: 500, offen: 0, aelter: 1000 });
  });

  it('nimmt, was über die Monatsmiete hinaus gezahlt wird, zuerst für ältere Rückstände (§ 366 Abs. 2 BGB)', () => {
    const forderungen = [miete('a', '2026-09'), miete('a', '2026-10')];
    // 200 für Oktober decken den Oktober zum Teil; die 100 für September tilgen den September
    const teil = monatsSaldo([vertraege[0]], forderungen, [zahlung('a', 200, '2026-10-02'), zahlung('a', 100, '2026-09-30')], am10Okt);
    expect(teil).toMatchObject({ eingang: 200, offen: 300, aelter: 400 });
    // Eine Doppelzahlung im Oktober deckt zuerst den Oktober, der Rest tilgt den September; Eingang ist alles
    const doppelt = monatsSaldo([vertraege[0]], forderungen, [zahlung('a', 800, '2026-10-02')], am10Okt);
    expect(doppelt).toMatchObject({ eingang: 800, offen: 0, aelter: 200 });
    // Eine BKA-Zahlung ohne BKA-Forderung ist für die BKA bestimmt: weder Oktobermiete noch Tilgung des Septembers
    const bka = monatsSaldo([vertraege[0]], forderungen, [zahlung('a', 500, '2026-10-02', 'Betriebskostenabrechnung')], am10Okt);
    expect(bka).toMatchObject({ eingang: 0, offen: 500, aelter: 500 });
  });

  it('rechnet eine Rücklastschrift ihrem zugeordneten Monat zu', () => {
    const forderungen = [miete('a', '2026-09'), miete('a', '2026-10')];
    // Septemberzahlung am 26.09., Rücklastschrift am 03.10., Oktoberzahlung am 06.10.
    const ruecklastschrift = zahlung('a', -500, '2026-10-03', 'Rücklastschrift');
    const zahlungen = [zahlung('a', 500, '2026-09-26'), ruecklastschrift, zahlung('a', 500, '2026-10-06')];
    // Im Oktober gebucht hebt sie die Oktoberzahlung auf; dem September zugeordnet ist der Oktober bezahlt
    expect(monatsSaldo([vertraege[0]], forderungen, zahlungen, am10Okt)).toMatchObject({ eingang: 0, offen: 500, aelter: 0 });
    const zugeordnet = [zahlungen[0], { ...ruecklastschrift, zugeordneter_monat: '2026-09' }, zahlungen[2]];
    expect(monatsSaldo([vertraege[0]], forderungen, zugeordnet, am10Okt)).toMatchObject({ eingang: 500, offen: 0, aelter: 500 });
    // Im selben Monat: Lastschrift am 01.10. geplatzt, am 05.10. neu gezahlt — der Oktober ist bezahlt
    const gleich = [zahlung('a', 500, '2026-09-03'), zahlung('a', 500, '2026-10-01'), zahlung('a', -500, '2026-10-02', 'Rücklastschrift'), zahlung('a', 500, '2026-10-05')];
    expect(monatsSaldo([vertraege[0]], forderungen, gleich, am10Okt)).toMatchObject({ eingang: 500, offen: 0, aelter: 0 });
  });

  it('nimmt eine Zahlung für einen späteren Monat und eine Gutschrift zuerst für ältere Rückstände', () => {
    const forderungen = [miete('a', '2026-09'), miete('a', '2026-10')];
    const november = { ...zahlung('a', 500, '2026-10-20'), zugeordneter_monat: '2026-11' };
    expect(monatsSaldo([vertraege[0]], forderungen, [november], am10Okt)).toMatchObject({ eingang: 0, offen: 500, aelter: 0 });
    const gutschrift = { mietvertrag_id: 'a', sollmonat: '2026-09-01', sollbetrag: -500, faelligkeitsdatum: '2026-09-08', typ: 'Miete' };
    expect(monatsSaldo([vertraege[0]], [...forderungen, gutschrift], [], am10Okt)).toMatchObject({ offen: 500, aelter: 0 });
  });

  it('nimmt die Soll-Miete aus den Verträgen, ohne Gebühren und BKA (Kundenvorgabe 29.10.2026)', () => {
    // a: Einzug am 15.10., 17 von 31 Tagen von 500 €, mit Gebühr; b: Sollstellung noch nicht gelaufen (1. vor 05:00)
    const einzug = { ...vertraege[0], start_datum: '2026-10-15' };
    const r = monatsSaldo(
      [einzug, vertraege[1]],
      [
        { mietvertrag_id: 'a', sollmonat: '2026-10-01', sollbetrag: '274.19', faelligkeitsdatum: '2026-10-16', typ: 'Miete' },
        { mietvertrag_id: 'a', sollmonat: '2026-10-01', sollbetrag: 7.5, faelligkeitsdatum: '2026-10-02', typ: 'Miete', ruecklastschrift_am: '2026-10-02' },
        { mietvertrag_id: 'a', sollmonat: '2025-12-01', sollbetrag: 300, faelligkeitsdatum: '2026-11-20', typ: 'BKA' },
      ],
      [],
      new Date(2026, 9, 1, 3)
    );
    expect(r.soll).toBe(774.19);
    expect(r.offen).toBe(774.19);
    expect(r.aelter).toBe(0);
  });

  it('zählt Rücklastschriften mindernd, Kaution und Zahlungen ohne Vertrag nicht', () => {
    // x: Vertrag läuft im Oktober nicht mehr (Nachzahlung nach dem Auszug) — zählt im Eingang, nicht in Soll und
    // Noch offen (Kundenvorgabe „alle Zahlungen, die dem Monat zugeordnet werden als Miete“, Review 29.10.2026)
    const r = monatsSaldo(vertraege, [miete('a', '2026-10'), miete('b', '2026-10')], [
      zahlung('a', 500, '2026-10-01'),
      zahlung('a', -500, '2026-10-05', 'Rücklastschrift'),
      zahlung('b', 1500, '2026-10-01', 'Mietkaution'),
      zahlung('x', 999, '2026-10-01'),
      zahlung(null, 50, '2026-10-01'),
      { ...zahlung('x', 400, '2026-10-02'), zugeordneter_monat: '2026-09' },
    ], am10Okt);
    expect(r).toMatchObject({ soll: 1000, eingang: 999, offen: 1000, vertraegeOffen: 2, zahlungenImMonat: 2 });
  });

  it('rechnet Cent-genau ohne Fließkommareste', () => {
    const cent = { id: 'a', status: 'aktiv', start_datum: '2024-01-01', kaltmiete: 0.1, betriebskosten: 0.2 };
    const r = monatsSaldo([cent], [
      { mietvertrag_id: 'a', sollmonat: '2026-10-01', sollbetrag: 0.3, faelligkeitsdatum: '2026-10-08' },
    ], [zahlung('a', 0.1, '2026-10-01'), zahlung('a', 0.2, '2026-10-02')], am10Okt);
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

  it('rechnet eine Zahlung vor dem 8. nie doppelt: offen + älter bleibt das Konto (Gegenprüfung)', () => {
    // Am 02.10. für Oktober gezahlt, September offen: Oktober bezahlt, September älter — schon vor dem 8.
    const forderungen = [miete('a', '2026-09'), miete('a', '2026-10')];
    const zahlungen = [zahlung('a', 500, '2026-10-02')];
    expect(monatsSaldo([vertraege[0]], forderungen, zahlungen, am3Okt)).toMatchObject({ eingang: 500, offen: 0, aelter: 500 });
    // Die Liste rechnet die Zahlung bis zur Fälligkeit des Oktobers noch auf den September (bekannte Grenze)
    expect(berechneMietkontostand(vertraege[0], forderungen, zahlungen, am3Okt).rueckstand).toBe(0);
    // Ab dem 8. stimmen beide überein
    expect(monatsSaldo([vertraege[0]], forderungen, zahlungen, am10Okt)).toMatchObject({ offen: 0, aelter: 500 });
    expect(berechneMietkontostand(vertraege[0], forderungen, zahlungen, am10Okt).rueckstand).toBe(500);
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
    // Die Gebühr gehört nicht zur Soll-Miete (Kundenvorgabe 29.10.2026); fällig steht sie im Mietkonto
    expect(r).toMatchObject({ soll: 500, offen: 500, aelter: 7.5 });
  });
});

describe('monatsSaldo — Review 29.10.2026, zweite Runde', () => {
  it('führt eine erlassene Monatsmiete (0 €) in der Soll-Miete laut Vertrag, aber nicht als offen', () => {
    // Seit 29.10.2026 kommt die Soll-Miete aus dem Vertrag; was erlassen ist, steht nur im Mietkonto
    const erlassen = { mietvertrag_id: 'a', sollmonat: '2026-10-01', sollbetrag: 0, faelligkeitsdatum: '2026-10-08', typ: 'Miete' };
    const r = monatsSaldo([vertraege[0]], [erlassen], [], am10Okt);
    expect(r).toMatchObject({ soll: 500, eingang: 0, offen: 0, aelter: 0 });
    expect(r.aufteilung).toEqual({ kaltmiete: 400, betriebskosten: 100 });
  });
});

describe('monatsSaldo — Soll-Miete aus den Verträgen, Gebühren getrennt (Kundenvorgabe 29.10.2026)', () => {
  // Kunde: „Die Soll-Miete soll aus den Mietverträgen berechnet werden“, Rücklastschriftgebühren „sind doch nicht
  // die Sollmiete“, und bei Erhöhungen „kommt es doch darauf an WANN die Mieterhöhung gültig ist“
  const am29Okt = new Date(2026, 9, 29, 12);
  const einzug = { id: 'e', status: 'aktiv', start_datum: '2026-10-15', kaltmiete: 1400, betriebskosten: 200 };
  // Live: Kaltmiete am 28.10. um 52,80 € erhöht, gilt erst ab November; der Vertrag hat schon die neue
  const erhoeht = { id: 'h', status: 'aktiv', start_datum: '2011-05-01', kaltmiete: 469.3, betriebskosten: 284, letzte_mieterhoehung_am: '2026-10-28' };
  const gebuehr = { id: 'g', status: 'aktiv', start_datum: '2024-01-01', kaltmiete: 500, betriebskosten: 0 };
  const forderungen = [
    { mietvertrag_id: 'a', sollmonat: '2026-10-01', sollbetrag: 500, faelligkeitsdatum: '2026-10-08', typ: 'Miete' },
    { mietvertrag_id: 'e', sollmonat: '2026-10-01', sollbetrag: 877.42, faelligkeitsdatum: '2026-10-15', typ: 'Miete' },
    { mietvertrag_id: 'h', sollmonat: '2026-10-01', sollbetrag: 700.5, faelligkeitsdatum: '2026-10-08', typ: 'Miete' },
    { mietvertrag_id: 'g', sollmonat: '2026-10-01', sollbetrag: 500, faelligkeitsdatum: '2026-10-08', typ: 'Miete' },
    { mietvertrag_id: 'g', sollmonat: '2026-10-01', sollbetrag: 7.5, faelligkeitsdatum: '2026-10-03', typ: 'Miete', ruecklastschrift_am: '2026-10-03' },
  ];

  it('teilt die Soll-Miete in Kaltmiete und Betriebskosten, anteilig beim Einzug, ohne Gebühr', () => {
    const r = monatsSaldo([vertraege[0], einzug, erhoeht, gebuehr], forderungen, [], am29Okt);
    // Kaltmiete 400 + 767,74 + 416,50 + 500; Betriebskosten 100 + 109,68 + 284 + 0 (Einzug: 17 von 31 Tagen)
    expect(r.aufteilung).toEqual({ kaltmiete: 2084.24, betriebskosten: 493.68 });
    expect(r.soll).toBe(2577.92);
    expect(Math.round((r.aufteilung.kaltmiete + r.aufteilung.betriebskosten) * 100) / 100).toBe(r.soll);
  });

  it('nimmt eine Erhöhung, die schon in diesem Monat gilt, sofort in die Soll-Miete', () => {
    // Zum Monatsersten erhöht oder als Korrektur geändert: Die Forderung hat noch den alten Betrag, es gilt der Vertrag
    const zumErsten = { ...erhoeht, letzte_mieterhoehung_am: '2026-10-01' };
    const korrektur = { ...erhoeht, letzte_mieterhoehung_am: '2024-05-01' };
    for (const v of [zumErsten, korrektur]) {
      expect(monatsSaldo([v], forderungen, [], am29Okt)).toMatchObject({ soll: 753.3, aufteilung: { kaltmiete: 469.3, betriebskosten: 284 } });
    }
  });

  it('führt eine Rücklastschriftgebühr nicht in der Soll-Miete, fällig aber im Mietkonto wie die Liste', () => {
    const zahlungen = [zahlung('g', 500, '2026-10-02')];
    const r = monatsSaldo([gebuehr], forderungen, zahlungen, am29Okt);
    expect(r).toMatchObject({ soll: 500, eingang: 500, offen: 0, aelter: 7.5, vertraegeOffen: 0 });
    const liste = berechneMietkontostand(gebuehr, forderungen.filter((f) => f.mietvertrag_id === 'g'), zahlungen, am29Okt).rueckstand;
    expect(Math.round((r.offen + r.aelter) * 100) / 100).toBe(liste);
  });

  it('teilt vor der Sollstellung die nachgebildete Monatsmiete ebenso auf', () => {
    // Am 1. vor 05:00 UTC: b voller Monat, Einzug am 15. anteilig (17 von 31 Tagen)
    const r = monatsSaldo([vertraege[1], einzug], [], [], new Date(2026, 9, 1, 3));
    expect(r.soll).toBe(1377.42);
    expect(r.aufteilung).toEqual({ kaltmiete: 1167.74, betriebskosten: 209.68 });
  });
});

describe('monatsSaldo — offene Verträge für die Liste unter „Noch offen“', () => {
  it('nennt jeden offenen Vertrag mit Betrag, größter zuerst, und erkennt Teilzahlungen', () => {
    const c = { id: 'c', status: 'aktiv', start_datum: '2024-01-01', kaltmiete: 600, betriebskosten: 150 };
    const r = monatsSaldo(
      [...vertraege, c],
      [miete('a', '2026-10'), miete('b', '2026-10'), miete('c', '2026-10', 750)],
      [zahlung('a', 500, '2026-10-02'), zahlung('b', 200, '2026-10-03')],
      am10Okt
    );
    expect(r.offeneVertraege).toEqual([
      { mietvertragId: 'c', offen: 750, soll: 750 },
      { mietvertragId: 'b', offen: 300, soll: 500 },
    ]);
    expect(r.offeneVertraege.length).toBe(r.vertraegeOffen);
    expect(r.offeneVertraege.reduce((s, o) => s + o.offen, 0)).toBe(r.offen);
  });

  it('führt einen Vertrag, der nur ältere Rückstände hat, nicht als offen für diesen Monat', () => {
    const r = monatsSaldo([vertraege[0]], [miete('a', '2026-09'), miete('a', '2026-10')], [zahlung('a', 500, '2026-10-02')], am10Okt);
    // Die Oktoberzahlung deckt den Oktober, offen bleibt der September (Kundenmeldung 29.10.2026)
    expect(r.offeneVertraege).toEqual([]);
    expect(r).toMatchObject({ offen: 0, aelter: 500 });
    const bezahlt = monatsSaldo([vertraege[0]], [miete('a', '2026-10')], [zahlung('a', 500, '2026-10-02')], am10Okt);
    expect(bezahlt.offeneVertraege).toEqual([]);
  });
});

describe('monatsSaldo — Prüfung des Rechenmodells 29.10.2026', () => {
  const andere = { id: 'B', status: 'aktiv', start_datum: '2020-01-01', kaltmiete: 500, betriebskosten: 100 };

  it('behält einen Auszug mitten im Monat den ganzen Monat in der Soll-Miete, offen zählt wie die Liste', () => {
    // Auszug 15.10.: Der Nachtlauf setzt am 16.10. „beendet“; bis dahin fiel der Vertrag ab dem 16. aus der Soll-Miete
    const aus = { id: 'A', start_datum: '2025-01-01', ende_datum: '2026-10-15', kuendigungsdatum: '2026-10-15', kaltmiete: 1000, betriebskosten: 0 };
    const forderungen = [
      { mietvertrag_id: 'A', sollmonat: '2026-10-01', sollbetrag: 483.87, faelligkeitsdatum: '2026-10-08', typ: 'Miete' },
      { mietvertrag_id: 'B', sollmonat: '2026-10-01', sollbetrag: 600, faelligkeitsdatum: '2026-10-08', typ: 'Miete' },
    ];
    const vor = monatsSaldo([{ ...aus, status: 'gekuendigt' }, andere], forderungen, [], new Date(2026, 9, 15, 12));
    const nach = monatsSaldo([{ ...aus, status: 'beendet' }, andere], forderungen, [], new Date(2026, 9, 16, 12));
    expect(vor.soll).toBe(1083.87);
    expect(nach.soll).toBe(1083.87);
    expect(nach.aufteilung).toEqual({ kaltmiete: 983.87, betriebskosten: 100 });
    // Offen bleibt der beendete Vertrag draußen wie in den Summen der Rückstandsliste
    expect(nach).toMatchObject({ offen: 600, vertraegeOffen: 1 });
  });

  it('setzt eine gelöschte Monatsmiete nach der Sollstellung nicht als offen an', () => {
    const v = { id: 'V', status: 'aktiv', start_datum: '2024-01-01', kaltmiete: 500, betriebskosten: 50 };
    const forderungen = [{ mietvertrag_id: 'V', sollmonat: '2026-09-01', sollbetrag: 550, faelligkeitsdatum: '2026-09-08', typ: 'Miete' }];
    const zahlungen = [zahlung('V', 550, '2026-09-01')];
    const r = monatsSaldo([v], forderungen, zahlungen, new Date(2026, 9, 29, 12));
    expect(r).toMatchObject({ soll: 550, offen: 0, aelter: 0 });
    expect(berechneMietkontostand(v, forderungen, zahlungen, new Date(2026, 9, 29, 12)).rueckstand).toBe(0);
    // Am 1. vor 05:00 UTC fehlt sie zu Recht noch und wird nachgebildet
    expect(monatsSaldo([v], forderungen, zahlungen, new Date(Date.UTC(2026, 10, 1, 3))).offen).toBe(550);
  });
});
