/**
 * Daten für den Mietvertragsentwurf: Objekt, Einheit, Vermieter, Vorvertrag
 * samt Dokumenten, dazu Mieterbestand (Dubletten) und Bewerber-Blacklist.
 */
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { leseEntwurfZeile, type EntwurfZeile } from '@/services/mietvertragEntwurfService';
import { alleSeiten } from '@/utils/supabaseSeiten';

export interface VorvertragDokument {
  id: string;
  titel: string;
  pfad: string;
  dateityp: string | null;
  groesse_bytes: number | null;
}

export interface EntwurfGrundlagenDaten {
  einheit: Tables<'einheiten'>;
  immobilie: Tables<'immobilien'>;
  vermieter: Tables<'vermieter'> | null;
  nebenkostenarten: Pick<Tables<'nebenkostenarten'>, 'name' | 'verteilerschluessel_art' | 'ist_umlagefaehig'>[];
  vorvertrag: Tables<'mietvertrag'> | null;
  vorvertragMieter: string[];
  vorvertragDokumente: VorvertragDokument[];
  /** Vorschlag für die Gesamtwohnfläche: Summe der Wohn- und Gewerbeflächen des Objekts. */
  summeEinheitenQm: number | null;
}

export function useEntwurfGrundlagen(einheitId: string | null, aktiv: boolean) {
  return useQuery({
    queryKey: ['mietvertrag-entwurf-grundlagen', einheitId],
    enabled: aktiv && !!einheitId,
    // Objektangaben ändern sich beim Speichern — jedes Öffnen liest frisch.
    staleTime: 0,
    queryFn: async (): Promise<EntwurfGrundlagenDaten> => {
      const { data: einheit, error: einheitError } = await supabase
        .from('einheiten')
        .select('*')
        .eq('id', einheitId!)
        .single();
      if (einheitError) throw einheitError;

      const [immobilieAntwort, vertraegeAntwort, nebenkostenAntwort, einheitenAntwort] = await Promise.all([
        supabase.from('immobilien').select('*').eq('id', einheit.immobilie_id!).single(),
        supabase
          .from('mietvertrag')
          .select('*, mietvertrag_mieter ( position, mieter:mieter_id ( vorname, nachname, firmenname, ist_unternehmen ) )')
          .eq('einheit_id', einheitId!)
          .order('start_datum', { ascending: false, nullsFirst: false }),
        supabase
          .from('nebenkostenarten')
          .select('name, verteilerschluessel_art, ist_umlagefaehig')
          .eq('immobilie_id', einheit.immobilie_id!),
        supabase.from('einheiten').select('qm, einheitentyp').eq('immobilie_id', einheit.immobilie_id!),
      ]);
      if (immobilieAntwort.error) throw immobilieAntwort.error;
      if (vertraegeAntwort.error) throw vertraegeAntwort.error;
      const immobilie = immobilieAntwort.data;

      const vermieterQuery = immobilie.vermieter_id
        ? supabase.from('vermieter').select('*').eq('id', immobilie.vermieter_id).maybeSingle()
        : supabase.from('vermieter').select('*').eq('ist_standard', true).maybeSingle();
      const { data: vermieter, error: vermieterError } = await vermieterQuery;
      if (vermieterError) throw vermieterError;

      // Vorvertrag: der zuletzt begonnene Vertrag der Einheit, gleich welcher Status
      const vertragZeile = vertraegeAntwort.data?.[0] ?? null;
      let vorvertrag: Tables<'mietvertrag'> | null = null;
      let vorvertragMieter: string[] = [];
      let vorvertragDokumente: VorvertragDokument[] = [];
      if (vertragZeile) {
        const { mietvertrag_mieter: verknuepfungen, ...rest } = vertragZeile;
        vorvertrag = rest as Tables<'mietvertrag'>;
        vorvertragMieter = [...(verknuepfungen ?? [])]
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map(v =>
            v.mieter?.ist_unternehmen
              ? v.mieter.firmenname ?? ''
              : `${v.mieter?.vorname ?? ''} ${v.mieter?.nachname ?? ''}`.trim()
          )
          .filter(Boolean);

        const { data: dokumente, error: dokError } = await supabase
          .from('dokumente')
          .select('id, titel, pfad, dateityp, groesse_bytes')
          .eq('mietvertrag_id', vorvertrag.id)
          .eq('kategorie', 'Mietvertrag')
          .or('geloescht.is.null,geloescht.eq.false');
        if (dokError) throw dokError;
        vorvertragDokumente = (dokumente ?? []) as VorvertragDokument[];
      }

      // Wie die Kennzahl „Fläche" im Objektdetail: ohne Garagen, Stellplätze, Lager, Sonstiges
      const flaechen = (einheitenAntwort.data ?? [])
        .filter(e => !['Garage', 'Stellplatz', 'Lager', 'Sonstiges'].includes(e.einheitentyp ?? ''))
        .map(e => Number(e.qm ?? 0))
        .filter(q => q > 0);
      const summe = flaechen.reduce((s, q) => s + q, 0);

      return {
        einheit,
        immobilie,
        vermieter,
        nebenkostenarten: nebenkostenAntwort.data ?? [],
        vorvertrag,
        vorvertragMieter,
        vorvertragDokumente,
        summeEinheitenQm: summe > 0 ? Math.round(summe * 100) / 100 : null,
      };
    },
  });
}

/**
 * Welches Dokument des Vorvertrags ist der Vertrag selbst? In der Kategorie
 * „Mietvertrag" liegen auch Lastschriftmandate und Kautionsbürgschaften.
 * Word vor PDF (Text statt Scan), Titel mit „MV"/„Mietvertrag" vor dem Rest,
 * „org"/Originalscans zuletzt.
 */
export function wahrscheinlichsterVertrag(dokumente: VorvertragDokument[]): VorvertragDokument | null {
  const punkte = (d: VorvertragDokument): number => {
    const t = d.titel.toLowerCase();
    if (/sepa|lastschrift|kaution|bürgschaft|buergschaft|übergabe|uebergabe|nachtrag|kündigung|kuendigung/.test(t)) return -10;
    let p = 0;
    // Der nie unterschriebene Entwurf eines Vorgängers taugt nicht als Vorlage
    if (/entwurf|nicht unterschrieben/.test(t)) p -= 4;
    if (/\bmv\b|mietvertrag/.test(t)) p += 5;
    if (/unterschrieben/.test(t) && !/nicht unterschrieben/.test(t)) p += 1;
    if (t.endsWith('.docx') || (d.dateityp ?? '').includes('wordprocessingml')) p += 3;
    else if (t.endsWith('.pdf')) p += 1;
    else if (t.endsWith('.doc')) p -= 5;
    if (/org|scan/.test(t)) p -= 1;
    return p;
  };
  const kandidaten = [...dokumente].filter(d => punkte(d) > 0).sort((a, b) => punkte(b) - punkte(a));
  return kandidaten[0] ?? null;
}

export function useMietvertragEntwuerfe(aktiv = true) {
  return useQuery({
    queryKey: ['mietvertrag-entwuerfe'],
    enabled: aktiv,
    queryFn: async (): Promise<EntwurfZeile[]> => {
      const { data, error } = await supabase
        .from('mietvertrag_entwuerfe')
        .select('*')
        .order('erstellt_am', { ascending: true });
      if (error) throw error;
      return (data ?? []).map(leseEntwurfZeile);
    },
  });
}

export function useMietvertragEntwurf(entwurfId: string | null, aktiv: boolean) {
  return useQuery({
    queryKey: ['mietvertrag-entwurf', entwurfId],
    enabled: aktiv && !!entwurfId,
    staleTime: 0,
    queryFn: async (): Promise<EntwurfZeile> => {
      const { data, error } = await supabase.from('mietvertrag_entwuerfe').select('*').eq('id', entwurfId!).single();
      if (error) throw error;
      return leseEntwurfZeile(data);
    },
  });
}

export type MieterAbgleich = Pick<
  Tables<'mieter'>,
  | 'id'
  | 'vorname'
  | 'nachname'
  | 'geburtsdatum'
  | 'hauptmail'
  | 'telnr'
  | 'anrede'
  | 'strasse'
  | 'hausnummer'
  | 'plz'
  | 'ort'
  | 'ist_unternehmen'
  | 'firmenname'
>;

/** Mieterbestand für die Dublettenprüfung und die Blacklist — beide nur für Admins lesbar bzw. nötig. */
export function useMieterAbgleich(aktiv: boolean) {
  const mieter = useQuery({
    queryKey: ['mietvertrag-entwurf-mieterbestand'],
    enabled: aktiv,
    queryFn: () =>
      alleSeiten<MieterAbgleich>((von, bis, mitZaehlung) =>
        supabase
          .from('mieter')
          .select('id, vorname, nachname, geburtsdatum, hauptmail, telnr, anrede, strasse, hausnummer, plz, ort, ist_unternehmen, firmenname', {
            count: mitZaehlung ? 'exact' : undefined,
          })
          .order('id')
          .range(von, bis)
      ),
  });

  const blacklist = useQuery({
    queryKey: ['bewerbung-blacklist-abgleich'],
    enabled: aktiv,
    queryFn: async () => {
      const { data, error } = await supabase.from('bewerbung_blacklist').select('name, email, telefon, grund');
      if (error) throw error;
      return data ?? [];
    },
  });

  return { mieter, blacklist };
}
