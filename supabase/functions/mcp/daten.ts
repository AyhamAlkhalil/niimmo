// Lader und Beschriftungen, die mehrere MCP-Werkzeuge teilen (16.11.2026).
// Spalten werden benannt (docs/architektur.md §4: keine Abfrage aller Spalten breiter Tabellen), wachsende Tabellen
// seitenweise gelesen.

import { mietsacheText } from '../_shared/namen.ts';
import { alleZeilen, type Kontext, mieterBezeichnung } from './werkzeug.ts';

export interface ImmobilieZeile {
  id: string;
  name: string | null;
  adresse: string | null;
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  ort: string | null;
  objekttyp: string | null;
  ist_angespannt: boolean | null;
}

export interface EinheitZeile {
  id: string;
  immobilie_id: string | null;
  einheitentyp: string | null;
  etage: string | null;
  qm: number | null;
  anzahl_zimmer: number | null;
  bezeichnung: string | null;
}

export interface VertragZeile {
  id: string;
  einheit_id: string | null;
  status: string | null;
  start_datum: string | null;
  ende_datum: string | null;
  kuendigungsdatum: string | null;
  kaltmiete: number | null;
  betriebskosten: number | null;
  mahnstufe: number | null;
}

export interface MieterKurz {
  id: string;
  name: string;
}

export const IMMOBILIE_SPALTEN = 'id, name, adresse, strasse, hausnummer, plz, ort, objekttyp, ist_angespannt';
export const EINHEIT_SPALTEN = 'id, immobilie_id, einheitentyp, etage, qm, anzahl_zimmer, bezeichnung';
export const VERTRAG_SPALTEN = 'id, einheit_id, status, start_datum, ende_datum, kuendigungsdatum, kaltmiete, betriebskosten, mahnstufe';

/** Anschrift aus den atomaren Feldern (führend), sonst der Freitext (docs/datenmodell.md §3) */
export function anschrift(i: Pick<ImmobilieZeile, 'adresse' | 'strasse' | 'hausnummer' | 'plz' | 'ort'>): string {
  const strasse = [i.strasse, i.hausnummer].filter(Boolean).join(' ').trim();
  const ort = [i.plz, i.ort].filter(Boolean).join(' ').trim();
  const atomar = [strasse, ort].filter(Boolean).join(', ');
  return atomar || i.adresse?.trim() || '';
}

export function objektName(i: ImmobilieZeile | null | undefined): string {
  if (!i) return 'Unbekannt';
  return i.name?.trim() || anschrift(i) || 'Unbekannt';
}

export function einheitText(e: EinheitZeile | null | undefined): string {
  if (!e) return 'Unbekannt';
  return mietsacheText({
    einheitentyp: e.einheitentyp,
    etage: e.etage,
    anzahlZimmer: e.anzahl_zimmer,
    qm: e.qm,
    bezeichnung: e.bezeichnung,
  }) || 'Einheit ohne Angaben';
}

/** Objekte, Einheiten und Verträge des ganzen Bestands */
export async function ladeBestand(ctx: Kontext): Promise<{
  immobilien: ImmobilieZeile[];
  einheiten: EinheitZeile[];
  vertraege: VertragZeile[];
}> {
  const [immobilien, einheiten, vertraege] = await Promise.all([
    alleZeilen<ImmobilieZeile>((von, bis) => ctx.db.from('immobilien').select(IMMOBILIE_SPALTEN).order('name').order('id').range(von, bis), 'Objekte'),
    alleZeilen<EinheitZeile>((von, bis) => ctx.db.from('einheiten').select(EINHEIT_SPALTEN).order('id').range(von, bis), 'Einheiten'),
    alleZeilen<VertragZeile>((von, bis) => ctx.db.from('mietvertrag').select(VERTRAG_SPALTEN).order('id').range(von, bis), 'Mietverträge'),
  ]);
  return { immobilien, einheiten, vertraege };
}

interface VertragsmieterZeile {
  mietvertrag_id: string;
  mieter: { id: string; vorname: string | null; nachname: string | null; firmenname: string | null } | null;
}

/** IDs je in()-Filter: 100 UUIDs sind rund 3,7 KB in der URL, das Gateway lehnt ab etwa 8 KB ab (414) */
const IN_BLOCK = 100;

export function inBloecken<T>(liste: readonly T[], groesse = IN_BLOCK): T[][] {
  const bloecke: T[][] = [];
  for (let i = 0; i < liste.length; i += groesse) bloecke.push(liste.slice(i, i + groesse));
  return bloecke;
}

/** Mieter je Vertrag (nur Namen). Ohne `vertragIds` alle Verträge. */
export async function ladeVertragsmieter(ctx: Kontext, vertragIds?: readonly string[]): Promise<Map<string, MieterKurz[]>> {
  const auswahl = 'mietvertrag_id, mieter:mieter!mietvertrag_mieter_mieter_id_fkey(id, vorname, nachname, firmenname)';
  const zeilen: VertragsmieterZeile[] = [];
  if (!vertragIds) {
    zeilen.push(...await alleZeilen<VertragsmieterZeile>(
      (von, bis) => ctx.db.from('mietvertrag_mieter').select(auswahl).order('mietvertrag_id').order('mieter_id').range(von, bis),
      'Vertragsmieter',
    ));
  } else {
    for (const block of inBloecken([...new Set(vertragIds)])) {
      zeilen.push(...await alleZeilen<VertragsmieterZeile>(
        (von, bis) => ctx.db.from('mietvertrag_mieter').select(auswahl).in('mietvertrag_id', block)
          .order('mietvertrag_id').order('mieter_id').range(von, bis),
        'Vertragsmieter',
      ));
    }
  }
  const jeVertrag = new Map<string, MieterKurz[]>();
  for (const z of zeilen) {
    if (!z.mieter) continue;
    const eintrag = { id: z.mieter.id, name: mieterBezeichnung(z.mieter) };
    jeVertrag.set(z.mietvertrag_id, [...(jeVertrag.get(z.mietvertrag_id) ?? []), eintrag]);
  }
  return jeVertrag;
}

/** Index nach id */
export function nachId<T extends { id: string }>(zeilen: readonly T[]): Map<string, T> {
  return new Map(zeilen.map((z) => [z.id, z]));
}

/** Gruppiert nach einem Schlüssel; Zeilen ohne Schlüssel fallen heraus */
export function gruppiere<T>(zeilen: readonly T[], schluessel: (z: T) => string | null | undefined): Map<string, T[]> {
  const gruppen = new Map<string, T[]>();
  for (const z of zeilen) {
    const k = schluessel(z);
    if (!k) continue;
    const liste = gruppen.get(k);
    if (liste) liste.push(z);
    else gruppen.set(k, [z]);
  }
  return gruppen;
}
