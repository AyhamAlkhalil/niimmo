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

// BetrKV § 2 - 17 umlagefähige Nebenkostenarten
export const BETRKV_KATEGORIEN = [
  { id: "grundsteuer", betrkvNummer: "2.1", name: "Grundsteuer", pdfName: "Kosten der Grundsteuer", icon: Building2, beschreibung: "Laufende öffentliche Lasten des Grundstücks", umlagefaehig: true, schluessel: "gleich" },
  { id: "wasserversorgung", betrkvNummer: "2.2", name: "Wasserversorgung", pdfName: "Kosten der Wasserversorgung", icon: Droplets, beschreibung: "Kosten des Wasserverbrauchs, Grundgebühren", umlagefaehig: true, schluessel: "personen" },
  { id: "entwaesserung", betrkvNummer: "2.3", name: "Entwässerung", pdfName: "Kosten der Entwässerung", icon: Droplets, beschreibung: "Kosten der Abwasserentsorgung", umlagefaehig: true, schluessel: "qm" },
  { id: "heizkosten", betrkvNummer: "2.4", name: "Heizkosten", pdfName: "K.d. Betriebs & Wartung der Heizungsanlage", icon: Flame, beschreibung: "Kosten der zentralen Heizungsanlage", umlagefaehig: true, schluessel: "gleich" },
  { id: "warmwasserkosten", betrkvNummer: "2.5", name: "Warmwasserkosten", pdfName: "K.d. Betriebs & Wartung der WWV", icon: Flame, beschreibung: "Kosten der zentralen Warmwasserversorgung", umlagefaehig: true, schluessel: "gleich" },
  { id: "verbundene_anlagen", betrkvNummer: "2.6", name: "Verbundene Anlagen", pdfName: "K.v. Heizungs- und WWV", icon: Flame, beschreibung: "Heizung und Warmwasser kombiniert", umlagefaehig: true, schluessel: "gleich" },
  { id: "aufzug", betrkvNummer: "2.7", name: "Aufzug", pdfName: "K.d. Betriebs d. Personen- oder Lastenaufzugs", icon: Building2, beschreibung: "Betriebsstrom, Wartung, Überwachung", umlagefaehig: true, schluessel: "gleich" },
  { id: "strassenreinigung_muell", betrkvNummer: "2.8", name: "Straßenreinigung & Müll", pdfName: "K.d. Straßenreinigung und Müllb.", icon: Trash2, beschreibung: "Müllabfuhr, Straßenreinigung", umlagefaehig: true, schluessel: "qm" },
  { id: "gebaeudereinigung", betrkvNummer: "2.9", name: "Gebäudereinigung", pdfName: "K.d. Gebäudereinigung und Ungezieferbek.", icon: Home, beschreibung: "Reinigung, Ungezieferbekämpfung", umlagefaehig: true, schluessel: "qm" },
  { id: "gartenpflege", betrkvNummer: "2.10", name: "Gartenpflege", pdfName: "Kosten der Gartenpflege", icon: TreePine, beschreibung: "Pflege von Gärten, Spielplätzen", umlagefaehig: true, schluessel: "qm" },
  { id: "beleuchtung", betrkvNummer: "2.11", name: "Beleuchtung", pdfName: "Kosten der Beleuchtung", icon: Zap, beschreibung: "Außenbeleuchtung, Treppenhaus", umlagefaehig: true, schluessel: "qm" },
  { id: "schornsteinreinigung", betrkvNummer: "2.12", name: "Schornsteinreinigung", pdfName: "Kosten der Schornsteinreinigung", icon: Flame, beschreibung: "Kehrgebühren, Emissionsmessungen", umlagefaehig: true, schluessel: "gleich" },
  { id: "versicherungen", betrkvNummer: "2.13", name: "Versicherungen", pdfName: "Kosten der Sach- und Haftpflichtversicherung", icon: Shield, beschreibung: "Gebäude-, Haftpflichtversicherungen", umlagefaehig: true, schluessel: "qm" },
  { id: "hauswart", betrkvNummer: "2.14", name: "Hauswart", pdfName: "Kosten für den Hauswart", icon: User, beschreibung: "Vergütung, Sozialbeiträge", umlagefaehig: true, schluessel: "qm" },
  { id: "antenne_kabel", betrkvNummer: "2.15", name: "Antenne/Kabel", pdfName: "K.d. Betriebs der mit einem Breitbandnetz verb.", icon: Tv, beschreibung: "Gemeinschaftsantenne, Kabelanschluss", umlagefaehig: true, schluessel: "gleich" },
  { id: "waeschepflege", betrkvNummer: "2.16", name: "Wäschepflege", pdfName: "K.d. Betriebs der Einrichtungen für die Wäschepfl.", icon: WashingMachine, beschreibung: "Gemeinschaftliche Waschmaschinen", umlagefaehig: true, schluessel: "qm" },
  { id: "sonstige_betriebskosten", betrkvNummer: "2.17", name: "Sonstige Betriebskosten", pdfName: "2.17 Sonstiges", icon: MoreHorizontal, beschreibung: "Vertraglich vereinbarte Kosten", umlagefaehig: true, schluessel: "qm" },
];

// Nicht umlagefähige Kostenarten
export const NICHT_UMLAGEFAEHIGE_KATEGORIEN = [
  { id: "reparaturen", name: "Reparaturen", icon: Wrench, beschreibung: "Instandhaltungskosten", umlagefaehig: false, schluessel: "qm" },
  { id: "wartungen", name: "Wartungen", icon: Wrench, beschreibung: "Instandsetzungswartungen", umlagefaehig: false, schluessel: "qm" },
  { id: "bankgebuehren", name: "Bankgebühren", icon: Euro, beschreibung: "Kontoführung, Porto", umlagefaehig: false, schluessel: "qm" },
  { id: "hausverwaltung", name: "Hausverwaltung", icon: Building2, beschreibung: "Verwaltungskosten", umlagefaehig: false, schluessel: "qm" },
];
