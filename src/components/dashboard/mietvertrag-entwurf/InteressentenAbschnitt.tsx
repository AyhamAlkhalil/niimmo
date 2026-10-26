/**
 * Interessenten des Entwurfs: aus der Selbstauskunft gelesen oder von Hand
 * erfasst. Je Person wird gewählt, ob sie Mitmieter (Vertragspartei) oder nur
 * Mitbewohner ist. Gibt es die Person schon als Mieter, wird der vorhandene
 * Datensatz vorgeschlagen — am 15.10.2026 entstand sonst eine Dublette.
 */
import { useRef } from 'react';
import { AlertTriangle, Building2, FileUp, Loader2, Plus, User, UserCheck, X } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { MieterAbgleich } from '@/hooks/useMietvertragEntwurf';
import {
  findeVorhandeneMieter,
  leerePerson,
  type BlacklistTreffer,
  type EntwurfPerson,
  type PersonRolle,
} from '@/utils/mietvertrag/entwurf';
import type { Anrede } from '@/utils/mietvertrag/typen';

interface Props {
  personen: EntwurfPerson[];
  setPersonen: (aenderung: (p: EntwurfPerson[]) => EntwurfPerson[]) => void;
  bestand: MieterAbgleich[];
  blacklistTreffer: BlacklistTreffer[];
  onSelbstauskunft: (datei: File) => void;
  liestSelbstauskunft: boolean;
  /** Namen der abgelegten und neu gewählten Selbstauskünfte. */
  selbstauskuenfte: string[];
}

function datumDe(iso: string | null | undefined): string {
  return iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE') : '';
}

export function InteressentenAbschnitt({
  personen,
  setPersonen,
  bestand,
  blacklistTreffer,
  onSelbstauskunft,
  liestSelbstauskunft,
  selbstauskuenfte,
}: Props) {
  const dateiFeld = useRef<HTMLInputElement>(null);

  const aendere = (schluessel: string, teil: Partial<EntwurfPerson>) =>
    setPersonen(liste => liste.map(p => (p.schluessel === schluessel ? { ...p, ...teil } : p)));

  /** Vorhandenen Mieter übernehmen: seine Daten zählen, leere Felder füllt die Selbstauskunft. */
  const verwende = (p: EntwurfPerson, m: MieterAbgleich) =>
    aendere(p.schluessel, {
      mieterId: m.id,
      quelle: 'bestand',
      vorname: m.vorname ?? p.vorname,
      nachname: m.nachname ?? p.nachname,
      istUnternehmen: m.ist_unternehmen ?? false,
      firmenname: m.firmenname ?? p.firmenname,
      vertretenDurch: m.vertreten_durch ?? p.vertretenDurch ?? null,
      anrede: (m.anrede as Anrede | null) ?? p.anrede,
      geburtsdatum: m.geburtsdatum ?? p.geburtsdatum,
      email: m.hauptmail ?? p.email,
      telefon: m.telnr ?? p.telefon,
      strasse: p.strasse ?? m.strasse,
      hausnummer: p.hausnummer ?? m.hausnummer,
      plz: p.plz ?? m.plz,
      ort: p.ort ?? m.ort,
    });

  const mitmieter = personen.filter(p => p.rolle === 'mitmieter').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="text-sm font-semibold">Interessenten</Label>
          <p className="text-xs text-muted-foreground">
            {mitmieter} Mitmieter, {personen.length - mitmieter} Mitbewohner
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={liestSelbstauskunft}
          onClick={() => dateiFeld.current?.click()}
        >
          {liestSelbstauskunft ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          Selbstauskunft hochladen
        </Button>
        <input
          ref={dateiFeld}
          type="file"
          accept=".pdf,.docx,.jpg,.jpeg,.png"
          className="hidden"
          onChange={e => {
            const datei = e.target.files?.[0];
            e.target.value = '';
            if (datei) onSelbstauskunft(datei);
          }}
        />
      </div>

      {liestSelbstauskunft && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Selbstauskunft wird gelesen — Name, Geburtsdatum, Anschrift, Kontakt und weitere Personen.
        </p>
      )}
      {selbstauskuenfte.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Abgelegt mit dem Entwurf: {selbstauskuenfte.join(', ')}. Einkommen, Arbeitgeber und Schufa-Angaben werden
          nicht übernommen.
        </p>
      )}

      {blacklistTreffer.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <p className="mb-1 font-medium">Treffer in der Bewerber-Blacklist</p>
            <ul className="space-y-1 text-xs">
              {blacklistTreffer.map((t, i) => (
                <li key={i}>
                  {t.person || 'Person'} — Eintrag „{t.eintrag}" ({t.merkmal})
                  {t.grund ? `: ${t.grund}` : ''}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {personen.map((p, index) => {
        const kandidaten = p.mieterId ? [] : findeVorhandeneMieter(p, bestand);
        return (
          <div key={p.schluessel} className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {p.istUnternehmen ? <Building2 className="h-4 w-4 text-primary" /> : <User className="h-4 w-4 text-primary" />}
                <span className="text-sm font-medium">Person {index + 1}</span>
                {p.verhaeltnis && <span className="text-xs text-muted-foreground">({p.verhaeltnis})</span>}
                {p.mieterId && (
                  <Badge variant="secondary" className="gap-1 text-xs">
                    <UserCheck className="h-3 w-3" />
                    vorhandener Mieter
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Select value={p.rolle} onValueChange={(v: PersonRolle) => aendere(p.schluessel, { rolle: v })}>
                  <SelectTrigger className="h-8 w-[150px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mitmieter">Mitmieter</SelectItem>
                    <SelectItem value="mitbewohner">nur Mitbewohner</SelectItem>
                  </SelectContent>
                </Select>
                {personen.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive"
                    aria-label={`Person ${index + 1} entfernen`}
                    onClick={() => setPersonen(liste => liste.filter(x => x.schluessel !== p.schluessel))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {p.rolle === 'mitbewohner' ? (
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Vorname" value={p.vorname} onChange={e => aendere(p.schluessel, { vorname: e.target.value })} />
                <Input placeholder="Nachname" value={p.nachname} onChange={e => aendere(p.schluessel, { nachname: e.target.value })} />
                <p className="col-span-2 text-xs text-muted-foreground">
                  Zieht mit ein, steht aber nicht im Vertrag und unterschreibt nicht. Zählt zur Personenzahl.
                </p>
              </div>
            ) : (
              <>
                {!p.mieterId && (
                  <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
                    <span className="text-xs">{p.istUnternehmen ? 'Unternehmen' : 'Privatperson'}</span>
                    <Switch
                      checked={p.istUnternehmen}
                      onCheckedChange={c => aendere(p.schluessel, { istUnternehmen: c, anrede: c ? 'Firma' : null })}
                    />
                  </div>
                )}

                {p.istUnternehmen ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Firmenname"
                      value={p.firmenname ?? ''}
                      disabled={!!p.mieterId}
                      onChange={e => aendere(p.schluessel, { firmenname: e.target.value || null })}
                    />
                    <Input
                      placeholder="vertreten durch, z. B. Geschäftsführer/in"
                      aria-label="vertreten durch"
                      value={p.vertretenDurch ?? ''}
                      onChange={e => aendere(p.schluessel, { vertretenDurch: e.target.value || null })}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-[110px_1fr_1fr] gap-2">
                    <Select
                      value={p.anrede ?? ''}
                      onValueChange={(v: Anrede) => aendere(p.schluessel, { anrede: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Anrede" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Frau">Frau</SelectItem>
                        <SelectItem value="Herr">Herr</SelectItem>
                        <SelectItem value="Divers">Divers</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Vorname"
                      value={p.vorname}
                      disabled={!!p.mieterId}
                      onChange={e => aendere(p.schluessel, { vorname: e.target.value })}
                    />
                    <Input
                      placeholder="Nachname"
                      value={p.nachname}
                      disabled={!!p.mieterId}
                      onChange={e => aendere(p.schluessel, { nachname: e.target.value })}
                    />
                  </div>
                )}

                {kandidaten.length > 0 && (
                  <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2">
                    <p className="text-xs font-medium">Diese Person gibt es schon als Mieter:</p>
                    {kandidaten.slice(0, 3).map(m => (
                      <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                        <span>
                          {m.ist_unternehmen ? m.firmenname : `${m.vorname ?? ''} ${m.nachname ?? ''}`.trim()}
                          {m.geburtsdatum ? `, geb. ${datumDe(m.geburtsdatum)}` : ''}
                          {m.hauptmail ? ` · ${m.hauptmail}` : ''}
                        </span>
                        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => verwende(p, m)}>
                          Diesen Datensatz verwenden
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {p.mieterId && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => aendere(p.schluessel, { mieterId: null, quelle: undefined })}
                  >
                    Doch als neuen Mieter anlegen
                  </Button>
                )}

                {!p.istUnternehmen && (
                  <div className="space-y-1">
                    <Label className="text-xs">Geburtsdatum</Label>
                    <Input
                      type="date"
                      value={p.geburtsdatum ?? ''}
                      onChange={e => aendere(p.schluessel, { geburtsdatum: e.target.value || null })}
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <Label className="text-xs">Anschrift vor Einzug</Label>
                  <div className="grid grid-cols-[1fr_80px] gap-2">
                    <Input placeholder="Straße" value={p.strasse ?? ''} onChange={e => aendere(p.schluessel, { strasse: e.target.value || null })} />
                    <Input placeholder="Nr." value={p.hausnummer ?? ''} onChange={e => aendere(p.schluessel, { hausnummer: e.target.value || null })} />
                  </div>
                  <div className="grid grid-cols-[90px_1fr] gap-2">
                    <Input placeholder="PLZ" value={p.plz ?? ''} onChange={e => aendere(p.schluessel, { plz: e.target.value || null })} />
                    <Input placeholder="Ort" value={p.ort ?? ''} onChange={e => aendere(p.schluessel, { ort: e.target.value || null })} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="email"
                    placeholder="E-Mail"
                    value={p.email ?? ''}
                    onChange={e => aendere(p.schluessel, { email: e.target.value || null })}
                  />
                  <Input placeholder="Telefon" value={p.telefon ?? ''} onChange={e => aendere(p.schluessel, { telefon: e.target.value || null })} />
                </div>
              </>
            )}
          </div>
        );
      })}

      <Button type="button" variant="outline" className="w-full" onClick={() => setPersonen(l => [...l, leerePerson()])}>
        <Plus className="h-4 w-4" />
        Weitere Person
      </Button>
    </div>
  );
}
