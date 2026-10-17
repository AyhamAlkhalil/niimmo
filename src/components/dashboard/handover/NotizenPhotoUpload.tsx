 import { useState, useEffect, useRef } from "react";
 import { Camera, X, Loader2 } from "lucide-react";
 import { supabase } from "@/integrations/supabase/client";
 import { useToast } from "@/hooks/use-toast";
 import { cn } from "@/lib/utils";
import { dateiendung, dateienHochladen } from "@/utils/uebergabeSpeicherung";
 
 interface NotizenPhotoUploadProps {
   contractId: string;
   isEinzug: boolean;
   onPhotosChange: (photos: string[]) => void;
   existingPhotos?: string[];
  /** Meldet laufende Uploads — solange darf weder gespeichert noch kommentarlos geschlossen werden */
  onUploadingChange?: (aktiv: boolean) => void;
 }
 
 export const NotizenPhotoUpload = ({
   contractId,
   isEinzug,
   onPhotosChange,
   existingPhotos = [],
  onUploadingChange,
 }: NotizenPhotoUploadProps) => {
   const [uploading, setUploading] = useState(false);
  const [fortschritt, setFortschritt] = useState<{ fertig: number; gesamt: number } | null>(null);
   const [photos, setPhotos] = useState<string[]>(existingPhotos);
  // Aktuelle Liste für das Ende eines Uploads — wer währenddessen ein Foto
  // entfernt, bekäme es sonst mit der Liste vom Uploadbeginn zurück
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const onUploadingChangeRef = useRef(onUploadingChange);
  onUploadingChangeRef.current = onUploadingChange;
   const { toast } = useToast();
   const inputId = `notizen-photo-${contractId}`;

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
 
   const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
     const files = e.target.files;
     if (!files || files.length === 0) return;
 
    setUploading(true);
    onUploadingChangeRef.current?.(true);
    setFortschritt({ fertig: 0, gesamt: files.length });
    try {
      const uebergabeTyp = isEinzug ? "einzug" : "auszug";
      const { pfade, fehlgeschlagen } = await dateienHochladen(
        files,
        // Endung nur aus sicheren Zeichen — ein Umlaut im Pfad lässt den Upload scheitern
        (file, i) => `uebergabefotos/${contractId}/notizen_${uebergabeTyp}_${Date.now()}_${i}.${dateiendung(file.name, file.type)}`,
        (pfad, file) => supabase.storage.from("dokumente").upload(pfad, file, { upsert: true }),
        (fertig, gesamt) => istEingehaengt.current && setFortschritt({ fertig, gesamt })
      );

      if (!istEingehaengt.current) return;

      if (pfade.length > 0) {
        const updatedPhotos = [...photosRef.current, ...pfade];
        setPhotos(updatedPhotos);
        onPhotosChange(updatedPhotos);
      }

      if (fehlgeschlagen === 0) {
        toast({
          title: "Fotos hochgeladen",
          description: `${pfade.length} Foto(s) hochgeladen.`,
        });
      } else {
        toast({
          title: "Foto nicht hochgeladen",
          description: `${fehlgeschlagen} von ${files.length} Fotos kamen nicht an — bitte erneut aufnehmen.`,
          variant: "destructive",
        });
      }
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
     const updatedPhotos = photos.filter((_, i) => i !== index);
     setPhotos(updatedPhotos);
     onPhotosChange(updatedPhotos);
   };
 
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  // Load signed URLs in a useEffect to avoid side-effects during render
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
         <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
           {photos.map((photoPath, index) => (
             <div
               key={index}
               className="relative aspect-square rounded-lg overflow-hidden bg-gray-100"
             >
              <img
                  src={signedUrls[photoPath] || ""}
                  alt={`Übergabe Foto ${index + 1}`}
                 className="w-full h-full object-cover"
               />
               <button
                 type="button"
                 onClick={() => removePhoto(index)}
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
           "flex items-center justify-center w-full h-10 rounded-md border border-dashed text-sm font-medium",
           "bg-background hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors",
           uploading && "opacity-50 pointer-events-none"
         )}
       >
         {uploading ? (
           <Loader2 className="h-4 w-4 animate-spin mr-2" />
         ) : (
           <Camera className="h-4 w-4 mr-2" />
         )}
         {uploading
           ? fortschritt && fortschritt.gesamt > 1 ? `Lädt ${Math.min(fortschritt.fertig + 1, fortschritt.gesamt)}/${fortschritt.gesamt}…` : "Wird hochgeladen…"
           : "Fotos hinzufügen"}
       </label>
     </div>
   );
 };