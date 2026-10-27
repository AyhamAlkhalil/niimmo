/**
 * Titel in Dialogen, Seitenleisten und Schubladen (26.10.2026, seit 27.10.2026 in Jost).
 *
 * Große Titel stehen im ruhigen Titelschnitt (font-display: normales Gewicht, eng gesetzt).
 * Gibt der Aufrufer eine kleine Größe vor (text-xs bis text-lg), wirkt dieser Schnitt zu
 * zart; der Titel wird dann mittelkräftig gesetzt.
 */
// Beliebig viele Präfixe (sm:, 2xl:, md:hover:, data-[state=open]:), wahlweise mit ! und /Zeilenhöhe
const KLEINE_GROESSE = /(^|\s)(?:[^\s:]+:)*!?text-(xs|sm|base|lg)(?:\/\S+)?(\s|$)/

export function titelKlassen(className: string | undefined, gross = "text-2xl"): string {
  return KLEINE_GROESSE.test(className ?? "")
    ? "font-medium leading-snug text-foreground"
    : `font-display ${gross} leading-tight text-foreground`
}
