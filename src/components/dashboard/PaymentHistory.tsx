
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Euro, CheckCircle, XCircle, Clock, Send, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MahnstufeIndicator } from "./MahnstufeIndicator";
import { MahnungVorschauModal } from "./MahnungVorschauModal";
import { useToast } from "@/hooks/use-toast";

interface PaymentHistoryProps {
  mietvertragId: string;
  currentMahnstufe?: number;
}

export const PaymentHistory = ({ mietvertragId, currentMahnstufe = 0 }: PaymentHistoryProps) => {
  const [isSendingMahnung, setIsSendingMahnung] = useState(false);
  const [showMahnungModal, setShowMahnungModal] = useState(false);
  const { toast } = useToast();

  // Lade Mietforderungen
  const { data: forderungen, isLoading: forderungenLoading, refetch: refetchForderungen } = useQuery({
    queryKey: ['mietforderungen', mietvertragId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mietforderungen')
        .select('*')
        .eq('mietvertrag_id', mietvertragId)
        .order('sollmonat', { ascending: false });
      
      if (error) throw error;
      return data;
    }
  });

  // Lade Zahlungen für Abgleich
  const { data: zahlungen, refetch: refetchZahlungen } = useQuery({
    queryKey: ['zahlungen', mietvertragId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zahlungen')
        .select('*')
        .eq('mietvertrag_id', mietvertragId)
        .order('buchungsdatum', { ascending: false });
      
      if (error) throw error;
      return data;
    }
  });

  // Lade Mietvertrag-Details inkl. Mieter + Immobilie für Mahnung-Versand
  const { data: vertrag, refetch: refetchVertrag } = useQuery({
    queryKey: ['mietvertrag-payment-detail', mietvertragId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mietvertrag')
        .select(`
          *,
          einheiten(
            id,
            immobilien(id, name, adresse)
          ),
          mietvertrag_mieter(
            mieter(id, vorname, nachname, hauptmail, telnr)
          )
        `)
        .eq('id', mietvertragId)
        .single();

      if (error) throw error;
      return data;
    }
  });

  // Prüfe Zahlungsstatus für jede Forderung
  const getPaymentStatus = (forderung: any) => {
    if (!zahlungen) return { paid: false, paymentDate: null, isLate: false };
    
    // sollmonat ist DATE ('YYYY-MM-DD'), normalisieren auf 'YYYY-MM' für zugeordneter_monat-Vergleich
    const sollMonat = forderung.sollmonat?.slice(0, 7); // z.B. "2025-10"
    const fälligkeitsDatum = new Date(sollMonat + '-08'); // 8. des Monats
    
    const isBkaForderung = forderung.typ === 'BKA';
    const abrechnungsjahr = sollMonat?.slice(0, 4); // z.B. "2024"

    // BKA-Forderungen: Matching gegen BKA-Zahlungseingänge im selben Abrechnungsjahr
    if (isBkaForderung) {
      const matchingBka = zahlungen.find(z => {
        if (z.kategorie !== 'Betriebskostenabrechnung') return false;
        const zahlungsJahr = (z.zugeordneter_monat || z.buchungsdatum)?.slice(0, 4);
        return zahlungsJahr === abrechnungsjahr;
      });
      if (matchingBka) {
        return { paid: true, paymentDate: matchingBka.buchungsdatum, isLate: false };
      }
      return { paid: false, paymentDate: null, isLate: fälligkeitsDatum < new Date() };
    }

    // Primär: Match über zugeordneter_monat (zuverlässigste Methode)
    const matchingZahlung = zahlungen.find(z => {
      if (z.zugeordneter_monat === sollMonat && z.kategorie === 'Miete') {
        return true;
      }
      return false;
    });

    // Fallback: Betrag + Datumstoleranz wenn kein zugeordneter_monat passt
    const fallbackZahlung = !matchingZahlung ? zahlungen.find(z => {
      if (z.kategorie !== 'Miete') return false;
      if (z.zugeordneter_monat) return false; // bereits geprüft
      const zahlungsDatum = new Date(z.buchungsdatum);
      const toleranzStart = new Date(fälligkeitsDatum);
      toleranzStart.setDate(toleranzStart.getDate() - 14);
      const toleranzEnde = new Date(fälligkeitsDatum);
      toleranzEnde.setDate(toleranzEnde.getDate() + 14);
      return zahlungsDatum >= toleranzStart &&
             zahlungsDatum <= toleranzEnde &&
             Math.abs(z.betrag - forderung.sollbetrag) <= 50;
    }) : null;

    const gefundeneZahlung = matchingZahlung || fallbackZahlung;

    if (gefundeneZahlung) {
      const zahlungsDatum = new Date(gefundeneZahlung.buchungsdatum);
      const isLate = zahlungsDatum > fälligkeitsDatum;
      return { paid: true, paymentDate: gefundeneZahlung.buchungsdatum, isLate };
    }

    return { paid: false, paymentDate: null, isLate: fälligkeitsDatum < new Date() };
  };

  const handleSendMahnung = async (pdfPath: string) => {
    if (!vertrag) return;
    setIsSendingMahnung(true);
    try {
      const offeneForderungen = forderungen?.filter(f => !getPaymentStatus(f).paid) || [];
      const aktuelleMahnstufe = (vertrag as any).mahnstufe || currentMahnstufe;
      const neueMahnstufe = Math.min(aktuelleMahnstufe + 1, 3);

      const mieter = (vertrag as any).mietvertrag_mieter?.[0]?.mieter;
      const immobilie = (vertrag as any).einheiten?.immobilien;
      const recipientEmail: string | undefined = mieter?.hauptmail;

      if (!recipientEmail) {
        toast({
          title: "Kein E-Mail-Versand",
          description: "Keine E-Mail-Adresse für diesen Mieter hinterlegt.",
          variant: "destructive",
        });
        return;
      }

      const gesamtbetrag = offeneForderungen.reduce((sum, f) => sum + (Number(f.sollbetrag) || 0), 0);

      const { error: sendError } = await supabase.functions.invoke('send-mahnung', {
        body: {
          recipientEmail,
          recipientName: `${mieter.vorname} ${mieter.nachname || ''}`.trim(),
          mahnstufe: neueMahnstufe,
          gesamtbetrag,
          rueckstandBetrag: gesamtbetrag,
          mahngebuehren: 0,
          verzugszinsen: 0,
          zusaetzlicheKosten: 0,
          zahlungsfristTage: 14,
          immobilieName: immobilie?.name || '',
          immobilieAdresse: immobilie?.adresse || '',
          pdfPath,
          mietvertragId,
          forderungen: offeneForderungen.map(f => ({ sollmonat: f.sollmonat, sollbetrag: f.sollbetrag }))
        }
      });
      if (sendError) throw sendError;

      toast({
        title: "Mahnung versendet",
        description: `Mahnung Stufe ${neueMahnstufe} wurde an ${recipientEmail} versendet.`,
      });

      setShowMahnungModal(false);
      await Promise.all([refetchForderungen(), refetchZahlungen(), refetchVertrag()]);
    } catch (error: unknown) {
      toast({
        title: "Fehler beim Versenden",
        description: error instanceof Error ? error.message : "Mahnung konnte nicht versendet werden.",
        variant: "destructive",
      });
    } finally {
      setIsSendingMahnung(false);
    }
  };

  if (forderungenLoading || !forderungen) {
    return (
      <Card className="elegant-card border-0 shadow-lg rounded-2xl overflow-hidden">
        <CardContent className="p-8">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (forderungen.length === 0) {
    return (
      <Card className="elegant-card border-0 shadow-lg rounded-2xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-muted/30 to-muted/10 border-b">
          <CardTitle className="flex items-center space-x-3">
            <div className="p-2 bg-muted rounded-lg">
              <Euro className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <span className="text-xl font-semibold">Zahlungshistorie</span>
              <p className="text-sm text-muted-foreground font-normal mt-1">Übersicht der Zahlungseingänge</p>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-8">
          <p className="text-muted-foreground text-center">Keine Zahlungshistorie verfügbar</p>
        </CardContent>
      </Card>
    );
  }

  const currentMahnstufeFromDB = vertrag?.mahnstufe || currentMahnstufe;

  return (
    <Card className="elegant-card border-0 shadow-lg rounded-2xl overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-muted/30 to-muted/10 border-b">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-accent/20 rounded-lg">
              <Euro className="h-5 w-5 text-accent-foreground" />
            </div>
            <div>
              <span className="text-xl font-semibold">Zahlungshistorie & Mahnstufen</span>
              <p className="text-sm text-muted-foreground font-normal mt-1">
                Die Mahnstufe steigt ausschließlich beim tatsächlichen Mahnungsversand
              </p>
            </div>
          </div>
          
        </CardTitle>

        {/* Mahnstufen-Bereich - prominent angezeigt */}
        {currentMahnstufeFromDB > 0 && (
          <div className="mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                <div>
                  <p className="font-semibold text-destructive">Mahnstufe {currentMahnstufeFromDB} aktiv</p>
                  <div className="flex items-center space-x-2 mt-1">
                    <MahnstufeIndicator stufe={currentMahnstufeFromDB} />
                    <span className="text-sm text-muted-foreground">
                      {vertrag?.letzte_mahnung_am && `Letzte Mahnung: ${new Date(vertrag.letzte_mahnung_am).toLocaleDateString('de-DE')}`}
                    </span>
                  </div>
                </div>
              </div>
              <Button
                onClick={() => setShowMahnungModal(true)}
                disabled={isSendingMahnung}
                size="sm"
                className="bg-destructive hover:bg-destructive/90"
              >
                <Send className="h-4 w-4 mr-2" />
                Mahnung verschicken
              </Button>
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className="p-8">
        <div className="space-y-4">
          {forderungen.map((forderung) => {
            const status = getPaymentStatus(forderung);
            
            return (
              <div key={forderung.id} className="p-6 bg-gradient-to-r from-card to-muted/20 rounded-xl border hover:shadow-md transition-all duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className={`p-3 rounded-full ${
                      status.paid 
                        ? status.isLate 
                          ? 'bg-orange-100 text-orange-600' 
                          : 'bg-green-100 text-green-600'
                        : 'bg-red-100 text-red-600'
                    }`}>
                      {status.paid ? (
                        <CheckCircle className="h-6 w-6" />
                      ) : (
                        <XCircle className="h-6 w-6" />
                      )}
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold mb-1">
                        {new Date(forderung.sollmonat).toLocaleDateString('de-DE', {
                          month: 'long', 
                          year: 'numeric' 
                        })}
                      </h4>
                      <div className="flex items-center space-x-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {status.paid 
                            ? `Bezahlt am ${new Date(status.paymentDate!).toLocaleDateString('de-DE')}${status.isLate ? ' (verspätet)' : ''}`
                            : 'Noch ausstehend'
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-right space-y-2">
                    <p className="text-2xl font-bold">
                      {forderung.sollbetrag.toLocaleString()}€
                    </p>
                    <Badge 
                      variant={status.paid ? (status.isLate ? "secondary" : "default") : "destructive"}
                      className={`${
                        status.paid 
                          ? status.isLate
                            ? 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                            : 'bg-green-100 text-green-800 hover:bg-green-200' 
                          : 'bg-red-100 text-red-800 hover:bg-red-200'
                      }`}
                    >
                      {status.paid ? (status.isLate ? '⚡ Verspätet' : '✓ Bezahlt') : '⚠ Offen'}
                    </Badge>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Info-Bereich */}
        <div className="mt-6 p-4 bg-muted/20 rounded-lg border">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground space-y-1">
              <p className="font-medium">Automatische Mahnstufen-Prüfung (ab 2025):</p>
              <p>• Toleranz: ±7 Tage Zahlungseingang, ±50€ Betragsdifferenz</p>
              <p>• Fälligkeit: 7. Tag des Folgemonats</p>
              <p>• Max. Mahnstufe: 3</p>
            </div>
            {currentMahnstufeFromDB === 0 && (
              <div className="text-right">
                <p className="text-sm font-medium text-green-600">
                  ✓ Alle Zahlungen pünktlich
                </p>
                <p className="text-xs text-muted-foreground">
                  Keine Mahnstufe aktiv
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
      
      {/* Mahnung Vorschau Modal */}
      <MahnungVorschauModal
        isOpen={showMahnungModal}
        onClose={() => setShowMahnungModal(false)}
        onSend={handleSendMahnung}
        mietvertragId={mietvertragId}
        vertragData={vertrag}
        mieterData={(vertrag as any)?.mietvertrag_mieter || []}
        forderungen={forderungen?.filter(f => !getPaymentStatus(f).paid) || []}
        currentMahnstufe={currentMahnstufeFromDB}
        immobilieData={(vertrag as any)?.einheiten?.immobilien || null}
        isSending={isSendingMahnung}
      />
    </Card>
  );
};
