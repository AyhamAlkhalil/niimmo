/**
 * Klauseltexte für den Wohnraum-Mietvertrag der NiImmo.
 *
 * Grundlage ist die Word-Hausvorlage (zuletzt verwendet im Vertrag vom
 * 01.01.2025). Aufbau, Paragraphenfolge und Ton wurden übernommen; 30 Klauseln
 * mussten geändert werden, weil sie nach der BGH-Rechtsprechung unwirksam
 * gewesen wären. Jede Abweichung ist in AENDERUNGEN dokumentiert und wird auf
 * der letzten Seite des Vertrags nicht mit ausgegeben — sie dient der internen
 * Nachvollziehbarkeit und der anwaltlichen Freigabe.
 *
 * WICHTIG: Dieser Text ist nicht anwaltlich geprüft. Vor dem ersten
 * Produktiveinsatz muss NiImmo ihn freigeben lassen.
 */
import { formatDatum, formatEur, formatIban, betragInWorten } from '../pdf/briefLayout';
import type { MietvertragDaten } from './typen';

export interface Absatz {
  /** Gliederungsziffer wie „1." oder „2.1" — optional. */
  nummer?: string;
  text: string;
  bold?: boolean;
  /** Ohne Blocksatz rendern, z. B. für Aufzählungen und Beträge. */
  linksbuendig?: boolean;
}

export interface Paragraph {
  nummer: string;
  titel: string;
  absaetze: Absatz[];
}

export interface Aenderung {
  paragraph: string;
  bestand: string;
  neu: string;
  grund: string;
}

/**
 * Was gegenüber der Word-Vorlage geändert wurde. Wird als Anlage für die
 * anwaltliche Freigabe ausgegeben.
 */
export const AENDERUNGEN: Aenderung[] = [
  {
    paragraph: '§ 5',
    bestand: 'Wertsicherungsklausel auf Indexbasis 2000 = 100, dazu ein von der IHK zu benennender Sachverständiger, der die Miethöhe nach § 317 BGB bestimmt.',
    neu: 'Indexmiete nach § 557b BGB auf Basis 2020 = 100 mit Nachfolgeindex-Regelung. Sachverständigenklausel gestrichen. Ohne Indexvereinbarung gilt die gesetzliche Mieterhöhung nach § 558 BGB.',
    grund: 'Die Basis 2000 = 100 wird vom Statistischen Bundesamt nicht mehr fortgeschrieben. Die Sachverständigenklausel stammt aus einem Gewerbeformular und ist im Wohnraummietrecht unwirksam.',
  },
  {
    paragraph: '§ 6 Ziff. 2',
    bestand: '„Für die Rechtzeitigkeit der Zahlung kommt es auf den Zugang beim Vermieter, nicht auf die Absendung des Geldes an."',
    neu: 'Rechtzeitig ist die Zahlung, wenn der Zahlungsauftrag fristgerecht erteilt wurde und das Konto gedeckt war.',
    grund: 'BGH VIII ZR 222/15: Die Klausel bürdet dem Mieter das Verzögerungsrisiko der Banken auf und ist unwirksam.',
  },
  {
    paragraph: '§ 6 Ziff. 3',
    bestand: 'Mahnkosten 11,00 € je Mahnung, Rücklastschrift 10,00 €, Buchungspauschale 3,50 € bei Nichtteilnahme am Lastschriftverfahren.',
    neu: 'Ersatz der tatsächlich entstandenen Kosten mit ausdrücklichem Recht des Mieters, geringeren Schaden nachzuweisen. Buchungspauschale gestrichen.',
    grund: 'Pauschalen weit über dem typischen Schaden sind nach § 309 Nr. 5 BGB unwirksam. Die Buchungspauschale verlangt Entgelt für eine Leistung, die der Vermieter ohnehin schuldet.',
  },
  {
    paragraph: '§ 7',
    bestand: 'Aufrechnungsverbot des Mieters während des laufenden Mietverhältnisses; Kosten der Kautionsverwahrung trägt der Mieter.',
    neu: 'Aufrechnung mit unbestrittenen oder titulierten Forderungen zulässig, Rechte aus §§ 536a, 539 BGB und § 556b Abs. 2 BGB ausdrücklich unberührt. Verwahrkosten trägt der Vermieter.',
    grund: '§ 556b Abs. 2 BGB ist zwingend. Die Anlagepflicht nach § 551 Abs. 3 BGB ist eine Vermieterpflicht, ihre Kosten sind nicht abwälzbar.',
  },
  {
    paragraph: '§ 9 Ziff. 2',
    bestand: 'Untervermietung nur mit Erlaubnis; Vorausabtretung der Untermietforderungen an den Vermieter.',
    neu: 'Anspruch auf Erlaubnis nach § 553 BGB ausformuliert, erlaubnisfreie Aufnahme naher Angehöriger klargestellt, Abtretungsabsatz gestrichen.',
    grund: '§ 553 Abs. 1 BGB gibt dem Mieter einen Anspruch, den ein schlichter Erlaubnisvorbehalt verdeckt. Die Vorausabtretung benachteiligt unangemessen.',
  },
  {
    paragraph: '§ 11',
    bestand: 'Jede Tierhaltung außer „Kleinsttiere in geringer Zahl" ist erlaubnispflichtig.',
    neu: 'Kleintiere in geschlossenen Behältnissen erlaubnisfrei; für sonstige Tiere Erlaubnis mit Anspruch auf ermessensfehlerfreie Entscheidung.',
    grund: 'BGH VIII ZR 168/12: Ein generelles Verbot ohne Interessenabwägung ist unwirksam. Bei Kleintieren besteht ohnehin kein Erlaubnisvorbehalt.',
  },
  {
    paragraph: '§ 14',
    bestand: 'Starre Fristen (5 Jahre Nassräume / 7 Jahre Wohnräume), Quotenabgeltung mit Prozentstaffel, Kostenvoranschlag eines vom Vermieter ausgewählten Malerbetriebs.',
    neu: 'Weicher Fristenplan („in der Regel", 5/8/10 Jahre) abhängig vom tatsächlichen Zustand; Quotenabgeltung und Betriebsbindung vollständig gestrichen. Bei nicht renovierter Übergabe entfällt der Paragraph ganz.',
    grund: 'BGH VIII ZR 185/14 und VIII ZR 242/13: Starre Fristen, Quotenabgeltung und die Übertragung bei unrenovierter Übergabe sind unwirksam — und zwar jeweils mit der Folge, dass die gesamte Klausel entfällt.',
  },
  {
    paragraph: '§ 15',
    bestand: 'Kleinreparaturen bis 190 € netto je Einzelfall, Jahresgrenze 250 € netto und zugleich 8 % der Jahresmiete; Katalog nennt Öfen, Thermen und Rollläden.',
    neu: 'Einzelgrenze brutto (Vorgabewert 100 €), eine Jahresgrenze in Prozent der Jahresnettokaltmiete, Katalog auf Gegenstände des direkten und häufigen Zugriffs beschränkt, ausdrücklich nur Kostentragung statt Vornahmepflicht.',
    grund: 'Der Betrag von 190 € netto überschreitet die von der Rechtsprechung akzeptierte Spanne. Innenteile von Thermen und Rollladenkästen unterliegen keinem direkten Zugriff. Eine Vornahmepflicht ist nach BGH VIII ZR 129/91 unwirksam.',
  },
  {
    paragraph: '§ 19 Ziff. 4',
    bestand: 'Modernisierungszuschlag 11 % der aufgewendeten Kosten, bei Mischmietverhältnissen 14 %.',
    neu: 'Verweis auf §§ 559 bis 559c BGB in der jeweils geltenden Fassung, ohne festen Prozentsatz.',
    grund: 'Der Satz beträgt seit 2019 8 %, dazu gelten Kappungsgrenzen nach § 559 Abs. 3a BGB. Ein fester Prozentsatz in der Vorlage veraltet mit jeder Gesetzesänderung.',
  },
  {
    paragraph: '§ 20 Ziff. 2',
    bestand: 'Besichtigungspflicht täglich 10–13 Uhr und 15–18 Uhr.',
    neu: 'Betreten nur mit konkretem Anlass, Ankündigung in Textform drei Werktage vorher, Termine werktags in üblichen Zeiten, Rücksicht auf Verhinderungen.',
    grund: 'Ein anlassloses oder starr terminiertes Betretungsrecht verletzt Art. 13 GG und ist unwirksam.',
  },
  {
    paragraph: '§ 21',
    bestand: 'Hausordnung wird durch gesonderte Unterschrift Vertragsbestandteil; der Vermieter darf sie einseitig ändern, Änderungen gelten mit Bekanntgabe als vereinbart.',
    neu: 'Hausordnung als Anlage mit dem Vertrag einbezogen, einseitige Änderung nur bei sachlichem Grund und ohne Einschränkung des Mietgebrauchs, Mitteilung in Textform mit Monatsfrist; Zustimmungsfiktion gestrichen.',
    grund: 'Ein unbegrenztes einseitiges Änderungsrecht mit Zustimmungsfiktion ist nach § 308 Nr. 5, § 307 BGB unwirksam. Die Einbeziehung darf nicht an einer vergessenen Zweitunterschrift scheitern.',
  },
  {
    paragraph: '§ 22 Ziff. 1',
    bestand: 'Rückgabe „in gereinigtem Zustand" einschließlich Fensterscheiben und Rahmen.',
    neu: 'Rückgabe geräumt und besenrein; weitergehende Reinigung nur bei zu vertretenden Verschmutzungen.',
    grund: 'Eine formularmäßige Endreinigungspflicht über „besenrein" hinaus ist unwirksam.',
  },
  {
    paragraph: '§ 25',
    bestand: '„Der Mieter übernimmt die Wohnung im gegenwärtigen Zustand" und „Der Mieter kann nach Einzug keine Minderungsrechte geltend machen."',
    neu: 'Zustandsfeststellung über das Übergabeprotokoll, ausdrückliche Auswahl renoviert/unrenoviert, gesetzliche Mängelrechte bleiben unberührt.',
    grund: '§ 536 Abs. 4 BGB: Ein Ausschluss der Minderung ist bei Wohnraum zwingend unwirksam. Der Übergabezustand entscheidet zudem über die Wirksamkeit von § 14.',
  },
  {
    paragraph: '§ 27',
    bestand: 'Pauschale Einwilligung in die Weitergabe der Vertragsdaten an Dritte, im Vertragstext eingebettet.',
    neu: 'Datenschutzinformation nach Art. 13 DSGVO als Anlage; die Mietspiegel-Einwilligung wird als freiwillige, gesondert anzukreuzende und widerrufliche Erklärung auf eigenem Blatt geführt.',
    grund: 'Eine im Vertrag versteckte Einwilligung ist nach Art. 7 Abs. 2 DSGVO nicht freiwillig und damit unwirksam.',
  },
  {
    paragraph: '§ 28',
    bestand: 'Salvatorische Klausel mit Ersetzungspflicht und Wiederauflebensregel sowie eine Gleichlaufklausel zu zwingendem Mieterschutzrecht.',
    neu: 'Reine Erhaltungsklausel: Unwirksames wird durch die gesetzliche Regelung ersetzt.',
    grund: 'Die Ersetzungs- und Gleichlaufklauseln versuchen, zwingendes Mieterschutzrecht zu neutralisieren, und sind ihrerseits unwirksam.',
  },
  {
    paragraph: 'Anlage Widerrufsbelehrung',
    bestand: 'Kriterienkatalog mit Schriftformzwang für den Widerruf und ohne Wertersatzhinweis.',
    neu: 'Gesetzliches Muster nach Art. 246a EGBGB mit formfreier Widerrufserklärung und Wertersatzhinweis. Wird nur ausgegeben, wenn der Vertrag außerhalb von Geschäftsräumen oder im Fernabsatz geschlossen wurde und keine Besichtigung stattfand.',
    grund: '§ 355 Abs. 1 BGB: Der Widerruf ist formfrei. Eine Belehrung, die mehr verlangt, setzt die Frist nicht in Gang — das Widerrufsrecht bliebe unbefristet bestehen.',
  },
  {
    paragraph: '§ 4 Ziff. 2',
    bestand: 'Heizung, Warmwasser und verbundene Anlagen (2.4 bis 2.6) werden „den Einheiten direkt zugeordnet".',
    neu: 'Abrechnung ausschließlich nach der Heizkostenverordnung mit dem am Objekt hinterlegten Schlüssel; bei eigener Etagenheizung des Mieters entfällt die Umlage.',
    grund: 'Die HeizkostenV ist zwingend und verlangt eine verbrauchsabhängige Abrechnung von mindestens 50 %.',
  },
  {
    paragraph: '§ 4 Ziff. 2',
    bestand: '„Sonstige Betriebskosten" als Sammelposition ohne Benennung; Umlageausfallwagnis von 2 %.',
    neu: 'Sonstige Betriebskosten werden einzeln benannt; das Umlageausfallwagnis entfällt bei nicht preisgebundenem Wohnraum.',
    grund: 'Nicht benannte sonstige Betriebskosten sind nach § 556 Abs. 1 BGB nicht umlagefähig. Das Umlageausfallwagnis ist nur im preisgebundenen Wohnraum zulässig.',
  },
];

const AUFZAEHLUNG_INDENT = 6;

export function wohnraumParagraphen(d: MietvertragDaten): Paragraph[] {
  const p: Paragraph[] = [];
  const mietsache = 'die Wohnung';

  // ─── § 1 Mietgegenstand ────────────────────────────────────────────────
  const objektAdresse = [
    `${d.objekt.strasse} ${d.objekt.hausnummer}`,
    `${d.objekt.plz} ${d.objekt.ort}${d.objekt.ortsteil ? ` OT ${d.objekt.ortsteil}` : ''}`,
  ].join(', ');

  const p1: Absatz[] = [
    {
      nummer: '1.',
      text: `Der Vermieter vermietet dem Mieter im Hause ${objektAdresse}, ${d.einheit.bezeichnung}, ${d.einheit.lage}, folgende Wohn- und Nebenräume: ${d.einheit.raumaufstellung}.`,
    },
    {
      text: `Die Wohnfläche beträgt ${d.einheit.wohnflaecheQm.toLocaleString('de-DE')} m². Die Angabe der Wohnfläche dient der Beschreibung der Mietsache und ist Grundlage der Betriebskostenverteilung.`,
    },
  ];

  if (d.einheit.nebenraeume?.trim()) {
    p1.push({ text: `Mitvermietet sind ferner: ${d.einheit.nebenraeume}.` });
  }
  if (d.einheit.einbaukueche) {
    p1.push({ text: 'Die in der Wohnung vorhandene Einbauküche ist mitvermietet.' });
  }
  if (d.nebenobjekte.length > 0) {
    const liste = d.nebenobjekte.map(n => `${n.bezeichnung} (${n.lage})`).join(', ');
    p1.push({ text: `Zusätzlich mitvermietet: ${liste}.` });
  }

  p1.push({
    nummer: '2.',
    text: d.mitbenutzungEinrichtungen?.trim()
      ? `Der Mieter darf folgende Gemeinschaftseinrichtungen und -flächen mitbenutzen: ${d.mitbenutzungEinrichtungen}. Die Mitbenutzung erfolgt nach Maßgabe der Hausordnung.`
      : 'Gemeinschaftseinrichtungen werden nicht zur Mitbenutzung überlassen.',
  });

  const schluesselText =
    d.schluessel.length > 0
      ? d.schluessel.map(s => `${s.anzahl} ${s.art}`).join(', ')
      : 'die im Übergabeprotokoll aufgeführten Schlüssel';
  p1.push({
    nummer: '3.',
    text: `Dem Mieter werden bei Einzug folgende Schlüssel ausgehändigt: ${schluesselText}. Die Anzahl wird im Übergabeprotokoll festgehalten, das Bestandteil dieses Vertrages ist.${
      d.schliessanlageArt === 'zentral'
        ? ' Die Schlüssel für Haus- und Wohnungseingangstüren gehören zu einer Zentralschließanlage.'
        : d.schliessanlageArt === 'einzel'
          ? ' Die Schlüssel für Haus- und Wohnungseingangstüren gehören zu einer Einzelschließanlage.'
          : ''
    }`,
  });

  p1.push({
    nummer: '4.',
    text: `Die Wohnung wird von ${d.anzahlPersonen} ${d.anzahlPersonen === 1 ? 'Person' : 'Personen'} bewohnt. Änderungen der Personenzahl sind dem Vermieter anzuzeigen, soweit sie für die Betriebskostenabrechnung erheblich sind.`,
  });

  p.push({ nummer: '§ 1', titel: 'Mietgegenstand', absaetze: p1 });

  // ─── § 2 Mietzeit ──────────────────────────────────────────────────────
  const p2: Absatz[] = [
    { nummer: '1.', text: `Das Mietverhältnis beginnt am ${formatDatum(d.mietbeginn)}.` },
  ];

  if (d.vertragsende && d.befristungsgrund) {
    p2.push({
      nummer: '2.',
      text: `Das Mietverhältnis ist bis zum ${formatDatum(d.vertragsende)} befristet. Grund der Befristung: ${befristungsgrundText(d)}. Der Mieter kann frühestens vier Monate vor Ablauf vom Vermieter verlangen, ihm binnen eines Monats mitzuteilen, ob der Befristungsgrund noch besteht (§ 575 Abs. 2 BGB).`,
    });
  } else {
    p2.push({
      nummer: '2.',
      text: 'Das Mietverhältnis läuft auf unbestimmte Zeit.',
    });
  }

  if (d.kuendigungsverzichtBis) {
    p2.push({
      nummer: '3.',
      text: `Beide Parteien verzichten wechselseitig bis zum ${formatDatum(d.kuendigungsverzichtBis)} auf ihr Recht zur ordentlichen Kündigung. Das Recht zur außerordentlichen Kündigung bleibt unberührt.`,
    });
  }

  p2.push({
    text: 'Der Vermieter stellt dem Mieter die Wohnungsgeberbestätigung nach § 19 Abs. 3 des Bundesmeldegesetzes innerhalb von zwei Wochen nach dem Einzug aus. Der Mieter meldet sich innerhalb der gesetzlichen Frist bei der Meldebehörde an.',
  });

  p.push({ nummer: '§ 2', titel: 'Mietzeit', absaetze: p2 });

  // ─── § 3 Kündigung ─────────────────────────────────────────────────────
  p.push({
    nummer: '§ 3',
    titel: 'Kündigung',
    absaetze: [
      {
        nummer: '1.',
        text: 'Ist das Mietverhältnis auf unbestimmte Zeit geschlossen, kann es von beiden Parteien nach den gesetzlichen Vorschriften gekündigt werden. Für den Mieter beträgt die Kündigungsfrist drei Monate. Für den Vermieter verlängert sie sich nach fünf Jahren seit Überlassung auf sechs und nach acht Jahren auf neun Monate (§ 573c Abs. 1 BGB).',
      },
      {
        nummer: '2.',
        text: 'Die Kündigung muss schriftlich erfolgen und spätestens am dritten Werktag eines Kalendermonats zugehen, um zum Ablauf des übernächsten Monats zu wirken. Maßgeblich ist der Zugang, nicht die Absendung.',
      },
      {
        nummer: '3.',
        text: 'Der Vermieter kann nur kündigen, wenn er ein berechtigtes Interesse an der Beendigung hat (§ 573 BGB). Die Kündigung ist zu begründen. Der Mieter kann der Kündigung nach §§ 574 bis 574b BGB widersprechen und die Fortsetzung des Mietverhältnisses verlangen, wenn die Beendigung für ihn eine Härte bedeuten würde; der Widerspruch ist spätestens zwei Monate vor Beendigung schriftlich zu erklären.',
      },
      {
        nummer: '4.',
        text: 'Jede Partei kann das Mietverhältnis aus wichtigem Grund fristlos kündigen (§§ 543, 569 BGB).',
      },
    ],
  });

  // ─── § 4 Mietzins und Betriebskosten ───────────────────────────────────
  const gesamt =
    d.kaltmiete +
    (d.betriebskostenModus === 'inklusiv' ? 0 : d.betriebskostenVorauszahlung) +
    (d.heizkostenVorauszahlung ?? 0);

  const p4: Absatz[] = [
    {
      nummer: '1.',
      text: `Die monatliche Nettokaltmiete beträgt ${formatEur(d.kaltmiete)} (in Worten: ${betragInWorten(d.kaltmiete)}).`,
      linksbuendig: true,
    },
  ];

  if (d.betriebskostenModus === 'inklusiv') {
    p4.push({
      nummer: '2.',
      text: 'Mit der Miete nach Ziffer 1 sind sämtliche Betriebskosten abgegolten. Eine gesonderte Umlage findet nicht statt.',
    });
  } else {
    const modusWort = d.betriebskostenModus === 'pauschale' ? 'Betriebskostenpauschale' : 'Vorauszahlung auf die Betriebskosten';
    p4.push({
      nummer: '2.',
      text: `Neben der Miete trägt der Mieter die nachstehend im Einzelnen benannten Betriebskosten im Sinne des § 556 Abs. 1 BGB in Verbindung mit § 2 der Betriebskostenverordnung. Hierauf leistet er eine monatliche ${modusWort} von ${formatEur(d.betriebskostenVorauszahlung)}.`,
    });

    const umgelegte = d.betriebskostenPositionen.filter(x => x.umgelegt);
    p4.push({
      text: 'Umgelegt werden folgende Betriebskosten:',
      linksbuendig: true,
    });
    for (const pos of umgelegte) {
      p4.push({
        text: `${pos.nummer}  ${pos.bezeichnung} — Verteilung nach ${schluesselLabel(pos.schluessel)}`,
        linksbuendig: true,
      });
    }

    if (d.heizkostenVorauszahlung !== null && d.heizkostenVorauszahlung > 0) {
      p4.push({
        nummer: '3.',
        text: `Auf die Kosten der Versorgung mit Wärme und Warmwasser leistet der Mieter eine gesonderte monatliche Vorauszahlung von ${formatEur(d.heizkostenVorauszahlung)}. Diese Kosten werden ausschließlich nach den Bestimmungen der Heizkostenverordnung abgerechnet; der verbrauchsabhängige Anteil beträgt ${d.objekt.heizkostenSchluessel.split('/')[0]} %, der übrige Anteil wird nach der Wohnfläche verteilt.`,
      });
    } else if (d.objekt.heizungsart === 'etage') {
      p4.push({
        nummer: '3.',
        text: 'Die Wohnung wird über eine vom Mieter selbst betriebene Etagenheizung mit eigenem Versorgungsvertrag beheizt. Eine Umlage von Heiz- und Warmwasserkosten findet nicht statt; der Mieter trägt die Kosten der jährlichen Wartung als Betriebskosten.',
      });
    }

    p4.push({
      text: `Abrechnungszeitraum ist ${d.abrechnungszeitraum}. Über die Vorauszahlungen wird jährlich abgerechnet; die Abrechnung ist dem Mieter spätestens zwölf Monate nach Ende des Abrechnungszeitraums mitzuteilen (§ 556 Abs. 3 BGB). Der Mieter kann die Abrechnungsunterlagen nach Terminvereinbarung einsehen.`,
    });

    p4.push({
      text: 'Auf die Kosten der Versorgung mit Wärme und Warmwasser wird der auf den Vermieter entfallende Anteil der Kohlendioxidkosten nach dem Kohlendioxidkostenaufteilungsgesetz angerechnet.',
    });
  }

  p4.push({
    nummer: d.betriebskostenModus === 'inklusiv' ? '3.' : '4.',
    text: `Die monatliche Gesamtzahlung beträgt derzeit ${formatEur(gesamt)}. Sie ist zu zahlen auf das Konto ${formatIban(d.vermieter.mietIban)}${d.vermieter.mietBic ? `, BIC ${d.vermieter.mietBic}` : ''}, Kontoinhaber ${d.vermieter.firmenname}. Als Verwendungszweck sind ${d.einheit.bezeichnung} und der Name des Mieters anzugeben.`,
    linksbuendig: true,
  });

  p.push({ nummer: '§ 4', titel: 'Miete und Betriebskosten', absaetze: p4 });

  // ─── § 5 Änderung der Miete ────────────────────────────────────────────
  p.push({ nummer: '§ 5', titel: 'Änderung der Miete', absaetze: mietanpassungAbsaetze(d) });

  // ─── § 6 Zahlung ───────────────────────────────────────────────────────
  const p6: Absatz[] = [
    {
      nummer: '1.',
      text: `Miete und Betriebskosten sind monatlich im Voraus, spätestens am ${d.faelligkeitWerktag}. Werktag eines jeden Monats, zu zahlen. Für die Rechtzeitigkeit genügt es, dass der Mieter den Zahlungsauftrag spätestens an diesem Tag bei seinem Zahlungsdienstleister erteilt und sein Konto die erforderliche Deckung aufweist. Verzögerungen im Zahlungsverkehr, die der Mieter nicht zu vertreten hat, gehen nicht zu seinen Lasten.`,
    },
  ];

  if (d.lastschrift) {
    p6.push({
      nummer: '2.',
      text: `Der Mieter erteilt dem Vermieter ein SEPA-Lastschriftmandat zum Einzug der monatlichen Gesamtzahlung. Kontoinhaber: ${d.lastschriftKontoinhaber ?? '—'}, IBAN ${formatIban(d.lastschriftIban)}${d.lastschriftBic ? `, BIC ${d.lastschriftBic}` : ''}${d.sepaMandatsreferenz ? `, Mandatsreferenz ${d.sepaMandatsreferenz}` : ''}. Der Einzug wird dem Mieter mindestens einen Bankarbeitstag vorher angekündigt; die Ankündigung kann auch einmalig für wiederkehrende Einzüge erfolgen. Das Mandat kann jederzeit widerrufen werden.`,
    });
  } else {
    p6.push({
      nummer: '2.',
      text: 'Ein Lastschriftmandat wird nicht erteilt. Der Mieter überweist die Gesamtzahlung fristgerecht selbst.',
    });
  }

  p6.push({
    nummer: '3.',
    text: 'Gerät der Mieter mit einer Zahlung in Verzug, hat er dem Vermieter die zur Rechtsverfolgung erforderlichen Kosten zu ersetzen, insbesondere die tatsächlich angefallenen Porto- und Materialkosten einer Mahnung, sowie Verzugszinsen in Höhe von fünf Prozentpunkten über dem Basiszinssatz (§ 288 Abs. 1 BGB). Wird eine Lastschrift aus einem vom Mieter zu vertretenden Grund zurückgegeben, hat er das dem Vermieter hierfür von seinem Kreditinstitut tatsächlich berechnete Entgelt zu erstatten. Dem Mieter bleibt in beiden Fällen der Nachweis vorbehalten, dass ein Schaden nicht oder in wesentlich geringerer Höhe entstanden ist.',
  });

  p.push({ nummer: '§ 6', titel: 'Zahlung der Miete', absaetze: p6 });

  // ─── § 7 Mietkaution ───────────────────────────────────────────────────
  p.push({ nummer: '§ 7', titel: 'Mietkaution', absaetze: kautionAbsaetze(d) });

  // ─── § 8 Schlüssel ─────────────────────────────────────────────────────
  p.push({
    nummer: '§ 8',
    titel: 'Haus- und Wohnungsschlüssel',
    absaetze: [
      {
        nummer: '1.',
        text: 'Der Mieter darf zusätzliche Schlüssel auf eigene Kosten beschaffen. Gehören die Schlüssel zu einer Schließanlage, ist hierfür die Zustimmung des Vermieters erforderlich; sie darf nur aus sachlichem Grund verweigert werden.',
      },
      {
        nummer: '2.',
        text: 'Geht ein Schlüssel verloren, ist der Vermieter unverzüglich zu unterrichten. Der Mieter hat die Kosten eines erforderlichen Austauschs von Schloss oder Schließanlage nur zu tragen, wenn er den Verlust zu vertreten hat und der Austausch zur Sicherung des Gebäudes tatsächlich notwendig ist.',
      },
      {
        nummer: '3.',
        text: 'Bei Beendigung des Mietverhältnisses sind sämtliche Schlüssel zurückzugeben, auch selbst beschaffte.',
      },
    ],
  });

  // ─── § 9 Nutzung und Gebrauchsüberlassung ──────────────────────────────
  p.push({
    nummer: '§ 9',
    titel: 'Benutzung der Wohnung und Gebrauchsüberlassung an Dritte',
    absaetze: [
      {
        nummer: '1.',
        text: `Die Mieträume sind zu Wohnzwecken vermietet. Eine darüber hinausgehende, insbesondere gewerbliche Nutzung bedarf der vorherigen Zustimmung des Vermieters. Eine freiberufliche oder gewerbliche Tätigkeit ohne Publikumsverkehr und ohne Beschäftigte, die nach außen nicht in Erscheinung tritt, ist zustimmungsfrei.`,
      },
      {
        nummer: '2.',
        text: 'Die Überlassung der Mieträume oder eines Teils davon an Dritte bedarf der vorherigen Erlaubnis des Vermieters. Keiner Erlaubnis bedarf die Aufnahme des Ehegatten oder eingetragenen Lebenspartners, der eigenen Kinder sowie von Personen, die zur Pflege des Mieters oder zur Führung seines Haushalts erforderlich sind. Entsteht für den Mieter nach Vertragsschluss ein berechtigtes Interesse, einen Teil des Wohnraums einem Dritten zu überlassen, kann er die Erlaubnis verlangen (§ 553 Abs. 1 BGB); dies gilt nicht, wenn in der Person des Dritten ein wichtiger Grund liegt, der Wohnraum übermäßig belegt würde oder die Überlassung dem Vermieter aus sonstigen Gründen nicht zuzumuten ist. Ist sie dem Vermieter nur bei angemessener Erhöhung der Miete zuzumuten, kann er die Erlaubnis hiervon abhängig machen (§ 553 Abs. 2 BGB).',
      },
      {
        nummer: '3.',
        text: 'Den Ein- und Auszug von Personen, denen der Mieter den Gebrauch überlassen hat, zeigt er dem Vermieter unverzüglich an.',
      },
    ],
  });

  // ─── § 10 Versorgungsleitungen ─────────────────────────────────────────
  p.push({
    nummer: '§ 10',
    titel: 'Elektrizität und andere Versorgungsleitungen',
    absaetze: [
      {
        nummer: '1.',
        text: 'Die Leitungsnetze für Strom, Gas und Wasser dürfen nur in dem Umfang in Anspruch genommen werden, in dem keine Überlastung eintritt. Reicht die vorhandene Kapazität für einen üblichen Haushaltsbedarf nicht aus, hat der Vermieter sie auf eigene Kosten anzupassen.',
      },
      {
        nummer: '2.',
        text: 'Störungen und Schäden an Versorgungsleitungen sind dem Vermieter unverzüglich anzuzeigen. Bei Gefahr sorgt der Mieter für die sofortige Abschaltung.',
      },
      {
        nummer: '3.',
        text: 'Der Mieter schützt die in seinem Bereich liegenden Wasserleitungen vor Frost, soweit ihm dies möglich und zumutbar ist.',
      },
    ],
  });

  // ─── § 11 Tierhaltung ──────────────────────────────────────────────────
  p.push({
    nummer: '§ 11',
    titel: 'Tierhaltung',
    absaetze: [
      {
        nummer: '1.',
        text: 'Die Haltung von Kleintieren, die in geschlossenen Behältnissen gehalten werden und von denen keine Beeinträchtigung der Mietsache und keine Störung der übrigen Hausbewohner ausgeht — insbesondere Zierfische, Ziervögel, Hamster, Meerschweinchen und Kaninchen —, ist ohne Erlaubnis gestattet.',
      },
      {
        nummer: '2.',
        text: 'Die Haltung sonstiger Tiere, insbesondere von Hunden und Katzen, bedarf der vorherigen Erlaubnis des Vermieters. Der Mieter hat Anspruch auf Erteilung, wenn eine Abwägung der beiderseitigen Interessen und der Interessen der übrigen Hausbewohner ergibt, dass die Tierhaltung zum vertragsgemäßen Gebrauch gehört; dabei sind Art, Größe, Zahl und Verhalten des Tieres, Größe und Zustand der Wohnung sowie die Verhältnisse im Haus zu berücksichtigen. Die Erlaubnis darf nicht ohne sachlichen Grund verweigert werden.',
      },
      {
        nummer: '3.',
        text: 'Die Erlaubnis gilt für das jeweils benannte Tier und kann aus wichtigem Grund widerrufen werden, insbesondere wenn von dem Tier trotz Abmahnung eine erhebliche Störung oder Gefährdung ausgeht.',
      },
    ],
  });

  // ─── § 12 Antennen ─────────────────────────────────────────────────────
  p.push({
    nummer: '§ 12',
    titel: 'Außenantennen und Empfangsanlagen',
    absaetze: [
      {
        nummer: '1.',
        text: 'Die Anbringung von Antennen außerhalb der Mieträume, einschließlich Parabolantennen, bedarf der vorherigen Erlaubnis des Vermieters. Der Mieter hat Anspruch auf Erteilung, wenn er ein besonderes Informationsinteresse hat, das über die vorhandenen Empfangsmöglichkeiten hinausgeht und nicht anderweitig gedeckt werden kann. Der Vermieter kann den Anbringungsort bestimmen, eine fachgerechte Montage sowie eine Sicherheit für den Rückbau verlangen.',
      },
      {
        nummer: '2.',
        text: 'Ist eine Gemeinschaftsempfangsanlage vorhanden, darf der Mieter sie nutzen.',
      },
    ],
  });

  // ─── § 13 Feuerstätten ─────────────────────────────────────────────────
  p.push({
    nummer: '§ 13',
    titel: 'Feuerstätten',
    absaetze: [
      {
        nummer: '1.',
        text: 'Mitvermietete Feuerstätten sind vom Mieter in betriebssicherem Zustand zu halten und der vorgeschriebenen Feuerstättenschau zu unterziehen.',
      },
      {
        nummer: '2.',
        text: 'Das Einbringen eigener Feuerstätten bedarf der Erlaubnis des Vermieters. Erforderliche behördliche Genehmigungen holt der Mieter auf eigene Kosten ein. Die Lagerung von Brennstoffen ist nur an den vom Vermieter bezeichneten Stellen und nach den gesetzlichen Vorschriften zulässig.',
      },
      {
        nummer: '3.',
        text: 'Für Schäden aus dem Aufstellen, dem Betrieb oder dem Abbau eigener Feuerstätten haftet der Mieter, soweit er sie zu vertreten hat.',
      },
    ],
  });

  // ─── § 14 Schönheitsreparaturen ────────────────────────────────────────
  p.push({ nummer: '§ 14', titel: 'Schönheitsreparaturen', absaetze: schoenheitsreparaturAbsaetze(d) });

  // ─── § 15 Kleinreparaturen ─────────────────────────────────────────────
  const jahresgrenze = (d.kaltmiete * 12 * d.kleinreparaturJahresgrenzeProzent) / 100;
  p.push({
    nummer: '§ 15',
    titel: 'Kleinreparaturen',
    absaetze: [
      {
        nummer: '1.',
        text: `Der Mieter trägt die Kosten einer Kleinreparatur, wenn diese im Einzelfall ${formatEur(d.kleinreparaturEinzelgrenze)} einschließlich Umsatzsteuer nicht übersteigen. Übersteigen die Kosten im Einzelfall diesen Betrag, trägt der Vermieter sie in voller Höhe.`,
      },
      {
        nummer: '2.',
        text: `Innerhalb eines Kalenderjahres ist die Kostentragung auf ${d.kleinreparaturJahresgrenzeProzent.toLocaleString('de-DE')} % der Jahresnettokaltmiete begrenzt, derzeit ${formatEur(jahresgrenze)}.`,
      },
      {
        nummer: '3.',
        text: 'Kleinreparaturen sind Maßnahmen zur Behebung von Schäden ausschließlich an solchen Gegenständen innerhalb der Mieträume, die dem direkten und häufigen Zugriff des Mieters unterliegen, nämlich an den Installationsgegenständen für Elektrizität, Wasser und Gas, den Heiz- und Kocheinrichtungen, den Fenster- und Türverschlüssen sowie den Verschlussvorrichtungen von Fensterläden und Rollläden. Nicht erfasst sind Bauteile im Inneren von Geräten und Anlagen, insbesondere von Thermen, Heizkesseln, Warmwasserbereitern und Rollladenkästen.',
      },
      {
        nummer: '4.',
        text: 'Die Beauftragung des Handwerkers obliegt dem Vermieter. Der Mieter schuldet nur die Kostentragung, nicht die Durchführung der Reparatur.',
      },
    ],
  });

  // ─── § 16 Obhut und Schäden ────────────────────────────────────────────
  p.push({
    nummer: '§ 16',
    titel: 'Obhutspflicht und Schäden',
    absaetze: [
      {
        nummer: '1.',
        text: 'Der Mieter hat die Mieträume schonend zu behandeln, ausreichend zu lüften und zu beheizen.',
      },
      {
        nummer: '2.',
        text: 'Schäden an den Mieträumen und am Gebäude hat der Mieter zu ersetzen, soweit er sie zu vertreten hat. Für das Verschulden von Haushaltsangehörigen, Untermietern und Besuchern hat er einzustehen, soweit er ihnen den Gebrauch überlassen hat. Veränderungen und Verschlechterungen durch den vertragsgemäßen Gebrauch hat der Mieter nicht zu vertreten (§ 538 BGB).',
      },
      {
        nummer: '3.',
        text: 'Der Mieter zeigt dem Vermieter jeden Mangel und jeden Schaden unverzüglich an (§ 536c BGB). Für Folgeschäden, die durch eine unterlassene Anzeige entstehen, haftet er.',
      },
    ],
  });

  // ─── § 17 Ersatzvornahme ───────────────────────────────────────────────
  p.push({
    nummer: '§ 17',
    titel: 'Ersatzvornahme und Schadensersatz',
    absaetze: [
      {
        text: 'Verletzt der Mieter eine Pflicht aus §§ 14 bis 16, kann der Vermieter nach erfolgloser Abmahnung und Fristsetzung die erforderlichen Maßnahmen auf Kosten des Mieters durchführen lassen oder Schadensersatz nach §§ 280, 281 BGB verlangen. Der Vermieter hat die Höhe des Schadens nachzuweisen; eine Bindung an einen bestimmten Handwerksbetrieb wird nicht vereinbart.',
      },
    ],
  });

  // ─── § 18 Veränderungen durch den Mieter ───────────────────────────────
  p.push({
    nummer: '§ 18',
    titel: 'Veränderungen der Mietsache durch den Mieter',
    absaetze: [
      {
        nummer: '1.',
        text: 'Bauliche Veränderungen an und in den Mieträumen bedürfen der vorherigen Erlaubnis des Vermieters. Das gilt auch für Änderungen der Installationen sowie für das Anbringen von Markisen, Außenjalousien und festen Balkonhalterungen.',
      },
      {
        nummer: '2.',
        text: 'Unberührt bleibt der Anspruch des Mieters nach § 554 BGB auf Erlaubnis baulicher Veränderungen, die dem Gebrauch durch Menschen mit Behinderungen, dem Laden elektrisch betriebener Fahrzeuge, dem Einbruchsschutz oder der Stromerzeugung durch Steckersolargeräte dienen. Der Vermieter kann die Erlaubnis in diesen Fällen nur verweigern, wenn ihm die Maßnahme auch unter Würdigung der Mieterinteressen nicht zuzumuten ist. Er kann sie davon abhängig machen, dass eine Fachfirma ausführt, ein geeigneter Anbringungsort gewählt wird und der Mieter für den Rückbau eine Sicherheit leistet.',
      },
      {
        nummer: '3.',
        text: 'Die mit der Veränderung verbundenen Kosten trägt der Mieter.',
      },
      {
        nummer: '4.',
        text: 'Bei Beendigung des Mietverhältnisses darf der Mieter eigene Einrichtungen wegnehmen; er hat sie zuvor dem Vermieter zur Übernahme anzubieten. Übernimmt der Vermieter sie, hat er einen angemessenen Ausgleich zu leisten. Macht er davon keinen Gebrauch, kann er die Wiederherstellung des ursprünglichen Zustands verlangen, soweit dies zumutbar ist.',
      },
    ],
  });

  // ─── § 19 Erhaltung und Modernisierung ─────────────────────────────────
  p.push({
    nummer: '§ 19',
    titel: 'Erhaltungs- und Modernisierungsmaßnahmen des Vermieters',
    absaetze: [
      {
        nummer: '1.',
        text: 'Der Mieter hat Erhaltungsmaßnahmen zu dulden (§ 555a BGB). Aufwendungen, die ihm dadurch entstehen, hat der Vermieter zu ersetzen.',
      },
      {
        nummer: '2.',
        text: 'Modernisierungsmaßnahmen hat der Mieter nach Maßgabe der §§ 555b bis 555e BGB zu dulden. Der Vermieter kündigt sie spätestens drei Monate vor Beginn in Textform an und teilt Art, Umfang, Beginn, voraussichtliche Dauer und die zu erwartende Mieterhöhung mit. Der Mieter kann bis zum Ablauf des Monats, der auf den Zugang folgt, außerordentlich zum Ablauf des übernächsten Monats kündigen (§ 555e BGB).',
      },
      {
        nummer: '3.',
        text: 'Nach Durchführung von Modernisierungsmaßnahmen kann der Vermieter die Miete nach Maßgabe der §§ 559 bis 559c BGB in der jeweils geltenden Fassung erhöhen. Umlagefähig sind die aufgewendeten Kosten abzüglich ersparter Erhaltungsaufwendungen und abzüglich Drittmitteln; die Kappungsgrenzen des § 559 Abs. 3a BGB sind einzuhalten. Die Erhöhung ist in Textform zu erklären und darin zu berechnen.',
      },
    ],
  });

  // ─── § 20 Betreten ─────────────────────────────────────────────────────
  p.push({
    nummer: '§ 20',
    titel: 'Betreten der Mieträume',
    absaetze: [
      {
        nummer: '1.',
        text: 'Der Vermieter oder von ihm Beauftragte dürfen die Mieträume nur betreten, wenn hierfür ein konkreter sachlicher Grund besteht, insbesondere Ablesung, Wartung, Erhaltungs- oder Modernisierungsmaßnahmen, Prüfung eines angezeigten Mangels oder Vorbereitung einer Neuvermietung oder eines Verkaufs.',
      },
      {
        nummer: '2.',
        text: 'Der Termin ist mindestens drei Werktage vorher in Textform anzukündigen und mit dem Mieter abzustimmen. Termine sind auf Montag bis Freitag zwischen 9.00 und 19.00 Uhr sowie Samstag zwischen 10.00 und 14.00 Uhr zu legen, soweit der Mieter nicht einem anderen Termin zustimmt; an Sonn- und Feiertagen findet keine Besichtigung statt. Auf Verhinderungen des Mieters ist Rücksicht zu nehmen. Ein anlassloses Betretungsrecht besteht nicht.',
      },
      {
        nummer: '3.',
        text: 'Bei Gefahr im Verzug darf der Vermieter die Mieträume auch ohne Ankündigung betreten oder öffnen lassen. Die Kosten trägt der Mieter nur, wenn er die Gefahr zu vertreten hat.',
      },
    ],
  });

  // ─── § 21 Hausordnung ──────────────────────────────────────────────────
  p.push({
    nummer: '§ 21',
    titel: 'Hausordnung',
    absaetze: [
      {
        nummer: '1.',
        text: 'Die als Anlage beigefügte Hausordnung ist Bestandteil dieses Vertrages; der Mieter bestätigt mit seiner Unterschrift unter diesen Vertrag, dass er sie erhalten hat.',
      },
      {
        nummer: '2.',
        text: 'Die Hausordnung regelt ausschließlich die Art und Weise der Ausübung des Mietgebrauchs; sie schränkt den nach § 1 vereinbarten Umfang nicht ein. Bei Widersprüchen geht dieser Vertrag vor.',
      },
      {
        nummer: '3.',
        text: 'Der Vermieter kann die Hausordnung ändern, soweit dies zur Wahrung von Sicherheit, Ordnung und Sauberkeit im Haus, zur Anpassung an geänderte gesetzliche oder behördliche Vorgaben oder an geänderte technische Einrichtungen erforderlich ist, die Änderung den Mietgebrauch nicht einschränkt und für den Mieter zumutbar ist. Die Änderung ist mit einer Frist von einem Monat in Textform mitzuteilen. Weitergehende Änderungen bedürfen der Zustimmung des Mieters.',
      },
    ],
  });

  // ─── § 22 Beendigung ───────────────────────────────────────────────────
  p.push({
    nummer: '§ 22',
    titel: 'Beendigung des Mietverhältnisses',
    absaetze: [
      {
        nummer: '1.',
        text: 'Bei Beendigung des Mietverhältnisses hat der Mieter die Mieträume vollständig geräumt und besenrein zurückzugeben. Besenrein bedeutet, dass grobe Verschmutzungen zu beseitigen und alle eingebrachten Gegenstände zu entfernen sind. Eine darüber hinausgehende Reinigungs- oder Renovierungspflicht besteht nur, soweit der Mieter Verschmutzungen oder Schäden zu vertreten hat, die über die vertragsgemäße Abnutzung hinausgehen.',
      },
      {
        nummer: '2.',
        text: 'Sämtliche Schlüssel, auch selbst beschaffte, sind spätestens bei Beendigung des Mietverhältnisses zurückzugeben. Die Anzahl ergibt sich aus dem Übergabeprotokoll.',
      },
      {
        nummer: '3.',
        text: 'Der Zustand der Mieträume wird bei Rückgabe in einem gemeinsamen Übergabeprotokoll festgehalten. Beide Parteien können hierzu Zeugen hinzuziehen.',
      },
      {
        nummer: '4.',
        text: 'Zieht der Mieter vor Ende des Mietverhältnisses aus, bleiben seine Pflichten aus diesem Vertrag bis zum Ende bestehen.',
      },
    ],
  });

  // ─── § 23 Personenmehrheit ─────────────────────────────────────────────
  if (d.mieter.length > 1) {
    p.push({
      nummer: '§ 23',
      titel: 'Mehrere Mieter',
      absaetze: [
        {
          nummer: '1.',
          text: 'Alle als Mieter benannten Personen haften für die Verpflichtungen aus diesem Vertrag als Gesamtschuldner.',
        },
        {
          nummer: '2.',
          text: 'Die Mieter bevollmächtigen sich gegenseitig zur Entgegennahme von Erklärungen des Vermieters, die das Mietverhältnis betreffen. Ausgenommen sind Kündigungen, Mieterhöhungsverlangen und Abmahnungen; diese sind gegenüber jedem Mieter gesondert zu erklären. Die Vollmacht kann jederzeit in Textform widerrufen werden; der Widerruf wirkt für Erklärungen, die nach seinem Zugang abgegeben werden.',
        },
        {
          nummer: '3.',
          text: 'Eine Kündigung des Mietverhältnisses muss von allen Mietern gemeinsam erklärt und gegenüber allen Mietern ausgesprochen werden.',
        },
      ],
    });
  }

  // ─── § 24 Besondere Einrichtungen ──────────────────────────────────────
  if (d.objekt.heizungsart !== 'keine') {
    p.push({
      nummer: '§ 24',
      titel: 'Heizung und Warmwasser',
      absaetze: heizungAbsaetze(d),
    });
  }

  // ─── § 25 Zustand bei Übergabe ─────────────────────────────────────────
  p.push({
    nummer: '§ 25',
    titel: 'Zustand der Mieträume bei Übergabe',
    absaetze: [
      {
        nummer: '1.',
        text: 'Der Zustand der Mieträume und der mitvermieteten Einrichtungen wird bei Übergabe in einem von beiden Parteien unterzeichneten Übergabeprotokoll festgehalten; dieses ist Bestandteil dieses Vertrages.',
      },
      {
        nummer: '2.',
        text: `Die Wohnung wird ${uebergabezustandText(d)} übergeben.`,
      },
      {
        nummer: '3.',
        text: 'Die gesetzlichen Rechte des Mieters bei Mängeln der Mietsache, insbesondere das Recht zur Mietminderung nach § 536 BGB, bleiben unberührt. Ein Ausschluss der Gewährleistung wird nicht vereinbart. Der Mieter hat Mängel unverzüglich anzuzeigen (§ 536c BGB).',
      },
    ],
  });

  // ─── § 26 Individuelle Vereinbarungen ──────────────────────────────────
  p.push({
    nummer: '§ 26',
    titel: 'Individuelle Vereinbarungen',
    absaetze: d.zusatzvereinbarungen?.trim()
      ? d.zusatzvereinbarungen
          .split('\n')
          .map(z => z.trim())
          .filter(Boolean)
          .map(text => ({ text }))
      : [{ text: 'Individuelle Vereinbarungen wurden nicht getroffen.' }],
  });

  // ─── § 27 Datenschutz ──────────────────────────────────────────────────
  p.push({
    nummer: '§ 27',
    titel: 'Datenschutz',
    absaetze: [
      {
        text: `Der Vermieter verarbeitet die im Rahmen dieses Mietverhältnisses erhobenen personenbezogenen Daten des Mieters zur Begründung, Durchführung und Beendigung des Mietverhältnisses. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Einzelheiten zu Zwecken, Empfängern, Speicherdauer und den Rechten des Mieters ergeben sich aus der beigefügten Datenschutzinformation nach Art. 13 DSGVO. Verantwortlicher ist ${d.vermieter.firmenname}, ${d.vermieter.strasse} ${d.vermieter.hausnummer}, ${d.vermieter.plz} ${d.vermieter.ort}.`,
      },
      {
        text: 'Eine Weitergabe von Vertragsdaten zu Zwecken der Mietspiegelerstellung erfolgt nur aufgrund einer gesonderten, freiwilligen und jederzeit widerruflichen Einwilligung des Mieters. Der Abschluss dieses Vertrages hängt nicht von ihr ab.',
      },
    ],
  });

  // ─── § 28 Schlussbestimmungen ──────────────────────────────────────────
  p.push({
    nummer: '§ 28',
    titel: 'Schlussbestimmungen',
    absaetze: [
      {
        nummer: '1.',
        text: 'Mit Beginn des Mietverhältnisses treten frühere Vereinbarungen der Parteien über diese Mietsache außer Kraft. Mündliche Nebenabreden bestehen nicht.',
      },
      {
        nummer: '2.',
        text: 'Änderungen und Ergänzungen dieses Vertrages bedürfen der Schriftform. Das gilt auch für die Änderung dieser Schriftformklausel.',
      },
      {
        nummer: '3.',
        text: 'Sollte eine Bestimmung dieses Vertrages unwirksam sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt. An die Stelle der unwirksamen Bestimmung treten die gesetzlichen Vorschriften.',
      },
    ],
  });

  return p;
}

// ─── Bausteine ───────────────────────────────────────────────────────────────

function befristungsgrundText(d: MietvertragDaten): string {
  const basis =
    d.befristungsgrund === 'eigenbedarf'
      ? 'Der Vermieter will die Räume nach Ablauf der Mietzeit als Wohnung für sich, seine Familienangehörigen oder Angehörige seines Haushalts nutzen (§ 575 Abs. 1 Nr. 1 BGB)'
      : d.befristungsgrund === 'bauliche_massnahme'
        ? 'Der Vermieter will die Räume nach Ablauf der Mietzeit beseitigen, wesentlich verändern oder instand setzen; die Maßnahmen würden durch eine Fortsetzung erheblich erschwert (§ 575 Abs. 1 Nr. 2 BGB)'
        : 'Der Vermieter will die Räume nach Ablauf der Mietzeit an einen zur Dienstleistung Verpflichteten vermieten (§ 575 Abs. 1 Nr. 3 BGB)';
  return d.befristungsgrundText?.trim() ? `${basis} — ${d.befristungsgrundText.trim()}` : basis;
}

function schluesselLabel(s: string): string {
  const m: Record<string, string> = {
    qm: 'Wohnfläche',
    personen: 'Personenzahl',
    einheit: 'Einheit zu gleichen Teilen',
    verbrauch: 'erfasstem Verbrauch',
    nutzer: 'Nutzerzahl',
    gleich: 'Einheit zu gleichen Teilen',
    individuell: 'gesonderter Vereinbarung',
  };
  return m[s] ?? s;
}

function uebergabezustandText(d: MietvertragDaten): string {
  if (d.uebergabezustand === 'renoviert') return 'renoviert';
  if (d.uebergabezustand === 'teilrenoviert') return 'teilrenoviert';
  return 'unrenoviert';
}

function mietanpassungAbsaetze(d: MietvertragDaten): Absatz[] {
  if (d.mietanpassungArt === 'staffel' && d.staffelplan?.length) {
    const a: Absatz[] = [
      {
        nummer: '1.',
        text: 'Die Miete ist eine Staffelmiete im Sinne des § 557a BGB. Sie ändert sich zu den nachstehenden Zeitpunkten auf die jeweils angegebene Nettokaltmiete. Während der Laufzeit der Staffelmiete sind Mieterhöhungen nach § 558 BGB und nach §§ 559 bis 559c BGB ausgeschlossen.',
      },
    ];
    for (const s of [...d.staffelplan].sort((x, y) => x.gueltigAb.localeCompare(y.gueltigAb))) {
      a.push({ text: `ab ${formatDatum(s.gueltigAb)}:  ${formatEur(s.kaltmiete)}`, linksbuendig: true });
    }
    a.push({
      nummer: '2.',
      text: 'Betriebskostenvorauszahlungen können unabhängig hiervon nach § 560 Abs. 4 BGB angepasst werden.',
    });
    return a;
  }

  if (d.mietanpassungArt === 'index') {
    return [
      {
        nummer: '1.',
        text: `Die Miete ist eine Indexmiete im Sinne des § 557b BGB. Maßgeblich ist der vom Statistischen Bundesamt veröffentlichte Verbraucherpreisindex für Deutschland (Basis 2020 = 100). Ausgangswert ist der Indexstand des Monats ${formatDatum(d.indexBasisMonat)} mit ${d.indexBasisWert?.toLocaleString('de-DE')} Punkten.`,
      },
      {
        nummer: '2.',
        text: 'Ändert sich der Index gegenüber dem Ausgangswert oder dem Stand der letzten Anpassung, kann jede Vertragspartei eine entsprechende prozentuale Änderung der Miete in Textform verlangen. Die Miete muss jeweils mindestens ein Jahr unverändert bleiben. Die geänderte Miete ist mit Beginn des übernächsten Monats nach Zugang der Erklärung zu zahlen.',
      },
      {
        nummer: '3.',
        text: 'Wird der Index auf eine neue Basis umgestellt oder durch einen anderen Index ersetzt, tritt der Nachfolgeindex an seine Stelle; die Umrechnung erfolgt nach den Vorgaben des Statistischen Bundesamtes.',
      },
      {
        nummer: '4.',
        text: 'Während der Geltung der Indexmiete sind Mieterhöhungen nach § 558 BGB ausgeschlossen. Erhöhungen nach §§ 559 bis 559c BGB sind nur zulässig, soweit der Vermieter die baulichen Maßnahmen aufgrund von Umständen durchgeführt hat, die er nicht zu vertreten hat (§ 557b Abs. 2 BGB). Betriebskostenvorauszahlungen können nach § 560 Abs. 4 BGB angepasst werden.',
      },
    ];
  }

  const a: Absatz[] = [
    {
      nummer: '1.',
      text: 'Der Vermieter kann die Zustimmung zu einer Erhöhung der Miete bis zur ortsüblichen Vergleichsmiete nach §§ 558 bis 558e BGB verlangen. Die Miete muss zum Zeitpunkt des Wirksamwerdens seit fünfzehn Monaten unverändert sein, und das Erhöhungsverlangen darf frühestens ein Jahr nach der letzten Erhöhung gestellt werden.',
    },
  ];

  a.push({
    nummer: '2.',
    text: d.objekt.istAngespannt
      ? `Die Wohnung liegt in ${d.objekt.ort}, einem Gebiet mit angespanntem Wohnungsmarkt nach der Niedersächsischen Mieterschutzverordnung. Die Miete darf sich innerhalb von drei Jahren um höchstens 15 % erhöhen (§ 558 Abs. 3 S. 2 BGB).`
      : 'Die Miete darf sich innerhalb von drei Jahren um höchstens 20 % erhöhen (§ 558 Abs. 3 BGB).',
  });

  a.push({
    nummer: '3.',
    text: 'Betriebskostenvorauszahlungen können nach einer Abrechnung durch Erklärung in Textform auf eine angemessene Höhe angepasst werden (§ 560 Abs. 4 BGB).',
  });

  return a;
}

function kautionAbsaetze(d: MietvertragDaten): Absatz[] {
  if (d.kautionArt === 'keine') {
    return [{ text: 'Eine Mietsicherheit wird nicht vereinbart.' }];
  }

  const artText =
    d.kautionArt === 'buergschaft'
      ? 'durch Stellung einer selbstschuldnerischen Bürgschaft eines in Deutschland zugelassenen Kreditinstituts'
      : d.kautionArt === 'verpfaendung'
        ? 'durch Verpfändung eines Sparguthabens'
        : d.kautionArt === 'sparbuch'
          ? 'durch Übergabe eines auf den Namen des Mieters lautenden Sparbuchs'
          : 'als Barkaution';

  const a: Absatz[] = [
    {
      nummer: '1.',
      text: `Der Mieter leistet eine Mietsicherheit in Höhe von ${formatEur(d.kautionBetrag)} ${artText}. Die Sicherheit übersteigt nicht das Dreifache der Nettokaltmiete (§ 551 Abs. 1 BGB).`,
    },
    {
      nummer: '2.',
      text: `Der Mieter kann die Sicherheit in ${d.kautionRaten} gleichen monatlichen Teilzahlungen leisten. Die erste Teilzahlung ist zu Beginn des Mietverhältnisses fällig, die weiteren mit den unmittelbar folgenden Mieten (§ 551 Abs. 2 BGB).`,
    },
  ];

  if (d.kautionArt === 'barkaution') {
    a.push({
      nummer: '3.',
      text: d.vermieter.kautionIban
        ? `Die Barkaution ist auf das Kautionskonto ${formatIban(d.vermieter.kautionIban)}${d.vermieter.kautionBic ? `, BIC ${d.vermieter.kautionBic}` : ''} zu zahlen. Der Vermieter legt sie getrennt von seinem Vermögen bei einem Kreditinstitut zu dem für Spareinlagen mit dreimonatiger Kündigungsfrist üblichen Zinssatz an (§ 551 Abs. 3 BGB). Die Zinsen stehen dem Mieter zu und erhöhen die Sicherheit. Die Kosten der Anlage trägt der Vermieter.`
        : 'Der Vermieter legt die Barkaution getrennt von seinem Vermögen bei einem Kreditinstitut zu dem für Spareinlagen mit dreimonatiger Kündigungsfrist üblichen Zinssatz an (§ 551 Abs. 3 BGB). Die Zinsen stehen dem Mieter zu und erhöhen die Sicherheit. Die Kosten der Anlage trägt der Vermieter.',
    });
  }

  a.push({
    nummer: d.kautionArt === 'barkaution' ? '4.' : '3.',
    text: 'Der Vermieter darf die Sicherheit während des laufenden Mietverhältnisses nur wegen unbestrittener oder rechtskräftig festgestellter Forderungen verwerten. Nach Beendigung des Mietverhältnisses hat er über die Sicherheit abzurechnen; er darf einen angemessenen Teil zurückbehalten, solange eine Betriebskostenabrechnung noch aussteht.',
  });

  a.push({
    nummer: d.kautionArt === 'barkaution' ? '5.' : '4.',
    text: 'Gegen Mietforderungen kann der Mieter nur mit unbestrittenen oder rechtskräftig festgestellten Forderungen aufrechnen. Unberührt bleibt sein Recht, mit Forderungen aus §§ 536a, 539 BGB oder aus ungerechtfertigter Bereicherung wegen zu viel gezahlter Miete aufzurechnen oder ein Zurückbehaltungsrecht auszuüben, wenn er die Absicht mindestens einen Monat vor Fälligkeit in Textform angezeigt hat (§ 556b Abs. 2 BGB).',
  });

  return a;
}

function schoenheitsreparaturAbsaetze(d: MietvertragDaten): Absatz[] {
  if (!d.schoenheitsreparaturen) {
    return [
      {
        text:
          d.uebergabezustand === 'renoviert'
            ? 'Die Schönheitsreparaturen verbleiben beim Vermieter (§ 535 Abs. 1 S. 2 BGB).'
            : 'Die Wohnung wird nicht renoviert übergeben. Die Schönheitsreparaturen verbleiben deshalb beim Vermieter (§ 535 Abs. 1 S. 2 BGB).',
      },
    ];
  }

  return [
    {
      nummer: '1.',
      text: 'Der Mieter führt die Schönheitsreparaturen während der Mietzeit auf eigene Kosten durch. Schönheitsreparaturen sind ausschließlich das Tapezieren, Anstreichen oder Kalken der Wände und Decken, das Streichen der Fußböden, der Heizkörper einschließlich der Heizrohre, der Innentüren sowie der Fenster und der Außentüren von innen. Weitere Arbeiten schuldet der Mieter nicht, insbesondere nicht das Streichen von Außenflächen, Einbaumöbeln und Versorgungsleitungen sowie das Abschleifen oder Versiegeln von Parkett.',
    },
    {
      nummer: '2.',
      text: 'Die Arbeiten sind fachgerecht in mittlerer Art und Güte auszuführen. Der Mieter darf sie selbst ausführen oder durch Dritte ausführen lassen; eine Bindung an einen bestimmten Betrieb wird nicht vereinbart.',
    },
    {
      nummer: '3.',
      text: 'Schönheitsreparaturen sind fällig, wenn sie nach dem tatsächlichen Erhaltungszustand erforderlich sind. Als Anhaltspunkt gelten in der Regel folgende Zeitabstände: fünf Jahre für Küchen, Bäder und Duschen, acht Jahre für Wohn- und Schlafräume, Flure und Dielen, zehn Jahre für sonstige Nebenräume. Diese Zeiträume sind unverbindlich; maßgeblich bleibt der tatsächliche Zustand.',
    },
    {
      nummer: '4.',
      text: 'Bei Beendigung des Mietverhältnisses schuldet der Mieter Schönheitsreparaturen nur, soweit sie nach dem tatsächlichen Erhaltungszustand erforderlich sind. Eine Verpflichtung zur Zahlung anteiliger Kosten für noch nicht fällige Schönheitsreparaturen besteht nicht. Veränderungen und Verschlechterungen durch den vertragsgemäßen Gebrauch hat der Mieter nicht zu vertreten (§ 538 BGB).',
    },
  ];
}

function heizungAbsaetze(d: MietvertragDaten): Absatz[] {
  if (d.objekt.heizungsart === 'etage') {
    return [
      {
        text: 'Die Wohnung wird über eine Etagenheizung beheizt, die der Mieter eigenverantwortlich auf eigene Kosten betreibt. Der Mieter trägt die Kosten der jährlichen Reinigung und Wartung als Betriebskosten; hierzu gehören die Prüfung von Betriebsbereitschaft und Betriebssicherheit, die damit verbundene Einstellung durch eine Fachkraft sowie die Messungen nach dem Bundes-Immissionsschutzgesetz. Die Instandhaltung und Instandsetzung der Anlage obliegt dem Vermieter.',
      },
    ];
  }

  const quelle = d.objekt.heizungsart === 'fernwaerme' ? 'Fernwärme' : 'eine zentrale Heizungsanlage';
  const [verbrauch, flaeche] = d.objekt.heizkostenSchluessel.split('/');

  return [
    {
      nummer: '1.',
      text: `Die Wohnung wird über ${quelle} mit Wärme und Warmwasser versorgt. Der Vermieter hält die Anlage vom 1. Oktober bis 30. April in Betrieb und darüber hinaus, wenn die Witterung es erfordert. Er stellt sicher, dass tagsüber eine Raumtemperatur von mindestens 20 °C erreicht werden kann.`,
    },
    {
      nummer: '2.',
      text: `Die Kosten werden ausschließlich nach den Bestimmungen der Heizkostenverordnung abgerechnet. Der verbrauchsabhängige Anteil beträgt ${verbrauch} %, der übrige Anteil von ${flaeche} % wird nach der Wohnfläche verteilt.`,
    },
    {
      nummer: '3.',
      text: 'Endet das Mietverhältnis während der Abrechnungsperiode, werden die Kosten nach den anerkannten Regeln der Technik auf die Nutzer verteilt. Die Kosten einer Zwischenablesung trägt der ausziehende Mieter.',
    },
    {
      nummer: '4.',
      text: 'Kommt es zu einer Unterbrechung der Versorgung, die der Vermieter nicht zu vertreten hat, bleiben die gesetzlichen Rechte des Mieters unberührt.',
    },
  ];
}

export { AUFZAEHLUNG_INDENT };
