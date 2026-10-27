
import { Pencil, Check, X, AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatEuroKompakt } from "@/utils/betragAnzeige";
import { useState, type ReactNode } from "react";
import { useUserRole } from "@/hooks/useUserRole";
import { alsIsoTag, getVertragsende, istLaufenderVertrag } from "@/utils/contractUtils";
import { alleSeiten } from "@/utils/supabaseSeiten";
import { monatsSaldo, type MonatsForderung, type MonatsZahlung } from "@/utils/monatsSaldo";

interface DashboardStatsProps {
  immobilien: any[] | undefined;
  onNavigateToContract?: (immobilieId: string, einheitId: string, mietvertragId: string) => void;
}

export const DashboardStats = ({ immobilien, onNavigateToContract }: DashboardStatsProps) => {
  const queryClient = useQueryClient();
  const { isAdmin } = useUserRole();
  const [editingTyp, setEditingTyp] = useState<'basiszinssatz' | 'vpi' | null>(null);
  const [editWert, setEditWert] = useState("");
  const { data: gesamtEinheiten, isError: einheitenFehler } = useQuery({
    queryKey: ['gesamt-einheiten'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('einheiten')
        .select('id');
      if (error) throw error;
      return data?.length || 0;
    }
  });

  const { data: mietvertraege, isError: vertraegeFehler } = useQuery({
    queryKey: ['alle-mietvertrag'],
    queryFn: async () => {
      const heute = alsIsoTag(new Date());
      const { data, error } = await supabase
        .from('mietvertrag')
        .select(`
          id,
          kaltmiete,
          betriebskosten,
          status,
          start_datum,
          ende_datum,
          kuendigungsdatum,
          einheit_id,
          einheiten(
            id,
            immobilie_id
          )
        `)
        .in('status', ['aktiv', 'gekuendigt'])
        // Verträge die bereits begonnen haben
        .or(`start_datum.is.null,start_datum.lte.${heute}`)
        // Verträge deren ende_datum noch nicht abgelaufen ist
        .or(`ende_datum.is.null,ende_datum.gte.${heute}`)
        // Verträge deren kuendigungsdatum noch nicht abgelaufen ist
        .or(`kuendigungsdatum.is.null,kuendigungsdatum.gte.${heute}`);
      if (error) throw error;
      return data || [];
    }
  });

  // Forderungen und Zahlungen des laufenden Monats; die Rechnung je Vertrag steht in
  // utils/monatsSaldo.ts. Ein Ladefehler lieferte bis zum 27.10.2026 still 0 € Eingang
  // („Noch keine Zahlungen erfasst“) — jetzt wird er angezeigt.
  const { data: monatsDaten, isError: monatsFehler } = useQuery({
    queryKey: ['erfasste-miete'],
    queryFn: async () => {
      const aktuellerMonat = alsIsoTag(new Date()).slice(0, 7);
      const [zahlungen, forderungen] = await Promise.all([
        alleSeiten<MonatsZahlung>((von, bis, mitZaehlung) =>
          supabase
            .from('zahlungen')
            .select('mietvertrag_id, betrag, kategorie', { count: mitZaehlung ? 'exact' : undefined })
            .in('kategorie', ['Miete', 'Rücklastschrift'])
            .eq('zugeordneter_monat', aktuellerMonat)
            .not('mietvertrag_id', 'is', null)
            .order('id')
            .range(von, bis)
        ),
        alleSeiten<MonatsForderung>((von, bis, mitZaehlung) =>
          supabase
            .from('mietforderungen')
            .select('mietvertrag_id, sollbetrag, typ', { count: mitZaehlung ? 'exact' : undefined })
            .eq('sollmonat', `${aktuellerMonat}-01`)
            .order('id')
            .range(von, bis)
        ),
      ]);
      return { zahlungen, forderungen };
    }
  });

  const { data: marktdaten } = useQuery({
    queryKey: ['aktuelle-marktdaten'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('aktuelle_marktdaten')
        .select('*');
      if (error) throw error;
      const basiszins = data?.find((d: any) => d.typ === 'basiszinssatz');
      const vpi = data?.find((d: any) => d.typ === 'vpi');
      return { basiszins, vpi };
    },
    staleTime: 300000,
  });

  const saveMarktdaten = async (typ: 'basiszinssatz' | 'vpi', wert: number) => {
    const heute = alsIsoTag(new Date());
    await (supabase as any).from('marktdaten').upsert({
      typ,
      wert,
      stichtag: heute,
      quelle: 'Manuelle Korrektur',
      abgerufen_am: new Date().toISOString(),
    }, { onConflict: 'typ,stichtag' });
    queryClient.invalidateQueries({ queryKey: ['aktuelle-marktdaten'] });
    setEditingTyp(null);
  };

  // Dieselbe Stichtagsregel wie Mietaufstellung und Mietuebersicht. Der Filter
  // in der Query oben ist nur der Vorfilter -- massgeblich ist istLaufenderVertrag,
  // damit die drei Ansichten nicht wieder auseinanderlaufen.
  const relevanteVertraege = (mietvertraege || []).filter((mv) => istLaufenderVertrag(mv));
  const aktiveMietvertraege = relevanteVertraege.filter(mv => mv.status === 'aktiv');
  const gekuendigteMietvertraege = relevanteVertraege.filter(mv => mv.status === 'gekuendigt');

  const gesamtKaltmiete = relevanteVertraege.reduce((sum, v) => sum + (v.kaltmiete || 0), 0);
  const gesamtBetriebskosten = relevanteVertraege.reduce((sum, v) => sum + (v.betriebskosten || 0), 0);
  const saldo = monatsSaldo(relevanteVertraege, monatsDaten?.forderungen ?? [], monatsDaten?.zahlungen ?? []);
  const ladeFehler = einheitenFehler || vertraegeFehler || monatsFehler;
  const monatGeladen = !!monatsDaten && !!mietvertraege;

  // Einheiten statt Verträge zählen: zwei laufende Verträge auf einer Einheit sind eine vermietete Einheit
  const vermieteteEinheiten = new Set(relevanteVertraege.map((mv) => mv.einheit_id ?? mv.id)).size;
  const leerstände = gesamtEinheiten ? gesamtEinheiten - vermieteteEinheiten : 0;

  // Berechne das nächste Kündigungs- oder Auslaufdatum. Kalendertage als Text vergleichen: Mit
  // `new Date(ende) > heute` fiel ein Vertrag, der heute endet, ab 1 bzw. 2 Uhr heraus (27.10.2026).
  const heuteTag = alsIsoTag(new Date());
  const naechstesVertragInfo = mietvertraege
    ?.reduce((frueheste: { datum: string | null, vertrag: any | null }, mv) => {
      const ende = getVertragsende(mv)?.slice(0, 10);
      if (!ende || ende < heuteTag) return frueheste;
      if (!frueheste.datum) return { datum: ende, vertrag: mv };
      return ende < frueheste.datum ? { datum: ende, vertrag: mv } : frueheste;
    }, { datum: null, vertrag: null });

  const naechstesDatum = naechstesVertragInfo?.datum;
  const naechsterVertrag = naechstesVertragInfo?.vertrag;

  const formatDatum = (datum: string | null) => {
    if (!datum) return 'Keine';
    return new Date(datum).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const heute = new Date();
  const monat = heute.toLocaleDateString('de-DE', { month: 'long' });

  // Beträge wie in Schriftstücken: „48.250 €“ statt „€48,250“, Cent nur wenn vorhanden
  const euro = formatEuroKompakt;
  const anzahlObjekte = immobilien?.length || 0;

  // Wert einer Marktkennzahl mit Bearbeiten-Knopf (nur Admin); Eingabe wie bisher
  const marktwert = (typ: 'basiszinssatz' | 'vpi', anzeige: ReactNode, aktuell: number | undefined, schritt: string, bezeichnung: string) =>
    editingTyp === typ ? (
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={schritt}
          value={editWert}
          onChange={e => setEditWert(e.target.value)}
          className="h-7 w-20 rounded-md border border-input bg-card px-2 text-xs focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-ring/10"
          aria-label={bezeichnung}
          autoFocus
        />
        <button onClick={() => saveMarktdaten(typ, parseFloat(editWert))} className="rounded-md p-1 text-success hover:bg-success/10" aria-label={`${bezeichnung} speichern`}>
          <Check className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => setEditingTyp(null)} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Abbrechen">
          <X className="h-3.5 w-3.5" />
        </button>
      </span>
    ) : (
      <span className="flex items-center gap-1.5">
        {anzeige}
        {isAdmin && (
          <button
            onClick={() => { setEditingTyp(typ); setEditWert(String(aktuell ?? '')); }}
            className="rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={`${bezeichnung} bearbeiten`}
          >
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
      </span>
    );

  // Exposé-Kopf der Startseite (27.10.2026): große leichte Überschrift, drei Leitzahlen auf
  // einer Anthrazitlinie, darunter eine Faktenzeile. Rechenwege unverändert.
  return (
    <section aria-labelledby="portfolio-titel" className="pb-10 pt-8 sm:pt-12 lg:pb-14 lg:pt-16">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-end lg:gap-12">
        <div className="min-w-0">
          <p className="eyebrow">Portfolio · {heute.getFullYear()}</p>
          <h1 id="portfolio-titel" className="mt-3 text-[2.5rem] font-light leading-[1.04] tracking-[-0.025em] text-foreground sm:text-5xl lg:text-[3.5rem]">
            Ihr Portfolio im <span className="font-normal text-brand">{monat}</span>
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {anzahlObjekte} {anzahlObjekte === 1 ? 'Objekt' : 'Objekte'} mit {gesamtEinheiten || 0} Einheiten, davon {vermieteteEinheiten} vermietet
            {leerstände > 0 ? ` und ${leerstände} frei` : ''}.
          </p>
          {ladeFehler && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              Ein Teil der Kennzahlen konnte nicht geladen werden. Fehlende Werte stehen als „—“, bitte die Seite neu laden.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 border-t border-foreground sm:grid-cols-3">
          <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-border py-3.5 sm:block sm:border-b-0 sm:py-0 sm:pr-5 sm:pt-4">
            <p className="eyebrow">Soll-Miete</p>
            <p className="whitespace-nowrap text-2xl font-light sm:mt-2 leading-none tabular-nums text-foreground sm:text-[1.75rem] xl:text-[2rem]">{monatGeladen ? euro(saldo.soll) : '—'}</p>
          </div>
          <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-border py-3.5 sm:block sm:border-b-0 sm:border-l sm:px-5 sm:py-0 sm:pt-4">
            <p className="eyebrow flex items-center gap-1.5">
              Eingang
              {monatGeladen && saldo.eingang === 0 && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 cursor-help text-warning" aria-label="Noch keine Zahlungen erfasst" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p className="text-xs">Noch keine Zahlungen für diesen Monat erfasst. Bitte laden Sie einen Kontoauszug (CSV) im Controlboard hoch.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </p>
            <p className="whitespace-nowrap text-2xl font-light sm:mt-2 leading-none tabular-nums text-foreground sm:text-[1.75rem] xl:text-[2rem]">{monatGeladen ? euro(saldo.eingang) : '—'}</p>
          </div>
          <div className="flex min-w-0 items-baseline justify-between gap-4 py-3.5 sm:block sm:border-l sm:border-border sm:py-0 sm:pl-5 sm:pt-4">
            <p className="eyebrow">Noch offen</p>
            <p className={`whitespace-nowrap text-2xl font-light sm:mt-2 leading-none tabular-nums sm:text-[1.75rem] xl:text-[2rem] ${monatGeladen && saldo.offen > 0 ? 'text-brand' : 'text-foreground'}`}>
              {monatGeladen ? euro(saldo.offen) : '—'}
            </p>
            {monatGeladen && (saldo.vertraegeMitRueckstand > 0 || saldo.mehr > 0) && (
              <p className="mt-1 text-xs text-muted-foreground sm:mt-2">
                {saldo.vertraegeMitRueckstand > 0 && `${saldo.vertraegeMitRueckstand} ${saldo.vertraegeMitRueckstand === 1 ? 'Vertrag' : 'Verträge'}`}
                {saldo.vertraegeMitRueckstand > 0 && saldo.mehr > 0 && ' · '}
                {saldo.mehr > 0 && `${euro(saldo.mehr)} mehr eingegangen`}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Faktenzeile */}
      <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-4 text-sm sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-10">
        <div>
          <dt className="eyebrow">Kaltmiete</dt>
          <dd className="mt-1 tabular-nums text-foreground">{euro(gesamtKaltmiete)}</dd>
        </div>
        <div>
          <dt className="eyebrow">Betriebskosten</dt>
          <dd className="mt-1 tabular-nums text-foreground">{euro(gesamtBetriebskosten)}</dd>
        </div>
        <div>
          <dt className="eyebrow">Leerstand</dt>
          <dd className={`mt-1 tabular-nums ${leerstände > 0 ? 'text-brand' : 'text-success'}`}>{leerstände}</dd>
        </div>
        <div>
          <dt className="eyebrow">Gekündigt</dt>
          <dd className="mt-1 tabular-nums text-foreground">{gekuendigteMietvertraege.length}</dd>
        </div>
        <div>
          <dt className="eyebrow">Nächstes Vertragsende</dt>
          <dd className="mt-1">
            <button
              type="button"
              disabled={!naechsterVertrag || !onNavigateToContract}
              className="inline-flex items-center gap-1 tabular-nums text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-brand disabled:no-underline"
              onClick={() => {
                if (naechsterVertrag && onNavigateToContract) {
                  onNavigateToContract(
                    naechsterVertrag.einheiten?.immobilie_id,
                    naechsterVertrag.einheit_id,
                    naechsterVertrag.id
                  );
                }
              }}
            >
              {formatDatum(naechstesDatum)}
            </button>
          </dd>
        </div>
        <div className="group">
          <dt className="eyebrow">Basiszins / Verzug</dt>
          <dd className="mt-1 tabular-nums text-foreground">
            {marktwert(
              'basiszinssatz',
              <>
                {marktdaten?.basiszins ? `${marktdaten.basiszins.wert}%` : '–'}
                <span className="text-muted-foreground">→ {marktdaten?.basiszins ? `${(marktdaten.basiszins.wert + 5).toFixed(2)}%` : '–'}</span>
              </>,
              marktdaten?.basiszins?.wert,
              '0.01',
              'Basiszinssatz',
            )}
          </dd>
        </div>
        <div className="group">
          <dt className="eyebrow">VPI 2020 = 100</dt>
          <dd className="mt-1 tabular-nums text-foreground">
            {marktwert('vpi', <>{marktdaten?.vpi ? marktdaten.vpi.wert.toFixed(1) : '–'}</>, marktdaten?.vpi?.wert, '0.1', 'Verbraucherpreisindex')}
          </dd>
        </div>
      </dl>
    </section>
  );
};
