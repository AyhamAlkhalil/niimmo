# Architektur und verbindliche Regeln

Wie die Anwendung gebaut ist und wie an ihr gearbeitet wird. Die Regeln sind aus dem Bestand abgeleitet und
gegen den Code belegt; sie gelten für alle Änderungen — auch für kleine.

## 1. Aufbau

React-SPA ohne eigenen Server. Alles, was nicht im Browser läuft, ist Supabase.

```
Browser (Vite/React)          Supabase
─────────────────────         ─────────────────────────────────
pages/Index.tsx  ─┐           Postgres + RLS  ← einzige Sicherheitsgrenze
  alle Ansichten  │  React    Auth
components/       │  Query    Storage (Bucket „dokumente")
hooks/            ├─────────► Edge Functions (Deno, 18 Stück)
utils/  Fachlogik │             ├ Zahlungen/KI/OCR
                  │             ├ PDF/Mail
integrations/     ┘             └ Cron (Sollstellung, Fälligkeit)
```

**Es gibt keine API-Schicht.** Komponenten sprechen über React Query direkt mit `supabase.from(...)`.
Der Query-Key ist der einzige Cache-Schlüssel. Wer eine Abfrage ändert, muss die Invalidierungen mitziehen.

**Es gibt nur vier Routen** (`/auth`, `/passwort-neu`, `/`, `*`). Alles andere sind Ansichten *innerhalb* von
`pages/Index.tsx`, gesteuert über `useNavigationState` (Zustand in `sessionStorage`). Folge: Auf einen einzelnen
Vertrag kann man nicht verlinken, und der Zurück-Knopf des Browsers verlässt die Anwendung.

**Fachlogik gehört nach `src/utils/`.** Dort liegen alle Tests (234 Stück, 14 Dateien). Komponenten sind
ungetestet — Logik in einer Komponente ist Logik ohne Netz.

## 2. Der Kanon — diese Helfer sind verbindlich

Für die folgenden Fragen gibt es genau eine richtige Antwort im Code. Eine zweite Implementierung anzulegen ist
die häufigste Fehlerquelle dieses Projekts.

| Frage | Verbindlich | Nicht verwenden |
|---|---|---|
| Läuft dieser Vertrag? | `istLaufenderVertrag()` / `getLaufenderVertrag()` | eigener Statusvergleich, `getCurrentContract()` für Summen |
| Wann endet er? | `getVertragsende()` | `ende_datum` oder `kuendigungsdatum` direkt |
| Wie hoch ist der Rückstand? | `calculateMietvertragRueckstand()` | Inline-Summen über `zahlungen`/`mietforderungen` |
| Verzugszinsen? | `utils/verzugszinsen.ts` | eigene Zinsrechnung |
| Betriebskosten verteilen? | `utils/nebenkostenBerechnung.ts` | Rechnen in einer Step-Komponente |
| Zahleneingabe? | `components/ui/input.tsx` (normalisiert über `decimalInput.ts`) | rohes `<input type="number">` |
| Zählerstand lesen? | `utils/zaehlerstandUtils.ts` | `parseFloat` auf der Rohkette |
| Name anzeigen? | `utils/benutzerName.ts` | lokale Zusammensetzung |
| Briefseite setzen? | `utils/pdf/briefLayout.ts` (`createLayout`) | eigene `checkPageBreak`/`drawJustifiedText`-Kopie |
| Bild ins PDF? | `blobToPdfImage()` aus `utils/pdfImageUtils.ts` | Blob oder DataURL direkt an `addImage` |
| Firmendaten? | `src/config/company.ts` (Absender), Tabelle `vermieter` (Vertragspartei) | Literal im Generator |

Betrag, Datum und Fläche sind heute 14-fach nachgebaut. Neue Formatierungen kommen aus `contractUtils.ts`
(`formatCurrency`, `formatArea`) und `utils/dateUtils.ts`.

## 3. Fachlogik

- **Rückstand, Forderungs- und Zahlungssumme** ausschließlich über `rueckstandsberechnung.ts`. Die Mahnung rechnet
  heute über eine eigene Inline-Formel, die bezahlte Betriebskostennachzahlungen ignoriert — sie ist zu ersetzen,
  nicht zu kopieren.
- **Die Mahnstufe steigt nur durch erfolgreichen Versand.** Manuell ist ausschließlich Zurücksetzen erlaubt.
  Durchgesetzt im UI, in `useMietvertragMutations` und im `set_mahnstufe`-Tool der `agent-api`; in `send-mahnung`
  muss die neue Stufe serverseitig aus der Datenbank abgeleitet werden, nicht aus dem Request.
- **Der Vertragsgenerator rät nichts.** Fehlt eine Pflichtangabe, entsteht kein PDF. Blocker in
  `pflichtpruefung.ts` nie zu Warnungen abschwächen, um „durchzukommen".
- **Ein Schriftstück, das den Vertrag beendet, muss den Vertrag beenden.** Wer ein Kündigungs- oder
  Räumungsschreiben erzeugt, ändert im selben Vorgang den Status. Heute verletzt: Mahnung Stufe 3.
- **Gesetzliche Grenzwerte gehören an eine Stelle mit Fundstelle im Kommentar** (Kappungsgrenze §558 Abs. 3 BGB,
  15-Monats-Frist, Kaution ≤ 3 Nettokaltmieten, Verzugsbeginn §556b BGB). Keine Zahl ohne Norm.

## 4. Daten und Abfragen

- **Jede Abfrage auf eine wachsende Tabelle braucht `range()` oder ein bewusstes `limit()`.** PostgREST liefert
  still nur 1000 Zeilen. Betroffen sind heute Auswertungen und Zahlungssichten — sie rechnen mit einem Bruchteil
  der Daten, ohne Fehlermeldung.
- **Query-Keys sind stabile, flache Arrays** aus Konstante plus IDs. Kein `join()` über Listen, keine Objekte.
  Wer invalidiert, muss den Key auch tatsächlich vergeben haben.
- **Kein `select('*')` auf breiten Tabellen** (`mietvertrag` hat 72 Spalten). Spalten benennen.
- **Keine Abfrage in einer Schleife oder pro Karte.** Über `in()` bündeln.
- **Schema-Fragen gegen die Live-Datenbank stellen** (MCP `list_tables`, `execute_sql`), nicht gegen den
  Migrationsordner — der ist seit dem 11.08.2026 geleert. Neue Migration als Datei `<YYYYMMDDHHMMSS>_<name>.sql`
  anlegen und gezielt per `apply_migration` einspielen. **Nie `supabase db push`.**
- **Neue DB-Funktionen brauchen `REVOKE EXECUTE … FROM PUBLIC` und `FROM anon`** — sonst vergeben die
  Default-Privilegien im Schema `public` automatisch EXECUTE.
- **Keine doppelten Fremdschlüssel** auf dieselbe Spalte; sie machen PostgREST-Embeds mehrdeutig (PGRST201).

## 5. Oberfläche

Der Ist-Zustand: Es gibt eine vollständige Token-Schicht (`index.css`, `tailwind.config.ts`), aber im
Anwendungscode stehen **2578 fest verdrahtete Palettenfarben gegen 1187 Token-Klassen**. Vier konkurrierende
Kartensprachen, 31 Dialog-Geometrien, Buttonhöhen 81-mal überschrieben, 155 Textstellen unter 12px. Die Folge ist
eine austauschbare „Modern-SaaS"-Optik, während die Eigenschaften eines Fachprogramms fehlen.

**Regeln für neue Oberfläche:**

- **Farben nur über Rollen.** Außerhalb von `components/ui/` keine Klassen der Form `text-/bg-/border-<Palette>-<Zahl>`.
  Verbindlich sind `primary`, `muted`, `destructive`, `border`, `foreground` usw.
- **Statusfarben aus einer Quelle.** Für `aktiv`/`gekuendigt`/`beendet` genau eine Zuordnung, zentral abgelegt.
  Heute gibt es fünf konkurrierende, und die dafür angelegten `.status-badge-*`-Klassen werden nirgends benutzt.
- **Ein Kartentyp: die shadcn-`Card`.** `glass-card`, `metric-card`, `elegant-card` und handgebaute
  `bg-white`-Container werden nicht neu verwendet.
- **Dialoge nutzen feste Größenstufen** (S / M / L / Vollbild). Keine neuen `max-w-[95vw] w-[1400px]`-Rezepte.
- **Wo Masse anfällt, gehört eine Tabelle hin** — mit ausgerichteten Betragsspalten (`tabular-nums`), sortierbaren
  Kopfzeilen und Tastaturnavigation. Die Zahlungszuordnung ist heute eine Kartenliste; das ist der Arbeitsplatz
  der Buchhaltung.
- **Schriftgrößen aus der Skala** (`text-xs` aufwärts). Keine `text-[9px]`-Werte; Dichte entsteht über Zeilenhöhe
  und Spaltenführung, nicht über kleinere Schrift.
- **Jede Ansicht behandelt drei Zustände: lädt, Fehler, leer.** Heute behandeln 155 Stellen `isLoading` und genau
  zwei einen Fehler — die Rückstandsansicht zeigt bei fehlgeschlagener Abfrage die grüne Entwarnung „Alle
  Mietverträge sind ausgeglichen". Ein Fehler darf nie wie ein Erfolg aussehen.
- **Icon-Knöpfe brauchen `aria-label`**, klickbare `<div>` brauchen Rolle, `tabIndex` und Tastaturbehandlung.
- **Eine Toast-Bibliothek.** Heute laufen `use-toast` (47 Dateien) und `sonner` (23) parallel. Neuer Code nutzt
  den in `App.tsx` zuerst montierten Weg; Emoji in Toast-Titeln entfallen.
- **Formulare über `react-hook-form` + `zod`** — beide sind installiert und werden nirgends importiert. Validierung
  gehört ans Feld, nicht in einen Toast beim Absenden.

## 6. Schriftstücke

- **Ein Dokumenttyp, ein Generator, und der liegt in `src/utils/`.** Neue jsPDF-Generatoren in Edge Functions sind
  unzulässig. Muss ein Server versenden, erzeugt der Client das PDF und übergibt es als Base64 oder Storage-Pfad
  (Muster: `NebenkostenStep3Abrechnung` → `send-nebenkostenabrechnung`).
- **Alle Generatoren nutzen `createLayout`** aus `utils/pdf/briefLayout.ts`. Eigene Kopien von `checkPageBreak`,
  `drawJustifiedText`, `addFooter` oder `loadLogo` werden nicht angelegt; die vier Briefgeneratoren tragen heute
  je eine wortgleiche Kopie.
- **Jeder Absatz, jede Tabellenzeile, jedes Bild läuft durch die Umbruchprüfung.** Auch bei festen Mehrseiten-
  Layouts. Jedes mehrseitige Schriftstück ruft am Ende `seitenzahlenSetzen()`.
- **Nur WinAnsi-Zeichen**, solange keine Schrift eingebettet ist. Emoji in Generatortexten entfallen.
- **Zu jedem Generator gehört ein Test nach Muster `pdfSmoke.test.ts`**, der das erzeugte PDF zurückliest.
  Ohne diesen Test wird kein Generator geändert.
- **Erzeugte Dateinamen tragen Datum und Uhrzeit.** Vor jedem `upsert: true` prüfen, dass kein zweiter Codepfad
  denselben Pfad schreibt.
- **Ein Wechsel der Renderkette (DOCX/HTML) ist eine Planner-Entscheidung**, kein Nebenbei-Umbau. Bedingungen und
  Bewertung in [offene-punkte.md](offene-punkte.md).

## 7. Sicherheit

**RLS ist die Sicherheitsgrenze, nicht das Frontend.** Eine Berechtigung, die im UI über `isAdmin` ausgeblendet
wird, muss zusätzlich in RLS oder in der Edge Function durchgesetzt sein — sonst ist sie Kosmetik.

- Alle 18 Edge Functions laufen mit `verify_jwt = false` und **müssen selbst prüfen**. Jede schreibende Function
  wertet nach `auth.getUser()` zusätzlich `is_admin` aus und antwortet sonst mit 403.
- **Der Service-Role-Client wird erst nach bestandener Prüfung erzeugt** — nie oberhalb davon.
- **Nach `auth.getUser()` immer beides prüfen**: `authError` **und** `!userData?.user?.id`.
- **Storage-Pfade und Empfängeradressen nie ungeprüft aus dem Request übernehmen.** Ein `pdfPath` wird gegen die
  übergebene Vertrags-ID validiert, Empfänger werden serverseitig aus `mieter.hauptmail` aufgelöst.
- **Fachliche Werte, die eine Regel tragen, kommen nicht aus dem Request** (z. B. die neue Mahnstufe).
- **Suchbegriffe nie in PostgREST-Filter interpolieren** — vorher auf Buchstaben, Ziffern, Leerzeichen und
  Bindestrich beschränken.
- **Personenbezogene Daten nur im nötigen Umfang an KI-Gateways.** Geburtsdatum, Telefon, Mail, IBAN,
  WhatsApp-Verlauf und Bewerber-Blacklist gehören nicht in einen Systemprompt.
- **Keine Mieternamen, IBANs oder Beträge in `console.log`** — nur IDs, Zählwerte, Entscheidungsgründe.
- **Fehlermeldungen an den Aufrufer sind fachlich und fest**; `error.message` gehört in `console.error`.
- **Deno-Importe mit exakter Version.** Sechs Functions importieren `supabase-js@2` unversioniert — genau so
  entstand der frühere Boot-Crash der `agent-api`.
- **Secrets nie ins Repo.** `.env` ist derzeit getrackt und fehlt in `.gitignore` (siehe offene Punkte).

## 8. Ablauf einer Änderung

**Vorher**
1. Prüfen, ob die Datei überhaupt lebt: Erscheint sie nicht in [funktionen.md](funktionen.md), sondern in der
   Liste „Gebaut, aber nicht erreichbar", ändert man toten Code.
2. Betroffene Dateien lesen. Schema-Fragen an die Live-Datenbank.
3. `npm test` als Ausgangsstand festhalten (erwartet 234/234).
4. Im Kanon (§2) nachsehen, ob die Frage schon beantwortet ist.

**Währenddessen**
5. Nur ändern, was die Aufgabe verlangt. Generierte Dateien (`types.ts`, `client.ts`) und `.env` nicht anfassen.
6. Fachlogik nach `src/utils/` legen und mit Vitest abdecken.
7. Schema-Änderung = Migrationsdatei **plus** `apply_migration`, danach Typen neu erzeugen.
8. Keine Geheimnisse, keine Mieternamen in Code, Tests oder Commits.

**Danach**
9. `npm test` und `npx eslint src` (0 Fehler erwartet; `npm run lint` ist wegen der Deno-Dateien nie grün).
10. Erzeugte Schriftstücke gegen ein unterschriebenes Original prüfen, nicht nur gegen Tests.
11. Bei kundensichtbaren Änderungen `package.json` und `src/config/changelog.ts` gemeinsam pflegen.
12. Commit auf Deutsch (`feat:`/`fix:`/`security:`/`docs:`), pushen — **und danach prüfen, ob der Stand wirklich
    live ist**: `curl -s https://immobilien-blick-dashboard.lovable.app | grep -o 'assets/index-[^"]*'`.
    Gleicher Hash heißt: nicht neu gebaut. Ein grüner Push ist kein Deployment.

## 9. Konventionen

- Komponenten **PascalCase**, Hooks `useXyz.ts`, Utilities camelCase, DB `snake_case`. Das weicht bewusst von der
  globalen kebab-case-Regel ab — hier gilt der Bestand.
- Fachsprache **Deutsch**: neue Bezeichner, Spalten und Dateien deutsch (`pflichtpruefung.ts`). Älterer Code ist
  englisch; nicht flächendeckend umbenennen.
- Kommentare erklären das **Warum**, mit Datum und Beleg (Muster: `contractUtils.ts`, `decimalInput.ts`).
- Commit-Betreff deutsch, ohne Umlaute.
