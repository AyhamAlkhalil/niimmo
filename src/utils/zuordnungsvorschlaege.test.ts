import { describe, expect, it } from 'vitest';
import {
  ImmobilieOption,
  KEINE_KORREKTUREN,
  Korrekturen,
  VertragOption,
  Zuordnungsvorschlag,
  effektiveImmobilieId,
  effektiveVertragId,
  filtereVorschlaege,
  naechsterPruefFall,
  standardAuswahl,
  vorschlagStatus,
  vorschlagsSchluessel,
  wendeKorrekturenAn,
  zaehleStatus,
} from './zuordnungsvorschlaege';

function vorschlag(teil: Partial<Zuordnungsvorschlag>): Zuordnungsvorschlag {
  return {
    buchungsdatum: '2026-09-01',
    betrag: 850,
    iban: 'DE00',
    verwendungszweck: 'Miete',
    mietvertrag_id: 'mv1',
    kategorie: 'Miete',
    zuordnungsgrund: 'IBAN-Match',
    confidence: 95,
    ...teil,
  };
}

const vertraege: VertragOption[] = [
  { id: 'mv1', mieter: 'Erika Beispiel', objekt: 'Haus A · EG', gesamtmiete: 850 },
  { id: 'mv2', mieter: 'Max Muster', objekt: 'Haus B · 1. OG', gesamtmiete: 700 },
];
const immobilien: ImmobilieOption[] = [{ id: 'im1', name: 'Haus A', adresse: 'Weg 1' }];

describe('vorschlagsSchluessel', () => {
  it('ist mit der Übernahme in PaymentManagement kompatibel', () => {
    const v = vorschlag({ buchungsdatum: '2026-09-01', betrag: 850, iban: 'DE00', verwendungszweck: 'x'.repeat(80) });
    expect(vorschlagsSchluessel(v)).toBe(`2026-09-01_850_DE00_${'x'.repeat(50)}`);
    expect(vorschlagsSchluessel(vorschlag({ iban: '', verwendungszweck: '' }))).toBe('2026-09-01_850__');
  });
});

describe('Status je Vorschlag', () => {
  it('ist zugeordnet, offen oder unsicher', () => {
    expect(vorschlagStatus(0, vorschlag({}), KEINE_KORREKTUREN)).toBe('zugeordnet');
    expect(vorschlagStatus(0, vorschlag({ mietvertrag_id: null }), KEINE_KORREKTUREN)).toBe('offen');
    expect(vorschlagStatus(0, vorschlag({ confidence: 40 }), KEINE_KORREKTUREN)).toBe('unsicher');
    expect(vorschlagStatus(0, vorschlag({ confidence: 40, mietvertrag_id: null }), KEINE_KORREKTUREN)).toBe('offen');
  });

  it('wird durch jede manuelle Korrektur zu „geändert"', () => {
    const v = vorschlag({ confidence: 40 });
    expect(vorschlagStatus(3, v, { ...KEINE_KORREKTUREN, vertrag: { 3: 'mv2' } })).toBe('geaendert');
    expect(vorschlagStatus(3, v, { ...KEINE_KORREKTUREN, kategorie: { 3: 'Nichtmiete' } })).toBe('geaendert');
    expect(vorschlagStatus(3, v, { ...KEINE_KORREKTUREN, vertrag: { 3: null } })).toBe('geaendert');
    expect(vorschlagStatus(4, v, { ...KEINE_KORREKTUREN, vertrag: { 3: 'mv2' } })).toBe('unsicher');
  });

  it('Nebenkosten hängen am Objekt, nie am Vertrag', () => {
    const v = vorschlag({ kategorie: 'Nebenkosten', mietvertrag_id: 'mv1', immobilie_id: null });
    expect(effektiveVertragId(0, v, KEINE_KORREKTUREN)).toBeNull();
    expect(vorschlagStatus(0, v, KEINE_KORREKTUREN)).toBe('offen');
    const k: Korrekturen = { ...KEINE_KORREKTUREN, immobilie: { 0: 'im1' } };
    expect(effektiveImmobilieId(0, v, k)).toBe('im1');
    expect(vorschlagStatus(0, v, k)).toBe('geaendert');
  });

  it('gilt nach Hin- und Rückwechsel der Kategorie nicht mehr als geändert, wenn nur das inaktive Zielfeld übrig ist', () => {
    const v = vorschlag({});
    // Miete → Nebenkosten mit Objekt → zurück auf Miete: die Objektwahl bleibt in den Korrekturen stehen,
    // wirkt sich aber nicht mehr aus.
    const k: Korrekturen = { ...KEINE_KORREKTUREN, immobilie: { 0: 'im1' } };
    expect(vorschlagStatus(0, v, k)).toBe('zugeordnet');
    expect(vorschlagStatus(0, vorschlag({ kategorie: 'Nebenkosten', mietvertrag_id: null }), { ...KEINE_KORREKTUREN, vertrag: { 0: 'mv2' } })).toBe('offen');
  });

  it('zählt je Status', () => {
    const liste = [vorschlag({}), vorschlag({ mietvertrag_id: null }), vorschlag({ confidence: 10 })];
    expect(zaehleStatus(liste, { ...KEINE_KORREKTUREN, vertrag: { 1: 'mv2' } })).toEqual({
      geaendert: 1,
      offen: 0,
      unsicher: 1,
      zugeordnet: 1,
    });
  });
});

describe('standardAuswahl', () => {
  it('wählt nur Vorschläge mit Vertrag vor, die das Backend nicht abgewählt hat', () => {
    const liste = [
      vorschlag({}),
      vorschlag({ mietvertrag_id: null }),
      vorschlag({ selected: false }),
      vorschlag({ selected: true }),
    ];
    expect([...standardAuswahl(liste)]).toEqual([0, 3]);
  });
});

describe('filtereVorschlaege', () => {
  const liste = [
    vorschlag({ empfaengername: 'Erika Beispiel', verwendungszweck: 'Miete September' }),
    vorschlag({ empfaengername: 'Jobcenter', verwendungszweck: 'KdU Muster', mietvertrag_id: null }),
    vorschlag({ empfaengername: 'Unbekannt', verwendungszweck: 'Ueberweisung', confidence: 40, betrag: 123.45, mietvertrag_id: 'mv2' }),
  ];

  it('liefert Indizes in Originalreihenfolge je Sicht', () => {
    expect(filtereVorschlaege(liste, KEINE_KORREKTUREN, 'alle', '')).toEqual([0, 1, 2]);
    expect(filtereVorschlaege(liste, KEINE_KORREKTUREN, 'offen', '')).toEqual([1]);
    expect(filtereVorschlaege(liste, KEINE_KORREKTUREN, 'unsicher', '')).toEqual([2]);
    expect(filtereVorschlaege(liste, { ...KEINE_KORREKTUREN, vertrag: { 2: 'mv2' } }, 'geaendert', '')).toEqual([2]);
  });

  it('sucht in Name, Verwendungszweck, Betrag und Zielvertrag', () => {
    expect(filtereVorschlaege(liste, KEINE_KORREKTUREN, 'alle', 'jobcenter')).toEqual([1]);
    expect(filtereVorschlaege(liste, KEINE_KORREKTUREN, 'alle', '123,45')).toEqual([2]);
    expect(filtereVorschlaege(liste, KEINE_KORREKTUREN, 'alle', 'beispiel', vertraege)).toEqual([0]);
    // „max" steht nur im Namen des Zielvertrags mv2, nicht in einer Buchung selbst
    expect(filtereVorschlaege(liste, KEINE_KORREKTUREN, 'alle', 'max', vertraege)).toEqual([2]);
    expect(filtereVorschlaege(liste, { ...KEINE_KORREKTUREN, vertrag: { 1: 'mv2' } }, 'alle', 'max', vertraege)).toEqual([1, 2]);
  });
});

describe('wendeKorrekturenAn', () => {
  it('übernimmt nur gewählte Zeilen mit ihren Korrekturen', () => {
    const liste = [vorschlag({}), vorschlag({ mietvertrag_id: null }), vorschlag({})];
    const k: Korrekturen = { ...KEINE_KORREKTUREN, vertrag: { 1: 'mv2' } };
    const ergebnis = wendeKorrekturenAn(liste, k, new Set([1, 2]), vertraege, immobilien);
    expect(ergebnis).toHaveLength(2);
    expect(ergebnis[0].mietvertrag_id).toBe('mv2');
    expect(ergebnis[0].immobilie_id).toBeNull();
    expect(ergebnis[0].mieter_name).toBe('Max Muster');
    expect(ergebnis[0].immobilie_name).toBe('Haus B · 1. OG');
    expect(ergebnis[0].zuordnungsgrund).toBe('Manuell korrigiert: Max Muster');
    // Objektbezug wird außerhalb von Nebenkosten immer abgeräumt, sonst bleibt alles gleich.
    expect(ergebnis[1]).toEqual({ ...liste[2], immobilie_id: null });
  });

  it('dokumentiert eine entfernte Zuordnung', () => {
    const ergebnis = wendeKorrekturenAn([vorschlag({})], { ...KEINE_KORREKTUREN, vertrag: { 0: null } }, new Set([0]), vertraege, immobilien);
    expect(ergebnis[0].mietvertrag_id).toBeNull();
    expect(ergebnis[0].zuordnungsgrund).toBe('Manuell entfernt');
  });

  it('setzt bei Nebenkosten das Objekt und löscht den Vertrag', () => {
    const liste = [vorschlag({ kategorie: 'Miete', mietvertrag_id: 'mv1' })];
    const k: Korrekturen = { vertrag: {}, immobilie: { 0: 'im1' }, kategorie: { 0: 'Nebenkosten' } };
    const [ergebnis] = wendeKorrekturenAn(liste, k, new Set([0]), vertraege, immobilien);
    expect(ergebnis.kategorie).toBe('Nebenkosten');
    expect(ergebnis.mietvertrag_id).toBeNull();
    expect(ergebnis.immobilie_id).toBe('im1');
    expect(ergebnis.immobilie_name).toBe('Haus A');
    expect(ergebnis.zuordnungsgrund).toBe('Manuell zugeordnet: Haus A');
  });

  it('räumt beim Wechsel weg von Nebenkosten den Objektbezug ab, auch ohne Vertragswahl', () => {
    // Vorschlag kam als Nebenkosten mit Objekt; die Buchhaltung stellt nur die Kategorie um.
    const liste = [vorschlag({ kategorie: 'Nebenkosten', mietvertrag_id: null, immobilie_id: 'im1' })];
    const [ergebnis] = wendeKorrekturenAn(liste, { ...KEINE_KORREKTUREN, kategorie: { 0: 'Miete' } }, new Set([0]), vertraege, immobilien);
    expect(ergebnis.kategorie).toBe('Miete');
    expect(ergebnis.immobilie_id).toBeNull();
    expect(ergebnis.mietvertrag_id).toBeNull();
  });

  it('verändert die Eingabe nicht', () => {
    const liste = [vorschlag({})];
    const kopie = JSON.parse(JSON.stringify(liste));
    wendeKorrekturenAn(liste, { ...KEINE_KORREKTUREN, vertrag: { 0: 'mv2' } }, new Set([0]), vertraege, immobilien);
    expect(liste).toEqual(kopie);
  });
});

describe('naechsterPruefFall', () => {
  const liste = [
    vorschlag({}),
    vorschlag({ mietvertrag_id: null }),
    vorschlag({}),
    vorschlag({ confidence: 30 }),
  ];

  it('springt zum nächsten offenen oder unsicheren Fall und läuft rundum', () => {
    const sichtbar = [0, 1, 2, 3];
    expect(naechsterPruefFall(liste, KEINE_KORREKTUREN, sichtbar, null)).toBe(1);
    expect(naechsterPruefFall(liste, KEINE_KORREKTUREN, sichtbar, 1)).toBe(3);
    expect(naechsterPruefFall(liste, KEINE_KORREKTUREN, sichtbar, 3)).toBe(1);
  });

  it('achtet nur auf sichtbare Zeilen und gibt null zurück, wenn nichts offen ist', () => {
    expect(naechsterPruefFall(liste, KEINE_KORREKTUREN, [0, 2], null)).toBeNull();
    expect(naechsterPruefFall(liste, KEINE_KORREKTUREN, [], null)).toBeNull();
    expect(naechsterPruefFall(liste, { ...KEINE_KORREKTUREN, vertrag: { 1: 'mv2', 3: 'mv2' } }, [0, 1, 2, 3], null)).toBeNull();
  });
});
