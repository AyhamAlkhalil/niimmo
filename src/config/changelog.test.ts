import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { RELEASES } from "./changelog";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf-8"));

describe("Changelog", () => {
  it("hat einen Eintrag zur Version aus package.json", () => {
    // Der haeufigste Pflegefehler: package.json hochgezaehlt, Changelog vergessen.
    // Dann zeigt der Dialog "aktuell" beim falschen Release.
    expect(RELEASES.map((r) => r.version)).toContain(pkg.version);
  });

  it("führt die Version aus package.json als jüngstes Release", () => {
    expect(RELEASES[0].version).toBe(pkg.version);
  });

  it("vergibt jede Versionsnummer nur einmal", () => {
    const versionen = RELEASES.map((r) => r.version);
    expect(new Set(versionen).size).toBe(versionen.length);
  });

  it("ist chronologisch absteigend sortiert", () => {
    const daten = RELEASES.map((r) => r.datum);
    expect([...daten].sort().reverse()).toEqual(daten);
  });

  it("nutzt durchgehend ISO-Datumsangaben", () => {
    for (const r of RELEASES) {
      expect(r.datum, `Release ${r.version}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(r.datum)), `Release ${r.version}`).toBe(false);
    }
  });

  it("nutzt Semver-Versionsnummern", () => {
    for (const r of RELEASES) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("hat in jedem Release mindestens eine Änderung mit Titel", () => {
    for (const r of RELEASES) {
      expect(r.aenderungen.length, `Release ${r.version}`).toBeGreaterThan(0);
      for (const a of r.aenderungen) {
        expect(a.titel.trim(), `Release ${r.version}`).not.toBe("");
      }
    }
  });

  it("verwendet keine Entwicklersprache in den Kundentexten", () => {
    // Die Eintraege richten sich an die Verwaltung. Dateinamen, Spalten- und
    // Funktionsnamen gehoeren in die Commit-Message, nicht hierher.
    const verboten = /\.tsx?\b|_id\b|SELECT |NULL\b|\bnull\b|function |=>/;
    for (const r of RELEASES) {
      for (const a of r.aenderungen) {
        expect(a.titel, `Release ${r.version}: "${a.titel}"`).not.toMatch(verboten);
        if (a.detail) {
          expect(a.detail, `Release ${r.version}: "${a.titel}"`).not.toMatch(verboten);
        }
      }
    }
  });
});
