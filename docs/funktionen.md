# Funktionsinventar

Alles, was die Anwendung kann — erhoben am Code, Stand 06.09.2026 (Commit `ae72395`).
**308 genutzte Funktionen** in 14 Fachbereichen, dazu 69 nicht erreichbare (siehe Ende).

Reife: `fertig` = im Betrieb tragfähig · `teilweise` = nutzbar, mit bekannter Lücke · `prototyp` = nicht abgenommen.
Risiken zu einzelnen Funktionen stehen in [offene-punkte.md](offene-punkte.md), Zustände in [datenmodell.md](datenmodell.md).


## Immobilien, Einheiten, Zähler

| Funktion | Was sie leistet | Einstieg | Reife |
|---|---|---|---|
| **Objektuebersicht mit Auslastungskachel** | Je Objekt eine Kachel mit Adresse, Einheitenzahl, Auslastungsbalken und den Zaehlern Aktiv / Gekuendigt… | `src/pages/Index.tsx:590` | teilweise |
| **Objektdetail mit Kennzahlen und Tabs** | Kopf mit Adresse, Objekttyp, Flaeche, Kaltmiete, Betriebskosten, Warmmiete und den Tabs Einheiten,… | `src/components/dashboard/ImmobilienDetail.tsx:40` | fertig |
| **Kennzeichnung angespannter Wohnungsmarkt** | Klickbarer Schalter setzt immobilien.ist_angespannt, was Kappungsgrenze und Mietpreisbremse im Vertrag… | `src/components/dashboard/ImmobilienDetail.tsx:280-295` | teilweise |
| **Hausanschlusszaehler am Objekt pflegen** | Zaehlernummer, Stand und Datum fuer Wasser, Strom, Gas (optional zweiter Satz) inline bearbeitbar;… | `src/components/dashboard/ImmobilienDetail.tsx:322-462` | fertig |
| **Einheitenliste mit Mietersuche** | Rasteransicht aller Einheiten eines Objekts mit Freitextsuche ueber Einheit, Etage, Typ und Mieternamen. | `src/components/dashboard/ImmobilienDetail.tsx:482-546` | teilweise |
| **Einheitenkarte mit Vertrags- und Mieterstatus** | Zeigt Status (Aktiv/Gekuendigt/Beendet/Leerstehend), Flaeche, Mieter mit Kontaktdaten, Mieten,… | `src/components/dashboard/EinheitCard.tsx:56` | fertig |
| **Einheiten-Historie mit Leerstandszeitachse** | Baut aus allen Vertraegen einer Einheit eine Zeitachse aus Perioden vom Typ vertrag und leerstand;… | `src/components/dashboard/EinheitHistorieView.tsx:27` | teilweise |
| **Objektuebergreifende Zaehlerverwaltung** | Baumansicht aller Objekte und Einheiten mit Zaehlernummern, aktuellem Stand, Ablesedatum,… | `src/components/dashboard/ZaehlerVerwaltung.tsx:37` | fertig |
| **Zaehlerstands-Historie mit Verbrauchsdelta** | Listet je Einheit oder Objekt die letzten 100 Ablesungen, rechnet den Verbrauch als Differenz zur… | `src/components/dashboard/ZaehlerHistorie.tsx:85` | teilweise |
| **Ablesung durch den Hausmeister** | Reduzierte Objekt-/Einheitentabelle, in der nur Zaehlernummer, Stand und Datum je Einheit erfasst und… | `src/components/dashboard/HausmeisterDashboard.tsx:77-140` | fertig |
| **Versicherungen je Objekt** | Anlegen, Bearbeiten und Loeschen von Policen (Typ, Firma, Vertragsnummer, Ansprechpartner,… | `src/components/dashboard/ImmobilienVersicherungenTab.tsx:55` | teilweise |
| **Objektdokumente mit Kategorien** | Upload, Vorschau, Umkategorisieren und Soft-Delete von Dokumenten am Objekt ueber das Enum kategorie. | `src/components/dashboard/ImmobilienDetail.tsx:583` | fertig |
| **Nebenkostenarten und Verteilerschluessel je Objekt** | Die 17 BetrKV-Kostenarten mit Kundenvorgabe-Schluessel (qm, personen, gleich) werden je Objekt in… | `src/components/dashboard/nebenkosten/nebenkostenKategorien.ts…` | fertig |
| **Verteilungsrechnung mit Leerstand als eigener Zeile** | Bildet Nutzungsperioden je Einheit im Abrechnungszeitraum, fuellt jede Luecke als Leerstandsperiode und… | `src/utils/nebenkostenBerechnung.ts:115-180` | fertig |
| **SOLL-Miete je Einheit** | einheiten.soll_miete ist direkt in der Tabelle editierbar und dient als Kalt-Sollwert im… | `src/components/dashboard/MietaufstellungBank.tsx:138-146` | fertig |
| **Bank-Mietaufstellung mit Leerstandsausweis** | Einheitenweise Aufstellung fuer die Bank mit qm, Ist- und Sollmiete, Annuitaet je Objekt und der… | `src/components/dashboard/MietaufstellungBank.tsx:55-135` | fertig |
| **Datenluecken-Pruefung Flaeche und Personenzahl** | Zaehlt Einheiten ohne m2 und laufende Vertraege ohne Personenzahl je Objekt und bietet einen Filter auf… | `src/components/dashboard/EditableMietUebersichtModal.tsx:530-…` | fertig |
| **Zaehlerstaende aus dem Uebergabeprotokoll** | Erfasst Strom, Gas, Kalt- und Warmwasser je Vertrag, schreibt sie in die *_einzug/_auszug-Spalten des… | `src/components/dashboard/handover/UebergabeDialog.tsx:437-490` | teilweise |
| **Einheitendaten im Mietvertrags-PDF** | Bezeichnung, Lage, Wohnflaeche, Zimmerzahl, Raumaufstellung, Nebenraeume und Einbaukueche der Einheit… | `src/hooks/useMietvertragPdfDaten.ts:217-230` | teilweise |
| **Objekt- und Leerstandsauskunft fuer Chatbot und Telegram-Agent** | Der Chatbot baut je Objekt eine Einheitenliste mit LEERSTAND-Markierung, der Agent liest Leerstaende… | `supabase/functions/chat/index.ts:160-192` | teilweise |
| **Zaehlerstand per Telegram-Agent setzen** | Schreibt ueber mieter_search oder einheit_id den aktuellen Stand und das Datum in die Einheit und legt… | `supabase/functions/agent-api/index.ts:850-889` | teilweise |

## Mieter und Mieterbeziehungen

| Funktion | Was sie leistet | Einstieg | Reife |
|---|---|---|---|
| **Neuen Mieter beim Vertragsabschluss anlegen** | Erfasst Vorname, Nachname, E-Mail, Telefon und Geburtsdatum und legt daraus eine Zeile in mieter an. | `src/components/dashboard/NewTenantContractDialog.tsx:451 (Dia…` | teilweise |
| **Unternehmen als Mieter erfassen** | Das Formular kennt den Schalter Unternehmen und ein Feld Firmenname, speichert beides aber nicht: der… | `src/components/dashboard/NewTenantContractDialog.tsx:685-700 …` | prototyp |
| **Bestehenden Mieter einem neuen Vertrag zuordnen** | Laedt alle Mieter der Datenbank zur Mehrfachauswahl und verknuepft sie beim Anlegen des Vertrags ueber… | `src/components/dashboard/NewTenantContractDialog.tsx:112-123 …` | teilweise |
| **Mieterdaten aus einem Vertrags-PDF per KI vorbefuellen** | Liest aus einem hochgeladenen Mietvertrag Mieterliste samt Rolle (hauptmieter/mitmieter) aus und fuellt… | `supabase/functions/process-contract-ocr/index.ts:212-222` | teilweise |
| **Mieter-Kontaktdaten am Vertrag pflegen** | Inline-Bearbeitung von Vorname, Nachname, hauptmail und telnr direkt in der Vertragsansicht. | `src/components/dashboard/mietvertrag-details/MietvertragContr…` | teilweise |
| **Mieteranschrift vor Einzug pflegen (Vertragsrubrum)** | Erfasst Strasse, Hausnummer, PLZ und Ort je Mieter fuer das Rubrum "zur Zeit wohnhaft in" und schreibt… | `src/components/dashboard/MietvertragErstellungModal.tsx:556-5…` | fertig |
| **Privat- und Unternehmensmieter im Vertragsdruck unterscheiden** | Das Rubrum druckt bei Unternehmen Firmenname und Vertretung statt Anrede/Name/Geburtsdatum; die… | `src/utils/mietvertrag/mietvertragPdfGenerator.ts:124-150 und …` | teilweise |
| **Mieterreihenfolge und -rolle im Vertrag** | Die Tabelle mietvertrag_mieter traegt rolle (Hauptmieter/Zweitmieter/Drittmieter) und position; das PDF… | `supabase/migrations/20260821055952_mieter_einheiten_vertragsd…` | prototyp |
| **Privat/Gewerbe-Kennzeichnung an der Einheit** | Leitet aus dem Einheitentyp ein farbiges Badge "Gewerbe" oder "Privat" ab. | `src/utils/tenantTypeUtils.ts:6-39` | teilweise |
| **Verbundene Vertraege derselben Mieter finden** | Sucht ueber gemeinsame mieter_id alle weiteren aktiven oder gekuendigten Vertraege derselben Personen,… | `src/hooks/useLinkedContracts.ts:34-121` | fertig |
| **Doppel-Timeline verbundener Vertraege mit Umbuchen per Drag and Drop** | Stellt Forderungen und Zahlungen zweier verbundener Vertraege monatsweise gegenueber und erlaubt, eine… | `src/components/dashboard/mietvertrag-details/LinkedContractsT…` | teilweise |
| **Zahlungs-Anomalien bei verbundenen Vertraegen anzeigen** | Listet die von der DB-Funktion check_zahlungs_anomalien gefundenen Verdachtsfaelle mit lesbaren… | `src/hooks/useZahlungsAnomalien.ts:38-140` | teilweise |
| **Globale Mietersuche** | Sucht Mieter ueber Vorname, Nachname oder E-Mail und gruppiert die Treffer zu Mietvertraegen samt aller… | `src/components/dashboard/SearchPanel.tsx:29-80` | teilweise |
| **Mieterhistorie je Einheit** | Baut aus allen Vertraegen einer Einheit eine Zeitachse und zeigt je Periode die zugehoerigen Mieter. | `src/components/dashboard/EinheitHistorieView.tsx:45-80 und :3…` | fertig |
| **Bewerbungs-Blacklist verwalten** | Anlegen, Suchen und Loeschen gesperrter Bewerber mit Name, E-Mail, Telefon, Grund und Notizen. | `src/components/dashboard/BlacklistVerwaltung.tsx:29-306` | fertig |
| **Blacklist-Auskunft ueber den KI-Assistenten** | Chilla und der Dashboard-Chatbot kennen die vollstaendige Blacklist und pruefen auf Zuruf, ob eine… | `supabase/functions/agent-api/index.ts:430-442 (rpc_agent_blac…` | fertig |
| **WhatsApp-Verlauf ueber den KI-Assistenten** | Gibt die letzten Nachrichten eines Mieters aus; die einzige tatsaechlich erreichbare Nutzung der… | `supabase/functions/agent-api/index.ts:333-348 (rpc_agent_what…` | teilweise |
| **Mieterkontakte fuer den Telegram-Assistenten** | Liefert vollstaendige Kontaktdaten, Gesamtlisten nach Vertragsstatus und Namenssuche ueber… | `supabase/functions/agent-api/index.ts:268-315 (rpc_agent_tena…` | fertig |
| **Mieter per Agent anlegen und aendern** | Schreibende Aussenschnittstelle zum Anlegen und Aendern von Mieterstammdaten; create_mieter schreibt… | `supabase/functions/agent-api/index.ts:754-766 (create_mieter)…` | prototyp |
| **Mieter als Adressat von Schreiben (Mahnung, Kuendigung, Mieterhoehung)** | Zieht Empfaengername und E-Mail aus dem ersten Mieter des Vertrags; Anrede und Anschrift werden im… | `src/components/dashboard/MahnungErstellungModal.tsx:107-109` | teilweise |
| **Empfaengerauswahl und E-Mail-Ruecklauf beim Uebergabeprotokoll** | Waehlt je Mieter die Zieladresse und schreibt eine im Dialog korrigierte Adresse nach mieter.hauptmail… | `src/components/dashboard/handover/UebergabeEmailDialog.tsx:17…` | fertig |

## Mietvertrag: Lebenszyklus und Timeline

| Funktion | Was sie leistet | Einstieg | Reife |
|---|---|---|---|
| **Mietvertrag anlegen (neuer/bestehender Mieter)** | Mehrstufiger Dialog, der Mieter anlegt oder auswaehlt, den Vertrag mit status='aktiv' und… | `src/components/dashboard/NewTenantContractDialog.tsx:502-522` | fertig |
| **Einheitenauswahl vor der Vertragsanlage** | Zeigt je Immobilie alle Einheiten mit aktuellem Belegungsstand (freie zuerst) und uebergibt die… | `src/components/dashboard/NeuerMietvertragDialog.tsx:67-131` | fertig |
| **Vertragsdetails ansehen und Einzelfelder pflegen** | Zentrale Vertragsansicht mit Tabs Uebersicht und Dokumente; einzelne Felder (Mietbeginn, Mietende,… | `src/components/dashboard/MietvertragDetailsModal.tsx:24-284` | fertig |
| **Sammelbearbeitung aller Vertragsfelder (Global-Edit)** | Ein Bearbeiten-Modus schaltet alle Felder gleichzeitig frei, prueft Datumsplausibilitaet und… | `src/hooks/useMietvertragMutations.ts:367-430` | fertig |
| **Kuendigung manuell erfassen mit erzeugtem Kuendigungsschreiben** | Erfasst Kuendigungstyp, Kuendigungs- und Auszugsdatum, Grund und Bemerkungen, erzeugt das PDF, legt es… | `src/components/dashboard/termination/TerminationDialog.tsx:24…` | teilweise |
| **Kuendigung durch Upload eines vorhandenen Schreibens** | Nimmt PDF/JPG/PNG bis 10 MB entgegen und setzt status='gekuendigt' sowie kuendigungsdatum UND… | `src/components/dashboard/termination/TerminationDialog.tsx:32…` | teilweise |
| **Automatischer Uebergang gekuendigt -> beendet im Frontend** | Beim Rendern einer Einheitenkarte wird ein gekuendigter Vertrag, dessen Kuendigungsdatum erreicht ist,… | `src/hooks/useAutoExpireContracts.ts:8-37 (verdrahtet in src/c…` | teilweise |
| **Statusautomatik in der Datenbank (Trigger auto_set_beendet_status)** | Setzt bei jedem Insert/Update: ende_datum in der Vergangenheit -> 'beendet'; ende_datum in der Zukunft… | `supabase/migrations/20260903120000_vertragsende_vereinheitlic…` | fertig |
| **Ueberschneidungspruefung von Vertragszeitraeumen je Einheit** | Vergleicht einen neuen oder geaenderten Zeitraum gegen alle Vertraege derselben Einheit (aktiv,… | `src/utils/contractOverlapValidation.ts:23-137` | teilweise |
| **Vertrags- und Leerstandshistorie je Einheit** | Baut aus allen Vertraegen einer Einheit eine chronologische Zeitachse aus Perioden vom Typ 'vertrag'… | `src/components/dashboard/EinheitHistorieView.tsx:86-158` | fertig |
| **Monatsweise Zahlungs- und Forderungs-Timeline zum Vertrag** | Stellt je Monat Sollstellungen und Zahlungen gegenueber und erlaubt Umbuchen per Drag-and-drop,… | `src/components/dashboard/mietvertrag-details/MietvertragTimel…` | fertig |
| **Verbundene Vertraege derselben Mieter** | Findet ueber gemeinsame Mieter-IDs alle weiteren aktiven oder gekuendigten Vertraege derselben Personen… | `src/hooks/useLinkedContracts.ts:34-128 (Anzeige: mietvertrag-…` | fertig |
| **Haupt- und Nebenobjekte eines Vertrags** | Zusaetzlich mitvermietete Einheiten mit Rolle und Teilmiete; im Frontend werden sie ausschliesslich… | `src/hooks/useMietvertragPdfDaten.ts:110-114 / Tabelle mietver…` | prototyp |
| **Monatliche Sollstellung je laufendem Vertrag** | Cron-Function, die fuer jeden aktiven oder gekuendigten Vertrag mit laufendem Zeitraum eine… | `supabase/functions/generate-mietforderungen/index.ts:73-178` | teilweise |
| **Faelligkeitsmarkierung offener Forderungen** | Cron-Function, die per DB-Funktion update_faellige_forderungen offene Forderungen als faellig markiert… | `supabase/functions/check-faelligkeiten/index.ts:59-113` | fertig |
| **Mahnstufen-Lebenszyklus am Vertrag** | Die Mahnstufe steigt ausschliesslich beim erfolgreichen Mahnungsversand (gedeckelt auf 3); im UI ist… | `supabase/functions/send-mahnung/index.ts:225-231 und src/hook…` | fertig |
| **Dokumentation einer Mieterhoehung am Vertrag** | Jede Kaltmieten-Aenderung fragt nach, ob es eine offizielle Mieterhoehung ist, und setzt dann… | `src/hooks/useMietvertragMutations.ts:200-225 und src/componen…` | fertig |
| **Vertragserzeugung als PDF mit Pflichtpruefung** | Prueft vor dem Druck rund 30 fachliche und gesetzliche Bedingungen; ein Blocker verhindert das PDF, die… | `src/utils/mietvertrag/pflichtpruefung.ts:22-320 (Aufruf ueber…` | teilweise |
| **Uebergabe schreibt Zaehlerstaende an den Vertrag** | Je nach Richtung werden die erfassten Staende in die *_einzug- oder *_auszug-Spalten des Vertrags… | `src/components/dashboard/handover/UebergabeDialog.tsx:428-457` | fertig |
| **Vorschlagsliste faelliger Uebergaben (Einzug/Auszug)** | Priorisiert Vertraege nach Naehe zum Einzugs- bzw. Auszugstermin; beendete Vertraege bleiben bewusst… | `src/components/dashboard/handover/UebergabeContractList.tsx:6…` | fertig |
| **Kuendigung ueber die Aussenschnittstelle agent-api** | Werkzeug terminate_contract des Telegram-Assistenten setzt status='gekuendigt', kuendigungsdatum und… | `supabase/functions/agent-api/index.ts:504-519 und 813-828` | teilweise |
| **Vertragskennzahlen im Dashboard** | Zaehlt aktive und gekuendigte Vertraege, summiert Soll-Kaltmiete und Betriebskosten stichtagsbezogen… | `src/components/dashboard/DashboardStats.tsx:113-147` | teilweise |
| **Mietaufstellung fuer die Bank und Mietuebersicht** | Objektuebergreifende Aufstellungen, die konsequent den am Stichtag laufenden Vertrag verwenden und… | `src/components/dashboard/MietaufstellungBank.tsx:90-128` | fertig |

## Vertragserzeugung (Vorlage, Klauseln)

| Funktion | Was sie leistet | Einstieg | Reife |
|---|---|---|---|
| **Vertragsdaten fuer den Druck zusammentragen** | Laedt Vertrag, Einheit, Objekt, Vermieter, Mieter, Nebenobjekte und Kostenarten und formt daraus das… | `src/hooks/useMietvertragPdfDaten.ts:65` | fertig |
| **Pflichtpruefung vor der Erzeugung** | Prueft 30+ fachliche Bedingungen und liefert Befunde der Schwere blocker oder warnung; ein Blocker… | `src/utils/mietvertrag/pflichtpruefung.ts:22` | fertig |
| **Wohnraum-Klauselwerk §§ 1–28** | Baut aus den Vertragsdaten die vollstaendige Paragraphenfolge des Wohnraummietvertrags, inklusive… | `src/utils/mietvertrag/wohnraumKlauseln.ts:168` | fertig |
| **Mietvertrag als PDF erzeugen** | Rendert Titelseite/Rubrum, alle Paragraphen, Unterschriftsblock und Anlagen als ein PDF im Layout der… | `src/utils/mietvertrag/mietvertragPdfGenerator.ts:24` | fertig |
| **Erstellungsdialog mit Live-Vorschau** | Formular links, PDF-Vorschau rechts mit 500-ms-Debounce; zeigt Blocker und Warnungen und sperrt die… | `src/components/dashboard/MietvertragErstellungModal.tsx:54` | fertig |
| **Einstieg in den Dialog aus der Vertragsansicht** | Button "Mietvertrag erzeugen" in der Vertragsdetailansicht, bewusst auch fuer gekuendigte Vertraege… | `src/components/dashboard/mietvertrag-details/MietvertragContr…` | fertig |
| **Betriebskosten-Aufstellung fuer § 4 pflegen** | Haken und Einzelbetrag je BetrKV-Position 2.1–2.19 mit laufender Kontrollsumme gegen die vereinbarte… | `src/components/dashboard/MietvertragErstellungModal.tsx:486` | fertig |
| **Betriebskosten-Schnappschuss am Vertrag** | Speichert nummer/bezeichnung/schluessel/umgelegt/betrag als JSONB in… | `src/components/dashboard/MietvertragErstellungModal.tsx:230` | fertig |
| **Anlagen zum Vertrag** | Hausordnung, Betriebskostenkatalog, DSGVO-Information, Widerrufsbelehrung und Mietspiegel-Einwilligung… | `src/utils/mietvertrag/anlagen.ts:22` | fertig |
| **Widerrufsrecht ermitteln** | Entscheidet ueber den Druck der Widerrufsbelehrung, prueft dafuer aber nur besichtigtAm und nicht die… | `src/utils/mietvertrag/anlagen.ts:40` | teilweise |
| **Vermieterstammdaten pflegen** | Maske fuer Firmierung, Vertretung, Register, Miet- und Kautionskonto mit IBAN-Pruefziffernpruefung beim… | `src/components/dashboard/VermieterStammdatenDialog.tsx:66` | fertig |
| **IBAN-Pruefung nach ISO 7064** | Prueft jede IBAN vor dem Druck; die Word-Vorlage trug jahrelang eine IBAN mit falscher Pruefziffer. | `src/utils/pdf/briefLayout.ts:93` | fertig |
| **Betrag in Worten fuer die Mietzinsangabe** | Erzeugt "(in Worten: …)" fuer § 4 Ziff. 1 der Vorlage. | `src/utils/pdf/briefLayout.ts:108` | fertig |
| **Stammdaten aus dem Dialog zurueckschreiben** | Im Dialog ergaenzte Einheitendaten (bezeichnung, etage, qm) und Mieteranschriften werden nach einheiten… | `src/components/dashboard/MietvertragErstellungModal.tsx:244` | teilweise |
| **Vertrags-PDF ablegen und protokollieren** | Upload nach mietvertraege/<vertragId>/ im Bucket dokumente, Zeile in dokumente mit Kategorie… | `src/components/dashboard/MietvertragErstellungModal.tsx:188` | fertig |
| **Vorlagenversion festhalten** | Konstante VORLAGE_VERSION = 'wohnraum-2026.1' wird beim Speichern in mietvertrag.vorlage_version… | `src/utils/mietvertrag/typen.ts:195` | fertig |
| **Aenderungsliste gegenueber der Word-Vorlage** | 18 dokumentierte Klauselaenderungen mit Bestand, Neufassung und Grund — im Dialog wird jedoch nur die… | `src/utils/mietvertrag/wohnraumKlauseln.ts:55` | teilweise |
| **Neuen Mietvertrag ueber Objekt/Einheit anlegen** | Auswahl von Objekt und Einheit mit Frei/Belegt-Kennzeichnung, danach uebergibt der Dialog an… | `src/components/dashboard/NeuerMietvertragDialog.tsx:50` | fertig |
| **Vertragsanlage mit OCR-Vorbefuellung** | Liest ein bestehendes Vertrags-PDF per Edge Function process-contract-ocr aus und legt Mieter und… | `src/components/dashboard/NewTenantContractDialog.tsx:300` | teilweise |
| **Angespannter Wohnungsmarkt automatisch erkennen** | DB-Trigger setzt immobilien.ist_angespannt aus dem Ort gegen die Tabelle angespannte_maerkte; steuert… | `supabase/migrations/20260821060228_angespannter_markt_aus_ato…` | fertig |
| **Referenzabgleich gegen den Vertrag vom 01.06.2025** | Testsuite erzeugt den Kundenvertrag aus echten Angaben und prueft Werte, Kostenspalte und lueckenlose… | `src/utils/mietvertrag/hausvorlage.test.ts:129` | fertig |

## Zahlungen: Import, Zuordnung, Korrektur

| Funktion | Was sie leistet | Einstieg | Reife |
|---|---|---|---|
| **CSV-Import von Bankbewegungen** | Der Nutzer laedt eine Kontoumsatz-CSV hoch; die Datei wird im Browser zeilenweise in Zahlungsobjekte… | `src/components/controlboard/PaymentManagement.tsx:630 (parseC…` | teilweise |
| **Spaltenerkennung fuer verschiedene Bankformate** | Ueber eine Liste alternativer Spaltenueberschriften (Buchungstag/Buchungsdatum/Datum, Betrag/Umsatz, 14… | `src/components/controlboard/PaymentManagement.tsx:648-653` | teilweise |
| **Betragsparser fuer deutsche und englische Zahlformate** | Normalisiert '1.250,00', '1,250.00', '5000 00' sowie nachgestellte Minuszeichen zu einer Zahl. | `supabase/functions/process-payments/index.ts:33 und identisch…` | fertig |
| **Duplikaterkennung** | SHA-256 ueber Datum, Betrag, IBAN, Verwendungszweck und Empfaenger; geprueft wird erst innerhalb der… | `supabase/functions/process-payments/index.ts:76 (computePayme…` | fertig |
| **Kategorisierung nach gepflegten Nichtmiete-Regeln** | Jobcenter-IBAN zuerst, danach die Regeln aus nichtmiete_regeln (verwendungszweck_contains,… | `supabase/functions/process-payments/index.ts:397 (categorizeP…` | teilweise |
| **Sonderfall-Regeln aus der Datenbank** | Frei definierbare Regeln (Name im Verwendungszweck, IBAN, Textbestandteil) setzen Zielkategorie,… | `supabase/functions/process-payments/index.ts:450 (checkSonder…` | teilweise |
| **Regelbasierte Matching-Kaskade** | Fuenf Stufen in fester Reihenfolge: IBAN (95/90), Verwendungszweck-Schluesselwort des Vertrags (85),… | `supabase/functions/process-payments/index.ts:695 (matchPaymen…` | fertig |
| **Mehrdeutigkeit aufloesen ueber Datum, Betrag und Vertragsstatus** | Treffen mehrere Vertraege zu, entscheidet zuerst die Vertragslaufzeit, dann Miet- oder Kautionsbetrag,… | `supabase/functions/process-payments/index.ts:526 (selectBestC…` | fertig |
| **Rueckl astschrift ueber die im Verwendungszweck eingebettete…** | Aus dem Fliesstext der Ruecklastschrift wird die zurueckgebuchte Mieter-IBAN laengengenau… | `supabase/functions/process-payments/index.ts:652` | fertig |
| **Jobcenter-/Buergergeld-Zahlungen ueber Namensvergleich zuordnen** | Alle Namensteile des Vertrags werden im Verwendungszweck gesucht, Schreibvarianten per… | `supabase/functions/process-payments/index.ts:970 (matchBGPaym…` | fertig |
| **KI-Fallback fuer ungeklaerte Zahlungen** | Was die Regeln nicht klaeren, geht mit dem vollstaendigen Vertragskontext an das Lovable-Gateway… | `supabase/functions/process-payments/index.ts:195 (callAI)` | teilweise |
| **Vorschau- und Korrekturmaske vor der Uebernahme** | Zeigt jeden Vorschlag mit Konfidenz-Ampel und Begruendung; je Zeile lassen sich Vertrag, Objekt und… | `src/components/controlboard/PaymentAssignmentResultsModal.tsx…` | fertig |
| **Manuelle Vertrags- oder Objektauswahl im Korrekturdialog** | Durchsuchbare Liste aller Vertraege (mit Status, Laufzeit, Gesamtmiete) beziehungsweise aller Objekte,… | `src/components/controlboard/PaymentCorrectionDialog.tsx:47` | fertig |
| **Uebernahme in die Datenbank** | Legt je Zahlung eine Zeile an oder aktualisiert eine vorhandene, speichert auch abgewaehlte und… | `src/components/controlboard/PaymentManagement.tsx:761 (handle…` | teilweise |
| **Automatisches Nachtragen der Mieter-IBAN am Vertrag** | Ist am zugeordneten Vertrag noch keine Bankverbindung hinterlegt, wird die IBAN der Zahlung dort… | `src/components/controlboard/PaymentManagement.tsx:836-841 und…` | teilweise |
| **Upload-Historie und Nachschau des letzten Imports** | Listet die letzten zehn Uploads mit Zeitraum und Anzahl; ein Klick auf den juengsten zeigt die damals… | `src/components/controlboard/PaymentManagement.tsx:177 und src…` | teilweise |
| **Nachtraegliche Zuordnung einer einzelnen Zahlung** | Ordnet eine Zahlung einem Vertrag oder einem Objekt zu, kategorisiert sie als Nichtmiete oder hebt jede… | `src/components/controlboard/AssignPaymentDialog.tsx:29` | fertig |
| **Kategorie einer gebuchten Zahlung aendern** | Auswahlfeld mit allen sieben Kategorien; beim Wechsel auf Nebenkosten oder Nichtmiete wird der… | `src/components/controlboard/PaymentKategorieEditor.tsx:27` | fertig |
| **Zahlung aufteilen, Aufteilung bearbeiten und aufheben** | Eine Sammelzahlung wird in bis zu 20 Teilbetraege mit je eigener Kategorie, eigenem Verrechnungsmonat… | `src/components/dashboard/PaymentSplitModal.tsx:95` | teilweise |
| **Zahlung auf einen anderen Monat umbuchen** | In der Vertrags-Timeline laesst sich eine Zahlung per Maus auf einen anderen Monat ziehen oder der… | `src/components/dashboard/mietvertrag-details/MietvertragTimel…` | fertig |
| **Zahlung auf einen anderen Mietvertrag umbuchen** | Ueber ein Suchfeld in der Timeline wird die Zahlung einem anderen Vertrag zugewiesen — der uebliche Weg… | `src/components/dashboard/mietvertrag-details/MietvertragTimel…` | fertig |
| **Zahlungen im Controlboard suchen, filtern und nach Jahr/Monat gruppieren** | Alle Zahlungen werden vollstaendig geladen und lassen sich nach Zeitraum, Kategorie, Zuordnungsstatus… | `src/components/controlboard/PaymentManagement.tsx:210 (Vollab…` | fertig |
| **Arbeitsliste nicht zugeordneter Zahlungen** | Eigener Reiter mit allen Zahlungen ohne Vertragsbezug in den Kategorien Miete, Mietkaution,… | `src/components/controlboard/PaymentManagement.tsx:194-206` | teilweise |
| **Nebenkosten-Zuordnung: Zahlungen einem Objekt zuweisen** | Zahlungen der Kategorien Nichtmiete und Nebenkosten ohne Objektbezug werden per Ziehen und Ablegen… | `src/components/controlboard/NebenkostenZuordnungTab.tsx:292` | fertig |
| **Verdachtsfaelle falscher Zuordnung anzeigen** | Banner ueber der Zahlungsverwaltung zeigt taeglich vom Datenbank-Job erkannte Zahlungen, die vermutlich… | `src/components/controlboard/ZahlungsAnomalienBanner.tsx:24` | fertig |
| **Zahlungen ueber die Aussenschnittstelle agent-api buchen** | Der Telegram-Assistent kann eine bestehende Zahlung einem Vertrag zuordnen und eine manuelle Zahlung… | `supabase/functions/agent-api/index.ts:743 (assign_payment_to_…` | teilweise |
| **Rueckstands- und Vorauszahlungsrechnung** | Stellt Forderungen und Zahlungen gegenueber; Zahlungen auf einen Monat ohne Forderung wandern auf den… | `src/utils/rueckstandsberechnung.ts:8` | fertig |
| **Zahlungsstatus je Mietforderung** | Markiert eine Forderung als bezahlt, wenn eine Miete-Zahlung mit demselben Verrechnungsmonat existiert;… | `src/components/dashboard/PaymentHistory.tsx:75 (getPaymentSta…` | teilweise |

## Forderungen, Rückstände, Verzugszinsen

| Funktion | Was sie leistet | Einstieg | Reife |
|---|---|---|---|
| **Monatliche Sollstellung erzeugen** | Legt fuer jeden aktiven oder gekuendigten Vertrag eine Zeile in mietforderungen fuer den aktuellen… | `supabase/functions/generate-mietforderungen/index.ts:95-178` | teilweise |
| **Faelligkeit von Forderungen markieren** | Setzt taeglich ist_faellig=true und faellig_seit fuer alle Forderungen, deren faelligkeitsdatum… | `supabase/functions/check-faelligkeiten/index.ts:60-113 ruft D…` | fertig |
| **Forderung manuell anlegen** | Buchhaltung traegt fuer einen Vertrag eine Forderung vom Typ Miete oder BKA mit Sollmonat und Betrag… | `src/components/dashboard/CreateForderungModal.tsx:35-97` | fertig |
| **BKA-Saldo als Forderung uebernehmen** | Uebertraegt Nachzahlungen und Guthaben aus der Betriebskostenabrechnung gesammelt oder einzeln als… | `src/components/dashboard/nebenkosten/NebenkostenStep3Abrechnu…` | teilweise |
| **Forderung bearbeiten und loeschen** | In der Vertrags-Timeline laesst sich der Sollbetrag einer Forderung inline aendern oder die Forderung… | `src/components/dashboard/mietvertrag-details/MietvertragTimel…` | teilweise |
| **Rueckstandsberechnung je Mietvertrag** | Stellt die Summe aller Forderungen der Summe aller als Miete, Ruecklastschrift oder… | `src/utils/rueckstandsberechnung.ts:8-106` | teilweise |
| **Rueckstandsliste im Dashboard** | Zeigt Admins alle Vertraege mit Rueckstand oder Guthaben, gruppiert nach Vertragsstatus, mit Suche,… | `src/components/dashboard/FehlendeMietzahlungen.tsx:26-140` | fertig |
| **Guthabenanzeige und Nettostand** | Vertraege mit Ueberzahlung werden als Guthaben ausgewiesen; Betraege unter einem Cent werden… | `src/hooks/useRueckstaende.ts:194-247` | fertig |
| **Finanzuebersicht und Timeline im Vertrag** | Stellt je Monat Forderungen und Zahlungen nebeneinander, schluesselt BKA-Nachzahlungen und BKA-Guthaben… | `src/components/dashboard/mietvertrag-details/MietvertragPayme…` | fertig |
| **Timeline verbundener Vertraege** | Zeigt Forderungen und Zahlungen zweier Vertraege desselben Mieters nebeneinander, damit eine auf dem… | `src/components/dashboard/mietvertrag-details/LinkedContractsT…` | fertig |
| **Verzugszinsen nach § 288 BGB** | Berechnet tagesgenau Verzugszinsen aus Basiszinssatz plus 5 Prozentpunkten ab dem 4. Werktag mit… | `src/utils/verzugszinsen.ts:96-208` | teilweise |
| **Basiszinssatz aus Marktdaten** | Laedt alle Basiszinssatz-Perioden aus der Tabelle marktdaten und faellt bei Fehler oder leerem Ergebnis… | `src/hooks/useBasiszinsPerioden.ts:9-38` | fertig |
| **Verzugszinsen im Mahnungsschreiben** | Schaetzt die Zinsposten, indem der Gesamtrueckstand durch die Anzahl Monatsmieten geteilt und auf die… | `src/components/dashboard/MahnungErstellungModal.tsx:365-397 u…` | prototyp |
| **Rueckstandsbetrag fuer die Mahnung** | Berechnet fuer das Mahnungsmodal einen eigenen, bei null abgeschnittenen Rueckstand aus allen… | `src/components/dashboard/MietvertragDetailsModal.tsx:230-235` | teilweise |
| **Mahnstufen-Schutz** | Setzt die Regel durch, dass die Mahnstufe im UI und ueber die Agent-Schnittstelle nur gesenkt werden… | `src/hooks/useMietvertragMutations.ts:95-115 und supabase/func…` | teilweise |
| **Zahlungs-Anomalien erkennen** | Ein taeglicher Cron vergleicht bei verbundenen Vertraegen den zugeordneten mit dem vermuteten Vertrag… | `DB-Funktion check_zahlungs_anomalien` | unvalidiert |
| **Anomalien-Banner im Controlboard** | Zeigt Admins offene Verdachtsfaelle mit Betrag, Begruendung und beiden Vertraegen, springt zur… | `src/components/controlboard/ZahlungsAnomalienBanner.tsx:24-120` | fertig |
| **Verdachtsfall pruefen oder ignorieren** | Setzt status auf geprueft oder ignoriert und vermerkt geprueft_von und geprueft_am; laut Hinweis im… | `src/hooks/useZahlungsAnomalien.ts:181-208` | teilweise |
| **Rueckstand fuer den Chatbot** | Bildet die Kennzahl "Offene faellige Forderungen" als Summe aller Forderungen mit ist_faellig —… | `supabase/functions/chat/index.ts:156-157 und 327` | prototyp |
| **Rueckstand ueber die agent-api** | Stellt dem Telegram-Assistenten die Werkzeuge rpc_agent_outstanding (Schuldnerliste mit soll_gesamt,… | `supabase/functions/agent-api/index.ts:112-139` | unvalidiert |

## Mahnwesen und Kündigung

| Funktion | Was sie leistet | Einstieg | Reife |
|---|---|---|---|
| **Mahnung erstellen (Stufe 1-3) mit Live-PDF-Vorschau** | Split-Screen: links Rueckstand, Verzugszinsen, Mahnkosten, Fristen und optionaler Freitext, rechts das… | `src/components/dashboard/MahnungErstellungModal.tsx:45 (Butto…` | fertig |
| **Mahnungs-PDF ins Dokumentenarchiv speichern** | Laedt das im Browser erzeugte PDF nach `mahnungen/<vertragId>/` im Bucket `dokumente` und legt dazu… | `src/components/dashboard/MahnungErstellungModal.tsx:262 handl…` | fertig |
| **Mahnung per E-Mail versenden** | Schickt HTML-Mail mit Forderungstabelle, Summenblock und PDF-Anhang ueber das MAHNUNG_SMTP_*-Postfach… | `src/components/dashboard/MahnungErstellungModal.tsx:331 handl…` | fertig |
| **Mahnstufe erhoehen (nur bei tatsaechlichem Versand)** | Erst nach erfolgreichem `sendMail` werden `mahnstufe`, `letzte_mahnung_am` und `naechste_mahnung_am`… | `supabase/functions/send-mahnung/index.ts:226-231` | fertig |
| **Mahnstufe manuell zuruecksetzen** | Ein Select bietet nur Werte von 0 bis zur aktuellen Stufe an; ein Erhoehungsversuch wird mit einer… | `src/hooks/useMietvertragMutations.ts:95-117` | fertig |
| **Mahnstufen-Ampel** | Drei Balken gelb/orange/rot je erreichter Stufe, eingebunden in MietvertragContractInfo.tsx:335. | `src/components/dashboard/MahnstufeIndicator.tsx:8` | fertig |
| **Verzugszinsen nach § 288 BGB automatisch berechnen** | Tagesgenaue Zinsen aus Basiszinssatz plus 5 Punkten ab dem 4. Werktag des Folgemonats; Basiszinssaetze… | `src/utils/verzugszinsen.ts:186 berechneAlleVerzugszinsen` | teilweise |
| **Verzugszinsposten von Hand nachpflegen** | Jede Zinszeile (Monatstext und Betrag) laesst sich hinzufuegen, aendern und loeschen, die Zwischensumme… | `src/components/dashboard/MahnungErstellungModal.tsx:406-418 u…` | fertig |
| **Mahnkosten erfassen** | Preis je Schreiben (Vorgabe 11,00 EUR) mal Anzahl Schreiben ergibt die Mahnkosten, die im Brief und in… | `src/components/dashboard/MahnungErstellungModal.tsx:86-88` | teilweise |
| **Fristen im Mahnschreiben setzen** | Zahlungsfrist in Tagen (Vorgabe 7), ab Stufe 3 zusaetzlich eine Raeumungsfrist (Vorgabe 14) und ein… | `src/components/dashboard/MahnungErstellungModal.tsx:91-93` | teilweise |
| **Standardtext oder Freitext im Mahnschreiben** | Auf Knopfdruck wird der Stufentext in ein Textfeld uebernommen und kann frei ueberschrieben werden;… | `src/components/dashboard/MahnungErstellungModal.tsx:142 build…` | fertig |
| **Mahnschreiben als PDF im Briefkopf-Layout erzeugen** | A4-Brief mit Logo, Kontaktkasten, Blocksatz, automatischem Seitenumbruch und Rechtsfussnote; ab Stufe 3… | `src/utils/mahnungPdfGenerator.ts:69 generateMahnungPdf` | fertig |
| **Mahnung herunterladen ohne zu versenden** | Speichert die aktuelle Vorschau als lokale Datei; die Mahnstufe bleibt dabei unveraendert. | `src/components/dashboard/MahnungErstellungModal.tsx:321 handl…` | fertig |
| **Kuendigung manuell erfassen und Kuendigungsschreiben erzeugen** | Erfasst Kuendigungsart, Kuendigungs- und Auszugsdatum, Grund und Bemerkungen, erzeugt das PDF, legt es… | `src/components/dashboard/termination/TerminationDialog.tsx:24…` | teilweise |
| **Vorhandenes Kuendigungsschreiben hochladen** | Nimmt PDF/JPG/PNG bis 10 MB entgegen, setzt `status`, `kuendigungsdatum` und `ende_datum` und legt eine… | `src/components/dashboard/termination/TerminationDialog.tsx:32…` | fertig |
| **Kuendigungsschreiben-Generator fuer drei Kuendigungsarten** | Baut je nach ordentlich, ausserordentlich fristlos oder ausserordentlich mit Frist einen anderen… | `src/utils/kuendigungPdfGenerator.ts:55 generateKuendigungPdf` | fertig |
| **Kuendigung ueber die Aussenschnittstelle des Telegram-Assistenten** | Setzt `status`, `kuendigungsdatum`, `ende_datum` und zusaetzlich `kuendigungsgrund` — eine Spalte, die… | `supabase/functions/agent-api/index.ts:507 (Werkzeug) und 813 …` | prototyp |
| **Mahnstufe ueber die Aussenschnittstelle zuruecksetzen** | Liest die aktuelle Stufe, verweigert jede Erhoehung, schreibt den neuen Wert und bestaetigt ihn durch… | `supabase/functions/agent-api/index.ts:580 (Werkzeug) und 891 …` | fertig |
| **Automatischer Statuswechsel gekuendigt -> beendet im Browser** | Sobald eine Einheitenkarte gerendert wird und das `kuendigungsdatum` in der Vergangenheit liegt, setzt… | `src/hooks/useAutoExpireContracts.ts:8` | teilweise |
| **Statusfortschreibung durch DB-Trigger** | Vergangenes `ende_datum` setzt `beendet`; zukuenftiges `ende_datum` plus belegtes `kuendigungsdatum`… | `supabase/migrations/20260903120000_vertragsende_vereinheitlic…` | fertig |
| **Faelligkeitsmarkierung als Vorstufe des Mahnwesens** | Cron-Function mit Header `x-cron-key`, ruft `update_faellige_forderungen` und protokolliert das… | `supabase/functions/check-faelligkeiten/index.ts:25` | fertig |
| **Rueckstandsliste nach Mahnstufe sortieren und filtern** | Die Rueckstandsuebersicht laesst sich nach Mahnstufe sortieren und nach Vertragsstatus (aktiv,… | `src/components/dashboard/FehlendeMietzahlungen.tsx:101 und 29…` | fertig |
| **Uebergabeprotokoll erst nach Kuendigung freigeben** | Der Uebergabe-Button ist nur aktiv, wenn der Vertrag `gekuendigt` oder `beendet` ist oder sein… | `src/components/dashboard/handover/UebergabeButton.tsx:45-64` | teilweise |
| **Mahn- und Kuendigungsschreiben im Dokumententab wiederfinden** | Gruppiert die Vertragsdokumente nach Kategorie; Mahnungen liegen unter "Schriftverkehr", Kuendigungen… | `src/components/dashboard/mietvertrag-details/MietvertragDocum…` | fertig |
| **Kuendigung im Aktivitaetsprotokoll** | Schreibt `kuendigung_durchgefuehrt` nach `activity_logs`, aber nur wenn die Kuendigung aus… | `src/hooks/useMietvertragMutations.ts:312-318 handleTerminatio…` | teilweise |

## Übergabe und Rücknahme

| Funktion | Was sie leistet | Einstieg | Reife |
|---|---|---|---|
| **Uebergabetyp waehlen (Einzug oder Auszug)** | Zwei Kacheln setzen den Modus; er steuert danach durchgaengig, ob in die *_einzug- oder… | `src/pages/Uebergabe.tsx:119-169` | fertig |
| **Vertrag zur Uebergabe suchen und vorschlagen** | Listet alle Vertraege (auch beendete, Zeile 256-259), sortiert sie nach Naehe zum Ein- bzw.… | `src/components/dashboard/handover/UebergabeContractList.tsx:2…` | fertig |
| **Uebergabedatum erfassen** | Kalenderfeld, vorbelegt mit dem Kuendigungsdatum des ersten Vertrags (Zeile 99) — auch beim Einzug; das… | `src/components/dashboard/handover/UebergabeDialog.tsx:660-674` | teilweise |
| **Schluesselanzahl je Art erfassen** | Vier Zaehlfelder (Haustuer, Wohnung, Briefkasten, Keller), die ausschliesslich im PDF landen… | `src/components/dashboard/handover/UebergabeDialog.tsx:676-700` | teilweise |
| **Zaehlerstaende je Einheit und Medium erfassen** | Strom, Gas, Kaltwasser und Warmwasser je ausgewaehltem Vertrag als Textfeld mit deutschem Dezimalkomma;… | `src/components/dashboard/handover/UebergabeDialog.tsx:703-736` | fertig |
| **Zaehlerfotos je Medium hochladen** | Beliebig viele Fotos je Zaehlertyp und Vertrag, sofort nach zaehlerfotos/<vertragId>/ im Bucket… | `src/components/dashboard/handover/MeterPhotoUpload.tsx:65-109` | fertig |
| **Zustandsfotos und Bemerkungen erfassen** | Freitextnotiz plus beliebig viele Maengel-/Zustandsfotos nach uebergabefotos/<vertragId>/; beide… | `src/components/dashboard/handover/NotizenPhotoUpload.tsx:36-82` | fertig |
| **Digitale Unterschriften von Vermieter und Mieter** | Zwei Canvas-Felder mit fester logischer Flaeche 600x200, DPR-Skalierung und passiv-freien… | `src/components/dashboard/handover/SignatureCanvas.tsx:17-131` | teilweise |
| **PDF-Vorschau erzeugen und im Dialog anzeigen** | Baut das komplette Protokoll inklusive aller Fotos und zeigt es rechts neben dem Formular; ein… | `src/components/dashboard/handover/UebergabeDialog.tsx:374-405` | fertig |
| **Safari-/iOS-Ersatzweg fuer die Vorschau** | Da WKWebView keine Blob-URLs im iframe rendert, bekommen Safari, CriOS und FxiOS statt der… | `src/components/dashboard/handover/UebergabeDialog.tsx:1000-10…` | fertig |
| **PDF herunterladen** | Laedt das erzeugte Protokoll lokal herunter; der Dateiname enthaelt Typ, Mieternamen und Datum. | `src/components/dashboard/handover/UebergabeDialog.tsx:407-422` | fertig |
| **Protokoll speichern** | Schreibt in vier getrennten Schritten die Zaehlerstaende an den Vertrag, Historieneintraege,… | `src/components/dashboard/handover/UebergabeDialog.tsx:424-585` | teilweise |
| **Zaehlerstand-Historie fortschreiben** | Jeder lesbare Stand wird als Zeile in zaehlerstand_historie mit Einheit, Objekt, Typ, Datum, Quelle… | `src/components/dashboard/handover/UebergabeDialog.tsx:459-491` | teilweise |
| **Fotos in der Dokumentenablage registrieren** | Zaehler- und Zustandsfotos bekommen je eine Zeile in dokumente mit kategorie "Uebergabeprotokoll",… | `src/components/dashboard/handover/UebergabeDialog.tsx:493-537` | fertig |
| **Plausibilitaetswarnungen beim Ausfuellen** | Drei Hinweise: Foto vorhanden aber Zaehlerstand leer, Eingabe nicht als Zahl lesbar (blockiert Vorschau… | `src/components/dashboard/handover/UebergabeDialog.tsx:604-632` | fertig |
| **Formular zuruecksetzen** | Setzt alle Eingaben zurueck, entwertet laufende Vorschaulaeufe und remountet die Foto-Uploader ueber… | `src/components/dashboard/handover/UebergabeDialog.tsx:246-275` | teilweise |
| **Protokoll per E-Mail an die Mieter senden** | Vorbelegter, editierbarer Betreff und Text, Empfaenger je Mieter plus beliebige CC-Adressen; Versand… | `src/components/dashboard/handover/UebergabeEmailDialog.tsx:16…` | teilweise |
| **Mieter-E-Mail-Adressen im Uebergabeformular pflegen** | Nur beim Auszug sichtbar; die eingetragene Adresse wird beim Versand ungefragt in mieter.hauptmail… | `src/components/dashboard/handover/UebergabeDialog.tsx:753-774` | teilweise |
| **Versorger im Formular vorauswaehlen** | Checkboxen fuer Strom, Gas und Wasser aus den versorger_*-Feldern der Immobilie; der Text verspricht… | `src/components/dashboard/handover/UebergabeDialog.tsx:776-815` | teilweise |
| **Versorger benachrichtigen** | Erzeugt je Versorger einen editierbaren An-/Abmeldungstext mit Adresse, Mieter, Datum und Zaehlerstand… | `src/components/dashboard/handover/VersorgerBenachrichtigungDi…` | teilweise |
| **Versorger-Entwurf in die Zwischenablage kopieren** | Ausweichweg fuer den Fall, dass die Meldung ueber ein anderes Postfach oder ein Versorgerportal laufen… | `src/components/dashboard/handover/VersorgerBenachrichtigungDi…` | fertig |
| **Fotoaufbereitung fuer das PDF** | Dreht Handyfotos ueber ein Canvas anhand der EXIF-Orientierung gerade, rechnet sie auf 1600 px… | `src/utils/pdfImageUtils.ts:105-178` | fertig |

## Betriebskostenabrechnung

| Funktion | Was sie leistet | Einstieg | Reife |
|---|---|---|---|
| **Nebenkosten-Arbeitsflaeche je Objekt (3-Schritt-Assistent)** | Waehlt das Abrechnungsjahr, zeigt Kennzahlen (offene Zahlungen, zugeordnete Positionen, umlagefaehige… | `src/components/dashboard/nebenkosten/BetrKVNebenkostenTab.tsx…` | fertig |
| **Schritt 1 – Ausgaben den BetrKV-Kostenarten zuordnen** | Zeigt alle Ausgaben (betrag < 0) des Objekts aus Abrechnungs- und Vorjahr, mit Suche, Monatsgruppierung… | `src/components/dashboard/nebenkosten/NebenkostenStep1Zuordnun…` | fertig |
| **Zahlung aufteilen / Kostenposition manuell anlegen** | Teilt eine Bankbewegung auf mehrere Kostenarten mit je eigenem Zeitraum und Bezeichnung auf, bearbeitet… | `src/components/dashboard/nebenkosten/NebenkostenSplitDialog.t…` | fertig |
| **KI-Vorklassifizierung von Ausgaben** | Filtert Darlehens- und Bankbuchungen aus, erkennt bekannte Versorger per Regex, schickt den Rest an das… | `supabase/functions/classify-nebenkosten/index.ts:171 (Aufruf:…` | teilweise |
| **Uebernahme des KI-Vorschlags in Schritt 1** | Zeigt je Zahlung den KI-Vorschlag als Badge und uebernimmt ihn per Klick als vollstaendige… | `src/components/dashboard/nebenkosten/NebenkostenStep1Zuordnun…` | fertig |
| **Objektzuordnung unklarer Ausgaben im Controlboard** | Ordnet Zahlungen der Kategorien Nichtmiete und Nebenkosten per Drag-and-Drop oder KI-Vorschlag einer… | `src/components/controlboard/NebenkostenZuordnungTab.tsx:243 (…` | fertig |
| **Schritt 2 – Verteilerschluessel je Kostenart pflegen** | Speichert je Nebenkostenart einen der drei rechenbaren Schluessel (Wohnflaeche, Personentage,… | `src/components/dashboard/nebenkosten/NebenkostenStep2Verteilu…` | fertig |
| **Schritt 2 – Vorschau der Kostenverteilung auf Nutzungsperioden** | Zeigt je Kostenart, welche Mieter- und Leerstandsperiode mit welchem Prozentsatz, welcher… | `src/components/dashboard/nebenkosten/NebenkostenStep2Verteilu…` | fertig |
| **Personenzahl am Mietvertrag nachpflegen** | Listet alle im Zeitraum relevanten Vertraege ohne anzahl_personen auf und schreibt die nachgetragene… | `src/components/dashboard/nebenkosten/NebenkostenStep2Verteilu…` | fertig |
| **Nutzungsperioden und Leerstand ermitteln** | Zerlegt jede Einheit im Abrechnungszeitraum in Vertragsperioden und Leerstandsluecken, meldet… | `src/utils/nebenkostenBerechnung.ts:231 (ermittlePerioden)` | fertig |
| **Zeitanteilige Einrechnung jahresuebergreifender Rechnungen** | Rechnet eine Kostenposition ueber die Tages-Ueberlappung ihres Zeitraums mit dem Abrechnungszeitraum… | `src/utils/nebenkostenBerechnung.ts:68 (kostenAnteilImZeitraum)` | fertig |
| **Schritt 3 – Abrechnung je Mieter und Leerstandsperiode** | Bildet je Nutzungsperiode eine Abrechnung mit Kostenaufschluesselung nach Kategorie, Soll-Vorauszahlung… | `src/components/dashboard/nebenkosten/NebenkostenStep3Abrechnu…` | teilweise |
| **Abrechnungssperre bei unvollstaendigen Stammdaten** | Sperrt PDF, E-Mail und Forderungsuebernahme fuer das ganze Objekt, sobald ein aktiver Schluessel eine… | `src/components/dashboard/nebenkosten/NebenkostenStep3Abrechnu…` | fertig |
| **Warnungen zu Ueberschneidungen, Altschluesseln, fehlender…** | Blendet vier Warnbanner ein: abgelaufene Abrechnungsfrist nach § 556 Abs. 3 BGB, ueberschneidende… | `src/components/dashboard/nebenkosten/NebenkostenStep3Abrechnu…` | fertig |
| **Betriebskostenabrechnung als PDF (3 Seiten)** | Erzeugt Anschreiben mit Briefkopf und Zahlungsfrist, Gesamtaufstellung aller 17 BetrKV-Positionen der… | `src/utils/nebenkostenAbrechnungPdfGenerator.ts:99` | teilweise |
| **Versand der Abrechnung per E-Mail** | Nur fuer Administratoren; schickt das PDF an alle Vertragspartner mit hinterlegter hauptmail ueber das… | `supabase/functions/send-nebenkostenabrechnung/index.ts:117 (A…` | fertig |
| **Versand- und Erstellungsprotokoll je Vertrag und Jahr** | Schreibt Saldo, Vorauszahlungen, Gesamtkosten sowie pdf_erstellt_am bzw. versandt_am und versandt_an… | `src/components/dashboard/nebenkosten/NebenkostenStep3Abrechnu…` | fertig |
| **Fortschreibung der Anteile je Kostenposition und Einheit** | Schreibt bei jedem PDF und jedem Versand Prozentsatz, Betrag, Bezugsgroessen, Zeitraum und… | `src/components/dashboard/nebenkosten/NebenkostenStep3Abrechnu…` | teilweise |
| **BKA-Salden in die Forderungsuebersicht uebernehmen** | Legt Nachzahlungen und Guthaben einzeln oder gesammelt als mietforderungen mit typ = 'BKA' und… | `src/components/dashboard/nebenkosten/NebenkostenStep3Abrechnu…` | teilweise |
| **Nachsendeadresse fuer ausgezogene Mieter** | Adressiert die Abrechnung nach Auszug an mietvertrag.neue_anschrift und faellt sonst auf die… | `src/utils/nebenkostenBerechnung.ts:380 (nachsendeAdresseZeile…` | fertig |
| **Kostenposition ueber die Aussenschnittstelle anlegen** | Der Telegram-Assistent kann fuer ein per Namen gesuchtes Objekt eine Kostenposition mit Betrag und… | `supabase/functions/agent-api/index.ts:1018 (Werkzeug create_k…` | teilweise |
| **Nebenkosten-Auskunft fuer Chatbot und Assistent** | Liest Nebenkostenarten, Kostenpositionen und nebenkosten_zahlungen als Kontext bzw. liefert… | `supabase/functions/chat/index.ts:113-115 und :264` | fertig |
| **Betriebskostenkatalog im Mietvertrag** | Zieht die Nebenkostenarten des Objekts in die Mietvertragserzeugung und friert sie als… | `src/hooks/useMietvertragPdfDaten.ts:105-139` | fertig |
| **Durchreich-Komponente ImmobilienNebenkostenTabNew** | Neun Zeilen, die ausschliesslich BetrKVNebenkostenTab weiterreichen; die Namensendung "New" deutet auf… | `src/components/dashboard/nebenkosten/ImmobilienNebenkostenTab…` | teilweise |

## Mieterhöhung und Marktdaten

| Funktion | Was sie leistet | Einstieg | Reife |
|---|---|---|---|
| **Liste moeglicher Mieterhoehungen im Dashboard** | Aufklappbares Panel, das alle Vertraege zeigt, bei denen die 15-Monats-Sperrfrist abgelaufen ist, mit… | `src/components/dashboard/rent-increase/RentIncreaseList.tsx:55` | teilweise |
| **Fristenpruefung (Sperrfrist 15 Monate)** | Edge Function laedt alle Vertraege mit status='aktiv' und markiert sie als erhoehungsfaehig, wenn seit… | `supabase/functions/check-rent-increase-eligibility/index.ts:1…` | teilweise |
| **Mieterhoehungsschreiben erstellen (Dialog mit Live-Vorschau)** | Erfasst Empfaenger, neue Kaltmiete und neue Betriebskosten, erzeugt nach 500 ms Debounce eine… | `src/components/dashboard/rent-increase/RentIncreaseModal.tsx:…` | teilweise |
| **PDF-Generator Mieterhoehungsschreiben** | Erzeugt das einseitige Schreiben mit Logo, Kontaktkasten, Gegenueberstellungstabelle… | `src/utils/mieterhoehungPdfGenerator.ts:48` | teilweise |
| **Mieterhoehung speichern und Vertrag aktualisieren** | Legt das PDF unter mieterhoehungen/<vertragId>/ im Bucket dokumente ab, schreibt eine Zeile in… | `src/components/dashboard/rent-increase/RentIncreaseModal.tsx:…` | teilweise |
| **Kappungsgrenzen-Anzeige im Erhoehungsdialog** | Rechnet aus immobilien.ist_angespannt eine maximal zulaessige Kaltmiete aus und faerbt den Hinweis rot… | `src/components/dashboard/rent-increase/RentIncreaseModal.tsx:…` | teilweise |
| **Kennzeichnung angespannter Wohnungsmarkt am Objekt** | Ein DB-Trigger setzt immobilien.ist_angespannt beim Schreiben von ort per Abgleich gegen… | `supabase/migrations/20260821060228_angespannter_markt_aus_ato…` | teilweise |
| **Marktdatenabruf Basiszinssatz und Verbraucherpreisindex** | Holt den Basiszinssatz aus der Bundesbank-API (Reihe BBIN1.M.DE.BBK.BBKBAS2.EUR.ME, CSV) und den… | `supabase/functions/fetch-marktdaten/index.ts:10-143` | teilweise |
| **Marktdaten im Dashboard-Kopf anzeigen und manuell korrigieren** | Zeigt Basiszinssatz (samt +5 Punkte Verzugszinssatz) und VPI aus der View aktuelle_marktdaten; Admins… | `src/components/dashboard/DashboardStats.tsx:83-107 und 228-315` | fertig |
| **VPI-Hinweis im Erhoehungsdialog** | Blendet den aktuellen Indexstand mit Stichtag und Basisjahr ein — rein informativ, es wird nichts damit… | `src/components/dashboard/rent-increase/RentIncreaseModal.tsx:…` | teilweise |
| **Basiszins-Perioden fuer die Verzugszinsberechnung** | Liest alle Basiszinssatz-Zeilen als Perioden aus marktdaten und faellt bei DB-Fehler auf die im Code… | `src/hooks/useBasiszinsPerioden.ts:9-38` | fertig |
| **Mieterhoehung beim Aendern der Kaltmiete dokumentieren** | Wer die Kaltmiete in der Vertragsansicht aendert, wird gefragt, ob es eine offizielle Mieterhoehung… | `src/hooks/useMietvertragMutations.ts:55-76 und 199-224` | fertig |
| **Gleiche Rueckfrage in der Mietuebersicht** | Zweiter, unabhaengiger Weg, ueber den die Kaltmiete geaendert und dabei wahlweise das… | `src/components/dashboard/EditableMietUebersichtModal.tsx:956-…` | fertig |
| **Staffelmiete im Mietvertrag** | Erzeugt § 5 als Staffeltabelle mit Ausschluss der Erhoehungen nach §§ 558/559 BGB und blockiert… | `src/utils/mietvertrag/wohnraumKlauseln.ts:920-935 (Klauseltex…` | teilweise |
| **Indexmiete im Mietvertrag** | Erzeugt die § 557b-Klausel mit Ausgangsindexstand, Nachfolgeindex-Regelung und Jahresmindestabstand;… | `src/utils/mietvertrag/wohnraumKlauseln.ts:937-955 und src/uti…` | teilweise |
| **Indexklausel im Gewerbemietvertrag** | Frei vereinbarte Wertsicherung mit Schwellenwert in Prozent, beidseitig wirkend, Basis VPI 2020=100. | `src/utils/mietvertrag/gewerbeKlauseln.ts:578-592` | teilweise |
| **Mietpreisbremsen-Pruefung im Vertragsgenerator** | Bei Wohnraum in angespanntem Markt ist die Auskunft nach § 556g Abs. 1a BGB Pflicht (Blocker) und es… | `src/utils/mietvertrag/pflichtpruefung.ts:284-298` | teilweise |
| **Kappungsgrenzen-Absatz im erzeugten Mietvertrag** | § 5 nennt die 15-Monats- und die Jahresfrist sowie 15 % (angespannt) bzw. 20 % (normal) in drei Jahren;… | `src/utils/mietvertrag/wohnraumKlauseln.ts:960-970` | fertig |
| **Mieterhoehungspruefung fuer den Telegram-Assistenten** | Liefert Kappungsgrenze, maximale neue Kaltmiete und Sperrfriststand — mit 15/20 %, aber ausschliesslich… | `supabase/functions/agent-api/index.ts:658-670 (Werkzeug) und …` | teilweise |

## Darlehen und Versicherungen

| Funktion | Was sie leistet | Einstieg | Reife |
|---|---|---|---|
| **Darlehenskonten anlegen, bearbeiten, loeschen** | Vollstaendige Stammdatenpflege eines Darlehens: Bezeichnung, Bank, IBAN, Darlehensbetrag, Restschuld,… | `src/components/dashboard/DarlehenVerwaltung.tsx:241-303 (Dial…` | fertig |
| **Portfolio-Kennzahlen der Finanzierung** | Drei Kacheln ueber alle Konten: Gesamtschuld (Summe restschuld), Gesamtrate (Summe monatliche_rate) und… | `src/components/dashboard/DarlehenVerwaltung.tsx:381-387` | fertig |
| **Darlehen einer oder mehreren Immobilien zuordnen** | Mehrfach-Checkbox-Auswahl der Objekte; die Zuordnung wird bei jedem Speichern komplett geloescht und… | `src/components/dashboard/DarlehenVerwaltung.tsx:273-281 (Spei…` | teilweise |
| **Tilgungsplan-Vorschau (berechnet, nicht gespeichert)** | Monatliche Fortschreibung aus Restschuld, Zinssatz und Rate mit Zins-, Tilgungs- und Restschuldspalte;… | `src/components/dashboard/DarlehenVerwaltung.tsx:125-167 (bere…` | teilweise |
| **Automatische Ratenberechnung (Annuitaet)** | Rechnet aus Darlehensbetrag, Zins- und Tilgungssatz die monatliche Annuitaet und traegt sie ins… | `src/components/dashboard/DarlehenVerwaltung.tsx:169-171 (bere…` | fertig |
| **Bankbuchungen zum Darlehen ansehen (IBAN-Treffer)** | Zeigt bis zu 100 Zahlungen, deren zahlungen.iban die hinterlegte Kontonummer enthaelt — reine Anzeige,… | `src/components/dashboard/DarlehenVerwaltung.tsx:222-237` | teilweise |
| **Annuitaet in der Mietaufstellung fuer die Bank** | Summiert je Objekt die Monatsraten aller verknuepften Darlehen und weist daraus den Ueberschuss p.a.… | `src/components/dashboard/MietaufstellungBank.tsx:72-85` | fertig |
| **Annuitaet in der druckbaren Mietuebersicht** | Gleiche Annuitaetsermittlung aus darlehen_immobilien fuer die Bildschirm- und Druckuebersicht; ersetzt… | `src/components/dashboard/EditableMietUebersichtModal.tsx:265-…` | fertig |
| **Darlehenssuche im globalen Suchfeld** | Sucht ueber Bezeichnung, Bank und Kontonummer; ein Treffer oeffnet lediglich die Darlehensuebersicht,… | `src/components/dashboard/SearchPanel.tsx:111-115` | teilweise |
| **Eigenkapital- und Portfolioauswertung mit Restschuld** | Rechnet Gesamtrestschuld und Eigenkapital aus immobilien.restschuld statt aus den Darlehenskonten;… | `src/components/dashboard/Analytics.tsx:76-78 und :216-221` | prototyp |
| **Darlehens- und Versicherungskontext fuer den Chatbot** | Baut je Darlehen Restschuld, Tilgungsgrad und zugeordnete Objekte sowie die Versicherungsliste samt… | `supabase/functions/chat/index.ts:105-111` | fertig |
| **Darlehensauskunft der agent-api (Telegram-Assistent)** | Zwei Lesewerkzeuge fuer Uebersicht und Details inklusive "letzter Tilgungszahlung"; die… | `supabase/functions/agent-api/index.ts:160-163 (rpc_agent_loan…` | teilweise |
| **Restschuld per Assistent aktualisieren** | Schreibwerkzeug update_loan_balance setzt darlehen.restschuld, findet das Darlehen notfalls per… | `supabase/functions/agent-api/index.ts:641-654 (Tool)` | fertig |
| **Versicherungen je Objekt pflegen** | Anlegen, Bearbeiten und Loeschen von Policen mit Typ, Firma, Vertragsnummer, Kontaktperson, Telefon,… | `src/components/dashboard/ImmobilienVersicherungenTab.tsx:104-…` | fertig |
| **Versicherungsdokumente hochladen, ansehen, herunterladen, loeschen** | PDF-Upload ueber useDocumentUpload mit Kategorie "Versicherungen", Vorschau und Download ueber… | `src/components/dashboard/ImmobilienVersicherungenTab.tsx:194-…` | teilweise |
| **Versicherungssuche im globalen Suchfeld** | Sucht Policen ueber Firma, Typ, Vertragsnummer, Kontaktperson, E-Mail und Telefon objektuebergreifend —… | `src/components/dashboard/SearchPanel.tsx:102-109` | fertig |

## Dokumente, Storage, OCR

| Funktion | Was sie leistet | Einstieg | Reife |
|---|---|---|---|
| **Dokument hochladen (zentraler Weg)** | Legt die Datei unter <mietvertragId/immobilieId/'general'>/<timestamp>_<zufall>.<ext> im Bucket ab und… | `src/hooks/useDocumentUpload.ts:22` | teilweise |
| **Datei per Drag-and-Drop ablegen** | Overlay-Zone mit Endungs-/MIME-Pruefung gegen accept (Standard .pdf,.jpg,.jpeg,.png,.doc,.docx, Zeile… | `src/components/dashboard/DocumentDragDropZone.tsx:13` | fertig |
| **Objektdokumente verwalten** | Liste, Upload, Vorschau, Download, Kategoriewechsel und Soft-Delete fuer Dokumente einer Immobilie. | `src/components/dashboard/ImmobilienDocumentsTab.tsx:35 (einge…` | teilweise |
| **Vertragsdokumente verwalten** | Gruppierte Liste nach Kategorie mit Sortierung, Upload, Vorschau im neuen Tab, Download und Soft-Delete. | `src/components/dashboard/mietvertrag-details/MietvertragDocum…` | fertig |
| **Kategorie eines Dokuments nachtraeglich aendern** | Select-Feld schreibt kategorie direkt auf die Zeile; die angebotenen Werte weichen je Ansicht… | `src/components/dashboard/mietvertrag-details/MietvertragDocum…` | teilweise |
| **Dokument loeschen (Soft-Delete)** | Setzt nur geloescht=true; die Datei bleibt im Bucket und es gibt im gesamten Code keinen Weg zurueck… | `src/components/dashboard/mietvertrag-details/MietvertragDocum…` | teilweise |
| **Dokumentvorschau im Dialog (PDF/Bild/HTML)** | Rendert PDF-Seiten per pdfjs auf ein Canvas mit Blaettern, zeigt Bilder und HTML ueber eine… | `src/components/dashboard/PdfPreviewModal.tsx:19` | teilweise |
| **Vorschau im neuen Browser-Tab** | Oeffnet die signierte URL (3600 s) direkt; der Vertrags-Tab nutzt diesen Weg statt des Vorschau-Dialogs. | `src/components/dashboard/mietvertrag-details/MietvertragDocum…` | fertig |
| **Dokument herunterladen** | Erzeugt eine 60-Sekunden-Signatur, holt den Blob und loest den Browser-Download unter dem Titel aus. | `src/components/dashboard/mietvertrag-details/MietvertragDocum…` | fertig |
| **Versicherungsdokumente je Objekt** | Upload fest mit kategorie 'Versicherungen'; die Zuordnung zu einer konkreten Versicherung erfolgt nur… | `src/components/dashboard/ImmobilienVersicherungenTab.tsx:88 u…` | teilweise |
| **Globale Dokumentensuche** | Sucht bis zu 6 Treffer im Titel; durch immobilien!inner sind Vertragsdokumente ohne immobilie_id nicht… | `src/components/dashboard/SearchPanel.tsx:117-126` | teilweise |
| **Erzeugte Mahnung archivieren** | Legt das jsPDF-Schreiben unter mahnungen/<vertragId>/ ab (upsert:true) und schreibt eine… | `src/components/dashboard/MahnungErstellungModal.tsx:271-299` | fertig |
| **Erzeugte Mieterhoehung archivieren** | Ablage unter mieterhoehungen/<vertragId>/ (upsert:true) plus dokumente-Zeile 'Schriftverkehr'. | `src/components/dashboard/rent-increase/RentIncreaseModal.tsx:…` | fertig |
| **Erzeugte Kuendigung archivieren** | Ablage unter kuendigungen/<vertragId>/ (upsert:true) plus dokumente-Zeile 'Kuendigung'. | `src/components/dashboard/termination/TerminationDialog.tsx:26…` | fertig |
| **Kuendigungsschreiben hochladen** | Prueft Typ (PDF/JPG/PNG) und Groesse (max. 10 MB), legt die Datei ohne Ordner in der Bucket-Wurzel als… | `src/components/dashboard/termination/TerminationDialog.tsx:32…` | teilweise |
| **Uebergabeprotokoll und Zaehlerfotos ablegen** | Registriert jedes Zaehler- und Zustandsfoto je Vertrag als eigene dokumente-Zeile… | `src/components/dashboard/handover/UebergabeDialog.tsx:493-575` | fertig |
| **Zaehler- und Notizfotos aufnehmen** | Kamera-Upload nach zaehlerfotos/<vertragId>/ bzw. uebergabefotos/<vertragId>/ mit upsert:true; Anzeige… | `src/components/dashboard/handover/MeterPhotoUpload.tsx:64-90 …` | teilweise |
| **Fotos EXIF-korrigiert und verkleinert ins PDF einbetten** | Dreht Handyfotos ueber ein Canvas gerade (jsPDF wertet EXIF nicht aus) und rechnet sie auf 1600 px… | `src/utils/pdfImageUtils.ts:1-24 und :73` | fertig |
| **Mietvertrags-PDF erzeugen und ablegen** | Speichert unter mietvertraege/<vertragId>/ mit upsert:false und dokumente-Zeile 'Mietvertrag'; in der… | `src/components/dashboard/MietvertragErstellungModal.tsx:188-2…` | prototyp |
| **Bildschirmfotos an Aufgaben** | Legt die Aufnahme unter aufgaben/<uuid>/ ab (bewusst vor dem Ticket-Insert) und haelt sie ueber… | `src/hooks/useAufgaben.ts:128-138` | fertig |
| **Mietvertrag per KI aus PDF auslesen (OCR-Import)** | Zieht den Textlayer aus max. 5 Seiten; bleibt zu wenig Text uebrig, wird die erste Seite als JPEG… | `src/components/dashboard/NewTenantContractDialog.tsx:259-383 …` | teilweise |
| **Vertrags-PDF beim Anlegen mitspeichern** | Legt die hochgeladene Datei flach in der Bucket-Wurzel als <vertragId>_<ts>.<ext> ab; ein Fehler beim… | `src/components/dashboard/NewTenantContractDialog.tsx:557-585` | teilweise |
| **Dokumente im Chatbot und ueber die agent-api** | Liefert reine Metadaten (Titel, Kategorie, Dateityp, Datum), gefiltert auf geloescht=false; der Chat… | `supabase/functions/chat/index.ts:112 und supabase/functions/a…` | fertig |

## Aufgaben, Benachrichtigungen, Meldungen

| Funktion | Was sie leistet | Einstieg | Reife |
|---|---|---|---|
| **Problem per Bildschirmaufnahme melden** | Ein Klick nimmt den aktuellen Tab per getDisplayMedia auf (utils/bildschirmaufnahme.ts:78-105), der… | `src/components/aufgaben/MelderLeiste.tsx:65-90 (Kamera-Knopf)` | fertig |
| **Meldung auch ohne Aufnahme** | Schlaegt die Aufnahme fehl oder wird sie abgelehnt, oeffnet der Dialog trotzdem und zeigt den Grund als… | `src/components/aufgaben/MelderLeiste.tsx:84-89` | fertig |
| **Bild aus Zwischenablage oder Datei anhaengen** | Strg+V uebernimmt ein Bild aus der Zwischenablage, alternativ waehlt man eine Bilddatei; beides laeuft… | `src/components/aufgaben/ProblemMeldenDialog.tsx:68-99` | fertig |
| **Technischen Kontext mitschicken** | Pfad, Seitentitel, Fenstermasse, Pixelverhaeltnis, Browser und Zeitpunkt werden vor der Aufnahme… | `src/utils/bildschirmaufnahme.ts:54-64` | fertig |
| **Melde-Knoepfe waehrend der Aufnahme ausblenden** | Das Kennzeichen html[data-aufnahme] blendet den Knopfstapel .schwebende-knoepfe aus, damit er nicht… | `src/utils/bildschirmaufnahme.ts:86 + src/index.css:388-393` | fertig |
| **Aufgaben-Board mit Sichten, Suche und Filtern** | Liste aller Aufgaben mit den Sichten "Fuer mich", "Offen", "Alle", Volltextsuche sowie Filtern nach Art… | `src/components/aufgaben/AufgabenBoard.tsx:32-209` | fertig |
| **Aufgabe anlegen, aendern, loeschen** | Titel, Art, Status, Dringlichkeit, Verantwortlicher und Beschreibung sind pflegbar; Loeschen entfernt… | `src/components/aufgaben/AufgabeDetail.tsx:45-299 ueber useAuf…` | teilweise |
| **Personen auf einer Aufgabe markieren (Erwaehnungen)** | Markierte Personen werden in dev_ticket_erwaehnungen gefuehrt und per Trigger benachrichtigt; im Board… | `src/components/aufgaben/BenutzerAuswahl.tsx + useAufgaben.ts:…` | teilweise |
| **Kommentarverlauf je Aufgabe** | Rueckfragen werden als Kommentare an der Aufgabe festgehalten; jeder neue Beitrag benachrichtigt… | `src/components/aufgaben/AufgabeKommentare.tsx:22-99` | fertig |
| **Benachrichtigungs-Glocke (Posteingang)** | Zeigt ungelesene Meldungen mit Zaehler, markiert einzeln oder alle als gelesen und springt per Klick in… | `src/components/aufgaben/BenachrichtigungsGlocke.tsx:31-149` | teilweise |
| **Live-Zustellung neuer Benachrichtigungen** | Realtime-Abo auf benachrichtigungen mit Filter auf den eigenen Empfaenger blendet eine Einblendung ein… | `src/hooks/useBenachrichtigungen.ts:92-125` | fertig |
| **Benachrichtigungen ausschliesslich per Datenbank-Trigger** | Vier Trigger (neue Aufgabe, Zuweisung/Statuswechsel, Erwaehnung, Kommentar) erzeugen die Eintraege,… | `supabase/migrations/20260903153000_aufgaben_und_benachrichtig…` | fertig |
| **Aufgabe aus einer Benachrichtigung direkt oeffnen** | Der Klick auf eine Meldung legt selectedAufgabe im Navigationszustand ab; das Board klappt die Aufgabe… | `src/components/aufgaben/AufgabenBoard.tsx:47-51` | fertig |
| **Erledigt-Zeitpunkt automatisch fuehren** | Beim Wechsel auf "fertig" setzt die Datenbank erledigt_am, jeder andere Status loescht es wieder -… | `Migration 20260903153000:126-144 (setze_erledigt_am)` | fertig |
| **Sortier- und Darstellungsregeln des Boards (getestet)** | Erledigtes ans Ende, davor die dringendste, bei Gleichstand die zuletzt gemeldete zuerst; unbekannte… | `src/components/aufgaben/aufgabenDarstellung.ts:81-97` | fertig |
| **Internes Personenverzeichnis fuer Erwaehnungen** | Fuenf interne Personen mit Kuerzel und Funktion, bewusst getrennt von auth.users, damit die Buchhaltung… | `src/hooks/useAppBenutzer.ts:42-87` | teilweise |
| **Bildschirmfotos im privaten Bucket ablegen und signiert anzeigen** | Dateien liegen unter aufgaben/<uuid>/ im Bucket dokumente und bekommen erst beim Anzeigen eine fuer… | `src/hooks/useAufgaben.ts:128-138 (Upload) und :266-270 (signi…` | teilweise |
| **Herkunftsangabe einer Meldung** | Zeigt Melder, Zeitpunkt, Kennzeichen "per Bildschirmaufnahme", Seitentitel/Pfad, Fenstermasse und… | `src/components/aufgaben/AufgabeDetail.tsx:334-371` | fertig |
| **Zugangssperre fuer den Hausmeister** | RLS beschraenkt Aufgaben, Kommentare, Erwaehnungen und den Storage-Praefix aufgaben/ auf Admins; das… | `Migration 20260903153000:388-415 und 448-490` | fertig |
| **Aktivitaetenlog (Wer hat was geaendert)** | Liest die letzten 500 Zeilen aus activity_logs und formuliert daraus lesbare Saetze; sichtbar… | `src/components/dashboard/DevActivityLog.tsx:186-327` | teilweise |
| **Aktivitaeten protokollieren** | Schreibt Aktion, Entitaet und Details nach activity_logs - bewusst ohne Fehlerbehandlung; tatsaechlich… | `src/hooks/useActivityLog.ts:22-49` | teilweise |
| **Chilla Agent-Logs auswerten** | Kennzahlen der letzten 24 h, Diagramme ueber 7 Tage, gefilterte Liste, Live-Strom der letzten 10… | `src/components/dashboard/AgentLogViewer.tsx:140-` | teilweise |
| **Systemprotokoll der Turnus-Functions** | Faelligkeitspruefung und Mahnungsversand schreiben Freitextzeilen nach system_logs; im Frontend liest… | `supabase/functions/check-faelligkeiten/index.ts:104-110` | teilweise |
| **Wartesperre fuer Passwort-Zuruecksetzung ueber app_benutzer** | Der Zeitpunkt der letzten Reset-Mail steht in app_benutzer.letzte_reset_mail und sperrt erneutes Senden… | `supabase/functions/send-passwort-reset/index.ts:29` | fertig |

## Zugang, Rollen, Assistent, Auswertungen

| Funktion | Was sie leistet | Einstieg | Reife |
|---|---|---|---|
| **Anmelden mit E-Mail und Passwort** | Supabase-Login per E-Mail/Passwort mit uebersetzten Fehlermeldungen; nach Erfolg leitet Auth.tsx:23-27… | `src/components/auth/AuthForm.tsx:80-99 (ueber src/pages/Auth.…` | fertig |
| **Selbstregistrierung** | Die Maske bietet weiterhin supabase.auth.signUp an; ein so angelegtes Konto bekommt keine Zeile in… | `src/components/auth/AuthForm.tsx:100-128` | prototyp |
| **Passwort vergessen — Link anfordern** | Eigener Mailweg ueber den bestaetigten Mahnungs-SMTP statt des Supabase-Auth-Mailers; die Antwort ist… | `src/components/auth/AuthForm.tsx:28-50 → supabase/functions/s…` | fertig |
| **Neues Passwort vergeben** | Der Token steht hinter der Raute, wird per verifyOtp selbst eingeloest (Zeile 42-45), aus der… | `src/pages/PasswortNeu.tsx:32-84` | fertig |
| **Sitzung halten und abmelden** | AuthProvider haelt user/session global, UserMenu zeigt E-Mail und Konto-Kennung und meldet ab. | `src/hooks/useAuth.tsx:23-75` | fertig |
| **Routenschutz** | Leitet ohne Sitzung auf /auth um; ist ausdruecklich nur Komfort, die eigentliche Grenze ist RLS. | `src/components/auth/ProtectedRoute.tsx:15-38` | fertig |
| **Rollenerkennung (admin / hausmeister)** | Liest genau eine Zeile aus user_roles und leitet isAdmin/isHausmeister ab; Fehler werden zu null… | `src/hooks/useUserRole.ts:10-38` | teilweise |
| **Rollenabhaengige Oberflaeche** | Hausmeister bekommt ein eigenes Dashboard, alle Aktionsknoepfe, Kennzahlen, Rueckstands- und… | `src/pages/Index.tsx:292-294` | fertig |
| **Hausmeister-Dashboard (Zaehlerstaende erfassen)** | Objekte aufklappen, Hausanschluss- und Einheitenzaehler samt Nummer, Stand und Datum eintragen und je… | `src/components/dashboard/HausmeisterDashboard.tsx:52-130` | teilweise |
| **Entwickleransicht per E-Mail-Abgleich** | Wer mit der in VITE_DEV_EMAIL hinterlegten Adresse angemeldet ist, sieht zusaetzlich den Knopf zum… | `src/pages/Index.tsx:43 mit src/constants/config.ts:7` | teilweise |
| **Internes Personenverzeichnis (Erwaehnungen, Melder)** | app_benutzer ist bewusst von auth.users getrennt, damit Personen ohne Konto erwaehnt werden koennen;… | `src/hooks/useAppBenutzer.ts:42-87` | teilweise |
| **Aktivitaetsprotokoll (Wer hat was geaendert)** | Schreibt fachliche Aenderungen nach activity_logs; nur sechs der dreizehn deklarierten Aktionsarten… | `src/hooks/useActivityLog.ts:22-50` | teilweise |
| **Chatbot Chilla im Dashboard** | Schwebender Knopf oeffnet einen Streaming-Chat; die Function laedt siebzehn Tabellen und baut daraus… | `src/components/chatbot/ModernChatbotTrigger.tsx:105 (aus src/…` | teilweise |
| **Aussenschnittstelle Chilla (Telegram-Assistent)** | Mit x-agent-key geschuetzte Schnittstelle mit 27 lesenden rpc_agent_*-Werkzeugen und 12 weiteren, davon… | `supabase/functions/agent-api/index.ts:1079-1199` | teilweise |
| **Anti-Halluzinations-Regelwerk des Agenten** | Der Systemtext verbietet Erfolgsmeldungen ohne Tool-Aufruf; set_mahnstufe liest den gespeicherten Wert… | `supabase/functions/agent-api/index.ts:19-34` | fertig |
| **Chilla-Protokoll (Agent-Logs)** | Admin-Ansicht ueber agent_logs mit Kennzahlen, Diagrammen und Tool-Aufrufen; geschrieben wird dort nur… | `src/components/dashboard/AgentLogViewer.tsx (Aufruf src/pages…` | fertig |
| **Bewerbungs-Blacklist pflegen** | Gesperrte Mietinteressenten mit Name, Mail, Telefon und Grund anlegen, suchen und loeschen; beide… | `src/components/dashboard/BlacklistVerwaltung.tsx:36-80 (Aufru…` | fertig |
| **Dashboard-Kennzahlen (Soll-Ist der Monatsmiete)** | Zaehlt Immobilien, Einheiten, Leerstand, gekuendigte Vertraege und stellt erwartete gegen erfasste… | `src/components/dashboard/DashboardStats.tsx:113-123` | fertig |
| **Basiszins und VPI direkt korrigieren** | Admins koennen den Basiszinssatz und den Verbraucherpreisindex inline ueberschreiben; der Eintrag geht… | `src/components/dashboard/DashboardStats.tsx:97-108` | fertig |
| **Analytics (Zeitreihen, Rendite, Prognose)** | Portfoliowert, Rendite, Vermietungsgrad, Cashflow und Wertprognose ueber 6/12/24 Monate; mehrere… | `src/components/dashboard/Analytics.tsx:70-290 (Aufruf src/pag…` | prototyp |
| **Mietaufstellung fuer die Bank** | Druckbare Aufstellung je Objekt mit qm, Kalt-, Warm- und SOLL-Miete gegen die Annuitaet; SOLL-Miete ist… | `src/components/dashboard/MietaufstellungBank.tsx:60-195 (Aufr…` | fertig |


## Gebaut, aber nicht erreichbar

Am 06.09.2026 wurden 30 Vorgänger-Fassungen entfernt (7380 Zeilen). Diese acht Dateien blieben: Sie sind
vollständig gebaut, haben eigenständigen fachlichen Wert, aber keinen Einstieg in der Oberfläche. Sie stehen in
der Ausnahmeliste von `src/erreichbarkeit.test.ts`, der ab jetzt meldet, wenn neuer unerreichbarer Code entsteht.

| Funktion | Ort | Warum behalten |
|---|---|---|
| Pflege der Nichtmiete-Regeln | `src/components/controlboard/NichtmieteRegelnManager.tsx` | Ohne sie sind die Regeln der Zahlungszuordnung nur per SQL änderbar |
| Aufteilung rückgängig machen | `src/components/dashboard/PaymentUndoSplitModal.tsx` | Eigener Dialog für einen Vorgang, der sonst nur umständlich geht |
| Objektübergreifende Zahlungssicht | `src/components/dashboard/ZahlungenUebersicht.tsx` | Vollständige Ansicht ohne Navigationseintrag |
| WhatsApp-Posteingang | `src/components/dashboard/WhatsappNachrichten.tsx` | Die Tabelle wird von außen befüllt; die Nachrichten sind sonst unsichtbar |
| Übergabe-Einstieg an Einheit/Vertrag | `src/components/dashboard/handover/UebergabeButton.tsx` | Direkter Weg in die Übergabe samt Freigaberegel |
| Gewerbe-Klauselwerk §§ 1–26 | `src/utils/mietvertrag/gewerbeKlauseln.ts` | Siehe offene-punkte.md D3 — Gewerbeverträge bekommen sonst Wohnraumklauseln |
| Stellplatz- und Küchen-Nebenverträge | `src/utils/mietvertrag/nebenvertraege.ts` | Fertig und getestet, ohne UI-Einstieg |
| Generator für Gewerbe-/Nebenverträge | `src/utils/mietvertrag/nebenvertragPdfGenerator.ts` | Gehört zu den beiden Vorgenannten |
