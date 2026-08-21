/**
 * Klauseltexte für den Gewerbemietvertrag.
 *
 * Grundlage ist die Gewerbe-Schablone der NiImmo (Skyller Sports 2022,
 * ReLog 2025, Bäckerei 2023). Gewerbemietrecht ist eine andere Welt als
 * Wohnraum: Kein Kündigungsschutz, kein § 559 BGB, dafür Umsatzsteueroption,
 * Betriebspflicht und Konkurrenzschutz. Die AGB-Kontrolle nach §§ 307 ff. BGB
 * gilt aber auch hier — nur ohne die verbraucherschützenden §§ 308, 309 BGB
 * in ihrer vollen Härte.
 *
 * WICHTIG: Nicht anwaltlich geprüft. Gewerbemietverträge haben typischerweise
 * deutlich höhere Streitwerte als Wohnraumverträge — eine Prüfung vor dem
 * ersten Einsatz ist hier noch wichtiger als beim Wohnraumvertrag.
 */
import { formatEur, formatDatum, formatIban, betragInWorten } from '../pdf/briefLayout';
import type { Absatz, Paragraph } from './wohnraumKlauseln';
import type { MietvertragDaten } from './typen';

export interface GewerbeDaten {
  vermieter: MietvertragDaten['vermieter'];
  mieter: MietvertragDaten['mieter'];
  objekt: MietvertragDaten['objekt'];

  /** Einzelflächen mit Bezeichnung und Größe. */
  flaechen: { bezeichnung: string; qm: number }[];
  /** Was der Mieter dort betreiben darf — bestimmt zugleich die Betriebspflicht. */
  mietzweck: string;
  betriebspflicht: boolean;
  konkurrenzschutz: boolean;

  mietbeginn: string;
  /** Feste Laufzeit in Monaten; 0 = unbefristet. */
  festmietzeitMonate: number;
  /** Anzahl der Verlängerungsoptionen und ihre Dauer in Monaten. */
  optionen: { anzahl: number; dauerMonate: number } | null;

  /** Nettokaltmiete ohne Umsatzsteuer. */
  nettokaltmiete: number;
  /** Optiert der Vermieter nach § 9 UStG zur Umsatzsteuer? */
  umsatzsteuerpflichtig: boolean;
  umsatzsteuersatz: number;
  nebenkostenVorauszahlungNetto: number;

  kaution: number;
  kautionArt: 'barkaution' | 'buergschaft' | 'keine';

  /** Indexklausel nach § 557b BGB analog — im Gewerbe frei vereinbar. */
  indexklausel: boolean;
  indexSchwelleProzent: number;
  indexBasisWert: number | null;
  indexBasisMonat: string | null;

  /** Höchstbetrag für Instandhaltung auf Mieterkosten (Kleinreparaturdeckel). */
  instandhaltungEinzelgrenze: number;
  instandhaltungJahresgrenze: number;

  schoenheitsreparaturen: boolean;
  gerichtsstand: string;
  zusatzvereinbarungen: string | null;
  vertragsdatum: string | null;
  unterschriftOrt: string | null;
}

export const GEWERBE_AENDERUNGEN = [
  {
    paragraph: '§ 7',
    bestand: '„Verzugszinsen in Höhe von 9 % p. a. über dem jeweiligen Diskontsatz der Deutschen Bundesbank"',
    neu: 'Verzugszinsen in Höhe von neun Prozentpunkten über dem Basiszinssatz (§ 288 Abs. 2 BGB).',
    grund:
      'Den Diskontsatz gibt es seit dem 01.01.1999 nicht mehr; an seine Stelle ist der Basiszinssatz nach § 247 BGB getreten. Die Klausel lief ins Leere.',
  },
  {
    paragraph: '§ 23',
    bestand: 'Modernisierungszuschlag an einer Stelle 11 %, an anderer Stelle 14 % — mit wechselseitigem Verweis.',
    neu: 'Ein einheitlicher Satz, im Vertrag beziffert, gedeckelt auf drei Monatsnettokaltmieten pro Jahr.',
    grund: 'Zwei widersprüchliche Prozentsätze in einem Vertrag machen die Klausel unbestimmt und damit angreifbar.',
  },
  {
    paragraph: '§ 29',
    bestand: 'Schriftformheilungsklausel: Die Parteien verpflichten sich, Formmängel jederzeit zu heilen.',
    neu: 'Gestrichen. Stattdessen der Hinweis auf die seit 2025 geltende Textform für Gewerbemietverträge.',
    grund:
      'BGH XII ZR 114/16: Schriftformheilungsklauseln sind unwirksam. Zudem genügt seit dem Bürokratieentlastungsgesetz IV für Gewerbemietverträge die Textform.',
  },
  {
    paragraph: '§ 19',
    bestand: 'Beweislastumkehr: Der Mieter muss beweisen, dass er einen Schaden nicht verursacht hat.',
    neu: 'Beweislast nach der gesetzlichen Sphärentheorie: Der Vermieter beweist die Verursachung aus dem Mieterbereich, der Mieter das fehlende Verschulden.',
    grund:
      'Eine formularmäßige Beweislastumkehr benachteiligt unangemessen (§ 307 BGB); § 309 Nr. 12 BGB strahlt auch auf den unternehmerischen Verkehr aus.',
  },
  {
    paragraph: '§ 25',
    bestand: 'Hausordnung wird einseitig erlassen und geändert und gilt mit Bekanntgabe als Vertragsbestandteil.',
    neu: 'Änderungen nur bei sachlichem Grund, in Textform mit Monatsfrist, ohne Einschränkung des vereinbarten Mietgebrauchs.',
    grund: 'Ein unbegrenztes einseitiges Leistungsbestimmungsrecht ist auch gegenüber Unternehmern unwirksam.',
  },
  {
    paragraph: '§ 4',
    bestand: '„Übernimmt der Mieter ohne ausreichenden Grund die Mietsache nicht am Übergabetermin, so gilt sie als übergeben."',
    neu: 'Der Mieter kommt in Annahmeverzug; Miete und Nebenkosten sind ab dem vereinbarten Termin geschuldet. Eine Übergabefiktion wird nicht vereinbart.',
    grund:
      'Eine Zugangs- bzw. Übergabefiktion schneidet dem Mieter Mängelrechte ab, obwohl er die Sache nie in Besitz hatte.',
  },
  {
    paragraph: '§ 18',
    bestand: 'Instandhaltung mitvermieteter Anlagen auf Mieterkosten, Kostendeckel uneinheitlich beziffert.',
    neu: 'Einzelfall- und Jahresobergrenze werden im Vertrag ausdrücklich beziffert; Instandsetzung von Dach und Fach bleibt beim Vermieter.',
    grund:
      'Ohne betragsmäßige Obergrenze ist die Abwälzung der Instandhaltung auch im Gewerbe unwirksam (BGH XII ZR 6/09).',
  },
];

export function gewerbeParagraphen(d: GewerbeDaten): Paragraph[] {
  const p: Paragraph[] = [];
  const gesamtFlaeche = d.flaechen.reduce((s, f) => s + f.qm, 0);
  const bruttomiete = d.umsatzsteuerpflichtig
    ? d.nettokaltmiete * (1 + d.umsatzsteuersatz / 100)
    : d.nettokaltmiete;
  const nkBrutto = d.umsatzsteuerpflichtig
    ? d.nebenkostenVorauszahlungNetto * (1 + d.umsatzsteuersatz / 100)
    : d.nebenkostenVorauszahlungNetto;

  // ─── § 1 Vertragsgegenstand ────────────────────────────────────────────
  p.push({
    nummer: '§ 1',
    titel: 'Vertragsgegenstand',
    absaetze: [
      {
        text: `Der Vermieter vermietet dem Mieter die nachstehend bezeichneten Flächen auf dem Grundstück ${d.objekt.strasse} ${d.objekt.hausnummer}, ${d.objekt.plz} ${d.objekt.ort}. Das Mietobjekt ist dem Mieter nach Lage und Größe bekannt.`,
      },
    ],
  });

  // ─── § 2 Mietsache ─────────────────────────────────────────────────────
  const p2: Absatz[] = [{ nummer: '2.1', text: 'Vermietet werden:' }];
  for (const f of d.flaechen) {
    p2.push({ text: `${f.bezeichnung}: ${f.qm.toLocaleString('de-DE')} m²`, linksbuendig: true });
  }
  p2.push({
    text: `Gesamtfläche: ${gesamtFlaeche.toLocaleString('de-DE')} m²`,
    linksbuendig: true,
    bold: true,
  });
  p2.push({
    nummer: '2.2',
    text: 'Die Flächen wurden ab Innenkante der Außenwände beziehungsweise der Begrenzungswände ermittelt. Weicht die tatsächliche Fläche um mehr als fünf Prozent von der vereinbarten ab, kann jede Partei eine Anpassung der Miete verlangen; weitergehende Rechte bleiben unberührt.',
  });
  p2.push({
    nummer: '2.3',
    text: 'Wandflächen am und im Gebäude sind nicht mitvermietet. Für Schilder, Reklame und Automaten gilt § 15.',
  });
  p.push({ nummer: '§ 2', titel: 'Mietsache', absaetze: p2 });

  // ─── § 3 Mietzweck ─────────────────────────────────────────────────────
  const p3: Absatz[] = [
    { nummer: '3.1', text: `Die Mietsache wird ausschließlich zum folgenden Zweck vermietet: ${d.mietzweck}. Eine Änderung des Mietzwecks bedarf der Zustimmung des Vermieters in Textform.` },
  ];
  if (d.betriebspflicht) {
    p3.push({
      nummer: '3.2',
      text: 'Der Mieter ist verpflichtet, den Betrieb während der üblichen Geschäftszeiten offenzuhalten. Vorübergehende Schließungen wegen Urlaub, Krankheit, Umbau oder aus anderen sachlichen Gründen sind zulässig und dem Vermieter anzuzeigen.',
    });
  }
  p3.push({
    nummer: d.betriebspflicht ? '3.3' : '3.2',
    text: 'Behördliche Genehmigungen für den Betrieb holt der Mieter auf eigene Kosten ein. Er trägt die Kosten der Wartung betriebsbedingter Einrichtungen wie Fettabscheider, Lüftungs- und Klimaanlagen und weist die Wartung auf Verlangen nach.',
  });
  p3.push({
    nummer: d.betriebspflicht ? '3.4' : '3.3',
    text: 'Der Vermieter haftet nicht dafür, dass der beabsichtigte Betrieb behördlich genehmigt wird oder wirtschaftlich erfolgreich ist. Er schuldet jedoch, dass die Mietsache in einem Zustand ist, der die vertraglich vorausgesetzte Nutzung baurechtlich zulässt.',
  });
  p3.push({
    nummer: d.betriebspflicht ? '3.5' : '3.4',
    text: d.konkurrenzschutz
      ? 'Der Vermieter gewährt Konkurrenzschutz: Er wird im selben Objekt keine Flächen an ein Unternehmen vermieten, dessen Hauptsortiment mit dem in Ziffer 3.1 genannten Mietzweck übereinstimmt. Ein Schutz gegen Randsortimente wird nicht geschuldet.'
      : 'Ein über den vertragsimmanenten Mindestschutz hinausgehender Konkurrenzschutz wird nicht vereinbart. Der Vermieter wird jedoch im selben Objekt kein Unternehmen ansiedeln, dessen Tätigkeit den vertragsgemäßen Gebrauch der Mietsache erheblich beeinträchtigt.',
  });
  p.push({ nummer: '§ 3', titel: 'Mietzweck und Betriebspflicht', absaetze: p3 });

  // ─── § 4 Übergabe ──────────────────────────────────────────────────────
  p.push({
    nummer: '§ 4',
    titel: 'Übergabe',
    absaetze: [
      { nummer: '4.1', text: `Die Mietsache wird dem Mieter zum ${formatDatum(d.mietbeginn)} übergeben.` },
      {
        nummer: '4.2',
        text: 'Der Zustand wird in einem gemeinsam unterzeichneten Übergabeprotokoll festgehalten; Mängel werden dort aufgenommen. Das Protokoll ist Bestandteil dieses Vertrages.',
      },
      {
        nummer: '4.3',
        text: 'Der Mieter duldet die Beseitigung protokollierter Mängel auch nach Einzug. Der Vermieter führt sie unverzüglich durch.',
      },
      {
        nummer: '4.4',
        text: 'Nimmt der Mieter die Mietsache zum vereinbarten Termin ohne ausreichenden Grund nicht entgegen, kommt er in Annahmeverzug. Miete und Nebenkosten sind ab dem vereinbarten Termin geschuldet. Eine Übergabe gilt damit nicht als erfolgt; die Rechte des Mieters wegen Mängeln bleiben unberührt.',
      },
    ],
  });

  // ─── § 5 Vertragsdauer ─────────────────────────────────────────────────
  const p5: Absatz[] = [{ nummer: '5.1', text: `Das Mietverhältnis beginnt am ${formatDatum(d.mietbeginn)}.` }];
  if (d.festmietzeitMonate > 0) {
    const ende = laufzeitEnde(d.mietbeginn, d.festmietzeitMonate);
    p5.push({
      nummer: '5.2',
      text: `Es wird fest abgeschlossen bis zum ${formatDatum(ende)} (${d.festmietzeitMonate} Monate). Während der Festmietzeit ist die ordentliche Kündigung ausgeschlossen.`,
    });
    if (d.optionen && d.optionen.anzahl > 0) {
      p5.push({
        nummer: '5.3',
        text: `Der Mieter hat das Recht, das Mietverhältnis ${d.optionen.anzahl}-mal um jeweils ${d.optionen.dauerMonate} Monate zu verlängern. Die Option ist spätestens sechs Monate vor Ablauf der jeweiligen Mietzeit in Textform auszuüben. Übt der Mieter die Option nicht aus, endet das Mietverhältnis mit Ablauf der Mietzeit, ohne dass es einer Kündigung bedarf.`,
      });
    } else {
      p5.push({
        nummer: '5.3',
        text: 'Nach Ablauf der Festmietzeit verlängert sich das Mietverhältnis um jeweils ein Jahr, wenn es nicht spätestens sechs Monate vor Ablauf gekündigt wird.',
      });
    }
  } else {
    p5.push({
      nummer: '5.2',
      text: 'Das Mietverhältnis läuft auf unbestimmte Zeit. Es kann von beiden Parteien spätestens am dritten Werktag eines Kalendervierteljahres zum Ablauf des nächsten Kalendervierteljahres gekündigt werden (§ 580a Abs. 2 BGB).',
    });
  }
  p5.push({
    nummer: d.festmietzeitMonate > 0 ? '5.4' : '5.3',
    text: 'Die Kündigung bedarf der Textform. Für die Rechtzeitigkeit kommt es auf den Zugang an. Setzt der Mieter den Gebrauch nach Ablauf der Mietzeit fort, verlängert sich das Mietverhältnis nicht stillschweigend; § 545 BGB wird abbedungen.',
  });
  p.push({ nummer: '§ 5', titel: 'Vertragsdauer', absaetze: p5 });

  // ─── § 6 Mietzins ──────────────────────────────────────────────────────
  const p6: Absatz[] = [
    {
      nummer: '6.1',
      text: `Die monatliche Nettokaltmiete beträgt ${formatEur(d.nettokaltmiete)} (in Worten: ${betragInWorten(d.nettokaltmiete)}).`,
      linksbuendig: true,
    },
    {
      nummer: '6.2',
      text: `Die monatliche Vorauszahlung auf die Nebenkosten beträgt ${formatEur(d.nebenkostenVorauszahlungNetto)} netto.`,
      linksbuendig: true,
    },
  ];
  if (d.umsatzsteuerpflichtig) {
    p6.push({
      nummer: '6.3',
      text: `Der Vermieter optiert nach § 9 UStG zur Umsatzsteuer. Auf Miete und Nebenkostenvorauszahlung wird die gesetzliche Umsatzsteuer von derzeit ${d.umsatzsteuersatz.toLocaleString('de-DE')} % erhoben. Der Mieter versichert, die Mietsache ausschließlich für Umsätze zu verwenden, die den Vorsteuerabzug nicht ausschließen, und weist dies auf Verlangen nach. Entfällt diese Voraussetzung, hat er den Vermieter von den daraus entstehenden Nachteilen freizustellen, insbesondere von einer Vorsteuerberichtigung nach § 15a UStG.`,
    });
    p6.push({
      text: `Gesamtbetrag monatlich: ${formatEur(bruttomiete + nkBrutto)} brutto (Miete ${formatEur(bruttomiete)}, Nebenkosten ${formatEur(nkBrutto)}).`,
      linksbuendig: true,
      bold: true,
    });
  } else {
    p6.push({
      nummer: '6.3',
      text: 'Der Vermieter optiert nicht zur Umsatzsteuer. Die Vermietung ist nach § 4 Nr. 12 lit. a UStG steuerfrei; Umsatzsteuer wird nicht gesondert ausgewiesen.',
    });
    p6.push({
      text: `Gesamtbetrag monatlich: ${formatEur(d.nettokaltmiete + d.nebenkostenVorauszahlungNetto)}.`,
      linksbuendig: true,
      bold: true,
    });
  }
  p.push({ nummer: '§ 6', titel: 'Mietzins', absaetze: p6 });

  // ─── § 7 Zahlung ───────────────────────────────────────────────────────
  p.push({
    nummer: '§ 7',
    titel: 'Zahlung, Nebenkosten, Aufrechnung',
    absaetze: [
      {
        nummer: '7.1',
        text: `Der Gesamtbetrag ist monatlich im Voraus, spätestens am dritten Werktag eines jeden Monats, kostenfrei zu zahlen auf das Konto ${formatIban(d.vermieter.mietIban)}${d.vermieter.mietBic ? `, BIC ${d.vermieter.mietBic}` : ''}, Kontoinhaber ${d.vermieter.firmenname}.`,
        linksbuendig: true,
      },
      {
        nummer: '7.2',
        text: 'Die Nebenkosten sind in der Miete nicht enthalten. Der Vermieter rechnet jährlich bis zum 31. Dezember des Folgejahres ab und kann die Vorauszahlung nach der Abrechnung auf eine angemessene Höhe anpassen.',
      },
      {
        nummer: '7.3',
        text: 'Umgelegt werden die Betriebskosten im Sinne des § 2 der Betriebskostenverordnung sowie zusätzlich die Kosten der Verwaltung und die Kosten der Instandhaltung im Rahmen des § 18. Kosten, die einzelnen Mietern direkt zurechenbar sind, werden diesen direkt zugeordnet; im Übrigen wird nach dem Verhältnis der Mietflächen verteilt.',
      },
      {
        nummer: '7.4',
        text: 'Gerät der Mieter in Verzug, schuldet er Verzugszinsen in Höhe von neun Prozentpunkten über dem Basiszinssatz (§ 288 Abs. 2 BGB) sowie den Ersatz der tatsächlich entstandenen Rechtsverfolgungskosten.',
      },
      {
        nummer: '7.5',
        text: 'Gegen Mietforderungen kann der Mieter nur mit unbestrittenen oder rechtskräftig festgestellten Forderungen aufrechnen oder ein Zurückbehaltungsrecht ausüben. Rechte aus § 536a BGB bleiben unberührt, wenn der Mieter seine Absicht mindestens einen Monat vor Fälligkeit in Textform angezeigt hat.',
      },
    ],
  });

  // ─── § 8 Kaution ───────────────────────────────────────────────────────
  p.push({
    nummer: '§ 8',
    titel: 'Mietsicherheit',
    absaetze:
      d.kautionArt === 'keine'
        ? [{ text: 'Eine Mietsicherheit wird nicht vereinbart.' }]
        : [
            {
              nummer: '8.1',
              text: `Der Mieter leistet zur Sicherung aller Ansprüche aus diesem Mietverhältnis eine Sicherheit in Höhe von ${formatEur(d.kaution)} (in Worten: ${betragInWorten(d.kaution)})${d.kautionArt === 'buergschaft' ? ' durch unbefristete, selbstschuldnerische Bürgschaft eines in Deutschland zugelassenen Kreditinstituts unter Verzicht auf die Einreden der Anfechtbarkeit und Aufrechenbarkeit' : ' als Barkaution'}. Sie ist vor Übergabe zu stellen. Die Begrenzung des § 551 BGB gilt für Gewerberaum nicht.`,
            },
            {
              nummer: '8.2',
              text: 'Nimmt der Vermieter die Sicherheit während des Mietverhältnisses berechtigt in Anspruch, hat der Mieter sie binnen eines Monats wieder aufzufüllen.',
            },
            {
              nummer: '8.3',
              text: 'Nach Beendigung des Mietverhältnisses rechnet der Vermieter über die Sicherheit ab. Er darf einen angemessenen Teil zurückbehalten, solange eine Nebenkostenabrechnung noch aussteht.',
            },
          ],
  });

  // ─── § 9 Nutzung und Untervermietung ───────────────────────────────────
  p.push({
    nummer: '§ 9',
    titel: 'Nutzung der Mieträume, Untervermietung',
    absaetze: [
      {
        nummer: '9.1',
        text: 'Die Schlüssel werden nach Übergabeprotokoll ausgehändigt. Zusätzliche Schlüssel dürfen nur mit Zustimmung des Vermieters beschafft werden. Bei einem vom Mieter zu vertretenden Verlust trägt er die Kosten eines erforderlichen Schlossaustauschs.',
      },
      {
        nummer: '9.2',
        text: 'Die Überlassung der Mietsache an Dritte, auch teilweise, bedarf der vorherigen Zustimmung des Vermieters in Textform. Der Vermieter darf sie nur aus wichtigem Grund verweigern; er kann sie von einer angemessenen Erhöhung der Miete abhängig machen.',
      },
      {
        nummer: '9.3',
        text: 'Ein Wechsel der Gesellschafter oder der Rechtsform des Mieters gilt nicht als Überlassung an Dritte, solange der Mieter als Rechtsträger fortbesteht. Eine Übertragung des Mietverhältnisses auf einen anderen Rechtsträger bedarf der Zustimmung des Vermieters.',
      },
    ],
  });

  // ─── § 10 bis § 16: Betriebsbezogene Pflichten ─────────────────────────
  p.push({
    nummer: '§ 10',
    titel: 'Versorgungsleitungen',
    absaetze: [
      {
        text: 'Die Leitungsnetze dürfen nur in dem Umfang beansprucht werden, in dem keine Überlastung eintritt. Erweiterungen bedürfen der Zustimmung des Vermieters und gehen zu Lasten des Mieters. Bei Störungen sorgt der Mieter für die sofortige Abschaltung und benachrichtigt den Vermieter. Frostgefährdete Leitungen im Bereich des Mieters schützt dieser vor dem Einfrieren.',
      },
    ],
  });

  p.push({
    nummer: '§ 11',
    titel: 'Reinigung, Verkehrssicherung, Abfall',
    absaetze: [
      {
        nummer: '11.1',
        text: 'Der Mieter hält die zu seiner Mietsache gehörenden Zugänge sauber und verkehrssicher, einschließlich Schnee- und Eisbeseitigung während seiner Geschäftszeiten, soweit diese Pflicht nicht vom Vermieter zentral vergeben und über die Nebenkosten umgelegt wird.',
      },
      {
        nummer: '11.2',
        text: 'Betriebsabfall entsorgt der Mieter auf eigene Kosten. Die Hausmüllbehälter des Objekts stehen dafür nicht zur Verfügung.',
      },
      {
        nummer: '11.3',
        text: 'Der Mieter hält die immissionsschutzrechtlichen Vorgaben ein und vermeidet vermeidbare Geruchs-, Lärm- und Erschütterungsbelastungen für die übrigen Nutzer des Objekts.',
      },
    ],
  });

  p.push({
    nummer: '§ 12',
    titel: 'Maschinen, Lagerung, Abstellflächen',
    absaetze: [
      {
        text: 'Das Aufstellen von Maschinen bedarf der Zustimmung des Vermieters, wenn die zulässige Deckenbelastung berührt wird oder Erschütterungen zu erwarten sind. Außerhalb der Mieträume dürfen Gegenstände nur auf den ausdrücklich zugewiesenen Flächen gelagert oder abgestellt werden.',
      },
    ],
  });

  p.push({
    nummer: '§ 13',
    titel: 'Werbeanlagen und Beschilderung',
    absaetze: [
      {
        nummer: '13.1',
        text: 'Der Mieter hat Anspruch darauf, an der Mietsache ein Firmenschild üblicher Größe anzubringen. Besteht eine Sammelschildanlage, fügt er sich in diese ein und trägt die anteiligen Kosten.',
      },
      {
        nummer: '13.2',
        text: 'Weitergehende Werbeanlagen bedürfen der Zustimmung des Vermieters in Textform. Erforderliche behördliche Genehmigungen holt der Mieter auf eigene Kosten ein.',
      },
      {
        nummer: '13.3',
        text: 'Bei Vertragsende entfernt der Mieter seine Werbeanlagen und stellt den ursprünglichen Zustand wieder her.',
      },
    ],
  });

  // ─── § 14 Schönheitsreparaturen ────────────────────────────────────────
  p.push({
    nummer: '§ 14',
    titel: 'Schönheitsreparaturen',
    absaetze: d.schoenheitsreparaturen
      ? [
          {
            text: 'Der Mieter führt die Schönheitsreparaturen während der Mietzeit auf eigene Kosten aus, soweit sie nach dem tatsächlichen Zustand erforderlich sind. Sie beschränken sich auf dekorative Schäden aus seinem Gebrauch. Eine Verpflichtung zur Endrenovierung unabhängig vom Zustand und eine Beteiligung an noch nicht fälligen Arbeiten werden nicht vereinbart.',
          },
        ]
      : [{ text: 'Die Schönheitsreparaturen verbleiben beim Vermieter.' }],
  });

  // ─── § 15 Instandhaltung ───────────────────────────────────────────────
  p.push({
    nummer: '§ 15',
    titel: 'Instandhaltung von Anlagen und Einrichtungen',
    absaetze: [
      {
        nummer: '15.1',
        text: `Der Mieter trägt die Kosten der Instandhaltung und Instandsetzung der mitvermieteten Anlagen und Einrichtungen innerhalb der Mietsache, die seinem unmittelbaren Zugriff unterliegen, bis zu ${formatEur(d.instandhaltungEinzelgrenze)} je Einzelfall und höchstens ${formatEur(d.instandhaltungJahresgrenze)} im Kalenderjahr. Darüber hinausgehende Kosten trägt der Vermieter.`,
      },
      {
        nummer: '15.2',
        text: 'Instandsetzungen an Dach und Fach, an der Tragkonstruktion sowie an den zentralen technischen Anlagen des Gebäudes bleiben Sache des Vermieters.',
      },
      {
        nummer: '15.3',
        text: 'Wartungsverträge für betriebsbedingte Einrichtungen des Mieters — insbesondere Lüftung, Klima, Fettabscheider und Brandschutztechnik im Bereich der Mietsache — schließt der Mieter auf eigene Kosten ab und weist sie auf Verlangen nach. Die letzte Wartung vor Vertragsende darf bei Rückgabe nicht länger als drei Monate zurückliegen.',
      },
    ],
  });

  // ─── § 16 Schäden ──────────────────────────────────────────────────────
  p.push({
    nummer: '§ 16',
    titel: 'Beschädigungen und Schädlingsbefall',
    absaetze: [
      {
        nummer: '16.1',
        text: 'Der Mieter behandelt die Mietsache pfleglich, reinigt, lüftet und beheizt sie ausreichend.',
      },
      {
        nummer: '16.2',
        text: 'Für Schäden haftet der Mieter, soweit er oder Personen, denen er den Gebrauch überlassen hat, sie zu vertreten haben. Der Vermieter hat darzulegen und zu beweisen, dass die Schadensursache aus dem Bereich des Mieters stammt; der Mieter hat darzulegen und zu beweisen, dass ihn kein Verschulden trifft.',
      },
      {
        nummer: '16.3',
        text: 'Schädlingsbefall zeigt der Mieter unverzüglich an. Die Kosten der Bekämpfung trägt er, soweit der Befall aus seinem Betrieb herrührt; andernfalls der Vermieter.',
      },
      {
        nummer: '16.4',
        text: 'Der Mieter versichert seine eingebrachten Sachen und seine Betriebshaftpflicht auf eigene Kosten in angemessener Höhe und weist dies auf Verlangen nach.',
      },
    ],
  });

  // ─── § 17 Ersatzvornahme ───────────────────────────────────────────────
  p.push({
    nummer: '§ 17',
    titel: 'Ersatzvornahme und Schadensersatz',
    absaetze: [
      {
        text: 'Verletzt der Mieter eine Pflicht aus §§ 14 bis 16, kann der Vermieter nach erfolgloser Abmahnung und angemessener Fristsetzung die erforderlichen Maßnahmen auf Kosten des Mieters durchführen lassen oder Schadensersatz nach §§ 280, 281 BGB verlangen. Die Höhe des Schadens hat der Vermieter nachzuweisen.',
      },
    ],
  });

  // ─── § 18 Außerordentliche Kündigung ───────────────────────────────────
  p.push({
    nummer: '§ 18',
    titel: 'Außerordentliche Kündigung',
    absaetze: [
      {
        text: 'Der Vermieter kann das Mietverhältnis aus wichtigem Grund fristlos kündigen (§ 543 BGB), insbesondere wenn der Mieter die vereinbarte Sicherheit trotz Fristsetzung nicht stellt, mit der Miete in Höhe von mehr als zwei Monatsmieten in Verzug ist, die Mietsache trotz Abmahnung vertragswidrig gebraucht oder sie unbefugt einem Dritten überlässt. Die Rechte des Mieters aus § 543 BGB bleiben unberührt.',
      },
    ],
  });

  // ─── § 19 Veränderungen durch den Mieter ───────────────────────────────
  p.push({
    nummer: '§ 19',
    titel: 'Veränderungen durch den Mieter',
    absaetze: [
      {
        nummer: '19.1',
        text: 'Um- und Einbauten bedürfen der vorherigen Zustimmung des Vermieters in Textform. Der Mieter trägt die Kosten und die Verantwortung für erforderliche Genehmigungen.',
      },
      {
        nummer: '19.2',
        text: 'Bei Vertragsende kann der Vermieter verlangen, dass der Mieter seine Einbauten entfernt und den ursprünglichen Zustand wiederherstellt. Er hat dies spätestens sechs Monate vor Vertragsende in Textform anzukündigen; andernfalls kann er den Rückbau nicht mehr verlangen.',
      },
      {
        nummer: '19.3',
        text: 'Übernimmt der Vermieter Einbauten, hat er dem Mieter einen angemessenen Ausgleich unter Berücksichtigung der Abnutzung zu leisten.',
      },
    ],
  });

  // ─── § 20 Maßnahmen des Vermieters ─────────────────────────────────────
  const zuschlagSatz = 8;
  p.push({
    nummer: '§ 20',
    titel: 'Maßnahmen des Vermieters',
    absaetze: [
      {
        nummer: '20.1',
        text: 'Der Mieter duldet Erhaltungs- und Modernisierungsmaßnahmen. Der Vermieter kündigt sie mindestens drei Monate vorher in Textform an und nimmt auf die Betriebsabläufe des Mieters Rücksicht. Wird der Betrieb dadurch erheblich beeinträchtigt, bleibt das Minderungsrecht unberührt.',
      },
      {
        nummer: '20.2',
        text: `Nach einer wertverbessernden Maßnahme kann der Vermieter die jährliche Miete um ${zuschlagSatz} % der für die Mietsache aufgewendeten Kosten erhöhen, abzüglich ersparter Erhaltungsaufwendungen und Drittmittel. Die Erhöhung ist auf drei Monatsnettokaltmieten je Kalenderjahr begrenzt und in Textform zu erklären und zu berechnen.`,
      },
    ],
  });

  // ─── § 21 Betreten ─────────────────────────────────────────────────────
  p.push({
    nummer: '§ 21',
    titel: 'Betreten der Mieträume',
    absaetze: [
      {
        nummer: '21.1',
        text: 'Der Vermieter darf die Mietsache aus konkretem Anlass nach Ankündigung in Textform während der Geschäftszeiten besichtigen. Bei Gefahr im Verzug darf er sie jederzeit betreten und öffnen lassen; die Kosten trägt der Mieter nur, wenn er die Gefahr zu vertreten hat.',
      },
      {
        nummer: '21.2',
        text: 'In den letzten sechs Monaten der Mietzeit sowie bei beabsichtigtem Verkauf darf der Vermieter die Mietsache nach Ankündigung mit Interessenten besichtigen und Vermietungshinweise anbringen, soweit dadurch der Betrieb nicht erheblich beeinträchtigt wird.',
      },
    ],
  });

  // ─── § 22 Hausordnung ──────────────────────────────────────────────────
  p.push({
    nummer: '§ 22',
    titel: 'Hausordnung',
    absaetze: [
      {
        text: 'Der Vermieter kann eine Hausordnung erlassen und ändern, soweit dies zur Wahrung von Sicherheit, Ordnung und Sauberkeit im Objekt oder zur Anpassung an geänderte Vorgaben erforderlich ist. Sie darf den nach § 3 vereinbarten Mietgebrauch nicht einschränken. Änderungen sind mit einer Frist von einem Monat in Textform mitzuteilen; bei Widersprüchen geht dieser Vertrag vor.',
      },
    ],
  });

  // ─── § 23 Beendigung ───────────────────────────────────────────────────
  p.push({
    nummer: '§ 23',
    titel: 'Beendigung des Mietverhältnisses',
    absaetze: [
      {
        nummer: '23.1',
        text: 'Bei Beendigung gibt der Mieter die Mietsache geräumt und besenrein zurück und übergibt sämtliche Schlüssel. Der Zustand wird in einem gemeinsamen Protokoll festgehalten.',
      },
      {
        nummer: '23.2',
        text: 'Zurückgelassene Gegenstände darf der Vermieter nach fruchtlosem Ablauf einer in Textform gesetzten Frist von vier Wochen auf Kosten des Mieters einlagern oder verwerten.',
      },
      {
        nummer: '23.3',
        text: 'Endet das Mietverhältnis durch eine vom Mieter zu vertretende fristlose Kündigung, haftet er für den Mietausfall bis zum Ablauf der vereinbarten Mietzeit, längstens jedoch bis zu dem Zeitpunkt, zu dem er ordentlich hätte kündigen können. Der Vermieter hat sich um eine Weitervermietung zu bemühen und muss sich anrechnen lassen, was er dadurch erlangt.',
      },
    ],
  });

  // ─── § 24 Mehrere Mieter ───────────────────────────────────────────────
  if (d.mieter.length > 1) {
    p.push({
      nummer: '§ 24',
      titel: 'Mehrere Mieter',
      absaetze: [
        { nummer: '24.1', text: 'Mehrere Mieter haften als Gesamtschuldner.' },
        {
          nummer: '24.2',
          text: 'Sie bevollmächtigen sich gegenseitig zur Abgabe und Entgegennahme von Erklärungen. Das gilt nicht für Kündigungen und Mieterhöhungserklärungen; diese sind von allen und gegenüber allen zu erklären.',
        },
      ],
    });
  }

  // ─── § 25 Indexklausel ─────────────────────────────────────────────────
  if (d.indexklausel) {
    p.push({
      nummer: '§ 25',
      titel: 'Wertsicherung',
      absaetze: [
        {
          nummer: '25.1',
          text: `Ändert sich der vom Statistischen Bundesamt veröffentlichte Verbraucherpreisindex für Deutschland (Basis 2020 = 100) gegenüber dem Stand bei Vertragsbeginn${d.indexBasisMonat ? ` — Monat ${formatDatum(d.indexBasisMonat)}${d.indexBasisWert ? ` mit ${d.indexBasisWert.toLocaleString('de-DE')} Punkten` : ''}` : ''} oder gegenüber dem Stand der letzten Anpassung um mindestens ${d.indexSchwelleProzent.toLocaleString('de-DE')} %, kann jede Vertragspartei eine entsprechende prozentuale Anpassung der Nettokaltmiete in Textform verlangen.`,
        },
        {
          nummer: '25.2',
          text: 'Die geänderte Miete ist ab dem Monat zu zahlen, der auf den Zugang der Erklärung folgt. Die Anpassung wirkt in beide Richtungen. Wird der Index umgestellt oder ersetzt, tritt der Nachfolgeindex an seine Stelle; die Umrechnung erfolgt nach den Vorgaben des Statistischen Bundesamtes.',
        },
      ],
    });
  }

  // ─── § 26 Schlussbestimmungen ──────────────────────────────────────────
  const schluss: Absatz[] = [
    {
      nummer: '26.1',
      text: 'Mündliche Nebenabreden bestehen nicht. Änderungen und Ergänzungen dieses Vertrages bedürfen der Textform (§ 578 Abs. 1 in Verbindung mit § 550 BGB in der seit 2025 geltenden Fassung).',
    },
    {
      nummer: '26.2',
      text: 'Nachträge sind mit dem Vertrag zu verbinden und nehmen auf ihn Bezug.',
    },
    {
      nummer: '26.3',
      text: 'Veräußert der Vermieter das Grundstück, tritt der Erwerber nach § 566 BGB in dieses Mietverhältnis ein.',
    },
    {
      nummer: '26.4',
      text: `Gerichtsstand für alle Streitigkeiten aus diesem Vertrag ist ${d.gerichtsstand}, soweit die Parteien Kaufleute sind.`,
    },
    {
      nummer: '26.5',
      text: 'Sollte eine Bestimmung dieses Vertrages unwirksam sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt. An die Stelle der unwirksamen Bestimmung treten die gesetzlichen Vorschriften.',
    },
  ];

  if (d.zusatzvereinbarungen?.trim()) {
    schluss.push({ nummer: '26.6', text: 'Ergänzend wird vereinbart:' });
    for (const zeile of d.zusatzvereinbarungen.split('\n').map(z => z.trim()).filter(Boolean)) {
      schluss.push({ text: zeile });
    }
  }

  p.push({ nummer: '§ 26', titel: 'Schlussbestimmungen', absaetze: schluss });

  return p;
}

/** Ende einer Festmietzeit: Beginn plus n Monate, minus einen Tag. */
export function laufzeitEnde(beginn: string, monate: number): string {
  if (!beginn) return '';
  const d = new Date(`${beginn}T12:00:00`);
  d.setMonth(d.getMonth() + monate);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
