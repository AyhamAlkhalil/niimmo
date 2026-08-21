/**
 * Kurzverträge, die NiImmo neben dem Wohnraummietvertrag verwendet:
 * Stellplatz/Garage und die Überlassung einer Einbauküche.
 *
 * Beide folgen den Bestandsvorlagen. Korrigiert wurden zwei Dinge, die in den
 * Word-Fassungen auffielen:
 *  - Der Stellplatzvertrag nennt als Mietkonto die IBAN des Kautionskontos.
 *  - Die einseitige Mieterhöhungsklausel ohne jeden Maßstab wäre als AGB
 *    gegenüber Verbrauchern unwirksam.
 */
import { formatEur, formatDatum, formatIban, betragInWorten } from '../pdf/briefLayout';
import type { Absatz, Paragraph } from './wohnraumKlauseln';
import type { MietvertragDaten } from './typen';

export interface NebenvertragDaten {
  vermieter: MietvertragDaten['vermieter'];
  mieter: MietvertragDaten['mieter'];
  objekt: Pick<MietvertragDaten['objekt'], 'strasse' | 'hausnummer' | 'plz' | 'ort'>;
  /** Kennzeichnung des Stellplatzes bzw. Beschreibung der Küche. */
  bezeichnung: string;
  beginn: string;
  /** Nur beim Stellplatz. */
  miete?: number;
  /** Vertrag über die Wohnung, an den die Überlassung gekoppelt ist. */
  wohnungBezug?: string;
  vertragsdatum: string | null;
  unterschriftOrt: string | null;
}

export const NEBENVERTRAG_AENDERUNGEN = [
  {
    vertrag: 'Stellplatz',
    paragraph: '§ 3',
    bestand:
      'Als Zahlungskonto ist DE89 2559 1413 3155 4105 01 angegeben — das ist die IBAN des Kautionskontos.',
    neu: 'Es wird das Mietkonto des Objekts verwendet.',
    grund: 'Stellplatzmieten landeten auf dem Kautionskonto und vermischen sich dort mit Sicherheiten.',
  },
  {
    vertrag: 'Stellplatz',
    paragraph: '§ 3',
    bestand:
      '„Der Vermieter ist berechtigt, die Miete angemessen entsprechend der für vergleichbare Garagen bzw. Stellplätze vereinbarten Miete zu erhöhen. Das Verfahren nach §§ 558ff. BGB muss nicht eingehalten werden."',
    neu: 'Erhöhung frühestens ein Jahr nach Vertragsbeginn oder der letzten Erhöhung, in Textform, begrenzt auf das ortsübliche Entgelt vergleichbarer Stellplätze, mit Sonderkündigungsrecht des Mieters.',
    grund:
      'Ein Preisänderungsvorbehalt ohne Anlass, Maßstab und Grenze benachteiligt Verbraucher unangemessen (§ 307 BGB).',
  },
  {
    vertrag: 'Stellplatz',
    paragraph: '§ 5',
    bestand: '„Die Vermietung dieses Mietobjektes ist von der Vermietung einer Wohnung … unabhängig."',
    neu: 'Hinweis ergänzt, dass die Selbständigkeit nur gilt, wenn die Verträge tatsächlich unabhängig geschlossen wurden.',
    grund:
      'Werden Wohnung und Stellplatz zusammen vermietet, liegt trotz zweier Urkunden regelmäßig ein einheitliches Wohnraummietverhältnis vor — dann gilt Wohnraumkündigungsschutz.',
  },
  {
    vertrag: 'Küche',
    paragraph: '§ 4',
    bestand: 'Sämtliche Erhaltungsmaßnahmen trägt der Leihnehmer.',
    neu: 'Der Entleiher trägt die gewöhnlichen Erhaltungskosten (§ 601 Abs. 1 BGB); Reparaturen durch normale Abnutzung und Ersatzbeschaffung bleiben beim Verleiher.',
    grund:
      'Die Leihkonstruktion trägt nur, solange sie tatsächlich unentgeltlich ist. Wird die Küche über die Miete mitbezahlt, ist sie Teil der Mietsache und der Vermieter schuldet die Instandhaltung.',
  },
];

// ─── Stellplatz ──────────────────────────────────────────────────────────────

export function stellplatzParagraphen(d: NebenvertragDaten): Paragraph[] {
  const miete = d.miete ?? 0;

  return [
    {
      nummer: '§ 1',
      titel: 'Mietgegenstand',
      absaetze: [
        {
          text: `Der Vermieter vermietet dem Mieter ${d.bezeichnung} auf dem Grundstück ${d.objekt.strasse} ${d.objekt.hausnummer}, ${d.objekt.plz} ${d.objekt.ort}.`,
        },
      ],
    },
    {
      nummer: '§ 2',
      titel: 'Mietzeit und Kündigung',
      absaetze: [
        { nummer: '1.', text: `Das Mietverhältnis beginnt am ${formatDatum(d.beginn)} und läuft auf unbestimmte Zeit.` },
        {
          nummer: '2.',
          text: 'Es kann von jeder Partei spätestens am dritten Werktag eines Kalendermonats zum Ablauf des übernächsten Kalendermonats gekündigt werden. Die Kündigung bedarf der Schriftform.',
        },
        {
          nummer: '3.',
          text: 'Setzt der Mieter den Gebrauch nach Ablauf der Mietzeit fort, verlängert sich das Mietverhältnis nicht stillschweigend; § 545 BGB wird abbedungen.',
        },
      ],
    },
    {
      nummer: '§ 3',
      titel: 'Miete',
      absaetze: [
        {
          nummer: '1.',
          text: `Die Miete beträgt monatlich ${formatEur(miete)} (in Worten: ${betragInWorten(miete)}). Betriebskosten werden nicht gesondert umgelegt.`,
          linksbuendig: true,
        },
        {
          nummer: '2.',
          text: `Die Miete ist monatlich im Voraus, spätestens am dritten Werktag eines Monats, zu zahlen auf das Konto ${formatIban(d.vermieter.mietIban)}${d.vermieter.mietBic ? `, BIC ${d.vermieter.mietBic}` : ''}, Kontoinhaber ${d.vermieter.firmenname}.`,
          linksbuendig: true,
        },
        {
          nummer: '3.',
          text: 'Der Vermieter kann die Miete durch Erklärung in Textform anpassen, frühestens ein Jahr nach Vertragsbeginn und frühestens ein Jahr nach der letzten Anpassung. Die neue Miete darf das ortsübliche Entgelt für vergleichbare Stellplätze nicht übersteigen und ist zu begründen. Sie ist ab dem übernächsten Monat nach Zugang zu zahlen. Der Mieter kann das Mietverhältnis bis zum Wirksamwerden der Erhöhung zum Ende des Folgemonats kündigen.',
        },
      ],
    },
    {
      nummer: '§ 4',
      titel: 'Nutzungszweck',
      absaetze: [
        { nummer: '1.', text: 'Der Stellplatz darf ausschließlich zum Abstellen eines zugelassenen Kraftfahrzeugs genutzt werden.' },
        {
          nummer: '2.',
          text: 'Das Abstellen sonstiger Gegenstände, insbesondere von Reifen und Fahrzeugzubehör, bedarf der vorherigen Zustimmung des Vermieters. Das Lagern brennbarer Stoffe ist nicht gestattet.',
        },
        {
          nummer: '3.',
          text: 'Besteht für das Grundstück eine Garagen- oder Stellplatzordnung, ist sie zu beachten.',
        },
      ],
    },
    {
      nummer: '§ 5',
      titel: 'Verhältnis zu einem Wohnraummietvertrag',
      absaetze: [
        {
          text: d.wohnungBezug
            ? `Dieser Vertrag steht im Zusammenhang mit dem Mietverhältnis über ${d.wohnungBezug}. Er endet zum selben Zeitpunkt wie jenes Mietverhältnis.`
            : 'Dieser Vertrag ist von der Vermietung einer Wohnung rechtlich und tatsächlich unabhängig. Das gilt nur, soweit die Verträge nicht gleichzeitig und im Zusammenhang miteinander geschlossen wurden.',
        },
      ],
    },
    {
      nummer: '§ 6',
      titel: 'Instandhaltung und Haftung',
      absaetze: [
        { nummer: '1.', text: 'Der Mieter behandelt den Stellplatz pfleglich und hält ihn sauber.' },
        {
          nummer: '2.',
          text: 'Für Beschädigungen haftet der Mieter, soweit er oder Personen, denen er den Gebrauch überlassen hat, sie zu vertreten haben.',
        },
        {
          nummer: '3.',
          text: 'Der Vermieter haftet nicht für Schäden am abgestellten Fahrzeug, die er nicht zu vertreten hat. Eine Bewachung wird nicht geschuldet.',
        },
      ],
    },
    {
      nummer: '§ 7',
      titel: 'Gebrauchsüberlassung an Dritte',
      absaetze: [
        {
          text: 'Die Überlassung an Dritte bedarf der Erlaubnis des Vermieters. Eine erteilte Erlaubnis kann aus wichtigem Grund widerrufen werden.',
        },
      ],
    },
    {
      nummer: '§ 8',
      titel: 'Schlussbestimmungen',
      absaetze: [
        { nummer: '1.', text: 'Mehrere Personen als Mieter haften als Gesamtschuldner.' },
        { nummer: '2.', text: 'Mündliche Nebenabreden bestehen nicht. Änderungen bedürfen der Schriftform.' },
        {
          nummer: '3.',
          text: 'Sollte eine Bestimmung dieses Vertrages unwirksam sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt. An die Stelle der unwirksamen Bestimmung treten die gesetzlichen Vorschriften.',
        },
      ],
    },
  ];
}

// ─── Einbauküche ─────────────────────────────────────────────────────────────

export function kuechenParagraphen(d: NebenvertragDaten): Paragraph[] {
  const wohnung = d.wohnungBezug ?? `${d.objekt.strasse} ${d.objekt.hausnummer}, ${d.objekt.plz} ${d.objekt.ort}`;

  return [
    {
      nummer: '§ 1',
      titel: 'Gegenstand',
      absaetze: [
        {
          text: `Der Verleiher überlässt dem Entleiher die Einbauküche in der Wohnung ${wohnung} unentgeltlich zur Nutzung. ${d.bezeichnung ? `Umfang: ${d.bezeichnung}. ` : ''}Ein Entgelt für die Nutzung wird weder gesondert noch über die Miete erhoben.`,
        },
      ],
    },
    {
      nummer: '§ 2',
      titel: 'Dauer',
      absaetze: [
        {
          text: `Die Leihe beginnt am ${formatDatum(d.beginn)} und ist an das Bestehen des Mietverhältnisses über die in § 1 bezeichnete Wohnung gekoppelt. Sie endet mit diesem, ohne dass es einer gesonderten Aufhebung bedarf.`,
        },
      ],
    },
    {
      nummer: '§ 3',
      titel: 'Erhaltung',
      absaetze: [
        {
          nummer: '1.',
          text: 'Der Entleiher trägt die gewöhnlichen Kosten der Erhaltung (§ 601 Abs. 1 BGB), insbesondere Pflege und Reinigung.',
        },
        {
          nummer: '2.',
          text: 'Wird ein Gerät durch normale Abnutzung unbrauchbar, entscheidet der Verleiher, ob er es ersetzt. Eine Pflicht zur Ersatzbeschaffung besteht nicht; ebenso wenig eine Pflicht des Entleihers, auf eigene Kosten zu ersetzen.',
        },
      ],
    },
    {
      nummer: '§ 4',
      titel: 'Sorgfaltspflicht und Schäden',
      absaetze: [
        {
          text: 'Der Entleiher geht sorgsam mit der Einbauküche um. Für Veränderungen oder Verschlechterungen durch vertragswidrigen Gebrauch haftet er, es sei denn, er hat die Pflichtverletzung nicht zu vertreten. Veränderungen durch den vertragsgemäßen Gebrauch hat er nicht zu vertreten (§ 602 BGB).',
        },
      ],
    },
    {
      nummer: '§ 5',
      titel: 'Mängel',
      absaetze: [
        {
          text: 'Für Sach- und Rechtsmängel haftet der Verleiher nur, wenn er sie arglistig verschwiegen hat (§ 600 BGB).',
        },
      ],
    },
    {
      nummer: '§ 6',
      titel: 'Kündigung',
      absaetze: [
        {
          text: 'Der Verleiher kann die Leihe kündigen und die Einbauküche zurückverlangen, wenn er sie infolge eines nicht vorhergesehenen Umstandes selbst benötigt, wenn der Entleiher einen vertragswidrigen Gebrauch ausübt oder die Sache durch Vernachlässigung erheblich gefährdet, oder wenn der Entleiher stirbt (§ 605 BGB). Nimmt der Verleiher die Küche zurück, mindert sich die Wohnungsmiete nicht — ein Entgelt für die Küche war nicht vereinbart.',
        },
      ],
    },
    {
      nummer: '§ 7',
      titel: 'Rückgabe',
      absaetze: [
        {
          text: 'Der Entleiher gibt die Einbauküche bei Beendigung der Leihe in gereinigtem Zustand zurück, im Regelfall gemeinsam mit der Wohnung.',
        },
      ],
    },
    {
      nummer: '§ 8',
      titel: 'Schlussbestimmungen',
      absaetze: [
        {
          text: 'Sollte eine Bestimmung dieser Vereinbarung unwirksam sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt. An die Stelle der unwirksamen Bestimmung treten die gesetzlichen Vorschriften.',
        },
      ],
    },
  ];
}

/** Warnungen, die vor der Erzeugung eines Nebenvertrags angezeigt werden. */
export function nebenvertragHinweise(art: 'stellplatz' | 'kueche', d: NebenvertragDaten): string[] {
  const h: string[] = [];

  if (art === 'stellplatz') {
    if (d.wohnungBezug) {
      h.push(
        'Stellplatz und Wohnung werden zusammen vermietet. Damit liegt trotz zweier Urkunden regelmäßig ein einheitliches Wohnraummietverhältnis vor: Der Stellplatz kann dann nicht gesondert gekündigt werden und die Miete unterliegt dem Wohnraummietrecht.'
      );
    }
    if (!d.miete || d.miete <= 0) {
      h.push('Ohne Mietbetrag kann der Vertrag nicht erzeugt werden.');
    }
  }

  if (art === 'kueche') {
    h.push(
      'Die Leihkonstruktion trägt nur, solange die Küche wirklich unentgeltlich überlassen wird. Ist sie im Mietvertrag als mitvermietet aufgeführt oder in der Miete eingepreist, ist sie Teil der Mietsache — dann schuldet der Vermieter die Instandhaltung.'
    );
  }

  return h;
}

/** Wiederverwendbar für beide Nebenverträge. */
export function nebenvertragTitel(art: 'stellplatz' | 'kueche'): string {
  return art === 'stellplatz' ? 'Stellplatz-Mietvertrag' : 'Nutzungsvereinbarung Einbauküche';
}

export function parteiBezeichnung(art: 'stellplatz' | 'kueche'): { geber: string; nehmer: string } {
  return art === 'stellplatz'
    ? { geber: 'Vermieter', nehmer: 'Mieter' }
    : { geber: 'Verleiher', nehmer: 'Entleiher' };
}

export type { Absatz };
