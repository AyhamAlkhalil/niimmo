import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, ArrowLeft, ChevronRight, History, LogIn, LogOut, Loader2, RotateCcw, Search, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { UebergabeDialog } from "@/components/dashboard/handover/UebergabeDialog";
import { UebergabeContractList } from "@/components/dashboard/handover/UebergabeContractList";
import { cn } from "@/lib/utils";
import { alleSeiten } from "@/utils/supabaseSeiten";
import { browserAblage, entwuerfeAuflisten, entwurfLoeschen, type EntwurfEintrag } from "@/utils/uebergabeEntwurf";
import { letzteProtokolle, type ProtokollZeile } from "@/utils/uebergabeProtokolle";
import { mietsacheText } from "@/utils/uebergabeAblauf";
import { toast } from "sonner";

interface UebergabeProps {
  onBack: () => void;
}

type UebergabeType = "einzug" | "auszug" | null;

interface ContractWithDetails {
  id: string;
  status: string;
  start_datum: string | null;
  ende_datum: string | null;
  kuendigungsdatum: string | null;
  kaltmiete: number | null;
  betriebskosten: number | null;
  strom_einzug: number | null;
  gas_einzug: number | null;
  kaltwasser_einzug: number | null;
  warmwasser_einzug: number | null;
  einheit: {
    id: string;
    etage: string | null;
    zaehler: number | null;
    einheitentyp: string | null;
    qm: number | null;
    anzahl_zimmer: number | null;
    bezeichnung: string | null;
    immobilie: {
      id: string;
      name: string;
      adresse: string;
    };
  };
  mieter: Array<{
    id: string;
    vorname: string;
    nachname: string;
  }>;
}

export const Uebergabe = ({ onBack }: UebergabeProps) => {
  const [uebergabeType, setUebergabeType] = useState<UebergabeType>(null);
  const [selectedContracts, setSelectedContracts] = useState<ContractWithDetails[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: contracts, isLoading, isError, refetch } = useQuery({
    queryKey: ['uebergabe-contracts'],
    queryFn: async () => {
      // Seitenweise: PostgREST liefert still höchstens 1000 Zeilen. Fehler werfen
      // statt verschluckt zu werden — bis zum 19.10.2026 sah ein Ladefehler wie
      // eine leere Seite aus, ein Fehler bei den Mietern wie „Kein Mieter“.
      const data = await alleSeiten((von, bis, mitZaehlung) =>
        supabase
          .from('mietvertrag')
          .select(`
            id, status, start_datum, ende_datum, kuendigungsdatum,
            kaltmiete, betriebskosten, strom_einzug, gas_einzug,
            kaltwasser_einzug, warmwasser_einzug,
            einheiten!inner (
              id, etage, zaehler, einheitentyp, qm, anzahl_zimmer, bezeichnung,
              immobilien!inner ( id, name, adresse )
            )
          `, { count: mitZaehlung ? 'exact' : undefined })
          .order('start_datum', { ascending: false })
          .order('id')
          .range(von, bis)
      );
      if (data.length === 0) return [] as ContractWithDetails[];

      // In Gruppen: Alle Vertrags-IDs in einer Abfrage-URL werden mit dem
      // Bestand zu lang für die Gateways davor
      const contractIds = data.map(c => c.id);
      const allMieterData = [];
      for (let i = 0; i < contractIds.length; i += 100) {
        const gruppe = contractIds.slice(i, i + 100);
        allMieterData.push(...await alleSeiten((von, bis, mitZaehlung) =>
          supabase
            .from('mietvertrag_mieter')
            .select('mietvertrag_id, mieter:mieter_id (id, vorname, nachname)', { count: mitZaehlung ? 'exact' : undefined })
            .in('mietvertrag_id', gruppe)
            .order('mietvertrag_id')
            .order('mieter_id')
            .range(von, bis)
        ));
      }

      const mieterByContract = new Map<string, Array<{ id: string; vorname: string; nachname: string }>>();
      (allMieterData || []).forEach(entry => {
        if (!entry.mieter) return;
        const list = mieterByContract.get(entry.mietvertrag_id) || [];
        list.push(entry.mieter as any);
        mieterByContract.set(entry.mietvertrag_id, list);
      });

      return data.map(contract => ({
        ...contract,
        einheit: {
          id: contract.einheiten.id,
          etage: contract.einheiten.etage,
          zaehler: contract.einheiten.zaehler,
          einheitentyp: contract.einheiten.einheitentyp,
          qm: contract.einheiten.qm,
          anzahl_zimmer: contract.einheiten.anzahl_zimmer,
          bezeichnung: contract.einheiten.bezeichnung,
          immobilie: {
            id: contract.einheiten.immobilien.id,
            name: contract.einheiten.immobilien.name,
            adresse: contract.einheiten.immobilien.adresse,
          }
        },
        mieter: mieterByContract.get(contract.id) || []
      })) as ContractWithDetails[];
    }
  });

  // Stabil halten: Der Dialog lädt Mieter und Versorger neu, sobald sich diese
  // Werte ändern. Als frische Arrays je Render lud er bei jedem Neuzeichnen der
  // Seite neu — etwa wenn die Vertragsliste beim Zurückkehren aus der Kamera-App
  // aktualisiert wird —, und ein kurzer Netzaussetzer zeigte dann einen Ladefehler.
  const dialogVertragIds = useMemo(() => selectedContracts.map((c) => c.id), [selectedContracts]);
  const dialogVertraege = useMemo(
    () =>
      selectedContracts.map((c) => ({
        id: c.id,
        einheit: {
          id: c.einheit.id,
          nummer: c.einheit.zaehler?.toString(),
          etage: c.einheit.etage || undefined,
          mietsache: mietsacheText({
            einheitentyp: c.einheit.einheitentyp,
            etage: c.einheit.etage,
            anzahlZimmer: c.einheit.anzahl_zimmer,
            qm: c.einheit.qm,
            bezeichnung: c.einheit.bezeichnung,
          }),
          immobilie_id: c.einheit.immobilie.id,
          immobilie: { id: c.einheit.immobilie.id, name: c.einheit.immobilie.name, adresse: c.einheit.immobilie.adresse },
        },
        kuendigungsdatum: c.kuendigungsdatum || undefined,
        ende_datum: c.ende_datum || undefined,
      })),
    [selectedContracts]
  );

  // Angefangene Übergaben auf diesem Gerät. Der Entwurf liegt nur hier
  // (utils/uebergabeEntwurf.ts) — ohne diese Liste musste man sich merken, bei
  // welchem Vertrag man angefangen hatte.
  const [entwuerfe, setEntwuerfe] = useState<EntwurfEintrag[]>(() => entwuerfeAuflisten(browserAblage()));
  // Entwurf zu einem Vertrag, den es nicht mehr gibt — sonst bliebe er unlöschbar liegen
  const [entwurfEntfernen, setEntwurfEntfernen] = useState<EntwurfEintrag | null>(null);

  // Schon gespeicherte Protokolle: Ein zweites entstand bisher oft nur, weil
  // niemand sah, dass es schon eines gab. Ein Ladefehler blendet nur den Hinweis aus.
  const { data: protokolle, refetch: protokolleNeuLaden } = useQuery({
    queryKey: ['uebergabe-protokolle'],
    queryFn: async () =>
      letzteProtokolle(
        await alleSeiten<ProtokollZeile>((von, bis, mitZaehlung) =>
          supabase
            .from('dokumente')
            .select('mietvertrag_id, titel, pfad, dateityp, hochgeladen_am', { count: mitZaehlung ? 'exact' : undefined })
            .eq('kategorie', 'Übergabeprotokoll')
            .eq('geloescht', false)
            .order('id')
            .range(von, bis)
        )
      ),
  });

  const entwurfJeVertrag = useMemo(
    () =>
      new Map(
        entwuerfe
          .filter((e) => e.vertragIds.length === 1 && e.isEinzug === (uebergabeType === "einzug"))
          .map((e) => [e.vertragIds[0], e.gespeichertAm] as const)
      ),
    [entwuerfe, uebergabeType]
  );
  const protokollJeVertrag = useMemo(() => {
    const m = new Map<string, string>();
    if (!uebergabeType) return m;
    protokolle?.forEach((arten, vertragId) => {
      const am = arten[uebergabeType];
      if (am) m.set(vertragId, am);
    });
    return m;
  }, [protokolle, uebergabeType]);

  const handleContractClick = (group: any) => {
    setSelectedContracts(group.contracts);
    setShowDialog(true);
  };

  const entwurfOeffnen = (e: EntwurfEintrag) => {
    const gefunden = e.vertragIds
      .map((id) => contracts?.find((c) => c.id === id))
      .filter((c): c is ContractWithDetails => !!c);
    if (gefunden.length !== e.vertragIds.length) {
      toast.error("Der Vertrag zu diesem Entwurf wurde nicht gefunden.");
      return;
    }
    setUebergabeType(e.isEinzug ? "einzug" : "auszug");
    setSelectedContracts(gefunden);
    setShowDialog(true);
  };

  const handleDialogClose = () => {
    setShowDialog(false);
    setSelectedContracts([]);
    setEntwuerfe(entwuerfeAuflisten(browserAblage()));
  };

  const handleSuccess = () => {
    refetch();
    protokolleNeuLaden();
    handleDialogClose();
    toast.success("Übergabe erfolgreich dokumentiert");
  };

  const vertragsTitel = (ids: string[]) => {
    const vertraege = ids.map((id) => contracts?.find((c) => c.id === id)).filter((c): c is ContractWithDetails => !!c);
    if (vertraege.length === 0) return null;
    const mieter = vertraege[0].mieter.map((m) => `${m.vorname} ${m.nachname}`).join(", ") || "Kein Mieter";
    const objekt = [vertraege[0].einheit.immobilie.name, vertraege[0].einheit.etage].filter(Boolean).join(", ");
    return { mieter, objekt: vertraege.length > 1 ? `${objekt} (+${vertraege.length - 1})` : objekt };
  };

  if (!uebergabeType) {
    // Immer zeigen — auch während die Verträge laden oder wenn das scheitert. Ein
    // Entwurf mit Unterschriften und Fotos darf nicht unsichtbar werden.
    const offene = entwuerfe.map((e) => ({ eintrag: e, titel: vertragsTitel(e.vertragIds) }));
    return (
      <div className="min-h-screen modern-dashboard-bg">
        <div className="container mx-auto px-4 py-4 sm:p-6 lg:p-8">
          <div className="glass-card mb-6 rounded-xl p-4 sm:rounded-2xl sm:p-6">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={onBack}>
                <ArrowLeft className="mr-1 h-4 w-4" /> Zurück
              </Button>
              <div>
                <h1 className="font-display text-2xl leading-none text-foreground sm:text-3xl lg:text-4xl">Übergabe</h1>
                <p className="font-sans text-xs text-muted-foreground sm:text-sm">Einzug oder Auszug wählen</p>
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-4xl space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
              {([
                ["einzug", LogIn, "Einzug", "Schlüssel, Zählerstände und Zustand der Wohnung beim Einzug festhalten.", "bg-success/10 text-success"],
                ["auszug", LogOut, "Auszug", "Rückgabe der Wohnung mit Zählerständen für Abrechnung und Versorger.", "bg-warning/10 text-warning"],
              ] as const).map(([art, Symbol, titel, text, farbe]) => (
                <button
                  key={art}
                  onClick={() => setUebergabeType(art)}
                  className="glass-card group rounded-2xl p-5 text-left transition-all duration-300 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-7"
                >
                  <div className="mb-3 flex items-center gap-4">
                    <div className={cn("rounded-xl p-3 transition-transform group-hover:scale-105", farbe)}>
                      <Symbol className="h-6 w-6 sm:h-7 sm:w-7" />
                    </div>
                    <h2 className="text-xl font-bold sm:text-2xl">{titel}</h2>
                    <ChevronRight className="ml-auto h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground sm:text-base">{text}</p>
                </button>
              ))}
            </div>

            {offene.length > 0 && (
              <section className="glass-card space-y-3 rounded-2xl p-4 sm:p-6">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <History className="h-4 w-4 text-primary" />
                    Angefangen auf diesem Gerät
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">Noch nicht gespeichert — hier geht es an derselben Stelle weiter.</p>
                </div>
                {isError && !contracts && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span className="flex-1">Die Verträge zu den Entwürfen konnten nicht geladen werden.</span>
                    <Button variant="outline" size="sm" onClick={() => refetch()}>
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      Erneut laden
                    </Button>
                  </div>
                )}
                <ul className="space-y-2">
                  {offene.map(({ eintrag, titel }) => (
                    <li key={eintrag.schluessel} className="flex items-center gap-2">
                      <button
                        onClick={() => entwurfOeffnen(eintrag)}
                        disabled={!titel}
                        className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:border-border"
                      >
                        <span
                          className={cn(
                            "rounded-md px-2 py-0.5 text-xs font-medium",
                            eintrag.isEinzug ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                          )}
                        >
                          {eintrag.isEinzug ? "Einzug" : "Auszug"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {titel ? titel.mieter : isLoading ? "Vertrag wird geladen …" : isError ? "Vertrag nicht geladen" : "Vertrag nicht gefunden"}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {titel ? `${titel.objekt} · ` : ""}zuletzt {format(new Date(eintrag.gespeichertAm), "dd.MM., HH:mm", { locale: de })} Uhr
                          </span>
                        </span>
                        {titel && <span className="hidden text-sm text-primary sm:inline">Weiter</span>}
                        {titel ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : isLoading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
                      </button>
                      {!titel && contracts && (
                        <Button variant="ghost" size="icon" aria-label="Entwurf löschen" onClick={() => setEntwurfEntfernen(eintrag)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>

        <AlertDialog open={!!entwurfEntfernen} onOpenChange={(offen) => !offen && setEntwurfEntfernen(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Entwurf löschen?</AlertDialogTitle>
              <AlertDialogDescription>
                Der Vertrag zu diesem Entwurf ist nicht mehr vorhanden. Eingaben, Fotos und Unterschriften des Entwurfs werden von
                diesem Gerät gelöscht.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (entwurfEntfernen) entwurfLoeschen(browserAblage(), entwurfEntfernen.schluessel);
                  setEntwurfEntfernen(null);
                  setEntwuerfe(entwuerfeAuflisten(browserAblage()));
                }}
              >
                Löschen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div className="min-h-screen modern-dashboard-bg">
      <div className="container mx-auto px-4 py-4 sm:p-6 lg:p-8">
        <div className="glass-card mb-6 rounded-xl p-4 sm:rounded-2xl sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => { setUebergabeType(null); setSearchQuery(""); }}>
                <ArrowLeft className="mr-1 h-4 w-4" /> Zurück
              </Button>
              <div className={cn("rounded-lg p-2", uebergabeType === "einzug" ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>
                {uebergabeType === "einzug" ? <LogIn className="h-5 w-5" /> : <LogOut className="h-5 w-5" />}
              </div>
              <div>
                <h1 className="font-display text-2xl leading-none text-foreground sm:text-3xl lg:text-4xl">
                  {uebergabeType === "einzug" ? "Einzug" : "Auszug"}
                </h1>
                <p className="font-sans text-xs text-muted-foreground sm:text-sm">Mietvertrag auswählen</p>
              </div>
            </div>
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Mieter, Objekt oder Adresse suchen..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 pl-9"
              />
            </div>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Scheitert nur eine Aktualisierung, bleibt die geladene Liste stehen */}
        {!isLoading && isError && !contracts && (
          <div className="glass-card flex flex-col items-center gap-3 rounded-xl p-6 text-center sm:rounded-2xl">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <p className="text-sm font-medium">Die Mietverträge konnten nicht geladen werden.</p>
            <Button variant="outline" onClick={() => refetch()}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Erneut laden
            </Button>
          </div>
        )}

        {!isLoading && contracts && (
          <div className="glass-card rounded-xl p-4 sm:rounded-2xl sm:p-6">
            <UebergabeContractList
              contracts={contracts}
              uebergabeType={uebergabeType}
              searchQuery={searchQuery}
              onContractClick={handleContractClick}
              entwuerfe={entwurfJeVertrag}
              protokolle={protokollJeVertrag}
            />
          </div>
        )}
      </div>

      {selectedContracts.length > 0 && (
        <UebergabeDialog
          isOpen={showDialog}
          onClose={handleDialogClose}
          vertragIds={dialogVertragIds}
          contracts={dialogVertraege}
          mieterName={selectedContracts[0].mieter.map(m => `${m.vorname} ${m.nachname}`).join(", ")}
          onSuccess={handleSuccess}
          isEinzug={uebergabeType === "einzug"}
        />
      )}
    </div>
  );
};

export default Uebergabe;
