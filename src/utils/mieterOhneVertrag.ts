/**
 * Mieter ohne Mietvertrag in der Suche. Seit dem 10.11.2026 lassen sich Mieter aus einem Entwurf anlegen,
 * bevor es einen Vertrag gibt („erst einmal die Mieter anlegen“). Die Suche fand Mieter bis dahin nur über
 * ihren Vertrag — so angelegte Mieter wären unauffindbar gewesen.
 *
 * Steht der Mieter in einem offenen Entwurf, führt der Treffer zu dessen Einheit: Dort steht der Entwurf,
 * und der Vertrag lässt sich fortsetzen. Entwürfe darf nur ein Admin lesen; für alle anderen fehlt die Einheit.
 *
 * Löschen (ebenfalls 10.11.2026): Ein Mieter ohne Vertrag und ohne Entwurf lässt sich aus der Suche löschen,
 * angelegte Mieter eines Entwurfs beim Verwerfen auf Wunsch mit. Ohne diesen Weg blieben Name, Geburtsdatum und
 * Anschrift eines abgesprungenen Interessenten ohne Zweck im Bestand (DSGVO, Speicherbegrenzung).
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

/**
 * Mieterdatensätze, auf die die Personen eines Entwurfs zeigen — angelegt über „Mieter anlegen“ oder aus dem
 * Bestand gewählt. Robust gegen kaputte Listen; jede ID einmal.
 */
export function entwurfsMieterIds(personen: unknown): string[] {
  if (!Array.isArray(personen)) return [];
  const ids = personen
    .map(p => (p && typeof p === 'object' ? (p as { mieterId?: unknown }).mieterId : null))
    .filter((id): id is string => typeof id === 'string' && id.trim() !== '');
  return [...new Set(ids)];
}

/**
 * Namen der Mieter, die in den anderen, mitverworfenen Entwürfen schon angelegt sind und im aktivierten nicht
 * stehen. Sie bleiben im Bestand — der Hinweis beim Aktivieren sagt das, statt „samt Interessentendaten“ zu
 * versprechen.
 */
export function angelegteMieterAusAnderen(
  andere: { personen: { mieterId?: string | null; vorname?: string; nachname?: string; firmenname?: string | null; istUnternehmen?: boolean }[] }[],
  eigene: { mieterId?: string | null }[]
): string[] {
  const eigeneIds = new Set(entwurfsMieterIds(eigene));
  const namen = new Map<string, string>();
  for (const e of andere) {
    for (const p of e.personen ?? []) {
      const id = entwurfsMieterIds([p])[0];
      if (!id || eigeneIds.has(id) || namen.has(id)) continue;
      const firma = p.istUnternehmen ? p.firmenname?.trim() : '';
      namen.set(id, firma || [p.vorname, p.nachname].map(t => t?.trim()).filter(Boolean).join(' ') || 'Ohne Namen');
    }
  }
  return [...namen.values()];
}

/** Ergebnis von `loesche_mieter_ohne_vertrag`: Wer an nichts hing, ist gelöscht; der Rest bleibt mit Grund. */
export interface MieterLoeschErgebnis {
  geloescht: { id: string; name: string }[];
  behalten: { id: string; name: string; grund: string }[];
}

function liste<T>(wert: unknown, lies: (x: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(wert)) return [];
  return wert
    .map(x => (x && typeof x === 'object' ? lies(x as Record<string, unknown>) : null))
    .filter((x): x is T => x !== null);
}

/**
 * Liest die Antwort der Funktion. Eine unerwartete Form wirft: Leere Listen hießen sonst „Der Mieter war schon
 * gelöscht“ — ein Fehler sähe wie ein Erfolg aus (Review 10.11.2026). Einzelne kaputte Einträge fallen weg.
 */
export function leseLoeschErgebnis(daten: unknown): MieterLoeschErgebnis {
  const d = daten && typeof daten === 'object' && !Array.isArray(daten) ? (daten as Record<string, unknown>) : null;
  if (!d || !Array.isArray(d.geloescht) || !Array.isArray(d.behalten)) {
    throw new Error('Unerwartete Antwort der Datenbank — ob gelöscht wurde, ist unklar. Bitte die Suche neu laden.');
  }
  const text = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
  return {
    geloescht: liste(d.geloescht, x => (text(x.id) ? { id: text(x.id)!, name: text(x.name) ?? 'Ohne Namen' } : null)),
    behalten: liste(d.behalten, x =>
      text(x.id) ? { id: text(x.id)!, name: text(x.name) ?? 'Ohne Namen', grund: text(x.grund) ?? 'unbekannter Grund' } : null
    ),
  };
}

/** „A, B und C“ */
export function namensAufzaehlung(namen: string[]): string {
  return namen.length <= 1 ? namen.join('') : `${namen.slice(0, -1).join(', ')} und ${namen[namen.length - 1]}`;
}

/** Ein Satz je Ausgang, für die Meldung nach dem Löschen. */
export function loeschErgebnisText(e: MieterLoeschErgebnis): string {
  const saetze: string[] = [];
  if (e.geloescht.length > 0) {
    const namen = e.geloescht.map(m => m.name);
    saetze.push(`${namensAufzaehlung(namen)} ${namen.length > 1 ? 'sind' : 'ist'} aus dem Mieterbestand gelöscht.`);
  }
  for (const m of e.behalten) saetze.push(`${m.name} bleibt im Bestand: ${m.grund.replace(/[.\s]+$/, '')}.`);
  return saetze.length > 0 ? saetze.join(' ') : 'Der Mieter war schon gelöscht.';
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
