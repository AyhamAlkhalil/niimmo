
import { Pencil, Check, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatEuroKompakt } from "@/utils/betragAnzeige";
import { useState, type ReactNode } from "react";
import { useUserRole } from "@/hooks/useUserRole";
import { AKTUELLER_VPI_KEY, BASISZINS_PERIODEN_KEY } from "@/hooks/useBasiszinsPerioden";
import { Input } from "@/components/ui/input";
import { alsIsoTag, getVertragsende, istLaufenderVertrag } from "@/utils/contractUtils";
import { basiszinsPeriodenBeginn, marktdatenKorrektur, vorgeschlagenerVpiMonat } from "@/utils/marktdatenKorrektur";
import { useMietkonto } from "@/hooks/useRueckstaende";
import { KennzahlInfo } from "./KennzahlInfo";

interface DashboardStatsProps {
  immobilien: any[] | undefined;
  onNavigateToContract?: (immobilieId: string, einheitId: string, mietvertragId: string) => void;
}

export const DashboardStats = ({ immobilien, onNavigateToContract }: DashboardStatsProps) => {
  const queryClient = useQueryClient();
  const { isAdmin } = useUserRole();
  const [editingTyp, setEditingTyp] = useState<'basiszinssatz' | 'vpi' | null>(null);
  const [editWert, setEditWert] = useState("");
  // Bezugsmonat einer VPI-Korrektur (JJJJ-MM) und Meldung am Feld
  const [editMonat, setEditMonat] = useState("");
  const [editFehler, setEditFehler] = useState<string | null>(null);
  const [speichertMarktwert, setSpeichertMarktwert] = useState(false);
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
        // Verträge deren ende_datum noch nicht abgelaufen ist. Kein Filter auf kuendigungsdatum:
        // Das Vertragsende kommt aus getVertragsende() (ende_datum führt); der frühere Zusatzfilter
        // warf Verträge mit späterem ende_datum heraus (28.10.2026).
        .or(`ende_datum.is.null,ende_datum.gte.${heute}`);
      if (error) throw error;
      return data || [];
    }
  });

  // Soll-Miete, Eingang und Noch offen kommen aus derselben Abfrage und demselben Mietkonto wie die
  // Rückstandsliste darunter (utils/monatsSaldo.ts, 29.10.2026). Ein Ladefehler zeigt „—“, nie 0 €.
  const { data: mietkonto, isError: monatsFehler } = useMietkonto();

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

  // Stichtag, Wertebereich und Zeilen aus utils/marktdatenKorrektur.ts (28.10.2026): bis dahin
  // stichtag = heute, ungeprüft, ohne Fehlerauswertung und ohne Neuladen der Hooks
  const saveMarktdaten = async (typ: 'basiszinssatz' | 'vpi') => {
    const korrektur = marktdatenKorrektur(typ, editWert, new Date(), editMonat);
    if ('fehler' in korrektur) {
      setEditFehler(korrektur.fehler);
      return;
    }
    setSpeichertMarktwert(true);
    const abgerufenAm = new Date().toISOString();
    const { error } = await (supabase as any).from('marktdaten').upsert(
      korrektur.zeilen.map((zeile) => ({ ...zeile, quelle: 'Manuelle Korrektur', abgerufen_am: abgerufenAm })),
      { onConflict: 'typ,stichtag' }
    );
    setSpeichertMarktwert(false);
    if (error) {
      console.error('Marktdaten-Korrektur nicht gespeichert:', error.message);
      setEditFehler('Der Wert konnte nicht gespeichert werden. Bitte erneut versuchen.');
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['aktuelle-marktdaten'] });
    queryClient.invalidateQueries({ queryKey: BASISZINS_PERIODEN_KEY });
    queryClient.invalidateQueries({ queryKey: AKTUELLER_VPI_KEY });
    setEditingTyp(null);
    setEditFehler(null);
  };

  // Dieselbe Stichtagsregel wie Mietaufstellung und Mietuebersicht. Der Filter
  // in der Query oben ist nur der Vorfilter -- massgeblich ist istLaufenderVertrag,
  // damit die drei Ansichten nicht wieder auseinanderlaufen.
  const relevanteVertraege = (mietvertraege || []).filter((mv) => istLaufenderVertrag(mv));
  const aktiveMietvertraege = relevanteVertraege.filter(mv => mv.status === 'aktiv');
  const gekuendigteMietvertraege = relevanteVertraege.filter(mv => mv.status === 'gekuendigt');

  // Kaltmiete und Betriebskosten der Faktenzeile teilen die Soll-Miete auf (monatsSaldo → aufteilung). Bis zum
  // 29.10.2026 standen dort die Vertragswerte (summiereLaufendeMieten), die im Monat eines Einzugs oder einer
  // erst ab dem Folgemonat geltenden Erhöhung nicht die Soll-Miete ergaben (Kundenfrage).
  const saldo = mietkonto?.monat;
  const ladeFehler = einheitenFehler || vertraegeFehler || monatsFehler;
  const monatGeladen = !!saldo;

  // Einheiten statt Verträge zählen: zwei laufende Verträge auf einer Einheit sind eine vermietete Einheit
  const vermieteteEinheiten = new Set(relevanteVertraege.map((mv) => mv.einheit_id ?? mv.id)).size;
  const leerstände = gesamtEinheiten ? gesamtEinheiten - vermieteteEinheiten : 0;
  // Ladefehler und Laden zeigen „—“, nie 0: Bis zum 29.10.2026 stand bei fehlgeschlagener Abfrage ein
  // grünes „0“ beim Leerstand und „0 €“ Kaltmiete (Review)
  const vertraegeDa = !!mietvertraege && !vertraegeFehler;
  const bestandDa = vertraegeDa && gesamtEinheiten !== undefined && !einheitenFehler;

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
  const vorzeichen = (betrag: number) => `${betrag > 0 ? '+' : '−'} ${euro(Math.abs(betrag))}`;
  const anzahlObjekte = immobilien?.length || 0;

  // Wert einer Marktkennzahl mit Bearbeiten-Knopf (nur Admin). ui/input statt rohem Zahlenfeld:
  // das liest das Dezimalkomma (vorher wurde „1,52“ zu 152)
  const marktwert = (typ: 'basiszinssatz' | 'vpi', anzeige: ReactNode, aktuell: number | undefined, schritt: string, bezeichnung: string, letzterStichtag?: string) =>
    editingTyp === typ ? (
      <span className="flex flex-wrap items-center gap-1">
        <Input
          type="number"
          step={schritt}
          value={editWert}
          onChange={e => { setEditWert(e.target.value); setEditFehler(null); }}
          className="h-7 w-20 px-2 text-xs md:text-xs"
          aria-label={bezeichnung}
          aria-invalid={!!editFehler}
          autoFocus
        />
        {typ === 'vpi' ? (
          <Input
            type="month"
            value={editMonat}
            onChange={e => { setEditMonat(e.target.value); setEditFehler(null); }}
            className="h-7 w-36 px-2 text-xs md:text-xs"
            aria-label="Bezugsmonat des VPI"
            placeholder="JJJJ-MM"
          />
        ) : (
          <span className="text-xs text-muted-foreground">
            ab {basiszinsPeriodenBeginn(new Date()).split('-').reverse().join('.')}
          </span>
        )}
        <button onClick={() => saveMarktdaten(typ)} disabled={speichertMarktwert} className="rounded-md p-1 text-success hover:bg-success/10 disabled:opacity-50" aria-label={`${bezeichnung} speichern`}>
          <Check className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => { setEditingTyp(null); setEditFehler(null); }} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Abbrechen">
          <X className="h-3.5 w-3.5" />
        </button>
        {editFehler && <span role="alert" className="basis-full text-xs text-destructive">{editFehler}</span>}
      </span>
    ) : (
      <span className="flex items-center gap-1.5">
        {anzeige}
        {isAdmin && (
          <button
            onClick={() => {
              setEditingTyp(typ);
              setEditWert(String(aktuell ?? ''));
              setEditMonat(vorgeschlagenerVpiMonat(letzterStichtag, new Date()));
              setEditFehler(null);
            }}
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
            {bestandDa
              ? <>{anzahlObjekte} {anzahlObjekte === 1 ? 'Objekt' : 'Objekte'} mit {gesamtEinheiten} Einheiten, davon {vermieteteEinheiten} vermietet{leerstände > 0 ? ` und ${leerstände} frei` : ''}.</>
              : ladeFehler ? 'Bestand nicht geladen.' : 'Bestand wird geladen …'}
          </p>
          {ladeFehler && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              Ein Teil der Kennzahlen konnte nicht geladen werden. Fehlende Werte stehen als „—“, bitte die Seite neu laden.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 border-t border-foreground sm:grid-cols-3">
          <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-border py-3.5 sm:block sm:border-b-0 sm:py-0 sm:pr-5 sm:pt-4">
            <p className="eyebrow flex items-center gap-1">
              Soll-Miete
              <KennzahlInfo titel={`Soll-Miete ${monat}`}>
                <p>Die Monatsmieten im {monat} aller aktiven und gekündigten Verträge, die in diesem Monat laufen — auch bei Einzug im Laufe des Monats. So, wie die Sollstellung sie anlegt: Kaltmiete + Betriebskosten, bei Ein- oder Auszug taggenau anteilig, mit Minderungen und Rücklastschriftgebühren.</p>
                <p>Fällig am 8. des Monats, beim Einzug am Mietbeginn.</p>
                {saldo && (
                  <table className="mt-2 w-full text-xs tabular-nums">
                    <tbody>
                      <tr><td>Kaltmiete</td><td className="text-right">{euro(saldo.aufteilung.kaltmiete)}</td></tr>
                      <tr><td>Betriebskosten</td><td className="text-right">{euro(saldo.aufteilung.betriebskosten)}</td></tr>
                      {saldo.ueberleitung.gebuehren !== 0 && <tr><td>Rücklastschriftgebühren</td><td className="text-right">{euro(saldo.ueberleitung.gebuehren)}</td></tr>}
                      <tr className="border-t border-border font-medium text-foreground"><td>Soll-Miete</td><td className="text-right">{euro(saldo.soll)}</td></tr>
                    </tbody>
                  </table>
                )}
                {saldo && (saldo.ueberleitung.anteilig !== 0 || saldo.ueberleitung.abweichend !== 0) && (
                  <>
                    <p className="mt-2">Laut Verträgen sind es {euro(saldo.ueberleitung.vertragsmiete)} im Monat. Unterschied im {monat}:</p>
                    <table className="w-full text-xs tabular-nums">
                      <tbody>
                        {saldo.ueberleitung.anteilig !== 0 && <tr><td>Einzug oder Auszug im Monat, nur anteilig</td><td className="text-right">{vorzeichen(saldo.ueberleitung.anteilig)}</td></tr>}
                        {saldo.ueberleitung.abweichend !== 0 && <tr><td>Abweichende Monatsmiete (z. B. Erhöhung erst ab Folgemonat, Minderung)</td><td className="text-right">{vorzeichen(saldo.ueberleitung.abweichend)}</td></tr>}
                      </tbody>
                    </table>
                  </>
                )}
              </KennzahlInfo>
            </p>
            <p className="whitespace-nowrap text-2xl font-light sm:mt-2 leading-none tabular-nums text-foreground sm:text-[1.75rem] xl:text-[2rem]">{saldo ? euro(saldo.soll) : '—'}</p>
          </div>
          <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-border py-3.5 sm:block sm:border-b-0 sm:border-l sm:px-5 sm:py-0 sm:pt-4">
            <p className="eyebrow flex items-center gap-1">
              Eingang
              <KennzahlInfo titel={`Eingang ${monat}`}>
                <p>Der Teil der Soll-Miete, den Zahlungen und Gutschriften decken. Eingang + Noch offen = Soll-Miete.</p>
                <p>Zahlungen tilgen zuerst ältere Rückstände (§ 366 BGB). Eine schon im Vormonat gezahlte Miete zählt hier mit, eine Zahlung auf eine noch nicht fällige Betriebskostennachzahlung nicht.</p>
              </KennzahlInfo>
              {saldo && saldo.zahlungenImMonat === 0 && (
                <KennzahlInfo titel="Noch keine Zahlungen erfasst" warnung>
                  <p>Für diesen Monat ist noch keine Zahlung eines Mieters gebucht. Bitte einen Kontoauszug (CSV) im Controlboard hochladen.</p>
                </KennzahlInfo>
              )}
            </p>
            <p className="whitespace-nowrap text-2xl font-light sm:mt-2 leading-none tabular-nums text-foreground sm:text-[1.75rem] xl:text-[2rem]">{saldo ? euro(saldo.eingang) : '—'}</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 py-3.5 sm:block sm:border-l sm:border-border sm:py-0 sm:pl-5 sm:pt-4">
            <p className="eyebrow flex items-center gap-1">
              Noch offen
              <KennzahlInfo titel={`Noch offen ${monat}`}>
                <p>Was von der Soll-Miete im {monat} noch nicht bezahlt ist. Vor der Fälligkeit (8. des Monats, beim Einzug Mietbeginn) ist es noch kein Rückstand.</p>
                <p>Ältere Rückstände stehen darunter getrennt. Ab dem 8. ergeben beide zusammen die Rückstände unter „Handlungsbedarf“. Guthaben stehen ebenfalls dort.</p>
              </KennzahlInfo>
            </p>
            <p className={`whitespace-nowrap text-2xl font-light sm:mt-2 leading-none tabular-nums sm:text-[1.75rem] xl:text-[2rem] ${saldo && saldo.offen > 0 ? 'text-brand' : 'text-foreground'}`}>
              {saldo ? euro(saldo.offen) : '—'}
            </p>
            {saldo && (saldo.vertraegeOffen > 0 || saldo.aelter > 0) && (
              <p className="mt-1 basis-full text-right text-xs text-muted-foreground sm:mt-2 sm:text-left">
                {saldo.vertraegeOffen > 0 && `${saldo.vertraegeOffen} ${saldo.vertraegeOffen === 1 ? 'Vertrag' : 'Verträge'}`}
                {saldo.vertraegeOffen > 0 && saldo.aelter > 0 && ' · '}
                {saldo.aelter > 0 && `dazu ${euro(saldo.aelter)} ältere Rückstände`}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Faktenzeile */}
      <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-4 text-sm sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-10">
        <div>
          <dt className="eyebrow flex items-center gap-1">
            Kaltmiete
            <KennzahlInfo titel={`Kaltmiete ${monat}`}>
              <p>Der Kaltmiete-Anteil der Soll-Miete im {monat}. Kaltmiete + Betriebskosten = Soll-Miete.</p>
              <p>Bei Ein- oder Auszug im Monat anteilig. Gilt eine Mieterhöhung erst ab dem Folgemonat, steht hier noch die alte Kaltmiete; eine Minderung senkt sie.</p>
              {saldo && <p>Laut Verträgen: {euro(saldo.aufteilung.vertragKaltmiete)} im Monat.</p>}
            </KennzahlInfo>
          </dt>
          <dd className="mt-1 tabular-nums text-foreground">{saldo ? euro(saldo.aufteilung.kaltmiete) : '—'}</dd>
        </div>
        <div>
          <dt className="eyebrow flex items-center gap-1">
            Betriebskosten
            <KennzahlInfo titel={`Betriebskosten ${monat}`}>
              <p>Die Betriebskostenvorauszahlungen in der Soll-Miete im {monat}, bei Ein- oder Auszug im Monat anteilig.</p>
              {saldo && <p>Laut Verträgen: {euro(saldo.aufteilung.vertragBetriebskosten)} im Monat.</p>}
            </KennzahlInfo>
          </dt>
          <dd className="mt-1 tabular-nums text-foreground">{saldo ? euro(saldo.aufteilung.betriebskosten) : '—'}</dd>
        </div>
        {saldo && saldo.ueberleitung.gebuehren !== 0 && (
          <div>
            <dt className="eyebrow flex items-center gap-1">
              Gebühren
              <KennzahlInfo titel="Rücklastschriftgebühren">
                <p>Rücklastschriftgebühren im {monat}. Sie gehören zur Soll-Miete: Kaltmiete + Betriebskosten + Gebühren = Soll-Miete.</p>
              </KennzahlInfo>
            </dt>
            <dd className="mt-1 tabular-nums text-foreground">{euro(saldo.ueberleitung.gebuehren)}</dd>
          </div>
        )}
        <div>
          <dt className="eyebrow flex items-center gap-1">
            Leerstand
            <KennzahlInfo titel="Leerstand">
              <p>Einheiten ohne laufenden Mietvertrag. Ein unterschriebener Vertrag, der erst später beginnt, zählt noch als Leerstand.</p>
            </KennzahlInfo>
          </dt>
          <dd className={`mt-1 tabular-nums ${!bestandDa ? 'text-foreground' : leerstände > 0 ? 'text-brand' : 'text-success'}`}>{bestandDa ? leerstände : '—'}</dd>
        </div>
        <div>
          <dt className="eyebrow flex items-center gap-1">
            Gekündigt
            <KennzahlInfo titel="Gekündigt">
              <p>Laufende Verträge mit Kündigung, deren Mietende noch nicht erreicht ist. Sie zählen bis dahin in Miete und Soll-Miete mit.</p>
            </KennzahlInfo>
          </dt>
          <dd className="mt-1 tabular-nums text-foreground">{vertraegeDa ? gekuendigteMietvertraege.length : '—'}</dd>
        </div>
        <div>
          <dt className="eyebrow flex items-center gap-1">
            Nächstes Vertragsende
            <KennzahlInfo titel="Nächstes Vertragsende">
              <p>Das früheste Mietende ab heute, aus Kündigung oder befristetem Vertrag. Ein Klick auf das Datum öffnet den Vertrag.</p>
            </KennzahlInfo>
          </dt>
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
              {vertraegeDa ? formatDatum(naechstesDatum) : '—'}
            </button>
          </dd>
        </div>
        <div className="group">
          <dt className="eyebrow flex items-center gap-1">
            Basiszins / Verzug
            <KennzahlInfo titel="Basiszins / Verzug">
              <p>Basiszinssatz der Bundesbank und daraus der Verzugszins für Wohnraummieter: Basiszins + 5 Prozentpunkte (§ 288 Abs. 1 BGB). Die Mahnung rechnet damit. Bei Gewerbe wären es 9 Prozentpunkte (Abs. 2).</p>
            </KennzahlInfo>
          </dt>
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
          <dt className="eyebrow flex items-center gap-1">
            VPI 2020 = 100
            <KennzahlInfo titel="Verbraucherpreisindex">
              <p>Verbraucherpreisindex des Statistischen Bundesamts, Basisjahr 2020 = 100. Grundlage für Indexmieten.</p>
            </KennzahlInfo>
          </dt>
          <dd className="mt-1 tabular-nums text-foreground">
            {marktwert('vpi', <>{marktdaten?.vpi ? marktdaten.vpi.wert.toFixed(1) : '–'}</>, marktdaten?.vpi?.wert, '0.1', 'Verbraucherpreisindex', marktdaten?.vpi?.stichtag)}
          </dd>
        </div>
      </dl>
    </section>
  );
};
