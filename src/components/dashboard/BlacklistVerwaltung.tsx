import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ShieldAlert, Plus, Trash2, Search, User, Mail, Phone, AlertTriangle } from "lucide-react";
import { toast } from "@/components/ui/use-toast";

interface BlacklistEintrag {
  id: string;
  name: string;
  email: string | null;
  telefon: string | null;
  grund: string | null;
  notizen: string | null;
  created_at: string;
}

interface BlacklistVerwaltungProps {
  onBack: () => void;
}

const leererEintrag = { name: "", email: "", telefon: "", grund: "", notizen: "" };

export function BlacklistVerwaltung({ onBack }: BlacklistVerwaltungProps) {
  const queryClient = useQueryClient();
  const [suchbegriff, setSuchbegriff] = useState("");
  const [dialogOffen, setDialogOffen] = useState(false);
  const [loeschenId, setLoeschenId] = useState<string | null>(null);
  const [formular, setFormular] = useState(leererEintrag);

  const { data: eintraege = [], isLoading } = useQuery<BlacklistEintrag[]>({
    queryKey: ["blacklist"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bewerbung_blacklist")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as BlacklistEintrag[];
    },
  });

  const hinzufuegenMutation = useMutation({
    mutationFn: async (eintrag: typeof leererEintrag) => {
      const { error } = await supabase.from("bewerbung_blacklist").insert({
        name: eintrag.name.trim(),
        email: eintrag.email.trim() || null,
        telefon: eintrag.telefon.trim() || null,
        grund: eintrag.grund.trim() || null,
        notizen: eintrag.notizen.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blacklist"] });
      setDialogOffen(false);
      setFormular(leererEintrag);
      toast({ title: "Eintrag hinzugefügt", description: "Person wurde zur Blacklist hinzugefügt." });
    },
    onError: () => {
      toast({ title: "Fehler", description: "Eintrag konnte nicht gespeichert werden.", variant: "destructive" });
    },
  });

  const loeschenMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bewerbung_blacklist").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blacklist"] });
      setLoeschenId(null);
      toast({ title: "Eintrag entfernt", description: "Person wurde von der Blacklist entfernt." });
    },
    onError: () => {
      toast({ title: "Fehler", description: "Eintrag konnte nicht gelöscht werden.", variant: "destructive" });
    },
  });

  const gefilterteEintraege = eintraege.filter((e) => {
    if (!suchbegriff.trim()) return true;
    const s = suchbegriff.toLowerCase();
    return (
      e.name.toLowerCase().includes(s) ||
      e.email?.toLowerCase().includes(s) ||
      e.telefon?.toLowerCase().includes(s) ||
      e.grund?.toLowerCase().includes(s)
    );
  });

  const handleSpeichern = () => {
    if (!formular.name.trim()) {
      toast({ title: "Name erforderlich", description: "Bitte gib mindestens einen Namen ein.", variant: "destructive" });
      return;
    }
    hinzufuegenMutation.mutate(formular);
  };

  return (
    <div className="min-h-screen modern-dashboard-bg">
      <div className="container mx-auto px-4 py-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="glass-card p-4 sm:p-6 rounded-xl sm:rounded-2xl mb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Zurück
              </Button>
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-6 w-6 text-orange-600" />
                <h1 className="text-xl sm:text-2xl font-sans font-bold text-gray-800">Bewerbungs-Blacklist</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 font-semibold">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {eintraege.length} {eintraege.length === 1 ? "Person" : "Personen"}
              </Badge>
              <Button
                onClick={() => { setFormular(leererEintrag); setDialogOffen(true); }}
                size="sm"
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Eintrag hinzufügen
              </Button>
            </div>
          </div>

          <p className="text-gray-500 text-sm mt-3 ml-1">
            Personen auf dieser Liste sollen bei Bewerbungen sofort geprüft werden. Chilla (KI-Chat) kennt diese Liste und kann gezielt danach suchen.
          </p>
        </div>

        {/* Suche */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Name, E-Mail oder Telefon suchen..."
            value={suchbegriff}
            onChange={(e) => setSuchbegriff(e.target.value)}
            className="pl-9 bg-white/80 border-gray-200"
          />
        </div>

        {/* Liste */}
        {isLoading ? (
          <div className="glass-card rounded-xl p-12 text-center text-gray-400">Lade Liste...</div>
        ) : gefilterteEintraege.length === 0 ? (
          <div className="glass-card rounded-xl p-12 text-center">
            <ShieldAlert className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">
              {suchbegriff ? "Keine Treffer für diese Suche." : "Die Blacklist ist leer."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {gefilterteEintraege.map((eintrag) => (
              <div key={eintrag.id} className="glass-card rounded-xl p-4 border-l-4 border-orange-400">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <User className="h-4 w-4 text-orange-600 shrink-0" />
                      <span className="font-semibold text-gray-800">{eintrag.name}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 ml-6">
                      {eintrag.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {eintrag.email}
                        </span>
                      )}
                      {eintrag.telefon && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {eintrag.telefon}
                        </span>
                      )}
                    </div>
                    {eintrag.grund && (
                      <div className="ml-6 mt-1">
                        <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">
                          {eintrag.grund}
                        </Badge>
                      </div>
                    )}
                    {eintrag.notizen && (
                      <p className="ml-6 mt-1 text-xs text-gray-400 italic">{eintrag.notizen}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-400">
                      {new Date(eintrag.created_at).toLocaleDateString("de-DE")}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => setLoeschenId(eintrag.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hinzufügen-Dialog */}
      <Dialog open={dialogOffen} onOpenChange={setDialogOffen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-orange-600" />
              Person zur Blacklist hinzufügen
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Name *</label>
              <Input
                placeholder="Vor- und Nachname"
                value={formular.name}
                onChange={(e) => setFormular((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">E-Mail</label>
              <Input
                type="email"
                placeholder="beispiel@email.de"
                value={formular.email}
                onChange={(e) => setFormular((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Telefon</label>
              <Input
                type="tel"
                placeholder="+49 123 456789"
                value={formular.telefon}
                onChange={(e) => setFormular((f) => ({ ...f, telefon: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Grund</label>
              <Input
                placeholder="z.B. Zahlungsausfälle, Vandalismus..."
                value={formular.grund}
                onChange={(e) => setFormular((f) => ({ ...f, grund: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Notizen</label>
              <Textarea
                placeholder="Zusätzliche Informationen..."
                value={formular.notizen}
                onChange={(e) => setFormular((f) => ({ ...f, notizen: e.target.value }))}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOffen(false)}>Abbrechen</Button>
            <Button
              onClick={handleSpeichern}
              disabled={hinzufuegenMutation.isPending}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {hinzufuegenMutation.isPending ? "Wird gespeichert..." : "Hinzufügen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Löschen-Bestätigung */}
      <AlertDialog open={!!loeschenId} onOpenChange={(o) => { if (!o) setLoeschenId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Person von Blacklist entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              Diese Person wird dauerhaft von der Blacklist entfernt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => loeschenId && loeschenMutation.mutate(loeschenId)}
            >
              Entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
