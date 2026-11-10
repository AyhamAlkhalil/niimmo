/**
 * Verteilerschlüssel „nach tatsächlichem Verbrauch“ (seit 10.11.2026).
 *
 * Kundenmeldung: Beim Festlegen der Verteilerschlüssel fehlte die Option. Bis dahin rechnete die Abrechnung einen
 * gespeicherten Schlüssel „verbrauch“ still nach Wohnfläche, und der Vertrag durfte ihn deshalb nicht nennen
 * (02.11.2026). Jetzt trägt Schritt 2 der Abrechnung je Kostenart und Nutzungsperiode den erfassten Verbrauch ein
 * (Tabelle `nebenkosten_verbrauch`), der Anteil ist eigener Verbrauch durch die Summe aller Perioden.
 *
 * Bewusst ohne Ersatzwerte: Fehlt der Verbrauch einer Periode — auch eines Leerstands —, ist die Summe falsch und
 * damit jeder Anteil im Haus. Schritt 3 sperrt dann, statt nach Fläche zu rechnen. Ein Wert gilt nur für genau den
 * Zeitraum, für den er eingetragen wurde; ändert sich ein Vertragsdatum, muss er neu erfasst werden.
 */
import { format } from 'date-fns';

import type { VerbrauchDerPeriode } from './nebenkostenBerechnung';

/** Eine gespeicherte Zeile aus `nebenkosten_verbrauch` */
export interface VerbrauchsErfassung {
  kategorie: string;
  einheit_id: string;
  mietvertrag_id: string | null;
  zeitraum_von: string;
  zeitraum_bis: string;
  verbrauch: number | string | null;
}

/** Was eine Nutzungsperiode für die Zuordnung braucht; Leerstand hat keinen Vertrag */
export interface PeriodeFuerVerbrauch {
  einheitId: string;
  von: Date;
  bis: Date;
  mietvertragId?: string | null;
}

const tag = (d: Date) => format(d, 'yyyy-MM-dd');

/** Gültige Verbrauchszahl oder null — nie eine erfundene Null */
export function verbrauchsZahl(wert: number | string | null | undefined): number | null {
  // Nur Leerzeichen ist leer, nicht 0 — Number(' ') wäre 0 (QA 10.11.2026)
  if (wert === null || wert === undefined || (typeof wert === 'string' && !wert.trim())) return null;
  const n = typeof wert === 'number' ? wert : Number(wert);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Eingetragener Verbrauch genau dieser Periode für die Kostenart, sonst null */
export function verbrauchDerPeriode(
  erfassungen: readonly VerbrauchsErfassung[],
  kategorie: string,
  periode: PeriodeFuerVerbrauch
): number | null {
  const von = tag(periode.von);
  const bis = tag(periode.bis);
  const vertrag = periode.mietvertragId ?? null;
  const treffer = erfassungen.find(
    e =>
      e.kategorie === kategorie &&
      e.einheit_id === periode.einheitId &&
      e.zeitraum_von === von &&
      e.zeitraum_bis === bis &&
      (e.mietvertrag_id ?? null) === vertrag
  );
  return treffer ? verbrauchsZahl(treffer.verbrauch) : null;
}

export interface VerbrauchsBezug {
  /** Je Periode in der übergebenen Reihenfolge; null = nicht eingetragen */
  werte: (number | null)[];
  /** Summe der eingetragenen Werte */
  gesamt: number;
  /** Anzahl Perioden ohne Wert */
  fehlend: number;
}

export function verbrauchsBezug(
  erfassungen: readonly VerbrauchsErfassung[],
  kategorie: string,
  perioden: readonly PeriodeFuerVerbrauch[]
): VerbrauchsBezug {
  const werte = perioden.map(p => verbrauchDerPeriode(erfassungen, kategorie, p));
  return {
    werte,
    gesamt: werte.reduce<number>((s, w) => s + (w ?? 0), 0),
    fehlend: werte.filter(w => w === null).length,
  };
}

/** Verbrauch der i-ten Periode für berechneAnteil / bezugsgroesseFuerSchluessel */
export function verbrauchFuer(bezug: VerbrauchsBezug | undefined, index: number): VerbrauchDerPeriode | undefined {
  if (!bezug) return undefined;
  return { eigen: bezug.werte[index] ?? null, gesamt: bezug.gesamt };
}

/**
 * Sperrgrund für Schritt 3, oder null. Ohne vollständige Werte stimmt die Summe nicht und damit kein Anteil im
 * Haus; bei Summe 0 würde nichts verteilt und die Kosten verschwänden aus der Abrechnung.
 */
export function verbrauchSperrgrund(name: string, bezug: VerbrauchsBezug): string | null {
  if (bezug.werte.length === 0) return null;
  if (bezug.fehlend > 0) {
    return `${name}: Verbrauch fehlt bei ${bezug.fehlend} von ${bezug.werte.length} Nutzungsperioden (auch Leerstand) — bitte in Schritt 2 eintragen.`;
  }
  if (!(bezug.gesamt > 0)) {
    return `${name}: Der eingetragene Verbrauch ergibt zusammen 0 — so lassen sich die Kosten nicht nach Verbrauch verteilen.`;
  }
  return null;
}

/** Wert eines Eingabefelds („12,5“, „1.234,5“) als Verbrauch; leer oder ungültig → null */
export function verbrauchAusEingabe(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  // Tausenderpunkt nur, wenn zusätzlich ein Komma steht — „12.5“ bleibt 12,5
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^\d+(\.\d+)?$/.test(normal)) return null;
  return verbrauchsZahl(Number(normal));
}

/**
 * Welche Zähler der Einheiten den Verbrauch einer Kostenart messen. Nur wo das Datenmodell sie kennt (Kalt- und
 * Warmwasser an der Einheit); Heizkostenverteiler, Wärme- und Stromzähler der Allgemeinflächen sind nicht erfasst.
 */
const ZAEHLER_JE_KATEGORIE: Record<string, { feld: 'kaltwasser_zaehler' | 'warmwasser_zaehler'; name: string }> = {
  wasserversorgung: { feld: 'kaltwasser_zaehler', name: 'Kaltwasserzähler' },
  entwaesserung: { feld: 'kaltwasser_zaehler', name: 'Kaltwasserzähler' },
  warmwasserkosten: { feld: 'warmwasser_zaehler', name: 'Warmwasserzähler' },
};

export interface EinheitMitZaehlern {
  kaltwasser_zaehler: string | null;
  warmwasser_zaehler: string | null;
}

/**
 * Zählerausstattung für den Hinweis im Dialog: „Kaltwasserzähler in 4 von 7 Einheiten“. Verteilt werden darf nach
 * Verbrauch nur, wenn jede Einheit ihren Verbrauch erfasst; sonst fehlt in Schritt 2 ein Wert und die Abrechnung
 * bleibt gesperrt. null, wenn das Datenmodell für die Kostenart keine Zähler kennt.
 */
export function zaehlerAusstattung(
  kategorie: string,
  einheiten: readonly EinheitMitZaehlern[]
): { name: string; mit: number; gesamt: number } | null {
  const zaehler = ZAEHLER_JE_KATEGORIE[kategorie];
  if (!zaehler || einheiten.length === 0) return null;
  const mit = einheiten.filter(e => !!e[zaehler.feld]?.trim()).length;
  return { name: zaehler.name, mit, gesamt: einheiten.length };
}

/** Kostenarten, die unter die Heizkostenverordnung fallen (BetrKV 2.4 bis 2.6) */
const HEIZKOSTEN_KATEGORIEN = new Set(['heizkosten', 'warmwasserkosten', 'verbundene_anlagen']);

/**
 * Hinweis im Dialog, wenn Heizung oder Warmwasser nach Verbrauch verteilt werden sollen. Die HeizkostenV verlangt
 * 50 bis 70 % nach Verbrauch und den Rest nach Fläche (§§ 7, 8); mehr Verbrauch ist nur durch Vereinbarung zulässig
 * (§ 10). „Nach Verbrauch“ hieße hier 100 % — das muss bewusst gewählt sein (Review 10.11.2026).
 */
export function heizkostenHinweis(kategorie: string): string | null {
  if (!HEIZKOSTEN_KATEGORIEN.has(kategorie)) return null;
  return 'Heizung und Warmwasser: Die Heizkostenverordnung verteilt 50–70 % nach Verbrauch, den Rest nach Fläche (Schlüssel am Objekt, z. B. 70/30). „Nach Verbrauch“ hieße hier 100 % — nur wählen, wenn das so vereinbart ist (§ 10 HeizkostenV).';
}
