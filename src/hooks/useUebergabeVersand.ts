import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { alleSeiten } from "@/utils/supabaseSeiten";
import { istProtokollPdf, type ProtokollZeile } from "@/utils/uebergabeProtokolle";
import type { ProtokollAblesung, VersandMail } from "@/utils/uebergabeVersand";

export interface VersandMieter {
  id: string;
  vorname: string;
  nachname: string | null;
  hauptmail: string | null;
}

export interface VersandVersorger {
  typ: "strom" | "gas" | "wasser";
  label: string;
  name: string;
  email: string;
}

export interface VersandVertrag {
  id: string;
  einheit: {
    id: string;
    etage: string | null;
    einheitentyp: string | null;
    qm: number | null;
    anzahl_zimmer: number | null;
    bezeichnung: string | null;
  };
  immobilie: { id: string; name: string; adresse: string };
}

export interface UebergabeVersandDaten {
  vertrag: VersandVertrag;
  mieter: VersandMieter[];
  versorger: VersandVersorger[];
  protokolle: ProtokollZeile[];
  ablesungen: ProtokollAblesung[];
  /** Mails mit einem der Protokolle als Anhang, mit Pfad */
  mails: Array<VersandMail & { anhang_pfad: string | null }>;
}

export const uebergabeVersandKey = (mietvertragId: string) => ["uebergabe-versand", mietvertragId] as const;

/** Pfade je Abfrage — kurz genug für jede Gateway-Grenze der Adresslänge */
const PFADE_JE_ABFRAGE = 50;

async function jeGruppe<T>(pfade: string[], abfrage: (gruppe: string[]) => Promise<T[]>): Promise<T[]> {
  const alle: T[] = [];
  for (let i = 0; i < pfade.length; i += PFADE_JE_ABFRAGE) alle.push(...(await abfrage(pfade.slice(i, i + PFADE_JE_ABFRAGE))));
  return alle;
}

/**
 * Alles, was der nachträgliche Versand eines gespeicherten Übergabeprotokolls braucht
 * (seit 28.10.2026): Vertrag mit Einheit und Objekt samt Versorgern, Mieter mit Mail,
 * die PDF-Protokolle, ihre Ablesungen und die bisherigen Mails mit diesem Anhang.
 * Jeder Fehler wirft — ein Ladefehler bei den Mails darf nicht wie „noch nicht versendet“ aussehen.
 */
export function useUebergabeVersand(mietvertragId: string, aktiv: boolean) {
  return useQuery({
    queryKey: uebergabeVersandKey(mietvertragId),
    enabled: aktiv && !!mietvertragId,
    queryFn: async (): Promise<UebergabeVersandDaten | null> => {
      const { data: v, error: vertragFehler } = await supabase
        .from("mietvertrag")
        .select(
          `id,
           einheiten!inner (
             id, etage, einheitentyp, qm, anzahl_zimmer, bezeichnung,
             immobilien!inner ( id, name, adresse, versorger_strom_name, versorger_strom_email, versorger_gas_name, versorger_gas_email, versorger_wasser_name, versorger_wasser_email )
           )`
        )
        .eq("id", mietvertragId)
        .maybeSingle();
      if (vertragFehler) throw vertragFehler;
      if (!v) return null;
      const einheit = (Array.isArray(v.einheiten) ? v.einheiten[0] : v.einheiten) as {
        id: string;
        etage: string | null;
        einheitentyp: string | null;
        qm: number | null;
        anzahl_zimmer: number | null;
        bezeichnung: string | null;
        immobilien: Record<string, string | null> | Array<Record<string, string | null>>;
      };
      const objekt = (Array.isArray(einheit.immobilien) ? einheit.immobilien[0] : einheit.immobilien) ?? {};

      const versorger: VersandVersorger[] = [];
      for (const [typ, label] of [["strom", "Strom"], ["gas", "Gas"], ["wasser", "Wasser"]] as const) {
        const name = objekt[`versorger_${typ}_name`] ?? "";
        const email = objekt[`versorger_${typ}_email`] ?? "";
        if (name || email) versorger.push({ typ, label, name, email });
      }

      const { data: links, error: mieterFehler } = await supabase
        .from("mietvertrag_mieter")
        .select("position, mieter:mieter_id (id, vorname, nachname, hauptmail)")
        .eq("mietvertrag_id", mietvertragId)
        .order("position")
        .range(0, 49);
      if (mieterFehler) throw mieterFehler;
      const mieter = (links ?? [])
        .map((l) => (Array.isArray(l.mieter) ? l.mieter[0] : l.mieter) as VersandMieter | null)
        .filter((m): m is VersandMieter => !!m);

      // Seitenweise, mit stabiler Reihenfolge: PostgREST schneidet sonst still bei 1000 Zeilen ab
      const dokumente = await alleSeiten<ProtokollZeile>((von, bis, mitZaehlung) =>
        supabase
          .from("dokumente")
          .select("mietvertrag_id, titel, pfad, dateityp, hochgeladen_am", { count: mitZaehlung ? "exact" : undefined })
          .eq("mietvertrag_id", mietvertragId)
          .eq("kategorie", "Übergabeprotokoll")
          .eq("geloescht", false)
          .order("id")
          .range(von, bis)
      );
      const protokolle = dokumente.filter((d) => d.pfad && istProtokollPdf(d));
      const pfade = [...new Set(protokolle.map((p) => p.pfad as string))];

      // Nur die Pfade dieses Vertrags, in Gruppen und seitenweise (28.10.2026): Eine einzige
      // in()-Liste machte die Adresse bei vielen Protokollen zu lang, range() schnitt still ab
      const ablesungen = await jeGruppe(pfade, (gruppe) =>
        alleSeiten<ProtokollAblesung>((von, bis, mitZaehlung) =>
          supabase
            .from("zaehlerstand_historie")
            .select("zaehler_typ, stand, datum, protokoll_pfad, mietvertrag_id", { count: mitZaehlung ? "exact" : undefined })
            .in("protokoll_pfad", gruppe)
            .order("id")
            .range(von, bis)
        )
      );
      const mails = await jeGruppe(pfade, (gruppe) =>
        alleSeiten<UebergabeVersandDaten["mails"][number]>((von, bis, mitZaehlung) =>
          supabase
            .from("mails")
            .select("anhang_pfad, status, empfaenger, gesendet_am, erstellt_am, fehler, nutzlast", { count: mitZaehlung ? "exact" : undefined })
            .eq("typ", "uebergabe")
            .in("anhang_pfad", gruppe)
            .order("id")
            .range(von, bis)
        )
      );

      return {
        vertrag: {
          id: v.id,
          einheit: {
            id: einheit.id,
            etage: einheit.etage,
            einheitentyp: einheit.einheitentyp,
            qm: einheit.qm,
            anzahl_zimmer: einheit.anzahl_zimmer,
            bezeichnung: einheit.bezeichnung,
          },
          immobilie: { id: objekt.id ?? "", name: objekt.name ?? "", adresse: objekt.adresse ?? "" },
        },
        mieter,
        versorger,
        protokolle,
        ablesungen,
        mails,
      };
    },
  });
}
