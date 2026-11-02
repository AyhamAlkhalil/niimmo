import { useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import { useBriefunterzeichner } from "./useBriefunterzeichner";
import { unterzeichnerZurAnmeldung, type UnterzeichnerEintrag } from "@/utils/unterzeichner";

/**
 * Wer ein Schreiben unterzeichnet (Mahnung seit 30.10.2026, Kündigung, Bestätigung und Mieterhöhung seit
 * 31.10.2026; Kundenwunsch: „immer der, der eingeloggt ist — oder man soll es auswählen können“). Seit 02.11.2026
 * aus der Tabelle `briefunterzeichner`, in die sich weitere Personen selbst eintragen.
 *
 * Bei jedem Öffnen vorbelegt mit dem Angemeldeten — auch wenn die Liste erst nach dem Öffnen geladen ist: Bis zur
 * ersten eigenen Wahl gilt der Vorschlag. Konten, die nicht eingetragen sind (Buchhaltung, Entwicklung), bekommen
 * keinen Vorschlag: Ohne Wahl ist `unterzeichner` null, und die Dialoge erzeugen kein Schreiben — es soll nie still
 * jemand anderes unterzeichnen.
 */
export function useUnterzeichnerWahl(isOpen: boolean): {
  /** Zeile aus der Tabelle, über die Renders hinweg dasselbe Objekt (Abhängigkeit der Vorschau) */
  unterzeichner: UnterzeichnerEintrag | null;
  unterzeichnerId: string;
  setUnterzeichnerId: (id: string) => void;
} {
  const { user } = useAuth();
  const { eintraege } = useBriefunterzeichner();
  // null = noch nicht selbst gewählt, dann gilt der Vorschlag zur Anmeldung
  const [gewaehlteId, setGewaehlteId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) setGewaehlteId(null);
  }, [isOpen]);

  const unterzeichnerId = gewaehlteId ?? unterzeichnerZurAnmeldung(eintraege, user?.email)?.id ?? "";
  const unterzeichner = eintraege.find((u) => u.id === unterzeichnerId) ?? null;
  return { unterzeichner, unterzeichnerId, setUnterzeichnerId: setGewaehlteId };
}
