/**
 * Stand des Mietvertrags als Schriftstück (12.11.2026): welche Fassung unterschrieben ist, welches PDF noch auf die
 * Unterschrift wartet. Pfade wie in Generator, Vermietung und Nachreichen.
 */
import { describe, expect, it } from 'vitest';

import { fassungArt, fassungDatum, fassungenStand, vertragsTitel, type VertragsDokument } from './fassungen';

const V = '3c000000-0000-4000-8000-000000000001';
const dok = (id: string, pfad: string, am: string, mehr: Partial<VertragsDokument> = {}): VertragsDokument => ({
  id,
  titel: id,
  pfad,
  hochgeladen_am: am,
  kategorie: 'Mietvertrag',
  geloescht: false,
  ...mehr,
});

const generator = (am: string) => dok(`g${am}`, `mietvertraege/${V}/Mietvertrag_2026-11-12_101500.pdf`, am);
const unterschrieben = (am: string) => dok(`u${am}`, `mietvertraege/${V}/Mietvertrag_unterschrieben_2026-11-12_101500.pdf`, am);
const scan = (am: string) => dok(`s${am}`, `${V}/1793805667613_xyprp.pdf`, am);
const entwurf = (am: string) => dok(`e${am}`, 'mietvertrag-entwuerfe/abc/Mietvertrag_Entwurf_2026-11-10_090000.pdf', am);

describe('fassungArt', () => {
  it('erkennt die Fassung am Pfad, nicht am Titel', () => {
    expect(fassungArt(`mietvertraege/${V}/Mietvertrag_unterschrieben_2026-11-12_101500.jpg`)).toBe('unterschrieben');
    expect(fassungArt(`mietvertraege/${V}/Mietvertrag_2026-11-12_101500.pdf`)).toBe('erstellt');
    expect(fassungArt('mietvertrag-entwuerfe/abc/Mietvertrag_Entwurf_2026-11-10_090000.pdf')).toBe('erstellt');
    expect(fassungArt(`${V}/1793805667613_xyprp.pdf`)).toBe('hochgeladen');
    // Ein anderes Schriftstück im Vertragsordner ist kein erstellter Vertrag
    expect(fassungArt(`mietvertraege/${V}/Mietvertrag_Anlage.pdf`)).toBe('hochgeladen');
  });
});

describe('fassungenStand', () => {
  it('kennt ohne Dokumente weder Unterschrift noch PDF', () => {
    expect(fassungenStand([], true)).toEqual({ unterschrieben: null, erstellt: null, offenesPdf: null, anzahl: 0 });
    expect(fassungenStand([], false).unterschrieben).toBeNull();
  });

  it('zeigt bei ausstehender Unterschrift das erstellte PDF als offen — auch ein hochgeladener Scan zählt dann nicht', () => {
    const stand = fassungenStand([scan('2026-11-11T10:00:00Z'), generator('2026-11-12T09:00:00Z')], true);
    expect(stand.unterschrieben).toBeNull();
    expect(stand.offenesPdf?.id).toBe('g2026-11-12T09:00:00Z');
    expect(stand.anzahl).toBe(2);
  });

  it('nimmt im Altbestand den neuesten hochgeladenen Vertrag als hinterlegt', () => {
    const stand = fassungenStand([scan('2025-01-01T10:00:00Z'), scan('2025-03-01T10:00:00Z')], false);
    expect(stand.unterschrieben?.id).toBe('s2025-03-01T10:00:00Z');
    expect(stand.offenesPdf).toBeNull();
  });

  it('zieht eine nachgereichte unterschriebene Fassung einem älteren Scan vor', () => {
    const stand = fassungenStand([unterschrieben('2026-11-01T10:00:00Z'), scan('2026-11-05T10:00:00Z')], false);
    expect(stand.unterschrieben?.id).toBe('u2026-11-01T10:00:00Z');
  });

  it('meldet ein neueres PDF nach der Unterschrift als offen, ein älteres nicht', () => {
    const neu = fassungenStand([unterschrieben('2026-11-01T10:00:00Z'), generator('2026-11-12T09:00:00Z')], false);
    expect(neu.offenesPdf?.id).toBe('g2026-11-12T09:00:00Z');
    const alt = fassungenStand([unterschrieben('2026-11-12T10:00:00Z'), entwurf('2026-11-10T09:00:00Z')], false);
    expect(alt.offenesPdf).toBeNull();
    expect(alt.erstellt?.id).toBe('e2026-11-10T09:00:00Z');
  });

  it('übergeht gelöschte, pfadlose und fremde Dokumente', () => {
    const stand = fassungenStand(
      [
        scan('2026-01-01T10:00:00Z'),
        dok('weg', `${V}/1.pdf`, '2026-06-01T10:00:00Z', { geloescht: true }),
        dok('ohne', '', '2026-06-01T10:00:00Z'),
        dok('kuendigung', `${V}/2.pdf`, '2026-06-01T10:00:00Z', { kategorie: 'Kündigung' }),
      ],
      false
    );
    expect(stand.unterschrieben?.id).toBe('s2026-01-01T10:00:00Z');
    expect(stand.anzahl).toBe(1);
  });

  it('verträgt fehlende und kaputte Zeitstempel', () => {
    const stand = fassungenStand([dok('a', `${V}/a.pdf`, ''), dok('b', `${V}/b.pdf`, 'kaputt', { hochgeladen_am: null })], false);
    expect(stand.unterschrieben).not.toBeNull();
    expect(fassungDatum(null)).toBe('');
    expect(fassungDatum(dok('x', 'x', 'kaputt'))).toBe('');
    expect(fassungDatum(dok('x', 'x', '2026-11-12T10:00:00Z'))).toBe('12.11.2026');
  });
});

describe('vertragsTitel', () => {
  const k = { mieter: ['Probe', 'Muster'], adresse: 'Mühlenweg 5', lage: 'EG links' };
  const zeit = new Date(2026, 10, 12, 10, 5);

  it('unterscheidet Fassungen nach Mieter, Mietsache und Zeitpunkt', () => {
    expect(vertragsTitel(k, { art: 'erstellt', zeitpunkt: zeit })).toBe(
      'Mietvertrag – Probe, Muster – Mühlenweg 5, EG links – erstellt 12.11.2026 10.05 Uhr'
    );
    expect(vertragsTitel(k, { art: 'erstellt', zeitpunkt: new Date(2026, 10, 12, 10, 6) })).not.toBe(
      vertragsTitel(k, { art: 'erstellt', zeitpunkt: zeit })
    );
  });

  it('nennt Anlagen und unterschriebene Fassungen', () => {
    expect(vertragsTitel(k, { art: 'erstellt', zeitpunkt: zeit, mitAnlagen: true })).toMatch(/^Mietvertrag einschließlich Anlagen – /);
    expect(vertragsTitel(k, { art: 'unterschrieben', zeitpunkt: zeit })).toBe(
      'Mietvertrag (unterschrieben) – Probe, Muster – Mühlenweg 5, EG links – hochgeladen 12.11.2026 10.05 Uhr'
    );
  });

  it('kürzt lange Mieterlisten, lässt Leeres weg und entfernt Zeichen, die kein Dateiname verträgt', () => {
    expect(vertragsTitel({ mieter: ['A', 'B', 'C'], adresse: 'Weg 1', lage: '' }, { art: 'erstellt', zeitpunkt: zeit })).toBe(
      'Mietvertrag – A, B u. a. – Weg 1 – erstellt 12.11.2026 10.05 Uhr'
    );
    expect(vertragsTitel({ mieter: [], adresse: '', lage: '' }, { art: 'erstellt', zeitpunkt: zeit })).toBe(
      'Mietvertrag – erstellt 12.11.2026 10.05 Uhr'
    );
    expect(vertragsTitel({ mieter: ['Probe/Muster'], adresse: 'Weg 1: "Hof"', lage: 'EG' }, { art: 'erstellt', zeitpunkt: zeit })).not.toMatch(
      /[\\/:*?"<>|]/
    );
  });
});
