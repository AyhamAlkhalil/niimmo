/**
 * Firmenstammdaten für Schriftverkehr (PDF, E-Mail).
 *
 * Bisher standen Firmenname und Anschrift verstreut im PDF-Generator und im
 * E-Mail-Template — mit widersprüchlichen Angaben ("NiImmo Verwaltung GmbH" vs.
 * "NiImmo Wohnungsbaugesellschaft mbH"). Maßgeblich ist der Briefkopf mit
 * Handelsregistereintrag.
 *
 * Achtung: Die Edge Function `send-nebenkostenabrechnung` läuft unter Deno und
 * kann diese Datei nicht importieren — Änderungen dort mitziehen.
 */

export const COMPANY = {
  name: "NiImmo Wohnungsbaugesellschaft mbH",
  strasse: "Egerstorffstraße 11",
  plzOrt: "33119 Sehnde",
  ort: "Sehnde",
  get anschriftEinzeilig() {
    return `${this.name}, ${this.strasse}, ${this.plzOrt}`;
  },

  ansprechpartner: {
    name: "Dennis Baris Mikyas",
    unterschrift: "Dennis Mikyas",
    funktion: "Geschäftsführer",
    telefon: "05138 - 600 72 72",
    fax: "05138 - 600 72 79",
    email: "mikyas@niimmo.de",
  },

  rechtliches: [
    "Vertretungsberechtigte Geschäftsführer: Ayhan Yeyrek, Dennis Mikyas",
    "Registrierung: HRB 208151 | Amtsgericht Hildesheim",
    "Gewerberlaubnis nach § 34c GewO | IHK Hannover",
    "Steuer-Nr.: 16/204/50864",
  ],
} as const;
