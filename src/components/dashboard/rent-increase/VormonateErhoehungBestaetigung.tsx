import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { MonatVorErhoehung } from "@/utils/monateVorErhoehung";
import { monatText } from "@/utils/rueckstandSeit";

interface VormonateErhoehungBestaetigungProps {
  open: boolean;
  monate: MonatVorErhoehung[];
  /** Erster Monat mit der Miete der letzten Erhöhung (JJJJ-MM) */
  erhoehungAb: string | null;
  onAnpassen: () => void;
  onUnveraendert: () => void;
  onAbbrechen: () => void;
}

const euroText = (betrag: number) => `${betrag.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/**
 * Hinweis, wenn eine Änderung von Mietbeginn oder -ende Monate vor der letzten Mieterhöhung trifft (02.11.2026, Kunde:
 * „kurz hinweisen und dem User die Wahl lassen“): Dort steht noch die frühere Miete. Anpassen rechnet sie anteilig auf
 * die neue Laufzeit um, unverändert lässt sie stehen.
 */
export function VormonateErhoehungBestaetigung({ open, monate, erhoehungAb, onAnpassen, onUnveraendert, onAbbrechen }: VormonateErhoehungBestaetigungProps) {
  return (
    <AlertDialog open={open} onOpenChange={(offen) => { if (!offen) onAbbrechen(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Monate vor der Mieterhöhung</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                Die geänderte Laufzeit betrifft {monate.length === 1 ? 'einen Monat' : `${monate.length} Monate`} vor der
                letzten Mieterhöhung{erhoehungAb ? ` (gültig ab ${monatText(erhoehungAb)})` : ''}. Dort steht noch die
                frühere Miete.
              </p>
              <ul className="divide-y divide-border border-y border-border">
                {monate.map((m) => (
                  <li key={m.monat} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="text-foreground">{monatText(m.monat)}</span>
                    <span className="tabular-nums">
                      {m.bisher === null ? 'neu' : euroText(m.bisher)}
                      {' → '}
                      <span className="text-foreground">{m.neu === null ? 'entfällt' : euroText(m.neu)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p>
                <strong className="text-foreground">Anpassen:</strong> Die Monatsmieten werden anteilig auf die neue
                Laufzeit umgerechnet, wie oben gezeigt. <strong className="text-foreground">Unverändert lassen:</strong>{' '}
                Diese Monate bleiben, wie sie sind; Monate ab der Erhöhung werden trotzdem angepasst.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={(e) => { e.stopPropagation(); onAbbrechen(); }}>Abbrechen</AlertDialogCancel>
          <Button variant="outline" onClick={(e) => { e.stopPropagation(); onUnveraendert(); }}>Unverändert lassen</Button>
          <AlertDialogAction onClick={(e) => { e.stopPropagation(); onAnpassen(); }}>Anpassen</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
