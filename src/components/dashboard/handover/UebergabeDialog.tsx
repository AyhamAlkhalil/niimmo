import React, { useState, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { CalendarIcon, KeyRound, ClipboardList, Loader2, Building2, FileDown, RotateCcw, Mail, Eye, Zap, Flame, Droplets, Save, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SignatureCanvas } from "./SignatureCanvas";
import { MeterPhotoUpload } from "./MeterPhotoUpload";
import { NotizenPhotoUpload } from "./NotizenPhotoUpload";
import { UebergabeEmailDialog } from "./UebergabeEmailDialog";
import { VersorgerBenachrichtigungDialog } from "./VersorgerBenachrichtigungDialog";
import { generateUebergabePdf, type UebergabePdfData } from "@/utils/uebergabePdfGenerator";
import { blobToPdfImage, type PdfImage } from "@/utils/pdfImageUtils";
import { sanitizeZaehlerstand, parseZaehlerstand, istGueltigeZaehlerstandEingabe } from "@/utils/zaehlerstandUtils";

const METER_TYPEN = ["strom", "gas", "wasser", "warmwasser"] as const;
type MeterTyp = (typeof METER_TYPEN)[number];

const METER_LABELS: Record<MeterTyp, string> = {
  strom: "Strom",
  gas: "Gas",
  wasser: "Kaltwasser",
  warmwasser: "Warmwasser",
};

interface ContractInfo {
  id: string;
  einheit: {
    id: string;
    nummer?: string;
    etage?: string;
    immobilie_id?: string;
    immobilie: {
      id?: string;
      name: string;
      adresse: string;
    };
  };
  kuendigungsdatum?: string;
}

interface MieterData {
  id: string;
  vorname: string;
  nachname: string | null;
  hauptmail: string | null;
}

interface UebergabeDialogProps {
  isEinzug?: boolean;
  isOpen: boolean;
  onClose: () => void;
  vertragIds: string[];
  contracts: ContractInfo[];
  mieterName?: string;
  onSuccess?: () => void;
}

interface ZaehlerstaendePerContract {
  [contractId: string]: {
    strom: string;
    gas: string;
    wasser: string;
    warmwasser: string;
  };
}

interface MeterPhotosPerContract {
  [contractId: string]: {
    strom?: string[];
    gas?: string[];
    wasser?: string[];
    warmwasser?: string[];
  };
}

export const UebergabeDialog = ({
  isOpen,
  onClose,
  vertragIds,
  contracts,
  mieterName,
  onSuccess,
  isEinzug = false,
}: UebergabeDialogProps) => {
  const [uebergabeDatum, setUebergabeDatum] = useState<Date | undefined>(
    contracts[0]?.kuendigungsdatum ? new Date(contracts[0].kuendigungsdatum) : new Date()
  );
  const [schluesselHaustuer, setSchluesselHaustuer] = useState<string>("");
  const [schluesselWohnung, setSchluesselWohnung] = useState<string>("");
  const [schluesselBriefkasten, setSchluesselBriefkasten] = useState<string>("");
  const [schluesselKeller, setSchluesselKeller] = useState<string>("");
  const [zaehlerstaendePerContract, setZaehlerstaendePerContract] = useState<ZaehlerstaendePerContract>(() => {
    const initial: ZaehlerstaendePerContract = {};
    contracts.forEach(c => {
      initial[c.id] = { strom: "", gas: "", wasser: "", warmwasser: "" };
    });
    return initial;
  });
  const [meterPhotosPerContract, setMeterPhotosPerContract] = useState<MeterPhotosPerContract>(() => {
    const initial: MeterPhotosPerContract = {};
    contracts.forEach(c => {
      initial[c.id] = {};
    });
    return initial;
  });
  const [protokollNotizen, setProtokollNotizen] = useState("");
  const [vermieterSignature, setVermieterSignature] = useState<string | null>(null);
  const [mieterSignature, setMieterSignature] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  // Safari, Chrome-on-iOS (CriOS) und Firefox-on-iOS (FxiOS) können alle
  // keine Blob-URLs in iframes rendern — alle auf WKWebView basierend
  const isSafari = typeof navigator !== "undefined" && (
    /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ||
    /CriOS/.test(navigator.userAgent) ||
    /FxiOS/.test(navigator.userAgent)
  );

  // Notes photos
  const [notizenPhotos, setNotizenPhotos] = useState<string[]>([]);

  // Die Upload-Komponenten halten ihre Fotoliste in eigenem State, der nur beim
  // Mount aus existingPhotos übernommen wird. Ohne Remount würden sie nach
  // "Formular zurücksetzen" weiterhin Fotos anzeigen, die der Dialog nicht mehr
  // kennt — und die damit auch nicht mehr ins Protokoll wandern.
  const [formResetKey, setFormResetKey] = useState(0);

  // Anzahl Fotos, die beim letzten PDF-Aufbau nicht eingebettet werden konnten
  const [nichtEingebetteteFotos, setNichtEingebetteteFotos] = useState(0);

  // Entwertet das Ergebnis eines Vorschaulaufs, der von einem neueren Lauf
  // oder einem Reset überholt wurde
  const previewLaufRef = React.useRef(0);
  
  // Preview state
  const [showPreview, setShowPreview] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  
  // Gespeicherter PDF-Pfad (nach handleSubmit) — wird an Email/Versorger-Dialog weitergegeben
  const [savedPdfPath, setSavedPdfPath] = useState<string | null>(null);

  // Protokoll wurde gespeichert
  const [isSaved, setIsSaved] = useState(false);

  // Email dialog
  const [showEmailDialog, setShowEmailDialog] = useState(false);

  // Versorger confirmation dialog
  const [showVersorgerDialog, setShowVersorgerDialog] = useState(false);

  // Inline Versorger state
  const [versorgerData, setVersorgerData] = useState<Array<{ typ: 'strom' | 'gas' | 'wasser'; label: string; name: string; email: string }>>([]);
  const [versorgerSelected, setVersorgerSelected] = useState<Set<string>>(new Set());
  
  // Tenant data
  const [mieterData, setMieterData] = useState<MieterData[]>([]);
  const [mieterEmails, setMieterEmails] = useState<{ [mieterId: string]: string }>({});

  // Fetch tenant data
  useEffect(() => {
    const fetchMieterData = async () => {
      if (vertragIds.length === 0) return;
      const { data: mieterLinks } = await supabase
        .from("mietvertrag_mieter")
        .select("mieter_id")
        .in("mietvertrag_id", vertragIds);
      if (mieterLinks && mieterLinks.length > 0) {
        const mieterIds = mieterLinks.map((l) => l.mieter_id);
        const { data: mieter } = await supabase
          .from("mieter")
          .select("id, vorname, nachname, hauptmail")
          .in("id", mieterIds);
        if (mieter) {
          setMieterData(mieter);
          const emails: { [key: string]: string } = {};
          mieter.forEach((m) => {
            emails[m.id] = m.hauptmail || "";
          });
          setMieterEmails(emails);
        }
      }
    };
    fetchMieterData().catch(() => {});
  }, [vertragIds]);

  // Fetch Versorger-Daten
  useEffect(() => {
    const immobilieId = contracts[0]?.einheit?.immobilie_id || contracts[0]?.einheit?.immobilie?.id;
    if (!immobilieId) return;
    const fetchVersorger = async () => {
      const { data } = await supabase
        .from('immobilien')
        .select('versorger_strom_name, versorger_strom_email, versorger_gas_name, versorger_gas_email, versorger_wasser_name, versorger_wasser_email')
        .eq('id', immobilieId)
        .single();
      if (!data) return;
      const liste: typeof versorgerData = [];
      if (data.versorger_strom_name || data.versorger_strom_email)
        liste.push({ typ: 'strom', label: 'Strom', name: data.versorger_strom_name || '', email: data.versorger_strom_email || '' });
      if (data.versorger_gas_name || data.versorger_gas_email)
        liste.push({ typ: 'gas', label: 'Gas', name: data.versorger_gas_name || '', email: data.versorger_gas_email || '' });
      if (data.versorger_wasser_name || data.versorger_wasser_email)
        liste.push({ typ: 'wasser', label: 'Wasser', name: data.versorger_wasser_name || '', email: data.versorger_wasser_email || '' });
      setVersorgerData(liste);
    };
    fetchVersorger().catch(() => {});
  }, [contracts]);

  // Cleanup blob URL
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
  }, [pdfBlobUrl]);

  const updateZaehlerstand = (contractId: string, field: string, value: string) => {
    setZaehlerstaendePerContract(prev => ({
      ...prev,
      [contractId]: { ...prev[contractId], [field]: sanitizeZaehlerstand(value) }
    }));
  };

  const updateMeterPhotos = (contractId: string, meterType: string, paths: string[]) => {
    setMeterPhotosPerContract(prev => ({
      ...prev,
      [contractId]: { ...prev[contractId], [meterType]: paths }
    }));
  };

  const resetForm = () => {
    setUebergabeDatum(contracts[0]?.kuendigungsdatum ? new Date(contracts[0].kuendigungsdatum) : new Date());
    setSchluesselHaustuer("");
    setSchluesselWohnung("");
    setSchluesselBriefkasten("");
    setSchluesselKeller("");
    const initialZaehler: ZaehlerstaendePerContract = {};
    const initialPhotos: MeterPhotosPerContract = {};
    contracts.forEach(c => {
      initialZaehler[c.id] = { strom: "", gas: "", wasser: "", warmwasser: "" };
      initialPhotos[c.id] = {};
    });
    setZaehlerstaendePerContract(initialZaehler);
    setMeterPhotosPerContract(initialPhotos);
    setProtokollNotizen("");
    setNotizenPhotos([]);
    setVermieterSignature(null);
    setMieterSignature(null);
    setShowPreview(false);
    setPdfBlobUrl(null);
    setPdfBlob(null);
    setSavedPdfPath(null);
    setIsSaved(false);
    setFormResetKey((k) => k + 1);
    setNichtEingebetteteFotos(0);
    // Laufende Vorschau entwerten, damit sie die zurückgesetzten Daten nicht
    // nachträglich wieder einblendet
    previewLaufRef.current += 1;
    setIsGeneratingPreview(false);
  };

  /**
   * Lädt Storage-Fotos und bereitet sie für die PDF-Einbettung auf
   * (EXIF-Orientierung anwenden, herunterrechnen).
   *
   * Fehlgeschlagene Fotos werden gezählt und vom Aufrufer sichtbar gemacht —
   * ein Foto darf nicht unbemerkt aus dem Protokoll fallen, nur weil eine
   * Signed URL abgelaufen ist oder die Datei nicht dekodiert werden konnte.
   * Es wird in kleinen Gruppen geladen, damit das Dekodieren mehrerer
   * hochauflösender Handyfotos den Speicher mobiler WebViews nicht sprengt.
   */
  const loadPdfImages = async (
    paths: string[]
  ): Promise<{ images: PdfImage[]; fehlgeschlagen: number }> => {
    if (paths.length === 0) return { images: [], fehlgeschlagen: 0 };

    const images: PdfImage[] = [];
    let fehlgeschlagen = 0;
    const BATCH = 3;

    for (let i = 0; i < paths.length; i += BATCH) {
      const batch = await Promise.all(
        paths.slice(i, i + BATCH).map(async (path) => {
          try {
            const { data } = await supabase.storage
              .from("dokumente")
              .createSignedUrl(path, 300);
            if (!data?.signedUrl) return null;
            const resp = await fetch(data.signedUrl);
            if (!resp.ok) return null;
            return await blobToPdfImage(await resp.blob());
          } catch {
            return null;
          }
        })
      );
      for (const img of batch) {
        if (img) images.push(img);
        else fehlgeschlagen++;
      }
    }

    return { images, fehlgeschlagen };
  };

  const buildPdfData = async (): Promise<UebergabePdfData | null> => {
    if (!uebergabeDatum) return null;

    let fotoFehler = 0;

    const einheitenWithPhotos = await Promise.all(
      contracts.map(async (c) => {
        const photos = meterPhotosPerContract[c.id] ?? {};
        const zaehlerfotos: Partial<Record<MeterTyp, PdfImage[]>> = {};

        for (const typ of METER_TYPEN) {
          const { images, fehlgeschlagen } = await loadPdfImages(photos[typ] ?? []);
          fotoFehler += fehlgeschlagen;
          if (images.length > 0) zaehlerfotos[typ] = images;
        }

        return {
          name: c.einheit.immobilie.name,
          adresse: c.einheit.immobilie.adresse,
          etage: c.einheit.etage || "",
          qm: null,
          zaehlerstaende: zaehlerstaendePerContract[c.id] || { strom: "", gas: "", wasser: "", warmwasser: "" },
          zaehlerfotos: Object.keys(zaehlerfotos).length > 0 ? zaehlerfotos : undefined,
        };
      })
    );

    const notizen = await loadPdfImages(notizenPhotos);
    fotoFehler += notizen.fehlgeschlagen;
    const notizenFotos = notizen.images;

    setNichtEingebetteteFotos(fotoFehler);

    return {
      isEinzug,
      uebergabeDatum: format(uebergabeDatum, "dd.MM.yyyy", { locale: de }),
      mieterName: mieterName || "–",
      immobilieName: contracts[0]?.einheit?.immobilie?.name || "",
      immobilieAdresse: contracts[0]?.einheit?.immobilie?.adresse || "",
      schluessel: {
        haustuer: schluesselHaustuer,
        wohnung: schluesselWohnung,
        briefkasten: schluesselBriefkasten,
        keller: schluesselKeller,
      },
      einheiten: einheitenWithPhotos,
      protokollNotizen,
      notizenFotos,
      vermieterSignature,
      mieterSignature,
    };
  };

  const handleGeneratePreview = async () => {
    if (!uebergabeDatum) {
      toast({ title: "Fehler", description: "Bitte wählen Sie ein Übergabedatum aus.", variant: "destructive" });
      return;
    }

    // Vor dem Laden setzen: das Aufbereiten der Fotos dauert, und solange darf
    // das Formular nicht zurückgesetzt oder ein zweiter Lauf gestartet werden.
    setIsGeneratingPreview(true);
    const laufNummer = previewLaufRef.current + 1;
    previewLaufRef.current = laufNummer;

    try {
      const pdfData = await buildPdfData();
      if (!pdfData) return;

      const blob = await generateUebergabePdf(pdfData);

      // Ein zwischenzeitlich gestarteter Lauf oder ein Reset macht dieses
      // Ergebnis ungültig — sonst zeigt die Vorschau verworfene Daten.
      if (previewLaufRef.current !== laufNummer) return;

      setPdfBlob(blob);
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(URL.createObjectURL(blob));
      setShowPreview(true);
    } catch (error) {
      toast({ title: "Fehler", description: "PDF-Vorschau konnte nicht erstellt werden.", variant: "destructive" });
    } finally {
      if (previewLaufRef.current === laufNummer) setIsGeneratingPreview(false);
    }
  };

  const handleDownloadPdf = () => {
    if (!pdfBlobUrl) return;
    const datumStr = uebergabeDatum ? format(uebergabeDatum, "dd-MM-yyyy") : "datum";
    const fileName = `Uebergabeprotokoll_${isEinzug ? "Einzug" : "Auszug"}_${mieterName?.replace(/\s+/g, "_") || "Mieter"}_${datumStr}.pdf`;
    const a = document.createElement("a");
    a.href = pdfBlobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const getPdfFileName = () => {
    const datumStr = uebergabeDatum ? format(uebergabeDatum, "dd-MM-yyyy") : "datum";
    return `Uebergabeprotokoll_${isEinzug ? "Einzug" : "Auszug"}_${mieterName?.replace(/\s+/g, "_") || "Mieter"}_${datumStr}.pdf`;
  };

  const handleSubmit = async () => {
    if (!uebergabeDatum) {
      toast({ title: "Fehler", description: "Bitte wählen Sie ein Übergabedatum aus.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // supabase-js wirft bei Query-Fehlern nicht — ohne diese Prüfungen würde
      // ein fehlgeschlagenes Update (RLS, Netzwerk) mit "Protokoll gespeichert"
      // quittiert und der eben erfasste Zählerstand wäre still verloren.
      for (const contract of contracts) {
        const zaehlerstaende = zaehlerstaendePerContract[contract.id] || { strom: "", gas: "", wasser: "", warmwasser: "" };
        const staende = isEinzug
          ? {
              strom_einzug: parseZaehlerstand(zaehlerstaende.strom),
              gas_einzug: parseZaehlerstand(zaehlerstaende.gas),
              kaltwasser_einzug: parseZaehlerstand(zaehlerstaende.wasser),
              warmwasser_einzug: parseZaehlerstand(zaehlerstaende.warmwasser),
            }
          : {
              strom_auszug: parseZaehlerstand(zaehlerstaende.strom),
              gas_auszug: parseZaehlerstand(zaehlerstaende.gas),
              kaltwasser_auszug: parseZaehlerstand(zaehlerstaende.wasser),
              warmwasser_auszug: parseZaehlerstand(zaehlerstaende.warmwasser),
            };

        const { error: vertragError } = await supabase
          .from("mietvertrag")
          .update(staende)
          .eq("id", contract.id);
        if (vertragError) throw vertragError;
      }

      // Zählerstände in zaehlerstand_historie eintragen
      const historieDatum = format(uebergabeDatum, "yyyy-MM-dd");
      const historieQuelle = isEinzug ? "Übergabe (Einzug)" : "Übergabe (Auszug)";
      const historieEintraege = contracts.flatMap((contract) => {
        const z = zaehlerstaendePerContract[contract.id] || { strom: "", gas: "", wasser: "", warmwasser: "" };
        const einheitId = contract.einheit.id;
        const immobilieId = contract.einheit.immobilie_id ?? contract.einheit.immobilie?.id ?? null;
        return (
          [
            { typ: "strom", wert: z.strom },
            { typ: "gas", wert: z.gas },
            { typ: "kaltwasser", wert: z.wasser },
            { typ: "warmwasser", wert: z.warmwasser },
          ] as const
        )
          .map(({ typ, wert }) => ({ typ, stand: parseZaehlerstand(wert) }))
          .filter((eintrag): eintrag is { typ: typeof eintrag.typ; stand: number } => eintrag.stand !== null)
          .map(({ typ, stand }) => ({
            einheit_id: einheitId,
            immobilie_id: immobilieId,
            zaehler_typ: typ,
            stand,
            datum: historieDatum,
            quelle: historieQuelle,
            erstellt_von: user?.id ?? null,
          }));
      });
      if (historieEintraege.length > 0) {
        const { error: historieError } = await supabase
          .from("zaehlerstand_historie")
          .insert(historieEintraege);
        if (historieError) throw historieError;
      }

      // Zählerfotos als Einträge in der dokumente-Tabelle speichern
      const uebergabeTypLabel = isEinzug ? "Einzug" : "Auszug";
      const datumLabel = format(uebergabeDatum!, "dd.MM.yyyy", { locale: de });
      const dokumenteInserts = contracts.flatMap((contract) => {
        const photos = meterPhotosPerContract[contract.id] ?? {};
        return METER_TYPEN.flatMap((typ) => {
          const paths = photos[typ] ?? [];
          return paths.map((pfad) => ({
            pfad,
            titel: `Zähler ${METER_LABELS[typ]} (${uebergabeTypLabel}) – ${datumLabel}`,
            kategorie: "Übergabeprotokoll" as const,
            dateityp: null,
            groesse_bytes: null,
            mietvertrag_id: contract.id,
            immobilie_id: null,
            erstellt_von: user?.id ?? null,
            hochgeladen_am: new Date().toISOString(),
            geloescht: false,
          }));
        });
      });

      // Zustandsfotos aus dem Notizen-Bereich ebenfalls registrieren — sie lagen
      // bisher nur im Storage und waren dadurch in der App unauffindbar.
      dokumenteInserts.push(
        ...notizenPhotos.flatMap((pfad) =>
          contracts.map((contract) => ({
            pfad,
            titel: `Zustandsfoto (${uebergabeTypLabel}) – ${datumLabel}`,
            kategorie: "Übergabeprotokoll" as const,
            dateityp: null,
            groesse_bytes: null,
            mietvertrag_id: contract.id,
            immobilie_id: null,
            erstellt_von: user?.id ?? null,
            hochgeladen_am: new Date().toISOString(),
            geloescht: false,
          }))
        )
      );

      if (dokumenteInserts.length > 0) {
        const { error: dokError } = await supabase.from("dokumente").insert(dokumenteInserts);
        if (dokError) throw dokError;
      }

      // PDF-Protokoll in Storage hochladen und als Dokument speichern
      // → unabhängig davon, ob E-Mail versendet wird
      //
      // Das PDF wird hier neu erzeugt statt die letzte Vorschau zu verwenden:
      // wer nach dem Erstellen der Vorschau noch einen Zählerstand korrigiert
      // und dann speichert, bekäme sonst ein archiviertes und versendetes
      // Protokoll, das nicht zu den gespeicherten Daten passt.
      const pdfData = await buildPdfData();
      const aktuellesPdf = pdfData ? await generateUebergabePdf(pdfData) : null;

      if (aktuellesPdf) {
        setPdfBlob(aktuellesPdf);
        if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
        setPdfBlobUrl(URL.createObjectURL(aktuellesPdf));

        const fileName = getPdfFileName();
        const filePath = `uebergabeprotokolle/${contracts[0].id}/${fileName}`;
        const { error: pdfUploadError } = await supabase.storage
          .from("dokumente")
          .upload(filePath, aktuellesPdf, { contentType: "application/pdf", upsert: true });
        if (pdfUploadError) throw pdfUploadError;

        const pdfDokInserts = contracts.map((contract) => ({
          pfad: filePath,
          titel: `Übergabeprotokoll (${uebergabeTypLabel}) – ${datumLabel}`,
          kategorie: "Übergabeprotokoll" as const,
          dateityp: "application/pdf",
          groesse_bytes: aktuellesPdf.size,
          mietvertrag_id: contract.id,
          immobilie_id: null,
          erstellt_von: user?.id ?? null,
          hochgeladen_am: new Date().toISOString(),
          geloescht: false,
        }));
        const { error: pdfDokError } = await supabase.from("dokumente").insert(pdfDokInserts);
        if (pdfDokError) throw pdfDokError;
        setSavedPdfPath(filePath);
      }

      setIsSaved(true);
      toast({ title: "Protokoll gespeichert", description: "Das Übergabeprotokoll wurde erfolgreich gespeichert." });
    } catch (error) {
      toast({ title: "Fehler", description: "Die Übergabe konnte nicht gespeichert werden.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailDialogClose = () => {
    setShowEmailDialog(false);
  };

  const handleVersorgerDialogClose = () => {
    setShowVersorgerDialog(false);
  };

  const handleClose = () => {
    onSuccess?.();
    onClose();
  };

  const updateMieterEmail = (mieterId: string, email: string) => {
    setMieterEmails((prev) => ({ ...prev, [mieterId]: email }));
  };

  // Sicherheitsnetz: Zählerfoto hochgeladen, aber kein Zählerstand erfasst.
  // Genau diese Kombination hat schon einmal zu einem Protokoll ohne
  // Wasserstände geführt, ohne dass es beim Ausfüllen auffiel.
  const fehlendeZaehlerstaende = contracts.flatMap((contract) =>
    METER_TYPEN.filter((typ) => {
      const hatFoto = (meterPhotosPerContract[contract.id]?.[typ]?.length ?? 0) > 0;
      const hatWert = parseZaehlerstand(zaehlerstaendePerContract[contract.id]?.[typ] ?? "") !== null;
      return hatFoto && !hatWert;
    }).map((typ) => ({
      key: `${contract.id}-${typ}`,
      label: METER_LABELS[typ],
      einheit: contracts.length > 1 ? contract.einheit.immobilie.name : null,
    }))
  );

  // Eingaben, die sich nicht eindeutig als Zahl lesen lassen (z.B. "12,34,5").
  // Sie werden markiert statt beim Speichern still zu null zu werden.
  const ungueltigeZaehlerstaende = contracts.flatMap((contract) =>
    METER_TYPEN.filter(
      (typ) => !istGueltigeZaehlerstandEingabe(zaehlerstaendePerContract[contract.id]?.[typ])
    ).map((typ) => ({
      key: `${contract.id}-${typ}`,
      label: METER_LABELS[typ],
      einheit: contracts.length > 1 ? contract.einheit.immobilie.name : null,
    }))
  );

  const istZaehlerstandUngueltig = (contractId: string, typ: MeterTyp): boolean =>
    !istGueltigeZaehlerstandEingabe(zaehlerstaendePerContract[contractId]?.[typ]);

  // ============ FORM CONTENT ============
  const formContent = (
    <div className="space-y-6 p-1">
      {mieterName && (
        <div className="bg-muted/50 rounded-lg p-3 sm:p-4">
          <p className="text-xs text-muted-foreground">Mieter</p>
          <p className="text-sm font-medium">{mieterName}</p>
        </div>
      )}

      {contracts.length > 1 && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
          <p className="text-xs text-blue-700 font-medium mb-2">
            {contracts.length} verbundene Einheiten werden gemeinsam übergeben:
          </p>
          <ul className="space-y-1">
            {contracts.map(c => (
              <li key={c.id} className="text-xs text-blue-600 flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {c.einheit.immobilie.name} - {c.einheit.etage || "–"} / Nr. {c.einheit.nummer || "–"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Übergabedatum */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Übergabedatum *</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("w-full justify-start text-left font-normal h-12 sm:h-10", !uebergabeDatum && "text-muted-foreground")}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {uebergabeDatum ? format(uebergabeDatum, "PPP", { locale: de }) : <span>Datum auswählen</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={uebergabeDatum} onSelect={setUebergabeDatum} locale={de} />
          </PopoverContent>
        </Popover>
      </div>

      {/* Schlüssel */}
      <div className="space-y-2">
        <Label className="text-sm font-medium flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          Übergebene Schlüssel
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Haustür</Label>
            <Input type="number" inputMode="numeric" placeholder="0" min="0" value={schluesselHaustuer} onChange={(e) => setSchluesselHaustuer(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Wohnung</Label>
            <Input type="number" inputMode="numeric" placeholder="0" min="0" value={schluesselWohnung} onChange={(e) => setSchluesselWohnung(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Briefkasten</Label>
            <Input type="number" inputMode="numeric" placeholder="0" min="0" value={schluesselBriefkasten} onChange={(e) => setSchluesselBriefkasten(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Keller</Label>
            <Input type="number" inputMode="numeric" placeholder="0" min="0" value={schluesselKeller} onChange={(e) => setSchluesselKeller(e.target.value)} className="h-10" />
          </div>
        </div>
      </div>

      {/* Zählerstände per Contract */}
      {contracts.map((contract) => (
        <div key={contract.id} className="space-y-3">
          <Label className="text-sm font-medium flex items-center gap-2">
            {contracts.length > 1 && (
              <span className="bg-muted px-2 py-0.5 rounded text-xs">
                {contract.einheit.immobilie.name} - {contract.einheit.etage || "–"}
              </span>
            )}
            Zählerstände bei {isEinzug ? "Einzug" : "Auszug"}
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Strom (kWh)</Label>
              <Input type="text" inputMode="decimal" placeholder="0" value={zaehlerstaendePerContract[contract.id]?.strom || ""} onChange={(e) => updateZaehlerstand(contract.id, "strom", e.target.value)} className={cn("h-10", istZaehlerstandUngueltig(contract.id, "strom") && "border-destructive focus-visible:ring-destructive")} />
              <MeterPhotoUpload key={`strom-${formResetKey}`} contractId={contract.id} meterType="strom" isEinzug={isEinzug} onPhotosChange={(paths) => updateMeterPhotos(contract.id, "strom", paths)} existingPhotos={meterPhotosPerContract[contract.id]?.strom ?? []} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Gas (m³)</Label>
              <Input type="text" inputMode="decimal" placeholder="0" value={zaehlerstaendePerContract[contract.id]?.gas || ""} onChange={(e) => updateZaehlerstand(contract.id, "gas", e.target.value)} className={cn("h-10", istZaehlerstandUngueltig(contract.id, "gas") && "border-destructive focus-visible:ring-destructive")} />
              <MeterPhotoUpload key={`gas-${formResetKey}`} contractId={contract.id} meterType="gas" isEinzug={isEinzug} onPhotosChange={(paths) => updateMeterPhotos(contract.id, "gas", paths)} existingPhotos={meterPhotosPerContract[contract.id]?.gas ?? []} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Kaltwasser (m³)</Label>
              <Input type="text" inputMode="decimal" placeholder="0" value={zaehlerstaendePerContract[contract.id]?.wasser || ""} onChange={(e) => updateZaehlerstand(contract.id, "wasser", e.target.value)} className={cn("h-10", istZaehlerstandUngueltig(contract.id, "wasser") && "border-destructive focus-visible:ring-destructive")} />
              <MeterPhotoUpload key={`wasser-${formResetKey}`} contractId={contract.id} meterType="wasser" isEinzug={isEinzug} onPhotosChange={(paths) => updateMeterPhotos(contract.id, "wasser", paths)} existingPhotos={meterPhotosPerContract[contract.id]?.wasser ?? []} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Warmwasser (m³)</Label>
              <Input type="text" inputMode="decimal" placeholder="0" value={zaehlerstaendePerContract[contract.id]?.warmwasser || ""} onChange={(e) => updateZaehlerstand(contract.id, "warmwasser", e.target.value)} className={cn("h-10", istZaehlerstandUngueltig(contract.id, "warmwasser") && "border-destructive focus-visible:ring-destructive")} />
              <MeterPhotoUpload key={`warmwasser-${formResetKey}`} contractId={contract.id} meterType="warmwasser" isEinzug={isEinzug} onPhotosChange={(paths) => updateMeterPhotos(contract.id, "warmwasser", paths)} existingPhotos={meterPhotosPerContract[contract.id]?.warmwasser ?? []} />
            </div>
          </div>
        </div>
      ))}

      {/* Notizen */}
      <div className="space-y-2">
        <Label className="text-sm font-medium flex items-center gap-2">
          <ClipboardList className="h-4 w-4" />
          Übergabeprotokoll Notizen
        </Label>
        {contracts.length > 0 && (
          <div className="mb-3">
            <Label className="text-xs text-muted-foreground mb-2 block">Fotos (z.B. Mängel, Zustand)</Label>
            <NotizenPhotoUpload key={formResetKey} contractId={contracts[0].id} isEinzug={isEinzug} onPhotosChange={setNotizenPhotos} existingPhotos={notizenPhotos} />
          </div>
        )}
        <Textarea placeholder="Zustand der Wohnung, Mängel, Besonderheiten..." value={protokollNotizen} onChange={(e) => setProtokollNotizen(e.target.value)} className="min-h-[100px] resize-none" />
      </div>

      {/* Tenant Emails - only for Auszug */}
      {!isEinzug && mieterData.length > 0 && (
        <div className="space-y-3 border-t pt-4">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Mail className="h-4 w-4" />
            E-Mail-Adressen der Mieter
          </Label>
          <p className="text-xs text-muted-foreground">
            Diese werden für die Bestätigungsmail nach der Übergabe verwendet.
          </p>
          <div className="space-y-2">
            {mieterData.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">{m.vorname} {m.nachname || ""}</Label>
                  <Input type="email" placeholder="E-Mail-Adresse eingeben..." value={mieterEmails[m.id] || ""} onChange={(e) => updateMieterEmail(m.id, e.target.value)} className="h-10" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Versorger benachrichtigen */}
      {versorgerData.length > 0 && (
        <div className="space-y-3 border-t pt-4">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Versorger benachrichtigen
          </Label>
          <p className="text-xs text-muted-foreground">
            Ausgewählte Versorger erhalten nach Abschluss eine E-Mail mit dem Übergabeprotokoll als PDF-Anhang.
          </p>
          <div className="space-y-2">
            {versorgerData.map(v => {
              const Icon = v.typ === 'strom' ? Zap : v.typ === 'gas' ? Flame : Droplets;
              return (
                <div key={v.typ} className="flex items-center justify-between border rounded-lg p-3">
                  <div className="flex items-center gap-2.5">
                    <Checkbox
                      id={`versorger-${v.typ}`}
                      checked={versorgerSelected.has(v.typ)}
                      onCheckedChange={() => {
                        setVersorgerSelected(prev => {
                          const next = new Set(prev);
                          if (next.has(v.typ)) next.delete(v.typ); else next.add(v.typ);
                          return next;
                        });
                      }}
                    />
                    <Label htmlFor={`versorger-${v.typ}`} className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <Icon className="h-3.5 w-3.5" />
                      {v.label}
                      {v.name && <span className="text-muted-foreground text-xs">({v.name})</span>}
                    </Label>
                  </div>
                  {v.email && <span className="text-xs text-muted-foreground">{v.email}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Signatures */}
      <div className="space-y-4 border-t pt-4">
        <h4 className="text-sm font-semibold">Digitale Unterschriften</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SignatureCanvas label="Vermieter / Bevollmächtigter" onSignatureChange={setVermieterSignature} />
          <SignatureCanvas label="Mieter" onSignatureChange={setMieterSignature} />
        </div>
      </div>

      {/* Fehler: Eingabe nicht als Zahl lesbar */}
      {ungueltigeZaehlerstaende.length > 0 && (
        <div className="flex items-start gap-2 bg-destructive/10 border border-destructive rounded-lg p-3 text-destructive text-sm">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Zählerstand nicht lesbar</p>
            <p className="text-xs mt-0.5">
              {ungueltigeZaehlerstaende.map((f) => (f.einheit ? `${f.label} (${f.einheit})` : f.label)).join(", ")}{" "}
              enthält mehrere Trennzeichen. Bitte als Zahl mit höchstens einem Komma eintragen, z.B. 128,456.
            </p>
          </div>
        </div>
      )}

      {/* Fehler: Foto konnte nicht ins PDF übernommen werden */}
      {nichtEingebetteteFotos > 0 && (
        <div className="flex items-start gap-2 bg-destructive/10 border border-destructive rounded-lg p-3 text-destructive text-sm">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">
              {nichtEingebetteteFotos === 1 ? "1 Foto fehlt im Protokoll" : `${nichtEingebetteteFotos} Fotos fehlen im Protokoll`}
            </p>
            <p className="text-xs mt-0.5">
              Konnte nicht geladen werden. Bitte Vorschau erneut erstellen und vor dem Speichern prüfen,
              ob alle Fotos enthalten sind.
            </p>
          </div>
        </div>
      )}

      {/* Warnung: Foto da, Zählerstand fehlt */}
      {!isSaved && fehlendeZaehlerstaende.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg p-3 text-amber-900 text-sm">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Zählerstand fehlt</p>
            <p className="text-xs mt-0.5">
              Für {fehlendeZaehlerstaende.map((f) => (f.einheit ? `${f.label} (${f.einheit})` : f.label)).join(", ")}{" "}
              wurde ein Foto hochgeladen, aber kein Zählerstand eingetragen. Diese Werte fehlen sonst im Protokoll.
            </p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col gap-3 pt-4 border-t">
        {!isSaved ? (
          <>
            <Button onClick={handleGeneratePreview} className="w-full h-12 sm:h-10" disabled={isGeneratingPreview || isSubmitting || ungueltigeZaehlerstaende.length > 0}>
              {isGeneratingPreview ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Vorschau wird erstellt...</>
              ) : showPreview ? (
                <><Eye className="mr-2 h-4 w-4" />Vorschau aktualisieren</>
              ) : (
                <><Eye className="mr-2 h-4 w-4" />Vorschau erstellen</>
              )}
            </Button>

            {showPreview && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleDownloadPdf} disabled={!pdfBlobUrl} className="flex-1 h-10">
                  <FileDown className="mr-2 h-4 w-4" />
                  Download
                </Button>
                <Button onClick={handleSubmit} disabled={isSubmitting || ungueltigeZaehlerstaende.length > 0} className="flex-1 h-10">
                  {isSubmitting ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Wird gespeichert...</>
                  ) : (
                    <><Save className="mr-2 h-4 w-4" />Protokoll speichern</>
                  )}
                </Button>
              </div>
            )}

            <Button variant="ghost" onClick={resetForm} className="w-full h-10 text-muted-foreground" disabled={isSubmitting || isGeneratingPreview}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Formular zurücksetzen
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 text-sm">
              <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              Protokoll wurde gespeichert.
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={handleDownloadPdf} disabled={!pdfBlobUrl} className="flex-1 h-10">
                <FileDown className="mr-2 h-4 w-4" />
                Download
              </Button>
              {mieterData.length > 0 && (
                <Button variant="outline" onClick={() => setShowEmailDialog(true)} className="flex-1 h-10">
                  <Mail className="mr-2 h-4 w-4" />
                  E-Mail senden
                </Button>
              )}
            </div>

            {versorgerData.length > 0 && (
              <Button variant="outline" onClick={() => setShowVersorgerDialog(true)} className="w-full h-10">
                <Zap className="mr-2 h-4 w-4" />
                Versorger benachrichtigen
              </Button>
            )}

            <Button onClick={handleClose} className="w-full h-10">
              Schließen
            </Button>
          </>
        )}
      </div>
    </div>
  );

  const dialogTitle = isEinzug ? "Übergabe (Einzug)" : "Übergabe (Auszug)";
  const DialogIcon = KeyRound;

  // Email dialog
  const emailDialogComponent = showEmailDialog && uebergabeDatum && (
    <UebergabeEmailDialog
      isOpen={showEmailDialog}
      onClose={handleEmailDialogClose}
      mieter={mieterData.map((m) => ({
        ...m,
        hauptmail: mieterEmails[m.id] || m.hauptmail,
      }))}
      contracts={contracts}
      uebergabeDatum={uebergabeDatum}
      mieterName={mieterName || ""}
      pdfBlob={pdfBlob}
      pdfFileName={getPdfFileName()}
      preSavedPdfPath={savedPdfPath ?? undefined}
    />
  );

  const immobilieId = contracts[0]?.einheit?.immobilie_id || contracts[0]?.einheit?.immobilie?.id;
  const firstZaehler = zaehlerstaendePerContract[contracts[0]?.id] || { strom: "", gas: "", wasser: "", warmwasser: "" };

  const versorgerDialogComponent = showVersorgerDialog && uebergabeDatum && immobilieId && (
    <VersorgerBenachrichtigungDialog
      isOpen={showVersorgerDialog}
      onClose={handleVersorgerDialogClose}
      immobilieId={immobilieId}
      mieterName={mieterName || ""}
      uebergabeDatum={uebergabeDatum}
      zaehlerstaende={{ strom: firstZaehler.strom, gas: firstZaehler.gas, wasser: firstZaehler.wasser }}
      adresse={contracts[0]?.einheit?.immobilie?.adresse || ""}
      einheitBezeichnung={contracts[0]?.einheit?.etage || undefined}
      isEinzug={isEinzug}
      pdfBlob={pdfBlob}
      pdfFileName={getPdfFileName()}
      contractIds={vertragIds}
      initialSelected={versorgerSelected}
      preSavedPdfPath={savedPdfPath ?? undefined}
    />
  );

  if (isMobile) {
    return (
      <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
        {emailDialogComponent}
        {versorgerDialogComponent}
        <DrawerContent className="max-h-[95vh]">
          <DrawerHeader className="pb-2">
            <DrawerTitle className="flex items-center gap-2 text-lg">
              <DialogIcon className={cn("h-5 w-5", isEinzug ? "text-green-600" : "text-orange-600")} />
              {dialogTitle}
            </DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6" style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
            {formContent}
            {showPreview && pdfBlobUrl && (
              <div className="mt-4 border-t pt-4">
                {isSafari ? (
                  <a
                    href={pdfBlobUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full h-12 rounded-lg border border-dashed text-sm text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <Eye className="h-4 w-4" />
                    PDF in neuem Tab öffnen
                  </a>
                ) : (
                  <iframe src={pdfBlobUrl} className="w-full min-h-[500px] rounded-lg border" title="Vorschau" />
                )}
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      {emailDialogComponent}
      {versorgerDialogComponent}
      <DialogContent className={cn(
        "max-h-[90vh] overflow-hidden flex flex-col",
        showPreview ? "sm:max-w-[1200px]" : "sm:max-w-[900px]"
      )}>
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <DialogIcon className={cn("h-5 w-5", isEinzug ? "text-green-600" : "text-orange-600")} />
            {dialogTitle}
          </DialogTitle>
        </DialogHeader>
        <div className={cn(
          "flex-1 min-h-0",
          showPreview
            ? "flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden"
            : "overflow-hidden"
        )}>
          {/* Form (always visible) */}
          <div
            className={cn(
              showPreview
                ? "lg:w-[480px] lg:flex-shrink-0 lg:border-r lg:pr-2 lg:overflow-y-auto lg:max-h-[calc(90vh-80px)]"
                : "w-full overflow-y-auto max-h-[calc(90vh-80px)]"
            )}
            style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
          >
            {formContent}
          </div>

          {/* PDF Preview — rechts auf Desktop, unten auf Tablet */}
          {showPreview && pdfBlobUrl && (
            <div className="lg:flex-1 flex flex-col min-w-0 lg:pl-4 pt-4 lg:pt-0 border-t lg:border-t-0">
              <div className="flex items-center justify-between pb-2 mb-2 border-b flex-shrink-0">
                <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Eye className="h-4 w-4" />
                  PDF-Vorschau
                </span>
                {isGeneratingPreview && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              </div>
              {isSafari ? (
                <a
                  href={pdfBlobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 flex-1 min-h-[350px] lg:min-h-[500px] rounded-lg border border-dashed text-sm text-muted-foreground hover:bg-muted transition-colors"
                >
                  <Eye className="h-4 w-4" />
                  PDF in neuem Tab öffnen
                </a>
              ) : (
                <iframe
                  src={pdfBlobUrl}
                  className="w-full flex-1 min-h-[350px] lg:min-h-[500px] rounded-lg border bg-white"
                  title="Übergabeprotokoll Vorschau"
                />
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
