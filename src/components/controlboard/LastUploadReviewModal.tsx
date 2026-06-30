import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, AlertTriangle, FileText, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

interface LastUploadReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  upload: {
    id: string;
    dateiname: string;
    hochgeladen_am: string;
    anzahl_datensaetze: number | null;
  };
}

export function LastUploadReviewModal({ open, onOpenChange, upload }: LastUploadReviewModalProps) {
  // Fetch payments imported around the upload time
  const { data: payments, isLoading } = useQuery({
    queryKey: ['last-upload-payments', upload.id],
    queryFn: async () => {
      const uploadTime = new Date(upload.hochgeladen_am);
      // Payments were inserted before the csv_upload record, so look back ~5 minutes
      const fromTime = new Date(uploadTime.getTime() - 5 * 60 * 1000).toISOString();
      const toTime = new Date(uploadTime.getTime() + 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('zahlungen')
        .select('*')
        .gte('import_datum', fromTime)
        .lte('import_datum', toTime)
        .order('buchungsdatum', { ascending: false });

      if (error) throw error;

      // Enrich with contract/mieter info
      const contractIds = [...new Set((data || []).filter(z => z.mietvertrag_id).map(z => z.mietvertrag_id!))];
      const immobilieIds = [...new Set((data || []).filter(z => z.immobilie_id && !z.mietvertrag_id).map(z => z.immobilie_id!))];

      const contractMap = new Map<string, { mieter_name: string; immobilie_name: string }>();
      if (contractIds.length > 0) {
        const { data: contracts } = await supabase
          .from('mietvertrag')
          .select(`
            id, einheit_id,
            einheiten:einheit_id (etage, immobilien:immobilie_id (name)),
            mietvertrag_mieter (mieter:mieter_id (vorname, nachname))
          `)
          .in('id', contractIds);

        contracts?.forEach((c: any) => {
          const mieterNames = c.mietvertrag_mieter?.map((mm: any) =>
            `${mm.mieter?.vorname || ''} ${mm.mieter?.nachname || ''}`.trim()
          ).filter(Boolean).join(', ') || '';
          const immobilie = c.einheiten?.immobilien;
          contractMap.set(c.id, {
            mieter_name: mieterNames,
            immobilie_name: `${immobilie?.name || ''} ${c.einheiten?.etage || ''}`.trim(),
          });
        });
      }

      const immobilieMap = new Map<string, string>();
      if (immobilieIds.length > 0) {
        const { data: immobilien } = await supabase
          .from('immobilien')
          .select('id, name')
          .in('id', immobilieIds);
        immobilien?.forEach((i: any) => immobilieMap.set(i.id, i.name));
      }

      return (data || []).map(z => ({
        ...z,
        mieter_name: z.mietvertrag_id ? contractMap.get(z.mietvertrag_id)?.mieter_name || null : null,
        immobilie_name: z.mietvertrag_id
          ? contractMap.get(z.mietvertrag_id)?.immobilie_name || null
          : z.immobilie_id ? immobilieMap.get(z.immobilie_id) || null : null,
      }));
    },
    enabled: open,
  });

  const formatBetrag = (betrag: number) =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(betrag);

  const getKategorieBadge = (kategorie: string | null) => {
    const colors: Record<string, string> = {
      Miete: "bg-blue-100 text-blue-800 border-blue-200",
      Mietkaution: "bg-purple-100 text-purple-800 border-purple-200",
      Rücklastschrift: "bg-red-100 text-red-800 border-red-200",
      Nichtmiete: "bg-gray-100 text-gray-800 border-gray-200",
      Nebenkosten: "bg-teal-100 text-teal-800 border-teal-200",
      Ignorieren: "bg-gray-100 text-gray-500 border-gray-200",
    };
    if (!kategorie) return <Badge variant="outline">Keine</Badge>;
    return <Badge className={colors[kategorie] || "bg-gray-100"}>{kategorie}</Badge>;
  };

  const zugeordnet = payments?.filter(p => p.mietvertrag_id || p.immobilie_id).length || 0;
  const nichtZugeordnet = payments?.filter(p => !p.mietvertrag_id && !p.immobilie_id).length || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] w-[1200px] h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileText className="h-5 w-5 text-primary" />
            Upload-Ergebnis: {upload.dateiname}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Hochgeladen am {format(new Date(upload.hochgeladen_am), 'dd.MM.yyyy HH:mm')}
            {upload.anzahl_datensaetze && ` • ${upload.anzahl_datensaetze} Datensätze`}
          </p>
        </DialogHeader>

        {/* Stats */}
        {payments && (
          <div className="grid grid-cols-3 gap-2 py-2 border-b flex-shrink-0">
            <div className="bg-muted/50 rounded-lg p-2 text-center">
              <div className="text-xl font-bold">{payments.length}</div>
              <div className="text-xs text-muted-foreground">Gesamt</div>
            </div>
            <div className="bg-green-50 rounded-lg p-2 text-center">
              <div className="text-xl font-bold text-green-700">{zugeordnet}</div>
              <div className="text-xs text-green-600">Zugeordnet</div>
            </div>
            <div className="bg-amber-50 rounded-lg p-2 text-center">
              <div className="text-xl font-bold text-amber-700">{nichtZugeordnet}</div>
              <div className="text-xs text-amber-600">Nicht zugeordnet</div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : payments && payments.length > 0 ? (
            <ScrollArea className="h-full">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-[40px]">Status</TableHead>
                    <TableHead className="w-[90px]">Datum</TableHead>
                    <TableHead className="text-right w-[100px]">Betrag</TableHead>
                    <TableHead className="w-[150px]">Empfänger/Absender</TableHead>
                    <TableHead className="min-w-[200px]">Verwendungszweck</TableHead>
                    <TableHead className="w-[100px]">Kategorie</TableHead>
                    <TableHead className="w-[180px]">Mieter</TableHead>
                    <TableHead className="w-[150px]">Immobilie</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => (
                    <TableRow
                      key={payment.id}
                      className={!payment.mietvertrag_id && !payment.immobilie_id && (payment.kategorie === 'Miete' || payment.kategorie === 'Betriebskostenabrechnung') ? "bg-amber-50/50" : ""}
                    >
                      <TableCell className="py-2">
                        {payment.mietvertrag_id || payment.immobilie_id ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2 text-sm">
                        {format(new Date(payment.buchungsdatum), 'dd.MM.yy')}
                      </TableCell>
                      <TableCell className={`text-right py-2 font-medium ${payment.betrag < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatBetrag(payment.betrag)}
                      </TableCell>
                      <TableCell className="py-2 text-sm truncate max-w-[150px]">
                        {payment.empfaengername || '–'}
                      </TableCell>
                      <TableCell className="py-2 text-sm truncate max-w-[200px]" title={payment.verwendungszweck || ''}>
                        {payment.verwendungszweck || '–'}
                      </TableCell>
                      <TableCell className="py-2">
                        {getKategorieBadge(payment.kategorie)}
                      </TableCell>
                      <TableCell className="py-2 text-sm">
                        {payment.mieter_name || '–'}
                      </TableCell>
                      <TableCell className="py-2 text-sm truncate max-w-[150px]">
                        {payment.immobilie_name || '–'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Keine Zahlungen für diesen Upload gefunden.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
