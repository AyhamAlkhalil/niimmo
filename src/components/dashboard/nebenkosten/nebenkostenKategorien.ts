import {
  Building2,
  Droplets,
  Flame,
  Zap,
  Trash2,
  TreePine,
  Shield,
  User,
  Tv,
  WashingMachine,
  MoreHorizontal,
  Wrench,
  Home,
  Euro,
} from "lucide-react";
import type { VerteilerSchluessel } from "@/utils/nebenkostenBerechnung";

export interface NebenkostenKategorie {
  id: string;
  betrkvNummer?: string;
  name: string;
  pdfName?: string;
  icon: typeof Building2;
  beschreibung: string;
  umlagefaehig: boolean;
  schluessel: VerteilerSchluessel;
}

// BetrKV § 2 - 17 umlagefähige Nebenkostenarten.
// Die Verteilerschlüssel sind Kundenvorgabe (NiImmo-Vorlage) und dürfen nur
// auf ausdrücklichen Kundenwunsch geändert werden.
export const BETRKV_KATEGORIEN: NebenkostenKategorie[] = [
  { id: "grundsteuer", betrkvNummer: "2.1", name: "Grundsteuer", pdfName: "Kosten der Grundsteuer", icon: Building2, beschreibung: "Laufende öffentliche Lasten des Grundstücks", umlagefaehig: true, schluessel: "gleich" },
  { id: "wasserversorgung", betrkvNummer: "2.2", name: "Wasserversorgung", pdfName: "Kosten der Wasserversorgung", icon: Droplets, beschreibung: "Kosten des Wasserverbrauchs, Grundgebühren", umlagefaehig: true, schluessel: "personen" },
  { id: "entwaesserung", betrkvNummer: "2.3", name: "Entwässerung", pdfName: "Kosten der Entwässerung", icon: Droplets, beschreibung: "Kosten der Abwasserentsorgung", umlagefaehig: true, schluessel: "qm" },
  { id: "heizkosten", betrkvNummer: "2.4", name: "Heizkosten", pdfName: "K.d. Betriebs & Wartung der Heizungsanlage", icon: Flame, beschreibung: "Kosten der zentralen Heizungsanlage", umlagefaehig: true, schluessel: "gleich" },
  { id: "warmwasserkosten", betrkvNummer: "2.5", name: "Warmwasserkosten", pdfName: "K.d. Betriebs & Wartung der WWV", icon: Flame, beschreibung: "Kosten der zentralen Warmwasserversorgung", umlagefaehig: true, schluessel: "gleich" },
  { id: "verbundene_anlagen", betrkvNummer: "2.6", name: "Verbundene Anlagen", pdfName: "K.v. Heizungs- und WWV", icon: Flame, beschreibung: "Heizung und Warmwasser kombiniert", umlagefaehig: true, schluessel: "gleich" },
  { id: "aufzug", betrkvNummer: "2.7", name: "Aufzug", pdfName: "K.d. Betriebs d. Personen- oder Lastenaufzugs", icon: Building2, beschreibung: "Betriebsstrom, Wartung, Überwachung", umlagefaehig: true, schluessel: "qm" },
  { id: "strassenreinigung_muell", betrkvNummer: "2.8", name: "Straßenreinigung & Müll", pdfName: "K.d. Straßenreinigung und Müllb.", icon: Trash2, beschreibung: "Müllabfuhr, Straßenreinigung", umlagefaehig: true, schluessel: "qm" },
  { id: "gebaeudereinigung", betrkvNummer: "2.9", name: "Gebäudereinigung", pdfName: "K.d. Gebäudereinigung und Ungezieferbek.", icon: Home, beschreibung: "Reinigung, Ungezieferbekämpfung", umlagefaehig: true, schluessel: "qm" },
  { id: "gartenpflege", betrkvNummer: "2.10", name: "Gartenpflege", pdfName: "Kosten der Gartenpflege", icon: TreePine, beschreibung: "Pflege von Gärten, Spielplätzen", umlagefaehig: true, schluessel: "qm" },
  { id: "beleuchtung", betrkvNummer: "2.11", name: "Beleuchtung", pdfName: "Kosten der Beleuchtung", icon: Zap, beschreibung: "Außenbeleuchtung, Treppenhaus, Allgemeinstrom", umlagefaehig: true, schluessel: "qm" },
  { id: "schornsteinreinigung", betrkvNummer: "2.12", name: "Schornsteinreinigung", pdfName: "Kosten der Schornsteinreinigung", icon: Flame, beschreibung: "Kehrgebühren, Emissionsmessungen", umlagefaehig: true, schluessel: "gleich" },
  { id: "versicherungen", betrkvNummer: "2.13", name: "Versicherungen", pdfName: "Kosten der Sach- und Haftpflichtversicherung", icon: Shield, beschreibung: "Gebäude-, Haftpflichtversicherungen", umlagefaehig: true, schluessel: "qm" },
  { id: "hauswart", betrkvNummer: "2.14", name: "Hauswart", pdfName: "Kosten für den Hauswart", icon: User, beschreibung: "Vergütung, Sozialbeiträge", umlagefaehig: true, schluessel: "qm" },
  { id: "antenne_kabel", betrkvNummer: "2.15", name: "Antenne/Kabel", pdfName: "K.d. Betriebs der mit einem Breitbandnetz verb.", icon: Tv, beschreibung: "Gemeinschaftsantenne, Kabelanschluss", umlagefaehig: true, schluessel: "gleich" },
  { id: "waeschepflege", betrkvNummer: "2.16", name: "Wäschepflege", pdfName: "K.d. Betriebs der Einrichtungen für die Wäschepfl.", icon: WashingMachine, beschreibung: "Gemeinschaftliche Waschmaschinen", umlagefaehig: true, schluessel: "qm" },
  { id: "sonstige_betriebskosten", betrkvNummer: "2.17", name: "Sonstige Betriebskosten", pdfName: "2.17 Sonstiges", icon: MoreHorizontal, beschreibung: "Vertraglich vereinbarte Kosten", umlagefaehig: true, schluessel: "qm" },
];

// Nicht umlagefähige Kostenarten
export const NICHT_UMLAGEFAEHIGE_KATEGORIEN: NebenkostenKategorie[] = [
  { id: "reparaturen", name: "Reparaturen", icon: Wrench, beschreibung: "Instandhaltungskosten", umlagefaehig: false, schluessel: "qm" },
  { id: "wartungen", name: "Wartungen", icon: Wrench, beschreibung: "Instandsetzungswartungen", umlagefaehig: false, schluessel: "qm" },
  { id: "bankgebuehren", name: "Bankgebühren", icon: Euro, beschreibung: "Kontoführung, Porto", umlagefaehig: false, schluessel: "qm" },
  { id: "hausverwaltung", name: "Hausverwaltung", icon: Building2, beschreibung: "Verwaltungskosten", umlagefaehig: false, schluessel: "qm" },
];

export const ALLE_KATEGORIEN: NebenkostenKategorie[] = [
  ...BETRKV_KATEGORIEN,
  ...NICHT_UMLAGEFAEHIGE_KATEGORIEN,
];

/**
 * Normalisiert einen Kategorie- oder Nebenkostenart-Namen auf einen Vergleichsschlüssel.
 *
 * Umlaute und ß werden ausgeschrieben (ä→ae, ß→ss), damit "Entwässerung" und die
 * Kategorie-ID "entwaesserung" auf denselben Wert abbilden. Die frühere Variante
 * strippte Umlaute ersatzlos, wodurch bei fünf Kategorien der Lookup nie traf und
 * bei jeder Zuordnung eine neue Nebenkostenart angelegt wurde.
 */
export function normalisiereKategorieName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Namen von Nebenkostenarten, die im Bestand abweichend angelegt wurden, aber
 * eindeutig einer BetrKV-Kategorie entsprechen. Ohne dieses Mapping liefen sie
 * als unbekannte Kostenart durch und bekamen keine BetrKV-Nummer.
 *
 * Bewusst NICHT enthalten sind mehrdeutige Bestandsnamen wie "Wasser/Abwasser",
 * das die getrennten Positionen 2.2 und 2.3 zusammenfasst — solche Arten bleiben
 * eigenständig und werden im PDF als Zusatzposition ausgewiesen.
 */
const NAME_SYNONYME: Record<string, string> = {
  heizung: "heizkosten",
  muellabfuhr: "strassenreinigung_muell",
  muell: "strassenreinigung_muell",
  strassenreinigungundmuellbeseitigung: "strassenreinigung_muell",
  strassenreinigungmuellbeseitigung: "strassenreinigung_muell",
  // Die Normalisierung entfernt "&" ersatzlos — beide Schreibweisen abdecken.
  gebaeudereinigungundungezieferbekaempfung: "gebaeudereinigung",
  gebaeudereinigungungezieferbekaempfung: "gebaeudereinigung",
  ungezieferbekaempfung: "gebaeudereinigung",
  sachundhaftpflichtversicherung: "versicherungen",
  versicherung: "versicherungen",
  hausmeister: "hauswart",
  allgemeinstrom: "beleuchtung",
  strom: "beleuchtung",
  abwasser: "entwaesserung",
  kabelanschluss: "antenne_kabel",
};

/** Findet die Kategorie zu einem Nebenkostenart-Namen aus der Datenbank. */
export function findeKategorieNachName(
  name: string | null | undefined
): NebenkostenKategorie | undefined {
  if (!name) return undefined;
  const normalisiert = normalisiereKategorieName(name);

  const direkt = ALLE_KATEGORIEN.find(
    (k) =>
      normalisiereKategorieName(k.name) === normalisiert ||
      normalisiereKategorieName(k.id) === normalisiert
  );
  if (direkt) return direkt;

  const synonym = NAME_SYNONYME[normalisiert];
  return synonym ? findeKategorieNachId(synonym) : undefined;
}

/**
 * Verteilerschlüssel, für die eine Verteilung berechnet werden kann.
 * `individuell` und `verbrauch` sind in Altdaten vorhanden, haben aber keine
 * Datengrundlage (es gibt keine Verbrauchserfassung je Kostenart) — sie werden
 * wie `qm` gerechnet und müssen im UI sichtbar gemacht werden, damit die
 * Abweichung nicht unbemerkt in die Abrechnung läuft.
 */
export const BERECHENBARE_SCHLUESSEL = ["qm", "personen", "gleich"] as const;

export function istBerechenbarerSchluessel(schluessel: string | null | undefined): boolean {
  return !!schluessel && (BERECHENBARE_SCHLUESSEL as readonly string[]).includes(schluessel);
}

export function findeKategorieNachId(id: string): NebenkostenKategorie | undefined {
  return ALLE_KATEGORIEN.find((k) => k.id === id);
}

/**
 * Ersatz-Kategorie für Nebenkostenarten, die im Bestand frei benannt wurden und
 * keiner BetrKV-Position entsprechen (z. B. "Wasser/Abwasser", das 2.2 und 2.3
 * zusammenfasst). Sie behalten ihren Namen und ihren gespeicherten Schlüssel,
 * statt stillschweigend unter "2.17 Sonstige" zu verschwinden.
 */
export function pseudoKategorieFuerArt(
  art: { id: string; name: string; verteilerschluessel_art: string | null; ist_umlagefaehig?: boolean } | null | undefined
): NebenkostenKategorie | undefined {
  if (!art) return undefined;
  return {
    id: `custom_${art.id}`,
    name: art.name,
    icon: MoreHorizontal,
    beschreibung: "Kostenart ohne BetrKV-Zuordnung",
    umlagefaehig: art.ist_umlagefaehig ?? true,
    schluessel: (art.verteilerschluessel_art || "qm") as VerteilerSchluessel,
  };
}

/**
 * Übersetzt die Kategorien der KI-Vorklassifizierung (Edge Function
 * `classify-nebenkosten`) in BetrKV-Kategorien. Ohne dieses Mapping endete das
 * KI-Ergebnis in einer Sackgasse: es setzte nur die Immobilien-Zuordnung, die
 * fachliche Einordnung musste danach komplett von Hand wiederholt werden.
 */
const KI_KATEGORIE_MAPPING: Record<string, string> = {
  strom: "beleuchtung", // Allgemeinstrom → BetrKV 2.11
  gas: "heizkosten",
  heizung: "heizkosten",
  wasser: "wasserversorgung",
  abwasser: "entwaesserung",
  muell: "strassenreinigung_muell",
  versicherung: "versicherungen",
  grundsteuer: "grundsteuer",
  hausmeister: "hauswart",
  wartung: "wartungen",
  sonstige: "sonstige_betriebskosten",
};

export function kategorieAusKiVorschlag(
  kiKategorie: string | null | undefined
): NebenkostenKategorie | undefined {
  if (!kiKategorie) return undefined;
  const key = normalisiereKategorieName(kiKategorie);
  const mapped = KI_KATEGORIE_MAPPING[key];
  return mapped ? findeKategorieNachId(mapped) : findeKategorieNachName(kiKategorie);
}
