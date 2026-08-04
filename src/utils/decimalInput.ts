/**
 * Eingabe von Dezimalzahlen in Formularfeldern.
 *
 * `<input type="number">` verträgt kein Dezimalkomma — und versagt dabei auf zwei
 * Arten, beide lautlos (in Chrome 147 gemessen):
 *
 * | Eingabeweg        | `el.value` bei "128,456"                     |
 * |-------------------|----------------------------------------------|
 * | getippt           | `"128456"` — Komma verworfen, Faktor 1000 zu groß |
 * | eingefügt         | `""` — Wert komplett weg                     |
 * | programmatisch    | `""` — Wert komplett weg                     |
 *
 * Auf deutscher Tastatur ist das Komma der naheliegende Dezimaltrenner, und auf
 * Mobilgeräten liegt es direkt auf der Zifferntastatur. Betroffen war real ein
 * Übergabeprotokoll, in dem die Wasserzählerstände fehlten.
 *
 * Deshalb erfasst `Input` numerische Felder als Text und normalisiert die Eingabe
 * mit dieser Funktion direkt im Feld. Aufrufer bekommen über `e.target.value`
 * weiterhin eine Zeichenkette, die `parseFloat` korrekt liest.
 */

/**
 * "128,456" → "128.456", "1.234,56" → "1234.56", "-45,5" → "-45.5", "128," → "128."
 *
 * Regeln:
 * - Ein führendes Minus bleibt erhalten (Rücklastschriften und Korrekturbuchungen
 *   sind negativ — rund 43 % der Bankbewegungen in diesem Portfolio).
 * - Ist ein Komma vorhanden, gilt es als Dezimaltrenner; Punkte davor sind
 *   Tausendertrenner und entfallen. Sonst würde aus 1.234,56 € der Betrag 1,23456.
 * - Ohne Komma zählt ein einzelner Punkt als Dezimaltrenner (unverändertes
 *   Verhalten). Ab zwei Punkten kann es kein Dezimaltrenner mehr sein, also
 *   werden sie als Tausendertrenner entfernt.
 * - Ein nachlaufender Trenner bleibt stehen, damit die Eingabe beim Tippen
 *   nicht abbricht.
 */
export const normalisiereDezimalEingabe = (roh: string): string => {
  const negativ = roh.trimStart().startsWith("-");
  const ziffernUndTrenner = roh.replace(/[^\d.,]/g, "");

  let kern: string;
  if (ziffernUndTrenner.includes(",")) {
    const erstesKomma = ziffernUndTrenner.indexOf(",");
    const vorKomma = ziffernUndTrenner.slice(0, erstesKomma).replace(/\./g, "");
    const nachKomma = ziffernUndTrenner.slice(erstesKomma + 1).replace(/[.,]/g, "");
    kern = `${vorKomma}.${nachKomma}`;
  } else if ((ziffernUndTrenner.match(/\./g) ?? []).length > 1) {
    kern = ziffernUndTrenner.replace(/\./g, "");
  } else {
    kern = ziffernUndTrenner;
  }

  return negativ ? `-${kern}` : kern;
};
