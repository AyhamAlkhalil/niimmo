import * as React from "react"

import { cn } from "@/lib/utils"
import { normalisiereDezimalEingabe } from "@/utils/decimalInput"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onChange, inputMode, ...props }, ref) => {
    // <input type="number"> verliert oder verfälscht Eingaben mit Dezimalkomma:
    // getippt wird das Komma verworfen ("128,456" → 128456), eingefügt landet gar
    // nichts im Feld. Beides passiert ohne Fehlermeldung. Numerische Felder werden
    // daher als Text erfasst und das Komma direkt im Feld zum Punkt normalisiert,
    // damit e.target.value für alle Aufrufer eine gültige Zahl bleibt.
    const istZahlenfeld = type === "number"

    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const el = event.target
        const roh = el.value
        const bereinigt = normalisiereDezimalEingabe(roh)

        if (bereinigt !== roh) {
          const cursor = el.selectionStart
          el.value = bereinigt
          // Cursor an Ort und Stelle lassen, statt ans Ende zu springen
          if (cursor !== null) {
            const versatz = roh.length - bereinigt.length
            const neu = Math.max(0, cursor - versatz)
            el.setSelectionRange(neu, neu)
          }
        }

        onChange?.(event)
      },
      [onChange]
    )

    return (
      <input
        type={istZahlenfeld ? "text" : type}
        inputMode={istZahlenfeld ? inputMode ?? "decimal" : inputMode}
        onChange={istZahlenfeld ? handleChange : onChange}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-feld ring-offset-background transition-[border-color,box-shadow] duration-200 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-neutral-400 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/10 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
