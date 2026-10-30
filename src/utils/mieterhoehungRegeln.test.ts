import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  offizielleErhoehungGiltAb,
  vereinbarungGiltAbOptionen,
  vereinbarungGiltAbVorgabe,
  erhoehungRueckwirkend,
  vereinbarungVerlangtAm,
  offizielleErhoehungGiltAbText,
  KAPPUNGSGRENZE_ANGESPANNT_PROZENT,
  KAPPUNGSGRENZE_REGEL_PROZENT,
  erhoehungUeberfaellig,
  kappungsBasis,
  kappungsgrenzeProzent,
  maximaleKaltmiete,
  mehrforderungProMonat,
  mieteAusVerlangen,
  mieteSeitVerlangenGeaendert,
  nachzuberechnendeMonate,
  neueMieteAusEingabe,
  offeneVerlangenIds,
  offenesVerlangen,
  ueberfaelligGrund,
  uebernahmeKonflikt,
  uebernahmeMeldung,
  vereinbarteErhoehung,
  wirksamAb,
  wirksamAbTag,
  zustimmungHindernis,
} from './mieterhoehungRegeln';

const migration = readFileSync('supabase/migrations/20261028142000_mieterhoehung_ab_wirksamwerden.sql', 'utf-8');

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

  it('rundet die Höchstmiete auf den Cent ab, nie über die Kappungsgrenze (Prüfung 29.10.2026)', () => {
    expect(maximaleKaltmiete(446.13, false)).toBe(535.35);
    expect(maximaleKaltmiete(477.73, false)).toBe(573.27);
    expect(maximaleKaltmiete(1000, false)).toBe(1200);
    expect(maximaleKaltmiete(333.33, true)).toBe(383.32);
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

  it('zählt eine zugestimmte, noch nicht übernommene Erhöhung mit (28.10.2026)', () => {
    // Sonst wäre die Basis die heutige Miete, obwohl eine Erhöhung schon vereinbart ist
    expect(kappungsBasis(500, '2027-04-01', null, [{ wirksam_ab: '2027-01-01', alte_kaltmiete: 480, status: 'zugestimmt' }])).toEqual({ betrag: 480, sicher: true });
    expect(kappungsBasis(500, '2027-04-01', null, [{ wirksam_ab: '2027-01-01', alte_kaltmiete: 480, status: 'zurueckgezogen' }])).toEqual({ betrag: 500, sicher: true });
  });

  it('speichert als letzte Erhöhung das Wirksamwerden — jetzt in der Datenbank', () => {
    expect(migration).toContain('letzte_mieterhoehung_am = greatest(coalesce(letzte_mieterhoehung_am, v_mh.wirksam_ab), v_mh.wirksam_ab)');
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

  it('erfasst die Zustimmung am vorhandenen Vorgang — kein neues Schreiben, kein zweiter Vorgang', () => {
    const start = modal.indexOf('const handleZustimmungErfassen = async');
    const ende = modal.indexOf('const handleTrotzdemUebernehmen = async', start);
    const zweig = modal.slice(start, ende);
    // Seit 28.10.2026 ein Aufruf: die Datenbank sperrt, prüft 'verlangt' und übernimmt bei Bedarf sofort
    expect(zweig).toContain("erhoehungsRpc('mieterhoehung_zustimmen', {");
    expect(zweig).toContain('p_mieterhoehung_id: vorgang.id,');
    expect(zweig).not.toMatch(/\.insert\(|\.upload\(|generateMieterhoehungPdf|\.update\(/);
  });

  it('die Datenbank übernimmt die Miete an genau einer Stelle, nur zugestimmt und nur ab wirksam_ab', () => {
    // Die einzige Schreibstelle der Vertragsmiete für Mieterhöhungen ist mieterhoehung_anwenden_intern
    expect(migration.match(/update public\.mietvertrag\b/g)).toHaveLength(1);
    const kern = migration.slice(migration.indexOf('create or replace function public.mieterhoehung_anwenden_intern'), migration.indexOf('create or replace function public.mieterhoehungen_anwenden()'));
    expect(kern).toContain('update public.mietvertrag');
    expect(kern).toMatch(/if v_mh\.status <> 'zugestimmt' then/);
    expect(kern).toMatch(/if v_mh\.wirksam_ab > current_date then/);
    expect(kern.indexOf("hint = 'NOCH_NICHT_WIRKSAM'")).toBeLessThan(kern.indexOf('update public.mietvertrag'));
    expect(kern.indexOf("hint = 'MIETE_GEAENDERT'")).toBeLessThan(kern.indexOf('update public.mietvertrag'));
    // 'wirksam' nur mit der transaktionslokalen Freigabe, die der Wächter-Trigger verlangt
    expect(kern).toMatch(/set_config\('niimmo\.mieterhoehung_anwenden', 'an', true\);\s*update public\.mieterhoehungen set status = 'wirksam'/);
  });

  it('der Nachtlauf läuft in der Sollstellung nach den Staffelmieten und vor dem Anlegen', () => {
    const soll = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.generate_monthly_mietforderungen()'));
    const staffel = soll.indexOf('perform public.staffelmieten_anwenden();');
    const erhoehung = soll.indexOf('perform public.mieterhoehungen_anwenden();');
    expect(staffel).toBeGreaterThan(-1);
    expect(erhoehung).toBeGreaterThan(staffel);
    expect(erhoehung).toBeLessThan(soll.indexOf('insert into mietforderungen'));
    // In eigenem Block: die Sollstellung darf an der Mieterhöhung nie hängen
    expect(soll.slice(erhoehung)).toMatch(/^perform public\.mieterhoehungen_anwenden\(\);\s*exception when others then/);
    // Bricht ab, statt eine inzwischen geänderte Sollstellung still zu überschreiben
    expect(migration).toContain("md5(pg_get_functiondef('public.generate_monthly_mietforderungen()'::regprocedure))");
  });

  it('sperrt Nachtlauf und Kern für Nutzer, die Aufrufe der Oberfläche nur für Admins', () => {
    expect(migration).toContain('revoke execute on function public.mieterhoehungen_anwenden() from public, anon, authenticated, service_role;');
    expect(migration).toContain('revoke execute on function public.mieterhoehung_zustimmung_pruefen(uuid, date, uuid) from public, anon, authenticated, service_role;');
    expect(migration).toContain('revoke execute on function public.mieterhoehung_zustimmung_zuruecknehmen(uuid) from public, anon;');
    expect(migration).toContain('revoke execute on function public.mieterhoehung_anwenden_intern(uuid, boolean) from public, anon, authenticated, service_role;');
    expect(migration).toContain('revoke execute on function public.mieterhoehung_zustimmen(uuid, boolean) from public, anon;');
    expect(migration).toContain('revoke execute on function public.mieterhoehung_anwenden(uuid, boolean) from public, anon;');
    for (const kopf of ['public.mieterhoehung_zustimmen(', 'public.mieterhoehung_anwenden(', 'public.mieterhoehung_zustimmung_zuruecknehmen(']) {
      const start = migration.indexOf(`create or replace function ${kopf}`);
      expect(migration.slice(start, start + 600)).toContain('if not public.is_admin((select auth.uid())) then');
    }
    // Zurückliegende Monate: nur Monatsmieten, keine Rücklastschrift-Gebühren (20261028140000)
    expect(migration).toContain('and f.ruecklastschrift_am is null');
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
    expect(modal).toMatch(/if \(vorgangError\) \{\s*await zurueckrollen\(\);[\s\S]{0,140}throw new Error\(uebernahmeMeldung\(vorgangError\.hint, vorgangError\.message\)\);/);
    expect(modal).toContain('neueMieteAusEingabe(neueKaltmiete, neueBetriebskosten, contractData?.current_kaltmiete)');
  });
});

/**
 * Review 28.10.2026: Scheiterte nach „wirksam“ das Update der Miete, blieb der Vorgang wirksam, die Miete
 * alt, und ein zweiter Versuch war unmöglich. BK null setzte die Vorauszahlung auf 0 €. Der Haken neben
 * einem offenen Verlangen legte weiter einen zweiten Vorgang an. Seit der Übernahme in der Datenbank
 * (ebenfalls 28.10.2026) ist die Zustimmung atomar; die Tests prüfen jetzt Fehlerweg und Sperren.
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
  const zweig = modal.slice(modal.indexOf('const handleZustimmungErfassen = async'), modal.indexOf('const handleTrotzdemUebernehmen = async'));

  it('schließt nur im Erfolgsweg und bietet nach MIETE_GEAENDERT „Trotzdem übernehmen“ an', () => {
    // Die Zustimmung rollt in der Datenbank mit zurück, wenn die Übernahme scheitert (28.10.2026)
    const fehler = zweig.slice(zweig.indexOf('if (error) {'));
    expect(fehler.indexOf("if (error.hint === 'MIETE_GEAENDERT') setTrotzAbweichungAngeboten(true);")).toBeGreaterThan(-1);
    expect(fehler.indexOf('throw new Error(uebernahmeMeldung(error.hint, error.message));')).toBeLessThan(fehler.indexOf('onClose();'));
    // onClose nur im Erfolgsweg, nicht im catch
    expect(zweig.slice(zweig.indexOf('} catch')).includes('onClose()')).toBe(false);
    expect(modal).toContain('onClick={() => handleZustimmungErfassen(trotzAbweichungAngeboten)}');
  });

  it('schreibt BK nur, wenn das Verlangen sie ändert (§ 560-Anpassungen seither bleiben)', () => {
    expect(migration).toMatch(/v_bk := case when v_mh\.neue_betriebskosten <> v_mh\.alte_betriebskosten\s*then v_mh\.neue_betriebskosten\s*else v_mv\.betriebskosten end;/);
  });

  it('sperrt ein neues Schreiben, solange eine Erhöhung vereinbart ist oder die Vorgänge fehlen', () => {
    expect(modal).toContain("const speichernGesperrt = !!vereinbart || erhoehungenGeladen !== 'ok';");
    expect(modal).toContain('disabled={!pdfBlob || isSubmitting || speichernGesperrt}');
    expect(modal).toMatch(/if \(speichernGesperrt\) \{/);
  });

  it('sperrt den Haken neben einem offenen Verlangen und zieht es bei einem neuen Schreiben zurück', () => {
    expect(modal).toContain('disabled={!!verlangen || !!hakenHindernis}');
    expect(modal).toMatch(/if \(mieterHatZugestimmt && verlangen\) \{/);
    expect(modal).toMatch(/\.update\(\{ status: 'zurueckgezogen'[\s\S]{0,120}\.in\('id', zurueckzuziehen\)\s*\.eq\('status', 'verlangt'\)/);
    expect(modal).toContain('wird danach als zurückgezogen markiert');
  });

  it('sagt vor der Zustimmung, ab wann die Miete gilt, und bei später Zustimmung die Nachforderung', () => {
    expect(modal).toContain('Die Vertragsmiete bleibt bis zum {verlangenWirksamText} unverändert und wird dann automatisch auf');
    expect(modal).toContain('mehrforderungProMonat(verlangenMiete, contractData.current_kaltmiete, contractData.current_betriebskosten)');
    expect(modal).toContain('nachzuberechnendeMonate(verlangen.wirksam_ab, new Date())');
  });
});

/**
 * 28.10.2026: Die Miete gilt erst ab wirksam_ab. Eine Zustimmung macht den Vorgang 'zugestimmt'; die
 * Datenbank übernimmt zum Wirksamwerden. Diese Regeln zeigen den Zustand im Dialog und in der Liste an.
 */
describe('Vereinbarte, noch nicht übernommene Erhöhung', () => {
  const v = { id: 'z', verlangt_am: '2026-10-01', wirksam_ab: '2027-01-01', status: 'zugestimmt', zugestimmt_am: '2026-10-10', alte_kaltmiete: 500, alte_betriebskosten: 100, neue_kaltmiete: 550, neue_betriebskosten: 100 };

  it('findet die vereinbarte Erhöhung und übergeht offene, übernommene und zurückgezogene', () => {
    expect(vereinbarteErhoehung([v])?.id).toBe('z');
    expect(vereinbarteErhoehung([{ ...v, status: 'verlangt' }, { ...v, status: 'wirksam' }, { ...v, status: 'zurueckgezogen' }])).toBeNull();
    expect(vereinbarteErhoehung([{ ...v, id: 'alt', wirksam_ab: '2026-01-01' }, v])?.id).toBe('z');
  });

  it('ist erst ab dem Tag nach dem Wirksamwerden überfällig, solange sie nicht übernommen ist', () => {
    expect(erhoehungUeberfaellig(v, '2026-12-31')).toBe(false);
    // Am Monatsersten bis 2 Uhr rechnet die Datenbank (UTC) noch mit dem Vortag, übernommen wird um 05:00 UTC
    expect(erhoehungUeberfaellig(v, '2027-01-01')).toBe(false);
    expect(erhoehungUeberfaellig(v, '2027-01-02')).toBe(true);
    expect(erhoehungUeberfaellig({ ...v, status: 'wirksam' }, '2027-02-01')).toBe(false);
  });

  it('kennt die Hindernisse einer Zustimmung wie die Datenbank (mieterhoehung_zustimmung_pruefen)', () => {
    expect(zustimmungHindernis({ wirksamAbIso: '2027-01-01' })).toBeNull();
    expect(zustimmungHindernis({ mietanpassungArt: 'keine', vertragsende: '2027-01-01', wirksamAbIso: '2027-01-01' })).toBeNull();
    expect(zustimmungHindernis({ mietanpassungArt: 'staffel', wirksamAbIso: '2027-01-01' })).toBe('STAFFEL_ODER_INDEX');
    expect(zustimmungHindernis({ mietanpassungArt: 'index', wirksamAbIso: '2027-01-01' })).toBe('STAFFEL_ODER_INDEX');
    expect(zustimmungHindernis({ vertragsende: '2026-12-31', wirksamAbIso: '2027-01-01' })).toBe('VERTRAG_ENDET_VORHER');
  });

  it('nennt den Grund einer überfälligen Erhöhung', () => {
    expect(ueberfaelligGrund(v, 510, 100)).toMatch(/seit dem Verlangen geändert/);
    expect(ueberfaelligGrund(v, 500, 100, { vertragsende: '2026-12-15' })).toMatch(/endet vor dem Wirksamwerden/);
    expect(ueberfaelligGrund(v, 500, 100, { mietanpassungArt: 'staffel' })).toMatch(/Staffel- oder Indexmiete/);
    expect(ueberfaelligGrund(v, 500, 100)).toMatch(/nicht übernommen/);
  });

  it('erkennt einen Konflikt wie die Datenbank (MIETE_GEAENDERT)', () => {
    expect(uebernahmeKonflikt(v, 500, 100)).toBe(false);
    // Kaltmiete seither geändert
    expect(uebernahmeKonflikt(v, 510, 100)).toBe(true);
    // schon von Hand übernommen
    expect(uebernahmeKonflikt(v, 550, 100)).toBe(false);
    // Vorauszahlung nach § 560 angepasst, das Verlangen ändert die BK nicht: kein Konflikt
    expect(uebernahmeKonflikt(v, 500, 130)).toBe(false);
    expect(uebernahmeKonflikt(v, 550, 130)).toBe(false);
    // Das Verlangen ändert die BK, die am Vertrag sind nicht mehr die alten: Konflikt
    expect(uebernahmeKonflikt({ ...v, neue_betriebskosten: 120 }, 500, 110)).toBe(true);
    expect(uebernahmeKonflikt({ ...v, neue_betriebskosten: 120 }, 500, 100)).toBe(false);
  });

  it('zählt die höchstens nachzuberechnenden Monate bis einschließlich des laufenden', () => {
    expect(nachzuberechnendeMonate('2026-09-01', new Date(2026, 9, 28))).toBe(2);
    expect(nachzuberechnendeMonate('2026-10-01', new Date(2026, 9, 1))).toBe(1);
    expect(nachzuberechnendeMonate('2025-12-01', new Date(2026, 1, 5))).toBe(3);
    expect(nachzuberechnendeMonate('2027-01-01', new Date(2026, 9, 28))).toBe(0);
  });

  it('übersetzt die Hinweise der Datenbank in feste Meldungen', () => {
    expect(uebernahmeMeldung('MIETE_GEAENDERT')).toMatch(/seit dem Verlangen geändert/);
    expect(uebernahmeMeldung('NICHT_OFFEN')).toMatch(/nicht mehr offen/);
    expect(uebernahmeMeldung('SCHON_VEREINBART')).toMatch(/schon eine Erhöhung vereinbart/);
    expect(uebernahmeMeldung('NOCH_NICHT_WIRKSAM')).toBe('Die Erhöhung wird heute früh automatisch übernommen.');
    expect(uebernahmeMeldung('VERTRAG_ENDET_VORHER')).toMatch(/endet vor dem Wirksamwerden/);
    expect(uebernahmeMeldung('NUR_UEBER_ZURUECKNEHMEN')).toMatch(/Zustimmung zurücknehmen/);
    expect(uebernahmeMeldung(undefined, 'Netzwerkfehler')).toBe('Netzwerkfehler');
    expect(uebernahmeMeldung(null)).toBe('Die Mieterhöhung konnte nicht gespeichert werden.');
  });
});

/**
 * Review 28.10.2026: Eine irrtümlich erfasste Zustimmung ließ sich nicht zurücknehmen; Hindernisse
 * (Staffel/Index, Vertragsende, schon vereinbart) zeigten sich erst beim Übernehmen oder als roher
 * Unique-Verstoß; eine fehlende Kaltmiete übersprang die Konfliktprüfung.
 */
describe('Zustimmung: Zurücknehmen und Prüfung beim Zustimmen', () => {
  const modal = readFileSync('src/components/dashboard/rent-increase/RentIncreaseModal.tsx', 'utf-8');
  const abschnitt = (kopf: string, bis: string) => migration.slice(migration.indexOf(kopf), migration.indexOf(bis, migration.indexOf(kopf)));

  it('nimmt eine Zustimmung nur über die Datenbankfunktion zurück, vorher bestätigt', () => {
    const fn = abschnitt('create or replace function public.mieterhoehung_zustimmung_zuruecknehmen', '$function$;');
    expect(fn).toMatch(/if v_mh\.status <> 'zugestimmt' then/);
    expect(fn).toMatch(/set_config\('niimmo\.mieterhoehung_zuruecknehmen', 'an', true\);\s*update public\.mieterhoehungen\s*set status = 'verlangt',\s*zugestimmt_am = null/);
    const handler = modal.slice(modal.indexOf('const handleZustimmungZuruecknehmen = async'), modal.indexOf('\n  };\n', modal.indexOf('const handleZustimmungZuruecknehmen = async')));
    expect(handler).toContain("erhoehungsRpc('mieterhoehung_zustimmung_zuruecknehmen', { p_mieterhoehung_id: vorgang.id })");
    expect(modal).toContain('<AlertDialogAction onClick={handleZustimmungZuruecknehmen}>');
    expect(modal).toContain('onClick={() => setShowConfirmZuruecknehmen(true)}');
  });

  it('der Wächter lässt „zugestimmt“ nur durch Übernahme oder Zurücknehmen enden und prüft jede neue Zustimmung', () => {
    const waechter = abschnitt('create or replace function public.mieterhoehung_status_waechter()', '$function$;');
    expect(waechter).toContain("old.status = 'zugestimmt' and new.status not in ('zugestimmt', 'wirksam')");
    expect(waechter).toContain("current_setting('niimmo.mieterhoehung_zuruecknehmen', true)");
    expect(waechter).toMatch(/if new\.status = 'zugestimmt' and \(tg_op = 'INSERT' or old\.status is distinct from 'zugestimmt'\) then\s*perform public\.mieterhoehung_zustimmung_pruefen\(new\.mietvertrag_id, new\.wirksam_ab, new\.id\);/);
    // SECURITY DEFINER: die Prüfung ist für authenticated gesperrt, läuft aber auch beim Haken aus dem Browser
    expect(waechter).toContain('security definer');
  });

  it('prüft Staffel/Index, Vertragsende und schon vereinbarte Erhöhung — in der Zustimmung vor dem Update', () => {
    const pruefen = abschnitt('create or replace function public.mieterhoehung_zustimmung_pruefen', '$function$;');
    for (const hinweis of ['STAFFEL_ODER_INDEX', 'VERTRAG_ENDET_VORHER', 'SCHON_VEREINBART']) expect(pruefen).toContain(`hint = '${hinweis}'`);
    const zustimmen = abschnitt('create or replace function public.mieterhoehung_zustimmen', '$function$;');
    expect(zustimmen.indexOf('perform public.mieterhoehung_zustimmung_pruefen(')).toBeGreaterThan(-1);
    expect(zustimmen.indexOf('perform public.mieterhoehung_zustimmung_pruefen(')).toBeLessThan(zustimmen.indexOf("set status = 'zugestimmt'"));
  });

  it('prüft auch der Dialog beim Haken, mit denselben Hinweisen', () => {
    expect(modal).toContain('zustimmungHindernis({ mietanpassungArt: contractData.mietanpassung_art, vertragsende: contractData.vertragsende, wirksamAbIso: wirksamAbTag(new Date()) })');
    expect(modal).toMatch(/if \(mieterHatZugestimmt && hakenHindernis\) \{\s*toast\(\{ title: "Zustimmung nicht möglich", description: uebernahmeMeldung\(hakenHindernis\)/);
  });

  it('fehlende Kaltmiete überspringt die Konfliktprüfung nicht mehr', () => {
    expect(migration).toMatch(/v_schon := v_mv\.kaltmiete is not distinct from v_mh\.neue_kaltmiete/);
    expect(migration).toContain('v_mv.kaltmiete is distinct from v_mh.alte_kaltmiete');
  });
});

describe('offizielleErhoehungGiltAb (Vertragsbearbeitung, 29.10.2026)', () => {
  it('gilt ab dem Folgemonat, am Monatsersten ab diesem Monat', () => {
    expect(offizielleErhoehungGiltAb(new Date(2026, 9, 28))).toEqual(new Date(2026, 10, 1));
    expect(offizielleErhoehungGiltAb(new Date(2026, 11, 15))).toEqual(new Date(2027, 0, 1));
    expect(offizielleErhoehungGiltAb(new Date(2026, 10, 1))).toEqual(new Date(2026, 10, 1));
    expect(offizielleErhoehungGiltAbText(new Date(2026, 9, 28))).toBe('1. November 2026');
  });

  it('entspricht der Regel im DB-Trigger der Migration', () => {
    const migration = readFileSync('supabase/migrations/20261029100000_mieterhoehung_ab_folgemonat.sql', 'utf-8');
    expect(migration).toMatch(/when extract\(day from new\.letzte_mieterhoehung_am\) = 1\s+then new\.letzte_mieterhoehung_am\s+else \(date_trunc\('month', new\.letzte_mieterhoehung_am\) \+ interval '1 month'\)::date/);
    // Monate vor der Wirksamkeit mit alter Miete — auch bei gleichzeitiger Datumsänderung (Review 29.10.2026)
    expect(migration).toMatch(/case when v_f\.sollmonat < v_ab then v_alt_miete else v_neu_miete end/);
    expect(migration).toMatch(/elsif v_monat < v_ab then\s+v_basis := v_alt_miete;/);
    expect(migration).toMatch(/and f\.sollmonat >= v_laufend/);
  });
});

describe('Mieterhöhung als Vorgang aus der Vertragsbearbeitung (Kundenentscheidung 29.10.2026)', () => {
  const heute = new Date(2026, 9, 30, 12);
  it('bietet den 1. des laufenden Monats und zwölf folgende Monatserste an, Vorgabe der Folgemonat', () => {
    const optionen = vereinbarungGiltAbOptionen(heute);
    expect(optionen[0]).toBe('2026-10-01');
    expect(optionen[1]).toBe('2026-11-01');
    expect(optionen).toHaveLength(13);
    expect(optionen[12]).toBe('2027-10-01');
    expect(vereinbarungGiltAbVorgabe(heute)).toBe('2026-11-01');
  });

  it('erkennt rückwirkend und datiert das Verlangen dann vor den Wirksamkeitstag', () => {
    expect(erhoehungRueckwirkend('2026-10-01', heute)).toBe(true);
    expect(erhoehungRueckwirkend('2026-11-01', heute)).toBe(false);
    expect(vereinbarungVerlangtAm('2026-10-01', heute)).toBe('2026-09-30');
    expect(vereinbarungVerlangtAm('2026-11-01', heute)).toBe('2026-10-30');
    // Am Monatsersten selbst: gilt heute, also rückwirkend, verlangt am Vortag
    const erster = new Date(2026, 10, 1, 9);
    expect(erhoehungRueckwirkend('2026-11-01', erster)).toBe(true);
    expect(vereinbarungVerlangtAm('2026-11-01', erster)).toBe('2026-10-31');
  });
});

describe('Mieterhöhung nur als Vorgang (Kundenentscheidung 29.10.2026)', () => {
  it('Vertragsbearbeitung und Mietübersicht schreiben bei einer Erhöhung nie selbst Miete oder Erhöhungsdatum', async () => {
    const { readFileSync } = await import('node:fs');
    const hook = readFileSync('src/hooks/useMietvertragMutations.ts', 'utf-8');
    const uebersicht = readFileSync('src/components/dashboard/EditableMietUebersichtModal.tsx', 'utf-8');
    for (const quelle of [hook, uebersicht]) {
      expect(quelle).toContain('mieterhoehungAlsVorgangAnlegen(');
      expect(quelle).not.toMatch(/letzte_mieterhoehung_am[:=]\s*format\(/);
    }
    const vorgang = readFileSync('src/utils/mieterhoehungVorgang.ts', 'utf-8');
    expect(vorgang).toContain("begruendungsart: 'vereinbarung'");
    expect(vorgang).toContain("'mieterhoehung_zustimmen'");
    expect(vorgang).not.toContain(".from('mietvertrag')");
  });
});
