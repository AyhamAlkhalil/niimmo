import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AnzahlFeldProps {
  id: string;
  label: string;
  /** Leer heißt „nicht übergeben" — im Protokoll steht dann ein Strich, nicht „0 Stück" */
  wert: string;
  onChange: (wert: string) => void;
}

/**
 * Stückzahl mit Minus/Plus. Auf dem Handy war ein kleines Zahlenfeld je
 * Schlüsselart mühsam zu treffen; getippt werden kann weiterhin.
 */
export const AnzahlFeld = ({ id, label, wert, onChange }: AnzahlFeldProps) => {
  const zahl = wert.trim() === "" ? null : Number(wert);
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      <div className="flex items-center">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11 rounded-r-none"
          aria-label={`${label}: einer weniger`}
          disabled={zahl === null || zahl <= 0}
          onClick={() => onChange(String(Math.max(0, (zahl ?? 0) - 1)))}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          placeholder="–"
          value={wert}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 3))}
          className="h-11 w-14 rounded-none border-x-0 text-center text-base tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11 rounded-l-none"
          aria-label={`${label}: einer mehr`}
          disabled={zahl !== null && zahl >= 999}
          onClick={() => onChange(String((zahl ?? 0) + 1))}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
