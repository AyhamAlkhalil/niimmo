import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

/**
 * Am 06.09.2026 waren 38 Fachdateien mit 10.691 Zeilen von main.tsx aus nicht
 * erreichbar — etwa ein Sechstel des Anwendungscodes. Für die
 * Vertragsdetailansicht gab es drei Kandidaten, für die Kündigung drei, für
 * die Mietübersicht zwei; beim Lesen wirkte die tote Fassung genauso
 * plausibel wie die lebende. Zweimal enthielt ausgerechnet die tote Fassung
 * die bessere Logik.
 *
 * Dieser Test hält den aufgeräumten Zustand: Neue Dateien müssen entweder
 * eingebunden sein oder hier bewusst eingetragen werden.
 */

/** Gebaut, aber (noch) nicht angeschlossen — bewusst behalten. */
const BEWUSST_NICHT_EINGEBUNDEN = new Set([
  // Pflegeoberfläche für nichtmiete_regeln; ohne sie sind die Regeln der
  // Zahlungszuordnung nur per SQL änderbar.
  'src/components/controlboard/NichtmieteRegelnManager.tsx',
  // Aufteilung einer Zahlung rückgängig machen.
  'src/components/dashboard/PaymentUndoSplitModal.tsx',
  // Objektübergreifende Zahlungssicht.
  'src/components/dashboard/ZahlungenUebersicht.tsx',
  // WhatsApp-Posteingang; die Tabelle wird von außen befüllt.
  'src/components/dashboard/WhatsappNachrichten.tsx',
  // Übergabe-Einstieg direkt an Einheit und Vertrag.
  'src/components/dashboard/handover/UebergabeButton.tsx',
  // Gewerbe- und Nebenverträge: vollständig gebaut und getestet, aber ohne
  // Einstieg im UI. Siehe docs/offene-punkte.md D3.
  'src/utils/mietvertrag/gewerbeKlauseln.ts',
  'src/utils/mietvertrag/nebenvertraege.ts',
  'src/utils/mietvertrag/nebenvertragPdfGenerator.ts',
]);

const WURZEL = 'src/main.tsx';

function aufloesen(pfad: string): string | null {
  for (const kandidat of [pfad, `${pfad}.ts`, `${pfad}.tsx`, `${pfad}/index.ts`, `${pfad}/index.tsx`]) {
    try {
      if (statSync(kandidat).isFile()) return normalize(kandidat);
    } catch {
      /* nächster Kandidat */
    }
  }
  return null;
}

function alleQuelldateien(verzeichnis: string): string[] {
  const treffer: string[] = [];
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) treffer.push(...alleQuelldateien(pfad));
    else if (/\.tsx?$/.test(eintrag.name)) treffer.push(normalize(pfad));
  }
  return treffer;
}

function importeVon(datei: string): string[] {
  const quelle = readFileSync(datei, 'utf-8');
  const ziele: string[] = [];
  for (const treffer of quelle.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    const spezifikation = treffer[1];
    const ziel = spezifikation.startsWith('@/')
      ? aufloesen(join('src', spezifikation.slice(2)))
      : spezifikation.startsWith('.')
      ? aufloesen(normalize(join(dirname(datei), spezifikation)))
      : null;
    if (ziel) ziele.push(ziel);
  }
  return ziele;
}

describe('Erreichbarkeit des Anwendungscodes', () => {
  it('jede Quelldatei hängt an main.tsx oder steht auf der Ausnahmeliste', () => {
    const gesehen = new Set<string>();
    const offen = [normalize(WURZEL)];
    while (offen.length > 0) {
      const datei = offen.pop()!;
      if (gesehen.has(datei)) continue;
      gesehen.add(datei);
      offen.push(...importeVon(datei));
    }

    const unerreichbar = alleQuelldateien('src')
      .map((p) => relative('.', p).split('\\').join('/'))
      .filter((p) => !p.includes('.test.'))
      .filter((p) => !p.endsWith('.d.ts'))
      // shadcn/ui ist eine Bibliothek: Bausteine dürfen auf Vorrat liegen.
      .filter((p) => !p.startsWith('src/components/ui/'))
      .filter((p) => !gesehen.has(normalize(p)))
      .filter((p) => !BEWUSST_NICHT_EINGEBUNDEN.has(p));

    expect(
      unerreichbar,
      'Diese Dateien werden nie gerendert. Entweder einbinden, löschen oder ' +
        'mit Begründung in BEWUSST_NICHT_EINGEBUNDEN eintragen.'
    ).toEqual([]);
  });

  it('die Ausnahmeliste enthält nur Dateien, die es noch gibt', () => {
    for (const pfad of BEWUSST_NICHT_EINGEBUNDEN) {
      expect(() => statSync(pfad), `${pfad} steht auf der Ausnahmeliste, existiert aber nicht mehr`).not.toThrow();
    }
  });
});
