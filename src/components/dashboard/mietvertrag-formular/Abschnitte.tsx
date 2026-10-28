/**
 * Formularabschnitte des Mietvertrags. Gemeinsam für den Generator am
 * bestehenden Vertrag (`MietvertragErstellungModal`) und für den Ablauf
 * „Neuer Mietvertrag" (`mietvertrag-entwurf/`), der sie auf Schritte verteilt
 * und zusätzlich `markierung` und `geaendert` durchreicht, um übernommene
 * Werte kenntlich zu machen.
 *
 * Grundsatz (20.10.2026): Jeder Platzhalter der Vorlage lässt sich hier von
 * Hand setzen — niemand soll im Vorschlag der Automatik festhängen.
 */
import { Plus, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { plusMonate, positionenSumme, SCHLUESSEL_ARTEN } from '@/utils/mietvertrag/entwurf';
import type {
  BetriebskostenPosition,
  Heizungsart,
  MietanpassungArt,
  MietvertragDaten,
  SchliessanlageArt,
  Uebergabezustand,
  Warmwasserart,
} from '@/utils/mietvertrag/typen';
import { Feldname, ZahlFeld, type AbschnittProps } from './Bausteine';

function eur(n: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Ueberschrift({ children, hinweis }: { children: ReactNode; hinweis?: ReactNode }) {
  return (
    <div>
      <Label className="text-sm font-semibold">{children}</Label>
      {hinweis && <p className="text-xs text-muted-foreground">{hinweis}</p>}
    </div>
  );
}

// ─── Mietsache ──────────────────────────────────────────────────────────────

export function MietsacheFelder({
  entwurf,
  setEntwurf,
  markierung,
  geaendert,
  mitPersonenzahl = true,
}: AbschnittProps & { mitPersonenzahl?: boolean }) {
  const einheit = <K extends keyof MietvertragDaten['einheit']>(feld: K, wert: MietvertragDaten['einheit'][K]) => {
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
        <Feldname htmlFor="nebenraeume" marke={markierung?.('einheit.nebenraeume')}>
          Mitvermietete Nebenräume
        </Feldname>
        <Input
          id="nebenraeume"
          placeholder="z. B. Kellerraum Nr. 9, Dachbodenabteil"
          value={entwurf.einheit.nebenraeume ?? ''}
          onChange={e => einheit('nebenraeume', e.target.value || null)}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={entwurf.einheit.einbaukueche} onCheckedChange={c => einheit('einbaukueche', c === true)} />
        Einbauküche ist mitvermietet
        {markierung?.('einheit.einbaukueche')}
      </label>

      {mitPersonenzahl && <PersonenzahlFeld entwurf={entwurf} setEntwurf={setEntwurf} markierung={markierung} geaendert={geaendert} />}
    </div>
  );
}

export function PersonenzahlFeld({ entwurf, setEntwurf, markierung, geaendert }: AbschnittProps) {
  return (
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
        Gehört zum Vertrag, nicht zur Einheit. Wird nicht geschätzt — ohne Angabe ist der Personenschlüssel bei den
        Betriebskosten nicht vereinbarungsfähig.
      </p>
    </div>
  );
}

/** Schlüssel für § 1 Ziff. 3; ohne Angabe nennt der Vertrag das Übergabeprotokoll. */
export function SchluesselFelder({ entwurf, setEntwurf, markierung, geaendert }: AbschnittProps) {
  const anzahl = (name: string) => entwurf.schluessel.find(s => s.art === name)?.anzahl ?? 0;
  const setze = (name: string, n: number) => {
    setEntwurf(d => {
      const uebrige = d.schluessel.filter(s => s.art !== name);
      const neu = n > 0 ? [...uebrige, { art: name, anzahl: n }] : uebrige;
      // Reihenfolge wie in der Vorlage, frei benannte Schlüssel ans Ende
      const rang = (art: string) => {
        const i = SCHLUESSEL_ARTEN.findIndex(a => a.name === art);
        return i < 0 ? 99 : i;
      };
      return { ...d, schluessel: neu.sort((a, b) => rang(a.art) - rang(b.art)) };
    });
    geaendert?.('schluessel');
  };

  return (
    <div className="space-y-2">
      <Feldname marke={markierung?.('schluessel')}>Schlüssel bei Einzug</Feldname>
      <div className="grid grid-cols-3 gap-2">
        {SCHLUESSEL_ARTEN.map(a => (
          <div key={a.key} className="space-y-1">
            <Label htmlFor={`schluessel-${a.key}`} className="text-xs font-normal text-muted-foreground">
              {a.name}
            </Label>
            <ZahlFeld
              id={`schluessel-${a.key}`}
              placeholder="0"
              wert={anzahl(a.name) || null}
              onWert={n => setze(a.name, Math.max(0, Math.round(n ?? 0)))}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Leer gelassen verweist der Vertrag auf die im Übergabeprotokoll aufgeführten Schlüssel.
      </p>
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
      <Ueberschrift hinweis="Werden am Objekt gespeichert und gelten für alle weiteren Verträge.">Angaben zum Haus</Ueberschrift>

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

      {zentral && (
        <div className="space-y-2">
          <Feldname marke={markierung?.('objekt.heizkostenSchluessel')}>Heizkostenverteilung (Verbrauch/Fläche)</Feldname>
          <Select value={entwurf.objekt.heizkostenSchluessel} onValueChange={v => objekt('heizkostenSchluessel', v)}>
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

// ─── Energieausweis ─────────────────────────────────────────────────────────

const EFFIZIENZKLASSEN = ['A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * Energieausweis des Hauses. Steht nicht im Vertrag, ist dem Mieter aber
 * spätestens bei Vertragsschluss vorzulegen (§ 80 Abs. 4 GEG) — die Prüfung
 * erinnert daran. Wird am Objekt gespeichert (20.10.2026: vorher nirgends erfassbar).
 */
export function EnergieausweisFelder({ entwurf, setEntwurf, markierung, geaendert }: AbschnittProps) {
  const e = entwurf.objekt;
  const setze = <
    K extends 'energieausweisTyp' | 'energieKennwert' | 'energietraeger' | 'energieausweisGueltigBis' | 'energieeffizienzklasse',
  >(
    feld: K,
    wert: MietvertragDaten['objekt'][K]
  ) => {
    setEntwurf(d => ({ ...d, objekt: { ...d.objekt, [feld]: wert } }));
    geaendert?.('objekt.energieausweis');
  };

  return (
    <div className="space-y-3">
      <Ueberschrift hinweis="Steht nicht im Vertrag, ist dem Mieter aber spätestens bei Vertragsschluss vorzulegen (§ 80 Abs. 4 GEG). Wird am Objekt gespeichert.">
        Energieausweis
      </Ueberschrift>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Feldname marke={markierung?.('objekt.energieausweis')}>Art</Feldname>
          <Select
            value={e.energieausweisTyp ?? 'keiner'}
            onValueChange={v => setze('energieausweisTyp', v === 'bedarf' || v === 'verbrauch' ? v : null)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="keiner">nicht erfasst</SelectItem>
              <SelectItem value="bedarf">Bedarfsausweis</SelectItem>
              <SelectItem value="verbrauch">Verbrauchsausweis</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="energieausweis-gueltig">gültig bis</Label>
          <Input
            id="energieausweis-gueltig"
            type="date"
            value={e.energieausweisGueltigBis ?? ''}
            onChange={ev => setze('energieausweisGueltigBis', ev.target.value || null)}
          />
        </div>
      </div>
      {e.energieausweisTyp && (
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label htmlFor="energie-kennwert">Kennwert (kWh/(m²·a))</Label>
            <ZahlFeld id="energie-kennwert" wert={e.energieKennwert} onWert={n => setze('energieKennwert', n && n > 0 ? n : null)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="energietraeger">Energieträger</Label>
            <Input
              id="energietraeger"
              placeholder="z. B. Erdgas"
              value={e.energietraeger ?? ''}
              onChange={ev => setze('energietraeger', ev.target.value || null)}
            />
          </div>
          <div className="space-y-2">
            <Label>Effizienzklasse</Label>
            <Select value={e.energieeffizienzklasse ?? ''} onValueChange={v => setze('energieeffizienzklasse', v)}>
              <SelectTrigger>
                <SelectValue placeholder="—" />
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
        </div>
      )}
    </div>
  );
}

// ─── Betriebskosten ─────────────────────────────────────────────────────────

/** Aufstellung wie in § 4 der Hausvorlage; die Spalte muss die Vorauszahlung ergeben. */
export function BetriebskostenEditor({ entwurf, setEntwurf, markierung, geaendert }: AbschnittProps) {
  if (entwurf.betriebskostenModus === 'inklusiv') {
    return (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        Inklusivmiete: Mit der Kaltmiete sind sämtliche Betriebskosten abgegolten, eine Kostenaufstellung entfällt.
      </p>
    );
  }

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
      <div className="space-y-1 rounded border p-2">
        {entwurf.betriebskostenPositionen.map(pos => (
          <div key={pos.nummer} className="grid grid-cols-[24px_1fr_96px] items-center gap-2">
            <Checkbox
              checked={pos.umgelegt}
              aria-label={`${pos.nummer} umlegen`}
              onCheckedChange={c => aendere(pos.nummer, { umgelegt: c === true, betrag: c === true ? pos.betrag : null })}
            />
            <span className="truncate text-xs" title={pos.bezeichnung}>
              <span className="text-muted-foreground">{pos.nummer}</span> {pos.bezeichnung}
            </span>
            <ZahlFeld
              art="betrag"
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

export function UebergabeFelder({ entwurf, setEntwurf, markierung, geaendert }: AbschnittProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Feldname marke={markierung?.('uebergabezustand')}>Zustand bei Übergabe</Feldname>
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
          onCheckedChange={c => {
            setEntwurf(d => ({ ...d, schoenheitsreparaturen: c === true }));
            geaendert?.('schoenheitsreparaturen');
          }}
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
    </div>
  );
}

export function KleinreparaturFelder({ entwurf, setEntwurf, markierung, geaendert }: AbschnittProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-2">
        <Feldname htmlFor="klein-einzel" marke={markierung?.('kleinreparaturEinzelgrenze')}>
          Kleinreparatur je Fall (€)
        </Feldname>
        <ZahlFeld
          art="betrag"
          id="klein-einzel"
          wert={entwurf.kleinreparaturEinzelgrenze}
          onWert={n => {
            setEntwurf(d => ({ ...d, kleinreparaturEinzelgrenze: n ?? 0 }));
            geaendert?.('kleinreparaturEinzelgrenze');
          }}
        />
      </div>
      <div className="space-y-2">
        <Feldname htmlFor="klein-jahr" marke={markierung?.('kleinreparaturJahresgrenzeProzent')}>
          Jahresgrenze (% der Jahresmiete)
        </Feldname>
        <ZahlFeld
          id="klein-jahr"
          wert={entwurf.kleinreparaturJahresgrenzeProzent}
          onWert={n => {
            setEntwurf(d => ({ ...d, kleinreparaturJahresgrenzeProzent: n ?? 0 }));
            geaendert?.('kleinreparaturJahresgrenzeProzent');
          }}
        />
      </div>
    </div>
  );
}

/**
 * Mietanpassung mit Staffelplan und Indexangaben. Ohne diese Felder sperrte
 * die Pflichtprüfung das PDF, sobald jemand Staffel- oder Indexmiete wählte.
 */
export function MietanpassungFelder({
  entwurf,
  setEntwurf,
  markierung,
  geaendert,
  setzeHerkunft,
  indexVorschlag,
}: AbschnittProps & { indexVorschlag?: { wert: number; monat: string } | null }) {
  const staffel = entwurf.staffelplan ?? [];

  const setzeStaffel = (neu: { gueltigAb: string; kaltmiete: number }[]) => {
    setEntwurf(d => ({ ...d, staffelplan: neu }));
    geaendert?.('staffelplan');
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Feldname marke={markierung?.('mietanpassungArt')}>Mietanpassung</Feldname>
        <Select
          value={entwurf.mietanpassungArt}
          onValueChange={(v: MietanpassungArt) => {
            setEntwurf(d => {
              const neu = { ...d, mietanpassungArt: v };
              // Indexmiete: Ausgangswert aus den Marktdaten vorschlagen
              if (v === 'index' && !d.indexBasisWert && indexVorschlag) {
                neu.indexBasisWert = indexVorschlag.wert;
                neu.indexBasisMonat = indexVorschlag.monat;
              }
              return neu;
            });
            geaendert?.('mietanpassungArt');
            if (v === 'index' && !entwurf.indexBasisWert && indexVorschlag) setzeHerkunft?.('indexBasisWert', 'marktdaten');
          }}
        >
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

      {entwurf.mietanpassungArt === 'staffel' && (
        <div className="space-y-2 rounded-md border p-3">
          <Label className="text-xs">Staffelstufen (Nettokaltmiete ab Datum, mindestens 12 Monate Abstand)</Label>
          {staffel.map((s, i) => (
            // Neu einhängen nur beim Hinzufügen/Löschen (nicht beim Tippen): Sonst erbte nach dem
            // Löschen einer ungültigen Zeile die nächste deren rote Markierung samt Sperre (28.10.2026)
            <div key={`${i}-${staffel.length}`} className="grid grid-cols-[1fr_1fr_32px] items-center gap-2">
              <Input
                type="date"
                aria-label={`Stufe ${i + 1} gültig ab`}
                value={s.gueltigAb}
                onChange={e => setzeStaffel(staffel.map((x, j) => (j === i ? { ...x, gueltigAb: e.target.value } : x)))}
              />
              <ZahlFeld
                art="betrag"
                placeholder="Kaltmiete €"
                wert={s.kaltmiete || null}
                onWert={n => setzeStaffel(staffel.map((x, j) => (j === i ? { ...x, kaltmiete: n ?? 0 } : x)))}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-destructive"
                aria-label={`Stufe ${i + 1} entfernen`}
                onClick={() => setzeStaffel(staffel.filter((_, j) => j !== i))}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const letzte = staffel[staffel.length - 1];
              const ab = letzte?.gueltigAb || entwurf.mietbeginn;
              setzeStaffel([
                ...staffel,
                { gueltigAb: ab ? plusMonate(ab, 12) : '', kaltmiete: letzte?.kaltmiete || entwurf.kaltmiete },
              ]);
            }}
          >
            <Plus className="h-4 w-4" />
            Stufe hinzufügen
          </Button>
        </div>
      )}

      {entwurf.mietanpassungArt === 'index' && (
        <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
          <div className="space-y-1">
            <Feldname htmlFor="index-monat" marke={markierung?.('indexBasisWert')}>
              Basismonat
            </Feldname>
            <Input
              id="index-monat"
              type="month"
              value={entwurf.indexBasisMonat?.slice(0, 7) ?? ''}
              onChange={e => {
                setEntwurf(d => ({ ...d, indexBasisMonat: e.target.value ? `${e.target.value}-01` : null }));
                geaendert?.('indexBasisWert');
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="index-wert">Indexstand (VPI, 2020 = 100)</Label>
            <ZahlFeld
              id="index-wert"
              wert={entwurf.indexBasisWert}
              onWert={n => {
                setEntwurf(d => ({ ...d, indexBasisWert: n && n > 0 ? n : null }));
                geaendert?.('indexBasisWert');
              }}
            />
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">
            Maßgeblich ist der zuletzt veröffentlichte Stand bei Vertragsschluss.
          </p>
        </div>
      )}
    </div>
  );
}

/** Fälligkeit und Kautionsraten — im Generator für bestehende Verträge. */
export function ZahlungsterminFelder({ entwurf, setEntwurf, markierung, geaendert }: AbschnittProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-2">
        <Feldname htmlFor="faellig" marke={markierung?.('faelligkeitWerktag')}>
          Miete fällig am … Werktag
        </Feldname>
        <ZahlFeld
          id="faellig"
          wert={entwurf.faelligkeitWerktag}
          onWert={n => {
            setEntwurf(d => ({ ...d, faelligkeitWerktag: Math.min(10, Math.max(1, Math.round(n ?? 3))) }));
            geaendert?.('faelligkeitWerktag');
          }}
        />
      </div>
      <div className="space-y-2">
        <Feldname htmlFor="raten" marke={markierung?.('kautionRaten')}>
          Kaution in … Raten
        </Feldname>
        <ZahlFeld
          id="raten"
          wert={entwurf.kautionRaten}
          onWert={n => {
            setEntwurf(d => ({ ...d, kautionRaten: Math.min(3, Math.max(1, Math.round(n ?? 3))) }));
            geaendert?.('kautionRaten');
          }}
        />
      </div>
    </div>
  );
}

const ANLAGEN = [
  ['hausordnung', 'Hausordnung'],
  ['betrkvKatalog', 'Betriebskostenkatalog'],
  ['datenschutzhinweis', 'Datenschutzinformation (Art. 13 DSGVO)'],
  ['widerrufsbelehrung', 'Widerrufsbelehrung'],
  ['mietspiegelEinwilligung', 'Einwilligung Mietspiegel (freiwillig)'],
] as const;

export function AnlagenFelder({ entwurf, setEntwurf, markierung, geaendert }: AbschnittProps) {
  return (
    <div className="space-y-3">
      <Feldname marke={markierung?.('anlagen')}>Anlagen</Feldname>
      {ANLAGEN.map(([key, label]) => (
        <div key={key} className="flex items-center gap-2">
          <Checkbox
            id={`anlage-${key}`}
            checked={entwurf.anlagen[key]}
            onCheckedChange={c => {
              setEntwurf(d => ({ ...d, anlagen: { ...d.anlagen, [key]: c === true } }));
              geaendert?.('anlagen');
            }}
          />
          <Label htmlFor={`anlage-${key}`} className="text-sm font-normal">
            {label}
          </Label>
        </div>
      ))}
      {entwurf.besichtigtAm && entwurf.anlagen.widerrufsbelehrung && (
        <p className="text-xs text-muted-foreground">
          Der Mieter hat die Wohnung am {new Date(`${entwurf.besichtigtAm}T12:00:00`).toLocaleDateString('de-DE')} besichtigt —
          damit besteht kein Widerrufsrecht (§ 312 Abs. 4 S. 2 BGB). Die Belehrung wird nicht mitgedruckt.
        </p>
      )}
    </div>
  );
}

export function ZusatzvereinbarungFeld({ entwurf, setEntwurf, geaendert }: AbschnittProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="zusatz">Individuelle Vereinbarungen (§ 26)</Label>
      <Textarea
        id="zusatz"
        rows={4}
        placeholder="Eine Vereinbarung je Zeile"
        value={entwurf.zusatzvereinbarungen ?? ''}
        onChange={e => {
          setEntwurf(d => ({ ...d, zusatzvereinbarungen: e.target.value || null }));
          geaendert?.('zusatzvereinbarungen');
        }}
      />
    </div>
  );
}

export function UnterzeichnungFelder({ entwurf, setEntwurf, geaendert }: AbschnittProps) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="ort">Ort der Unterzeichnung</Label>
          <Input
            id="ort"
            value={entwurf.unterschriftOrt ?? ''}
            onChange={e => {
              setEntwurf(d => ({ ...d, unterschriftOrt: e.target.value || null }));
              geaendert?.('unterschriftOrt');
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="datum">Vertragsdatum</Label>
          <Input
            id="datum"
            type="date"
            value={entwurf.vertragsdatum ?? ''}
            onChange={e => {
              setEntwurf(d => ({ ...d, vertragsdatum: e.target.value || null }));
              geaendert?.('vertragsdatum');
            }}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Leer gelassen bleibt die Zeile zum Ausfüllen bei der Unterschrift frei.</p>
    </div>
  );
}

/** Alle Klauselfelder in einem Block — für den Generator am bestehenden Vertrag. */
export function KlauselFelder(props: AbschnittProps) {
  return (
    <div className="space-y-5">
      <UebergabeFelder {...props} />
      <KleinreparaturFelder {...props} />
      <MietanpassungFelder {...props} />
      <ZahlungsterminFelder {...props} />
      <AnlagenFelder {...props} />
      <ZusatzvereinbarungFeld {...props} />
      <UnterzeichnungFelder {...props} />
    </div>
  );
}
