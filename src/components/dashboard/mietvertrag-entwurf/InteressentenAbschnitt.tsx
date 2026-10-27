/**
 * Interessenten des Entwurfs: aus der Selbstauskunft gelesen, von Hand erfasst
 * oder aus dem Mieterbestand gewählt — neue und bestehende Mieter stehen
 * nebeneinander im selben Vertrag (Kundenwunsch 27.10.2026). Je Person wird
 * gewählt, ob sie Mitmieter (Vertragspartei) oder nur Mitbewohner ist. Gibt es
 * eine neu erfasste Person schon als Mieter, wird der vorhandene Datensatz
 * vorgeschlagen — am 15.10.2026 entstand sonst eine Dublette.
 */
import { useRef, useState } from 'react';
import { AlertTriangle, Building2, FileUp, Loader2, Plus, User, UserCheck, UserSearch, X } from 'lucide-react';

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
  istLeerePerson,
  leerePerson,
  mieterBezug,
  mitBestandsmieter,
  sucheMieter,
  type BlacklistTreffer,
  type EntwurfPerson,
  type PersonRolle,
} from '@/utils/mietvertrag/entwurf';
import type { Anrede } from '@/utils/mietvertrag/typen';

interface Props {
  personen: EntwurfPerson[];
  setPersonen: (aenderung: (p: EntwurfPerson[]) => EntwurfPerson[]) => void;
  bestand: MieterAbgleich[];
  bestandLaedt: boolean;
  bestandFehler: boolean;
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
  bestandLaedt,
  bestandFehler,
  blacklistTreffer,
  onSelbstauskunft,
  liestSelbstauskunft,
  selbstauskuenfte,
}: Props) {
  const dateiFeld = useRef<HTMLInputElement>(null);
  const suchFeld = useRef<HTMLInputElement>(null);
  /** Suchbegriff der Bestandsauswahl; null = Auswahl zu. */
  const [suche, setSuche] = useState<string | null>(null);

  const aendere = (schluessel: string, teil: Partial<EntwurfPerson>) =>
    setPersonen(liste => liste.map(p => (p.schluessel === schluessel ? { ...p, ...teil } : p)));

  /** Vorhandenen Mieter übernehmen: seine Daten zählen, leere Felder füllt die Selbstauskunft. */
  const verwende = (p: EntwurfPerson, m: MieterAbgleich) =>
    setPersonen(liste => liste.map(x => (x.schluessel === p.schluessel ? mitBestandsmieter(x, m) : x)));

  /**
   * Bestehenden Mieter als weitere Person dazunehmen. Nur eine ganz unberührte
   * Karte ersetzt er — eine mit Mail oder Anschrift, aber noch ohne Namen, bleibt.
   */
  const waehleBestand = (m: MieterAbgleich) => {
    const neu = mitBestandsmieter(leerePerson('mitmieter'), m);
    const unberuehrt = (p: EntwurfPerson) =>
      istLeerePerson(p) && !p.email && !p.telefon && !p.geburtsdatum && !p.strasse && !p.plz && !p.ort;
    setPersonen(liste => (liste.every(unberuehrt) ? [neu] : [...liste, neu]));
    setSuche(null);
  };

  const mitmieter = personen.filter(p => p.rolle === 'mitmieter').length;
  const gewaehlt = new Set(personen.map(p => p.mieterId).filter((id): id is string => !!id));
  const treffer = suche === null ? [] : sucheMieter(bestand, suche, gewaehlt);
  const bezugVon = (id: string | null) => (id ? mieterBezug(bestand.find(m => m.id === id)?.mietvertrag_mieter) : null);

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
        // Wer schon auf einer anderen Karte steht, wird nicht noch einmal vorgeschlagen
        const kandidaten = p.mieterId ? [] : findeVorhandeneMieter(p, bestand).filter(m => !gewaehlt.has(m.id));
        return (
          <div key={p.schluessel} className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {p.istUnternehmen ? <Building2 className="h-4 w-4 text-primary" /> : <User className="h-4 w-4 text-primary" />}
                <span className="whitespace-nowrap text-sm font-medium">Person {index + 1}</span>
                {p.verhaeltnis && <span className="text-xs text-muted-foreground">({p.verhaeltnis})</span>}
                {p.mieterId && (
                  <Badge variant="secondary" className="gap-1 whitespace-nowrap text-xs">
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
            {p.mieterId && bezugVon(p.mieterId) && (
              <p className="-mt-1 text-xs text-muted-foreground">{bezugVon(p.mieterId)}</p>
            )}

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
                    {kandidaten.slice(0, 3).map(m => {
                      const bezug = mieterBezug(m.mietvertrag_mieter);
                      return (
                        <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                          <span>
                            {m.ist_unternehmen ? m.firmenname : `${m.vorname ?? ''} ${m.nachname ?? ''}`.trim()}
                            {m.geburtsdatum ? `, geb. ${datumDe(m.geburtsdatum)}` : ''}
                            {m.hauptmail ? ` · ${m.hauptmail}` : ''}
                            {bezug ? ` · ${bezug}` : ''}
                          </span>
                          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => verwende(p, m)}>
                            Diesen Datensatz verwenden
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {p.mieterId && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => aendere(p.schluessel, { mieterId: null, quelle: undefined, bestandStand: undefined })}
                  >
                    Doch als neuen Mieter anlegen
                  </Button>
                )}
                {p.mieterId && (
                  <p className="text-xs text-muted-foreground">
                    Ergänzte oder geänderte Kontaktdaten übernimmt das Aktivieren in seine Stammdaten; leere Felder
                    löschen dort nichts.
                  </p>
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

      {suche !== null && (
        <div className="space-y-2 rounded-lg border border-primary/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="bestand-suche" className="text-sm font-medium">
              Bestehenden Mieter wählen
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              aria-label="Auswahl schließen"
              onClick={() => setSuche(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Input
            id="bestand-suche"
            ref={suchFeld}
            autoFocus
            placeholder="Name, E-Mail oder Telefon"
            value={suche}
            onChange={e => setSuche(e.target.value)}
          />
          <div aria-live="polite">
            {bestandLaedt ? (
              <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Mieterbestand wird geladen …
              </p>
            ) : bestandFehler ? (
              <p className="py-2 text-xs text-destructive">
                Der Mieterbestand konnte nicht geladen werden. Bitte den Ablauf neu öffnen.
              </p>
            ) : treffer.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">
                {suche.trim()
                  ? 'Kein Mieter gefunden. Über „Neue Person" anlegen.'
                  : 'Alle Mieter aus dem Bestand stehen schon im Vertrag.'}
              </p>
            ) : (
              <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
                {treffer.map(m => {
                  const bezug = mieterBezug(m.mietvertrag_mieter);
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                        onClick={() => waehleBestand(m)}
                      >
                        <span className="font-medium">
                          {m.ist_unternehmen && m.firmenname ? m.firmenname : `${m.vorname ?? ''} ${m.nachname ?? ''}`.trim()}
                        </span>
                        {m.geburtsdatum && <span className="text-muted-foreground">, geb. {datumDe(m.geburtsdatum)}</span>}
                        <span className="block text-xs text-muted-foreground">
                          {[bezug, m.hauptmail, m.telnr].filter(Boolean).join(' · ') || 'ohne Vertrag und Kontaktdaten'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button type="button" variant="outline" onClick={() => setPersonen(l => [...l, leerePerson()])}>
          <Plus className="h-4 w-4" />
          Neue Person
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-expanded={suche !== null}
          aria-controls="bestand-suche"
          onClick={() => (suche === null ? setSuche('') : suchFeld.current?.focus())}
        >
          <UserSearch className="h-4 w-4" />
          Bestehenden Mieter wählen
        </Button>
      </div>
    </div>
  );
}
