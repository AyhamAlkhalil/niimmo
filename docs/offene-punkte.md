# Offene Punkte und Risiken

Ergebnis der Bestandsaufnahme vom 05.09.2026 (Commit `ae72395`): 14 Fachbereiche und 7 Querschnittsthemen wurden
am Code kartiert, jeder Befund von einem zweiten Durchgang gegengeprüft (32 verworfen). Es bleiben **469 Befunde**
— 26 kritisch, 130 hoch, 227 mittel, 86 niedrig.

Dieses Dokument ordnet und priorisiert. Die vollständige Liste zum Abarbeiten steht in
[befundliste.md](befundliste.md), die Regeln zur Vermeidung in [architektur.md](architektur.md).

## Stand der Umsetzung (06.09.2026)

**Erledigt:** A1–A3 und A5 (Zugriffsschutz), B1–B5 (rechtlich fehlerhafte Schreiben), C1, C2, C4, C7
(stille Datenfehler) sowie F (toter Code). Sieben Commits, alle Tests grün.

Die Mieterhöhung hat seit dem 06.09.2026 einen Haken „Der Mieter hat der Erhöhung zugestimmt": Ist er gesetzt,
wird die Vertragsmiete sofort geändert; ohne ihn bleibt sie stehen, bis die Zustimmung vorliegt.

**Als Nächstes:** C3 (Abfragen ohne Paginierung), C5 (Mahnungsrückstand ignoriert bezahlte
Betriebskostennachzahlungen), C6 (Heizkostenvorauszahlung fehlt in der Sollstellung), C8 (drei
Restschulden), A4 (personenbezogene Daten am KI-Gateway), E (Briefgeneratoren zusammenführen).

**Nur mit dem Kunden zu klären:** D1 (Betriebskosten), D2 (Übergabe), D3 (Gewerbeverträge) und die
Steuernummer aus B5.

---

## A. Sofort — Zugriffsschutz

Diese vier Punkte sind keine Fehler im Ablauf, sondern offene Türen. Sie gelten unabhängig davon, was das
Frontend anzeigt.

**A1 ✅ · Jedes angemeldete Konto darf Mieter, Einheiten und Immobilien ändern und löschen.**
`supabase/migrations/20260824140000_anon_zugriff_schliessen.sql:14-18` schließt nur den anonymen Zugriff; für
angemeldete Konten bleibt Schreibrecht ohne Rollenprüfung. Ein Hausmeisterkonto — oder ein neu angelegtes Konto
ganz ohne Rolle — kann per REST-Aufruf Mieterstammdaten ändern und Einheiten samt Vertragshistorie löschen. Die
Rollentrennung im UI ist damit Kosmetik. *Zu prüfen an der Live-Datenbank, dann Policies je Tabelle auf `is_admin`
einschränken.*

**A2 ✅ · Der Dokumenten-Bucket steht jedem Angemeldeten offen.**
`20260903153000_...sql:452-492`: Die Tabelle `dokumente` ist auf Admins beschränkt, der Storage-Bucket nicht. Ein
Hausmeisterkonto sieht keine Dokumentenliste, kann aber den Bucket auflisten, jede Datei ziehen, überschreiben und
löschen — einschließlich Mahnungen und Kündigungen, deren Dateinamen Mieternamen tragen.

**A3 ✅ · Beliebige Datei an beliebige Adresse mailbar.**
`send-mahnung/index.ts:133-140` und `send-uebergabe-email/index.ts:43-50` übernehmen Storage-Pfad **und**
Empfängeradresse ungeprüft aus dem Request und laden die Datei mit Service-Role. Jedes angemeldete Konto kann sich
so jedes Dokument aus dem Bucket an eine frei gewählte Adresse schicken lassen. Ebenso schreibt `send-mahnung` die
Mahnstufe aus dem Request (`:225-228`) — jeder kann jeden Vertrag auf Stufe 3 setzen.

**A4 · Personenbezogene Daten gehen vollständig an das KI-Gateway.**
`chat/index.ts:88-116` lädt Namen, Mailadressen, Telefonnummern, Geburtsdaten, WhatsApp-Verläufe und die
Bewerber-Blacklist (mit `grund` und `notizen`) in den Systemprompt an `ai.gateway.lovable.dev`;
`process-payments` serialisiert Verwendungszwecke mit IBAN. Das ist eine Auftragsverarbeitung, die geprüft und
vertraglich gedeckt sein muss — oder die Daten müssen vor dem Versand ersetzt werden. Zusätzlich liefert der
Chatbot jedem angemeldeten Konto den kompletten Bestand, auch dem Hausmeister.

**A5 ✅ · `.env` ist im Repository versioniert** und fehlt in `.gitignore`. Die enthaltenen Werte sind heute
öffentlich (URL, anon-Key), aber der nächste Eintrag ist es womöglich nicht. `git rm --cached .env`,
`.env` in `.gitignore`, `.env.example` mit Platzhaltern anlegen.

---

## B. Sofort — rechtlich fehlerhafte Schreiben

Diese Punkte erzeugen Dokumente, die an Mieter herausgehen und einer Prüfung nicht standhalten.

**B1 ✅ · Falsche Kappungsgrenze im Erhöhungsdialog.** `RentIncreaseModal.tsx:58-60` rechnet mit 20 % bzw. 30 %
statt der gesetzlichen 15 % / 20 %. Die Buchhaltung bekommt eine um zehn Prozentpunkte zu hohe Obergrenze grün
bestätigt; die Erhöhung ist in Höhe des Überschusses nach § 558 Abs. 3 BGB unwirksam.

**B2 ✅ · Erhöhungsschreiben ohne Begründung nach § 558a BGB.** `mieterhoehungPdfGenerator.ts:167-292` erzeugt kein
Begründungsmittel (Mietspiegel, Vergleichswohnungen, Gutachten). Ein Erhöhungsverlangen ohne Begründung ist
formunwirksam — die Miete bleibt alt, während die App sie im Vertrag bereits erhöht hat (`:210-214`, sofort und
rückwirkend für den laufenden Monat). Der Mieter erscheint dadurch automatisch als säumig, Mahnlauf und
Verzugszinsen starten.

**B3 ✅ · Der Brief belehrt falsch.** `mieterhoehungPdfGenerator.ts:186` und `:270` formulieren die Erhöhung als
einseitig wirksam und Schweigen als Zustimmung. Tatsächlich braucht es die Zustimmung des Mieters.

**B4 ✅ · Mahnung Stufe 3 spricht die fristlose Kündigung aus, ohne den Vertrag zu kündigen.**
`mahnungPdfGenerator.ts:284-299`. Der Mieter hält ein Kündigungsschreiben, im System bleibt der Vertrag `aktiv`:
Die Sollstellung läuft weiter, das Dashboard zählt die Einheit als vermietet, keine Auswertung kennt den Vorgang.

**B5 ⚠️ · Widersprüchliche Firmenstammdaten auf ausgehenden Briefen.** *(Anschrift und HRB geklärt und umgesetzt; die Steuernummer ist weiterhin offen.)* Im Repo stehen nebeneinander:
Egerstorffstraße/Egestorffstraße, PLZ 33119/31319, HRB 208151/208111, Steuernummer 16/204/50864 vs. 50884, dazu
„NiImmo Wohnungsbaugesellschaft mbH" gegen „NiImmo Projektentwicklung & Bau GmbH". Mindestens zwei Fassungen sind
falsch. **Das ist eine Kundenfrage, keine technische** — bitte verbindlich klären, dann `src/config/company.ts`
als einzige Quelle setzen und die Kopie in `send-nebenkostenabrechnung` mitziehen.

---

## C. Sofort — stille Datenfehler

**C1 ✅ · Einheiten verschwinden.** `ImmobilienDetail.tsx:96-107` gruppiert Einheiten nach den letzten zwei Zeichen
ihrer UUID und behält je Gruppe nur die neueste. Bei 20 Einheiten in einem Haus liegt die Kollisionswahrschein-
lichkeit bei rund 50 %; die verlorene Einheit fehlt lautlos in Detailansicht, Suche und Kündigung. Der Filter hat
keinen erkennbaren Zweck und gehört ersatzlos entfernt.

**C2 ✅ · Der CSV-Zahlungsimport meldet immer Erfolg.** `PaymentManagement.tsx:760-906` hat kein `try/catch`,
destrukturiert `error` an zwei Stellen ohne es zu lesen und prüft auch den Fehler der Duplikatsuche nicht.
Scheitert eine Zeile an RLS oder einem Constraint, fehlt sie dauerhaft — Protokoll und Meldung führen sie als
verarbeitet. Der Rückstand des Mieters ist zu hoch, ohne auffindbare Ursache.

**C3 · Auswertungen rechnen mit einem Bruchteil der Daten.** PostgREST liefert still 1000 Zeilen. Betroffen sind
`Analytics.tsx:59-66`, `ZahlungenUebersicht.tsx:60-66`, `MietUebersichtModal.tsx:271-281`, `useRueckstaende.ts:139`
— bei 3505 Zahlungen und 1465 Dokumenten. Keine Fehlermeldung, nur zu niedrige Zahlen.

**C4 ✅ · Eine fehlgeschlagene Abfrage sieht aus wie Entwarnung.** `FehlendeMietzahlungen.tsx:36` entnimmt
`isLoading` und `error`, benutzt beide im Render nicht und zeigt bei jedem Fehler „0 Verträge" und den grünen
Kasten „Alle Mietverträge sind ausgeglichen".

**C5 · Der Rückstand für die Mahnung ignoriert bezahlte Betriebskostennachzahlungen.**
`MietvertragDetailsModal.tsx:230-236` rechnet mit einer eigenen Inline-Formel. Ein Mieter, der seine Nachzahlung
beglichen hat, wird über genau diesen Betrag erneut gemahnt — während die Finanzübersicht im selben Fenster ihn
als ausgeglichen führt.

**C6 · Die Sollstellung ist bei Heizkostenvorauszahlung dauerhaft zu niedrig.**
`mietvertrag.heizkosten_vorauszahlung` wird im gesamten Backend nicht verwendet.

**C7 ✅ · Der manuelle Kündigungsweg setzt `ende_datum` nicht** (`TerminationDialog.tsx:273-280`) und stellt damit
genau den Zustand wieder her, der am 03.09.2026 bereinigt wurde. Kurios: Die *toten* Komponenten
`ManualTerminationForm` und `DocumentUploadTermination` enthalten den richtigen Schreibpfad samt Kommentar.

**C8 · Drei verschiedene Restschulden.** Bei einem Darlehen ohne gepflegte `restschuld` zeigt das Dashboard 0 €,
der Chat den vollen Ursprungsbetrag, die Auswertung etwas Drittes — und die Eigenkapitalkachel meldet 100 % Quote.

---

## D. Nicht abgenommene Fachkonzepte

### D1 · Betriebskostenabrechnung — Konzept offen

Die Rechenlogik ist testabgesichert und sauber (Zeitanteile, Personentage, Leerstand als eigene Zeile). Ein
produktiver Durchlauf ist nirgends belegt, und **Schritt 3 ist für jedes Objekt mit Garagen oder Stellplätzen
gesperrt** (`NebenkostenStep3Abrechnung.tsx:423`) — also für die meisten. Die Sperre ist zudem falsch begründet:
Ein Stellplatz ohne Quadratmeter verfälscht den qm-Nenner nicht.

Vor dem ersten echten Lauf sind zu entscheiden:

| Frage | Heute |
|---|---|
| Heizkostenvorauszahlung abziehen oder getrennt abrechnen? | wird ignoriert |
| Verträge mit Pauschale/Inklusivmiete ausschließen (§ 556 Abs. 2 BGB)? | laufen mit |
| Fallen die Objekte unter die Heizkostenverordnung? | Schlüssel „gleich" für 2.4–2.6, verbrauchsunabhängig |
| Zählen Stellplätze, Garagen und Gewerbe bei „gleich" und „Wohnfläche" mit? | zählen wie Wohnungen |
| Vorauszahlung: Soll oder tatsächlich geleistet? | Soll |
| Zahlungsfrist der Nachzahlung? | drei verschiedene Angaben in PDF, Mail und Dialog |
| Guthaben: Überweisung oder Verrechnung? Wer quittiert? | kein Feld dafür |
| Sollen BKA-Salden ins Mahnwesen einfließen? | ja — und werden nach §§ 543/569 BGB gemahnt |
| Abrechnungszeitraum immer Kalenderjahr? | ja |
| Vier-Augen-Freigabe vor Versand? Zweitversand sperren? | „Erneut senden" jederzeit möglich |

**Empfehlung:** einen Abrechnungslauf für ein Objekt vollständig durchspielen und das erzeugte PDF gegen eine
früher von Hand erstellte, vom Mieter akzeptierte Abrechnung desselben Objekts legen. Erst danach ausrollen.

### D2 · Übergabe — Konzept offen

**Der Vorgang existiert in der Datenbank nicht.** Gespeichert werden nur die Zählerstände; Datum, Typ,
Schlüsselzahlen, Unterschriftenstatus und Versandnachweis leben ausschließlich im PDF. Nach dem Schließen des
Dialogs ist nicht mehr feststellbar, ob und an wen versendet wurde. Eine Korrektur am selben Tag überschreibt die
alte Datei stillschweigend.

Ihre Frage nach den Fotos: **Eine Obergrenze gibt es nicht.** `MeterPhotoUpload.tsx:80-86` lädt das Original in
den Storage; für das PDF werden alle Bilder gleichzeitig als Base64 im Speicher gehalten, und der komplette Lauf
passiert zweimal (Vorschau und Speichern). Bei 100–300 Fotos ergibt das ~50 Bildseiten, zweistellige MB und einen
Mailversand, der an den Anhangsgrenzen der Empfänger scheitert. Die Bildaufbereitung selbst ist gut gelöst
(`pdfImageUtils.ts`: EXIF-Korrektur, 1600 px, JPEG 0,82) — sie skaliert nur nicht.

Zu entscheiden: Fotoanzahl je Zähler und Obergrenze je Protokoll · Übergabe als eigener Datensatz? ·
Unterschrift als Blocker? · Darf der Hausmeister übergeben (heute kein Zugang)? · Schlüsselanzahl aus dem Vertrag
vorbelegen und beim Auszug prüfen? · Zweites Protokoll ersetzen oder versionieren? · Sollen Ein-/Auszugsstände in
die Betriebskostenabrechnung einfließen (heute kein Verbrauchsschlüssel)? · Soll die Übergabe den Vertragsstatus
ändern dürfen?

### D3 · Gewerbe- und Nebenverträge — gebaut, nicht angeschlossen

Ein vollständiges Gewerbe-Klauselwerk (§§ 1–26, mit Umsatzsteueroption, Betriebspflicht, Konkurrenzschutz),
ein Stellplatzvertrag und ein Küchen-Leihvertrag liegen fertig im Repo — ohne jeden UI-Einstieg. Gleichzeitig
ruft `mietvertragPdfGenerator.ts:40` **bedingungslos** `wohnraumParagraphen(d)`, und die Vertragsart ist im UI
nicht wählbar. **Ein Gewerbevertrag bekäme damit heute Wohnraumklauseln.** Entweder die Weiche einbauen oder die
Vertragsart bis dahin sichtbar auf Wohnraum festschreiben.

---

## E. PDF oder DOCX — Entscheidungsvorlage

**Ist-Zustand:** Sieben Generatoren in `src/utils/` plus drei veraltete Kopien in Edge Functions, zusammen rund
400 `doc.text`-Aufrufe und über 1800 Zahlenliterale — jedes Layout aus absoluten Millimeterkoordinaten. Nur der
Mietvertrag nutzt die gemeinsame Seitenmechanik `briefLayout.ts`; die vier Briefgeneratoren tragen je eine
wortgleiche Kopie von Briefkopf, Fußzeile, Umbruch und Blocksatz. Eine Änderung wie „neue Anschrift in der
Fußzeile" betrifft vier bis sieben Dateien. Für die Mahnung sind zwei Wege gleichzeitig produktiv, die auf
denselben Storage-Pfad schreiben.

**Was für DOCX spricht:** Die Word-Hausvorlage ist der fachliche Maßstab, und die Verwaltung könnte Textänderungen
selbst pflegen, ohne Entwickler. Layouttreue zur gewohnten Vorlage wäre höher.

**Was dagegen spricht:** Die Renderkette (DOCX → PDF) braucht LibreOffice oder einen Dienst — beides läuft nicht
in Supabase Edge Functions, es wäre also ein neuer Serverbaustein mit eigener Verfügbarkeit. Bilder (Zählerfotos,
Unterschriften) sind in einer Vorlagen-Engine deutlich unhandlicher als heute. Und die bestehenden Tests, die
das erzeugte PDF zurücklesen und Pflichtangaben prüfen, fielen ersatzlos weg.

**Empfehlung — gestuft, nicht als Umbau:**
1. **Zuerst das Naheliegende:** die vier Briefgeneratoren auf `briefLayout.createLayout` ziehen, die drei toten
   Edge-Generatoren abschalten, Firmendaten auf eine Quelle. Damit verschwindet der größte Teil des
   Pflegeaufwands — ohne neue Technik.
2. **Dann prüfen, ob der Bedarf bleibt.** Der eigentliche Wunsch ist meist „die Verwaltung soll Texte selbst
   ändern können". Dafür genügt oft, die Textbausteine als Datenstruktur zu pflegen — die Klauseln liegen bereits
   so vor (`wohnraumKlauseln.ts` als `Paragraph`/`Absatz`), der Renderer ist also schon austauschbar.
3. **Ein Wechsel der Renderkette nur mit drei Bedingungen:** eigener Renderdienst außerhalb Supabase Edge, ein
   benannter fachlicher Vorlagenverantwortlicher, und je umgestelltem Schriftstück ein unterschriebenes Original
   als Abnahmemaßstab.

---

## F ✅ Aufräumen: 7380 Zeilen entfernt

Eine Erreichbarkeitsanalyse ab `main.tsx` (dynamische Importe eingeschlossen) findet **38 Fachdateien, die nie
gerendert werden** — etwa ein Sechstel des Anwendungscodes; dazu 22 ungenutzte shadcn-Bausteine. Vollständige
Liste am Ende von [funktionen.md](funktionen.md).

Das ist die Ursache des Insellösungs-Gefühls: Für die Vertragsdetailansicht gibt es drei Kandidaten, für die
Mietübersicht zwei, für die Kündigung drei — und die jeweils *falsche* wirkt beim Lesen genauso plausibel. Zweimal
enthält ausgerechnet die tote Fassung die bessere Logik (Kündigung mit `ende_datum`, Nichtmiete-Regelpflege).

**Erledigt am 06.09.2026:** 30 Vorgänger-Fassungen entfernt (7380 Zeilen). Acht Dateien mit eigenständigem
fachlichem Wert wurden behalten — darunter die Pflegeoberfläche der Nichtmiete-Regeln und das Gewerbe-Klauselwerk;
sie stehen mit Begründung in der Ausnahmeliste von `src/erreichbarkeit.test.ts`, der ab jetzt verhindert, dass
unbemerkt neuer toter Code entsteht. Die bessere Kündigungslogik aus der toten Fassung wurde vorher in den
lebenden Dialog übernommen (C7).

---

## G. Was noch nicht untersucht ist

- **Der Live-Datenbestand.** Alle Aussagen über Datenmengen stammen aus früheren Sitzungen und sind im Repo nicht
  belegbar. Vor Entscheidungen per SQL zählen.
- ~~**RLS-Policies im Detail**~~ — am 06.09.2026 an der Live-Datenbank geprüft und geschlossen (A1, A2).
- **Cron-Jobs** stehen in `cron.job`, nicht im Repo. Welche Turnusläufe tatsächlich aktiv sind, ist offen.
- **Realtime-Publikation:** `useRealtimeUpdates` abonniert vier Tabellen; ob sie in `supabase_realtime` liegen,
  ist unbelegt (Notiz vom 03.09.2026: nur `benachrichtigungen` und `dev_tickets`).
- **Lovable-Deployment:** Weiterhin ungeklärt. Nach dem Push vom 06.09.2026 war der Asset-Hash fünf Minuten
  später unverändert — ein Push veröffentlicht nichts, es braucht *Share → Publish* in Lovable.
- **Geklärt am 06.09.2026:** `dashboard.niimmo.de` ist live (HTTP 200) und liefert dieselbe Anwendung wie
  `immobilien-blick-dashboard.lovable.app` — identischer Asset-Hash. Beide sind produktiv, die Preview-Adresse
  antwortet mit 401.
- **Der Lückenprüfer der Bestandsaufnahme** lief nicht zu Ende (Session-Limit). Seine Hauptfrage — nicht erfasster
  und verwaister Code — ist über die Erreichbarkeitsanalyse beantwortet, eine zweite Durchsicht der Edge Functions
  und Tabellen auf unerfasste Fähigkeiten steht aber noch aus.
