import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, Calendar, Upload, X, FileText, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { terminationWebhookService } from "@/services/terminationWebhookService";
import { DocumentDragDropZone } from "../DocumentDragDropZone";

interface DocumentUploadTerminationProps {
  vertragId: string;
  einheitId?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export const DocumentUploadTermination = ({
  vertragId,
  einheitId,
  onSuccess,
  onCancel
}: DocumentUploadTerminationProps) => {
  const [kuendigungsdatum, setKuendigungsdatum] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      validateAndSetFile(file);
    }
  };

  const handleFileDrop = (file: File) => {
    validateAndSetFile(file);
  };

  const validateAndSetFile = (file: File) => {
    // Validate file type
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Ungültiger Dateityp",
        description: "Bitte wählen Sie eine PDF-, JPG- oder PNG-Datei aus",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "Datei zu groß",
        description: "Die Datei darf maximal 10MB groß sein",
        variant: "destructive",
      });
      return;
    }

    setSelectedFile(file);
  };

  const removeFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const uploadDocument = async (file: File): Promise<string> => {
    const fileExtension = file.name.split('.').pop();
    const fileName = `kuendigung_${vertragId}_${Date.now()}.${fileExtension}`;
    
    const { data, error } = await supabase.storage
      .from('dokumente')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw new Error('Upload fehlgeschlagen: ' + error.message);
    }

    return data.path;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!kuendigungsdatum) {
      toast({
        title: "Fehler",
        description: "Bitte geben Sie ein Kündigungsdatum an",
        variant: "destructive",
      });
      return;
    }

    if (!selectedFile) {
      toast({
        title: "Fehler",
        description: "Bitte wählen Sie ein Kündigungsdokument aus",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setUploadProgress(0);

    try {
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 10, 80));
      }, 100);

      // Upload document
      const documentPath = await uploadDocument(selectedFile);
      setUploadProgress(90);

      // Update contract status
      const { error: updateError } = await supabase
        .from('mietvertrag')
        .update({
          status: 'gekuendigt',
          kuendigungsdatum: kuendigungsdatum,
          aktualisiert_am: new Date().toISOString()
        })
        .eq('id', vertragId);

      if (updateError) {
        throw new Error('Fehler beim Aktualisieren des Vertrags: ' + updateError.message);
      }

      // Create document entry
      const { error: docError } = await supabase
        .from('dokumente')
        .insert({
          mietvertrag_id: vertragId,
          immobilie_id: einheitId,
          kategorie: 'Kündigung',
          titel: `Kündigungsschreiben - ${selectedFile.name}`,
          pfad: documentPath,
          dateityp: selectedFile.type,
          groesse_bytes: selectedFile.size,
          erstellt_von: 'Upload',
          hochgeladen_am: new Date(kuendigungsdatum + 'T12:00:00').toISOString()
        });

      if (docError) {
      }

      clearInterval(progressInterval);
      setUploadProgress(100);

      // Call webhook service
      try {
        await terminationWebhookService.notifyTermination({
          vertragId,
          kuendigungsdatum,
          documentPath,
          fileName: selectedFile.name,
          method: 'document_upload'
        });
      } catch (webhookError) {
      }

      toast({
        title: "Erfolg",
        description: "Mietvertrag wurde erfolgreich gekündigt und das Dokument hochgeladen",
      });

      onSuccess();
    } catch (error) {
      toast({
        title: "Fehler",
        description: error instanceof Error ? error.message : "Ein unbekannter Fehler ist aufgetreten",
        variant: "destructive",
      });
      setUploadProgress(0);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card className="border-l-4 border-l-destructive bg-destructive/5">
        <CardContent className="pt-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Dokumenten-Upload</p>
              <p className="text-sm text-muted-foreground">
                Laden Sie das offizielle Kündigungsschreiben hoch. Unterstützt: PDF, JPG, PNG (max. 10MB)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div>
          <Label htmlFor="kuendigungsdatum-upload" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Kündigungsdatum *
          </Label>
          <Input
            id="kuendigungsdatum-upload"
            type="date"
            value={kuendigungsdatum}
            onChange={(e) => setKuendigungsdatum(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
            required
          />
        </div>

        <div>
          <Label className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Kündigungsdokument *
          </Label>
          
          <DocumentDragDropZone 
            onFileSelect={handleFileDrop}
            accept=".pdf,.jpg,.jpeg,.png"
            showOverlay={!selectedFile}
          >
            {!selectedFile ? (
              <div
                className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Klicken Sie hier oder ziehen Sie eine Datei hinein
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  PDF, JPG oder PNG - maximal 10MB
                </p>
              </div>
            ) : (
              <Card className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{selectedFile.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={removeFile}
                    disabled={isLoading}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                
                {uploadProgress > 0 && (
                  <div className="mt-2">
                    <Progress value={uploadProgress} className="h-2" />
                    <p className="text-xs text-muted-foreground mt-1">
                      {uploadProgress === 100 ? 'Upload abgeschlossen' : `Upload: ${uploadProgress}%`}
                    </p>
                  </div>
                )}
              </Card>
            )}
          </DocumentDragDropZone>
          
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isLoading}
        >
          Abbrechen
        </Button>
        <Button
          type="submit"
          variant="destructive"
          disabled={isLoading || !selectedFile}
          className="flex items-center gap-2"
        >
          {uploadProgress === 100 ? (
            <Check className="h-4 w-4" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
          {isLoading ? "Wird verarbeitet..." : "Kündigung einreichen"}
        </Button>
      </div>
    </form>
  );
};