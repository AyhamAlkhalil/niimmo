import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useDocumentUpload } from "@/hooks/useDocumentUpload";
import { DocumentDragDropZone } from "./DocumentDragDropZone";
import { PdfPreviewModal } from "./PdfPreviewModal";
import { Progress } from "@/components/ui/progress";
import { Plus, Shield, Pencil, Trash2, Upload, FileText, Download, Eye, Building2, Phone, Mail, User } from "lucide-react";
import { toast } from "sonner";

interface ImmobilienVersicherungenTabProps {
  immobilieId: string;
}

const VERSICHERUNG_TYPEN = [
  "Wohngebäudeversicherung",
  "Haftpflichtversicherung",
  "Hausratversicherung",
  "Rechtsschutzversicherung",
  "Elementarversicherung",
  "Sonstige",
];

interface VersicherungFormData {
  typ: string;
  firma: string;
  kontaktperson: string;
  email: string;
  telefon: string;
  vertragsnummer: string;
  jahresbeitrag: string;
  notizen: string;
}

const emptyForm: VersicherungFormData = {
  typ: "",
  firma: "",
  kontaktperson: "",
  email: "",
  telefon: "",
  vertragsnummer: "",
  jahresbeitrag: "",
  notizen: "",
};

export const ImmobilienVersicherungenTab = ({ immobilieId }: ImmobilienVersicherungenTabProps) => {
  const queryClient = useQueryClient();
  const { uploadDocument, uploading, progress } = useDocumentUpload();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<VersicherungFormData>(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Document upload state
  const [uploadVersicherungId, setUploadVersicherungId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadTitel, setUploadTitel] = useState("");
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  // PDF preview
  const [previewDokument, setPreviewDokument] = useState<any>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Fetch versicherungen
  const { data: versicherungen, isLoading, isError, refetch } = useQuery({
    queryKey: ["versicherungen", immobilieId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("versicherungen" as any)
        .select("*")
        .eq("immobilie_id", immobilieId)
        .order("typ");
      if (error) throw error;
      return data as any[];
    },
  });

  // Fetch versicherungs-dokumente
  const { data: dokumente } = useQuery({
    queryKey: ["versicherungen-dokumente", immobilieId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dokumente")
        .select("*")
        .eq("immobilie_id", immobilieId)
        .eq("kategorie", "Versicherungen" as any)
        .eq("geloescht", false)
        .order("hochgeladen_am", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const handleSave = async () => {
    if (!formData.typ) {
      toast.error("Bitte Versicherungstyp auswählen");
      return;
    }

    const payload = {
      immobilie_id: immobilieId,
      typ: formData.typ,
      firma: formData.firma || null,
      kontaktperson: formData.kontaktperson || null,
      email: formData.email || null,
      telefon: formData.telefon || null,
      vertragsnummer: formData.vertragsnummer || null,
      jahresbeitrag: formData.jahresbeitrag ? parseFloat(formData.jahresbeitrag) : null,
      notizen: formData.notizen || null,
    };

    if (editingId) {
      const { error } = await supabase
        .from("versicherungen" as any)
        .update(payload)
        .eq("id", editingId);
      if (error) {
        toast.error("Fehler beim Speichern");
        return;
      }
      toast.success("Versicherung aktualisiert");
    } else {
      const { error } = await supabase
        .from("versicherungen" as any)
        .insert([payload]);
      if (error) {
        toast.error("Fehler beim Anlegen");
        return;
      }
      toast.success("Versicherung hinzugefügt");
    }

    queryClient.invalidateQueries({ queryKey: ["versicherungen", immobilieId] });
    setFormData(emptyForm);
    setEditingId(null);
    setIsFormOpen(false);
  };

  const handleEdit = (v: any) => {
    setFormData({
      typ: v.typ || "",
      firma: v.firma || "",
      kontaktperson: v.kontaktperson || "",
      email: v.email || "",
      telefon: v.telefon || "",
      vertragsnummer: v.vertragsnummer || "",
      jahresbeitrag: v.jahresbeitrag ? String(v.jahresbeitrag) : "",
      notizen: v.notizen || "",
    });
    setEditingId(v.id);
    setIsFormOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase
      .from("versicherungen" as any)
      .delete()
      .eq("id", deleteId);
    if (error) {
      toast.error("Fehler beim Löschen");
    } else {
      toast.success("Versicherung gelöscht");
      queryClient.invalidateQueries({ queryKey: ["versicherungen", immobilieId] });
    }
    setDeleteId(null);
  };

  // Document handling
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setUploadTitel(file.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleFileDrop = (file: File) => {
    setSelectedFile(file);
    setUploadTitel(file.name.replace(/\.[^/.]+$/, ""));
    setIsUploadDialogOpen(true);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    try {
      await uploadDocument(selectedFile, {
        immobilieId,
        kategorie: "Versicherungen",
        titel: uploadTitel || selectedFile.name,
      });
      queryClient.invalidateQueries({ queryKey: ["versicherungen-dokumente", immobilieId] });
      setSelectedFile(null);
      setUploadTitel("");
      setIsUploadDialogOpen(false);
    } catch {
      // Toast already shown by hook
    }
  };

  const handlePreview = async (dok: any) => {
    setPreviewDokument(dok);
    setIsPreviewOpen(true);
  };

  const handleDownload = async (dok: any) => {
    const { data } = await supabase.storage
      .from("dokumente")
      .createSignedUrl(dok.pfad, 3600);
    if (data?.signedUrl) {
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = dok.titel || "download";
      a.click();
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    const { error } = await supabase
      .from("dokumente")
      .update({ geloescht: true })
      .eq("id", docId);
    if (error) {
      toast.error("Fehler beim Löschen");
    } else {
      toast.success("Dokument gelöscht");
      queryClient.invalidateQueries({ queryKey: ["versicherungen-dokumente", immobilieId] });
    }
  };

  const getDokumenteForVersicherung = (versicherungTyp: string) => {
    return dokumente?.filter((d) => d.titel?.toLowerCase().includes(versicherungTyp.toLowerCase())) || [];
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Versicherungen</h3>
          <Badge variant="secondary">{versicherungen?.length || 0}</Badge>
        </div>
        <Dialog open={isFormOpen} onOpenChange={(open) => {
          setIsFormOpen(open);
          if (!open) {
            setFormData(emptyForm);
            setEditingId(null);
          }
        }}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Versicherung hinzufügen
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Versicherung bearbeiten" : "Neue Versicherung"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Versicherungstyp *</Label>
                <Select value={formData.typ} onValueChange={(v) => setFormData((p) => ({ ...p, typ: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Typ auswählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {VERSICHERUNG_TYPEN.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Firma</Label>
                  <Input value={formData.firma} onChange={(e) => setFormData((p) => ({ ...p, firma: e.target.value }))} placeholder="z.B. Allianz" />
                </div>
                <div>
                  <Label>Vertragsnummer</Label>
                  <Input value={formData.vertragsnummer} onChange={(e) => setFormData((p) => ({ ...p, vertragsnummer: e.target.value }))} placeholder="Vertragsnr." />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Kontaktperson</Label>
                  <Input value={formData.kontaktperson} onChange={(e) => setFormData((p) => ({ ...p, kontaktperson: e.target.value }))} placeholder="Name" />
                </div>
                <div>
                  <Label>Telefon</Label>
                  <Input value={formData.telefon} onChange={(e) => setFormData((p) => ({ ...p, telefon: e.target.value }))} placeholder="+49..." />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>E-Mail</Label>
                  <Input type="email" value={formData.email} onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))} placeholder="mail@versicherung.de" />
                </div>
                <div>
                  <Label>Jahresbeitrag (€)</Label>
                  <Input type="number" step="0.01" value={formData.jahresbeitrag} onChange={(e) => setFormData((p) => ({ ...p, jahresbeitrag: e.target.value }))} placeholder="0,00" />
                </div>
              </div>
              <div>
                <Label>Notizen</Label>
                <Textarea value={formData.notizen} onChange={(e) => setFormData((p) => ({ ...p, notizen: e.target.value }))} placeholder="Anmerkungen..." rows={2} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setIsFormOpen(false); setFormData(emptyForm); setEditingId(null); }}>
                  Abbrechen
                </Button>
                <Button onClick={handleSave}>
                  {editingId ? "Speichern" : "Hinzufügen"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Versicherungsliste */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Laden...</div>
      ) : isError ? (
        // Bis zum 27.10.2026 sah ein Ladefehler aus wie „Noch keine Versicherungen hinterlegt“
        <div role="alert" className="text-center py-8 text-sm text-destructive space-y-2">
          <div>Die Versicherungen konnten nicht geladen werden.</div>
          <button type="button" onClick={() => refetch()} className="font-medium text-primary underline-offset-4 hover:underline">Erneut versuchen</button>
        </div>
      ) : !versicherungen?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Shield className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">Noch keine Versicherungen hinterlegt</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Fügen Sie Wohngebäude- oder Haftpflichtversicherungen hinzu
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {versicherungen.map((v: any) => (
            <Card key={v.id} className="relative group">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-primary/10 rounded-lg">
                      <Shield className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold">{v.typ}</CardTitle>
                      {v.firma && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Building2 className="h-3 w-3" />
                          {v.firma}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleEdit(v)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => setDeleteId(v.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {v.vertragsnummer && (
                  <p className="text-xs text-muted-foreground">
                    Vertragsnr.: <span className="text-foreground font-medium">{v.vertragsnummer}</span>
                  </p>
                )}
                <div className="grid grid-cols-1 gap-1">
                  {v.kontaktperson && (
                    <p className="text-xs flex items-center gap-1.5 text-muted-foreground">
                      <User className="h-3 w-3" />
                      <span className="text-foreground">{v.kontaktperson}</span>
                    </p>
                  )}
                  {v.telefon && (
                    <p className="text-xs flex items-center gap-1.5 text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      <a href={`tel:${v.telefon}`} className="text-primary hover:underline">{v.telefon}</a>
                    </p>
                  )}
                  {v.email && (
                    <p className="text-xs flex items-center gap-1.5 text-muted-foreground">
                      <Mail className="h-3 w-3" />
                      <a href={`mailto:${v.email}`} className="text-primary hover:underline">{v.email}</a>
                    </p>
                  )}
                </div>
                {v.jahresbeitrag && (
                  <div className="bg-muted/50 rounded-md px-2 py-1 inline-block">
                    <span className="text-xs text-muted-foreground">Jahresbeitrag: </span>
                    <span className="text-sm font-semibold text-foreground">€{Number(v.jahresbeitrag).toLocaleString("de-DE", { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {v.notizen && (
                  <p className="text-xs text-muted-foreground italic">{v.notizen}</p>
                )}
                {/* Upload-Button für diesen Versicherungstyp */}
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 h-7 text-xs"
                  onClick={() => {
                    setUploadVersicherungId(v.id);
                    setUploadTitel(`${v.typ} - ${v.firma || "Dokument"}`);
                    setIsUploadDialogOpen(true);
                  }}
                >
                  <Upload className="h-3 w-3 mr-1" />
                  PDF hochladen
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dokumente-Bereich */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Versicherungsdokumente
              <Badge variant="secondary" className="text-xs">{dokumente?.length || 0}</Badge>
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => {
              setUploadVersicherungId(null);
              setUploadTitel("");
              setIsUploadDialogOpen(true);
            }}>
              <Upload className="h-3.5 w-3.5 mr-1" />
              Hochladen
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DocumentDragDropZone onFileSelect={handleFileDrop} accept=".pdf,.jpg,.jpeg,.png">
            {dokumente && dokumente.length > 0 ? (
              <div className="space-y-2">
                {dokumente.map((dok: any) => (
                  <div key={dok.id} className="flex items-center justify-between bg-muted/30 rounded-lg p-2.5 border border-border/50 group">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{dok.titel}</p>
                        <p className="text-xs text-muted-foreground">
                          {dok.hochgeladen_am ? new Date(dok.hochgeladen_am).toLocaleDateString("de-DE") : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {dok.dateityp?.includes("pdf") && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handlePreview(dok)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleDownload(dok)}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteDoc(dok.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Dokumente hier ablegen oder über den Button hochladen
              </div>
            )}
          </DocumentDragDropZone>
        </CardContent>
      </Card>

      {/* Upload Dialog */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Versicherungsdokument hochladen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Datei auswählen</Label>
              <Input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileSelect} />
            </div>
            <div>
              <Label>Titel</Label>
              <Input value={uploadTitel} onChange={(e) => setUploadTitel(e.target.value)} placeholder="Dokumenttitel" />
            </div>
            {uploading && <Progress value={progress} className="h-2" />}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setIsUploadDialogOpen(false); setSelectedFile(null); }}>
                Abbrechen
              </Button>
              <Button onClick={handleUpload} disabled={!selectedFile || uploading}>
                {uploading ? "Laden..." : "Hochladen"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Versicherung löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchten Sie diese Versicherung wirklich löschen? Die zugehörigen Dokumente bleiben erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* PDF Preview */}
      <PdfPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => { setIsPreviewOpen(false); setPreviewDokument(null); }}
        dokument={previewDokument}
      />
    </div>
  );
};
