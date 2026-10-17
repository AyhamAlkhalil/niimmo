import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useActivityLog } from "@/hooks/useActivityLog";
import type { Database } from "@/integrations/supabase/types";
import { dateiendung } from "@/utils/storagePfad";

type DokumentKategorie = Database["public"]["Enums"]["kategorie"];

interface UploadMetadata {
  immobilieId?: string;
  mietvertragId?: string;
  kategorie?: DokumentKategorie;
  titel?: string;
}

export const useDocumentUpload = () => {
  const { toast } = useToast();
  const { logActivity } = useActivityLog();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const uploadDocument = async (file: File, metadata: UploadMetadata) => {
    setUploading(true);
    setProgress(0);

    try {
      // 1. Upload to Storage
      // Endung nur aus sicheren Zeichen — ein Umlaut im Pfad lässt den Upload scheitern
      const fileExt = dateiendung(file.name, file.type, 'bin');
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${metadata.mietvertragId || metadata.immobilieId || 'general'}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('dokumente')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      setProgress(50);

      // 2. Create entry in dokumente table
      const { data: doc, error: dbError } = await supabase
        .from('dokumente')
        .insert([{
          pfad: filePath,
          titel: metadata.titel || file.name,
          dateityp: file.type || fileExt,
          groesse_bytes: file.size,
          immobilie_id: metadata.immobilieId || null,
          mietvertrag_id: metadata.mietvertragId || null,
          kategorie: (metadata.kategorie ?? 'Sonstiges') as DokumentKategorie,
        }])
        .select()
        .single();

      if (dbError) throw dbError;

      setProgress(100);

      toast({
        title: "Upload erfolgreich",
        description: `${file.name} wurde hochgeladen.`,
      });

      logActivity('dokument_hochgeladen', 'dokument', doc?.id, {
        dateiname: file.name,
        kategorie: metadata.kategorie ?? 'Sonstiges',
        mietvertragId: metadata.mietvertragId ?? null,
        immobilieId: metadata.immobilieId ?? null,
      });

      return doc;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Dokument konnte nicht hochgeladen werden.";
      toast({
        title: "Upload fehlgeschlagen",
        description: msg,
        variant: "destructive",
      });
      throw error;
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return { uploadDocument, uploading, progress };
};
