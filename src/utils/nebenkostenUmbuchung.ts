/**
 * Sperre gegen das Umbuchen einer Zahlung, die schon Kostenpositionen trägt.
 *
 * Bis zum 28.10.2026 gab es diese Prüfung nur im Dialog „Auf anderes Objekt
 * buchen“ (ZahlungObjektWechselDialog). Der Nebenkosten-Arbeitsplatz
 * (zuordnen, aufheben, „Als Nichtmiete“) und der Kategorie-Editor schrieben
 * ungeprüft: Die Kostenpositionen blieben am alten Objekt, im neuen erschien die
 * Zahlung als unverteilt — der Betrag wurde doppelt umgelegt. Die Datenbank
 * setzt dieselbe Regel seit diesem Tag per Trigger durch
 * (Migration 20261028120100_zahlung_umbuchung_sperre.sql); hier steht sie für
 * eine frühe, verständliche Meldung in der Oberfläche.
 */

/**
 * Kategorien, unter denen eine Ausgabe Kostenpositionen tragen darf. Neben
 * Nebenkosten auch Nichtmiete: Am 28.10.2026 hingen live 35 Kostenpositionen an
 * Nichtmiete-Ausgaben (Grundsteuer, Abschläge), und Schritt 1 lässt Nichtmiete-
 * Ausgaben bewusst zu. Ein Wechsel zwischen beiden ändert an der Abrechnung nichts.
 */
export const KATEGORIEN_MIT_KOSTENPOSITIONEN: readonly string[] = ["Nebenkosten", "Nichtmiete"];

/**
 * Zulässige Kategorien je Vorzeichen. Eine Gutschrift (Eingang) gilt in Schritt 1
 * nur unter Nebenkosten als zuordenbar (istGutschrift). Unter Nichtmiete bliebe
 * ihre negative Position in der Abrechnung, die Zahlung verschwände aber aus
 * Schritt 1 und ließe sich nicht mehr entkoppeln (Review 28.10.2026).
 */
export function erlaubteKategorienMitKostenpositionen(zahlungBetrag: number): readonly string[] {
  return zahlungBetrag > 0 ? ["Nebenkosten"] : KATEGORIEN_MIT_KOSTENPOSITIONEN;
}

export interface UmbuchungsAenderung {
  /** Neues Objekt; `undefined`, wenn die Spalte nicht geschrieben wird. */
  immobilieId?: string | null;
  /** Neue Kategorie; `undefined`, wenn die Spalte nicht geschrieben wird. */
  kategorie?: string | null;
  /** Neuer Betrag; `undefined`, wenn die Spalte nicht geschrieben wird. */
  betrag?: number;
}

/**
 * Grund, warum die Änderung nicht geschrieben werden darf, sonst null.
 *
 * Gesperrt wird nur, was die Abrechnung verfälscht: ein anderes Objekt als das
 * der Kostenpositionen, eine Kategorie, unter der die Zahlung keine
 * Betriebskosten mehr ist (bei einer Gutschrift alles außer Nebenkosten), oder
 * ein anderer Betrag — die Positionen tragen den Betrag der Zahlung. Dasselbe
 * Objekt noch einmal zu wählen ist harmlos.
 *
 * `zahlungBetrag` ist der gespeicherte Betrag der Zahlung (Vorzeichen der Bank).
 */
export function umbuchungSperrgrund(
  kostenpositionen: readonly { immobilie_id: string | null }[],
  aenderung: UmbuchungsAenderung,
  zahlungBetrag: number
): string | null {
  const anzahl = kostenpositionen.length;
  if (anzahl === 0) return null;
  const zuordnung =
    `Die Zahlung ist in der Betriebskostenabrechnung ${anzahl === 1 ? "einer Kostenposition" : `${anzahl} Kostenpositionen`} zugeordnet.`;
  const abhilfe =
    "Bitte die Zuordnung zuerst im Objekt unter Nebenkosten, Schritt 1, entfernen — sonst würde der Betrag doppelt umgelegt.";

  if (
    aenderung.immobilieId !== undefined &&
    kostenpositionen.some((kp) => kp.immobilie_id !== aenderung.immobilieId)
  ) {
    return `${zuordnung} Der Objektbezug lässt sich deshalb nicht ändern. ${abhilfe}`;
  }
  if (aenderung.betrag !== undefined && aenderung.betrag !== zahlungBetrag) {
    return `${zuordnung} Der Betrag lässt sich deshalb nicht ändern. ${abhilfe}`;
  }
  const betragNachher = aenderung.betrag ?? zahlungBetrag;
  if (
    aenderung.kategorie !== undefined &&
    !erlaubteKategorienMitKostenpositionen(betragNachher).includes(aenderung.kategorie ?? "")
  ) {
    const gutschrift = betragNachher > 0 ? " Eine Gutschrift bleibt unter Nebenkosten." : "";
    return `${zuordnung} Die Kategorie „${aenderung.kategorie ?? "ohne"}“ ist deshalb nicht möglich.${gutschrift} ${abhilfe}`;
  }
  return null;
}

/**
 * Grund, warum Zahlungen nicht gelöscht werden dürfen, sonst null.
 *
 * Aufteilen und Aufheben (PaymentSplitModal) legen neue Zeilen an und löschen die
 * alte. Bis zum 28.10.2026 setzte das Löschen kostenpositionen.zahlung_id per
 * ON DELETE SET NULL auf NULL: Die Umlage blieb ohne Zahlung stehen, die neuen
 * Teilzahlungen erschienen in Schritt 1 als unverteilt. Die Datenbank sperrt das
 * seit diesem Tag per Trigger (zahlung_loeschen_pruefen, gleicher Meldungsanfang);
 * hier steht die Regel für eine Meldung, bevor überhaupt etwas geschrieben wird.
 * `anzahlKostenpositionen` zählt die Positionen aller zu löschenden Zahlungen.
 */
export function loeschSperrgrund(anzahlKostenpositionen: number): string | null {
  if (!(anzahlKostenpositionen > 0)) return null;
  const zuordnung = `Die Zahlung ist in der Betriebskostenabrechnung ${
    anzahlKostenpositionen === 1 ? "einer Kostenposition" : `${anzahlKostenpositionen} Kostenpositionen`
  } zugeordnet.`;
  return `${zuordnung} Sie lässt sich deshalb weder löschen noch aufteilen. Bitte die Zuordnung zuerst im Objekt unter Nebenkosten, Schritt 1, entfernen — sonst würde der Betrag doppelt umgelegt.`;
}

/** Fehler mit fachlicher Meldung, die so in der Oberfläche erscheinen darf. */
export class UmbuchungGesperrtFehler extends Error {
  constructor(meldung: string) {
    super(meldung);
    this.name = "UmbuchungGesperrtFehler";
  }
}

/**
 * Fachliche Meldung zu einem Fehler beim Umbuchen, sonst null. Erkennt die
 * eigene Sperre und die Ablehnung durch den Datenbank-Trigger (SQLSTATE P0001
 * aus `raise exception`), deren Text fest und fachlich formuliert ist.
 */
export function umbuchungSperrMeldung(fehler: unknown): string | null {
  if (fehler instanceof UmbuchungGesperrtFehler) return fehler.message;
  if (fehler && typeof fehler === "object") {
    const { code, message } = fehler as { code?: unknown; message?: unknown };
    if (code === "P0001" && typeof message === "string" && message.startsWith("Die Zahlung ist")) {
      return message;
    }
  }
  return null;
}
