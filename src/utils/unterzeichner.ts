/** Wer ein Schreiben unterzeichnet: Rückfragenblock oben rechts, Name und Funktion unter dem Gruß. */
export interface Unterzeichner {
  /** Anmelde-E-Mail; sie steht zugleich im Rückfragenblock. */
  email: string;
  /** Rückfragenblock, in der Form der Briefvorlage („Herr …, M. Sc.“) */
  kontaktname: string;
  /** Unter dem Gruß */
  unterschrift: string;
  funktion: string;
  telefon: string;
}

/** Zeile aus `briefunterzeichner` (seit 02.11.2026; bis dahin fest in company.ts) */
export interface UnterzeichnerEintrag extends Unterzeichner {
  id: string;
}

export type UnterzeichnerFehler = Partial<Record<keyof Unterzeichner, string>>;

/**
 * Wie die Prüfung in der Tabelle: genau ein @ und ein Punkt im Domainteil, keine Leerzeichen. U+0085 zählt in
 * Postgres zu [[:space:]], in JavaScript nicht zu \s (QA 02.11.2026).
 */
const EMAIL_FORM = /^[^@\s\u0085]+@[^@\s\u0085]+\.[^@\s\u0085]+$/;

/** Der Unterzeichner zur Anmeldung; null für Konten, die nicht unterzeichnen (Buchhaltung, Entwicklung) — dann wird gewählt. */
export function unterzeichnerZurAnmeldung<T extends Unterzeichner>(liste: readonly T[], email: string | null | undefined): T | null {
  const gesucht = email?.trim().toLowerCase();
  if (!gesucht) return null;
  return liste.find((u) => u.email === gesucht) ?? null;
}

/**
 * Vorschlag für den Namen unter dem Gruß aus dem Namen im Rückfragenblock, wie in der Briefvorlage:
 * „Herr Ayhan Yeyrek, M. Sc.“ wird „Ayhan Yeyrek (M. Sc.)“.
 */
export function unterschriftAusKontaktname(kontaktname: string): string {
  const ohneAnrede = kontaktname.trim().replace(/^(Herrn?|Frau)\s+/, '');
  const komma = ohneAnrede.indexOf(',');
  if (komma < 0) return ohneAnrede;
  const name = ohneAnrede.slice(0, komma).trim();
  const titel = ohneAnrede.slice(komma + 1).trim();
  return titel ? `${name} (${titel})` : name;
}

/**
 * Prüft die Eingabe aus dem Formular und bringt sie in die Form der Tabelle (getrimmt, E-Mail klein).
 * `eigeneId` nimmt beim Ändern den eigenen Eintrag von der Doppelprüfung aus.
 */
export function unterzeichnerPruefen(
  eingabe: Unterzeichner,
  vorhandene: readonly UnterzeichnerEintrag[],
  eigeneId?: string,
): { daten: Unterzeichner | null; fehler: UnterzeichnerFehler } {
  const daten: Unterzeichner = {
    email: eingabe.email.trim().toLowerCase(),
    kontaktname: eingabe.kontaktname.trim(),
    unterschrift: eingabe.unterschrift.trim(),
    funktion: eingabe.funktion.trim(),
    telefon: eingabe.telefon.trim(),
  };
  const fehler: UnterzeichnerFehler = {};
  for (const feld of ['kontaktname', 'unterschrift', 'funktion', 'telefon', 'email'] as const) {
    if (!daten[feld]) fehler[feld] = 'Bitte ausfüllen.';
  }
  if (daten.email && !EMAIL_FORM.test(daten.email)) {
    fehler.email = 'Bitte eine gültige E-Mail-Adresse eingeben.';
  } else if (daten.email && vorhandene.some((u) => u.email === daten.email && u.id !== eigeneId)) {
    fehler.email = 'Diese E-Mail ist schon eingetragen.';
  }
  return { daten: Object.keys(fehler).length ? null : daten, fehler };
}
