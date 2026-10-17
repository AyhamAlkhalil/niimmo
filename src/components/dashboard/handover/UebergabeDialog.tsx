import React, { useState, useEffect, useMemo, useRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { format, parse } from "date-fns";
import { de } from "date-fns/locale";
import { CalendarIcon, KeyRound, ClipboardList, Loader2, Building2, FileDown, RotateCcw, Mail, Eye, Zap, Flame, Droplets, Save, AlertTriangle, History, X } from "lucide-react";
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
import { getVertragsende } from "@/utils/contractUtils";
import { alleSeiten } from "@/utils/supabaseSeiten";
import {
  uebergabePdfPfad,
  vertragsStaende,
  historieEintraege,
  historieAufteilen,
  fehlendeDokumente,
  LEERE_ZAEHLER,
} from "@/utils/uebergabeSpeicherung";
import {
  browserAblage,
  entwurfSchluessel,
  entwurfLesen,
  entwurfSchreiben,
  entwurfLoeschen,
  hatEingaben,
  type UebergabeEingaben,
} from "@/utils/uebergabeEntwurf";

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
  ende_datum?: string;
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
  // Entwurf auf dem Gerät (utils/uebergabeEntwurf.ts): Jede Eingabe wird sofort
  // gesichert und beim nächsten Öffnen desselben Vertrags wiederhergestellt.
  const entwurfKey = entwurfSchluessel(vertragIds, isEinzug);
  const [ablage] = useState(browserAblage);
  const [geladenerEntwurf] = useState(() => entwurfLesen(ablage, entwurfKey, contracts.map((c) => c.id)));
  const [wiederhergestelltAm, setWiederhergestelltAm] = useState<string | null>(geladenerEntwurf?.gespeichertAm || null);
  const [entwurfGesichert, setEntwurfGesichert] = useState(true);

  const standardDatum = () => (getVertragsende(contracts[0]) ? new Date(getVertragsende(contracts[0])!) : new Date());
  const [uebergabeDatum, setUebergabeDatum] = useState<Date | undefined>(() =>
    geladenerEntwurf?.uebergabeDatum ? parse(geladenerEntwurf.uebergabeDatum, "yyyy-MM-dd", new Date()) : standardDatum()
  );
  const [schluesselHaustuer, setSchluesselHaustuer] = useState<string>(geladenerEntwurf?.schluessel.haustuer ?? "");
  const [schluesselWohnung, setSchluesselWohnung] = useState<string>(geladenerEntwurf?.schluessel.wohnung ?? "");
  const [schluesselBriefkasten, setSchluesselBriefkasten] = useState<string>(geladenerEntwurf?.schluessel.briefkasten ?? "");
  const [schluesselKeller, setSchluesselKeller] = useState<string>(geladenerEntwurf?.schluessel.keller ?? "");
  const [zaehlerstaendePerContract, setZaehlerstaendePerContract] = useState<ZaehlerstaendePerContract>(() => {
    const initial: ZaehlerstaendePerContract = {};
    contracts.forEach(c => {
      initial[c.id] = { ...LEERE_ZAEHLER, ...geladenerEntwurf?.zaehlerstaende[c.id] };
    });
    return initial;
  });
  const [meterPhotosPerContract, setMeterPhotosPerContract] = useState<MeterPhotosPerContract>(() => {
    const initial: MeterPhotosPerContract = {};
    contracts.forEach(c => {
      initial[c.id] = { ...geladenerEntwurf?.zaehlerfotos[c.id] };
    });
    return initial;
  });
  const [protokollNotizen, setProtokollNotizen] = useState(geladenerEntwurf?.notizen ?? "");
  const [vermieterSignature, setVermieterSignature] = useState<string | null>(geladenerEntwurf?.unterschriftVermieter ?? null);
  const [mieterSignature, setMieterSignature] = useState<string | null>(geladenerEntwurf?.unterschriftMieter ?? null);
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
  const [notizenPhotos, setNotizenPhotos] = useState<string[]>(geladenerEntwurf?.notizenFotos ?? []);

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

  // Eingabestand, aus dem die aktuelle Vorschau entstand. Stimmt er beim
  // Speichern noch, wird das Vorschau-PDF übernommen statt alle Fotos ein
  // zweites Mal zu laden und aufzubereiten — auf dem Handy dauerte das so
  // lange wie die Vorschau selbst.
  const vorschauStandRef = useRef<string | null>(null);
  // PDF, das ein abgebrochener Speicherlauf schon abgelegt hat. Ein zweiter
  // Versuch mit unverändertem Stand legt keine zweite Datei an.
  const hochgeladenesPdfRef = useRef<{ stand: string; pfad: string } | null>(null);
  
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
  const [versorgerSelected, setVersorgerSelected] = useState<Set<string>>(() => new Set(geladenerEntwurf?.versorgerAuswahl ?? []));

  // Tenant data
  const [mieterData, setMieterData] = useState<MieterData[]>([]);
  const [mieterEmails, setMieterEmails] = useState<{ [mieterId: string]: string }>(geladenerEntwurf?.mieterEmails ?? {});

  // Abfrage vor dem Schließen, solange ungespeicherte Eingaben da sind
  const [schliessenFragen, setSchliessenFragen] = useState(false);

  // Alles, was ins PDF eingeht — Vergleichswert für die Wiederverwendung der Vorschau
  const pdfStand = useMemo(
    () =>
      JSON.stringify([
        uebergabeDatum ? format(uebergabeDatum, "yyyy-MM-dd") : null,
        schluesselHaustuer,
        schluesselWohnung,
        schluesselBriefkasten,
        schluesselKeller,
        zaehlerstaendePerContract,
        meterPhotosPerContract,
        protokollNotizen,
        notizenPhotos,
        vermieterSignature,
        mieterSignature,
      ]),
    [uebergabeDatum, schluesselHaustuer, schluesselWohnung, schluesselBriefkasten, schluesselKeller,
      zaehlerstaendePerContract, meterPhotosPerContract, protokollNotizen, notizenPhotos, vermieterSignature, mieterSignature]
  );

  const eingaben = useMemo<UebergabeEingaben>(
    () => ({
      uebergabeDatum: uebergabeDatum ? format(uebergabeDatum, "yyyy-MM-dd") : null,
      schluessel: { haustuer: schluesselHaustuer, wohnung: schluesselWohnung, briefkasten: schluesselBriefkasten, keller: schluesselKeller },
      zaehlerstaende: zaehlerstaendePerContract,
      zaehlerfotos: meterPhotosPerContract,
      notizen: protokollNotizen,
      notizenFotos: notizenPhotos,
      unterschriftVermieter: vermieterSignature,
      unterschriftMieter: mieterSignature,
      versorgerAuswahl: [...versorgerSelected].sort(),
      mieterEmails,
    }),
    [uebergabeDatum, schluesselHaustuer, schluesselWohnung, schluesselBriefkasten, schluesselKeller, zaehlerstaendePerContract,
      meterPhotosPerContract, protokollNotizen, notizenPhotos, vermieterSignature, mieterSignature, versorgerSelected, mieterEmails]
  );
  const ungespeicherteEingaben = !isSaved && hatEingaben(eingaben);

  // Jede Änderung sofort als Entwurf sichern. Der erste Lauf nach dem Öffnen
  // gibt nur den geladenen Entwurf wieder und schreibt nicht — sonst stünde
  // dort der Zeitpunkt des Öffnens statt der letzten Eingabe.
  const geschriebenerStandRef = useRef<string | null>(null);
  useEffect(() => {
    if (isSaved) return;
    const stand = JSON.stringify(eingaben);
    if (stand === geschriebenerStandRef.current) return;
    const ersterLauf = geschriebenerStandRef.current === null;
    geschriebenerStandRef.current = stand;
    if (ersterLauf && geladenerEntwurf) return;
    if (!hatEingaben(eingaben)) {
      entwurfLoeschen(ablage, entwurfKey);
      setEntwurfGesichert(true);
      return;
    }
    setEntwurfGesichert(entwurfSchreiben(ablage, entwurfKey, eingaben, new Date()));
  }, [eingaben, isSaved, ablage, entwurfKey, geladenerEntwurf]);

  // Neu laden oder Tab schließen: nur warnen, wenn sonst wirklich etwas verloren
  // geht — während des Speicherns oder wenn der Entwurf nicht gesichert werden konnte.
  useEffect(() => {
    if (!isOpen || !(isSubmitting || (ungespeicherteEingaben && !entwurfGesichert))) return;
    const warnen = (ereignis: BeforeUnloadEvent) => {
      ereignis.preventDefault();
      ereignis.returnValue = "";
    };
    window.addEventListener("beforeunload", warnen);
    return () => window.removeEventListener("beforeunload", warnen);
  }, [isOpen, isSubmitting, ungespeicherteEingaben, entwurfGesichert]);

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
          // Eine im Entwurf schon eingetragene Adresse hat Vorrang vor der Stammadresse
          setMieterEmails((vorher) => {
            const emails: { [key: string]: string } = {};
            mieter.forEach((m) => {
              emails[m.id] = vorher[m.id] || m.hauptmail || "";
            });
            return emails;
          });
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
    entwurfLoeschen(ablage, entwurfKey);
    setWiederhergestelltAm(null);
    setUebergabeDatum(standardDatum());
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
    vorschauStandRef.current = null;
    hochgeladenesPdfRef.current = null;
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
    const stand = pdfStand;

    try {
      const pdfData = await buildPdfData();
      if (!pdfData) return;

      const blob = await generateUebergabePdf(pdfData);

      // Ein zwischenzeitlich gestarteter Lauf oder ein Reset macht dieses
      // Ergebnis ungültig — sonst zeigt die Vorschau verworfene Daten.
      if (previewLaufRef.current !== laufNummer) return;

      vorschauStandRef.current = stand;
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
    // Der Stand beim Klick — Tippen während des Speicherns gehört nicht mehr zu diesem Lauf
    const stand = pdfStand;
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // 1. Zuerst das PDF: Fotos laden und aufbereiten ist der aufwendigste und
      // anfälligste Schritt. Scheitert er, ist noch nichts geschrieben.
      // Die Vorschau wird nur übernommen, wenn seitdem nichts geändert wurde und
      // alle Fotos drin sind — sonst passte das archivierte und versendete
      // Protokoll nicht zu den gespeicherten Daten.
      let aktuellesPdf: Blob;
      if (pdfBlob && vorschauStandRef.current === stand && nichtEingebetteteFotos === 0) {
        aktuellesPdf = pdfBlob;
      } else {
        const pdfData = await buildPdfData();
        if (!pdfData) throw new Error("Übergabedatum fehlt");
        aktuellesPdf = await generateUebergabePdf(pdfData);
        vorschauStandRef.current = stand;
        setPdfBlob(aktuellesPdf);
        if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
        setPdfBlobUrl(URL.createObjectURL(aktuellesPdf));
      }

      // Ab hier ist jeder Schritt wiederholbar: Ein zweiter Klick nach einem
      // Abbruch ergänzt, was fehlt, statt Historie und Dokumente zu verdoppeln.
      // supabase-js wirft bei Query-Fehlern nicht — ohne die Prüfungen würde
      // ein fehlgeschlagenes Update (RLS, Netzwerk) mit "Protokoll gespeichert"
      // quittiert und der eben erfasste Zählerstand wäre still verloren.
      const vertragIdListe = contracts.map((c) => c.id);

      // 2. Zählerstände am Vertrag — ein leeres Feld lässt den vorhandenen Stand stehen
      for (const contract of contracts) {
        const staende = vertragsStaende(zaehlerstaendePerContract[contract.id] ?? LEERE_ZAEHLER, isEinzug);
        if (Object.keys(staende).length === 0) continue;
        const { error: vertragError } = await supabase
          .from("mietvertrag")
          .update(staende)
          .eq("id", contract.id);
        if (vertragError) throw vertragError;
      }

      // 3. Ablesehistorie — je Einheit, Zähler, Tag und Übergabeart ein Eintrag
      const historieDatum = format(uebergabeDatum, "yyyy-MM-dd");
      const historieQuelle = isEinzug ? "Übergabe (Einzug)" : "Übergabe (Auszug)";
      const historie = contracts.flatMap((contract) =>
        historieEintraege(
          contract.einheit.id,
          contract.einheit.immobilie_id ?? contract.einheit.immobilie?.id ?? null,
          zaehlerstaendePerContract[contract.id] ?? LEERE_ZAEHLER,
          historieDatum,
          historieQuelle,
          user?.id ?? null
        )
      );
      if (historie.length > 0) {
        const vorhandeneAblesungen = await alleSeiten<{ einheit_id: string; zaehler_typ: string }>((von, bis, mitZaehlung) =>
          supabase
            .from("zaehlerstand_historie")
            .select("einheit_id, zaehler_typ", { count: mitZaehlung ? "exact" : undefined })
            .in("einheit_id", [...new Set(historie.map((e) => e.einheit_id))])
            .eq("datum", historieDatum)
            .eq("quelle", historieQuelle)
            .order("id")
            .range(von, bis)
        );
        const { einfuegen, aktualisieren } = historieAufteilen(historie, vorhandeneAblesungen);
        for (const eintrag of aktualisieren) {
          const { error: aktualisierFehler } = await supabase
            .from("zaehlerstand_historie")
            .update({ stand: eintrag.stand })
            .eq("einheit_id", eintrag.einheit_id)
            .eq("zaehler_typ", eintrag.zaehler_typ)
            .eq("datum", eintrag.datum)
            .eq("quelle", eintrag.quelle);
          if (aktualisierFehler) throw aktualisierFehler;
        }
        if (einfuegen.length > 0) {
          const { error: historieError } = await supabase
            .from("zaehlerstand_historie")
            .insert(einfuegen);
          if (historieError) throw historieError;
        }
      }

      // 4. PDF ablegen. Der Pfad trägt Datum und Uhrzeit statt des Mieternamens:
      // Supabase Storage lehnt Umlaute im Pfad ab (InvalidKey) — daran scheiterte
      // jedes Protokoll für Mieter mit Umlaut im Namen.
      let filePath: string;
      if (hochgeladenesPdfRef.current?.stand === stand) {
        filePath = hochgeladenesPdfRef.current.pfad;
      } else {
        filePath = uebergabePdfPfad(contracts[0].id, isEinzug, new Date());
        const { error: pdfUploadError } = await supabase.storage
          .from("dokumente")
          .upload(filePath, aktuellesPdf, { contentType: "application/pdf", upsert: false });
        if (pdfUploadError) throw pdfUploadError;
        hochgeladenesPdfRef.current = { stand, pfad: filePath };
      }

      // 5. Fotos und PDF als Dokumente — in einem Insert, ohne schon Eingetragenes
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

      const vorhandeneDokumente = await alleSeiten<{ pfad: string; mietvertrag_id: string | null }>((von, bis, mitZaehlung) =>
        supabase
          .from("dokumente")
          .select("pfad, mietvertrag_id", { count: mitZaehlung ? "exact" : undefined })
          .in("mietvertrag_id", vertragIdListe)
          .eq("kategorie", "Übergabeprotokoll")
          .order("id")
          .range(von, bis)
      );
      const neueDokumente = fehlendeDokumente([...dokumenteInserts, ...pdfDokInserts], vorhandeneDokumente);
      if (neueDokumente.length > 0) {
        const { error: dokError } = await supabase.from("dokumente").insert(neueDokumente);
        if (dokError) throw dokError;
      }

      setSavedPdfPath(filePath);
      setIsSaved(true);
      entwurfLoeschen(ablage, entwurfKey);
      toast({ title: "Protokoll gespeichert", description: "Das Übergabeprotokoll wurde erfolgreich gespeichert." });
    } catch (error) {
      console.error("Übergabe konnte nicht gespeichert werden:", error);
      toast({
        title: "Fehler",
        description: "Die Übergabe konnte nicht gespeichert werden. Die Eingaben bleiben erhalten — bitte erneut auf „Protokoll speichern“ tippen.",
        variant: "destructive",
      });
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

  // Einziger Weg aus dem Dialog — ob X, Escape, Tippen daneben oder der Knopf im
  // Handy-Panel. Bis zum 17.10.2026 schloss jeder davon ohne Rückfrage und nahm
  // alle Eingaben mit.
  const schliessenAnfragen = () => {
    if (isSubmitting) {
      toast({ title: "Wird gespeichert", description: "Bitte warten, bis das Protokoll gespeichert ist." });
      return;
    }
    if (ungespeicherteEingaben) {
      setSchliessenFragen(true);
      return;
    }
    if (isSaved) handleClose();
    else onClose();
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
      {wiederhergestelltAm && !isSaved && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
          <History className="h-4 w-4 flex-shrink-0 mt-0.5 text-warning" />
          <div>
            <p className="font-medium">Entwurf wiederhergestellt</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Stand vom {format(new Date(wiederhergestelltAm), "dd.MM.yyyy 'um' HH:mm 'Uhr'", { locale: de })}. Gespeichert
              ist das Protokoll erst mit „Protokoll speichern“.
            </p>
          </div>
        </div>
      )}

      {!entwurfGesichert && ungespeicherteEingaben && (
        <div className="flex items-start gap-2 bg-destructive/10 border border-destructive rounded-lg p-3 text-destructive text-sm">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Entwurf kann auf diesem Gerät nicht gesichert werden</p>
            <p className="text-xs mt-0.5">
              Der Browser lässt kein Zwischenspeichern zu. Den Dialog bitte erst nach „Protokoll speichern“ schließen.
            </p>
          </div>
        </div>
      )}

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
          {/* key: nach "Formular zurücksetzen" ein leeres Feld statt der alten Unterschrift */}
          <SignatureCanvas key={`vermieter-${formResetKey}`} label="Vermieter / Bevollmächtigter" onSignatureChange={setVermieterSignature} initialValue={vermieterSignature} />
          <SignatureCanvas key={`mieter-${formResetKey}`} label="Mieter" onSignatureChange={setMieterSignature} initialValue={mieterSignature} />
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

  const schliessenAbfrage = (
    <AlertDialog open={schliessenFragen} onOpenChange={setSchliessenFragen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Übergabe noch nicht gespeichert</AlertDialogTitle>
          <AlertDialogDescription>
            {entwurfGesichert
              ? "Die Eingaben bleiben als Entwurf auf diesem Gerät erhalten. Wenn Sie diesen Vertrag wieder öffnen, geht es an derselben Stelle weiter. Gespeichert ist das Protokoll erst mit „Protokoll speichern“."
              : "Die Eingaben konnten auf diesem Gerät nicht zwischengespeichert werden und gehen beim Schließen verloren."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Weiter bearbeiten</AlertDialogCancel>
          <AlertDialogAction
            className={cn(!entwurfGesichert && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
            onClick={() => {
              setSchliessenFragen(false);
              onClose();
            }}
          >
            {entwurfGesichert ? "Schließen" : "Verwerfen und schließen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (isMobile) {
    return (
      // dismissible={false}: kein Schließen durch Wischen oder Tippen daneben.
      // Bei einem langen Formular reichte ein Zug nach unten am oberen Rand, und
      // alles war weg. Geschlossen wird nur über den Knopf im Kopf.
      <Drawer open={isOpen} dismissible={false}>
        {emailDialogComponent}
        {versorgerDialogComponent}
        {schliessenAbfrage}
        <DrawerContent className="max-h-[95vh]">
          <DrawerHeader className="pb-2 flex items-center justify-between gap-2">
            <DrawerTitle className="flex items-center gap-2 text-lg">
              <DialogIcon className={cn("h-5 w-5", isEinzug ? "text-green-600" : "text-orange-600")} />
              {dialogTitle}
            </DrawerTitle>
            <Button variant="ghost" size="icon" onClick={schliessenAnfragen} aria-label="Übergabe schließen">
              <X className="h-5 w-5" />
            </Button>
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && schliessenAnfragen()}>
      {emailDialogComponent}
      {versorgerDialogComponent}
      {schliessenAbfrage}
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
