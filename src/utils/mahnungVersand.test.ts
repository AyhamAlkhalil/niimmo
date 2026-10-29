import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  angeboteneVormerkung,
  berlinerKalendertag,
  betraegeDesSchreibens,
  istAblehnung,
  unklarerVersand,
  vorgemerkteKuendigungFehler,
  fristVorgaben,
  postversandFehler,
  sendungsnummerFehler,
  tagPlus,
  tageZwischen,
  versandStandAusVormerkung,
  versandZeileText,
  vorgabeVersandart,
  zugangBeiPost,
  type MahnungVormerkung,
} from './mahnungVersand';
import { empfaengerDerAuswahl, mailadressenDerMieter, vorausgewaehlteEmpfaenger } from './kuendigungsbestaetigung';

/**
 * 28.10.2026: Die Mahnstufe stieg nur durch Mailversand; 34 von 98 laufenden Verträgen haben keine
 * Mailadresse, Stufe 3 war für sie unerreichbar. Jetzt: Vormerken beim Speichern, Versand per Mail
 * oder Buchung „per Post versandt“ (auch später). Diese Datei prüft die Regeln der Oberfläche;
 * dieselben Regeln in send-mahnung prüft sendMahnung.test.ts.
 */
describe('Zugang und Fristen beim Postversand', () => {
  it('rechnet den Zugang drei Kalendertage nach der Aufgabe, auch über Monats-, Jahres- und Zeitwechsel', () => {
    expect(zugangBeiPost('2026-10-28')).toBe('2026-10-31');
    expect(zugangBeiPost('2026-12-30')).toBe('2027-01-02');
    expect(zugangBeiPost('2026-03-27')).toBe('2026-03-30'); // Sommerzeit ab 29.03.2026
    expect(zugangBeiPost('2026-10-24')).toBe('2026-10-27'); // Winterzeit ab 25.10.2026
    expect(tagPlus('2028-02-27', 2)).toBe('2028-02-29');
    expect(tageZwischen('2026-10-31', '2026-11-07')).toBe(7);
    expect(tageZwischen('2026-03-28', '2026-03-31')).toBe(3);
    expect(tageZwischen('2026-11-07', '2026-10-31')).toBe(-7);
  });

  it('gibt ohne Mailadresse die Post vor und rechnet dann die Postlaufzeit in die Fristen ein', () => {
    expect(vorgabeVersandart([])).toBe('post');
    expect(vorgabeVersandart(['a@b.de'])).toBe('email');
    expect(fristVorgaben('email')).toEqual({ zahlungsfristTage: '7', raeumungsfristTage: '14' });
    expect(fristVorgaben('post')).toEqual({ zahlungsfristTage: '10', raeumungsfristTage: '17' });
  });

  it('lässt die Buchung nur zu, wenn Aufgabetag und Fristen zusammenpassen', () => {
    const basis = { aufgabeIso: '2026-10-28', schreibtagIso: '2026-10-28', heuteIso: '2026-10-28', fristIso: '2026-11-07' };
    expect(postversandFehler(basis)).toBeNull();
    // Frist genau am Zugangstag ist noch zulässig
    expect(postversandFehler({ ...basis, fristIso: '2026-10-31' })).toBeNull();
    expect(postversandFehler({ ...basis, fristIso: '2026-10-30' })).toMatch(/vor dem Zugang am 31\.10\.2026/);
    expect(postversandFehler({ ...basis, aufgabeIso: '2026-10-29' })).toMatch(/Zukunft/);
    expect(postversandFehler({ ...basis, aufgabeIso: '2026-10-27' })).toMatch(/vom 28\.10\.2026/);
    expect(postversandFehler({ ...basis, aufgabeIso: '' })).toMatch(/angeben/);
    expect(postversandFehler({ ...basis, raeumungsendeIso: '2026-10-30' })).toMatch(/Räumungsende/);
    expect(postversandFehler({ ...basis, raeumungsendeIso: '2026-11-11' })).toBeNull();
    // Nachträglich gebucht: Aufgabe am Speichertag, heute zwei Tage später
    expect(postversandFehler({ ...basis, heuteIso: '2026-10-30' })).toBeNull();
  });

  it('nimmt eine Sendungsnummer nur mit unverfänglichen Zeichen an', () => {
    expect(sendungsnummerFehler('')).toBeNull();
    expect(sendungsnummerFehler('  RR 1234 5678 9DE ')).toBeNull();
    expect(sendungsnummerFehler('A-1.2')).toBeNull();
    expect(sendungsnummerFehler('x;drop')).not.toBeNull();
    expect(sendungsnummerFehler('<b>')).not.toBeNull();
    expect(sendungsnummerFehler('A'.repeat(65))).not.toBeNull();
  });
});

describe('Offene Vormerkung beim Öffnen des Dialogs', () => {
  const zeile = (teil: Partial<MahnungVormerkung>): MahnungVormerkung => ({
    id: 'v1',
    stufe: 2,
    dokument_pfad: 'mahnungen/x/Mahnung_Stufe2_2026-10-26_100000.pdf',
    zahlungsfrist: '2026-11-02',
    kuendigung: null,
    betraege: { gesamtRueckstand: 1200, mahnkostenGesamt: 22, verzugszinsenGesamt: 3.5, zahlungsfristTage: 7 },
    erstellt_am: '2026-10-26T09:00:00+00:00',
    ...teil,
  });

  it('bietet die jüngste passende, nicht veraltete Vormerkung an, deren Schreiben noch unter Dokumente liegt', () => {
    const alt = zeile({ id: 'alt', erstellt_am: '2026-10-20T09:00:00+00:00', dokument_pfad: 'p/alt.pdf' });
    const neu = zeile({ id: 'neu', erstellt_am: '2026-10-27T09:00:00+00:00', dokument_pfad: 'p/neu.pdf' });
    const vorhanden = new Set(['p/alt.pdf', 'p/neu.pdf']);
    expect(angeboteneVormerkung([alt, neu], 2, '2026-10-28', vorhanden)?.id).toBe('neu');
    // Schreiben gelöscht: nicht anbieten
    expect(angeboteneVormerkung([alt, neu], 2, '2026-10-28', new Set(['p/alt.pdf']))?.id).toBe('alt');
    // Andere Stufe: nicht anbieten
    expect(angeboteneVormerkung([neu], 3, '2026-10-28', vorhanden)).toBeNull();
  });

  it('bietet veraltete Vormerkungen nicht an', () => {
    const v = zeile({ dokument_pfad: 'p.pdf' });
    expect(angeboteneVormerkung([v], 2, '2026-11-02', new Set(['p.pdf']))).not.toBeNull();
    expect(angeboteneVormerkung([v], 2, '2026-11-03', new Set(['p.pdf']))).toBeNull();
    // Stufe 3 braucht ein Räumungsende, das noch nicht vorbei ist
    const k = { status: 'gekuendigt' as const, kuendigungsdatum: '2026-11-09', ende_datum: '2026-11-09' };
    const s3 = zeile({ stufe: 3, dokument_pfad: 'p.pdf', zahlungsfrist: '2026-11-20', kuendigung: k });
    expect(angeboteneVormerkung([s3], 3, '2026-11-09', new Set(['p.pdf']))).not.toBeNull();
    expect(angeboteneVormerkung([s3], 3, '2026-11-10', new Set(['p.pdf']))).toBeNull();
    expect(angeboteneVormerkung([{ ...s3, kuendigung: null }], 3, '2026-10-28', new Set(['p.pdf']))).toBeNull();
  });

  it('bietet ein Schreiben nicht mehr an, wenn sich der Rückstand seither geändert hat (Prüfung 29.10.2026)', () => {
    const v = zeile({ dokument_pfad: 'p.pdf', betraege: { gesamtRueckstand: 1200 } });
    expect(angeboteneVormerkung([v], 2, '2026-10-28', new Set(['p.pdf']), 1200)).not.toBeNull();
    // Der Mieter hat 600 € gezahlt: Das alte Schreiben über 1.200 € ginge sonst unverändert hinaus
    expect(angeboteneVormerkung([v], 2, '2026-10-28', new Set(['p.pdf']), 600)).toBeNull();
    expect(angeboteneVormerkung([{ ...v, betraege: null }], 2, '2026-10-28', new Set(['p.pdf']), 1200)).toBeNull();
  });

  it('baut den Versandstand aus der Vormerkung (Tag des Schreibens in deutscher Zeit)', () => {
    const stand = versandStandAusVormerkung(zeile({ erstellt_am: '2026-10-27T23:30:00+00:00' }));
    expect(stand.pfad).toBe('mahnungen/x/Mahnung_Stufe2_2026-10-26_100000.pdf');
    expect(stand.fristIso).toBe('2026-11-02');
    expect(stand.kuendigung).toBeNull();
    expect(stand.daten).toEqual({
      gesamtRueckstand: 1200,
      mahnkostenGesamt: 22,
      verzugszinsenGesamt: 3.5,
      zahlungsfristTage: 7,
      datum: '28.10.2026',
      zahlungsfristDatum: '02.11.2026',
    });
    expect(versandStandAusVormerkung(zeile({ betraege: null })).daten.gesamtRueckstand).toBe(0);
  });

  it('übergibt die Beträge des Schreibens an die Vormerkung und beschreibt den letzten Versand', () => {
    expect(betraegeDesSchreibens({ gesamtRueckstand: 5, mahnkostenGesamt: 11, verzugszinsenGesamt: 0, datum: '', zahlungsfristDatum: '' }))
      .toEqual({ gesamtRueckstand: 5, mahnkostenGesamt: 11, verzugszinsenGesamt: 0, zahlungsfristTage: 7 });
    expect(versandZeileText({ stufe: 2, versandart: 'post', versendet_am: '2026-10-28', erstellt_von: null })).toBe('Stufe 2 · per Post am 28.10.2026');
    expect(versandZeileText({ stufe: 1, versandart: 'email', versendet_am: '2026-10-01', erstellt_von: null })).toBe('Stufe 1 · per E-Mail am 01.10.2026');
  });
});

describe('Empfänger im Mailweg wie in der Kündigungsbestätigung', () => {
  it('zerlegt die Adressen und wählt die Hauptadressen vor — nie der rohe hauptmail-Text', () => {
    const mieter = [{ hauptmail: 'A@x.de, b@y.de', weitere_mails: 'c@z.de' }, { hauptmail: 'Max <m@n.de>', weitere_mails: null }];
    expect(mailadressenDerMieter(mieter)).toEqual(['a@x.de', 'b@y.de', 'c@z.de', 'm@n.de']);
    expect(vorausgewaehlteEmpfaenger(mieter)).toEqual(['a@x.de', 'b@y.de', 'm@n.de']);
    // Ein Eintrag, der nicht in der Liste steht, wird nicht versendet
    expect(empfaengerDerAuswahl(['a@x.de', 'A@x.de, b@y.de'], mailadressenDerMieter(mieter))).toEqual(['a@x.de']);
    expect(mailadressenDerMieter([{ hauptmail: null, weitere_mails: null }])).toEqual([]);
  });

  const modal = readFileSync('src/components/dashboard/MahnungErstellungModal.tsx', 'utf-8');

  it('der Dialog belegt die Auswahl über vorausgewaehlteEmpfaenger vor und sendet nur die Auswahl', () => {
    expect(modal).toContain('setAusgewaehlt(vorausgewaehlteEmpfaenger(contractData.mieter ?? []));');
    expect(modal).toContain('const versandEmpfaenger = useMemo(() => empfaengerDerAuswahl(ausgewaehlt, adressen), [ausgewaehlt, adressen]);');
    expect(modal).toContain('recipientEmails: versandEmpfaenger,');
    expect(modal).not.toMatch(/recipientEmail:/);
    expect(modal).not.toContain('firstMieter?.hauptmail');
  });
});

describe('Mahnungsdialog: Vormerken und Postversand', () => {
  const modal = readFileSync('src/components/dashboard/MahnungErstellungModal.tsx', 'utf-8');
  const speichern = modal.slice(modal.indexOf('const handleSaveAndUpload'), modal.indexOf('const handleDownload'));
  const post = modal.slice(modal.indexOf('const handlePostBuchen'), modal.indexOf('// Nur der Rückstand zählt: hinge die Rechnung'));

  it('merkt das Schreiben beim Speichern vor und entfernt es wieder, wenn das scheitert', () => {
    const vormerken = speichern.indexOf("versandart: 'vormerken'");
    expect(vormerken).toBeGreaterThan(speichern.indexOf(".from('dokumente').insert("));
    expect(vormerken).toBeLessThan(speichern.indexOf('setGespeichert({ pfad: filePath, daten, fristIso, kuendigung });'));
    expect(speichern).toMatch(/if \(vormerkFehler\) \{[\s\S]{0,300}\.from\('dokumente'\)\.delete\(\)\.eq\('id', dokument\.id\)[\s\S]{0,250}\.remove\(\[filePath\]\)/);
    // Ergebnisse des Aufräumens werden geprüft und gemeldet (Review 28.10.2026)
    expect(speichern).toContain('const { error: loeschFehler } = await supabase.from(\'dokumente\').delete().eq(\'id\', dokument.id);');
    expect(speichern).toMatch(/entfernFehler \|\| !entfernt \|\| entfernt\.length === 0/);
    // Ohne eindeutige Ablehnung einmal wiederholen (Vormerken ist idempotent), erst danach aufräumen
    const wiederholung = speichern.indexOf('if (vormerkFehler && !istAblehnung(vormerkFehler)) {');
    expect(wiederholung).toBeGreaterThan(0);
    expect(wiederholung).toBeLessThan(speichern.indexOf(".from('dokumente').delete()"));
    expect(speichern).toContain('betraege: betraegeDesSchreibens(daten),');
  });

  it('bucht den Postversand nur über send-mahnung und setzt nie selbst den Vertragsstatus', () => {
    expect(post).toContain("versandart: 'post',");
    expect(post).toContain('versendetAm: aufgabeAm,');
    expect(post).toContain('pdfPath: stand.pfad,');
    expect(post).not.toContain(".from('mietvertrag')");
    expect(post).toMatch(/const fehler = postFehler \?\? nummerFehler;\s*if \(fehler\)/);
  });

  it('bietet eine offene Vormerkung an und daneben ein neues Schreiben', () => {
    expect(modal).toContain('angeboteneVormerkung(liste, mahnstufe, berlinerKalendertag(), vorhanden, rueckstand)');
    expect(modal).toContain('Jetzt versenden (E-Mail oder Post)');
    expect(modal).toContain('Neues Schreiben erstellen');
    expect(modal).toContain('setGespeichert(versandStandAusVormerkung(angebot));');
  });

  it('setzt die Fristvorgaben ohne Mailadresse auf die Post', () => {
    expect(modal).toContain('setZahlungsfristTage(fristVorgaben(vorgabe).zahlungsfristTage);');
    expect(modal).toContain('setRaeumungsfristTage(fristVorgaben(vorgabe).raeumungsfristTage);');
  });
});

describe('Review 28.10.2026: Berliner Kalendertag, unklarer Versand, Ablehnung', () => {
  it('rechnet Kalendertage in Berlin, unabhängig von der Zeitzone des Rechners', () => {
    expect(berlinerKalendertag(new Date('2026-10-27T23:30:00Z'))).toBe('2026-10-28');
    expect(berlinerKalendertag(new Date('2026-07-31T21:59:00Z'))).toBe('2026-07-31');
    expect(berlinerKalendertag(new Date('2026-07-31T22:00:00Z'))).toBe('2026-08-01');
    expect(berlinerKalendertag(new Date('2026-03-29T00:59:00Z'))).toBe('2026-03-29');
  });

  it('der Dialog nutzt für Heute, Schreibtag und Aufgabedatum den Berliner Kalendertag', () => {
    const modal = readFileSync('src/components/dashboard/MahnungErstellungModal.tsx', 'utf-8');
    expect(modal).not.toContain('alsIsoTag(');
    expect(modal).toContain('const heuteIso = berlinerKalendertag();');
    expect(modal).toContain('setSchreibtag(berlinerKalendertag(new Date(angebot.erstellt_am)));');
    expect(modal).toContain('const schreibtagIso = gespeichert ? schreibtag : heuteIso;');
    expect(modal).toMatch(/min=\{schreibtagIso\}\s*max=\{heuteIso\}/);
  });

  it('bietet eine Stufe-3-Vormerkung an späteren Tagen weiter an, solange das Räumungsende nicht vorbei ist', () => {
    const k = { status: 'gekuendigt' as const, kuendigungsdatum: '2026-11-11', ende_datum: '2026-11-11' };
    expect(vorgemerkteKuendigungFehler(k, '2026-10-31')).toBeNull();
    expect(vorgemerkteKuendigungFehler(k, '2026-10-31', '2026-11-03')).toBeNull();
    expect(vorgemerkteKuendigungFehler(k, '2026-11-12')).not.toBeNull();
    expect(vorgemerkteKuendigungFehler(k, '2026-11-09', '2026-11-12')).toMatch(/Zugang/);
    expect(vorgemerkteKuendigungFehler({ ...k, kuendigungsdatum: '2026-10-28' }, '2026-10-31')).toMatch(/Vergangenheit/);
    expect(vorgemerkteKuendigungFehler(null, '2026-10-31')).not.toBeNull();
  });

  it('zeigt einen beanspruchten Versand als unklar und lässt ihn erst nach 15 Minuten klären', () => {
    const zeile = { id: 'u', stufe: 2, dokument_pfad: 'p.pdf', versandart: 'email' as const, erstellt_am: '2026-10-28T09:00:00Z', aktualisiert_am: '2026-10-28T10:00:00Z' };
    expect(unklarerVersand([])).toBeNull();
    const frueh = unklarerVersand([zeile], new Date('2026-10-28T10:14:00Z'));
    expect(frueh?.klaerbar).toBe(false);
    expect(frueh?.klaerbarAb.toISOString()).toBe('2026-10-28T10:15:00.000Z');
    expect(unklarerVersand([zeile], new Date('2026-10-28T10:15:00Z'))?.klaerbar).toBe(true);
    const neuer = { ...zeile, id: 'n', aktualisiert_am: '2026-10-28T11:00:00Z' };
    expect(unklarerVersand([zeile, neuer], new Date('2026-10-28T12:00:00Z'))?.zeile.id).toBe('n');
  });

  it('wiederholt das Vormerken nur ohne eindeutige Ablehnung', () => {
    expect(istAblehnung({ context: new Response('{}', { status: 409 }) })).toBe(true);
    expect(istAblehnung({ context: new Response('{}', { status: 400 }) })).toBe(true);
    expect(istAblehnung({ context: new Response('{}', { status: 500 }) })).toBe(false);
    expect(istAblehnung(new Error('Netzwerk'))).toBe(false);
    expect(istAblehnung(null)).toBe(false);
  });

  it('der Dialog bietet einen unklaren Versand nicht erneut an, sondern lässt ihn klären', () => {
    const modal = readFileSync('src/components/dashboard/MahnungErstellungModal.tsx', 'utf-8');
    expect(modal).toContain(".eq('status', 'wird_versendet')");
    expect(modal).toMatch(/versandart: 'freigeben',\s*mietvertragId: contractData\.mietvertrag_id,\s*pdfPath: unklar\.zeile\.dokument_pfad,/);
    expect(modal).toContain('disabled={!unklar.klaerbar || klaertGerade}');
    expect(modal).toContain("'Als nicht versendet freigeben'");
    // Mail ohne Beleg: erst der Bestätigungsdialog setzt bestaetigtNichtVersendet (Review 28.10.2026)
    expect(modal).toContain("bestaetigtNichtVersendet: bestaetigung === 'nicht_versendet' || undefined,");
    expect(modal).toContain("bestaetigtVersendet: bestaetigung === 'versendet' || undefined,");
    expect(modal).toContain("onClick={() => (unklar.zeile.versandart === 'email' ? setShowConfirmFreigabe(true) : versandKlaeren(null))}");
    expect(modal).toMatch(/<AlertDialogAction onClick=\{\(\) => versandKlaeren\('nicht_versendet'\)\}[^>]*>\s*Ich habe im Postausgang geprüft: nicht versendet/);
    expect(modal).toMatch(/<AlertDialogAction onClick=\{\(\) => versandKlaeren\('versendet'\)\}[^>]*>\s*Ich habe im Postausgang geprüft: die Mail ist versendet worden/);
    // Jede Bestätigung nur aus ihrem eigenen Dialog
    expect(modal.match(/versandKlaeren\('nicht_versendet'\)/g)).toHaveLength(1);
    expect(modal.match(/versandKlaeren\('versendet'\)/g)).toHaveLength(1);
    expect(modal).toContain('onClick={() => setShowConfirmVersendet(true)}');
    // Solange unklar: kein neues Schreiben, kein Angebot
    expect(modal).toContain('anzahlUngueltig || !vorschauAktuell || unklar !== null || !unklarGeprueft;');
    // Fehler der Abfrage sichtbar, Speichern bis zur erfolgreichen Prüfung gesperrt (Review 28.10.2026)
    expect(modal).toContain('isError: unklarFehler, isSuccess: unklarGeprueft } = useQuery({');
    expect(modal).toMatch(/\{unklarFehler && \(\s*<p className="text-xs text-destructive" role="alert">/);
    expect(modal).toContain('{angebot && !angebotVerworfen && !unklar && (');
    // Angeboten werden nur Zeilen in 'vorgemerkt'
    expect(modal).toMatch(/\.eq\('status', 'vorgemerkt'\)\s*\.eq\('stufe', mahnstufe\)/);
  });
});
