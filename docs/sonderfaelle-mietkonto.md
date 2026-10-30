# Sonderfälle im Mietkonto

Rückstand, Guthaben und die Monatszahlen der Startseite rechnen auf **einem** Mietkonto je Vertrag
(`berechneMietkontostand()` und `monatsSaldo()` in `src/utils/`; der Rechenkern liegt seit 30.10.2026 in
`supabase/functions/_shared/mietkonto.ts`, damit `send-mahnung` genauso rechnet). Diese Seite sammelt die Fälle, in denen
„Forderung minus Zahlung“ allein ein falsches Bild gäbe, mit der Regel und der Stelle, die sie umsetzt.
Stand 29.10.2026, geprüft an den Live-Daten (141 Verträge, Juli bis Oktober 2026).

Grundregeln: Eine Monatsmiete ist am 8. fällig, beim Einzug am Mietbeginn. Zahlungen tilgen zuerst die
älteste fällige Schuld (§ 366 Abs. 2 BGB). Rückstand ist, was fällig und unbezahlt ist. Guthaben ist, was
über alle fälligen Forderungen hinaus gezahlt wurde und keine Vorauszahlung auf die kommende Miete ist.

## Zahlungen

| Fall | Regel | Umsetzung |
|---|---|---|
| Miete vor dem 8. gezahlt | Vorauszahlung, kein Guthaben, bis die Miete fällig ist | `berechneMietkontostand` (`seitherGezahlt`, Deckung durch nicht fällige Forderungen) |
| Folgemiete ab dem 9. gezahlt (live: am 16., 21., 25., 26., 27.) | Vorauszahlung bis zur Höhe der erwarteten Folgemiete. Entscheidend ist der Zahltag nach dem letzten 8., nicht der zugeordnete Monat — der DB-Trigger ordnet erst ab dem 28. dem Folgemonat zu | `berechneMietkontostand`, erwartete Miete über `sollMonatsmiete` |
| Mehrere Monatsmieten in einer Überweisung | Ohne Aufteilung Guthaben, bis die nächste Miete fällig ist (nicht von einer Doppelzahlung zu unterscheiden). Aufgeteilt mit zugeordnetem Monat gilt der Teil für einen kommenden Monat als Vorauszahlung, auch wenn vor dem 8. gebucht | `berechneMietkontostand` (`zugeordneter_monat >= kommender Monat`) |
| Nachzahlung alter Rückstände | Tilgt die älteste Schuld. Auf der Startseite gilt eine Zahlung zuerst für den Monat, dem sie zugeordnet ist (sonst Buchungsmonat): Wer im Oktober zahlt, aber den April ausließ, hat den Oktober bezahlt und den April als älteren Rückstand (Kundenmeldung 29.10.2026). Was über die Monatsmiete hinausgeht, tilgt die älteste Schuld. Am Saldo ändert das nichts | `monatsSaldo` (`zahlungsMonat`) |
| Mehrere Teilzahlungen (z. B. Jobcenter und Mieter) | Werden summiert | Mietkonto |
| Rücklastschrift | Hebt die Zahlung auf; die Gebühr ist eine eigene Forderung (`ruecklastschrift_am`), fällig am Buchungstag, und gilt nie als Monatsmiete. Der Mieter trägt nur die Pauschale aus dem Vertrag (Kundenentscheidung 29.10.2026): Die Bankgebühr steckt schon im Rückbuchungsbetrag (−503 € für 500 €), angelegt wird nur der Rest der Pauschale (7,50 − 3,00 = 4,50 €). Die 19 alten Gebühren wurden am 30.10.2026 so berichtigt (−68,30 €) | Trigger `create_ruecklastschrift_forderung` (Migration `20261030090000`), `istMonatsmiete` |
| Sammelzahlung für zwei Verträge (Wohnung + Garage, zwei Garagen) | Die Software teilt nie selbst auf (Entscheidung 28.10.2026). Die Liste weist auf den Gegenbetrag am anderen Vertrag desselben Mieters hin | `useRueckstaende` (`verbundener_gegenbetrag`) |
| Zahlung mit „Kaution“ im Text | Kaution, solange die vereinbarte Kaution nicht voll gezahlt ist. Danach ist ein weiterer Eingang Miete; eine Rückzahlung bleibt Kaution | `process-payments` → `istKautionsbuchung` (Test `processPaymentsKaution.test.ts`) |
| Kaution | Zählt nie im Mietkonto | `zaehltImMietkonto` |

## Forderungen

| Fall | Regel | Umsetzung |
|---|---|---|
| Einzug oder Auszug im Monat | Miete taggenau anteilig wie die Sollstellung (Postgres-Rundung), erste Miete fällig am Mietbeginn. Auf der Startseite steht sie bis dahin unter „Noch offen“, aber noch nicht als Rückstand | `sollMonatsmiete`, Trigger `set_faelligkeitsdatum_trigger` |
| Mieterhöhung in Vertragsbearbeitung und Mietübersicht | Seit 30.10.2026 ein Vorgang (Kunde: „Eine Mieterhöhung ist ein Vorgang“): Gewählt wird „gilt ab“ (Monatserster). Rückwirkend zum 1. des laufenden Monats mit deutlichem Hinweis, dann gilt sie sofort samt der schon angelegten Monatsmiete; sonst bleibt der Vertrag bis zum Wirksamkeitstag bei der alten Miete, der Nachtlauf stellt um. Eine Korrektur gilt sofort. Das Verlangen mit Schreiben und E-Mail bleibt im Mieterhöhungsdialog. Vorher (28./29.10.2026): neue Miete sofort im Vertrag, gefordert ab dem Folgemonat — so noch die fünf Erhöhungen vom 28.10. | `mieterhoehungAlsVorgangAnlegen`, `MietaenderungBestaetigung`, RPC `mieterhoehung_zustimmen`, Begründungsart `vereinbarung` (Migration `20261030100000`) |
| Beginn oder Ende nachträglich geändert | Der Trigger zieht die Monatsmieten nach: Grenzmonate anteilig, Monate außerhalb der Laufzeit gelöscht, neue Monate angelegt. Monate vor der letzten Erhöhung tragen eine frühere Miete; dort wird die vorhandene Monatsmiete anteilig umgerechnet (seit 30.10.2026, vorher still übergangen: Auszug am 20.10. nach Erhöhung ließ den Oktober voll stehen). Eine von Hand geänderte Monatsmiete ab der letzten Erhöhung bleibt | Trigger `update_forderungen_on_rent_change`, `miete_vor_erhoehung` (Migration `20261030120000`) |
| „Heute“ in der Datenbank | Deutsche Zeit (`heute_berlin()`) in allen Funktionen des Mietkontos, wie in der Oberfläche. Vorher UTC: Eine Korrektur am 1. zwischen 00:00 und 01:00/02:00 Uhr zog den Vormonat nach | `heute_berlin()` (Migration `20261030120000`) |
| Vertragsende | Beendet wird über das Vertragsende wie `getVertragsende()`: `ende_datum`, sonst `kuendigungsdatum` — nie über ein früheres Kündigungsdatum, wenn das Räumungsende später liegt | `update_expired_terminated_contracts`, `auto_set_beendet_status`, `check_contract_status_on_update` |
| Erlassene Miete (Forderung 0 €) | Gilt als angelegte Monatsmiete; es wird keine Vertragsmiete ersatzweise angenommen | `istMonatsmiete` |
| Minderung | Senkt die Forderung des Monats; fällig mit der Monatsmiete | `nurFaelligeForderungen` |
| Betriebskostennachzahlung (BKA) | Fällig 30 Tage nach Anlage. Vorab gezahlt, steht die Zahlung für die BKA bereit und tilgt keine Miete (§ 366 Abs. 1 BGB) | `bkaVorauszahlung` |
| BKA-Guthaben | Zählt ab seinem Monat; eine Auszahlung gleicht es aus | `nurFaelligeForderungen` |
| Vorauszahlung in der Betriebskostenabrechnung | Je Monat der Betrag, den das Mietkonto verlangt hat: Jede Änderung der Betriebskosten am Vertrag steht seit 30.10.2026 in `betriebskosten_verlauf` mit dem Monat, ab dem sie gilt. Ältere Änderungen sind nicht erfasst, dort gilt der heutige Betrag. Pauschal- und Inklusivmieten werden nicht abgerechnet, im Vertrag nicht umgelegte Arten trägt der Vermieter | `betriebskostenImMonat`, `berechneVorauszahlungen`, `ohneBetriebskostenabrechnung`, `nichtUmgelegteNummern` |
| Mahnstufe 3 (fristlose Kündigung) | Nur, wenn der Mietrückstand (nur Monatsmieten, ohne BKA-Nachzahlung und Gebühren) eine Monatsmiete übersteigt. Der Dialog sperrt, `send-mahnung` rechnet seit 30.10.2026 mit den Daten der Datenbank nach, auch beim Versand einer Vormerkung. Bei gleicher Fälligkeit gilt die Monatsmiete als zuerst getilgt | `kuendigungsrueckstandErreicht`, `mietanteilAmStichtag`, `juengsteZuerst` |
| BKA-Zahlung ohne BKA-Forderung | Zählt nicht im Mietkonto, bis die Abrechnung als Forderung (Typ BKA) angelegt ist; Hinweis in Liste und Vertrag (Entscheidung 29.10.2026). Ebenso der Teil einer BKA-Zahlung oder -Auszahlung, der über die BKA-Forderungen hinausgeht | `bkaAnrechnung` |
| Sollstellung noch nicht gelaufen (am 1. vor 05:00 UTC) | Die Vertragsmiete gilt als Soll und als erwartete Miete | `sollMonatsmiete` |

## Anzeige

| Fall | Regel | Umsetzung |
|---|---|---|
| Soll-Miete auf der Startseite | Aus den Mietverträgen, nicht aus den Forderungen (Kunde 29.10.2026: „sie sind die Basis“): Kaltmiete + Betriebskosten aller aktiven und gekündigten Verträge, die im Monat laufen, bei Ein- oder Auszug taggenau anteilig. Es zählt die im Monat gültige Miete: Eine offizielle Erhöhung, die erst ab dem Folgemonat gilt, zählt erst dort; der Vertrag hat dann schon die neue Miete, die bisherige steht nur in der Monatsmiete-Forderung. Keine Gebühren, keine Minderungen. Kaltmiete + Betriebskosten = Soll-Miete; keine Vertragswerte oder Überleitung (Kunde: „total verwirrend“) | `vertragsMonatsmiete`, `monatsSaldo` → `aufteilung` |
| Pfeil ↑/↓ an Soll-Miete, Kaltmiete, Betriebskosten | Zeigt nur, ob es im nächsten Monat mehr oder weniger wird (Kunde 29.10.2026). Nächster Monat wie oben gerechnet, mit Ein- und Auszügen und dem, was zum Ersten im Voraus vereinbart ist (zugestimmter Erhöhungsvorgang, Staffelstufe). Betrag im Info-Knopf | `sollFolgemonat` |
| Eingang | Alle Miet-Zahlungen, die dem Monat zugeordnet sind, Rücklastschriften mindernd, ohne Deckel (Kunde 29.10.2026). Eine Vorauszahlung im Vormonat zählt dort, eine Doppelzahlung doppelt; Eingang + Noch offen ergibt daher nicht immer die Soll-Miete | `monatsSaldo` |
| „Noch offen“ und Rückstände | Was von der Soll-Miete weder durch Zahlungen für den Monat noch durch ein Guthaben gedeckt ist. Ab dem Fälligkeitstag ergeben Noch offen und „ältere Rückstände“ die Rückstände der Liste (aktive und gekündigte Verträge). Eine Rücklastschriftgebühr zählt erst ab ihrer Fälligkeit | `monatsSaldo`, `useMietkonto` |
| Beendete Verträge | Stehen in der Liste, zählen nicht in den Summen | `FehlendeMietzahlungen` |
| Ladefehler | Kennzahlen zeigen „—“, nie 0 | `DashboardStats` |

## In den Live-Daten (29.10.2026)

- **Fünf Mieterhöhungen vom 28.10.2026:** Oktober noch alte, ab November neue Miete. Zusammen 281,80 € Unterschied zwischen
  Vertragsmiete und Oktober-Soll. Richtig nach der Regel oben. Sie wurden vor dem Einspielen der Trigger-Fassung
  vom Abend erfasst, die den laufenden Monat rückwirkend angehoben hätte.
- **Zwei Verträge mit BKA-Zahlungen ohne BKA-Forderung** (782,53 €). Ihr Mietrückstand steigt dadurch auf 698,26 € bzw.
  482,00 €. Abhilfe: die Abrechnung als BKA-Forderung anlegen.
- **„Kaution“ im Verwendungszweck bei voll gezahlter Kaution:** zwei Verträge (22 Monatsmieten bzw. eine Zahlung),
  korrekt als Miete gebucht. Zwei weitere einzelne Zahlungen mit Kautionstext sind uneindeutig und sollten von Hand
  geprüft werden.
- **Eine Zahlung über 1.800 € ist als Kaution gebucht,** der Text nennt nur Miete. Von Hand prüfen.
- **Ein Mieter mit zwei Garagen zu je 50 €:** an einer Garage 100 € Guthaben, an der anderen 150 € Rückstand
  (Sammelzahlung). Die Zahlung von Hand aufteilen.
- **Ein Mieter zahlte schon vor der Erhöhung 25 € mehr im Monat;** daraus entstand ein Guthaben.
- **Altdaten aus inzwischen behobenen Fehlern:**
  - sieben erste Mieten mit Fälligkeit vor dem Mietbeginn (vor dem 27.10.2026 angelegt);
  - vier Forderungen außerhalb der Vertragslaufzeit.

## Bekannte Grenzen

- **Staffel- oder Mieterhöhung zum Folgemonat:** Zahlt der Mieter die neue Miete vorher, erscheint der Mehrbetrag bis zum 1. als
  Guthaben. Die erwartete Miete ist die heutige Vertragsmiete. Live gibt es derzeit weder Staffelpläne noch anstehende Mieterhöhungen.
- **Zahlungseingang ab dem 9.:** Er gilt als Vorauszahlung, sobald der laufende Monat bezahlt ist. Eine versehentliche Doppelzahlung
  zur Monatsmitte erscheint deshalb erst nach dem nächsten Fälligkeitstag als Guthaben, wenn der Mieter dann auch die nächste Miete zahlt.
- **„Noch offen“ und Zahlungen vor dem 28.:** Auf der Startseite gilt eine Zahlung für den zugeordneten Monat; die DB ordnet erst ab dem
  28. dem Folgemonat zu. Wer die Oktobermiete schon am 23.09. zahlt und noch einen älteren Rückstand hat, steht deshalb unter „Noch
  offen“, bis die Zahlung in der Zahlungsverwaltung dem Oktober zugeordnet ist. Eine Weitergabe des Septemberüberschusses an den
  Oktober wurde am 29.10.2026 an den Live-Daten geprüft und verworfen: Der einzige betroffene Mieter zahlt jeden Monat spät (29.07.
  für Juli, 31.08. für August, 23.09. für September); sein Oktober wäre fälschlich als bezahlt erschienen.
- **Vor dem 8. zeigt die Startseite einen älteren Rückstand früher als die Liste:** Wer am 02.10. für Oktober zahlt und den September
  offen hat, hat auf der Startseite den Oktober bezahlt und den September als älteren Rückstand. Die Liste rechnet die Zahlung bis zur
  Fälligkeit des Oktobers noch auf den September und zeigt erst ab dem 8. denselben Rückstand. Ein Deckel auf den Listenwert rechnete
  die Zahlung doppelt und ließ den Rückstand bis zum 8. ganz verschwinden (Gegenprüfung 29.10.2026).
- **Rücklastschrift im Folgemonat:** Sie gilt wie jede Zahlung für ihren zugeordneten Monat. Platzt die Septemberzahlung erst im
  Oktober, hebt sie auf der Startseite die Oktoberzahlung auf, bis sie in der Zahlungsverwaltung dem September zugeordnet ist. Live
  wurden alle 29 Rücklastschriften im Monat der Zahlung gebucht.

Validierung: Eine unabhängige SQL-Umsetzung derselben Regeln stimmte mit der App in 16.920 Fällen überein
(120 Tage × 141 Verträge). Die anteilige Miete stimmte mit der DB-Funktion `monatsanteil` in 6.018 Fällen centgenau überein.
