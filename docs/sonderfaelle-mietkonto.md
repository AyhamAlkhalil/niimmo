# Sonderfälle im Mietkonto

Rückstand, Guthaben und die Monatszahlen der Startseite rechnen auf **einem** Mietkonto je Vertrag
(`berechneMietkontostand()` und `monatsSaldo()` in `src/utils/`). Diese Seite sammelt die Fälle, in denen
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
| Nachzahlung alter Rückstände | Tilgt die älteste Schuld. Auf der Startseite zählt sie nicht als Eingang für den laufenden Monat | `monatsSaldo` (Konto bis einschließlich laufendem Monat) |
| Mehrere Teilzahlungen (z. B. Jobcenter und Mieter) | Werden summiert | Mietkonto |
| Rücklastschrift | Hebt die Zahlung auf; die Gebühr ist eine eigene Forderung (`ruecklastschrift_am`), fällig am Buchungstag, und gilt nie als Monatsmiete | Trigger `create_ruecklastschrift_forderung`, `istMonatsmiete` |
| Sammelzahlung für zwei Verträge (Wohnung + Garage, zwei Garagen) | Die Software teilt nie selbst auf (Entscheidung 28.10.2026). Die Liste weist auf den Gegenbetrag am anderen Vertrag desselben Mieters hin | `useRueckstaende` (`verbundener_gegenbetrag`) |
| Zahlung mit „Kaution“ im Text | Kaution, solange die vereinbarte Kaution nicht voll gezahlt ist. Danach ist ein weiterer Eingang Miete; eine Rückzahlung bleibt Kaution | `process-payments` → `istKautionsbuchung` (Test `processPaymentsKaution.test.ts`) |
| Kaution | Zählt nie im Mietkonto | `zaehltImMietkonto` |

## Forderungen

| Fall | Regel | Umsetzung |
|---|---|---|
| Einzug oder Auszug im Monat | Miete taggenau anteilig wie die Sollstellung (Postgres-Rundung), erste Miete fällig am Mietbeginn. Auf der Startseite steht sie bis dahin unter „Noch offen“, aber noch nicht als Rückstand | `sollMonatsmiete`, Trigger `set_faelligkeitsdatum_trigger` |
| Mieterhöhung in der Vertragsbearbeitung („offizielle Mieterhöhung“) | Gilt ab dem Folgemonat, am Monatsersten ab diesem Monat; der laufende Monat bleibt (Entscheidung 29.10.2026). Eine reine Korrektur der Miete gilt schon für den laufenden Monat. Der Mieterhöhungsdialog arbeitet mit `wirksam_ab` | Trigger `update_forderungen_on_rent_change` (Migration `20261029100000`), `offizielleErhoehungGiltAb` |
| Erlassene Miete (Forderung 0 €) | Gilt als angelegte Monatsmiete; es wird keine Vertragsmiete ersatzweise angenommen | `istMonatsmiete` |
| Minderung | Senkt die Forderung des Monats; fällig mit der Monatsmiete | `nurFaelligeForderungen` |
| Betriebskostennachzahlung (BKA) | Fällig 30 Tage nach Anlage. Vorab gezahlt, steht die Zahlung für die BKA bereit und tilgt keine Miete (§ 366 Abs. 1 BGB) | `bkaVorauszahlung` |
| BKA-Guthaben | Zählt ab seinem Monat; eine Auszahlung gleicht es aus | `nurFaelligeForderungen` |
| BKA-Zahlung ohne BKA-Forderung | Zählt nicht im Mietkonto, bis die Abrechnung als Forderung (Typ BKA) angelegt ist; Hinweis in Liste und Vertrag (Entscheidung 29.10.2026). Ebenso der Teil einer BKA-Zahlung oder -Auszahlung, der über die BKA-Forderungen hinausgeht | `bkaAnrechnung` |
| Sollstellung noch nicht gelaufen (am 1. vor 05:00 UTC) | Die Vertragsmiete gilt als Soll und als erwartete Miete | `sollMonatsmiete` |

## Anzeige

| Fall | Regel | Umsetzung |
|---|---|---|
| Kaltmiete + Betriebskosten ≠ Soll-Miete | Die Faktenzeile zeigt die Vertragsmiete, die Soll-Miete das tatsächlich Geforderte. Der Info-Knopf der Soll-Miete zeigt die Überleitung (anteilige Monate, abweichende Monatsmiete, Gebühren) | `monatsSaldo` → `ueberleitung` |
| „Noch offen“ und Rückstände | Eingang + Noch offen = Soll-Miete. Ab dem Fälligkeitstag ergeben Noch offen und „ältere Rückstände“ die Rückstände der Liste (aktive und gekündigte Verträge) | `monatsSaldo`, `useMietkonto` |
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

Validierung: Eine unabhängige SQL-Umsetzung derselben Regeln stimmte mit der App in 16.920 Fällen überein
(120 Tage × 141 Verträge). Die anteilige Miete stimmte mit der DB-Funktion `monatsanteil` in 6.018 Fällen centgenau überein.
