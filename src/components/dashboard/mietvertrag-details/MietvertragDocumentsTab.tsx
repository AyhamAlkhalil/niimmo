import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Download, Loader2, ArrowUpDown, ArrowUp, ArrowDown, Edit3, X, Eye, Plus, Upload, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDocumentUpload } from "@/hooks/useDocumentUpload";
import { useQueryClient } from "@tanstack/react-query";
import { DocumentDragDropZone } from "../DocumentDragDropZone";
import type { Database } from "@/integrations/supabase/types";

type DokumentKategorie = Database["public"]["Enums"]["kategorie"];

interface MietvertragDocumentsTabProps {
  dokumente: any[];
  formatDatum: (datum: string) => string;
  onDocumentsChange?: () => void;
  mietvertragId: string;
}

type SortBy = 'kategorie' | 'titel' | 'datum';
type SortDirection = 'asc' | 'desc';

const DOCUMENT_CATEGORIES = [
  'Mietvertrag',
  'Kündigung',
  'Übergabeprotokoll',
  'Betriebskostenabrechnung',
  'Mieterunterlagen',
  'Schriftverkehr',
  'Versicherungen',
  'Sonstiges',
];

export function MietvertragDocumentsTab({
  dokumente,
  formatDatum,
  onDocumentsChange,
  mietvertragId
}: MietvertragDocumentsTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { uploadDocument, uploading, progress } = useDocumentUpload();
  
  const [downloading, setDownloading] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('kategorie');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [updatingCategory, setUpdatingCategory] = useState<string | null>(null);
  
  // Upload dialog state
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadTitel, setUploadTitel] = useState("");
  const [uploadKategorie, setUploadKategorie] = useState<DokumentKategorie>("Sonstiges");
  
  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<string | null>(null);
  
  const handlePreview = async (dokument: any) => {
    try {
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from('dokumente')
        .createSignedUrl(dokument.pfad, 3600);

      if (signedUrlError) {
        toast({
          variant: "destructive",
          title: "Vorschau fehlgeschlagen",
          description: `Fehler: ${signedUrlError.message}`
        });
        return;
      }

      window.open(signedUrlData.signedUrl, '_blank');
    } catch (error) {
      toast({
        title: "Fehler",
        description: "Vorschau konnte nicht geöffnet werden.",
        variant: "destructive",
      });
    }
  };

  // Sort documents
  const sortedDokumente = useMemo(() => {
    if (!dokumente || dokumente.length === 0) return [];
    
    const sorted = [...dokumente].sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'kategorie':
          comparison = (a.kategorie || '').localeCompare(b.kategorie || '');
          break;
        case 'titel':
          comparison = (a.titel || '').localeCompare(b.titel || '');
          break;
        case 'datum':
          const dateA = new Date(a.hochgeladen_am || 0).getTime();
          const dateB = new Date(b.hochgeladen_am || 0).getTime();
          comparison = dateA - dateB;
          break;
        default:
          return 0;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    return sorted;
  }, [dokumente, sortBy, sortDirection]);

  // Group documents by category for better overview
  const groupedDokumente = useMemo(() => {
    const groups: { [key: string]: any[] } = {};
    
    sortedDokumente.forEach(doc => {
      const kategorie = doc.kategorie || 'Sonstiges';
      if (!groups[kategorie]) {
        groups[kategorie] = [];
      }
      groups[kategorie].push(doc);
    });
    
    return groups;
  }, [sortedDokumente]);

  const handleSort = (newSortBy: SortBy) => {
    if (sortBy === newSortBy) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSortBy);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: SortBy) => {
    if (sortBy !== field) return <ArrowUpDown className="h-4 w-4" />;
    return sortDirection === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />;
  };

  const handleCategoryChange = async (dokumentId: string, newCategory: string) => {
    setUpdatingCategory(dokumentId);
    try {
      const { error } = await supabase
        .from('dokumente')
        .update({ kategorie: newCategory as any }) // Cast to avoid TypeScript enum issues
        .eq('id', dokumentId);

      if (error) {
        toast({
          title: "Fehler",
          description: "Kategorie konnte nicht geändert werden.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Erfolg",
          description: "Kategorie wurde erfolgreich geändert.",
        });
        // Trigger refresh if callback provided
        onDocumentsChange?.();
      }
    } catch (error) {
      toast({
        title: "Fehler", 
        description: "Ein Fehler ist aufgetreten.",
        variant: "destructive",
      });
    } finally {
      setUpdatingCategory(null);
      setEditingCategory(null);
    }
  };

  const handleDownload = async (dokument: any) => {
    if (!dokument || !dokument.pfad) {
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

      if (signedUrlError) {
        toast({
          variant: "destructive",
          title: "Download fehlgeschlagen",
          description: `Fehler beim Download: ${signedUrlError.message}`
        });
        return;
      }

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
      setUploadTitel(file.name); // Always update title with new file name
    }
  };

  const handleFileDrop = (file: File) => {
    setSelectedFile(file);
    setUploadTitel(file.name);
    setUploadKategorie("Sonstiges");
    setIsUploadDialogOpen(true);
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
        titel: uploadTitel || selectedFile.name,
        kategorie: uploadKategorie,
      });

      // Refresh documents list
      queryClient.invalidateQueries({ queryKey: ['dokumente-detail', mietvertragId] });
      onDocumentsChange?.();

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
      queryClient.invalidateQueries({ queryKey: ['dokumente-detail', mietvertragId] });
      onDocumentsChange?.();
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

  return (
    <>
      <DocumentDragDropZone onFileSelect={handleFileDrop}>
        <div className="space-y-4">
          <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FileText className="h-5 w-5" />
                <span>Dokumente</span>
                <Badge variant="secondary" className="ml-2">
                  {dokumente?.length || 0}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                {/* Upload Button */}
                <Button
                  onClick={() => {
                    // Reset form when opening
                    setSelectedFile(null);
                    setUploadTitel("");
                    setUploadKategorie("Sonstiges");
                    setIsUploadDialogOpen(true);
                  }}
                  size="sm"
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Hochladen
                </Button>
                
                {/* Sorting Controls */}
                {dokumente && dokumente.length > 0 && (
                  <>
                    <span className="text-sm text-muted-foreground">Sortieren:</span>
                    <Button
                      variant={sortBy === 'kategorie' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleSort('kategorie')}
                      className="gap-1"
                    >
                      Kategorie {getSortIcon('kategorie')}
                    </Button>
                    <Button
                      variant={sortBy === 'titel' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleSort('titel')}
                      className="gap-1"
                    >
                      Titel {getSortIcon('titel')}
                    </Button>
                    <Button
                      variant={sortBy === 'datum' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleSort('datum')}
                      className="gap-1"
                    >
                      Datum {getSortIcon('datum')}
                    </Button>
                  </>
                )}
              </div>
            </CardTitle>
          </CardHeader>
        <CardContent>
          {dokumente && dokumente.length > 0 ? (
            <div className="space-y-4">
              {sortBy === 'kategorie' ? (
                // Group by category when sorting by category
                Object.entries(groupedDokumente).map(([kategorie, docs]) => (
                  <div key={kategorie} className="space-y-3">
                    <div className="flex items-center gap-2 pb-2 border-b">
                      <Badge variant="outline" className="px-3 py-1">
                        {kategorie}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        ({docs.length} Dokument{docs.length !== 1 ? 'e' : ''})
                      </span>
                    </div>
                    
                    {docs.map((dok) => (
                      <div
                        key={dok.id}
                        className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center space-x-3 flex-1">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-medium">{dok.titel}</p>
                              
                              {/* Editable Category */}
                              <div className="flex items-center gap-1">
                                {editingCategory === dok.id ? (
                                  <div className="flex items-center gap-1">
                                    <Select
                                      value={dok.kategorie}
                                      onValueChange={(value) => handleCategoryChange(dok.id, value)}
                                      disabled={updatingCategory === dok.id}
                                    >
                                      <SelectTrigger className="w-40 h-7">
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
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setEditingCategory(null)}
                                      className="h-7 w-7 p-0"
                                    >
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <Badge variant="secondary" className="text-xs">
                                      {dok.kategorie}
                                    </Badge>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setEditingCategory(dok.id)}
                                      className="h-6 w-6 p-0 opacity-50 hover:opacity-100"
                                    >
                                      <Edit3 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            <p className="text-sm text-muted-foreground">
                              {formatDatum(dok.hochgeladen_am)}
                              {dok.groesse_bytes && ` • ${Math.round(dok.groesse_bytes / 1024)}KB`}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <Button
                            onClick={() => handlePreview(dok)}
                            size="sm"
                            variant="outline"
                            disabled={updatingCategory === dok.id}
                            className="flex items-center space-x-2"
                          >
                            <Eye className="h-4 w-4" />
                            <span>Vorschau</span>
                          </Button>
                          
                          <Button
                            onClick={() => handleDownload(dok)}
                            size="sm"
                            variant="outline"
                            disabled={downloading === dok.id || updatingCategory === dok.id}
                            className="flex items-center space-x-2"
                          >
                            {downloading === dok.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                            <span>{downloading === dok.id ? 'Lädt...' : 'Download'}</span>
                          </Button>
                          
                          <Button
                            onClick={() => handleDeleteClick(dok.id)}
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                // Linear list for other sorting
                sortedDokumente.map((dok) => (
                  <div
                    key={dok.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center space-x-3 flex-1">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium">{dok.titel}</p>
                          
                          {/* Editable Category */}
                          <div className="flex items-center gap-1">
                            {editingCategory === dok.id ? (
                              <div className="flex items-center gap-1">
                                <Select
                                  value={dok.kategorie}
                                  onValueChange={(value) => handleCategoryChange(dok.id, value)}
                                  disabled={updatingCategory === dok.id}
                                >
                                  <SelectTrigger className="w-40 h-7">
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
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setEditingCategory(null)}
                                  className="h-7 w-7 p-0"
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <Badge variant="secondary" className="text-xs">
                                  {dok.kategorie}
                                </Badge>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setEditingCategory(dok.id)}
                                  className="h-6 w-6 p-0 opacity-50 hover:opacity-100"
                                >
                                  <Edit3 className="h-3 w-3" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <p className="text-sm text-muted-foreground">
                          {dok.kategorie} • {formatDatum(dok.hochgeladen_am)}
                          {dok.groesse_bytes && ` • ${Math.round(dok.groesse_bytes / 1024)}KB`}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => handlePreview(dok)}
                        size="sm"
                        variant="outline"
                        disabled={updatingCategory === dok.id}
                        className="flex items-center space-x-2"
                      >
                        <Eye className="h-4 w-4" />
                        <span>Vorschau</span>
                      </Button>
                      
                      <Button
                        onClick={() => handleDownload(dok)}
                        size="sm"
                        variant="outline"
                        disabled={downloading === dok.id || updatingCategory === dok.id}
                        className="flex items-center space-x-2"
                      >
                        {downloading === dok.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        <span>{downloading === dok.id ? 'Lädt...' : 'Download'}</span>
                      </Button>
                      
                      <Button
                        onClick={() => handleDeleteClick(dok.id)}
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Keine Dokumente vorhanden</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>

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
            <Select value={uploadKategorie} onValueChange={setUploadKategorie}>
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
      </DocumentDragDropZone>
    </>
  );
}