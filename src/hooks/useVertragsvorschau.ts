/**
 * Live-Vorschau des Mietvertrags für Generator und Vertragsentwurf.
 */
import { useEffect, useRef, useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import { generateMietvertragPdf } from '@/utils/mietvertrag/mietvertragPdfGenerator';
import type { MietvertragDaten } from '@/utils/mietvertrag/typen';

/**
 * Erzeugt das PDF bei jeder Änderung neu (entprellt). Gesperrt, solange die
 * Pflichtprüfung blockiert — ein Vertrag darf nichts behaupten, was nicht erfasst ist.
 */
export function useVertragsvorschau(daten: MietvertragDaten | null, aktiv: boolean, gesperrt: boolean) {
  const { toast } = useToast();
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [erzeugt, setErzeugt] = useState(false);
  const [erzeugtFuer, setErzeugtFuer] = useState<string | null>(null);
  const [fehlerFuer, setFehlerFuer] = useState<string | null>(null);
  const schluessel = daten ? JSON.stringify(daten) : '';
  const lauf = useRef(0);

  useEffect(() => {
    if (!aktiv || !daten || gesperrt) {
      lauf.current += 1;
      setPdfBlob(null);
      setErzeugt(false);
      return;
    }
    const nummer = ++lauf.current;
    const zeitgeber = setTimeout(async () => {
      setErzeugt(true);
      try {
        const blob = await generateMietvertragPdf(daten);
        // Eine ältere, langsamere Erzeugung darf eine neuere nicht überschreiben
        if (nummer !== lauf.current) return;
        setPdfBlob(blob);
        setErzeugtFuer(schluessel);
        setPdfUrl(alt => {
          if (alt) URL.revokeObjectURL(alt);
          return URL.createObjectURL(blob);
        });
      } catch (e) {
        if (nummer !== lauf.current) return;
        setFehlerFuer(schluessel);
        toast({
          title: 'Vorschau fehlgeschlagen',
          description: e instanceof Error ? e.message : 'Unbekannter Fehler',
          variant: 'destructive',
        });
      } finally {
        if (nummer === lauf.current) setErzeugt(false);
      }
    }, 500);
    return () => clearTimeout(zeitgeber);
    // Der Schlüssel fasst alle Felder zusammen; `daten` selbst ist bei jedem Render neu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktiv, gesperrt, schluessel]);

  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl]
  );

  return {
    pdfBlob: gesperrt ? null : pdfBlob,
    pdfUrl,
    erzeugt,
    /** Das PDF passt zum aktuellen Stand — erst dann darf es gespeichert werden. */
    aktuell: !gesperrt && !!pdfBlob && erzeugtFuer === schluessel,
    /** Die Erzeugung ist für den aktuellen Stand gescheitert — Speichern geht dann ohne PDF. */
    fehlgeschlagen: !gesperrt && fehlerFuer === schluessel,
  };
}
