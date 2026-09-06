# Flows zum Durchtesten

Alle Abläufe der Anwendung, gruppiert nach dem, was man tatsächlich tut — nicht nach Technik. Reihenfolge folgt
dem Lebenszyklus einer Mietsache, sodass sich Flow 2 bis 9 am Stück an einem Testvertrag durchspielen lassen.

**Legende:** ⚠️ = am 06.09.2026 geändert, hier genau hinsehen · 🔒 = derzeit gesperrt oder nicht erreichbar ·
❓ = fachlich noch nicht abgenommen

---

## 1. Zugang und Rollen

Einstieg: `/auth`

- [ ] Anmelden mit Admin-Konto → Dashboard erscheint
- [ ] Abmelden über das Benutzermenü → zurück auf `/auth`
- [ ] „Passwort vergessen" → Mail kommt an, Link führt auf `/passwort-neu`, neues Passwort greift
- [ ] ⚠️ Anmelden mit **Hausmeister-Konto** → nur das Hausmeister-Dashboard, keine Objektliste
- [ ] ⚠️ Hausmeister: Zählerstand an einer Einheit erfassen und speichern → **muss weiter gehen**
- [ ] ⚠️ Hausmeister: Hausanschlusszähler am Objekt erfassen → **muss weiter gehen**
- [ ] ⚠️ Hausmeister: Dokumente sind nicht mehr zugänglich → **soll jetzt fehlschlagen**

> Die Rollentrennung lag bisher nur im UI; jedes angemeldete Konto konnte per Direktzugriff schreiben. Wenn beim
> Hausmeister etwas klemmt, das er braucht, liegt es an den neuen Policies — bitte melden.

## 2. Objekt und Einheiten anlegen

Einstieg: Dashboard → Objektkachel

- [ ] Objekt anlegen, Adresse und Objekttyp erfassen
- [ ] Einheit anlegen: Fläche, Etage, Zimmer, Einheitentyp
- [ ] ⚠️ **Mehr als 20 Einheiten** in einem Objekt anzeigen → alle müssen sichtbar sein
- [ ] Einheit bearbeiten, Zählernummern hinterlegen
- [ ] Schalter „angespannter Wohnungsmarkt" setzen → wirkt später auf Kappungsgrenze und Vertrag
- [ ] Versicherung am Objekt anlegen und Police hochladen
- [ ] Einheiten-Historie öffnen → Zeitachse mit Verträgen und Leerstand

## 3. Mieter und Mietvertrag anlegen

Einstieg: Einheitenkarte → „Neuer Mietvertrag"

- [ ] Neuen Mieter anlegen (Name, Mail, Telefon, Geburtsdatum)
- [ ] Bestehenden Mieter zuordnen
- [ ] Mehrere Mieter zuordnen → Reihenfolge im Vertrag prüfen
- [ ] Vertragsdaten erfassen: Beginn, Kaltmiete, Betriebskosten, Kaution, Personenzahl
- [ ] Vertrag speichern → erscheint auf der Einheitenkarte

**Bekannte Lücken hier** (nicht behoben, siehe offene-punkte.md):
- ❓ Der Schalter „Unternehmen" speichert nichts — Firmen landen als Privatperson
- ❓ Mieterrolle und Reihenfolge werden nicht geschrieben
- ❓ Die Mietermaske erfasst keine Anschrift — die braucht der Vertragsdruck (Flow 4)

## 4. Mietvertrag als PDF erzeugen

Einstieg: Vertragsdetails → „Mietvertrag erstellen"

- [ ] Pflichtprüfung: Vertrag ohne Personenzahl → **kein PDF**, Meldung nennt den Grund
- [ ] Ohne Mieteranschrift → **kein PDF**
- [ ] Kaution über drei Nettokaltmieten → **kein PDF**
- [ ] Vollständige Daten → PDF entsteht
- [ ] ⚠️ **Briefkopf und Fußzeile prüfen**: Egestorffstraße 11, 31319 Sehnde, HRB 208111, Steuer-Nr. 16/204/50864
- [ ] Betriebskostenaufstellung im Vertrag: Positionen einzeln mit Betrag, Summe stimmt
- [ ] Vertrag gegen ein unterschriebenes Original legen — Paragraphenfolge und Text
- [ ] 🔒 Gewerbevertrag: **nicht testen** — die Vertragsart ist im UI nicht wählbar, jeder Vertrag wird als
      Wohnraum gedruckt (offene-punkte.md D3)

## 5. Einzug und Übergabe

Einstieg: Dashboard → „Übergabe"

- [ ] Vertrag auswählen, Typ „Einzug"
- [ ] Zählerstände je Einheit erfassen — **mit Dezimalkomma tippen** (128,456)
- [ ] Foto je Zähler aufnehmen
- [ ] Beide Unterschriften setzen
- [ ] PDF-Vorschau, dann speichern → Protokoll liegt unter den Dokumenten
- [ ] Zählerstände stehen danach am Vertrag (`strom_einzug` etc.)
- [ ] E-Mail an Mieter versenden (bewusster zweiter Klick)
- [ ] Versorgerbenachrichtigung — ⚠️ Absender muss „NiImmo Wohnungsbaugesellschaft mbH" sein
- [ ] ❓ **Belastungstest**: 30, dann 100 Fotos in einem Protokoll → wo wird es langsam, wo bricht der Mailversand?

> Es gibt keine Fotogrenze. Das ist die wichtigste offene Frage aus D2 — bitte hier bewusst ausreizen und
> festhalten, ab welcher Anzahl es unbrauchbar wird.

## 6. Laufende Miete und Zahlungen

Einstieg: Controlboard

- [ ] CSV-Datei hochladen → Zuordnungsvorschläge erscheinen
- [ ] Vorschläge prüfen, einzelne umsetzen, andere abwählen
- [ ] Übernehmen → ⚠️ **Meldung muss die tatsächliche Zahl nennen**
- [ ] ⚠️ Fehlerfall provozieren (z. B. Import ohne Adminrechte) → **muss jetzt eine rote Meldung geben**,
      nicht mehr „erfolgreich"
- [ ] Zahlung manuell einem Vertrag zuordnen
- [ ] Zahlung auf Nebenkosten umbuchen → verschwindet aus der Vertrags-Timeline, taucht am Objekt auf
- [ ] Zahlung aufteilen und wieder zusammenführen
- [ ] Kategorie einer Zahlung ändern
- [ ] Nichtmiete-Regel greift (Jobcenter, Rücklastschrift)
- [ ] Doppelten Import derselben Datei → Duplikate werden erkannt

## 7. Rückstände und Mahnwesen

Einstieg: Dashboard → Rückstände

- [ ] Rückstandsliste zeigt die erwarteten Verträge
- [ ] ⚠️ **Fehlerfall**: Verbindung trennen und neu laden → muss „konnte nicht geladen werden" zeigen,
      **nicht** den grünen Kasten „alle ausgeglichen"
- [ ] Mahnung Stufe 1 erzeugen → Vorschau prüfen, Verzugszinsen plausibel
- [ ] ⚠️ Versand an eine **nicht hinterlegte** Adresse → muss abgelehnt werden
- [ ] Versand an die hinterlegte Adresse → Mail kommt **mit PDF-Anhang** an
- [ ] ⚠️ Mahnstufe steigt erst nach erfolgreichem Versand, um genau eins
- [ ] Mahnstufe manuell zurücksetzen → geht; manuell erhöhen → geht nicht
- [ ] Stufe 2 erzeugen und versenden
- [ ] ⚠️ **Stufe 3**: Bestätigungsdialog warnt vor der Kündigung → nach Versand steht der Vertrag auf
      „gekündigt" mit Ende zur Räumungsfrist
- [ ] ❓ Rückstand gegenprüfen bei einem Vertrag mit bezahlter Betriebskostennachzahlung — bekannter Fehler,
      noch nicht behoben (C5)

## 8. Mieterhöhung

Einstieg: Dashboard → Mieterhöhung

- [ ] Kandidatenliste zeigt nur Verträge mit 15 Monaten Frist
- [ ] ⚠️ **Kappungsgrenze prüfen**: normaler Markt 20 %, angespannter Markt 15 %
- [ ] ⚠️ Erhöhung über der Grenze → Warnung erscheint
- [ ] ⚠️ **Ohne Begründung** → kein PDF, Hinweis auf § 558a BGB
- [ ] Begründungsart wählen, Text erfassen → PDF entsteht mit Begründungsabschnitt
- [ ] ⚠️ Brieftext prüfen: verlangt **Zustimmung**, behauptet keine einseitige Erhöhung, sagt nicht
      „Schweigen gilt als Zustimmung"
- [ ] ⚠️ **Ohne Haken** speichern → Kaltmiete am Vertrag bleibt unverändert
- [ ] ⚠️ **Mit Haken „Der Mieter hat der Erhöhung zugestimmt"** → Kaltmiete steht sofort auf dem neuen Wert
- [ ] ⚠️ Haken setzen, während das Wirksamkeitsdatum in der Zukunft liegt → gelber Warnhinweis erscheint

> Beide Wege legen einen Vorgang in `mieterhoehungen` an — ohne Haken mit Status `verlangt`, mit Haken
> `wirksam`. Der Warnhinweis ist bewusst keine Sperre: Die erhöhte Miete ist erst ab dem dritten
> Kalendermonat nach Zugang geschuldet, aber wann Sie den Vertrag anpassen, entscheiden Sie.

## 9. Kündigung und Auszug

Einstieg: Vertragsdetails → „Kündigen"

- [ ] Manuell kündigen mit PDF → ⚠️ danach **Vertragsende auch in den Vertragsdetails sichtbar**
      (nicht mehr „unbefristet")
- [ ] Kündigungsschreiben hochladen statt erzeugen
- [ ] Einheitenkarte und Detailansicht zeigen **dasselbe** Enddatum
- [ ] Übergabe „Auszug" durchführen, Zählerstände erfassen
- [ ] Nach Ablauf: Vertrag geht auf „beendet"
- [ ] Einheit erscheint wieder als leer

## 10. Betriebskostenabrechnung ❓

Einstieg: Objekt → Nebenkosten

- [ ] Schritt 1: Ausgaben den Kostenarten zuordnen
- [ ] Schritt 2: Verteilerschlüssel je Kostenart prüfen
- [ ] 🔒 Schritt 3: **für Objekte mit Stellplatz oder Garage gesperrt** — bitte an einem Objekt ohne
      Stellplätze testen
- [ ] Abrechnung erzeugen, PDF gegen eine früher von Hand erstellte Abrechnung desselben Objekts legen
- [ ] Versand an einen Testmieter

> Der ganze Ablauf ist fachlich nicht abgenommen. Vor dem ersten echten Lauf die zehn Fragen in
> offene-punkte.md D1 klären — insbesondere Heizkosten, Pauschalmieten und Stellplätze.

## 11. Darlehen, Zähler, Dokumente

- [ ] Darlehen anlegen, Objekt zuordnen, Restschuld pflegen
- [ ] ❓ Restschuld in Dashboard, Auswertung und Chatbot vergleichen — bekannter Widerspruch (C8)
- [ ] Zählerverwaltung: Stand erfassen, Historie zeigt Verbrauchsdifferenz
- [ ] Dokument am Vertrag hochladen, Kategorie setzen, Vorschau öffnen, löschen
- [ ] ⚠️ Als Hausmeister: Dokumente sind gesperrt

## 12. Auswertungen

- [ ] Dashboard-Kennzahlen gegen die Vertragsliste gegenrechnen
- [ ] Analytics über 6, 12, 24 Monate
- [ ] Mietaufstellung für die Bank erzeugen und drucken
- [ ] ❓ **Achtung**: Auswertungen lesen höchstens 1000 Zahlungen von aktuell 3505 — die Zahlen sind zu
      niedrig, bis C3 behoben ist. Nicht als Fehler melden, ist bekannt.

## 13. Aufgaben und Meldungen

- [ ] „Problem melden" mit Bildschirmaufnahme → Aufgabe entsteht
- [ ] Aufgabe zuweisen, kommentieren, jemanden erwähnen
- [ ] Benachrichtigungsglocke zeigt die Erwähnung
- [ ] Aufgabe erledigen

## 14. Assistent

- [ ] Chatbot im Dashboard: Portfolio-Fragen, Mietersuche, Rückstände
- [ ] ❓ Antworten gegen die Oberfläche gegenprüfen — der Chatbot liest teils aus veralteten Tabellen
- [ ] Telegram-Agent „Chilla": Leseabfragen
- [ ] ⚠️ Schreibende Agent-Befehle (Mahnstufe, Zählerstand, Kündigung) nur bewusst testen — sie ändern
      den Echtbestand

---

## Was beim Testen auffallen darf und trotzdem bekannt ist

Damit Sie nichts doppelt melden — diese Punkte stehen bereits in [offene-punkte.md](offene-punkte.md):

| Beobachtung | Punkt |
|---|---|
| Auswertungen zeigen zu niedrige Summen | C3 |
| Mahnung mahnt bezahlte Betriebskostennachzahlung erneut an | C5 |
| Sollstellung zu niedrig bei getrennter Heizkostenvorauszahlung | C6 |
| Drei verschiedene Restschulden je Ansicht | C8 |
| Betriebskosten Schritt 3 gesperrt bei Stellplätzen | D1 |
| Übergabe wird nicht als Vorgang gespeichert, kein Versandnachweis | D2 |
| Gewerbevertrag nicht wählbar | D3 |
| Vier Brieflayouts leicht unterschiedlich | E |

## Was noch gar nicht erreichbar ist

Gebaut, aber ohne Einstieg in der Oberfläche — siehe [funktionen.md](funktionen.md): Pflege der
Nichtmiete-Regeln, objektübergreifende Zahlungssicht, WhatsApp-Posteingang, Aufteilung rückgängig machen,
Übergabe-Einstieg an der Einheit, Gewerbe- und Nebenverträge.
