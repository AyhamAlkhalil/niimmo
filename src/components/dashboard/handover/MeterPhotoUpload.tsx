import { useState, useEffect, useRef } from "react";
import { Camera, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface MeterPhotoUploadProps {
  contractId: string;
  meterType: "strom" | "gas" | "wasser" | "warmwasser";
  isEinzug: boolean;
  onPhotosChange: (paths: string[]) => void;
  existingPhotos?: string[];
}

export const MeterPhotoUpload = ({
  contractId,
  meterType,
  isEinzug,
  onPhotosChange,
  existingPhotos = [],
}: MeterPhotoUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [photos, setPhotos] = useState<string[]>(existingPhotos);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const { toast } = useToast();
  const inputId = `meter-photo-${contractId}-${meterType}`;

  // Wird das Formular während eines Uploads zurückgesetzt, wird diese Instanz
  // ersetzt. Der laufende Upload darf dann nicht mehr in den Dialog
  // zurückschreiben — sonst hinge dort ein Foto, das hier niemand mehr sieht.
  const istEingehaengt = useRef(true);
  useEffect(() => {
    istEingehaengt.current = true;
    return () => {
      istEingehaengt.current = false;
    };
  }, []);

  const meterLabels: Record<string, string> = {
    strom: "Strom",
    gas: "Gas",
    wasser: "Kaltwasser",
    warmwasser: "Warmwasser",
  };

  // Signed URLs für neue Fotos nachladen
  useEffect(() => {
    const missing = photos.filter((p) => !signedUrls[p]);
    if (missing.length === 0) return;
    Promise.all(
      missing.map((p) =>
        supabase.storage
          .from("dokumente")
          .createSignedUrl(p, 3600)
          .then(({ data }) => (data?.signedUrl ? { path: p, url: data.signedUrl } : null))
      )
    ).then((results) => {
      const next: Record<string, string> = {};
      results.forEach((r) => { if (r) next[r.path] = r.url; });
      setSignedUrls((prev) => ({ ...prev, ...next }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      const newPaths: string[] = [];
      const uebergabeTyp = isEinzug ? "einzug" : "auszug";

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileExt = file.name.split(".").pop();
        const fileName = `${meterType}_${uebergabeTyp}_${Date.now()}_${i}.${fileExt}`;
        const filePath = `zaehlerfotos/${contractId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from("dokumente")
          .upload(filePath, file, { upsert: true });

        if (uploadError) throw uploadError;
        newPaths.push(filePath);
      }

      if (!istEingehaengt.current) return;

      const updatedPhotos = [...photos, ...newPaths];
      setPhotos(updatedPhotos);
      onPhotosChange(updatedPhotos);

      toast({
        title: "Foto gespeichert",
        description: `${files.length} ${meterLabels[meterType]}-Zählerfoto(s) hochgeladen.`,
      });
    } catch {
      toast({
        title: "Fehler",
        description: "Foto konnte nicht hochgeladen werden.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      const el = document.getElementById(inputId) as HTMLInputElement | null;
      if (el) el.value = "";
    }
  };

  const removePhoto = (index: number) => {
    const updated = photos.filter((_, i) => i !== index);
    setPhotos(updated);
    onPhotosChange(updated);
  };

  return (
    <div className="space-y-2">
      {/* sr-only statt hidden — iOS Safari triggert display:none-Inputs nicht */}
      <input
        id={inputId}
        type="file"
        accept="image/*"
        multiple
        onChange={handleCapture}
        className="sr-only"
      />

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((path, i) => (
            <div
              key={i}
              className="relative aspect-square rounded-lg overflow-hidden bg-gray-100"
            >
              <img
                src={signedUrls[path] || ""}
                alt={`${meterLabels[meterType]} Zähler ${i + 1}`}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(i)}
                className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 shadow-md"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* label statt Button+onClick — einzige zuverlässige Methode auf iOS Safari */}
      <label
        htmlFor={inputId}
        className={cn(
          "flex items-center justify-center w-full h-9 rounded-md border border-dashed text-xs font-medium",
          "bg-background hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors",
          uploading && "opacity-50 pointer-events-none"
        )}
      >
        {uploading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
        ) : (
          <Camera className="h-3.5 w-3.5 mr-1" />
        )}
        {uploading ? "Lädt..." : photos.length > 0 ? "Weiteres Foto" : "Foto aufnehmen"}
      </label>
    </div>
  );
};
