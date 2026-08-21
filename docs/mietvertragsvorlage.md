# Mietvertragsvorlage

Stand: 21.08.2026 · Vorlagenfassung `wohnraum-2026.1`

Der Generator erzeugt Miet- und Nutzungsverträge als PDF und legt sie in den
Dokumenten des Vertrags ab. Grundlage sind die 14 Word-Verträge, die im
Dokumentenbestand von NiImmo lagen — Aufbau, Paragraphenfolge und Ton wurden
übernommen, 30 Klauseln mussten rechtlich überarbeitet werden.

> **Vor dem Produktiveinsatz:** Der Klauseltext ist nicht anwaltlich geprüft.
> Die Liste unter „Was gegenüber der Word-Vorlage geändert wurde" ist als
> Vorlage für diese Prüfung gedacht.

## Was es gibt

| Vertragsart | Modul | Umfang |
|---|---|---|
| Wohnraum | `src/utils/mietvertrag/wohnraumKlauseln.ts` | 28 §§, Hausordnung, Betriebskostenkatalog, Datenschutzinformation, Widerrufsbelehrung, Mietspiegel-Einwilligung |
| Gewerbe | `src/utils/mietvertrag/gewerbeKlauseln.ts` | 26 §§ mit Umsatzsteueroption, Betriebspflicht, Konkurrenzschutz, Indexklausel |
| Stellplatz/Garage | `src/utils/mietvertrag/nebenvertraege.ts` | 8 §§ |
| Einbauküche | `src/utils/mietvertrag/nebenvertraege.ts` | 8 §§ (Leihe nach §§ 598 ff. BGB) |

Bedienung: Mietvertrag öffnen → „Mietvertrag erzeugen". Links das Formular,
rechts die Live-Vorschau. Gespeichert wird nach `mietvertraege/{vertrag_id}/`
mit einem Eintrag in `dokumente` unter der Kategorie „Mietvertrag".

## Fehler, die in den Bestandsvorlagen gefunden wurden

Diese Punkte betreffen die bestehenden Word-Dateien, nicht den neuen Generator.
Sie sind der Grund, warum eine automatisierte Vorlage sich lohnt.

| Fund | Wirkung |
|---|---|
| **Die Miet-IBAN im Wohnraumvertrag ist ungültig.** `DE89 2559 1413 3155 4105 00` hat eine falsche Prüfziffer — offenbar von der Kautions-IBAN (`…4105 01`, gültig) übernommen. | Jede Überweisung an dieses Konto wird von der Bank abgelehnt. Der Generator prüft jede IBAN nach ISO 7064 und blockiert bei falscher Prüfziffer. |
| **Im Stellplatzvertrag ist als Mietkonto die Kautions-IBAN angegeben.** | Stellplatzmieten landen auf dem Kautionskonto und vermischen sich dort mit Sicherheiten. |
| **Laufzeit-Rechenfehler** im Bäckerei-Gewerbevertrag: „läuft 10 Jahre, sprich bis zum 28.02.2033" bei Beginn 10.02.2023. | Richtig wäre der 09.02.2033. Der Generator rechnet das Ende aus Beginn und Laufzeit. |
| **Redaktionshinweis stehengeblieben** im Skyller-Vertrag § 7.3: „(Achtung: nur die tatsächlich anfallenden Betriebskosten aufführen)". | Interner Hinweis in einem unterschriebenen Vertrag. |
| **Unausgefüllte Platzhalter**: „sowie etwaige Außenflächen in ……………" | — |
| **Widersprüchliche Nebenkosten** im selben Vertrag: § 6.1 nennt 340,00 € brutto, § 7.2 legt 2,00 €/m²/Monat netto fest — bei 191 m² wären das 454,58 € brutto. | Zwei Beträge für dieselbe Sache. |
| **Modernisierungszuschlag 11 % und 14 %** in einem Vertrag, mit wechselseitigem Verweis. | Klausel unbestimmt. |
| **Verzugszinsen „über dem Diskontsatz der Deutschen Bundesbank"** | Den Diskontsatz gibt es seit dem 01.01.1999 nicht mehr. |
| **Firmenname im Unterschriftenblock falsch**: Rubrum „Skyller Sports GmbH", Unterschrift „Skyller Sport GmbH". | — |
| **Statische Fußzeile „Seite 16 von 16"** | Bei jeder Änderung des Umfangs falsch. Der Generator zählt die Seiten selbst. |

## Was gegenüber der Word-Vorlage geändert wurde

Die vollständige Liste steht im Code (`AENDERUNGEN` in `wohnraumKlauseln.ts`,
`GEWERBE_AENDERUNGEN` in `gewerbeKlauseln.ts`, `NEBENVERTRAG_AENDERUNGEN` in
`nebenvertraege.ts`) und wird im Erstellungsdialog angezeigt. Die schwerwiegendsten:

| § | Bestand | Neu | Grund |
|---|---|---|---|
| 14 | Starre Fristen 5/7 Jahre, Quotenabgeltung mit Prozentstaffel, Kostenvoranschlag eines vom Vermieter gewählten Malerbetriebs | Weicher Fristenplan, keine Quotenabgeltung, keine Betriebsbindung; bei unrenovierter Übergabe entfällt der Paragraph ganz | BGH VIII ZR 185/14, VIII ZR 242/13 — jeweils mit der Folge, dass die **gesamte** Klausel entfällt |
| 25 | „Der Mieter kann nach Einzug keine Minderungsrechte geltend machen." | Gesetzliche Mängelrechte bleiben unberührt | § 536 Abs. 4 BGB ist zwingend |
| 15 | 190 € netto je Einzelfall, Jahresgrenze 250 € netto **und** 8 % der Jahresmiete, Katalog nennt Thermen und Rollläden | 100 € brutto je Fall, eine Jahresgrenze in Prozent, Katalog auf Gegenstände des direkten Zugriffs beschränkt, nur Kostentragung | Betrag über der akzeptierten Spanne; Innenteile von Thermen unterliegen keinem direkten Zugriff |
| 6 | Mahnkosten 11 € je Mahnung, Rücklastschrift 10 €, Buchungspauschale 3,50 € | Ersatz der tatsächlichen Kosten mit Gegenbeweisrecht; Buchungspauschale gestrichen | § 309 Nr. 5 BGB |
| 5 | Wertsicherung auf Indexbasis 2000 = 100, IHK-Sachverständiger bestimmt die Miete | Indexmiete nach § 557b BGB, Basis 2020 = 100, Nachfolgeindex-Regelung; Sachverständigenklausel gestrichen | Basis 2000 wird nicht mehr fortgeschrieben; Sachverständigenklausel stammt aus einem Gewerbeformular |
| 11 | Jede Tierhaltung außer „Kleinsttiere" erlaubnispflichtig | Kleintiere erlaubnisfrei, sonst Erlaubnis mit Anspruch auf Interessenabwägung | BGH VIII ZR 168/12 |
| 20 | Besichtigungspflicht täglich 10–13 und 15–18 Uhr | Nur mit konkretem Anlass, Ankündigung drei Werktage vorher | Art. 13 GG |
| 21 | Hausordnung einseitig änderbar, Änderungen gelten mit Bekanntgabe | Änderung nur bei sachlichem Grund, Textform, Monatsfrist; Zustimmungsfiktion gestrichen | § 308 Nr. 5, § 307 BGB |
| 27 | Pauschale Einwilligung in Datenweitergabe, im Vertragstext eingebettet | Datenschutzinformation als Anlage, Mietspiegel-Einwilligung separat und freiwillig | Art. 7 Abs. 2 DSGVO |
| 28 | Salvatorische Klausel mit Ersetzungspflicht und Wiederauflebensregel | Reine Erhaltungsklausel | Versuch, zwingendes Mieterschutzrecht zu neutralisieren |
| Anlage | Widerrufsbelehrung mit Schriftformzwang, ohne Wertersatzhinweis | Gesetzliches Muster; wird nur ausgegeben, wenn keine Besichtigung stattfand | § 355 Abs. 1 BGB — sonst läuft die Frist nie an |

## Was der Generator verweigert

Fehlt eine Angabe, wird kein PDF erzeugt. Der Vertrag soll nichts behaupten,
was nicht erfasst ist. Blockierend sind unter anderem:

- Personenzahl fehlt, obwohl eine Betriebskostenart nach Personen verteilt wird (§ 556a Abs. 1 S. 2 BGB)
- Kaution über drei Nettokaltmieten (§ 551 Abs. 1 BGB)
- Schönheitsreparaturen sollen übertragen werden, obwohl nicht renoviert übergeben wird
- Befristung ohne Befristungsgrund (§ 575 Abs. 1 S. 2 BGB)
- IBAN mit falscher Prüfziffer
- Staffelstufen mit weniger als zwölf Monaten Abstand (§ 557a Abs. 2 BGB)
- Objekt in einem Gebiet mit angespanntem Wohnungsmarkt, ohne dokumentierte Auskunft nach § 556g Abs. 1a BGB
- Fehlende Mieteranschrift, Objektadresse, Wohnfläche, Raumaufstellung oder Einheitenbezeichnung

## Nebenbefund: Mietpreisbremse

`immobilien.ist_angespannt` stand bei allen 13 Objekten auf `false`. Tatsächlich
liegen **fünf** Objekte in Gemeinden der Niedersächsischen Mieterschutzverordnung:
Wolfsburg, Hannover, Seelze, Langenhagen und Hildesheim. Ursache war, dass die
Erkennung gegen das Freitextfeld `immobilien.adresse` lief, dessen Format
uneinheitlich ist (Langenhagen steht als „30851, Langenhagen, …" mit Komma nach
der PLZ).

Die Adressen sind jetzt in `strasse`, `hausnummer`, `plz`, `ort` und `ortsteil`
zerlegt, ein Trigger hält `ist_angespannt` aktuell, und die fünf Objekte sind
korrekt markiert.

**Das wirkt über die Vertragsvorlage hinaus:** Für diese Objekte gilt die
Kappungsgrenze von 15 % statt 20 % (§ 558 Abs. 3 S. 2 BGB), die Mietpreisbremse
(§§ 556d ff. BGB) und die verlängerte Kündigungssperrfrist (§ 577a Abs. 2 BGB).
Das bestehende Mieterhöhungsmodul rechnete bisher mit der falschen Grenze.

## Offene Fragen an NiImmo

Bis zur Klärung arbeitet der Generator mit den genannten Vorgabewerten. Die
Antworten ändern nur Werte, keinen Aufbau.

1. **Vermieterstammdaten.** In den Verträgen kommen drei Rechtsträger vor:
   „NiImmo Projektentwicklung & Bau GmbH" (trägt alle Wohnraumverträge),
   „… GmbH & Co. KG" und „NiImmo Wohnungsbaugesellschaft mbH". Hinterlegt ist
   derzeit die Wohnungsbaugesellschaft mbH als Standard. Welcher Rechtsträger
   ist Eigentümer welcher Objekte? Bitte HRB, Registergericht, Steuernummer und
   USt-ID aus dem Handelsregisterauszug bestätigen — im Code standen abweichende
   Werte (HRB 208151 vs. 208111, Steuer-Nr. …50864 vs. …50884).
   *Anschrift wurde korrigiert auf Egestorffstraße 11, 31319 Sehnde — so steht
   sie in allen 14 Verträgen; `company.ts` führte „Egerstorffstraße 11, 33119 Sehnde".*
2. **Kautionskonto.** Gibt es ein getrenntes, insolvenzfestes Kautionskonto
   (§ 551 Abs. 3 BGB)? Wenn ja: IBAN. Wenn nein, darf der Vertrag keine
   getrennte Anlage zusagen — und der Mieter hätte ein Zurückbehaltungsrecht an
   der laufenden Miete in Kautionshöhe.
3. **Übergabezustand.** Werden Wohnungen ausnahmslos renoviert übergeben?
   Davon hängt ab, ob eine Schönheitsreparaturklausel überhaupt zulässig ist.
   *Vorgabe: wird pro Vertrag erfasst.*
4. **Kleinreparaturen.** Vorgabe 100 € brutto je Fall und 8 % der Jahresnettokaltmiete.
   Bestätigen oder ändern? Über 120 € steigt das Risiko, dass die Klausel
   insgesamt kippt.
5. **Betriebskosten.** Wird durchgehend Vorauszahlung mit Jahresabrechnung
   vereinbart, oder gibt es echte Inklusivmieten? 23 aktive Verträge stehen auf
   `betriebskosten = 0`. Welche sonstigen Betriebskosten nach § 2 Nr. 17 BetrKV
   sollen namentlich umgelegt werden (Rauchwarnmelder-Wartung, Dachrinnenreinigung,
   Legionellenprüfung, …)?
6. **Mietpreisbremse.** Gab es seit 01.01.2025 Neuvermietungen in Wolfsburg,
   Hannover, Seelze, Langenhagen oder Hildesheim? Falls ja: Wurde die
   vorvertragliche Auskunft in Textform erteilt?
7. **Mietanpassung.** Bleibt es bei der gesetzlichen Erhöhung nach § 558 BGB,
   oder sollen Staffel- oder Indexmiete angeboten werden? Beide schließen
   Erhöhungen nach § 558 BGB aus — das Mieterhöhungsmodul müsste das kennen.
8. **Energieausweise.** Für keines der 13 Objekte ist ein Energieausweis
   hinterlegt. Er muss dem Mieter spätestens bei Vertragsabschluss vorgelegt
   werden (§ 80 Abs. 4 GEG); Verstoß ist bußgeldbewehrt bis 10.000 €.
9. **Unterschrift.** Papier mit Rückscan, oder qualifizierte elektronische
   Signatur? *Vorgabe: Papier. Eine einfache Klick-Signatur genügt für Wohnraum
   nicht — der Vertrag gälte dann als unbefristet.*
10. **Gewerbe: Umsatzsteueroption.** Wird nach § 9 UStG optiert? Das setzt
    voraus, dass der Mieter die Fläche für vorsteuerabzugsberechtigende Umsätze
    nutzt.

## Nicht umgesetzt

- **Wohnungsgeberbestätigung** nach § 19 BMG als eigenes Dokument. § 2 des
  Vertrags kündigt sie an; erzeugt wird sie noch nicht.
- **Auskunftsdokument zur Mietpreisbremse** nach § 556g Abs. 1a BGB. Der
  Generator verlangt das Datum der Auskunft, erstellt das Dokument aber nicht.
- **Nachtrag zum Mietvertrag** als eigene Vorlage.
- **Heizungsart je Objekt.** Das Datenmodell kennt sie nicht; der Generator
  nimmt Zentralversorgung an. Bei Etagenheizungen muss das vor der Erzeugung
  geprüft werden — sonst legt der Vertrag Heizkosten um, die es nicht gibt.

## Technisches

Neue Tabellen und Spalten (Migrationen vom 21.08.2026):

- `vermieter` — die Vertragspartei als Datensatz statt als Frontend-Konstante,
  mit `immobilien.vermieter_id`
- `mietvertrag_einheiten` — Wohnung plus Garage in einem Vertrag
- `mietvertrag`: 34 neue Spalten (Vertragsart, Betriebskostenmodus,
  Übergabezustand, Klauselschalter, Staffel-/Indexmiete, SEPA-Mandat,
  Befristungsgrund, Mietpreisbremse)
- `mieter`: Anrede, juristische Person, Anschrift vor Einzug
- `einheiten`: Bezeichnung, Zimmerzahl, Räume, Einbauküche
- `immobilien`: atomare Adresse, Energieausweis, Heizkostenschlüssel

Tests: `src/utils/mietvertrag/*.test.ts` (50 Tests). Sie sichern insbesondere
ab, dass gestrichene Klauseln nicht versehentlich zurückkehren — jede
Textänderung an einem freigegebenen Wortlaut fällt damit im Review auf.
