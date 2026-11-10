/**
 * Mieter ohne Mietvertrag in der Suche. Seit dem 10.11.2026 lassen sich Mieter aus einem Entwurf anlegen,
 * bevor es einen Vertrag gibt („erst einmal die Mieter anlegen“). Die Suche fand Mieter bis dahin nur über
 * ihren Vertrag — so angelegte Mieter wären unauffindbar gewesen.
 *
 * Steht der Mieter in einem offenen Entwurf, führt der Treffer zu dessen Einheit: Dort steht der Entwurf,
 * und der Vertrag lässt sich fortsetzen. Entwürfe darf nur ein Admin lesen; für alle anderen fehlt die Einheit.
 */

export interface MieterOhneVertragRoh {
  id: string;
  vorname: string | null;
  nachname: string | null;
  firmenname: string | null;
  ist_unternehmen: boolean | null;
  mietvertrag_mieter: { mietvertrag_id: string }[] | null;
}

export interface EntwurfFuerSuche {
  einheit_id: string;
  personen: unknown;
  einheiten: { etage: string | null; immobilie_id: string; immobilien: { name: string | null } | null } | null;
}

export interface MieterOhneVertragTreffer {
  id: string;
  name: string;
  /** Einheit des offenen Entwurfs, in dem der Mieter steht — sonst null. */
  einheitId: string | null;
  immobilieId: string | null;
  ort: string | null;
}

function name(m: MieterOhneVertragRoh): string {
  const firma = m.ist_unternehmen ? m.firmenname?.trim() : '';
  return firma || [m.vorname, m.nachname].map(t => t?.trim()).filter(Boolean).join(' ') || 'Ohne Namen';
}

function stehtImEntwurf(e: EntwurfFuerSuche, mieterId: string): boolean {
  return Array.isArray(e.personen) && e.personen.some(p => !!p && typeof p === 'object' && (p as { mieterId?: unknown }).mieterId === mieterId);
}

export function mieterOhneVertragTreffer(mieter: MieterOhneVertragRoh[], entwuerfe: EntwurfFuerSuche[]): MieterOhneVertragTreffer[] {
  return mieter
    .filter(m => (m.mietvertrag_mieter ?? []).length === 0)
    .map(m => {
      const entwurf = entwuerfe.find(e => stehtImEntwurf(e, m.id)) ?? null;
      const einheit = entwurf?.einheiten ?? null;
      return {
        id: m.id,
        name: name(m),
        einheitId: entwurf?.einheit_id ?? null,
        immobilieId: einheit?.immobilie_id ?? null,
        ort: einheit ? [einheit.immobilien?.name?.trim(), einheit.etage?.trim()].filter(Boolean).join(' · ') || null : null,
      };
    });
}
