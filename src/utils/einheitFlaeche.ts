/**
 * Welche Einheiten zur Fläche eines Objekts zählen (Kundenentscheidung 29.10.2026): alle außer Garagen und
 * Stellplätzen. Bis dahin ließ der Objektkopf auch Lager und Sonstiges weg, Mietaufstellung und Mietübersicht zählten
 * jede Einheit (live 6.222 gegen 6.288 m²). Dieselbe Abgrenzung wie in der Betriebskostenabrechnung
 * (traegtBetriebskosten).
 */
export const zaehltZurFlaeche = (einheitentyp: string | null | undefined): boolean =>
  einheitentyp !== 'Garage' && einheitentyp !== 'Stellplatz';

/** Fläche einer Einheit, wie sie in Summen eingeht: 0 für Garagen und Stellplätze */
export const flaecheFuerSumme = (einheit: { qm?: number | null; einheitentyp?: string | null }): number =>
  zaehltZurFlaeche(einheit.einheitentyp) ? Number(einheit.qm) || 0 : 0;
