import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BestehendeZahlung,
  NachtragKontext,
  VertragsKonten,
  abgleichSchluessel,
  bestehendeAusschliessen,
  bestehendeIndexieren,
  bezugPruefen,
  ibanFuerNachtrag,
  buchungstageVon,
  mieterKennungen,
  nimmBestehende,
  normalisiereWert,
  vertragsIdsMitIban,
} from './zahlungenUebernahme';

function zeile(teil: Partial<BestehendeZahlung>): BestehendeZahlung {
  return {
    id: 'z1',
    kategorie: 'Miete',
    mietvertrag_id: 'mv1',
    buchungsdatum: '2026-09-01',
    betrag: 850,
    iban: 'DE00',
    verwendungszweck: 'Miete September',
    ...teil,
  };
}

describe('normalisiereWert', () => {
  it('macht aus leer und Leerraum null, wie die Übernahme vor dem Vergleich', () => {
    expect(normalisiereWert(undefined)).toBeNull();
    expect(normalisiereWert(null)).toBeNull();
    expect(normalisiereWert('')).toBeNull();
    expect(normalisiereWert('   ')).toBeNull();
    expect(normalisiereWert('  DE00 ')).toBe('DE00');
  });
});

describe('abgleichSchluessel', () => {
  it('vergleicht Beträge numerisch, wie die Datenbank', () => {
    expect(abgleichSchluessel(zeile({ betrag: '850.00' }))).toBe(abgleichSchluessel(zeile({ betrag: 850 })));
    expect(abgleichSchluessel(zeile({ betrag: 850.5 }))).not.toBe(abgleichSchluessel(zeile({ betrag: 850 })));
  });

  it('hält null und Leerstring auseinander — .is(null) trifft keinen Leerstring', () => {
    expect(abgleichSchluessel(zeile({ iban: null }))).not.toBe(abgleichSchluessel(zeile({ iban: '' })));
    expect(abgleichSchluessel(zeile({ verwendungszweck: null }))).not.toBe(abgleichSchluessel(zeile({ verwendungszweck: '' })));
  });

  it('unterscheidet Tag, IBAN und Verwendungszweck', () => {
    const basis = abgleichSchluessel(zeile({}));
    expect(abgleichSchluessel(zeile({ buchungsdatum: '2026-09-02' }))).not.toBe(basis);
    expect(abgleichSchluessel(zeile({ iban: 'DE01' }))).not.toBe(basis);
    expect(abgleichSchluessel(zeile({ verwendungszweck: 'Miete Oktober' }))).not.toBe(basis);
  });
});

describe('nimmBestehende', () => {
  const neuerIndex = () =>
    bestehendeIndexieren([
      zeile({ id: 'a' }),
      zeile({ id: 'b', iban: null }),
      zeile({ id: 'c', betrag: '850.00', verwendungszweck: null }),
      zeile({ id: 'd' }),
    ]);
  const september = { buchungsdatum: '2026-09-01', betrag: 850, iban: 'DE00', verwendungszweck: 'Miete September' };

  it('findet die erste passende Buchung', () => {
    expect(nimmBestehende(neuerIndex(), september)?.id).toBe('a');
  });

  it('trifft nur bei gleichen Null-Werten', () => {
    const index = neuerIndex();
    expect(nimmBestehende(index, { ...september, iban: null })?.id).toBe('b');
    expect(nimmBestehende(index, { ...september, verwendungszweck: null })?.id).toBe('c');
    expect(nimmBestehende(index, { ...september, iban: null, verwendungszweck: null })).toBeNull();
  });

  it('liefert null für andere Beträge oder Tage', () => {
    const index = neuerIndex();
    expect(nimmBestehende(index, { ...september, betrag: 851 })).toBeNull();
    expect(nimmBestehende(index, { ...september, buchungsdatum: '2026-08-01' })).toBeNull();
  });

  it('stellt jede Bestandsbuchung nur einer Importzeile gegenüber', () => {
    // 27.10.2026: Zwei gleiche Überweisungen am selben Tag wurden zu einer
    const index = neuerIndex();
    expect(nimmBestehende(index, september)?.id).toBe('a');
    expect(nimmBestehende(index, september)?.id).toBe('d');
    expect(nimmBestehende(index, september)).toBeNull();
  });

  it('lässt Buchungen aus, die process-payments schon als Duplikat gezählt hat', () => {
    const index = neuerIndex();
    bestehendeAusschliessen(index, new Set(['a', 'c']));
    expect(nimmBestehende(index, september)?.id).toBe('d');
    expect(nimmBestehende(index, september)).toBeNull();
    expect(nimmBestehende(index, { ...september, verwendungszweck: null })).toBeNull();
  });
});

describe('Vorabfrage-Filter', () => {
  it('sammelt eindeutige Buchungstage sortiert und ohne Leerwerte', () => {
    expect(buchungstageVon([{ buchungsdatum: '2026-09-03' }, { buchungsdatum: '2026-09-01' }, { buchungsdatum: '2026-09-03' }, { buchungsdatum: null }, {}])).toEqual([
      '2026-09-01',
      '2026-09-03',
    ]);
  });

  it('sammelt nur Verträge, bei denen eine IBAN nachgetragen werden könnte', () => {
    expect(
      vertragsIdsMitIban([
        { mietvertrag_id: 'mv1', iban: 'DE00' },
        { mietvertrag_id: 'mv1', iban: 'DE01' },
        { mietvertrag_id: 'mv2', iban: '' },
        { mietvertrag_id: null, iban: 'DE02' },
        { mietvertrag_id: 'mv3', iban: 'DE03' },
      ])
    ).toEqual(['mv1', 'mv3']);
  });
});

describe('Vertrag oder Objekt, nie beides', () => {
  it('speichert beim CSV-Import keinen Objektbezug neben einem Vertrag', () => {
    // 27.10.2026: Fünf Altbuchungen trugen beide Bezüge und zählten doppelt
    const quelle = readFileSync('src/components/controlboard/PaymentManagement.tsx', 'utf-8');
    expect(quelle).toMatch(/const objektBezug = \(r: Zuordnungsvorschlag\) => \(r\.mietvertrag_id \? null : r\.immobilie_id \|\| null\);/);
    expect(quelle.match(/immobilie_id: objektBezug\(result\)/g)).toHaveLength(2);
    expect(quelle).not.toMatch(/immobilie_id: result\.immobilie_id \|\| null/);
  });

  it('räumt im Assistenten beim Zuordnen zu einem Vertrag den Objektbezug ab', () => {
    const agent = readFileSync('supabase/functions/agent-api/index.ts', 'utf-8');
    expect(agent).toMatch(/\.update\(\{ mietvertrag_id: args\.mietvertrag_id, kategorie: args\.kategorie, immobilie_id: null \}\)/);
  });
});

describe('ibanFuerNachtrag', () => {
  const konto = (id: string, bankkonto: string | null, mieter: string[], weitere: string | null = null): VertragsKonten => ({
    id, bankkonto_mieter: bankkonto, weitere_bankkonten: weitere, mieterKennungen: mieter,
  });
  const LEER: NachtragKontext = { vertraege: [konto('mv1', null, ['id:m1'])], nichtIdentifizierend: new Set() };

  it('trägt nur die IBAN einer Mietzahlung nach, nie die des Jobcenters', () => {
    // 27.10.2026: Sammelkonten, Rücklastschriften und Jobcenter wurden zum Mieterkonto
    expect(ibanFuerNachtrag('Miete', 'de00 1111 2222 3333 4444 55', 'mv1', LEER)).toBe('DE00111122223333444455');
    expect(ibanFuerNachtrag('Mietkaution', 'DE00111122223333444455', 'mv1', LEER)).toBeNull();
    expect(ibanFuerNachtrag('Rücklastschrift', 'DE00111122223333444455', 'mv1', LEER)).toBeNull();
    expect(ibanFuerNachtrag('Miete', 'DE94 7600 0000 0076 0016 01', 'mv1', LEER)).toBeNull();
    expect(ibanFuerNachtrag('Miete', 'kein Konto', 'mv1', LEER)).toBeNull();
  });

  it('trägt kein Sammel- oder Bankkonto und keine IBAN eines fremden Vertrags nach', () => {
    // 28.10.2026: Ein Konto der Bank für Retouren und Kautionsüberträge wurde Hauptkonto eines Vertrags,
    // jede Buchung von dort ging danach vorausgewählt an ihn
    const IBAN = 'DE00111122223333444455';
    const sammel: NachtragKontext = { ...LEER, nichtIdentifizierend: new Set([IBAN]) };
    expect(ibanFuerNachtrag('Miete', 'DE00 1111 2222 3333 4444 55', 'mv1', sammel)).toBeNull();

    const vertraege = [
      konto('wohnung', 'DE00 1111 2222 3333 4444 55', ['id:m1', 'name:anna|beispiel']),
      konto('garage', null, ['id:m1', 'name:anna|beispiel']),
      konto('zweitdatensatz', null, ['id:m9', 'name:anna|beispiel']),
      konto('fremd', null, ['id:m2', 'name:max|muster']),
      konto('weitere', null, ['id:m3'], 'DE99000000000000000000, de00 2222 3333 4444 5555 66'),
    ];
    const kontext: NachtragKontext = { vertraege, nichtIdentifizierend: new Set() };
    // Wohnung und Garage derselben Mieter dürfen dieselbe IBAN tragen, auch über einen zweiten Mieterdatensatz
    expect(ibanFuerNachtrag('Miete', IBAN, 'garage', kontext)).toBe(IBAN);
    expect(ibanFuerNachtrag('Miete', IBAN, 'zweitdatensatz', kontext)).toBe(IBAN);
    // An einem fremden Vertrag hinterlegt, als Haupt- oder weiteres Konto: kein Nachtrag
    expect(ibanFuerNachtrag('Miete', IBAN, 'fremd', kontext)).toBeNull();
    expect(ibanFuerNachtrag('Miete', 'DE00222233334444555566', 'fremd', kontext)).toBeNull();
    // Am Zielvertrag selbst als weiteres Konto: kein fremder Vertrag
    expect(ibanFuerNachtrag('Miete', 'DE00222233334444555566', 'weitere', kontext)).toBe('DE00222233334444555566');
    // Nirgends hinterlegt
    expect(ibanFuerNachtrag('Miete', 'DE00333344445555666677', 'fremd', kontext)).toBe('DE00333344445555666677');
  });

  it('wird von der Übernahme mit Kategorie, Vertrag und Kontext aufgerufen', () => {
    const quelle = readFileSync('src/components/controlboard/PaymentManagement.tsx', 'utf-8');
    expect(quelle.match(/ibanNachtragen\(result\.mietvertrag_id, result\.kategorie, result\.iban\)/g)).toHaveLength(2);
    expect(quelle).toMatch(/ibanFuerNachtrag\(kategorie, roheIban, mietvertragId, nachtragKontext\)/);
    // Die erkannten Sammelkonten kommen aus process-payments, die Konten aller Verträge seitenweise
    expect(quelle).toMatch(/nichtIdentifizierend: new Set\(\(aiSammelkonten \?\? \[\]\)\.map\(normalisiereIban\)\)/);
    // Scheiterte die Erkennung in process-payments (null), wird gar nichts nachgetragen
    expect(quelle).toMatch(/result\.nicht_identifizierende_ibans === null \? null/);
    expect(quelle).toMatch(/if \(vorabfrageOk && aiSammelkonten !== null && vertragsIdsMitIban/);
    expect(quelle).toMatch(/alleSeiten<VertragKontoRoh>/);
    // Nach dem Nachtrag fortgeschrieben, damit dieselbe IBAN im selben Import keinem fremden Vertrag zufällt
    expect(quelle).toMatch(/if \(!error\) vertrag\.bankkonto_mieter = iban;/);
  });
});

describe('mieterKennungen', () => {
  it('kennt Mieter über die ID und über den vollen Namen', () => {
    expect(mieterKennungen([
      { mieter_id: 'm1', mieter: { vorname: ' Anna ', nachname: 'Beispiel' } },
      { mieter_id: 'm2', mieter: { vorname: '', nachname: 'Firma GmbH' } },
      { mieter_id: null, mieter: null },
    ])).toEqual(['id:m1', 'name:anna|beispiel', 'id:m2']);
    expect(mieterKennungen(null)).toEqual([]);
  });

  it('vergleicht wie process-payments: Vor- und Nachname getrennt, Unicode-Normalform', () => {
    // Review 28.10.2026: „Anna Maria“ + „Beispiel“ ist nicht „Anna“ + „Maria Beispiel“; ü zerlegt = ü
    expect(mieterKennungen([{ mieter: { vorname: 'Anna Maria', nachname: 'Beispiel' } }]))
      .not.toEqual(mieterKennungen([{ mieter: { vorname: 'Anna', nachname: 'Maria Beispiel' } }]));
    expect(mieterKennungen([{ mieter: { vorname: 'Jörg', nachname: 'Mu\u0308ller' } }])).toEqual(['name:jörg|müller']);
  });
});

describe('bezugPruefen', () => {
  // 28.10.2026: Der Text "null" kam aus der KI als Vertrag; das Speichern scheiterte an der UUID
  const ID = '0b6f1c9e-2a3d-4e5f-8a9b-0c1d2e3f4a5b';

  it('lässt nur Bezüge in UUID-Form durch und meldet verworfene', () => {
    expect(bezugPruefen({ mietvertrag_id: ID, immobilie_id: null })).toEqual({ mietvertrag_id: ID, immobilie_id: null, verworfen: false });
    expect(bezugPruefen({ mietvertrag_id: ` ${ID} ` })).toMatchObject({ mietvertrag_id: ID, verworfen: false });
    expect(bezugPruefen({ mietvertrag_id: 'null' })).toEqual({ mietvertrag_id: null, immobilie_id: null, verworfen: true });
    expect(bezugPruefen({ mietvertrag_id: null, immobilie_id: 'undefined' })).toMatchObject({ immobilie_id: null, verworfen: true });
    expect(bezugPruefen({ mietvertrag_id: '', immobilie_id: undefined })).toMatchObject({ mietvertrag_id: null, verworfen: false });
    expect(bezugPruefen({})).toMatchObject({ verworfen: false });
  });

  it('prüft jede Zeile vor dem Speichern und speichert sie ohne den kaputten Bezug', () => {
    const quelle = readFileSync('src/components/controlboard/PaymentManagement.tsx', 'utf-8');
    expect(quelle).toMatch(/const bezug = bezugPruefen\(roh\);/);
    expect(quelle).toMatch(/const result: Zuordnungsvorschlag = \{ \.\.\.roh, mietvertrag_id: bezug\.mietvertrag_id, immobilie_id: bezug\.immobilie_id \};/);
  });

  it('meldet nur Zeilen, die wirklich ohne Bezug gespeichert wurden', () => {
    // Review 28.10.2026: Gezählt wurden auch übersprungene Zeilen und solche, die ihren Vertrag behielten
    const quelle = readFileSync('src/components/controlboard/PaymentManagement.tsx', 'utf-8');
    expect(quelle).toMatch(/if \(bezug\.verworfen && !result\.mietvertrag_id && !objektBezug\(result\)\) nichtZuordenbar\.push/);
    // Je einmal nach erfolgreichem Aktualisieren und nach erfolgreichem Einfügen, nach der Fehlerprüfung
    expect(quelle.match(/continue;\s*\}\s*ohneBezugGespeichert\(\);/g)).toHaveLength(2);
    expect(quelle.match(/ohneBezugGespeichert\(\);/g)).toHaveLength(2);
  });
});

describe('Upload-Protokoll', () => {
  it('prüft den Eintrag in csv_uploads und meldet einen Fehlschlag, ohne die Übernahme abzubrechen', () => {
    // 28.10.2026: Der Fehler wurde verworfen, der Import fehlte still im Upload-Verlauf
    const quelle = readFileSync('src/components/controlboard/PaymentManagement.tsx', 'utf-8');
    expect(quelle).toMatch(/const \{ error: protokollFehler \} = await supabase\.from\('csv_uploads'\)\.insert\(/);
    expect(quelle).toMatch(/if \(protokollFehler\) \{[\s\S]{0,200}hinweise\.push\(/);
    expect(quelle).not.toMatch(/await supabase\.from\('csv_uploads'\)\.insert\(\{[^}]*\}\);\s*\}/);
  });

  it('gibt die Hinweise an die Prüfmaske zurück, die sie in ihrer einen Meldung zeigt', () => {
    // Review 28.10.2026: Ein eigener Toast per setTimeout ersetzte die Erfolgsmeldung (TOAST_LIMIT 1)
    const quelle = readFileSync('src/components/controlboard/PaymentManagement.tsx', 'utf-8');
    expect(quelle).not.toMatch(/setTimeout/);
    expect(quelle).toMatch(/return \{ gesamt: allResultsToSave\.length, gespeichert, fehler, hinweise \};/);
    // Mit Fehlern stehen die Hinweise in der Fehlermeldung
    expect(quelle).toMatch(/\(hinweise\.length > 0 \? ` \$\{hinweise\.join\(' '\)\}` : ''\),\s*variant: 'destructive',/);
    const maske = readFileSync('src/components/controlboard/PaymentAssignmentResultsModal.tsx', 'utf-8');
    expect(maske).toMatch(/hinweise\?: string\[\]/);
    expect(maske).toMatch(/const hinweise = ergebnis && "hinweise" in ergebnis \? ergebnis\.hinweise \?\? \[\] : \[\];/);
    expect(maske).toMatch(/title: "Zuordnungen übernommen — bitte prüfen", description: `\$\{gespeichert\} \$\{hinweise\.join\(" "\)\}`/);
  });

  it('zeigt Warnungen von process-payments in der Meldung nach dem Einlesen', () => {
    const quelle = readFileSync('src/components/controlboard/PaymentManagement.tsx', 'utf-8');
    expect(quelle).toMatch(/const warnungen: string\[\] = Array\.isArray\(result\.warnungen\) \? result\.warnungen : \[\];/);
    expect(quelle).toMatch(/\$\{warnungen\.length > 0 \? ` \$\{warnungen\.join\(' '\)\}` : ''\}/);
  });
});
