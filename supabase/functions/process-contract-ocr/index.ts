import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const ALLOWED_ORIGINS = [
  'https://immobilien-blick-dashboard.lovable.app',
  'https://id-preview--8e9e2f9b-7950-413f-adfd-90b0d2663ae1.lovable.app',
  'https://dashboard.niimmo.de',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  };
}

/**
 * Drei Dokumentarten (seit 18.10.2026):
 *  - mietvertrag:     bisheriger Weg im Erfassungsdialog „Bestehenden Vertrag erfassen"
 *  - selbstauskunft:  Interessenten für einen neuen Vertragsentwurf
 *  - vorvertrag:      Grundparameter aus dem alten Vertrag derselben Einheit
 */
type Art = 'mietvertrag' | 'selbstauskunft' | 'vorvertrag';
const ARTEN: Art[] = ['mietvertrag', 'selbstauskunft', 'vorvertrag'];

/**
 * Ausdrücklich gewählt (28.10.2026): Lovable hat google/gemini-2.5-flash am 20.10.2026 abgeschaltet und
 * die Anfragen seitdem still auf Gemini 3.8 Flash umgeleitet (Lovable-Doku „Deprecated models").
 */
const MODELL = 'google/gemini-3.8-flash';

/**
 * Seit 28.10.2026 kommt jede Seite als Bild, bei Text-PDFs dazu die Textebene. Bis dahin fielen Bilder
 * über der sechsten und Text über 200.000 Zeichen still weg. Die Grenze liegt jetzt beim Umfang; der
 * Browser rechnet die Seitenbilder auf 9 MB herunter (src/utils/pdfAuslese.ts).
 */
const MAX_BILDER_ZEICHEN = 12 * 1024 * 1024;
const MAX_TEXT_ZEICHEN = 1_000_000;
/** Das Denken des Modells zählt zur Ausgabe (Lovable-Doku „Chat models"); bei vielen Seiten reichten 2000 nicht sicher. */
const MAX_AUSGABE_TOKEN = 16_000;
/** Supabase beendet eine Anfrage nach 150 s ohne Antwort mit 504. */
const KI_ZEITLIMIT_MS = 140_000;

const PROMPT_MIETVERTRAG = `Du bist ein Experte für die Extraktion von Mietvertragsdaten aus deutschen Dokumenten.
Analysiere das bereitgestellte Dokument und extrahiere folgende Informationen:

- Alle Mieter mit Vorname, Nachname, E-Mail, Telefonnummer, Geburtsdatum und Rolle (hauptmieter oder mitmieter)
- Kaltmiete (nur der Betrag in Euro, als Zahl)
- Betriebskosten/Nebenkosten (nur der Betrag in Euro, als Zahl)
- Kaution/Sicherheitsleistung (nur der Betrag in Euro, als Zahl)
- Mietbeginn/Startdatum (Format: YYYY-MM-DD)
- Mietende/Enddatum falls befristet (Format: YYYY-MM-DD oder null)
- Ob Lastschrift vereinbart ist (true/false)
- IBAN/Bankkonto des Mieters
- Rücklastschrift-Gebühr falls angegeben
- Verwendungszweck für Mietzahlungen
- Zählerstände bei Einzug: Strom, Gas, Kaltwasser, Warmwasser

Antworte NUR mit einem JSON-Objekt ohne zusätzliche Erklärungen.
Bei fehlenden Daten verwende null.

Beispiel-Antwort:
{
  "mieter": [
    {
      "vorname": "Max",
      "nachname": "Mustermann",
      "hauptmail": "max@example.de",
      "telnr": "+49 123 456789",
      "geburtsdatum": "1990-01-15",
      "rolle": "hauptmieter"
    }
  ],
  "kaltmiete": 850.00,
  "betriebskosten": 120.50,
  "kaution_betrag": 2550.00,
  "start_datum": "2024-01-15",
  "ende_datum": null,
  "lastschrift": true,
  "bankkonto_mieter": "DE89 3704 0044 0532 0130 00",
  "ruecklastschrift_gebuehr": 7.50,
  "verwendungszweck": "Miete Wohnung 12",
  "strom_einzug": 12345,
  "gas_einzug": 23456,
  "kaltwasser_einzug": 34567,
  "warmwasser_einzug": 45678
}`;

// Datensparsam: Einkommen, Arbeitgeber, Schufa-Angaben und Vorvermieter
// braucht der Vertrag nicht — sie werden gar nicht erst zurückgegeben.
const PROMPT_SELBSTAUSKUNFT = `Du liest eine deutsche Mieterselbstauskunft (Bewerbung um eine Mietwohnung).
Gib NUR die Angaben zurück, die für einen Mietvertrag gebraucht werden:

- personen: zuerst der Mietinteressent bzw. die Mietinteressenten aus dem Kopf des Formulars,
  danach alle weiteren Personen, die laut Formular mit einziehen sollen.
  Je Person: vorname, nachname, geburtsdatum (YYYY-MM-DD), strasse, hausnummer, plz, ort
  (aktuelle Anschrift; steht bei einer weiteren Person keine eigene, dann null), telefon, email,
  ist_interessent (true für Personen aus dem Kopf des Formulars, false für weitere Personen),
  verhaeltnis (Verwandtschaftsverhältnis laut Formular, sonst null).
- einzug_ab: gewünschter Einzug als YYYY-MM-DD, "sofort" oder null.
- objekt_adresse: die Adresse des Mietobjekts, für das sich beworben wird, sonst null.

Gib KEINE Angaben zu Einkommen, Beruf, Arbeitgeber, Familienstand, Vorvermieter, Mietrückständen,
Räumungsklagen, Zwangsvollstreckung, Insolvenz, Sozialleistungen oder SCHUFA zurück.
Trenne "Nachname, Vorname" korrekt; Doppelnamen bleiben zusammen.

Antworte NUR mit einem JSON-Objekt ohne Erklärungen, fehlende Werte als null:
{
  "personen": [
    { "vorname": "Erika", "nachname": "Muster Beispiel", "geburtsdatum": "1995-03-01",
      "strasse": "Hauptstraße", "hausnummer": "2C", "plz": "30455", "ort": "Hannover",
      "telefon": "0151 1234567", "email": "erika@example.de", "ist_interessent": true, "verhaeltnis": null }
  ],
  "einzug_ab": "2026-11-01",
  "objekt_adresse": "Musterweg 12, 30851 Langenhagen"
}`;

const PROMPT_VORVERTRAG = `Du liest einen deutschen Wohnraummietvertrag. Seine Werte dienen als Vorlage für den
Nachfolgevertrag derselben Wohnung. Gib NUR Angaben zur Mietsache und zu den Kosten zurück, keine
Angaben zu den Mietern.

- einheit_bezeichnung: Kennung der Wohnung, z. B. "WE9" (sonst null)
- lage: Lage im Gebäude ohne Kennung, z. B. "DG rechts" (sonst null)
- raumaufstellung: Aufzählung der Räume wie im Vertrag, z. B. "1 Zimmer, 1 Wohnküche, 1 Badezimmer, 1 Abstellraum"
- wohnflaeche_qm: Zahl
- schliessanlage: "zentral" oder "einzel", NUR wenn im Vertrag eine der Möglichkeiten angekreuzt ist ([x]), sonst null
- kaltmiete: monatliche Nettokaltmiete als Zahl
- betriebskosten_vorauszahlung: Summe der monatlichen Betriebskosten-Vorauszahlung OHNE Heizkosten
- heizkosten_vorauszahlung: monatliche Heizkostenvorauszahlung, wenn getrennt ausgewiesen, sonst null
- betriebskosten_positionen: jede Zeile der Kostenaufstellung nach Betriebskostenverordnung
  (Nummern 2.1 bis 2.19) mit nummer (z. B. "2.1"), betrag (monatlicher Betrag als Zahl) und umgelegt.
  Ein Strich ("-----", "– – –") heißt umgelegt=false und betrag=null. "0,00" heißt umgelegt=true und betrag=0.
- kaution: Kautionsbetrag als Zahl
- mietbeginn: YYYY-MM-DD
- mindestlaufzeit_monate: vereinbarte Mindestmietdauer bzw. beidseitiger Kündigungsverzicht in Monaten
  (z. B. "auf unbestimmte Zeit, mindestens jedoch 12 Monate" ergibt 12), sonst null

Beträge immer als Zahl mit Punkt als Dezimaltrenner. Antworte NUR mit einem JSON-Objekt ohne
Erklärungen, fehlende Werte als null:
{
  "einheit_bezeichnung": "WE9", "lage": "DG rechts",
  "raumaufstellung": "1 Zimmer, 1 Wohnküche, 1 Badezimmer, 1 Abstellraum",
  "wohnflaeche_qm": 68, "schliessanlage": "zentral",
  "kaltmiete": 1000, "betriebskosten_vorauszahlung": 50, "heizkosten_vorauszahlung": 50,
  "betriebskosten_positionen": [ { "nummer": "2.1", "betrag": 5, "umgelegt": true },
                                 { "nummer": "2.7", "betrag": null, "umgelegt": false } ],
  "kaution": 3000, "mietbeginn": "2024-05-01", "mindestlaufzeit_monate": 12
}`;

const PROMPTS: Record<Art, { system: string; einleitung: string }> = {
  mietvertrag: {
    system: PROMPT_MIETVERTRAG,
    einleitung: 'Bitte analysiere dieses Mietvertragsdokument und extrahiere die relevanten Daten:',
  },
  selbstauskunft: {
    system: PROMPT_SELBSTAUSKUNFT,
    einleitung: 'Bitte lies diese Mieterselbstauskunft:',
  },
  vorvertrag: {
    system: PROMPT_VORVERTRAG,
    einleitung: 'Bitte lies diesen Mietvertrag:',
  },
};

function antwort(body: unknown, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Prüft den Anfragekörper. Was nicht passt, wird gemeldet, nicht still weggelassen.
 * Ältere Oberflächen schicken ein einzelnes `fileContent`; das gilt weiter.
 */
// deno-lint-ignore no-explicit-any
function pruefeEingabe(body: any): { art: Art; textContent: string; bilder: string[] } | { fehler: string } {
  const art: Art = ARTEN.includes(body?.art) ? body.art : 'mietvertrag';
  const textContent = typeof body?.textContent === 'string' ? body.textContent.trim() : '';
  if (textContent.length > MAX_TEXT_ZEICHEN) {
    return { fehler: 'Das Dokument enthält zu viel Text, um es in einem Schritt auszulesen. Bitte den Vertrag ohne Anlagen hochladen.' };
  }

  const bilderRoh: unknown[] = Array.isArray(body?.fileContents)
    ? body.fileContents
    : typeof body?.fileContent === 'string' && body.fileContent.length > 0 ? [body.fileContent] : [];
  const bilder: string[] = [];
  for (const b of bilderRoh) {
    if (typeof b !== 'string' || b.length < 100 || (!b.startsWith('/9j/') && !b.startsWith('iVBOR'))) {
      return { fehler: 'Ungültiges Bildformat. Bitte lade ein klares JPG oder PNG hoch.' };
    }
    bilder.push(b);
  }
  if (bilder.reduce((summe, b) => summe + b.length, 0) > MAX_BILDER_ZEICHEN) {
    return { fehler: `Das Dokument (${bilder.length} Seiten) ist zu groß, um es in einem Schritt auszulesen. Bitte den Vertrag ohne Anlagen hochladen.` };
  }

  const text = textContent.length > 10 ? textContent : '';
  if (!text && bilder.length === 0) {
    return { fehler: 'Kein verwertbarer Inhalt im Dokument gefunden. Bitte lade ein textbasiertes PDF oder ein klares Bild hoch.' };
  }
  return { art, textContent: text, bilder };
}

/**
 * Textebene und Seitenbilder gehen zusammen an die KI. Bis 28.10.2026 galt entweder-oder: Hatte ein
 * PDF eine Textebene, sah die KI handschriftlich eingetragene Beträge und Zählerstände nie.
 */
function baueNutzernachricht(einleitung: string, textContent: string, bilder: string[]) {
  if (bilder.length === 0) {
    return { role: 'user', content: `${einleitung}\n\n${textContent}` };
  }
  const kopf = [
    einleitung,
    `Es folgen ${bilder.length === 1 ? 'ein Seitenbild' : `${bilder.length} Seitenbilder`}. ` +
      'Lies jede Seite vollständig, viele Angaben stehen erst auf späteren Seiten.',
    textContent
      ? 'Die Textebene unten enthält nur den getippten Text. Handschriftliche Einträge, Ankreuzungen und ' +
        'Stempel stehen nur in den Seitenbildern; fehlt eine Angabe in der Textebene, suche sie dort.'
      : '',
    textContent ? `Textebene:\n${textContent}` : '',
  ].filter(Boolean).join('\n\n');
  return {
    role: 'user',
    content: [
      { type: 'text', text: kopf },
      ...bilder.flatMap((b, i) => [
        { type: 'text', text: `Seitenbild ${i + 1} von ${bilder.length}:` },
        { type: 'image_url', image_url: { url: `data:${b.startsWith('iVBOR') ? 'image/png' : 'image/jpeg'};base64,${b}` } },
      ]),
    ],
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth check
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return antwort({ error: 'Unauthorized' }, corsHeaders, 401);
  }
  const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: authError } = await authClient.auth.getUser();
  if (authError || !userData?.user?.id) {
    return antwort({ error: 'Unauthorized' }, corsHeaders, 401);
  }

  // Mieterdaten und Selbstauskünfte sind Verwaltungsarbeit — wie Mieter,
  // Verträge und Dokumente nur für Admins (RLS gilt dort ebenso).
  try {
    const rollenClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: istAdmin, error: rolleError } = await rollenClient.rpc('is_admin', { _user_id: userData.user.id });
    if (rolleError || istAdmin !== true) {
      return antwort({ error: 'Nur Administratoren dürfen Dokumente auslesen lassen.' }, corsHeaders, 403);
    }
  } catch (e) {
    console.error('Rollenprüfung fehlgeschlagen:', e instanceof Error ? e.message : e);
    return antwort({ error: 'Die Berechtigung konnte nicht geprüft werden.' }, corsHeaders, 500);
  }

  try {
    const eingabe = pruefeEingabe(await req.json());
    if ('fehler' in eingabe) {
      return antwort({ success: false, error: eingabe.fehler }, corsHeaders);
    }
    const { art, textContent, bilder } = eingabe;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Kein Dokumentinhalt im Log: Selbstauskünfte und Verträge enthalten Personendaten.
    const bildZeichen = bilder.reduce((summe, b) => summe + b.length, 0);
    console.log(`Dokument wird gelesen: Art ${art}, Text ${textContent.length} Zeichen, ${bilder.length} Bild(er), ${Math.round(bildZeichen / 1024)} KB`);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODELL,
        messages: [
          { role: "system", content: PROMPTS[art].system },
          baueNutzernachricht(PROMPTS[art].einleitung, textContent, bilder),
        ],
        max_tokens: MAX_AUSGABE_TOKEN,
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(KI_ZEITLIMIT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status);

      if (response.status === 429) {
        return antwort({ success: false, error: "Rate-Limit erreicht. Bitte versuche es in einer Minute erneut." }, corsHeaders);
      }
      if (response.status === 402) {
        return antwort({ success: false, error: "AI-Credits aufgebraucht. Bitte Credits aufladen." }, corsHeaders);
      }
      if (response.status === 413) {
        return antwort({ success: false, error: "Das Dokument ist für die KI zu groß. Bitte den Vertrag ohne Anlagen hochladen oder die Angaben von Hand erfassen." }, corsHeaders);
      }

      let friendly = "AI-Verarbeitung fehlgeschlagen.";
      try {
        if (response.status === 400) {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.message?.includes("Failed to extract")) {
            friendly = "Das hochgeladene PDF konnte nicht als Bild gelesen werden. Bitte lade ein klares JPG/PNG hoch oder ein textbasiertes PDF.";
          }
        }
      } catch (_) { /* ignore */ }

      return antwort({ success: false, error: friendly, extractedData: {}, fieldsExtracted: 0, confidence: 'low' }, corsHeaders);
    }

    const aiResult = await response.json();
    if (aiResult.choices?.[0]?.finish_reason === 'length') {
      console.error(`KI-Antwort bei ${MAX_AUSGABE_TOKEN} Token abgeschnitten`);
      return antwort(
        { success: false, error: 'Die Antwort der KI war unvollständig. Bitte erneut versuchen oder die Angaben von Hand erfassen.', extractedData: {} },
        corsHeaders
      );
    }
    const extractedText = aiResult.choices?.[0]?.message?.content;

    if (!extractedText) {
      throw new Error("No content extracted from AI response");
    }

    // deno-lint-ignore no-explicit-any
    let extractedData: any;
    try {
      const cleanedText = extractedText.replace(/```json\n?|\n?```/g, '').trim();
      extractedData = JSON.parse(cleanedText);
    } catch (_parseError) {
      console.error("KI-Antwort ist kein gültiges JSON");
      throw new Error("Could not parse extracted data as JSON");
    }

    const { daten, felder } =
      art === 'selbstauskunft' ? normalisiereSelbstauskunft(extractedData)
      : art === 'vorvertrag' ? normalisiereVorvertrag(extractedData)
      : normalisiereMietvertrag(extractedData);

    console.log(`Dokument gelesen: Art ${art}, ${felder} Felder`);

    return antwort({
      success: true,
      art,
      extractedData: daten,
      confidence: felder >= 5 ? 'high' : felder >= 2 ? 'medium' : 'low',
      fieldsExtracted: felder,
    }, corsHeaders);

  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      console.error(`KI-Antwort nach ${KI_ZEITLIMIT_MS / 1000} s abgebrochen`);
      return antwort(
        { success: false, error: 'Das Auslesen hat länger als zwei Minuten gedauert und wurde abgebrochen. Bitte erneut versuchen oder die Angaben von Hand erfassen.', extractedData: {} },
        corsHeaders
      );
    }
    // Interne Ursachen (fehlender Schlüssel, kaputte KI-Antwort) nur ins Log, nicht in den Browser
    console.error("OCR processing error:", error instanceof Error ? error.message : error);
    return antwort(
      { success: false, error: 'Das Dokument konnte nicht ausgelesen werden. Bitte die Angaben von Hand erfassen.', extractedData: {} },
      corsHeaders
    );
  }
});

// ─── Normalisierung ─────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
type Roh = any;

function zahl(v: Roh): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[€\s]/g, '');
  // „1.000,50" deutsch, „1000.50" englisch, „1.250" deutsch ohne Nachkommastellen
  const tausenderOhneKomma = /^-?\d{1,3}(\.\d{3})+$/.test(s);
  const n = Number(s.includes(',') || tausenderOhneKomma ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
}

function datum(v: Roh): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function text(v: Roh): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function normalisiereMietvertrag(extractedData: Roh) {
  let fieldsExtracted = 0;
  const validatedData: Roh = {};

  if (Array.isArray(extractedData.mieter) && extractedData.mieter.length > 0) {
    validatedData.mieter = extractedData.mieter.map((m: Roh) => ({
      vorname: m.vorname || '',
      nachname: m.nachname || '',
      hauptmail: m.hauptmail || '',
      telnr: m.telnr || '',
      geburtsdatum: m.geburtsdatum || '',
      rolle: m.rolle === 'mitmieter' ? 'mitmieter' : 'hauptmieter',
    }));
    fieldsExtracted += validatedData.mieter.length;
  }

  for (const key of ['kaltmiete', 'betriebskosten', 'kaution_betrag', 'ruecklastschrift_gebuehr', 'strom_einzug', 'gas_einzug', 'kaltwasser_einzug', 'warmwasser_einzug']) {
    if (extractedData[key] != null && !isNaN(Number(extractedData[key]))) {
      validatedData[key] = Number(extractedData[key]);
      fieldsExtracted++;
    }
  }

  for (const key of ['start_datum', 'ende_datum']) {
    if (datum(extractedData[key])) {
      validatedData[key] = extractedData[key];
      fieldsExtracted++;
    }
  }

  for (const key of ['verwendungszweck', 'bankkonto_mieter']) {
    if (extractedData[key] && typeof extractedData[key] === 'string') {
      validatedData[key] = extractedData[key].trim();
      fieldsExtracted++;
    }
  }

  if (typeof extractedData.lastschrift === 'boolean') {
    validatedData.lastschrift = extractedData.lastschrift;
    fieldsExtracted++;
  }

  return { daten: validatedData, felder: fieldsExtracted };
}

function normalisiereSelbstauskunft(roh: Roh) {
  const personen = (Array.isArray(roh?.personen) ? roh.personen : [])
    .map((p: Roh) => ({
      vorname: text(p?.vorname) ?? '',
      nachname: text(p?.nachname) ?? '',
      geburtsdatum: datum(p?.geburtsdatum),
      strasse: text(p?.strasse),
      hausnummer: text(p?.hausnummer),
      plz: text(p?.plz),
      ort: text(p?.ort),
      telefon: text(p?.telefon),
      email: text(p?.email),
      ist_interessent: p?.ist_interessent === true,
      verhaeltnis: text(p?.verhaeltnis),
    }))
    .filter((p: Roh) => p.vorname || p.nachname);

  // Ohne Kennzeichnung gilt die erste Person als Interessent
  if (personen.length > 0 && !personen.some((p: Roh) => p.ist_interessent)) {
    personen[0].ist_interessent = true;
  }

  const einzug = roh?.einzug_ab === 'sofort' ? 'sofort' : datum(roh?.einzug_ab);
  const daten = {
    personen,
    einzug_ab: einzug,
    objekt_adresse: text(roh?.objekt_adresse),
  };
  return { daten, felder: personen.length + (einzug ? 1 : 0) };
}

function normalisiereVorvertrag(roh: Roh) {
  const positionen = (Array.isArray(roh?.betriebskosten_positionen) ? roh.betriebskosten_positionen : [])
    .map((p: Roh) => {
      const nummer = typeof p?.nummer === 'string' ? p.nummer.trim() : String(p?.nummer ?? '');
      const betrag = zahl(p?.betrag);
      return {
        nummer,
        umgelegt: p?.umgelegt === false ? false : betrag !== null,
        betrag: p?.umgelegt === false ? null : betrag,
      };
    })
    .filter((p: Roh) => /^2\.\d{1,2}$/.test(p.nummer));

  const schliessanlage = roh?.schliessanlage === 'zentral' || roh?.schliessanlage === 'einzel' ? roh.schliessanlage : null;

  const daten = {
    einheit_bezeichnung: text(roh?.einheit_bezeichnung),
    lage: text(roh?.lage),
    raumaufstellung: text(roh?.raumaufstellung),
    wohnflaeche_qm: zahl(roh?.wohnflaeche_qm),
    schliessanlage,
    kaltmiete: zahl(roh?.kaltmiete),
    betriebskosten_vorauszahlung: zahl(roh?.betriebskosten_vorauszahlung),
    heizkosten_vorauszahlung: zahl(roh?.heizkosten_vorauszahlung),
    betriebskosten_positionen: positionen,
    kaution: zahl(roh?.kaution),
    mietbeginn: datum(roh?.mietbeginn),
    // Mehr als vier Jahre wäre als Formularklausel ohnehin unwirksam
    mindestlaufzeit_monate: (() => {
      const m = zahl(roh?.mindestlaufzeit_monate);
      return m !== null && m > 0 && m <= 48 ? Math.round(m) : null;
    })(),
  };

  const felder = Object.entries(daten).filter(([k, v]) =>
    k === 'betriebskosten_positionen' ? positionen.length > 0 : v !== null
  ).length;
  return { daten, felder };
}
