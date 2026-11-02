import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useBriefunterzeichner } from "@/hooks/useBriefunterzeichner";
import { unterzeichnerZurAnmeldung, type UnterzeichnerEintrag } from "@/utils/unterzeichner";
import { UnterzeichnerFormular } from "./UnterzeichnerFormular";

interface UnterzeichnerAuswahlProps {
  /** Kennung des Unterzeichners, leer ohne Wahl */
  wert: string;
  onChange: (id: string) => void;
  /** Höhe des Auswahlfelds passend zu den übrigen Feldern des Dialogs */
  className?: string;
}

/** Steht nie als Kennung in der Tabelle (uuid) */
const NEU = "__neu";

/**
 * Auswahl für Rückfragenblock und Unterschrift; Vorbelegung und Sperre in useUnterzeichnerWahl. Seit 02.11.2026 mit
 * „Weitere Person eintragen …“ und „Angaben ändern“ direkt hier.
 */
export function UnterzeichnerAuswahl({ wert, onChange, className = "mt-1 h-9" }: UnterzeichnerAuswahlProps) {
  const { user } = useAuth();
  const { eintraege, isLoading, isError } = useBriefunterzeichner();
  const [formularOffen, setFormularOffen] = useState(false);
  // null = neue Person; bleibt beim Schließen stehen, sonst wechselt der Titel während der Ausblendung
  const [formularEintrag, setFormularEintrag] = useState<UnterzeichnerEintrag | null>(null);
  const formularAuf = (eintrag: UnterzeichnerEintrag | null) => {
    setFormularEintrag(eintrag);
    setFormularOffen(true);
  };
  // Scheitert nur das Neuladen, bleibt die geladene Liste wählbar
  const ladefehler = isError && eintraege.length === 0;
  const gewaehlt = eintraege.find((u) => u.id === wert) ?? null;
  const angemeldetFehlt = !isLoading && !ladefehler && !unterzeichnerZurAnmeldung(eintraege, user?.email);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">Rückfragen und Unterschrift</Label>
        {gewaehlt && (
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => formularAuf(gewaehlt)}>
            Angaben ändern
          </button>
        )}
      </div>
      <Select value={wert} onValueChange={(v) => (v === NEU ? formularAuf(null) : onChange(v))} disabled={isLoading || ladefehler}>
        <SelectTrigger className={className}>
          <SelectValue placeholder={isLoading ? "Wird geladen …" : "Bitte wählen"} />
        </SelectTrigger>
        <SelectContent>
          {eintraege.map((u) => (
            <SelectItem key={u.id} value={u.id}>{u.unterschrift} – {u.funktion}</SelectItem>
          ))}
          {eintraege.length > 0 && <SelectSeparator />}
          <SelectItem value={NEU}>Weitere Person eintragen …</SelectItem>
        </SelectContent>
      </Select>
      {ladefehler ? (
        <p className="text-xs text-destructive mt-1" role="alert">Die Unterzeichner konnten nicht geladen werden.</p>
      ) : !isLoading && !gewaehlt ? (
        <p className="text-xs text-destructive mt-1" role="alert">
          Bitte wählen, wer das Schreiben unterzeichnet.
          {angemeldetFehlt && " Wer selbst unterzeichnen will, trägt sich über „Weitere Person eintragen …“ ein."}
        </p>
      ) : null}
      <UnterzeichnerFormular
        offen={formularOffen}
        eintrag={formularEintrag}
        vorschlagEmail={angemeldetFehlt ? user?.email ?? "" : ""}
        onClose={() => setFormularOffen(false)}
        onGespeichert={onChange}
        onEntfernt={(id) => { if (id === wert) onChange(""); }}
      />
    </div>
  );
}
