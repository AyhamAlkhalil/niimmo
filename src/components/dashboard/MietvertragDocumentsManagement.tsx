import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { FileText, Download, Eye, Calendar, Loader2, Upload, Trash2, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useDocumentUpload } from "@/hooks/useDocumentUpload";
import { PdfPreviewModal } from "./PdfPreviewModal";
import { useQueryClient } from "@tanstack/react-query";
import type { Database } from "@/integrations/supabase/types";

type DokumentKategorie = Database["public"]["Enums"]["kategorie"];

interface MietvertragDocumentsManagementProps {
  mietvertragId: string;
  dokumente: any[];
}

const DOCUMENT_CATEGORIES = [
  "Mietvertrag",
  "Kuendigung",
  "Nebenkostenabrechnung",
  "Kaution",
  "Rechnung",
  "Mahnung",
  "Sonstiges",
];

export const MietvertragDocumentsManagement = ({ 
  mietvertragId, 
  dokumente 
}: MietvertragDocumentsManagementProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { uploadDocument, uploading, progress } = useDocumentUpload();
  
  const [downloading, setDownloading] = useState<string | null>(null);
  const [previewDokument, setPreviewDokument] = useState<any>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<string | null>(null);
  
  // Upload form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadTitel, setUploadTitel] = useState("");
  const [uploadKategorie, setUploadKategorie] = useState<DokumentKategorie>("Sonstiges");

  const handlePreview = (dokument: any) => {
    setPreviewDokument(dokument);
    setIsPreviewOpen(true);
  };

  const handleDownload = async (dokument: any) => {
    if (!dokument?.pfad) {
      toast({
        title: "Fehler",
        description: "Dokument-Pfad nicht gefunden.",
        variant: "destructive",
      });
      return;
    }

    setDownloading(dokument.id);
    try {
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from('dokumente')
        .createSignedUrl(dokument.pfad, 60);

      if (signedUrlError) throw signedUrlError;

      const response = await fetch(signedUrlData.signedUrl);
      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = dokument.titel || 'dokument';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Download erfolgreich",
        description: `${dokument.titel} wurde heruntergeladen.`,
      });
    } catch (error) {
      toast({
        title: "Fehler",
        description: "Dokument konnte nicht heruntergeladen werden.",
        variant: "destructive",
      });
    } finally {
      setDownloading(null);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!uploadTitel) {
        setUploadTitel(file.name);
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast({
        title: "Fehler",
        description: "Bitte wählen Sie eine Datei aus.",
        variant: "destructive",
      });
      return;
    }

    try {
      await uploadDocument(selectedFile, {
        mietvertragId,
        titel: uploadTitel,
        kategorie: uploadKategorie,
      });

      // Refresh documents list
      queryClient.invalidateQueries({ queryKey: ['dokumente', mietvertragId] });

      // Reset form
      setSelectedFile(null);
      setUploadTitel("");
      setUploadKategorie("Sonstiges");
      setIsUploadDialogOpen(false);
    } catch (error) {
      // Error already handled in hook
    }
  };

  const handleDeleteClick = (documentId: string) => {
    setDocumentToDelete(documentId);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!documentToDelete) return;

    try {
      // Soft delete - mark as deleted
      const { error } = await supabase
        .from('dokumente')
        .update({ geloescht: true })
        .eq('id', documentToDelete);

      if (error) throw error;

      toast({
        title: "Dokument gelöscht",
        description: "Das Dokument wurde erfolgreich gelöscht.",
      });

      // Refresh documents list
      queryClient.invalidateQueries({ queryKey: ['dokumente', mietvertragId] });
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: error.message || "Dokument konnte nicht gelöscht werden.",
        variant: "destructive",
      });
    } finally {
      setDeleteDialogOpen(false);
      setDocumentToDelete(null);
    }
  };

  const getFileTypeColor = (dateityp: string) => {
    const normalized = dateityp?.toLowerCase().replace(/^\./, '') || '';
    if (normalized === 'pdf' || normalized === 'application/pdf') {
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
    }
    if (['doc', 'docx', 'application/msword'].includes(normalized)) {
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    }
    if (normalized.startsWith('image/') || ['jpeg', 'jpg', 'png'].includes(normalized)) {
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
    }
    return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  const getCategoryColor = (kategorie?: string) => {
    switch (kategorie) {
      case 'Mietvertrag':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
      case 'Kuendigung':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
      case 'Nebenkostenabrechnung':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300';
      case 'Kaution':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
      case 'Rechnung':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
      case 'Mahnung':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
    }
  };

  return (
    <>
      <Card className="border-0 shadow-lg rounded-2xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-background to-muted/50 border-b px-4 md:px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="flex items-center space-x-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div>
                <span className="text-lg md:text-xl font-semibold">Dokumente</span>
                <p className="text-xs md:text-sm text-muted-foreground font-normal mt-0.5">
                  {dokumente?.length || 0} Dokument(e) verfügbar
                </p>
              </div>
            </CardTitle>
            <Button
              onClick={() => setIsUploadDialogOpen(true)}
              className="gap-2 w-full sm:w-auto"
              size="sm"
            >
              <Plus className="h-4 w-4" />
              <span className="sm:inline">Hochladen</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          {!dokumente || dokumente.length === 0 ? (
            <div className="text-center py-8 md:py-12">
              <div className="p-3 md:p-4 bg-muted rounded-full w-14 h-14 md:w-16 md:h-16 mx-auto mb-3 md:mb-4 flex items-center justify-center">
                <FileText className="h-6 w-6 md:h-8 md:w-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-base md:text-lg">Keine Dokumente vorhanden</p>
              <p className="text-muted-foreground/60 text-xs md:text-sm mt-1 md:mt-2">
                Laden Sie Dokumente hoch, um sie hier anzuzeigen.
              </p>
            </div>
          ) : (
            <div className="space-y-2 md:space-y-3">
              {dokumente.map((dokument) => (
                <div
                  key={dokument.id}
                  className="p-3 md:p-4 bg-card rounded-xl border hover:shadow-md transition-all duration-200 group"
                >
                  {/* Mobile Layout */}
                  <div className="flex flex-col gap-3 md:hidden">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg shrink-0">
                        <FileText className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-sm text-foreground line-clamp-2">
                          {dokument.titel || 'Unbenanntes Dokument'}
                        </h4>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                          <Calendar className="h-3 w-3" />
                          <span>
                            {dokument.hochgeladen_am
                              ? new Date(dokument.hochgeladen_am).toLocaleDateString('de-DE', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                })
                              : 'Unbekannt'}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap gap-1.5">
                        {dokument.kategorie && (
                          <Badge variant="outline" className={`${getCategoryColor(dokument.kategorie)} border-0 text-xs px-2 py-0.5`}>
                            {dokument.kategorie}
                          </Badge>
                        )}
                        <Badge variant="outline" className={`${getFileTypeColor(dokument.dateityp)} border-0 text-xs px-2 py-0.5`}>
                          {dokument.dateityp?.toUpperCase() || '?'}
                        </Badge>
                      </div>
                      
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handlePreview(dokument)}
                          className="h-8 w-8"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDownload(dokument)}
                          disabled={downloading === dokument.id}
                          className="h-8 w-8"
                        >
                          {downloading === dokument.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteClick(dokument.id)}
                          className="h-8 w-8 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Desktop Layout */}
                  <div className="hidden md:flex items-center justify-between">
                    <div className="flex items-center space-x-4 flex-1 min-w-0">
                      <div className="p-2 bg-primary/10 rounded-lg shrink-0">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-foreground truncate">
                          {dokument.titel || 'Unbenanntes Dokument'}
                        </h4>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                          <Calendar className="h-3 w-3" />
                          <span>
                            {dokument.hochgeladen_am
                              ? new Date(dokument.hochgeladen_am).toLocaleDateString('de-DE', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                })
                              : 'Unbekannt'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {dokument.kategorie && (
                        <Badge variant="outline" className={`${getCategoryColor(dokument.kategorie)} border-0`}>
                          {dokument.kategorie}
                        </Badge>
                      )}
                      <Badge variant="outline" className={`${getFileTypeColor(dokument.dateityp)} border-0`}>
                        {dokument.dateityp?.toUpperCase() || 'UNBEKANNT'}
                      </Badge>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handlePreview(dokument)}
                          className="h-8 w-8"
                          title="Vorschau"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDownload(dokument)}
                          disabled={downloading === dokument.id}
                          className="h-8 w-8"
                          title="Herunterladen"
                        >
                          {downloading === dokument.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteClick(dokument.id)}
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title="Löschen"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload Dialog */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Dokument hochladen
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="file-upload">Datei auswählen</Label>
              <Input
                id="file-upload"
                type="file"
                onChange={handleFileSelect}
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                className="cursor-pointer"
              />
              {selectedFile && (
                <p className="text-sm text-muted-foreground">
                  Ausgewählt: {selectedFile.name}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="titel">Titel</Label>
              <Input
                id="titel"
                value={uploadTitel}
                onChange={(e) => setUploadTitel(e.target.value)}
                placeholder="Dokumententitel"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kategorie">Kategorie</Label>
              <Select value={uploadKategorie} onValueChange={(v) => setUploadKategorie(v as DokumentKategorie)}>
                <SelectTrigger id="kategorie">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {uploading && (
              <div className="space-y-2">
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  Hochladen... {progress}%
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsUploadDialogOpen(false)}
              disabled={uploading}
            >
              Abbrechen
            </Button>
            <Button onClick={handleUpload} disabled={!selectedFile || uploading}>
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Wird hochgeladen...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Hochladen
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dokument löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Sind Sie sicher, dass Sie dieses Dokument löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Preview Modal */}
      <PdfPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        dokument={previewDokument}
      />
    </>
  );
};
