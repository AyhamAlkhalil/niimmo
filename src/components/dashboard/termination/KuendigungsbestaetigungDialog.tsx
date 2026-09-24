import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Download, Eye, FileCheck, Loader2, Mail, RefreshCw, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useActivityLog } from "@/hooks/useActivityLog";
import { supabase } from "@/integrations/supabase/client";
import { getVertragsende } from "@/utils/contractUtils";
import { formatDatum } from "@/utils/pdf/briefLayout";
import { generateKuendigungsbestaetigungPdf } from "@/utils/kuendigungPdfGenerator";
import {
  anredeAusDatenbank,
  bestaetigungsAbsaetze,
  briefanrede,
  mailadressenDerMieter,
  type Anrede,
  type BestaetigungsDaten,
} from "@/utils/kuendigungsbestaetigung";

interface KuendigungsbestaetigungDialogProps {
  isOpen: boolean;
  onClose: () => void;
  vertragId: string;
  /** Nach Speichern, damit die Dokumentenliste neu lädt. */
  onGespeichert?: () => void;
  /** Angaben aus der eben erfassten Mieterkündigung. */
  vorbelegung?: { schreibenVom: string | null; eingangAm: string | null } | null;
}

interface MieterZeile {
  id: string;
  vorname: string;
  nachname: string;
  anrede: string | null;
  hauptmail: string | null;
  weitere_mails: string | null;
}

interface Vertragsdaten {
  startDatum: string | null;
  vertragsende: string | null;
  vertragsart: string | null;
  einheitentyp: string | null;
  hatKaution: boolean;
  neueAnschriftBekannt: boolean;
  immobilieName: string;
  immobilieAdresse: string;
  einheitVorschlag: string;
  mieter: MieterZeile[];
}

function heuteIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** supabase-js meldet bei 4xx/5xx nur „non-2xx" — der eigentliche Text steht im Antwortkörper. */
async function fehlertextAus(error: unknown): Promise<string> {
  const antwort = (error as { context?: Response } | null)?.context;
  if (antwort && typeof antwort.json === "function") {
    try {
      const body = await antwort.json();
      if (body?.error) return String(body.error);
    } catch {
      /* kein JSON */
    }
  }
  return error instanceof Error ? error.message : "Unbekannter Fehler";
}

async function ladeVertragsdaten(vertragId: string): Promise<Vertragsdaten> {
  const { data: vertrag, error: vertragFehler } = await supabase
    .from("mietvertrag")
    .select("einheit_id, start_datum, ende_datum, kuendigungsdatum, vertragsart, kaution_betrag, kaution_ist, neue_anschrift, einheiten ( bezeichnung, zaehler, einheitentyp, immobilien ( name, adresse ) )")
    .eq("id", vertragId)
    .single();
  if (vertragFehler) throw vertragFehler;

  const { data: links, error: mieterFehler } = await supabase
    .from("mietvertrag_mieter")
    .select("mieter ( id, vorname, nachname, anrede, hauptmail, weitere_mails )")
    .eq("mietvertrag_id", vertragId);
  if (mieterFehler) throw mieterFehler;

  const einheit = vertrag.einheiten as {
    bezeichnung: string | null;
    zaehler: number | null;
    einheitentyp: string | null;
    immobilien: { name: string | null; adresse: string | null } | null;
  } | null;

  // Einheitennummer wie in der Detailansicht: Zähler, sonst die letzten zwei Stellen der ID.
  const nummer = einheit?.zaehler
    ? String(einheit.zaehler).padStart(2, "0")
    : (vertrag.einheit_id ?? "").slice(-2);

  return {
    startDatum: vertrag.start_datum,
    vertragsende: getVertragsende(vertrag),
    vertragsart: vertrag.vertragsart,
    einheitentyp: einheit?.einheitentyp ?? null,
    hatKaution: Number(vertrag.kaution_betrag || 0) > 0 || Number(vertrag.kaution_ist || 0) > 0,
    neueAnschriftBekannt: Boolean(vertrag.neue_anschrift?.trim()),
    immobilieName: einheit?.immobilien?.name ?? "",
    immobilieAdresse: einheit?.immobilien?.adresse ?? "",
    einheitVorschlag: einheit?.bezeichnung?.trim() || (nummer ? `WE ${nummer}` : ""),
    mieter: (links ?? [])
      .map(l => l.mieter as MieterZeile | null)
      .filter((m): m is MieterZeile => Boolean(m)),
  };
}

export const KuendigungsbestaetigungDialog = ({
  isOpen,
  onClose,
  vertragId,
  onGespeichert,
  vorbelegung,
}: KuendigungsbestaetigungDialogProps) => {
  const { toast } = useToast();
  const { logActivity } = useActivityLog();

  const { data: vertrag, isLoading, error: ladefehler, refetch } = useQuery({
    queryKey: ["kuendigungsbestaetigung", vertragId],
    queryFn: () => ladeVertragsdaten(vertragId),
    enabled: isOpen && Boolean(vertragId),
    // Direkt nach dem Upload geöffnet — das Vertragsende muss frisch sein.
    staleTime: 0,
    gcTime: 0,
    // Ein Neuladen bei Fensterfokus würde das offene Formular zurücksetzen.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const [anreden, setAnreden] = useState<Record<string, Anrede>>({});
  const [strasse, setStrasse] = useState("");
  const [plzOrt, setPlzOrt] = useState("");
  const [einheitBezeichnung, setEinheitBezeichnung] = useState("");
  const [schreibenVom, setSchreibenVom] = useState("");
  const [eingangAm, setEingangAm] = useState("");
  const [useFreitext, setUseFreitext] = useState(false);
  const [freitext, setFreitext] = useState("");
  const [bemerkungen, setBemerkungen] = useState("");
  const [ausgewaehlt, setAusgewaehlt] = useState<string[]>([]);

  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  /** Formularstand, aus dem `pdfBlob` erzeugt wurde. */
  const [blobSignatur, setBlobSignatur] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [vorschauFehler, setVorschauFehler] = useState(false);
  const [erzeugt, setErzeugt] = useState(false);
  const [gespeichert, setGespeichert] = useState<{ pfad: string; signatur: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [versendetAn, setVersendetAn] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const laufNummer = useRef(0);
  // Sperre gegen Doppelklick: der Button wird erst beim nächsten Render deaktiviert.
  const vorgangLaeuft = useRef(false);
  // Vorbelegt wird einmal je Öffnen — ein späteres „Erneut laden" oder ein
  // Hintergrund-Refetch darf Eingaben nicht überschreiben (Review 24.09.2026).
  const vorbelegt = useRef(false);

  // Formular bei jedem Öffnen aus den Vertragsdaten vorbelegen
  useEffect(() => {
    if (!isOpen) {
      vorbelegt.current = false;
      return;
    }
    if (!vertrag || vorbelegt.current) return;
    vorbelegt.current = true;
    setAnreden(Object.fromEntries(vertrag.mieter.map(m => [m.id, anredeAusDatenbank(m.anrede)])));
    const [strasseTeil, ...rest] = vertrag.immobilieAdresse.split(",");
    setStrasse(strasseTeil?.trim() ?? "");
    setPlzOrt(rest.join(",").trim());
    setEinheitBezeichnung(vertrag.einheitVorschlag);
    setSchreibenVom(vorbelegung?.schreibenVom ?? "");
    setEingangAm(vorbelegung ? (vorbelegung.eingangAm ?? "") : heuteIso());
    setUseFreitext(false);
    setFreitext("");
    setBemerkungen("");
    setAusgewaehlt(vertrag.mieter.map(m => m.hauptmail?.trim().toLowerCase()).filter((m): m is string => Boolean(m?.includes("@"))));
    setGespeichert(null);
    setVersendetAn(null);
  }, [isOpen, vertrag, vorbelegung]);

  const adressen = useMemo(() => mailadressenDerMieter(vertrag?.mieter ?? []), [vertrag]);

  const pdfDaten = useMemo((): BestaetigungsDaten | null => {
    if (!vertrag?.vertragsende) return null;
    return {
      mieter: vertrag.mieter.map(m => ({
        vorname: m.vorname ?? "",
        nachname: m.nachname ?? "",
        anrede: anreden[m.id] ?? "ohne",
      })),
      strasse,
      plzOrt,
      einheitBezeichnung,
      immobilieAdresse: vertrag.immobilieAdresse,
      vertragsart: vertrag.vertragsart,
      einheitentyp: vertrag.einheitentyp,
      vertragStart: vertrag.startDatum,
      vertragsende: vertrag.vertragsende,
      schreibenVom: schreibenVom || null,
      eingangAm: eingangAm || null,
      datum: heuteIso(),
      hatKaution: vertrag.hatKaution,
      neueAnschriftBekannt: vertrag.neueAnschriftBekannt,
      freitext: useFreitext ? freitext : undefined,
      bemerkungen: bemerkungen || undefined,
    };
  }, [vertrag, anreden, strasse, plzOrt, einheitBezeichnung, schreibenVom, eingangAm, useFreitext, freitext, bemerkungen]);

  const vorschauErzeugen = useCallback(async () => {
    if (!pdfDaten) return;
    const lauf = ++laufNummer.current;
    const stand = JSON.stringify(pdfDaten);
    try {
      const blob = await generateKuendigungsbestaetigungPdf(pdfDaten);
      // Ein älterer Lauf, der später fertig wird, darf den neueren nicht überschreiben.
      if (lauf !== laufNummer.current) return;
      setPdfBlob(blob);
      setBlobSignatur(stand);
      setPdfUrl(alt => {
        if (alt) URL.revokeObjectURL(alt);
        return URL.createObjectURL(blob);
      });
      setVorschauFehler(false);
    } catch (err) {
      console.error("Kündigungsbestätigung konnte nicht erzeugt werden:", err);
      if (lauf !== laufNummer.current) return;
      setPdfBlob(null);
      setBlobSignatur("");
      setVorschauFehler(true);
    } finally {
      setErzeugt(true);
    }
  }, [pdfDaten]);

  useEffect(() => {
    if (!isOpen || !pdfDaten) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(vorschauErzeugen, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [isOpen, pdfDaten, vorschauErzeugen]);

  useEffect(() => {
    if (isOpen) return;
    setErzeugt(false);
    setPdfBlob(null);
    setBlobSignatur("");
    setPdfUrl(alt => {
      if (alt) URL.revokeObjectURL(alt);
      return null;
    });
  }, [isOpen]);

  const signatur = pdfDaten ? JSON.stringify(pdfDaten) : "";
  // Die Vorschau läuft 400 ms hinter dem Formular her. Wer in dieser Zeit
  // speichert, würde sonst das alte PDF ablegen und versenden, während der
  // Dialog den neuen Stand als gespeichert meldet (Review 17.09.2026).
  const vorschauAktuell = pdfBlob !== null && blobSignatur === signatur;
  const istGespeichert = gespeichert !== null && gespeichert.signatur === signatur;

  const handleDownload = () => {
    if (!pdfUrl) return;
    const a = document.createElement("a");
    a.href = pdfUrl;
    a.download = `Kuendigungsbestaetigung_${heuteIso()}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  /** Legt das aktuelle Schreiben ab. Unverändert erneut aufgerufen, bleibt es bei einer Datei. */
  const speichern = async (): Promise<string> => {
    // Blob und Stand zu Beginn festhalten — beide gehören zusammen, auch wenn
    // während des Uploads weiter getippt wird.
    const blob = pdfBlob;
    const stand = blobSignatur;
    if (!blob || !pdfDaten) throw new Error("Das Schreiben ist noch nicht erzeugt.");
    if (stand !== signatur) throw new Error("Die Vorschau wird gerade aktualisiert. Bitte einen Moment warten und erneut versuchen.");
    if (gespeichert && gespeichert.signatur === stand) return gespeichert.pfad;

    const jetzt = new Date();
    const uhrzeit = [jetzt.getHours(), jetzt.getMinutes(), jetzt.getSeconds()].map(z => String(z).padStart(2, "0")).join("");
    // Keine Mieternamen im Dateinamen (docs/offene-punkte.md A-Block)
    const pfad = `kuendigungen/${vertragId}/Kuendigungsbestaetigung_${heuteIso()}_${uhrzeit}.pdf`;

    const { error: uploadFehler } = await supabase.storage
      .from("dokumente")
      .upload(pfad, blob, { contentType: "application/pdf", upsert: false });
    if (uploadFehler) throw new Error(`Speichern fehlgeschlagen: ${uploadFehler.message}`);

    const { error: eintragFehler } = await supabase.from("dokumente").insert({
      titel: `Kündigungsbestätigung ${formatDatum(heuteIso())}`,
      pfad,
      kategorie: "Kündigung",
      dateityp: "application/pdf",
      groesse_bytes: blob.size,
      mietvertrag_id: vertragId,
      hochgeladen_am: jetzt.toISOString(),
    });
    if (eintragFehler) {
      // Eine Datei ohne Zeile in `dokumente` ist im UI unsichtbar — dann lieber gar keine.
      await supabase.storage.from("dokumente").remove([pfad]);
      throw new Error(`Dokument konnte nicht eingetragen werden: ${eintragFehler.message}`);
    }

    setGespeichert({ pfad, signatur: stand });
    onGespeichert?.();
    logActivity("pdf_generiert", "mietvertrag", vertragId, { typ: "Kündigungsbestätigung" });
    return pfad;
  };

  const handleSpeichern = async () => {
    if (vorgangLaeuft.current) return;
    vorgangLaeuft.current = true;
    setIsSaving(true);
    try {
      await speichern();
      toast({ title: "Gespeichert", description: "Die Kündigungsbestätigung liegt jetzt in den Vertragsdokumenten." });
    } catch (err) {
      toast({ title: "Fehler", description: err instanceof Error ? err.message : "Unbekannter Fehler", variant: "destructive" });
    } finally {
      vorgangLaeuft.current = false;
      setIsSaving(false);
    }
  };

  const handleSenden = async () => {
    if (!pdfDaten || ausgewaehlt.length === 0 || vorgangLaeuft.current) return;
    vorgangLaeuft.current = true;
    // Anrede und Empfänger zum Zeitpunkt des Klicks — passend zum gespeicherten PDF.
    const anrede = briefanrede(pdfDaten.mieter);
    const empfaenger = [...ausgewaehlt];
    setIsSending(true);
    try {
      const pfad = await speichern();
      const { data, error } = await supabase.functions.invoke("send-kuendigungsbestaetigung", {
        body: {
          mietvertragId: vertragId,
          pdfPath: pfad,
          empfaenger,
          briefanrede: anrede,
        },
      });
      if (error) throw new Error(await fehlertextAus(error));
      if (data?.error) throw new Error(data.error);

      setVersendetAn(empfaenger.length);
      logActivity("kuendigungsbestaetigung_versendet", "mietvertrag", vertragId, { empfaenger: empfaenger.length });
      toast({
        title: "Kündigungsbestätigung versendet",
        description: `Die E-Mail ging an ${empfaenger.length === 1 ? "1 Adresse" : `${empfaenger.length} Adressen`}. Das Schreiben liegt in den Vertragsdokumenten.`,
      });
    } catch (err) {
      toast({ title: "Nicht versendet", description: err instanceof Error ? err.message : "Unbekannter Fehler", variant: "destructive" });
    } finally {
      vorgangLaeuft.current = false;
      setIsSending(false);
    }
  };

  const umschaltenFreitext = () => {
    if (!useFreitext && !freitext.trim() && pdfDaten) {
      // Standardtext als Ausgangspunkt übernehmen, statt mit leerem Feld zu beginnen
      setFreitext(bestaetigungsAbsaetze({ ...pdfDaten, freitext: undefined, bemerkungen: undefined }).join("\n\n"));
    }
    setUseFreitext(v => !v);
  };

  const beschaeftigt = isSaving || isSending;
  const fehltVertragsende = Boolean(vertrag) && !vertrag?.vertragsende;

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open && !beschaeftigt) onClose(); }}>
      <DialogContent className="max-w-[95vw] w-[1400px] max-h-[95vh] h-[90vh] overflow-hidden flex flex-col p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-b bg-background flex-shrink-0">
          <div className="flex items-center gap-3">
            <FileCheck className="h-5 w-5 text-primary" />
            <DialogTitle className="text-lg font-semibold">Kündigungsbestätigung</DialogTitle>
            <DialogDescription className="sr-only">
              Bestätigungsschreiben zur Kündigung des Mieters erzeugen, speichern und per E-Mail versenden.
            </DialogDescription>
            {versendetAn !== null ? (
              <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" />versendet</Badge>
            ) : istGespeichert ? (
              <Badge variant="outline">gespeichert</Badge>
            ) : null}
          </div>
          {vertrag && (
            <p className="text-sm text-muted-foreground mr-8">
              {vertrag.immobilieName}{einheitBezeichnung ? ` – ${einheitBezeichnung}` : ""}
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Vertragsdaten werden geladen …
          </div>
        ) : ladefehler ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="font-medium">Die Vertragsdaten konnten nicht geladen werden.</p>
            <p className="text-sm text-muted-foreground">Ohne sie lässt sich keine Bestätigung erzeugen.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1.5" />Erneut laden
            </Button>
          </div>
        ) : fehltVertragsende ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="font-medium">Am Vertrag ist kein Vertragsende eingetragen.</p>
            <p className="text-sm text-muted-foreground max-w-md">
              Die Bestätigung nennt das Datum, zu dem das Mietverhältnis endet. Bitte erfassen Sie zuerst die Kündigung.
            </p>
            <Button variant="outline" size="sm" onClick={onClose}>Schließen</Button>
          </div>
        ) : vertrag ? (
          <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
            {/* Ohne feste Höhe scrollt die Spalte auf dem Handy nicht — die Knöpfe lägen außer Reichweite. */}
            <ScrollArea className="flex-1 min-h-0 w-full md:flex-none md:w-[420px] md:border-r">
              <div className="p-5 space-y-5">
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Vertrag</h3>
                  <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1">
                    <p><span className="text-muted-foreground">Adresse:</span> {vertrag.immobilieAdresse || "–"}</p>
                    <p><span className="text-muted-foreground">Vertragsbeginn:</span> {formatDatum(vertrag.startDatum) || "–"}</p>
                    <p><span className="text-muted-foreground">Vertragsende:</span> <strong>{formatDatum(vertrag.vertragsende)}</strong></p>
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Empfänger im Brief</h3>
                  {vertrag.mieter.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Diesem Vertrag ist kein Mieter zugeordnet — der Brief grüßt allgemein.</p>
                  ) : (
                    <div className="space-y-2">
                      {vertrag.mieter.map(m => (
                        <div key={m.id} className="flex items-center gap-2">
                          <Select
                            value={anreden[m.id] ?? "ohne"}
                            onValueChange={v => setAnreden(a => ({ ...a, [m.id]: v as Anrede }))}
                          >
                            <SelectTrigger className="h-9 w-[150px] shrink-0" aria-label={`Anrede ${m.vorname} ${m.nachname}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Frau">Frau</SelectItem>
                              <SelectItem value="Herr">Herr</SelectItem>
                              <SelectItem value="ohne">ohne Anrede</SelectItem>
                            </SelectContent>
                          </Select>
                          <span className="text-sm truncate">{`${m.vorname ?? ""} ${m.nachname ?? ""}`.trim()}</span>
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground">Anrede: „{briefanrede(pdfDaten?.mieter ?? [])}"</p>
                    </div>
                  )}
                  <div className="space-y-3 mt-3">
                    <div>
                      <Label className="text-xs" htmlFor="kb-strasse">Straße</Label>
                      <Input id="kb-strasse" value={strasse} onChange={e => setStrasse(e.target.value)} className="mt-1 h-9" />
                    </div>
                    <div>
                      <Label className="text-xs" htmlFor="kb-plzort">PLZ + Ort</Label>
                      <Input id="kb-plzort" value={plzOrt} onChange={e => setPlzOrt(e.target.value)} className="mt-1 h-9" />
                    </div>
                    <div>
                      <Label className="text-xs" htmlFor="kb-einheit">Einheit-Bezeichnung</Label>
                      <Input id="kb-einheit" value={einheitBezeichnung} onChange={e => setEinheitBezeichnung(e.target.value)} className="mt-1 h-9" />
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Kündigung des Mieters</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs" htmlFor="kb-vom">Schreiben vom</Label>
                      <Input id="kb-vom" type="date" value={schreibenVom} onChange={e => setSchreibenVom(e.target.value)} className="mt-1 h-9" />
                    </div>
                    <div>
                      <Label className="text-xs" htmlFor="kb-eingang">Eingegangen am</Label>
                      <Input id="kb-eingang" type="date" value={eingangAm} onChange={e => setEingangAm(e.target.value)} className="mt-1 h-9" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Leere Felder erscheinen nicht im Brief. Das Vertragsende stammt aus dem Vertrag.
                  </p>
                  <div className="mt-3">
                    <Label className="text-xs" htmlFor="kb-hinweise">Ergänzende Hinweise</Label>
                    <Textarea
                      id="kb-hinweise"
                      value={bemerkungen}
                      onChange={e => setBemerkungen(e.target.value)}
                      placeholder="z. B. Schlüsselrückgabe im Büro"
                      rows={2}
                      className="mt-1"
                    />
                  </div>
                </div>

                <Separator />

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Brieftext</h3>
                    <Button variant={useFreitext ? "default" : "outline"} size="sm" className="h-7 text-xs" onClick={umschaltenFreitext}>
                      {useFreitext ? "Standard verwenden" : "Text anpassen"}
                    </Button>
                  </div>
                  {useFreitext ? (
                    <Textarea
                      value={freitext}
                      onChange={e => setFreitext(e.target.value)}
                      className="min-h-[200px] text-sm"
                      aria-label="Brieftext"
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Standardtext mit Vertragsende, Widerspruch gegen stillschweigende Verlängerung (§ 545 BGB) und Hinweisen zur Rückgabe.
                    </p>
                  )}
                </div>

                <Separator />

                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Versand per E-Mail</h3>
                  {adressen.length === 0 ? (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        Für diesen Vertrag ist keine Mailadresse hinterlegt. Speichern Sie das Schreiben und
                        versenden Sie es per Post, oder tragen Sie die Adresse zuerst beim Mieter ein.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <div className="space-y-2">
                      {adressen.map(adresse => (
                        <label key={adresse} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={ausgewaehlt.includes(adresse)}
                            onCheckedChange={an =>
                              setAusgewaehlt(liste => an ? [...liste, adresse] : liste.filter(a => a !== adresse))
                            }
                          />
                          <span className="truncate">{adresse}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {versendetAn !== null && (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Versendet an {versendetAn === 1 ? "1 Adresse" : `${versendetAn} Adressen`}. Das Schreiben liegt in den Vertragsdokumenten.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-wrap gap-2 pb-4">
                  <Button variant="outline" size="sm" onClick={handleDownload} disabled={!pdfUrl}>
                    <Download className="h-4 w-4 mr-1.5" />Download
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleSpeichern} disabled={!vorschauAktuell || beschaeftigt || istGespeichert}>
                    {isSaving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                    {istGespeichert ? "Gespeichert" : "Speichern"}
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={handleSenden}
                    disabled={!vorschauAktuell || beschaeftigt || ausgewaehlt.length === 0}
                  >
                    {isSending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Mail className="h-4 w-4 mr-1.5" />}
                    Speichern &amp; senden
                  </Button>
                </div>
                <Button variant="ghost" size="sm" className="w-full" onClick={onClose} disabled={beschaeftigt}>
                  {versendetAn !== null || istGespeichert ? "Schließen" : "Später erstellen"}
                </Button>
              </div>
            </ScrollArea>

            <div className="hidden md:flex flex-1 flex-col bg-muted/30 min-w-0">
              <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/50 flex-shrink-0 text-sm text-muted-foreground">
                <Eye className="h-4 w-4" />
                <span>PDF-Vorschau</span>
              </div>
              <div className="flex-1 p-4 overflow-auto">
                {vorschauFehler ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                    <AlertTriangle className="h-8 w-8 text-destructive" />
                    <p className="text-sm">Das Schreiben konnte nicht erzeugt werden.</p>
                    <Button variant="outline" size="sm" onClick={vorschauErzeugen}>
                      <RefreshCw className="h-4 w-4 mr-1.5" />Erneut versuchen
                    </Button>
                  </div>
                ) : pdfUrl ? (
                  <iframe
                    src={pdfUrl}
                    title="Vorschau der Kündigungsbestätigung"
                    className="w-full h-full min-h-[600px] bg-background shadow-lg rounded border"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin mb-3" />
                    <p className="text-sm">{erzeugt ? "PDF wird aktualisiert …" : "PDF wird erzeugt …"}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
