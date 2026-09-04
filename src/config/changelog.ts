/**
 * Release-Historie für die NiImmo-Verwaltung.
 *
 * Diese Datei ist die einzige Quelle für den "Was ist neu"-Dialog. Sie liegt
 * bewusst im Code und nicht in der Datenbank: So beschreibt der Changelog immer
 * genau den Stand, der auch tatsächlich ausgeliefert ist. Ein Changelog in der
 * DB könnte Änderungen ankündigen, die noch gar nicht deployt sind.
 *
 * PFLEGE: Bei jedem Release oben einen Eintrag ergänzen und die `version` in
 * package.json auf denselben Wert setzen. Die Einträge richten sich an die
 * Verwaltung, nicht an Entwickler — also fachlich formulieren: was kann man
 * jetzt, was ging vorher schief. Keine Dateinamen, keine Funktionsnamen.
 *
 * Die Liste beginnt bewusst mit dem Stand vom 3. September 2026. Was davor lag,
 * war nachträglich aus der Entwicklungshistorie zusammengetragen und für die
 * Verwaltung ohne Wert — es hat die Übersicht nur lang gemacht.
 */

export type AenderungsArt = "neu" | "verbessert" | "behoben";

export interface Aenderung {
  art: AenderungsArt;
  /** Eine Zeile, die für sich steht. Details gehören in `detail`. */
  titel: string;
  /** Optional: was vorher schiefging oder worauf zu achten ist. */
  detail?: string;
}

export interface Release {
  version: string;
  /** ISO-Datum des Releases. */
  datum: string;
  /** Optionale Überschrift, wenn das Release ein Thema hat. */
  schwerpunkt?: string;
  aenderungen: Aenderung[];
}

export const RELEASES: Release[] = [
  {
    version: "1.3.0",
    datum: "2026-09-04",
    schwerpunkt: "Mietvertrag: Betriebskosten im Vertrag ausweisen",
    aenderungen: [
      {
        art: "neu",
        titel: "Der Mietvertrag zeigt die Betriebskosten jetzt einzeln mit Betrag",
        detail:
          "Im Vertrag steht eine Aufstellung mit einem Betrag je Kostenart, darunter die Summe der Vorauszahlung und die Summe der monatlichen Zahlungen. Vorher war nur der Gesamtbetrag genannt; wofür er erhoben wird, ging aus dem Vertrag nicht hervor. Die Beträge werden beim Anlegen des Vertrags erfasst und dort gespeichert, sodass ein Nachdruck später denselben Vertrag ergibt.",
      },
      {
        art: "neu",
        titel: "Vermieterdaten lassen sich selbst pflegen",
        detail:
          "Über \"Vermieter\" im Kopfbereich sind Firmierung, Vertretung, Anschrift, Handelsregister und Bankverbindung der vermietenden Gesellschaften einzusehen und zu ändern. Das ging bisher gar nicht. Bei der NiImmo Wohnungsbaugesellschaft mbH fehlte deshalb die Bankverbindung — ohne Mietkonto lässt sich kein Vertrag erzeugen. Die IBAN wird beim Eintippen auf ihre Prüfziffer geprüft.",
      },
      {
        art: "verbessert",
        titel: "Vertragsaufbau folgt der Hausvorlage bis 2.19",
        detail:
          "Die Kostenarten sind jetzt wie in der gewohnten Word-Vorlage bis 2.19 durchnummeriert, einschließlich Rauchwarnmelder und Abgasmessung. Außerdem umfasst der Abschnitt über besondere Einrichtungen wieder Fahrstuhl und Gemeinschaftsempfangsanlage — Kosten dafür dürfen nur umgelegt werden, wenn der Vertrag die Einrichtung auch regelt.",
      },
      {
        art: "behoben",
        titel: "Bei nur einem Mieter fehlte im Vertrag ein Paragraph",
        detail:
          "Der Vertrag sprang von § 22 auf § 24 und sah aus, als fehle eine Seite. Die Zählung ist jetzt lückenlos; der Abschnitt regelt zusätzlich, wer beim Tod des Mieters in das Mietverhältnis eintritt.",
      },
      {
        art: "behoben",
        titel: "Widersprüchliche Betriebskosten werden nicht mehr gedruckt",
        detail:
          "Ergeben die Einzelbeträge eine andere Summe als die vereinbarte Vorauszahlung, wird kein Vertrag erzeugt und der Unterschied angezeigt. Ein Vertrag mit zwei Beträgen für dieselbe Sache müsste im Streitfall ein Gericht auflösen.",
      },
    ],
  },
  {
    version: "1.2.0",
    datum: "2026-09-03",
    schwerpunkt: "Zugang für die Buchhaltung",
    aenderungen: [
      {
        art: "neu",
        titel: "Die Buchhaltung hat einen eigenen Zugang",
        detail:
          "buchhaltung@niimmo.de kann sich jetzt anmelden, mit denselben Rechten wie die Geschäftsführung. Bisher war die Buchhaltung zwar in Aufgaben markierbar, konnte die Meldungen aber nicht abrufen — die aufgelaufenen Hinweise sind jetzt erreichbar.",
      },
      {
        art: "neu",
        titel: "Passwort selbst zurücksetzen",
        detail:
          "Auf der Anmeldeseite lässt sich ein Link anfordern, mit dem man sich selbst ein neues Passwort vergibt. Das ging bisher überhaupt nicht: Ein vergessenes Passwort musste jemand von Hand beim Anbieter zurücksetzen. Der Link gilt eine Stunde und lässt sich nur einmal verwenden; aus Sicherheitsgründen verrät die Seite nie, ob es zu einer Adresse einen Zugang gibt.",
      },
    ],
  },
  {
    version: "1.1.0",
    datum: "2026-09-03",
    schwerpunkt: "Probleme direkt aus der Anwendung melden",
    aenderungen: [
      {
        art: "neu",
        titel: "Bildschirm aufnehmen und daraus sofort eine Aufgabe machen",
        detail:
          "Unten rechts, über dem Chat, sitzt jetzt ein Kamera-Knopf. Ein Klick nimmt den aktuellen Bildschirm auf, im selben Schritt entsteht daraus eine Aufgabe — mit Titel, Dringlichkeit und der Person, die sich darum kümmern soll. Bisher musste ein Problem gesondert beschrieben und auf anderem Weg verschickt werden.",
      },
      {
        art: "neu",
        titel: "Personen markieren, die es sofort erfahren sollen",
        detail:
          "Wer markiert wird, sieht die Meldung unmittelbar an der Glocke im Kopfbereich, ohne die Seite neu zu laden. Markierbar sind die Geschäftsführung, die Entwicklung und die Buchhaltung. Klappt keine Aufnahme, lässt sich auch ein eigenes Bild einfügen oder die Meldung ganz ohne Bild abschicken.",
      },
      {
        art: "neu",
        titel: "Aufgaben-Übersicht mit allen offenen Punkten",
        detail:
          "Erreichbar über „Aufgaben“ im Kopfbereich oder den Listen-Knopf unten rechts. Mit den Ansichten „Für mich“, „Offen“ und „Alle“, dazu Suche, Filter nach Art und Status sowie einem Verlauf je Aufgabe, in dem Rückfragen festgehalten werden.",
      },
      {
        art: "verbessert",
        titel: "Der Hausmeister-Zugang bleibt auf Zählerstände beschränkt",
        detail:
          "Aufgaben, Meldungen und Benachrichtigungen sind für diesen Zugang weder sichtbar noch abrufbar. Zuvor waren die internen Einträge grundsätzlich für jeden angemeldeten Zugang lesbar.",
      },
    ],
  },
  {
    version: "1.0.0",
    datum: "2026-09-03",
    schwerpunkt: "Einheitliche Zahlen und ein eindeutiges Vertragsende",
    aenderungen: [
      {
        art: "behoben",
        titel: "Vertragsende war in Karten- und Detailansicht unterschiedlich",
        detail:
          "Kündigungstermin und Mietende wurden getrennt geführt und nicht abgeglichen. Die Einheiten-Karte zeigte den einen, die Vertragsdetails den anderen Wert — bei 23 Verträgen wichen sie voneinander ab, zwei gekündigte Verträge standen im Detail sogar auf „Unbefristet“. Es gibt jetzt nur noch ein Vertragsende; die Altfälle wurden korrigiert.",
      },
      {
        art: "behoben",
        titel: "Befristete Verträge wurden fälschlich als gekündigt geführt",
        detail:
          "Sobald ein Mietende in der Zukunft eingetragen war, sprang der Status automatisch auf „gekündigt“ — auch ohne jede Kündigung. Das passiert nicht mehr.",
      },
      {
        art: "behoben",
        titel: "Mietaufstellung und Dashboard zeigten unterschiedliche Kaltmieten",
        detail:
          "Dashboard, Mietaufstellung und Mietübersicht zählten jeweils andere Verträge: einmal einen erst im Oktober beginnenden Vertrag, einmal neun bereits beendete. Alle drei rechnen jetzt nach derselben Regel — es zählt, was am Stichtag tatsächlich läuft.",
      },
      {
        art: "behoben",
        titel: "Spalte „Gesamt“ der Mietaufstellung enthielt keine Betriebskosten",
        detail:
          "Sie stand direkt hinter Kaltmiete und Betriebskosten, zeigte aber nur die Kaltmiete — es fehlten rund 12.800 € im Monat. Die Spalte heißt jetzt „Warmmiete“ und enthält beides.",
      },
      {
        art: "behoben",
        titel: "Jahreswerte und Flächensumme fehlten im Ausdruck",
        detail:
          "In der gedruckten Aufstellung blieb „SOLL p.a.“ leer, obwohl „SOLL p.m.“ einen Betrag zeigte, und die Quadratmeter-Gesamtsumme war gar nicht gefüllt. Beides wird jetzt ausgewiesen, dazu der Überschuss auch für die SOLL-Miete.",
      },
      {
        art: "behoben",
        titel: "Soll-Ist-Vergleich verglich Warmmiete gegen Kaltmiete",
        detail:
          "Die Differenzspalte im Ausdruck war um die Betriebskosten verschoben. IST und SOLL sind jetzt beide Kaltmieten.",
      },
      {
        art: "behoben",
        titel: "Annuität und Überschuss der Mietübersicht waren ohne Abzug",
        detail:
          "Die Annuität wurde aus einem Feld gelesen, das bei keinem Objekt gefüllt war — der ausgewiesene „Überschuss“ war damit die ungekürzte Jahresmiete. Sie kommt jetzt aus den hinterlegten Darlehen.",
      },
      {
        art: "neu",
        titel: "Zahlungen lassen sich direkt im Mietvertrag auf Nebenkosten umbuchen",
        detail:
          "Bisher fehlten „Nebenkosten“ und „Nichtmiete“ in der Auswahl — eine falsch zugeordnete Versorgerrechnung ließ sich nur über den Umweg Zahlungsverwaltung korrigieren. Jetzt geht es direkt in der Zahlungs-Timeline, und die Zahlung landet automatisch beim richtigen Objekt.",
      },
      {
        art: "behoben",
        titel: "Umgebuchte Zahlungen waren danach nirgends mehr auffindbar",
        detail:
          "Beim Umbuchen auf Nebenkosten fiel der Mieterbezug weg, ohne dass ein Objektbezug entstand — die Zahlung verschwand aus der Mieter-Timeline und tauchte in der Nebenkostenabrechnung nie auf. Das Objekt wird jetzt immer mitgesetzt. Lässt es sich nicht ermitteln, bricht das Umbuchen mit einem Hinweis ab, statt die Zahlung zu verlieren.",
      },
      {
        art: "verbessert",
        titel: "Nebenkosten je Objekt: Suche und vollständige Zahlungsliste",
        detail:
          "Die Ansicht zeigte nur offene Posten aus zwei Jahren, nach Monaten gruppiert und beim Öffnen komplett zugeklappt — sie wirkte leer, obwohl Zahlungen darin lagen. Neu: Suche über Empfänger, Verwendungszweck, Betrag und Datum, ein Umschalter auf alle Zahlungen des Objekts über alle Jahre, und eine durchgehende Liste statt Monatskacheln.",
      },
      {
        art: "neu",
        titel: "Versionsnummer und diese Übersicht",
        detail:
          "Oben im Kopf steht jetzt die laufende Version. Ein Klick darauf öffnet diese Liste aller Updates.",
      },
    ],
  },
];

/** Die ausgelieferte Version. Kommt aus package.json über den Build. */
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

export const BUILD_DATE: string =
  typeof __BUILD_DATE__ !== "undefined" ? __BUILD_DATE__ : "";

export const COMMIT_SHA: string =
  typeof __COMMIT_SHA__ !== "undefined" ? __COMMIT_SHA__ : "unbekannt";

/**
 * Das Release zur laufenden Version — oder das neueste dokumentierte, falls
 * die Changelog-Pflege einmal hinter package.json zurückbleibt.
 */
export const AKTUELLES_RELEASE: Release | undefined =
  RELEASES.find((r) => r.version === APP_VERSION) ?? RELEASES[0];
