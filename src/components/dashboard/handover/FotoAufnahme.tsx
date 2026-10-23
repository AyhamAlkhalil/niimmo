import { useState, useEffect, useRef, type ReactNode } from "react";
import { Camera, ImageOff, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { dateienHochladen } from "@/utils/uebergabeSpeicherung";
import { bildLesbar } from "@/utils/pdfImageUtils";

interface FotoAufnahmeProps {
  inputId: string;
  /** Storage-Pfad je Datei — nur ASCII (utils/storagePfad.ts), sonst scheitert der Upload */
  pfadFuer: (file: File, index: number) => string;
  /** z. B. „Strom-Zählerfoto" — für Alternativtext und Fehlermeldung */
  bezeichnung: string;
  onPhotosChange: (paths: string[]) => void;
  existingPhotos?: string[];
  /** Meldet laufende Uploads — solange darf weder gespeichert noch kommentarlos geschlossen werden */
  onUploadingChange?: (aktiv: boolean) => void;
  /** Steht in derselben Zeile vor dem Kamera-Knopf, z. B. das Eingabefeld des Zählerstands */
  vorKnopf?: ReactNode;
  /** Beschriftung des Kamera-Knopfs; ohne nur das Symbol */
  knopfText?: string;
}

/**
 * Fotos aufnehmen und hochladen — für Zählerfotos und Zustandsfotos derselbe
 * Baustein (bis 20.10.2026 zwei fast gleiche Komponenten).
 *
 * Erfolg zeigt das Vorschaubild, nicht eine Einblendung: Auf dem Handy deckte
 * „Foto hochgeladen" jedes Mal den oberen Teil des Formulars ab. Ein Fehler
 * kommt weiter als Meldung, denn dann fehlt etwas.
 */
export const FotoAufnahme = ({
  inputId,
  pfadFuer,
  bezeichnung,
  onPhotosChange,
  existingPhotos = [],
  onUploadingChange,
  vorKnopf,
  knopfText,
}: FotoAufnahmeProps) => {
  const [uploading, setUploading] = useState(false);
  const [fortschritt, setFortschritt] = useState<{ fertig: number; gesamt: number } | null>(null);
  const [photos, setPhotos] = useState<string[]>(existingPhotos);
  // Aktuelle Liste für das Ende eines Uploads — wer währenddessen ein Foto
  // entfernt, bekäme es sonst mit der Liste vom Uploadbeginn zurück
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const onUploadingChangeRef = useRef(onUploadingChange);
  onUploadingChangeRef.current = onUploadingChange;
  const [signedUrls, setSignedUrls] = useState<Record<string, string | null>>({});
  const { toast } = useToast();

  // Wird das Formular während eines Uploads zurückgesetzt, wird diese Instanz
  // ersetzt. Der laufende Upload darf dann nicht mehr in den Dialog
  // zurückschreiben — sonst hinge dort ein Foto, das hier niemand mehr sieht.
  const istEingehaengt = useRef(true);
  useEffect(() => {
    istEingehaengt.current = true;
    return () => {
      istEingehaengt.current = false;
      onUploadingChangeRef.current?.(false);
    };
  }, []);

  // Signierte Adressen für die Vorschaubilder; null = nicht ladbar
  useEffect(() => {
    const fehlend = photos.filter((p) => !(p in signedUrls));
    if (fehlend.length === 0) return;
    Promise.all(
      fehlend.map((p) =>
        supabase.storage
          .from("dokumente")
          .createSignedUrl(p, 3600)
          .then(({ data }) => ({ pfad: p, url: data?.signedUrl ?? null }))
          .catch(() => ({ pfad: p, url: null }))
      )
    ).then((ergebnisse) => {
      if (!istEingehaengt.current) return;
      setSignedUrls((vorher) => ({ ...vorher, ...Object.fromEntries(ergebnisse.map((e) => [e.pfad, e.url])) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const auswahl = e.target.files ? Array.from(e.target.files) : [];
    if (auswahl.length === 0) return;

    setUploading(true);
    onUploadingChangeRef.current?.(true);
    setFortschritt({ fertig: 0, gesamt: auswahl.length });
    try {
      // Nicht lesbare Formate gar nicht erst hochladen — sie fehlten sonst im PDF
      const files: File[] = [];
      for (const datei of auswahl) if (await bildLesbar(datei)) files.push(datei);
      const unlesbar = auswahl.length - files.length;
      if (unlesbar > 0 && istEingehaengt.current) {
        toast({
          title: "Bildformat nicht lesbar",
          description: `${unlesbar === 1 ? "Ein Foto hat" : `${unlesbar} Fotos haben`} ein Format, das dieser Browser nicht lesen kann (z. B. HEIC). Bitte direkt mit der Kamera aufnehmen oder als JPEG speichern.`,
          variant: "destructive",
        });
      }
      if (files.length === 0) return;
      setFortschritt({ fertig: 0, gesamt: files.length });

      // Jedes angekommene Foto sofort übernehmen: Bis zum 23.10.2026 kamen sie erst
      // am Ende der ganzen Auswahl in den Entwurf, und ein Neuladen dazwischen
      // verlor auch die schon hochgeladenen
      const { fehlgeschlagen } = await dateienHochladen(
        files,
        pfadFuer,
        (pfad, file) => supabase.storage.from("dokumente").upload(pfad, file, { upsert: true }),
        (fertig, gesamt, pfad) => {
          if (!istEingehaengt.current) return;
          setFortschritt({ fertig, gesamt });
          if (pfad) {
            const aktualisiert = [...photosRef.current, pfad];
            photosRef.current = aktualisiert;
            setPhotos(aktualisiert);
            onPhotosChange(aktualisiert);
          }
        }
      );

      if (!istEingehaengt.current) return;

      if (fehlgeschlagen > 0) {
        toast({
          title: "Foto nicht hochgeladen",
          description: `${fehlgeschlagen} von ${files.length} ${bezeichnung}${files.length === 1 ? "" : "s"} kamen nicht an — bitte erneut aufnehmen.`,
          variant: "destructive",
        });
      }
    } catch {
      if (istEingehaengt.current) toast({ title: "Fehler", description: "Foto konnte nicht hochgeladen werden.", variant: "destructive" });
    } finally {
      if (istEingehaengt.current) {
        setUploading(false);
        setFortschritt(null);
        onUploadingChangeRef.current?.(false);
      }
      const el = document.getElementById(inputId) as HTMLInputElement | null;
      if (el) el.value = "";
    }
  };

  const removePhoto = (index: number) => {
    const aktualisiert = photos.filter((_, i) => i !== index);
    setPhotos(aktualisiert);
    onPhotosChange(aktualisiert);
  };

  const laeuftText =
    fortschritt && fortschritt.gesamt > 1 ? `Lädt ${Math.min(fortschritt.fertig + 1, fortschritt.gesamt)}/${fortschritt.gesamt}…` : "Lädt…";

  return (
    <div className="space-y-2">
      <div className="flex items-stretch gap-2">
        {vorKnopf}
        {/* sr-only statt hidden — iOS Safari öffnet display:none-Dateifelder nicht.
            Direkt vor dem Label, damit peer-focus-visible den Fokus am Knopf zeigt. */}
        {/* Während eines Uploads gesperrt: Eine zweite Auswahl gab sonst mit dem Ende der
            ersten das Speichern frei, obwohl die zweite noch lief */}
        <input id={inputId} type="file" accept="image/*" multiple disabled={uploading} onChange={handleCapture} className="peer sr-only" />
        {/* label statt Button+onClick — einzige zuverlässige Methode auf iOS Safari */}
        <label
          htmlFor={inputId}
          aria-label={knopfText ? undefined : `${bezeichnung} aufnehmen`}
          className={cn(
            "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors",
            "hover:bg-accent hover:text-accent-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
            knopfText ? "h-11 flex-1" : "h-11 w-12",
            uploading && "pointer-events-none opacity-60"
          )}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {knopfText && <span>{uploading ? laeuftText : knopfText}</span>}
          {!knopfText && uploading && fortschritt && fortschritt.gesamt > 1 && <span className="sr-only">{laeuftText}</span>}
        </label>
      </div>

      {photos.length > 0 && (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {photos.map((pfad, i) => (
            <li key={pfad} className="relative aspect-square overflow-hidden rounded-md border bg-muted">
              {signedUrls[pfad] ? (
                // lazy/async: Handyfotos haben 8–12 Megapixel; viele Originale auf
                // einmal zu dekodieren brachte den Speicher des iPhones an die Grenze
                <img
                  src={signedUrls[pfad]!}
                  alt={`${bezeichnung} ${i + 1}`}
                  loading="lazy"
                  decoding="async"
                  onError={() => setSignedUrls((vorher) => ({ ...vorher, [pfad]: null }))}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  {pfad in signedUrls ? <ImageOff className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
                </div>
              )}
              <button
                type="button"
                onClick={() => removePhoto(i)}
                aria-label={`${bezeichnung} ${i + 1} entfernen`}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-border hover:bg-destructive hover:text-destructive-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {uploading && knopfText === undefined && <p className="text-xs text-muted-foreground" aria-live="polite">{laeuftText}</p>}
    </div>
  );
};
