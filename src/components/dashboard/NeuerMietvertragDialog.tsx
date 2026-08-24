/**
 * Einstieg „Neuer Mietvertrag" ohne Umweg über die Einheit.
 *
 * Bisher ging ein neuer Vertrag nur über die Kachel der jeweiligen Einheit —
 * man musste erst wissen, wo die Wohnung liegt. Hier wählt man Objekt und
 * Einheit direkt aus und landet dann im gewohnten Erfassungsdialog.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, DoorOpen, Loader2, Search, UserCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { sortPropertiesByName } from '@/utils/contractUtils';
import { NewTenantContractDialog } from './NewTenantContractDialog';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface EinheitZeile {
  id: string;
  bezeichnung: string | null;
  etage: string | null;
  qm: number | null;
  einheitentyp: string | null;
  immobilie_id: string | null;
  /** Namen der Mieter, deren Vertrag noch läuft. Leer = frei. */
  belegtVon: string[];
  endetAm: string | null;
}

export function NeuerMietvertragDialog({ isOpen, onClose }: Props) {
  const [immobilieId, setImmobilieId] = useState<string>('');
  const [suche, setSuche] = useState('');
  const [gewaehlteEinheit, setGewaehlteEinheit] = useState<EinheitZeile | null>(null);

  const { data: immobilien, isLoading: immobilienLaden } = useQuery({
    queryKey: ['immobilien-auswahl'],
    enabled: isOpen,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('immobilien')
        .select('id, name, adresse, strasse, hausnummer, plz, ort');
      if (error) throw error;
      return sortPropertiesByName(data ?? []);
    },
  });

  const { data: einheiten, isLoading: einheitenLaden } = useQuery({
    queryKey: ['einheiten-auswahl', immobilieId],
    enabled: isOpen && !!immobilieId,
    queryFn: async (): Promise<EinheitZeile[]> => {
      const { data, error } = await supabase
        .from('einheiten')
        .select(
          // Fremdschlüssel explizit benannt: einheiten und mietvertrag sind über
          // mietvertrag_einheiten zusätzlich verbunden, ein Embed ohne Hint wäre
          // mehrdeutig, sobald PostgREST daraus wieder eine m:n-Beziehung ableitet.
          `id, bezeichnung, etage, qm, einheitentyp, immobilie_id,
           mietvertrag!mietvertraege_einheit_id_fkey ( id, status, ende_datum,
             mietvertrag_mieter ( mieter:mieter_id ( vorname, nachname ) ) )`
        )
        .eq('immobilie_id', immobilieId);
      if (error) throw error;

      return (data ?? []).map(e => {
        const laufende = (e.mietvertrag ?? []).filter(
          (v: { status: string | null }) => v.status === 'aktiv' || v.status === 'gekuendigt'
        );
        const namen = laufende.flatMap(
          (v: { mietvertrag_mieter?: { mieter?: { vorname: string | null; nachname: string | null } | null }[] }) =>
            (v.mietvertrag_mieter ?? [])
              .map(mm => `${mm.mieter?.vorname ?? ''} ${mm.mieter?.nachname ?? ''}`.trim())
              .filter(Boolean)
        );
        const enden = laufende
          .map((v: { ende_datum: string | null }) => v.ende_datum)
          .filter((d): d is string => !!d)
          .sort();

        return {
          id: e.id,
          bezeichnung: e.bezeichnung,
          etage: e.etage,
          qm: e.qm !== null ? Number(e.qm) : null,
          einheitentyp: e.einheitentyp,
          immobilie_id: e.immobilie_id,
          belegtVon: namen,
          endetAm: enden[0] ?? null,
        };
      });
    },
  });

  const immobilie = useMemo(
    () => immobilien?.find(i => i.id === immobilieId),
    [immobilien, immobilieId]
  );

  const gefiltert = useMemo(() => {
    const begriff = suche.trim().toLowerCase();
    const liste = (einheiten ?? []).filter(e => {
      if (!begriff) return true;
      return [e.bezeichnung, e.etage, e.einheitentyp, ...e.belegtVon]
        .filter(Boolean)
        .some(w => String(w).toLowerCase().includes(begriff));
    });
    // Freie zuerst — dort entsteht in der Regel der neue Vertrag
    return liste.sort((a, b) => {
      if (a.belegtVon.length !== b.belegtVon.length) return a.belegtVon.length - b.belegtVon.length;
      return (a.bezeichnung ?? a.etage ?? '').localeCompare(b.bezeichnung ?? b.etage ?? '');
    });
  }, [einheiten, suche]);

  const frei = gefiltert.filter(e => e.belegtVon.length === 0).length;

  function schliessen() {
    setImmobilieId('');
    setSuche('');
    setGewaehlteEinheit(null);
    onClose();
  }

  return (
    <>
      <Dialog open={isOpen && !gewaehlteEinheit} onOpenChange={o => !o && schliessen()}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DoorOpen className="h-5 w-5" />
              Neuer Mietvertrag
            </DialogTitle>
            <DialogDescription>
              Objekt und Einheit wählen — die Mieterdaten werden im nächsten Schritt erfasst.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="objekt">Objekt</Label>
              <Select value={immobilieId} onValueChange={v => { setImmobilieId(v); setSuche(''); }}>
                <SelectTrigger id="objekt">
                  <SelectValue placeholder={immobilienLaden ? 'Objekte werden geladen …' : 'Objekt auswählen'} />
                </SelectTrigger>
                <SelectContent>
                  {(immobilien ?? []).map(i => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name?.trim() || i.adresse}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {immobilie && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  {immobilie.strasse
                    ? `${immobilie.strasse} ${immobilie.hausnummer ?? ''}, ${immobilie.plz ?? ''} ${immobilie.ort ?? ''}`
                    : immobilie.adresse}
                </p>
              )}
            </div>

            {immobilieId && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="einheit-suche">Einheit</Label>
                  {!einheitenLaden && (
                    <span className="text-xs text-muted-foreground">
                      {frei} von {gefiltert.length} frei
                    </span>
                  )}
                </div>

                {(einheiten?.length ?? 0) > 6 && (
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="einheit-suche"
                      className="pl-8"
                      placeholder="Nach Bezeichnung, Lage oder Mieter suchen"
                      value={suche}
                      onChange={e => setSuche(e.target.value)}
                    />
                  </div>
                )}

                {einheitenLaden ? (
                  <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Einheiten werden geladen …</span>
                  </div>
                ) : gefiltert.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {suche ? 'Keine Einheit passt zur Suche.' : 'Für dieses Objekt sind keine Einheiten erfasst.'}
                  </p>
                ) : (
                  <div className="border rounded-md divide-y max-h-[45vh] overflow-y-auto">
                    {gefiltert.map(e => {
                      const belegt = e.belegtVon.length > 0;
                      return (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => setGewaehlteEinheit(e)}
                          className="w-full text-left px-3 py-2.5 hover:bg-muted/60 focus:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">
                                {e.bezeichnung?.trim() || e.etage?.trim() || 'Ohne Bezeichnung'}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {[
                                  e.bezeichnung?.trim() && e.etage?.trim(),
                                  e.einheitentyp,
                                  e.qm ? `${e.qm.toLocaleString('de-DE')} m²` : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ') || 'Keine weiteren Angaben'}
                              </p>
                              {belegt && (
                                <p className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1">
                                  <UserCheck className="h-3 w-3 shrink-0" />
                                  {e.belegtVon.join(', ')}
                                  {e.endetAm &&
                                    ` · endet ${new Date(`${e.endetAm}T12:00:00`).toLocaleDateString('de-DE')}`}
                                </p>
                              )}
                            </div>
                            <Badge variant={belegt ? 'secondary' : 'default'} className="shrink-0">
                              {belegt ? 'belegt' : 'frei'}
                            </Badge>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Auch belegte Einheiten sind wählbar — für einen Nachmietvertrag, der vor dem
                  Auszug des jetzigen Mieters angelegt wird.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {gewaehlteEinheit && immobilie && (
        <NewTenantContractDialog
          isOpen={true}
          onClose={schliessen}
          einheitId={gewaehlteEinheit.id}
          immobilie={{
            name: immobilie.name?.trim() || immobilie.adresse || '',
            adresse: immobilie.strasse
              ? `${immobilie.strasse} ${immobilie.hausnummer ?? ''}, ${immobilie.plz ?? ''} ${immobilie.ort ?? ''}`.replace(/\s+/g, ' ').trim()
              : (immobilie.adresse ?? ''),
          }}
        />
      )}
    </>
  );
}
