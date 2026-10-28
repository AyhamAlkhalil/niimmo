/**
 * Schritt „Miete & Laufzeit": Mietbeginn, Befristung, Kündigungsverzicht,
 * Miete und Nebenkosten, Kaution, Zahlungsweg, Mietanpassung und
 * Mietpreisbremse.
 *
 * Abgeleitete Werte folgen ihrer Grundlage, bis jemand sie von Hand ändert:
 * die Kaution der Kaltmiete (drei Nettokaltmieten), ein in Monaten
 * vereinbarter Kündigungsverzicht dem Mietbeginn.
 */
import { useEffect, useRef, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { kautionFuer, kuendigungsverzichtNachMonaten, mitMietbeginn, rund2 } from '@/utils/mietvertrag/entwurf';
import { istPlausiblesDatum } from '@/utils/pdf/briefLayout';
import type { Befristungsgrund, BetriebskostenModus, KautionArt } from '@/utils/mietvertrag/typen';
import { MietanpassungFelder } from '../mietvertrag-formular/Abschnitte';
import { Feldname, ZahlFeld, type AbschnittProps } from '../mietvertrag-formular/Bausteine';

function eur(n: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Abschnitt({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <Label className="text-sm font-semibold">{titel}</Label>
      {children}
    </section>
  );
}

interface Props extends AbschnittProps {
  kautionFolgtMiete: boolean;
  verzichtFolgtBeginn: boolean;
  indexVorschlag: { wert: number; monat: string } | null;
  /** Name des ersten Mitmieters — Vorschlag für den Kontoinhaber der Lastschrift. */
  hauptmieter: string | null;
}

export function MieteSchritt({
  entwurf,
  setEntwurf,
  markierung,
  geaendert,
  setzeHerkunft,
  kautionFolgtMiete,
  verzichtFolgtBeginn,
  indexVorschlag,
  hauptmieter,
}: Props) {
  const setze = <K extends keyof typeof entwurf>(feld: K, wert: (typeof entwurf)[K]) => {
    setEntwurf(d => ({ ...d, [feld]: wert }));
    geaendert?.(feld);
  };
  const heizkosten = entwurf.heizkostenVorauszahlung ?? 0;
  const bk = entwurf.betriebskostenModus === 'inklusiv' ? 0 : entwurf.betriebskostenVorauszahlung;
  const summe = rund2(entwurf.kaltmiete + bk + heizkosten);
  const kautionZuHoch = entwurf.kaltmiete > 0 && entwurf.kautionBetrag > entwurf.kaltmiete * 3 + 0.005;
  // Befristet heißt: ein Enddatum ist vorgesehen, auch wenn es noch leer ist ("").
  // So erreicht die Wahl die Pflichtprüfung — ohne Datum entsteht kein Vertrag „auf unbestimmte Zeit".
  const befristet = entwurf.vertragsende !== null || !!entwurf.befristungsgrund;
  // Letzter vollständiger Mietbeginn: Beim Tippen des Jahres liefert das Feld
  // Zwischenstände („0002-11-01", ""), der Verzicht wandert erst mit dem fertigen Datum.
  const letzterBeginn = useRef(istPlausiblesDatum(entwurf.mietbeginn) ? entwurf.mietbeginn : '');
  const beginnGueltig = istPlausiblesDatum(entwurf.mietbeginn);
  // Angehakt heißt: ein Ende ist vereinbart, auch während das Datumsfeld beim Bearbeiten leer ist ("")
  const verzichtGewaehlt = typeof entwurf.kuendigungsverzichtBis === 'string';
  useEffect(() => {
    // Auch von außen gesetzt (Selbstauskunft, während der Schritt offen ist)
    if (istPlausiblesDatum(entwurf.mietbeginn)) letzterBeginn.current = entwurf.mietbeginn;
  }, [entwurf.mietbeginn]);

  return (
    <div className="space-y-5">
      {/* ── Laufzeit ── */}
      <Abschnitt titel="Laufzeit">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Feldname htmlFor="mietbeginn" marke={markierung?.('mietbeginn')}>
              Mietbeginn
            </Feldname>
            <Input
              id="mietbeginn"
              type="date"
              value={entwurf.mietbeginn}
              onChange={e => {
                const neu = e.target.value;
                const alt = letzterBeginn.current;
                if (istPlausiblesDatum(neu)) letzterBeginn.current = neu;
                setEntwurf(d => mitMietbeginn(d, neu, verzichtFolgtBeginn, alt));
                geaendert?.('mietbeginn');
              }}
            />
          </div>
          <div className="space-y-2">
            <Feldname marke={markierung?.('vertragsende')}>Laufzeit</Feldname>
            <Select
              value={befristet ? 'befristet' : 'unbefristet'}
              onValueChange={v => {
                // Nur die Wahl merken: Datum und Grund trägt man selbst ein, geraten wird nichts
                if (v === 'befristet') setEntwurf(d => ({ ...d, vertragsende: d.vertragsende ?? '' }));
                else setEntwurf(d => ({ ...d, vertragsende: null, befristungsgrund: null, befristungsgrundText: null }));
                geaendert?.('vertragsende');
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unbefristet">unbefristet</SelectItem>
                <SelectItem value="befristet">befristet (Zeitmietvertrag)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {befristet && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="vertragsende" className="text-xs">
                  befristet bis
                </Label>
                <Input
                  id="vertragsende"
                  type="date"
                  value={entwurf.vertragsende ?? ''}
                  onChange={e => setze('vertragsende', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Grund (§ 575 BGB)</Label>
                <Select
                  value={entwurf.befristungsgrund ?? ''}
                  onValueChange={(v: Befristungsgrund) => setze('befristungsgrund', v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Bitte wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="eigenbedarf">Eigenbedarf</SelectItem>
                    <SelectItem value="bauliche_massnahme">bauliche Maßnahme</SelectItem>
                    <SelectItem value="dienstwohnung">Werkwohnung</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Input
              placeholder="Erläuterung des Grundes, z. B. wer einziehen soll"
              value={entwurf.befristungsgrundText ?? ''}
              onChange={e => setze('befristungsgrundText', e.target.value || null)}
            />
            <p className="text-xs text-muted-foreground">
              Ohne konkreten Grund gilt ein befristeter Wohnraummietvertrag als unbefristet.
            </p>
          </div>
        )}

        <div className="space-y-2 rounded-md border p-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={verzichtGewaehlt}
              // Ohne vollständigen Mietbeginn lässt sich kein Ende berechnen
              disabled={!verzichtGewaehlt && !beginnGueltig}
              onCheckedChange={c => {
                if (c === true) {
                  setEntwurf(d => ({
                    ...d,
                    kuendigungsverzichtBis: istPlausiblesDatum(d.mietbeginn) ? kuendigungsverzichtNachMonaten(d.mietbeginn, 12) : null,
                  }));
                  geaendert?.('kuendigungsverzichtBis');
                  setzeHerkunft?.('kuendigungsverzichtBis', 'berechnet');
                } else {
                  setze('kuendigungsverzichtBis', null);
                }
              }}
            />
            Beidseitiger Kündigungsverzicht
            {markierung?.('kuendigungsverzichtBis')}
          </label>
          {verzichtGewaehlt && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">bis</span>
              <Input
                type="date"
                aria-label="Kündigungsverzicht bis"
                className="w-auto"
                value={entwurf.kuendigungsverzichtBis ?? ''}
                onChange={e => setze('kuendigungsverzichtBis', e.target.value)}
              />
              {[12, 24].map(m => (
                <Button
                  key={m}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={!beginnGueltig}
                  onClick={() => {
                    if (!istPlausiblesDatum(entwurf.mietbeginn)) return;
                    setEntwurf(d => ({ ...d, kuendigungsverzichtBis: kuendigungsverzichtNachMonaten(d.mietbeginn, m) }));
                    geaendert?.('kuendigungsverzichtBis');
                    setzeHerkunft?.('kuendigungsverzichtBis', 'berechnet');
                  }}
                >
                  {m / 12} {m === 12 ? 'Jahr' : 'Jahre'}
                </Button>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Höchstens vier Jahre ab Vertragsschluss. Die NiImmo-Vorlage vom 01.06.2025 vereinbart ein Jahr.
          </p>
        </div>
      </Abschnitt>

      <Separator />

      {/* ── Miete und Nebenkosten ── */}
      <Abschnitt titel="Miete und Nebenkosten">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Feldname htmlFor="kaltmiete" marke={markierung?.('kaltmiete')}>
              Kaltmiete (€)
            </Feldname>
            <ZahlFeld
              art="betrag"
              id="kaltmiete"
              wert={entwurf.kaltmiete || null}
              onWert={n => {
                const kalt = n ?? 0;
                // Folgt, solange die Kaution leer ist oder genau drei Kaltmieten beträgt —
                // sonst bliebe beim Tippen von „800" die Kaution der ersten Ziffer stehen.
                const folgt =
                  entwurf.kautionArt !== 'keine' &&
                  (kautionFolgtMiete ||
                    entwurf.kautionBetrag === 0 ||
                    Math.abs(entwurf.kautionBetrag - kautionFuer(entwurf.kaltmiete)) < 0.005);
                setEntwurf(d => ({ ...d, kaltmiete: kalt, kautionBetrag: folgt ? kautionFuer(kalt) : d.kautionBetrag }));
                geaendert?.('kaltmiete');
                if (folgt) setzeHerkunft?.('kautionBetrag', 'berechnet');
              }}
            />
          </div>
          <div className="space-y-2">
            <Feldname marke={markierung?.('betriebskostenModus')}>Betriebskosten</Feldname>
            <Select
              value={entwurf.betriebskostenModus}
              onValueChange={(v: BetriebskostenModus) => setze('betriebskostenModus', v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vorauszahlung">Vorauszahlung mit Abrechnung</SelectItem>
                <SelectItem value="pauschale">Pauschale</SelectItem>
                <SelectItem value="inklusiv">Inklusivmiete</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {entwurf.betriebskostenModus !== 'inklusiv' ? (
            <div className="space-y-2">
              <Feldname htmlFor="bk" marke={markierung?.('betriebskostenVorauszahlung')}>
                {entwurf.betriebskostenModus === 'pauschale' ? 'Pauschale (€)' : 'Vorauszahlung (€)'}
              </Feldname>
              <ZahlFeld
                art="betrag"
                id="bk"
                wert={entwurf.betriebskostenVorauszahlung || null}
                onWert={n => setze('betriebskostenVorauszahlung', n ?? 0)}
              />
            </div>
          ) : (
            <p className="self-end pb-2 text-xs text-muted-foreground">Betriebskosten sind mit der Miete abgegolten.</p>
          )}
          <div className="space-y-2">
            <Feldname htmlFor="hk" marke={markierung?.('heizkostenVorauszahlung')}>
              Heizkosten (€)
            </Feldname>
            <ZahlFeld
              art="betrag"
              id="hk"
              placeholder="nicht getrennt"
              wert={entwurf.heizkostenVorauszahlung}
              onWert={n => setze('heizkostenVorauszahlung', n && n > 0 ? n : null)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Monatlich insgesamt <span className="font-medium text-foreground">{eur(summe)} €</span>. Heizkosten getrennt
          ausweisen, wenn sie nach der Heizkostenverordnung abgerechnet werden.
        </p>
      </Abschnitt>

      <Separator />

      {/* ── Kaution ── */}
      <Abschnitt titel="Kaution">
        <div className="grid grid-cols-[1.2fr_1fr_0.8fr] gap-3">
          <div className="space-y-2">
            <Feldname marke={markierung?.('kautionArt')}>Art</Feldname>
            <Select value={entwurf.kautionArt} onValueChange={(v: KautionArt) => setze('kautionArt', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="barkaution">Barkaution</SelectItem>
                <SelectItem value="buergschaft">Bürgschaft</SelectItem>
                <SelectItem value="verpfaendung">Verpfändung eines Guthabens</SelectItem>
                <SelectItem value="sparbuch">Sparbuch</SelectItem>
                <SelectItem value="keine">keine Kaution</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {entwurf.kautionArt !== 'keine' && (
            <div className="space-y-2">
              <Feldname htmlFor="kaution" marke={markierung?.('kautionBetrag')}>
                Betrag (€)
              </Feldname>
              <ZahlFeld art="betrag" id="kaution" wert={entwurf.kautionBetrag || null} onWert={n => setze('kautionBetrag', n ?? 0)} />
            </div>
          )}
          {entwurf.kautionArt === 'barkaution' && (
            <div className="space-y-2">
              <Feldname htmlFor="raten" marke={markierung?.('kautionRaten')}>
                Raten
              </Feldname>
              <ZahlFeld
                id="raten"
                wert={entwurf.kautionRaten}
                onWert={n => setze('kautionRaten', Math.min(3, Math.max(1, Math.round(n ?? 3))))}
              />
            </div>
          )}
        </div>
        {kautionZuHoch && (
          <p className="text-xs text-destructive">Höchstens drei Nettokaltmieten ({eur(entwurf.kaltmiete * 3)} €, § 551 BGB).</p>
        )}
      </Abschnitt>

      <Separator />

      {/* ── Zahlung ── */}
      <Abschnitt titel="Zahlung">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Feldname htmlFor="faellig" marke={markierung?.('faelligkeitWerktag')}>
              Fällig am … Werktag
            </Feldname>
            <ZahlFeld
              id="faellig"
              wert={entwurf.faelligkeitWerktag}
              onWert={n => setze('faelligkeitWerktag', Math.min(10, Math.max(1, Math.round(n ?? 3))))}
            />
          </div>
          <div className="flex items-end justify-between gap-2 pb-2">
            <Label htmlFor="lastschrift">SEPA-Lastschrift</Label>
            <Switch id="lastschrift" checked={entwurf.lastschrift} onCheckedChange={c => setze('lastschrift', c)} />
          </div>
        </div>
        {entwurf.lastschrift ? (
          <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
            <Input
              placeholder="IBAN des Mieters"
              aria-label="IBAN des Mieters"
              value={entwurf.lastschriftIban ?? ''}
              onChange={e => setze('lastschriftIban', e.target.value || null)}
            />
            <div className="flex gap-1">
              <Input
                placeholder="Kontoinhaber"
                aria-label="Kontoinhaber"
                value={entwurf.lastschriftKontoinhaber ?? ''}
                onChange={e => setze('lastschriftKontoinhaber', e.target.value || null)}
              />
              {hauptmieter && !entwurf.lastschriftKontoinhaber && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-10 shrink-0 text-xs"
                  onClick={() => setze('lastschriftKontoinhaber', hauptmieter)}
                >
                  Mieter
                </Button>
              )}
            </div>
            <Input
              placeholder="BIC (optional)"
              aria-label="BIC"
              value={entwurf.lastschriftBic ?? ''}
              onChange={e => setze('lastschriftBic', e.target.value || null)}
            />
            <Input
              placeholder="Mandatsreferenz (optional)"
              aria-label="Mandatsreferenz"
              value={entwurf.sepaMandatsreferenz ?? ''}
              onChange={e => setze('sepaMandatsreferenz', e.target.value || null)}
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Der Mieter überweist auf das Mietkonto {entwurf.vermieter.mietIban ?? '— nicht hinterlegt'}.
          </p>
        )}
      </Abschnitt>

      <Separator />

      <MietanpassungFelder
        entwurf={entwurf}
        setEntwurf={setEntwurf}
        markierung={markierung}
        geaendert={geaendert}
        setzeHerkunft={setzeHerkunft}
        indexVorschlag={indexVorschlag}
      />

      {entwurf.objekt.istAngespannt && (
        <>
          <Separator />
          <Abschnitt titel="Mietpreisbremse">
            <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3">
              <p className="text-xs">{entwurf.objekt.ort} gilt als angespannter Wohnungsmarkt.</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Feldname htmlFor="vormiete" marke={markierung?.('vormieteNetto')}>
                    <span className="text-xs">Vormiete netto (€)</span>
                  </Feldname>
                  <ZahlFeld
                    art="betrag"
                    id="vormiete"
                    wert={entwurf.vormieteNetto}
                    onWert={n => setze('vormieteNetto', n && n > 0 ? n : null)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="vormiete-bis" className="text-xs">
                    Vormiete geschuldet bis
                  </Label>
                  <Input
                    id="vormiete-bis"
                    type="date"
                    value={entwurf.vormieteBis ?? ''}
                    onChange={e => setze('vormieteBis', e.target.value || null)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="auskunft" className="text-xs">
                  Auskunft nach § 556g Abs. 1a BGB in Textform erteilt am
                </Label>
                <Input
                  id="auskunft"
                  type="date"
                  value={entwurf.mietpreisbremseAuskunftAm ?? ''}
                  onChange={e => setze('mietpreisbremseAuskunftAm', e.target.value || null)}
                />
                <p className="text-xs text-muted-foreground">
                  Liegt die neue Kaltmiete nicht über der Vormiete, greift die Ausnahme nach § 556e BGB — sie muss aber vor
                  Vertragsschluss in der Auskunft genannt sein. Ohne Datum entsteht kein PDF.
                </p>
              </div>
            </div>
          </Abschnitt>
        </>
      )}
    </div>
  );
}
