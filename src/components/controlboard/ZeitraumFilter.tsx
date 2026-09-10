import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { ZEITRAUM_VORGABEN, zeitraumVoreinstellung } from "@/utils/zahlungenAnsicht";

/**
 * Zeitraum-Filter der Zahlungsarbeitsplätze: Vorgaben wie „Letzter Monat"
 * links, Kalender mit Bereichswahl rechts. Seit dem 10.09.2026 gemeinsam für
 * „Alle Zahlungen" und „Nebenkosten".
 */
interface ZeitraumFilterProps {
  von: Date | undefined;
  bis: Date | undefined;
  onChange: (von: Date | undefined, bis: Date | undefined) => void;
}

export function ZeitraumFilter({ von, bis, onChange }: ZeitraumFilterProps) {
  const [offen, setOffen] = useState(false);
  const text =
    von && bis
      ? `${format(von, "dd.MM.yy", { locale: de })} – ${format(bis, "dd.MM.yy", { locale: de })}`
      : von
        ? `ab ${format(von, "dd.MM.yy", { locale: de })}`
        : bis
          ? `bis ${format(bis, "dd.MM.yy", { locale: de })}`
          : "Zeitraum";

  return (
    <Popover open={offen} onOpenChange={setOffen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-9 bg-background text-xs", (von || bis) && "border-primary/50 bg-primary/5")}>
          <CalendarIcon className="h-3.5 w-3.5" />
          {text}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          <div className="flex flex-col gap-0.5 border-r p-2">
            {ZEITRAUM_VORGABEN.map((v) => (
              <Button
                key={v.wert}
                variant="ghost"
                size="sm"
                className="h-8 justify-start text-xs"
                onClick={() => {
                  const bereich = zeitraumVoreinstellung(v.wert);
                  onChange(bereich.von, bereich.bis);
                  setOffen(false);
                }}
              >
                {v.label}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 justify-start text-xs text-muted-foreground"
              disabled={!von && !bis}
              onClick={() => {
                onChange(undefined, undefined);
                setOffen(false);
              }}
            >
              Gesamter Zeitraum
            </Button>
          </div>
          <Calendar
            mode="range"
            selected={{ from: von, to: bis }}
            onSelect={(bereich) => onChange(bereich?.from, bereich?.to)}
            numberOfMonths={2}
            locale={de}
            initialFocus
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
