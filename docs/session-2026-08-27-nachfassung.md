# Session-Prompt: Nachfassung der offenen Themen

Stand: 27.08.2026 · Quelle: Sprachnachricht NiImmo vom 26.08.2026, 10:13 Uhr
· Ist-Stand gegen die Live-DB (`kmtgzrnpitlslivdvlyq`) am 27.08.2026 nachgezählt

---

## Auftrag für die neue Session

Der Kunde hat per Sprachnachricht drei Themen angemahnt (Nebenkosten, Übergabe,
Mietvertragsvorlage) und ein Abstimmungstermin steht an. In dieser Session sind
zwei Dinge zu liefern:

1. **Die Punkte als Tickets in die Anwendung bringen.** Das Devboard
   (`dev_tickets`) ist leer — 0 Zeilen. Alle Arbeitspakete unten werden als
   Tickets angelegt, damit der Kunde den Stand im eigenen Dashboard sieht statt
   in einer Markdown-Datei.
2. **Die Arbeitspakete abarbeiten**, in der unter „Reihenfolge" genannten Folge.

Was **nicht** Teil des Auftrags ist: der Klauseltext der Vertragsvorlage
(anwaltliche Prüfung läuft extern), das Postgres-Upgrade (nur über das Supabase-
Dashboard) und der Cron `generate-mietforderungen-hourly` (nur über das Dashboard
löschbar).

---

## Was der Kunde gesagt hat

> „Wie sieht das aus mit den Nebenkosten? Habt ihr da schon was gemacht? Das
> Übergabethema wurde jetzt auch nicht mehr gefeedbackt. Funktioniert das?
> Hattet ihr schon einen Einsatz? […] Mietvertragsvorlage — genau, da bin ich
> dran. Da ploppen aber ganz viele Fragen auf. Da wolltest du mir noch eine
> Mietvertragsvorlage schicken. […] Es sind so viele Punkte gerade wieder und
> ich habe die alle halb angefangen und kommt immer etwas Neues rein."

Daraus folgen fünf Sachthemen (AP1–AP5) plus die Ticket-Erfassung (AP0) und die
Terminvorbereitung (AP6).

---

## Verifizierter Ist-Stand (27.08.2026)

| Kennzahl | Wert | Bedeutung |
|---|---|---|
| Objekte gesamt | 13 | davon 5 im angespannten Markt, korrekt markiert |
| Objekte **mit** Nebenkostenarten | 5 | 8 Objekte haben **keine einzige** Kostenart |
| Nebenkostenarten gesamt | 13 | verteilt: Wolfsburg 5, Celle 4, Langenhagen 2, Sarstedt 1, Springe 1 |
| Kostenpositionen | 6 | nur in Wolfsburg (3), Celle (2), Sarstedt (1) |
| `kostenposition_anteile` | **0** | es wurde noch nie etwas verteilt |
| `nebenkosten_abrechnungen` | **0** | es wurde noch nie eine Abrechnung erzeugt |
| Einheiten gesamt / ohne qm | 113 / 26 | **18 der 26 sind aktiv vermietet** |
| Übergabe-Dokumente seit 01.07.2026 | 7 | letztes am **03.08.2026** — danach kein Einsatz mehr |
| Zahlungen ohne Kategorie | 60 | Summe −28.313,98 €, Zeitraum 01/2025–01/2026 |
| Aktive Verträge mit Kaltmiete 0 € | 6 | Mahnwesen greift dort nie |
| Objekte ohne Energieausweis | 13 | alle — § 80 Abs. 4 GEG, bußgeldbewehrt bis 10.000 € |
| `dev_tickets` | 0 | Devboard existiert, ist aber ungenutzt |

Die Zahlen zu Nebenkosten und Einheiten entsprechen dem Stand vom 24.08. — in den
drei Tagen dazwischen hat niemand am Feature gearbeitet. Das ist die belastbare
Antwort auf „Habt ihr da schon was gemacht?": **Konfiguriert ist ein Fünftel,
durchgelaufen ist nichts.**

---

## AP0 — Themen als Tickets im Devboard anlegen

**Warum:** Der Kunde beschreibt selbst das Kernproblem — „ich habe die alle halb
angefangen und kommt immer etwas Neues rein". Eine Liste, die er selbst sieht und
abhaken kann, ist der eigentliche Auftrag hinter der Sprachnachricht.

**Zu tun:** Für jedes Arbeitspaket AP1–AP6 einen Eintrag in `dev_tickets` anlegen,
plus die HOCH-/MITTEL-Punkte aus `.claude/CLAUDE.md`, die kein eigenes AP haben.

Feldwerte (aus `src/components/devboard/DevTicketModal.tsx`, es gibt **keine**
Check-Constraints in der DB — die Werte müssen exakt stimmen, sonst rendert die
Karte auf den Default zurück):

- `typ`: `bug` | `feature` | `aufgabe`
- `status`: `offen` | `geplant` | `in_entwicklung` | `in_testing` | `fertig`
- `prioritaet`: `kritisch` | `hoch` | `mittel` | `niedrig`
- `kurzbeschreibung` erscheint auf der Karte, `beschreibung` im Modal
- `sort_order` setzen, sonst ist die Board-Reihenfolge zufällig

Anlegen per `execute_sql`, nicht über das UI. `erstellt_von` bleibt NULL
(Systemeintrag) — vorher prüfen, ob die Spalte NOT NULL ist oder eine RLS-Policy
das blockt.

**Fertig, wenn:** Das Devboard alle Punkte in sinnvoller Priorität zeigt und der
Kunde ohne Rückfrage erkennt, was offen, was in Arbeit und was erledigt ist.

---

## AP1 — Nebenkostenabrechnung zum ersten Mal durchlaufen lassen

**Kundenfrage:** „Wie sieht das aus mit den Nebenkosten? Habt ihr da schon was gemacht?"

**Stand:** Die Rechenlogik wurde am 11.08. überarbeitet und ist mit 30 Unit-Tests
abgesichert. In der Praxis ist sie nie gelaufen: 0 Anteile, 0 Abrechnungen.
Das Feature ist nicht defekt, es ist **unbenutzt** — und ob es funktioniert, weiß
niemand, weil es an echten Daten noch nie geprüft wurde.

**Zu tun:**

1. **Blocker zuerst:** 18 aktiv vermietete Einheiten ohne `qm`. Jede Verteilung
   nach Fläche scheitert daran. Liste der 18 Einheiten mit Objekt und Mieter
   erzeugen und dem Kunden zur Nachpflege geben — die Flächen stehen in den
   Mietverträgen, das Nachtragen ist keine Entwicklungsaufgabe. Prüfen, ob der
   Verteilungsschritt bei fehlender Fläche **blockiert** oder still mit 0 rechnet;
   im zweiten Fall ist das ein Bug (stille Falschabrechnung) und muss vor allem
   anderen behoben werden.
2. **Ein Objekt vollständig durchspielen:** Saarstraße 37, Wolfsburg — 14 Einheiten,
   5 Kostenarten, 3 Positionen, die beste Datenlage im Bestand. Abrechnungsjahr
   2025. Von Step 1 (Zuordnung) über Step 2 (Verteilung) bis Step 3 (Abrechnung)
   mit echten Daten durchlaufen und das Ergebnis von Hand nachrechnen.
3. **Die 60 unkategorisierten Zahlungen** (−28.313,98 €) durchsehen: Darunter
   stecken mit hoher Wahrscheinlichkeit umlagefähige Betriebskosten, die sonst in
   jeder Abrechnung fehlen. `classify-nebenkosten` darauf ansetzen, Ergebnis
   stichprobenartig prüfen, nicht blind übernehmen.
4. **Kostenarten der übrigen 8 Objekte:** Ohne Kostenarten kann für sie nie
   abgerechnet werden. Die verbindlichen Verteilerschlüssel für alle 17
   BetrKV-Kategorien liegen als Kundenvorgabe vor — prüfen, ob sich eine
   Vorbelegung je Objekt daraus generieren lässt, statt 13× von Hand.

**Fertig, wenn:** Für Wolfsburg 2025 eine plausible, händisch nachgerechnete
Abrechnung als PDF vorliegt und der Weg für die übrigen Objekte beschrieben ist.

**Offene Kundenfrage (Termin):** 23 aktive Verträge stehen auf
`betriebskosten = 0` — echte Inklusivmieten oder fehlende Vorauszahlungen?
Davon hängt ab, für wen überhaupt abgerechnet werden darf.

---

## AP2 — Übergabeprotokoll: Einsatz belegen und Feedback einholen

**Kundenfrage:** „Das Übergabethema wurde jetzt auch nicht mehr gefeedbackt.
Funktioniert das? Hattet ihr schon einen Einsatz?"

**Stand — die Antwort ist ja, mit Einschränkung:** Seit dem Fix vom 31.07.2026
sind **7 Übergabe-Dokumente** entstanden, das letzte am **03.08.2026**. Seitdem
drei Wochen Stille. Ob die sieben Protokolle auch **versendet** wurden, ist damit
nicht gesagt — der Mailversand ist bewusst ein eigener Klick, wer nur speichert,
verschickt nichts.

**Zu tun:**

1. Die 7 Vorgänge auflisten: Vertrag, Objekt, Datum, Ein-/Auszug, ob Fotos und
   Unterschriften vorhanden sind. Das ist die konkrete Antwort auf „Hattet ihr
   schon einen Einsatz?".
2. Prüfen, ob zu diesen Vorgängen ein Mailversand stattgefunden hat (Logs der
   Function `send-uebergabe-email` für Juli/August). Wenn nicht: Das ist die
   wahrscheinlichste Ursache dafür, dass kein Feedback kam — es hat nie jemand
   außerhalb des Systems etwas gesehen.
3. **Wenn der Versand tatsächlich regelmäßig vergessen wird**, ist das ein
   Bedienproblem, kein Bug: Nach „Protokoll speichern" einen deutlichen,
   nicht übersehbaren Hinweis auf den ausstehenden Versand setzen, und im
   Vertrag sichtbar machen, ob das Protokoll versendet wurde. **Nicht**
   automatisch versenden — das war eine bewusste Entscheidung.
4. Ein vollständiges Testprotokoll erzeugen (Zählerstände, Schlüssel, Foto,
   Unterschrift) und an eine interne Adresse senden, um den Weg Ende-zu-Ende
   einmal belegt zu haben.

**Fertig, wenn:** Es gibt eine Liste der echten Einsätze, eine belegte Aussage zum
Versand und — falls nötig — die UI-Korrektur.

---

## AP3 — Mietvertragsvorlage: Word-Hausvorlage einarbeiten

**Kundensatz:** „Da wolltest du mir noch eine Mietvertragsvorlage schicken.
Dennis, schick nochmal rein bitte."

**Achtung — Richtung klären.** Der Satz ist zweideutig: Entweder soll *unsere*
generierte Vorlage zur Prüfung an den Kunden gehen, oder *seine* Word-Hausvorlage
soll noch bei uns eintreffen. Das Layout wurde zuletzt (Commit `fc3eec4`) an die
Word-Hausvorlage angeglichen, es liegt also mindestens eine vor. **Vor Arbeitsbeginn
klären, welche Datei fehlt und bei wem.**

**Stand:** Generator läuft in Fassung `wohnraum-2026.1` für Wohnraum, Gewerbe,
Stellplatz und Küche. 50 Tests sichern ab, dass gestrichene Klauseln nicht
zurückkehren. Der Text ist **nicht anwaltlich geprüft**.

**Zu tun:**

1. Ein Muster-PDF je Vertragsart aus echten Bestandsdaten erzeugen und an den
   Kunden geben — das ist die Grundlage für die anwaltliche Prüfung und
   gleichzeitig die Antwort auf „schick nochmal rein".
2. Die 10 offenen Fragen aus [`docs/mietvertragsvorlage.md`](mietvertragsvorlage.md)
   in eine beantwortbare Form bringen: eine Seite, je Frage die Vorgabe, die der
   Generator heute verwendet, und was sich ändert, wenn die Antwort anders lautet.
   Der Kunde sagt selbst, es „ploppen ganz viele Fragen auf" — die Liste existiert
   bereits, sie war nur nie als Fragebogen aufbereitet.
3. **Vorrangig zu klären, weil es alles andere blockiert:** Frage 1
   (welcher Rechtsträger gehört zu welchem Objekt — im Code standen abweichende
   HRB- und Steuernummern) und Frage 2 (getrenntes Kautionskonto). Ohne Frage 1
   trägt jeder erzeugte Vertrag womöglich die falsche Vertragspartei.
4. Nicht Umgesetztes einplanen, aber nicht in dieser Session bauen:
   Wohnungsgeberbestätigung (§ 19 BMG), Auskunftsdokument zur Mietpreisbremse
   (§ 556g Abs. 1a BGB), Nachtragsvorlage, Heizungsart je Objekt.

**Randnotiz zum Datenmodell:** `mietvertrag_einheiten` ist leer (0 Zeilen). Das ist
**kein** Fehler — die Haupteinheit kommt aus `mietvertrag.einheit_id`, die Tabelle
trägt nur Nebenobjekte (Garage/Stellplatz im selben Vertrag), und die wurden noch
nie erfasst. Vor dem ersten Vertrag mit Garage prüfen, dass der Weg funktioniert.

---

## AP4 — Verträge mit Kaltmiete 0 € klären

**Stand:** 6 aktive Verträge, alle mit namentlichem Mieter und laufenden
Forderungen, aber ohne eine einzige Mietzahlung. Darunter zwei frische
Gewerbeverträge in Seelze (The Leaf Company GmbH seit 12/2025, Cetin Allak seit
02/2026). Bei Sollmiete 0 entsteht nie ein Rückstand — **das Mahnwesen greift bei
diesen Verträgen nie.**

**Zu tun:** Die 6 Verträge mit Mieter, Objekt, Beginn und Forderungslage
auflisten und dem Kunden vorlegen. Das ist eine fachliche Klärung, keine
Entwicklungsaufgabe — entweder fehlt die Miete im System oder es sind
unentgeltliche Überlassungen. Erst danach entscheiden, ob das System solche
Verträge kennzeichnen soll.

---

## AP5 — Energieausweise

**Stand:** Für **kein einziges** der 13 Objekte ist ein Energieausweis hinterlegt.
Er muss dem Mieter spätestens bei Vertragsabschluss vorgelegt werden
(§ 80 Abs. 4 GEG), Verstoß ist bußgeldbewehrt bis 10.000 €.

**Zu tun:** Beim Kunden erfragen, ob die Ausweise existieren und nur nicht erfasst
sind. Falls ja: Erfassungsweg prüfen (die Spalten liegen seit dem 21.08. an
`immobilien`) und die Vorlage der Vorlagepflicht im Vertragsprozess sichtbar
machen. Falls nein, ist das ein Thema für den Kunden, nicht für die Software —
aber es gehört auf den Tisch, weil der Generator sonst Verträge erzeugt, deren
gesetzliche Beilage fehlt.

---

## AP6 — Statusübersicht für den Abstimmungstermin

**Kundensatz:** „Wir müssen uns mal wieder online treffen, einmal alles
zusammenfassen, weil es gibt wieder zig Punkte."

**Zu tun:** Eine Seite, die pro Thema drei Dinge nennt: Was läuft, was hakt, was
wir vom Kunden brauchen. Kein Fließtext — der Termin soll die offenen
Entscheidungen abräumen, nicht den Stand vortragen. Die Entscheidungen, die
gebraucht werden, sind heute schon bekannt:

| Frage | Blockiert |
|---|---|
| Welcher Rechtsträger gehört zu welchem Objekt? (HRB/Steuernummer bestätigen) | jeden erzeugten Mietvertrag |
| Getrenntes Kautionskonto vorhanden? IBAN? | Kautionsklausel im Vertrag |
| 23 Verträge mit `betriebskosten = 0`: Inklusivmiete oder Lücke? | Nebenkostenabrechnung |
| Wer trägt die qm der 18 vermieteten Einheiten nach? | Nebenkostenabrechnung (qm-Schlüssel) |
| 6 Verträge mit Kaltmiete 0 €: unentgeltlich oder Datenlücke? | Mahnwesen |
| Energieausweise: vorhanden, nur nicht erfasst? | Vertragsabschluss (§ 80 GEG) |
| Kleinreparaturen: 100 € brutto / 8 % bestätigen? | Vertragsklausel § 15 |
| Neuvermietungen seit 01.01.2025 in den 5 angespannten Orten? | Mietpreisbremse |

---

## Reihenfolge

1. **AP0** — Tickets anlegen. Zuerst, damit alles Folgende sichtbar ist.
2. **AP2** — Übergabe. Billigste Antwort auf eine direkte Kundenfrage, reine
   Auswertung plus ggf. ein UI-Hinweis.
3. **AP1** — Nebenkosten. Der größte Brocken, blockiert von den fehlenden qm.
   Die Blockerliste sofort rausgeben, damit der Kunde parallel nachpflegen kann.
4. **AP3** — Vertragsvorlage. Muster-PDFs und Fragebogen; die Antworten kommen
   ohnehin erst nach dem Termin.
5. **AP4, AP5** — Auswertungen, gehen nebenher.
6. **AP6** — Statusseite, zuletzt, wenn die Befunde aus 1–5 vorliegen.

---

## Regeln für diese Session

- **Live-DB ist die Schemaquelle**, nicht `supabase/migrations/`. Nie
  `supabase db push`. Neue Migrationen gezielt per `apply_migration` einspielen.
  Bestehende DB-Funktionen vor dem Ändern per `pg_get_functiondef` aus der Live-DB
  holen, nicht aus dem Gedächtnis neu schreiben.
- **Keine Zahl ohne Nachzählen.** Alle Angaben oben sind am 27.08.2026 gegen die
  Live-DB geprüft. Was in dieser Session behauptet wird, wird genauso belegt.
- **Mahnstufe** wird nie automatisch erhöht — nur `send-mahnung` erhöht sie nach
  erfolgreichem Versand. Manuell ist ausschließlich Zurücksetzen erlaubt.
- **Personenzahl** hängt am Mietvertrag, nie an der Einheit. Fehlt sie, wird nicht
  geschätzt, sondern gesperrt.
- `code-reviewer` und `qa` nach jeder Implementierung, erst nach PASS committen
  und pushen. Nicht vorher pushen.
- Deployment des Frontends läuft über Lovable, ausgelöst durch den Git-Push.

---

## Ausgangsmaterial

- Sprachnachricht: `WhatsApp Ptt 2026-08-26 at 10.13.04.ogg` (70 Sek.),
  Transkript im Sessionverlauf vom 27.08.2026
- [`.claude/CLAUDE.md`](../.claude/CLAUDE.md) — Abschnitt „Offene Punkte & bekannte Risiken"
- [`docs/mietvertragsvorlage.md`](mietvertragsvorlage.md) — die 10 offenen Fragen
- [`.claude/checkup-prompt.md`](../.claude/checkup-prompt.md) — SQL für die Portfolio-Metriken
