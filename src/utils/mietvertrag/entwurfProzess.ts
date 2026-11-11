/**
 * Die Vermietung einer Einheit in Schritten: Mieter → Miete & Laufzeit → Abschließen.
 *
 * Seit dem 11.11.2026 abends (Nutzer: „den Mietvertrag als PDF zu erzeugen ist ein anderer Prozess als einen
 * Mietvertrag im System zu haben mit Mietbeginn etc. — das muss klar abgegrenzt sein. Man soll ganz normal
 * abschließen können, und die Erstellung des Mietvertrags ist optional und kann jederzeit nachträglich erzeugt
 * werden“) ist die Vermietung nur noch das Mietverhältnis im System. Das Schriftstück entsteht getrennt davon am
 * laufenden Vertrag (`MietvertragErstellungModal`). Bis dahin standen fünf Vertragsschritte (Grundlagen,
 * Mietsache & Haus, Betriebskosten, Vereinbarungen, Prüfen & PDF) zwischen Miete und Aktivieren.
 */
import { istPlausiblesDatum } from '../pdf/briefLayout';
import { ungueltigeDaten } from './pflichtpruefung';
import { hatNamen, istGleichePerson, type EntwurfPerson } from './entwurf';
import type { MietvertragDaten } from './typen';

// ─── Schritte ───────────────────────────────────────────────────────────────

export type SchrittId = 'mieter' | 'miete' | 'start';

export const SCHRITT_TITEL: Record<SchrittId, string> = {
  mieter: 'Mieter',
  miete: 'Miete & Laufzeit',
  start: 'Abschließen',
};

export function schrittTitel(schritt: SchrittId): string {
  return SCHRITT_TITEL[schritt];
}

/** Gleich für jede Einheit: Ob es eine Vorlage für das PDF gibt, spielt für die Vermietung keine Rolle mehr. */
export const SCHRITTE: SchrittId[] = ['mieter', 'miete', 'start'];

/** Der erste Schritt des Ablaufs. */
export const ERSTER_SCHRITT: SchrittId = 'mieter';

/** Die Vertragsschritte bis zum 11.11.2026 — gespeicherte Entwürfe tragen sie noch in `schritt`/`weitester_schritt`. */
const FRUEHERE_VERTRAGSSCHRITTE = ['grundlagen', 'mietsache', 'betriebskosten', 'vereinbarungen', 'pruefen'];

export function istSchrittId(wert: unknown): wert is SchrittId {
  return typeof wert === 'string' && (SCHRITTE as string[]).includes(wert);
}

/**
 * Gespeicherter Schritt im heutigen Ablauf. Ein früherer Vertragsschritt lag hinter der Miete — wer dort stand,
 * steht jetzt vor dem Abschließen.
 */
export function alsSchritt(wert: string | null | undefined): SchrittId | null {
  if (istSchrittId(wert)) return wert;
  return typeof wert === 'string' && FRUEHERE_VERTRAGSSCHRITTE.includes(wert) ? 'start' : null;
}

/** Der spätere von zwei Schritten — für den weitesten erreichten Stand des Vorgangs. */
export function spaetererSchritt(a: string | null | undefined, b: string | null | undefined): SchrittId | null {
  const ia = SCHRITTE.indexOf(alsSchritt(a) as SchrittId);
  const ib = SCHRITTE.indexOf(alsSchritt(b) as SchrittId);
  if (ia < 0 && ib < 0) return null;
  return SCHRITTE[Math.max(ia, ib)];
}

/**
 * Ist die Miete vorgemerkt — wurde der Schritt Miete & Laufzeit mit „Miete speichern“ verlassen? Dann liest die
 * Vorvertrags-Auslese ihre Felder nicht mehr ein: Sonst stünde wieder die alte Miete im neuen Vertrag (vgl. die
 * Kundenanmerkung zu § 15 vom 02.11.2026).
 */
export function mieteVorgemerkt(weitester: string | null | undefined): boolean {
  return alsSchritt(weitester) === 'start';
}

/**
 * Weitester Schritt eines Entwurfs, der noch keinen hat (vor dem 11.11.2026 oder von der alten App gespeichert).
 * Dort kam „Grundlagen“ vor „Miete“: Wer dort stand, hatte die Miete noch nicht gesehen (Review 11.11.2026).
 */
export function weitesterAusAltbestand(schritt: string | null | undefined): SchrittId | null {
  return schritt === 'grundlagen' ? 'mieter' : alsSchritt(schritt);
}

/**
 * Neuer weitester Schritt beim Speichern. Über „Miete & Laufzeit“ hinaus geht es nur mit „Miete speichern“ — wer
 * über die Schrittleiste vorspringt und zwischenspeichert, hat die Miete nicht vorgemerkt (Review 11.11.2026).
 * Sonst stünde an der Einheit „Miete vorgemerkt“, und die Auslese sperrte Felder, die keiner bestätigt hat.
 */
export function naechsterWeitester(
  bisher: string | null | undefined,
  ziel: string | null | undefined,
  mieteBestaetigt: boolean
): SchrittId | null {
  const kandidat = spaetererSchritt(bisher, ziel);
  if (!mieteVorgemerkt(kandidat) || mieteVorgemerkt(bisher) || mieteBestaetigt) return kandidat;
  return 'miete';
}

export interface VermietungsStufe {
  titel: string;
  /** Kurz für „Weiter: …“ an der Einheit. */
  kurz: string;
  erledigt: boolean;
  /** Schritt, in dem die Stufe bearbeitet wird. */
  schritt: SchrittId;
}

/**
 * Stand der Vermietung, wie ihn die Einheit zeigt. „Miete vorgemerkt“ heißt: Der Schritt Miete & Laufzeit wurde
 * mit „Miete speichern“ verlassen (`naechsterWeitester`) — vorbelegte Werte aus dem Vorvertrag allein zählen nicht.
 * Die letzte Stufe ist nie erledigt: Mit dem Abschließen verschwindet der Vorgang, und an seine Stelle tritt der
 * Vertrag. Den Mietvertrag als PDF gibt es hier nicht mehr — er ist kein Schritt der Vermietung.
 */
export function vermietungsStufen(e: {
  personen: EntwurfPerson[];
  schritt: string | null;
  weitesterSchritt?: string | null;
}): VermietungsStufe[] {
  // Nicht aus `schritt` vorrücken: Der sagt nur, wo es weitergeht (Review 11.11.2026)
  const weitester = alsSchritt(e.weitesterSchritt) ?? weitesterAusAltbestand(e.schritt);
  const mitmieter = e.personen.filter(p => p.rolle === 'mitmieter' && hatNamen(p));
  return [
    { titel: 'Mieter angelegt', kurz: 'Mieter', schritt: 'mieter', erledigt: mitmieter.length > 0 && mitmieter.every(p => !!p.mieterId) },
    { titel: 'Miete vorgemerkt', kurz: 'Miete', schritt: 'miete', erledigt: mieteVorgemerkt(weitester) },
    { titel: 'Abgeschlossen', kurz: 'Abschließen', schritt: 'start', erledigt: false },
  ];
}

/**
 * Darf abgeschlossen werden? Eine unterschriebene Fassung oder ein PDF braucht es dafür nicht — wohl aber eine mit
 * „Miete speichern“ bestätigte Miete: Sonst gingen ungeprüfte Werte aus dem Vorvertrag ins Mietkonto (Review 11.11.2026).
 */
export function abschliessenMoeglich(z: {
  mieteOffen: boolean;
  ungespeichert: boolean;
  luecken: number;
  beginnOffen: boolean;
  ueberschneidungOffen: boolean;
}): boolean {
  return !z.mieteOffen && !z.ungespeichert && z.luecken === 0 && !z.beginnOffen && !z.ueberschneidungOffen;
}

/** Wo „Weiter“ an der Einheit einsteigt: in der ersten offenen Stufe. */
export function naechsteStufe(stufen: VermietungsStufe[]): VermietungsStufe {
  return stufen.find(s => !s.erledigt) ?? stufen[stufen.length - 1];
}

/**
 * Wo sich ein Feld bearbeiten lässt: im Schritt Mieter, im Schritt Miete & Laufzeit — oder nur noch im Mietvertrag
 * (PDF am laufenden Vertrag), etwa Vertragsdatum oder Besichtigung.
 */
export function bereichFuerFeld(feld: string): 'mieter' | 'miete' | 'vertrag' {
  if (feld.startsWith('mieter') || feld === 'anzahlPersonen') return 'mieter';
  if (feld === 'vertragsdatum' || feld === 'besichtigtAm') return 'vertrag';
  // Miete, Nebenkosten, Kaution, Laufzeit, Zahlung, Mietanpassung, Mietpreisbremse
  return 'miete';
}

export type SchrittZustand = 'ok' | 'fehlt';

/** Zustand je Schritt für die Schrittleiste: „fehlt“, wenn dort etwas für das Abschließen offen ist. */
export function schrittZustaende(luecken: { feld: string }[]): Record<SchrittId, SchrittZustand> {
  const zustand: Record<SchrittId, SchrittZustand> = { mieter: 'ok', miete: 'ok', start: 'ok' };
  for (const l of luecken) {
    const bereich = bereichFuerFeld(l.feld);
    if (bereich !== 'vertrag') zustand[bereich] = 'fehlt';
  }
  return zustand;
}

function heuteLokal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Was das Mietverhältnis im System zum Abschließen braucht — für jede Einheit. Die Pflichtprüfung der Vorlage
 * läuft erst beim Mietvertrag (PDF). Jeder Eintrag ist ein ganzer Satz.
 */
export function entwurfLuecken(daten: MietvertragDaten, personen: EntwurfPerson[]): { feld: string; text: string }[] {
  const luecken: { feld: string; text: string }[] = [];
  const parteien = personen.filter(p => p.rolle === 'mitmieter' && hatNamen(p));
  if (parteien.length === 0) luecken.push({ feld: 'mieter', text: 'Mindestens ein Mitmieter mit Namen fehlt.' });
  // Dieselbe Person auf zwei Karten (z. B. Bestandsmieter gewählt, dann seine Selbstauskunft geladen)
  parteien.forEach((p, i) => {
    const frueher = parteien.findIndex((q, j) => j < i && istGleichePerson(p, q));
    if (frueher >= 0) {
      luecken.push({
        feld: `mieter[${i}]`,
        text: `${`${p.vorname} ${p.nachname}`.trim() || 'Eine Person'} steht doppelt im Vertrag (Mitmieter ${frueher + 1} und ${i + 1}). Bitte eine der beiden Karten entfernen.`,
      });
    }
  });
  // Ein halbes Geburtsdatum stünde im Rubrum und verhinderte den Dublettenabgleich
  const heute = heuteLokal();
  parteien.forEach((p, i) => {
    if (!p.istUnternehmen && p.geburtsdatum && (!istPlausiblesDatum(p.geburtsdatum) || p.geburtsdatum > heute)) {
      luecken.push({
        feld: `mieter[${i}].geburtsdatum`,
        text: `Das Geburtsdatum von ${`${p.vorname} ${p.nachname}`.trim()} ist kein gültiges Datum.`,
      });
    }
  });
  if (!daten.mietbeginn) luecken.push({ feld: 'mietbeginn', text: 'Der Mietbeginn fehlt.' });
  if (!(daten.kaltmiete > 0)) luecken.push({ feld: 'kaltmiete', text: 'Die Kaltmiete fehlt.' });
  // „befristet" gewählt, Datum noch offen — sonst gälte der Vertrag still als unbefristet
  if (daten.vertragsende === '') luecken.push({ feld: 'vertragsende', text: 'Das Enddatum der Befristung fehlt.' });
  if (daten.kuendigungsverzichtBis === '') {
    luecken.push({ feld: 'kuendigungsverzichtBis', text: 'Das Ende des Kündigungsverzichts fehlt.' });
  }
  // Vertragsdatum und Besichtigung gehören zum Mietvertrag (PDF) — dort werden sie geprüft, nicht beim Abschließen
  luecken.push(...ungueltigeDaten(daten).filter(f => bereichFuerFeld(f.feld) !== 'vertrag'));
  if (istPlausiblesDatum(daten.mietbeginn)) {
    if (istPlausiblesDatum(daten.vertragsende) && daten.vertragsende <= daten.mietbeginn) {
      luecken.push({ feld: 'vertragsende', text: 'Das Vertragsende liegt nicht nach dem Mietbeginn.' });
    }
    if (istPlausiblesDatum(daten.kuendigungsverzichtBis) && daten.kuendigungsverzichtBis < daten.mietbeginn) {
      luecken.push({ feld: 'kuendigungsverzichtBis', text: 'Der Kündigungsverzicht endet vor dem Mietbeginn.' });
    }
  }
  return luecken;
}
