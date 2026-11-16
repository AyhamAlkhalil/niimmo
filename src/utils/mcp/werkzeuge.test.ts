import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Constants } from '@/integrations/supabase/types';
import { PRIORITAET_REIHENFOLGE, STATUS_REIHENFOLGE, TYP_REIHENFOLGE } from '@/components/aufgaben/aufgabenDarstellung';
import { berechneMietkontostand } from '../../../supabase/functions/_shared/mietkonto.ts';
import { vereinbarungVerlangtAmTag } from '../../../supabase/functions/_shared/mieterhoehung.ts';
import { pruefeSchema } from '../../../supabase/functions/mcp/eingabe.ts';
import { WERKZEUGE } from '../../../supabase/functions/mcp/server.ts';
import { Fachfehler, heuteInBerlin, type Kontext, ohneIban, type Rolle } from '../../../supabase/functions/mcp/werkzeug.ts';
import { belegung, objektUebersicht } from '../../../supabase/functions/mcp/werkzeuge/bestand.ts';
import { kontostand, rueckstandsliste } from '../../../supabase/functions/mcp/werkzeuge/mietkonto.ts';
import { ablesungPlan, mieterFelder, zaehlerSpalten } from '../../../supabase/functions/mcp/werkzeuge/pflege.ts';
import { giltAbErlaubt, mietendePlausibel, vertragsFelder } from '../../../supabase/functions/mcp/werkzeuge/vertraege.ts';
import {
  AUFGABEN_PRIORITAET,
  AUFGABEN_STATUS,
  AUFGABEN_TYP,
  DOKUMENT_KATEGORIEN,
  dokumentAenderbar,
  pruefeDarlehen,
} from '../../../supabase/functions/mcp/werkzeuge/verwaltung.ts';
import { forderungsMonatErlaubt, kategorieFelder, ZAHLKATEGORIEN } from '../../../supabase/functions/mcp/werkzeuge/zahlungen.ts';

const STICHTAG = new Date(2026, 10, 16, 12);
const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const Z1 = '33333333-3333-4333-8333-333333333333';
const E1 = '44444444-4444-4444-8444-444444444444';

// ---------- Attrappe des supabase-js-Clients ----------

interface Aufruf {
  tabelle: string;
  art: 'select' | 'insert' | 'update' | 'delete' | 'rpc';
  daten?: unknown;
  spalten?: string;
  filter: [string, string, unknown][];
}
type Antwort = { data: unknown; error: { message: string; code?: string; hint?: string } | null; count?: number };

function attrappe(antworten: (a: Aufruf) => Antwort) {
  const aufrufe: Aufruf[] = [];
  const from = (tabelle: string) => {
    const a: Aufruf = { tabelle, art: 'select', filter: [] };
    const filter = (op: string) => (k: string, v?: unknown) => {
      a.filter.push([op, k, v]);
      return b;
    };
    const b: Record<string, unknown> = {
      select: (s?: string) => ((a.spalten = s), b),
      insert: (d: unknown) => ((a.art = 'insert'), (a.daten = d), b),
      update: (d: unknown) => ((a.art = 'update'), (a.daten = d), b),
      delete: () => ((a.art = 'delete'), b),
      eq: filter('eq'), neq: filter('neq'), in: filter('in'), is: filter('is'), gte: filter('gte'), lte: filter('lte'),
      or: filter('or'), not: filter('not'),
      order: () => b, limit: () => b, range: () => b, maybeSingle: () => b, single: () => b,
      then: (ok: (x: Antwort) => unknown, fehler: (e: unknown) => unknown) => {
        aufrufe.push(a);
        return Promise.resolve(antworten(a)).then(ok, fehler);
      },
    };
    return b;
  };
  const rpc = (fn: string, daten: unknown) => {
    const a: Aufruf = { tabelle: fn, art: 'rpc', daten, filter: [] };
    aufrufe.push(a);
    return Promise.resolve(antworten(a));
  };
  return { db: { from, rpc }, aufrufe };
}

const ctx = (db: unknown, rollen: Rolle[] = ['admin']): Kontext => ({
  db, benutzerId: 'u1', rollen: new Set(rollen), heute: '2026-11-16', stichtag: STICHTAG,
});
const werkzeug = (name: string) => {
  const w = WERKZEUGE.find((x) => x.name === name);
  if (!w) throw new Error(`Werkzeug ${name} fehlt`);
  return w;
};
const ok = (data: unknown): Antwort => ({ data, error: null });

// ---------- Katalog ----------

describe('Werkzeugkatalog', () => {
  it('hat eindeutige, gültige Namen und geprüfte Schemas', () => {
    const namen = WERKZEUGE.map((w) => w.name);
    expect(new Set(namen).size).toBe(namen.length);
    for (const w of WERKZEUGE) {
      expect(w.name).toMatch(/^[a-z_]{3,64}$/);
      expect(w.beschreibung.length).toBeGreaterThan(20);
      expect(w.eingabe.type).toBe('object');
      expect(() => pruefeSchema(w.eingabe)).not.toThrow();
    }
  });

  it('gibt dem Hausmeister nur die Zähler — wie die Ablesetabelle der App, ohne Mieten und Mieterdaten', () => {
    const hausmeister = WERKZEUGE.filter((w) => w.rollen.includes('hausmeister'));
    expect(hausmeister.map((w) => w.name).sort()).toEqual(['zaehler_auflisten', 'zaehlernummer_aendern', 'zaehlerstaende_anzeigen', 'zaehlerstand_erfassen']);
    // Mietkonto, Zahlungen, Dokumente, Aufgaben, Darlehen und Versicherungen sind in RLS nur für Admins lesbar
    for (const name of ['mietkonto_anzeigen', 'rueckstaende_auflisten', 'zahlungen_suchen', 'dokumente_auflisten', 'aufgaben_auflisten', 'darlehen_auflisten', 'versicherungen_auflisten']) {
      expect(werkzeug(name).rollen).toEqual(['admin']);
    }
  });

  it('führt dieselben Werte wie Schema und App', () => {
    expect([...ZAHLKATEGORIEN].sort()).toEqual([...Constants.public.Enums.zahlkategorien].sort());
    expect([...DOKUMENT_KATEGORIEN].sort()).toEqual([...Constants.public.Enums.kategorie].sort());
    expect([...AUFGABEN_STATUS]).toEqual(STATUS_REIHENFOLGE);
    expect([...AUFGABEN_PRIORITAET]).toEqual(PRIORITAET_REIHENFOLGE);
    expect([...AUFGABEN_TYP]).toEqual(TYP_REIHENFOLGE);
  });

  it('liest keine Bank-, Ausweis- oder Geburtsdaten, keine WhatsApp-Nachrichten und nutzt keinen Service-Role-Schlüssel', () => {
    const dateien = (verzeichnis: string): string[] => readdirSync(verzeichnis).flatMap((n) => {
      const p = join(verzeichnis, n);
      return statSync(p).isDirectory() ? dateien(p) : [p];
    });
    const quelltext = dateien('supabase/functions/mcp').map((d) => readFileSync(d, 'utf-8')).join('\n');
    for (const verboten of ['iban', 'geburtsdatum', 'ausweisnummer', 'bankkonto_mieter', 'kontoinhaber', 'sepa_mandatsreferenz', 'whatsapp_nachrichten', 'bewerbung_blacklist', 'SERVICE_ROLE']) {
      expect(quelltext, verboten).not.toMatch(new RegExp(`\\b${verboten}\\b`));
    }
    expect(quelltext).not.toMatch(/select\(\s*['"`]\*/);
  });
});

// ---------- reine Fachlogik ----------

describe('Bestand', () => {
  const vertrag = (id: string, einheit: string, status: string, start: string, ende: string | null, kalt = 500, bk = 100) => ({
    id, einheit_id: einheit, status, start_datum: start, ende_datum: ende, kuendigungsdatum: null, kaltmiete: kalt, betriebskosten: bk, mahnstufe: 0,
  });

  it('zählt Leerstand und laufende Mieten über den laufenden Vertrag', () => {
    const immobilien = [{ id: 'o1', name: 'Haus A', adresse: null, strasse: 'Weg', hausnummer: '1', plz: '31319', ort: 'Sehnde', objekttyp: null, ist_angespannt: true }];
    const einheiten = ['e1', 'e2', 'e3'].map((id) => ({ id, immobilie_id: 'o1', einheitentyp: 'Wohnung', etage: 'EG', qm: 50, anzahl_zimmer: 2, bezeichnung: null }));
    const vertraege = [
      vertrag('v1', 'e1', 'aktiv', '2024-01-01', null),
      // Mieterwechsel: Vormieter gekündigt bis gestern, Nachmieter ab nächstem Monat — heute leer
      vertrag('v2', 'e2', 'gekuendigt', '2023-01-01', '2026-11-15', 400, 80),
      vertrag('v3', 'e2', 'aktiv', '2026-12-01', null, 450, 90),
      vertrag('v4', 'e3', 'beendet', '2020-01-01', '2025-12-31'),
    ];
    expect(objektUebersicht(immobilien, einheiten, vertraege, STICHTAG)).toEqual([{
      id: 'o1', name: 'Haus A', anschrift: 'Weg 1, 31319 Sehnde', objekttyp: null, angespannter_markt: true,
      einheiten: 3, vermietet: 1, leer: 2, kaltmiete_laufend: 500, betriebskosten_laufend: 100,
    }]);
    const b = belegung(vertraege.filter((v) => v.einheit_id === 'e2'), new Map([['v3', [{ id: 'm1', name: 'Anna Berg' }]]]), STICHTAG, '2026-11-16');
    expect(b.leer).toBe(true);
    expect(b.kuenftiger_vertrag).toMatchObject({ mietvertrag_id: 'v3', mieter: ['Anna Berg'], beginn: '2026-12-01' });
  });
});

describe('Mietkonto', () => {
  const vertrag = { id: V1, einheit_id: 'e1', status: 'aktiv', start_datum: '2026-01-01', ende_datum: null, kuendigungsdatum: null, kaltmiete: 500, betriebskosten: 100, mahnstufe: 1 };
  const forderungen = ['09', '10', '11'].map((m, i) => ({
    id: `f${i}`, mietvertrag_id: V1, sollmonat: `2026-${m}-01`, sollbetrag: 600, faelligkeitsdatum: `2026-${m}-08`, typ: 'Miete', ruecklastschrift_am: null,
  }));
  const zahlungen = [{ id: 'z1', mietvertrag_id: V1, betrag: 600, buchungsdatum: '2026-09-03', kategorie: 'Miete', zugeordneter_monat: '2026-09' }];

  it('rechnet wie der Rechenkern und nennt seit wann', () => {
    const k = kontostand(vertrag, forderungen, zahlungen, STICHTAG);
    expect(k.rueckstand).toBe(berechneMietkontostand(vertrag, forderungen, zahlungen, STICHTAG).rueckstand);
    expect(k).toMatchObject({ rueckstand: 1200, guthaben: 0, rueckstand_seit: '2026-10', rueckstand_in_monatsmieten: 2 });
    expect(k.offene_posten).toEqual([
      { monat: '2026-10', betrag: 600, art: 'Miete' },
      { monat: '2026-11', betrag: 600, art: 'Miete' },
    ]);
  });

  it('listet Rückstand und Guthaben und erkennt eine Sammelzahlung desselben Mieters', () => {
    const garage = { ...vertrag, id: V2, einheit_id: 'e2', kaltmiete: 50, betriebskosten: 0, mahnstufe: 0 };
    const garagenForderung = { id: 'g1', mietvertrag_id: V2, sollmonat: '2026-11-01', sollbetrag: 50, faelligkeitsdatum: '2026-11-08', typ: 'Miete', ruecklastschrift_am: null };
    const garagenZahlung = { id: 'z2', mietvertrag_id: V2, betrag: 250, buchungsdatum: '2026-11-02', kategorie: 'Miete', zugeordneter_monat: '2026-11' };
    const mieter = new Map([[V1, [{ id: 'm1', name: 'Anna Berg' }]], [V2, [{ id: 'm1', name: 'Anna Berg' }]]]);
    const liste = rueckstandsliste([vertrag, garage], [...forderungen, garagenForderung], [...zahlungen, garagenZahlung], new Map(), new Map(), mieter, STICHTAG);
    expect(liste.map((x) => [x.mietvertrag_id, x.art, x.betrag, x.verbundener_gegenbetrag])).toEqual([
      [V1, 'rueckstand', 1200, 200],
      [V2, 'guthaben', 200, 1200],
    ]);
  });
});

describe('Zahlungen, Verträge, Pflege', () => {
  it('setzt beim Kategoriewechsel den Bezug wie der Kategorie-Editor', () => {
    expect(kategorieFelder('Nebenkosten', 'o1')).toEqual({ kategorie: 'Nebenkosten', immobilie_id: 'o1', mietvertrag_id: null });
    expect(() => kategorieFelder('Nichtmiete', null)).toThrow(Fachfehler);
    expect(kategorieFelder('Ignorieren', null)).toEqual({ kategorie: 'Ignorieren', mietvertrag_id: null });
    expect(kategorieFelder('Mietkaution', null)).toEqual({ kategorie: 'Mietkaution' });
  });

  it('begrenzt Monate von Forderungen und Erhöhungen wie die Dialoge', () => {
    expect(forderungsMonatErlaubt('2025-01', '2026-11-16')).toBe(true);
    expect(forderungsMonatErlaubt('2024-12', '2026-11-16')).toBe(false);
    expect(forderungsMonatErlaubt('2028-01', '2026-11-16')).toBe(false);
    expect(giltAbErlaubt('2026-11-01', '2026-11-16')).toBe(true);
    expect(giltAbErlaubt('2027-11-01', '2026-11-16')).toBe(true);
    expect(giltAbErlaubt('2027-12-01', '2026-11-16')).toBe(false);
    expect(giltAbErlaubt('2026-10-01', '2026-11-16')).toBe(false);
    expect(giltAbErlaubt('2026-12-15', '2026-11-16')).toBe(false);
    expect(giltAbErlaubt('2026-13-01', '2026-11-16')).toBe(false);
  });

  it('nimmt nur erlaubte Vertragsfelder und keine Erhöhung als Korrektur', () => {
    const alt = { kaltmiete: 500, mietanpassung_art: 'keine' };
    expect(vertragsFelder({ kaution_soll: 1500, kaution_ist_grundwert: 0, anzahl_personen: 2, betriebskosten: 99.999 }, alt))
      .toEqual({ kaution_betrag: 1500, kaution_ist_grundwert: 0, anzahl_personen: 2, betriebskosten: 100 });
    expect(() => vertragsFelder({ kaltmiete: 550 }, alt)).toThrow(/mieterhoehung_vereinbaren/);
    expect(() => vertragsFelder({ kaltmiete: 550, kaltmiete_ist_korrektur: true }, alt)).toThrow(/korrektur_begruendung/);
    expect(vertragsFelder({ kaltmiete: 550, kaltmiete_ist_korrektur: true, korrektur_begruendung: 'Zahlendreher bei der Erfassung' }, alt))
      .toEqual({ kaltmiete: 550 });
    expect(vertragsFelder({ kaltmiete: 450 }, alt)).toEqual({ kaltmiete: 450 });
    expect(() => vertragsFelder({ kaltmiete: 450 }, { kaltmiete: 500, mietanpassung_art: 'staffel' })).toThrow(/Staffelmiete/);
    expect(() => vertragsFelder({ betriebskosten: -1 }, alt)).toThrow(/negativ/);
    expect(() => vertragsFelder({}, alt)).toThrow(/Keine Änderung/);
    // null heißt „nicht angegeben“ — nie als Wert ins UPDATE (Review 16.11.2026)
    expect(vertragsFelder({ kaltmiete: null, betriebskosten: 250 }, alt)).toEqual({ betriebskosten: 250 });
  });

  it('weist unplausible Kündigungstermine ab und macht IBANs unkenntlich', () => {
    expect(mietendePlausibel('2031-11-16', '2026-11-16')).toBe(true);
    expect(mietendePlausibel('2031-11-17', '2026-11-16')).toBe(false);
    expect(ohneIban('Miete DE89 3704 0044 0532 0130 00 Okt')).toBe('Miete [IBAN] Okt');
    expect(ohneIban('IBAN DE89370400440532013000 Wohnung 3')).toBe('IBAN [IBAN] Wohnung 3');
    expect(ohneIban('Miete Oktober 2026 Whg 12')).toBe('Miete Oktober 2026 Whg 12');
    expect(ohneIban(null)).toBeNull();
  });

  it('schreibt Ablesungen wie die Zählerverwaltung', () => {
    expect(ablesungPlan({ stand: 120, datum: '2026-11-16' }, { stand: 100, datum: '2026-10-01' })).toEqual({ stammsatz: 'stand_und_datum', historie: true });
    expect(ablesungPlan({ stand: 90, datum: '2026-09-01' }, { stand: 100, datum: '2026-10-01' })).toEqual({ stammsatz: 'nichts', historie: true });
    expect(ablesungPlan({ stand: 100, datum: '2026-11-16' }, { stand: 100, datum: '2026-10-01' })).toEqual({ stammsatz: 'nur_datum', historie: false });
    expect(ablesungPlan({ stand: 5, datum: '2026-11-16' }, { stand: null, datum: null })).toEqual({ stammsatz: 'stand_und_datum', historie: true });
    expect(zaehlerSpalten('objekt', 'wasser', 2)).toEqual({ stand: 'allgemein_wasser_stand_2', datum: 'allgemein_wasser_datum_2', nummer: 'allgemein_wasser_zaehler_2', typ: 'wasser_2' });
    expect(() => zaehlerSpalten('einheit', 'wasser')).toThrow(Fachfehler);
  });

  it('pflegt Mieterdaten mit null statt Leertext und prüft die Mailadresse', () => {
    expect(mieterFelder({ mail: ' a@b.de ', telefon: '' })).toEqual({ hauptmail: 'a@b.de', telnr: null });
    expect(() => mieterFelder({ mail: 'a@b' })).toThrow(/Mailadresse/);
    expect(() => mieterFelder({ vorname: '', nachname: ' ' })).toThrow(/Vor- und Nachname/);
  });

  it('prüft Darlehen und schützt Mietvertrags-Dokumente', () => {
    expect(() => pruefeDarlehen({ restschuld: 1000 }, { restschuld_stichtag: null, ende_datum: null }, '2026-11-16')).toThrow(/beide/);
    expect(() => pruefeDarlehen({ restschuld: 1000, restschuld_stichtag: '2026-12-01' }, { restschuld_stichtag: null, ende_datum: null }, '2026-11-16')).toThrow(/Zukunft/);
    expect(() => pruefeDarlehen({ ende_datum: '2026-01-01' }, { restschuld_stichtag: '2026-06-30', ende_datum: null }, '2026-11-16')).toThrow(/Laufzeitende/);
    expect(() => pruefeDarlehen({ restschuld: 1000, restschuld_stichtag: '2026-10-31' }, { restschuld_stichtag: null, ende_datum: '2030-01-01' }, '2026-11-16')).not.toThrow();
    expect(() => pruefeDarlehen({ restschuld: null, restschuld_stichtag: '2026-10-31' }, { restschuld_stichtag: null, ende_datum: null }, '2026-11-16')).toThrow(/beide/);
    expect(() => dokumentAenderbar('Mietvertrag')).toThrow(Fachfehler);
    expect(() => dokumentAenderbar('Rechnung', 'Mietvertrag')).toThrow(Fachfehler);
    expect(() => dokumentAenderbar('Rechnung', 'Sonstiges')).not.toThrow();
  });

  it('rechnet Tage in deutscher Zeit', () => {
    expect(heuteInBerlin(new Date('2026-11-16T23:30:00Z'))).toBe('2026-11-17');
    expect(heuteInBerlin(new Date('2026-07-31T22:30:00Z'))).toBe('2026-08-01');
    expect(vereinbarungVerlangtAmTag('2026-11-01', '2026-11-16')).toBe('2026-10-31');
    expect(vereinbarungVerlangtAmTag('2027-03-01', '2027-03-01')).toBe('2027-02-28');
    expect(vereinbarungVerlangtAmTag('2026-12-01', '2026-11-16')).toBe('2026-11-16');
  });
});

// ---------- Schreibwege gegen die Attrappe ----------

describe('Schreibwege', () => {
  it('ordnet eine Zahlung dem Vertrag zu: Objektbezug fällt, Kategorie wird Miete', async () => {
    const { db, aufrufe } = attrappe((a) => {
      if (a.tabelle === 'zahlungen' && a.art === 'select') return ok({ id: Z1, kategorie: 'Nichtmiete', mietvertrag_id: null, immobilie_id: 'o1' });
      if (a.tabelle === 'mietvertrag') return ok({ id: V1 });
      if (a.art === 'update') return ok([{ id: Z1 }]);
      throw new Error(`unerwartet ${a.tabelle}`);
    });
    await werkzeug('zahlung_vertrag_zuordnen').ausfuehren({ zahlung_id: Z1, mietvertrag_id: V1, monat: '2026-11' }, ctx(db));
    const update = aufrufe.find((a) => a.art === 'update');
    expect(update?.daten).toEqual({ mietvertrag_id: V1, immobilie_id: null, kategorie: 'Miete', zugeordneter_monat: '2026-11' });
    expect(update?.filter).toEqual([['eq', 'id', Z1]]);
  });

  it('meldet ein Update ohne getroffene Zeile (RLS) als Fehler statt als Erfolg', async () => {
    const { db } = attrappe((a) => (a.art === 'update' ? ok([]) : ok({ id: V1, mahnstufe: 2 })));
    await expect(werkzeug('mahnstufe_zuruecksetzen').ausfuehren({ mietvertrag_id: V1, stufe: 0 }, ctx(db)))
      .rejects.toThrow(/nicht gefunden oder keine Berechtigung/);
  });

  it('erhöht die Mahnstufe nie', async () => {
    const { db, aufrufe } = attrappe(() => ok({ id: V1, mahnstufe: 1 }));
    await expect(werkzeug('mahnstufe_zuruecksetzen').ausfuehren({ mietvertrag_id: V1, stufe: 1 }, ctx(db))).rejects.toThrow(/nur gesenkt/);
    expect(aufrufe.some((a) => a.art === 'update')).toBe(false);
  });

  it('reicht Geschäftsregeln der Datenbank im Wortlaut durch, andere Fehler nicht', async () => {
    const fehlerLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const regel = 'Die Zahlung ist in der Betriebskostenabrechnung einer Kostenposition zugeordnet.';
    const { db } = attrappe((a) => (a.art === 'update'
      ? { data: null, error: { message: regel, code: 'P0001' } }
      : ok({ id: Z1, kategorie: 'Nebenkosten', mietvertrag_id: null, immobilie_id: 'o1' })));
    await expect(werkzeug('zahlung_kategorie_aendern').ausfuehren({ zahlung_id: Z1, kategorie: 'Miete' }, ctx(db))).rejects.toThrow(regel);
    const { db: db2 } = attrappe((a) => (a.art === 'update'
      ? { data: null, error: { message: 'column "x" does not exist', code: '42703' } }
      : ok({ id: Z1, kategorie: 'Miete', mietvertrag_id: null, immobilie_id: null })));
    await expect(werkzeug('zahlung_monat_aendern').ausfuehren({ zahlung_id: Z1, monat: '2026-10' }, ctx(db2))).rejects.toThrow('Monat ändern ist fehlgeschlagen.');
    fehlerLog.mockRestore();
  });

  it('nimmt eine vereinbarte Erhöhung zurück, wenn die Zustimmung scheitert', async () => {
    const fehlerLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, aufrufe } = attrappe((a) => {
      if (a.tabelle === 'mietvertrag') return ok({ id: V1, kaltmiete: 500, betriebskosten: 100 });
      if (a.tabelle === 'mieterhoehungen' && a.art === 'insert') return ok({ id: 'mh1' });
      if (a.art === 'rpc') return { data: null, error: { message: 'x', code: 'P0001', hint: 'SCHON_VEREINBART' } };
      return ok([{ id: 'mh1' }]);
    });
    await expect(werkzeug('mieterhoehung_vereinbaren').ausfuehren({ mietvertrag_id: V1, neue_kaltmiete: 550, gilt_ab: '2026-12-01' }, ctx(db)))
      .rejects.toThrow(/schon eine Erhöhung vereinbart/);
    const anlage = aufrufe.find((a) => a.tabelle === 'mieterhoehungen' && a.art === 'insert');
    expect(anlage?.daten).toMatchObject({ verlangt_am: '2026-11-16', wirksam_ab: '2026-12-01', alte_kaltmiete: 500, neue_kaltmiete: 550, neue_betriebskosten: 100, begruendungsart: 'vereinbarung', status: 'verlangt' });
    expect(aufrufe.some((a) => a.tabelle === 'mieterhoehungen' && a.art === 'delete')).toBe(true);
    fehlerLog.mockRestore();
  });

  it('meldet es, wenn der Vorgang nach gescheiterter Zustimmung nicht zurückgenommen werden kann', async () => {
    const fehlerLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = attrappe((a) => {
      if (a.tabelle === 'mietvertrag') return ok({ id: V1, kaltmiete: 500, betriebskosten: 100 });
      if (a.tabelle === 'mieterhoehungen' && a.art === 'insert') return ok({ id: 'mh1' });
      if (a.art === 'rpc') return { data: null, error: { message: 'x', code: 'P0001', hint: 'SCHON_VEREINBART' } };
      return ok([]);
    });
    await expect(werkzeug('mieterhoehung_vereinbaren').ausfuehren({ mietvertrag_id: V1, neue_kaltmiete: 550, gilt_ab: '2026-12-01' }, ctx(db)))
      .rejects.toThrow(/nicht zurückgenommen/);
    fehlerLog.mockRestore();
  });

  it('lässt den Hausmeister nur Zählerspalten schreiben und führt die Historie', async () => {
    const { db, aufrufe } = attrappe((a) => {
      if (a.tabelle === 'einheiten' && a.art === 'select') return ok({ id: E1, strom_stand_aktuell: 100, strom_stand_datum: '2026-10-01', strom_zaehler: 'S-1' });
      if (a.art === 'update') return ok([{ id: E1 }]);
      if (a.art === 'insert') return ok(null);
      throw new Error('unerwartet');
    });
    const ergebnis = await werkzeug('zaehlerstand_erfassen').ausfuehren({ einheit_id: E1, zaehler: 'strom', stand: 130 }, ctx(db, ['hausmeister']));
    expect(aufrufe.find((a) => a.art === 'update')?.daten).toEqual({ strom_stand_aktuell: 130, strom_stand_datum: '2026-11-16' });
    expect(aufrufe.find((a) => a.art === 'insert')?.daten).toEqual({
      einheit_id: E1, zaehler_typ: 'strom', zaehler_nummer: 'S-1', stand: 130, datum: '2026-11-16', quelle: 'manuell', erstellt_von: 'u1',
    });
    expect(ergebnis).toMatchObject({ aktueller_stand_geaendert: true, historie: true });
  });

  it('erfasst die Kündigung des Mieters mit beiden Datumsfeldern', async () => {
    const { db, aufrufe } = attrappe((a) => (a.art === 'update'
      ? ok([{ id: V1, status: 'gekuendigt', ende_datum: '2027-01-31' }])
      : ok({ id: V1, status: 'aktiv', start_datum: '2024-01-01', ende_datum: null, kuendigungsdatum: null })));
    await werkzeug('kuendigung_erfassen').ausfuehren({ mietvertrag_id: V1, mietende: '2027-01-31' }, ctx(db));
    expect(aufrufe.find((a) => a.art === 'update')?.daten).toMatchObject({ status: 'gekuendigt', kuendigungsdatum: '2027-01-31', ende_datum: '2027-01-31' });
  });
});
