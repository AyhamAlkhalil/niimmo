/**
 * Prüfung vor der Vertragserzeugung.
 *
 * Grundregel: Der Generator rät nichts. Fehlt eine Angabe, die der Vertrag
 * braucht, wird kein PDF erzeugt — statt eine Zahl zu erfinden, die später
 * als vereinbart gilt. Das betrifft insbesondere die Personenzahl (§ 556a
 * Abs. 1 S. 2 BGB), die Kaution und den Übergabezustand.
 */
import { istIbanGueltig } from '../pdf/briefLayout';
import type { MietvertragDaten } from './typen';

export type Schwere = 'blocker' | 'warnung';

export interface Befund {
  schwere: Schwere;
  feld: string;
  text: string;
  /** Was der Anwender tun muss. */
  loesung: string;
}

export function pruefeVertragsdaten(d: MietvertragDaten): Befund[] {
  const b: Befund[] = [];
  const blocker = (feld: string, text: string, loesung: string) =>
    b.push({ schwere: 'blocker', feld, text, loesung });
  const warnung = (feld: string, text: string, loesung: string) =>
    b.push({ schwere: 'warnung', feld, text, loesung });

  // ─── Vertragsparteien ───────────────────────────────────────────────────
  if (!d.vermieter.firmenname?.trim()) {
    blocker('vermieter', 'Kein Vermieter hinterlegt.', 'Vermieter in den Stammdaten anlegen.');
  }
  if (!d.vermieter.stammdatenGeprueft) {
    warnung(
      'vermieter.stammdatenGeprueft',
      'Die Vermieterstammdaten sind noch nicht gegen den Handelsregisterauszug geprüft.',
      'Firmierung, Anschrift, HRB und Steuernummer bestätigen und in den Stammdaten als geprüft markieren.'
    );
  }
  if (d.vermieter.vertretenDurch.length === 0) {
    blocker(
      'vermieter.vertretenDurch',
      'Es ist nicht hinterlegt, wer den Vermieter vertritt.',
      'Vertretungsberechtigte Person(en) in den Vermieterstammdaten eintragen.'
    );
  }

  if (d.mieter.length === 0) {
    blocker('mieter', 'Dem Vertrag ist kein Mieter zugeordnet.', 'Mindestens einen Mieter zuordnen.');
  }
  d.mieter.forEach((m, i) => {
    const bez = `Mieter ${i + 1}`;
    if (m.istUnternehmen) {
      if (!m.firmenname?.trim()) {
        blocker(`mieter[${i}].firmenname`, `${bez}: Firmenname fehlt.`, 'Firmenname erfassen.');
      }
      if (!m.vertretenDurch?.trim()) {
        warnung(
          `mieter[${i}].vertretenDurch`,
          `${bez}: Es ist nicht angegeben, wer die Firma vertritt.`,
          'Vertretungsberechtigte Person erfassen.'
        );
      }
    } else {
      if (!m.vorname?.trim() || !m.nachname?.trim()) {
        blocker(`mieter[${i}].name`, `${bez}: Vor- oder Nachname fehlt.`, 'Namen vervollständigen.');
      }
      if (!m.anrede) {
        warnung(`mieter[${i}].anrede`, `${bez}: Keine Anrede hinterlegt.`, 'Anrede auswählen.');
      }
    }
    if (!m.strasse?.trim() || !m.plz?.trim() || !m.ort?.trim()) {
      blocker(
        `mieter[${i}].adresse`,
        `${bez}: Die bisherige Anschrift fehlt.`,
        'Anschrift vor Einzug erfassen — sie steht im Vertragsrubrum.'
      );
    }
  });

  // ─── Mietsache ──────────────────────────────────────────────────────────
  if (!d.objekt.strasse?.trim() || !d.objekt.plz?.trim() || !d.objekt.ort?.trim()) {
    blocker('objekt.adresse', 'Die Objektadresse ist unvollständig.', 'Straße, PLZ und Ort der Immobilie erfassen.');
  }
  if (!d.einheit.bezeichnung?.trim()) {
    blocker(
      'einheit.bezeichnung',
      'Die Einheit hat keine Bezeichnung.',
      'Einheitenkennung vergeben, z. B. „WE 12".'
    );
  }
  if (!d.einheit.lage?.trim()) {
    blocker('einheit.lage', 'Die Lage der Einheit im Gebäude fehlt.', 'Lage erfassen, z. B. „Dachgeschoss rechts".');
  }
  if (!d.einheit.wohnflaecheQm || d.einheit.wohnflaecheQm <= 0) {
    blocker(
      'einheit.wohnflaecheQm',
      'Es ist keine Wohnfläche hinterlegt.',
      'Wohnfläche erfassen — sie ist Grundlage für Miete und Betriebskostenverteilung.'
    );
  }
  if (!d.einheit.raumaufstellung?.trim()) {
    blocker(
      'einheit.raumaufstellung',
      'Die Raumaufstellung fehlt.',
      'Räume auflisten, z. B. „3,5 Zimmer, 1 Küche, 1 Bad, 1 Gäste-WC".'
    );
  }

  // ─── Laufzeit ───────────────────────────────────────────────────────────
  if (!d.mietbeginn) {
    blocker('mietbeginn', 'Kein Mietbeginn hinterlegt.', 'Mietbeginn erfassen.');
  }
  if (d.vertragsende && !d.befristungsgrund) {
    blocker(
      'befristungsgrund',
      'Der Vertrag ist befristet, aber es fehlt der Befristungsgrund.',
      'Befristungsgrund wählen — ohne ihn gilt der Vertrag nach § 575 Abs. 1 S. 2 BGB als unbefristet.'
    );
  }
  if (d.vertragsende && d.mietbeginn && d.vertragsende <= d.mietbeginn) {
    blocker('vertragsende', 'Das Vertragsende liegt vor dem Mietbeginn.', 'Daten korrigieren.');
  }

  // ─── Miete und Nebenkosten ──────────────────────────────────────────────
  if (!d.kaltmiete || d.kaltmiete <= 0) {
    blocker('kaltmiete', 'Keine Kaltmiete hinterlegt.', 'Nettokaltmiete erfassen.');
  }
  if (d.betriebskostenModus === 'vorauszahlung' && d.betriebskostenVorauszahlung <= 0) {
    blocker(
      'betriebskostenVorauszahlung',
      'Es ist eine Vorauszahlung vereinbart, aber der Betrag ist 0,00 €.',
      'Betrag erfassen oder den Modus auf „Inklusivmiete" umstellen.'
    );
  }
  if (d.betriebskostenModus !== 'inklusiv' && !d.betriebskostenPositionen.some(p => p.umgelegt)) {
    blocker(
      'betriebskostenPositionen',
      'Es ist keine einzige Betriebskostenart zur Umlage ausgewählt.',
      'Umzulegende Positionen auswählen — ohne Benennung sind sie nach § 556 Abs. 1 BGB nicht umlagefähig.'
    );
  }
  // Die Kostenspalte muss aufgehen. Ein Vertrag, dessen Einzelbeträge eine
  // andere Summe ergeben als die vereinbarte Vorauszahlung, ist in sich
  // widersprüchlich — welcher der beiden Beträge gilt, müsste ein Gericht
  // klären. Lieber kein PDF als eines mit zwei Wahrheiten.
  if (d.betriebskostenModus !== 'inklusiv') {
    const mitBetrag = d.betriebskostenPositionen.filter(p => p.umgelegt && p.betrag !== null);
    if (mitBetrag.length > 0) {
      const summe = mitBetrag.reduce((s, p) => s + (p.betrag ?? 0), 0);
      // Centgenau vergleichen, Rundungsrauschen aus Gleitkomma ignorieren.
      if (Math.round(summe * 100) !== Math.round(d.betriebskostenVorauszahlung * 100)) {
        blocker(
          'betriebskostenPositionen',
          `Die Einzelbeträge der Betriebskosten ergeben ${summe.toFixed(2).replace('.', ',')} €, vereinbart sind aber ${d.betriebskostenVorauszahlung.toFixed(2).replace('.', ',')} €.`,
          'Einzelbeträge oder Gesamtvorauszahlung angleichen.'
        );
      }
      const ohneBetrag = d.betriebskostenPositionen.filter(p => p.umgelegt && p.betrag === null);
      if (ohneBetrag.length > 0) {
        warnung(
          'betriebskostenPositionen',
          `${ohneBetrag.length} umgelegte Position(en) haben keinen Betrag: ${ohneBetrag.map(p => p.nummer).join(', ')}.`,
          'Betrag ergänzen oder Position von der Umlage ausnehmen.'
        );
      }
    }
  }

  if (d.betriebskostenPositionen.some(p => p.umgelegt && p.schluessel === 'personen') && !d.anzahlPersonen) {
    blocker(
      'anzahlPersonen',
      'Eine Position wird nach Personen verteilt, aber die Personenzahl fehlt.',
      'Personenzahl am Mietvertrag erfassen. Sie darf nicht geschätzt werden.'
    );
  }

  // ─── Kaution ────────────────────────────────────────────────────────────
  if (d.kautionArt !== 'keine') {
    if (!d.kautionBetrag || d.kautionBetrag <= 0) {
      blocker('kautionBetrag', 'Kautionsart gewählt, aber kein Betrag hinterlegt.', 'Kautionsbetrag erfassen.');
    } else if (d.kaltmiete > 0 && d.kautionBetrag > d.kaltmiete * 3 + 0.01) {
      blocker(
        'kautionBetrag',
        `Die Kaution übersteigt drei Nettokaltmieten (zulässig wären ${(d.kaltmiete * 3).toFixed(2)} €).`,
        'Kaution auf höchstens drei Nettokaltmieten senken (§ 551 Abs. 1 BGB).'
      );
    }
    if (d.kautionArt === 'barkaution' && !d.vermieter.kautionIban) {
      warnung(
        'vermieter.kautionIban',
        'Es ist kein getrenntes Kautionskonto hinterlegt.',
        'Kautionskonto erfassen. Der Vertrag sagt sonst keine getrennte Anlage nach § 551 Abs. 3 BGB zu.'
      );
    }
  }

  // ─── Zahlungsverkehr ────────────────────────────────────────────────────
  if (!d.vermieter.mietIban) {
    blocker(
      'vermieter.mietIban',
      'Es ist kein Konto hinterlegt, auf das die Miete gezahlt werden soll.',
      'IBAN des Mietkontos erfassen.'
    );
  } else if (!istIbanGueltig(d.vermieter.mietIban)) {
    blocker(
      'vermieter.mietIban',
      'Die IBAN des Mietkontos hat eine ungültige Prüfziffer.',
      'IBAN korrigieren — Überweisungen dorthin würden von der Bank abgelehnt.'
    );
  }
  if (d.vermieter.kautionIban && !istIbanGueltig(d.vermieter.kautionIban)) {
    blocker(
      'vermieter.kautionIban',
      'Die IBAN des Kautionskontos hat eine ungültige Prüfziffer.',
      'IBAN korrigieren.'
    );
  }
  if (d.lastschrift) {
    if (!d.lastschriftIban) {
      blocker('lastschriftIban', 'Lastschrift vereinbart, aber keine Mieter-IBAN hinterlegt.', 'IBAN erfassen.');
    } else if (!istIbanGueltig(d.lastschriftIban)) {
      blocker('lastschriftIban', 'Die IBAN des Mieters hat eine ungültige Prüfziffer.', 'IBAN korrigieren.');
    }
    if (!d.lastschriftKontoinhaber?.trim()) {
      warnung(
        'lastschriftKontoinhaber',
        'Kein Kontoinhaber für die Lastschrift hinterlegt.',
        'Kontoinhaber erfassen — er kann vom Mieter abweichen.'
      );
    }
  }

  // ─── Zustand und Klauseln ───────────────────────────────────────────────
  if (!d.uebergabezustand) {
    blocker(
      'uebergabezustand',
      'Der Übergabezustand ist nicht erfasst.',
      'Zustand wählen — er entscheidet, ob eine Schönheitsreparaturklausel überhaupt zulässig ist.'
    );
  }
  if (d.schoenheitsreparaturen && d.uebergabezustand !== 'renoviert') {
    blocker(
      'schoenheitsreparaturen',
      'Schönheitsreparaturen sollen übertragen werden, obwohl die Wohnung nicht renoviert übergeben wird.',
      'Übertragung abwählen. Bei unrenovierter Übergabe ist die Klausel nach BGH VIII ZR 185/14 insgesamt unwirksam.'
    );
  }
  if (d.kleinreparaturEinzelgrenze > 120) {
    warnung(
      'kleinreparaturEinzelgrenze',
      `Die Einzelgrenze für Kleinreparaturen liegt bei ${d.kleinreparaturEinzelgrenze.toFixed(2)} €.`,
      'Auf höchstens 120 € senken. Darüber droht die Klausel insgesamt zu kippen — dann trägt der Vermieter alle Kosten.'
    );
  }

  // ─── Mietanpassung ──────────────────────────────────────────────────────
  if (d.mietanpassungArt === 'staffel') {
    if (!d.staffelplan || d.staffelplan.length === 0) {
      blocker('staffelplan', 'Staffelmiete gewählt, aber kein Staffelplan hinterlegt.', 'Staffelstufen erfassen.');
    } else {
      const sortiert = [...d.staffelplan].sort((a, b2) => a.gueltigAb.localeCompare(b2.gueltigAb));
      let vorher = d.mietbeginn;
      for (const stufe of sortiert) {
        if (monateZwischen(vorher, stufe.gueltigAb) < 12) {
          blocker(
            'staffelplan',
            `Die Staffelstufe zum ${stufe.gueltigAb} liegt weniger als 12 Monate nach der vorherigen.`,
            'Abstand auf mindestens ein Jahr erhöhen (§ 557a Abs. 2 BGB).'
          );
        }
        vorher = stufe.gueltigAb;
      }
    }
  }
  if (d.mietanpassungArt === 'index' && (!d.indexBasisWert || !d.indexBasisMonat)) {
    blocker(
      'indexBasisWert',
      'Indexmiete gewählt, aber Ausgangsindexstand oder Basismonat fehlen.',
      'Indexstand aus den Marktdaten übernehmen — ohne ihn ist die Klausel nicht bestimmt genug.'
    );
  }

  // ─── Mietpreisbremse ────────────────────────────────────────────────────
  if (d.objekt.istAngespannt && d.vertragsart === 'wohnraum') {
    if (!d.mietpreisbremseAuskunftAm) {
      blocker(
        'mietpreisbremseAuskunftAm',
        `Das Objekt liegt in ${d.objekt.ort} — einem Gebiet mit angespanntem Wohnungsmarkt. Die Auskunft nach § 556g Abs. 1a BGB ist noch nicht dokumentiert.`,
        'Auskunft in Textform vor Vertragsschluss erteilen und das Datum erfassen. Ohne sie kann der Mieter 30 Monate lang rügen und die Überzahlung ab Mietbeginn zurückfordern.'
      );
    }
    warnung(
      'mietpreisbremse',
      `${d.objekt.ort} unterliegt der Mietpreisbremse: Die Miete darf die ortsübliche Vergleichsmiete um höchstens 10 % übersteigen.`,
      'Vergleichsmiete prüfen oder eine Ausnahme nach §§ 556e, 556f BGB belegen.'
    );
  }

  // ─── Energieausweis ─────────────────────────────────────────────────────
  if (d.vertragsart === 'wohnraum' && !d.objekt.energieausweisTyp) {
    warnung(
      'objekt.energieausweis',
      'Für das Objekt ist kein Energieausweis hinterlegt.',
      'Energieausweis erfassen und dem Mieter spätestens bei Vertragsabschluss vorlegen (§ 80 Abs. 4 GEG). Verstoß: Bußgeld bis 10.000 €.'
    );
  } else if (d.objekt.energieausweisGueltigBis && d.objekt.energieausweisGueltigBis < heute()) {
    warnung(
      'objekt.energieausweisGueltigBis',
      'Der hinterlegte Energieausweis ist abgelaufen.',
      'Neuen Energieausweis ausstellen lassen.'
    );
  }

  return b;
}

export function hatBlocker(befunde: Befund[]): boolean {
  return befunde.some(f => f.schwere === 'blocker');
}

function heute(): string {
  return new Date().toISOString().slice(0, 10);
}

function monateZwischen(von: string, bis: string): number {
  if (!von || !bis) return 0;
  const a = new Date(`${von}T12:00:00`);
  const b = new Date(`${bis}T12:00:00`);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}
