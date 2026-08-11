import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Euro,
  Loader2,
  FileText,
  Mail,
  Home,
  Users,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Download,
  Receipt,
  Calculator,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  generateNebenkostenAbrechnungPdf,
  type NebenkostenAbrechnungPdfData,
  type NebenkostenKostenDetail,
} from "@/utils/nebenkostenAbrechnungPdfGenerator";
import {
  BETRKV_KATEGORIEN,
  findeKategorieNachName,
  istBerechenbarerSchluessel,
  type NebenkostenKategorie,
} from "./nebenkostenKategorien";
import {
  berechneAnteil,
  berechneBezugsgroessen,
  berechneVorauszahlungen,
  bezugsgroesseFuerSchluessel,
  ermittlePerioden,
  istAbrechnungsfristAbgelaufen,
  kostenAnteilImZeitraum,
  tageInZeitraum,
  type Bezugsgroessen,
  type Nutzungsperiode,
  type VerteilerSchluessel,
} from "@/utils/nebenkostenBerechnung";
import { useKostenpositionen, positionenImZeitraum } from "@/hooks/useNebenkostenDaten";

interface NebenkostenStep3AbrechnungProps {
  immobilieId: string;
  selectedYear: number;
}

interface MieterAbrechnung {
  /** Stabile Zeilen-ID, auch für Leerstandszeilen. */
  id: string;
  mietvertragId: string | null;
  mieterNamen: string[];
  mieterEmails: string[];
  empfaengerAdresse: string[];
  einheitName: string;
  periode: Nutzungsperiode;
  anzahlMonate: number;
  monatlicheVorauszahlung: number;
  vorauszahlungenGesamt: number;
  kostenDetails: NebenkostenKostenDetail[];
  kostenAnteilGesamt: number;
  saldo: number;
  isLeerstand: boolean;
}

interface KategorieKosten {
  kategorieId: string;
  name: string;
  betrkvNummer?: string;
  pdfName: string;
  schluessel: VerteilerSchluessel;
  /** Bereits auf den Abrechnungszeitraum heruntergerechnet. */
  total: number;
}

function mieterNamenText(namen: string[]): string {
  if (namen.length === 0) return "Unbekannter Mieter";
  if (namen.length === 1) return namen[0];
  return `${namen.slice(0, -1).join(", ")} und ${namen[namen.length - 1]}`;
}

export function NebenkostenStep3Abrechnung({
  immobilieId,
  selectedYear,
}: NebenkostenStep3AbrechnungProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [loadingPdf, setLoadingPdf] = useState<Set<string>>(new Set());
  const [loadingEmail, setLoadingEmail] = useState<Set<string>>(new Set());
  const [forderungenDialogOpen, setForderungenDialogOpen] = useState(false);

  const yearStart = `${selectedYear}-01-01`;
  const yearEnd = `${selectedYear}-12-31`;
  const abrStart = parseISO(yearStart);
  const abrEnde = parseISO(yearEnd);
  const gesamtTage = tageInZeitraum(abrStart, abrEnde);

  const { data: immobilie } = useQuery({
    queryKey: ["immobilie-abrechnung", immobilieId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("immobilien")
        .select("id, adresse, name")
        .eq("id", immobilieId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: einheiten, isLoading: einheitenLoading } = useQuery({
    queryKey: ["einheiten-step3", immobilieId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("einheiten")
        .select("id, zaehler, qm, einheitentyp")
        .eq("immobilie_id", immobilieId);
      if (error) throw error;
      return data || [];
    },
  });

  // Alle Verträge, die den Abrechnungszeitraum berühren — inkl. kuendigungsdatum,
  // vertraglicher Personenzahl und Nachsendeadresse.
  const { data: mietvertraege, isLoading: vertraegeLoading } = useQuery({
    queryKey: ["mietvertraege-step3", immobilieId, selectedYear],
    queryFn: async () => {
      const einheitIds = einheiten?.map((e) => e.id) || [];
      if (einheitIds.length === 0) return [];

      const { data, error } = await supabase
        .from("mietvertrag")
        .select(`
          id,
          einheit_id,
          betriebskosten,
          start_datum,
          ende_datum,
          kuendigungsdatum,
          anzahl_personen,
          neue_anschrift,
          status,
          mietvertrag_mieter(
            mieter:mieter_id(id, vorname, nachname, hauptmail)
          )
        `)
        .in("einheit_id", einheitIds);

      if (error) throw error;
      return data || [];
    },
    enabled: !!einheiten && einheiten.length > 0,
  });

  const { data: alleKostenpositionen, isLoading: kostenLoading } =
    useKostenpositionen(immobilieId);

  // Positionen, die den Abrechnungszeitraum ÜBERLAPPEN. Der frühere Filter
  // (Zeitraum vollständig innerhalb des Jahres) ließ jahresübergreifende
  // Abrechnungen wie Heizperioden komplett unter den Tisch fallen.
  const kostenpositionen = useMemo(
    () =>
      positionenImZeitraum(alleKostenpositionen, abrStart, abrEnde).filter(
        (kp) => kp.ist_umlagefaehig
      ),
    [alleKostenpositionen, abrStart, abrEnde]
  );

  const { data: versandStatus } = useQuery({
    queryKey: ["nebenkosten-abrechnungen-status", immobilieId, selectedYear],
    queryFn: async () => {
      const mietvertragIds = mietvertraege?.map((mv) => mv.id) || [];
      if (mietvertragIds.length === 0) return [];
      const { data, error } = await supabase
        .from("nebenkosten_abrechnungen")
        .select("*")
        .in("mietvertrag_id", mietvertragIds)
        .eq("abrechnungsjahr", selectedYear);
      if (error) throw error;
      return data || [];
    },
    enabled: !!mietvertraege && mietvertraege.length > 0,
  });

  const immobilieAdresse = (immobilie?.adresse || "").trim();

  // ── Nutzungsperioden je Einheit (Verträge + Leerstand) ─────────────────────
  const { perioden, ueberschneidungen } = useMemo(() => {
    if (!einheiten || !mietvertraege) {
      return { perioden: [], ueberschneidungen: [] as { vertragA: string; vertragB: string }[] };
    }

    const alle: {
      periode: Nutzungsperiode;
      mietvertragId: string | null;
      einheitId: string;
    }[] = [];
    const konflikte: { vertragA: string; vertragB: string }[] = [];

    einheiten.forEach((einheit) => {
      const vertraege = mietvertraege.filter((mv) => mv.einheit_id === einheit.id);
      const ergebnis = ermittlePerioden(einheit, vertraege, abrStart, abrEnde);

      ergebnis.vertragsPerioden.forEach((p) =>
        alle.push({ periode: p, mietvertragId: p.mietvertragId, einheitId: einheit.id })
      );
      ergebnis.leerstandsPerioden.forEach((p) =>
        alle.push({ periode: p, mietvertragId: null, einheitId: einheit.id })
      );
      konflikte.push(...ergebnis.ueberschneidungen);
    });

    return { perioden: alle, ueberschneidungen: konflikte };
  }, [einheiten, mietvertraege, abrStart, abrEnde]);

  const bezugsgroessen: Bezugsgroessen = useMemo(
    () =>
      berechneBezugsgroessen(
        einheiten || [],
        perioden.map((p) => p.periode),
        gesamtTage
      ),
    [einheiten, perioden, gesamtTage]
  );

  // ── Kosten je BetrKV-Kategorie, anteilig auf den Abrechnungszeitraum ───────
  const kostenProKategorie = useMemo(() => {
    const map = new Map<string, KategorieKosten>();

    kostenpositionen.forEach((kp) => {
      const art = kp.nebenkostenart;
      const kategorie: NebenkostenKategorie | undefined = findeKategorieNachName(art?.name);

      const kategorieId = kategorie?.id ?? (art ? `custom_${art.id}` : "sonstige_betriebskosten");
      const name = kategorie?.name ?? art?.name ?? "Sonstige Betriebskosten";
      const schluessel = (art?.verteilerschluessel_art ||
        kategorie?.schluessel ||
        "qm") as VerteilerSchluessel;

      const betrag = kostenAnteilImZeitraum(kp, abrStart, abrEnde);
      if (betrag <= 0) return;

      const vorhanden = map.get(kategorieId);
      if (vorhanden) {
        vorhanden.total += betrag;
      } else {
        map.set(kategorieId, {
          kategorieId,
          name,
          betrkvNummer: kategorie?.betrkvNummer,
          pdfName: kategorie?.pdfName ?? name,
          schluessel,
          total: betrag,
        });
      }
    });

    return map;
  }, [kostenpositionen, abrStart, abrEnde]);

  const gesamtkostenUmlagefaehig = useMemo(
    () => Array.from(kostenProKategorie.values()).reduce((s, k) => s + k.total, 0),
    [kostenProKategorie]
  );

  // ── Abrechnung je Nutzungsperiode ──────────────────────────────────────────
  const abrechnungen: MieterAbrechnung[] = useMemo(() => {
    if (!einheiten || !mietvertraege) return [];

    return perioden.map(({ periode, mietvertragId, einheitId }) => {
      const einheit = einheiten.find((e) => e.id === einheitId);
      const vertrag = mietvertragId
        ? mietvertraege.find((mv) => mv.id === mietvertragId)
        : undefined;

      const kostenDetails: NebenkostenKostenDetail[] = [];
      let kostenAnteilGesamt = 0;

      kostenProKategorie.forEach((kategorie) => {
        const anteil = berechneAnteil(periode, kategorie.schluessel, bezugsgroessen);
        const anteilBetrag = kategorie.total * anteil;
        if (anteilBetrag <= 0.01) return;

        kostenAnteilGesamt += anteilBetrag;
        const bezug = bezugsgroesseFuerSchluessel(kategorie.schluessel, periode, bezugsgroessen);

        kostenDetails.push({
          betrkvNummer: kategorie.betrkvNummer,
          kategorieName: kategorie.name,
          gesamtKosten: kategorie.total,
          verteilerschluessel: kategorie.schluessel,
          anteilProzent: anteil * 100,
          anteilBetrag,
          einheitenGesamt: bezug.gesamt,
          ihreEinheiten: bezug.anteilig,
          nutzungsdauerProzent:
            bezugsgroessen.gesamtTage > 0
              ? (periode.tage / bezugsgroessen.gesamtTage) * 100
              : 0,
        });
      });

      const monatlicheVorauszahlung = vertrag?.betriebskosten || 0;
      const vorauszahlung = berechneVorauszahlungen(
        monatlicheVorauszahlung,
        periode.von,
        periode.bis
      );

      const mieterListe = ((vertrag?.mietvertrag_mieter as
        | { mieter: { vorname: string | null; nachname: string | null; hauptmail: string | null } | null }[]
        | undefined) || [])
        .map((mm) => mm.mieter)
        .filter((m): m is NonNullable<typeof m> => !!m);

      const mieterNamen = mieterListe
        .map((m) => `${m.vorname || ""} ${m.nachname || ""}`.trim())
        .filter(Boolean);
      const mieterEmails = mieterListe
        .map((m) => m.hauptmail)
        .filter((mail): mail is string => !!mail && mail.includes("@"));

      // Nach Auszug geht die Abrechnung an die Nachsendeadresse, nicht an das Objekt.
      const empfaengerAdresse = vertrag?.neue_anschrift
        ? vertrag.neue_anschrift.split(/[\n,]/).map((z) => z.trim()).filter(Boolean)
        : immobilieAdresse.split(",").map((z) => z.trim()).filter(Boolean);

      const einheitName = einheit?.zaehler
        ? `Einheit ${einheit.zaehler}`
        : `Einheit ${einheitId.slice(-4)}`;

      const isLeerstand = !mietvertragId;

      return {
        id: mietvertragId ?? `leerstand_${einheitId}_${periode.von.getTime()}`,
        mietvertragId,
        mieterNamen: isLeerstand ? ["Leerstand"] : mieterNamen,
        mieterEmails: isLeerstand ? [] : mieterEmails,
        empfaengerAdresse,
        einheitName,
        periode,
        anzahlMonate: vorauszahlung.monate,
        monatlicheVorauszahlung,
        vorauszahlungenGesamt: vorauszahlung.betrag,
        kostenDetails,
        kostenAnteilGesamt,
        saldo: kostenAnteilGesamt - vorauszahlung.betrag,
        isLeerstand,
      };
    });
  }, [
    perioden,
    einheiten,
    mietvertraege,
    kostenProKategorie,
    bezugsgroessen,
    immobilieAdresse,
  ]);

  const mieterAbrechnungen = abrechnungen.filter((a) => !a.isLeerstand);
  const leerstandAbrechnungen = abrechnungen.filter((a) => a.isLeerstand);
  const nachzahlungAbrechnungen = mieterAbrechnungen.filter((a) => a.saldo > 0.01);
  const guthabenAbrechnungen = mieterAbrechnungen.filter((a) => a.saldo < -0.01);
  const gesamtNachzahlungen = nachzahlungAbrechnungen.reduce((s, a) => s + a.saldo, 0);
  const gesamtGuthaben = guthabenAbrechnungen.reduce((s, a) => s + Math.abs(a.saldo), 0);

  // Altdaten kennen 'individuell' und 'verbrauch'. Dafür gibt es keine
  // Datengrundlage — es wird wie Wohnfläche gerechnet und muss sichtbar sein.
  const unklareSchluessel = Array.from(kostenProKategorie.values()).filter(
    (k) => !istBerechenbarerSchluessel(k.schluessel)
  );

  // Fehlt an einem Vertrag die Personenzahl, stimmen die Personentage der
  // gesamten Immobilie nicht — dann sind ALLE Abrechnungen dieses Objekts
  // betroffen, nicht nur die des lückenhaften Vertrags. Solange eine Kostenart
  // nach Personentagen verteilt wird, wird deshalb nichts erzeugt oder versendet.
  const personenSchluesselAktiv = Array.from(kostenProKategorie.values()).some(
    (k) => k.schluessel === "personen"
  );
  const ohnePersonenzahl = abrechnungen.filter(
    (a) => !a.isLeerstand && !a.periode.personenGepflegt
  );
  const abrechnungGesperrt = personenSchluesselAktiv && ohnePersonenzahl.length > 0;

  const fristAbgelaufen = istAbrechnungsfristAbgelaufen(selectedYear);
  const ohneVorauszahlung = mieterAbrechnungen.filter((a) => a.monatlicheVorauszahlung === 0);
  const ohneEmail = mieterAbrechnungen.filter((a) => a.mieterEmails.length === 0);

  function getVersandInfo(mietvertragId: string | null) {
    if (!mietvertragId) return null;
    return versandStatus?.find((v) => v.mietvertrag_id === mietvertragId) ?? null;
  }

  // ── Persistenz ─────────────────────────────────────────────────────────────

  async function saveAbrechnungRecord(
    abrechnung: MieterAbrechnung,
    kanal: "pdf" | "email"
  ) {
    if (!abrechnung.mietvertragId) return;

    const { data: userData } = await supabase.auth.getUser();
    const payload: Record<string, unknown> = {
      mietvertrag_id: abrechnung.mietvertragId,
      abrechnungsjahr: selectedYear,
      saldo: Math.round(abrechnung.saldo * 100) / 100,
      vorauszahlungen: Math.round(abrechnung.vorauszahlungenGesamt * 100) / 100,
      kosten_gesamt: Math.round(abrechnung.kostenAnteilGesamt * 100) / 100,
      erstellt_von: userData.user?.id ?? null,
    };

    if (kanal === "email") {
      payload.versandt_am = new Date().toISOString();
      payload.versandt_an = abrechnung.mieterEmails.join(", ");
    } else {
      payload.pdf_erstellt_am = new Date().toISOString();
    }

    const { error } = await supabase
      .from("nebenkosten_abrechnungen")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(payload as any, { onConflict: "mietvertrag_id,abrechnungsjahr" });
    if (error) throw error;
  }

  /**
   * Schreibt die Anteile je Kostenposition und Einheit fort. Läuft über eine RPC,
   * damit Löschen und Neuschreiben in einer Transaktion passieren.
   */
  async function saveKostenpositionAnteile() {
    if (kostenpositionen.length === 0 || abrechnungen.length === 0) return;

    const kpIds = kostenpositionen.map((kp) => kp.id);
    const anteile: Record<string, unknown>[] = [];

    for (const kp of kostenpositionen) {
      const art = kp.nebenkostenart;
      const kategorie = findeKategorieNachName(art?.name);
      const schluessel = (art?.verteilerschluessel_art ||
        kategorie?.schluessel ||
        "qm") as VerteilerSchluessel;

      const betragImZeitraum = kostenAnteilImZeitraum(kp, abrStart, abrEnde);
      if (betragImZeitraum <= 0) continue;

      for (const abr of abrechnungen) {
        const anteil = berechneAnteil(abr.periode, schluessel, bezugsgroessen);
        if (anteil <= 0) continue;

        const bezug = bezugsgroesseFuerSchluessel(schluessel, abr.periode, bezugsgroessen);

        anteile.push({
          kostenposition_id: kp.id,
          einheit_id: abr.periode.einheitId,
          anteil_prozent: anteil * 100,
          anteil_betrag: betragImZeitraum * anteil,
          verteilerschluessel_art: schluessel,
          bezugsgroesse_einheit: bezug.anteilig,
          bezugsgroesse_gesamt: bezug.gesamt,
          zeitraum_von: format(abr.periode.von, "yyyy-MM-dd"),
          zeitraum_bis: format(abr.periode.bis, "yyyy-MM-dd"),
          zeitanteil_faktor:
            bezugsgroessen.gesamtTage > 0 ? abr.periode.tage / bezugsgroessen.gesamtTage : 0,
        });
      }
    }

    const { error } = await supabase.rpc("replace_kostenposition_anteile", {
      p_kostenposition_ids: kpIds,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      p_anteile: anteile as any,
    });
    if (error) throw error;
  }

  /**
   * Schreibt Anteile und Audit-Eintrag fort. Wird erst nach dem erfolgreichen
   * Versand bzw. Download aufgerufen und meldet Fehler eigenständig — ein
   * fehlgeschlagenes Protokoll darf nicht als fehlgeschlagener Versand erscheinen.
   */
  async function protokolliere(abrechnung: MieterAbrechnung, kanal: "pdf" | "email") {
    try {
      await saveKostenpositionAnteile();
      await saveAbrechnungRecord(abrechnung, kanal);
      queryClient.invalidateQueries({
        queryKey: ["nebenkosten-abrechnungen-status", immobilieId, selectedYear],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unbekannter Fehler";
      toast({
        title: "Protokollierung fehlgeschlagen",
        description: `${kanal === "email" ? "Die E-Mail wurde versendet" : "Das PDF wurde erstellt"}, der Vorgang konnte aber nicht gespeichert werden: ${message}`,
        variant: "destructive",
      });
    }
  }

  // ── PDF ────────────────────────────────────────────────────────────────────

  function buildPdfData(abrechnung: MieterAbrechnung): NebenkostenAbrechnungPdfData {
    function einheitenLabelFuer(schluessel: VerteilerSchluessel): string {
      const gesamt = bezugsgroesseFuerSchluessel(schluessel, abrechnung.periode, bezugsgroessen)
        .gesamt;
      return schluessel === "qm" ? `${gesamt.toFixed(0)} m²` : `${gesamt.toFixed(0)}`;
    }

    // Seite 2 zeigt alle 17 BetrKV-Positionen, auch die ohne Kosten.
    const immobilieKosten = BETRKV_KATEGORIEN.map((kat) => {
      const entry = kostenProKategorie.get(kat.id);
      const schluessel = (entry?.schluessel ?? kat.schluessel) as VerteilerSchluessel;
      return {
        betrkvNummer: kat.betrkvNummer ?? "",
        name: kat.pdfName ?? kat.name,
        verteilerschluessel: schluessel,
        betragGesamt: entry?.total ?? 0,
        einheitenLabel: einheitenLabelFuer(schluessel),
      };
    });

    // Kostenarten ohne BetrKV-Zuordnung (im Bestand frei benannt) anhängen —
    // sonst fehlen sie in der Auflistung, zählen aber in die Gesamtsumme und
    // die Seite ginge rechnerisch nicht auf.
    const betrkvIds = new Set(BETRKV_KATEGORIEN.map((k) => k.id));
    kostenProKategorie.forEach((entry) => {
      if (betrkvIds.has(entry.kategorieId)) return;
      immobilieKosten.push({
        betrkvNummer: "—",
        name: entry.name,
        verteilerschluessel: entry.schluessel,
        betragGesamt: entry.total,
        einheitenLabel: einheitenLabelFuer(entry.schluessel),
      });
    });

    return {
      immobilieAdresse,
      empfaengerName: mieterNamenText(abrechnung.mieterNamen),
      empfaengerAdresse: abrechnung.empfaengerAdresse,
      gesamtFlaeche: bezugsgroessen.qm,
      anzahlWohneinheiten: bezugsgroessen.einheiten,
      gesamtPersonentage: Math.round(bezugsgroessen.personentage),
      immobilieKosten,
      immobilieGesamtkosten: gesamtkostenUmlagefaehig,
      einheitBezeichnung: abrechnung.einheitName,
      qm: abrechnung.periode.qm,
      anzahlPersonen: abrechnung.periode.personen,
      personentageEinheit: abrechnung.periode.personen * abrechnung.periode.tage,
      mieterName: mieterNamenText(abrechnung.mieterNamen),
      abrechnungsjahr: selectedYear,
      abrechnungszeitraumVon: format(abrStart, "dd.MM.yyyy", { locale: de }),
      abrechnungszeitraumBis: format(abrEnde, "dd.MM.yyyy", { locale: de }),
      nutzungVon: format(abrechnung.periode.von, "dd.MM.yyyy", { locale: de }),
      nutzungBis: format(abrechnung.periode.bis, "dd.MM.yyyy", { locale: de }),
      kostenDetails: abrechnung.kostenDetails,
      monatlicheVorauszahlung: abrechnung.monatlicheVorauszahlung,
      anzahlMonate: abrechnung.anzahlMonate,
      vorauszahlungenGesamt: abrechnung.vorauszahlungenGesamt,
      kostenAnteilGesamt: abrechnung.kostenAnteilGesamt,
      saldo: abrechnung.saldo,
      abrechnungsDatum: format(new Date(), "dd.MM.yyyy", { locale: de }),
    };
  }

  async function handleDownloadPdf(abrechnung: MieterAbrechnung) {
    setLoadingPdf((prev) => new Set([...prev, abrechnung.id]));
    try {
      const blob = await generateNebenkostenAbrechnungPdf(buildPdfData(abrechnung));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Betriebskostenabrechnung_${selectedYear}_${mieterNamenText(
        abrechnung.mieterNamen
      ).replace(/\s+/g, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      toast({
        title: "PDF erstellt",
        description: `Abrechnung für ${mieterNamenText(abrechnung.mieterNamen)} wurde heruntergeladen.`,
      });

      // Auch der Download wird protokolliert — Mieter ohne E-Mail werden
      // postalisch bedient und fehlten sonst komplett im Audit-Trail.
      // Schlägt nur die Protokollierung fehl, ist das PDF trotzdem erzeugt:
      // separat melden, damit es nicht wie ein fehlgeschlagener Download aussieht.
      await protokolliere(abrechnung, "pdf");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unbekannter Fehler";
      toast({ title: "PDF konnte nicht erstellt werden", description: message, variant: "destructive" });
    } finally {
      setLoadingPdf((prev) => {
        const next = new Set(prev);
        next.delete(abrechnung.id);
        return next;
      });
    }
  }

  async function pdfToBase64(pdfData: NebenkostenAbrechnungPdfData): Promise<string> {
    const blob = await generateNebenkostenAbrechnungPdf(pdfData);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function handleSendEmail(abrechnung: MieterAbrechnung) {
    if (abrechnung.mieterEmails.length === 0) {
      toast({
        title: "Keine E-Mail",
        description: "Für diesen Vertrag ist keine E-Mail-Adresse hinterlegt.",
        variant: "destructive",
      });
      return;
    }

    setLoadingEmail((prev) => new Set([...prev, abrechnung.id]));
    try {
      const pdfBase64 = await pdfToBase64(buildPdfData(abrechnung));

      const { data, error } = await supabase.functions.invoke("send-nebenkostenabrechnung", {
        body: {
          // Alle Vertragspartner müssen die Abrechnung erhalten (§ 556 BGB).
          recipientEmails: abrechnung.mieterEmails,
          recipientName: mieterNamenText(abrechnung.mieterNamen),
          pdfBase64,
          immobilieAdresse,
          einheitBezeichnung: abrechnung.einheitName,
          abrechnungsjahr: selectedYear,
          saldo: abrechnung.saldo,
        },
      });

      if (error) throw new Error(error.message || "E-Mail konnte nicht gesendet werden");
      if (data?.error) throw new Error(data.error);

      toast({
        title: "E-Mail gesendet",
        description: `Abrechnung wurde an ${abrechnung.mieterEmails.join(", ")} gesendet.`,
      });

      // Erst nach dem bestätigten Versand protokollieren — und Fehler dabei
      // getrennt melden, sonst liest sich ein Audit-Problem wie ein
      // fehlgeschlagener Versand und die Mail wird ein zweites Mal geschickt.
      await protokolliere(abrechnung, "email");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unbekannter Fehler";
      toast({ title: "Fehler beim Senden", description: message, variant: "destructive" });
    } finally {
      setLoadingEmail((prev) => {
        const next = new Set(prev);
        next.delete(abrechnung.id);
        return next;
      });
    }
  }

  // ── Forderungen ────────────────────────────────────────────────────────────

  /**
   * BKA-Salden werden mit typ='BKA' geschrieben. Ohne diese Kennzeichnung würde
   * der Sollmieten-Cron sie für eine Mietforderung halten und überschreiben, und
   * das Mahnwesen würde sie wie ausstehende Miete behandeln.
   */
  function bkaForderung(abrechnung: MieterAbrechnung) {
    return {
      mietvertrag_id: abrechnung.mietvertragId,
      sollmonat: `${selectedYear}-12-01`,
      sollbetrag: Math.round(abrechnung.saldo * 100) / 100,
      typ: "BKA",
    };
  }

  const createForderungenMutation = useMutation({
    mutationFn: async () => {
      const relevante = mieterAbrechnungen.filter(
        (a) => Math.abs(a.saldo) > 0.01 && a.mietvertragId
      );
      if (relevante.length === 0) return { nachzahlungen: 0, guthaben: 0 };

      const { error } = await supabase
        .from("mietforderungen")
        .insert(relevante.map(bkaForderung));
      if (error) throw error;

      return {
        nachzahlungen: relevante.filter((a) => a.saldo > 0).length,
        guthaben: relevante.filter((a) => a.saldo < 0).length,
      };
    },
    onSuccess: (result) => {
      if (!result) return;
      const parts: string[] = [];
      if (result.nachzahlungen > 0) parts.push(`${result.nachzahlungen} Nachzahlung(en)`);
      if (result.guthaben > 0) parts.push(`${result.guthaben} Guthaben`);
      toast({
        title: "BKA-Positionen eingetragen",
        description: `${parts.join(" und ")} wurden in die Forderungsübersicht übernommen.`,
      });
      queryClient.invalidateQueries({ queryKey: ["mietforderungen"] });
      setForderungenDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    },
  });

  const einzelForderungMutation = useMutation({
    mutationFn: async (abrechnung: MieterAbrechnung) => {
      const { error } = await supabase.from("mietforderungen").insert(bkaForderung(abrechnung));
      if (error) throw error;
      return abrechnung;
    },
    onSuccess: (abrechnung) => {
      toast({
        title: "Forderung angelegt",
        description: `Nachzahlung von ${abrechnung.saldo.toFixed(2)} € erstellt.`,
      });
      queryClient.invalidateQueries({ queryKey: ["mietforderungen"] });
    },
    onError: (err: Error) => {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    },
  });

  // ── Rendering ──────────────────────────────────────────────────────────────

  const isLoading = einheitenLoading || vertraegeLoading || kostenLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (kostenpositionen.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-16">
          <Calculator className="h-14 w-14 mx-auto mb-4 text-muted-foreground opacity-30" />
          <p className="text-lg font-medium">Keine Kostenpositionen vorhanden</p>
          <p className="text-sm text-muted-foreground mt-2">
            Ordnen Sie zuerst in Schritt 1 Zahlungen den Kategorien zu, bevor Sie die Abrechnung
            erstellen.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Abrechnungsfrist § 556 Abs. 3 BGB */}
      {fristAbgelaufen && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="py-3 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-800">Abrechnungsfrist abgelaufen</p>
              <p className="text-xs text-red-700 mt-1">
                Die Frist nach § 556 Abs. 3 BGB endete am 31.12.{selectedYear + 1}. Nachforderungen
                sind ab jetzt in der Regel ausgeschlossen — Guthaben müssen weiterhin ausgezahlt
                werden.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Überschneidende Verträge auf derselben Einheit */}
      {ueberschneidungen.length > 0 && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="py-3 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-800">
                Überschneidende Mietverträge ({ueberschneidungen.length})
              </p>
              <p className="text-xs text-red-700 mt-1">
                Auf mindestens einer Einheit laufen zwei Verträge zeitgleich. Die Kostenanteile
                summieren sich dadurch auf über 100 %. Bitte die Vertragszeiträume korrigieren.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fehlende Personenzahl sperrt die Abrechnung */}
      {abrechnungGesperrt && (
        <Card className="border-red-400 bg-red-50">
          <CardContent className="py-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-red-800">
                Abrechnung gesperrt — Personenzahl fehlt bei {ohnePersonenzahl.length} Vertrag/Verträgen
              </p>
              <p className="text-xs text-red-700">
                Mindestens eine Kostenart wird nach Personentagen verteilt. Die Personenzahl gehört
                zum Mietvertrag und wird nicht ersetzt — fehlt sie, sind die Personentage der
                gesamten Immobilie und damit <span className="font-medium">alle</span> Abrechnungen
                dieses Objekts falsch, nicht nur die betroffenen.
              </p>
              <p className="text-xs text-red-700">
                Betroffen:{" "}
                <span className="font-medium">
                  {ohnePersonenzahl.map((a) => mieterNamenText(a.mieterNamen)).join(", ")}
                </span>
              </p>
              <p className="text-xs text-red-700">
                Personenzahl in Schritt 2 oder direkt im Mietvertrag nachtragen.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Verteilerschlüssel ohne Berechnungsgrundlage */}
      {unklareSchluessel.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-3 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">
                Verteilerschlüssel ohne Berechnungsgrundlage
              </p>
              <p className="text-xs text-amber-700 mt-1">
                Für{" "}
                <span className="font-medium">
                  {unklareSchluessel.map((k) => `${k.name} (${k.schluessel})`).join(", ")}
                </span>{" "}
                gibt es keine Verbrauchserfassung — es wird ersatzweise nach Wohnfläche verteilt.
                Bitte in Schritt 2 einen gültigen Schlüssel wählen.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fehlende BK-Vorauszahlung */}
      {ohneVorauszahlung.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-3 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">
                Fehlende Betriebskosten-Vorauszahlung
              </p>
              <p className="text-xs text-amber-700 mt-1">
                Kein BK-Betrag im Mietvertrag hinterlegt — Vorauszahlung wird als 0 € gerechnet:{" "}
                <span className="font-medium">
                  {ohneVorauszahlung.map((a) => mieterNamenText(a.mieterNamen)).join(", ")}
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Übersichts-Header */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Card className="bg-gradient-to-br from-slate-50 to-slate-100 border-slate-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-slate-200 flex items-center justify-center shrink-0">
                <Users className="h-4 w-4 text-slate-600" />
              </div>
              <div>
                <p className="text-xs text-slate-600 font-medium">Mietverträge</p>
                <p className="text-xl font-bold text-slate-800">
                  {mieterAbrechnungen.length}
                  {leerstandAbrechnungen.length > 0 && (
                    <span className="text-sm font-normal text-slate-500 ml-1">
                      + {leerstandAbrechnungen.length} Leerstand
                    </span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-emerald-200 flex items-center justify-center shrink-0">
                <Euro className="h-4 w-4 text-emerald-700" />
              </div>
              <div>
                <p className="text-xs text-emerald-700 font-medium">Umlagefähig</p>
                <p className="text-lg font-bold text-emerald-800">
                  {gesamtkostenUmlagefaehig.toFixed(0)} €
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-50 to-red-100 border-red-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-red-200 flex items-center justify-center shrink-0">
                <ArrowUp className="h-4 w-4 text-red-700" />
              </div>
              <div>
                <p className="text-xs text-red-700 font-medium">Nachzahlungen</p>
                <p className="text-lg font-bold text-red-800">
                  {nachzahlungAbrechnungen.length} × {gesamtNachzahlungen.toFixed(0)} €
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-green-200 flex items-center justify-center shrink-0">
                <ArrowDown className="h-4 w-4 text-green-700" />
              </div>
              <div>
                <p className="text-xs text-green-700 font-medium">Guthaben</p>
                <p className="text-lg font-bold text-green-800">
                  {guthabenAbrechnungen.length} × {gesamtGuthaben.toFixed(0)} €
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Aktions-Bar */}
      {(nachzahlungAbrechnungen.length > 0 || guthabenAbrechnungen.length > 0) && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="py-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                {nachzahlungAbrechnungen.length > 0 && (
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                    <p className="text-sm font-medium text-amber-800">
                      {nachzahlungAbrechnungen.length} Nachzahlung(en):{" "}
                      {gesamtNachzahlungen.toFixed(2)} €
                    </p>
                  </div>
                )}
                {guthabenAbrechnungen.length > 0 && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                    <p className="text-sm font-medium text-green-800">
                      {guthabenAbrechnungen.length} Guthaben: {gesamtGuthaben.toFixed(2)} €
                    </p>
                  </div>
                )}
                {ohneEmail.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {ohneEmail.length} Abrechnung(en) ohne E-Mail-Adresse — PDF herunterladen und
                    postalisch versenden.
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-blue-400 text-blue-800 hover:bg-blue-100 gap-2 shrink-0"
                disabled={abrechnungGesperrt}
                title={
                  abrechnungGesperrt
                    ? "Gesperrt: Personenzahl fehlt bei mindestens einem Vertrag"
                    : undefined
                }
                onClick={() => setForderungenDialogOpen(true)}
              >
                <Receipt className="h-4 w-4" />
                Alle BKA-Salden eintragen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mieter-Abrechnungsliste */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Abrechnungen pro Mieter
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Klicken für Details — PDF herunterladen oder per E-Mail versenden
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[500px] sm:h-[calc(100vh-480px)]">
            <div className="p-4 space-y-3">
              {abrechnungen.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-30" />
                  <p className="text-lg font-medium">Keine Mietverträge im Abrechnungszeitraum</p>
                </div>
              ) : (
                abrechnungen.map((abrechnung) => {
                  const isExpanded = expandedCards.has(abrechnung.id);
                  const isNachzahlung = !abrechnung.isLeerstand && abrechnung.saldo > 0.01;
                  const isPdfLoading = loadingPdf.has(abrechnung.id);
                  const isEmailLoading = loadingEmail.has(abrechnung.id);
                  const versandInfo = getVersandInfo(abrechnung.mietvertragId);
                  const bereitsVersendet = !!versandInfo?.versandt_am;
                  const nutzungsanteil =
                    bezugsgroessen.gesamtTage > 0
                      ? abrechnung.periode.tage / bezugsgroessen.gesamtTage
                      : 0;

                  return (
                    <Collapsible
                      key={abrechnung.id}
                      open={isExpanded}
                      onOpenChange={() => {
                        setExpandedCards((prev) => {
                          const next = new Set(prev);
                          if (next.has(abrechnung.id)) next.delete(abrechnung.id);
                          else next.add(abrechnung.id);
                          return next;
                        });
                      }}
                    >
                      <div
                        className={cn(
                          "border-2 rounded-xl transition-all",
                          abrechnung.isLeerstand
                            ? "border-slate-200 bg-slate-50/50"
                            : isNachzahlung
                            ? "border-red-200 bg-red-50/30"
                            : "border-green-200 bg-green-50/30"
                        )}
                      >
                        <CollapsibleTrigger className="w-full p-4 text-left hover:bg-white/40 rounded-t-xl transition-colors">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-3">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                              )}
                              <div
                                className={cn(
                                  "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                                  abrechnung.isLeerstand
                                    ? "bg-slate-100"
                                    : isNachzahlung
                                    ? "bg-red-100"
                                    : "bg-green-100"
                                )}
                              >
                                <Home
                                  className={cn(
                                    "h-4 w-4",
                                    abrechnung.isLeerstand
                                      ? "text-slate-500"
                                      : isNachzahlung
                                      ? "text-red-600"
                                      : "text-green-600"
                                  )}
                                />
                              </div>
                              <div>
                                <p className="font-semibold">
                                  {mieterNamenText(abrechnung.mieterNamen)}
                                </p>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                                  <span>{abrechnung.einheitName}</span>
                                  <span>•</span>
                                  <span>{abrechnung.periode.qm.toFixed(0)} m²</span>
                                  <span>•</span>
                                  <span>{abrechnung.periode.personen} Pers.</span>
                                  <span>•</span>
                                  <span>
                                    {format(abrechnung.periode.von, "dd.MM.yy", { locale: de })} –{" "}
                                    {format(abrechnung.periode.bis, "dd.MM.yy", { locale: de })}
                                  </span>
                                  {nutzungsanteil < 0.99 && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                                      {abrechnung.periode.tage} Tage
                                    </Badge>
                                  )}
                                  {!abrechnung.isLeerstand &&
                                    abrechnung.mieterEmails.length === 0 && (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] px-1 py-0 border-amber-300 text-amber-700"
                                      >
                                        Keine E-Mail
                                      </Badge>
                                    )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 ml-10 sm:ml-0">
                              {abrechnung.isLeerstand ? (
                                <Badge
                                  variant="outline"
                                  className="text-sm px-3 py-1 border-slate-400 text-slate-600"
                                >
                                  {abrechnung.saldo.toFixed(2)} € Eigentümeranteil
                                </Badge>
                              ) : (
                                <Badge
                                  variant={isNachzahlung ? "destructive" : "default"}
                                  className={cn("text-sm px-3 py-1", !isNachzahlung && "bg-green-600")}
                                >
                                  {isNachzahlung ? "+" : ""}
                                  {abrechnung.saldo.toFixed(2)} €{" "}
                                  {isNachzahlung ? "Nachzahlung" : "Guthaben"}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </CollapsibleTrigger>

                        <CollapsibleContent>
                          <div className="px-4 pb-4 space-y-4 border-t bg-white/30">
                            <div className="pt-4 space-y-1">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                Kostenaufschlüsselung
                              </p>
                              {abrechnung.kostenDetails.map((detail, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between text-sm py-1.5 border-b border-dashed border-muted last:border-0"
                                >
                                  <span className="text-muted-foreground">
                                    {detail.betrkvNummer ? `${detail.betrkvNummer} ` : ""}
                                    {detail.kategorieName}
                                  </span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-muted-foreground">
                                      {detail.anteilProzent.toFixed(1)}%
                                    </span>
                                    <span className="font-medium w-20 text-right">
                                      {detail.anteilBetrag.toFixed(2)} €
                                    </span>
                                  </div>
                                </div>
                              ))}
                              <div className="flex items-center justify-between text-sm pt-2 font-semibold">
                                <span>Kosten gesamt</span>
                                <span>{abrechnung.kostenAnteilGesamt.toFixed(2)} €</span>
                              </div>
                              <div className="flex items-center justify-between text-sm text-muted-foreground">
                                <span>
                                  Vorauszahlungen ({abrechnung.anzahlMonate.toFixed(1)} Monate ×{" "}
                                  {abrechnung.monatlicheVorauszahlung.toFixed(2)} €)
                                </span>
                                <span>– {abrechnung.vorauszahlungenGesamt.toFixed(2)} €</span>
                              </div>
                              <div
                                className={cn(
                                  "flex items-center justify-between text-base font-bold pt-2 border-t",
                                  abrechnung.isLeerstand
                                    ? "text-slate-600"
                                    : isNachzahlung
                                    ? "text-red-700"
                                    : "text-green-700"
                                )}
                              >
                                <span>
                                  {abrechnung.isLeerstand
                                    ? "Eigentümeranteil (Leerstand)"
                                    : isNachzahlung
                                    ? "Nachzahlung"
                                    : "Guthaben"}
                                </span>
                                <span>
                                  {isNachzahlung ? "+" : ""}
                                  {abrechnung.saldo.toFixed(2)} €
                                </span>
                              </div>
                            </div>

                            {!abrechnung.isLeerstand && (
                              <div className="flex flex-wrap gap-2 pt-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-2"
                                  onClick={() => handleDownloadPdf(abrechnung)}
                                  disabled={isPdfLoading || abrechnungGesperrt}
                                  title={
                                    abrechnungGesperrt
                                      ? "Gesperrt: Personenzahl fehlt bei mindestens einem Vertrag"
                                      : undefined
                                  }
                                >
                                  {isPdfLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Download className="h-4 w-4" />
                                  )}
                                  PDF herunterladen
                                </Button>

                                <div className="flex flex-col gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className={cn(
                                      "gap-2",
                                      bereitsVersendet &&
                                        "border-blue-300 text-blue-700 hover:bg-blue-50"
                                    )}
                                    onClick={() => handleSendEmail(abrechnung)}
                                    disabled={
                                      isEmailLoading ||
                                      abrechnung.mieterEmails.length === 0 ||
                                      abrechnungGesperrt
                                    }
                                    title={
                                      abrechnungGesperrt
                                        ? "Gesperrt: Personenzahl fehlt bei mindestens einem Vertrag"
                                        : abrechnung.mieterEmails.length === 0
                                        ? "Keine E-Mail-Adresse hinterlegt"
                                        : undefined
                                    }
                                  >
                                    {isEmailLoading ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : bereitsVersendet ? (
                                      <CheckCircle2 className="h-4 w-4" />
                                    ) : (
                                      <Mail className="h-4 w-4" />
                                    )}
                                    {bereitsVersendet ? "Erneut senden" : "Per E-Mail senden"}
                                    {abrechnung.mieterEmails.length > 0 && (
                                      <span className="text-xs text-muted-foreground ml-1">
                                        ({abrechnung.mieterEmails.join(", ")})
                                      </span>
                                    )}
                                  </Button>
                                  {bereitsVersendet && versandInfo?.versandt_am && (
                                    <p className="text-xs text-blue-600 flex items-center gap-1 ml-1">
                                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                                      Versendet am{" "}
                                      {format(parseISO(versandInfo.versandt_am), "dd.MM.yyyy, HH:mm", {
                                        locale: de,
                                      })}{" "}
                                      Uhr
                                    </p>
                                  )}
                                  {!bereitsVersendet && versandInfo?.pdf_erstellt_am && (
                                    <p className="text-xs text-muted-foreground flex items-center gap-1 ml-1">
                                      <Download className="h-3 w-3 shrink-0" />
                                      PDF erstellt am{" "}
                                      {format(
                                        parseISO(versandInfo.pdf_erstellt_am),
                                        "dd.MM.yyyy, HH:mm",
                                        { locale: de }
                                      )}{" "}
                                      Uhr
                                    </p>
                                  )}
                                </div>

                                {isNachzahlung && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50"
                                    disabled={einzelForderungMutation.isPending || abrechnungGesperrt}
                                    onClick={() => einzelForderungMutation.mutate(abrechnung)}
                                  >
                                    <Receipt className="h-4 w-4" />
                                    Als Forderung anlegen
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <AlertDialog open={forderungenDialogOpen} onOpenChange={setForderungenDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>BKA-Salden in Forderungsübersicht eintragen?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {nachzahlungAbrechnungen.length > 0 && (
                  <p>
                    <span className="font-medium text-amber-700">
                      {nachzahlungAbrechnungen.length} Nachzahlung(en)
                    </span>{" "}
                    über insgesamt {gesamtNachzahlungen.toFixed(2)} € werden als Forderung
                    eingetragen.
                  </p>
                )}
                {guthabenAbrechnungen.length > 0 && (
                  <p>
                    <span className="font-medium text-green-700">
                      {guthabenAbrechnungen.length} Guthaben
                    </span>{" "}
                    über insgesamt {gesamtGuthaben.toFixed(2)} € werden als Guthaben eingetragen
                    (negativer Betrag).
                  </p>
                )}
                <p>
                  Alle Einträge werden mit Typ „BKA" und Sollmonat 12/{selectedYear} gespeichert.
                  Nachzahlungen sind 30 Tage nach Eintrag fällig, Guthaben werden nicht angemahnt.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => createForderungenMutation.mutate()}
              disabled={createForderungenMutation.isPending}
            >
              {createForderungenMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Eintragen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
