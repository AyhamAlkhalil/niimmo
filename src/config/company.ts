/**
 * Firmenstammdaten für Schriftverkehr (PDF, E-Mail).
 *
 * Einzige Quelle für den Absender. Bis zum 06.09.2026 standen die Angaben in
 * sieben Generatoren verstreut und widersprachen sich: Straße („Egerstorffstraße"
 * gegen „Egestorffstraße"), Postleitzahl (33119 gegen 31319), Handelsregister
 * (HRB 208151 gegen 208111) und Steuernummer (…50864 gegen …50884). Die
 * Betriebskostenabrechnung — der einzige Generator, der diese Datei schon nutzte —
 * trug deshalb als einziges Schreiben die falsche Anschrift.
 *
 * Maßgeblich ist seit dem 06.09.2026 der Handelsregisterauszug (Kundenauskunft):
 * NiImmo Wohnungsbaugesellschaft mbH, Amtsgericht Hildesheim HRB 208111,
 * EUID DEP2408.HRB208111, Egestorffstr. 11, 31319 Sehnde.
 *
 * Nicht verwechseln: Der Absender ist die Verwaltung. Die Vertragspartei eines
 * Mietvertrags steht in der Tabelle `vermieter` und kann eine andere Gesellschaft
 * sein (NiImmo Projektentwicklung & Bau GmbH & Co. KG, HRA 202284).
 *
 * Achtung: Die Edge Function `send-nebenkostenabrechnung` läuft unter Deno und
 * kann diese Datei nicht importieren — Änderungen dort mitziehen.
 */

export const COMPANY = {
  name: "NiImmo Wohnungsbaugesellschaft mbH",
  /** Kurzform ohne Rechtsform, wie sie in der Absenderzeile über der Anschrift steht. */
  nameKurz: "NiImmo Wohnungsbaugesellschaft",
  strasse: "Egestorffstraße 11",
  plzOrt: "31319 Sehnde",
  ort: "Sehnde",
  /** Allgemeine Firmenadresse; die persönliche steht unter ansprechpartner.email. */
  email: "info@niimmo.de",
  get anschriftEinzeilig() {
    return `${this.name}, ${this.strasse}, ${this.plzOrt}`;
  },
  /** Absenderzeile über dem Anschriftenfeld (DIN 5008). */
  get absenderzeile() {
    return `${this.nameKurz}, ${this.strasse}, ${this.plzOrt}`;
  },

  ansprechpartner: {
    name: "Dennis Baris Mikyas",
    unterschrift: "Dennis Mikyas",
    funktion: "Geschäftsführer",
    telefon: "05138 - 600 72 72",
    fax: "05138 - 600 72 79",
    email: "mikyas@niimmo.de",
  },

  /** Geschäftsführer in der im Handelsregister eingetragenen Reihenfolge. */
  geschaeftsfuehrer: "Ayhan Yeyrek, Dennis Mikyas",

  register: {
    gericht: "Amtsgericht Hildesheim",
    abteilung: "Handelsregister B",
    nummer: "HRB 208111",
    euid: "DEP2408.HRB208111",
  },

  /**
   * Vom Kunden am 06.09.2026 bestätigt. Dieselbe Nummer steht in der Tabelle
   * `vermieter` und damit in allen erzeugten Mietverträgen. Die abweichende
   * Fassung 16/204/50884 stand in den vier Briefgeneratoren und ging damit auf
   * Mahnungen, Kündigungen, Übergabeprotokollen und Erhöhungsschreiben hinaus —
   * sie ist falsch und darf nicht zurückkehren.
   */
  steuernummer: "16/204/50864",

  gewerbeerlaubnis: {
    grundlage: "Gewerbeerlaubnis nach § 34c GewO",
    aufsicht: "IHK Hannover",
  },

  /** Zeilen der Brieffußzeile, linke Spalte. */
  get rechtliches(): string[] {
    return [
      `Vertretungsberechtigte Geschäftsführer: ${this.geschaeftsfuehrer}`,
      `Registrierung: ${this.register.nummer} | ${this.register.gericht}`,
      `${this.gewerbeerlaubnis.grundlage} | ${this.gewerbeerlaubnis.aufsicht}`,
      `Steuer-Nr.: ${this.steuernummer}`,
    ];
  },
} as const;
