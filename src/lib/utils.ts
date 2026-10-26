import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Eigene Werte aus tailwind.config.ts bekanntmachen: Ohne das hielte tailwind-merge
// `shadow-card` für eine Schattenfarbe, und ein `shadow-none` am Aufrufer würde den
// Kartenschatten nicht ersetzen (26.10.2026)
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: [{ shadow: ["card", "card-hover", "popover", "dialog", "knopf", "feld"] }],
      ease: [{ ease: ["sanft"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
