/**
 * Angaben zum Haus, die in jeden Mietvertrag übernommen werden: Heizung,
 * Warmwasser, Schließanlage, Gemeinschaftseinrichtungen, Gesamtwohnfläche.
 *
 * Seit 18.10.2026 am Objekt gepflegt. Fehlen sie, fragt der Vertragsentwurf
 * beim ersten Vertrag danach und speichert sie hier.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileSignature, Loader2, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { ZahlFeld } from './mietvertrag-formular/Bausteine';

type Angaben = Pick<
  Tables<'immobilien'>,
  'id' | 'heizungsart' | 'warmwasser' | 'schliessanlage_art' | 'gemeinschaftseinrichtungen' | 'gesamtwohnflaeche'
>;

const HEIZUNG: Record<string, string> = {
  zentral: 'Zentralheizung',
  fernwaerme: 'Fernwärme',
  etage: 'Etagenheizung',
  keine: 'keine Heizung',
};
const EINRICHTUNGEN = ['Waschkeller', 'Trockenraum', 'Fahrradkeller', 'Kinderwagenraum', 'Hof', 'Garten', 'Dachboden'];

export function HausangabenFuerVertraege({ immobilie, summeEinheitenQm }: { immobilie: Angaben; summeEinheitenQm: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [offen, setOffen] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const [werte, setWerte] = useState({
    heizungsart: immobilie.heizungsart,
    warmwasser: immobilie.warmwasser,
    schliessanlage_art: immobilie.schliessanlage_art,
    einrichtungen: (immobilie.gemeinschaftseinrichtungen ?? []).join(', '),
    gesamtwohnflaeche: immobilie.gesamtwohnflaeche !== null ? Number(immobilie.gesamtwohnflaeche) : null,
  });

  useEffect(() => {
    if (!offen) return;
    setWerte({
      heizungsart: immobilie.heizungsart,
      warmwasser: immobilie.warmwasser,
      schliessanlage_art: immobilie.schliessanlage_art,
      einrichtungen: (immobilie.gemeinschaftseinrichtungen ?? []).join(', '),
      gesamtwohnflaeche: immobilie.gesamtwohnflaeche !== null ? Number(immobilie.gesamtwohnflaeche) : null,
    });
  }, [offen, immobilie]);

  const liste = werte.einrichtungen
    .split(/\s*,\s*/)
    .map(s => s.trim())
    .filter(Boolean);
  const zentral = werte.heizungsart === 'zentral' || werte.heizungsart === 'fernwaerme';

  const teile = [
    immobilie.heizungsart ? HEIZUNG[immobilie.heizungsart] : null,
    immobilie.warmwasser ? `Warmwasser ${immobilie.warmwasser}` : null,
    immobilie.schliessanlage_art ? (immobilie.schliessanlage_art === 'zentral' ? 'Zentralschließanlage' : 'Einzelschließanlage') : null,
    immobilie.gesamtwohnflaeche ? `${Number(immobilie.gesamtwohnflaeche).toLocaleString('de-DE')} m² gesamt` : null,
    (immobilie.gemeinschaftseinrichtungen ?? []).length > 0 ? (immobilie.gemeinschaftseinrichtungen ?? []).join(', ') : null,
  ].filter(Boolean);

  async function speichern() {
    setSpeichert(true);
    const { error } = await supabase
      .from('immobilien')
      .update({
        heizungsart: werte.heizungsart,
        warmwasser: zentral ? werte.warmwasser : null,
        schliessanlage_art: werte.schliessanlage_art,
        gemeinschaftseinrichtungen: liste.length > 0 ? liste : null,
        gesamtwohnflaeche: werte.gesamtwohnflaeche && werte.gesamtwohnflaeche > 0 ? werte.gesamtwohnflaeche : null,
      })
      .eq('id', immobilie.id);
    setSpeichert(false);
    if (error) {
      toast({ title: 'Speichern fehlgeschlagen', description: error.message, variant: 'destructive' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['immobilie', immobilie.id] });
    toast({ title: 'Angaben gespeichert', description: 'Sie gelten ab jetzt für jeden neuen Mietvertrag in diesem Haus.' });
    setOffen(false);
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <FileSignature className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 font-medium">Für Mietverträge:</span>
          <span className="truncate text-muted-foreground">
            {teile.length > 0 ? teile.join(' · ') : 'noch nicht erfasst — der nächste Vertragsentwurf fragt danach'}
          </span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs" onClick={() => setOffen(true)}>
          <Pencil className="h-3 w-3" />
          Bearbeiten
        </Button>
      </div>

      <Dialog open={offen} onOpenChange={o => !speichert && setOffen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Angaben für Mietverträge</DialogTitle>
            <DialogDescription>Gelten für das ganze Haus und werden in jeden neuen Vertrag übernommen.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Heizung</Label>
                <Select value={werte.heizungsart ?? ''} onValueChange={v => setWerte(w => ({ ...w, heizungsart: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Bitte wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(HEIZUNG).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Warmwasser</Label>
                <Select
                  value={zentral ? werte.warmwasser ?? '' : ''}
                  disabled={!zentral}
                  onValueChange={v => setWerte(w => ({ ...w, warmwasser: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={zentral ? 'Bitte wählen' : 'entfällt'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zentral">zentral über die Heizung</SelectItem>
                    <SelectItem value="dezentral">dezentral in der Wohnung</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Schließanlage</Label>
                <Select
                  value={werte.schliessanlage_art ?? ''}
                  onValueChange={(v: 'zentral' | 'einzel') => setWerte(w => ({ ...w, schliessanlage_art: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Bitte wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zentral">Zentralschließanlage</SelectItem>
                    <SelectItem value="einzel">Einzelschließanlage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="gesamt-qm">Gesamtwohnfläche (m²)</Label>
                <ZahlFeld
                  id="gesamt-qm"
                  wert={werte.gesamtwohnflaeche}
                  onWert={n => setWerte(w => ({ ...w, gesamtwohnflaeche: n }))}
                />
                {summeEinheitenQm > 0 && summeEinheitenQm !== werte.gesamtwohnflaeche && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => setWerte(w => ({ ...w, gesamtwohnflaeche: summeEinheitenQm }))}
                  >
                    Summe der Einheiten übernehmen ({summeEinheitenQm.toLocaleString('de-DE')} m²)
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="einrichtungen-objekt">Gemeinschaftseinrichtungen zur Mitbenutzung</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {EINRICHTUNGEN.map(name => (
                  <label key={name} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={liste.includes(name)}
                      onCheckedChange={c => {
                        const neu = c === true ? [...liste, name] : liste.filter(e => e !== name);
                        setWerte(w => ({ ...w, einrichtungen: neu.join(', ') }));
                      }}
                    />
                    {name}
                  </label>
                ))}
              </div>
              <Input
                id="einrichtungen-objekt"
                placeholder="Weitere, durch Komma getrennt"
                value={werte.einrichtungen}
                onChange={e => setWerte(w => ({ ...w, einrichtungen: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOffen(false)} disabled={speichert}>
              Abbrechen
            </Button>
            <Button onClick={() => void speichern()} disabled={speichert}>
              {speichert && <Loader2 className="h-4 w-4 animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
