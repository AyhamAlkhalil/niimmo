// Werkzeugkatalog und Selbstbeschreibung des NiImmo-MCP-Servers (16.11.2026).
// Ohne Bibliotheksimporte — Vitest prüft Katalog und Schemas (src/utils/mcp/*.test.ts).

import type { ServerBeschreibung } from './protokoll.ts';
import type { Werkzeug } from './werkzeug.ts';
import { BESTAND_WERKZEUGE } from './werkzeuge/bestand.ts';
import { MIETKONTO_WERKZEUGE } from './werkzeuge/mietkonto.ts';
import { PFLEGE_WERKZEUGE } from './werkzeuge/pflege.ts';
import { VERTRAGS_WERKZEUGE } from './werkzeuge/vertraege.ts';
import { VERWALTUNGS_WERKZEUGE } from './werkzeuge/verwaltung.ts';
import { ZAHLUNGS_WERKZEUGE } from './werkzeuge/zahlungen.ts';

export const WERKZEUGE: readonly Werkzeug[] = [
  ...BESTAND_WERKZEUGE,
  ...MIETKONTO_WERKZEUGE,
  ...ZAHLUNGS_WERKZEUGE,
  ...VERTRAGS_WERKZEUGE,
  ...PFLEGE_WERKZEUGE,
  ...VERWALTUNGS_WERKZEUGE,
];

export const SERVER: ServerBeschreibung = {
  name: 'niimmo',
  titel: 'NiImmo Immobilienverwaltung',
  version: '1.0.0',
  hinweise: [
    'Zugang zur Immobilienverwaltung der NiImmo Gruppe (Objekte, Einheiten, Mieter, Mietverträge, Mietkonten, Zahlungen,',
    'Zähler, Aufgaben, Versicherungen, Darlehen, Dokumente). Jeder Aufruf läuft mit den Rechten des angemeldeten Kontos.',
    '',
    'Regeln:',
    '- IDs nie raten: immer aus suche, objekte_auflisten oder einem anderen Lesewerkzeug übernehmen.',
    '- Vor jeder Änderung den Datensatz lesen und dem Nutzer knapp sagen, was sich ändert; bei Geldbeträgen, Löschungen und',
    '  Kündigungen ausdrücklich nachfragen.',
    '- Beträge in Euro, Tage als JJJJ-MM-TT, Monate als JJJJ-MM. „Heute“ ist der Kalendertag in Deutschland.',
    '- Rückstand = fällige Forderungen minus Zahlungen; die Monatsmiete ist am 8. fällig. Rückstand und Guthaben nur aus',
    '  mietkonto_anzeigen bzw. rueckstaende_auflisten übernehmen, nie selbst aus Einzelbuchungen summieren.',
    '- Sammelzahlungen (eine Überweisung für mehrere Verträge) nie selbst aufteilen — den Nutzer entscheiden lassen.',
    '- Die Mahnstufe steigt nur durch den Versand einer Mahnung in der App; hier lässt sie sich nur senken.',
    '- Schriftstücke (Mietvertrag, Mahnung, Kündigungsschreiben, Mieterhöhungsverlangen, Betriebskostenabrechnung,',
    '  Übergabeprotokoll), die Vermietung einer Einheit und der Import von Kontoauszügen gehen nur in der App:',
    '  https://dashboard.niimmo.de',
  ].join('\n'),
};
