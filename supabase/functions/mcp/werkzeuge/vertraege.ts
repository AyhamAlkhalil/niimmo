// MCP-Werkzeuge für Vertragsänderungen, Kündigung, Mahnstufe, Mieterhöhung und die Vorgänge am Vertrag (16.11.2026).
// Was in der App nur zusammen mit einem Schriftstück entsteht (Kündigung durch den Vermieter, Mieterhöhungsverlangen,
// Mahnung), bleibt in der App: Die PDF-Generatoren laufen im Browser (docs/architektur.md §6).

import { uebernahmeMeldung, vereinbarungVerlangtAmTag } from '../../_shared/mieterhoehung.ts';
import { getVertragsende } from '../../_shared/mietkonto.ts';
import { ANZAHL, BETRAG, DATUM_FELD, ID, objekt, TEXT } from '../eingabe.ts';
import {
  aendereZeile,
  cent,
  ergebnis,
  Fachfehler,
  genauEine,
  type Kontext,
  NUR_ADMIN,
  schreibfehler,
  type Werkzeug,
} from '../werkzeug.ts';

// ---------- reine Fachlogik (Vitest) ----------

/** Monatserster JJJJ-MM-01, der vom laufenden Monat bis höchstens zwölf Monate danach liegt (Vertragsbearbeitung) */
export function giltAbErlaubt(giltAb: string, heute: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(giltAb)) return false;
  const monate = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
  const abstand = monate(giltAb) - monate(heute);
  return abstand >= 0 && abstand <= 12;
}

export interface VertragsAenderung {
  betriebskosten?: number | null;
  kaltmiete?: number | null;
  kaltmiete_ist_korrektur?: boolean | null;
  korrektur_begruendung?: string | null;
  anzahl_personen?: number | null;
  kaution_soll?: number | null;
  kaution_ist_grundwert?: number | null;
  ruecklastschrift_gebuehr?: number | null;
}

/**
 * Spalten für die Vertragsbearbeitung — eine feste Erlaubnisliste. Die RPC mietvertrag_speichern nähme jede Spalte;
 * der MCP-Server schreibt nur, was die App in der Vertragsbearbeitung ohne Schriftstück ändert. Eine höhere Kaltmiete
 * ist ein Vorgang (mieterhoehung_vereinbaren); nur eine ausdrücklich als Korrektur bezeichnete und begründete Änderung
 * geht direkt — wie die Rückfrage „Korrektur oder Erhöhung?“ der App (MietaenderungBestaetigung). Bei Staffelmiete setzt
 * der Nachtlauf die Kaltmiete nach dem Plan; dort ändert sie nur die App. null gilt überall als „nicht angegeben“.
 */
export function vertragsFelder(
  a: VertragsAenderung,
  alt: { kaltmiete: number | null; mietanpassung_art?: string | null },
): Record<string, number> {
  const felder: Record<string, number> = {};
  const alteKaltmiete = Number(alt.kaltmiete) || 0;
  if (a.kaltmiete != null) {
    if (alt.mietanpassung_art === 'staffel') {
      throw new Fachfehler('Der Vertrag hat eine Staffelmiete; die Kaltmiete folgt dem Staffelplan und lässt sich nur in der App ändern.');
    }
    if (a.kaltmiete > alteKaltmiete) {
      if (!a.kaltmiete_ist_korrektur) {
        throw new Fachfehler(
          'Eine höhere Kaltmiete ist eine Mieterhöhung — dafür mieterhoehung_vereinbaren nutzen. Nur wenn ein Erfassungsfehler ' +
            'berichtigt wird, kaltmiete_ist_korrektur=true und korrektur_begruendung angeben.',
        );
      }
      if ((a.korrektur_begruendung ?? '').trim().length < 10) {
        throw new Fachfehler('Für eine Korrektur nach oben ist korrektur_begruendung nötig (mindestens zehn Zeichen).');
      }
    }
    felder.kaltmiete = cent(a.kaltmiete);
  }
  if (a.betriebskosten != null) felder.betriebskosten = cent(a.betriebskosten);
  if (a.anzahl_personen != null) felder.anzahl_personen = a.anzahl_personen;
  // Die App schreibt das Soll in kaution_betrag und das Ist als Grundwert; kaution_ist leitet ein Trigger ab
  // (Grundwert + Zahlungen der Kategorie Mietkaution), useMietvertragMutations.ts:367
  if (a.kaution_soll != null) felder.kaution_betrag = cent(a.kaution_soll);
  if (a.kaution_ist_grundwert != null) felder.kaution_ist_grundwert = cent(a.kaution_ist_grundwert);
  if (a.ruecklastschrift_gebuehr != null) felder.ruecklastschrift_gebuehr = cent(a.ruecklastschrift_gebuehr);
  if (Object.keys(felder).length === 0) throw new Fachfehler('Keine Änderung angegeben.');
  for (const [name, wert] of Object.entries(felder)) {
    if (!Number.isFinite(wert) || wert < 0) throw new Fachfehler(`${name} darf nicht negativ sein.`);
  }
  return felder;
}

/** Spätestes Mietende, das eine Kündigung nennen darf: fünf Jahre voraus (Tippfehlerschutz, z. B. 2062 statt 2026) */
export function mietendePlausibel(ende: string, heute: string): boolean {
  return ende <= `${Number(heute.slice(0, 4)) + 5}${heute.slice(4)}`;
}

// ---------- Werkzeuge ----------

const mietvertragAendern: Werkzeug = {
  name: 'mietvertrag_aendern',
  titel: 'Mietvertrag ändern',
  beschreibung:
    'Ändert Betriebskosten-Vorauszahlung, Personenzahl, Kaution (Soll; Ist als Grundwert ohne gebuchte Kautionszahlungen), ' +
    'Rücklastschriftgebühr oder — nur als Korrektur eines Erfassungsfehlers — die Kaltmiete. Die Datenbank passt die ' +
    'Monatsmieten ab dem laufenden Monat an. Eine Mieterhöhung läuft über mieterhoehung_vereinbaren, das Mietende über ' +
    'kuendigung_erfassen; Beginn, Status und Bankdaten ändert nur die App.',
  eingabe: objekt({
    mietvertrag_id: ID('ID des Mietvertrags'),
    betriebskosten: BETRAG('Neue Betriebskosten-Vorauszahlung je Monat (inkl. Heizkosten)'),
    kaltmiete: BETRAG('Neue Kaltmiete — nur zur Korrektur'),
    kaltmiete_ist_korrektur: { type: 'boolean', description: 'true, wenn eine höhere Kaltmiete einen Erfassungsfehler berichtigt' },
    korrektur_begruendung: TEXT('Pflicht bei einer Korrektur nach oben: welcher Erfassungsfehler berichtigt wird', 500),
    anzahl_personen: { type: 'integer', minimum: 1, maximum: 30, description: 'Personen im Haushalt' },
    kaution_soll: BETRAG('Vereinbarte Kaution in Euro'),
    kaution_ist_grundwert: BETRAG('Bar oder außerhalb des Kontos erhaltene Kaution; gebuchte Kautionszahlungen kommen automatisch hinzu'),
    ruecklastschrift_gebuehr: BETRAG('Gebühr je Rücklastschrift'),
  }, ['mietvertrag_id']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const v = genauEine<Record<string, number | string | null> & { id: string; kaltmiete: number | null; mietanpassung_art: string | null }>(
      await ctx.db.from('mietvertrag')
        .select('id, kaltmiete, betriebskosten, anzahl_personen, kaution_betrag, kaution_ist_grundwert, ruecklastschrift_gebuehr, mietanpassung_art')
        .eq('id', e.mietvertrag_id).maybeSingle(),
      'Mietvertrag',
    );
    const felder = vertragsFelder(e as VertragsAenderung, v);
    // useMietvertragMutations.ts:86 (speichereVertrag): ohne Datumsänderung direktes Update
    await aendereZeile(ctx, 'mietvertrag', v.id, felder, 'Vertrag ändern');
    const vorher = Object.fromEntries(Object.keys(felder).map((k) => [k, v[k] ?? null]));
    if (e.korrektur_begruendung) vorher.korrektur_begruendung = e.korrektur_begruendung as string;
    return { ok: true, mietvertrag_id: v.id, geaendert: felder, vorher };
  },
};

const kuendigungErfassen: Werkzeug = {
  name: 'kuendigung_erfassen',
  titel: 'Kündigung des Mieters erfassen',
  beschreibung:
    'Erfasst eine eingegangene Kündigung: Der Vertrag steht danach auf „gekündigt“ mit dem angegebenen Mietende (liegt es ' +
    'in der Vergangenheit, auf „beendet“). Die Monatsmiete des letzten Monats wird anteilig. Kündigt der Vermieter, ' +
    'entsteht das Schreiben in der App.',
  eingabe: objekt({ mietvertrag_id: ID('ID des Mietvertrags'), mietende: DATUM_FELD('Letzter Tag des Mietverhältnisses') }, [
    'mietvertrag_id',
    'mietende',
  ]),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const v = genauEine<{ id: string; status: string; start_datum: string | null; ende_datum: string | null; kuendigungsdatum: string | null }>(
      await ctx.db.from('mietvertrag').select('id, status, start_datum, ende_datum, kuendigungsdatum').eq('id', e.mietvertrag_id).maybeSingle(),
      'Mietvertrag',
    );
    const ende = e.mietende as string;
    if (v.status === 'beendet') throw new Fachfehler('Der Vertrag ist schon beendet.');
    if (v.start_datum && ende < v.start_datum) throw new Fachfehler('Das Mietende liegt vor dem Mietbeginn.');
    if (!mietendePlausibel(ende, ctx.heute)) throw new Fachfehler('Das Mietende liegt mehr als fünf Jahre in der Zukunft — bitte prüfen.');
    // TerminationDialog.tsx:409 (handleUploadTermination): Kündigung des Mieters, ohne Schreiben
    const { data, error } = await ctx.db.from('mietvertrag')
      .update({ status: 'gekuendigt', kuendigungsdatum: ende, ende_datum: ende, aktualisiert_am: new Date().toISOString() })
      .eq('id', v.id)
      .select('id, status, ende_datum');
    if (error) throw schreibfehler(error, 'Kündigung erfassen');
    if (!data || data.length === 0) throw new Fachfehler('Kündigung erfassen: Vertrag nicht gefunden oder keine Berechtigung.');
    return { ok: true, mietvertrag_id: v.id, status: data[0].status, mietende: data[0].ende_datum, vorher: { status: v.status, ende: getVertragsende(v) } };
  },
};

const mahnstufeZuruecksetzen: Werkzeug = {
  name: 'mahnstufe_zuruecksetzen',
  titel: 'Mahnstufe zurücksetzen',
  beschreibung:
    'Senkt die Mahnstufe eines Vertrags (z. B. nach Ausgleich). Erhöhen ist nicht möglich: Die Mahnstufe steigt nur durch ' +
    'den Versand einer Mahnung in der App.',
  eingabe: objekt({
    mietvertrag_id: ID('ID des Mietvertrags'),
    stufe: { type: 'integer', minimum: 0, maximum: 2, description: 'Neue, niedrigere Mahnstufe (0 = keine)' },
  }, ['mietvertrag_id', 'stufe']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const v = genauEine<{ id: string; mahnstufe: number | null }>(
      await ctx.db.from('mietvertrag').select('id, mahnstufe').eq('id', e.mietvertrag_id).maybeSingle(),
      'Mietvertrag',
    );
    const aktuell = v.mahnstufe ?? 0;
    const stufe = e.stufe as number;
    if (stufe >= aktuell) throw new Fachfehler(`Die Mahnstufe steht auf ${aktuell} und kann nur gesenkt werden.`);
    // useMietvertragMutations.ts:174; der Trigger mahnstufe_nur_durch_versand sperrt jede Erhöhung
    await aendereZeile(ctx, 'mietvertrag', v.id, { mahnstufe: stufe }, 'Mahnstufe zurücksetzen');
    return { ok: true, mietvertrag_id: v.id, vorher: aktuell, mahnstufe: stufe };
  },
};

interface RpcFehler {
  message: string;
  code?: string;
  hint?: string | null;
}

function erhoehungsFehler(fehler: RpcFehler, was: string): Fachfehler {
  console.error(`[mcp] ${was}:`, fehler.code ?? '', fehler.hint ?? '', fehler.message);
  return new Fachfehler(uebernahmeMeldung(fehler.hint, `${was} ist fehlgeschlagen.`));
}

const mieterhoehungVereinbaren: Werkzeug = {
  name: 'mieterhoehung_vereinbaren',
  titel: 'Mieterhöhung vereinbaren',
  beschreibung:
    'Erfasst eine mit dem Mieter vereinbarte Mieterhöhung als Vorgang (§ 557 Abs. 1 BGB), wie die Vertragsbearbeitung der ' +
    'App: Gilt sie ab dem laufenden Monat, übernimmt die Datenbank Miete und schon angelegte Monatsmieten sofort; sonst ' +
    'stellt der Nachtlauf am Wirksamkeitstag um. Ein förmliches Erhöhungsverlangen mit Schreiben entsteht in der App.',
  eingabe: objekt({
    mietvertrag_id: ID('ID des Mietvertrags'),
    neue_kaltmiete: BETRAG('Neue Kaltmiete in Euro (höher als bisher)'),
    neue_betriebskosten: BETRAG('Neue Betriebskosten-Vorauszahlung; ohne Angabe unverändert'),
    gilt_ab: DATUM_FELD('Monatserster, ab dem die neue Miete gilt (laufender Monat bis zwölf Monate voraus)'),
  }, ['mietvertrag_id', 'neue_kaltmiete', 'gilt_ab']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const giltAb = e.gilt_ab as string;
    if (!giltAbErlaubt(giltAb, ctx.heute)) {
      throw new Fachfehler('gilt_ab muss ein Monatserster zwischen dem laufenden Monat und zwölf Monaten voraus sein.');
    }
    const v = genauEine<{ id: string; kaltmiete: number | null; betriebskosten: number | null }>(
      await ctx.db.from('mietvertrag').select('id, kaltmiete, betriebskosten').eq('id', e.mietvertrag_id).maybeSingle(),
      'Mietvertrag',
    );
    const alteKaltmiete = Number(v.kaltmiete) || 0;
    const alteBetriebskosten = Number(v.betriebskosten) || 0;
    const neueKaltmiete = cent(e.neue_kaltmiete as number);
    const neueBetriebskosten = e.neue_betriebskosten != null ? cent(e.neue_betriebskosten as number) : alteBetriebskosten;
    if (neueBetriebskosten < 0) throw new Fachfehler('Die Betriebskosten dürfen nicht negativ sein.');
    if (!(neueKaltmiete > alteKaltmiete)) {
      throw new Fachfehler('Die Kaltmiete sinkt oder bleibt gleich — das ist eine Korrektur (mietvertrag_aendern), keine Mieterhöhung.');
    }
    // utils/mieterhoehungVorgang.ts (mieterhoehungAlsVorgangAnlegen)
    const { data: vorgang, error } = await ctx.db.from('mieterhoehungen')
      .insert({
        mietvertrag_id: v.id,
        verlangt_am: vereinbarungVerlangtAmTag(giltAb, ctx.heute),
        wirksam_ab: giltAb,
        alte_kaltmiete: alteKaltmiete,
        alte_betriebskosten: alteBetriebskosten,
        neue_kaltmiete: neueKaltmiete,
        neue_betriebskosten: neueBetriebskosten,
        begruendungsart: 'vereinbarung',
        begruendung_text: 'Vereinbarte Mieterhöhung, erfasst über den MCP-Zugang',
        status: 'verlangt',
      })
      .select('id')
      .single();
    if (error || !vorgang) throw erhoehungsFehler(error ?? { message: 'kein Vorgang' }, 'Mieterhöhung anlegen');
    const { data: zustimmung, error: rpcFehler } = await ctx.db.rpc('mieterhoehung_zustimmen', { p_mieterhoehung_id: vorgang.id });
    if (rpcFehler) {
      // Ohne Zustimmung hätte der Vorgang keinen Sinn (schon vereinbart, Staffel/Index, Vertragsende vorher)
      const { data: weg, error: loeschFehler } = await ctx.db.from('mieterhoehungen').delete().eq('id', vorgang.id).select('id');
      if (loeschFehler || !weg || weg.length === 0) {
        console.error('[mcp] Vorgang nach gescheiterter Zustimmung nicht entfernt:', loeschFehler?.message ?? '0 Zeilen');
        throw new Fachfehler(
          'Die Mieterhöhung ließ sich nicht übernehmen, und der angelegte Vorgang konnte nicht zurückgenommen werden. ' +
            'Bitte in der App unter Mieterhöhung prüfen.',
        );
      }
      // Der Vorgang ist entfernt — „wird heute früh übernommen“ (NOCH_NICHT_WIRKSAM) stimmte dann nicht mehr
      if (rpcFehler.hint === 'NOCH_NICHT_WIRKSAM') {
        throw new Fachfehler('Die Erhöhung ließ sich gerade nicht übernehmen. Bitte in einigen Minuten erneut erfassen.');
      }
      throw erhoehungsFehler(rpcFehler, 'Mieterhöhung erfassen');
    }
    return {
      ok: true,
      mieterhoehung_id: vorgang.id,
      wirksam_ab: giltAb,
      sofort_uebernommen: zustimmung?.status === 'wirksam',
      nachberechnete_monate: zustimmung?.nachberechnete_monate ?? 0,
    };
  },
};

const zustimmungErfassen: Werkzeug = {
  name: 'mieterhoehung_zustimmung_erfassen',
  titel: 'Zustimmung zur Mieterhöhung erfassen',
  beschreibung:
    'Der Mieter hat einem offenen Erhöhungsverlangen zugestimmt. Ist der Wirksamkeitstag erreicht, übernimmt die Datenbank ' +
    'die Miete sofort. Hat sich die Miete seit dem Verlangen geändert, lehnt sie ab — dann nur nach Rückfrage beim Nutzer ' +
    'trotz_abweichung=true setzen.',
  eingabe: objekt({
    mieterhoehung_id: ID('ID des Vorgangs (aus mieterhoehungen_auflisten)'),
    trotz_abweichung: { type: 'boolean', description: 'Trotz geänderter Vertragsmiete übernehmen' },
  }, ['mieterhoehung_id']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const { data, error } = await ctx.db.rpc('mieterhoehung_zustimmen', {
      p_mieterhoehung_id: e.mieterhoehung_id,
      p_trotz_abweichung: Boolean(e.trotz_abweichung),
    });
    if (error) throw erhoehungsFehler(error, 'Zustimmung erfassen');
    return { ok: true, mieterhoehung_id: e.mieterhoehung_id, ...data };
  },
};

const zustimmungZuruecknehmen: Werkzeug = {
  name: 'mieterhoehung_zustimmung_zuruecknehmen',
  titel: 'Zustimmung zur Mieterhöhung zurücknehmen',
  beschreibung: 'Setzt einen zugestimmten, noch nicht wirksamen Vorgang zurück auf „verlangt“.',
  eingabe: objekt({ mieterhoehung_id: ID('ID des Vorgangs') }, ['mieterhoehung_id']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const { data, error } = await ctx.db.rpc('mieterhoehung_zustimmung_zuruecknehmen', { p_mieterhoehung_id: e.mieterhoehung_id });
    if (error) throw erhoehungsFehler(error, 'Zustimmung zurücknehmen');
    return { ok: true, mieterhoehung_id: e.mieterhoehung_id, ergebnis: data ?? null };
  },
};

// ---------- Lesen ----------

const mieterhoehungenAuflisten: Werkzeug = {
  name: 'mieterhoehungen_auflisten',
  titel: 'Mieterhöhungen auflisten',
  beschreibung: 'Vorgänge zur Mieterhöhung (verlangt, zugestimmt, wirksam, abgelehnt, zurückgezogen), neueste zuerst.',
  eingabe: objekt({
    mietvertrag_id: ID('Nur dieser Vertrag'),
    status: { type: 'string', enum: ['verlangt', 'zugestimmt', 'wirksam', 'abgelehnt', 'zurueckgezogen'], description: 'Nur dieser Status' },
  }),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(e, ctx) {
    let q = ctx.db.from('mieterhoehungen').select(
      'id, mietvertrag_id, status, verlangt_am, wirksam_ab, alte_kaltmiete, neue_kaltmiete, alte_betriebskosten, neue_betriebskosten, ' +
        'begruendungsart, zugestimmt_am, abgelehnt_am, bemerkung',
    );
    if (e.mietvertrag_id) q = q.eq('mietvertrag_id', e.mietvertrag_id);
    if (e.status) q = q.eq('status', e.status);
    return { vorgaenge: ergebnis(await q.order('erstellt_am', { ascending: false }).limit(200), 'Lesen: Mieterhöhungen') ?? [] };
  },
};

const mahnungenAuflisten: Werkzeug = {
  name: 'mahnungen_auflisten',
  titel: 'Mahnungen auflisten',
  beschreibung: 'Erstellte und versandte Mahnungen mit Stufe, Versandart, Zugang, Zahlungsfrist und Beträgen, neueste zuerst.',
  eingabe: objekt({ mietvertrag_id: ID('Nur dieser Vertrag'), anzahl: ANZAHL('Höchstens so viele (Standard 50)', 200) }),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(e, ctx: Kontext) {
    let q = ctx.db.from('mahnung_versand').select(
      'id, mietvertrag_id, stufe, status, versandart, versendet_am, zugang_am, zahlungsfrist, betraege, kuendigung, erstellt_am',
    );
    if (e.mietvertrag_id) q = q.eq('mietvertrag_id', e.mietvertrag_id);
    const zeilen = ergebnis(await q.order('erstellt_am', { ascending: false }).limit((e.anzahl as number | undefined) ?? 50), 'Lesen: Mahnungen');
    return { mahnungen: zeilen ?? [] };
  },
};

const abrechnungenAuflisten: Werkzeug = {
  name: 'nebenkostenabrechnungen_auflisten',
  titel: 'Betriebskostenabrechnungen auflisten',
  beschreibung: 'Erstellte Betriebskostenabrechnungen je Vertrag und Jahr mit Kosten, Vorauszahlungen, Saldo und Versand.',
  eingabe: objekt({
    mietvertrag_id: ID('Nur dieser Vertrag'),
    jahr: { type: 'integer', minimum: 2000, maximum: 2100, description: 'Abrechnungsjahr' },
  }),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(e, ctx) {
    let q = ctx.db.from('nebenkosten_abrechnungen').select(
      'id, mietvertrag_id, abrechnungsjahr, kosten_gesamt, vorauszahlungen, saldo, pdf_erstellt_am, versandt_am',
    );
    if (e.mietvertrag_id) q = q.eq('mietvertrag_id', e.mietvertrag_id);
    if (e.jahr) q = q.eq('abrechnungsjahr', e.jahr);
    const zeilen = ergebnis(await q.order('abrechnungsjahr', { ascending: false }).order('id').limit(500), 'Lesen: Abrechnungen');
    return { abrechnungen: zeilen ?? [] };
  },
};

export const VERTRAGS_WERKZEUGE: readonly Werkzeug[] = [
  mietvertragAendern,
  kuendigungErfassen,
  mahnstufeZuruecksetzen,
  mieterhoehungVereinbaren,
  zustimmungErfassen,
  zustimmungZuruecknehmen,
  mieterhoehungenAuflisten,
  mahnungenAuflisten,
  abrechnungenAuflisten,
];
