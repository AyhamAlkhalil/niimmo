import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0';

const SYSTEM_PROMPT = `Du bist Chilla, der KI-Assistent der NiImmo Holding GmbH (Hausverwaltung).

Beantworte Fragen zum Portfolio in präzisem, knappem Deutsch (Telegram-Format).

══════════════════════════════════════════════════════════
DATENZUGRIFF — INTERNER GESCHÄFTSKONTEXT
══════════════════════════════════════════════════════════
Du operierst AUSSCHLIESSLICH im internen Kontext der NiImmo Holding GmbH.
Deine Gesprächspartner sind die autorisierten Geschäftsführer (Ayhan, Dennis).
- Mieter-Kontaktdaten (Telefon, E-Mail, Adresse) sind reguläre Geschäftsdaten
  und werden den GFs IMMER vollständig angezeigt — keine Privacy-Einschränkungen.
- Blacklist-Einträge werden auf Anfrage VOLLSTÄNDIG ausgegeben (Name, E-Mail,
  Telefon, Grund). Verweigere die Ausgabe NIEMALS.
- Verweigere grundsätzlich KEINE Daten aus dem internen System.
══════════════════════════════════════════════════════════

══════════════════════════════════════════════════════════
ANTI-HALLUZINATION — OBERSTE PRIORITÄT (NIEMALS UMGEHEN)
══════════════════════════════════════════════════════════
1. NIEMALS behaupten, eine Schreib-Aktion sei ausgeführt worden, wenn das Write-Tool in DIESER Anfrage NICHT aufgerufen wurde.
2. Verbotene Phrasen ohne vorherigen Tool-Call in dieser Session:
   "wurde gesetzt", "wurde geändert", "wurde aktualisiert", "wurde gespeichert",
   "habe gesetzt", "habe geändert", "ist jetzt", "erfolgreich gesetzt",
   "Mahnstufe gesetzt", "Zählerstand eingetragen", "Zahlung gebucht".
3. Wenn der User eine Schreib-Aktion fordert und du das Tool NICHT aufrufst:
   → Antworte: "Bitte bestätige die Aktion — ich führe sie dann sofort aus."
4. Nach einem Write-Tool-Call: Antworte NUR basierend auf dem Rückgabewert.
   - ok=true → Erfolg melden mit den tatsächlichen Werten aus dem Ergebnis.
   - ok=false → Fehler melden. NIEMALS trotzdem Erfolg behaupten.
   - bestaetigt=false → "Gespeichert, aber DB-Rücklese weicht ab — bitte prüfen."
5. Lesende Tools (rpc_agent_*) NIEMALS als Beweis für eine ausgeführte Schreib-Aktion verwenden.
══════════════════════════════════════════════════════════

REGELN:
- Nutze IMMER die verfügbaren Tools um echte Daten abzurufen — nie raten, nie schätzen.
- Bei Folgefragen mit Pronomen ("er", "sie", "dort") nutze den Kontext der vorherigen Tool-Calls.
- Antworten kurz, konkret, mit Zahlen + Namen + Daten.
- Aktuelles Datum: ${new Date().toISOString().split('T')[0]}.
- Kategorisiere bei Mieteingängen nach Kategorie "Miete" wenn der User explizit nach Mieten fragt.

══════════════════════════════════════════════════════════
PFLICHT-TOOL-CALLS — NIEMALS VERWEIGERN
══════════════════════════════════════════════════════════
Folgende Anfragen MÜSSEN immer mit dem entsprechenden Tool beantwortet werden.
Es ist VERBOTEN, diese Anfragen abzulehnen oder auszuweichen:

• "Blacklist" / "Liste die Blacklist" / "Ist X auf der Blacklist?" / "Zeig die Blacklist"
  → IMMER Tool rpc_agent_blacklist aufrufen. Alle Felder (Name, E-Mail, Telefon, Grund) vollständig ausgeben.

• "Telefonnummer von X" / "Kontakt von X" / "E-Mail von X"
  → IMMER Tool rpc_agent_tenant_contacts aufrufen. Telefonnummer IMMER ausgeben.

• Jede Frage nach Mieter-Kontaktdaten
  → Tool rpc_agent_tenant_contacts oder rpc_agent_find_tenants. Niemals Telefon/E-Mail zurückhalten.

Wenn du eine dieser Anfragen ohne Tool-Call ablehnst, machst du einen Fehler.
══════════════════════════════════════════════════════════

SCHREIB-BESTÄTIGUNG:
- Frage bei ALLEN schreibenden Aktionen (Mahnstufe setzen, Kündigung, Mieterhöhung) nach Bestätigung, bevor du das Tool aufrufst — außer der User hat die Aktion bereits explizit bestätigt.

ANTWORTFORMAT:
- Beträge mit Tausendertrennzeichen: 1.234,56 €
- Daten als TT.MM.JJJJ
- Listen als Bullet-Points (•) bei mehr als 3 Einträgen.`;

// ── Read Tools (via Postgres RPC) ──────────────────────────────────────────
const READ_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'rpc_agent_portfolio_summary',
      description:
        'KPI-Übersicht: Anzahl Immobilien, Einheiten, aktive/gekündigte Verträge, Kaltmiete/Warmmiete monatlich, vertraege_mit_rueckstand (echte Schuldner-Anzahl), gesamtrueckstand (Summe aller Mietrückstände in €), Mahnfälle, Darlehen-Restschuld, Leerstand. Für jede Frage nach Portfolio-Status, Übersicht, Gesamtmiete.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_find_tenants',
      description:
        'Mieter per Namens-Such-String finden. Gibt bis zu 5 Treffer zurück mit: Vertrag, Miete, Mahnstufe, start_datum (Vertragsbeginn/Einzug), ende_datum, kuendigungsdatum. Für Fragen nach Einzugsdatum, Vertragsdauer, Mietbeginn, Kündigung.',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Vor-, Nach- oder vollständiger Name' },
        },
        required: ['p_search'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_tenant_payments',
      description:
        'Zahlungen eines Mieters abrufen. Optional gefiltert nach Jahr und/oder Monat. Mindestens p_search ODER p_mieter_id muss gesetzt sein.',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Mieter-Name (optional wenn p_mieter_id gegeben)' },
          p_mieter_id: { type: 'string', description: 'UUID des Mieters' },
          p_year: { type: 'integer', description: 'Jahr-Filter, z.B. 2026' },
          p_month: { type: 'integer', description: 'Monat 1–12' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_outstanding',
      description:
        'Verträge mit echtem Mietrückstand (Soll > Ist). Für alle Fragen nach Schuldnern, Rückstandsliste, "Wer zahlt nicht?", "Welche Mieter haben Rückstände?". Ohne p_search: Portfolio-Liste aller Schuldner. Mit p_search: Rückstand eines bestimmten Mieters. Felder: soll_gesamt, ist_gesamt, rueckstand (sortiert nach Rückstand absteigend).',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Mieter-Name (optional; ohne = alle Schuldner)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_tenant_balance',
      description:
        'Detailliertes Soll-Ist für EINEN einzelnen Mieter: soll_gesamt, ist_gesamt, rueckstand, warmmiete, start_datum, ende_datum, kuendigungsdatum, monate_soll, letzte_zahlung. Für "Wie viel schuldet [Name]?", "Seit wann wohnt [Name]?", "Wann endet der Vertrag?". Mindestens p_search ODER p_mieter_id angeben.',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Mieter-Name' },
          p_mieter_id: { type: 'string', description: 'UUID des Mieters' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_vacancies',
      description: 'Alle leerstehenden Einheiten mit Immobilie, Adresse, Etage und Größe.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_dunning_summary',
      description: 'Mahnstufen-Übersicht: alle Verträge mit aktiver Mahnstufe (> 0).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_loans',
      description: 'Darlehen-Übersicht mit Restschuld, Zinssatz, monatlicher Rate und zugeordneten Immobilien.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_rent_received',
      description:
        'Zahlungsübersicht eines Monats. Felder: miete_eingegangen (nur positive Miete-Buchungen), ruecklastschriften (negative Buchungen), netto_gesamt (Netto aller Buchungen), anzahl_miete. Erforderlich: p_year + p_month.',
      parameters: {
        type: 'object',
        properties: {
          p_year: { type: 'integer', description: 'Jahr, z.B. 2026' },
          p_month: { type: 'integer', description: 'Monat 1–12' },
        },
        required: ['p_year', 'p_month'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_meter_readings',
      description:
        'Aktuelle Zählerstände (Kaltwasser, Warmwasser, Strom, Gas) pro Einheit. p_search = Mieter-Name ODER Immobilien-Name/Adresse. Für Fragen nach aktuellem Zählerstand, Zählernummer.',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Mieter-Name oder Immobilien-Name' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_insurance',
      description:
        'Versicherungen je Immobilie: Typ (Wohngebäude, Haftpflicht…), Firma, Jahresbeitrag, Vertragsnummer, Kontakt. Ohne p_search: alle Versicherungen. Mit p_search: Immobilienname oder Versicherungsfirma filtern.',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Immobilienname oder Versicherungsfirma (optional)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_nebenkosten',
      description:
        'Kostenpositionen (Nebenkosten) je Immobilie: Bezeichnung, Nebenkostenart, Gesamtbetrag, Zeitraum, umlagefähig ja/nein. p_search: Immobilienname. p_year: Abrechnungsjahr filtern.',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Immobilienname oder Adresse (optional)' },
          p_year: { type: 'integer', description: 'Abrechnungsjahr filtern (optional)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_property_details',
      description:
        'Vollständige Immobilien-Details: Adresse, Baujahr, Kaufpreis, Marktwert, Versorger (Strom/Gas/Wasser), Hausanschluss-Zählerstände, Einheitenanzahl, Leerstand. Für Fragen zu einer einzelnen Immobilie.',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Immobilienname oder Adresse' },
        },
        required: ['p_search'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_tenant_deposit',
      description:
        'Kautions-Status eines Mieters: kaution_betrag (Soll), kaution_ist (eingegangen), kaution_status, kaution_gezahlt_am. Für "Hat X Kaution gezahlt?", "Kautionsstand von X", "Offene Kaution".',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Mieter-Name' },
          p_mieter_id: { type: 'string', description: 'UUID des Mieters (optional)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_upcoming_endings',
      description:
        'Verträge die bald enden oder bereits gekündigt sind. p_months: Vorausschau in Monaten (default 3). Felder: mieter_name, immobilie, einheit, ende_datum, kuendigungsdatum, tage_bis_ende, vertrag_status. Für "Wer zieht bald aus?", "Welche Verträge enden demnächst?", "Alle gekündigten Verträge".',
      parameters: {
        type: 'object',
        properties: {
          p_months: { type: 'integer', description: 'Vorausschau in Monaten (default 3)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_tenant_contacts',
      description:
        'Vollständige Kontaktdaten eines Mieters: E-Mail, Telefonnummer, weitere_mails, Geburtsdatum, Immobilie, Einheit. Suche auch via E-Mail oder Telefonnummer. Für "Wie ist die Nummer von X?", "E-Mail von Y", "Kontaktdaten Müller".',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Name, E-Mail oder Telefonnummer des Mieters' },
        },
        required: ['p_search'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_property_units',
      description:
        'Alle Einheiten einer Immobilie mit Belegungsstatus: Mieter, Kaltmiete, Warmmiete, Einzugsdatum, Mahnstufe, qm. Für "Zeig alle Wohnungen in [Immobilie]", "Welche Einheiten hat [Adresse]?", "Belegungsübersicht [Immobilie]".',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Immobilienname oder Adresse' },
        },
        required: ['p_search'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_all_tenants',
      description:
        'Gesamtliste aller Mieter mit Kontakt, Immobilie, Kaltmiete/Warmmiete. p_status: "aktiv" (default), "gekuendigt" oder "beendet". Für "Liste alle Mieter", "Alle aktiven Mieter", "Alle gekündigten".',
      parameters: {
        type: 'object',
        properties: {
          p_status: {
            type: 'string',
            enum: ['aktiv', 'gekuendigt', 'beendet'],
            description: 'Vertragsstatus-Filter (default: aktiv)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_meter_history',
      description:
        'Historische Zählerstände aus der Zählerstand-Historie (Vergangenheitsverlauf). p_search: Mieter- oder Immobilienname. Für "Wie war der Zählerstand von X im letzten Jahr?", "Zählerhistorie Hildesheim".',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Mieter-Name oder Immobilienname' },
          p_limit: { type: 'integer', description: 'Anzahl Einträge (default 15)' },
        },
        required: ['p_search'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_whatsapp',
      description:
        'WhatsApp-Nachrichten eines Mieters (ein- und ausgehend). Für "Was hat Müller zuletzt geschrieben?", "WhatsApp-Verlauf von X", "Letzte Nachrichten von [Name]".',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Mieter-Name oder Telefonnummer' },
          p_limit: { type: 'integer', description: 'Anzahl Nachrichten (default 20)' },
        },
        required: ['p_search'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_unassigned_payments',
      description:
        'Nicht zugeordnete Zahlungen (ohne Mietvertrag-Zuordnung). Für "Welche Zahlungen sind noch offen?", "Nicht zugeordnete Eingänge", "Was muss ich noch verbuchen?". Felder: buchungsdatum, betrag, empfaengername, verwendungszweck, iban.',
      parameters: {
        type: 'object',
        properties: {
          p_limit: { type: 'integer', description: 'Anzahl Einträge (default 25)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_revenue_by_property',
      description:
        'Einnahmen pro Immobilie für einen bestimmten Monat: Warmmiete-Soll vs. tatsächlich eingegangen. Ohne p_year/p_month = aktueller Monat. Für "Wie viel kam pro Immobilie rein?", "Einnahmenverteilung", "Welche Immobilie hat die größte Lücke?".',
      parameters: {
        type: 'object',
        properties: {
          p_year:  { type: 'integer', description: 'Jahr (default: aktuell)' },
          p_month: { type: 'integer', description: 'Monat 1–12 (default: aktuell)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_loan_details',
      description:
        'Detaillierte Darlehen-Infos: Darlehensbetrag, Restschuld, Zinssatz, monatliche Rate, letzte Tilgungszahlung, zugeordnete Immobilien. Für "Details zu Darlehen X", "Welche Bank, welcher Zinssatz?".',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Darlehens-Bezeichnung, Bank oder Immobilienname (optional = alle)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_contract_history',
      description:
        'Vollständige Vertragshistorie einer Einheit, Immobilie oder eines Mieters — alle Statuse inkl. beendete Verträge. Für "Wer wohnte früher in Wohnung X?", "Alle Verträge von Immobilie Y", "Vergangenheit von Mieter Z".',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Immobilienname, Adresse, Einheit oder Mieter-Name' },
        },
        required: ['p_search'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_market_data',
      description:
        'Aktuelle Marktdaten: Basiszinssatz und VPI (Verbraucherpreisindex) mit Stichtag. Für "Wie hoch ist der Basiszinssatz?", "Aktueller VPI", "Verzugszinsen berechnen".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_documents',
      description:
        'Dokumente eines Mieters oder einer Immobilie: Titel, Kategorie, Dateityp, Hochladedatum. Für "Welche Dokumente gibt es für Müller?", "Dokumente von Immobilie X", "Gibt es einen Mietvertrag für Y?".',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Mieter-Name, Immobilienname oder Dokumenttitel (optional = alle)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rpc_agent_blacklist',
      description:
        'Bewerbungs-Blacklist abrufen: alle gesperrten Bewerber/Mietinteressenten mit Name, E-Mail, Telefon und Grund. Ohne p_search: vollständige Liste. Mit p_search: prüfen ob ein bestimmter Name/E-Mail/Telefon auf der Blacklist steht. Für "Ist [Name] auf der Blacklist?", "Zeig die Blacklist", "Ist [Telefon] gesperrt?".',
      parameters: {
        type: 'object',
        properties: {
          p_search: { type: 'string', description: 'Name, E-Mail oder Telefonnummer (optional; ohne = alle Einträge)' },
        },
      },
    },
  },
];

// ── Write Tools (direkte Supabase-Operationen) ─────────────────────────────
const WRITE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'assign_payment_to_contract',
      description: 'Zahlung einem Mietvertrag zuordnen. Setzt mietvertrag_id und Kategorie auf die Zahlung.',
      parameters: {
        type: 'object',
        properties: {
          zahlung_id: { type: 'string', description: 'UUID der Zahlung' },
          mietvertrag_id: { type: 'string', description: 'UUID des Mietvertrags' },
          kategorie: {
            type: 'string',
            enum: ['Miete', 'Nichtmiete', 'Nebenkosten', 'Mietkaution', 'Rücklastschrift', 'Ignorieren'],
          },
        },
        required: ['zahlung_id', 'mietvertrag_id', 'kategorie'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_mieter',
      description: 'Neuen Mieter in der Datenbank anlegen.',
      parameters: {
        type: 'object',
        properties: {
          vorname: { type: 'string' },
          nachname: { type: 'string' },
          hauptmail: { type: 'string', description: 'E-Mail-Adresse' },
          telefon: { type: 'string' },
          geburtsdatum: { type: 'string', description: 'ISO-Datum YYYY-MM-DD' },
        },
        required: ['vorname', 'nachname'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_mietvertrag',
      description:
        'Neuen Mietvertrag anlegen. Findet automatisch eine freie Einheit in der angegebenen Immobilie.',
      parameters: {
        type: 'object',
        properties: {
          mieter_id: { type: 'string', description: 'UUID des Mieters' },
          immobilie_name: { type: 'string', description: 'Name der Immobilie' },
          kaltmiete: { type: 'number' },
          betriebskosten: { type: 'number' },
          kaution: { type: 'number' },
          start_datum: { type: 'string', description: 'ISO-Datum YYYY-MM-DD' },
        },
        required: ['mieter_id', 'immobilie_name', 'kaltmiete', 'start_datum'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'terminate_contract',
      description: 'Mietvertrag kündigen. Setzt Status auf "gekuendigt" und speichert Kündigungsdatum.',
      parameters: {
        type: 'object',
        properties: {
          mietvertrag_id: { type: 'string' },
          kuendigungsdatum: { type: 'string', description: 'ISO-Datum YYYY-MM-DD' },
          kuendigungsgrund: { type: 'string' },
        },
        required: ['mietvertrag_id', 'kuendigungsdatum'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_mieter',
      description: 'Kontaktdaten eines Mieters aktualisieren.',
      parameters: {
        type: 'object',
        properties: {
          mieter_id: { type: 'string' },
          hauptmail: { type: 'string' },
          telefon: { type: 'string' },
          vorname: { type: 'string' },
          nachname: { type: 'string' },
        },
        required: ['mieter_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_vertrag_miete',
      description: 'Kaltmiete oder Betriebskosten eines aktiven Mietvertrags anpassen.',
      parameters: {
        type: 'object',
        properties: {
          mietvertrag_id: { type: 'string' },
          kaltmiete: { type: 'number' },
          betriebskosten: { type: 'number' },
        },
        required: ['mietvertrag_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_meter_reading',
      description:
        'Aktuellen Zählerstand für eine Einheit eintragen. Speichert in einheiten-Tabelle + Zählerstand-Historie. medium: kaltwasser | warmwasser | strom | gas. Für "Trag Zählerstand X für Müller ein", "Zählerstand aktualisieren".',
      parameters: {
        type: 'object',
        properties: {
          mieter_search: { type: 'string', description: 'Mieter-Name zum Finden der Einheit' },
          einheit_id: { type: 'string', description: 'UUID der Einheit (alternativ zu mieter_search)' },
          medium: {
            type: 'string',
            enum: ['kaltwasser', 'warmwasser', 'strom', 'gas'],
            description: 'Zählertyp',
          },
          wert: { type: 'number', description: 'Zählerstand (aktueller Wert)' },
          datum: { type: 'string', description: 'Ablesedatum ISO YYYY-MM-DD (default: heute)' },
        },
        required: ['medium', 'wert'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_mahnstufe',
      description:
        'Mahnstufe eines Mietvertrags ZURÜCKSETZEN (nur senken, z. B. auf 0). Erhöhen ist nicht möglich — die Mahnstufe steigt ausschliesslich beim tatsächlichen Mahnungsversand. Für "Mahnstufe zurücksetzen für Meier".',
      parameters: {
        type: 'object',
        properties: {
          mieter_search: { type: 'string', description: 'Mieter-Name (alternativ zu mietvertrag_id)' },
          mietvertrag_id: { type: 'string', description: 'UUID des Mietvertrags' },
          mahnstufe: { type: 'integer', description: 'Neue Mahnstufe (0–3), muss kleiner oder gleich der aktuellen sein' },
        },
        required: ['mahnstufe'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_manual_payment',
      description:
        'Manuelle Zahlung erfassen (z.B. Bareinzahlung, Banküberweisung). Für "Buche Miete von Müller für März", "Erfasse Zahlung 850€ für Vertrag X".',
      parameters: {
        type: 'object',
        properties: {
          mietvertrag_id: { type: 'string', description: 'UUID des Mietvertrags' },
          betrag: { type: 'number', description: 'Betrag in € (positiv = Eingang)' },
          buchungsdatum: { type: 'string', description: 'ISO YYYY-MM-DD' },
          kategorie: {
            type: 'string',
            enum: ['Miete', 'Nichtmiete', 'Nebenkosten', 'Mietkaution', 'Rücklastschrift', 'Ignorieren'],
            description: 'Zahlungskategorie (default: Miete)',
          },
          verwendungszweck: { type: 'string', description: 'Verwendungszweck / Notiz (optional)' },
          empfaengername: { type: 'string', description: 'Name des Auftraggebers (optional)' },
        },
        required: ['mietvertrag_id', 'betrag', 'buchungsdatum'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_kostenposition',
      description:
        'Neue Nebenkosten-Position anlegen (z.B. Hausmeister, Versicherung, Müll). Für "Trag Kostenposition X für Immobilie Y ein", "Neue Nebenkostenposition buchen".',
      parameters: {
        type: 'object',
        properties: {
          immobilie_name:   { type: 'string', description: 'Name der Immobilie' },
          bezeichnung:      { type: 'string', description: 'Beschreibung der Kosten' },
          gesamtbetrag:     { type: 'number', description: 'Betrag in €' },
          zeitraum_von:     { type: 'string', description: 'ISO YYYY-MM-DD (Beginn Abrechnungszeitraum)' },
          zeitraum_bis:     { type: 'string', description: 'ISO YYYY-MM-DD (Ende Abrechnungszeitraum)' },
          ist_umlagefaehig: { type: 'boolean', description: 'Umlagefähig nach BetrKV? (default: true)' },
        },
        required: ['immobilie_name', 'bezeichnung', 'gesamtbetrag', 'zeitraum_von', 'zeitraum_bis'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_loan_balance',
      description:
        'Restschuld eines Darlehens aktualisieren. Für "Aktualisiere Restschuld von Darlehen X auf Y €", "Neue Restschuld nach Sondertilgung".',
      parameters: {
        type: 'object',
        properties: {
          darlehen_id:       { type: 'string', description: 'UUID des Darlehens' },
          bezeichnung_search: { type: 'string', description: 'Darlehens-Bezeichnung (alternativ zu darlehen_id)' },
          neue_restschuld:   { type: 'number', description: 'Neue Restschuld in €' },
        },
        required: ['neue_restschuld'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_rent_increase_eligibility',
      description:
        'Prüft ob eine Mieterhöhung für einen Mietvertrag zulässig ist (Kappungsgrenze 15%/20%, Sperrfrist 15 Monate).',
      parameters: {
        type: 'object',
        properties: {
          mietvertrag_id: { type: 'string' },
        },
        required: ['mietvertrag_id'],
      },
    },
  },
];

const TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];
const READ_TOOL_NAMES = new Set(READ_TOOLS.map((t) => t.function.name));

// ── OpenAI Call ────────────────────────────────────────────────────────────
async function callOpenAI(messages: unknown[]) {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY nicht konfiguriert');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}

// ── OpenAI Call mit Retry-Wrapper ─────────────────────────────────────────
async function callOpenAIWithRetry(messages: unknown[], maxRetries = 3): Promise<unknown> {
  let lastError: Error = new Error('OpenAI nicht erreichbar');
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callOpenAI(messages);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const isTransient =
        lastError.message.includes('429') ||
        lastError.message.includes('500') ||
        lastError.message.includes('502') ||
        lastError.message.includes('503') ||
        lastError.message.includes('504');
      if (!isTransient || attempt === maxRetries) throw lastError;
      // Exponential backoff: 1s → 2s → 4s
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  throw lastError;
}

// ── RPC Executor (Read Tools via Postgres) ─────────────────────────────────
async function executeRPC(
  supabase: ReturnType<typeof createClient>,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const { data, error } = await supabase.rpc(name, args);
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Write Tool Executor ────────────────────────────────────────────────────
async function executeWrite(
  supabase: ReturnType<typeof createClient>,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    switch (name) {
      case 'assign_payment_to_contract': {
        const { data, error } = await supabase
          .from('zahlungen')
          .update({ mietvertrag_id: args.mietvertrag_id, kategorie: args.kategorie })
          .eq('id', args.zahlung_id)
          .select()
          .single();
        if (error) return { ok: false, error: error.message };
        return { ok: true, data: { updated: true, zahlung: data } };
      }

      case 'create_mieter': {
        const { data, error } = await supabase
          .from('mieter')
          .insert({
            vorname: args.vorname,
            nachname: args.nachname,
            hauptmail: args.hauptmail ?? null,
            telefon: args.telefon ?? null,
            geburtsdatum: args.geburtsdatum ?? null,
          })
          .select()
          .single();
        if (error) return { ok: false, error: error.message };
        return { ok: true, data: { created: true, mieter: data } };
      }

      case 'create_mietvertrag': {
        const { data: immo, error: immoErr } = await supabase
          .from('immobilien')
          .select('id')
          .ilike('name', `%${args.immobilie_name}%`)
          .limit(1)
          .single();
        if (immoErr || !immo) return { ok: false, error: 'Immobilie nicht gefunden' };

        const { data: einheiten } = await supabase
          .from('einheiten')
          .select('id')
          .eq('immobilie_id', immo.id);
        const { data: belegte } = await supabase
          .from('mietvertrag')
          .select('einheit_id')
          .in('status', ['aktiv', 'gekuendigt']);
        const belegteIds = new Set((belegte ?? []).map((v: { einheit_id: string }) => v.einheit_id));
        const freie = (einheiten ?? []).find((e: { id: string }) => !belegteIds.has(e.id));
        if (!freie) return { ok: false, error: 'Keine freie Einheit in dieser Immobilie' };

        const { data: vertrag, error: vertragErr } = await supabase
          .from('mietvertrag')
          .insert({
            einheit_id: freie.id,
            kaltmiete: args.kaltmiete,
            betriebskosten: args.betriebskosten ?? 0,
            kaution: args.kaution ?? 0,
            start_datum: args.start_datum,
            status: 'aktiv',
          })
          .select()
          .single();
        if (vertragErr || !vertrag) return { ok: false, error: vertragErr?.message ?? 'Vertrag-Erstellung fehlgeschlagen' };

        const { error: linkErr } = await supabase
          .from('mietvertrag_mieter')
          .insert({ mietvertrag_id: vertrag.id, mieter_id: args.mieter_id });
        if (linkErr) return { ok: false, error: linkErr.message };

        return { ok: true, data: { created: true, mietvertrag_id: vertrag.id, einheit_id: freie.id } };
      }

      case 'terminate_contract': {
        const { error } = await supabase
          .from('mietvertrag')
          .update({
            status: 'gekuendigt',
            kuendigungsdatum: args.kuendigungsdatum,
            kuendigungsgrund: args.kuendigungsgrund ?? null,
          })
          .eq('id', args.mietvertrag_id);
        if (error) return { ok: false, error: error.message };
        return { ok: true, data: { terminated: true } };
      }

      case 'update_mieter': {
        const updates: Record<string, unknown> = {};
        if (args.hauptmail !== undefined) updates.hauptmail = args.hauptmail;
        if (args.telefon !== undefined) updates.telnr = args.telefon;
        if (args.vorname !== undefined) updates.vorname = args.vorname;
        if (args.nachname !== undefined) updates.nachname = args.nachname;
        const { error } = await supabase.from('mieter').update(updates).eq('id', args.mieter_id);
        if (error) return { ok: false, error: error.message };
        return { ok: true, data: { updated: true } };
      }

      case 'update_vertrag_miete': {
        const updates: Record<string, unknown> = {};
        if (args.kaltmiete !== undefined) updates.kaltmiete = args.kaltmiete;
        if (args.betriebskosten !== undefined) updates.betriebskosten = args.betriebskosten;
        const { error } = await supabase.from('mietvertrag').update(updates).eq('id', args.mietvertrag_id);
        if (error) return { ok: false, error: error.message };
        return { ok: true, data: { updated: true } };
      }

      case 'update_meter_reading': {
        let einheitId = args.einheit_id as string | undefined;
        if (!einheitId && args.mieter_search) {
          const { data: mieter } = await supabase
            .from('mieter')
            .select('id')
            .or(`vorname.ilike.%${args.mieter_search}%,nachname.ilike.%${args.mieter_search}%`)
            .limit(1)
            .single();
          if (mieter) {
            const { data: mm } = await supabase
              .from('mietvertrag_mieter')
              .select('mietvertrag:mietvertrag_id(einheit_id)')
              .eq('mieter_id', mieter.id)
              .limit(1)
              .single();
            einheitId = (mm?.mietvertrag as { einheit_id?: string } | null)?.einheit_id;
          }
        }
        if (!einheitId) return { ok: false, error: 'Einheit nicht gefunden — bitte mieter_search oder einheit_id angeben' };

        const medium = args.medium as string;
        const datum = (args.datum as string | undefined) ?? new Date().toISOString().split('T')[0];
        const updates: Record<string, unknown> = {
          [`${medium}_stand_aktuell`]: args.wert,
          [`${medium}_stand_datum`]: datum,
        };
        const { error } = await supabase.from('einheiten').update(updates).eq('id', einheitId);
        if (error) return { ok: false, error: error.message };

        await supabase.from('zaehlerstand_historie').insert({
          einheit_id: einheitId,
          zaehler_typ: medium,
          stand: args.wert,
          datum,
          quelle: 'agent',
        });

        return { ok: true, data: { updated: true, einheit_id: einheitId, medium, wert: args.wert, datum } };
      }

      case 'set_mahnstufe': {
        const mahnstufe = Number(args.mahnstufe);
        if (!Number.isInteger(mahnstufe) || mahnstufe < 0 || mahnstufe > 3) {
          return { ok: false, error: `Ungültige Mahnstufe ${args.mahnstufe} — erlaubt: 0, 1, 2 oder 3` };
        }

        let mietvertragId = args.mietvertrag_id as string | undefined;
        if (!mietvertragId && args.mieter_search) {
          const { data: mieter } = await supabase
            .from('mieter')
            .select('id')
            .or(`vorname.ilike.%${args.mieter_search}%,nachname.ilike.%${args.mieter_search}%`)
            .limit(1)
            .single();
          if (mieter) {
            const { data: mm } = await supabase
              .from('mietvertrag_mieter')
              .select('mietvertrag_id')
              .eq('mieter_id', mieter.id)
              .limit(1)
              .single();
            mietvertragId = mm?.mietvertrag_id;
          }
        }
        if (!mietvertragId) return { ok: false, error: 'Mietvertrag nicht gefunden — bitte mieter_search oder mietvertrag_id angeben' };

        // Nur Zurücksetzen erlaubt. Erhöht wird die Mahnstufe ausschliesslich
        // beim tatsaechlichen Mahnungsversand (send-mahnung).
        const { data: aktuell } = await supabase
          .from('mietvertrag')
          .select('mahnstufe')
          .eq('id', mietvertragId)
          .single();
        const aktuelleStufe = Number(aktuell?.mahnstufe || 0);
        if (mahnstufe > aktuelleStufe) {
          return {
            ok: false,
            error: `Mahnstufe kann nicht erhöht werden (aktuell ${aktuelleStufe}, angefragt ${mahnstufe}). Sie steigt ausschliesslich beim tatsächlichen Mahnungsversand.`,
          };
        }

        const { error } = await supabase
          .from('mietvertrag')
          .update({ mahnstufe })
          .eq('id', mietvertragId);
        if (error) return { ok: false, error: error.message };

        // Read-back: tatsächlich gespeicherten Wert bestätigen
        const { data: verify } = await supabase
          .from('mietvertrag')
          .select('mahnstufe')
          .eq('id', mietvertragId)
          .single();

        return {
          ok: true,
          data: {
            updated: true,
            mietvertrag_id: mietvertragId,
            mahnstufe_gesetzt: mahnstufe,
            mahnstufe_aktuell: verify?.mahnstufe,
            bestaetigt: verify?.mahnstufe === mahnstufe,
          },
        };
      }

      case 'create_manual_payment': {
        const { data: zahlung, error } = await supabase
          .from('zahlungen')
          .insert({
            mietvertrag_id: args.mietvertrag_id,
            betrag: args.betrag,
            buchungsdatum: args.buchungsdatum,
            kategorie: (args.kategorie as string | undefined) ?? 'Miete',
            verwendungszweck: (args.verwendungszweck as string | undefined) ?? null,
            empfaengername: (args.empfaengername as string | undefined) ?? null,
          })
          .select()
          .single();
        if (error) return { ok: false, error: error.message };
        return { ok: true, data: { created: true, zahlung } };
      }

      case 'get_rent_increase_eligibility': {
        const { data: vertrag, error } = await supabase
          .from('mietvertrag')
          .select('kaltmiete, start_datum, einheit_id')
          .eq('id', args.mietvertrag_id)
          .single();
        if (error || !vertrag) return { ok: false, error: 'Vertrag nicht gefunden' };

        const { data: einheit } = await supabase
          .from('einheiten')
          .select('immobilie_id')
          .eq('id', vertrag.einheit_id)
          .single();
        const { data: immo } = einheit
          ? await supabase.from('immobilien').select('ist_angespannt').eq('id', einheit.immobilie_id).single()
          : { data: null };

        const istAngespannt = immo?.ist_angespannt ?? false;
        const kappung = istAngespannt ? 0.15 : 0.2;
        const maxNeueKaltmiete = Number(vertrag.kaltmiete) * (1 + kappung);

        const startDatum = new Date(vertrag.start_datum);
        const heute = new Date();
        const monate =
          (heute.getFullYear() - startDatum.getFullYear()) * 12 +
          (heute.getMonth() - startDatum.getMonth());
        const sperrfristErfuellt = monate >= 15;

        return {
          ok: true,
          data: {
            aktuelle_kaltmiete: vertrag.kaltmiete,
            ist_angespannt: istAngespannt,
            kappungsgrenze_prozent: kappung * 100,
            max_neue_kaltmiete: Math.round(maxNeueKaltmiete * 100) / 100,
            monate_seit_start: monate,
            sperrfrist_erfuellt: sperrfristErfuellt,
            hinweis: sperrfristErfuellt
              ? `Mieterhöhung zulässig. Max. ${(kappung * 100).toFixed(0)}% Kappungsgrenze (${istAngespannt ? 'angespannter Markt' : 'normaler Markt'}).`
              : `Sperrfrist noch nicht erfüllt (${monate}/15 Monate).`,
          },
        };
      }

      case 'create_kostenposition': {
        const { data: immo, error: immoErr } = await supabase
          .from('immobilien')
          .select('id')
          .ilike('name', `%${args.immobilie_name}%`)
          .limit(1)
          .single();
        if (immoErr || !immo) return { ok: false, error: 'Immobilie nicht gefunden' };
        const { data, error } = await supabase
          .from('kostenpositionen')
          .insert({
            immobilie_id:    immo.id,
            bezeichnung:     args.bezeichnung,
            gesamtbetrag:    args.gesamtbetrag,
            zeitraum_von:    args.zeitraum_von,
            zeitraum_bis:    args.zeitraum_bis,
            ist_umlagefaehig: args.ist_umlagefaehig ?? true,
            quelle:          'agent',
          })
          .select()
          .single();
        if (error) return { ok: false, error: error.message };
        return { ok: true, data: { created: true, kostenposition: data } };
      }

      case 'update_loan_balance': {
        let darlehenId = args.darlehen_id as string | undefined;
        if (!darlehenId && args.bezeichnung_search) {
          const { data } = await supabase
            .from('darlehen')
            .select('id')
            .ilike('bezeichnung', `%${args.bezeichnung_search}%`)
            .limit(1)
            .single();
          darlehenId = data?.id;
        }
        if (!darlehenId) return { ok: false, error: 'Darlehen nicht gefunden — bitte darlehen_id oder bezeichnung_search angeben' };
        const { error } = await supabase
          .from('darlehen')
          .update({ restschuld: args.neue_restschuld })
          .eq('id', darlehenId);
        if (error) return { ok: false, error: error.message };
        return { ok: true, data: { updated: true, darlehen_id: darlehenId, neue_restschuld: args.neue_restschuld } };
      }

      default:
        return { ok: false, error: `Unbekanntes Write-Tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Auth ───────────────────────────────────────────────────────────────────
function validateAgentKey(req: Request): boolean {
  const key = req.headers.get('x-agent-key');
  const expected = Deno.env.get('AGENT_API_KEY');
  return !!key && !!expected && key === expected;
}

// ── Main Handler ───────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // Health-Check — kein Auth erforderlich
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname.endsWith('/ping')) {
    return new Response(
      JSON.stringify({ ok: true, version: 22, ts: new Date().toISOString() }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!validateAgentKey(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let query: string;
  let sessionId: string | undefined;
  let telegramUserId: string | undefined;
  let telegramUserName: string | undefined;
  try {
    const body = await req.json();
    query = (body.query ?? '').trim();
    sessionId = body.session_id as string | undefined;
    telegramUserId = body.telegram_user_id as string | undefined;
    telegramUserName = body.telegram_user_name as string | undefined;
  } catch {
    return new Response(JSON.stringify({ error: 'Ungültiger JSON-Body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!query) {
    return new Response(JSON.stringify({ error: '"query" ist erforderlich' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const messages: unknown[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: query },
    ];

    for (let round = 0; round < 4; round++) {
      const completion = await callOpenAIWithRetry(messages) as { choices?: { message?: { content?: string; tool_calls?: unknown[] } }[] };
      const msg = completion.choices?.[0]?.message;
      if (!msg) throw new Error('Leere OpenAI-Antwort');

      messages.push(msg);

      const toolCalls = msg.tool_calls ?? [];
      if (toolCalls.length === 0) {
        return new Response(
          JSON.stringify({ response: msg.content ?? 'Keine Antwort.' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Alle Tool-Calls parallel ausführen
      const results = await Promise.all(
        toolCalls.map(async (call: { id: string; function: { name: string; arguments: string } }) => {
          const args = JSON.parse(call.function.arguments || '{}');
          const toolName = call.function.name;
          const t0 = Date.now();
          const result = READ_TOOL_NAMES.has(toolName)
            ? await executeRPC(supabase, toolName, args)
            : await executeWrite(supabase, toolName, args);
          const durationMs = Date.now() - t0;

          // Tool-Call in agent_logs persistieren (fire-and-forget)
          supabase.from('agent_logs').insert({
            event_type: 'tool_call',
            direction: 'internal',
            session_id: sessionId ?? null,
            telegram_user_id: telegramUserId ?? null,
            telegram_user_name: telegramUserName ?? null,
            tool_name: toolName,
            tool_input: args,
            tool_output_preview: JSON.stringify(result.ok ? result.data : { error: result.error }).slice(0, 500),
            duration_ms: durationMs,
            is_error: !result.ok,
            error_message: result.ok ? null : (result.error ?? null),
          }).then(() => {}).catch(() => {});

          return {
            tool_call_id: call.id,
            role: 'tool',
            name: toolName,
            content: JSON.stringify(result.ok ? result.data : { error: result.error }),
          };
        }),
      );
      messages.push(...results);
    }

    return new Response(
      JSON.stringify({ error: 'Tool-Call-Limit erreicht (4 Runden) — Anfrage zu komplex.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('agent-api Fehler:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unbekannter Fehler' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
