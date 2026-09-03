import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AtSign, Bell, CheckCheck, MessageSquare, RefreshCw, UserCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  useBenachrichtigungen,
  type Benachrichtigung,
  type BenachrichtigungsTyp,
} from "@/hooks/useBenachrichtigungen";

// Rueckfall auf die Glocke, falls je ein weiterer Typ dazukommt: Ohne ihn
// waere die Komponente `undefined` und risse die ganze Ansicht ab.
const TYP_SYMBOL: Record<BenachrichtigungsTyp, typeof AtSign> = {
  erwaehnung: AtSign,
  zuweisung: UserCheck,
  kommentar: MessageSquare,
  status: RefreshCw,
};

interface BenachrichtigungsGlockeProps {
  /** Öffnet die zugehörige Aufgabe im Board. */
  onAufgabeOeffnen: (aufgabenId: string) => void;
  className?: string;
  /** Rund als schwebender Knopf, sonst flach für den Kopfbereich. */
  variante?: "schwebend" | "kopfbereich";
}

export const BenachrichtigungsGlocke = ({
  onAufgabeOeffnen,
  className,
  variante = "kopfbereich",
}: BenachrichtigungsGlockeProps) => {
  const { eintraege, anzahlUngelesen, alsGelesenMarkieren, alleAlsGelesenMarkieren } =
    useBenachrichtigungen();

  const beiKlick = (eintrag: Benachrichtigung) => {
    if (!eintrag.gelesen_am) alsGelesenMarkieren([eintrag.id]);
    if (eintrag.ticket_id) onAufgabeOeffnen(eintrag.ticket_id);
  };

  const istSchwebend = variante === "schwebend";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={anzahlUngelesen ? `${anzahlUngelesen} ungelesen` : "Benachrichtigungen"}
          className={cn(
            "relative flex items-center justify-center transition-all",
            istSchwebend
              ? "h-12 w-12 rounded-full border border-gray-200/60 bg-white text-gray-700 shadow-lg hover:scale-105 hover:bg-gray-50 active:scale-95"
              : "h-9 w-9 rounded-full border border-gray-200/70 bg-white/60 text-gray-600 hover:bg-white hover:text-gray-900",
            className,
          )}
        >
          <Bell className={istSchwebend ? "h-5 w-5" : "h-4 w-4"} />
          {anzahlUngelesen > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-[18px] text-white">
              {anzahlUngelesen > 9 ? "9+" : anzahlUngelesen}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(92vw,22rem)] p-0" sideOffset={8}>
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Benachrichtigungen</span>
          {anzahlUngelesen > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => alleAlsGelesenMarkieren()}
            >
              <CheckCheck className="mr-1 h-3.5 w-3.5" /> Alle gelesen
            </Button>
          )}
        </div>

        {eintraege.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            Nichts Neues.
          </p>
        ) : (
          <ScrollArea className="max-h-[22rem]">
            <ul className="divide-y">
              {eintraege.map((eintrag) => {
                const Symbol = TYP_SYMBOL[eintrag.typ] ?? Bell;
                const ungelesen = !eintrag.gelesen_am;

                return (
                  <li key={eintrag.id}>
                    <button
                      type="button"
                      onClick={() => beiKlick(eintrag)}
                      className={cn(
                        "flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                        ungelesen && "bg-red-50/60",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                          ungelesen ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground",
                        )}
                      >
                        <Symbol className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block text-sm leading-snug",
                            ungelesen ? "font-medium" : "text-muted-foreground",
                          )}
                        >
                          {eintrag.titel}
                        </span>
                        {eintrag.text && (
                          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                            {eintrag.text}
                          </span>
                        )}
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {eintrag.ausloeser?.anzeigename
                            ? `${eintrag.ausloeser.anzeigename} · `
                            : ""}
                          {formatDistanceToNow(new Date(eintrag.erstellt_am), {
                            addSuffix: true,
                            locale: de,
                          })}
                        </span>
                      </span>
                      {ungelesen && (
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
};
