/**
 * Wer für den Vermieter unterschreibt.
 *
 * Kundenwunsch vom 03.11.2026: „Wer legt diesen Mietvertrag an, damit wir nicht
 * beide Namen haben … wegen der Unterschrift am Ende.“ Jeder Geschäftsführer
 * darf allein unterschreiben (Auskunft des Kunden am 03.11.2026, in den
 * Stammdaten seitdem Einzelvertretung). Bei Einzelvertretung mit mehreren
 * Vertretern steht deshalb nur der gewählte im Rubrum und unter der
 * Unterschriftslinie. Bei Gesamtvertretung zeichnen weiter alle gemeinsam.
 */
import type { MietvertragDaten, VermieterDaten } from './typen';

/** Die Vertreter aus den Stammdaten ohne Leereinträge (der Dialog trennt Eingaben am Komma). */
export function vertreterListe(v: VermieterDaten): string[] {
  return v.vertretenDurch.map(n => n.trim()).filter(Boolean);
}

/** Muss gewählt werden, wer unterschreibt? Nur bei Einzelvertretung mit mehreren Vertretern. */
export function brauchtUnterzeichnerWahl(v: VermieterDaten): boolean {
  return v.vertretungArt === 'einzel' && vertreterListe(v).length > 1;
}

/** Die gewählte Person, solange sie noch in den Stammdaten steht — sonst null. */
export function gewaehlterUnterzeichner(d: Pick<MietvertragDaten, 'vermieter' | 'unterzeichnerVermieter'>): string | null {
  const name = d.unterzeichnerVermieter?.trim();
  return name && vertreterListe(d.vermieter).includes(name) ? name : null;
}

/**
 * Wer im Rubrum steht und wie viele Unterschriftslinien die Vermieterseite
 * braucht. Ohne gültige Wahl stehen bei Einzelvertretung alle Vertreter im
 * Rubrum — die Pflichtprüfung sperrt das PDF dann ohnehin.
 */
export function vermieterVertretung(d: Pick<MietvertragDaten, 'vermieter' | 'unterzeichnerVermieter'>): {
  namen: string[];
  gemeinsam: boolean;
  linien: number;
} {
  const alle = vertreterListe(d.vermieter);
  if (d.vermieter.vertretungArt === 'gesamt') {
    return { namen: alle, gemeinsam: true, linien: alle.length || 1 };
  }
  const gewaehlt = gewaehlterUnterzeichner(d);
  return { namen: gewaehlt ? [gewaehlt] : alle, gemeinsam: false, linien: 1 };
}

/** Nachname ohne Titel in Klammern oder nach Komma: „Ayhan Yeyrek (M. Sc.)“ → „yeyrek“. */
function nachname(name: string): string {
  const ohneTitel = name.replace(/\(.*?\)/g, '').split(',')[0].trim();
  const teile = ohneTitel.split(/\s+/).filter(Boolean);
  return (teile[teile.length - 1] ?? '').toLowerCase();
}

/**
 * Vorschlag aus der Anmeldung: der Vertreter, dessen Nachname zum
 * Briefunterzeichner der angemeldeten E-Mail passt. Verglichen wird nur der
 * Nachname, weil die Schreibweisen auseinandergehen (live 03.11.2026:
 * „Denis“ in den Vermieterstammdaten, „Dennis“ bei den Briefunterzeichnern).
 * Passt keiner oder mehr als einer, gibt es keinen Vorschlag — dann wird gewählt.
 */
export function unterzeichnerVorschlag(
  vertretenDurch: readonly string[],
  briefunterzeichner: readonly { email: string; unterschrift: string; kontaktname: string }[],
  email: string | null | undefined,
): string | null {
  const gesucht = email?.trim().toLowerCase();
  if (!gesucht) return null;
  const eintrag = briefunterzeichner.find(u => u.email?.trim().toLowerCase() === gesucht);
  if (!eintrag) return null;
  const name = nachname(eintrag.unterschrift) || nachname(eintrag.kontaktname.replace(/^(Herrn?|Frau)\s+/, ''));
  if (!name) return null;
  const treffer = vertretenDurch.map(v => v.trim()).filter(v => v && nachname(v) === name);
  return treffer.length === 1 ? treffer[0] : null;
}

/**
 * Name und akademischer Titel eines Vertreters. Der Titel steht in den
 * Vermieter-Stammdaten in Klammern hinter dem Namen, etwa „Ayhan Yeyrek (M. Sc.)“
 * (Kundenwunsch 04.11.2026: unter der Unterschrift Name und darunter der Titel).
 * Im Rubrum steht nur der Name, wie in der Vorlage.
 */
export function vertreterTeile(eintrag: string): { name: string; titel: string | null } {
  const treffer = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(eintrag.trim());
  if (!treffer || !treffer[1].trim()) return { name: eintrag.trim(), titel: null };
  return { name: treffer[1].trim(), titel: treffer[2].trim() || null };
}
