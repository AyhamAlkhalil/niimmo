import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  KAPPUNGSGRENZE_ANGESPANNT_PROZENT,
  KAPPUNGSGRENZE_REGEL_PROZENT,
  kappungsBasis,
  kappungsgrenzeProzent,
  maximaleKaltmiete,
  mehrforderungProMonat,
  mieteAusVerlangen,
  mieteSeitVerlangenGeaendert,
  neueMieteAusEingabe,
  offeneVerlangenIds,
  offenesVerlangen,
  wirksamAb,
  wirksamAbTag,
} from './mieterhoehungRegeln';

describe('Kappungsgrenze § 558 Abs. 3 BGB', () => {
  it('begrenzt im Regelfall auf 20 Prozent', () => {
    expect(kappungsgrenzeProzent(false)).toBe(20);
    expect(KAPPUNGSGRENZE_REGEL_PROZENT).toBe(20);
  });

  it('begrenzt bei angespanntem Wohnungsmarkt auf 15 Prozent', () => {
    expect(kappungsgrenzeProzent(true)).toBe(15);
    expect(KAPPUNGSGRENZE_ANGESPANNT_PROZENT).toBe(15);
  });

  it('ist im angespannten Markt strenger, nie großzügiger', () => {
    expect(kappungsgrenzeProzent(true)).toBeLessThan(kappungsgrenzeProzent(false));
  });

  it('rechnet die Höchstmiete aus der aktuellen Kaltmiete', () => {
    expect(maximaleKaltmiete(1000, false)).toBeCloseTo(1200, 2);
    expect(maximaleKaltmiete(1000, true)).toBeCloseTo(1150, 2);
    expect(maximaleKaltmiete(0, false)).toBe(0);
  });

  it('lässt die früher verwendeten 30 Prozent nicht mehr zu', () => {
    // Der Dialog rechnete bis 06.09.2026 mit 20/30 statt 15/20 Prozent.
    expect(maximaleKaltmiete(1000, false)).toBeLessThan(1300);
    expect(maximaleKaltmiete(1000, true)).toBeLessThan(1200);
  });
});

describe('Wirksamkeit § 558b BGB', () => {
  it('setzt die erhöhte Miete auf den dritten Monat nach Zugang', () => {
    // Zugang im März 2026 → erhöhte Miete ab 1. Juni 2026
    const ab = wirksamAb(new Date(2026, 2, 15));
    expect(ab.getFullYear()).toBe(2026);
    expect(ab.getMonth()).toBe(5);
    expect(ab.getDate()).toBe(1);
  });

  it('rechnet über den Jahreswechsel', () => {
    const ab = wirksamAb(new Date(2026, 10, 20)); // November 2026
    expect(ab.getFullYear()).toBe(2027);
    expect(ab.getMonth()).toBe(1); // Februar
  });

  it('speichert den Monatsersten als Kalendertag, nicht den Vortag', () => {
    // 27.10.2026: toISOString() ergab in deutscher Zeit '2026-12-31'
    expect(wirksamAbTag(new Date(2026, 9, 27, 10))).toBe('2027-01-01');
    expect(wirksamAbTag(new Date(2026, 2, 15, 0, 30))).toBe('2026-06-01');
    expect(wirksamAbTag(new Date(2026, 6, 1, 23, 59))).toBe('2026-10-01');
  });

  it('liegt nie im Monat des Zugangs', () => {
    for (let m = 0; m < 12; m++) {
      const zugang = new Date(2026, m, 5);
      expect(wirksamAb(zugang).getTime()).toBeGreaterThan(zugang.getTime());
    }
  });
});

describe('Der Erhöhungsdialog nutzt die zentrale Regel', () => {
  it('rechnet nicht mehr mit eigenen Prozentwerten', () => {
    const quelle = readFileSync('src/components/dashboard/rent-increase/RentIncreaseModal.tsx', 'utf-8');
    expect(quelle).toContain('kappungsgrenzeProzent');
    expect(quelle).not.toContain('istAngespannt ? 20 : 30');
    expect(quelle).not.toContain('Kappung 30%');
  });
});

describe('neueMieteAusEingabe', () => {
  it('nimmt Beträge an, Betriebskosten auch mit 0', () => {
    expect(neueMieteAusEingabe('812.50', '0')).toEqual({ kaltmiete: 812.5, betriebskosten: 0 });
    expect(neueMieteAusEingabe('812,50', '120')).toEqual({ kaltmiete: 812.5, betriebskosten: 120 });
  });

  it('meldet leere Felder statt 0 € oder NaN ins Schreiben und an den Vertrag zu geben', () => {
    // 27.10.2026: parseFloat('') || 0 — geleerte BK wurden mit Haken „zugestimmt“ zu 0 € am Vertrag
    expect(neueMieteAusEingabe('812.50', '')).toHaveProperty('fehler');
    expect(neueMieteAusEingabe('', '120')).toHaveProperty('fehler');
    expect(neueMieteAusEingabe('0', '120')).toHaveProperty('fehler');
    expect(neueMieteAusEingabe('-5', '120')).toHaveProperty('fehler');
  });

  it('nennt bei einem Tausenderpunkt den Grund statt „bitte eintragen“', () => {
    // Review 27.10.2026: „1.000,50“ ist gefüllt, aber nicht lesbar
    expect(neueMieteAusEingabe('1.000,50', '120')).toEqual({ fehler: expect.stringMatching(/ohne Tausenderpunkt/) });
    expect(neueMieteAusEingabe('1000,50', '1.200,00')).toEqual({ fehler: expect.stringMatching(/Betriebskosten.*ohne Tausenderpunkt/) });
  });

  it('wird vor Download und Speichern geprüft, der Dokumenteintrag ist nicht mehr ungeprüft', () => {
    const modal = readFileSync('src/components/dashboard/rent-increase/RentIncreaseModal.tsx', 'utf-8');
    expect(modal).toMatch(/if \(!pdfBlob \|\| !pruefeNeueMiete\(\)\) return;/);
    expect(modal).toMatch(/const neueMiete = pruefeNeueMiete\(\);\s*if \(!neueMiete\) return;/);
    expect(modal).not.toMatch(/parseFloat\(neueBetriebskosten\) \|\| 0,\s*\n\s*(letzte_mieterhoehung_am|begruendungsart)/);
    expect(modal).toMatch(/if \(dokumentError\) throw dokumentError;/);
  });
});

describe('kappungsBasis (§ 558 Abs. 3 BGB)', () => {
  it('rechnet von der Miete vor drei Jahren, wenn eine Erhöhung im Fenster gespeichert ist', () => {
    // 27.10.2026: 500 € → 550 € (vor einem Jahr) → angeboten wurden bis 660 € statt 600 €
    const b = kappungsBasis(550, '2027-01-01', '2026-01-01', [{ wirksam_ab: '2026-01-01', alte_kaltmiete: 500, status: 'wirksam' }]);
    expect(b).toEqual({ betrag: 500, sicher: true });
  });

  it('meldet eine unbekannte Basis, wenn nur das Datum einer Erhöhung im Fenster steht', () => {
    expect(kappungsBasis(550, '2027-01-01', '2025-06-01', [])).toEqual({ betrag: 550, sicher: false });
  });

  it('nimmt die heutige Miete, wenn im Fenster keine Erhöhung lag', () => {
    expect(kappungsBasis(550, '2027-01-01', '2023-06-01', [{ wirksam_ab: '2023-06-01', alte_kaltmiete: 480, status: 'wirksam' }])).toEqual({ betrag: 550, sicher: true });
    expect(kappungsBasis(550, '2027-01-01', null, [{ wirksam_ab: '2026-06-01', alte_kaltmiete: 500, status: 'verlangt' }])).toEqual({ betrag: 550, sicher: true });
  });

  it('speichert als letzte Erhöhung das Wirksamwerden', () => {
    const modal = readFileSync('src/components/dashboard/rent-increase/RentIncreaseModal.tsx', 'utf-8');
    expect(modal).toMatch(/letzte_mieterhoehung_am: wirksamIso,/);
  });
});

/**
 * Prüfung 28.10.2026: „Sobald der Mieter zustimmt, hier erneut öffnen und den Haken setzen“ erzeugte
 * ein zweites Schreiben mit heutigem Datum und einen zweiten Vorgang; der erste blieb `verlangt`.
 */
describe('Zustimmung zu einem offenen Verlangen', () => {
  const vorgang = (id: string, verlangt_am: string, status: string) => ({
    id, verlangt_am, status, wirksam_ab: '2027-01-01', alte_kaltmiete: 500, neue_kaltmiete: 550, neue_betriebskosten: 120,
  });

  it('findet das jüngste offene Verlangen und übergeht erledigte', () => {
    expect(offenesVerlangen([vorgang('a', '2026-09-01', 'verlangt'), vorgang('b', '2026-10-27', 'verlangt'), vorgang('c', '2026-10-28', 'wirksam')])?.id).toBe('b');
    expect(offenesVerlangen([vorgang('c', '2026-10-28', 'wirksam'), vorgang('d', '2026-10-01', 'abgelehnt')])).toBeNull();
    expect(offenesVerlangen([{ ...vorgang('e', '2026-10-01', 'verlangt'), neue_kaltmiete: null }])).toBeNull();
  });

  const modal = readFileSync('src/components/dashboard/rent-increase/RentIncreaseModal.tsx', 'utf-8');

  it('setzt den vorhandenen Vorgang wirksam — kein neues Schreiben, kein zweiter Vorgang', () => {
    const start = modal.indexOf('const handleZustimmungErfassen = async');
    const ende = modal.indexOf('if (!contractData) return null;', start);
    const zweig = modal.slice(start, ende);
    expect(zweig).toContain(".update({ status: 'wirksam'");
    expect(zweig).toContain(".eq('status', 'verlangt')");
    expect(zweig).toContain('const wirksamIso = vorgang.wirksam_ab.slice(0, 10);');
    expect(zweig).not.toMatch(/\.insert\(|\.upload\(|generateMieterhoehungPdf/);
  });

  it('schreibt die Vertragsmiete an genau einer Stelle, und die verlangt die Zustimmung', () => {
    // Ergänzt den Wächter in mieterhoehungPdfGenerator.test.ts: der prüft nur die erste Schreibstelle
    const schreibstellen = modal.match(/from\(['"]mietvertrag['"]\)[\s\S]{0,40}\.update\(/g) ?? [];
    expect(schreibstellen).toHaveLength(1);
    const funktion = modal.slice(modal.indexOf('const mieteNachZustimmungSetzen = async'), modal.indexOf('const handleSaveAndUpload = async'));
    expect(funktion).toMatch(/if \(mieterHatZugestimmt\) \{\s*const \{ data: geschrieben, error: mieteError \} = await supabase\.from\('mietvertrag'\)\.update\(/);
    // Aufrufer: der Haken beim Speichern, die bestätigte Zustimmung zum Verlangen
    expect(modal).toContain('await mieteNachZustimmungSetzen(mieterHatZugestimmt, neueMiete, wirksamIso)');
    expect(modal).toContain('await mieteNachZustimmungSetzen(true, miete, wirksamIso)');
    expect(modal.match(/mieteNachZustimmungSetzen\(/g)).toHaveLength(2);
  });
});

/**
 * Prüfung 28.10.2026: Scheiterte nach dem Upload der Dokumenteintrag oder der Vorgang, blieben Datei
 * und Dokumentzeile stehen. Gleiche Kaltmiete fing bisher nur der Generator ab (Vorschau nicht möglich).
 */
describe('Mieterhöhung: neue Kaltmiete und Aufräumen nach Fehlern', () => {
  it('verlangt eine neue Kaltmiete über der bisherigen', () => {
    expect(neueMieteAusEingabe('500.00', '150', 500)).toEqual({ fehler: expect.stringMatching(/über der bisherigen von 500,00 €/) });
    expect(neueMieteAusEingabe('499', '150', 500)).toHaveProperty('fehler');
    expect(neueMieteAusEingabe('500.01', '150', 500)).toEqual({ kaltmiete: 500.01, betriebskosten: 150 });
    // ohne bisherige Miete wie vorher
    expect(neueMieteAusEingabe('500', '150')).toEqual({ kaltmiete: 500, betriebskosten: 150 });
  });

  it('räumt Datei und Dokumentzeile weg, wenn der Vorgang nicht gespeichert wird', () => {
    const modal = readFileSync('src/components/dashboard/rent-increase/RentIncreaseModal.tsx', 'utf-8');
    expect(modal).toContain("if (dokumentEingetragen) await supabase.from('dokumente').delete().eq('pfad', filePath);");
    expect(modal).toContain("await supabase.storage.from('dokumente').remove([filePath]);");
    expect(modal).toMatch(/if \(dokumentError\) await zurueckrollen\(\);/);
    expect(modal).toMatch(/if \(vorgangError\) \{\s*await zurueckrollen\(\);\s*throw vorgangError;/);
    expect(modal).toContain('neueMieteAusEingabe(neueKaltmiete, neueBetriebskosten, contractData?.current_kaltmiete)');
  });
});

/**
 * Review 28.10.2026: Scheiterte nach „wirksam“ das Update der Miete, blieb der Vorgang wirksam, die Miete
 * alt, und ein zweiter Versuch war unmöglich. BK null setzte die Vorauszahlung auf 0 €. Der Haken neben
 * einem offenen Verlangen legte weiter einen zweiten Vorgang an.
 */
describe('Zustimmung: Rückbau, Betriebskosten, Haken und Rückzug', () => {
  const basis = { id: 'a', verlangt_am: '2026-10-01', wirksam_ab: '2027-01-01', status: 'verlangt', alte_kaltmiete: 500, alte_betriebskosten: 120, neue_kaltmiete: 550, neue_betriebskosten: 130 };

  it('lässt die Betriebskosten stehen, wenn das Verlangen keine nennt', () => {
    expect(mieteAusVerlangen(basis)).toEqual({ kaltmiete: 550, betriebskosten: 130 });
    expect(mieteAusVerlangen({ ...basis, neue_betriebskosten: null })).toEqual({ kaltmiete: 550, betriebskosten: null });
    expect(mieteAusVerlangen({ ...basis, neue_kaltmiete: null })).toBeNull();
    expect(mieteAusVerlangen({ ...basis, neue_betriebskosten: -1 })).toBeNull();
  });

  it('erkennt eine geänderte Miete auch an den Betriebskosten', () => {
    expect(mieteSeitVerlangenGeaendert(basis, 500, 120)).toBe(false);
    expect(mieteSeitVerlangenGeaendert(basis, 500, 140)).toBe(true);
    expect(mieteSeitVerlangenGeaendert(basis, 510, 120)).toBe(true);
    expect(mieteSeitVerlangenGeaendert({ ...basis, alte_betriebskosten: null }, 500, 140)).toBe(false);
  });

  it('nennt, um wie viel die Monatsforderung vor dem Wirksamwerden zu hoch ist', () => {
    expect(mehrforderungProMonat({ kaltmiete: 550, betriebskosten: 130 }, 500, 120)).toBe(60);
    expect(mehrforderungProMonat({ kaltmiete: 550.1, betriebskosten: null }, 500, 120)).toBe(50.1);
  });

  it('kennt alle offenen Verlangen für den Rückzug', () => {
    expect(offeneVerlangenIds([basis, { ...basis, id: 'b', status: 'wirksam' }, { ...basis, id: 'c' }])).toEqual(['a', 'c']);
  });

  const modal = readFileSync('src/components/dashboard/rent-increase/RentIncreaseModal.tsx', 'utf-8');
  const zweig = modal.slice(modal.indexOf('const handleZustimmungErfassen = async'), modal.indexOf('if (!contractData) return null;', modal.indexOf('const handleZustimmungErfassen = async')));

  it('setzt den Vorgang zurück, wenn die Miete nicht geschrieben wird, und schließt dann nicht', () => {
    expect(zweig.indexOf(".eq('status', 'verlangt')")).toBeLessThan(zweig.indexOf('await mieteNachZustimmungSetzen(true, miete, wirksamIso)'));
    const rueckbau = zweig.slice(zweig.indexOf('if (mieteError) {'));
    expect(rueckbau).toMatch(/\.update\(\{ status: 'verlangt', zugestimmt_am: null[\s\S]*?\.eq\('status', 'wirksam'\)/);
    expect(rueckbau.indexOf('throw new Error(')).toBeLessThan(rueckbau.indexOf('onClose();'));
    // onClose nur im Erfolgsweg, nicht im catch
    expect(zweig.slice(zweig.indexOf('} catch')).includes('onClose()')).toBe(false);
  });

  it('schreibt BK nur, wenn das Verlangen sie nennt, und prüft, ob eine Zeile getroffen wurde', () => {
    expect(modal).toContain('...(miete.betriebskosten !== null ? { betriebskosten: miete.betriebskosten } : {}),');
    expect(modal).toContain("if (!geschrieben || geschrieben.length === 0) return { message:");
  });

  it('sperrt den Haken neben einem offenen Verlangen und zieht es bei einem neuen Schreiben zurück', () => {
    expect(modal).toContain('disabled={!!verlangen}');
    expect(modal).toMatch(/if \(mieterHatZugestimmt && verlangen\) \{/);
    expect(modal).toMatch(/\.update\(\{ status: 'zurueckgezogen'[\s\S]{0,120}\.in\('id', zurueckzuziehen\)\s*\.eq\('status', 'verlangt'\)/);
    expect(modal).toContain('wird danach als zurückgezogen markiert');
  });

  it('sagt vor der Zustimmung, dass die Miete sofort gilt und um wie viel die Forderung zu hoch ist', () => {
    expect(modal).toContain('wirksam ist die Erhöhung erst ab {verlangenWirksamText}. Bis dahin ist die Monatsforderung um');
    expect(modal).toContain('mehrforderungProMonat(verlangenMiete, contractData.current_kaltmiete, contractData.current_betriebskosten)');
  });
});
