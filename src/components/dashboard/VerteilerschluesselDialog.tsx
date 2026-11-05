/**
 * Verteilerschlüssel je Kostenart eines Objekts festlegen (seit 04.11.2026).
 * Erreichbar im Objektdetail unter „Für Mietverträge“ und im Ablauf „Neuer
 * Mietvertrag“ beim Schritt Betriebskosten. Gespeichert wird an der
 * Nebenkostenart; dieselben Werte nutzen Vertrag und Betriebskostenabrechnung.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { findeOderErstelleNebenkostenart, nebenkostenartenKey, useNebenkostenarten } from '@/hooks/useNebenkostenDaten';
import { supabase } from '@/integrations/supabase/client';
import { VERTEILERSCHLUESSEL, verteilerschluesselName } from '@/utils/mietvertrag/typen';
import { geaenderteSchluessel, schluesselJeKategorie } from '@/utils/mietvertrag/verteilerschluesselObjekt';

interface Props {
  immobilieId: string;
  offen: boolean;
  onOpenChange: (offen: boolean) => void;
  /** Nach dem Speichern, z. B. um einen offenen Vertragsentwurf nachzuziehen */
  onGespeichert?: () => void;
}

export function VerteilerschluesselDialog({ immobilieId, offen, onOpenChange, onGespeichert }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const arten = useNebenkostenarten(offen ? immobilieId : '');
  const zeilen = useMemo(() => schluesselJeKategorie(arten.data ?? []), [arten.data]);
  const [auswahl, setAuswahl] = useState<Record<string, string>>({});
  const [speichert, setSpeichert] = useState(false);

  // Bei jedem Öffnen mit dem gespeicherten Stand beginnen
  useEffect(() => {
    if (offen) setAuswahl({});
  }, [offen]);

  const aenderungen = geaenderteSchluessel(zeilen, auswahl);

  async function speichern() {
    setSpeichert(true);
    try {
      for (const { zeile, schluessel } of aenderungen) {
        const ids =
          zeile.artIds.length > 0
            ? zeile.artIds
            : [await findeOderErstelleNebenkostenart(immobilieId, zeile.kategorie.id, arten.data ?? [])];
        const { data, error } = await supabase
          .from('nebenkostenarten')
          .update({ verteilerschluessel_art: schluessel })
          .in('id', ids)
          .select('id');
        // Ohne Recht ändert RLS still nichts — das darf nicht wie ein Erfolg aussehen
        if (error || !data?.length) throw new Error(error?.message ?? 'Keine Berechtigung für dieses Objekt.');
      }
      await queryClient.invalidateQueries({ queryKey: nebenkostenartenKey(immobilieId) });
      await queryClient.invalidateQueries({ queryKey: ['mietvertrag-entwurf-grundlagen'] });
      toast({
        title: 'Verteilerschlüssel gespeichert',
        description: 'Sie gelten für jeden neuen Mietvertrag in diesem Haus und für die Betriebskostenabrechnung.',
      });
      onGespeichert?.();
      onOpenChange(false);
    } catch (e) {
      toast({
        title: 'Speichern fehlgeschlagen',
        description: e instanceof Error ? e.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
      // Was schon geschrieben ist, soll sichtbar sein
      void queryClient.invalidateQueries({ queryKey: nebenkostenartenKey(immobilieId) });
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <Dialog open={offen} onOpenChange={o => !speichert && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Verteilerschlüssel je Kostenart</DialogTitle>
          <DialogDescription>
            Gilt für das ganze Haus: Jeder neue Mietvertrag nennt diese Schlüssel in § 4, und die
            Betriebskostenabrechnung verteilt danach. Wählt ihr einen Schlüssel für eine Kostenart, die am Objekt
            noch nicht angelegt ist, wird sie angelegt und in neuen Verträgen als umgelegt vorgeschlagen.
          </DialogDescription>
        </DialogHeader>

        {arten.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Kostenarten werden geladen …
          </div>
        ) : arten.error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Die Kostenarten des Objekts konnten nicht geladen werden.</AlertDescription>
          </Alert>
        ) : (
          <div className="divide-y rounded-md border">
            {zeilen.map(z => (
              <div key={z.kategorie.id} className="grid grid-cols-[1fr_250px] items-center gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">{z.kategorie.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {z.vertragsPositionen.length > 0 ? `im Vertrag ${z.vertragsPositionen.join(', ')}` : ''}
                    {!z.umlagefaehig
                      ? ' · am Objekt nicht umlagefähig'
                      : z.wirdAngelegt
                        ? auswahl[z.kategorie.id] && auswahl[z.kategorie.id] !== z.schluessel
                          ? ' · wird am Objekt angelegt'
                          : ' · Vorgabe, am Objekt nicht angelegt'
                        : !z.gepflegt && ' · Vorgabe'}
                  </p>
                </div>
                <Select
                  value={auswahl[z.kategorie.id] ?? z.schluessel}
                  onValueChange={v => setAuswahl(a => ({ ...a, [z.kategorie.id]: v }))}
                  disabled={speichert || !z.umlagefaehig}
                >
                  <SelectTrigger aria-label={`${z.kategorie.name}: Verteilerschlüssel`} className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VERTEILERSCHLUESSEL.map(v => (
                      <SelectItem key={v.key} value={v.key}>
                        nach {v.name}
                      </SelectItem>
                    ))}
                    {!VERTEILERSCHLUESSEL.some(v => v.key === z.schluessel) && (
                      <SelectItem value={z.schluessel}>nach {verteilerschluesselName(z.schluessel)}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={speichert}>
            Abbrechen
          </Button>
          <Button onClick={() => void speichern()} disabled={speichert || aenderungen.length === 0 || !!arten.error}>
            {speichert && <Loader2 className="h-4 w-4 animate-spin" />}
            {aenderungen.length > 0 ? `${aenderungen.length} ${aenderungen.length === 1 ? 'Änderung' : 'Änderungen'} speichern` : 'Speichern'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
