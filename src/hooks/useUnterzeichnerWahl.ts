import { useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import { COMPANY, unterzeichnerZurAnmeldung, type Unterzeichner } from "@/config/company";

/**
 * Wer ein Schreiben unterzeichnet (Mahnung seit 30.10.2026, Kündigung, Bestätigung und Mieterhöhung seit
 * 31.10.2026; Kundenwunsch: „immer der, der eingeloggt ist — oder man soll es auswählen können“).
 *
 * Bei jedem Öffnen vorbelegt mit dem Angemeldeten. Konten, die nicht unterzeichnen (Buchhaltung, Entwicklung),
 * bekommen keinen Vorschlag: Ohne Wahl ist `unterzeichner` null, und die Dialoge erzeugen kein Schreiben — es soll
 * nie still jemand anderes unterzeichnen.
 */
export function useUnterzeichnerWahl(isOpen: boolean): {
  unterzeichner: Unterzeichner | null;
  unterzeichnerEmail: string;
  setUnterzeichnerEmail: (email: string) => void;
} {
  const { user } = useAuth();
  const [unterzeichnerEmail, setUnterzeichnerEmail] = useState("");

  useEffect(() => {
    if (isOpen) setUnterzeichnerEmail(unterzeichnerZurAnmeldung(user?.email)?.email ?? "");
  }, [isOpen, user?.email]);

  const unterzeichner = COMPANY.unterzeichner.find((u) => u.email === unterzeichnerEmail) ?? null;
  return { unterzeichner, unterzeichnerEmail, setUnterzeichnerEmail };
}
