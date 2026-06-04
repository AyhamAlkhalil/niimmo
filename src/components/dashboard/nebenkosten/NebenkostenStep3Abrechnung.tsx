import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Euro,
  Loader2,
  FileText,
  Mail,
  Home,
  Users,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Download,
  Send,
  Receipt,
  Calculator,
  Zap,
} from "lucide-react";
import { format, parseISO, differenceInDays } from "date-fns";
import { de } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  generateNebenkostenAbrechnungPdf,
  type NebenkostenAbrechnungPdfData,
  type NebenkostenKostenDetail,
} from "@/utils/nebenkostenAbrechnungPdfGenerator";
import { BETRKV_KATEGORIEN, NICHT_UMLAGEFAEHIGE_KATEGORIEN } from "./nebenkostenKategorien";

interface NebenkostenStep3AbrechnungProps {
  immobilieId: string;
  selectedYear: number;
}

interface MieterAbrechnung {
  mietvertragId: string;
  mieterName: string;
  mieterEmail: string | null;
  einheitId: string;
  einheitName: string;
  qm: number;
  anzahlPersonen: number;
  nutzungVon: Date;
  nutzungBis: Date;
  anzahlMonate: number;
  monatlicheVorauszahlung: number;
  vorauszahlungenGesamt: number;
  kostenDetails: NebenkostenKostenDetail[];
  kostenAnteilGesamt: number;
  saldo: number;
  zeitanteilFaktor: number;
}

const ALL_KATEGORIEN = [...BETRKV_KATEGORIEN, ...NICHT_UMLAGEFAEHIGE_KATEGORIEN];

function findKategorieByArtName(artName: string) {
  const normalized = artName.toLowerCase().replace(/[^a-zäöü]/g, '');
  return ALL_KATEGORIEN.find(
    k => k.name.toLowerCase().replace(/[^a-zäöü]/g, '') === normalized
  );
}

export function NebenkostenStep3Abrechnung({
  immobilieId,
  selectedYear,
}: NebenkostenStep3AbrechnungProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [loadingPdf, setLoadingPdf] = useState<Set<string>>(new Set());
  const [loadingEmail, setLoadingEmail] = useState<Set<string>>(new Set());
  const [forderungenDialogOpen, setForderungenDialogOpen] = useState(false);

  const yearStart = `${selectedYear}-01-01`;
  const yearEnd = `${selectedYear}-12-31`;
  const abrStart = parseISO(yearStart);
  const abrEnde = parseISO(yearEnd);
  const gesamtTage = differenceInDays(abrEnde, abrStart) + 1;

  // Immobilie (für Adresse im PDF)
  const { data: immobilie } = useQuery({
    queryKey: ['immobilie-abrechnung', immobilieId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('immobilien')
        .select('id, adresse, plz, ort, name')
        .eq('id', immobilieId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Einheiten
  const { data: einheiten, isLoading: einheitenLoading } = useQuery({
    queryKey: ['einheiten-step3', immobilieId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('einheiten')
        .select('id, zaehler, qm, anzahl_personen, einheitentyp')
        .eq('immobilie_id', immobilieId);
      if (error) throw error;
      return data || [];
    },
  });

  // Mietverträge mit Mietern (inkl. E-Mail)
  const { data: mietvertraege, isLoading: vertraegeLoading } = useQuery({
    queryKey: ['mietvertraege-step3', immobilieId, selectedYear],
    queryFn: async () => {
      const einheitIds = einheiten?.map(e => e.id) || [];
      if (einheitIds.length === 0) return [];

      const { data, error } = await supabase
        .from('mietvertrag')
        .select(`
          id,
          einheit_id,
          betriebskosten,
          start_datum,
          ende_datum,
          status,
          mietvertrag_mieter(
            mieter:mieter_id(id, vorname, nachname, email)
          )
        `)
        .in('einheit_id', einheitIds);

      if (error) throw error;

      return (data || []).filter(mv => {
        const start = mv.start_datum ? parseISO(mv.start_datum) : new Date(0);
        const ende = mv.ende_datum ? parseISO(mv.ende_datum) : new Date(9999, 11, 31);
        return start <= abrEnde && ende >= abrStart;
      });
    },
    enabled: !!einheiten && einheiten.length > 0,
  });

  // Kostenpositionen (nur umlagefähige, mit Nebenkostenart)
  const { data: kostenpositionen, isLoading: kostenLoading } = useQuery({
    queryKey: ['kostenpositionen-step3', immobilieId, selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kostenpositionen')
        .select('*, nebenkostenart:nebenkostenart_id(id, name, verteilerschluessel_art)')
        .eq('immobilie_id', immobilieId)
        .gte('zeitraum_von', yearStart)
        .lte('zeitraum_bis', yearEnd)
        .eq('ist_umlagefaehig', true);
      if (error) throw error;
      return data || [];
    },
  });

  // Bezugsgrößen über alle Einheiten
  const bezugsgroessen = useMemo(() => {
    if (!einheiten) return { qm: 0, personen: 0, anzahl: 0 };
    return {
      qm: einheiten.reduce((s, e) => s + (e.qm || 0), 0),
      personen: einheiten.reduce((s, e) => s + (e.anzahl_personen || 1), 0),
      anzahl: einheiten.length,
    };
  }, [einheiten]);

  // Kosten pro Kategorie-ID → { total, schluessel }
  const kostenProKategorie = useMemo(() => {
    const map = new Map<string, { total: number; schluessel: string; name: string }>();
    kostenpositionen?.forEach(kp => {
      const art = (kp as any).nebenkostenart;
      let kategorieId = 'sonstige_betriebskosten';
      let schluessel = 'qm';
      let name = 'Sonstige Betriebskosten';

      if (art) {
        const kat = findKategorieByArtName(art.name);
        if (kat) {
          kategorieId = kat.id;
          schluessel = art.verteilerschluessel_art || kat.schluessel;
          name = kat.name;
        } else {
          name = art.name;
          schluessel = art.verteilerschluessel_art || 'qm';
          kategorieId = `custom_${art.id}`;
        }
      }

      const existing = map.get(kategorieId);
      if (existing) {
        existing.total += kp.gesamtbetrag;
      } else {
        map.set(kategorieId, { total: kp.gesamtbetrag, schluessel, name });
      }
    });
    return map;
  }, [kostenpositionen]);

  // Anteil berechnen basierend auf Schlüssel
  function berechneAnteil(einheit: { qm: number | null; anzahl_personen: number | null }, schluessel: string): number {
    switch (schluessel) {
      case 'qm':
        return bezugsgroessen.qm > 0 ? (einheit.qm || 0) / bezugsgroessen.qm : 0;
      case 'personen':
        return bezugsgroessen.personen > 0 ? (einheit.anzahl_personen || 1) / bezugsgroessen.personen : 0;
      case 'gleich':
        return bezugsgroessen.anzahl > 0 ? 1 / bezugsgroessen.anzahl : 0;
      default:
        return bezugsgroessen.qm > 0 ? (einheit.qm || 0) / bezugsgroessen.qm : 0;
    }
  }

  // Abrechnungen pro Mieter berechnen
  const abrechnungen: MieterAbrechnung[] = useMemo(() => {
    if (!mietvertraege || !einheiten || !kostenpositionen) return [];

    return mietvertraege.map(mv => {
      const einheit = einheiten.find(e => e.id === mv.einheit_id);
      const mieterData = (mv.mietvertrag_mieter as any[])?.[0]?.mieter;
      const qm = einheit?.qm || 0;
      const anzahlPersonen = einheit?.anzahl_personen || 1;

      const vertragStart = mv.start_datum ? parseISO(mv.start_datum) : abrStart;
      const vertragEnde = mv.ende_datum ? parseISO(mv.ende_datum) : abrEnde;
      const overlapStart = vertragStart > abrStart ? vertragStart : abrStart;
      const overlapEnde = vertragEnde < abrEnde ? vertragEnde : abrEnde;

      const belegteTage = Math.max(0, differenceInDays(overlapEnde, overlapStart) + 1);
      const zeitanteilFaktor = belegteTage / gesamtTage;

      // Monate berechnen (für Vorauszahlungen)
      const anzahlMonate = Math.max(1,
        (overlapEnde.getFullYear() - overlapStart.getFullYear()) * 12 +
        (overlapEnde.getMonth() - overlapStart.getMonth()) + 1
      );

      const monatlicheVorauszahlung = mv.betriebskosten || 0;
      const vorauszahlungenGesamt = monatlicheVorauszahlung * anzahlMonate;

      // Kostenanteile pro Kategorie
      const kostenDetails: NebenkostenKostenDetail[] = [];
      let kostenAnteilGesamt = 0;

      kostenProKategorie.forEach((entry, kategorieId) => {
        const basisAnteil = berechneAnteil({ qm, anzahl_personen: anzahlPersonen }, entry.schluessel);
        const effektiverAnteil = basisAnteil * zeitanteilFaktor;
        const anteilBetrag = entry.total * effektiverAnteil;
        kostenAnteilGesamt += anteilBetrag;

        kostenDetails.push({
          kategorieName: entry.name,
          gesamtKosten: entry.total,
          verteilerschluessel: entry.schluessel,
          anteilProzent: effektiverAnteil * 100,
          anteilBetrag,
        });
      });

      const saldo = kostenAnteilGesamt - vorauszahlungenGesamt;

      const einheitName = einheit?.zaehler
        ? `Einheit ${einheit.zaehler}`
        : `Einheit ${(einheit?.id || '').slice(-4)}`;

      return {
        mietvertragId: mv.id,
        mieterName: mieterData
          ? `${mieterData.vorname} ${mieterData.nachname || ''}`.trim()
          : 'Unbekannter Mieter',
        mieterEmail: mieterData?.email || null,
        einheitId: mv.einheit_id,
        einheitName,
        qm,
        anzahlPersonen,
        nutzungVon: overlapStart,
        nutzungBis: overlapEnde,
        anzahlMonate,
        monatlicheVorauszahlung,
        vorauszahlungenGesamt,
        kostenDetails: kostenDetails.filter(d => d.anteilBetrag > 0.01),
        kostenAnteilGesamt,
        saldo,
        zeitanteilFaktor,
      } as MieterAbrechnung;
    });
  }, [mietvertraege, einheiten, kostenpositionen, kostenProKategorie, bezugsgroessen]);

  const immobilieAdresse = immobilie
    ? `${immobilie.adresse || ''}, ${immobilie.plz || ''} ${immobilie.ort || ''}`.trim().replace(/^,\s*/, '')
    : '';

  const gesamtNachzahlungen = abrechnungen.filter(a => a.saldo > 0).reduce((s, a) => s + a.saldo, 0);
  const gesamtGuthaben = abrechnungen.filter(a => a.saldo < 0).reduce((s, a) => s + Math.abs(a.saldo), 0);

  // PDF generieren und herunterladen
  async function handleDownloadPdf(abrechnung: MieterAbrechnung) {
    setLoadingPdf(prev => new Set([...prev, abrechnung.mietvertragId]));
    try {
      const pdfData: NebenkostenAbrechnungPdfData = {
        immobilieAdresse,
        einheitBezeichnung: abrechnung.einheitName,
        qm: abrechnung.qm,
        anzahlPersonen: abrechnung.anzahlPersonen,
        mieterName: abrechnung.mieterName,
        abrechnungsjahr: selectedYear,
        nutzungVon: format(abrechnung.nutzungVon, 'dd.MM.yyyy', { locale: de }),
        nutzungBis: format(abrechnung.nutzungBis, 'dd.MM.yyyy', { locale: de }),
        kostenDetails: abrechnung.kostenDetails,
        monatlicheVorauszahlung: abrechnung.monatlicheVorauszahlung,
        anzahlMonate: abrechnung.anzahlMonate,
        vorauszahlungenGesamt: abrechnung.vorauszahlungenGesamt,
        kostenAnteilGesamt: abrechnung.kostenAnteilGesamt,
        saldo: abrechnung.saldo,
        abrechnungsDatum: format(new Date(), 'dd.MM.yyyy', { locale: de }),
      };

      const blob = await generateNebenkostenAbrechnungPdf(pdfData);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Betriebskostenabrechnung_${selectedYear}_${abrechnung.mieterName.replace(/\s+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: "PDF erstellt", description: `Abrechnung für ${abrechnung.mieterName} wurde heruntergeladen.` });
    } catch (err) {
      toast({ title: "Fehler", description: "PDF konnte nicht erstellt werden.", variant: "destructive" });
    } finally {
      setLoadingPdf(prev => {
        const next = new Set(prev);
        next.delete(abrechnung.mietvertragId);
        return next;
      });
    }
  }

  // PDF als Base64 für E-Mail
  async function pdfToBase64(pdfData: NebenkostenAbrechnungPdfData): Promise<string> {
    const blob = await generateNebenkostenAbrechnungPdf(pdfData);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // E-Mail senden
  async function handleSendEmail(abrechnung: MieterAbrechnung) {
    if (!abrechnung.mieterEmail) {
      toast({ title: "Keine E-Mail", description: "Für diesen Mieter ist keine E-Mail-Adresse hinterlegt.", variant: "destructive" });
      return;
    }

    setLoadingEmail(prev => new Set([...prev, abrechnung.mietvertragId]));
    try {
      const pdfData: NebenkostenAbrechnungPdfData = {
        immobilieAdresse,
        einheitBezeichnung: abrechnung.einheitName,
        qm: abrechnung.qm,
        anzahlPersonen: abrechnung.anzahlPersonen,
        mieterName: abrechnung.mieterName,
        abrechnungsjahr: selectedYear,
        nutzungVon: format(abrechnung.nutzungVon, 'dd.MM.yyyy', { locale: de }),
        nutzungBis: format(abrechnung.nutzungBis, 'dd.MM.yyyy', { locale: de }),
        kostenDetails: abrechnung.kostenDetails,
        monatlicheVorauszahlung: abrechnung.monatlicheVorauszahlung,
        anzahlMonate: abrechnung.anzahlMonate,
        vorauszahlungenGesamt: abrechnung.vorauszahlungenGesamt,
        kostenAnteilGesamt: abrechnung.kostenAnteilGesamt,
        saldo: abrechnung.saldo,
        abrechnungsDatum: format(new Date(), 'dd.MM.yyyy', { locale: de }),
      };

      const pdfBase64 = await pdfToBase64(pdfData);

      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-nebenkostenabrechnung`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            recipientEmail: abrechnung.mieterEmail,
            recipientName: abrechnung.mieterName,
            pdfBase64,
            immobilieAdresse,
            einheitBezeichnung: abrechnung.einheitName,
            abrechnungsjahr: selectedYear,
            saldo: abrechnung.saldo,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'E-Mail konnte nicht gesendet werden');
      }

      toast({ title: "E-Mail gesendet", description: `Abrechnung wurde an ${abrechnung.mieterEmail} gesendet.` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast({ title: "Fehler beim Senden", description: message, variant: "destructive" });
    } finally {
      setLoadingEmail(prev => {
        const next = new Set(prev);
        next.delete(abrechnung.mietvertragId);
        return next;
      });
    }
  }

  // Nachzahlungs-Forderungen anlegen
  const createForderungenMutation = useMutation({
    mutationFn: async () => {
      const nachzahlungen = abrechnungen.filter(a => a.saldo > 0.01);
      if (nachzahlungen.length === 0) return;

      const inserts = nachzahlungen.map(a => ({
        mietvertrag_id: a.mietvertragId,
        sollmonat: `${selectedYear}-12-01`,
        sollbetrag: Math.round(a.saldo * 100) / 100,
        ist_faellig: true,
      }));

      const { error } = await supabase.from('mietforderungen').insert(inserts);
      if (error) throw error;
      return nachzahlungen.length;
    },
    onSuccess: (count) => {
      toast({
        title: "Forderungen angelegt",
        description: `${count} Nachzahlungs-Forderung(en) wurden erstellt.`,
      });
      queryClient.invalidateQueries({ queryKey: ['mietforderungen'] });
      setForderungenDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    },
  });

  const isLoading = einheitenLoading || vertraegeLoading || kostenLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!kostenpositionen || kostenpositionen.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-16">
          <Calculator className="h-14 w-14 mx-auto mb-4 text-muted-foreground opacity-30" />
          <p className="text-lg font-medium">Keine Kostenpositionen vorhanden</p>
          <p className="text-sm text-muted-foreground mt-2">
            Ordnen Sie zuerst in Schritt 1 Zahlungen den Kategorien zu, bevor Sie die Abrechnung erstellen.
          </p>
        </CardContent>
      </Card>
    );
  }

  const nachzahlungAbrechnungen = abrechnungen.filter(a => a.saldo > 0.01);
  const guthabenAbrechnungen = abrechnungen.filter(a => a.saldo <= 0);

  return (
    <div className="space-y-6">
      {/* Übersichts-Header */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Card className="bg-gradient-to-br from-slate-50 to-slate-100 border-slate-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-slate-200 flex items-center justify-center shrink-0">
                <Users className="h-4 w-4 text-slate-600" />
              </div>
              <div>
                <p className="text-xs text-slate-600 font-medium">Mietverträge</p>
                <p className="text-xl font-bold text-slate-800">{abrechnungen.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-emerald-200 flex items-center justify-center shrink-0">
                <Euro className="h-4 w-4 text-emerald-700" />
              </div>
              <div>
                <p className="text-xs text-emerald-700 font-medium">Umlagefähig</p>
                <p className="text-lg font-bold text-emerald-800">
                  {Array.from(kostenProKategorie.values()).reduce((s, v) => s + v.total, 0).toFixed(0)} €
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-50 to-red-100 border-red-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-red-200 flex items-center justify-center shrink-0">
                <ArrowUp className="h-4 w-4 text-red-700" />
              </div>
              <div>
                <p className="text-xs text-red-700 font-medium">Nachzahlungen</p>
                <p className="text-lg font-bold text-red-800">
                  {nachzahlungAbrechnungen.length} × {gesamtNachzahlungen.toFixed(0)} €
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-green-200 flex items-center justify-center shrink-0">
                <ArrowDown className="h-4 w-4 text-green-700" />
              </div>
              <div>
                <p className="text-xs text-green-700 font-medium">Guthaben</p>
                <p className="text-lg font-bold text-green-800">
                  {guthabenAbrechnungen.length} × {gesamtGuthaben.toFixed(0)} €
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Aktions-Bar */}
      {nachzahlungAbrechnungen.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
                <p className="text-sm font-medium text-amber-800">
                  {nachzahlungAbrechnungen.length} Mieter haben Nachzahlungen (gesamt {gesamtNachzahlungen.toFixed(2)} €)
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-amber-400 text-amber-800 hover:bg-amber-100 gap-2 shrink-0"
                onClick={() => setForderungenDialogOpen(true)}
              >
                <Receipt className="h-4 w-4" />
                Alle als Forderungen anlegen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mieter-Abrechnungsliste */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Abrechnungen pro Mieter
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Klicken für Details — PDF herunterladen oder per E-Mail versenden
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[500px] sm:h-[calc(100vh-480px)]">
            <div className="p-4 space-y-3">
              {abrechnungen.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-30" />
                  <p className="text-lg font-medium">Keine Mietverträge im Abrechnungszeitraum</p>
                </div>
              ) : (
                abrechnungen.map(abrechnung => {
                  const isExpanded = expandedCards.has(abrechnung.mietvertragId);
                  const isNachzahlung = abrechnung.saldo > 0.01;
                  const isPdfLoading = loadingPdf.has(abrechnung.mietvertragId);
                  const isEmailLoading = loadingEmail.has(abrechnung.mietvertragId);

                  return (
                    <Collapsible
                      key={abrechnung.mietvertragId}
                      open={isExpanded}
                      onOpenChange={() => {
                        setExpandedCards(prev => {
                          const next = new Set(prev);
                          if (next.has(abrechnung.mietvertragId)) next.delete(abrechnung.mietvertragId);
                          else next.add(abrechnung.mietvertragId);
                          return next;
                        });
                      }}
                    >
                      <div className={cn(
                        "border-2 rounded-xl transition-all",
                        isNachzahlung
                          ? "border-red-200 bg-red-50/30"
                          : "border-green-200 bg-green-50/30"
                      )}>
                        {/* Header */}
                        <CollapsibleTrigger className="w-full p-4 text-left hover:bg-white/40 rounded-t-xl transition-colors">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-3">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                              )}
                              <div className={cn(
                                "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                                isNachzahlung ? "bg-red-100" : "bg-green-100"
                              )}>
                                <Home className={cn("h-4 w-4", isNachzahlung ? "text-red-600" : "text-green-600")} />
                              </div>
                              <div>
                                <p className="font-semibold">{abrechnung.mieterName}</p>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                                  <span>{abrechnung.einheitName}</span>
                                  <span>•</span>
                                  <span>{abrechnung.qm.toFixed(0)} m²</span>
                                  <span>•</span>
                                  <span>
                                    {format(abrechnung.nutzungVon, 'dd.MM.yy', { locale: de })} –{' '}
                                    {format(abrechnung.nutzungBis, 'dd.MM.yy', { locale: de })}
                                  </span>
                                  {abrechnung.zeitanteilFaktor < 0.99 && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                                      {(abrechnung.zeitanteilFaktor * 100).toFixed(0)}% Jahr
                                    </Badge>
                                  )}
                                  {!abrechnung.mieterEmail && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-300 text-amber-700">
                                      Keine E-Mail
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 ml-10 sm:ml-0">
                              <Badge
                                variant={isNachzahlung ? "destructive" : "default"}
                                className={cn("text-sm px-3 py-1", !isNachzahlung && "bg-green-600")}
                              >
                                {isNachzahlung ? '+' : ''}{abrechnung.saldo.toFixed(2)} €
                                {' '}
                                {isNachzahlung ? 'Nachzahlung' : 'Guthaben'}
                              </Badge>
                            </div>
                          </div>
                        </CollapsibleTrigger>

                        {/* Details */}
                        <CollapsibleContent>
                          <div className="px-4 pb-4 space-y-4 border-t bg-white/30">
                            {/* Kostenaufschlüsselung */}
                            <div className="pt-4 space-y-1">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                Kostenaufschlüsselung
                              </p>
                              {abrechnung.kostenDetails.map((detail, idx) => (
                                <div key={idx} className="flex items-center justify-between text-sm py-1.5 border-b border-dashed border-muted last:border-0">
                                  <span className="text-muted-foreground">{detail.kategorieName}</span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-muted-foreground">{detail.anteilProzent.toFixed(1)}%</span>
                                    <span className="font-medium w-20 text-right">{detail.anteilBetrag.toFixed(2)} €</span>
                                  </div>
                                </div>
                              ))}
                              <div className="flex items-center justify-between text-sm pt-2 font-semibold">
                                <span>Kosten gesamt</span>
                                <span>{abrechnung.kostenAnteilGesamt.toFixed(2)} €</span>
                              </div>
                              <div className="flex items-center justify-between text-sm text-muted-foreground">
                                <span>Vorauszahlungen ({abrechnung.anzahlMonate} × {abrechnung.monatlicheVorauszahlung.toFixed(2)} €)</span>
                                <span>– {abrechnung.vorauszahlungenGesamt.toFixed(2)} €</span>
                              </div>
                              <div className={cn(
                                "flex items-center justify-between text-base font-bold pt-2 border-t",
                                isNachzahlung ? "text-red-700" : "text-green-700"
                              )}>
                                <span>{isNachzahlung ? 'Nachzahlung' : 'Guthaben'}</span>
                                <span>{isNachzahlung ? '+' : ''}{abrechnung.saldo.toFixed(2)} €</span>
                              </div>
                            </div>

                            {/* Aktions-Buttons */}
                            <div className="flex flex-wrap gap-2 pt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-2"
                                onClick={() => handleDownloadPdf(abrechnung)}
                                disabled={isPdfLoading}
                              >
                                {isPdfLoading ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Download className="h-4 w-4" />
                                )}
                                PDF herunterladen
                              </Button>

                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-2"
                                onClick={() => handleSendEmail(abrechnung)}
                                disabled={isEmailLoading || !abrechnung.mieterEmail}
                                title={!abrechnung.mieterEmail ? 'Keine E-Mail-Adresse hinterlegt' : undefined}
                              >
                                {isEmailLoading ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Mail className="h-4 w-4" />
                                )}
                                Per E-Mail senden
                                {abrechnung.mieterEmail && (
                                  <span className="text-xs text-muted-foreground ml-1">({abrechnung.mieterEmail})</span>
                                )}
                              </Button>

                              {isNachzahlung && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50"
                                  onClick={async () => {
                                    const { error } = await supabase.from('mietforderungen').insert({
                                      mietvertrag_id: abrechnung.mietvertragId,
                                      sollmonat: `${selectedYear}-12-01`,
                                      sollbetrag: Math.round(abrechnung.saldo * 100) / 100,
                                      ist_faellig: true,
                                    });
                                    if (error) {
                                      toast({ title: "Fehler", description: error.message, variant: "destructive" });
                                    } else {
                                      toast({ title: "Forderung angelegt", description: `Nachzahlung von ${abrechnung.saldo.toFixed(2)} € erstellt.` });
                                      queryClient.invalidateQueries({ queryKey: ['mietforderungen'] });
                                    }
                                  }}
                                >
                                  <Receipt className="h-4 w-4" />
                                  Als Forderung anlegen
                                </Button>
                              )}
                            </div>
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Alle-Forderungen-Dialog */}
      <AlertDialog open={forderungenDialogOpen} onOpenChange={setForderungenDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alle Nachzahlungen als Forderungen anlegen?</AlertDialogTitle>
            <AlertDialogDescription>
              Es werden {nachzahlungAbrechnungen.length} Forderung(en) mit einem Gesamtbetrag von{' '}
              {gesamtNachzahlungen.toFixed(2)} € in der Mieterforderungsliste angelegt.
              Die Fälligkeitsdaten werden automatisch gesetzt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => createForderungenMutation.mutate()}
              disabled={createForderungenMutation.isPending}
            >
              {createForderungenMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Forderungen anlegen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
