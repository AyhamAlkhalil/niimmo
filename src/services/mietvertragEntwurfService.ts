/**
 * Speichern, Aktivieren und Verwerfen von Mietvertragsentwürfen.
 *
 * Ein Entwurf liegt in `mietvertrag_entwuerfe` und zählt nirgends mit. Erst
 * `aktiviereEntwurf` legt Vertrag, Verknüpfungen, Dokumente und die
 * Forderungen an — und die Mieter, die noch keinen Datensatz haben — in einer
 * Transaktion (`aktiviere_mietvertrag_entwurf`), die den Entwurf zuerst
 * beansprucht. Mieter lassen sich seit dem 10.11.2026 auch vorher anlegen
 * (`legeMieterAusEntwurfAn`), der Vertrag folgt dann später oder nie. Dateien des Entwurfs liegen unter
 * `mietvertrag-entwuerfe/<id>/`; Pfade entstehen nie aus Namen (Storage lehnt
 * Umlaute ab, siehe storagePfad.ts).
 */
import { format } from 'date-fns';

import { supabase } from '@/integrations/supabase/client';
import type { Json, Tables } from '@/integrations/supabase/types';
import { dateiendung } from '@/utils/storagePfad';
import { alleSeiten } from '@/utils/supabaseSeiten';
import {
  aktivierungsDaten,
  anzulegendeMieter,
  anzulegendePersonen,
  bestandsStammdaten,
  doppeltAufKarten,
  moeglicheDublettenIn,
  personName,
  type EntwurfDatei,
  type EntwurfPerson,
  type HerkunftKarte,
  type MoeglicheDublette,
} from '@/utils/mietvertrag/entwurf';
import { weitesterAusAltbestand } from '@/utils/mietvertrag/entwurfProzess';
import { vertragsTitel, type VertragsKennung } from '@/utils/mietvertrag/fassungen';
import type { MietvertragDaten } from '@/utils/mietvertrag/typen';

export const ENTWURF_ORDNER = 'mietvertrag-entwuerfe';

export interface EntwurfZeile {
  id: string;
  einheitId: string;
  vorvertragId: string | null;
  daten: MietvertragDaten;
  personen: EntwurfPerson[];
  herkunft: HerkunftKarte;
  dateien: EntwurfDatei[];
  erstelltAm: string;
  aktualisiertAm: string;
  schritt: string | null;
  /** Weitester gespeicherter Schritt — der Stand der Vermietung an der Einheit (seit 11.11.2026). */
  weitesterSchritt: string | null;
}

export function leseEntwurfZeile(z: Tables<'mietvertrag_entwuerfe'>): EntwurfZeile {
  return {
    id: z.id,
    einheitId: z.einheit_id,
    vorvertragId: z.vorvertrag_id,
    daten: z.daten as unknown as MietvertragDaten,
    personen: (Array.isArray(z.personen) ? z.personen : []) as unknown as EntwurfPerson[],
    herkunft: (z.herkunft ?? {}) as unknown as HerkunftKarte,
    dateien: (Array.isArray(z.dateien) ? z.dateien : []) as unknown as EntwurfDatei[],
    erstelltAm: z.erstellt_am,
    aktualisiertAm: z.aktualisiert_am,
    schritt: z.schritt,
    weitesterSchritt: z.weitester_schritt ?? weitesterAusAltbestand(z.schritt),
  };
}

function stempel(jetzt: Date): string {
  return `${format(jetzt, 'yyyy-MM-dd')}_${format(jetzt, 'HHmmss')}`;
}

async function hochladen(pfad: string, datei: Blob, typ: string): Promise<void> {
  const { error } = await supabase.storage.from('dokumente').upload(pfad, datei, { contentType: typ, upsert: false });
  if (error) throw new Error(`Datei konnte nicht abgelegt werden: ${error.message}`);
}

async function entfernen(pfade: string[]): Promise<void> {
  if (pfade.length === 0) return;
  await supabase.storage.from('dokumente').remove(pfade);
}

/** Pfade, die schon an einem Vertrag hängen — die darf ein Entwurf nie löschen. */
async function belegtePfade(pfade: string[]): Promise<Set<string>> {
  if (pfade.length === 0) return new Set();
  const { data, error } = await supabase.from('dokumente').select('pfad').in('pfad', pfade);
  if (error) throw new Error(`Dokumente konnten nicht geprüft werden: ${error.message}`);
  return new Set((data ?? []).map(d => d.pfad));
}

// ─── Speichern ──────────────────────────────────────────────────────────────

export interface SpeichernArgs {
  id: string;
  istNeu: boolean;
  /** Stand beim Öffnen; ein zwischenzeitlich geänderter Entwurf wird nicht überschrieben. */
  aktualisiertAm: string | null;
  einheitId: string;
  vorvertragId: string | null;
  daten: MietvertragDaten;
  personen: EntwurfPerson[];
  herkunft: HerkunftKarte;
  bisherigeDateien: EntwurfDatei[];
  /** Neues Entwurfs-PDF; `null`, solange Pflichtangaben fehlen oder keine Vorlage existiert. */
  pdf: Blob | null;
  /**
   * Ohne neues PDF das bisherige behalten — nur wenn sich seit dem letzten
   * Speichern nichts geändert hat und es den Stand also noch zeigt.
   */
  pdfBehalten?: boolean;
  /** In dieser Sitzung neu hochgeladene Selbstauskünfte. */
  selbstauskuenfte: File[];
  /** Schritt, in dem der Ablauf beim nächsten Öffnen weitergeht. */
  schritt: string | null;
  /** Weitester erreichter Schritt; geht beim Zurückblättern nicht zurück. */
  weitesterSchritt: string | null;
}

export interface SpeicherErgebnis {
  dateien: EntwurfDatei[];
  /** Neuer Stand für die nächste Sperrprüfung. */
  aktualisiertAm: string;
}

export async function speichereEntwurf(a: SpeichernArgs): Promise<SpeicherErgebnis> {
  const jetzt = new Date();
  let aktualisiertAm = a.aktualisiertAm ?? '';
  const neuHochgeladen: string[] = [];
  let dateien = [...a.bisherigeDateien];
  let ersetztesPdf: string[] = [];

  try {
    for (const [i, datei] of a.selbstauskuenfte.entries()) {
      const endung = dateiendung(datei.name, datei.type, 'pdf');
      const pfad = `${ENTWURF_ORDNER}/${a.id}/Selbstauskunft_${stempel(jetzt)}_${i + 1}.${endung}`;
      await hochladen(pfad, datei, datei.type || 'application/octet-stream');
      neuHochgeladen.push(pfad);
      dateien.push({
        pfad,
        titel: `Selbstauskunft${a.selbstauskuenfte.length > 1 ? ` ${i + 1}` : ''}.${endung}`,
        kategorie: 'Mieterunterlagen',
        dateityp: datei.type || 'application/octet-stream',
        groesse_bytes: datei.size,
        art: 'selbstauskunft',
      });
    }

    // Ein Entwurf hat höchstens ein PDF; das alte fällt weg, sobald das neue sicher liegt.
    // Ohne neues PDF bleibt es nur, wenn es den gespeicherten Stand noch zeigt.
    if (a.pdf || !a.pdfBehalten) {
      ersetztesPdf = dateien.filter(d => d.art === 'entwurf_pdf').map(d => d.pfad);
      dateien = dateien.filter(d => d.art !== 'entwurf_pdf');
    }
    if (a.pdf) {
      const pfad = `${ENTWURF_ORDNER}/${a.id}/Mietvertrag_Entwurf_${stempel(jetzt)}.pdf`;
      await hochladen(pfad, a.pdf, 'application/pdf');
      neuHochgeladen.push(pfad);
      dateien.push({
        pfad,
        titel: 'Mietvertrag-Entwurf (nicht unterschrieben).pdf',
        kategorie: 'Mietvertrag',
        dateityp: 'application/pdf',
        groesse_bytes: a.pdf.size,
        art: 'entwurf_pdf',
      });
    }

    const zeile = {
      einheit_id: a.einheitId,
      vorvertrag_id: a.vorvertragId,
      daten: a.daten as unknown as Json,
      personen: a.personen as unknown as Json,
      herkunft: a.herkunft as unknown as Json,
      dateien: dateien as unknown as Json,
      schritt: a.schritt,
      weitester_schritt: a.weitesterSchritt,
    };

    if (a.istNeu) {
      const { data: user } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('mietvertrag_entwuerfe')
        .insert({ id: a.id, ...zeile, erstellt_von: user.user?.id ?? null })
        .select('aktualisiert_am')
        .single();
      if (error) throw new Error(`Entwurf konnte nicht gespeichert werden: ${error.message}`);
      aktualisiertAm = data.aktualisiert_am;
    } else {
      let anfrage = supabase.from('mietvertrag_entwuerfe').update(zeile).eq('id', a.id);
      if (a.aktualisiertAm) anfrage = anfrage.eq('aktualisiert_am', a.aktualisiertAm);
      const { data, error } = await anfrage.select('id, aktualisiert_am');
      if (error) throw new Error(`Entwurf konnte nicht gespeichert werden: ${error.message}`);
      // Ein Update ohne Treffer ist kein Fehler für PostgREST — für uns schon.
      if (!data || data.length === 0) {
        throw new Error(
          'Der Entwurf wurde inzwischen geändert, aktiviert oder verworfen. Bitte schließen und neu öffnen — es wurde nichts überschrieben.'
        );
      }
      aktualisiertAm = data[0].aktualisiert_am;
    }
  } catch (e) {
    await entfernen(neuHochgeladen);
    throw e;
  }

  // Erst jetzt: ohne gespeicherte Zeile wäre das alte PDF die einzige Fassung.
  const belegt = await belegtePfade(ersetztesPdf).catch(() => new Set(ersetztesPdf));
  await entfernen(ersetztesPdf.filter(p => !belegt.has(p)));
  return { dateien, aktualisiertAm };
}

// ─── Verwerfen ──────────────────────────────────────────────────────────────

/**
 * Löscht Entwurf, Entwurfs-PDF und Selbstauskunft. Mieter im Bestand bleiben — auch die, die über
 * „Mieter anlegen“ schon vor dem Vertrag angelegt wurden (seit 10.11.2026).
 */
export async function verwirfEntwurf(entwurf: Pick<EntwurfZeile, 'id' | 'dateien'>): Promise<void> {
  const pfade = entwurf.dateien.map(d => d.pfad);
  // Dateien eines schon aktivierten Vertrags bleiben in jedem Fall stehen
  const belegt = await belegtePfade(pfade);
  const frei = pfade.filter(p => !belegt.has(p));
  if (frei.length > 0) {
    const { error } = await supabase.storage.from('dokumente').remove(frei);
    // Erst die Dateien: Bleibt die Zeile stehen, lässt sich das Verwerfen wiederholen.
    if (error) throw new Error(`Dateien des Entwurfs konnten nicht gelöscht werden: ${error.message}`);
  }
  const { error } = await supabase.from('mietvertrag_entwuerfe').delete().eq('id', entwurf.id);
  if (error) throw new Error(`Entwurf konnte nicht gelöscht werden: ${error.message}`);
}

// ─── Aktivieren ─────────────────────────────────────────────────────────────

/**
 * Abschließen der Vermietung (seit 11.11.2026 ohne unterschriebene Fassung und ohne PDF — „ganz normal abschließen,
 * die Erstellung des Mietvertrags ist optional und kann jederzeit nachträglich erzeugt werden“). Der Vertrag trägt
 * `unterschrift_ausstehend`, bis die unterschriebene Fassung über `reicheUnterschriftNach` vorliegt.
 */
export interface AktivierenArgs {
  entwurf: EntwurfZeile;
  /** Wohnraum mit einem PDF aus dem früheren Ablauf — dann gilt die Vorlagenfassung als vereinbart. */
  mitVorlage: boolean;
}

export interface AktivierenErgebnis {
  vertragId: string;
  nachgeholt: number;
  hinweise: string[];
}

export async function aktiviereEntwurf(a: AktivierenArgs): Promise<AktivierenErgebnis> {
  const vertragId = crypto.randomUUID();
  const hinweise: string[] = [];

  // Abgeschlossen wird der gespeicherte Stand — ein PDF aus dem früheren Ablauf gehört zu ihm. Was die Oberfläche
  // zeigt, kann seitdem Objekt- oder Vermieterdaten nachgezogen haben.
  const { data: zeile, error: ladeFehler } = await supabase
    .from('mietvertrag_entwuerfe')
    .select('*')
    .eq('id', a.entwurf.id)
    .maybeSingle();
  if (ladeFehler) throw new Error(`Der Entwurf konnte nicht geladen werden: ${ladeFehler.message}`);
  if (!zeile) throw new Error('Den Entwurf gibt es nicht mehr — er wurde schon aktiviert oder verworfen.');
  const entwurf = leseEntwurfZeile(zeile);
  if (a.entwurf.aktualisiertAm && entwurf.aktualisiertAm !== a.entwurf.aktualisiertAm) {
    throw new Error('Der Entwurf wurde inzwischen an anderer Stelle geändert. Bitte schließen und neu öffnen.');
  }

  const zeilen = aktivierungsDaten({
    id: vertragId,
    einheitId: entwurf.einheitId,
    daten: entwurf.daten,
    herkunft: entwurf.herkunft,
    vorvertragId: entwurf.vorvertragId,
    mitVorlage: a.mitVorlage && entwurf.dateien.some(d => d.art === 'entwurf_pdf'),
    personen: entwurf.personen,
  });
  if (zeilen.verknuepfungen.length === 0) {
    throw new Error('Der Entwurf hat keinen Mitmieter mit Namen — wer soll den Vertrag schließen?');
  }

  // Alles in einer Transaktion
  const { data, error } = await supabase.rpc('aktiviere_mietvertrag_entwurf', {
    p_entwurf_id: entwurf.id,
    p_vertrag: { ...zeilen.vertrag, unterschrift_ausstehend: true } as unknown as Json,
    p_neue_mieter: zeilen.neueMieter as unknown as Json,
    p_verknuepfungen: zeilen.verknuepfungen as unknown as Json,
    p_dokumente: [
      ...entwurf.dateien.map(d => ({
        titel: d.titel,
        pfad: d.pfad,
        kategorie: d.kategorie,
        dateityp: d.dateityp,
        groesse_bytes: d.groesse_bytes,
      })),
    ] as unknown as Json,
  });

  if (error) {
    // Kam nur die Antwort nicht an, steht der Vertrag schon
    const { data: steht, error: pruefFehler } = await supabase.from('mietvertrag').select('id').eq('id', vertragId).maybeSingle();
    if (pruefFehler) {
      throw new Error(
        `${error.message} Ob der Vertrag angelegt wurde, ließ sich nicht prüfen. Bitte die Seite neu laden und an der Einheit nachsehen, bevor du es noch einmal versuchst.`
      );
    }
    if (!steht) throw new Error(`${error.message} Es wurde nichts angelegt; der Entwurf bleibt erhalten.`);
    hinweise.push('Die Bestätigung des Servers kam nicht an; der Vertrag steht aber.');
  }

  const ergebnis = (data ?? {}) as { vertrag_id?: string; nachgeholt?: number };

  // 3. Bei vorhandenen Mietern nur leere Kontakt- und Anschriftsfelder ergänzen (nicht kritisch).
  // Nur, was auf der Karte geändert wurde (bestandsStammdaten): Bis zum 27.10.2026 kam hier die
  // ganze alte Karte zum Zug — eine im Bestand inzwischen gelöschte falsche Rufnummer kam zurück.
  for (const p of entwurf.personen.filter(m => m.rolle === 'mitmieter' && m.mieterId)) {
    const { data: vorhanden } = await supabase
      .from('mieter')
      .select('hauptmail, telnr, geburtsdatum, strasse, hausnummer, plz, ort, anrede, vertreten_durch')
      .eq('id', p.mieterId!)
      .maybeSingle();
    if (!vorhanden) continue;
    const neu = bestandsStammdaten(p);
    const ergaenzung: Record<string, string | null> = {};
    for (const feld of ['hauptmail', 'telnr', 'geburtsdatum', 'strasse', 'hausnummer', 'plz', 'ort', 'anrede', 'vertreten_durch'] as const) {
      if (!vorhanden[feld] && neu[feld]) ergaenzung[feld] = neu[feld] as string;
    }
    if (Object.keys(ergaenzung).length > 0) {
      const { error: fehler } = await supabase.from('mieter').update(ergaenzung).eq('id', p.mieterId!);
      if (fehler) hinweise.push(`Kontaktdaten eines vorhandenen Mieters wurden nicht ergänzt (${fehler.message}).`);
    }
  }

  return { vertragId: ergebnis.vertrag_id ?? vertragId, nachgeholt: ergebnis.nachgeholt ?? 0, hinweise };
}

// ─── Mieter anlegen, ohne Vertrag ───────────────────────────────────────────

type AbgleichMieter = Pick<Tables<'mieter'>, 'id' | 'vorname' | 'nachname' | 'geburtsdatum' | 'hauptmail' | 'firmenname' | 'ist_unternehmen'>;

/** Gleiche Prüfung wie im Schritt Mieter (`findeVorhandeneMieter`) — für den Weg über die Einheitskarte. */
export async function moeglicheDubletten(personen: EntwurfPerson[]): Promise<MoeglicheDublette[]> {
  if (anzulegendePersonen(personen).length === 0) return [];
  const bestand = await alleSeiten<AbgleichMieter>((von, bis, mitZaehlung) =>
    supabase
      .from('mieter')
      .select('id, vorname, nachname, geburtsdatum, hauptmail, firmenname, ist_unternehmen', {
        count: mitZaehlung ? 'exact' : undefined,
      })
      .order('id')
      .range(von, bis)
  );
  return moeglicheDublettenIn(personen, bestand);
}

export interface MieterAnlegenErgebnis {
  /** Namen der jetzt angelegten Mieter; leer, wenn schon alle einen Datensatz hatten. */
  angelegt: string[];
  /** Personen des Entwurfs nach dem Anlegen, mit `mieterId`. */
  personen: EntwurfPerson[];
  aktualisiertAm: string;
}

/**
 * „Mieter anlegen“: Die Mitmieter des gespeicherten Entwurfs ohne Datensatz kommen in den Mieterbestand,
 * der Mietvertrag kann warten (Kundenwunsch 10.11.2026). Maßgeblich ist der gespeicherte Stand — ihn sperrt
 * die Funktion. Kam nur die Antwort nicht an, tragen die Personen ihren Datensatz schon, und ein zweiter
 * Versuch legt niemanden doppelt an.
 */
export async function legeMieterAusEntwurfAn(entwurfId: string): Promise<MieterAnlegenErgebnis> {
  const { data: zeile, error: ladeFehler } = await supabase
    .from('mietvertrag_entwuerfe')
    .select('*')
    .eq('id', entwurfId)
    .maybeSingle();
  if (ladeFehler) throw new Error(`Der Entwurf konnte nicht geladen werden: ${ladeFehler.message}`);
  if (!zeile) throw new Error('Den Entwurf gibt es nicht mehr — er wurde schon aktiviert oder verworfen.');
  const entwurf = leseEntwurfZeile(zeile);

  const neu = anzulegendePersonen(entwurf.personen);
  if (neu.length === 0) return { angelegt: [], personen: entwurf.personen, aktualisiertAm: entwurf.aktualisiertAm };
  const doppelt = doppeltAufKarten(entwurf.personen);
  if (doppelt.length > 0) {
    throw new Error(`${doppelt.join(', ')} steht doppelt im Entwurf. Bitte im Schritt „Mieter“ eine der beiden Karten entfernen.`);
  }

  const { data, error } = await supabase.rpc('lege_mieter_aus_entwurf_an', {
    p_entwurf_id: entwurf.id,
    p_stand: entwurf.aktualisiertAm,
    p_neue_mieter: anzulegendeMieter(entwurf.personen) as unknown as Json,
  });
  if (error) throw new Error(`Es wurde niemand angelegt: ${error.message}`);
  const antwort = (data ?? {}) as { personen?: unknown; aktualisiert_am?: string };
  return {
    angelegt: neu.map(personName),
    personen: Array.isArray(antwort.personen) ? (antwort.personen as EntwurfPerson[]) : entwurf.personen,
    aktualisiertAm: antwort.aktualisiert_am ?? entwurf.aktualisiertAm,
  };
}

// ─── Unterschriebene Fassung ────────────────────────────────────────────────

/**
 * Mieter, Adresse und Lage eines Vertrags für den Titel seiner Dokumente (`vertragsTitel`). Scheitert das Laden, bleibt
 * der Titel kürzer — das Ablegen der unterschriebenen Fassung hängt nicht daran.
 */
export async function ladeVertragsKennung(vertragId: string): Promise<VertragsKennung> {
  const leer: VertragsKennung = { mieter: [], adresse: '', lage: '' };
  const { data, error } = await supabase
    .from('mietvertrag')
    .select(
      'einheit:einheit_id (etage, bezeichnung, immobilie:immobilie_id (strasse, hausnummer)), mietvertrag_mieter (position, mieter:mieter_id (nachname, firmenname, ist_unternehmen))'
    )
    .eq('id', vertragId)
    .maybeSingle();
  if (error || !data) return leer;
  const einheit = data.einheit as { etage: string | null; bezeichnung: string | null; immobilie: { strasse: string | null; hausnummer: string | null } | null } | null;
  const verknuepfungen = (data.mietvertrag_mieter ?? []) as {
    position: number | null;
    mieter: { nachname: string | null; firmenname: string | null; ist_unternehmen: boolean | null } | null;
  }[];
  return {
    mieter: [...verknuepfungen]
      .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
      .map(v => (v.mieter?.ist_unternehmen && v.mieter.firmenname?.trim()) || v.mieter?.nachname?.trim() || '')
      .filter(Boolean),
    adresse: [einheit?.immobilie?.strasse, einheit?.immobilie?.hausnummer].filter(Boolean).join(' ').trim(),
    lage: (einheit?.etage || einheit?.bezeichnung || '').trim(),
  };
}

function unterschriftDokument(vertragId: string, datei: File, kennung: VertragsKennung) {
  const endung = dateiendung(datei.name, datei.type, 'pdf');
  const jetzt = new Date();
  return {
    // Mieter, Mietsache und Zeitpunkt: mehrere Fassungen lassen sich nach dem Herunterladen unterscheiden (12.11.2026)
    titel: vertragsTitel(kennung, { art: 'unterschrieben', zeitpunkt: jetzt }),
    pfad: `mietvertraege/${vertragId}/Mietvertrag_unterschrieben_${stempel(jetzt)}.${endung}`,
    kategorie: 'Mietvertrag' as const,
    dateityp: datei.type || 'application/pdf',
    groesse_bytes: datei.size,
  };
}

/**
 * Unterschriebene Fassung zu einem Vertrag nachreichen, der ohne sie aktiviert wurde (11.11.2026). Datei hochladen,
 * dann Dokument und Merker in einer Transaktion (`unterschrift_nachreichen`); scheitert das, fliegt die Datei wieder raus.
 */
export async function reicheUnterschriftNach(vertragId: string, datei: File): Promise<void> {
  const dokument = unterschriftDokument(vertragId, datei, await ladeVertragsKennung(vertragId));
  await hochladen(dokument.pfad, datei, dokument.dateityp);
  const { error } = await supabase.rpc('unterschrift_nachreichen', {
    p_vertrag_id: vertragId,
    p_dokument: dokument as unknown as Json,
  });
  if (error) {
    // Kam nur die Antwort nicht an, liegt das Dokument schon — dann bleibt die Datei, sonst wäre die
    // einzige unterschriebene Fassung weg (Review 11.11.2026)
    const { data: liegt, error: pruefFehler } = await supabase
      .from('dokumente')
      .select('id')
      .eq('pfad', dokument.pfad)
      .eq('geloescht', false)
      .limit(1);
    if (pruefFehler) {
      throw new Error(
        `${error.message} Ob die Fassung abgelegt wurde, ließ sich nicht prüfen. Bitte die Seite neu laden und in den Dokumenten des Vertrags nachsehen.`
      );
    }
    if (liegt && liegt.length > 0) return;
    await entfernen([dokument.pfad]);
    throw new Error(`Die unterschriebene Fassung wurde nicht abgelegt: ${error.message}`);
  }
}

/**
 * Unterschriebene Fassung ablegen — für jeden Vertrag (12.11.2026: der Mietvertrag lässt sich an jeder Stelle erstellen,
 * ändern und nachreichen). Steht der Merker `unterschrift_ausstehend`, läuft es über `reicheUnterschriftNach` (Dokument
 * und Merker in einer Transaktion). Sonst ist es eine weitere Fassung, etwa nach einer Änderung oder ein Nachtrag:
 * Datei hochladen und als Vertragsdokument eintragen; scheitert der Eintrag, fliegt die Datei wieder raus.
 */
export async function legeUnterschriebeneFassungAb(vertragId: string, datei: File, ausstehend: boolean): Promise<void> {
  if (ausstehend) return reicheUnterschriftNach(vertragId, datei);
  // Die Anzeige kann veraltet sein: Steht der Merker in der Datenbank doch, muss er weg — sonst bliebe der Vertrag
  // als nicht unterschrieben stehen (Review 12.11.2026). Andersherum fängt die RPC ein zweites Nachreichen ab.
  const { data: vertrag, error: merkerFehler } = await supabase
    .from('mietvertrag')
    .select('unterschrift_ausstehend')
    .eq('id', vertragId)
    .maybeSingle();
  if (merkerFehler) throw new Error(`Der Vertrag konnte nicht geladen werden: ${merkerFehler.message}`);
  if (!vertrag) throw new Error('Den Vertrag gibt es nicht mehr.');
  if (vertrag.unterschrift_ausstehend) return reicheUnterschriftNach(vertragId, datei);
  const dokument = unterschriftDokument(vertragId, datei, await ladeVertragsKennung(vertragId));
  await hochladen(dokument.pfad, datei, dokument.dateityp);
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from('dokumente').insert({
    ...dokument,
    mietvertrag_id: vertragId,
    erstellt_von: user.user?.id ?? null,
    geloescht: false,
  });
  if (!error) return;
  // Kam nur die Antwort nicht an, steht der Eintrag schon — dann bleibt die Datei
  const { data: liegt, error: pruefFehler } = await supabase.from('dokumente').select('id').eq('pfad', dokument.pfad).limit(1);
  if (pruefFehler) {
    throw new Error(
      `${error.message} Ob die Fassung abgelegt wurde, ließ sich nicht prüfen. Bitte die Seite neu laden und in den Dokumenten des Vertrags nachsehen.`
    );
  }
  if (liegt && liegt.length > 0) return;
  await entfernen([dokument.pfad]);
  throw new Error(`Die unterschriebene Fassung wurde nicht abgelegt: ${error.message}`);
}

// ─── Vermietung zurücknehmen ────────────────────────────────────────────────

export interface RuecknahmeErgebnis {
  forderungen: number;
  hinweise: string[];
}

/**
 * Nimmt eine abgeschlossene Vermietung zurück, solange nichts darauf aufbaut (seit 11.11.2026): keine unterschriebene
 * Fassung, keine Zahlung, Kaution, Mahnung, Abrechnung, Mieterhöhung, Zählerstände oder Nachrichten — das prüft die
 * DB-Funktion `vermietung_zuruecknehmen` und nennt den Grund. Vertrag, Forderungen und Dokumentzeilen fallen dort in
 * einer Transaktion weg, die Mieter bleiben. Danach räumt diese Funktion die Dateien aus dem Storage.
 */
export async function nimmVermietungZurueck(vertragId: string): Promise<RuecknahmeErgebnis> {
  const { data, error } = await supabase.rpc('vermietung_zuruecknehmen', { p_vertrag_id: vertragId });
  if (error) throw new Error(error.message);
  const antwort = (data ?? {}) as { pfade?: unknown; forderungen?: number };
  const pfade = Array.isArray(antwort.pfade) ? antwort.pfade.filter((p): p is string => typeof p === 'string' && !!p) : [];
  const hinweise: string[] = [];
  if (pfade.length > 0) {
    try {
      // Nur, was keine andere Dokumentzeile mehr nennt
      const belegt = await belegtePfade(pfade);
      const frei = pfade.filter(p => !belegt.has(p));
      if (frei.length > 0) {
        const { error: fehler } = await supabase.storage.from('dokumente').remove(frei);
        if (fehler) throw new Error(fehler.message);
      }
    } catch (e) {
      // Der Vertrag ist weg; übrig bleiben nur unsichtbare Dateien
      hinweise.push(`Die Dateien des Vertrags konnten nicht gelöscht werden (${e instanceof Error ? e.message : String(e)}).`);
    }
  }
  return { forderungen: antwort.forderungen ?? 0, hinweise };
}

/** Kurzlebiger Link zum Ansehen einer Entwurfsdatei. */
export async function entwurfDateiLink(pfad: string): Promise<string> {
  const { data, error } = await supabase.storage.from('dokumente').createSignedUrl(pfad, 300);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Link konnte nicht erzeugt werden.');
  return data.signedUrl;
}
