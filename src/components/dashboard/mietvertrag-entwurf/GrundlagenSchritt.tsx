/**
 * Schritt 1 „Grundlagen": die Quellen, aus denen die Platzhalter der Vorlage
 * befüllt werden — Objekt, Einheit, Vermieterstammdaten und Vorvertrag.
 */
import type { ReactNode } from 'react';
import { Building2, DoorOpen, Landmark } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { EntwurfGrundlagenDaten } from '@/hooks/useMietvertragEntwurf';
import type { Herkunft } from '@/utils/mietvertrag/entwurf';
import type { MietvertragDaten } from '@/utils/mietvertrag/typen';
import { HerkunftHinweis } from '../mietvertrag-formular/Bausteine';
import { VorvertragAbschnitt, type AusleseStatus } from './VorvertragAbschnitt';

interface Props {
  g: EntwurfGrundlagenDaten;
  daten: MietvertragDaten;
  vorvertragPfad: string | null;
  setVorvertragPfad: (pfad: string) => void;
  ausleseStatus: AusleseStatus;
  onAuslesen: () => void;
  onVermieterBearbeiten: () => void;
  onDirektErfassen?: () => void;
}

function Karte({ titel, symbol, children, aktion }: { titel: string; symbol: ReactNode; children: ReactNode; aktion?: ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          {symbol}
          {titel}
        </p>
        {aktion}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">{children}</dl>
    </div>
  );
}

function Zeile({ label, wert }: { label: string; wert: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{wert || <span className="text-muted-foreground">— nicht erfasst</span>}</dd>
    </>
  );
}

const HEIZUNG: Record<string, string> = {
  zentral: 'Zentralheizung',
  fernwaerme: 'Fernwärme',
  etage: 'Etagenheizung (Mieter)',
  keine: 'keine Heizung',
};

const QUELLEN: { quelle: Herkunft; text: string }[] = [
  { quelle: 'objekt', text: 'Objekt' },
  { quelle: 'einheit', text: 'Einheit' },
  { quelle: 'vorvertrag', text: 'Vorvertrag' },
  { quelle: 'selbstauskunft', text: 'Selbstauskunft' },
  { quelle: 'stammdaten', text: 'Vermieter' },
  { quelle: 'vorgabe', text: 'Standard der Vorlage' },
  { quelle: 'berechnet', text: 'aus anderen Werten' },
];

export function GrundlagenSchritt({
  g,
  daten,
  vorvertragPfad,
  setVorvertragPfad,
  ausleseStatus,
  onAuslesen,
  onVermieterBearbeiten,
  onDirektErfassen,
}: Props) {
  const imm = g.immobilie;
  const adresse = [`${imm.strasse ?? ''} ${imm.hausnummer ?? ''}`.trim(), `${imm.plz ?? ''} ${imm.ort ?? ''}`.trim()]
    .filter(Boolean)
    .join(', ');
  const v = daten.vermieter;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm">
          Der Mietvertrag ist eine feste Vorlage. Dieser Ablauf füllt nur ihre Platzhalter — aus den Quellen unten, aus
          der Selbstauskunft und aus deinen Eingaben. Jeder übernommene Wert ist gekennzeichnet und lässt sich in seinem
          Schritt ändern.
        </p>
        <div className="flex flex-wrap items-center gap-y-1 text-xs text-muted-foreground">
          {QUELLEN.map(q => (
            <span key={q.quelle} className="mr-2 flex items-center">
              <HerkunftHinweis quelle={q.quelle} vorvertragBeginn={g.vorvertrag?.start_datum ?? null} />
              <span className="ml-1">{q.text}</span>
            </span>
          ))}
          <span>· ohne Marke: von Hand erfasst</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Karte titel="Objekt" symbol={<Building2 className="h-4 w-4 text-primary" />}>
          <Zeile label="Name" wert={imm.name?.trim()} />
          <Zeile label="Anschrift" wert={adresse} />
          <Zeile label="Heizung" wert={imm.heizungsart ? HEIZUNG[imm.heizungsart] : null} />
          <Zeile label="Gesamtfläche" wert={imm.gesamtwohnflaeche ? `${Number(imm.gesamtwohnflaeche).toLocaleString('de-DE')} m²` : null} />
          <Zeile label="Mietpreisbremse" wert={imm.ist_angespannt ? 'ja — angespannter Wohnungsmarkt' : 'nein'} />
        </Karte>
        <Karte titel="Einheit" symbol={<DoorOpen className="h-4 w-4 text-primary" />}>
          <Zeile label="Art" wert={g.einheit.einheitentyp} />
          <Zeile label="Bezeichnung" wert={g.einheit.bezeichnung} />
          <Zeile label="Lage" wert={g.einheit.etage} />
          <Zeile label="Wohnfläche" wert={g.einheit.qm ? `${Number(g.einheit.qm).toLocaleString('de-DE')} m²` : null} />
        </Karte>
      </div>

      <Karte
        titel="Vermieter"
        symbol={<Landmark className="h-4 w-4 text-primary" />}
        aktion={
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onVermieterBearbeiten}>
            Stammdaten bearbeiten
          </Button>
        }
      >
        <Zeile label="Firma" wert={v.firmenname} />
        <Zeile label="Anschrift" wert={[`${v.strasse} ${v.hausnummer}`.trim(), `${v.plz} ${v.ort}`.trim()].filter(Boolean).join(', ')} />
        <Zeile label="vertreten durch" wert={v.vertretenDurch.join(', ')} />
        <Zeile label="Mietkonto" wert={v.mietIban} />
        <Zeile label="Kautionskonto" wert={v.kautionIban} />
      </Karte>

      <VorvertragAbschnitt
        vorvertrag={g.vorvertrag}
        mieter={g.vorvertragMieter}
        dokumente={g.vorvertragDokumente}
        gewaehlt={vorvertragPfad}
        setGewaehlt={setVorvertragPfad}
        status={ausleseStatus}
        onAuslesen={onAuslesen}
      />

      {onDirektErfassen && (
        <p className="text-xs text-muted-foreground">
          Der Vertrag ist schon unterschrieben und soll nur erfasst werden?{' '}
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onDirektErfassen}>
            Bestehenden Vertrag direkt erfassen
          </Button>
        </p>
      )}
    </div>
  );
}
