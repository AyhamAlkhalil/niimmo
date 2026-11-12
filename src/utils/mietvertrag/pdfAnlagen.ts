/**
 * Weitere Anlagen am Mietvertrag (Besprechung 12.11.2026): „Der bestehende Mietvertrag soll unverändert bleiben.
 * Zusätzliche Anlagen werden erst nach der letzten Vertragsseite angehängt … Die Originaldateien sollten vollständig
 * erhalten bleiben und im fertigen PDF in der gewünschten Reihenfolge erscheinen.“
 *
 * jsPDF kann keine fremden PDFs einlesen; pdf-lib kopiert ihre Seiten unverändert hinter den Vertrag. Inhaltsverzeichnis
 * und Seitenzahlen des Vertrags bleiben, wie sie sind („zunächst nicht erforderlich“).
 */
import { PDFDocument } from 'pdf-lib';

export interface AnlageDatei {
  /** Name für Fehlermeldungen, etwa „Grundriss“. */
  titel: string;
  bytes: Uint8Array;
}

/**
 * Hängt alle Seiten jeder Anlage in der gegebenen Reihenfolge an den Vertrag. Eine Datei, die kein lesbares PDF oder
 * kennwortgeschützt ist, bricht mit ihrem Namen ab — bevor irgendetwas gespeichert wird.
 */
/** Größte Anlage — der Speicher nimmt höchstens 50 MB je Datei, der fertige Vertrag muss darunter bleiben. */
export const ANLAGE_HOECHSTENS_MB = 20;

export async function anlagenAnhaengen(vertrag: Uint8Array, anlagen: readonly AnlageDatei[]): Promise<Uint8Array> {
  const zuGross = anlagen.find(a => a.bytes.byteLength > ANLAGE_HOECHSTENS_MB * 1024 * 1024);
  if (zuGross) {
    throw new Error(`Die Anlage „${zuGross.titel}“ ist größer als ${ANLAGE_HOECHSTENS_MB} MB. Bitte verkleinert speichern.`);
  }
  const gesamt = anlagen.reduce((s, a) => s + a.bytes.byteLength, vertrag.byteLength);
  if (gesamt > 45 * 1024 * 1024) {
    throw new Error('Vertrag und Anlagen zusammen wären größer als 45 MB. Bitte weniger oder kleinere Anlagen wählen.');
  }
  // Titel und Ersteller des Vertrags bleiben, wie jsPDF sie gesetzt hat
  const ziel = await PDFDocument.load(vertrag, { updateMetadata: false });
  for (const anlage of anlagen) {
    let quelle: PDFDocument;
    try {
      quelle = await PDFDocument.load(anlage.bytes, { ignoreEncryption: true, updateMetadata: false });
    } catch (e) {
      throw new Error(
        `Die Anlage „${anlage.titel}“ ist keine lesbare PDF-Datei (${e instanceof Error ? e.message : String(e)}).`
      );
    }
    // Verschlüsselte Seiten kämen leer oder unlesbar an — lieber ehrlich ablehnen
    if (quelle.isEncrypted) {
      throw new Error(
        `Die Anlage „${anlage.titel}“ ist verschlüsselt (Kennwort- oder Kopierschutz). Bitte ohne Schutz speichern und erneut wählen.`
      );
    }
    if (quelle.getPageCount() === 0) {
      throw new Error(`Die Anlage „${anlage.titel}“ hat keine Seiten.`);
    }
    const seiten = await ziel.copyPages(quelle, quelle.getPageIndices());
    for (const seite of seiten) ziel.addPage(seite);
  }
  return ziel.save();
}
