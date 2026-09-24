import { supabase } from "@/integrations/supabase/client";
import { getVertragsende } from "@/utils/contractUtils";

export interface ContractOverlapCheck {
  hasOverlap: boolean;
  overlappingContracts: Array<{
    id: string;
    startDate: string;
    endDate: string | null;
    tenantNames: string;
    status: string;
  }>;
  warningMessage?: string;
}

export interface BestehenderVertrag {
  id: string;
  start_datum: string;
  ende_datum?: string | null;
  kuendigungsdatum?: string | null;
  status: string;
  mieterNamen?: string;
}

/** Tagesgenauer Vergleich über den ISO-Tag, damit keine Zeitzone einen Tag verschiebt. */
const tag = (datum: string): string => datum.slice(0, 10);

/**
 * Welche bestehenden Verträge der Einheit überschneiden sich mit dem Zeitraum?
 *
 * Das Ende eines bestehenden Vertrags kommt seit dem 24.09.2026 aus getVertragsende()
 * -- vorher entschied hier der Status, ob `kuendigungsdatum` oder `ende_datum` galt, und
 * ein gekündigter Vertrag mit abweichendem `ende_datum` wurde anders bewertet als in der
 * Vertragsansicht. Beide Enddaten meinen dasselbe Mietende.
 *
 * Eine Überschneidung ist nur ein Hinweis, kein Verbot: Beim Nachmieter oder bei
 * einem vorgezogenen Einzug laufen zwei Verträge bewusst einige Tage parallel.
 */
export function findeUeberschneidungen(
  neuerStart: string,
  neuesEnde: string | null,
  bestehende: BestehenderVertrag[]
): ContractOverlapCheck["overlappingContracts"] {
  const start = tag(neuerStart);
  const ende = neuesEnde ? tag(neuesEnde) : null;

  return bestehende
    .filter((vertrag) => {
      if (!vertrag.start_datum) return false;
      const vertragStart = tag(vertrag.start_datum);
      const vertragEnde = getVertragsende(vertrag);
      const startetVorDessenEnde = !vertragEnde || start <= tag(vertragEnde);
      const endetNachDessenStart = !ende || ende >= vertragStart;
      return startetVorDessenEnde && endetNachDessenStart;
    })
    .map((vertrag) => ({
      id: vertrag.id,
      startDate: vertrag.start_datum,
      endDate: getVertragsende(vertrag),
      tenantNames: vertrag.mieterNamen || "Unbekannt",
      status: vertrag.status,
    }));
}

export function ueberschneidungsHinweis(
  vertraege: ContractOverlapCheck["overlappingContracts"]
): string | undefined {
  if (vertraege.length === 0) return undefined;
  if (vertraege.length > 1) {
    return `Der Zeitraum überschneidet sich mit ${vertraege.length} bestehenden Verträgen dieser Einheit. Bitte prüfen Sie die Laufzeiten.`;
  }
  const [vertrag] = vertraege;
  const bis = vertrag.endDate ? `bis ${formatDate(vertrag.endDate)}` : "unbefristet";
  return (
    `Der Zeitraum überschneidet sich mit einem bestehenden Vertrag dieser Einheit:\n` +
    `${vertrag.tenantNames} (${vertrag.status}), ab ${formatDate(vertrag.startDate)} ${bis}.`
  );
}

/**
 * Prüft einen Zeitraum gegen die übrigen Verträge derselben Einheit.
 * @param excludeContractId - der gerade bearbeitete Vertrag
 */
export async function checkContractOverlap(
  einheitId: string,
  newStartDate: string,
  newEndDate: string | null = null,
  excludeContractId: string | null = null
): Promise<ContractOverlapCheck> {
  let query = supabase
    .from('mietvertrag')
    .select(`
      id,
      start_datum,
      ende_datum,
      kuendigungsdatum,
      status,
      mietvertrag_mieter (
        mieter:mieter_id (
          vorname,
          nachname
        )
      )
    `)
    .eq('einheit_id', einheitId)
    .in('status', ['aktiv', 'gekuendigt', 'beendet']);

  if (excludeContractId) {
    query = query.neq('id', excludeContractId);
  }

  const { data, error } = await query;

  // Ein Fehler darf nicht wie „keine Überschneidung" aussehen.
  if (error) {
    return {
      hasOverlap: true,
      overlappingContracts: [],
      warningMessage: "Die Überschneidungsprüfung ist fehlgeschlagen. Bitte prüfen Sie die Laufzeiten der übrigen Verträge dieser Einheit selbst.",
    };
  }

  const bestehende: BestehenderVertrag[] = (data || []).map((vertrag: any) => ({
    id: vertrag.id,
    start_datum: vertrag.start_datum,
    ende_datum: vertrag.ende_datum,
    kuendigungsdatum: vertrag.kuendigungsdatum,
    status: vertrag.status,
    mieterNamen: vertrag.mietvertrag_mieter
      ?.map((mm: any) => `${mm.mieter?.vorname ?? ''} ${mm.mieter?.nachname ?? ''}`.trim())
      .filter(Boolean)
      .join(', '),
  }));

  const overlappingContracts = findeUeberschneidungen(newStartDate, newEndDate, bestehende);
  return {
    hasOverlap: overlappingContracts.length > 0,
    overlappingContracts,
    warningMessage: ueberschneidungsHinweis(overlappingContracts),
  };
}

/**
 * Hinweis mit Rückfrage. Liefert true, wenn gespeichert werden darf.
 */
export async function bestaetigeUeberschneidung(
  einheitId: string,
  start: string,
  ende: string | null,
  excludeContractId: string | null = null
): Promise<boolean> {
  const pruefung = await checkContractOverlap(einheitId, start, ende, excludeContractId);
  if (!pruefung.hasOverlap) return true;
  return window.confirm(`${pruefung.warningMessage}\n\nTrotzdem speichern?`);
}

function formatDate(dateString: string): string {
  const [jahr, monat, tagImMonat] = tag(dateString).split('-');
  return `${tagImMonat}.${monat}.${jahr}`;
}
