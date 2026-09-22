/**
 * Zentraler Zugang zu PDF.js.
 *
 * Warum: pdfjs-dist 4 liefert nur noch `.mjs`-Dateien. Die frueher eingetragenen
 * Worker-Pfade waren beide tot — `pdfjs-dist/legacy/build/pdf.worker.min.js` wurde
 * von Vite nicht aufgeloest und landete als 404 unter /assets/..., und
 * cdnjs .../4.0.379/pdf.worker.min.js gibt es ebenfalls nicht (nur .mjs).
 * Ohne Worker scheitert `getDocument()`; im Vertragsupload sah das aus wie
 * "Kein verwertbarer Inhalt im Dokument gefunden" (geprueft am 22.09.2026).
 *
 * Der Worker wird deshalb per `?url` mitgebaut und same-origin ausgeliefert.
 */
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

let pdfjsPromise: Promise<any> | null = null;

export async function ladePdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjsLib: any) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjsLib;
    });
  }
  return pdfjsPromise;
}
