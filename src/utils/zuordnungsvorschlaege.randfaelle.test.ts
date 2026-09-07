/**
 * Zusätzliche QA-Tests für src/utils/zuordnungsvorschlaege.ts — Randfälle, die
 * src/utils/zuordnungsvorschlaege.test.ts noch nicht abdeckt. Nur lesend,
 * keine Änderung am geprüften Modul.
 */
import { describe, expect, it } from 'vitest';
import {
  ImmobilieOption,
  KEINE_KORREKTUREN,
  KONFIDENZ_UNSICHER,
  Korrekturen,
  VertragOption,
  Zuordnungsvorschlag,
  effektiveImmobilieId,
  effektiveKategorie,
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

describe('Konfidenz genau an der Schwelle', () => {
  it('confidence === KONFIDENZ_UNSICHER (50) gilt noch als zugeordnet, nicht unsicher', () => {
    expect(KONFIDENZ_UNSICHER).toBe(50);
    expect(vorschlagStatus(0, vorschlag({ confidence: 50 }), KEINE_KORREKTUREN)).toBe('zugeordnet');
  });

  it('confidence === 49 (eins unter der Schwelle) gilt als unsicher', () => {
    expect(vorschlagStatus(0, vorschlag({ confidence: 49 }), KEINE_KORREKTUREN)).toBe('unsicher');
  });
});

describe('Vorschlag ohne iban/verwendungszweck', () => {
  it('vorschlagsSchluessel funktioniert mit leerer iban und leerem Verwendungszweck', () => {
    const v = vorschlag({ iban: '', verwendungszweck: '' });
    expect(vorschlagsSchluessel(v)).toBe('2026-09-01_850__');
  });

  it('vorschlagsSchluessel kürzt den Verwendungszweck exakt bei 50 Zeichen', () => {
    const genau50 = 'x'.repeat(50);
    const einZeichenLaenger = 'x'.repeat(51);
    expect(vorschlagsSchluessel(vorschlag({ verwendungszweck: genau50 }))).toBe(`2026-09-01_850_DE00_${genau50}`);
    expect(vorschlagsSchluessel(vorschlag({ verwendungszweck: einZeichenLaenger }))).toBe(`2026-09-01_850_DE00_${genau50}`);
  });

  it('filtereVorschlaege findet auch einen Vorschlag ohne Empfängername über Verwendungszweck oder Betrag', () => {
    const liste = [vorschlag({ empfaengername: undefined, verwendungszweck: 'Sondertilgung' })];
    expect(filtereVorschlaege(liste, KEINE_KORREKTUREN, 'alle', 'sondertilgung')).toEqual([0]);
    expect(filtereVorschlaege(liste, KEINE_KORREKTUREN, 'alle', '850,00')).toEqual([0]);
  });
});

describe('Kategoriewechsel Miete -> Nebenkosten -> Miete', () => {
  it('effektive Werte folgen der letzten Korrektur; ein Rückwechsel zu Miete gibt den ursprünglichen Vertrag zurück', () => {
    const v = vorschlag({ kategorie: 'Miete', mietvertrag_id: 'mv1' });

    // Schritt 1: Wechsel zu Nebenkosten mit Objekt
    const kNebenkosten: Korrekturen = { vertrag: {}, immobilie: { 0: 'im1' }, kategorie: { 0: 'Nebenkosten' } };
    expect(effektiveKategorie(0, v, kNebenkosten)).toBe('Nebenkosten');
    expect(effektiveVertragId(0, v, kNebenkosten)).toBeNull();
    expect(effektiveImmobilieId(0, v, kNebenkosten)).toBe('im1');
    expect(vorschlagStatus(0, v, kNebenkosten)).toBe('geaendert');

    // Schritt 2: zurück zu Miete — die Immobilien-Korrektur bleibt im Korrekturen-Objekt
    // stehen, wird aber ignoriert, sobald die Kategorie wieder Miete ist; der Vertrag
    // fällt auf den ursprünglichen Vorschlag zurück, weil kein Vertrags-Korrektureintrag existiert.
    const kZurueck: Korrekturen = { vertrag: {}, immobilie: { 0: 'im1' }, kategorie: { 0: 'Miete' } };
    expect(effektiveKategorie(0, v, kZurueck)).toBe('Miete');
    expect(effektiveVertragId(0, v, kZurueck)).toBe('mv1');
    expect(effektiveImmobilieId(0, v, kZurueck)).toBeNull();
  });

  it('wendeKorrekturenAn spiegelt einen vollständigen Hin- und Rückwechsel korrekt', () => {
    const v = vorschlag({ kategorie: 'Miete', mietvertrag_id: 'mv1' });
    const kZurueck: Korrekturen = { vertrag: {}, immobilie: { 0: 'im1' }, kategorie: { 0: 'Miete' } };
    const [ergebnis] = wendeKorrekturenAn([v], kZurueck, new Set([0]), vertraege, immobilien);
    expect(ergebnis.kategorie).toBe('Miete');
    expect(ergebnis.mietvertrag_id).toBe('mv1');
    // Seit dem 07.09.2026 räumt der „sonst"-Zweig den Objektbezug immer ab:
    // Alles außer Nebenkosten hängt am Vertrag, ein Objekt daneben zählte doppelt.
    expect(ergebnis.immobilie_id).toBeNull();
  });
});

describe('Nebenkosten mit und ohne Objekt', () => {
  it('Nebenkosten ohne jegliches Objekt (weder Vorschlag noch Korrektur) ist „offen"', () => {
    const v = vorschlag({ kategorie: 'Nebenkosten', mietvertrag_id: null, immobilie_id: null });
    expect(effektiveImmobilieId(0, v, KEINE_KORREKTUREN)).toBeNull();
    expect(vorschlagStatus(0, v, KEINE_KORREKTUREN)).toBe('offen');
  });

  it('Nebenkosten mit vom Backend vorgeschlagenem Objekt ist zugeordnet, ohne manuelle Korrektur', () => {
    const v = vorschlag({ kategorie: 'Nebenkosten', mietvertrag_id: null, immobilie_id: 'im1', confidence: 80 });
    expect(effektiveImmobilieId(0, v, KEINE_KORREKTUREN)).toBe('im1');
    expect(vorschlagStatus(0, v, KEINE_KORREKTUREN)).toBe('zugeordnet');
  });

  it('eine manuelle Entfernung des Objekts (Korrektur auf null) macht Nebenkosten wieder offen, aber „geändert"', () => {
    const v = vorschlag({ kategorie: 'Nebenkosten', mietvertrag_id: null, immobilie_id: 'im1' });
    const k: Korrekturen = { ...KEINE_KORREKTUREN, immobilie: { 0: null } };
    expect(effektiveImmobilieId(0, v, k)).toBeNull();
    expect(vorschlagStatus(0, v, k)).toBe('geaendert');
  });
});

describe('Korrekturen auf nicht existierende Indizes', () => {
  it('beeinflussen die tatsächlich vorhandenen Zeilen nicht und lösen keinen Fehler aus', () => {
    const liste = [vorschlag({}), vorschlag({ mietvertrag_id: null })];
    const k: Korrekturen = { vertrag: { 99: 'mv2' }, immobilie: { 50: 'im1' }, kategorie: { 7: 'Nebenkosten' } };
    expect(vorschlagStatus(0, liste[0], k)).toBe('zugeordnet');
    expect(vorschlagStatus(1, liste[1], k)).toBe('offen');
    expect(() => wendeKorrekturenAn(liste, k, new Set([0, 1]), vertraege, immobilien)).not.toThrow();
    const ergebnis = wendeKorrekturenAn(liste, k, new Set([0, 1]), vertraege, immobilien);
    expect(ergebnis).toHaveLength(2);
    expect(ergebnis[0].mietvertrag_id).toBe('mv1');
  });

  it('eine Auswahl mit einem nicht existierenden Index liefert einfach kein zusätzliches Element', () => {
    const liste = [vorschlag({})];
    const ergebnis = wendeKorrekturenAn(liste, KEINE_KORREKTUREN, new Set([0, 5]), vertraege, immobilien);
    expect(ergebnis).toHaveLength(1);
  });
});

describe('filtereVorschlaege: Sicht und Suche', () => {
  const liste = [
    vorschlag({ empfaengername: 'Erika Beispiel', verwendungszweck: 'Miete September', confidence: 95 }),
    vorschlag({ empfaengername: 'Jobcenter', verwendungszweck: 'KdU Muster', mietvertrag_id: null }),
    vorschlag({ empfaengername: 'Unbekannt', verwendungszweck: 'Ueberweisung', confidence: 40, betrag: 123.45, mietvertrag_id: 'mv2' }),
  ];

  it('Sicht „zugeordnet" liefert nur eindeutig zugeordnete Zeilen', () => {
    expect(filtereVorschlaege(liste, KEINE_KORREKTUREN, 'zugeordnet', '')).toEqual([0]);
  });

  it('leere Vorschlagsliste liefert eine leere Trefferliste', () => {
    expect(filtereVorschlaege([], KEINE_KORREKTUREN, 'alle', 'irgendwas')).toEqual([]);
  });

  it('eine Suche aus nur Leerzeichen wirkt wie keine Suche', () => {
    expect(filtereVorschlaege(liste, KEINE_KORREKTUREN, 'alle', '   ')).toEqual([0, 1, 2]);
  });

  it('findet Sonderzeichen im Verwendungszweck ohne Regex-Fehler', () => {
    const sonderliste = [vorschlag({ verwendungszweck: 'Miete (September) & Nebenkosten' })];
    expect(filtereVorschlaege(sonderliste, KEINE_KORREKTUREN, 'alle', '(september)')).toEqual([0]);
  });
});

describe('wendeKorrekturenAn: unbekannte Ziel-IDs', () => {
  it('ein korrigierter Vertrag, der in der Liste nicht existiert, fällt auf den alten Namen zurück und nutzt die ID im Grund', () => {
    const liste = [vorschlag({ mieter_name: 'Alt Name' })];
    const k: Korrekturen = { ...KEINE_KORREKTUREN, vertrag: { 0: 'mv-unbekannt' } };
    const [ergebnis] = wendeKorrekturenAn(liste, k, new Set([0]), vertraege, immobilien);
    expect(ergebnis.mietvertrag_id).toBe('mv-unbekannt');
    expect(ergebnis.mieter_name).toBe('Alt Name');
    expect(ergebnis.zuordnungsgrund).toBe('Manuell korrigiert: mv-unbekannt');
  });

  it('ein korrigiertes Objekt, das in der Liste nicht existiert, fällt auf den alten Objektnamen zurück', () => {
    const liste = [vorschlag({ kategorie: 'Nebenkosten', mietvertrag_id: null, immobilie_name: 'Alt Objekt' })];
    const k: Korrekturen = { vertrag: {}, immobilie: { 0: 'im-unbekannt' }, kategorie: {} };
    const [ergebnis] = wendeKorrekturenAn(liste, k, new Set([0]), vertraege, immobilien);
    expect(ergebnis.immobilie_id).toBe('im-unbekannt');
    expect(ergebnis.immobilie_name).toBe('Alt Objekt');
    expect(ergebnis.zuordnungsgrund).toBe('Manuell zugeordnet: im-unbekannt');
  });
});

describe('standardAuswahl und zaehleStatus: leere Liste', () => {
  it('liefern eine leere Auswahl bzw. lauter Nullen', () => {
    expect([...standardAuswahl([])]).toEqual([]);
    expect(zaehleStatus([], KEINE_KORREKTUREN)).toEqual({ geaendert: 0, offen: 0, unsicher: 0, zugeordnet: 0 });
  });
});

describe('naechsterPruefFall: Rundum-Suche', () => {
  const liste = [
    vorschlag({}),
    vorschlag({ mietvertrag_id: null }),
    vorschlag({}),
    vorschlag({ confidence: 30 }),
  ];

  it('ein einzelnes sichtbares, offenes Element springt auf sich selbst zurück', () => {
    expect(naechsterPruefFall(liste, KEINE_KORREKTUREN, [1], 1)).toBe(1);
  });

  it('ein „ab"-Index, der nicht in der sichtbaren Liste steht, wird wie „kein Startpunkt" behandelt', () => {
    // ab = 2 ist nicht in sichtbar enthalten -> indexOf liefert -1 -> Verhalten wie ab = null.
    const sichtbar = [0, 1, 3];
    expect(naechsterPruefFall(liste, KEINE_KORREKTUREN, sichtbar, 2)).toBe(naechsterPruefFall(liste, KEINE_KORREKTUREN, sichtbar, null));
    expect(naechsterPruefFall(liste, KEINE_KORREKTUREN, sichtbar, 2)).toBe(1);
  });

  it('läuft nach dem letzten sichtbaren Treffer wieder vorn an', () => {
    const sichtbar = [1, 3];
    expect(naechsterPruefFall(liste, KEINE_KORREKTUREN, sichtbar, 3)).toBe(1);
  });
});
