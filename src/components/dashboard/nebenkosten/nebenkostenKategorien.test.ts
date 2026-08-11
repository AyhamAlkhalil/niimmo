import { describe, it, expect } from 'vitest';
import {
  BETRKV_KATEGORIEN,
  findeKategorieNachName,
  findeKategorieNachId,
  istBerechenbarerSchluessel,
  kategorieAusKiVorschlag,
  normalisiereKategorieName,
  pseudoKategorieFuerArt,
} from './nebenkostenKategorien';

describe('normalisiereKategorieName', () => {
  // Die frühere Variante strippte Umlaute ersatzlos ("Entwässerung" -> "entwsserung")
  // und traf damit nie die Kategorie-ID "entwaesserung".
  it.each([
    ['Entwässerung', 'entwaesserung'],
    ['Straßenreinigung & Müll', 'strassenreinigungmuell'],
    ['Gebäudereinigung', 'gebaeudereinigung'],
    ['Wäschepflege', 'waeschepflege'],
    ['Bankgebühren', 'bankgebuehren'],
  ])('schreibt Umlaute in %s aus', (name, erwartet) => {
    expect(normalisiereKategorieName(name)).toBe(erwartet);
  });

  it('bildet Name und ID jeder Kategorie auf denselben Schlüssel ab', () => {
    for (const kat of BETRKV_KATEGORIEN) {
      expect(normalisiereKategorieName(kat.name)).toBe(normalisiereKategorieName(kat.id));
    }
  });
});

describe('findeKategorieNachName', () => {
  it('findet jede Kategorie über ihren eigenen Namen', () => {
    for (const kat of BETRKV_KATEGORIEN) {
      expect(findeKategorieNachName(kat.name)?.id).toBe(kat.id);
    }
  });

  it('löst Bestandsnamen über Synonyme auf', () => {
    expect(findeKategorieNachName('Heizung')?.id).toBe('heizkosten');
    expect(findeKategorieNachName('Müllabfuhr')?.id).toBe('strassenreinigung_muell');
    expect(findeKategorieNachName('Gebäudereinigung & Ungezieferbekämpfung')?.id).toBe(
      'gebaeudereinigung'
    );
    expect(findeKategorieNachName('Hausmeister')?.id).toBe('hauswart');
  });

  it('lässt mehrdeutige Bestandsnamen ungelöst', () => {
    // "Wasser/Abwasser" fasst 2.2 und 2.3 zusammen — eine automatische Zuordnung
    // waere eine fachliche Entscheidung und wird bewusst nicht getroffen.
    expect(findeKategorieNachName('Wasser/Abwasser')).toBeUndefined();
  });

  it('liefert undefined für Leerwerte', () => {
    expect(findeKategorieNachName(null)).toBeUndefined();
    expect(findeKategorieNachName('')).toBeUndefined();
  });
});

describe('pseudoKategorieFuerArt', () => {
  const art = {
    id: 'abc-123',
    name: 'Wasser/Abwasser',
    verteilerschluessel_art: 'personen',
    ist_umlagefaehig: true,
  };

  it('behält Name und gespeicherten Schlüssel', () => {
    const pseudo = pseudoKategorieFuerArt(art);
    expect(pseudo?.name).toBe('Wasser/Abwasser');
    expect(pseudo?.schluessel).toBe('personen');
    expect(pseudo?.id).toBe('custom_abc-123');
    expect(pseudo?.betrkvNummer).toBeUndefined();
  });

  it('faellt ohne gespeicherten Schluessel auf qm zurueck', () => {
    expect(pseudoKategorieFuerArt({ ...art, verteilerschluessel_art: null })?.schluessel).toBe('qm');
  });

  it('kollidiert nicht mit echten Kategorie-IDs', () => {
    const pseudo = pseudoKategorieFuerArt(art);
    expect(findeKategorieNachId(pseudo!.id)).toBeUndefined();
  });
});

describe('istBerechenbarerSchluessel', () => {
  it('akzeptiert die drei rechenbaren Schluessel', () => {
    expect(istBerechenbarerSchluessel('qm')).toBe(true);
    expect(istBerechenbarerSchluessel('personen')).toBe(true);
    expect(istBerechenbarerSchluessel('gleich')).toBe(true);
  });

  it('lehnt Altwerte ohne Datengrundlage ab', () => {
    // In den Bestandsdaten vorhanden, aber ohne Verbrauchserfassung nicht rechenbar.
    expect(istBerechenbarerSchluessel('individuell')).toBe(false);
    expect(istBerechenbarerSchluessel('verbrauch')).toBe(false);
    expect(istBerechenbarerSchluessel(null)).toBe(false);
  });

  it('haelt alle Kategorie-Defaults berechenbar', () => {
    for (const kat of BETRKV_KATEGORIEN) {
      expect(istBerechenbarerSchluessel(kat.schluessel)).toBe(true);
    }
  });
});

describe('kategorieAusKiVorschlag', () => {
  it('bildet die Kategorien der Vorklassifizierung auf BetrKV ab', () => {
    expect(kategorieAusKiVorschlag('Strom')?.id).toBe('beleuchtung');
    expect(kategorieAusKiVorschlag('Müll')?.id).toBe('strassenreinigung_muell');
    expect(kategorieAusKiVorschlag('Versicherung')?.id).toBe('versicherungen');
    expect(kategorieAusKiVorschlag('Grundsteuer')?.id).toBe('grundsteuer');
    expect(kategorieAusKiVorschlag('Hausmeister')?.id).toBe('hauswart');
  });

  it('liefert undefined für Unbekanntes', () => {
    expect(kategorieAusKiVorschlag('Irgendwas')).toBeUndefined();
    expect(kategorieAusKiVorschlag(null)).toBeUndefined();
  });
});

describe('BetrKV-Stammdaten', () => {
  it('deckt 2.1 bis 2.17 lückenlos ab', () => {
    expect(BETRKV_KATEGORIEN.map((k) => k.betrkvNummer)).toEqual(
      Array.from({ length: 17 }, (_, i) => `2.${i + 1}`)
    );
  });

  it('hat eindeutige IDs', () => {
    const ids = BETRKV_KATEGORIEN.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Verbindliche Kundenvorgabe (NiImmo-Vorlage) — Aenderungen nur auf ausdruecklichen Wunsch.
  it('haelt die vorgegebenen Verteilerschluessel ein', () => {
    const vorgabe: Record<string, string> = {
      '2.1': 'gleich', '2.2': 'personen', '2.3': 'qm', '2.4': 'gleich', '2.5': 'gleich',
      '2.6': 'gleich', '2.7': 'qm', '2.8': 'qm', '2.9': 'qm', '2.10': 'qm', '2.11': 'qm',
      '2.12': 'gleich', '2.13': 'qm', '2.14': 'qm', '2.15': 'gleich', '2.16': 'qm', '2.17': 'qm',
    };
    for (const kat of BETRKV_KATEGORIEN) {
      expect(kat.schluessel, `BetrKV ${kat.betrkvNummer} ${kat.name}`).toBe(
        vorgabe[kat.betrkvNummer!]
      );
    }
  });
});
