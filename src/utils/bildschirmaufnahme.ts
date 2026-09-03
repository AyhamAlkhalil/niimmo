/**
 * Bildschirmaufnahme für die Problemmeldung.
 *
 * Es wird bewusst der echte Bildschirminhalt aufgenommen und nicht der
 * nachgezeichnete Seiteninhalt: Die Oberfläche arbeitet durchgehend mit
 * Glaseffekten (backdrop-filter), die keine der gängigen Nachzeichen-
 * Bibliotheken korrekt wiedergibt. Wer einen Darstellungsfehler meldet,
 * würde sonst ein Bild schicken, das anders aussieht als sein Bildschirm.
 *
 * Der Aufruf muss direkt aus einem Klick heraus erfolgen, sonst verweigern
 * die Browser den Zugriff.
 */

/** Kennzeichen am <html>-Element, solange die Aufnahme läuft. */
const AUFNAHME_MARKER = "aufnahme";

export type Aufnahmequelle = "bildschirm" | "datei" | "zwischenablage";

export interface Bildschirmaufnahme {
  datei: File;
  vorschauUrl: string;
  breite: number;
  hoehe: number;
  quelle: Aufnahmequelle;
}

export type AufnahmeFehlerGrund =
  | "nicht_unterstuetzt"
  | "abgelehnt"
  | "abgebrochen"
  | "fehlgeschlagen";

export class AufnahmeFehler extends Error {
  readonly grund: AufnahmeFehlerGrund;

  constructor(grund: AufnahmeFehlerGrund, nachricht: string) {
    super(nachricht);
    this.name = "AufnahmeFehler";
    this.grund = grund;
  }
}

/** Technischer Kontext, damit ein Fehler nachgestellt werden kann. */
export interface AufnahmeKontext {
  pfad: string;
  titel: string;
  fensterbreite: number;
  fensterhoehe: number;
  pixelverhaeltnis: number;
  browser: string;
  zeitpunkt: string;
}

export function ermittleKontext(): AufnahmeKontext {
  return {
    pfad: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    titel: document.title,
    fensterbreite: window.innerWidth,
    fensterhoehe: window.innerHeight,
    pixelverhaeltnis: window.devicePixelRatio || 1,
    browser: navigator.userAgent,
    zeitpunkt: new Date().toISOString(),
  };
}

export function bildschirmaufnahmeMoeglich(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
}

/**
 * Nimmt ein Einzelbild des aktuellen Tabs auf.
 *
 * Der Melde-Knopf blendet sich vorher selbst aus (siehe CSS-Regel zu
 * `[data-aufnahme]`), damit er nicht auf dem Bild landet. Das Setzen des
 * Kennzeichens ist synchron und wird vom Auswahldialog des Browsers, der
 * ohnehin ein Neuzeichnen auslöst, zuverlässig übernommen.
 */
export async function nimmBildschirmAuf(): Promise<Bildschirmaufnahme> {
  if (!bildschirmaufnahmeMoeglich()) {
    throw new AufnahmeFehler(
      "nicht_unterstuetzt",
      "Dieser Browser kann den Bildschirm nicht aufnehmen.",
    );
  }

  document.documentElement.dataset[AUFNAHME_MARKER] = "laeuft";

  let strom: MediaStream | null = null;
  try {
    strom = await navigator.mediaDevices.getDisplayMedia({
      // preferCurrentTab wählt in Chrome den aktuellen Tab vor, sodass ein
      // einziger Bestätigungsklick genügt. Andere Browser ignorieren es.
      preferCurrentTab: true,
      video: { displaySurface: "browser" },
      audio: false,
    } as DisplayMediaStreamOptions);

    return await bildAusStrom(strom, "bildschirm");
  } catch (fehler) {
    throw uebersetzeFehler(fehler);
  } finally {
    strom?.getTracks().forEach((spur) => spur.stop());
    delete document.documentElement.dataset[AUFNAHME_MARKER];
  }
}

function uebersetzeFehler(fehler: unknown): AufnahmeFehler {
  if (fehler instanceof AufnahmeFehler) return fehler;

  const name = (fehler as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new AufnahmeFehler("abgelehnt", "Die Bildschirmaufnahme wurde abgelehnt.");
  }
  if (name === "AbortError") {
    return new AufnahmeFehler("abgebrochen", "Die Bildschirmaufnahme wurde abgebrochen.");
  }
  if (name === "NotFoundError" || name === "NotSupportedError") {
    return new AufnahmeFehler("nicht_unterstuetzt", "Es steht keine Bildquelle zur Verfügung.");
  }
  return new AufnahmeFehler("fehlgeschlagen", "Die Bildschirmaufnahme ist fehlgeschlagen.");
}

async function bildAusStrom(strom: MediaStream, quelle: Aufnahmequelle): Promise<Bildschirmaufnahme> {
  const video = document.createElement("video");
  video.srcObject = strom;
  video.muted = true;
  video.playsInline = true;

  try {
    return await zeichneEinzelbild(video, quelle);
  } finally {
    // Auch auf den Fehlerpfaden: Sonst haengt das Element noch am toten Strom.
    video.pause();
    video.srcObject = null;
  }
}

async function zeichneEinzelbild(
  video: HTMLVideoElement,
  quelle: Aufnahmequelle,
): Promise<Bildschirmaufnahme> {
  await new Promise<void>((auf, ab) => {
    const zeitgeber = window.setTimeout(
      () => ab(new AufnahmeFehler("fehlgeschlagen", "Das Bild kam nicht rechtzeitig an.")),
      8000,
    );
    video.onloadedmetadata = () => {
      window.clearTimeout(zeitgeber);
      auf();
    };
    video.onerror = () => {
      window.clearTimeout(zeitgeber);
      ab(new AufnahmeFehler("fehlgeschlagen", "Das Bild konnte nicht gelesen werden."));
    };
  });

  try {
    await video.play();
  } catch {
    // Eigene Meldung: Sonst liest der Nutzer „Aufnahme abgelehnt", obwohl er
    // sie gerade freigegeben hat — abgelehnt wurde nur die Wiedergabe.
    throw new AufnahmeFehler("fehlgeschlagen", "Das Bild konnte nicht angezeigt werden.");
  }
  // Ein Bildlauf abwarten, sonst ist das erste Bild gelegentlich noch schwarz.
  await new Promise((auf) => requestAnimationFrame(() => requestAnimationFrame(auf)));

  const breite = video.videoWidth;
  const hoehe = video.videoHeight;
  if (!breite || !hoehe) {
    throw new AufnahmeFehler("fehlgeschlagen", "Das Bild war leer.");
  }

  const leinwand = document.createElement("canvas");
  leinwand.width = breite;
  leinwand.height = hoehe;
  const zeichenflaeche = leinwand.getContext("2d");
  if (!zeichenflaeche) {
    throw new AufnahmeFehler("fehlgeschlagen", "Die Zeichenfläche steht nicht zur Verfügung.");
  }
  zeichenflaeche.drawImage(video, 0, 0, breite, hoehe);

  const blob = await new Promise<Blob | null>((auf) => leinwand.toBlob(auf, "image/png"));
  if (!blob) {
    throw new AufnahmeFehler("fehlgeschlagen", "Das Bild konnte nicht gespeichert werden.");
  }

  return alsAufnahme(new File([blob], dateiname("png"), { type: "image/png" }), breite, hoehe, quelle);
}

/** Übernimmt ein Bild aus Dateiauswahl oder Zwischenablage. */
export async function uebernimmBilddatei(
  datei: File,
  quelle: Aufnahmequelle = "datei",
): Promise<Bildschirmaufnahme> {
  if (!datei.type.startsWith("image/")) {
    throw new AufnahmeFehler("fehlgeschlagen", "Das ist keine Bilddatei.");
  }

  const url = URL.createObjectURL(datei);
  try {
    const masse = await new Promise<{ breite: number; hoehe: number }>((auf, ab) => {
      const bild = new Image();
      bild.onload = () => auf({ breite: bild.naturalWidth, hoehe: bild.naturalHeight });
      bild.onerror = () => ab(new AufnahmeFehler("fehlgeschlagen", "Das Bild ließ sich nicht lesen."));
      bild.src = url;
    });
    return { datei, vorschauUrl: url, breite: masse.breite, hoehe: masse.hoehe, quelle };
  } catch (fehler) {
    URL.revokeObjectURL(url);
    throw fehler;
  }
}

function alsAufnahme(
  datei: File,
  breite: number,
  hoehe: number,
  quelle: Aufnahmequelle,
): Bildschirmaufnahme {
  return { datei, vorschauUrl: URL.createObjectURL(datei), breite, hoehe, quelle };
}

function dateiname(endung: string): string {
  const jetzt = new Date();
  const zwei = (wert: number) => String(wert).padStart(2, "0");
  const stempel =
    `${jetzt.getFullYear()}${zwei(jetzt.getMonth() + 1)}${zwei(jetzt.getDate())}` +
    `-${zwei(jetzt.getHours())}${zwei(jetzt.getMinutes())}${zwei(jetzt.getSeconds())}`;
  return `bildschirm-${stempel}.${endung}`;
}

/** Gibt die Objekt-URL einer Aufnahme wieder frei. */
export function gibAufnahmeFrei(aufnahme: Bildschirmaufnahme | null): void {
  if (aufnahme?.vorschauUrl) URL.revokeObjectURL(aufnahme.vorschauUrl);
}
