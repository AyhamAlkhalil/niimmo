/**
 * „Weitere Anlagen (PDF)“ im Generator (Besprechung 12.11.2026): eigene PDF-Dateien oder PDF-Dokumente des Vertrags,
 * in frei wählbarer Reihenfolge. Sie kommen beim Speichern unverändert hinter die letzte Vertragsseite
 * (`anlagenAnhaengen`); die Vorschau zeigt den Vertrag ohne sie.
 */
import { useRef } from 'react';
import { ArrowDown, ArrowUp, FilePlus2, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AnlagenKandidat } from '@/hooks/useMietvertragAnlagen';
import { anlagenName, verschiebe } from '@/utils/mietvertrag/anlagenListe';

export interface GewaehlteAnlage {
  /** Stabiler Schlüssel für die Liste. */
  schluessel: string;
  titel: string;
  /** Vorhandenes Dokument des Vertrags … */
  dokumentId: string | null;
  pfad: string | null;
  /** … oder eine neu gewählte Datei, die beim Speichern als Dokument abgelegt wird. */
  datei: File | null;
}

interface Props {
  anlagen: GewaehlteAnlage[];
  setAnlagen: (aenderung: (alt: GewaehlteAnlage[]) => GewaehlteAnlage[]) => void;
  kandidaten: AnlagenKandidat[];
  laedt: boolean;
  fehler: boolean;
  onErneutLaden: () => void;
  gesperrt?: boolean;
}

export function PdfAnlagenFelder({ anlagen, setAnlagen, kandidaten, laedt, fehler, onErneutLaden, gesperrt }: Props) {
  const eingabe = useRef<HTMLInputElement>(null);
  const frei = kandidaten.filter(k => !anlagen.some(a => a.dokumentId === k.id));

  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold">Weitere Anlagen (PDF)</Label>
      <p className="text-xs text-muted-foreground">
        Werden nach der letzten Vertragsseite angehängt, in dieser Reihenfolge und unverändert. Die Vorschau zeigt den
        Vertrag ohne sie.
      </p>

      {anlagen.length > 0 && (
        <ol className="space-y-1.5">
          {anlagen.map((a, i) => (
            <li key={a.schluessel} className="flex items-center gap-1.5 rounded border px-2 py-1.5 text-sm">
              <span className="w-5 shrink-0 text-xs text-muted-foreground">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate" title={a.titel}>
                {a.titel}
                {a.datei && <span className="text-xs text-muted-foreground"> · neu</span>}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label={`${a.titel} nach oben`}
                disabled={gesperrt || i === 0}
                onClick={() => setAnlagen(alt => verschiebe(alt, i, -1))}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label={`${a.titel} nach unten`}
                disabled={gesperrt || i === anlagen.length - 1}
                onClick={() => setAnlagen(alt => verschiebe(alt, i, 1))}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label={`${a.titel} entfernen`}
                disabled={gesperrt}
                onClick={() => setAnlagen(alt => alt.filter(x => x.schluessel !== a.schluessel))}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={gesperrt} onClick={() => eingabe.current?.click()}>
          <FilePlus2 className="h-3.5 w-3.5" />
          PDF hinzufügen
        </Button>
        <input
          ref={eingabe}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          aria-label="PDF-Anlage wählen"
          onChange={e => {
            const dateien = Array.from(e.target.files ?? []);
            if (dateien.length > 0) {
              setAnlagen(alt => [
                ...alt,
                ...dateien.map(datei => ({
                  schluessel: crypto.randomUUID(),
                  titel: anlagenName(datei.name),
                  dokumentId: null,
                  pfad: null,
                  datei,
                })),
              ]);
            }
            e.target.value = '';
          }}
        />
        {laedt ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Dokumente werden geladen …
          </span>
        ) : fehler ? (
          <span className="text-xs text-destructive">
            Die Dokumente des Vertrags konnten nicht geladen werden.{' '}
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onErneutLaden}>
              Erneut laden
            </Button>
          </span>
        ) : (
          frei.length > 0 && (
            <Select
              value=""
              disabled={gesperrt}
              onValueChange={id => {
                const k = frei.find(x => x.id === id);
                if (k) {
                  setAnlagen(alt => [...alt, { schluessel: k.id, titel: k.titel, dokumentId: k.id, pfad: k.pfad, datei: null }]);
                }
              }}
            >
              <SelectTrigger className="h-8 w-auto min-w-[14rem] text-xs" aria-label="Dokument des Vertrags anhängen">
                <SelectValue placeholder="Aus den Dokumenten des Vertrags …" />
              </SelectTrigger>
              <SelectContent>
                {frei.map(k => (
                  <SelectItem key={k.id} value={k.id} className="text-xs">
                    {k.titel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        )}
      </div>
    </div>
  );
}
