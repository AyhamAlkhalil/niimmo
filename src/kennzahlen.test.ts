import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Bankaufstellungen und Übersichten (Systemprüfung 27.10.2026) — Quelltextprüfung der Komponenten. */
describe('Bankaufstellungen', () => {
  const uebersicht = readFileSync('src/components/dashboard/EditableMietUebersichtModal.tsx', 'utf-8');
  const bank = readFileSync('src/components/dashboard/MietaufstellungBank.tsx', 'utf-8');

  it('zählen die SOLL-Miete freier Einheiten beide mit', () => {
    // Die Stammdaten-Übersicht ließ sie aus der Summe weg (2.275 €/Monat Unterschied)
    expect(uebersicht).toMatch(/\} else if \(r\.sollMiete != null\) \{\s*gSoll \+= r\.sollMiete;/);
    expect(bank).toMatch(/soll \+= row\.sollMiete \?\? \(row\.isVacant \? 0 : \(row\.kaltmiete \?\? 0\)\);/);
  });

  it('werten einen Ladefehler der Darlehen aus und rechnen im Teilauszug keine Annuität', () => {
    expect(uebersicht).toMatch(/if \(darlehenRes\.error\) throw darlehenRes\.error;/);
    expect(bank).toMatch(/if \(darlehenRes\.error\) throw darlehenRes\.error;/);
    expect(uebersicht).toMatch(/const annuitaet = teilauszug \? null : g\.annuitaet;/);
  });
});

describe('Zählerverwaltung', () => {
  it('zeigt den heute laufenden Vertrag je Einheit', () => {
    const quelle = readFileSync('src/components/dashboard/ZaehlerVerwaltung.tsx', 'utf-8');
    expect(quelle).not.toMatch(/\.eq\('status', 'aktiv'\);\s*contracts = contractData/);
    expect(quelle).toMatch(/getLaufenderVertrag\(contracts\.filter/);
  });
});

describe('Ladefehler sehen nicht wie 0 € oder „keine Daten“ aus', () => {
  it('zeigen Bankaufstellung, Mietübersicht, Darlehen, Versicherungen und Objektkopf einen Fehler', () => {
    // 27.10.2026: Fehler erschienen als leere Aufstellung, „Keine Daten“, Gesamtschuld 0 € oder 0 € Miete
    const dateien = {
      bank: 'src/components/dashboard/MietaufstellungBank.tsx',
      uebersicht: 'src/components/dashboard/EditableMietUebersichtModal.tsx',
      versicherungen: 'src/components/dashboard/ImmobilienVersicherungenTab.tsx',
    };
    for (const pfad of Object.values(dateien)) {
      expect(readFileSync(pfad, 'utf-8'), pfad).toMatch(/isError/);
    }
    expect(readFileSync('src/components/dashboard/DarlehenVerwaltung.tsx', 'utf-8')).toMatch(/darlehenFehler \|\| zuordnungFehler \|\| buchungenFehler \?/);
    expect(readFileSync('src/components/dashboard/ImmobilienDetail.tsx', 'utf-8')).toMatch(/mietenBekannt \? formatBetragKompakt\(gesamtKaltmiete\) : '—'/);
  });
});
