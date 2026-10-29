import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OFFENE_MIETEN_SICHTBAR, OffeneMietenListe } from './OffeneMietenListe';
import { anzahlMieter } from '@/utils/offeneMieten';
import type { OffeneMiete } from '@/hooks/useRueckstaende';

const eintrag = (n: number, teilweise = false): OffeneMiete => ({
  mietvertrag_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  mieter_name: `Mieter ${n}`,
  immobilie_name: `Objekt ${n}`,
  einheit: 'Wohnung · EG',
  offen: 500 - n,
  teilweise_bezahlt: teilweise,
  mieter_schluessel: `mieter-${n}`,
});

describe('OffeneMietenListe', () => {
  it('sagt in einem Satz, wie viele Mieter noch nicht bezahlt haben, und öffnet Verträge im neuen Tab', () => {
    const html = renderToStaticMarkup(
      <OffeneMietenListe eintraege={[eintrag(1), eintrag(2, true)]} monat="Oktober" aelter={0} vertraegeAelter={0} />
    );
    expect(html).toContain('2 Mieter</span> haben die Oktobermiete noch nicht bezahlt:');
    expect(html).toContain('href="/?vertrag=00000000-0000-4000-8000-000000000001"');
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Objekt 2 · Wohnung · EG · teilweise bezahlt');
    expect(html).toContain('öffnet den Vertrag in einem neuen Tab');
    expect(html).not.toContain('Rückstände aus früheren Monaten');
  });

  it('nutzt die Einzahl und meldet, wenn alle bezahlt haben', () => {
    expect(renderToStaticMarkup(<OffeneMietenListe eintraege={[eintrag(1)]} monat="Oktober" aelter={0} vertraegeAelter={0} />))
      .toContain('1 Mieter</span> hat die Oktobermiete noch nicht bezahlt:');
    const alle = renderToStaticMarkup(<OffeneMietenListe eintraege={[]} monat="Oktober" aelter={0} vertraegeAelter={0} />);
    expect(alle).toContain('Alle Mieter haben die Oktobermiete bezahlt.');
    expect(alle).not.toContain('<ul');
  });

  it('zeigt zuerst nur die ersten Zeilen und bietet „Alle anzeigen“ an', () => {
    const viele = Array.from({ length: OFFENE_MIETEN_SICHTBAR + 3 }, (_, i) => eintrag(i + 1));
    const html = renderToStaticMarkup(<OffeneMietenListe eintraege={viele} monat="Oktober" aelter={0} vertraegeAelter={0} />);
    expect(html.match(/<li>/g)).toHaveLength(OFFENE_MIETEN_SICHTBAR);
    expect(html).toContain(`Alle ${viele.length} anzeigen`);
    expect(html).toContain('aria-expanded="false"');
  });

  it('nennt ältere Rückstände getrennt mit Sprung zur Rückstandsliste', () => {
    const html = renderToStaticMarkup(
      <OffeneMietenListe eintraege={[eintrag(1)]} monat="Oktober" aelter={7872.28} vertraegeAelter={9} onRueckstaendeZeigen={() => {}} />
    );
    expect(html).toContain('Dazu 7.872,28 € Rückstände aus früheren Monaten (9 Mieter).');
    expect(html).toContain('Zu den Rückständen');
  });

  it('zählt einen Mieter mit Wohnung und Garage einmal, zeigt aber beide Verträge', () => {
    const garage = { ...eintrag(9), mieter_name: 'Mieter 1', mieter_schluessel: 'mieter-1', einheit: 'Garage' };
    const eintraege = [eintrag(1), garage, eintrag(2)];
    expect(anzahlMieter(eintraege)).toBe(2);
    const html = renderToStaticMarkup(<OffeneMietenListe eintraege={eintraege} monat="Oktober" aelter={0} vertraegeAelter={0} />);
    expect(html).toContain('2 Mieter</span> haben die Oktobermiete noch nicht bezahlt:');
    expect(html.match(/<li>/g)).toHaveLength(3);
  });
});
