import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useUserRole } from "./useUserRole";

export interface ZahlungsAnomalieVertragInfo {
  id: string;
  mieterNamen: string;
  einheitBezeichnung: string;
}

export interface ZahlungsAnomalie {
  id: string;
  zahlungId: string;
  betrag: number;
  buchungsdatum: string | null;
  regelTyp: string;
  begruendung: string;
  status: string;
  zugeordneterVertragDiff: number | null;
  vermuteterVertragDiff: number;
  zugeordneterMietvertrag: ZahlungsAnomalieVertragInfo | null;
  vermuteterMietvertrag: ZahlungsAnomalieVertragInfo | null;
  createdAt: string;
}

const ZAHLUNGS_ANOMALIEN_QUERY_KEY = ['zahlungs-anomalien', 'offen'];

/**
 * Hook zum Laden offener Zahlungs-Zuordnungs-Verdachtsfälle (befüllt durch
 * den täglichen Cron-Job `check_zahlungs_anomalien()`), inkl. lesbarer
 * Zusatzinfos (Mieter-Namen, Einheit/Immobilie) zu zugeordnetem und
 * vermutetem Mietvertrag.
 */
export function useZahlungsAnomalien() {
  const { isAdmin } = useUserRole();

  const { data: anomalien = [], isLoading, refetch } = useQuery({
    queryKey: ZAHLUNGS_ANOMALIEN_QUERY_KEY,
    enabled: isAdmin,
    queryFn: async (): Promise<ZahlungsAnomalie[]> => {
      const { data: rows, error } = await supabase
        .from('zahlungs_anomalien')
        .select('*')
        .eq('status', 'offen')
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (!rows?.length) return [];

      // Zahlungsdetails (Buchungsdatum) nachladen
      const zahlungIds = [...new Set(rows.map(r => r.zahlung_id))];
      const { data: zahlungen, error: zahlungenError } = await supabase
        .from('zahlungen')
        .select('id, betrag, buchungsdatum')
        .in('id', zahlungIds);

      if (zahlungenError) throw zahlungenError;
      const zahlungenMap = new Map((zahlungen ?? []).map(z => [z.id, z]));

      // Beteiligte Mietverträge (zugeordnet + vermutet) nachladen
      const mietvertragIds = [...new Set(
        rows
          .flatMap(r => [r.zugeordneter_mietvertrag_id, r.vermuteter_mietvertrag_id])
          .filter((id): id is string => !!id)
      )];

      const vertragInfoMap = new Map<string, ZahlungsAnomalieVertragInfo>();

      if (mietvertragIds.length) {
        const { data: vertraege, error: vertraegeError } = await supabase
          .from('mietvertrag')
          .select('id, einheit_id')
          .in('id', mietvertragIds);

        if (vertraegeError) throw vertraegeError;

        const einheitIds = [...new Set((vertraege ?? []).map(v => v.einheit_id).filter(Boolean))];
        const { data: einheiten, error: einheitenError } = einheitIds.length
          ? await supabase.from('einheiten').select('id, etage, immobilie_id').in('id', einheitIds)
          : { data: [], error: null };

        if (einheitenError) throw einheitenError;

        const immobilieIds = [...new Set(
          (einheiten ?? []).map(e => e.immobilie_id).filter((id): id is string => !!id)
        )];
        const { data: immobilien, error: immobilienError } = immobilieIds.length
          ? await supabase.from('immobilien').select('id, name').in('id', immobilieIds)
          : { data: [], error: null };

        if (immobilienError) throw immobilienError;

        const { data: vertragMieterLinks, error: vmError } = await supabase
          .from('mietvertrag_mieter')
          .select('mietvertrag_id, mieter_id')
          .in('mietvertrag_id', mietvertragIds);

        if (vmError) throw vmError;

        const mieterIds = [...new Set((vertragMieterLinks ?? []).map(l => l.mieter_id))];
        const { data: mieter, error: mieterError } = mieterIds.length
          ? await supabase.from('mieter').select('id, vorname, nachname').in('id', mieterIds)
          : { data: [], error: null };

        if (mieterError) throw mieterError;

        const immobilienMap = new Map((immobilien ?? []).map(i => [i.id, i]));
        const einheitenMap = new Map((einheiten ?? []).map(e => [e.id, e]));
        const mieterMap = new Map((mieter ?? []).map(m => [m.id, m]));

        const mieterIdsByVertrag = new Map<string, string[]>();
        (vertragMieterLinks ?? []).forEach(link => {
          const list = mieterIdsByVertrag.get(link.mietvertrag_id) ?? [];
          list.push(link.mieter_id);
          mieterIdsByVertrag.set(link.mietvertrag_id, list);
        });

        (vertraege ?? []).forEach(v => {
          const einheit = einheitenMap.get(v.einheit_id);
          const immobilie = einheit?.immobilie_id ? immobilienMap.get(einheit.immobilie_id) : undefined;

          const mieterNamen = (mieterIdsByVertrag.get(v.id) ?? [])
            .map(id => mieterMap.get(id))
            .filter((m): m is { id: string; vorname: string; nachname: string | null } => !!m)
            .map(m => `${m.vorname} ${m.nachname ?? ''}`.trim())
            .join(', ') || 'Unbekannt';

          const einheitBezeichnung = einheit
            ? `${immobilie?.name ?? 'Objekt'} - ${einheit.etage ?? 'Einheit'}`
            : 'Unbekannt';

          vertragInfoMap.set(v.id, { id: v.id, mieterNamen, einheitBezeichnung });
        });
      }

      return rows.map(row => {
        const zahlung = zahlungenMap.get(row.zahlung_id);
        return {
          id: row.id,
          zahlungId: row.zahlung_id,
          betrag: row.betrag,
          buchungsdatum: zahlung?.buchungsdatum ?? null,
          regelTyp: row.regel_typ,
          begruendung: row.begruendung,
          status: row.status,
          zugeordneterVertragDiff: row.zugeordneter_vertrag_diff,
          vermuteterVertragDiff: row.vermuteter_vertrag_diff,
          zugeordneterMietvertrag: row.zugeordneter_mietvertrag_id
            ? vertragInfoMap.get(row.zugeordneter_mietvertrag_id) ?? null
            : null,
          vermuteterMietvertrag: row.vermuteter_mietvertrag_id
            ? vertragInfoMap.get(row.vermuteter_mietvertrag_id) ?? null
            : null,
          createdAt: row.created_at,
        };
      });
    },
    staleTime: 30000, // 30 Sekunden
  });

  return {
    anomalien,
    count: anomalien.length,
    isLoading,
    refetch,
  };
}

interface UpdateZahlungsAnomalieStatusParams {
  id: string;
  status: 'geprueft' | 'ignoriert';
}

/**
 * Mutation zum manuellen Prüfen/Ignorieren einer Zahlungs-Anomalie.
 * Setzt geprueft_von (aktueller User) + geprueft_am und invalidiert danach
 * die offenen-Findings-Query.
 */
export function useUpdateZahlungsAnomalieStatus() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ id, status }: UpdateZahlungsAnomalieStatusParams) => {
      if (!user?.id) throw new Error('Nicht angemeldet');

      const { error } = await supabase
        .from('zahlungs_anomalien')
        .update({
          status,
          geprueft_von: user.id,
          geprueft_am: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ZAHLUNGS_ANOMALIEN_QUERY_KEY });
      toast.success(status === 'geprueft' ? 'Als geprüft markiert' : 'Verdachtsfall ignoriert');
    },
    onError: (error: Error) => {
      toast.error(`Fehler beim Aktualisieren: ${error.message}`);
    },
  });
}
