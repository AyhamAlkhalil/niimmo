import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COMPANY } from "@/config/company";

interface UnterzeichnerAuswahlProps {
  /** E-Mail des Unterzeichners, leer ohne Wahl */
  wert: string;
  onChange: (email: string) => void;
  /** Höhe des Auswahlfelds passend zu den übrigen Feldern des Dialogs */
  className?: string;
}

/** Auswahl für Rückfragenblock und Unterschrift; Vorbelegung und Sperre in useUnterzeichnerWahl. */
export function UnterzeichnerAuswahl({ wert, onChange, className = "mt-1 h-9" }: UnterzeichnerAuswahlProps) {
  const gewaehlt = COMPANY.unterzeichner.some((u) => u.email === wert);
  return (
    <div>
      <Label className="text-xs">Rückfragen und Unterschrift</Label>
      <Select value={wert} onValueChange={onChange}>
        <SelectTrigger className={className}>
          <SelectValue placeholder="Bitte wählen" />
        </SelectTrigger>
        <SelectContent>
          {COMPANY.unterzeichner.map((u) => (
            <SelectItem key={u.email} value={u.email}>{u.unterschrift} – {u.funktion}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!gewaehlt && (
        <p className="text-xs text-destructive mt-1" role="alert">Bitte wählen, wer das Schreiben unterzeichnet.</p>
      )}
    </div>
  );
}
