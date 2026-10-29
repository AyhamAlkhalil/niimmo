import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OffeneMietenListe, OffeneMietenZeilen } from './OffeneMietenListe';
import { anzahlMieter, nachMieter } from '@/utils/offeneMieten';
import type { OffeneMiete } from '@/hooks/useRueckstaende';

const eintrag = (n: number, teilweise = false): OffeneMiete => ({
  mietvertrag_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  mieter_name: `Mieter ${n}`,
  immobilie_name: `Objekt ${n}`,
  einheit: 'Wohnung · EG',
  offen: 500 - n,
  teilweise_bezahlt: teilweise,
  mieter_ids: [`mieter-${n}`],
  mieter_namen: [`Mieter ${n}`],
});
const garageVon = (n: number, nr: number): OffeneMiete => ({
  ...eintrag(nr), mieter_name: `Mieter ${n}`, mieter_ids: [`mieter-${n}`], mieter_namen: [`Mieter ${n}`], einheit: 'Garage',
});

describe('OffeneMietenListe', () => {
  it('ist zugeklappt: nur der Satz und die älteren Rückstände, die Liste erst nach Klick (Kundenmeldung 29.10.2026)', () => {
    const html = renderToStaticMarkup(
      <OffeneMietenListe eintraege={[eintrag(1), eintrag(2, true)]} monat="Oktober" aelter={500} onRueckstaendeZeigen={() => {}} />
    );
    expect(html).toContain('2 Mieter</span> haben die Oktobermiete noch nicht bezahlt');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Anzeigen');
    expect(html).not.toContain('<ul');
    expect(html).not.toContain('href="/?vertrag=');
    expect(html).toContain('Dazu 500 € Rückstände aus früheren Monaten.');
    expect(html).toContain('Zu den Rückständen');
  });

  it('nutzt die Einzahl und meldet, wenn alle bezahlt haben', () => {
    expect(renderToStaticMarkup(<OffeneMietenListe eintraege={[eintrag(1)]} monat="Oktober" aelter={0} />))
      .toContain('1 Mieter</span> hat die Oktobermiete noch nicht bezahlt');
    const alle = renderToStaticMarkup(<OffeneMietenListe eintraege={[]} monat="Oktober" aelter={7872.28} onRueckstaendeZeigen={() => {}} />);
    expect(alle).toContain('Alle Mieter haben die Oktobermiete bezahlt.');
    expect(alle).not.toContain('aria-expanded');
    expect(alle).toContain('Dazu 7.872,28 € Rückstände aus früheren Monaten.');
    expect(alle).toContain('Zu den Rückständen');
  });

  it('zählt in der Überschrift so viele Mieter, wie die Liste Zeilen hat — Wohnung und Garage sind ein Mieter', () => {
    const eintraege = [eintrag(1), garageVon(1, 9), eintrag(2)];
    expect(anzahlMieter(eintraege)).toBe(2);
    expect(renderToStaticMarkup(<OffeneMietenListe eintraege={eintraege} monat="Oktober" aelter={0} />))
      .toContain('2 Mieter</span> haben die Oktobermiete noch nicht bezahlt');
    const zeilen = renderToStaticMarkup(<OffeneMietenZeilen mieter={nachMieter(eintraege)} />);
    // Zwei Mieterzeilen, die erste mit zwei Verträgen darunter
    expect(zeilen.match(/<li>/g)).toHaveLength(2 + 2);
    expect(zeilen.indexOf('Mieter 1')).toBeLessThan(zeilen.indexOf('Mieter 2'));
    expect(zeilen).toContain('990 € offen');
    expect(zeilen).toContain('2 Verträge');
    expect(zeilen).toContain('Objekt 9 · Garage');
  });
});

describe('OffeneMietenZeilen', () => {
  it('öffnet jeden Vertrag im neuen Tab, auch beide Verträge eines Mieters', () => {
    const html = renderToStaticMarkup(<OffeneMietenZeilen mieter={nachMieter([eintrag(1), eintrag(2, true), garageVon(1, 9)])} />);
    expect(html).toContain('href="/?vertrag=00000000-0000-4000-8000-000000000001"');
    expect(html).toContain('href="/?vertrag=00000000-0000-4000-8000-000000000009"');
    expect(html.match(/target="_blank"/g)).toHaveLength(3);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(3);
    expect(html).toContain('Objekt 2 · Wohnung · EG · teilweise bezahlt');
    expect(html).toContain('öffnet den Vertrag in einem neuen Tab');
  });

  it('nennt bei zusammengefassten Verträgen die Mieter, die der Name der Zeile nicht nennt (Gegenprüfung)', () => {
    const v4: OffeneMiete = { ...eintrag(4), mieter_name: 'Ben Bauer und Carla Clausen', mieter_ids: ['b', 'c'], mieter_namen: ['Ben Bauer', 'Carla Clausen'] };
    const v5: OffeneMiete = { ...eintrag(5), mieter_name: 'Carla Clausen und Dora Dorn', mieter_ids: ['c', 'd'], mieter_namen: ['Carla Clausen', 'Dora Dorn'] };
    const html = renderToStaticMarkup(<OffeneMietenZeilen mieter={nachMieter([v4, v5])} />);
    expect(html).toContain('Ben Bauer u. a.');
    expect(html).toContain('Objekt 5 · Wohnung · EG · Carla Clausen und Dora Dorn');
    expect(html).toContain('(Carla Clausen und Dora Dorn, öffnet den Vertrag in einem neuen Tab)');
  });
});
