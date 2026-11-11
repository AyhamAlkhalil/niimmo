/**
 * Der Ablauf „Neuer Mietvertrag" in Schritten und die Platzhalter-Übersicht.
 *
 * Der Vertrag ist eine feste, rechtlich geprüfte Vorlage; der Ablauf befüllt
 * nur ihre Platzhalter. Jeder Platzhalter hat eine Quelle — Objekt, Einheit,
 * Vorvertrag, Selbstauskunft, Stammdaten, Vorgabe oder Eingabe — und einen
 * Schritt, in dem er sich ändern lässt. Die Übersicht im letzten Schritt
 * zeigt genau das (Wunsch vom 20.10.2026: „Wir befüllen eigentlich nur die
 * Platzhalter. Die Platzhalter haben aber verschiedene Quellen.").
 */
import { formatMonat, istPlausiblesDatum } from '../pdf/briefLayout';
import { ungueltigeDaten, type Befund } from './pflichtpruefung';
import {
  hatNamen,
  herkunftText,
  istGleichePerson,
  mieterFuerVertrag,
  positionenSumme,
  rund2,
  type EntwurfPerson,
  type Herkunft,
  type HerkunftKarte,
} from './entwurf';
import { ausgehaendigteSchluessel, type MietvertragDaten } from './typen';
import { brauchtUnterzeichnerWahl, gewaehlterUnterzeichner } from './vertretung';

// ─── Schritte ───────────────────────────────────────────────────────────────

export type SchrittId =
  | 'grundlagen'
  | 'mieter'
  | 'miete'
  | 'mietsache'
  | 'betriebskosten'
  | 'vereinbarungen'
  | 'pruefen'
  | 'start';

export const SCHRITT_TITEL: Record<SchrittId, string> = {
  grundlagen: 'Grundlagen',
  mieter: 'Mieter',
  miete: 'Miete & Laufzeit',
  mietsache: 'Mietsache & Haus',
  betriebskosten: 'Betriebskosten',
  vereinbarungen: 'Vereinbarungen',
  pruefen: 'Prüfen & PDF',
  start: 'Unterschrift & Start',
};

/** Ohne Vorlage entsteht kein PDF — dann heißt der Prüfschritt nur „Prüfen". */
export function schrittTitel(schritt: SchrittId, wohnraum: boolean): string {
  return schritt === 'pruefen' && !wohnraum ? 'Prüfen' : SCHRITT_TITEL[schritt];
}

/**
 * Die Vermietung ist ein Prozess mit Zwischenständen (Kundenwunsch 11.11.2026): zuerst der Mieter, dann Miete
 * und Mietbeginn vorgemerkt, den Mietvertrag später — „ohne direkt den Mietvertrag komplett anzulegen“. Seit dem
 * 03.11.2026 stand der Mieter vorn („Erster Step, Mieter anlegen … und dann Mietvertrag erstellen“); „Mieter
 * speichern“ legt ihn seit dem 11.11.2026 gleich im Bestand an, „Miete speichern“ merkt die Eckdaten vor.
 */
const ALLE: SchrittId[] = ['mieter', 'miete', 'grundlagen', 'mietsache', 'betriebskosten', 'vereinbarungen', 'pruefen', 'start'];

/** Ohne Wohnraum-Vorlage (Gewerbe, Garage, Stellplatz) entfallen die Vertragsklauseln. */
export function schritteFuer(wohnraum: boolean): SchrittId[] {
  return wohnraum ? ALLE : ['mieter', 'miete', 'grundlagen', 'pruefen', 'start'];
}

/** Der erste Schritt des Ablaufs. */
export const ERSTER_SCHRITT: SchrittId = 'mieter';

/** Teil des Ablaufs, zu dem ein Schritt gehört — die Schrittleiste trennt beide: Vermietung, dann Mietvertrag. */
export function teilVon(schritt: SchrittId): 'vermietung' | 'vertrag' {
  return schritt === 'mieter' || schritt === 'miete' ? 'vermietung' : 'vertrag';
}

/** Der spätere von zwei Schritten — für den weitesten erreichten Stand des Vorgangs. */
export function spaetererSchritt(a: string | null | undefined, b: string | null | undefined): SchrittId | null {
  const ia = istSchrittId(a) ? ALLE.indexOf(a) : -1;
  const ib = istSchrittId(b) ? ALLE.indexOf(b) : -1;
  if (ia < 0 && ib < 0) return null;
  return ALLE[Math.max(ia, ib)];
}

/**
 * Ist die Miete vorgemerkt — wurde der Schritt Miete & Laufzeit mit „Miete speichern“ verlassen? Dann liest die
 * Vorvertrags-Auslese ihre Felder nicht mehr ein: Sonst stünde wieder die alte Miete im neuen Vertrag (vgl. die
 * Kundenanmerkung zu § 15 vom 02.11.2026).
 */
export function mieteVorgemerkt(weitester: string | null | undefined): boolean {
  return istSchrittId(weitester) && ALLE.indexOf(weitester) > ALLE.indexOf('miete');
}

/**
 * Weitester Schritt eines Entwurfs, der noch keinen hat (vor dem 11.11.2026 oder von der alten App gespeichert).
 * Dort kam „Grundlagen“ vor „Miete“: Wer dort stand, hatte die Miete noch nicht gesehen (Review 11.11.2026).
 */
export function weitesterAusAltbestand(schritt: string | null | undefined): SchrittId | null {
  if (!istSchrittId(schritt)) return null;
  return schritt === 'grundlagen' ? 'mieter' : schritt;
}

/**
 * Neuer weitester Schritt beim Speichern. Über „Miete & Laufzeit“ hinaus geht es nur mit „Miete speichern“ oder
 * dem PDF — wer über die Schrittleiste vorspringt und zwischenspeichert, hat die Miete nicht vorgemerkt (Review
 * 11.11.2026). Sonst stünde an der Einheit „Miete vorgemerkt“, und die Auslese sperrte Felder, die keiner bestätigt hat.
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
 * mit „Miete speichern“ verlassen oder das PDF erstellt (`naechsterWeitester`) — vorbelegte Werte aus dem
 * Vorvertrag allein zählen nicht. Die letzte Stufe ist
 * nie erledigt: Mit der Aktivierung verschwindet der Vorgang und an seine Stelle tritt der Vertrag.
 */
export function vermietungsStufen(
  e: { personen: EntwurfPerson[]; schritt: string | null; weitesterSchritt?: string | null; dateien: { art: string }[] },
  wohnraum: boolean
): VermietungsStufe[] {
  // Nicht aus `schritt` vorrücken: Der sagt nur, wo es weitergeht (Review 11.11.2026)
  const weitester = istSchrittId(e.weitesterSchritt) ? e.weitesterSchritt : weitesterAusAltbestand(e.schritt);
  const mitmieter = e.personen.filter(p => p.rolle === 'mitmieter' && hatNamen(p));
  // „Weiter: Mietvertrag“ steigt dort ein, wo der Vertragsteil zuletzt stand
  const imVertrag: SchrittId =
    weitester === 'start' ? 'pruefen' : weitester && teilVon(weitester) === 'vertrag' ? weitester : 'grundlagen';
  return [
    { titel: 'Mieter angelegt', kurz: 'Mieter', schritt: 'mieter', erledigt: mitmieter.length > 0 && mitmieter.every(p => !!p.mieterId) },
    { titel: 'Miete vorgemerkt', kurz: 'Miete', schritt: 'miete', erledigt: mieteVorgemerkt(weitester) },
    wohnraum
      ? { titel: 'Mietvertrag als PDF', kurz: 'Mietvertrag', schritt: imVertrag, erledigt: e.dateien.some(d => d.art === 'entwurf_pdf') }
      : { titel: 'Vertrag vorbereitet', kurz: 'Mietvertrag', schritt: imVertrag, erledigt: weitester === 'start' },
    { titel: 'Unterschrift & Start', kurz: 'Unterschrift', schritt: 'start', erledigt: false },
  ];
}

/** Wo „Weiter“ an der Einheit einsteigt: in der ersten offenen Stufe. */
export function naechsteStufe(stufen: VermietungsStufe[]): VermietungsStufe {
  return stufen.find(s => !s.erledigt) ?? stufen[stufen.length - 1];
}

export function istSchrittId(wert: unknown): wert is SchrittId {
  return typeof wert === 'string' && (ALLE as string[]).includes(wert);
}

/**
 * Befunde, die sich nicht im Ablauf beheben lassen, sondern nur am Objekt: der
 * Energieausweis steht nicht im Vertrag und wird seit 03.11.2026 nur dort gepflegt.
 */
export function nurAmObjekt(feld: string): boolean {
  return feld.startsWith('objekt.energieausweis');
}

/** In welchem Schritt lässt sich ein Feld der Pflichtprüfung beheben? */
export function schrittFuerFeld(feld: string): SchrittId {
  if (feld.startsWith('vermieter') || feld === 'objekt.adresse' || feld === 'unterzeichnerVermieter') return 'grundlagen';
  if (feld.startsWith('mieter') || feld === 'anzahlPersonen') return 'mieter';
  if (feld.startsWith('einheit.') || feld.startsWith('objekt.') || feld === 'schliessanlageArt' || feld === 'mitbenutzungEinrichtungen' || feld === 'schluessel') {
    return 'mietsache';
  }
  if (feld === 'betriebskostenPositionen') return 'betriebskosten';
  if (
    feld === 'uebergabezustand' ||
    feld === 'schoenheitsreparaturen' ||
    feld.startsWith('kleinreparatur') ||
    feld === 'besichtigtAm' ||
    feld === 'zusatzvereinbarungen' ||
    feld === 'anlagen' ||
    feld === 'vertragsdatum' ||
    feld === 'unterschriftOrt'
  ) {
    return 'vereinbarungen';
  }
  // Miete, Nebenkosten, Kaution, Laufzeit, Zahlung, Mietanpassung, Mietpreisbremse
  return 'miete';
}

export type SchrittZustand = 'ok' | 'fehlt' | 'hinweis';

/**
 * Zustand je Schritt: „fehlt", wenn dort eine Pflichtangabe offen ist,
 * „hinweis" bei Warnungen. Die Grundanforderungen des Entwurfs (Mitmieter,
 * Mietbeginn, Kaltmiete) zählen auch ohne Vorlage.
 */
export function schrittZustaende(befunde: Befund[], entwurfFehler: { feld: string }[]): Record<SchrittId, SchrittZustand> {
  const zustand = Object.fromEntries(ALLE.map(s => [s, 'ok'])) as Record<SchrittId, SchrittZustand>;
  for (const f of befunde) {
    if (nurAmObjekt(f.feld)) continue;
    const s = schrittFuerFeld(f.feld);
    if (f.schwere === 'blocker') zustand[s] = 'fehlt';
    else if (zustand[s] === 'ok') zustand[s] = 'hinweis';
  }
  for (const f of entwurfFehler) zustand[schrittFuerFeld(f.feld)] = 'fehlt';
  return zustand;
}

function heuteLokal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Was jeder Vertrag braucht — unabhängig davon, ob eine Vorlage existiert: Ohne
 * Vorlage (Garage, Gewerbe) läuft die Pflichtprüfung nicht, aktiviert wird trotzdem.
 * Jeder Eintrag ist ein ganzer Satz.
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
  luecken.push(...ungueltigeDaten(daten));
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

// ─── Platzhalter-Übersicht ──────────────────────────────────────────────────

/**
 * Quelle eines Platzhalters; „eingabe" heißt: von Hand erfasst oder geändert,
 * „bestand": ein vorhandener Mieterdatensatz wurde übernommen.
 */
export type PlatzhalterQuelle = Herkunft | 'eingabe' | 'bestand';

export function quelleText(quelle: PlatzhalterQuelle, vorvertragBeginn: string | null): string {
  if (quelle === 'eingabe') return 'Eingabe';
  if (quelle === 'bestand') return 'aus Mieterbestand';
  return herkunftText(quelle, vorvertragBeginn);
}

export interface PlatzhalterZeile {
  /** Feldpfad wie in der Herkunftskarte und der Pflichtprüfung. */
  feld: string;
  label: string;
  /** Formatierter Wert; leer heißt: nicht befüllt. */
  wert: string;
  quelle: PlatzhalterQuelle | null;
  /** Pflichtangabe offen (Blocker der Pflichtprüfung). */
  fehlt: boolean;
  schritt: SchrittId;
}

export interface PlatzhalterGruppe {
  titel: string;
  zeilen: PlatzhalterZeile[];
}

function eur(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function datum(iso: string | null | undefined): string {
  if (!iso) return '';
  const [j, m, t] = iso.slice(0, 10).split('-');
  return t && m && j ? `${t}.${m}.${j}` : iso;
}

const HEIZUNG: Record<string, string> = {
  zentral: 'Zentralheizung',
  fernwaerme: 'Fernwärme',
  etage: 'Etagenheizung (Mieter)',
  keine: 'keine Heizung',
};
const KAUTION: Record<string, string> = {
  barkaution: 'Barkaution',
  buergschaft: 'Bürgschaft',
  verpfaendung: 'Verpfändung eines Guthabens',
  sparbuch: 'Sparbuch',
  keine: 'keine Kaution',
};
const BK_MODUS: Record<string, string> = {
  vorauszahlung: 'Vorauszahlung',
  pauschale: 'Pauschale',
  inklusiv: 'Inklusivmiete',
};
const BEFRISTUNG: Record<string, string> = {
  eigenbedarf: 'Eigenbedarf',
  bauliche_massnahme: 'bauliche Maßnahme',
  dienstwohnung: 'Werkwohnung',
};

/**
 * Alle Platzhalter der Vorlage mit Wert, Quelle und Schritt.
 * `befunde` markiert die, an denen eine Pflichtangabe fehlt.
 */
export function platzhalterUebersicht(
  d: MietvertragDaten,
  herkunft: HerkunftKarte,
  personen: EntwurfPerson[],
  befunde: Befund[],
  wohnraum: boolean
): PlatzhalterGruppe[] {
  const blocker = befunde.filter(f => f.schwere === 'blocker').map(f => f.feld);
  const fehltBei = (...felder: string[]) => blocker.some(b => felder.some(f => b === f || b.startsWith(`${f}.`) || b.startsWith(`${f}[`)));

  const zeile = (
    feld: string,
    label: string,
    wert: string,
    schritt: SchrittId,
    opt: { quelle?: PlatzhalterQuelle | null; pruef?: string[] } = {}
  ): PlatzhalterZeile => ({
    feld,
    label,
    wert,
    quelle: opt.quelle !== undefined ? opt.quelle : herkunft[feld] ?? (wert ? 'eingabe' : null),
    fehlt: fehltBei(...(opt.pruef ?? [feld])),
    schritt,
  });

  const gruppen: PlatzhalterGruppe[] = [];

  // Vertragsparteien
  const mieterZeilen = mieterFuerVertrag(personen).map((m, i) => {
    const person = personen.filter(p => p.rolle === 'mitmieter' && hatNamen(p))[i];
    const name = m.istUnternehmen ? m.firmenname ?? '' : `${m.anrede ? `${m.anrede} ` : ''}${m.vorname} ${m.nachname}`.trim();
    const anschrift = [m.strasse && `${m.strasse} ${m.hausnummer ?? ''}`.trim(), [m.plz, m.ort].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ');
    const wert = [name, m.geburtsdatum ? `geb. ${datum(m.geburtsdatum)}` : '', anschrift].filter(Boolean).join(' · ');
    return zeile(`mieter[${i}]`, `Mieter ${i + 1}`, wert, 'mieter', {
      quelle: person?.quelle ?? (wert ? 'eingabe' : null),
      pruef: [`mieter[${i}]`],
    });
  });
  gruppen.push({
    titel: 'Vertragsparteien',
    zeilen: [
      zeile('vermieter', 'Vermieter', d.vermieter.firmenname, 'grundlagen', { pruef: ['vermieter'] }),
      brauchtUnterzeichnerWahl(d.vermieter)
        ? zeile('unterzeichnerVermieter', 'unterschreibt', gewaehlterUnterzeichner(d) ?? '', 'grundlagen', {
            quelle: gewaehlterUnterzeichner(d) ? 'eingabe' : null,
            pruef: ['unterzeichnerVermieter', 'vermieter.vertretenDurch'],
          })
        : zeile('vermieter.vertretenDurch', 'vertreten durch', d.vermieter.vertretenDurch.join(', '), 'grundlagen', {
            quelle: d.vermieter.vertretenDurch.length > 0 ? 'stammdaten' : null,
          }),
      ...(mieterZeilen.length > 0
        ? mieterZeilen
        : [zeile('mieter', 'Mieter', '', 'mieter', { quelle: null, pruef: ['mieter'] })]),
      zeile('anzahlPersonen', 'Personen im Haushalt', d.anzahlPersonen > 0 ? String(d.anzahlPersonen) : '', 'mieter'),
    ],
  });

  // Mietsache
  const adresse = [
    `${d.objekt.strasse} ${d.objekt.hausnummer}`.trim(),
    `${d.objekt.plz} ${d.objekt.ort}`.trim(),
  ]
    .filter(Boolean)
    .join(', ');
  const schluessel = ausgehaendigteSchluessel(d.schluessel);
  const mietsache: PlatzhalterZeile[] = [
    zeile('objekt.adresse', 'Anschrift', adresse, 'grundlagen', { quelle: adresse ? 'objekt' : null }),
    zeile('einheit.bezeichnung', 'Einheit', d.einheit.bezeichnung, 'mietsache'),
    zeile('einheit.lage', 'Lage im Gebäude', d.einheit.lage, 'mietsache'),
    zeile('einheit.wohnflaecheQm', 'Wohnfläche', d.einheit.wohnflaecheQm > 0 ? `${d.einheit.wohnflaecheQm.toLocaleString('de-DE')} m²` : '', 'mietsache'),
  ];
  if (wohnraum) {
    mietsache.push(
      zeile('einheit.raumaufstellung', 'Räume', d.einheit.raumaufstellung, 'mietsache'),
      zeile('einheit.nebenraeume', 'Mitvermietete Nebenräume', d.einheit.nebenraeume ?? '', 'mietsache'),
      zeile('einheit.einbaukueche', 'Einbauküche', d.einheit.einbaukueche ? 'mitvermietet' : 'nein', 'mietsache', {
        quelle: herkunft['einheit.einbaukueche'] ?? 'einheit',
      }),
      zeile('mitbenutzungEinrichtungen', 'Gemeinschaftseinrichtungen', d.mitbenutzungEinrichtungen ?? '', 'mietsache'),
      zeile(
        'schliessanlageArt',
        'Schließanlage',
        d.schliessanlageArt === 'zentral' ? 'Zentralschließanlage' : d.schliessanlageArt === 'einzel' ? 'Einzelschließanlage' : '',
        'mietsache'
      ),
      zeile(
        'schluessel',
        'Schlüssel',
        schluessel.length > 0 ? schluessel.map(s => `${s.anzahl} ${s.art}`).join(', ') : 'laut Übergabeprotokoll',
        'mietsache',
        { quelle: herkunft.schluessel ?? (schluessel.length > 0 ? 'eingabe' : 'vorgabe') }
      )
    );
  }
  gruppen.push({ titel: 'Mietsache', zeilen: mietsache });

  // Laufzeit
  gruppen.push({
    titel: 'Laufzeit',
    zeilen: [
      zeile('mietbeginn', 'Mietbeginn', datum(d.mietbeginn), 'miete'),
      zeile(
        'vertragsende',
        'Befristung',
        d.vertragsende
          ? `bis ${datum(d.vertragsende)}${d.befristungsgrund ? ` (${BEFRISTUNG[d.befristungsgrund] ?? d.befristungsgrund})` : ''}`
          : d.vertragsende === ''
            ? 'befristet, Enddatum fehlt'
            : 'unbefristet',
        'miete',
        {
          quelle: herkunft.vertragsende ?? (d.vertragsende !== null ? 'eingabe' : 'vorgabe'),
          pruef: ['vertragsende', 'befristungsgrund'],
        }
      ),
      zeile(
        'kuendigungsverzichtBis',
        'Kündigungsverzicht',
        d.kuendigungsverzichtBis
          ? `bis ${datum(d.kuendigungsverzichtBis)}`
          : d.kuendigungsverzichtBis === ''
            ? 'vereinbart, Enddatum fehlt'
            : 'keiner',
        'miete',
        { quelle: herkunft.kuendigungsverzichtBis ?? (typeof d.kuendigungsverzichtBis === 'string' ? 'eingabe' : 'vorgabe') }
      ),
    ],
  });

  // Miete und Nebenkosten
  const heizkosten = d.heizkostenVorauszahlung ?? 0;
  const bk = d.betriebskostenModus === 'inklusiv' ? 0 : d.betriebskostenVorauszahlung;
  const umgelegt = d.betriebskostenPositionen.filter(p => p.umgelegt);
  const miete: PlatzhalterZeile[] = [
    zeile('kaltmiete', 'Nettokaltmiete', d.kaltmiete > 0 ? eur(d.kaltmiete) : '', 'miete'),
    zeile('betriebskostenModus', 'Betriebskosten', BK_MODUS[d.betriebskostenModus] ?? d.betriebskostenModus, 'miete'),
  ];
  if (d.betriebskostenModus !== 'inklusiv') {
    miete.push(
      zeile(
        'betriebskostenVorauszahlung',
        d.betriebskostenModus === 'pauschale' ? 'Betriebskostenpauschale' : 'Vorauszahlung Betriebskosten',
        eur(d.betriebskostenVorauszahlung),
        'miete',
        // Ein negativer Betrag entsteht, wenn die Heizkosten die Gesamtvorauszahlung übersteigen
        { pruef: ['betriebskostenVorauszahlung', ...(heizkosten > 0 || herkunft.heizkostenVorauszahlung ? [] : ['heizkostenVorauszahlung'])] }
      )
    );
  }
  if (heizkosten > 0 || herkunft.heizkostenVorauszahlung) {
    miete.push(zeile('heizkostenVorauszahlung', 'Vorauszahlung Heizkosten', eur(heizkosten), 'miete'));
  }
  miete.push(
    zeile('summe', 'Monatliche Zahlung', eur(rund2(d.kaltmiete + bk + heizkosten)), 'miete', { quelle: 'berechnet' })
  );
  if (wohnraum && d.betriebskostenModus !== 'inklusiv') {
    miete.push(
      zeile(
        'betriebskostenPositionen',
        'Kostenaufstellung § 4',
        umgelegt.length > 0 ? `${umgelegt.length} Positionen, Summe ${eur(positionenSumme(d))}` : '',
        'betriebskosten'
      )
    );
  }
  miete.push(
    zeile('faelligkeitWerktag', 'Fällig', `am ${d.faelligkeitWerktag}. Werktag`, 'miete'),
    zeile(
      'lastschrift',
      'Zahlungsweg',
      d.lastschrift
        ? `Lastschrift von ${d.lastschriftIban ? d.lastschriftIban.replace(/\s+/g, '') : '—'}`
        : `Überweisung auf ${d.vermieter.mietIban ?? '—'}`,
      'miete',
      {
        quelle: herkunft.lastschrift ?? (d.lastschrift ? 'eingabe' : herkunft['vermieter.mietIban'] ?? 'stammdaten'),
        pruef: ['lastschriftIban', 'vermieter.mietIban'],
      }
    ),
    zeile(
      'mietanpassungArt',
      'Mietanpassung',
      d.mietanpassungArt === 'staffel'
        ? `Staffelmiete (${d.staffelplan?.length ?? 0} Stufen)`
        : d.mietanpassungArt === 'index'
          ? `Indexmiete${d.indexBasisWert ? `, Basis ${d.indexBasisWert.toLocaleString('de-DE')}${formatMonat(d.indexBasisMonat) ? ` (${formatMonat(d.indexBasisMonat)})` : ''}` : ''}`
          : 'ortsübliche Vergleichsmiete (§ 558 BGB)',
      'miete',
      { pruef: ['mietanpassungArt', 'staffelplan', 'indexBasisWert', 'indexBasisMonat'] }
    )
  );
  gruppen.push({ titel: 'Miete und Nebenkosten', zeilen: miete });

  // Kaution
  gruppen.push({
    titel: 'Kaution',
    zeilen: [
      zeile('kautionArt', 'Art', KAUTION[d.kautionArt] ?? d.kautionArt, 'miete'),
      ...(d.kautionArt === 'keine'
        ? []
        : [
            zeile('kautionBetrag', 'Betrag', d.kautionBetrag > 0 ? eur(d.kautionBetrag) : '', 'miete'),
            ...(d.kautionArt === 'barkaution'
              ? [zeile('kautionRaten', 'Zahlbar in', `${d.kautionRaten} Rate${d.kautionRaten === 1 ? '' : 'n'}`, 'miete')]
              : []),
          ]),
    ],
  });

  if (wohnraum) {
    // Heizung und Haus
    gruppen.push({
      titel: 'Heizung und Haus',
      zeilen: [
        zeile('objekt.heizungsart', 'Heizung', d.objekt.heizungsart ? HEIZUNG[d.objekt.heizungsart] : '', 'mietsache'),
        ...(d.objekt.heizungsart === 'zentral' || d.objekt.heizungsart === 'fernwaerme'
          ? [
              zeile(
                'objekt.warmwasser',
                'Warmwasser',
                d.objekt.warmwasser === 'zentral' ? 'zentral über die Heizung' : d.objekt.warmwasser === 'dezentral' ? 'dezentral in der Wohnung' : '',
                'mietsache'
              ),
              zeile('objekt.heizkostenSchluessel', 'Heizkostenverteilung', `${d.objekt.heizkostenSchluessel} (Verbrauch/Fläche)`, 'mietsache'),
            ]
          : []),
        zeile(
          'objekt.gesamtwohnflaecheQm',
          'Gesamtwohnfläche Haus',
          d.objekt.gesamtwohnflaecheQm ? `${d.objekt.gesamtwohnflaecheQm.toLocaleString('de-DE')} m²` : '',
          'mietsache'
        ),
      ],
    });

    // Vereinbarungen
    const vereinbarungen: PlatzhalterZeile[] = [
      zeile(
        'uebergabezustand',
        'Zustand bei Übergabe',
        d.uebergabezustand,
        'vereinbarungen'
      ),
      zeile(
        'schoenheitsreparaturen',
        'Schönheitsreparaturen',
        d.schoenheitsreparaturen ? 'auf den Mieter übertragen' : 'beim Vermieter',
        'vereinbarungen',
        { quelle: herkunft.schoenheitsreparaturen ?? (d.schoenheitsreparaturen ? 'eingabe' : 'vorgabe') }
      ),
      zeile(
        'kleinreparaturEinzelgrenze',
        'Kleinreparaturen',
        `bis ${eur(d.kleinreparaturEinzelgrenze)} je Fall, höchstens ${d.kleinreparaturJahresgrenzeProzent.toLocaleString('de-DE')} % der Jahresmiete`,
        'vereinbarungen'
      ),
      zeile(
        'besichtigtAm',
        'Besichtigung',
        d.besichtigtAm ? `am ${datum(d.besichtigtAm)} (kein Widerrufsrecht)` : 'keine (Widerrufsbelehrung wird beigefügt)',
        'vereinbarungen',
        { quelle: herkunft.besichtigtAm ?? (d.besichtigtAm ? 'eingabe' : 'vorgabe') }
      ),
    ];
    const anlagen = [
      d.anlagen.hausordnung && 'Hausordnung',
      d.anlagen.betrkvKatalog && 'Betriebskostenverordnung',
      d.anlagen.datenschutzhinweis && 'Datenschutzinformation',
      d.anlagen.widerrufsbelehrung && !d.besichtigtAm && 'Widerrufsbelehrung',
      d.anlagen.mietspiegelEinwilligung && 'Einwilligung Mietspiegel',
    ].filter(Boolean);
    vereinbarungen.push(
      zeile('anlagen', 'Anlagen', anlagen.join(', ') || 'keine', 'vereinbarungen'),
      zeile('zusatzvereinbarungen', 'Individuelle Vereinbarungen', d.zusatzvereinbarungen?.trim() ? `${d.zusatzvereinbarungen.split('\n').map(z => z.trim()).filter(Boolean).length} Vereinbarung(en)` : 'keine', 'vereinbarungen', {
        quelle: d.zusatzvereinbarungen?.trim() ? 'eingabe' : 'vorgabe',
      }),
      zeile(
        'vertragsdatum',
        'Ort und Datum der Unterschrift',
        d.unterschriftOrt && d.vertragsdatum ? `${d.unterschriftOrt}, ${datum(d.vertragsdatum)}` : 'bleibt zum Ausfüllen frei',
        'vereinbarungen',
        { quelle: d.unterschriftOrt && d.vertragsdatum ? 'eingabe' : 'vorgabe', pruef: ['vertragsdatum', 'unterschriftOrt'] }
      )
    );
    gruppen.push({ titel: 'Vereinbarungen', zeilen: vereinbarungen });

    if (d.objekt.istAngespannt) {
      // Stehen nicht im Vertragstext, belegen aber die Ausnahme nach § 556e BGB
      gruppen.push({
        titel: 'Mietpreisbremse (Prüfangaben, nicht im Vertragstext)',
        zeilen: [
          zeile(
            'vormieteNetto',
            'Vormiete',
            d.vormieteNetto ? `${eur(d.vormieteNetto)}${d.vormieteBis ? ` bis ${datum(d.vormieteBis)}` : ''}` : '',
            'miete',
            { pruef: ['vormieteNetto', 'vormieteBis'] }
          ),
          zeile('mietpreisbremseAuskunftAm', 'Auskunft § 556g erteilt', datum(d.mietpreisbremseAuskunftAm), 'miete'),
        ],
      });
    }
  }

  return gruppen;
}

/** Wie viele Platzhalter aus welcher Quelle — für die Kopfzeile der Übersicht. */
export function quellenZaehlung(gruppen: PlatzhalterGruppe[]): { quelle: PlatzhalterQuelle; anzahl: number }[] {
  const zaehler = new Map<PlatzhalterQuelle, number>();
  for (const z of gruppen.flatMap(g => g.zeilen)) {
    if (z.quelle) zaehler.set(z.quelle, (zaehler.get(z.quelle) ?? 0) + 1);
  }
  return [...zaehler.entries()].map(([quelle, anzahl]) => ({ quelle, anzahl })).sort((a, b) => b.anzahl - a.anzahl);
}
