import React, { useState, useEffect, useMemo, useRef } from "react";
import { MOBILE_BREAKPOINT } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import { supabase } from "@/integrations/supabase/client";
import { format, parse } from "date-fns";
import { de } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarIcon,
  Check,
  CheckCircle2,
  Eye,
  FileDown,
  History,
  KeyRound,
  Loader2,
  MoreVertical,
  RotateCcw,
  Save,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SignatureCanvas } from "./SignatureCanvas";
import { FotoAufnahme } from "./FotoAufnahme";
import { AnzahlFeld } from "./AnzahlFeld";
import { ZaehlerFeld } from "./ZaehlerFeld";
import { UebergabeSchrittleiste } from "./UebergabeSchrittleiste";
import { UebergabeZusammenfassung } from "./UebergabeZusammenfassung";
import { UebergabeAbschluss } from "./UebergabeAbschluss";
import { PdfSeitenVorschau } from "./PdfSeitenVorschau";
import { UebergabeEmailDialog } from "./UebergabeEmailDialog";
import { VersorgerBenachrichtigungDialog } from "./VersorgerBenachrichtigungDialog";
import { generateUebergabePdf, UnterschriftFehler, type UebergabePdfData } from "@/utils/uebergabePdfGenerator";
import { mailadressen } from "@/utils/uebergabeMail";
import { blobToPdfImage, type PdfImage } from "@/utils/pdfImageUtils";
import { sanitizeZaehlerstand, zaehlerstandText } from "@/utils/zaehlerstandUtils";
import { getVertragsende } from "@/utils/contractUtils";
import { alleSeiten } from "@/utils/supabaseSeiten";
import { dateiendung } from "@/utils/storagePfad";
import {
  uebergabePdfPfad,
  vertragsStaende,
  historieEintraege,
  historieAufteilen,
  aktuelleStaende,
  fehlendeDokumente,
  LEERE_ZAEHLER,
  istNetzfehler,
  belegeFuer,
  fremdBelegt,
  type BelegAblesung,
  type HistorieHerkunft,
  type Rueckbau,
} from "@/utils/uebergabeSpeicherung";
import type { Tables, TablesUpdate } from "@/integrations/supabase/types";
import {
  browserAblage,
  entwurfSchluessel,
  entwurfLesen,
  entwurfSchreiben,
  entwurfLoeschen,
  entwuerfeAufraeumen,
  hatEingaben,
  type UebergabeEingaben,
} from "@/utils/uebergabeEntwurf";
import {
  UEBERGABE_SCHRITTE,
  SCHRITT_TITEL,
  NOTIZ_BAUSTEINE,
  ZAEHLER_BEZEICHNUNG,
  ZAEHLER_DB_TYP,
  ZAEHLER_TYPEN,
  bausteinAnhaengen,
  handyAnsicht,
  istUebergabeSchritt,
  pruefpunkte,
  referenzstand,
  schrittZustaende,
  vergleichsAblesungen,
  vorschlagDatum,
  zaehlerHinweise,
  type Referenzstand,
  type UebergabeSchritt,
  type ZaehlerTyp,
} from "@/utils/uebergabeAblauf";

const METER_TYPEN = ZAEHLER_TYPEN;
type MeterTyp = ZaehlerTyp;
const METER_LABELS = ZAEHLER_BEZEICHNUNG;

/** Rückfragen scrollen, wenn sie höher als der Bildschirm sind (iPhone SE quer: 320 px) */
const ABFRAGE_KLASSE = "max-h-[calc(100dvh-1rem)] overflow-y-auto";

interface ContractInfo {
  id: string;
  einheit: {
    id: string;
    nummer?: string;
    etage?: string;
    /** „Wohnung, 1. OG links, 3 Zimmer, 72,5 m²“ (utils/uebergabeAblauf.ts, mietsacheText) */
    mietsache?: string;
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

/** Zählernummern und Einzugsstände je Vertrag — für Vergleich und Protokoll */
interface VertragsZaehler {
  start: string | null;
  nummern: Partial<Record<MeterTyp, string | null>>;
  einzug: Partial<Record<MeterTyp, number | null>>;
}

interface Ablesung {
  einheit_id: string;
  zaehler_typ: string;
  stand: number | null;
  datum: string | null;
  quelle: string | null;
  mietvertrag_id: string | null;
}

/**
 * Übergabe (Ein- oder Auszug) als geführter Ablauf — seit 20.10.2026:
 *
 *   Datum & Schlüssel → Zählerstände → Zustand → Unterschriften → Prüfen & Speichern
 *
 * danach der Abschluss mit Mail an den Mieter und Benachrichtigung der
 * Versorger. Alle Eingabeschritte bleiben eingehängt und werden nur aus- und
 * eingeblendet: Ein Foto, das noch hochlädt, während jemand auf „Weiter"
 * tippt, käme sonst nie im Entwurf an.
 *
 * Was hier gegen Datenverlust steht (16./17.10.2026), gilt unverändert:
 * Entwurf auf dem Gerät nach jeder Eingabe, Rückfrage vor jedem Schließen,
 * Sperre während Uploads und Speichern, wiederholbares Speichern ohne
 * Dubletten, Pfade ohne Umlaute.
 */
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
  // Verfallene Entwürfe anderer Verträge gleich mit abräumen
  useEffect(() => {
    entwuerfeAufraeumen(ablage);
  }, [ablage]);

  // Das Vertragsende taugt nur beim Auszug als Vorschlag. Beim Einzug stand dort
  // bis zum 19.10.2026 bei befristeten Verträgen das Ende in der Zukunft — und
  // landete so in Protokoll und Ablesehistorie, wenn es niemand bemerkte.
  const standardDatum = () => vorschlagDatum(isEinzug, getVertragsende(contracts[0]), new Date());
  const [uebergabeDatum, setUebergabeDatum] = useState<Date | undefined>(() =>
    geladenerEntwurf?.uebergabeDatum ? parse(geladenerEntwurf.uebergabeDatum, "yyyy-MM-dd", new Date()) : standardDatum()
  );
  const [datumOffen, setDatumOffen] = useState(false);
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
  // Meldungen stehen im Dialog über der Fußleiste. Als Einblendung lagen sie bis
  // zum 24.10.2026 unten rechts genau über „Weiter“ und „Protokoll speichern“ —
  // am Desktop, solange die Maus darauf stand, auf dem iPhone quer 5 s lang.
  const [meldung, setMeldung] = useState<{ art: "fehler" | "hinweis" | "erfolg"; titel: string; text: string } | null>(null);
  const meldungTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const melden = (m: { art: "fehler" | "hinweis" | "erfolg"; titel: string; text: string }) => {
    if (meldungTimerRef.current) clearTimeout(meldungTimerRef.current);
    setMeldung(m);
    // Fehler bleiben stehen, bis sie geschlossen oder überholt werden
    if (m.art !== "fehler") meldungTimerRef.current = setTimeout(() => setMeldung(null), 8000);
  };
  useEffect(() => () => {
    if (meldungTimerRef.current) clearTimeout(meldungTimerRef.current);
  }, []);
  // Handy-Panel oder Dialog wird beim Öffnen einmal festgelegt. useIsMobile
  // meldet im ersten Render immer „Desktop“ und folgt danach jeder Drehung über
  // die Grenze — beide Wechsel hängten das ganze Formular neu ein, und ein
  // gerade laufender Foto-Upload ging verloren.
  // Auch quer gehaltene iPhones bekommen das Panel (utils/uebergabeAblauf.ts, handyAnsicht)
  const [isMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    const touch = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    return handyAnsicht(window.innerWidth, window.innerHeight, touch, MOBILE_BREAKPOINT);
  });
  // Safari, Chrome-on-iOS (CriOS) und Firefox-on-iOS (FxiOS) können alle
  // keine Blob-URLs in iframes rendern — alle auf WKWebView basierend
  const isSafari = typeof navigator !== "undefined" && (
    /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ||
    /CriOS/.test(navigator.userAgent) ||
    /FxiOS/.test(navigator.userAgent)
  );
  // Chrome auf Android hat keinen eingebauten PDF-Betrachter, ein Blob-PDF im
  // iframe bleibt dort leer. Bis zum 19.10.2026 traf das Handys im Querformat
  // und Tablets: Ab 768 px Breite bekommen sie die Desktop-Ansicht mit iframe.
  const istAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
  const pdfEinbettbar = !isMobile && !isSafari && !istAndroid;

  // Ablauf: Schritt aus dem Entwurf übernehmen — „geht an derselben Stelle weiter"
  const [schritt, setSchritt] = useState<UebergabeSchritt>(() =>
    istUebergabeSchritt(geladenerEntwurf?.schritt) ? geladenerEntwurf!.schritt as UebergabeSchritt : "allgemein"
  );
  const [besucht, setBesucht] = useState<Set<UebergabeSchritt>>(() => {
    const bis = UEBERGABE_SCHRITTE.indexOf(schritt);
    return new Set(UEBERGABE_SCHRITTE.slice(0, bis));
  });
  const inhaltRef = useRef<HTMLDivElement>(null);

  // Notes photos
  const [notizenPhotos, setNotizenPhotos] = useState<string[]>(geladenerEntwurf?.notizenFotos ?? []);

  // Die Foto- und Unterschriftsbausteine halten eigenen State, der nur beim
  // Mount übernommen wird. Ohne Remount zeigten sie nach „Entwurf verwerfen"
  // weiterhin Fotos und Striche, die der Dialog nicht mehr kennt.
  const [formResetKey, setFormResetKey] = useState(0);
  // Zählt hoch, wenn Unterschriften wegen späterer Änderungen verworfen werden (leere Felder)
  const [unterschriftRunde, setUnterschriftRunde] = useState(0);
  const [unterschriftVerworfen, setUnterschriftVerworfen] = useState(false);

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
  // Stand, für den die Vorschau beim Betreten von „Prüfen" schon angestoßen
  // wurde — ein gescheiterter Lauf wird so nicht endlos wiederholt
  const autoVorschauRef = useRef<string | null>(null);
  // PDF, das ein abgebrochener Speicherlauf schon abgelegt hat. Ein zweiter
  // Versuch mit genau diesem PDF legt keine zweite Datei an. Gemerkt wird der
  // Blob selbst, nicht der Eingabestand: Wird neu gebaut (etwa weil beim ersten
  // Mal ein Foto fehlte), muss auch die neue Fassung hoch — sonst verwiese das
  // Dokument auf das unvollständige PDF.
  const hochgeladenesPdfRef = useRef<{ pdf: Blob; pfad: string } | null>(null);
  // Schreibzugriffe eines abgebrochenen Speicherlaufs (utils/uebergabeSpeicherung.ts, Rueckbau).
  // Ließ er sich nicht gleich zurücknehmen, steht er im Entwurf und wird beim
  // nächsten Öffnen nachgeholt — bis zum 23.10.2026 ging er mit dem Schließen verloren.
  const rueckbauRef = useRef<Rueckbau | null>(geladenerEntwurf?.offenerRueckbau ?? null);
  // Der Rückbau beim Öffnen läuft im Hintergrund; Speichern und Verwerfen warten
  // auf ihn, sonst setzte er nach einem neuen Speichern dessen Werte zurück
  const rueckbauLaufRef = useRef<Promise<unknown> | null>(null);
  // Synchron gesetzt, sobald feststeht, dass gespeichert ist — isSaved wäre im
  // Closure eines schon laufenden Speicherns noch false
  const gespeichertRef = useRef(false);
  const [offenerRueckbau, setOffenerRueckbau] = useState<Rueckbau | null>(geladenerEntwurf?.offenerRueckbau ?? null);
  // Ob ein früherer Lauf gespeichert hat, ist offen (Netz weg mitten im Speichern).
  // Solange ist das Formular gesperrt: Eine Änderung ginge sonst still verloren, wenn
  // sich zeigt, dass doch gespeichert war (24.10.2026).
  const [ausgangUnklar, setAusgangUnklar] = useState(
    () => !!geladenerEntwurf?.offenerRueckbau && (geladenerEntwurf.offenerRueckbau.historieIds.length > 0 || geladenerEntwurf.offenerRueckbau.zeilen.length > 0)
  );
  const [pruefungLaeuft, setPruefungLaeuft] = useState(false);
  /** Den Rückbau schon während des Speicherns im Entwurf festhalten — auch ein beendeter Tab hinterlässt so nichts */
  const rueckbauMerken = (r: Rueckbau) => {
    if (r.historieIds.length === 0 && r.zeilen.length === 0 && !r.pdfPfad) return;
    setOffenerRueckbau({ historieIds: [...r.historieIds], zeilen: [...r.zeilen], pdfPfad: r.pdfPfad ?? null });
  };
  // Sperre gegen einen zweiten Klick, bevor isSubmitting gerendert ist
  const speichertRef = useRef(false);

  // Preview state
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [vorschauFehler, setVorschauFehler] = useState(false);

  // Gespeicherter PDF-Pfad (nach handleSubmit) — wird an Email/Versorger-Dialog weitergegeben
  const [savedPdfPath, setSavedPdfPath] = useState<string | null>(null);

  // Protokoll wurde gespeichert
  const [isSaved, setIsSaved] = useState(false);
  const [gespeichertAm, setGespeichertAm] = useState<Date | null>(null);

  // Email dialog
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  // Adressen, an die das gespeicherte Protokoll schon ging
  const [mailVersendetAn, setMailVersendetAn] = useState<string[]>([]);
  // Ein Mieter selbst hat die Mail — eine angekommene CC-Kopie allein zählt nicht
  const [mieterBeliefert, setMieterBeliefert] = useState(false);
  // Versorger (typ), die schon benachrichtigt sind
  const [versorgerBenachrichtigt, setVersorgerBenachrichtigt] = useState<Set<string>>(() => new Set());

  // Versorger confirmation dialog
  const [showVersorgerDialog, setShowVersorgerDialog] = useState(false);

  const [versorgerData, setVersorgerData] = useState<Array<{ typ: 'strom' | 'gas' | 'wasser'; label: string; name: string; email: string }>>([]);
  // Nur noch aus älteren Entwürfen: Dort wurden die Versorger im Formular angehakt
  const [versorgerSelected, setVersorgerSelected] = useState<Set<string>>(() => new Set(geladenerEntwurf?.versorgerAuswahl ?? []));

  // Tenant data
  const [mieterData, setMieterData] = useState<MieterData[]>([]);
  // Nur noch aus älteren Entwürfen: Adressen aus dem früheren Formularfeld beim Auszug
  const [mieterEmails, setMieterEmails] = useState<{ [mieterId: string]: string }>(geladenerEntwurf?.mieterEmails ?? {});

  // Zählernummern, Einzugsstände und Ablesungen für den Vergleich
  const [vertragsZaehler, setVertragsZaehler] = useState<Record<string, VertragsZaehler>>({});
  const [ablesungen, setAblesungen] = useState<Ablesung[]>([]);

  // Abfrage vor dem Schließen, solange ungespeicherte Eingaben da sind
  const [schliessenFragen, setSchliessenFragen] = useState(false);
  // Nach dem Speichern: Rückfrage, solange noch nichts an Mieter oder Versorger ging
  const [fertigFragen, setFertigFragen] = useState(false);
  // Abfrage vor „Entwurf verwerfen“ — der Knopf löscht alles
  const [zuruecksetzenFragen, setZuruecksetzenFragen] = useState(false);
  // Abfrage beim Speichern, wenn Fotos nicht ins PDF übernommen werden konnten (Anzahl)
  const [fotoFrage, setFotoFrage] = useState(0);

  // Fotos, die gerade hochgeladen werden — je Upload-Feld. Solange etwas läuft,
  // fehlte das Foto in Vorschau und Protokoll, und Schließen verlöre es.
  const [laufendeUploads, setLaufendeUploads] = useState<Record<string, boolean>>({});
  const uploadMelden = (feld: string) => (aktiv: boolean) =>
    setLaufendeUploads((vorher) => (!!vorher[feld] === aktiv ? vorher : { ...vorher, [feld]: aktiv }));
  const fotosLaden = Object.values(laufendeUploads).some(Boolean);

  // Zeitpunkt des letzten Zwischenspeicherns, sichtbar im Formular
  const [zwischengespeichertAm, setZwischengespeichertAm] = useState<Date | null>(() =>
    geladenerEntwurf ? new Date(geladenerEntwurf.gespeichertAm) : null
  );

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
        vertragsZaehler,
      ]),
    [uebergabeDatum, schluesselHaustuer, schluesselWohnung, schluesselBriefkasten, schluesselKeller,
      zaehlerstaendePerContract, meterPhotosPerContract, protokollNotizen, notizenPhotos, vermieterSignature, mieterSignature, vertragsZaehler]
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
      schritt,
      ...(offenerRueckbau ? { offenerRueckbau } : {}),
    }),
    [uebergabeDatum, schluesselHaustuer, schluesselWohnung, schluesselBriefkasten, schluesselKeller, zaehlerstaendePerContract,
      meterPhotosPerContract, protokollNotizen, notizenPhotos, vermieterSignature, mieterSignature, versorgerSelected, mieterEmails, schritt,
      offenerRueckbau]
  );
  const ungespeicherteEingaben = !isSaved && (hatEingaben(eingaben) || fotosLaden);

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
      setZwischengespeichertAm(null);
      return;
    }
    const jetzt = new Date();
    const gesichert = entwurfSchreiben(ablage, entwurfKey, eingaben, jetzt);
    setEntwurfGesichert(gesichert);
    if (gesichert) setZwischengespeichertAm(jetzt);
  }, [eingaben, isSaved, ablage, entwurfKey, geladenerEntwurf]);

  // Eine Unterschrift gilt für die Angaben, die beim Unterschreiben dastanden. Bis
  // zum 23.10.2026 blieb sie stehen, wenn danach Stände, Schlüssel, Datum oder
  // Bemerkungen geändert wurden — das PDF trug sie dann unter Werten, die der
  // Mieter nie gesehen hat. Fotos zählen auch: ein entferntes fehlt im
  // unterschriebenen Protokoll, ein später aufgenommenes (etwa von einem Mangel)
  // stünde ungesehen darin. Ausgenommen sind Uploads, die beim Unterschreiben schon
  // liefen — sie gehören zu dem, was der Mieter gesehen hat.
  const unterschriebenerInhalt = useMemo(
    () =>
      JSON.stringify([
        uebergabeDatum ? format(uebergabeDatum, "yyyy-MM-dd") : null,
        schluesselHaustuer, schluesselWohnung, schluesselBriefkasten, schluesselKeller,
        zaehlerstaendePerContract,
        protokollNotizen,
      ]),
    [uebergabeDatum, schluesselHaustuer, schluesselWohnung, schluesselBriefkasten, schluesselKeller, zaehlerstaendePerContract, protokollNotizen]
  );
  const alleFotos = useMemo(
    () => [...notizenPhotos, ...Object.values(meterPhotosPerContract).flatMap((je) => Object.values(je ?? {}).flat())],
    [notizenPhotos, meterPhotosPerContract]
  );
  // Je Fotofeld (Schlüssel wie bei uploadMelden) die Fotos — für Uploads, die beim Unterschreiben liefen
  const fotosJeFeld = useMemo(() => {
    const r: Record<string, string[]> = { notizen: notizenPhotos };
    for (const [vertragId, je] of Object.entries(meterPhotosPerContract)) {
      for (const [typ, liste] of Object.entries(je ?? {})) r[`${vertragId}-${typ}`] = liste ?? [];
    }
    return r;
  }, [notizenPhotos, meterPhotosPerContract]);
  const unterschriftStandRef = useRef<string | null>(null);
  const unterschriftFotosRef = useRef<string[]>([]);
  // Felder, deren Upload beim Unterschreiben noch lief — nur deren Fotos gehören noch dazu
  const nachzueglerRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!vermieterSignature && !mieterSignature) {
      unterschriftStandRef.current = null;
      return;
    }
    if (unterschriftStandRef.current === null) {
      // Erste Unterschrift, oder Entwurf mit Unterschrift geöffnet
      unterschriftStandRef.current = unterschriebenerInhalt;
      unterschriftFotosRef.current = alleFotos;
      nachzueglerRef.current = new Set(Object.keys(laufendeUploads).filter((feld) => laufendeUploads[feld]));
      setUnterschriftVerworfen(false);
      return;
    }
    for (const feld of [...nachzueglerRef.current]) {
      // Fotos aus Uploads, die schon liefen, nachträglich zum unterschriebenen Stand nehmen
      unterschriftFotosRef.current = [...new Set([...unterschriftFotosRef.current, ...(fotosJeFeld[feld] ?? [])])];
      if (!laufendeUploads[feld]) nachzueglerRef.current.delete(feld);
    }
    const fotoEntfernt = unterschriftFotosRef.current.some((pfad) => !alleFotos.includes(pfad));
    const fotoNeu = alleFotos.some((pfad) => !unterschriftFotosRef.current.includes(pfad));
    if ((unterschriftStandRef.current === unterschriebenerInhalt && !fotoEntfernt && !fotoNeu) || isSaved) return;
    unterschriftStandRef.current = null;
    setVermieterSignature(null);
    setMieterSignature(null);
    setUnterschriftRunde((r) => r + 1);
    setUnterschriftVerworfen(true);
    melden({
      art: "hinweis",
      titel: "Unterschriften entfernt",
      text: "Nach dem Unterschreiben wurden Angaben geändert. Bitte unter „Unterschriften“ neu unterschreiben lassen.",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unterschriebenerInhalt, alleFotos, fotosJeFeld, laufendeUploads, vermieterSignature, mieterSignature, isSaved]);

  // Rückbau aus einem früheren, abgebrochenen Speichern beim Öffnen nachholen
  useEffect(() => {
    const r = rueckbauRef.current;
    if (!r) return;
    let aktiv = true;
    rueckbauLaufRef.current = rueckbauAusfuehren(r)
      .then((ergebnis) => {
        if (!aktiv || rueckbauRef.current !== r) return;
        if (ergebnis === "gespeichert" && r.pdfPfad) {
          alsGespeichertUebernehmen(r.pdfPfad);
          melden({ art: "hinweis", titel: "Bereits gespeichert", text: "Diese Übergabe wurde beim letzten Mal doch gespeichert — nur die Bestätigung kam nicht an." });
          return;
        }
        rueckbauRef.current = null;
        setOffenerRueckbau(null);
        setAusgangUnklar(false);
      })
      .catch(() => {
        // Bleibt im Entwurf und wird beim Speichern oder nächsten Öffnen erneut versucht
      });
    return () => {
      aktiv = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Neu laden oder Tab schließen: nur warnen, wenn sonst wirklich etwas verloren
  // geht — während des Speicherns, während ein Foto hochlädt (seit 23.10.2026),
  // oder wenn der Entwurf nicht gesichert werden konnte.
  useEffect(() => {
    if (!isOpen || !(isSubmitting || fotosLaden || (ungespeicherteEingaben && !entwurfGesichert))) return;
    const warnen = (ereignis: BeforeUnloadEvent) => {
      ereignis.preventDefault();
      ereignis.returnValue = "";
    };
    window.addEventListener("beforeunload", warnen);
    return () => window.removeEventListener("beforeunload", warnen);
  }, [isOpen, isSubmitting, fotosLaden, ungespeicherteEingaben, entwurfGesichert]);

  // Ladefehler bei Mieter-, Versorger- und Zählerdaten. Bis zum 19.10.2026
  // wurden sie verschluckt: Mailadressen, „E-Mail senden“ und die Versorger
  // fehlten dann einfach, als gäbe es sie nicht.
  const [ladeFehler, setLadeFehler] = useState({ mieter: false, versorger: false, zaehler: false });
  const [ladeVersuch, setLadeVersuch] = useState(0);
  const fehlerSetzen = (art: keyof typeof ladeFehler, wert: boolean) =>
    setLadeFehler((f) => (f[art] === wert ? f : { ...f, [art]: wert }));

  // Fetch tenant data
  useEffect(() => {
    const fetchMieterData = async () => {
      if (vertragIds.length === 0) return;
      const { data: mieterLinks, error: linkFehler } = await supabase
        .from("mietvertrag_mieter")
        .select("mieter_id")
        .in("mietvertrag_id", vertragIds);
      if (linkFehler) throw linkFehler;
      if (mieterLinks && mieterLinks.length > 0) {
        const mieterIds = mieterLinks.map((l) => l.mieter_id);
        const { data: mieter, error: mieterFehler } = await supabase
          .from("mieter")
          .select("id, vorname, nachname, hauptmail")
          .in("id", mieterIds);
        if (mieterFehler) throw mieterFehler;
        // Die Stammadressen bleiben aus dem Entwurf heraus — sonst schriebe schon
        // das bloße Öffnen den Entwurf neu und verschöbe seinen Zeitstempel. Der
        // Maildialog nimmt sie selbst, wenn kein Vorschlag aus dem Entwurf da ist.
        if (mieter) setMieterData(mieter);
      }
    };
    fetchMieterData()
      .then(() => fehlerSetzen("mieter", false))
      .catch(() => fehlerSetzen("mieter", true));
  }, [vertragIds, ladeVersuch]);

  // Fetch Versorger-Daten
  useEffect(() => {
    const immobilieId = contracts[0]?.einheit?.immobilie_id || contracts[0]?.einheit?.immobilie?.id;
    if (!immobilieId) return;
    const fetchVersorger = async () => {
      const { data, error } = await supabase
        .from('immobilien')
        .select('versorger_strom_name, versorger_strom_email, versorger_gas_name, versorger_gas_email, versorger_wasser_name, versorger_wasser_email')
        .eq('id', immobilieId)
        .maybeSingle();
      if (error) throw error;
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
    fetchVersorger()
      .then(() => fehlerSetzen("versorger", false))
      .catch(() => fehlerSetzen("versorger", true));
  }, [contracts, ladeVersuch]);

  // Zählernummern, Einzugsstände und bisherige Ablesungen: zeigen vor Ort, welcher
  // Zähler gemeint ist, und machen Tippfehler sichtbar, bevor sie im Protokoll stehen
  useEffect(() => {
    const ladeZaehler = async () => {
      if (vertragIds.length === 0) return;
      const { data, error } = await supabase
        .from("mietvertrag")
        .select("id, start_datum, strom_einzug, gas_einzug, kaltwasser_einzug, warmwasser_einzug, einheiten(strom_zaehler, gas_zaehler, kaltwasser_zaehler, warmwasser_zaehler)")
        .in("id", vertragIds);
      if (error) throw error;
      const neu: Record<string, VertragsZaehler> = {};
      for (const v of data ?? []) {
        const e = (Array.isArray(v.einheiten) ? v.einheiten[0] : v.einheiten) as
          | { strom_zaehler: string | null; gas_zaehler: string | null; kaltwasser_zaehler: string | null; warmwasser_zaehler: string | null }
          | null;
        neu[v.id] = {
          start: v.start_datum ?? null,
          nummern: { strom: e?.strom_zaehler, gas: e?.gas_zaehler, wasser: e?.kaltwasser_zaehler, warmwasser: e?.warmwasser_zaehler },
          einzug: { strom: v.strom_einzug, gas: v.gas_einzug, wasser: v.kaltwasser_einzug, warmwasser: v.warmwasser_einzug },
        };
      }
      const einheitIds = [...new Set(contracts.map((c) => c.einheit.id).filter(Boolean))];
      const liste = einheitIds.length
        ? await alleSeiten<Ablesung>((von, bis, mitZaehlung) =>
            supabase
              .from("zaehlerstand_historie")
              .select("einheit_id, zaehler_typ, stand, datum, quelle, mietvertrag_id", { count: mitZaehlung ? "exact" : undefined })
              .in("einheit_id", einheitIds)
              .order("id")
              .range(von, bis)
          )
        : [];
      setVertragsZaehler(neu);
      setAblesungen(liste);
    };
    ladeZaehler()
      .then(() => fehlerSetzen("zaehler", false))
      .catch(() => fehlerSetzen("zaehler", true));
  }, [vertragIds, contracts, ladeVersuch]);

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

  // Ein Doppelklick auf „Weiter“ traf bis zum 23.10.2026 mit dem zweiten Klick
  // „Protokoll speichern“ an derselben Stelle und speicherte, ohne dass jemand den
  // Prüfschritt sah. Darum ist Speichern kurz nach dem Betreten gesperrt.
  const [pruefenFrisch, setPruefenFrisch] = useState(false);
  const pruefenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (pruefenTimerRef.current) clearTimeout(pruefenTimerRef.current);
  }, []);
  // Nach einem Schrittwechsel kurz keine zweite Navigation: Ein Doppeltipp auf
  // „Weiter“ traf sonst das an derselben Stelle erscheinende „Zurück“
  const [navFrisch, setNavFrisch] = useState(false);
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (navTimerRef.current) clearTimeout(navTimerRef.current);
  }, []);
  const geheZu = (ziel: UebergabeSchritt) => {
    if (ziel === "pruefen" && schritt !== "pruefen") {
      setPruefenFrisch(true);
      if (pruefenTimerRef.current) clearTimeout(pruefenTimerRef.current);
      pruefenTimerRef.current = setTimeout(() => setPruefenFrisch(false), 1000);
    }
    // Eine Meldung gehört zum Schritt, in dem sie kam — sonst nähme sie überall Platz weg
    setMeldung(null);
    setNavFrisch(true);
    if (navTimerRef.current) clearTimeout(navTimerRef.current);
    navTimerRef.current = setTimeout(() => setNavFrisch(false), 400);
    // Fokus an den Anfang des neuen Schritts — sonst lag er auf dem Dialog selbst,
    // und bis „Protokoll speichern“ waren es 20 Tabs
    requestAnimationFrame(() => inhaltRef.current?.focus({ preventScroll: true }));
    setBesucht((vorher) => (vorher.has(schritt) ? vorher : new Set(vorher).add(schritt)));
    // Der Hinweis auf den fortgesetzten Entwurf ist nach dem ersten Schritt gelesen
    setWiederhergestelltAm(null);
    setSchritt(ziel);
    inhaltRef.current?.scrollTo({ top: 0 });
  };
  const schrittIndex = UEBERGABE_SCHRITTE.indexOf(schritt);
  // Rückfragen öffnen ohne Auslöser — beim Schließen fiel der Fokus sonst auf <body>
  const fokusZurueck = (e: Event) => {
    e.preventDefault();
    inhaltRef.current?.focus({ preventScroll: true });
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
    // Sonst blieb der Entwurf mit nur der Versorger-Auswahl gleich wieder stehen
    setVersorgerSelected(new Set());
    setMieterEmails({});
    setPdfBlobUrl(null);
    setPdfBlob(null);
    setVorschauFehler(false);
    setSavedPdfPath(null);
    setIsSaved(false);
    setFormResetKey((k) => k + 1);
    setUnterschriftVerworfen(false);
    setNichtEingebetteteFotos(0);
    setSchritt("allgemein");
    setBesucht(new Set());
    // Laufende Vorschau entwerten, damit sie die zurückgesetzten Daten nicht
    // nachträglich wieder einblendet
    previewLaufRef.current += 1;
    vorschauStandRef.current = null;
    autoVorschauRef.current = null;
    hochgeladenesPdfRef.current = null;
    rueckbauRef.current = null;
    setOffenerRueckbau(null);
    setAusgangUnklar(false);
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

  // fotoFehler: so viele Fotos fehlen im PDF. Zurückgegeben statt nur in den
  // State geschrieben, weil handleSubmit noch im selben Lauf darüber entscheidet.
  const buildPdfData = async (): Promise<{ daten: UebergabePdfData; fotoFehler: number } | null> => {
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
          mietsache: c.einheit.mietsache || "",
          qm: null,
          zaehlerstaende: zaehlerstaendePerContract[c.id] || { strom: "", gas: "", wasser: "", warmwasser: "" },
          zaehlernummern: vertragsZaehler[c.id]?.nummern,
          zaehlerfotos: Object.keys(zaehlerfotos).length > 0 ? zaehlerfotos : undefined,
        };
      })
    );

    const notizen = await loadPdfImages(notizenPhotos);
    fotoFehler += notizen.fehlgeschlagen;
    const notizenFotos = notizen.images;

    const daten: UebergabePdfData = {
      isEinzug,
      uebergabeDatum: format(uebergabeDatum, "dd.MM.yyyy", { locale: de }),
      mieterName: mieterName || "–",
      immobilieName: contracts[0]?.einheit?.immobilie?.name || "",
      immobilieAdresse: contracts[0]?.einheit?.immobilie?.adresse || "",
      mietsache: contracts.length === 1 ? contracts[0]?.einheit?.mietsache || "" : "",
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
    return { daten, fotoFehler };
  };

  const handleGeneratePreview = async () => {
    if (fotosLaden) return;
    if (!uebergabeDatum) {
      melden({ art: "fehler", titel: "Kein Datum", text: "Bitte wählen Sie ein Übergabedatum aus." });
      return;
    }

    // Vor dem Laden setzen: das Aufbereiten der Fotos dauert, und solange darf
    // das Formular nicht verworfen oder ein zweiter Lauf gestartet werden.
    setIsGeneratingPreview(true);
    setVorschauFehler(false);
    const laufNummer = previewLaufRef.current + 1;
    previewLaufRef.current = laufNummer;
    const stand = pdfStand;

    try {
      const ergebnis = await buildPdfData();
      if (!ergebnis) return;

      const blob = await generateUebergabePdf(ergebnis.daten);

      // Ein zwischenzeitlich gestarteter Lauf oder ein Reset macht dieses
      // Ergebnis ungültig — sonst zeigt die Vorschau verworfene Daten.
      if (previewLaufRef.current !== laufNummer) return;

      setNichtEingebetteteFotos(ergebnis.fotoFehler);
      vorschauStandRef.current = stand;
      setPdfBlob(blob);
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(URL.createObjectURL(blob));
    } catch (error) {
      if (previewLaufRef.current === laufNummer && !unterschriftVerwerfen(error)) setVorschauFehler(true);
    } finally {
      if (previewLaufRef.current === laufNummer) setIsGeneratingPreview(false);
    }
  };

  /** Eine nicht einbettbare Unterschrift entfernen und neu anfordern; true, wenn es das war */
  const unterschriftVerwerfen = (error: unknown): boolean => {
    if (!(error instanceof UnterschriftFehler)) return false;
    if (error.wer === "Mieter") setMieterSignature(null);
    else setVermieterSignature(null);
    setUnterschriftRunde((r) => r + 1);
    melden({ art: "fehler", titel: "Unterschrift unbrauchbar", text: `${error.message} Bitte unter „Unterschriften“ neu unterschreiben.` });
    return true;
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

  /**
   * ohneFehlendeFotos: Der Nutzer hat bestätigt, dass ohne die Fotos gespeichert
   * werden soll, die sich nicht ins PDF übernehmen ließen. Ohne diese Bestätigung
   * hält das Speichern vorher an — das archivierte Protokoll lässt sich danach
   * nicht mehr neu erstellen, und bis zum 19.10.2026 meldete es trotzdem
   * „erfolgreich gespeichert“.
   */
  const handleSubmit = async (ohneFehlendeFotos = false) => {
    if (!uebergabeDatum) {
      melden({ art: "fehler", titel: "Kein Datum", text: "Bitte wählen Sie ein Übergabedatum aus." });
      return;
    }
    // Während einer laufenden Vorschau nicht: Deren Ergebnis käme sonst nach dem
    // Speichern an und ersetzte das archivierte PDF in Download und Mail.
    if (speichertRef.current || ausgangUnklar || fotosLaden || isGeneratingPreview || speichernGesperrt) return;
    speichertRef.current = true;
    setIsSubmitting(true);
    // Der Stand beim Klick; das Formular ist während des Speicherns gesperrt
    const stand = pdfStand;
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // 1. Zuerst das PDF: Fotos laden und aufbereiten ist der aufwendigste und
      // anfälligste Schritt. Scheitert er, ist noch nichts geschrieben.
      // Die Vorschau wird nur übernommen, wenn seitdem nichts geändert wurde —
      // sonst passte das archivierte und versendete Protokoll nicht zu den
      // gespeicherten Daten — und wenn ihr kein Foto fehlte: Dann gibt ein
      // neuer Lauf dem Foto noch eine Chance. Fehlt es danach weiter, wird erst
      // nach Rückfrage gespeichert.
      // Nach „Ohne diese Fotos speichern“ wird genau das PDF übernommen, für das
      // die Rückfrage kam — kein zweites Laden aller Fotos über das Handynetz.
      let aktuellesPdf: Blob;
      let fehlendeFotos = 0;
      if (pdfBlob && vorschauStandRef.current === stand && (nichtEingebetteteFotos === 0 || ohneFehlendeFotos)) {
        aktuellesPdf = pdfBlob;
        fehlendeFotos = nichtEingebetteteFotos;
      } else {
        const ergebnis = await buildPdfData();
        if (!ergebnis) throw new Error("Übergabedatum fehlt");
        aktuellesPdf = await generateUebergabePdf(ergebnis.daten);
        fehlendeFotos = ergebnis.fotoFehler;
        setNichtEingebetteteFotos(fehlendeFotos);
        vorschauStandRef.current = stand;
        setPdfBlob(aktuellesPdf);
        if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
        setPdfBlobUrl(URL.createObjectURL(aktuellesPdf));
      }
      if (fehlendeFotos > 0 && !ohneFehlendeFotos) {
        // Noch ist nichts geschrieben
        setFotoFrage(fehlendeFotos);
        return;
      }

      // Ab hier ist jeder Schritt wiederholbar: Ein zweiter Klick nach einem
      // Abbruch ergänzt, was fehlt, statt Historie und Dokumente zu verdoppeln.
      // supabase-js wirft bei Query-Fehlern nicht — ohne die Prüfungen würde
      // ein fehlgeschlagenes Update (RLS, Netzwerk) mit "Protokoll gespeichert"
      // quittiert und der eben erfasste Zählerstand wäre still verloren.
      const vertragIdListe = contracts.map((c) => c.id);

      // Reste eines abgebrochenen Laufs zuerst zurücknehmen — gleiche Eingaben
      // schreiben danach dasselbe noch einmal, geänderte hinterlassen nichts Altes
      await rueckbauLaufRef.current;
      // Der Rückbau beim Öffnen hat inzwischen ein schon gespeichertes Protokoll gefunden
      if (gespeichertRef.current) return;
      if (rueckbauRef.current) {
        // Das schon abgelegte PDF bleibt, wenn es genau dieses ist — kein zweiter Upload
        const wiederverwendbar = hochgeladenesPdfRef.current?.pdf === aktuellesPdf ? hochgeladenesPdfRef.current.pfad : null;
        const offen = rueckbauRef.current;
        if ((await rueckbauAusfuehren(offen, wiederverwendbar)) === "gespeichert" && offen.pdfPfad) {
          // Der frühere Lauf kam doch an — kein zweites Protokoll
          alsGespeichertUebernehmen(offen.pdfPfad);
          melden({ art: "hinweis", titel: "Bereits gespeichert", text: "Diese Übergabe war schon gespeichert — nur die Bestätigung kam beim letzten Mal nicht an." });
          return;
        }
        rueckbauRef.current = null;
        setOffenerRueckbau(null);
        setAusgangUnklar(false);
      }
      const rueckbau: Rueckbau = { historieIds: [], zeilen: [] };
      rueckbauRef.current = rueckbau;

      // 2. Zählerstände am Vertrag — ein leeres Feld lässt den vorhandenen Stand stehen
      for (const contract of contracts) {
        const staende = vertragsStaende(zaehlerstaendePerContract[contract.id] ?? LEERE_ZAEHLER, isEinzug);
        const spalten = Object.keys(staende);
        if (spalten.length === 0) continue;
        const { data: vorherRoh, error: leseFehler } = await supabase
          .from("mietvertrag")
          .select(spalten.join(","))
          .eq("id", contract.id)
          .maybeSingle();
        if (leseFehler) throw leseFehler;
        // Vor dem Schreiben merken: Geht nur die Antwort verloren, kennt der Rückbau
        // den Schreibzugriff trotzdem; kam er nicht an, greift die Bedingung nicht
        rueckbau.zeilen.push({ tabelle: "mietvertrag", id: contract.id, neu: staende, vorher: (vorherRoh ?? {}) as unknown as Record<string, unknown> });
        rueckbauMerken(rueckbau);
        const { error: vertragError } = await supabase
          .from("mietvertrag")
          .update(staende)
          .eq("id", contract.id);
        if (vertragError) throw vertragError;
      }

      // 3. PDF ablegen — vor der Historie, damit jede Ablesung auf ihr Protokoll
      // verweisen kann. Der Pfad trägt Datum und Uhrzeit statt des Mieternamens:
      // Supabase Storage lehnt Umlaute im Pfad ab (InvalidKey) — daran scheiterte
      // jedes Protokoll für Mieter mit Umlaut im Namen.
      let filePath: string;
      if (hochgeladenesPdfRef.current?.pdf === aktuellesPdf) {
        filePath = hochgeladenesPdfRef.current.pfad;
      } else {
        // Ein PDF aus einem abgebrochenen Lauf ist jetzt überholt (andere Eingaben
        // oder neu geladene Fotos). Nichts verweist mehr darauf — der Dokument-
        // eintrag kommt erst ganz am Schluss, die Historie ist zurückgenommen.
        const ueberholt = hochgeladenesPdfRef.current?.pfad;
        if (ueberholt && !(await protokollEingetragen(ueberholt))) {
          const { error: entfernFehler } = await supabase.storage.from("dokumente").remove([ueberholt]);
          if (entfernFehler) console.warn("Überholtes Protokoll-PDF blieb im Speicher liegen:", entfernFehler.message);
        }
        hochgeladenesPdfRef.current = null;
        filePath = uebergabePdfPfad(contracts[0].id, isEinzug, new Date());
        const { error: pdfUploadError } = await supabase.storage
          .from("dokumente")
          .upload(filePath, aktuellesPdf, { contentType: "application/pdf", upsert: false });
        if (pdfUploadError) throw pdfUploadError;
        hochgeladenesPdfRef.current = { pdf: aktuellesPdf, pfad: filePath };
      }
      rueckbau.pdfPfad = filePath;
      rueckbauMerken(rueckbau);

      // 4. Ablesehistorie — je Einheit, Zähler, Tag und Übergabeart ein Eintrag,
      // mit Vertrag, Protokoll, Zählernummer und Foto (seit 22.10.2026)
      const historieDatum = format(uebergabeDatum, "yyyy-MM-dd");
      const historieQuelle = isEinzug ? "Übergabe (Einzug)" : "Übergabe (Auszug)";
      const herkunftFuer = (contract: ContractInfo): HistorieHerkunft => ({
        mietvertragId: contract.id,
        protokollPfad: filePath,
        je: Object.fromEntries(
          METER_TYPEN.map((typ) => {
            const fotos = meterPhotosPerContract[contract.id]?.[typ] ?? [];
            return [typ, { nummer: vertragsZaehler[contract.id]?.nummern[typ] ?? null, foto: fotos[fotos.length - 1] ?? null, erfassung: "hand" as const }] as const;
          })
        ),
      });
      const historie = contracts.flatMap((contract) =>
        historieEintraege(
          contract.einheit.id,
          contract.einheit.immobilie_id ?? contract.einheit.immobilie?.id ?? null,
          zaehlerstaendePerContract[contract.id] ?? LEERE_ZAEHLER,
          historieDatum,
          historieQuelle,
          user?.id ?? null,
          herkunftFuer(contract)
        )
      );
      if (historie.length > 0) {
        // Mit den bisherigen Werten: Eine übernommene Zeile wird im Rückbau wiederhergestellt
        const HISTORIE_SPALTEN = ["stand", "mietvertrag_id", "zaehler_nummer", "protokoll_pfad", "foto_pfad", "erfassung", "erkannter_stand"] as const;
        const vorhandeneAblesungen = await alleSeiten<Pick<Tables<"zaehlerstand_historie">, "id" | "einheit_id" | "zaehler_typ" | (typeof HISTORIE_SPALTEN)[number]>>((von, bis, mitZaehlung) =>
          supabase
            .from("zaehlerstand_historie")
            .select("id, einheit_id, zaehler_typ, stand, mietvertrag_id, zaehler_nummer, protokoll_pfad, foto_pfad, erfassung, erkannter_stand", {
              count: mitZaehlung ? "exact" : undefined,
            })
            .in("einheit_id", [...new Set(historie.map((e) => e.einheit_id))])
            .eq("datum", historieDatum)
            .eq("quelle", historieQuelle)
            .order("id")
            .range(von, bis)
        );
        const { einfuegen, aktualisieren } = historieAufteilen(historie, vorhandeneAblesungen);
        for (const eintrag of aktualisieren) {
          for (const alt of vorhandeneAblesungen.filter((v) => v.einheit_id === eintrag.einheit_id && v.zaehler_typ === eintrag.zaehler_typ)) {
            rueckbau.zeilen.push({
              tabelle: "zaehlerstand_historie",
              id: alt.id,
              neu: { protokoll_pfad: filePath },
              vorher: Object.fromEntries(HISTORIE_SPALTEN.map((spalte) => [spalte, alt[spalte] ?? null])),
            });
          }
          rueckbauMerken(rueckbau);
          const { error: aktualisierFehler } = await supabase
            .from("zaehlerstand_historie")
            .update({
              stand: eintrag.stand,
              mietvertrag_id: eintrag.mietvertrag_id,
              zaehler_nummer: eintrag.zaehler_nummer,
              protokoll_pfad: eintrag.protokoll_pfad,
              foto_pfad: eintrag.foto_pfad,
              erfassung: eintrag.erfassung,
              erkannter_stand: eintrag.erkannter_stand,
            })
            .eq("einheit_id", eintrag.einheit_id)
            .eq("zaehler_typ", eintrag.zaehler_typ)
            .eq("datum", eintrag.datum)
            .eq("quelle", eintrag.quelle);
          if (aktualisierFehler) throw aktualisierFehler;
        }
        if (einfuegen.length > 0) {
          const { data: eingefuegt, error: historieError, status: historieStatus } = await supabase
            .from("zaehlerstand_historie")
            .insert(einfuegen)
            .select("id");
          if (historieError) throw Object.assign(historieError, { status: historieStatus });
          // Kam die Antwort nicht an, findet der Rückbau die Zeilen über den Protokollpfad
          rueckbau.historieIds.push(...(eingefuegt ?? []).map((z) => z.id));
          rueckbauMerken(rueckbau);
        }
      }

      // 5. Aktueller Stand der Einheit (Zählerverwaltung) — nur, wenn die Übergabe
      // nicht älter ist als der dort stehende Stand. Der Filter entscheidet in
      // der Datenbank; ein späteres Ablesen wird so nie überschrieben.
      for (const contract of contracts) {
        const staende = aktuelleStaende(zaehlerstaendePerContract[contract.id] ?? LEERE_ZAEHLER);
        if (staende.length === 0) continue;
        const { data: vorherRoh, error: leseFehler } = await supabase
          .from("einheiten")
          .select(staende.flatMap((a) => [a.standSpalte, a.datumSpalte]).join(","))
          .eq("id", contract.einheit.id)
          .maybeSingle();
        if (leseFehler) throw leseFehler;
        const vorher = (vorherRoh ?? {}) as unknown as Record<string, unknown>;
        for (const a of staende) {
          const neu = { [a.standSpalte]: a.stand, [a.datumSpalte]: historieDatum };
          const zeile: Rueckbau["zeilen"][number] = {
            tabelle: "einheiten",
            id: contract.einheit.id,
            neu,
            vorher: { [a.standSpalte]: vorher[a.standSpalte] ?? null, [a.datumSpalte]: vorher[a.datumSpalte] ?? null },
          };
          rueckbau.zeilen.push(zeile);
          rueckbauMerken(rueckbau);
          const { data: getroffen, error: standFehler } = await supabase
            .from("einheiten")
            .update(neu as TablesUpdate<"einheiten">)
            .eq("id", contract.einheit.id)
            .or(`${a.datumSpalte}.is.null,${a.datumSpalte}.lte.${historieDatum}`)
            .select("id");
          if (standFehler) throw standFehler;
          // Ein späterer Stand stand schon da — nichts geschrieben, nichts zurückzunehmen
          if (!getroffen || getroffen.length === 0) {
            rueckbau.zeilen.splice(rueckbau.zeilen.indexOf(zeile), 1);
            rueckbauMerken(rueckbau);
          }
        }
      }

      // 6. Fotos und PDF als Dokumente — in einem Insert, ohne schon Eingetragenes
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
        const { error: dokError, status: dokStatus } = await supabase.from("dokumente").insert(neueDokumente);
        // Mit Status: Ein 504 vom Gateway heißt „vielleicht doch angekommen“ (istNetzfehler)
        if (dokError) throw Object.assign(dokError, { status: dokStatus });
      }

      alsGespeichertUebernehmen(filePath);
      if (fehlendeFotos > 0) {
        melden({
          art: "hinweis",
          titel: "Gespeichert – Fotos fehlen",
          text: `${fehlendeFotos === 1 ? "1 Foto fehlt" : `${fehlendeFotos} Fotos fehlen`} im Protokoll-PDF. Die Fotos selbst sind beim Vertrag unter Dokumente eingetragen.`,
        });
      }
    } catch (error) {
      console.error("Übergabe konnte nicht gespeichert werden:", error instanceof Error ? error.message : error);
      if (unterschriftVerwerfen(error)) return;
      // Netz weg: Ob der letzte Schreibzugriff ankam, ist offen. Dann nicht sofort
      // zurücknehmen — der Dokumenteintrag kann noch eintreffen —, sondern das
      // Formular sperren, bis „Erneut prüfen“ es klärt (24.10.2026).
      if (rueckbauRef.current && istNetzfehler(error)) {
        rueckbauMerken(rueckbauRef.current);
        setAusgangUnklar(true);
        setMeldung(null);
        return;
      }
      // Was dieser Lauf schon geschrieben hat, gleich zurücknehmen. Bis zum
      // 23.10.2026 blieb es stehen, wenn danach geschlossen oder verworfen wurde:
      // Stände, Historie mit Protokoll-Link und aktueller Zählerstand ohne Dokument.
      let zurueckgenommen = !rueckbauRef.current;
      if (rueckbauRef.current) {
        try {
          // Das PDF bleibt für den zweiten Versuch liegen (bis 10 MB nicht erneut
          // hochladen). Wird nicht mehr gespeichert, räumt es der Entwurf beim
          // Verwerfen oder nächsten Öffnen ab.
          const behalten = hochgeladenesPdfRef.current?.pfad ?? null;
          const lauf = rueckbauRef.current;
          if ((await rueckbauAusfuehren(lauf, behalten)) === "gespeichert" && lauf.pdfPfad) {
            // Der Dokumenteintrag kam an, nur die Antwort ging verloren
            alsGespeichertUebernehmen(lauf.pdfPfad);
            return;
          }
          rueckbauRef.current = behalten ? { historieIds: [], zeilen: [], pdfPfad: behalten } : null;
          zurueckgenommen = true;
        } catch {
          zurueckgenommen = false;
        }
      }
      setOffenerRueckbau(rueckbauRef.current);
      if (!zurueckgenommen) setAusgangUnklar(true);
      melden({
        art: "fehler",
        titel: "Nicht gespeichert",
        text: zurueckgenommen
          ? "Die Übergabe konnte nicht gespeichert werden. Die Eingaben bleiben erhalten — bitte erneut auf „Protokoll speichern“ tippen."
          : "Die Übergabe konnte nicht gespeichert werden, und ein Teil stand schon in der Datenbank. Bitte bei Verbindung auf „Erneut prüfen“ tippen; bis dahin ist das Formular gesperrt.",
      });
    } finally {
      speichertRef.current = false;
      setIsSubmitting(false);
    }
  };

  /**
   * Nimmt die Schreibzugriffe eines abgebrochenen Laufs zurück, wo noch der eigene
   * Wert steht. `pdfBehalten`: dieses PDF bleibt liegen, weil es gleich wieder gebraucht wird.
   */
  const rueckbauAusfuehren = async (r: Rueckbau, pdfBehalten: string | null = null): Promise<"zurueckgenommen" | "gespeichert"> => {
    // Kam der Dokumenteintrag doch an (nur die Antwort ging verloren), ist das
    // Protokoll gespeichert — dann bleibt alles stehen
    if (r.pdfPfad && (await protokollEingetragen(r.pdfPfad))) return "gespeichert";
    // Schmale Sicht auf den Query-Builder: Die Filter auf frei benannte Spalten
    // sprengen sonst die Typableitung von supabase-js
    type Filterbar = PromiseLike<{ error: unknown }> & { eq: (spalte: string, wert: unknown) => Filterbar };
    const zuruecksetzen = async (z: Rueckbau["zeilen"][number]) => {
      let abfrage = (
        z.tabelle === "mietvertrag"
          ? supabase.from("mietvertrag").update(z.vorher as TablesUpdate<"mietvertrag">).eq("id", z.id)
          : z.tabelle === "einheiten"
            ? supabase.from("einheiten").update(z.vorher as TablesUpdate<"einheiten">).eq("id", z.id)
            : supabase.from("zaehlerstand_historie").update(z.vorher as TablesUpdate<"zaehlerstand_historie">).eq("id", z.id)
      ) as unknown as Filterbar;
      for (const [spalte, wert] of Object.entries(z.neu)) abfrage = abfrage.eq(spalte, wert);
      const { error } = await abfrage;
      if (error) throw error;
    };
    // 1. Übernommene Historienzeilen wiederherstellen — nur, wo noch das eigene Protokoll steht
    for (const z of [...r.zeilen].reverse()) if (z.tabelle === "zaehlerstand_historie") await zuruecksetzen(z);
    // 2. Eigene Historienzeilen löschen: nach ID und nach Protokollpfad. Der Pfad
    // findet auch Zeilen, deren Antwort verloren ging; eine Zeile, die ein zweites
    // Gerät übernommen hat, trägt dessen Pfad und bleibt.
    if (r.historieIds.length > 0) {
      let loeschen = supabase.from("zaehlerstand_historie").delete().in("id", r.historieIds);
      if (r.pdfPfad) loeschen = loeschen.eq("protokoll_pfad", r.pdfPfad);
      const { error } = await loeschen;
      if (error) throw error;
    }
    if (r.pdfPfad) {
      const { error } = await supabase.from("zaehlerstand_historie").delete().eq("protokoll_pfad", r.pdfPfad);
      if (error) throw error;
    }
    // 3. Vertrag und Einheit — außer, ein anderes Speichern belegt denselben Wert
    for (const z of [...r.zeilen].reverse()) {
      if (z.tabelle === "zaehlerstand_historie") continue;
      const belege = belegeFuer(z);
      if (belege.length > 0) {
        const { data: ablesungen, error } = await supabase
          .from("zaehlerstand_historie")
          .select("einheit_id, mietvertrag_id, zaehler_typ, stand, datum, quelle, protokoll_pfad")
          .eq(z.tabelle === "einheiten" ? "einheit_id" : "mietvertrag_id", z.id)
          .in("zaehler_typ", [...new Set(belege.map((b) => b.zaehlerTyp))])
          .in("stand", [...new Set(belege.map((b) => b.stand))])
          .limit(500);
        if (error) throw error;
        if (fremdBelegt(belege, (ablesungen ?? []) as BelegAblesung[], r.pdfPfad)) continue;
      }
      await zuruecksetzen(z);
    }
    if (r.pdfPfad && r.pdfPfad !== pdfBehalten) {
      // Ohne Dokumenteintrag ist die Datei unsichtbar; bleibt sie liegen, stört sie nicht
      const { error } = await supabase.storage.from("dokumente").remove([r.pdfPfad]);
      if (error) console.warn("Protokoll-PDF des abgebrochenen Laufs blieb liegen:", error.message);
      if (hochgeladenesPdfRef.current?.pfad === r.pdfPfad) hochgeladenesPdfRef.current = null;
    }
    return "zurueckgenommen";
  };

  /** Verweist ein Dokument auf dieses PDF? Dann ist es Teil eines gespeicherten Protokolls. */
  const protokollEingetragen = async (pfad: string): Promise<boolean> => {
    const { data, error } = await supabase.from("dokumente").select("id").eq("pfad", pfad).eq("geloescht", false).limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  };

  /** Gespeichert — auch, wenn sich das erst beim Rückbau eines scheinbar gescheiterten Laufs zeigt */
  const alsGespeichertUebernehmen = (pfad: string) => {
    gespeichertRef.current = true;
    rueckbauRef.current = null;
    setOffenerRueckbau(null);
    hochgeladenesPdfRef.current = null;
    setSavedPdfPath(pfad);
    setIsSaved(true);
    setGespeichertAm(new Date());
    entwurfLoeschen(ablage, entwurfKey);
    inhaltRef.current?.scrollTo({ top: 0 });
  };

  /** Vor dem Verwerfen: Reste eines abgebrochenen Speicherns zurücknehmen. false, wenn das nicht ging. */
  const offenesZuruecknehmen = async (): Promise<boolean> => {
    // Nicht neben einem laufenden Speichern: Der Rückbau setzte sonst dessen
    // gerade geschriebene Werte zurück (24.10.2026)
    if (speichertRef.current) {
      melden({ art: "hinweis", titel: "Wird gespeichert", text: "Bitte warten, bis das Speichern abgeschlossen ist." });
      return false;
    }
    speichertRef.current = true;
    setPruefungLaeuft(true);
    try {
      await rueckbauLaufRef.current;
      if (gespeichertRef.current) return false;
      const r = rueckbauRef.current;
      if (!r) return true;
      if ((await rueckbauAusfuehren(r)) === "gespeichert" && r.pdfPfad) {
        // Dann wird nicht verworfen, sondern das gespeicherte Protokoll gezeigt
        alsGespeichertUebernehmen(r.pdfPfad);
        melden({ art: "hinweis", titel: "Bereits gespeichert", text: "Diese Übergabe wurde beim letzten Mal doch gespeichert — nur die Bestätigung kam nicht an." });
        return false;
      }
      rueckbauRef.current = null;
      setOffenerRueckbau(null);
      setAusgangUnklar(false);
      return true;
    } catch {
      melden({
        art: "fehler",
        titel: "Noch nicht verworfen",
        text: "Ein abgebrochenes Speichern ließ sich nicht zurücknehmen, vermutlich fehlt die Verbindung. Bitte mit Verbindung erneut versuchen.",
      });
      return false;
    } finally {
      speichertRef.current = false;
      setPruefungLaeuft(false);
    }
  };

  /** „Erneut prüfen“: klärt, ob ein Lauf mit unklarem Ausgang gespeichert hat, und gibt das Formular frei */
  const offenesKlaeren = async () => {
    if (speichertRef.current) return;
    speichertRef.current = true;
    setPruefungLaeuft(true);
    try {
      await rueckbauLaufRef.current;
      if (gespeichertRef.current) return;
      const r = rueckbauRef.current;
      if (!r) {
        setAusgangUnklar(false);
        return;
      }
      const behalten = hochgeladenesPdfRef.current?.pfad ?? null;
      if ((await rueckbauAusfuehren(r, behalten)) === "gespeichert" && r.pdfPfad) {
        alsGespeichertUebernehmen(r.pdfPfad);
        melden({ art: "erfolg", titel: "Gespeichert", text: "Das Protokoll ist gespeichert — nur die Bestätigung war unterwegs verloren gegangen." });
        return;
      }
      rueckbauRef.current = behalten ? { historieIds: [], zeilen: [], pdfPfad: behalten } : null;
      setOffenerRueckbau(rueckbauRef.current);
      setAusgangUnklar(false);
      melden({ art: "hinweis", titel: "Nicht gespeichert", text: "Es wurde nichts gespeichert. Das Formular ist wieder frei — bitte erneut auf „Protokoll speichern“ tippen." });
    } catch {
      melden({ art: "fehler", titel: "Noch keine Verbindung", text: "Ob gespeichert wurde, ließ sich noch nicht klären. Bitte gleich noch einmal versuchen." });
    } finally {
      speichertRef.current = false;
      setPruefungLaeuft(false);
    }
  };

  const handleClose = () => {
    onSuccess?.();
    onClose();
  };

  // Einziger Weg aus dem Dialog — ob X, Escape, Tippen daneben oder „Fertig“.
  // Bis zum 17.10.2026 schloss jeder davon ohne Rückfrage und nahm alle
  // Eingaben mit.
  const schliessenAnfragen = () => {
    if (isSubmitting) {
      melden({ art: "hinweis", titel: "Wird gespeichert", text: "Bitte warten, bis das Protokoll gespeichert ist." });
      return;
    }
    if (ungespeicherteEingaben) {
      setSchliessenFragen(true);
      return;
    }
    if (isSaved && offeneVersendungen.length > 0 && !fertigFragen) {
      // Versendet wird nur hier — nach dem Schließen gibt es dafür keinen Weg mehr
      setFertigFragen(true);
      return;
    }
    if (isSaved) handleClose();
    else onClose();
  };

  // ============ ABGELEITETES ============
  const offeneVersendungen = [
    ...((ladeFehler.mieter || mieterData.some((m) => mailadressen(mieterEmails[m.id] || m.hauptmail))) && !mieterBeliefert
      ? ["die Mail an den Mieter"]
      : []),
    ...versorgerData.filter((v) => mailadressen(v.email) && !versorgerBenachrichtigt.has(v.typ)).map((v) => `die ${isEinzug ? "Anmeldung" : "Abmeldung"} ${v.label}`),
    // Bei einem Ladefehler ist unbekannt, ob es Versorger gibt — dann lieber fragen
    ...(ladeFehler.versorger && versorgerData.length === 0 ? ["die Versorger-Benachrichtigung"] : []),
  ];
  const datumText = uebergabeDatum ? format(uebergabeDatum, "yyyy-MM-dd") : null;
  const referenzen = useMemo(() => {
    const r: Record<string, Partial<Record<MeterTyp, Referenzstand | null>>> = {};
    for (const c of contracts) {
      r[c.id] = {};
      const daten = vertragsZaehler[c.id];
      for (const typ of METER_TYPEN) {
        const eigene = vergleichsAblesungen(ablesungen, vertragIds)
          .filter((a) => a.einheit_id === c.einheit.id && a.zaehler_typ === ZAEHLER_DB_TYP[typ])
          .map((a) => ({ stand: a.stand === null ? null : Number(a.stand), datum: a.datum }));
        // Beim Einzug ist der eigene Einzugsstand kein Vergleich — er entsteht gerade
        const einzug = !isEinzug && daten ? { stand: daten.einzug[typ] ?? null, datum: daten.start } : null;
        r[c.id][typ] = referenzstand(eigene, einzug, datumText);
      }
    }
    return r;
  }, [contracts, vertragsZaehler, ablesungen, isEinzug, datumText, vertragIds]);

  const fotoAnzahl = useMemo(() => {
    const r: Record<string, Partial<Record<MeterTyp, number>>> = {};
    for (const c of contracts) {
      r[c.id] = {};
      for (const typ of METER_TYPEN) r[c.id][typ] = meterPhotosPerContract[c.id]?.[typ]?.length ?? 0;
    }
    return r;
  }, [contracts, meterPhotosPerContract]);

  const punkte = useMemo(
    () =>
      pruefpunkte(
        {
          uebergabeDatum: datumText,
          zaehlerstaende: zaehlerstaendePerContract,
          zaehlerfotos: fotoAnzahl,
          referenzen,
          unterschriftVermieter: !!vermieterSignature,
          unterschriftMieter: !!mieterSignature,
          heute: format(new Date(), "yyyy-MM-dd"),
        },
        contracts.map((c) => c.id)
      ),
    [datumText, zaehlerstaendePerContract, fotoAnzahl, referenzen, vermieterSignature, mieterSignature, contracts]
  );
  const zustaende = schrittZustaende(punkte);
  const speichernGesperrt = punkte.some((p) => p.art === "fehler");
  const zaehlerfotoGesamt = Object.values(fotoAnzahl).reduce((s, f) => s + Object.values(f).reduce((a, b) => a + (b ?? 0), 0), 0);

  // Beim Betreten von „Prüfen" die Vorschau bauen — einmal je Eingabestand
  useEffect(() => {
    if (schritt !== "pruefen" || isSaved || fotosLaden || isGeneratingPreview || isSubmitting || speichernGesperrt) return;
    if (vorschauStandRef.current === pdfStand || autoVorschauRef.current === pdfStand) return;
    autoVorschauRef.current = pdfStand;
    void handleGeneratePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schritt, pdfStand, isSaved, fotosLaden, isGeneratingPreview, isSubmitting, speichernGesperrt]);
  const vorschauAktuell = !!pdfBlob && vorschauStandRef.current === pdfStand;

  const objektTitel = (c: ContractInfo) => [c.einheit.immobilie.name, c.einheit.etage].filter(Boolean).join(", ");
  const untertitel = [mieterName, contracts[0] && objektTitel(contracts[0]) + (contracts.length > 1 ? ` (+${contracts.length - 1})` : "")]
    .filter(Boolean)
    .join(" · ");

  const statusZeile = isSaved ? null : !entwurfGesichert && ungespeicherteEingaben ? (
    <span className="flex items-center gap-1.5 text-xs text-destructive">
      <AlertTriangle className="h-3.5 w-3.5" />
      Nicht zwischengespeichert
    </span>
  ) : zwischengespeichertAm && entwurfGesichert ? (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
      <Check className="h-3.5 w-3.5 text-success" />
      Zwischengespeichert auf diesem Gerät · {format(zwischengespeichertAm, "HH:mm", { locale: de })} Uhr
    </span>
  ) : (
    <span className="text-xs text-muted-foreground">Eingaben werden auf diesem Gerät zwischengespeichert</span>
  );

  // ============ SCHRITTE ============
  const hinweisKarten = (
    <>
      {wiederhergestelltAm && !isSaved && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
          <History className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
          <div className="flex-1">
            <p className="font-medium">Entwurf fortgesetzt</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Stand vom {format(new Date(wiederhergestelltAm), "dd.MM.yyyy 'um' HH:mm 'Uhr'", { locale: de })}. Gespeichert ist das
              Protokoll erst mit „Protokoll speichern“.
            </p>
          </div>
          <button type="button" onClick={() => setWiederhergestelltAm(null)} aria-label="Hinweis ausblenden" className="rounded p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {!entwurfGesichert && ungespeicherteEingaben && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-medium">Entwurf kann auf diesem Gerät nicht gesichert werden</p>
            <p className="mt-0.5 text-xs">Der Browser lässt kein Zwischenspeichern zu. Den Dialog bitte erst nach „Protokoll speichern“ schließen.</p>
          </div>
        </div>
      )}

      {(ladeFehler.mieter || ladeFehler.versorger || ladeFehler.zaehler) && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium">
              {[ladeFehler.mieter && "Mieterdaten", ladeFehler.versorger && "Versorgerdaten", ladeFehler.zaehler && "Zählerdaten"]
                .filter(Boolean)
                .join(", ")
                .replace(/, ([^,]*)$/, " und $1")}{" "}
              konnten nicht geladen werden
            </p>
            <p className="mt-0.5 text-xs">
              {ladeFehler.mieter ? "Ohne sie fehlen die Mailadressen und der Mailversand. " : ""}
              {ladeFehler.versorger ? "Ohne sie fehlt die Versorger-Benachrichtigung. " : ""}
              {ladeFehler.zaehler ? "Ohne sie fehlen Zählernummern und Vergleichswerte, auch im Protokoll. " : ""}
              Das Protokoll selbst lässt sich trotzdem erfassen.
            </p>
            <Button variant="outline" size="sm" className="mt-2 h-8" onClick={() => setLadeVersuch((v) => v + 1)}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Erneut laden
            </Button>
          </div>
        </div>
      )}
    </>
  );

  const schrittAllgemein = (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          {mieterName && <p className="font-medium">{mieterName}</p>}
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {contracts.map((c) => (
              <li key={c.id} className="flex items-start gap-1.5">
                <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {objektTitel(c)}
                  {c.einheit.nummer ? ` · Nr. ${c.einheit.nummer}` : ""} · {c.einheit.immobilie.adresse}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Übergabedatum</Label>
          {/* modal: Die Scroll-Sperre des Panels blockierte sonst das Wischen im Kalender,
              der im Portal außerhalb liegt (iPhone quer, 22.10.2026). Modal schluckt den
              nächsten Tipp daneben — darum schließt die Auswahl den Kalender. */}
          <Popover modal open={datumOffen} onOpenChange={setDatumOffen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("h-11 w-full justify-start text-left font-normal", !uebergabeDatum && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {uebergabeDatum ? format(uebergabeDatum, "PPP", { locale: de }) : <span>Datum auswählen</span>}
              </Button>
            </PopoverTrigger>
            {/* Quer bleiben auf dem iPhone kaum 340 px Höhe, der Kalender braucht mehr:
                auf den verfügbaren Platz begrenzen und scrollen statt abschneiden */}
            <PopoverContent
              className="max-h-[var(--radix-popover-content-available-height)] w-auto overflow-y-auto p-0"
              align="start"
              collisionPadding={8}
            >
              {/* Ein zweiter Tipp auf den gewählten Tag hob die Auswahl auf — das Datum ist Pflicht */}
              <Calendar
                mode="single"
                selected={uebergabeDatum}
                // Im Monat des gewählten Datums öffnen, nicht im aktuellen
                defaultMonth={uebergabeDatum}
                onSelect={(d) => {
                  if (d) setUebergabeDatum(d);
                  setDatumOffen(false);
                }}
                locale={de}
              />
            </PopoverContent>
          </Popover>
          {!uebergabeDatum && <p className="text-xs text-destructive">Ohne Datum lässt sich das Protokoll nicht speichern.</p>}
          {uebergabeDatum && format(uebergabeDatum, "yyyy-MM-dd") > format(new Date(), "yyyy-MM-dd") && (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Das Datum liegt in der Zukunft. Im Protokoll steht es auch unter den Unterschriften.
            </p>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            Übergebene Schlüssel
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Leer lassen, was nicht übergeben wird — im Protokoll steht dann ein Strich.</p>
        </div>
        <div className="divide-y rounded-lg border px-3">
          <AnzahlFeld id="schluessel-haustuer" label="Haustür" wert={schluesselHaustuer} onChange={setSchluesselHaustuer} />
          <AnzahlFeld id="schluessel-wohnung" label="Wohnung" wert={schluesselWohnung} onChange={setSchluesselWohnung} />
          <AnzahlFeld id="schluessel-briefkasten" label="Briefkasten" wert={schluesselBriefkasten} onChange={setSchluesselBriefkasten} />
          <AnzahlFeld id="schluessel-keller" label="Keller" wert={schluesselKeller} onChange={setSchluesselKeller} />
        </div>
      </section>
    </div>
  );

  const schrittZaehler = (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Stand ablesen und den Zähler fotografieren — das Foto kommt mit ins Protokoll.
      </p>
      {contracts.map((contract) => (
        <section key={contract.id} className="space-y-3">
          {contracts.length > 1 && (
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              {objektTitel(contract)}
            </h3>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {METER_TYPEN.map((typ) => (
              <ZaehlerFeld
                key={`${typ}-${formResetKey}`}
                contractId={contract.id}
                typ={typ}
                isEinzug={isEinzug}
                wert={zaehlerstaendePerContract[contract.id]?.[typ] || ""}
                onWertChange={(w) => updateZaehlerstand(contract.id, typ, w)}
                fotos={meterPhotosPerContract[contract.id]?.[typ] ?? []}
                onFotosChange={(pfade) => updateMeterPhotos(contract.id, typ, pfade)}
                onUploadingChange={uploadMelden(`${contract.id}-${typ}`)}
                onFotoFehler={(text) => melden({ art: "fehler", titel: `${METER_LABELS[typ]}-Foto`, text })}
                nummer={vertragsZaehler[contract.id]?.nummern[typ]}
                referenz={referenzen[contract.id]?.[typ] ?? null}
                hinweise={zaehlerHinweise(
                  zaehlerstaendePerContract[contract.id]?.[typ],
                  fotoAnzahl[contract.id]?.[typ] ?? 0,
                  referenzen[contract.id]?.[typ] ?? null
                )}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );

  const schrittZustand = (
    <div className="space-y-6">
      <section className="space-y-2">
        <Label htmlFor="uebergabe-notizen" className="text-sm font-medium">
          Zustand der Wohnung
        </Label>
        <div className="flex flex-wrap gap-2">
          {NOTIZ_BAUSTEINE.map((b) => (
            <Button
              key={b}
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-full px-3 text-xs"
              onClick={() => setProtokollNotizen((n) => bausteinAnhaengen(n, b))}
            >
              + {b.replace(/\.$/, "")}
            </Button>
          ))}
        </div>
        <Textarea
          id="uebergabe-notizen"
          placeholder="Mängel, Schäden, Besonderheiten …"
          value={protokollNotizen}
          onChange={(e) => setProtokollNotizen(e.target.value)}
          className="min-h-[140px] text-base sm:text-sm"
        />
      </section>
      {contracts.length > 0 && (
        <section className="space-y-2">
          <div>
            <h3 className="text-sm font-medium">Fotos zum Zustand</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Mängel, Schäden, Zustand einzelner Räume — sie kommen mit ins Protokoll.</p>
          </div>
          <FotoAufnahme
            key={`notizen-${formResetKey}`}
            inputId={`zustandsfotos-${contracts[0].id}`}
            bezeichnung="Zustandsfoto"
            knopfText="Fotos aufnehmen"
            pfadFuer={(file, i) =>
              // Endung nur aus sicheren Zeichen — ein Umlaut im Pfad lässt den Upload scheitern
              `uebergabefotos/${contracts[0].id}/notizen_${isEinzug ? "einzug" : "auszug"}_${Date.now()}_${i}.${dateiendung(file.name, file.type)}`
            }
            existingPhotos={notizenPhotos}
            onPhotosChange={setNotizenPhotos}
            onUploadingChange={uploadMelden("notizen")}
            onFehler={(text) => melden({ art: "fehler", titel: "Zustandsfoto", text })}
          />
        </section>
      )}
    </div>
  );

  const zusammenfassung = (
    <UebergabeZusammenfassung
      isEinzug={isEinzug}
      uebergabeDatum={uebergabeDatum}
      mieterName={mieterName}
      schluessel={{ haustuer: schluesselHaustuer, wohnung: schluesselWohnung, briefkasten: schluesselBriefkasten, keller: schluesselKeller }}
      einheiten={contracts.map((c) => ({ id: c.id, titel: objektTitel(c), zaehlerstaende: zaehlerstaendePerContract[c.id] ?? {} }))}
      zaehlerfotos={zaehlerfotoGesamt}
      zustandsfotos={notizenPhotos.length}
      notizen={protokollNotizen}
    />
  );

  const schrittUnterschriften = (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Mit der Unterschrift bestätigen beide Seiten diese Angaben:</p>
      {zusammenfassung}
      {isMobile && <p className="text-xs text-muted-foreground">Zum Unterschreiben das Gerät an den Mieter geben.</p>}
      {unterschriftVerworfen && !vermieterSignature && !mieterSignature && (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          Nach dem Unterschreiben wurden Angaben geändert. Die Unterschriften sind entfernt — bitte beide neu unterschreiben.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 quer:grid-cols-2">
        {/* key: nach „Entwurf verwerfen" oder verworfener Unterschrift ein leeres Feld */}
        <SignatureCanvas key={`vermieter-${formResetKey}-${unterschriftRunde}`} label="Vermieter / Bevollmächtigter" onSignatureChange={setVermieterSignature} initialValue={vermieterSignature} />
        <SignatureCanvas key={`mieter-${formResetKey}-${unterschriftRunde}`} label="Mieter" onSignatureChange={setMieterSignature} initialValue={mieterSignature} />
      </div>
    </div>
  );

  const vorschauFlaeche = (
    <div className="flex min-h-0 flex-col rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Eye className="h-4 w-4 text-muted-foreground" />
          Vorschau
          {isGeneratingPreview && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => void handleGeneratePreview()}
            disabled={isGeneratingPreview || isSubmitting || fotosLaden || speichernGesperrt}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Aktualisieren
          </Button>
          <Button variant="ghost" size="sm" className="h-8" onClick={handleDownloadPdf} disabled={!pdfBlobUrl || !vorschauAktuell}>
            <FileDown className="h-3.5 w-3.5" />
            PDF
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {speichernGesperrt ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Die Vorschau entsteht, sobald kein roter Punkt mehr offen ist.</p>
        ) : fotosLaden ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Fotos werden noch hochgeladen …
          </p>
        ) : vorschauFehler ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Die Vorschau ließ sich nicht erstellen.
            <Button variant="outline" size="sm" onClick={() => void handleGeneratePreview()}>
              Erneut versuchen
            </Button>
          </div>
        ) : pdfBlob && pdfBlobUrl && vorschauAktuell ? (
          pdfEinbettbar ? (
            <iframe src={pdfBlobUrl} className="h-[65vh] w-full rounded border bg-white" title="Übergabeprotokoll Vorschau" />
          ) : (
            <div className="space-y-3">
              <PdfSeitenVorschau pdf={pdfBlob} />
              <a
                href={pdfBlobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors hover:bg-muted"
              >
                <Eye className="h-4 w-4" />
                PDF in neuem Tab öffnen
              </a>
            </div>
          )
        ) : (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Vorschau wird erstellt …
          </p>
        )}
      </div>
    </div>
  );

  const schrittPruefen = (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-4">
        <ul className="space-y-2">
          {punkte.map((p, i) => (
            <li
              key={i}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3 text-sm",
                p.art === "fehler" && "border-destructive bg-destructive/10",
                p.art === "hinweis" && "border-warning/40 bg-warning/10"
              )}
            >
              {p.art === "ok" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              ) : p.art === "hinweis" ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              )}
              <span className="flex-1">{p.text}</span>
              {p.art !== "ok" && (
                <Button variant="link" size="sm" className="h-auto p-0 text-sm" onClick={() => geheZu(p.schritt)}>
                  Ändern
                </Button>
              )}
            </li>
          ))}
          {nichtEingebetteteFotos > 0 && vorschauAktuell && (
            <li className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span className="flex-1">
                {nichtEingebetteteFotos === 1 ? "1 Foto fehlt" : `${nichtEingebetteteFotos} Fotos fehlen`} in der Vorschau — es ließ sich
                nicht laden. Beim Speichern wird es noch einmal versucht.
              </span>
              <Button variant="link" size="sm" className="h-auto p-0 text-sm" onClick={() => void handleGeneratePreview()} disabled={isGeneratingPreview}>
                Neu laden
              </Button>
            </li>
          )}
        </ul>
        <p className="text-xs text-muted-foreground">
          Nach dem Speichern liegt das Protokoll mit allen Fotos beim Vertrag. Danach lässt es sich an den Mieter schicken und die
          Versorger können benachrichtigt werden.
        </p>
      </div>
      {vorschauFlaeche}
    </div>
  );

  const schritte: Record<Exclude<UebergabeSchritt, "pruefen">, React.ReactNode> = {
    allgemein: schrittAllgemein,
    zaehler: schrittZaehler,
    zustand: schrittZustand,
    unterschriften: schrittUnterschriften,
  };

  const inhalt = isSaved && gespeichertAm ? (
    <UebergabeAbschluss
      isEinzug={isEinzug}
      gespeichertAm={gespeichertAm}
      onDownload={handleDownloadPdf}
      mieterVorhanden={mieterData.length > 0}
      mailVersendetAn={mailVersendetAn}
      mieterBeliefert={mieterBeliefert}
      onMail={() => setShowEmailDialog(true)}
      versorger={versorgerData}
      benachrichtigt={versorgerBenachrichtigt}
      onVersorger={() => setShowVersorgerDialog(true)}
      ladefehler={{ mieter: ladeFehler.mieter, versorger: ladeFehler.versorger }}
      onNeuLaden={() => setLadeVersuch((v) => v + 1)}
    />
  ) : (
    <div className="space-y-5">
      {hinweisKarten}
      {/* Während des Speicherns gesperrt: Was jetzt noch getippt würde, käme in
          kein Protokoll und ginge mit dem gelöschten Entwurf verloren.
          pointer-events: Die Unterschriftsfläche ist kein Formularfeld und
          ließe sich sonst weiter bemalen. Alle Schritte bleiben eingehängt und
          werden nur ausgeblendet — ein laufender Upload überlebt so „Weiter“. */}
      <fieldset
        disabled={isSubmitting || isSaved || ausgangUnklar}
        className={cn("min-w-0", (isSubmitting || isSaved || ausgangUnklar) && "pointer-events-none", (isSubmitting || ausgangUnklar) && "opacity-60")}
      >
        <legend className="sr-only">{SCHRITT_TITEL[schritt]}</legend>
        {(Object.keys(schritte) as Array<keyof typeof schritte>).map((s) => (
          <section key={s} hidden={schritt !== s} aria-label={SCHRITT_TITEL[s]}>
            {schritte[s]}
          </section>
        ))}
        {schritt === "pruefen" && <section aria-label={SCHRITT_TITEL.pruefen}>{schrittPruefen}</section>}
      </fieldset>
    </div>
  );

  // ============ MELDUNGEN ============
  const meldungsLeiste =
    (ausgangUnklar && !isSaved) || meldung ? (
      <div className="space-y-2 border-t bg-background px-4 py-2 sm:px-6 quer:py-1">
        {ausgangUnklar && !isSaved && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm quer:py-1 quer:text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <span className="min-w-0 flex-1">
              Ob das Protokoll gespeichert wurde, ist noch offen (Verbindung?). Bis das geklärt ist, ist das Formular gesperrt.
            </span>
            <Button size="sm" variant="outline" onClick={() => void offenesKlaeren()} disabled={pruefungLaeuft} className="h-9">
              {pruefungLaeuft ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Erneut prüfen
            </Button>
          </div>
        )}
        {meldung && (
          <div
            role={meldung.art === "fehler" ? "alert" : "status"}
            className={cn(
              // Quer zählt jede Zeile: dort kleiner
              "flex items-start gap-2 rounded-md border px-3 py-2 text-sm quer:py-1 quer:text-xs",
              meldung.art === "fehler" ? "border-destructive/40 bg-destructive/10" : meldung.art === "erfolg" ? "border-success/40 bg-success/10" : "bg-muted/40"
            )}
          >
            {meldung.art === "fehler" ? (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            ) : meldung.art === "erfolg" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <p className="min-w-0 flex-1">
              <span className="font-medium">{meldung.titel}.</span> <span className="text-muted-foreground">{meldung.text}</span>
            </p>
            <button type="button" onClick={() => setMeldung(null)} aria-label="Meldung schließen" className="rounded p-0.5 text-muted-foreground hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    ) : null;

  // ============ FUSSLEISTE ============
  const naechster = UEBERGABE_SCHRITTE[schrittIndex + 1];
  const vorheriger = UEBERGABE_SCHRITTE[schrittIndex - 1];
  // Gespeichert wird erst, wenn die Vorschau des aktuellen Stands steht (oder sich
  // nicht erstellen ließ — dann baut das Speichern das PDF selbst)
  const speichernKnopf = (
    <Button
      key="speichern"
      onClick={() => handleSubmit()}
      // Solange unklar ist, ob ein früherer Lauf gespeichert hat, nur „Erneut prüfen“
      disabled={isSubmitting || pruefungLaeuft || ausgangUnklar || isGeneratingPreview || fotosLaden || speichernGesperrt || pruefenFrisch || (!vorschauAktuell && !vorschauFehler)}
      className="h-11 sm:h-10"
    >
      {isSubmitting ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Wird gespeichert …
        </>
      ) : fotosLaden ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Fotos laden …
        </>
      ) : (
        <>
          <Save className="h-4 w-4" />
          Protokoll speichern
        </>
      )}
    </Button>
  );
  const knoepfe = isSaved ? (
    <Button onClick={schliessenAnfragen} className="h-11 sm:h-10">
      Fertig
    </Button>
  ) : (
    <>
      {vorheriger && (
        <Button variant="outline" onClick={() => geheZu(vorheriger)} disabled={isSubmitting || navFrisch} className="h-11 sm:h-10">
          <ArrowLeft className="h-4 w-4" />
          Zurück
        </Button>
      )}
      {naechster ? (
        // Eigener key: Sonst übernimmt „Protokoll speichern“ denselben Knopf samt Fokus,
        // und ein zweites Enter speicherte
        <Button key="weiter" onClick={() => geheZu(naechster)} disabled={isSubmitting || navFrisch} className="h-11 sm:h-10">
          {isMobile ? "Weiter" : `Weiter: ${SCHRITT_TITEL[naechster]}`}
          <ArrowRight className="h-4 w-4" />
        </Button>
      ) : (
        speichernKnopf
      )}
    </>
  );

  const menue = !isSaved && (
    // modal={false}: Öffnet aus dem Menü die Rückfrage, räumt Radix sonst die
    // Sperre am <body> nicht immer ab — die Seite bliebe danach unklickbar
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Weitere Aktionen" className="h-9 w-9 shrink-0">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={isSubmitting || isGeneratingPreview || fotosLaden}
          onSelect={() => (ungespeicherteEingaben ? setZuruecksetzenFragen(true) : resetForm())}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Entwurf verwerfen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const dialogTitle = isSaved ? `${isEinzug ? "Einzug" : "Auszug"} übergeben` : `Übergabe · ${isEinzug ? "Einzug" : "Auszug"}`;
  const symbol = <KeyRound className={cn("h-5 w-5 shrink-0", isEinzug ? "text-success" : "text-warning")} />;

  // Beide Mail-Dialoge gibt es erst nach dem Speichern, sie verschicken das
  // abgelegte Protokoll. Sie bleiben eingehängt, solange der Übergabe-Dialog
  // offen ist: Schließen und wieder Öffnen behält Texte und Versandstand.
  const emailDialogComponent = isSaved && savedPdfPath && uebergabeDatum && mieterData.length > 0 && (
    <UebergabeEmailDialog
      isOpen={showEmailDialog}
      onClose={() => setShowEmailDialog(false)}
      isEinzug={isEinzug}
      mieter={mieterData}
      adressVorschlaege={mieterEmails}
      contracts={contracts}
      uebergabeDatum={uebergabeDatum}
      mieterName={mieterName || ""}
      pdfPfad={savedPdfPath}
      onVersendet={(adressen, anMieter) => {
        setMailVersendetAn((vorher) => [...new Set([...vorher, ...adressen])]);
        if (anMieter) setMieterBeliefert(true);
      }}
    />
  );

  const immobilieId = contracts[0]?.einheit?.immobilie_id || contracts[0]?.einheit?.immobilie?.id;
  const firstZaehler = zaehlerstaendePerContract[contracts[0]?.id] || { strom: "", gas: "", wasser: "", warmwasser: "" };
  // Stabil halten: Der Versorger-Dialog baut Betreff und Text beim ersten Öffnen
  // aus diesen Werten — als Literal wäre es nach jedem Render neu.
  const versorgerZaehlerstaende = useMemo(
    () => ({ strom: zaehlerstandText(firstZaehler.strom), gas: zaehlerstandText(firstZaehler.gas), wasser: zaehlerstandText(firstZaehler.wasser) }),
    [firstZaehler.strom, firstZaehler.gas, firstZaehler.wasser]
  );

  const versorgerDialogComponent = isSaved && savedPdfPath && uebergabeDatum && immobilieId && (
    <VersorgerBenachrichtigungDialog
      isOpen={showVersorgerDialog}
      onClose={() => setShowVersorgerDialog(false)}
      immobilieId={immobilieId}
      mieterName={mieterName || ""}
      uebergabeDatum={uebergabeDatum}
      zaehlerstaende={versorgerZaehlerstaende}
      adresse={contracts[0]?.einheit?.immobilie?.adresse || ""}
      einheitBezeichnung={contracts[0]?.einheit?.mietsache || contracts[0]?.einheit?.etage || undefined}
      isEinzug={isEinzug}
      contractIds={vertragIds}
      initialSelected={versorgerSelected}
      pdfPfad={savedPdfPath}
      onVersendet={(typen) => setVersorgerBenachrichtigt((vorher) => new Set([...vorher, ...typen]))}
    />
  );

  const schliessenAbfrage = (
    <AlertDialog open={schliessenFragen} onOpenChange={setSchliessenFragen}>
      <AlertDialogContent className={ABFRAGE_KLASSE} onCloseAutoFocus={fokusZurueck}>
        <AlertDialogHeader>
          <AlertDialogTitle>Übergabe noch nicht gespeichert</AlertDialogTitle>
          <AlertDialogDescription>
            {/* Ein laufender Upload wird beim Schließen verworfen — das Foto
                landet dann nicht im Entwurf, also darf der Text das nicht versprechen. */}
            {fotosLaden
              ? "Ein Foto wird gerade noch hochgeladen. Wenn Sie jetzt schließen, fehlt es im Entwurf und muss neu aufgenommen werden."
              : entwurfGesichert
                ? "Die Eingaben bleiben als Entwurf auf diesem Gerät erhalten. Wenn Sie diesen Vertrag wieder öffnen, geht es an derselben Stelle weiter. Gespeichert ist das Protokoll erst mit „Protokoll speichern“."
                : "Die Eingaben konnten auf diesem Gerät nicht zwischengespeichert werden und gehen beim Schließen verloren."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Weiter bearbeiten</AlertDialogCancel>
          <AlertDialogAction
            className={cn((!entwurfGesichert || fotosLaden) && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
            onClick={async () => {
              setSchliessenFragen(false);
              if (!entwurfGesichert) {
                // Ohne gesicherten Entwurf hielte nichts den offenen Rückbau fest
                if (!(await offenesZuruecknehmen())) return;
                // Sonst tauchte beim nächsten Öffnen ein älterer Stand als „fortgesetzt“ auf
                entwurfLoeschen(ablage, entwurfKey);
              }
              onClose();
            }}
          >
            {fotosLaden ? "Trotzdem schließen" : entwurfGesichert ? "Schließen" : "Verwerfen und schließen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const fertigAbfrage = (
    <AlertDialog open={fertigFragen} onOpenChange={setFertigFragen}>
      <AlertDialogContent className={ABFRAGE_KLASSE} onCloseAutoFocus={fokusZurueck}>
        <AlertDialogHeader>
          <AlertDialogTitle>Noch nicht versendet</AlertDialogTitle>
          <AlertDialogDescription>
            Das Protokoll ist gespeichert. Offen {offeneVersendungen.length === 1 ? "ist" : "sind"} noch {offeneVersendungen.join(", ")}.
            Nach dem Schließen lässt sich das von hier aus nicht mehr nachholen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Zurück</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setFertigFragen(false);
              handleClose();
            }}
          >
            Trotzdem schließen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // Bis zum 19.10.2026 löschte ein einziger Tipp auf „Formular zurücksetzen“
  // Eingaben, Fotos, Unterschriften und den Entwurf.
  const zuruecksetzenAbfrage = (
    <AlertDialog open={zuruecksetzenFragen} onOpenChange={setZuruecksetzenFragen}>
      <AlertDialogContent className={ABFRAGE_KLASSE} onCloseAutoFocus={fokusZurueck}>
        <AlertDialogHeader>
          <AlertDialogTitle>Entwurf verwerfen?</AlertDialogTitle>
          <AlertDialogDescription>
            Alle Eingaben, Fotos und Unterschriften dieser Übergabe werden aus dem Formular und dem Entwurf auf diesem Gerät
            gelöscht. Das lässt sich nicht rückgängig machen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={async () => {
              setZuruecksetzenFragen(false);
              if (!(await offenesZuruecknehmen())) return;
              resetForm();
            }}
          >
            Verwerfen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const fotoAbfrage = (
    <AlertDialog open={fotoFrage > 0} onOpenChange={(offen) => !offen && setFotoFrage(0)}>
      <AlertDialogContent className={ABFRAGE_KLASSE} onCloseAutoFocus={fokusZurueck}>
        <AlertDialogHeader>
          <AlertDialogTitle>{fotoFrage === 1 ? "1 Foto fehlt im Protokoll" : `${fotoFrage} Fotos fehlen im Protokoll`}</AlertDialogTitle>
          <AlertDialogDescription>
            {fotoFrage === 1 ? "Ein Foto konnte" : "Einige Fotos konnten"} nicht geladen werden, meist wegen einer schwachen
            Verbindung. Wird jetzt ohne sie gespeichert, fehlen sie dauerhaft im archivierten Protokoll und in jeder Mail. Im
            Dokumentenbereich des Vertrags werden die Fotos trotzdem eingetragen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            className="mt-2 sm:mt-0 border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              setFotoFrage(0);
              handleSubmit(true);
            }}
          >
            Ohne diese Fotos speichern
          </AlertDialogAction>
          <AlertDialogAction
            onClick={() => {
              setFotoFrage(0);
              handleSubmit();
            }}
          >
            Erneut versuchen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const abfragen = (
    <>
      {emailDialogComponent}
      {versorgerDialogComponent}
      {schliessenAbfrage}
      {fertigAbfrage}
      {zuruecksetzenAbfrage}
      {fotoAbfrage}
    </>
  );

  const schrittleiste = !isSaved && (
    <UebergabeSchrittleiste
      schritte={UEBERGABE_SCHRITTE}
      aktuell={schritt}
      zustaende={zustaende}
      besucht={besucht}
      onWaehle={geheZu}
      kompakt={isMobile}
    />
  );

  if (isMobile) {
    return (
      // dismissible={false}: kein Schließen durch Wischen oder Tippen daneben.
      // Bei einem langen Formular reichte ein Zug nach unten am oberen Rand, und
      // alles war weg. Geschlossen wird nur über das X im Kopf oder „Fertig“.
      <Drawer open={isOpen} dismissible={false}>
        {abfragen}
        {/* quer: volle Höhe, Griff (ohne Funktion, dismissible=false) ausgeblendet,
            Kopf, Schrittleiste und Fußleiste je in einer Zeile */}
        <DrawerContent className="flex h-[96vh] max-h-[96vh] flex-col supports-[height:100dvh]:h-[96dvh] supports-[height:100dvh]:max-h-[96dvh] quer:h-[100vh] quer:max-h-[100vh] quer:supports-[height:100dvh]:h-[100dvh] quer:supports-[height:100dvh]:max-h-[100dvh] quer:rounded-none quer:[&>div:first-child]:hidden">
          <DrawerHeader className="flex items-start gap-2 px-4 pb-2 pt-3 text-left quer:items-center quer:py-1">
            {symbol}
            <div className="min-w-0 flex-1 quer:flex quer:items-baseline quer:gap-3">
              <DrawerTitle className="text-base quer:shrink-0">{dialogTitle}</DrawerTitle>
              <DrawerDescription className="truncate text-xs">{untertitel}</DrawerDescription>
            </div>
            {menue}
            <Button variant="ghost" size="icon" onClick={schliessenAnfragen} aria-label="Übergabe schließen" className="h-9 w-9 shrink-0">
              <X className="h-5 w-5" />
            </Button>
          </DrawerHeader>
          {schrittleiste}
          <div ref={inhaltRef} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 outline-none quer:py-2" style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
            {inhalt}
          </div>
          {meldungsLeiste}
          <div className="space-y-2 border-t bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 quer:flex quer:items-center quer:gap-3 quer:space-y-0 quer:pt-1.5 quer:pb-[max(0.375rem,env(safe-area-inset-bottom))]">
            {statusZeile && <div className="flex justify-center quer:min-w-0 quer:flex-1 quer:justify-start">{statusZeile}</div>}
            <div className={cn("grid gap-2 quer:flex quer:shrink-0", !isSaved && vorheriger ? "grid-cols-[auto_1fr]" : "grid-cols-1", !statusZeile && "quer:ml-auto")}>{knoepfe}</div>
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && schliessenAnfragen()}>
      {abfragen}
      <DialogContent className="flex h-[92vh] max-h-[960px] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="flex-row items-start gap-3 space-y-0 border-b px-6 py-4 pr-14 text-left quer:py-2">
          {symbol}
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg">{dialogTitle}</DialogTitle>
            <DialogDescription className="truncate">{untertitel}</DialogDescription>
          </div>
          {menue}
        </DialogHeader>
        {schrittleiste}
        <div ref={inhaltRef} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          <div className={cn("mx-auto p-6 quer:p-3", schritt === "pruefen" && !isSaved ? "max-w-none" : "max-w-3xl")}>
            {!isSaved && <h2 className="mb-4 text-base font-semibold quer:mb-2">{SCHRITT_TITEL[schritt]}</h2>}
            {inhalt}
          </div>
        </div>
        {meldungsLeiste}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-background px-6 py-3 quer:py-1.5">
          <div className="min-w-0">{statusZeile}</div>
          <div className="flex items-center gap-2">{knoepfe}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
