/**
 * Verzugszinsen-Berechnung nach § 288 BGB
 *
 * Verzugszinssatz = Basiszinssatz der Bundesbank + 5 Prozentpunkte (fuer Verbraucher)
 * Formel: (Rueckstand x Verzugszinssatz x Verzugstage) / (365 x 100)
 *
 * Verzugsbeginn: 4. Werktag des Folgemonats (§ 556b Abs. 1 BGB)
 */

// Fallback-Perioden wenn DB nicht verfuegbar (Stand 2026)
export const BASISZINSSATZ_PERIODEN_FALLBACK: Array<{ ab: string; satz: number }> = [
  { ab: '2026-01-01', satz: 1.27 },
  { ab: '2025-07-01', satz: 1.77 },
  { ab: '2025-01-01', satz: 2.27 },
  { ab: '2024-07-01', satz: 3.37 },
  { ab: '2024-01-01', satz: 3.62 },
  { ab: '2023-07-01', satz: 3.12 },
  { ab: '2023-01-01', satz: 1.62 },
];

// Aufschlag fuer Verbraucher-Mietverhaeltnisse: 5 Prozentpunkte (§ 288 Abs. 1 BGB)
const AUFSCHLAG_VERBRAUCHER = 5;

// Deutsche gesetzliche Feiertage (feststehende Daten, bundesweit)
const FEIERTAGE_FEST = [
  '01-01', // Neujahr
  '05-01', // Tag der Arbeit
  '10-03', // Tag der Deutschen Einheit
  '12-25', // 1. Weihnachtstag
  '12-26', // 2. Weihnachtstag
];

/**
 * Lokales ISO-Datum als YYYY-MM-DD — verhindert UTC-Drift bei Mitternacht in CET/CEST.
 * toISOString() gibt immer UTC zurueck: local midnight Jan 1 CET = Dec 31 23:00 UTC.
 */
export function toLocalIso(datum: Date): string {
  const y = datum.getFullYear();
  const m = String(datum.getMonth() + 1).padStart(2, '0');
  const d = String(datum.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isFeiertag(datum: Date): boolean {
  const localIso = toLocalIso(datum);
  const mmdd = localIso.slice(5, 10);
  if (FEIERTAGE_FEST.includes(mmdd)) return true;

  // Bewegliche Feiertage (Ostern-basiert)
  const jahr = datum.getFullYear();
  const ostern = berechneOsternSonntag(jahr);
  const bewegliche = [
    addTage(ostern, -2),  // Karfreitag
    addTage(ostern, 1),   // Ostermontag
    addTage(ostern, 39),  // Christi Himmelfahrt
    addTage(ostern, 49),  // Pfingstsonntag
    addTage(ostern, 50),  // Pfingstmontag
  ];
  return bewegliche.some(f => toLocalIso(f) === localIso);
}

function addTage(datum: Date, tage: number): Date {
  const d = new Date(datum);
  d.setDate(d.getDate() + tage);
  return d;
}

/** Gauss-Algorithmus fuer Ostersonntag */
function berechneOsternSonntag(jahr: number): Date {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(jahr, monat - 1, tag);
}

function isWerktag(datum: Date): boolean {
  const wochentag = datum.getDay();
  return wochentag !== 0 && wochentag !== 6 && !isFeiertag(datum);
}

/**
 * Berechnet den 4. Werktag des auf das Faelligkeitsmonat folgenden Monats.
 * Z.B. Miete Dezember → Verzug ab 4. Werktag Januar
 */
export function berechneVerzugsbeginn(faelligkeitsMonat: Date): Date {
  // Erster Tag des Folgemonats
  const folgeMonat = new Date(faelligkeitsMonat.getFullYear(), faelligkeitsMonat.getMonth() + 1, 1);

  let werktage = 0;
  let aktuell = new Date(folgeMonat);

  while (werktage < 4) {
    if (isWerktag(aktuell)) werktage++;
    if (werktage < 4) aktuell = addTage(aktuell, 1);
  }

  return aktuell;
}

export interface VerzugszinsPosten {
  monat: string;
  rueckstandBetrag: number;
  verzugVon: string; // ISO date
  verzugBis: string; // ISO date
  tage: number;
  basiszinssatz: number;
  verzugszinssatz: number;
  zinsbetrag: number;
}

/**
 * Ermittelt den Basiszinssatz fuer ein gegebenes Datum.
 * Nutzt optionale DB-Perioden, faellt auf Fallback zurueck.
 */
export function getBasiszinssatz(
  datum: Date,
  perioden: Array<{ ab: string; satz: number }> = BASISZINSSATZ_PERIODEN_FALLBACK
): number {
  const isoDate = toLocalIso(datum);
  for (const periode of perioden) {
    if (isoDate >= periode.ab) return periode.satz;
  }
  return perioden[perioden.length - 1].satz;
}

/**
 * Gibt den aktuellen Verzugszinssatz zurueck (Basiszins + 5%)
 */
export function getVerzugszinssatz(
  datum: Date,
  perioden?: Array<{ ab: string; satz: number }>
): number {
  return getBasiszinssatz(datum, perioden) + AUFSCHLAG_VERBRAUCHER;
}

function diffTage(von: Date, bis: Date): number {
  const msProTag = 1000 * 60 * 60 * 24;
  return Math.max(0, Math.round((bis.getTime() - von.getTime()) / msProTag));
}

/**
 * Berechnet Verzugszinsen tagesgenau fuer einen einzelnen Rueckstandsposten
 */
export function berechneVerzugszins(
  rueckstandBetrag: number,
  verzugVon: Date,
  verzugBis: Date,
  perioden?: Array<{ ab: string; satz: number }>
): VerzugszinsPosten {
  const tage = diffTage(verzugVon, verzugBis);
  const basiszinssatz = getBasiszinssatz(verzugVon, perioden);
  const verzugszinssatz = basiszinssatz + AUFSCHLAG_VERBRAUCHER;
  const zinsbetrag = (rueckstandBetrag * verzugszinssatz * tage) / (365 * 100);

  const monatLabel = verzugVon.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

  return {
    monat: monatLabel,
    rueckstandBetrag,
    verzugVon: toLocalIso(verzugVon),
    verzugBis: toLocalIso(verzugBis),
    tage,
    basiszinssatz,
    verzugszinssatz,
    zinsbetrag: Math.round(zinsbetrag * 100) / 100,
  };
}

/** Lokale Mitternacht eines Kalendertags JJJJ-MM-TT (new Date('JJJJ-MM-TT') wäre UTC). */
function lokalerTag(iso: string): Date {
  const [j, m, t] = iso.slice(0, 10).split('-').map(Number);
  return new Date(j, m - 1, t);
}

/**
 * Berechnet Verzugszinsen fuer mehrere Rueckstandsposten, je Basiszins-Periode getrennt.
 *
 * Bis zum 27.10.2026 galt der Satz zu Verzugsbeginn fuer den ganzen Zeitraum: Ein Verzug ab
 * 04.06.2026 lief durchgehend mit 1,27 + 5 %, obwohl ab 01.07. ein anderer Satz galt.
 *
 * @param posten Array von { betrag, faelligAb } - faelligAb = Datum ab dem Verzug gilt
 * @param stichtag Datum bis zu dem Zinsen berechnet werden (default: heute)
 * @param perioden Optionale DB-Basiszinssatz-Perioden
 */
export function berechneAlleVerzugszinsen(
  posten: Array<{ betrag: number; faelligAb: string }>,
  stichtag?: Date,
  perioden: Array<{ ab: string; satz: number }> = BASISZINSSATZ_PERIODEN_FALLBACK
): { details: VerzugszinsPosten[]; gesamt: number } {
  // Kalendertag ohne Uhrzeit: sonst rechnete die Mahnung ab 12 Uhr einen Zinstag mehr (27.10.2026)
  const jetzt = stichtag || new Date();
  const bis = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
  const details: VerzugszinsPosten[] = [];
  let gesamt = 0;
  const grenzen = [...new Set(perioden.map((p) => p.ab.slice(0, 10)))].sort();

  for (const p of posten) {
    const von = lokalerTag(p.faelligAb);
    if (von >= bis) continue;

    const monatLabel = von.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    let start = von;
    for (const grenze of [...grenzen.map(lokalerTag).filter((g) => g > von && g < bis), bis]) {
      const teil = berechneVerzugszins(p.betrag, start, grenze, perioden);
      if (teil.tage > 0) {
        details.push({ ...teil, monat: start === von ? monatLabel : `${monatLabel} ab ${start.toLocaleDateString('de-DE')}` });
        gesamt += teil.zinsbetrag;
      }
      start = grenze;
    }
  }

  return {
    details,
    gesamt: Math.round(gesamt * 100) / 100,
  };
}

/**
 * Verteilt einen Mietrückstand auf die jüngsten fälligen Monate (je eine Monatsmiete, der Rest
 * auf den ältesten) und gibt je Monat den Verzugsbeginn zurück: 4. Werktag des Mietmonats
 * (§ 556b Abs. 1 BGB). Zahlungen tilgen die älteste Schuld zuerst (§ 366 Abs. 2 BGB), offen
 * bleiben also die jüngsten Monate.
 *
 * Der jüngste Monat ist der, dessen Forderung schon fällig ist (Fälligkeit wie in der
 * Rückstandsliste: sollmonat + 7, also der 8.). Bis zum 27.10.2026 verteilte der Mahndialog den
 * Betrag gleichmäßig auf eine aufgerundete Monatszahl und setzte vom 1. bis 7. jedes Monats jeden
 * Posten einen Monat zu spät an; der jüngste fiel ganz weg (am 04.11. ergab Oktober 0,00 €).
 */
export function verzugspostenAusRueckstand(
  rueckstand: number,
  monatsmiete: number,
  heute: Date = new Date(),
  faelligkeitsTag = 8
): Array<{ betrag: number; faelligAb: string }> {
  if (!(rueckstand > 0)) return [];
  const juengster = new Date(heute.getFullYear(), heute.getMonth() - (heute.getDate() >= faelligkeitsTag ? 0 : 1), 1);
  const verzugAb = (mietmonat: Date) =>
    toLocalIso(berechneVerzugsbeginn(new Date(mietmonat.getFullYear(), mietmonat.getMonth() - 1, 1)));

  if (!(monatsmiete > 0)) return [{ betrag: Math.round(rueckstand * 100) / 100, faelligAb: verzugAb(juengster) }];

  const posten: Array<{ betrag: number; faelligAb: string }> = [];
  let rest = Math.round(rueckstand * 100);
  const miete = Math.round(monatsmiete * 100);
  for (let i = 0; rest > 0 && i < 600; i++) {
    const betrag = Math.min(miete, rest);
    posten.unshift({ betrag: betrag / 100, faelligAb: verzugAb(new Date(juengster.getFullYear(), juengster.getMonth() - i, 1)) });
    rest -= betrag;
  }
  return posten;
}

/**
 * Die DB-Perioden beginnen erst mit dem ersten Abruf (01.03.2026); ein älterer Verzug fiel bis zum
 * 27.10.2026 auf den ältesten DB-Satz. Ältere Zeiträume kommen aus der eingebauten Liste.
 */
export function mitAelterenPerioden(db: Array<{ ab: string; satz: number }>): Array<{ ab: string; satz: number }> {
  const aeltesteDb = db.reduce((min, p) => (p.ab < min ? p.ab : min), db[0]?.ab ?? '9999-12-31');
  return [...db, ...BASISZINSSATZ_PERIODEN_FALLBACK.filter((p) => p.ab < aeltesteDb)]
    .sort((a, b) => b.ab.localeCompare(a.ab));
}
