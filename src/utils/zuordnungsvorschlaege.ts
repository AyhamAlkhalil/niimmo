/**
 * Fachlogik der Prüfmaske für Zuordnungsvorschläge nach dem CSV-Import.
 *
 * Die Edge Function `process-payments` liefert je Buchung einen Vorschlag
 * (Kategorie, Vertrag oder Objekt, Begründung, Konfidenz). Die Buchhaltung
 * korrigiert einzelne Zeilen, wählt ab und übernimmt. Bis zum 07.09.2026
 * lebte diese Logik als `getFinalResults` in der Modal-Komponente — ohne Test.
 *
 * Korrekturen werden je Zeilenindex geführt, weil die Vorschläge keine ID
 * haben; `vorschlagsSchluessel` bildet den fachlichen Schlüssel, mit dem die
 * Übernahme gewählte von abgewählten Zeilen unterscheidet.
 */

export interface Zuordnungsvorschlag {
  buchungsdatum: string;
  betrag: number;
  iban: string;
  verwendungszweck: string;
  empfaengername?: string;
  mietvertrag_id: string | null;
  immobilie_id?: string | null;
  kategorie: string;
  zuordnungsgrund: string;
  confidence: number;
  mieter_name?: string;
  immobilie_name?: string;
  /** false = das Backend rät ausdrücklich zur Prüfung (reiner Betrags-Match). */
  selected?: boolean;
}

export interface VertragOption {
  id: string;
  mieter: string;
  /** Objekt mit Etage/Einheit, z. B. „Haus A · 2. OG" */
  objekt: string;
  adresse?: string;
  gesamtmiete: number;
  beginn?: string | null;
  /** Über getVertragsende() ermittelt, nie ende_datum direkt. */
  ende?: string | null;
  status?: string;
}

export interface ImmobilieOption {
  id: string;
  name: string;
  adresse: string;
}

export interface Korrekturen {
  vertrag: Record<number, string | null>;
  immobilie: Record<number, string | null>;
  kategorie: Record<number, string>;
}

export const KEINE_KORREKTUREN: Korrekturen = { vertrag: {}, immobilie: {}, kategorie: {} };

/** Unter dieser Konfidenz gilt ein Vorschlag als unsicher (Backend: reiner Betrags-Match = 40). */
export const KONFIDENZ_UNSICHER = 50;

export type VorschlagStatus = 'geaendert' | 'offen' | 'unsicher' | 'zugeordnet';
export type VorschlagSicht = 'alle' | VorschlagStatus;

/** Fachlicher Schlüssel einer Buchung, identisch mit dem der Übernahme in PaymentManagement. */
export function vorschlagsSchluessel(v: Pick<Zuordnungsvorschlag, 'buchungsdatum' | 'betrag' | 'iban' | 'verwendungszweck'>): string {
  return `${v.buchungsdatum}_${v.betrag}_${v.iban || ''}_${(v.verwendungszweck || '').slice(0, 50)}`;
}

export function effektiveKategorie(idx: number, v: Zuordnungsvorschlag, k: Korrekturen): string {
  return k.kategorie[idx] || v.kategorie;
}

/** Nebenkosten hängen am Objekt, nie am Vertrag (docs/datenmodell.md: Zahlungsbezug ist entweder-oder). */
export function effektiveVertragId(idx: number, v: Zuordnungsvorschlag, k: Korrekturen): string | null {
  if (effektiveKategorie(idx, v, k) === 'Nebenkosten') return null;
  return k.vertrag[idx] !== undefined ? k.vertrag[idx] : v.mietvertrag_id;
}

export function effektiveImmobilieId(idx: number, v: Zuordnungsvorschlag, k: Korrekturen): string | null {
  if (effektiveKategorie(idx, v, k) !== 'Nebenkosten') return null;
  return k.immobilie[idx] !== undefined ? k.immobilie[idx] : v.immobilie_id ?? null;
}

/**
 * Zählt nur Korrekturen, die auch gespeichert würden: die Kategorie und das
 * Zielfeld der wirksamen Kategorie. Eine Objektwahl, die nach dem Rückwechsel
 * auf „Miete" übrig bleibt, verändert das Ergebnis nicht und ist deshalb
 * keine Änderung.
 */
export function istManuellGeaendert(idx: number, v: Zuordnungsvorschlag, k: Korrekturen): boolean {
  if (k.kategorie[idx] !== undefined) return true;
  return effektiveKategorie(idx, v, k) === 'Nebenkosten' ? k.immobilie[idx] !== undefined : k.vertrag[idx] !== undefined;
}

export function hatZuordnung(idx: number, v: Zuordnungsvorschlag, k: Korrekturen): boolean {
  return effektiveKategorie(idx, v, k) === 'Nebenkosten'
    ? Boolean(effektiveImmobilieId(idx, v, k))
    : Boolean(effektiveVertragId(idx, v, k));
}

/**
 * Reihenfolge der Prüfung: Was die Buchhaltung angefasst hat, ist „geändert";
 * ohne Ziel ist „offen"; ein Ziel mit niedriger Konfidenz ist „unsicher".
 */
export function vorschlagStatus(idx: number, v: Zuordnungsvorschlag, k: Korrekturen): VorschlagStatus {
  if (istManuellGeaendert(idx, v, k)) return 'geaendert';
  if (!hatZuordnung(idx, v, k)) return 'offen';
  if (v.confidence < KONFIDENZ_UNSICHER) return 'unsicher';
  return 'zugeordnet';
}

/** Vorbelegung der Auswahl: nur Vorschläge mit Vertrag, die das Backend nicht ausdrücklich abgewählt hat. */
export function standardAuswahl(vorschlaege: readonly Zuordnungsvorschlag[]): Set<number> {
  const auswahl = new Set<number>();
  vorschlaege.forEach((v, idx) => {
    if (v.mietvertrag_id && v.selected !== false) auswahl.add(idx);
  });
  return auswahl;
}

export function zaehleStatus(vorschlaege: readonly Zuordnungsvorschlag[], k: Korrekturen): Record<VorschlagStatus, number> {
  const z: Record<VorschlagStatus, number> = { geaendert: 0, offen: 0, unsicher: 0, zugeordnet: 0 };
  vorschlaege.forEach((v, idx) => {
    z[vorschlagStatus(idx, v, k)] += 1;
  });
  return z;
}

function zielName(idx: number, v: Zuordnungsvorschlag, k: Korrekturen, vertraege: readonly VertragOption[], immobilien: readonly ImmobilieOption[]): string {
  if (effektiveKategorie(idx, v, k) === 'Nebenkosten') {
    const id = effektiveImmobilieId(idx, v, k);
    const imm = id ? immobilien.find((i) => i.id === id) : undefined;
    return imm?.name ?? v.immobilie_name ?? '';
  }
  const id = effektiveVertragId(idx, v, k);
  const vt = id ? vertraege.find((c) => c.id === id) : undefined;
  return vt ? `${vt.mieter} ${vt.objekt}` : `${v.mieter_name ?? ''} ${v.immobilie_name ?? ''}`;
}

/** Liefert die Indizes der Vorschläge, die Sicht und Suchbegriff entsprechen — in Originalreihenfolge. */
export function filtereVorschlaege(
  vorschlaege: readonly Zuordnungsvorschlag[],
  k: Korrekturen,
  sicht: VorschlagSicht,
  suche: string,
  vertraege: readonly VertragOption[] = [],
  immobilien: readonly ImmobilieOption[] = []
): number[] {
  const s = suche.trim().toLowerCase();
  const treffer: number[] = [];
  vorschlaege.forEach((v, idx) => {
    if (sicht !== 'alle' && vorschlagStatus(idx, v, k) !== sicht) return;
    if (s) {
      const text = [
        v.empfaengername,
        v.verwendungszweck,
        v.zuordnungsgrund,
        v.buchungsdatum,
        Math.abs(v.betrag).toFixed(2),
        Math.abs(v.betrag).toFixed(2).replace('.', ','),
        zielName(idx, v, k, vertraege, immobilien),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!text.includes(s)) return;
    }
    treffer.push(idx);
  });
  return treffer;
}

/**
 * Wendet die Korrekturen an und behält nur die gewählten Zeilen — das ist,
 * was die Übernahme speichert. Der Zuordnungsgrund dokumentiert die manuelle
 * Änderung, damit das Protokoll später nicht „IBAN-Match" behauptet.
 */
export function wendeKorrekturenAn(
  vorschlaege: readonly Zuordnungsvorschlag[],
  k: Korrekturen,
  auswahl: ReadonlySet<number>,
  vertraege: readonly VertragOption[],
  immobilien: readonly ImmobilieOption[]
): Zuordnungsvorschlag[] {
  return vorschlaege
    .map((v, idx): Zuordnungsvorschlag => {
      const kategorie = effektiveKategorie(idx, v, k);
      let neu: Zuordnungsvorschlag = { ...v, kategorie };
      if (kategorie === 'Nebenkosten') {
        const korrektur = k.immobilie[idx];
        if (korrektur !== undefined) {
          const imm = immobilien.find((i) => i.id === korrektur);
          neu.immobilie_id = korrektur;
          neu.immobilie_name = imm?.name || v.immobilie_name;
          neu.zuordnungsgrund = korrektur ? `Manuell zugeordnet: ${imm?.name ?? korrektur}` : 'Manuell entfernt';
        }
        neu.mietvertrag_id = null;
      } else {
        // Alles außer Nebenkosten hängt am Vertrag. Ein Objektbezug aus einem
        // früheren Nebenkosten-Vorschlag darf nicht mitgespeichert werden —
        // sonst zählt die Zahlung doppelt (docs/datenmodell.md, entweder-oder).
        neu.immobilie_id = null;
        const korrektur = k.vertrag[idx];
        if (korrektur !== undefined) {
          const vt = vertraege.find((c) => c.id === korrektur);
          neu = {
            ...neu,
            mietvertrag_id: korrektur,
            mieter_name: vt?.mieter || v.mieter_name,
            immobilie_name: vt?.objekt || v.immobilie_name,
            zuordnungsgrund: korrektur ? `Manuell korrigiert: ${vt?.mieter ?? korrektur}` : 'Manuell entfernt',
          };
        }
      }
      return neu;
    })
    .filter((_, idx) => auswahl.has(idx));
}

/**
 * Nächste Zeile nach `ab`, die noch Aufmerksamkeit braucht (offen oder
 * unsicher), innerhalb der sichtbaren Zeilen; läuft am Ende von vorn an.
 */
export function naechsterPruefFall(
  vorschlaege: readonly Zuordnungsvorschlag[],
  k: Korrekturen,
  sichtbar: readonly number[],
  ab: number | null
): number | null {
  if (sichtbar.length === 0) return null;
  const start = ab === null ? -1 : sichtbar.indexOf(ab);
  for (let schritt = 1; schritt <= sichtbar.length; schritt++) {
    const idx = sichtbar[(start + schritt) % sichtbar.length];
    const status = vorschlagStatus(idx, vorschlaege[idx], k);
    if (status === 'offen' || status === 'unsicher') return idx;
  }
  return null;
}
