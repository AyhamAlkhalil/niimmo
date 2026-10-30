import { describe, expect, it } from 'vitest';
import {
  kuendigungsrueckstandErreicht,
  mietanteilAmStichtag,
  mietrueckstand,
  monatText,
  offenePosten,
  rueckstandInMonatsmieten,
  rueckstandSeit,
} from './rueckstandSeit';
import { berechneMietkontostand, nurFaelligeForderungen } from './rueckstandsberechnung';

const miete = (monat: string, betrag = 500, typ = 'Miete') => ({
  sollmonat: `${monat}-01`, sollbetrag: betrag, faelligkeitsdatum: `${monat}-08`, typ,
});
const zahlung = (tag: string, betrag = 500, kategorie = 'Miete') => ({ buchungsdatum: tag, betrag, kategorie });
const vierMonate = [miete('2026-07'), miete('2026-08'), miete('2026-09'), miete('2026-10')];

describe('rueckstandSeit — seit wann das Konto nicht ausgeglichen ist', () => {
  it('nennt den ausgelassenen Monat, auch wenn seitdem jeden Monat gezahlt wurde (Review)', () => {
    const z = [zahlung('2026-08-03'), zahlung('2026-09-03'), zahlung('2026-10-03')];
    expect(rueckstandSeit(vierMonate, z, 500)).toBe('2026-07');
  });

  it('beginnt neu, sobald das Konto einmal ausgeglichen war', () => {
    const z = [zahlung('2026-07-03'), zahlung('2026-08-03')];
    expect(rueckstandSeit(vierMonate, z, 1000)).toBe('2026-09');
    // Zahlt immer erst am 15.: zwischendurch im Rückstand, danach wieder ausgeglichen; offen ist nur Oktober
    const spaet = [zahlung('2026-07-15'), zahlung('2026-08-15'), zahlung('2026-09-15')];
    expect(rueckstandSeit(vierMonate, spaet, 500)).toBe('2026-10');
  });

  it('rechnet eine Nachzahlung auf den ältesten offenen Monat und folgt dem zugeordneten Monat', () => {
    // Juli ausgelassen, im September doppelt gezahlt: Juli ist nachgezahlt, offen bleibt nur Oktober
    const nachgezahlt = [zahlung('2026-08-03'), zahlung('2026-09-03', 1000)];
    expect(rueckstandSeit(vierMonate, nachgezahlt, 500)).toBe('2026-10');
    // Am 29.09. gezahlt, von der DB dem Oktober zugeordnet: September ist offen, nicht Oktober
    const vorgezogen = [zahlung('2026-07-03'), zahlung('2026-08-03'), { ...zahlung('2026-09-29'), zugeordneter_monat: '2026-10' }];
    expect(rueckstandSeit(vierMonate, vorgezogen, 500)).toBe('2026-09');
  });

  it('lässt Cent-Reste und Kautionen außen vor', () => {
    const z = [zahlung('2026-07-03', 499.5), zahlung('2026-08-03'), zahlung('2026-09-03'), zahlung('2026-07-01', 1500, 'Kaution')];
    expect(rueckstandSeit(vierMonate, z, 500.5)).toBe('2026-10');
  });

  it('nennt ohne Rückstand nichts und fällt sonst auf den ältesten offenen Monat zurück', () => {
    expect(rueckstandSeit(vierMonate, [], 0)).toBeNull();
    expect(rueckstandSeit(vierMonate, [], -50)).toBeNull();
    expect(rueckstandSeit([], [], 100)).toBeNull();
    // Kontoführung sieht einen Rückstand, die Tagesrechnung nicht (z. B. BKA-Zahlung ohne BKA-Forderung)
    const z = [zahlung('2026-07-03'), zahlung('2026-08-03'), zahlung('2026-09-03'), zahlung('2026-10-03', 500, 'Betriebskostenabrechnung')];
    expect(rueckstandSeit(vierMonate, z, 500)).toBe('2026-10');
  });

  it('nennt bei einer BKA-Nachzahlung den Monat, in dem sie fällig wurde', () => {
    const bka = { sollmonat: '2026-08-01', sollbetrag: 300, faelligkeitsdatum: '2026-09-20', typ: 'BKA' };
    const z = [zahlung('2026-07-03'), zahlung('2026-08-03'), zahlung('2026-09-03'), zahlung('2026-10-03')];
    expect(rueckstandSeit([...vierMonate, bka], z, 300)).toBe('2026-09');
  });
});

describe('mietrueckstand', () => {
  it('zählt nur Monatsmieten, keine BKA-Nachzahlung und keine Gebühr', () => {
    const bka = { sollmonat: '2026-09-01', sollbetrag: 600, faelligkeitsdatum: '2026-10-10', typ: 'BKA' };
    expect(mietrueckstand([...vierMonate, bka], 600)).toBe(0);
    expect(mietrueckstand([...vierMonate, bka], 1100)).toBe(500);
    const gebuehr = { sollmonat: '2026-10-01', sollbetrag: 7.5, faelligkeitsdatum: '2026-10-20', typ: 'Miete', ruecklastschrift_am: '2026-10-20' };
    expect(mietrueckstand([...vierMonate, gebuehr], 507.5)).toBe(500);
  });
});

describe('rueckstandInMonatsmieten', () => {
  it('rundet ab: 1,95 sind noch keine zwei Monatsmieten (Review)', () => {
    expect(rueckstandInMonatsmieten(975, 500)).toBe(1.9);
    expect(rueckstandInMonatsmieten(1050, 500)).toBe(2.1);
    expect(rueckstandInMonatsmieten(1150, 500)).toBe(2.3);
    expect(rueckstandInMonatsmieten(500, 500)).toBe(1);
  });

  it('nennt unter 0,1 und ohne Miete nichts', () => {
    expect(rueckstandInMonatsmieten(10, 500)).toBeNull();
    expect(rueckstandInMonatsmieten(100, 0)).toBeNull();
    expect(rueckstandInMonatsmieten(0, 500)).toBeNull();
  });
});

describe('monatText', () => {
  it('schreibt den Monat aus', () => {
    expect(monatText('2026-09')).toBe('September 2026');
    expect(monatText('2027-01')).toBe('Januar 2027');
    expect(monatText('2026-03')).toBe('März 2026');
  });
});

describe('Stufe 3: Mietanteil und Schwelle (30.10.2026, gleich in Dialog und send-mahnung)', () => {
  const vertrag = { status: 'aktiv', start_datum: '2026-01-01', kaltmiete: 500, betriebskosten: 100 };
  const miete = (monat: string) => ({ sollmonat: `${monat}-01`, sollbetrag: 600, faelligkeitsdatum: `${monat}-08`, typ: 'Miete' });
  const forderungen = [
    miete('2026-08'), miete('2026-09'), miete('2026-10'),
    { sollmonat: '2026-09-01', sollbetrag: 450, faelligkeitsdatum: '2026-09-20', typ: 'BKA' },
  ];
  const stichtag = new Date(2026, 9, 30, 12);

  it('mietanteilAmStichtag ist genau, was die Vertragsansicht dem Dialog gibt', () => {
    const zahlungen = [
      { betrag: 600, buchungsdatum: '2026-08-05', kategorie: 'Miete', zugeordneter_monat: '2026-08' },
      { betrag: 200, buchungsdatum: '2026-10-05', kategorie: 'Miete', zugeordneter_monat: '2026-10' },
    ];
    const rueckstand = Math.max(0, berechneMietkontostand(vertrag, forderungen, zahlungen, stichtag).rueckstand);
    const posten = offenePosten(nurFaelligeForderungen(forderungen, stichtag), rueckstand);
    const imDialog = posten.filter((p) => p.art === 'Miete').reduce((s, p) => s + p.betrag, 0);
    // 2.250 € fällig, 800 € gezahlt: 1.450 € offen, davon 450 € BKA-Nachzahlung
    expect(rueckstand).toBe(1450);
    expect(mietanteilAmStichtag(vertrag, forderungen, zahlungen, stichtag)).toBe(1000);
    expect(mietanteilAmStichtag(vertrag, forderungen, zahlungen, stichtag)).toBe(Math.round(imDialog * 100) / 100);
  });

  it('kündigt erst, wenn der Mietanteil eine Monatsmiete übersteigt', () => {
    expect(kuendigungsrueckstandErreicht(600, 600)).toBe(false);
    expect(kuendigungsrueckstandErreicht(600.005, 600)).toBe(false);
    expect(kuendigungsrueckstandErreicht(600.01, 600)).toBe(true);
    expect(kuendigungsrueckstandErreicht(1000, 600)).toBe(true);
  });

  it('BKA-Nachzahlung und Gebühren heben den Mietanteil nicht über die Schwelle', () => {
    const zahlungen = [
      { betrag: 600, buchungsdatum: '2026-08-05', kategorie: 'Miete', zugeordneter_monat: '2026-08' },
      { betrag: 600, buchungsdatum: '2026-09-05', kategorie: 'Miete', zugeordneter_monat: '2026-09' },
    ];
    // Offen: Oktobermiete 600 € und BKA 450 € — 1.050 € Rückstand, aber nur eine Monatsmiete
    const anteil = mietanteilAmStichtag(vertrag, forderungen, zahlungen, stichtag);
    expect(anteil).toBe(600);
    expect(kuendigungsrueckstandErreicht(anteil, 600)).toBe(false);
  });

  it('bei gleicher Fälligkeit bleibt die Gebühr offen, nicht die Monatsmiete — unabhängig von der Reihenfolge', () => {
    const okt = miete('2026-10');
    const gebuehr = { sollmonat: '2026-10-01', sollbetrag: 7.5, faelligkeitsdatum: '2026-10-08', typ: 'Miete', ruecklastschrift_am: '2026-10-06' };
    for (const reihe of [[okt, gebuehr], [gebuehr, okt]]) {
      expect(offenePosten(reihe, 7.5)).toEqual([{ monat: '2026-10', betrag: 7.5, art: 'Rücklastschriftgebühr' }]);
    }
  });
});
