import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { ladePdfjs } from "@/utils/pdfjs";

interface PdfSeitenVorschauProps {
  pdf: Blob;
}

/**
 * Zeigt ein PDF als gezeichnete Seiten untereinander.
 *
 * Auf dem Handy taugt ein <iframe> mit Blob-URL nicht: Chrome auf Android hat
 * keinen eingebauten PDF-Betrachter und zeigt eine leere Fläche, Safari rendert
 * Blob-URLs in iframes gar nicht. Bis zum 17.10.2026 ließ sich das
 * Übergabeprotokoll auf dem Handy deshalb vor dem Speichern nicht ansehen.
 *
 * Die Seiten werden direkt in den Behälter gezeichnet; React rendert dort
 * nichts hinein, damit sich beides nicht in die Quere kommt. Eine neue Fassung
 * ersetzt die alte erst, wenn alle Seiten fertig sind (kein Springen beim
 * Aktualisieren); scheitert sie, verschwindet die alte, damit niemand eine
 * überholte Fassung für die aktuelle hält.
 */

/** Gibt den Pixelspeicher frei — iOS Safari tut das bei verworfenen Canvas nur verzögert. */
const freigeben = (behaelter: HTMLElement) => {
  behaelter.querySelectorAll("canvas").forEach((c) => {
    c.width = 0;
    c.height = 0;
  });
  behaelter.replaceChildren();
};

export const PdfSeitenVorschau = ({ pdf }: PdfSeitenVorschauProps) => {
  const behaelterRef = useRef<HTMLDivElement>(null);
  const [zustand, setZustand] = useState<"laedt" | "fertig" | "fehler">("laedt");

  useEffect(() => {
    const behaelter = behaelterRef.current;
    if (!behaelter) return;
    let abgebrochen = false;
    let dokument: { destroy: () => unknown } | null = null;
    setZustand("laedt");

    (async () => {
      try {
        const pdfjs = await ladePdfjs();
        const geladen = await pdfjs.getDocument({ data: await pdf.arrayBuffer(), disableRange: true, disableStream: true }).promise;
        dokument = geladen;
        if (abgebrochen) return;
        const breite = behaelter.clientWidth || 360;
        // Mehr als doppelte Auflösung bringt auf dem Handy nichts, kostet aber Speicher
        const aufloesung = Math.min(window.devicePixelRatio || 1, 2);
        const seiten: HTMLCanvasElement[] = [];
        for (let nummer = 1; nummer <= geladen.numPages; nummer++) {
          const seite = await geladen.getPage(nummer);
          if (abgebrochen) return;
          const ansicht = seite.getViewport({ scale: (breite / seite.getViewport({ scale: 1 }).width) * aufloesung });
          const leinwand = document.createElement("canvas");
          leinwand.width = Math.floor(ansicht.width);
          leinwand.height = Math.floor(ansicht.height);
          leinwand.className = "w-full rounded border bg-white";
          leinwand.setAttribute("aria-label", `Seite ${nummer} von ${geladen.numPages}`);
          seiten.push(leinwand);
          const zeichenflaeche = leinwand.getContext("2d");
          if (!zeichenflaeche) throw new Error("Kein Zeichenkontext");
          await seite.render({ canvasContext: zeichenflaeche, viewport: ansicht }).promise;
          if (abgebrochen) {
            seiten.forEach((c) => { c.width = 0; c.height = 0; });
            return;
          }
        }
        freigeben(behaelter);
        behaelter.append(...seiten);
        setZustand("fertig");
      } catch (fehler) {
        console.error("PDF-Vorschau konnte nicht gezeichnet werden:", fehler);
        if (!abgebrochen) {
          freigeben(behaelter);
          setZustand("fehler");
        }
      } finally {
        dokument?.destroy();
      }
    })();

    return () => {
      abgebrochen = true;
    };
  }, [pdf]);

  // Beim Aushängen den Speicher der gezeichneten Seiten freigeben
  useEffect(() => {
    const behaelter = behaelterRef.current;
    return () => {
      if (behaelter) freigeben(behaelter);
    };
  }, []);

  return (
    <div className="space-y-2">
      {zustand === "laedt" && (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Vorschau wird gezeichnet…
        </div>
      )}
      {zustand === "fehler" && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          Vorschau kann hier nicht angezeigt werden. Das PDF lässt sich über „Download“ öffnen.
        </div>
      )}
      <div ref={behaelterRef} className="space-y-3" />
    </div>
  );
};
