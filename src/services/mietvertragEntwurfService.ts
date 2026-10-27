/**
 * Speichern, Aktivieren und Verwerfen von Mietvertragsentwürfen.
 *
 * Ein Entwurf liegt in `mietvertrag_entwuerfe` und zählt nirgends mit. Erst
 * `aktiviereEntwurf` legt Mieter, Vertrag, Verknüpfungen, Dokumente und die
 * Forderungen an — in einer Transaktion (`aktiviere_mietvertrag_entwurf`),
 * die den Entwurf zuerst beansprucht. Dateien des Entwurfs liegen unter
 * `mietvertrag-entwuerfe/<id>/`; Pfade entstehen nie aus Namen (Storage lehnt
 * Umlaute ab, siehe storagePfad.ts).
 */
import { format } from 'date-fns';

import { supabase } from '@/integrations/supabase/client';
import type { Json, Tables } from '@/integrations/supabase/types';
import { dateiendung } from '@/utils/storagePfad';
import {
  aktivierungsDaten,
  bestandsStammdaten,
  type EntwurfDatei,
  type EntwurfPerson,
  type HerkunftKarte,
} from '@/utils/mietvertrag/entwurf';
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

/** Löscht Entwurf, Entwurfs-PDF und Selbstauskunft. Mieter entstehen erst beim Aktivieren. */
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

export interface AktivierenArgs {
  entwurf: EntwurfZeile;
  unterschrieben: File;
  /** Wohnraum mit erzeugtem PDF — dann gilt die Vorlagenfassung als vereinbart. */
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

  // Aktiviert wird der gespeicherte Stand — er gehört zum PDF, das unterschrieben
  // wurde. Was die Oberfläche zeigt, kann seitdem Objekt- oder Vermieterdaten nachgezogen haben.
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

  // 1. Unterschriebene Fassung zuerst — ohne sie wird nichts aktiviert.
  const endung = dateiendung(a.unterschrieben.name, a.unterschrieben.type, 'pdf');
  const unterschriftPfad = `mietvertraege/${vertragId}/Mietvertrag_unterschrieben_${stempel(new Date())}.${endung}`;
  await hochladen(unterschriftPfad, a.unterschrieben, a.unterschrieben.type || 'application/pdf');

  // 2. Alles Weitere in einer Transaktion
  const { data, error } = await supabase.rpc('aktiviere_mietvertrag_entwurf', {
    p_entwurf_id: entwurf.id,
    p_vertrag: zeilen.vertrag as unknown as Json,
    p_neue_mieter: zeilen.neueMieter as unknown as Json,
    p_verknuepfungen: zeilen.verknuepfungen as unknown as Json,
    p_dokumente: [
      {
        titel: `Mietvertrag (unterschrieben).${endung}`,
        pfad: unterschriftPfad,
        kategorie: 'Mietvertrag',
        dateityp: a.unterschrieben.type || 'application/pdf',
        groesse_bytes: a.unterschrieben.size,
      },
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
    // Kam nur die Antwort nicht an, steht der Vertrag schon — dann bleibt die Datei.
    const { data: steht, error: pruefFehler } = await supabase.from('mietvertrag').select('id').eq('id', vertragId).maybeSingle();
    if (pruefFehler) {
      // Ungewiss, ob der Vertrag steht: Die unterschriebene Fassung bleibt liegen, statt womöglich die einzige zu löschen.
      throw new Error(
        `${error.message} Ob der Vertrag angelegt wurde, ließ sich nicht prüfen. Bitte die Seite neu laden und an der Einheit nachsehen, bevor du es noch einmal versuchst.`
      );
    }
    if (!steht) {
      await entfernen([unterschriftPfad]);
      throw new Error(`${error.message} Es wurde nichts angelegt; der Entwurf bleibt erhalten.`);
    }
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

/** Kurzlebiger Link zum Ansehen einer Entwurfsdatei. */
export async function entwurfDateiLink(pfad: string): Promise<string> {
  const { data, error } = await supabase.storage.from('dokumente').createSignedUrl(pfad, 300);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Link konnte nicht erzeugt werden.');
  return data.signedUrl;
}
