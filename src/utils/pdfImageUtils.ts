/**
 * Bildaufbereitung für die PDF-Einbettung.
 *
 * jsPDF wertet die EXIF-Orientierung eines JPEGs nicht aus: ein hochkant
 * aufgenommenes Handyfoto liegt im Datenstrom quer und trägt die Drehung nur
 * als EXIF-Flag. Im Browser sieht es dadurch richtig aus, im PDF gekippt.
 *
 * Der Umweg über ein Canvas löst das: die Zeichenquelle wird bereits
 * EXIF-korrigiert geliefert, und das Ergebnis enthält keine EXIF-Daten mehr.
 * Gleichzeitig werden die Fotos auf eine sinnvolle Kantenlänge herunter-
 * gerechnet — Originalaufnahmen blähen das PDF sonst auf zweistellige MB auf
 * und sprengen die Anhangsgrenzen beim Mailversand.
 */

export interface PdfImage {
  dataUrl: string;
  /** Pixelbreite nach Orientierungskorrektur — für seitenverhältnistreues Einpassen */
  width: number;
  height: number;
}

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/**
 * Liefert eine Zeichenquelle mit angewandter EXIF-Orientierung.
 * Bevorzugt createImageBitmap, weil `imageOrientation: "from-image"` dort
 * spezifiziert ist; das <img>-Element ist der Fallback für ältere WebViews.
 */
async function decodeOriented(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // ältere Safari-Versionen kennen die Options nicht — weiter mit <img>
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Bild konnte nicht dekodiert werden"));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** Konvertiert ein Bild-Blob in ein PDF-taugliches JPEG. `null`, wenn es nicht lesbar ist. */
export async function blobToPdfImage(blob: Blob): Promise<PdfImage | null> {
  let decoded: DecodedImage;
  try {
    decoded = await decodeOriented(blob);
  } catch {
    return null;
  }

  try {
    const { source, width, height } = decoded;
    if (!width || !height) return null;

    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Weißer Grund, damit transparente PNGs im PDF nicht schwarz werden
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(source, 0, 0, targetW, targetH);

    return {
      dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
      width: targetW,
      height: targetH,
    };
  } catch {
    return null;
  } finally {
    decoded.release();
  }
}
