/**
 * Erfassung von Zählerständen.
 *
 * Zählerstände dürfen NICHT über <input type="number"> erfasst werden: gibt
 * jemand auf einer deutschen Tastatur ein Komma ein ("128,456"), gilt der Wert
 * für den Browser als ungültig. Das Feld zeigt die Eingabe weiterhin an,
 * `event.target.value` liefert aber "". Der Wert verschwindet also lautlos —
 * genau das ist am 03.08.2026 mit den Wasserzählerständen eines
 * Übergabeprotokolls passiert.
 *
 * Stattdessen: <input type="text" inputMode="decimal"> plus diese Helfer.
 *
 * Leitregel: lieber `null` und ein sichtbarer Hinweis als ein stillschweigend
 * halb geratener Wert. `parseFloat` allein genügt dafür nicht — es schneidet
 * mehrdeutige Eingaben ab ("12.345.678" → 12.345) und liefert eine plausible,
 * aber um Faktor 1000 falsche Zahl zurück.
 */

/** Lässt nur Ziffern sowie Komma und Punkt durch; das Komma bleibt für die Anzeige erhalten. */
export const sanitizeZaehlerstand = (raw: string): string => raw.replace(/[^\d.,]/g, "");

/**
 * "128,456" → 128.456, "1.234,5" → 1234.5, "3242" → 3242, "128," → 128.
 *
 * Ist ein Komma vorhanden, gilt es als Dezimaltrenner und Punkte davor als
 * Tausendertrenner. Ohne Komma wird ein einzelner Punkt als Dezimaltrenner
 * gelesen. Mehrdeutige Eingaben ("12,34,5", "12.345.678") ergeben `null`,
 * damit sie im Formular als ungültig auffallen statt falsch gespeichert zu
 * werden.
 */
/** Ganzzahl mit optionalen Tausenderpunkten, dann Komma und Nachkommastellen: "1.234,5" */
const MIT_DEZIMALKOMMA = /^\d+(\.\d{3})*,\d+$/;
/** Ganzzahl mit optionalem Punkt als Dezimaltrenner: "128.456", "3242" */
const OHNE_DEZIMALKOMMA = /^\d+(\.\d+)?$/;

export const parseZaehlerstand = (value: string | null | undefined): number | null => {
  const text = (value ?? "").trim();
  if (!text) return null;

  // Ein nachlaufendes Trennzeichen ist eine unfertige, aber eindeutige Eingabe
  const eingabe = text.replace(/[.,]$/, "");
  if (!eingabe) return null;

  // Die Struktur wird vor dem Umwandeln geprüft: parseFloat würde eine
  // mehrdeutige Eingabe stumm abschneiden ("12.345.678" → 12.345).
  if (eingabe.includes(",")) {
    if (!MIT_DEZIMALKOMMA.test(eingabe)) return null;
  } else if (!OHNE_DEZIMALKOMMA.test(eingabe)) {
    return null;
  }

  const normalized = eingabe.includes(",")
    ? eingabe.replace(/\./g, "").replace(",", ".")
    : eingabe;

  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Für die Feldvalidierung: ein leeres Feld ist zulässig (nicht erfasst),
 * eine nicht interpretierbare Eingabe nicht.
 */
export const istGueltigeZaehlerstandEingabe = (value: string | null | undefined): boolean => {
  const text = (value ?? "").trim();
  if (!text) return true;
  return parseZaehlerstand(text) !== null;
};
