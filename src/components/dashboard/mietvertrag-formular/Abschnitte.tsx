/**
 * Formularabschnitte des Mietvertrags. Gemeinsam für den Generator am
 * bestehenden Vertrag und für den Vertragsentwurf; der Entwurf reicht
 * zusätzlich `markierung` und `geaendert` durch, um übernommene Werte
 * kenntlich zu machen.
 */
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { positionenSumme } from '@/utils/mietvertrag/entwurf';
import type {
  BetriebskostenPosition,
  Heizungsart,
  MietanpassungArt,
  MietvertragDaten,
  SchliessanlageArt,
  Uebergabezustand,
  Warmwasserart,
} from '@/utils/mietvertrag/typen';
import { ZahlFeld, type AbschnittProps } from './Bausteine';

function eur(n: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Feldname({ htmlFor, children, marke }: { htmlFor?: string; children: ReactNode; marke?: ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className="flex flex-wrap items-center gap-y-1">
      {children}
      {marke}
    </Label>
  );
}

function Ueberschrift({ children }: { children: ReactNode }) {
  return <Label className="text-sm font-semibold">{children}</Label>;
}

// ─── Mietsache ──────────────────────────────────────────────────────────────

export function MietsacheFelder({ entwurf, setEntwurf, markierung, geaendert }: AbschnittProps) {
  const einheit = (feld: keyof MietvertragDaten['einheit'], wert: MietvertragDaten['einheit'][typeof feld]) => {
    setEntwurf(d => ({ ...d, einheit: { ...d.einheit, [feld]: wert } }));
    geaendert?.(`einheit.${feld}`);
  };

  return (
    <div className="space-y-3">
      <Ueberschrift>Angaben zur Mietsache</Ueberschrift>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Feldname htmlFor="einheit-bez" marke={markierung?.('einheit.bezeichnung')}>
            Einheitenbezeichnung
          </Feldname>
          <Input
            id="einheit-bez"
            placeholder="WE 12"
            value={entwurf.einheit.bezeichnung}
            onChange={e => einheit('bezeichnung', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Feldname htmlFor="einheit-qm" marke={markierung?.('einheit.wohnflaecheQm')}>
            Wohnfläche (m²)
          </Feldname>
          <ZahlFeld
            id="einheit-qm"
            wert={entwurf.einheit.wohnflaecheQm || null}
            onWert={n => einheit('wohnflaecheQm', n ?? 0)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Feldname htmlFor="einheit-lage" marke={markierung?.('einheit.lage')}>
          Lage im Gebäude
        </Feldname>
        <Input
          id="einheit-lage"
          placeholder="Haus rechts, Dachgeschoss rechts"
          value={entwurf.einheit.lage}
          onChange={e => einheit('lage', e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Feldname htmlFor="raumaufstellung" marke={markierung?.('einheit.raumaufstellung')}>
          Räume
        </Feldname>
        <Input
          id="raumaufstellung"
          placeholder="3,5 Zimmer, 1 Küche, 1 Badezimmer, 1 Gäste-WC"
          value={entwurf.einheit.raumaufstellung}
          onChange={e => einheit('raumaufstellung', e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Feldname htmlFor="personen" marke={markierung?.('anzahlPersonen')}>
          Anzahl Personen im Haushalt
        </Feldname>
        <ZahlFeld
          id="personen"
          wert={entwurf.anzahlPersonen || null}
          onWert={n => {
            setEntwurf(d => ({ ...d, anzahlPersonen: Math.max(0, Math.round(n ?? 0)) }));
            geaendert?.('anzahlPersonen');
          }}
        />
        <p className="text-xs text-muted-foreground">
          Gehört zum Vertrag, nicht zur Einheit. Wird nicht geschätzt — ohne Angabe ist der Personenschlüssel bei
          den Betriebskosten nicht vereinbarungsfähig.
        </p>
      </div>
    </div>
  );
}

// ─── Objektangaben ──────────────────────────────────────────────────────────

const EINRICHTUNGEN = ['Waschkeller', 'Trockenraum', 'Fahrradkeller', 'Kinderwagenraum', 'Hof', 'Garten', 'Dachboden'];

function einrichtungsListe(text: string | null): string[] {
  return (text ?? '')
    .split(/\s*,\s*/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Angaben, die für das ganze Haus gelten. Sie werden beim Speichern am Objekt
 * abgelegt und gelten dann für jeden weiteren Vertrag (Entscheidung vom 18.10.2026).
 */
export function ObjektAngabenFelder({
  entwurf,
  setEntwurf,
  markierung,
  geaendert,
  gesamtflaecheVorschlag,
}: AbschnittProps & { gesamtflaecheVorschlag?: number | null }) {
  const objekt = <K extends keyof MietvertragDaten['objekt']>(feld: K, wert: MietvertragDaten['objekt'][K]) => {
    setEntwurf(d => ({ ...d, objekt: { ...d.objekt, [feld]: wert } }));
    geaendert?.(`objekt.${feld}`);
  };
  const einrichtungen = einrichtungsListe(entwurf.mitbenutzungEinrichtungen);
  const zentral = entwurf.objekt.heizungsart === 'zentral' || entwurf.objekt.heizungsart === 'fernwaerme';

  return (
    <div className="space-y-3">
      <div>
        <Ueberschrift>Angaben zum Haus</Ueberschrift>
        <p className="text-xs text-muted-foreground">Werden am Objekt gespeichert und gelten für alle weiteren Verträge.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Feldname marke={markierung?.('objekt.heizungsart')}>Heizung</Feldname>
          <Select
            value={entwurf.objekt.heizungsart ?? ''}
            onValueChange={(v: Heizungsart) => {
              // Bei eigener Etagenheizung oder ohne Heizung gibt es keine zentrale Warmwasserbereitung
              setEntwurf(d => ({
                ...d,
                objekt: { ...d.objekt, heizungsart: v, warmwasser: v === 'zentral' || v === 'fernwaerme' ? d.objekt.warmwasser : null },
              }));
              geaendert?.('objekt.heizungsart');
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Bitte wählen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zentral">Zentralheizung</SelectItem>
              <SelectItem value="fernwaerme">Fernwärme</SelectItem>
              <SelectItem value="etage">Etagenheizung (Mieter)</SelectItem>
              <SelectItem value="keine">keine Heizung</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Feldname marke={markierung?.('objekt.warmwasser')}>Warmwasser</Feldname>
          <Select
            value={entwurf.objekt.warmwasser ?? ''}
            onValueChange={(v: Warmwasserart) => objekt('warmwasser', v)}
            disabled={!zentral && entwurf.objekt.heizungsart !== null}
          >
            <SelectTrigger>
              <SelectValue placeholder={zentral || entwurf.objekt.heizungsart === null ? 'Bitte wählen' : 'entfällt'} />
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
          <Feldname htmlFor="gesamtflaeche" marke={markierung?.('objekt.gesamtwohnflaecheQm')}>
            Gesamtwohnfläche Haus (m²)
          </Feldname>
          <ZahlFeld
            id="gesamtflaeche"
            wert={entwurf.objekt.gesamtwohnflaecheQm}
            onWert={n => objekt('gesamtwohnflaecheQm', n && n > 0 ? n : null)}
          />
          {gesamtflaecheVorschlag && gesamtflaecheVorschlag !== entwurf.objekt.gesamtwohnflaecheQm && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => objekt('gesamtwohnflaecheQm', gesamtflaecheVorschlag)}
            >
              Summe der Einheiten übernehmen ({gesamtflaecheVorschlag.toLocaleString('de-DE')} m²)
            </Button>
          )}
        </div>
        <div className="space-y-2">
          <Feldname marke={markierung?.('schliessanlageArt')}>Schließanlage</Feldname>
          <Select
            value={entwurf.schliessanlageArt ?? ''}
            onValueChange={(v: SchliessanlageArt) => {
              setEntwurf(d => ({ ...d, schliessanlageArt: v }));
              geaendert?.('schliessanlageArt');
            }}
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
      </div>

      <div className="space-y-2">
        <Feldname htmlFor="einrichtungen" marke={markierung?.('mitbenutzungEinrichtungen')}>
          Gemeinschaftseinrichtungen zur Mitbenutzung
        </Feldname>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {EINRICHTUNGEN.map(name => {
            const an = einrichtungen.includes(name);
            return (
              <label key={name} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={an}
                  onCheckedChange={c => {
                    const neu = c === true ? [...einrichtungen, name] : einrichtungen.filter(e => e !== name);
                    setEntwurf(d => ({ ...d, mitbenutzungEinrichtungen: neu.length > 0 ? neu.join(', ') : null }));
                    geaendert?.('mitbenutzungEinrichtungen');
                  }}
                />
                {name}
              </label>
            );
          })}
        </div>
        <Input
          id="einrichtungen"
          placeholder="Weitere, durch Komma getrennt"
          value={entwurf.mitbenutzungEinrichtungen ?? ''}
          onChange={e => {
            setEntwurf(d => ({ ...d, mitbenutzungEinrichtungen: e.target.value || null }));
            geaendert?.('mitbenutzungEinrichtungen');
          }}
        />
      </div>
    </div>
  );
}

// ─── Betriebskosten ─────────────────────────────────────────────────────────

/** Aufstellung wie in § 4 der Hausvorlage; die Spalte muss die Vorauszahlung ergeben. */
export function BetriebskostenEditor({ entwurf, setEntwurf, markierung, geaendert }: AbschnittProps) {
  if (entwurf.betriebskostenModus === 'inklusiv') return null;

  const summe = positionenSumme(entwurf);
  const stimmt = Math.round(summe * 100) === Math.round(entwurf.betriebskostenVorauszahlung * 100);

  const aendere = (nummer: string, teil: Partial<BetriebskostenPosition>) => {
    setEntwurf(d => ({
      ...d,
      betriebskostenPositionen: d.betriebskostenPositionen.map(p => (p.nummer === nummer ? { ...p, ...teil } : p)),
    }));
    geaendert?.('betriebskostenPositionen');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="flex flex-wrap items-center text-sm font-semibold">
          Betriebskosten — Aufstellung für § 4
          {markierung?.('betriebskostenPositionen')}
        </Label>
        <span className={stimmt ? 'text-xs text-muted-foreground' : 'text-xs font-medium text-destructive'}>
          {eur(summe)} von {eur(entwurf.betriebskostenVorauszahlung)} €
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Nur angehakte Positionen werden umgelegt. Nicht benannte Kosten sind nach § 556 Abs. 1 BGB nicht umlagefähig.
        Die Einzelbeträge müssen die vereinbarte Vorauszahlung ergeben.
      </p>
      <div className="max-h-72 space-y-1 overflow-y-auto rounded border p-2">
        {entwurf.betriebskostenPositionen.map(pos => (
          <div key={pos.nummer} className="grid grid-cols-[24px_1fr_88px] items-center gap-2">
            <Checkbox
              checked={pos.umgelegt}
              onCheckedChange={c => aendere(pos.nummer, { umgelegt: c === true, betrag: c === true ? pos.betrag : null })}
            />
            <span className="truncate text-xs" title={pos.bezeichnung}>
              <span className="text-muted-foreground">{pos.nummer}</span> {pos.bezeichnung}
            </span>
            <ZahlFeld
              className="h-8 text-right text-xs"
              placeholder="—"
              disabled={!pos.umgelegt}
              wert={pos.betrag}
              onWert={n => aendere(pos.nummer, { betrag: n })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Mieteranschrift (bestehender Vertrag) ──────────────────────────────────

export function MieteranschriftFelder({ entwurf, setEntwurf }: AbschnittProps) {
  const aendere = (index: number, teil: Partial<MietvertragDaten['mieter'][number]>) =>
    setEntwurf(d => ({ ...d, mieter: d.mieter.map((m, i) => (i === index ? { ...m, ...teil } : m)) }));

  return (
    <div className="space-y-3">
      <Ueberschrift>Anschrift {entwurf.mieter.length > 1 ? 'der Mieter' : 'des Mieters'} vor Einzug</Ueberschrift>
      {entwurf.mieter.map((m, i) => (
        <div key={i} className="space-y-2 rounded border p-3">
          <p className="text-xs font-medium">{m.istUnternehmen ? m.firmenname : `${m.vorname} ${m.nachname}`.trim()}</p>
          <div className="grid grid-cols-[1fr_80px] gap-2">
            <Input placeholder="Straße" value={m.strasse ?? ''} onChange={e => aendere(i, { strasse: e.target.value || null })} />
            <Input placeholder="Nr." value={m.hausnummer ?? ''} onChange={e => aendere(i, { hausnummer: e.target.value || null })} />
          </div>
          <div className="grid grid-cols-[90px_1fr] gap-2">
            <Input placeholder="PLZ" value={m.plz ?? ''} onChange={e => aendere(i, { plz: e.target.value || null })} />
            <Input placeholder="Ort" value={m.ort ?? ''} onChange={e => aendere(i, { ort: e.target.value || null })} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Klauseln ───────────────────────────────────────────────────────────────

const ANLAGEN = [
  ['hausordnung', 'Hausordnung'],
  ['betrkvKatalog', 'Betriebskostenkatalog'],
  ['datenschutzhinweis', 'Datenschutzinformation (Art. 13 DSGVO)'],
  ['widerrufsbelehrung', 'Widerrufsbelehrung'],
  ['mietspiegelEinwilligung', 'Einwilligung Mietspiegel (freiwillig)'],
] as const;

export function KlauselFelder({ entwurf, setEntwurf, geaendert }: AbschnittProps) {
  const aendere = <K extends keyof MietvertragDaten>(feld: K, wert: MietvertragDaten[K]) => {
    setEntwurf(d => ({ ...d, [feld]: wert }));
    geaendert?.(feld);
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Zustand bei Übergabe</Label>
        <Select
          value={entwurf.uebergabezustand}
          onValueChange={(v: Uebergabezustand) => {
            // Bei nicht renovierter Übergabe darf keine Schönheitsreparaturklausel gedruckt werden.
            setEntwurf(d => ({
              ...d,
              uebergabezustand: v,
              schoenheitsreparaturen: v === 'renoviert' ? d.schoenheitsreparaturen : false,
            }));
            geaendert?.('uebergabezustand');
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="renoviert">renoviert</SelectItem>
            <SelectItem value="teilrenoviert">teilrenoviert</SelectItem>
            <SelectItem value="unrenoviert">unrenoviert</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          id="schoenheit"
          checked={entwurf.schoenheitsreparaturen}
          disabled={entwurf.uebergabezustand !== 'renoviert'}
          onCheckedChange={c => aendere('schoenheitsreparaturen', c === true)}
        />
        <div className="space-y-1">
          <Label htmlFor="schoenheit" className="leading-tight">
            Schönheitsreparaturen auf den Mieter übertragen
          </Label>
          <p className="text-xs text-muted-foreground">
            {entwurf.uebergabezustand === 'renoviert'
              ? 'Zulässig, weil die Wohnung renoviert übergeben wird.'
              : 'Nicht wählbar: Bei nicht renovierter Übergabe wäre die Klausel insgesamt unwirksam (BGH VIII ZR 185/14).'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="klein-einzel">Kleinreparatur je Fall (€)</Label>
          <ZahlFeld
            id="klein-einzel"
            wert={entwurf.kleinreparaturEinzelgrenze}
            onWert={n => aendere('kleinreparaturEinzelgrenze', n ?? 0)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="klein-jahr">Jahresgrenze (% der Jahresmiete)</Label>
          <ZahlFeld
            id="klein-jahr"
            wert={entwurf.kleinreparaturJahresgrenzeProzent}
            onWert={n => aendere('kleinreparaturJahresgrenzeProzent', n ?? 0)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Mietanpassung</Label>
        <Select value={entwurf.mietanpassungArt} onValueChange={(v: MietanpassungArt) => aendere('mietanpassungArt', v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="keine">gesetzlich (§ 558 BGB)</SelectItem>
            <SelectItem value="staffel">Staffelmiete</SelectItem>
            <SelectItem value="index">Indexmiete</SelectItem>
          </SelectContent>
        </Select>
        {entwurf.mietanpassungArt !== 'keine' && (
          <p className="text-xs text-muted-foreground">
            Staffel- und Indexmiete schließen Mieterhöhungen nach § 558 BGB aus. Das Mieterhöhungsmodul darf für diesen
            Vertrag dann nicht verwendet werden.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="faellig">Miete fällig am … Werktag</Label>
          <ZahlFeld
            id="faellig"
            wert={entwurf.faelligkeitWerktag}
            onWert={n => aendere('faelligkeitWerktag', Math.min(10, Math.max(1, Math.round(n ?? 3))))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="raten">Kaution in … Raten</Label>
          <ZahlFeld
            id="raten"
            wert={entwurf.kautionRaten}
            onWert={n => aendere('kautionRaten', Math.min(3, Math.max(1, Math.round(n ?? 3))))}
          />
        </div>
      </div>

      <div className="space-y-3">
        <Label>Anlagen</Label>
        {ANLAGEN.map(([key, label]) => (
          <div key={key} className="flex items-center gap-2">
            <Checkbox
              id={`anlage-${key}`}
              checked={entwurf.anlagen[key]}
              onCheckedChange={c => aendere('anlagen', { ...entwurf.anlagen, [key]: c === true })}
            />
            <Label htmlFor={`anlage-${key}`} className="text-sm font-normal">
              {label}
            </Label>
          </div>
        ))}
        {entwurf.besichtigtAm && entwurf.anlagen.widerrufsbelehrung && (
          <p className="text-xs text-muted-foreground">
            Der Mieter hat die Wohnung am {new Date(`${entwurf.besichtigtAm}T12:00:00`).toLocaleDateString('de-DE')}{' '}
            besichtigt — damit besteht kein Widerrufsrecht (§ 312 Abs. 4 S. 2 BGB). Die Belehrung wird nicht mitgedruckt.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="zusatz">Individuelle Vereinbarungen (§ 26)</Label>
        <Textarea
          id="zusatz"
          rows={4}
          placeholder="Eine Vereinbarung je Zeile"
          value={entwurf.zusatzvereinbarungen ?? ''}
          onChange={e => aendere('zusatzvereinbarungen', e.target.value || null)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="ort">Ort der Unterzeichnung</Label>
          <Input id="ort" value={entwurf.unterschriftOrt ?? ''} onChange={e => aendere('unterschriftOrt', e.target.value || null)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="datum">Vertragsdatum</Label>
          <Input
            id="datum"
            type="date"
            value={entwurf.vertragsdatum ?? ''}
            onChange={e => aendere('vertragsdatum', e.target.value || null)}
          />
        </div>
      </div>
    </div>
  );
}
