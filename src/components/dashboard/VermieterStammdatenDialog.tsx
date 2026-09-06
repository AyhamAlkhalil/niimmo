/**
 * Stammdaten der vermietenden Gesellschaften.
 *
 * Ohne diese Maske war die Tabelle `vermieter` nur per SQL zu pflegen. Das
 * fiel beim ersten Vertrag sofort auf: Bei der NiImmo Wohnungsbaugesellschaft
 * mbH stand keine Bankverbindung, und ohne Mietkonto verweigert die
 * Pflichtprüfung den Druck — ein Mietvertrag ohne Zahlungsempfänger wäre
 * unbrauchbar.
 *
 * Die IBAN wird beim Tippen gegen die Prüfziffer nach ISO 7064 geprüft. In
 * der alten Word-Vorlage stand jahrelang eine IBAN mit falscher Prüfziffer;
 * Überweisungen dorthin lehnt die Bank ab.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, Check, Loader2, Save } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { formatIban, istIbanGueltig } from '@/utils/pdf/briefLayout';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Nach dem Speichern aufrufen, damit ein offener Vertragsdialog neu lädt. */
  onGespeichert?: () => void;
}

interface VermieterZeile {
  id: string;
  firmenname: string;
  rechtsform: string | null;
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  ort: string | null;
  vertreten_durch: string[] | null;
  vertretung_art: 'einzel' | 'gesamt' | null;
  registergericht: string | null;
  handelsregister: string | null;
  steuernummer: string | null;
  ust_id: string | null;
  telefon: string | null;
  email: string | null;
  miet_iban: string | null;
  miet_bic: string | null;
  kaution_iban: string | null;
  kaution_bic: string | null;
  ist_standard: boolean | null;
  stammdaten_geprueft: boolean | null;
}

export default function VermieterStammdatenDialog({ isOpen, onClose, onGespeichert }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<VermieterZeile | null>(null);
  const [speichert, setSpeichert] = useState(false);

  const { data: vermieter, isLoading } = useQuery({
    queryKey: ['vermieter-stammdaten'],
    enabled: isOpen,
    queryFn: async (): Promise<VermieterZeile[]> => {
      const { data, error } = await supabase
        .from('vermieter')
        .select('*')
        .order('ist_standard', { ascending: false })
        .order('firmenname');
      if (error) throw error;
      return (data ?? []) as unknown as VermieterZeile[];
    },
  });

  useEffect(() => {
    if (!vermieter?.length) return;
    const id = gewaehlt ?? vermieter[0].id;
    if (!gewaehlt) setGewaehlt(id);
    setEntwurf(vermieter.find(v => v.id === id) ?? null);
  }, [vermieter, gewaehlt]);

  const mietIbanOk = !entwurf?.miet_iban || istIbanGueltig(entwurf.miet_iban);
  const kautionIbanOk = !entwurf?.kaution_iban || istIbanGueltig(entwurf.kaution_iban);

  const fehlt = useMemo(() => {
    if (!entwurf) return [];
    const m: string[] = [];
    if (!entwurf.firmenname?.trim()) m.push('Firmierung');
    if (!(entwurf.vertreten_durch ?? []).filter(Boolean).length) m.push('Vertretung');
    if (!entwurf.strasse || !entwurf.plz || !entwurf.ort) m.push('Anschrift');
    if (!entwurf.miet_iban) m.push('Mietkonto');
    return m;
  }, [entwurf]);

  function setze<K extends keyof VermieterZeile>(feld: K, wert: VermieterZeile[K]) {
    setEntwurf(v => (v ? { ...v, [feld]: wert } : v));
  }

  async function speichern() {
    if (!entwurf) return;
    if (!mietIbanOk || !kautionIbanOk) {
      toast({
        title: 'IBAN prüfen',
        description: 'Die Prüfziffer stimmt nicht. So wird die Überweisung von der Bank abgelehnt.',
        variant: 'destructive',
      });
      return;
    }
    setSpeichert(true);
    try {
      const { error } = await supabase
        .from('vermieter')
        .update({
          firmenname: entwurf.firmenname.trim(),
          rechtsform: entwurf.rechtsform,
          strasse: entwurf.strasse,
          hausnummer: entwurf.hausnummer,
          plz: entwurf.plz,
          ort: entwurf.ort,
          vertreten_durch: (entwurf.vertreten_durch ?? []).map(x => x.trim()).filter(Boolean),
          vertretung_art: entwurf.vertretung_art,
          registergericht: entwurf.registergericht,
          handelsregister: entwurf.handelsregister,
          steuernummer: entwurf.steuernummer,
          ust_id: entwurf.ust_id,
          telefon: entwurf.telefon,
          email: entwurf.email,
          // Ohne Leerzeichen speichern — die Anzeige gruppiert selbst.
          miet_iban: entwurf.miet_iban?.replace(/\s+/g, '').toUpperCase() || null,
          miet_bic: entwurf.miet_bic?.trim().toUpperCase() || null,
          kaution_iban: entwurf.kaution_iban?.replace(/\s+/g, '').toUpperCase() || null,
          kaution_bic: entwurf.kaution_bic?.trim().toUpperCase() || null,
          stammdaten_geprueft: entwurf.stammdaten_geprueft ?? false,
        })
        .eq('id', entwurf.id);
      if (error) throw error;

      await queryClient.invalidateQueries({ queryKey: ['vermieter-stammdaten'] });
      await queryClient.invalidateQueries({ queryKey: ['mietvertrag-pdf-daten'] });
      toast({ title: 'Gespeichert', description: `${entwurf.firmenname} aktualisiert.` });
      onGespeichert?.();
    } catch (e) {
      toast({
        title: 'Speichern fehlgeschlagen',
        description: e instanceof Error ? e.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Vermieter-Stammdaten
          </DialogTitle>
          <DialogDescription>
            Diese Angaben stehen im Kopf jedes Mietvertrags. Ohne Mietkonto lässt sich kein
            Vertrag erzeugen.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lade …
          </div>
        )}

        {!isLoading && (vermieter?.length ?? 0) > 0 && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {vermieter!.map(v => (
                <Button
                  key={v.id}
                  size="sm"
                  variant={v.id === gewaehlt ? 'default' : 'outline'}
                  onClick={() => setGewaehlt(v.id)}
                >
                  {v.firmenname}
                  {v.ist_standard && <span className="ml-1 text-xs opacity-70">(Standard)</span>}
                  {!v.miet_iban && <AlertTriangle className="ml-1 h-3 w-3 text-amber-500" />}
                </Button>
              ))}
            </div>

            {entwurf && (
              <div className="space-y-4">
                {fehlt.length > 0 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Für einen Vertragsdruck fehlt noch: {fehlt.join(', ')}.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                  <div className="space-y-1">
                    <Label className="text-xs">Firmierung</Label>
                    <Input
                      value={entwurf.firmenname ?? ''}
                      onChange={e => setze('firmenname', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Rechtsform</Label>
                    <Input
                      value={entwurf.rechtsform ?? ''}
                      onChange={e => setze('rechtsform', e.target.value || null)}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">
                    Vertreten durch — mehrere Personen mit Komma trennen
                  </Label>
                  <Input
                    value={(entwurf.vertreten_durch ?? []).join(', ')}
                    onChange={e =>
                      setze('vertreten_durch', e.target.value.split(',').map(x => x.trim()))
                    }
                    placeholder="Ayhan Yeyrek, Dennis Mikyas"
                  />
                  <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                    <Checkbox
                      checked={entwurf.vertretung_art === 'gesamt'}
                      onCheckedChange={c => setze('vertretung_art', c === true ? 'gesamt' : 'einzel')}
                    />
                    Gesamtvertretung — alle müssen gemeinsam unterschreiben
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-[2fr_80px_100px_2fr]">
                  <div className="space-y-1">
                    <Label className="text-xs">Straße</Label>
                    <Input
                      value={entwurf.strasse ?? ''}
                      onChange={e => setze('strasse', e.target.value || null)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nr.</Label>
                    <Input
                      value={entwurf.hausnummer ?? ''}
                      onChange={e => setze('hausnummer', e.target.value || null)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">PLZ</Label>
                    <Input
                      value={entwurf.plz ?? ''}
                      onChange={e => setze('plz', e.target.value || null)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Ort</Label>
                    <Input
                      value={entwurf.ort ?? ''}
                      onChange={e => setze('ort', e.target.value || null)}
                    />
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <Label className="text-sm font-semibold">Bankverbindung</Label>
                  <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                    <div className="space-y-1">
                      <Label className="text-xs">Mietkonto — IBAN</Label>
                      <Input
                        value={formatIban(entwurf.miet_iban)}
                        onChange={e => setze('miet_iban', e.target.value || null)}
                        className={!mietIbanOk ? 'border-destructive' : ''}
                        placeholder="DE00 0000 0000 0000 0000 00"
                      />
                      {entwurf.miet_iban && (
                        <p
                          className={`flex items-center gap-1 text-xs ${
                            mietIbanOk ? 'text-emerald-600' : 'text-destructive'
                          }`}
                        >
                          {mietIbanOk ? (
                            <>
                              <Check className="h-3 w-3" /> Prüfziffer stimmt
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="h-3 w-3" /> Prüfziffer falsch
                            </>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">BIC</Label>
                      <Input
                        value={entwurf.miet_bic ?? ''}
                        onChange={e => setze('miet_bic', e.target.value || null)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                    <div className="space-y-1">
                      <Label className="text-xs">
                        Kautionskonto — IBAN (§ 551 Abs. 3 BGB: getrennt vom Vermögen)
                      </Label>
                      <Input
                        value={formatIban(entwurf.kaution_iban)}
                        onChange={e => setze('kaution_iban', e.target.value || null)}
                        className={!kautionIbanOk ? 'border-destructive' : ''}
                      />
                      {entwurf.kaution_iban && !kautionIbanOk && (
                        <p className="flex items-center gap-1 text-xs text-destructive">
                          <AlertTriangle className="h-3 w-3" /> Prüfziffer falsch
                        </p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">BIC</Label>
                      <Input
                        value={entwurf.kaution_bic ?? ''}
                        onChange={e => setze('kaution_bic', e.target.value || null)}
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Registergericht</Label>
                    <Input
                      value={entwurf.registergericht ?? ''}
                      onChange={e => setze('registergericht', e.target.value || null)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Handelsregister</Label>
                    <Input
                      value={entwurf.handelsregister ?? ''}
                      onChange={e => setze('handelsregister', e.target.value || null)}
                      placeholder="HRB 208111"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Steuernummer</Label>
                    <Input
                      value={entwurf.steuernummer ?? ''}
                      onChange={e => setze('steuernummer', e.target.value || null)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">USt-IdNr.</Label>
                    <Input
                      value={entwurf.ust_id ?? ''}
                      onChange={e => setze('ust_id', e.target.value || null)}
                    />
                  </div>
                </div>

                <label className="flex items-start gap-2 rounded border p-3 text-xs">
                  <Checkbox
                    checked={entwurf.stammdaten_geprueft === true}
                    onCheckedChange={c => setze('stammdaten_geprueft', c === true)}
                  />
                  <span>
                    Firmierung, Anschrift, Vertretung und Bankverbindung sind gegen
                    Handelsregisterauszug und Kontoauszug geprüft. Solange der Haken fehlt, weist
                    der Vertragsdialog darauf hin.
                  </span>
                </label>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={onClose}>
                    Schließen
                  </Button>
                  <Button onClick={speichern} disabled={speichert}>
                    {speichert ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Speichern
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
