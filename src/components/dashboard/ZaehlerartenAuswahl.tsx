import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUserRole } from "@/hooks/useUserRole";
import {
  artUmschalten,
  EINHEIT_ZAEHLERARTEN,
  einheitZaehlerarten,
  HAUSANSCHLUSS_ZAEHLERARTEN,
  hausanschlussZaehlerarten,
  hausanschlussZweiterZaehler,
  ZAEHLERART_BEZEICHNUNG,
  type HausanschlussZaehlerart,
  type ObjektZaehlerKonfiguration,
} from "@/utils/zaehlerarten";

interface ZaehlerartenAuswahlProps {
  immobilie: ObjektZaehlerKonfiguration & { id: string };
}

type Aenderung = {
  hat_wasser?: boolean;
  hat_strom?: boolean;
  hat_gas?: boolean;
  zaehlerarten_einheiten?: string[];
  hausanschluss_zweiter_zaehler?: string[];
};

// Alle Ansichten, die Zählerarten eines Objekts zeigen
const BETROFFENE_ABFRAGEN = ["zaehler-verwaltung-immobilien", "hausmeister-immobilien", "immobilie", "immobilien"];

/**
 * Welche Zähler ein Objekt hat: Hausanschluss (mit optionalem zweitem Zähler) und Einheiten.
 * Ersetzt seit 24.11.2026 die drei Haken Strom/Gas/Wasser, die Hausanschluss und Einheiten nur
 * gemeinsam schalteten (Regeln in utils/zaehlerarten.ts). Jede Änderung wird sofort gespeichert.
 */
export function ZaehlerartenAuswahl({ immobilie }: ZaehlerartenAuswahlProps) {
  const queryClient = useQueryClient();
  const { isAdmin } = useUserRole();
  const [speichert, setSpeichert] = useState(false);

  if (!isAdmin) return null;

  const hausanschluss = hausanschlussZaehlerarten(immobilie);
  const zweiter = hausanschlussZweiterZaehler(immobilie);
  const einheiten = einheitZaehlerarten(immobilie);

  const speichere = async (aenderung: Aenderung) => {
    setSpeichert(true);
    try {
      // Ein UPDATE, das RLS verweigert, trifft still 0 Zeilen -- deshalb die Zeile zurückholen
      const { data, error } = await supabase.from("immobilien").update(aenderung).eq("id", immobilie.id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Keine Zeile geändert");
      await Promise.all(BETROFFENE_ABFRAGEN.map((schluessel) => queryClient.invalidateQueries({ queryKey: [schluessel] })));
      toast.success("Zählerarten gespeichert");
    } catch {
      toast.error("Zählerarten konnten nicht gespeichert werden");
    } finally {
      setSpeichert(false);
    }
  };

  const zweiterUmschalten = (art: HausanschlussZaehlerart, an: boolean) =>
    speichere({
      hausanschluss_zweiter_zaehler: artUmschalten(HAUSANSCHLUSS_ZAEHLERARTEN, immobilie.hausanschluss_zweiter_zaehler ?? [], art, an),
    });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={(e) => e.stopPropagation()}>
          {speichert ? <Loader2 className="h-3 w-3 animate-spin" /> : <SlidersHorizontal className="h-3 w-3" />}
          Zählerarten
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-medium text-foreground">Welche Zähler hat dieses Objekt?</p>

        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hausanschluss</p>
          {HAUSANSCHLUSS_ZAEHLERARTEN.map((art) => {
            const vorhanden = hausanschluss.includes(art);
            return (
              <div key={art} className="flex items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={vorhanden}
                    disabled={speichert}
                    onCheckedChange={(an) => speichere({ [`hat_${art}`]: !!an })}
                  />
                  {ZAEHLERART_BEZEICHNUNG[art]}
                </label>
                <label className={`flex items-center gap-2 text-xs ${vorhanden ? "cursor-pointer text-foreground" : "text-muted-foreground"}`}>
                  <Checkbox
                    checked={zweiter.includes(art)}
                    disabled={speichert || !vorhanden}
                    onCheckedChange={(an) => zweiterUmschalten(art, !!an)}
                  />
                  zweiter Zähler
                </label>
              </div>
            );
          })}
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Einheiten</p>
          <div className="grid grid-cols-2 gap-2">
            {EINHEIT_ZAEHLERARTEN.map((art) => (
              <label key={art} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={einheiten.includes(art)}
                  disabled={speichert}
                  onCheckedChange={(an) =>
                    speichere({
                      zaehlerarten_einheiten: artUmschalten(EINHEIT_ZAEHLERARTEN, immobilie.zaehlerarten_einheiten, art, !!an),
                    })
                  }
                />
                {ZAEHLERART_BEZEICHNUNG[art]}
              </label>
            ))}
          </div>
        </section>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Abgewählte Zähler erscheinen nicht mehr in Zählerliste, Objektübersicht und Vertragsansicht. Gespeicherte
          Stände bleiben erhalten und kommen zurück, sobald die Art wieder gewählt ist.
        </p>
      </PopoverContent>
    </Popover>
  );
}
