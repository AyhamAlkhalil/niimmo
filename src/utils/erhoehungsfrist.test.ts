import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { wirksamAbTag } from './mieterhoehungRegeln';

/**
 * Prüfung 28.10.2026: check-rent-increase-eligibility verlangte 15 Monate seit der letzten Erhöhung
 * bis heute. Nach § 558 Abs. 1 BGB darf das Verlangen nach 12 Monaten gestellt werden; die 15 Monate
 * gelten zum Wirksamwerden. Die Liste bot Erhöhungen so rund drei Monate zu spät an.
 *
 * Deno-Code läuft hier nicht: Der Test schneidet die Fristrechnung aus dem Quelltext, übersetzt sie
 * und führt sie aus (wie processContractOcr.test.ts).
 */
const quelle = readFileSync('supabase/functions/check-rent-increase-eligibility/index.ts', 'utf-8');

function ausschnitt(kopf: string): string {
  const start = quelle.indexOf(kopf);
  expect(start, `${kopf} nicht gefunden`).toBeGreaterThanOrEqual(0);
  return quelle.slice(start, quelle.indexOf('\n}\n', start) + 3);
}

const js = ts.transpileModule(
  ['function berlinerHeute(', 'function plusMonate(', 'function wirksamAbTag(', 'function erhoehungsfrist(', 'function fristReferenz('].map(ausschnitt).join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }
).outputText;
const fn = new Function(`${js}\nreturn { berlinerHeute, plusMonate, wirksamAbTag, erhoehungsfrist, fristReferenz };`)() as {
  berlinerHeute: (jetzt: Date) => string;
  plusMonate: (iso: string, monate: number) => string;
  wirksamAbTag: (iso: string) => string;
  erhoehungsfrist: (referenz: string, heute: string) => { zulaessig: boolean; moeglichAb: string };
  fristReferenz: (letzte: string | null, start: string | null, vereinbartAb: string | null) => string | null;
};

const tage = (von: string, bis: string): string[] => {
  const liste: string[] = [];
  for (let d = new Date(`${von}T12:00:00Z`); d.toISOString().slice(0, 10) <= bis; d.setUTCDate(d.getUTCDate() + 1)) {
    liste.push(d.toISOString().slice(0, 10));
  }
  return liste;
};

describe('Erhöhungsliste: Fristen nach § 558 Abs. 1 BGB', () => {
  it('rechnet das Wirksamwerden wie der Dialog (wirksamAbTag in src/utils)', () => {
    for (const tag of tage('2026-01-01', '2026-12-31')) {
      const [j, m, t] = tag.split('-').map(Number);
      expect(fn.wirksamAbTag(tag), tag).toBe(wirksamAbTag(new Date(j, m - 1, t)));
    }
  });

  it('zählt Monate kalendergenau und kürzt auf den Monatsletzten', () => {
    expect(fn.plusMonate('2025-08-15', 12)).toBe('2026-08-15');
    expect(fn.plusMonate('2025-01-31', 1)).toBe('2025-02-28');
    expect(fn.plusMonate('2023-11-30', 15)).toBe('2025-02-28');
    expect(fn.plusMonate('2026-10-28T00:00:00', 3)).toBe('2027-01-28');
  });

  it('erlaubt das Verlangen nach 12 Monaten, wenn es zum Wirksamwerden 15 Monate sind', () => {
    // Letzte Erhöhung wirksam am 01.08.2025: Verlangen ab 01.08.2026, wirksam 01.11.2026 = 15 Monate
    expect(fn.erhoehungsfrist('2025-08-01', '2026-07-31').zulaessig).toBe(false);
    expect(fn.erhoehungsfrist('2025-08-01', '2026-08-01')).toEqual({ zulaessig: true, moeglichAb: '2026-08-01' });
    // Mitte des Monats: nach 12 Monaten wäre das Wirksamwerden (01.11.) noch vor den 15 Monaten (15.11.)
    expect(fn.erhoehungsfrist('2025-08-15', '2026-08-15').zulaessig).toBe(false);
    expect(fn.erhoehungsfrist('2025-08-15', '2026-09-01')).toEqual({ zulaessig: true, moeglichAb: '2026-09-01' });
    // Früher erst nach 15 Monaten bis heute (01.11.2026) — drei Monate zu spät
    expect(fn.erhoehungsfrist('2025-08-01', '2026-10-28').zulaessig).toBe(true);
  });

  it('nennt als „möglich ab“ genau den ersten zulässigen Tag', () => {
    for (const referenz of ['2025-01-31', '2025-02-28', '2025-08-01', '2025-08-15', '2024-12-31', '2025-03-01']) {
      const { moeglichAb } = fn.erhoehungsfrist(referenz, '2000-01-01');
      for (const heute of tage(fn.plusMonate(referenz, 10), fn.plusMonate(referenz, 16))) {
        expect(fn.erhoehungsfrist(referenz, heute).zulaessig, `${referenz} / ${heute}`).toBe(heute >= moeglichAb);
      }
    }
  });

  it('nimmt den Kalendertag in deutscher Zeit', () => {
    expect(fn.berlinerHeute(new Date('2026-10-27T23:30:00Z'))).toBe('2026-10-28');
    expect(fn.berlinerHeute(new Date('2026-07-31T22:30:00Z'))).toBe('2026-08-01');
  });

  it('prüft jeden Vertrag mit dieser Rechnung, ab letzter (auch vereinbarter) Erhöhung oder Mietbeginn', () => {
    // Seit 28.10.2026 über fristReferenz, die eine zugestimmte, noch nicht übernommene Erhöhung mitzählt
    expect(quelle).toMatch(/const referenzIso = fristReferenz\(\s*contract\.letzte_mieterhoehung_am,\s*contract\.start_datum,/);
    expect(quelle).toContain('const frist = referenzIso ? erhoehungsfrist(referenzIso, heuteIso) : null;');
    expect(quelle).toContain('} else if (frist?.zulaessig) {');
    expect(quelle).not.toMatch(/monthsSinceLastIncrease >= 15/);
    expect(quelle).toContain('supabase-js@2.49.1');
  });

  it('der Dialog nennt beide Fristen', () => {
    const modal = readFileSync('src/components/dashboard/rent-increase/RentIncreaseModal.tsx', 'utf-8');
    expect(modal).toContain('Verlangen frühestens 12 Monate nach Einzug bzw. letzter Erhöhung');
    expect(modal).toContain('seit 15 Monaten unverändert');
    expect(modal).not.toContain('Frühestens 15 Monate nach Einzug/letzter Erhöhung');
  });
});

/**
 * 28.10.2026: Eine zugestimmte Erhöhung übernimmt die Datenbank erst zum wirksam_ab; bis dahin steht
 * letzte_mieterhoehung_am noch auf der vorigen. Die Liste muss die Fristen trotzdem ab der vereinbarten
 * Erhöhung rechnen, sonst böte sie den Vertrag sofort wieder an.
 */
describe('Erhöhungsliste: Fristen ab einer vereinbarten Erhöhung', () => {
  it('nimmt das spätere von letzter und vereinbarter Erhöhung, sonst den Mietbeginn', () => {
    expect(fn.fristReferenz('2024-06-01', '2020-01-01', '2027-01-01')).toBe('2027-01-01');
    expect(fn.fristReferenz('2024-06-01', '2020-01-01', null)).toBe('2024-06-01');
    expect(fn.fristReferenz(null, '2020-01-01', '2027-01-01')).toBe('2027-01-01');
    expect(fn.fristReferenz(null, '2020-01-01T00:00:00', null)).toBe('2020-01-01');
    expect(fn.fristReferenz(null, null, null)).toBeNull();
  });

  it('bietet einen Vertrag mit vereinbarter Erhöhung erst zwölf Monate nach deren Wirksamwerden wieder an', () => {
    const referenz = fn.fristReferenz('2024-06-01', '2020-01-01', '2027-01-01') as string;
    expect(fn.erhoehungsfrist(referenz, '2026-10-28').zulaessig).toBe(false);
    expect(fn.erhoehungsfrist(referenz, '2027-12-31').zulaessig).toBe(false);
    expect(fn.erhoehungsfrist(referenz, '2028-01-01').zulaessig).toBe(true);
  });

  it('liest die offenen Vorgänge seitenweise und lässt die Antwort scheitern, wenn das nicht geht', () => {
    expect(quelle).toContain(".in('status', ['verlangt', 'zugestimmt'])");
    expect(quelle).toMatch(/if \(vorgangError\) \{[\s\S]{0,120}throw vorgangError;/);
    // PostgREST kappt bei 1000 Zeilen: eindeutige Sortierung und Seiten statt range(0, 9999)
    expect(quelle).toContain(".order('id', { ascending: true })");
    expect(quelle).toContain('.range(von, von + VORGAENGE_SEITE - 1);');
    expect(quelle).toContain('if (!seite || seite.length < VORGAENGE_SEITE) break;');
    expect(quelle).not.toContain('range(0, 9999)');
    expect(quelle).toContain("offenerVorgang?.status === 'zugestimmt' ? offenerVorgang.wirksam_ab : null");
  });
});

describe('Erhöhungsliste: vereinbarte Erhöhungen bleiben sichtbar', () => {
  it('zeigt gekündigte und Staffel-/Indexverträge nur mit vereinbarter Erhöhung und bietet ihnen nichts an', () => {
    expect(quelle).toContain(".in('status', ['aktiv', 'gekuendigt'])");
    expect(quelle).toMatch(/const ausgeschlossen = contract\.mietanpassung_art === 'staffel' \|\| contract\.mietanpassung_art === 'index'\s*\|\| contract\.status !== 'aktiv';\s*if \(ausgeschlossen && !vereinbart\) continue;/);
    // Vereinbart: nie „möglich“, nur der Hinweis
    expect(quelle.indexOf('if (vereinbart && offenerVorgang) {')).toBeLessThan(quelle.indexOf('} else if (frist?.zulaessig) {'));
    expect(quelle).toContain('vertragsende: contract.ende_datum || contract.kuendigungsdatum || null,');
  });
});
