import { jsPDF } from 'jspdf';
import type { Unterzeichner } from './unterzeichner';
import { beginneBrief, ladeBriefbilder, type Briefbilder } from './pdf/briefbogen';
import {
  anschriftDerMietsache,
  anschriftZeile,
  briefanrede,
  anredeFuerSchreiben,
  bestaetigungsAbsaetze,
  type BestaetigungsDaten,
} from './kuendigungsbestaetigung';

export type KuendigungsTyp = 'ordentlich' | 'ausserordentlich_fristlos' | 'ausserordentlich_mit_frist';

export interface KuendigungPdfData {
  // Empfaenger
  anrede: string;
  mieterName: string;
  mieterNachname: string;
  /** Alle Mieter des Vertrags; ohne Angabe gilt nur mieterNachname. */
  mieter?: Array<{ vorname: string; nachname: string }>;
  mieterAdresse: string;
  mieterPlzOrt: string;

  // Vertrag
  einheitBezeichnung: string;
  immobilieAdresse: string;
  vertragStart: string;

  // Kuendigung
  kuendigungsdatum: string;
  kuendigungsgrund: string;
  kuendigungstyp: KuendigungsTyp;
  datum: string;

  // Fristen
  auszugsdatum: string;

  // Freitext
  freitext?: string;

  // Bemerkungen
  bemerkungen?: string;

  /** Rückfragenblock und Unterschrift; im Dialog vorbelegt mit dem Angemeldeten (31.10.2026) */
  unterzeichner: Unterzeichner;
}

/** Die Bestätigung trägt dieselbe Person wie Rückfragenblock und Unterschrift. */
export type KuendigungsbestaetigungPdfData = BestaetigungsDaten & { unterzeichner: Unterzeichner };

const RUECKFRAGEN = 'Für Rückfragen stehen wir Ihnen gerne unter den oben genannten Kontaktdaten zur Verfügung.';

/** Betreff wie in der Briefvorlage: Art des Schreibens – Anschrift des Objekts */
function betreff(art: string, adresse: string | null | undefined): string {
  return adresse?.trim() ? `${art} – ${adresse.trim()}` : art;
}

export function kuendigungBetreff(data: Pick<KuendigungPdfData, 'kuendigungstyp' | 'immobilieAdresse'>): string {
  const art = data.kuendigungstyp === 'ausserordentlich_fristlos'
    ? 'Außerordentliche fristlose Kündigung des Mietvertrages'
    : data.kuendigungstyp === 'ausserordentlich_mit_frist'
      ? 'Außerordentliche Kündigung des Mietvertrages'
      : 'Kündigung des Mietvertrages';
  return betreff(art, data.immobilieAdresse);
}

/** Layout nach der Briefvorlage des Kunden wie die Mahnung (31.10.2026); bis dahin eigener Kopf mit Kontaktkasten. */
export async function generateKuendigungPdf(data: KuendigungPdfData): Promise<Blob> {
  return kuendigungSetzen(data, await ladeBriefbilder());
}

function kuendigungSetzen(data: KuendigungPdfData, bilder: Briefbilder): Blob {
  const typ = data.kuendigungstyp || 'ordentlich';
  const anrede = anredeFuerSchreiben(data.anrede, data.mieter ?? [{ vorname: '', nachname: data.mieterNachname }]);
  const brief = beginneBrief(new jsPDF('p', 'mm', 'a4'), bilder, {
    anschrift: anrede.anschrift,
    name: data.mieterName,
    zeilen: [data.mieterAdresse, data.mieterPlzOrt],
    datum: data.datum,
    betreff: kuendigungBetreff({ ...data, kuendigungstyp: typ }),
    unterzeichner: data.unterzeichner,
  });
  brief.anrede(anrede.gruss);

  if (data.freitext?.trim()) {
    brief.freitext(data.freitext);
  } else {
    const mietsache = anschriftDerMietsache(data.immobilieAdresse, data.einheitBezeichnung);
    const art = typ === 'ausserordentlich_fristlos'
      ? 'außerordentlich fristlos'
      : typ === 'ausserordentlich_mit_frist'
        ? `außerordentlich zum ${data.kuendigungsdatum}`
        : `ordentlich zum ${data.kuendigungsdatum}`;
    brief.absatz(`hiermit kündigen wir das bestehende Mietverhältnis über die Wohnung${mietsache ? ` ${mietsache}` : ''}, begründet durch den Mietvertrag vom ${data.vertragStart}, ${art}.`);

    if (data.kuendigungsgrund) {
      brief.absatz(`Grund der Kündigung: ${data.kuendigungsgrund}`);
    }

    if (typ === 'ausserordentlich_fristlos') {
      brief.absatz(`Wir fordern Sie auf, die Wohnung unverzüglich, spätestens jedoch bis zum ${data.auszugsdatum}, zu räumen und in ordnungsgemäßem Zustand zu übergeben.`);
    } else {
      brief.absatz(`Wir bitten Sie, die Wohnung bis zum ${data.auszugsdatum} geräumt und in ordnungsgemäßem Zustand zu übergeben. Bitte vereinbaren Sie rechtzeitig einen Übergabetermin mit uns.`);
      // Hinweis auf den Widerspruch (§ 568 Abs. 2 BGB) gehört zur Kündigung mit Frist; bei einer berechtigten fristlosen
      // Kündigung gibt es ihn nicht (§ 574 Abs. 1 S. 2 BGB). Bis zum 29.10.2026 stand er umgekehrt nur dort (Prüfung).
      brief.absatz('Der Kündigung können Sie gemäß §§ 574 bis 574b BGB schriftlich widersprechen und die Fortsetzung des Mietverhältnisses verlangen, wenn dessen Beendigung für Sie oder Ihre Familie eine nicht zu rechtfertigende Härte bedeuten würde. Der Widerspruch muss uns spätestens zwei Monate vor der Beendigung des Mietverhältnisses zugehen.');
    }

    brief.absatz('Die Abrechnung der Mietkaution erfolgt nach Beendigung des Mietverhältnisses und Prüfung des Wohnungszustandes gemäß den gesetzlichen Bestimmungen.');
    brief.absatz('Wir bitten Sie, am Tag der Übergabe alle Zählerstände (Strom, Gas, Wasser) abzulesen und uns mitzuteilen. Bitte kündigen Sie eigenständig Ihre Versorgungsverträge (Strom, Gas, Internet, etc.) zum Auszugsdatum.');
  }

  if (data.bemerkungen?.trim()) {
    brief.freitext(`Ergänzende Hinweise: ${data.bemerkungen.trim()}`);
  }

  brief.schluss({ satz: RUECKFRAGEN });
  return brief.fertig();
}

/**
 * Bestätigung einer Kündigung durch den Mieter. Text aus
 * `kuendigungsbestaetigung.ts`, Layout wie das Kündigungsschreiben.
 */
export async function generateKuendigungsbestaetigungPdf(data: KuendigungsbestaetigungPdfData): Promise<Blob> {
  const [jahr, monat, tag] = data.datum.slice(0, 10).split('-');
  const brief = beginneBrief(new jsPDF('p', 'mm', 'a4'), await ladeBriefbilder(), {
    // Jede Person mit ihrer Anrede auf einer eigenen Zeile
    name: data.mieter.map(anschriftZeile),
    zeilen: [data.strasse, data.plzOrt],
    datum: `${tag}.${monat}.${jahr}`,
    betreff: betreff('Bestätigung Ihrer Kündigung', data.immobilieAdresse),
    unterzeichner: data.unterzeichner,
  });
  brief.anrede(briefanrede(data.mieter));
  for (const absatz of bestaetigungsAbsaetze(data)) brief.absatz(absatz);
  brief.schluss({ satz: RUECKFRAGEN });
  return brief.fertig();
}
