/**
 * Angaben zum Haus, die in jeden Mietvertrag übernommen werden: Heizung,
 * Warmwasser, Heizkostenverteilung, Schließanlage, Gemeinschaftseinrichtungen,
 * Gesamtwohnfläche.
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
import { istPlausiblesDatum } from '@/utils/pdf/briefLayout';
import { ZahlFeld } from './mietvertrag-formular/Bausteine';

type Angaben = Pick<
  Tables<'immobilien'>,
  | 'id'
  | 'heizungsart'
  | 'warmwasser'
  | 'heizkosten_schluessel'
  | 'schliessanlage_art'
  | 'gemeinschaftseinrichtungen'
  | 'gesamtwohnflaeche'
  | 'energieausweis_typ'
  | 'energie_kennwert'
  | 'energietraeger'
  | 'energieausweis_gueltig_bis'
  | 'energieeffizienzklasse'
>;

const HEIZUNG: Record<string, string> = {
  zentral: 'Zentralheizung',
  fernwaerme: 'Fernwärme',
  etage: 'Etagenheizung',
  keine: 'keine Heizung',
};
const EINRICHTUNGEN = ['Waschkeller', 'Trockenraum', 'Fahrradkeller', 'Kinderwagenraum', 'Hof', 'Garten', 'Dachboden'];

function anfangswerte(immobilie: Angaben) {
  return {
    heizungsart: immobilie.heizungsart,
    warmwasser: immobilie.warmwasser,
    heizkosten_schluessel: immobilie.heizkosten_schluessel ?? '70/30',
    schliessanlage_art: immobilie.schliessanlage_art,
    einrichtungen: (immobilie.gemeinschaftseinrichtungen ?? []).join(', '),
    gesamtwohnflaeche: immobilie.gesamtwohnflaeche !== null ? Number(immobilie.gesamtwohnflaeche) : null,
    energieausweis_typ: immobilie.energieausweis_typ,
    energie_kennwert: immobilie.energie_kennwert !== null ? Number(immobilie.energie_kennwert) : null,
    energietraeger: immobilie.energietraeger ?? '',
    energieausweis_gueltig_bis: immobilie.energieausweis_gueltig_bis ?? '',
    energieeffizienzklasse: immobilie.energieeffizienzklasse,
  };
}

const EFFIZIENZKLASSEN = ['A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export function HausangabenFuerVertraege({ immobilie, summeEinheitenQm }: { immobilie: Angaben; summeEinheitenQm: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [offen, setOffen] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const [werte, setWerte] = useState(() => anfangswerte(immobilie));

  useEffect(() => {
    if (offen) setWerte(anfangswerte(immobilie));
  }, [offen, immobilie]);

  const liste = werte.einrichtungen
    .split(/\s*,\s*/)
    .map(s => s.trim())
    .filter(Boolean);
  const zentral = werte.heizungsart === 'zentral' || werte.heizungsart === 'fernwaerme';
  const zentralGespeichert = immobilie.heizungsart === 'zentral' || immobilie.heizungsart === 'fernwaerme';

  const teile = [
    immobilie.heizungsart ? HEIZUNG[immobilie.heizungsart] : null,
    zentralGespeichert && immobilie.heizkosten_schluessel ? `Heizkosten ${immobilie.heizkosten_schluessel}` : null,
    immobilie.warmwasser ? `Warmwasser ${immobilie.warmwasser}` : null,
    immobilie.schliessanlage_art ? (immobilie.schliessanlage_art === 'zentral' ? 'Zentralschließanlage' : 'Einzelschließanlage') : null,
    immobilie.gesamtwohnflaeche ? `${Number(immobilie.gesamtwohnflaeche).toLocaleString('de-DE')} m² gesamt` : null,
    (immobilie.gemeinschaftseinrichtungen ?? []).length > 0 ? (immobilie.gemeinschaftseinrichtungen ?? []).join(', ') : null,
    immobilie.energieausweis_typ ? `Energieausweis (${immobilie.energieausweis_typ === 'bedarf' ? 'Bedarf' : 'Verbrauch'})` : null,
  ].filter(Boolean);

  async function speichern() {
    if (werte.energieausweis_gueltig_bis && !istPlausiblesDatum(werte.energieausweis_gueltig_bis)) {
      toast({
        title: 'Datum unvollständig',
        description: '„gültig bis" des Energieausweises ist kein vollständiges Datum.',
        variant: 'destructive',
      });
      return;
    }
    setSpeichert(true);
    const { data, error } = await supabase
      .from('immobilien')
      .update({
        heizungsart: werte.heizungsart,
        warmwasser: zentral ? werte.warmwasser : null,
        heizkosten_schluessel: werte.heizkosten_schluessel,
        schliessanlage_art: werte.schliessanlage_art,
        gemeinschaftseinrichtungen: liste.length > 0 ? liste : null,
        gesamtwohnflaeche: werte.gesamtwohnflaeche && werte.gesamtwohnflaeche > 0 ? werte.gesamtwohnflaeche : null,
        energieausweis_typ: werte.energieausweis_typ,
        energie_kennwert: werte.energieausweis_typ && werte.energie_kennwert && werte.energie_kennwert > 0 ? werte.energie_kennwert : null,
        energietraeger: werte.energieausweis_typ ? werte.energietraeger.trim() || null : null,
        energieausweis_gueltig_bis: werte.energieausweis_gueltig_bis || null,
        energieeffizienzklasse: werte.energieausweis_typ ? werte.energieeffizienzklasse : null,
      })
      .eq('id', immobilie.id)
      .select('id');
    setSpeichert(false);
    // Ein Update ohne Treffer meldet PostgREST nicht als Fehler — hier ist es einer
    if (error || !data?.length) {
      toast({ title: 'Speichern fehlgeschlagen', description: error?.message ?? 'Keine Berechtigung für dieses Objekt.', variant: 'destructive' });
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

            {zentral && (
              <div className="space-y-2">
                <Label>Heizkostenverteilung (Verbrauch/Fläche)</Label>
                <Select value={werte.heizkosten_schluessel} onValueChange={v => setWerte(w => ({ ...w, heizkosten_schluessel: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="70/30">70 % Verbrauch / 30 % Fläche</SelectItem>
                    <SelectItem value="60/40">60 % Verbrauch / 40 % Fläche</SelectItem>
                    <SelectItem value="50/50">50 % Verbrauch / 50 % Fläche</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

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

            <div className="space-y-2">
              <Label>Energieausweis</Label>
              <p className="text-xs text-muted-foreground">
                Steht nicht im Vertrag, ist dem Mieter aber spätestens bei Vertragsschluss vorzulegen (§ 80 Abs. 4 GEG).
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Select
                  value={werte.energieausweis_typ ?? 'keiner'}
                  onValueChange={v =>
                    setWerte(w => ({ ...w, energieausweis_typ: v === 'bedarf' || v === 'verbrauch' ? v : null }))
                  }
                >
                  <SelectTrigger aria-label="Art des Energieausweises">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keiner">nicht erfasst</SelectItem>
                    <SelectItem value="bedarf">Bedarfsausweis</SelectItem>
                    <SelectItem value="verbrauch">Verbrauchsausweis</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  aria-label="Energieausweis gültig bis"
                  value={werte.energieausweis_gueltig_bis}
                  onChange={e => setWerte(w => ({ ...w, energieausweis_gueltig_bis: e.target.value }))}
                />
              </div>
              {werte.energieausweis_typ && (
                <div className="grid grid-cols-3 gap-3">
                  <ZahlFeld
                    id="energie-kennwert-objekt"
                    wert={werte.energie_kennwert}
                    onWert={n => setWerte(w => ({ ...w, energie_kennwert: n }))}
                  />
                  <Input
                    placeholder="Energieträger"
                    value={werte.energietraeger}
                    onChange={e => setWerte(w => ({ ...w, energietraeger: e.target.value }))}
                  />
                  <Select
                    value={werte.energieeffizienzklasse ?? ''}
                    onValueChange={v => setWerte(w => ({ ...w, energieeffizienzklasse: v }))}
                  >
                    <SelectTrigger aria-label="Effizienzklasse">
                      <SelectValue placeholder="Klasse" />
                    </SelectTrigger>
                    <SelectContent>
                      {EFFIZIENZKLASSEN.map(k => (
                        <SelectItem key={k} value={k}>
                          {k}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {werte.energieausweis_typ && (
                <p className="text-xs text-muted-foreground">Kennwert in kWh/(m²·a), Energieträger z. B. Erdgas.</p>
              )}
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
