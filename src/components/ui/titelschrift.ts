/**
 * Titel in Dialogen, Seitenleisten und Schubladen (26.10.2026).
 *
 * Die Titelschrift (Instrument Serif, nur ein Schnitt) wirkt erst ab etwa 20 px; darunter
 * ist sie zu zart. Gibt der Aufrufer eine kleine Größe vor (text-xs bis text-lg), bleibt
 * der Titel deshalb in Inter, halbfett. Ohne Größe oder ab text-xl steht er in der Titelschrift.
 */
// Beliebig viele Präfixe (sm:, 2xl:, md:hover:, data-[state=open]:), wahlweise mit ! und /Zeilenhöhe
const KLEINE_GROESSE = /(^|\s)(?:[^\s:]+:)*!?text-(xs|sm|base|lg)(?:\/\S+)?(\s|$)/

export function titelKlassen(className: string | undefined, gross = "text-2xl"): string {
  return KLEINE_GROESSE.test(className ?? "")
    ? "font-semibold leading-snug tracking-[-0.01em] text-foreground"
    : `font-display ${gross} leading-tight tracking-[-0.01em] text-foreground`
}
