import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  unterschriftAusKontaktname,
  unterzeichnerPruefen,
  unterzeichnerZurAnmeldung,
  type Unterzeichner,
  type UnterzeichnerEintrag,
} from './unterzeichner';

/**
 * Die Mahnung unterschrieb bis zum 30.10.2026 immer Herr Mikyas, gleich wer sie erstellte. Kundenwunsch: der
 * Angemeldete, sonst auswählbar. Seit 02.11.2026 stehen die Unterzeichner in `briefunterzeichner`, und weitere
 * Personen tragen sich im Dialog selbst ein.
 */
const LISTE: UnterzeichnerEintrag[] = [
  { id: 'a', email: 'muster@niimmo.de', kontaktname: 'Frau Maria Muster, M. A.', unterschrift: 'Maria Muster (M. A.)', funktion: 'Hausverwaltung', telefon: '05138 - 600 72 70' },
  { id: 'b', email: 'vogel@niimmo.de', kontaktname: 'Herr Bernd Vogel', unterschrift: 'Bernd Vogel', funktion: 'Prokurist', telefon: '05138 - 600 72 77' },
];

const EINGABE: Unterzeichner = { email: 'neu@niimmo.de', kontaktname: 'Frau Nora Neu', unterschrift: 'Nora Neu', funktion: 'Buchhaltung', telefon: '05138 - 600 72 73' };

describe('Zuordnung zur Anmeldung', () => {
  it('ordnet über die E-Mail zu, unabhängig von Groß- und Kleinschreibung', () => {
    expect(unterzeichnerZurAnmeldung(LISTE, ' VOGEL@niimmo.de ')).toBe(LISTE[1]);
  });

  it('wer nicht eingetragen ist, bekommt keinen Vorschlag und muss wählen', () => {
    expect(unterzeichnerZurAnmeldung(LISTE, 'buchhaltung@example.org')).toBeNull();
    expect(unterzeichnerZurAnmeldung(LISTE, undefined)).toBeNull();
    expect(unterzeichnerZurAnmeldung(LISTE, '  ')).toBeNull();
    expect(unterzeichnerZurAnmeldung([], 'vogel@niimmo.de')).toBeNull();
  });
});

describe('Name unter der Unterschrift aus dem Rückfragenblock', () => {
  it.each([
    ['Herr Ayhan Yeyrek, M. Sc.', 'Ayhan Yeyrek (M. Sc.)'],
    ['Frau Maria Muster', 'Maria Muster'],
    ['Herrn Bernd Vogel', 'Bernd Vogel'],
    ['  Bernd Vogel  ', 'Bernd Vogel'],
    ['Frau Dr. Eva Roth', 'Dr. Eva Roth'],
    ['Herr Max Muster,', 'Max Muster'],
    ['', ''],
  ])('%s → %s', (kontaktname, unterschrift) => {
    expect(unterschriftAusKontaktname(kontaktname)).toBe(unterschrift);
  });

  it('lässt Namen, die nur mit Herr beginnen, stehen', () => {
    expect(unterschriftAusKontaktname('Herrmann Klein')).toBe('Herrmann Klein');
  });
});

describe('Prüfung der Eingabe', () => {
  it('bringt die Eingabe in die Form der Tabelle', () => {
    const { daten, fehler } = unterzeichnerPruefen(
      { email: ' Neu@NiImmo.de ', kontaktname: ' Frau Nora Neu ', unterschrift: 'Nora Neu ', funktion: ' Buchhaltung', telefon: ' 05138 - 600 72 73 ' },
      LISTE,
    );
    expect(fehler).toEqual({});
    expect(daten).toEqual(EINGABE);
  });

  it('verlangt jedes Feld', () => {
    for (const feld of Object.keys(EINGABE) as Array<keyof Unterzeichner>) {
      const { daten, fehler } = unterzeichnerPruefen({ ...EINGABE, [feld]: '   ' }, LISTE);
      expect(daten, feld).toBeNull();
      expect(fehler[feld], feld).toBe('Bitte ausfüllen.');
    }
  });

  // U+0085 lehnt die Tabelle als [[:space:]] ab; JavaScript zählt es nicht zu \s
  it.each(['neu', 'neu@niimmo', 'neu @niimmo.de', 'a@b@niimmo.de', 'neu\u0085x@niimmo.de'])('lehnt die E-Mail „%s“ ab', (email) => {
    const { daten, fehler } = unterzeichnerPruefen({ ...EINGABE, email }, LISTE);
    expect(daten).toBeNull();
    expect(fehler.email).toBe('Bitte eine gültige E-Mail-Adresse eingeben.');
  });

  it('lehnt eine schon eingetragene E-Mail ab, außer beim Ändern des eigenen Eintrags', () => {
    expect(unterzeichnerPruefen({ ...EINGABE, email: 'Vogel@niimmo.de' }, LISTE).fehler.email).toBe('Diese E-Mail ist schon eingetragen.');
    expect(unterzeichnerPruefen({ ...EINGABE, email: 'vogel@niimmo.de' }, LISTE, 'b').daten?.email).toBe('vogel@niimmo.de');
    expect(unterzeichnerPruefen({ ...EINGABE, email: 'vogel@niimmo.de' }, LISTE, 'a').fehler.email).toBe('Diese E-Mail ist schon eingetragen.');
  });
});

describe('Unterzeichner aus der Datenbank', () => {
  const migration = readFileSync('supabase/migrations/20261102100000_briefunterzeichner.sql', 'utf-8');

  it('die Tabelle prüft dieselbe Form wie das Formular und ist nur für Admins', () => {
    expect(migration).toContain('email        text not null unique');
    expect(migration).toContain("check (email = lower(btrim(email))");
    expect(migration).toContain('enable row level security');
    expect(migration.match(/is_admin\(auth\.uid\(\)\)/g)).toHaveLength(3);
    for (const feld of ['kontaktname', 'unterschrift', 'funktion', 'telefon']) {
      expect(migration).toContain(`check (btrim(${feld}) <> '')`);
    }
  });

  it('die Namen stehen nicht mehr im Code', () => {
    expect(readFileSync('src/config/company.ts', 'utf-8')).not.toMatch(/unterzeichner/i);
    for (const datei of ['src/hooks/useUnterzeichnerWahl.ts', 'src/components/dashboard/UnterzeichnerAuswahl.tsx']) {
      const quelle = readFileSync(datei, 'utf-8');
      expect(quelle, datei).not.toContain('COMPANY');
      expect(quelle, datei).toContain('useBriefunterzeichner()');
    }
  });

  it('weitere Personen tragen sich im Auswahlfeld ein und ändern ihre Angaben dort', () => {
    const auswahl = readFileSync('src/components/dashboard/UnterzeichnerAuswahl.tsx', 'utf-8');
    expect(auswahl).toContain('Weitere Person eintragen …');
    expect(auswahl).toContain('Angaben ändern');
    expect(auswahl).toContain('<UnterzeichnerFormular');
    const formular = readFileSync('src/components/dashboard/UnterzeichnerFormular.tsx', 'utf-8');
    expect(formular).toContain('unterzeichnerPruefen(werte, eintraege, eintrag?.id)');
    // Kein <form> im Dialog im Dialog: Ein Absenden reichte sonst über das Portal in den umgebenden Dialog durch
    expect(formular).not.toContain('<form');
  });

  it('alle Schreiben mit Unterschrift belegen gleich vor und entstehen ohne Wahl nicht (31.10.2026)', () => {
    const dialoge: Array<[string, RegExp]> = [
      ['src/components/dashboard/MahnungErstellungModal.tsx', /if \(!contractData \|\| !unterzeichner\) return null;/],
      ['src/components/dashboard/termination/TerminationDialog.tsx', /if \(!unterzeichner\) return null;/],
      ['src/components/dashboard/termination/KuendigungsbestaetigungDialog.tsx', /if \(!vertrag\?\.vertragsende \|\| !unterzeichner\) return null;/],
      ['src/components/dashboard/rent-increase/RentIncreaseModal.tsx', /if \(!contractData \|\| !unterzeichner\) return null;/],
    ];
    for (const [datei, sperre] of dialoge) {
      const quelle = readFileSync(datei, 'utf-8');
      expect(quelle, datei).toContain('useUnterzeichnerWahl(isOpen)');
      expect(quelle, datei).toMatch(/<UnterzeichnerAuswahl wert=\{unterzeichnerId\} onChange=\{setUnterzeichnerId\}/);
      expect(quelle, datei).toMatch(sperre);
    }
  });
});
