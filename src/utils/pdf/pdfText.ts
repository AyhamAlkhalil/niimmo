/**
 * Text für jsPDF mit den Standardschriften (Helvetica, Zeichensatz WinAnsi/CP1252).
 *
 * Zeichen außerhalb davon druckt jsPDF als Zeichensalat und sperrt dabei die
 * ganze Zeile: Im Übergabeprotokoll wurde „−2 cm“ zu „"2 cm“, „≥“ zu „"e“ und ein
 * Emoji vom Handy zu „Ø=Þ“ — im Mängelteil eines unterschriebenen Dokuments
 * (23.10.2026). Gängige Zeichen werden deshalb ersetzt, Buchstaben mit fremden
 * Akzenten auf ihren Grundbuchstaben gebracht (Ş → S, ř → r), Emojis entfernt;
 * was dann noch übrig ist, wird „?“.
 */

/** Die Zeichen von CP1252 jenseits von Latin-1 */
const CP1252_ZUSATZ = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

const ERSATZ: Record<string, string> = {
  "−": "-", // Minuszeichen
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "―": "—",
  "≥": ">=",
  "≤": "<=",
  "≠": "!=",
  "≈": "~",
  "→": "->",
  "←": "<-",
  "↔": "<->",
  "⇒": "=>",
  "✓": "x",
  "✔": "x",
  "✗": "x",
  "✘": "x",
  "ı": "i",
  "Ł": "L",
  "ł": "l",
  "Đ": "D",
  "đ": "d",
  "Ħ": "H",
  "ħ": "h",
  " ": " ",
  " ": " ",
  " ": " ",
  "​": "",
  "‌": "",
  "‍": "",
  "️": "",
  "﻿": "",
};

function druckbar(zeichen: string): boolean {
  const c = zeichen.codePointAt(0) ?? 0;
  return zeichen === "\n" || zeichen === "\t" || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_ZUSATZ.includes(zeichen);
}

/** Teile von Emojis, die nicht als Bildzeichen gelten: Flaggen-Buchstaben, Tag-Zeichen, Varianten, Tastenkappe */
function emojiTeil(code: number): boolean {
  return (
    (code >= 0x1f1e6 && code <= 0x1f1ff) || (code >= 0xe0000 && code <= 0xe007f) || (code >= 0xfe00 && code <= 0xfe0f) || code === 0x20e3
  );
}

export function pdfText(text: string | null | undefined): string {
  let ergebnis = "";
  // Zeilenenden aus eingefügtem Text (Windows, alte Macs, Unicode) werden \n
  const einheitlich = (text ?? "").replace(/\r\n?|[\u2028\u2029\u0085]/g, "\n").normalize("NFC");
  for (const zeichen of einheitlich) {
    const code = zeichen.codePointAt(0) ?? 0;
    if (druckbar(zeichen)) ergebnis += zeichen;
    // Übrige Steuerzeichen haben im Druck nichts verloren
    else if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue;
    else if (emojiTeil(code)) continue;
    else if (zeichen in ERSATZ) ergebnis += ERSATZ[zeichen];
    else {
      const grund = zeichen.normalize("NFKD").replace(/\p{M}/gu, "");
      if (grund && [...grund].every(druckbar)) ergebnis += grund;
      else if (!/\p{Extended_Pictographic}|\p{M}|\p{Emoji_Modifier}/u.test(zeichen)) ergebnis += "?";
    }
  }
  return ergebnis;
}
