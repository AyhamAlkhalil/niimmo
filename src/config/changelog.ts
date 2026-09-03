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
 * Die Einträge vor 1.0.0 wurden nachträglich aus der Entwicklungshistorie
 * zusammengefasst, als der Changelog eingeführt wurde.
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
  {
    version: "0.9.0",
    datum: "2026-08-26",
    schwerpunkt: "Mietvertragsvorlage",
    aenderungen: [
      {
        art: "verbessert",
        titel: "Vertragslayout an die Word-Hausvorlage angeglichen",
        detail:
          "Der Klauseltext ist nicht anwaltlich geprüft — die Abweichungen gegenüber der Hausvorlage sind dokumentiert.",
      },
    ],
  },
  {
    version: "0.8.0",
    datum: "2026-08-24",
    schwerpunkt: "Sicherheit und Datenintegrität",
    aenderungen: [
      {
        art: "behoben",
        titel: "Zugriff auf Mieter- und Objektdaten ohne Anmeldung geschlossen",
        detail:
          "Mieter-, Einheiten- und Objektdaten waren ohne Login les- und schreibbar. Der Zugang ist geschlossen, angemeldete Nutzer arbeiten unverändert weiter.",
      },
      {
        art: "behoben",
        titel: "Fällige Forderungen wurden seit April nicht mehr markiert",
        detail:
          "650 fällige Forderungen standen weiter auf „nicht fällig“. Rückstandsbeträge waren nie betroffen, nur die Aufteilung fällig / noch nicht fällig. Altfälle nachgezogen.",
      },
      {
        art: "behoben",
        titel: "Mietverträge mit Dokumenten ließen sich nicht löschen",
      },
      {
        art: "behoben",
        titel: "Erwartete Miete und Leerstand wieder korrekt berechnet",
      },
      {
        art: "neu",
        titel: "Mietvertrag zentral anlegen, ohne Umweg über die Einheit",
      },
    ],
  },
  {
    version: "0.7.0",
    datum: "2026-08-21",
    schwerpunkt: "Mietvertragsvorlage",
    aenderungen: [
      {
        art: "neu",
        titel: "Generator für Wohnraum, Gewerbe, Stellplatz und Küchen-Nutzungsvereinbarung",
        detail:
          "Fehlt eine Pflichtangabe, wird kein PDF erzeugt — der Generator rät nichts.",
      },
      {
        art: "neu",
        titel: "Fehlende Stammdaten direkt im Erstellungsdialog erfassen",
      },
      {
        art: "verbessert",
        titel: "Lücken in den Stammdaten werden sichtbar gemacht",
        detail:
          "Wohnfläche und Personenzahl sind Bezugsgrößen der Betriebskostenabrechnung. Fehlen sie, wird das jetzt angezeigt, statt die Abrechnung stillschweigend zu blockieren.",
      },
    ],
  },
  {
    version: "0.6.0",
    datum: "2026-08-12",
    schwerpunkt: "Mahnwesen und Nebenkosten",
    aenderungen: [
      {
        art: "verbessert",
        titel: "Mahnstufe steigt nur noch beim tatsächlichen Mahnungsversand",
        detail: "Manuell lässt sie sich nur zurücksetzen, nie erhöhen.",
      },
      {
        art: "behoben",
        titel: "Betriebskostenabrechnung: Rechenlogik, Zustellung und Bestandsdaten",
      },
      {
        art: "behoben",
        titel: "Personenzahl gehört zum Mietvertrag, nicht zur Einheit",
        detail:
          "Fehlt sie, wird sie nicht mehr geschätzt, sondern die Abrechnung gesperrt.",
      },
    ],
  },
  {
    version: "0.5.0",
    datum: "2026-08-04",
    schwerpunkt: "Übergabeprotokoll und Eingabefelder",
    aenderungen: [
      {
        art: "behoben",
        titel: "Dezimalkomma in allen Zahlenfeldern",
        detail:
          "Eingaben mit Komma wurden vorher stillschweigend verschluckt — betraf unter anderem Zählerstände.",
      },
      {
        art: "behoben",
        titel: "Übergabeprotokoll: Zählerstände, Zustandsfotos und Bildausrichtung",
      },
    ],
  },
  {
    version: "0.4.0",
    datum: "2026-07-31",
    schwerpunkt: "E-Mail-Versand",
    aenderungen: [
      {
        art: "behoben",
        titel: "E-Mails mit PDF-Anhang wurden gar nicht verschickt",
        detail:
          "Betraf Übergabeprotokoll, Mahnung und Nebenkostenabrechnung. Der Versand brach ab, bevor eine Mail rausging.",
      },
      {
        art: "behoben",
        titel: "Beendete Verträge waren in der Übergabe nicht auffindbar",
      },
    ],
  },
  {
    version: "0.3.0",
    datum: "2026-07-22",
    schwerpunkt: "Zahlungszuordnung",
    aenderungen: [
      {
        art: "neu",
        titel: "Täglicher Check auf Fehlzuordnungen bei verbundenen Mietverträgen",
        detail: "Auffälligkeiten erscheinen als Banner mit Sprung zur betroffenen Zahlung.",
      },
      {
        art: "behoben",
        titel: "Mehrdeutige Namens- und Ortstreffer werden nicht mehr geraten",
      },
      {
        art: "verbessert",
        titel: "Rücklastschriften werden über die eingebettete IBAN erkannt",
      },
    ],
  },
  {
    version: "0.2.0",
    datum: "2026-07-01",
    schwerpunkt: "Betriebskostenabrechnung im Zahlungslauf",
    aenderungen: [
      {
        art: "neu",
        titel: "BKA-Saldo direkt in der Mietvertrags-Timeline eintragbar",
      },
      {
        art: "verbessert",
        titel: "BKA-Zahlungen und -Forderungen fließen in alle Auswertungen ein",
      },
    ],
  },
  {
    version: "0.1.0",
    datum: "2026-06-25",
    schwerpunkt: "Zahlungsverwaltung",
    aenderungen: [
      {
        art: "neu",
        titel: "Vollbild-Modus für die Zahlungsverwaltung",
      },
      {
        art: "neu",
        titel: "Betriebskostenabrechnung als Dokumentenkategorie",
      },
      {
        art: "behoben",
        titel: "Mehrere Fehler beim Aufteilen von Zahlungen",
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
