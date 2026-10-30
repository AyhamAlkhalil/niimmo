import { useEffect, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { erhoehungRueckwirkend, vereinbarungGiltAbOptionen, vereinbarungGiltAbVorgabe } from "@/utils/mieterhoehungRegeln";

interface MietaenderungBestaetigungProps {
  open: boolean;
  alteKaltmiete: number | null;
  neueKaltmiete: number | null;
  onKorrektur: () => void;
  /** Mieterhöhung als Vorgang ab diesem Monatsersten (mieterhoehungAlsVorgangAnlegen) */
  onErhoehung: (giltAb: string) => void;
  onAbbrechen: () => void;
}

const tagText = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const euroText = (betrag: number) => betrag.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Geänderte Kaltmiete bestätigen (29.10.2026, Kunde: „Eine Mieterhöhung ist ein Vorgang“): Korrektur (gilt sofort)
 * oder Mieterhöhung ab einem gewählten Monatsersten — rückwirkend zum 1. des laufenden Monats mit deutlichem Hinweis,
 * dann gilt sie sofort. Für Vertragsbearbeitung und Mietübersicht gleich.
 */
export function MietaenderungBestaetigung({ open, alteKaltmiete, neueKaltmiete, onKorrektur, onErhoehung, onAbbrechen }: MietaenderungBestaetigungProps) {
  const [giltAb, setGiltAb] = useState(() => vereinbarungGiltAbVorgabe());
  useEffect(() => {
    if (open) setGiltAb(vereinbarungGiltAbVorgabe());
  }, [open]);
  const erhoehung = alteKaltmiete !== null && neueKaltmiete !== null && neueKaltmiete > alteKaltmiete;

  return (
    <AlertDialog open={open} onOpenChange={(offen) => { if (!offen) onAbbrechen(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mietänderung bestätigen</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                Sie haben die Kaltmiete
                {alteKaltmiete !== null && neueKaltmiete !== null ? ` von ${euroText(alteKaltmiete)} € auf ${euroText(neueKaltmiete)} €` : ''} geändert.
              </p>
              <p><strong className="text-foreground">Korrektur:</strong> Die Miete war falsch erfasst. Die Änderung gilt sofort, auch für den laufenden Monat.</p>
              {erhoehung ? (
                <div className="space-y-2">
                  <p><strong className="text-foreground">Mieterhöhung:</strong> Die Erhöhung wird als Vorgang gespeichert und gilt ab dem gewählten Monat.</p>
                  <div>
                    <Label className="text-xs">Gilt ab</Label>
                    <Select value={giltAb} onValueChange={setGiltAb}>
                      <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {vereinbarungGiltAbOptionen().map((tag) => (
                          <SelectItem key={tag} value={tag}>
                            {tagText(tag)}{erhoehungRueckwirkend(tag) ? ' (rückwirkend)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {erhoehungRueckwirkend(giltAb) ? (
                    <p role="alert" className="border-l-2 border-destructive pl-3 text-destructive">
                      Rückwirkend zum {tagText(giltAb)}: Die neue Miete gilt sofort, auch für den laufenden Monat. Die schon
                      angelegte Monatsmiete wird angehoben, der Mieter schuldet die Differenz.
                    </p>
                  ) : (
                    <p>Bis zum {tagText(giltAb)} bleibt die bisherige Miete, dann stellt die Anwendung automatisch um.</p>
                  )}
                  <p className="text-xs">Das Erhöhungsverlangen mit Schreiben und E-Mail erstellen Sie unter „Mögliche Mieterhöhungen“.</p>
                </div>
              ) : (
                <p>Die Kaltmiete sinkt oder bleibt gleich, das ist eine Korrektur.</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={(e) => { e.stopPropagation(); onAbbrechen(); }}>Abbrechen</AlertDialogCancel>
          <Button variant="outline" onClick={(e) => { e.stopPropagation(); onKorrektur(); }}>Nur Korrektur</Button>
          {erhoehung && (
            <AlertDialogAction onClick={(e) => { e.stopPropagation(); onErhoehung(giltAb); }}>
              Mieterhöhung ab {tagText(giltAb)}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
