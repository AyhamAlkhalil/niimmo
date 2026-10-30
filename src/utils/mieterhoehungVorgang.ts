import { supabase } from '@/integrations/supabase/client';
import { erhoehungRueckwirkend, uebernahmeMeldung, vereinbarungVerlangtAm } from './mieterhoehungRegeln';

/**
 * Eine Mieterhöhung aus Vertragsbearbeitung oder Mietübersicht als Vorgang anlegen (Kundenentscheidung 29.10.2026:
 * „Eine Mieterhöhung ist ein Vorgang“). Angelegt als vereinbart ('vereinbarung', § 557 Abs. 1 BGB) über
 * mieterhoehung_zustimmen: Gilt sie schon heute (rückwirkend zum Monatsersten), übernimmt die Datenbank sofort Miete
 * und schon angelegte Monatsmieten; sonst stellt der Nachtlauf am Wirksamkeitstag um. Die Vertragsmiete schreibt
 * nie das Frontend. Bis zum 29.10.2026 stand die neue Miete sofort im Vertrag und galt fest ab dem Folgemonat — die
 * Objektansichten zeigten sie schon vorher (Prüfung 29.10.2026: Sarstedt im Oktober +281,80 €).
 */
export interface ErhoehungsAngaben {
  mietvertragId: string;
  alteKaltmiete: number;
  alteBetriebskosten: number;
  neueKaltmiete: number;
  neueBetriebskosten: number;
  /** Monatserster JJJJ-MM-TT */
  giltAb: string;
}

/** ok: angelegt (uebernommen: schon wirksam, nachberechnet: angehobene Monatsmieten); sonst die Meldung */
export interface ErhoehungsErgebnis {
  ok: boolean;
  uebernommen?: boolean;
  nachberechnet?: number;
  meldung?: string;
}

type ZustimmenRpc = (
  fn: 'mieterhoehung_zustimmen',
  args: { p_mieterhoehung_id: string }
) => Promise<{ data: { status?: string; nachberechnete_monate?: number } | null; error: { hint?: string; message: string } | null }>;

export async function mieterhoehungAlsVorgangAnlegen(a: ErhoehungsAngaben, heute: Date = new Date()): Promise<ErhoehungsErgebnis> {
  if (!(a.neueKaltmiete > a.alteKaltmiete)) {
    return { ok: false, meldung: 'Die Kaltmiete sinkt oder bleibt gleich — das ist eine Korrektur, keine Mieterhöhung.' };
  }
  const { data: vorgang, error: anlegenFehler } = await supabase
    .from('mieterhoehungen')
    .insert({
      mietvertrag_id: a.mietvertragId,
      verlangt_am: vereinbarungVerlangtAm(a.giltAb, heute),
      wirksam_ab: a.giltAb,
      alte_kaltmiete: a.alteKaltmiete,
      alte_betriebskosten: a.alteBetriebskosten,
      neue_kaltmiete: a.neueKaltmiete,
      neue_betriebskosten: a.neueBetriebskosten,
      begruendungsart: 'vereinbarung',
      begruendung_text: 'Vereinbarte Mieterhöhung, erfasst in der Vertragsbearbeitung',
      status: 'verlangt',
    })
    .select('id')
    .single();
  if (anlegenFehler || !vorgang) return { ok: false, meldung: uebernahmeMeldung(anlegenFehler?.hint, anlegenFehler?.message) };

  const zustimmen = supabase.rpc.bind(supabase) as unknown as ZustimmenRpc;
  const { data: ergebnis, error } = await zustimmen('mieterhoehung_zustimmen', { p_mieterhoehung_id: vorgang.id });
  if (error) {
    // Ohne Zustimmung hätte der Vorgang keinen Sinn (schon vereinbart, Staffel/Index, Vertragsende vorher)
    await supabase.from('mieterhoehungen').delete().eq('id', vorgang.id);
    return { ok: false, meldung: uebernahmeMeldung(error.hint, error.message) };
  }
  return { ok: true, uebernommen: ergebnis?.status === 'wirksam', nachberechnet: ergebnis?.nachberechnete_monate ?? 0 };
}

/** Kurzmeldung nach dem Anlegen */
export function erhoehungsMeldung(e: ErhoehungsErgebnis, giltAb: string, neueKaltmiete: number, heute: Date = new Date()): { title: string; description: string } {
  const ab = new Date(`${giltAb}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const betrag = neueKaltmiete.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (e.uebernommen) {
    return {
      title: 'Mieterhöhung rückwirkend übernommen',
      description: `Die Kaltmiete steht seit dem ${ab} auf ${betrag} €.` +
        ((e.nachberechnet ?? 0) > 0 ? ` ${e.nachberechnet} Monatsmiete${e.nachberechnet === 1 ? '' : 'n'} nachberechnet.` : ''),
    };
  }
  return erhoehungRueckwirkend(giltAb, heute)
    ? { title: 'Mieterhöhung erfasst', description: `Die neue Miete von ${betrag} € gilt ab dem ${ab} und wird heute früh automatisch übernommen.` }
    : { title: 'Mieterhöhung erfasst', description: `Die neue Miete von ${betrag} € gilt ab dem ${ab}. Bis dahin bleiben Vertragsmiete und Forderungen unverändert.` };
}
