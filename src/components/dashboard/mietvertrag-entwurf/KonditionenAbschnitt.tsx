/**
 * Miete, Nebenkosten, Kaution, Termine und Mietpreisbremse des Entwurfs.
 * Die Kaution folgt der Kaltmiete (drei Nettokaltmieten), bis sie von Hand
 * geändert wird.
 */
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { kautionFuer, rund2 } from '@/utils/mietvertrag/entwurf';
import { ZahlFeld, type AbschnittProps } from '../mietvertrag-formular/Bausteine';

function eur(n: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function KonditionenAbschnitt({
  entwurf,
  setEntwurf,
  markierung,
  geaendert,
  kautionFolgtMiete,
  onKautionBerechnet,
}: AbschnittProps & { kautionFolgtMiete: boolean; onKautionBerechnet?: () => void }) {
  const setze = <K extends keyof typeof entwurf>(feld: K, wert: (typeof entwurf)[K]) => {
    setEntwurf(d => ({ ...d, [feld]: wert }));
    geaendert?.(feld);
  };
  const heizkosten = entwurf.heizkostenVorauszahlung ?? 0;
  const summe = rund2(entwurf.kaltmiete + entwurf.betriebskostenVorauszahlung + heizkosten);
  const kautionZuHoch = entwurf.kaltmiete > 0 && entwurf.kautionBetrag > entwurf.kaltmiete * 3 + 0.005;

  return (
    <div className="space-y-3">
      <Label className="text-sm font-semibold">Miete und Termine</Label>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="mietbeginn" className="flex flex-wrap items-center gap-y-1">
            Mietbeginn{markierung?.('mietbeginn')}
          </Label>
          <Input
            id="mietbeginn"
            type="date"
            value={entwurf.mietbeginn}
            onChange={e => setze('mietbeginn', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="besichtigt">Besichtigt am</Label>
          <Input
            id="besichtigt"
            type="date"
            value={entwurf.besichtigtAm ?? ''}
            onChange={e => setze('besichtigtAm', e.target.value || null)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="kaltmiete" className="flex flex-wrap items-center gap-y-1">
            Kaltmiete (€){markierung?.('kaltmiete')}
          </Label>
          <ZahlFeld
            id="kaltmiete"
            wert={entwurf.kaltmiete || null}
            onWert={n => {
              const kalt = n ?? 0;
              // Folgt, solange die Kaution leer ist oder genau drei Kaltmieten beträgt —
              // sonst bliebe beim Tippen von „800" die Kaution der ersten Ziffer stehen.
              const folgt =
                kautionFolgtMiete ||
                entwurf.kautionBetrag === 0 ||
                Math.abs(entwurf.kautionBetrag - kautionFuer(entwurf.kaltmiete)) < 0.005;
              setEntwurf(d => ({ ...d, kaltmiete: kalt, kautionBetrag: folgt ? kautionFuer(kalt) : d.kautionBetrag }));
              geaendert?.('kaltmiete');
              if (folgt) onKautionBerechnet?.();
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="kaution" className="flex flex-wrap items-center gap-y-1">
            Kaution (€){markierung?.('kautionBetrag')}
          </Label>
          <ZahlFeld id="kaution" wert={entwurf.kautionBetrag || null} onWert={n => setze('kautionBetrag', n ?? 0)} />
          {kautionZuHoch && (
            <p className="text-xs text-destructive">Höchstens drei Nettokaltmieten ({eur(entwurf.kaltmiete * 3)} €).</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="bk" className="flex flex-wrap items-center gap-y-1">
            Betriebskosten (€){markierung?.('betriebskostenVorauszahlung')}
          </Label>
          <ZahlFeld
            id="bk"
            wert={entwurf.betriebskostenVorauszahlung || null}
            onWert={n => setze('betriebskostenVorauszahlung', n ?? 0)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="hk" className="flex flex-wrap items-center gap-y-1">
            Heizkosten (€){markierung?.('heizkostenVorauszahlung')}
          </Label>
          <ZahlFeld
            id="hk"
            placeholder="in Betriebskosten enthalten"
            wert={entwurf.heizkostenVorauszahlung}
            onWert={n => setze('heizkostenVorauszahlung', n && n > 0 ? n : null)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Monatlich insgesamt <span className="font-medium text-foreground">{eur(summe)} €</span>. Heizkosten getrennt
        ausweisen, wenn sie nach Heizkostenverordnung abgerechnet werden.
      </p>

      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="lastschrift">SEPA-Lastschrift</Label>
          <Switch id="lastschrift" checked={entwurf.lastschrift} onCheckedChange={c => setze('lastschrift', c)} />
        </div>
        {entwurf.lastschrift && (
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="IBAN des Mieters"
              value={entwurf.lastschriftIban ?? ''}
              onChange={e => setze('lastschriftIban', e.target.value || null)}
            />
            <Input
              placeholder="Kontoinhaber"
              value={entwurf.lastschriftKontoinhaber ?? ''}
              onChange={e => setze('lastschriftKontoinhaber', e.target.value || null)}
            />
          </div>
        )}
      </div>

      {entwurf.objekt.istAngespannt && (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3">
          <p className="text-xs font-medium">
            Mietpreisbremse: {entwurf.objekt.ort} gilt als angespannter Wohnungsmarkt.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="vormiete" className="flex flex-wrap items-center gap-y-1 text-xs">
                Vormiete netto (€){markierung?.('vormieteNetto')}
              </Label>
              <ZahlFeld id="vormiete" wert={entwurf.vormieteNetto} onWert={n => setze('vormieteNetto', n && n > 0 ? n : null)} />
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
              Vertragsschluss in der Auskunft genannt sein. Ohne Datum wird kein Vertrag erzeugt.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
