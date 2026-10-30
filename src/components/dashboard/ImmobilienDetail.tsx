import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatBetragKompakt } from "@/utils/betragAnzeige";
import type { Database } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { EinheitCard } from "./EinheitCard";
import { HausangabenFuerVertraege } from "./HausangabenFuerVertraege";
import { ArrowLeft, MapPin, Calendar, Info, Loader2, Pencil, Check, X, Droplets, Zap, Flame, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffect, useRef, useState } from "react";
import { sortUnitsByNumber, getCurrentContract, filterActiveAndTerminatedContracts, summiereLaufendeMieten } from "@/utils/contractUtils";
import { useEditableField } from "@/hooks/useEditableField";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { format } from "date-fns";
import { ImmobilienDocumentsTab } from "./ImmobilienDocumentsTab";
import { ImmobilienNebenkostenTabNew } from "./nebenkosten/ImmobilienNebenkostenTabNew";
import { ImmobilienVersicherungenTab } from "./ImmobilienVersicherungenTab";
import { ObjektFinanzierung } from "./ObjektFinanzierung";
import { Fassade } from "./Fassade";
import { freieEinheiten } from "@/utils/fassadenPlan";
import { standImEntwurf } from "./ZaehlerVerwaltung";
import { flaecheFuerSumme } from "@/utils/einheitFlaeche";

/** Mieterfelder, die der Vertrags-Query nachlaedt (siehe useQuery 'mietvertrag-detail'). */
type MieterKurz = Pick<
  Database['public']['Tables']['mieter']['Row'],
  'id' | 'vorname' | 'nachname' | 'hauptmail' | 'telnr'
>;

interface ImmobilienDetailProps {
  immobilieId: string;
  onBack: () => void;
  filters: {
    mietstatus: string;
    zahlungsstatus: string;
    vertragsart: string;
  };
  scrollToEinheitId?: string | null;
  openMietvertragId?: string | null;
  onContractModalClose?: () => void;
  isHausmeister?: boolean;
  initialTab?: string | null;
}
export const ImmobilienDetail = ({
  immobilieId,
  onBack,
  scrollToEinheitId,
  openMietvertragId,
  onContractModalClose,
  isHausmeister = false,
  initialTab,
}: ImmobilienDetailProps) => {
  const queryClient = useQueryClient();
  const einheitRefs = useRef<{
    [key: string]: HTMLDivElement | null;
  }>({});
  const [activeTab, setActiveTab] = useState(initialTab ?? "einheiten");
  const [searchTerm, setSearchTerm] = useState("");

  // State for editable meter fields
  const [editingMeter, setEditingMeter] = useState<string | null>(null);
  const [meterValues, setMeterValues] = useState<Record<string, string>>({});
  
  const {
    startEditing,
    updateValue,
    cancelEdit,
    getEditingValue,
    isFieldEditing,
    saveSingleField
  } = useEditableField();
  const {
    data: immobilie,
    isLoading: immobilieLoading
  } = useQuery({
    queryKey: ['immobilie', immobilieId],
    queryFn: async () => {
      const {
        data,
        error
      } = await supabase.from('immobilien').select('*').eq('id', immobilieId).single();
      if (error) throw error;
      return data;
    }
  });
  const {
    data: einheiten,
    isLoading: einheitenLoading
  } = useQuery({
    queryKey: ['einheiten', immobilieId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('einheiten')
        .select('*')
        .eq('immobilie_id', immobilieId);
      
      if (error) throw error;

      // Hier stand bis zum 06.09.2026 eine Gruppierung nach den letzten zwei
      // Zeichen der UUID, die je Gruppe nur die neueste Einheit behielt. Da es
      // nur 256 solcher Gruppen gibt, kollidierten schon bei 20 Einheiten in
      // einem Haus zwei mit rund 50 Prozent Wahrscheinlichkeit -- die aeltere
      // verschwand dann lautlos samt Vertrag aus Detailansicht, Suche und
      // Kuendigung. Ein fachlicher Grund fuer die Gruppierung war nicht
      // erkennbar; die Eindeutigkeit sichert bereits der Primaerschluessel.
      return sortUnitsByNumber(data || []);
    }
  });
  const {
    data: mietvertraege
  } = useQuery({
    queryKey: ['mietvertrag-detail', immobilieId, einheiten?.map(e => e.id).join(',')],
    queryFn: async () => {
      const einheitIds = einheiten?.map(e => e.id) || [];
      if (einheitIds.length === 0) return [];
      
      const { data: vertraege, error: vertraegeError } = await supabase
        .from('mietvertrag')
        .select('*')
        .in('einheit_id', einheitIds);

      if (vertraegeError) throw vertraegeError;
      
      const vertragIds = vertraege?.map(v => v.id) || [];
      // Immer mit mieter-Feld zurueckgeben, sonst ist der Typ je nach Pfad ein anderer
      const ohneMieter = (vertraege || []).map(v => ({ ...v, mieter: [] as MieterKurz[] }));
      if (vertragIds.length === 0) return ohneMieter;
      
      const { data: mietvertragMieter, error: mmError } = await supabase
        .from('mietvertrag_mieter')
        .select(`mietvertrag_id, mieter_id`)
        .in('mietvertrag_id', vertragIds);
      
      if (mmError) throw mmError;
      
      const mieterIds = mietvertragMieter?.map(mm => mm.mieter_id) || [];
      if (mieterIds.length === 0) return ohneMieter;
      
      const { data: mieter, error: mieterError } = await supabase
        .from('mieter')
        .select('id, vorname, nachname, hauptmail, telnr')
        .in('id', mieterIds);
      
      if (mieterError) throw mieterError;
      
      return vertraege?.map(vertrag => {
        const allMieterForVertrag = mietvertragMieter?.filter(mm => mm.mietvertrag_id === vertrag.id) || [];
        const mieterData = allMieterForVertrag
          .map(mvMieter => mieter?.find(m => m.id === mvMieter.mieter_id))
          .filter((m): m is MieterKurz => Boolean(m));
        
        return { ...vertrag, mieter: mieterData };
      }) || [];
    },
    enabled: !!einheiten
  });

  // Vertraege fuer die Mietsummen im Kopf. Der Status ist nur Vorfilter --
  // massgeblich ist der am Stichtag laufende Vertrag je Einheit (summiereLaufendeMieten).
  const {
    data: alleMietvertraege,
    isError: mietenFehler
  } = useQuery({
    queryKey: ['alle-mietvertrag-immobilie', immobilieId],
    queryFn: async () => {
      const einheitIds = einheiten?.map(e => e.id) || [];
      if (einheitIds.length === 0) return [];

      const { data, error } = await supabase
        .from('mietvertrag')
        .select('einheit_id, kaltmiete, betriebskosten, status, start_datum, ende_datum, kuendigungsdatum')
        .in('einheit_id', einheitIds)
        .in('status', ['aktiv', 'gekuendigt']);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!einheiten
  });

  // Query für Dokumente dieser Immobilie
  const { data: immobilienDokumente } = useQuery({
    queryKey: ['immobilien-dokumente', immobilieId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dokumente')
        .select('*')
        .eq('immobilie_id', immobilieId)
        .eq('geloescht', false)
        .order('hochgeladen_am', { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
  });

  const { kaltmiete: gesamtKaltmiete, betriebskosten: gesamtBetriebskosten } = summiereLaufendeMieten(alleMietvertraege);
  const gesamtWarmmiete = gesamtKaltmiete + gesamtBetriebskosten;
  // Beim Laden und bei einem Fehler „—“ statt 0 € (bis 27.10.2026 standen dort 0 €)
  const mietenBekannt = !!alleMietvertraege && !mietenFehler;
  // Fläche ohne Garagen und Stellplätze wie Mietaufstellung und Mietübersicht (einheitFlaeche, 29.10.2026)
  const gesamtQm = (einheiten || []).reduce((sum, einheit) => sum + flaecheFuerSumme(einheit), 0);

  // Scroll to specific unit if scrollToEinheitId is provided with enhanced highlighting
  useEffect(() => {
    if (scrollToEinheitId && einheiten && !einheitenLoading) {
      const timer = setTimeout(() => {
        const targetElement = einheitRefs.current[scrollToEinheitId];
        if (targetElement) {
          targetElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
          
          // Apply search highlight animation class
          targetElement.classList.add('animate-search-highlight');
          targetElement.style.border = '2px solid #be2637'; // Markenrot (26.10.2026)
          targetElement.style.borderRadius = '12px';
          targetElement.style.zIndex = '10';
          targetElement.style.position = 'relative';
          
          // Reset after enhanced duration
          setTimeout(() => {
            targetElement.classList.remove('animate-search-highlight');
            targetElement.style.border = '';
            targetElement.style.borderRadius = '';
            targetElement.style.zIndex = '';
            targetElement.style.position = '';
          }, 4000);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [scrollToEinheitId, einheiten, einheitenLoading]);
  const handleBackClick = () => {
    onBack();
  };
  if (immobilieLoading || einheitenLoading) {
    return <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>;
  }
  const freiImObjekt = einheiten && alleMietvertraege ? freieEinheiten(einheiten.map((e) => e.id), alleMietvertraege) : 0;
  const ueberzeile = [immobilie?.ort, immobilie?.objekttyp].filter(Boolean).join(" · ") || "Objekt";

  // Objektkopf wie die erste Seite eines Exposés (27.10.2026): Name groß und leicht, daneben
  // die Fassadenzeichnung, darunter die vier Summen auf einer Anthrazitlinie
  return <div className="min-h-screen modern-dashboard-bg">
      <div className="mx-auto max-w-[1400px] px-4 pb-16 sm:px-6 lg:px-10">
        <div className="mb-10">
          <div className="flex items-center gap-2.5 pt-6 sm:pt-8">
            <button
              type="button"
              onClick={handleBackClick}
              className="-ml-1 inline-flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Zurück zur Übersicht
            </button>
            <span className="h-3 w-px bg-border" aria-hidden="true" />
            <span className="eyebrow">Portfolio</span>
          </div>

          <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-end lg:gap-14">
            <div className="min-w-0">
              <p className="eyebrow">{ueberzeile}</p>
              <h1 className="mt-3 text-[2.25rem] font-light leading-[1.04] tracking-[-0.025em] text-foreground sm:text-5xl lg:text-[3.25rem]">
                {immobilie?.name}
              </h1>
              <p className="mt-3 flex items-start gap-1.5 text-base text-muted-foreground">
                <MapPin className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{immobilie?.adresse}</span>
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Badge variant="outline" className="px-2.5 py-1 text-sm tabular-nums">
                  {einheiten?.length || 0} von {immobilie?.einheiten_anzahl} Einheiten
                </Badge>
                  <div
                    className="flex items-center gap-2 cursor-pointer group"
                    title="Kappungsgrenze: 15% in 36 Monaten (angespannt) vs. 20% (normal)"
                    onClick={async () => {
                      const neuerWert = !(immobilie as any)?.ist_angespannt;
                      const { error } = await (supabase as any).from('immobilien').update({ ist_angespannt: neuerWert }).eq('id', immobilieId);
                      // Bis zum 28.10.2026 ungeprüft: Scheiterte das Speichern, sah der Klick
                      // wirkungslos aus — und die Kappungsgrenze der Mieterhöhung hängt daran.
                      if (error) {
                        toast.error('„Angespannter Markt“ wurde nicht gespeichert. Bitte erneut versuchen.');
                        return;
                      }
                      queryClient.invalidateQueries({ queryKey: ['immobilie', immobilieId] });
                    }}
                  >
                    <span className={`text-xs font-medium ${(immobilie as any)?.ist_angespannt ? 'text-orange-600' : 'text-muted-foreground'}`}>
                      Angespannter Markt
                    </span>
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${(immobilie as any)?.ist_angespannt ? 'bg-orange-500 border-orange-500' : 'border-gray-300 group-hover:border-orange-400'}`}>
                      {(immobilie as any)?.ist_angespannt && <Check className="h-3 w-3 text-white" />}
                    </div>
                  </div>
              </div>
            </div>

            <div className="relative aspect-[16/10] overflow-hidden bg-muted">
              {immobilie && (
                <Fassade id={immobilie.id} objekttyp={immobilie.objekttyp} einheiten={immobilie.einheiten_anzahl} frei={freiImObjekt} />
              )}
              {einheiten && einheiten.length > 0 && alleMietvertraege && (
                <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 bg-card/95 px-2.5 py-1 text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-foreground">
                  {freiImObjekt > 0 && <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />}
                  {freiImObjekt === 0 ? "Voll vermietet" : `${freiImObjekt} ${freiImObjekt === 1 ? "Einheit" : "Einheiten"} frei`}
                </span>
              )}
            </div>
          </div>

          {/* Summen */}
          <dl className="mt-10 grid grid-cols-2 border-t border-foreground sm:grid-cols-4 [&>div]:min-w-0 [&>div]:pb-1 [&>div]:pr-4 [&>div]:pt-4 [&>div:nth-child(even)]:border-l [&>div:nth-child(even)]:border-border [&>div:nth-child(even)]:pl-4 sm:[&>div+div]:border-l sm:[&>div+div]:border-border sm:[&>div+div]:pl-5">
            <div>
              <dt className="eyebrow">Fläche</dt>
              <dd className="mt-2 whitespace-nowrap text-2xl font-light leading-none tabular-nums text-foreground sm:text-3xl">{gesamtQm.toLocaleString('de-DE')} <span className="text-sm font-normal text-muted-foreground">m²</span></dd>
            </div>
            <div>
              <dt className="eyebrow">Kaltmiete</dt>
              <dd className="mt-2 whitespace-nowrap text-2xl font-light leading-none tabular-nums text-foreground sm:text-3xl">{mietenBekannt ? formatBetragKompakt(gesamtKaltmiete) : '—'} <span className="text-sm font-normal text-muted-foreground">€</span></dd>
            </div>
            <div className="mt-4 sm:mt-0">
              <dt className="eyebrow">Betriebskosten</dt>
              <dd className="mt-2 whitespace-nowrap text-2xl font-light leading-none tabular-nums text-foreground sm:text-3xl">{mietenBekannt ? formatBetragKompakt(gesamtBetriebskosten) : '—'} <span className="text-sm font-normal text-muted-foreground">€</span></dd>
            </div>
            <div className="mt-4 sm:mt-0">
              <dt className="eyebrow">Warmmiete</dt>
              <dd className="mt-2 whitespace-nowrap text-2xl font-light leading-none tabular-nums text-foreground sm:text-3xl">{mietenBekannt ? formatBetragKompakt(gesamtWarmmiete) : '—'} <span className="text-sm font-normal text-muted-foreground">€</span></dd>
            </div>
          </dl>

            <div className="mt-8 space-y-4">
              {immobilie && <HausangabenFuerVertraege immobilie={immobilie} summeEinheitenQm={gesamtQm} />}

              <ObjektFinanzierung
                immobilieId={immobilieId}
                kaltmiete={alleMietvertraege ? gesamtKaltmiete : null}
                betriebskosten={alleMietvertraege ? gesamtBetriebskosten : null}
                mietenFehler={mietenFehler}
              />

              {/* Allgemeine Zähler (Hausanschluss) - editable */}
              {(() => {
                const meterTypes = [
                  { key: 'wasser', label: 'Wasser', icon: Droplets, zaehlerField: 'allgemein_wasser_zaehler' as const, standField: 'allgemein_wasser_stand' as const, datumField: 'allgemein_wasser_datum' as const },
                  { key: 'strom', label: 'Strom', icon: Zap, zaehlerField: 'allgemein_strom_zaehler' as const, standField: 'allgemein_strom_stand' as const, datumField: 'allgemein_strom_datum' as const },
                  { key: 'gas', label: 'Gas', icon: Flame, zaehlerField: 'allgemein_gas_zaehler' as const, standField: 'allgemein_gas_stand' as const, datumField: 'allgemein_gas_datum' as const },
                ];
                
                // Also check for second set (_2)
                const meterTypes2 = [
                  { key: 'wasser_2', label: 'Wasser 2', icon: Droplets, zaehlerField: 'allgemein_wasser_zaehler_2' as const, standField: 'allgemein_wasser_stand_2' as const, datumField: 'allgemein_wasser_datum_2' as const },
                  { key: 'strom_2', label: 'Strom 2', icon: Zap, zaehlerField: 'allgemein_strom_zaehler_2' as const, standField: 'allgemein_strom_stand_2' as const, datumField: 'allgemein_strom_datum_2' as const },
                  { key: 'gas_2', label: 'Gas 2', icon: Flame, zaehlerField: 'allgemein_gas_zaehler_2' as const, standField: 'allgemein_gas_stand_2' as const, datumField: 'allgemein_gas_datum_2' as const },
                ];
                
                const hasSecondSet = immobilie && (
                  immobilie.allgemein_wasser_zaehler_2 != null || immobilie.allgemein_strom_zaehler_2 != null || immobilie.allgemein_gas_zaehler_2 != null ||
                  immobilie.allgemein_wasser_stand_2 || immobilie.allgemein_strom_stand_2 || immobilie.allgemein_gas_stand_2
                );
                
                const renderMeterRow = (meters: Array<{ key: string; label: string; icon: any; zaehlerField: string; standField: string; datumField: string }>, title?: string) => (
                  <>
                    {title && <p className="text-xs font-semibold text-muted-foreground mb-2">{title}</p>}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {meters.map(({ key, label, icon: Icon, zaehlerField, standField, datumField }) => {
                        const zaehlerVal = (immobilie as any)?.[zaehlerField] || '';
                        const standVal = (immobilie as any)?.[standField];
                        const datumVal = (immobilie as any)?.[datumField] || '';
                        const isEditing = editingMeter === key;
                        
                        return (
                          <div key={key} className="flex items-center gap-2 bg-background rounded-lg p-2 border border-border/50">
                            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                            {isEditing ? (
                              <div className="flex-1 flex flex-col gap-1">
                                <Input
                                  placeholder="Zählernr."
                                  defaultValue={meterValues[`${key}_zaehler`] ?? zaehlerVal}
                                  onChange={(e) => setMeterValues(prev => ({ ...prev, [`${key}_zaehler`]: e.target.value }))}
                                  className="h-7 text-xs"
                                />
                                <div className="flex gap-1">
                                  <Input
                                    type="number"
                                    placeholder="Stand"
                                    defaultValue={meterValues[`${key}_stand`] ?? (standVal ?? '')}
                                    // Neuer Stand → Datum auf heute, solange noch das alte im Feld steht
                                    // (28.10.2026, wie in der Zählerverwaltung)
                                    onChange={(e) => {
                                      const stand = e.target.value;
                                      setMeterValues(prev => standImEntwurf(prev, key, stand, { stand: String(standVal ?? ''), datum: datumVal }, format(new Date(), 'yyyy-MM-dd')));
                                    }}
                                    className="h-7 text-xs flex-1"
                                  />
                                  <Input
                                    type="date"
                                    value={meterValues[`${key}_datum`] ?? datumVal}
                                    onChange={(e) => setMeterValues(prev => ({ ...prev, [`${key}_datum`]: e.target.value }))}
                                    className="h-7 text-xs flex-1"
                                  />
                                </div>
                                <div className="flex gap-1 justify-end">
                                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={async () => {
                                    const zVal = meterValues[`${key}_zaehler`] ?? zaehlerVal;
                                    const sVal = meterValues[`${key}_stand`] ?? String(standVal ?? '');
                                    const dVal = meterValues[`${key}_datum`] ?? datumVal;
                                    const updates: Record<string, unknown> = {
                                      [zaehlerField]: zVal || null,
                                      [standField]: sVal ? parseFloat(sVal) : null,
                                      [datumField]: dVal || null,
                                    };
                                    const { error } = await supabase.from('immobilien').update(updates).eq('id', immobilieId);
                                    if (error) {
                                      toast.error('Fehler beim Speichern');
                                    } else {
                                      queryClient.invalidateQueries({ queryKey: ['immobilie', immobilieId] });
                                      const standNum = updates[standField] as number | null;
                                      // Historie nur bei geändertem Stand, wie in der Zählerverwaltung. Bis zum
                                      // 28.10.2026 entstand bei jedem Speichern eine Zeile, auch wenn nur die
                                      // Zählernummer korrigiert wurde — eine Ablesung, die es nie gab.
                                      const standAlt = standVal == null || standVal === '' ? null : Number(standVal);
                                      let historieOk = true;
                                      if (standNum != null && standNum !== standAlt) {
                                        const { error: historieFehler } = await supabase.from('zaehlerstand_historie').insert({
                                          immobilie_id: immobilieId,
                                          zaehler_typ: key,
                                          zaehler_nummer: (updates[zaehlerField] as string | null) ?? null,
                                          stand: standNum,
                                          datum: (updates[datumField] as string | null) ?? format(new Date(), 'yyyy-MM-dd'),
                                          quelle: 'manuell',
                                        });
                                        // Fehler wurde bis zum 28.10.2026 verschluckt (Muster: useMietvertragMutations)
                                        historieOk = !historieFehler;
                                        queryClient.invalidateQueries({ queryKey: ['zaehlerstand-historie'] });
                                      }
                                      if (historieOk) toast.success('Gespeichert');
                                      else toast.error('Gespeichert, Historie unvollständig', { description: 'Der Zählerstand ist gespeichert, die Zählerhistorie konnte aber nicht ergänzt werden.' });
                                    }
                                    setEditingMeter(null);
                                  }}>
                                    <Check className="h-3 w-3 text-green-600" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditingMeter(null)}>
                                    <X className="h-3 w-3 text-destructive" />
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex-1 min-w-0 cursor-pointer group" onClick={() => {
                                setMeterValues({
                                  [`${key}_zaehler`]: zaehlerVal,
                                  [`${key}_stand`]: String(standVal ?? ''),
                                  [`${key}_datum`]: datumVal,
                                });
                                setEditingMeter(key);
                              }}>
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-medium text-foreground">{label}</span>
                                  <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <p className="text-xs text-muted-foreground truncate">
                                  {zaehlerVal ? `Nr. ${zaehlerVal}` : 'Kein Zähler'} 
                                  {standVal != null ? ` · ${standVal}` : ''}
                                  {datumVal ? ` · ${new Date(datumVal).toLocaleDateString('de-DE')}` : ''}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
                
                return (
                  <div className="bg-muted/30 rounded-lg p-3 border border-border/30">
                    <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                      <Info className="h-4 w-4 text-muted-foreground" />
                      Hausanschlusszähler
                    </h4>
                    {renderMeterRow(meterTypes)}
                    {hasSecondSet && (
                      <div className="mt-3">
                        {renderMeterRow(meterTypes2, 'Hausanschlusszähler 2')}
                      </div>
                    )}
                    {immobilie?.baujahr && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>Baujahr: <strong className="text-foreground">{immobilie.baujahr}</strong></span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
        </div>

        {/* Tabs für Einheiten, Dokumente und Zahlungen */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="einheiten" className="text-xs sm:text-sm">Einheiten</TabsTrigger>
            <TabsTrigger value="dokumente" className="text-xs sm:text-sm">Dokumente</TabsTrigger>
            <TabsTrigger value="versicherungen" className="text-xs sm:text-sm">
              <span className="hidden sm:inline">Versicherungen</span>
              <span className="sm:hidden">Versich.</span>
            </TabsTrigger>
            <TabsTrigger value="zahlungen" className="text-xs sm:text-sm">
              <span className="hidden sm:inline">Nebenkosten</span>
              <span className="sm:hidden">NK</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="einheiten">
            {/* Mieter-Suche */}
            <div className="mb-4 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                placeholder="Mieter suchen (Name, Einheit, Etage)…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {(() => {
                const searchLower = searchTerm.trim().toLowerCase();
                const filtered = searchLower
                  ? einheiten?.filter(einheit => {
                      if (
                        einheit.nummer?.toLowerCase().includes(searchLower) ||
                        einheit.etage?.toLowerCase().includes(searchLower) ||
                        einheit.einheitentyp?.toLowerCase().includes(searchLower)
                      ) return true;
                      const vertraegeForEinheit = mietvertraege?.filter(v => v.einheit_id === einheit.id) || [];
                      return vertraegeForEinheit.some(v =>
                        v.mieter?.some(m =>
                          `${m.vorname} ${m.nachname}`.toLowerCase().includes(searchLower)
                        )
                      );
                    })
                  : einheiten;
                return filtered;
              })()?.map((einheit, index) => {
                // Find all rental contracts for this unit
                const vertraegeForEinheit = mietvertraege?.filter(v => v.einheit_id === einheit.id) || [];
                
                // Default to the most current contract
                let vertrag = getCurrentContract(vertraegeForEinheit);
                
                // If a specific contract is requested (e.g., via search), prefer that one
                if (openMietvertragId) {
                  const targeted = vertraegeForEinheit.find(v => v.id === openMietvertragId);
                  if (targeted) {
                    vertrag = targeted;
                  }
                }
                
                return (
                  <div 
                    key={einheit.id} 
                    ref={el => einheitRefs.current[einheit.id] = el} 
                    className="transition-transform duration-300"
                  >
                    <EinheitCard 
                      einheit={einheit} 
                      vertrag={vertrag} 
                      immobilie={immobilie} 
                      openMietvertragId={openMietvertragId}
                      einheitIndex={index + 1}
                      onContractModalClose={onContractModalClose}
                    />
                  </div>
                );
              })}
            </div>
            
            {(!einheiten || einheiten.length === 0) && (
              <div className="text-center py-12">
                <div className="glass-card p-8 max-w-md mx-auto rounded-2xl">
                  <p className="text-gray-500">
                    Keine Einheiten für diese Immobilie gefunden
                  </p>
                </div>
              </div>
            )}
            {einheiten && einheiten.length > 0 && searchTerm.trim() && (() => {
              const searchLower = searchTerm.trim().toLowerCase();
              const matchCount = einheiten.filter(einheit => {
                if (
                  einheit.nummer?.toLowerCase().includes(searchLower) ||
                  einheit.etage?.toLowerCase().includes(searchLower) ||
                  einheit.einheitentyp?.toLowerCase().includes(searchLower)
                ) return true;
                const vertraegeForEinheit = mietvertraege?.filter(v => v.einheit_id === einheit.id) || [];
                return vertraegeForEinheit.some(v =>
                  v.mieter?.some(m =>
                    `${m.vorname} ${m.nachname}`.toLowerCase().includes(searchLower)
                  )
                );
              }).length;
              return matchCount === 0 ? (
                <div className="text-center py-12">
                  <div className="glass-card p-8 max-w-md mx-auto rounded-2xl">
                    <Search className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                    <p className="text-gray-500">Kein Mieter für „{searchTerm}" gefunden</p>
                  </div>
                </div>
              ) : null;
            })()}
          </TabsContent>

          <TabsContent value="dokumente">
            <ImmobilienDocumentsTab 
              immobilieId={immobilieId}
              dokumente={immobilienDokumente || []}
            />
          </TabsContent>

          <TabsContent value="versicherungen">
            <ImmobilienVersicherungenTab immobilieId={immobilieId} />
          </TabsContent>

          <TabsContent value="zahlungen">
            <ImmobilienNebenkostenTabNew immobilieId={immobilieId} />
          </TabsContent>
        </Tabs>
      </div>
    </div>;
};