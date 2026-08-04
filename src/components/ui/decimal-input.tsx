import * as React from "react"

import { Input } from "@/components/ui/input"

interface DecimalInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
  value: number | null | undefined
  onValueChange: (wert: number | null) => void
}

/**
 * Zahlenfeld für Formulare, die ihren Wert als `number` halten.
 *
 * Ein `<Input value={zahl} onChange={e => setZahl(parseFloat(e.target.value))} />`
 * lässt keine Nachkommastellen zu: sobald der Dezimaltrenner getippt ist, ergibt
 * `parseFloat("12.")` den Wert 12, React rendert daraufhin "12" ins Feld und
 * räumt den gerade getippten Trenner wieder weg.
 *
 * Diese Komponente hält deshalb den Rohtext lokal und meldet nach außen nur die
 * fertige Zahl. Für Felder mit String-State genügt weiterhin `Input` — dort ist
 * die Komma-Normalisierung bereits eingebaut.
 */
export const DecimalInput = React.forwardRef<HTMLInputElement, DecimalInputProps>(
  ({ value, onValueChange, ...props }, ref) => {
    const [text, setText] = React.useState(() => (value ?? "").toString())

    React.useEffect(() => {
      const vonAussen = value ?? null
      const geparst = text.trim() === "" ? NaN : parseFloat(text)
      const textMeint = Number.isFinite(geparst) ? geparst : null

      // Der Text steht bereits für diesen Wert — auch der Zwischenstand "12."
      // meint 12. Nicht anfassen, sonst verschwindet der gerade getippte Trenner.
      if (textMeint === vonAussen) return

      // Feld leer, außen steht 0: die Aufrufer verrechnen unser null zu 0.
      // Das Feld bleibt leer, damit ein Neubeginn nicht mit einer 0 startet.
      if (textMeint === null && vonAussen === 0) return

      setText(vonAussen === null ? "" : String(vonAussen))
    }, [value, text])

    return (
      <Input
        {...props}
        ref={ref}
        type="number"
        value={text}
        onChange={(event) => {
          // Input hat das Komma bereits zum Punkt normalisiert
          const roh = event.target.value
          setText(roh)
          const zahl = parseFloat(roh)
          onValueChange(roh === "" || !Number.isFinite(zahl) ? null : zahl)
        }}
      />
    )
  }
)
DecimalInput.displayName = "DecimalInput"
