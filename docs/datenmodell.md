# Datenmodell und Zustände

Entitäten, ihre Beziehungen und alle Zustände, die sie annehmen können. Erhoben am Code und am generierten
Schema (`src/integrations/supabase/types.ts`), Stand 06.09.2026. Maßgeblich für das Schema ist die Live-Datenbank
(Projekt `kmtgzrnpitlslivdvlyq`), nicht der Migrationsordner — siehe [architektur.md](architektur.md).

## 1. Landkarte

```
immobilien ─┬─ einheiten ──┬─ mietvertrag.einheit_id       Hauptobjekt des Vertrags (1:n)
            │              ├─ mietvertrag_einheiten        Nebenobjekte — im UI nicht befüllbar
            │              └─ nebenkosten_anteile          Altstruktur, ungenutzt
            ├─ nebenkostenarten ─ kostenpositionen ─ kostenposition_anteile ─→ einheiten
            ├─ versicherungen · darlehen_immobilien ─ darlehen ─ darlehen_zahlungen (ungenutzt)
            └─ zahlungen.immobilie_id                      Objektbezug (Nebenkosten/Nichtmiete)
mietvertrag ┬─ mietvertrag_mieter ─ mieter                 echte m:n, mit rolle + position
            ├─ mietforderungen · zahlungen · dokumente
            └─ nebenkosten_abrechnungen                    Jahr, Kosten, Vorauszahlung, Saldo, Versand
```

**Vertrag ↔ Einheit ist keine m:n-Beziehung.** Das Hauptobjekt steht in `mietvertrag.einheit_id`.
`mietvertrag_einheiten` hat seit dem 24.08.2026 einen eigenen Primärschlüssel, damit PostgREST dort keine
m:n-Beziehung ableitet (vorher: HTTP 300 / PGRST201 bei neun Abfragen). Diesen Primärschlüssel nie entfernen.

**Zahlungsbezug ist ein Entweder-Oder.** Eine Zahlung hängt entweder am Vertrag (`mietvertrag_id`) oder am Objekt
(`immobilie_id`). Beim Umbuchen auf eine Objektkategorie setzt der Code `immobilie_id` **und** `mietvertrag_id =
null` (`MietvertragTimelineView.tsx:257-259`). Beide Felder gleichzeitig zu füllen zählt die Zahlung doppelt.

## 2. Zustandsmodelle

### Mietvertrag — `status` (Enum `mietstatus`)

| Zustand | Bedeutung | Wer setzt ihn |
|---|---|---|
| `aktiv` | laufendes Mietverhältnis | Vertragsanlage |
| `gekuendigt` | gekündigt, Ende terminiert, Mieter wohnt noch | `TerminationDialog` (beide Wege), `agent-api.terminate_contract` |
| `beendet` | Mietverhältnis vorbei | `useAutoExpireContracts`, DB-Funktion `update_expired_terminated_contracts` |

Übergänge nur vorwärts; einen Weg zurück von `beendet` gibt es im UI nicht.

**Das Vertragsende steht in zwei Feldern.** `ende_datum` ist laut Migration führend, `kuendigungsdatum` nur Beleg.
Vier von fünf Schreibstellen setzen beide — ausgerechnet der im UI eingebundene manuelle Kündigungsweg
(`TerminationDialog.tsx:273-280`) setzt `ende_datum` nicht. Lesen deshalb **immer** über `getVertragsende()`.
Ausnahme mit Absicht: die Betriebskostenabrechnung nimmt in `vertragsNutzungsende()` das *frühere* der beiden
Daten, weil dort das tatsächliche Nutzungsende zählt. Diese beiden Regeln nicht vereinheitlichen.

### Weitere Zustände am Vertrag

| Feld | Werte | Besonderheit |
|---|---|---|
| `mahnstufe` | 0–3 | steigt **nur** durch erfolgreichen Mahnungsversand; manuell nur zurücksetzbar |
| `kaution_status` | Freitext, faktisch immer `offen` | abgeleiteter Wert, wird nie nachgezogen — Chatbot gibt ihn wörtlich aus |
| `mietanpassung_art` | `keine` \| `staffel` \| `index` | Staffelplan in `staffelplan` (JSON), Index in `index_basis_*` |
| `betriebskosten_modus` | `vorauszahlung` \| `pauschale` \| `inklusiv` | steuert § 4 des Vertrags |
| `vertragsart` | `wohnraum` \| `gewerbe` \| `stellplatz` \| `sonstiges` | **im UI nicht wählbar**, immer `wohnraum` |
| `lastschrift` | bool | mit `sepa_mandat_datum`, `sepa_mandatsreferenz`, `lastschrift_wartetage` |
| `uebergabezustand` | `renoviert` \| `teilrenoviert` \| `unrenoviert` | Pflichtangabe der Vertragserzeugung |

### Einheit — Leerstand ist kein Feld

Es gibt **keinen** Statuswert an der Einheit. „Leer" wird an zehn Stellen unterschiedlich berechnet:
`EinheitCard` über den aktuellsten Vertrag, `EinheitHistorieView` über Lücken von mehr als fünf Tagen,
`MietaufstellungBank` datumsgenau über `getLaufenderVertrag()`, der Chatbot wieder anders. Verbindlich ist
`istLaufenderVertrag()` / `getLaufenderVertrag()` aus `utils/contractUtils.ts` — alles andere ist Altbestand.

| Feld | Werte |
|---|---|
| `einheitentyp` | Wohnung, Gewerbe, Stellplatz, Garage, Haus, Lager, Sonstiges |
| `einbaukueche` | bool — löst im Vertrag den (nicht angeschlossenen) Küchen-Leihvertrag aus |
| Zählerstände | `strom_/gas_/kaltwasser_/warmwasser_stand_aktuell` + `_datum` + Nummer |

### Forderung — `mietforderungen`

| Feld | Werte | Wer setzt |
|---|---|---|
| `ist_faellig` / `faellig_seit` | bool / Datum | `check-faelligkeiten` (Cron) |
| `typ` | `null` oder `Miete`, sonst Sonderforderung | Cron überschreibt `sollbetrag` nur bei `null`/`Miete` |

`sollbetrag` ist zugleich abgeleiteter Wert und Buchungsbeleg: Der Cron zieht jede Abweichung über einen Cent auf
`kaltmiete + betriebskosten` zurück. `heizkosten_vorauszahlung` geht **nicht** ein — bei Verträgen mit gesonderter
Heizkostenvorauszahlung ist die Sollstellung dauerhaft zu niedrig.

### Zahlung — `zahlungen`

| Feld | Werte |
|---|---|
| `kategorie` (Enum `zahlkategorien`) | Miete, Nichtmiete, Mietkaution, Ignorieren, Rücklastschrift, Nebenkosten, Betriebskostenabrechnung |
| `zugeordneter_monat` | `YYYY-MM` — entscheidet die Verrechnung, nicht das Buchungsdatum |
| Bezug | entweder `mietvertrag_id` **oder** `immobilie_id` (s. o.) |
| implizit „aufgeteilt" | eine Zahlung wurde in Teilzahlungen zerlegt — kein Feld, nur aus den Datensätzen ableitbar |

Vorauszahlungen: Hat der zugeordnete Monat keine Forderung, verrechnet `rueckstandsberechnung.ts` die Zahlung
rechnerisch auf den nächsten Monat mit Forderung.

### Aufgabe — `dev_tickets`

`status` (Freitext), `prioritaet`, `typ`, `quelle` (`meldung` aus dem Problemdialog oder manuell), `erledigt_am`
wird per Trigger `setze_erledigt_am` gesetzt. Benachrichtigungen entstehen **ausschließlich über DB-Trigger**
(`benachrichtige_bei_aufgabe`, `…_aenderung`, `…_erwaehnung`, `…_kommentar`), damit nichts verlorengeht, wenn der
Browser geschlossen ist.

### Weitere

| Entität | Feld | Werte |
|---|---|---|
| `mietvertrag_mieter` | `rolle` / `position` | Hauptmieter, Zweitmieter, Drittmieter / Reihenfolge — **beide werden nie geschrieben** |
| `mieter` | `ist_unternehmen` | wird nie geschrieben; Firmen landen als Privatperson |
| `vermieter` | `stammdaten_geprueft`, `ist_standard`, `vertretung_art` | `stammdaten_geprueft=false` erzeugt eine Warnung im Vertrag |
| `nebenkosten_klassifizierungen` | `bestaetigt`, `uebersprungen`, `confidence` | KI-Vorschlag mit Bestätigungszustand |
| `dokumente` | `geloescht` | Soft-Delete; `kategorie` als Enum |
| `app_benutzer` | `aktiv`, `darf_aufgaben`, `funktion` | Personen **ohne** Login-Konto, für Zuweisung und Erwähnung |
| `zaehlerstand_historie` | `quelle` | Freitext ohne Enum — dieselbe Herkunft steht in zwei Schreibweisen |
| `immobilien` | `ist_angespannt` | steuert Kappungsgrenze und Mietpreisbremse |

## 3. Doppelte Wahrheiten

Stellen, an denen dieselbe Aussage mehrfach gespeichert ist und auseinanderlaufen kann.

| Aussage | Ablagen | Führend | Zustand |
|---|---|---|---|
| Vertragsende | `ende_datum`, `kuendigungsdatum` | `ende_datum` | manueller Kündigungsweg füllt es nicht |
| Zählerstand | `einheiten.*_stand_aktuell`, `zaehlerstand_historie`, `mietvertrag.*_einzug/_auszug` | keine | kein Schreibweg bedient alle drei |
| Restschuld Darlehen | `darlehen.restschuld`, Analytics-Berechnung, Chatbot | `restschuld` | drei verschiedene Zahlen bei leerem Feld |
| Betriebskosten | `betriebskosten`, `betriebskosten_positionen` | `betriebskosten` | Summengleichheit nur beim PDF-Druck geprüft |
| Kaution | `kaution_betrag`, `kaution_ist`, `kaution_status` | Beträge | Status wird nie nachgezogen |
| Objektanschrift | `adresse` (Freitext), atomare Felder | atomare Felder | Freitext wird weiterhin angezeigt und exportiert |
| Verteilerschlüssel | `nebenkostenarten`, Code-Katalog, `einheiten.verteilerschluessel_*` | `nebenkostenarten` | zwei Kaskaden wortgleich dupliziert, Einheitenfelder tot |

## 4. Ungenutzte Schemateile

Im Schema vorhanden, im Code ohne Schreibweg: `mietvertrag_einheiten` (nur Lesen fürs Vertrags-PDF),
`nebenkosten_anteile`, `nebenkosten_zahlungen` (nur der Chatbot liest), `darlehen_zahlungen`,
`einheiten.verteilerschluessel_art/_wert`, `mietvertrag.heizkosten_vorauszahlung`,
DB-Funktion `calculate_zeitanteil`. Der Chatbot beantwortet Nebenkosten- und Darlehensfragen teilweise aus genau
diesen veralteten Quellen — seine Antworten weichen deshalb von der Oberfläche ab.

## 5. Enums

`app_role` (admin, hausmeister) · `mietstatus` · `zahlkategorien` · `vertragsart` · `einheitentyp` · `mieterrolle` ·
`objektrolle` (hauptobjekt, nebenobjekt) · `betriebskosten_modus` · `kaution_art` (barkaution, buergschaft,
verpfaendung, sparbuch, keine) · `mietanpassung_art` · `befristungsgrund` (eigenbedarf, bauliche_massnahme,
dienstwohnung) · `uebergabezustand` · `kategorie` (Dokumente) · `anrede` · `objekttyp` · `schliessanlage_art` ·
`vertretungsart` · `energieausweis_typ`.

## 6. Datenbankseitige Logik

Nicht im Frontend, sondern in der Datenbank: `has_role`, `is_admin`, `is_hausmeister`, `mein_app_benutzer_id`,
`lege_benachrichtigung_an` (+ vier Trigger), `generate_monthly_mietforderungen`, `update_faellige_forderungen`,
`update_expired_terminated_contracts`, `check_zahlungs_anomalien`, `calculate_zugeordneter_monat`,
`replace_kostenposition_anteile`, `ist_angespannter_markt`, `hybrid_search`, dazu die `rpc_agent_*`-Funktionen
für den Telegram-Assistenten.

Storage: genau ein Bucket `dokumente` mit den Präfixen `<vertrag|objekt|general>/`, `zaehlerfotos/<vertragId>/`,
`mahnungen/<vertragId>/`, `aufgaben/`. Eine Datei ohne Zeile in `dokumente` ist im UI unsichtbar.
