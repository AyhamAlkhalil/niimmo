/**
 * Anlagen zum Mietvertrag.
 *
 * Die Anlagen werden im selben PDF als Textseiten gerendert, nicht als separate
 * Dateien angehängt. § 550 BGB verlangt die Einheit der Urkunde — ein extern
 * beigefügtes PDF wäre ein Formrisiko, und jsPDF kann fremde PDFs ohnehin nicht
 * einbetten.
 */
import type { Absatz, Paragraph } from './wohnraumKlauseln';
import type { MietvertragDaten } from './typen';

export interface Anlage {
  kennung: string;
  titel: string;
  /** Einleitungstext über den Abschnitten. */
  vorspann?: string;
  abschnitte: Paragraph[];
  /** Eigener Unterschriftsblock am Ende der Anlage. */
  unterschrift: boolean;
}

export function anlagenFuerVertrag(d: MietvertragDaten): Anlage[] {
  const a: Anlage[] = [];

  if (d.anlagen.hausordnung) a.push(hausordnung());
  if (d.anlagen.betrkvKatalog) a.push(betriebskostenkatalog(d));
  if (d.anlagen.datenschutzhinweis) a.push(datenschutzinformation(d));
  if (d.anlagen.widerrufsbelehrung && widerrufsrechtBesteht(d)) a.push(widerrufsbelehrung(d));
  if (d.anlagen.mietspiegelEinwilligung) a.push(mietspiegelEinwilligung(d));

  return a;
}

/**
 * Ein Widerrufsrecht besteht nur bei Fernabsatz oder Abschluss außerhalb von
 * Geschäftsräumen — und nicht, wenn der Mieter die Wohnung vorher besichtigt
 * hat (§ 312 Abs. 4 S. 2 BGB). Eine Belehrung „auf Verdacht" ist keine gute
 * Idee: Sie erweckt den Eindruck eines Rechts, das nicht besteht.
 */
export function widerrufsrechtBesteht(d: MietvertragDaten): boolean {
  return !d.besichtigtAm;
}

function hausordnung(): Anlage {
  return {
    kennung: 'Anlage 1',
    titel: 'Hausordnung',
    vorspann:
      'Die Hausordnung soll das Zusammenleben im Haus regeln. Sie betrifft die Art und Weise der Ausübung des Mietgebrauchs und schränkt den vereinbarten Umfang des Mietgebrauchs nicht ein.',
    unterschrift: false,
    abschnitte: [
      {
        nummer: '1.',
        titel: 'Rücksichtnahme',
        absaetze: [
          {
            nummer: '1.1',
            text: 'In der Zeit von 22.00 bis 6.00 Uhr sowie an Sonn- und Feiertagen ist Zimmerlautstärke einzuhalten. Musizieren ist werktags bis zu zwei Stunden täglich außerhalb der Ruhezeiten zulässig.',
          },
          {
            nummer: '1.2',
            text: 'Vermeidbare Geräusche, die andere Hausbewohner erheblich stören, sind zu unterlassen. Kinderlärm und die üblichen Geräusche des Wohnens gelten nicht als Störung.',
          },
        ],
      },
      {
        nummer: '2.',
        titel: 'Gemeinschaftsflächen',
        absaetze: [
          {
            nummer: '2.1',
            text: 'Treppenhaus, Flure und gemeinschaftlich genutzte Räume sind sauber zu halten. Ist die Reinigung an ein Unternehmen vergeben, trägt der Mieter die Kosten anteilig als Betriebskosten; eine eigene Reinigungspflicht besteht dann nicht.',
          },
          {
            nummer: '2.2',
            text: 'Besondere Verschmutzungen beseitigt, wer sie verursacht hat.',
          },
          {
            nummer: '2.3',
            text: 'Flucht- und Rettungswege sind freizuhalten. Gegenstände dürfen dort nicht abgestellt werden. Kinderwagen und Gehhilfen dürfen im Hausflur abgestellt werden, soweit der Fluchtweg in ausreichender Breite frei bleibt.',
          },
        ],
      },
      {
        nummer: '3.',
        titel: 'Abfall',
        absaetze: [
          {
            nummer: '3.1',
            text: 'Abfälle sind getrennt in die dafür vorgesehenen Behälter zu geben. Sperrmüll ist auf eigene Kosten zu entsorgen und darf nicht im Haus oder auf dem Grundstück gelagert werden.',
          },
        ],
      },
      {
        nummer: '4.',
        titel: 'Waschen und Trocknen',
        absaetze: [
          {
            nummer: '4.1',
            text: 'Vorhandene Waschküchen und Trockenplätze sind nach Gebrauch zu reinigen. Wäsche darf auf dem Balkon getrocknet werden, soweit sie die Brüstung nicht überragt.',
          },
        ],
      },
      {
        nummer: '5.',
        titel: 'Lüften und Heizen',
        absaetze: [
          {
            nummer: '5.1',
            text: 'Die Wohnung ist ausreichend zu beheizen und regelmäßig durch Stoßlüften zu lüften, um Feuchtigkeitsschäden zu vermeiden.',
          },
          {
            nummer: '5.2',
            text: 'Bei Frostgefahr sind Fenster in gemeinschaftlich genutzten Räumen geschlossen zu halten.',
          },
        ],
      },
      {
        nummer: '6.',
        titel: 'Sicherheit',
        absaetze: [
          {
            nummer: '6.1',
            text: 'Die Haustür ist nachts geschlossen zu halten. Ein Abschließen ist unzulässig, soweit dadurch der Fluchtweg versperrt würde.',
          },
          {
            nummer: '6.2',
            text: 'In Keller- und Bodenräumen dürfen keine leicht entzündlichen Stoffe gelagert werden. Diese Räume dürfen nicht mit offenem Licht betreten werden.',
          },
        ],
      },
      {
        nummer: '7.',
        titel: 'Fahrzeuge',
        absaetze: [
          {
            nummer: '7.1',
            text: 'Fahrzeuge sind nur auf den dafür vorgesehenen Flächen abzustellen. Das Waschen von Kraftfahrzeugen auf dem Grundstück ist nicht gestattet. Fahrräder gehören in die dafür vorgesehenen Abstellräume.',
          },
        ],
      },
    ],
  };
}

function betriebskostenkatalog(d: MietvertragDaten): Anlage {
  const umgelegt = d.betriebskostenPositionen.filter(p => p.umgelegt);
  const nichtUmgelegt = d.betriebskostenPositionen.filter(p => !p.umgelegt);

  const abschnitte: Paragraph[] = [
    {
      nummer: 'A',
      titel: 'Umgelegte Betriebskosten',
      absaetze: umgelegt.map<Absatz>(p => ({
        text: `${p.nummer}  ${p.bezeichnung}`,
        linksbuendig: true,
      })),
    },
  ];

  if (nichtUmgelegt.length > 0) {
    abschnitte.push({
      nummer: 'B',
      titel: 'Nicht umgelegte Positionen',
      absaetze: [
        { text: 'Die folgenden Positionen werden nicht auf den Mieter umgelegt:' },
        ...nichtUmgelegt.map<Absatz>(p => ({
          text: `${p.nummer}  ${p.bezeichnung}`,
          linksbuendig: true,
        })),
      ],
    });
  }

  abschnitte.push({
    nummer: 'C',
    titel: 'Nicht umlagefähige Kosten',
    absaetze: [
      {
        text: 'Nicht umlagefähig und vom Vermieter zu tragen sind insbesondere die Kosten der Verwaltung sowie die Kosten der Instandhaltung und Instandsetzung (§ 1 Abs. 2 BetrKV). Reparaturen, Erneuerungen und die Beseitigung von Mängeln gehören dazu.',
      },
    ],
  });

  return {
    kennung: 'Anlage 2',
    titel: 'Betriebskostenkatalog',
    vorspann:
      'Umlagefähig sind nur die hier namentlich aufgeführten Betriebskosten im Sinne des § 556 Abs. 1 BGB in Verbindung mit § 2 der Betriebskostenverordnung. Sonstige Betriebskosten nach § 2 Nr. 17 BetrKV sind nur umlagefähig, soweit sie unten einzeln benannt sind.',
    unterschrift: false,
    abschnitte,
  };
}

function datenschutzinformation(d: MietvertragDaten): Anlage {
  const v = d.vermieter;
  return {
    kennung: 'Anlage 3',
    titel: 'Datenschutzinformation nach Art. 13 DSGVO',
    unterschrift: false,
    abschnitte: [
      {
        nummer: '1.',
        titel: 'Verantwortlicher',
        absaetze: [
          {
            text: `${v.firmenname}, ${v.strasse} ${v.hausnummer}, ${v.plz} ${v.ort}${v.telefon ? `, Telefon ${v.telefon}` : ''}${v.email ? `, E-Mail ${v.email}` : ''}.`,
          },
        ],
      },
      {
        nummer: '2.',
        titel: 'Zwecke und Rechtsgrundlagen',
        absaetze: [
          {
            text: 'Wir verarbeiten Ihre Daten zur Begründung, Durchführung und Beendigung des Mietverhältnisses (Art. 6 Abs. 1 lit. b DSGVO), zur Erfüllung gesetzlicher Pflichten, etwa aus Steuer- und Handelsrecht sowie dem Bundesmeldegesetz (Art. 6 Abs. 1 lit. c DSGVO), und zur Wahrung berechtigter Interessen, etwa der Geltendmachung von Ansprüchen (Art. 6 Abs. 1 lit. f DSGVO).',
          },
        ],
      },
      {
        nummer: '3.',
        titel: 'Empfänger',
        absaetze: [
          {
            text: 'Ihre Daten geben wir weiter an Messdienstleister für die Heiz- und Betriebskostenabrechnung, an Versorgungsunternehmen, an Handwerksbetriebe, soweit dies zur Auftragsdurchführung erforderlich ist, an unser Kreditinstitut sowie an Steuerberater und Rechtsanwälte. Eine Übermittlung in Drittländer findet nicht statt.',
          },
        ],
      },
      {
        nummer: '4.',
        titel: 'Speicherdauer',
        absaetze: [
          {
            text: 'Wir speichern Ihre Daten für die Dauer des Mietverhältnisses und darüber hinaus, solange gesetzliche Aufbewahrungsfristen bestehen oder Ansprüche geltend gemacht werden können — in der Regel bis zu zehn Jahre nach Ende des Mietverhältnisses.',
          },
        ],
      },
      {
        nummer: '5.',
        titel: 'Ihre Rechte',
        absaetze: [
          {
            text: 'Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen eine Verarbeitung auf Grundlage berechtigter Interessen (Art. 21). Sie können sich zudem bei einer Aufsichtsbehörde beschweren; zuständig ist die Landesbeauftragte für den Datenschutz Niedersachsen.',
          },
        ],
      },
      {
        nummer: '6.',
        titel: 'Bereitstellungspflicht',
        absaetze: [
          {
            text: 'Die Angabe Ihrer Daten ist für den Abschluss und die Durchführung des Mietvertrages erforderlich. Ohne sie können wir den Vertrag nicht schließen.',
          },
        ],
      },
    ],
  };
}

function widerrufsbelehrung(d: MietvertragDaten): Anlage {
  const v = d.vermieter;
  const adresse = `${v.firmenname}, ${v.strasse} ${v.hausnummer}, ${v.plz} ${v.ort}${v.telefon ? `, Telefon ${v.telefon}` : ''}${v.email ? `, E-Mail ${v.email}` : ''}`;

  return {
    kennung: 'Anlage 4',
    titel: 'Widerrufsbelehrung',
    vorspann:
      'Diese Belehrung gilt, wenn der Vertrag außerhalb unserer Geschäftsräume oder ausschließlich über Fernkommunikationsmittel geschlossen wurde.',
    unterschrift: true,
    abschnitte: [
      {
        nummer: '1.',
        titel: 'Widerrufsrecht',
        absaetze: [
          {
            text: 'Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.',
          },
          {
            text: `Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (${adresse}) mittels einer eindeutigen Erklärung — zum Beispiel per Brief, Telefax oder E-Mail — über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist. Eine bestimmte Form ist nicht erforderlich.`,
          },
          {
            text: 'Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.',
          },
        ],
      },
      {
        nummer: '2.',
        titel: 'Folgen des Widerrufs',
        absaetze: [
          {
            text: 'Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.',
          },
          {
            text: 'Haben Sie verlangt, dass die Überlassung der Mietsache während der Widerrufsfrist beginnen soll, so haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des Widerrufsrechts unterrichten, bereits erbrachten Leistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Leistungen entspricht.',
          },
        ],
      },
      {
        nummer: '3.',
        titel: 'Muster-Widerrufsformular',
        absaetze: [
          {
            text: 'Wenn Sie den Vertrag widerrufen wollen, füllen Sie bitte dieses Formular aus und senden Sie es zurück.',
          },
          { text: `An: ${adresse}`, linksbuendig: true },
          {
            text: 'Hiermit widerrufe(n) ich/wir den von mir/uns abgeschlossenen Vertrag über die Anmietung der folgenden Wohnung:',
            linksbuendig: true,
          },
          { text: '', linksbuendig: true },
          { text: 'Wohnung: ______________________________________________', linksbuendig: true },
          { text: 'Vertrag geschlossen am: ________________________________', linksbuendig: true },
          { text: 'Name des/der Verbraucher(s): ___________________________', linksbuendig: true },
          { text: 'Anschrift des/der Verbraucher(s): ______________________', linksbuendig: true },
          { text: '', linksbuendig: true },
          { text: '____________________          ____________________', linksbuendig: true },
          { text: 'Datum                         Unterschrift', linksbuendig: true },
        ],
      },
    ],
  };
}

function mietspiegelEinwilligung(d: MietvertragDaten): Anlage {
  return {
    kennung: 'Anlage 5',
    titel: 'Freiwillige Einwilligung in die Datenweitergabe zu Mietspiegelzwecken',
    unterschrift: true,
    abschnitte: [
      {
        nummer: '',
        titel: '',
        absaetze: [
          {
            text: `Ich willige ein, dass ${d.vermieter.firmenname} folgende Daten zu meiner Wohnung — Lage, Art, Größe, Ausstattung, Beschaffenheit, Nettokaltmiete und Betriebskostenvorauszahlung, ohne meinen Namen — an den mit der Erstellung des Mietspiegels beauftragten Ersteller zum Zweck der Mietspiegelerstellung übermittelt.`,
          },
          {
            text: 'Diese Einwilligung ist freiwillig. Der Abschluss und die Durchführung des Mietvertrages hängen nicht von ihr ab. Ich kann sie jederzeit ohne Angabe von Gründen mit Wirkung für die Zukunft widerrufen. Die Rechtmäßigkeit der bis zum Widerruf erfolgten Verarbeitung bleibt unberührt.',
          },
          { text: '', linksbuendig: true },
          { text: '[  ]  Ja, ich willige ein.', linksbuendig: true },
          { text: '[  ]  Nein, ich willige nicht ein.', linksbuendig: true },
        ],
      },
    ],
  };
}
