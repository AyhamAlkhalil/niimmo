import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// BG-Zahlung IBAN (Jobcenter/Sozialamt - immer gleiche IBAN vom Staat)
const BG_ZAHLUNG_IBAN = "DE94760000000076001601";

// ============= ROBUSTER BETRAGSPARSER =============

/**
 * Parst Beträge aus deutschen und englischen Formaten:
 * "1.250,00" → 1250.00  (DE mit Tausender)
 * "1,250.00" → 1250.00  (EN mit Tausender)
 * "1250,50"  → 1250.50  (DE ohne Tausender)
 * "1250.50"  → 1250.50  (EN ohne Tausender)
 * "5000 00"  → 5000.00  (Leerzeichen als Dezimal)
 * "-1.250,00"→ -1250.00 (Negativ)
 * "1.250,00-"→ -1250.00 (Negativ hinten)
 */
function parseAmount(raw: string | number): number {
  if (typeof raw === "number") return raw;
  if (!raw || typeof raw !== "string") return 0;

  let s = raw.trim();

  // Vorzeichen erkennen (vorne oder hinten)
  let negative = false;
  if (s.startsWith("-")) { negative = true; s = s.substring(1).trim(); }
  else if (s.endsWith("-")) { negative = true; s = s.slice(0, -1).trim(); }

  // Leerzeichen als Dezimaltrenner erkennen: "5000 00" → "5000.00"
  const spaceDecimalMatch = s.match(/^(\d+)\s(\d{2})$/);
  if (spaceDecimalMatch) {
    const val = parseFloat(`${spaceDecimalMatch[1]}.${spaceDecimalMatch[2]}`);
    return negative ? -val : val;
  }

  // Alle Leerzeichen entfernen
  s = s.replace(/\s/g, "");

  // Bestimme ob Komma oder Punkt der Dezimaltrenner ist
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma > lastDot) {
    // Komma ist Dezimaltrenner (DE-Format): "1.250,00" oder "250,50"
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    // Punkt ist Dezimaltrenner (EN-Format): "1,250.00" oder "250.50"
    s = s.replace(/,/g, "");
  } else {
    // Nur eines oder keines vorhanden
    s = s.replace(",", ".");
  }

  const val = parseFloat(s);
  if (isNaN(val)) return 0;
  return negative ? -val : val;
}

// ============= HASH-BASIERTE DUPLIKATERKENNUNG =============

async function computePaymentHash(payment: Payment): Promise<string> {
  const raw = [
    payment.buchungsdatum || "",
    String(payment.betrag),
    (payment.iban || "").trim(),
    (payment.verwendungszweck || "").trim(),
    (payment.empfaengername || "").trim()
  ].join("|");

  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ============= INTERFACES =============

interface Payment {
  buchungsdatum: string;
  wertstellungsdatum?: string;
  betrag: number;
  iban: string;
  verwendungszweck: string;
  empfaengername?: string;
}

interface ProcessedPayment extends Payment {
  mietvertrag_id: string | null;
  kategorie: string;
  zuordnungsgrund: string;
  confidence: number;
  selected?: boolean; // For UI checkbox state
}

interface ContractInfo {
  id: string;
  mieter: string;
  mieterNamen: string[]; // Array of individual names for fuzzy matching
  gesamtmiete: number;
  kaution: number | null;
  iban: string | null;
  weitere_iban: string | null;
  verwendungszweck: string[] | null;
  immobilie: string;
  etage: string | null;
  status: string;
  start_datum: string | null;
  ende_datum: string | null;
}

interface NichtmieteRegel {
  id: string;
  regel_typ: "empfaenger_contains" | "empfaenger_equals" | "iban_equals" | "verwendungszweck_contains";
  wert: string;
  beschreibung: string | null;
  aktiv: boolean;
}

interface SonderfallRegel {
  id: string;
  name: string;
  beschreibung: string | null;
  match_typ: "name_in_verwendungszweck" | "iban_equals" | "verwendungszweck_contains";
  match_wert: string;
  ziel_kategorie: string;
  ziel_mieter_name: string | null;
  confidence: number;
  aktiv: boolean;
}

interface NameMatchCandidate {
  contract: ContractInfo;
  matchedNames: string[];
  matchedParts: number;
}

// ============= FUZZY MATCHING (Levenshtein Distance) =============

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

function fuzzyMatch(text: string, searchTerm: string, maxDistance: number = 1): boolean {
  if (!text || !searchTerm) return false;
  
  // Require minimum 4 characters for matching to avoid false positives
  if (searchTerm.length < 4) return false;
  
  const textLower = text.toLowerCase();
  const searchLower = searchTerm.toLowerCase();
  
  // Exact substring match - this is reliable
  if (textLower.includes(searchLower)) return true;
  
  // For fuzzy matching, be MUCH more strict to avoid false positives
  // Only allow fuzzy match for longer names (6+ chars) with max 1 distance
  if (searchLower.length < 6) return false;
  
  // Split into words and check each - require near-exact match
  const words = textLower.split(/\s+/);
  for (const word of words) {
    // Word must be similar length to search term (±2 chars)
    if (Math.abs(word.length - searchLower.length) > 2) continue;
    
    if (word.length >= 5 && searchLower.length >= 5) {
      const distance = levenshteinDistance(word, searchLower);
      // Much stricter: only allow 1 character difference for names 6+ chars
      if (distance <= maxDistance) return true;
    }
  }
  
  return false;
}

// ============= AI CALL =============

async function callAI(systemPrompt: string, userPrompt: string): Promise<any> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY nicht konfiguriert");

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "assign_payment",
            description: "Ordne eine Zahlung einem Mietvertrag zu und kategorisiere sie",
            parameters: {
              type: "object",
              properties: {
                mietvertrag_id: { 
                  type: "string", 
                  description: "UUID des zugeordneten Mietvertrags oder null wenn nicht zuordenbar" 
                },
                kategorie: {
                  type: "string",
                  enum: ["Miete", "Mietkaution", "Rücklastschrift", "Nichtmiete", "Ignorieren", "Betriebskostenabrechnung"],
                  description: "Kategorie der Zahlung. 'Betriebskostenabrechnung' nur bei Jahres-/Nebenkostenabrechnungen (Nachzahlung oder Erstattung), nicht bei laufenden monatlichen Nebenkosten-Vorauszahlungen."
                },
                zuordnungsgrund: {
                  type: "string",
                  description: "Kurze Begründung für die Zuordnung"
                },
                confidence: {
                  type: "number",
                  description: "Konfidenz der Zuordnung (0-100)"
                }
              },
              required: ["kategorie", "zuordnungsgrund", "confidence"],
              additionalProperties: false
            }
          }
        }
      ],
      tool_choice: { type: "function", function: { name: "assign_payment" } },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("AI Gateway Error:", response.status, errorText);
    throw new Error(`AI Gateway Error: ${response.status}`);
  }

  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  
  if (toolCall?.function?.arguments) {
    return JSON.parse(toolCall.function.arguments);
  }
  
  throw new Error("Keine gültige AI-Antwort erhalten");
}

// ============= DB CONTEXT LOADING =============

async function getNichtmieteRegeln(supabase: any): Promise<NichtmieteRegel[]> {
  const { data, error } = await supabase
    .from("nichtmiete_regeln")
    .select("*")
    .eq("aktiv", true);
  
  if (error) {
    console.error("Error fetching nichtmiete_regeln:", error);
    return [];
  }
  
  return data || [];
}

async function getSonderfallRegeln(supabase: any): Promise<SonderfallRegel[]> {
  const { data, error } = await supabase
    .from("sonderfall_regeln")
    .select("*")
    .eq("aktiv", true);
  
  if (error) {
    console.error("Error fetching sonderfall_regeln:", error);
    return [];
  }
  
  return data || [];
}

async function getContractContext(supabase: any): Promise<ContractInfo[]> {
  // Also include beendet contracts for proper date-based matching
  const { data: contracts, error } = await supabase
    .from("mietvertrag")
    .select(`
      id,
      kaltmiete,
      betriebskosten,
      kaution_betrag,
      bankkonto_mieter,
      weitere_bankkonten,
      verwendungszweck,
      status,
      start_datum,
      ende_datum,
      einheit_id,
      einheiten!inner (
        id,
        etage,
        immobilie_id,
        immobilien!inner (
          id,
          name,
          adresse
        )
      ),
      mietvertrag_mieter (
        mieter (
          id,
          vorname,
          nachname
        )
      )
    `)
    .in("status", ["aktiv", "gekuendigt", "beendet"]);

  if (error) {
    console.error("Error fetching contracts:", error);
    return [];
  }

  return contracts.map((c: any) => {
    const mieterNamesSet = new Set<string>();
    const mieterDisplay: string[] = [];

    c.mietvertrag_mieter?.forEach((mm: any) => {
      const vorname = mm.mieter?.vorname || "";
      const nachname = mm.mieter?.nachname || "";
      const fullName = `${vorname} ${nachname}`.trim();
      if (fullName) {
        mieterDisplay.push(fullName);
        // Add individual parts for fuzzy matching — deduped, damit z.B. zwei
        // Mitmieter mit demselben Nachnamen die matchedParts-Zählung beim
        // Namen-Match nicht künstlich aufblähen (ein Nachname zählt nur einmal).
        if (vorname) mieterNamesSet.add(vorname.toLowerCase());
        if (nachname) mieterNamesSet.add(nachname.toLowerCase());
      }
    });

    const immobilie = c.einheiten?.immobilien;
    const gesamtmiete = (c.kaltmiete || 0) + (c.betriebskosten || 0);

    return {
      id: c.id,
      mieter: mieterDisplay.join(", ") || "Unbekannt",
      mieterNamen: Array.from(mieterNamesSet),
      gesamtmiete,
      kaution: c.kaution_betrag,
      iban: c.bankkonto_mieter,
      weitere_iban: c.weitere_bankkonten,
      verwendungszweck: c.verwendungszweck,
      immobilie: immobilie ? `${immobilie.name}, ${immobilie.adresse}` : "Unbekannt",
      etage: c.einheiten?.etage,
      status: c.status,
      start_datum: c.start_datum,
      ende_datum: c.ende_datum
    };
  });
}

// ============= CATEGORIZATION WITH DB RULES =============

function categorizePaymentType(
  payment: Payment, 
  regeln: NichtmieteRegel[]
): "retoure" | "nichtmiete" | "bg_zahlung" | "standard" {
  const verwendungszweck = payment.verwendungszweck || "";
  const empfaenger = payment.empfaengername || "";
  
  // 1. BG-Zahlung (Jobcenter) - IBAN-Match hat höchste Priorität
  if (payment.iban === BG_ZAHLUNG_IBAN) {
    return "bg_zahlung";
  }
  
  // 2. Check DB rules
  for (const regel of regeln) {
    switch (regel.regel_typ) {
      case "verwendungszweck_contains":
        // Special case: Rücklastschrift detection
        if (verwendungszweck.includes(regel.wert)) {
          if (regel.wert.toLowerCase().includes("retoure") || 
              regel.wert.toLowerCase().includes("rücklastschrift") ||
              regel.wert.toLowerCase().includes("lastschrift")) {
            return "retoure";
          }
          return "nichtmiete";
        }
        break;
      case "empfaenger_contains":
        if (empfaenger.includes(regel.wert)) {
          return "nichtmiete";
        }
        break;
      case "empfaenger_equals":
        if (empfaenger === regel.wert) {
          return "nichtmiete";
        }
        break;
      case "iban_equals":
        if (payment.iban === regel.wert) {
          return "nichtmiete";
        }
        break;
    }
  }
  
  return "standard";
}

// ============= RULE-BASED MATCHING =============

const BETRAG_TOLERANZ = 5; // ±5€ tolerance

// ============= SONDERFALL-PRÜFUNG (DB-basiert) =============

function checkSonderfallRegeln(
  payment: Payment, 
  sonderfallRegeln: SonderfallRegel[], 
  contracts: ContractInfo[]
): ProcessedPayment | null {
  const verwendungszweck = (payment.verwendungszweck || "").toLowerCase();
  
  for (const regel of sonderfallRegeln) {
    let matched = false;
    const wertLower = regel.match_wert.toLowerCase();
    
    switch (regel.match_typ) {
      case "name_in_verwendungszweck":
        matched = verwendungszweck.includes(wertLower);
        break;
      case "iban_equals":
        matched = (payment.iban || "").trim() === regel.match_wert.trim();
        break;
      case "verwendungszweck_contains":
        matched = verwendungszweck.includes(wertLower);
        break;
    }
    
    if (!matched) continue;
    
    // Finde passenden Vertrag wenn ziel_mieter_name gesetzt
    let targetContract: ContractInfo | null = null;
    if (regel.ziel_mieter_name) {
      const nameLower = regel.ziel_mieter_name.toLowerCase();
      const matchingContracts = contracts.filter(c =>
        c.mieterNamen.some(n => n.includes(nameLower) || nameLower.includes(n))
      );
      targetContract = selectBestContractByDate(payment, matchingContracts);
    }
    
    console.log(`Sonderfall-Regel "${regel.name}" greift für Zahlung: ${payment.verwendungszweck}`);
    
    return {
      ...payment,
      mietvertrag_id: targetContract?.id || null,
      kategorie: regel.ziel_kategorie,
      zuordnungsgrund: `Sonderfall-Regel: ${regel.name}`,
      confidence: regel.confidence,
      selected: true
    };
  }
  
  return null;
}

// Helper to check if a payment date falls within a contract's period
function isPaymentInContractPeriod(paymentDate: string, contract: ContractInfo): boolean {
  const buchungsDatum = new Date(paymentDate);
  
  // Contract must have start_datum
  if (!contract.start_datum) return false;
  
  const startDate = new Date(contract.start_datum);
  // Allow payments from 1 month before start (for first month rent)
  const adjustedStart = new Date(startDate);
  adjustedStart.setMonth(adjustedStart.getMonth() - 1);
  
  if (buchungsDatum < adjustedStart) return false;
  
  // If contract has end_datum, check if payment is before or at end (+1 month grace for final payments)
  if (contract.ende_datum) {
    const endDate = new Date(contract.ende_datum);
    const adjustedEnd = new Date(endDate);
    adjustedEnd.setMonth(adjustedEnd.getMonth() + 1);
    if (buchungsDatum > adjustedEnd) return false;
  }
  
  return true;
}

// Select best contract from multiple IBAN matches based on payment date and amount
function selectBestContractByDate(payment: Payment, matchingContracts: ContractInfo[]): ContractInfo | null {
  if (matchingContracts.length === 0) return null;
  if (matchingContracts.length === 1) return matchingContracts[0];
  
  const buchungsDatum = payment.buchungsdatum;
  console.log(`Multiple IBAN matches (${matchingContracts.length}) for payment date ${buchungsDatum}, selecting best match...`);
  
  // Filter by date range
  const validByDate = matchingContracts.filter(c => isPaymentInContractPeriod(buchungsDatum, c));
  
  if (validByDate.length === 1) {
    console.log(`Selected contract ${validByDate[0].id} (${validByDate[0].mieter}) based on date range`);
    return validByDate[0];
  }
  
  // Multiple contracts valid for this date - try amount matching first
  const candidates = validByDate.length > 1 ? validByDate : matchingContracts;
  
  if (candidates.length > 1) {
    // BETRAG-MATCH: Bei gleicher IBAN, schaue welcher Vertrag zum Betrag passt
    const amountMatches = candidates.filter(c => 
      Math.abs(c.gesamtmiete - payment.betrag) <= BETRAG_TOLERANZ && payment.betrag > 0
    );
    
    if (amountMatches.length === 1) {
      console.log(`Selected contract ${amountMatches[0].id} (${amountMatches[0].mieter}) based on AMOUNT match (${payment.betrag} ≈ ${amountMatches[0].gesamtmiete})`);
      return amountMatches[0];
    }
    
    // Also check Kaution match
    const kautionMatches = candidates.filter(c =>
      c.kaution && Math.abs(payment.betrag - c.kaution) <= BETRAG_TOLERANZ && payment.betrag > 0
    );
    if (kautionMatches.length === 1) {
      console.log(`Selected contract ${kautionMatches[0].id} (${kautionMatches[0].mieter}) based on KAUTION amount match (${payment.betrag} ≈ ${kautionMatches[0].kaution})`);
      return kautionMatches[0];
    }
    
    // Fall back to status priority
    const statusPriority: Record<string, number> = { "aktiv": 0, "gekuendigt": 1, "beendet": 2 };
    candidates.sort((a, b) => (statusPriority[a.status] ?? 99) - (statusPriority[b.status] ?? 99));
    console.log(`Selected contract ${candidates[0].id} (${candidates[0].mieter}) - status: ${candidates[0].status} (no unique amount match)`);
    return candidates[0];
  }
  
  // No valid date match - fall back to aktiv status
  const activeContract = matchingContracts.find(c => c.status === "aktiv");
  if (activeContract) {
    console.log(`No date match, falling back to active contract ${activeContract.id} (${activeContract.mieter})`);
    return activeContract;
  }
  
  // Last resort: first contract
  console.log(`No clear match, using first contract ${matchingContracts[0].id} (${matchingContracts[0].mieter})`);
  return matchingContracts[0];
}

// Erkennt ob ein Verwendungszweck auf eine Betriebskostenabrechnung hinweist.
// Wichtig: verhindert, dass BKA-Zahlungen via IBAN/Namen-Match als "Miete" landen.
function isBetriebskostenabrechnung(verwendungszweck: string): boolean {
  const vz = verwendungszweck.toLowerCase();
  return vz.includes("betriebskostenabrechnung") ||
         vz.includes("nebenkostenabrechnung") ||
         vz.includes("bk-abrechnung") ||
         vz.includes("bk abrechnung") ||
         vz.includes("jahresabrechnung nebenkosten") ||
         vz.includes("jahresabrechnung betriebskosten") ||
         vz.includes("nachzahlung betriebskosten") ||
         vz.includes("nachzahlung nebenkosten") ||
         vz.includes("erstattung betriebskosten") ||
         vz.includes("erstattung nebenkosten");
}

// Rücklastschrift-Texte enthalten kaum je den Mieternamen, aber fast immer das
// zurückgebuchte Mieterkonto eingebettet, z.B.:
// "... ORG.BETR.: 1.550,00 EUR IBAN: DE30269513110091833327 BIC: NOLADE21GFW"
// Das ist bei mehreren Einheiten derselben Adresse (z.B. Reihenhäuser 18a-18e
// unter einer gemeinsamen `immobilien.adresse`) der einzige zuverlässige Anker —
// Adresse und Betrag allein reichen dort nicht, um die Einheit sicher zu bestimmen.

// Bekannte IBAN-Gesamtlängen (Länge = Ländercode + Prüfziffer + BBAN). Erlaubt,
// eine IBAN aus Fließtext exakt abzuschneiden — auch wenn sie mit Leerzeichen
// gruppiert ist ("DE30 2695 ...") oder ohne Trenner direkt an ein folgendes
// Label anschließt ("...8333327BIC:..."), statt Leerzeichen zu übersehen oder
// das nachfolgende Label mit in die IBAN zu ziehen.
const IBAN_LAENGEN: Record<string, number> = {
  DE: 22, AT: 20, CH: 21, NL: 18, BE: 16, FR: 27, LU: 20,
  IT: 27, ES: 24, PL: 28, DK: 18, GB: 22, PT: 25, FI: 18, SE: 24, NO: 15,
  // Restliche SEPA-/EU-Länder (ISO 13616) — vervollständigt, damit die
  // Längen-Trunkierung nicht nur für die häufigsten Länder greift.
  IE: 22, CZ: 24, SK: 24, HR: 21, BG: 22, RO: 24, GR: 27, CY: 28, MT: 31,
  EE: 20, LT: 20, LV: 21, SI: 19, HU: 28, IS: 26, LI: 21, GI: 23, AD: 24,
  MC: 27, SM: 27,
};

function extractLabeledIbans(text: string | null | undefined): string[] {
  if (!text) return [];
  const ibans: string[] = [];
  // Label case-insensitiv, optional durch Doppelpunkt/Bindestrich getrennt
  const labelRegex = /iban\s*[:\-]?\s*/gi;
  let labelMatch: RegExpExecArray | null;

  while ((labelMatch = labelRegex.exec(text)) !== null) {
    const start = labelMatch.index + labelMatch[0].length;
    // Grosszügiges Fenster: IBANs sind max. 34 Zeichen, mit Gruppen-Leerzeichen
    // (je 4 Zeichen) bis zu ~45 Zeichen lang im Rohtext
    const window = text.slice(start, start + 45);
    const rawMatch = window.match(/^(?:[A-Za-z0-9]\s?)+/);
    if (!rawMatch) continue;

    const stripped = rawMatch[0].replace(/\s+/g, "").toUpperCase();
    const countryMatch = stripped.match(/^([A-Z]{2})\d{2}[A-Z0-9]+/);
    if (!countryMatch) continue;

    const knownLength = IBAN_LAENGEN[countryMatch[1]];
    const iban = stripped.slice(0, knownLength ?? 34);

    // Grundplausibilität: Ländercode + 2 Prüfziffern + mind. 11 weitere Zeichen
    if (/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
      ibans.push(iban);
    }
  }

  return [...new Set(ibans)];
}

function matchRuecklastschriftByVerwendungszweckIban(
  payment: Payment,
  contracts: ContractInfo[]
): ProcessedPayment | null {
  // BG-IBAN ausschließen — mehrere Verträge teilen sich die staatliche
  // Jobcenter/Bürgergeld-IBAN, ein Match darauf sagt nichts über den
  // konkreten Mieter aus (gleiche Ausnahme wie beim IBAN-Match in
  // matchPaymentByRules).
  const embeddedIbans = extractLabeledIbans(payment.verwendungszweck).filter(i => i !== BG_ZAHLUNG_IBAN);
  if (embeddedIbans.length === 0) return null;

  const matchingContracts = contracts.filter(c =>
    (c.iban && c.iban !== BG_ZAHLUNG_IBAN && embeddedIbans.includes(c.iban)) ||
    (c.weitere_iban && c.weitere_iban.split(",").map(i => i.trim()).filter(i => i !== BG_ZAHLUNG_IBAN).some(i => embeddedIbans.includes(i)))
  );
  if (matchingContracts.length === 0) return null;

  const bestContract = selectBestContractByDate(payment, matchingContracts);
  if (!bestContract) return null;

  // Mehrdeutig, wenn mehrere Verträge auf die IBAN gepasst haben und erst per
  // Datum/Betrag/Status disambiguiert werden mussten — ein aus Fließtext
  // extrahierter Wert ist ein schwächeres Signal als ein strukturiertes
  // IBAN-Feld, daher hier NICHT automatisch mit hoher Konfidenz übernehmen.
  const wasAmbiguous = matchingContracts.length > 1;
  const matchedIban = embeddedIbans.find(i =>
    i === bestContract.iban ||
    (bestContract.weitere_iban && bestContract.weitere_iban.split(",").map(x => x.trim()).includes(i))
  ) ?? embeddedIbans[0];
  const multiInfo = wasAmbiguous ? ` (1 von ${matchingContracts.length} IBAN-Treffern, nach Datum/Betrag ausgewählt — bitte prüfen)` : '';

  console.log(`Rücklastschrift: Mieter-IBAN "${matchedIban}" im Verwendungszweck gefunden → ${bestContract.mieter}${wasAmbiguous ? ` [mehrdeutig, ${matchingContracts.length} Kandidaten]` : ''}`);

  return {
    ...payment,
    mietvertrag_id: bestContract.id,
    kategorie: "Rücklastschrift",
    zuordnungsgrund: `Rücklastschrift: Mieter-IBAN "${matchedIban}" im Verwendungszweck-Text für ${bestContract.mieter}${multiInfo}`,
    confidence: wasAmbiguous ? 70 : 95,
    selected: !wasAmbiguous
  };
}

function matchPaymentByRules(payment: Payment, contracts: ContractInfo[], sonderfallRegeln?: SonderfallRegel[]): ProcessedPayment | null {
  const verwendungszweck = payment.verwendungszweck?.toLowerCase() || "";
  const empfaenger = payment.empfaengername?.toLowerCase() || "";

  // SONDERFALL-REGELN aus DB (ersetzt hardcoded Sonderfälle)
  if (sonderfallRegeln && sonderfallRegeln.length > 0) {
    const sonderfallResult = checkSonderfallRegeln(payment, sonderfallRegeln, contracts);
    if (sonderfallResult) return sonderfallResult;
  }

  // BKA-Keyword-Check: Muss VOR IBAN/Namen-Match stehen, damit eine Betriebskosten-
  // abrechnung nicht fälschlich als "Miete" kategorisiert wird.
  const bka = isBetriebskostenabrechnung(verwendungszweck);

  // 1. IBAN-Match (highest priority - includes weitere_bankkonten)
  // Collect ALL matching contracts first, then select best one by date
  // WICHTIG: BG-IBAN ausschließen — Verträge mit der staatlichen BG-IBAN dürfen nicht per IBAN gematcht werden
  const ibanMatchedContracts: { contract: ContractInfo; matchType: 'primary' | 'weitere' }[] = [];
  
  for (const contract of contracts) {
    // Primary IBAN — skip if it's the BG-IBAN (staatliche Zahlung, nicht mieter-spezifisch)
    if (contract.iban && payment.iban === contract.iban && contract.iban !== BG_ZAHLUNG_IBAN) {
      ibanMatchedContracts.push({ contract, matchType: 'primary' });
    }
    
    // Weitere Bankkonten (comma-separated) — also skip BG-IBAN entries
    if (contract.weitere_iban) {
      const weitereIbans = contract.weitere_iban.split(',').map(i => i.trim()).filter(i => i !== BG_ZAHLUNG_IBAN);
      if (weitereIbans.includes(payment.iban)) {
        ibanMatchedContracts.push({ contract, matchType: 'weitere' });
      }
    }
  }
  
  if (ibanMatchedContracts.length > 0) {
    // Select best contract considering payment date
    const matchingContracts = ibanMatchedContracts.map(m => m.contract);
    const bestContract = selectBestContractByDate(payment, matchingContracts);
    
    if (bestContract) {
      const matchInfo = ibanMatchedContracts.find(m => m.contract.id === bestContract.id);
      const kautionImText = verwendungszweck.includes("kaution") ||
                            verwendungszweck.includes("depot") ||
                            verwendungszweck.includes("sicherheitsleistung") ||
                            verwendungszweck.includes("mietkaution");
      const isKaution = kautionImText &&
                        bestContract.kaution &&
                        Math.abs(payment.betrag - bestContract.kaution) <= BETRAG_TOLERANZ;
      const matchType = matchInfo?.matchType === 'weitere' ? 'Weitere IBAN' : 'IBAN';
      const multiInfo = ibanMatchedContracts.length > 1 ? ` (1 von ${ibanMatchedContracts.length} Verträgen, ausgewählt nach Datum)` : '';
      const kategorie = isKaution ? "Mietkaution" : bka ? "Betriebskostenabrechnung" : "Miete";
      return {
        ...payment,
        mietvertrag_id: bestContract.id,
        kategorie,
        zuordnungsgrund: `${matchType}-Match: ${bestContract.mieter}${multiInfo}`,
        confidence: matchInfo?.matchType === 'weitere' ? 90 : 95,
        selected: true
      };
    }
  }
  
  // 2. Verwendungszweck-Match (contract's keywords in payment)
  for (const contract of contracts) {
    if (contract.verwendungszweck && Array.isArray(contract.verwendungszweck)) {
      for (const vzweck of contract.verwendungszweck) {
        if (vzweck && verwendungszweck.includes(vzweck.toLowerCase())) {
          const kautionImText = verwendungszweck.includes("kaution") ||
                                verwendungszweck.includes("depot") ||
                                verwendungszweck.includes("sicherheitsleistung") ||
                                verwendungszweck.includes("mietkaution");
          const isKaution = kautionImText &&
                            contract.kaution &&
                            Math.abs(payment.betrag - contract.kaution) <= BETRAG_TOLERANZ;
          const kategorie = isKaution ? "Mietkaution" : bka ? "Betriebskostenabrechnung" : "Miete";
          return {
            ...payment,
            mietvertrag_id: contract.id,
            kategorie,
            zuordnungsgrund: `Verwendungszweck-Match: "${vzweck}" für ${contract.mieter}`,
            confidence: 85,
            selected: true
          };
        }
      }
    }
  }
  
  // 3. STRICT Name-Match (tenant name in verwendungszweck or empfänger)
  // Collect ALL candidate contracts first — don't return on the first hit.
  // Mehrere Mieter teilen sich oft einen Vornamen (z.B. "Michael Piper" vs.
  // "Michael Rittweger"). Wer zuerst in `contracts` steht und nur den
  // Vornamen matcht, hätte sonst gewonnen, bevor der eigentlich richtige
  // Vertrag (Vor- UND Nachname treffen) überhaupt geprüft wird.
  const nameMatchCandidates: NameMatchCandidate[] = [];

  for (const contract of contracts) {
    const mieterNamen = contract.mieterNamen;

    // Skip if no names available
    if (!mieterNamen || mieterNamen.length === 0) continue;

    // For each name, require EXACT substring match (no fuzzy for names)
    let matchedParts = 0;
    const matchedNames: string[] = [];

    for (const name of mieterNamen) {
      // Require minimum 4 characters for name matching
      if (name.length < 4) continue;

      // EXACT substring match only - no fuzzy matching for names
      if (verwendungszweck.includes(name) || empfaenger.includes(name)) {
        matchedParts++;
        matchedNames.push(name);
      }
    }

    // Require at least 2 name parts matched (e.g., first AND last name)
    // OR one distinctive name (6+ chars) that's unlikely to be coincidental
    // Lowered from 7 to 6 chars for names like "Razgeen"
    if (matchedParts >= 2 || (matchedParts === 1 && matchedNames[0]?.length >= 6)) {
      console.log(`Name-Match Kandidat: "${matchedNames.join(', ')}" (${matchedParts} Teile) für ${contract.mieter}`);
      nameMatchCandidates.push({ contract, matchedNames, matchedParts });
    }
  }

  if (nameMatchCandidates.length > 0) {
    const topScore = Math.max(...nameMatchCandidates.map(c => c.matchedParts));
    const topCandidates = nameMatchCandidates.filter(c => c.matchedParts === topScore);

    // Ambiguous: mehrere Mieter mit demselben (schwachen) Treffer — z.B. zwei
    // Mieter heißen "Michael" und im Text steht nur der Vorname. Hier nicht
    // raten, sondern an Orts-/Betrags-Match bzw. KI/manuelle Prüfung übergeben.
    const ambiguousSingleNameTie = topScore === 1 && topCandidates.length > 1;

    if (ambiguousSingleNameTie) {
      console.log(`Name-Match: ${topCandidates.length} Mieter teilen sich Namensteil "${topCandidates[0].matchedNames[0]}" — zu unsicher für Auto-Zuordnung`);
    } else {
      // Seltene Restfälle (z.B. zwei Verträge mit identischem Vor- UND
      // Nachnamen) genauso auflösen wie IBAN-Mehrfachtreffer: über Datum/Betrag/Status.
      let winner: NameMatchCandidate;
      if (topCandidates.length === 1) {
        winner = topCandidates[0];
      } else {
        const bestId = selectBestContractByDate(payment, topCandidates.map(t => t.contract))?.id;
        winner = topCandidates.find(c => c.contract.id === bestId) ?? topCandidates[0];
      }

      const { contract, matchedNames, matchedParts } = winner;
      const kautionInText = verwendungszweck.includes("kaution") ||
                            verwendungszweck.includes("depot") ||
                            verwendungszweck.includes("sicherheitsleistung") ||
                            verwendungszweck.includes("mietkaution");
      const kautionBetragMatch = contract.kaution ? Math.abs(payment.betrag - contract.kaution) <= BETRAG_TOLERANZ : false;
      const isKaution = kautionInText && contract.kaution && kautionBetragMatch;
      const nameKategorie = isKaution ? "Mietkaution" : bka ? "Betriebskostenabrechnung" : "Miete";
      const multiInfo = topCandidates.length > 1 ? ` (1 von ${topCandidates.length} gleichwertigen Treffern, nach Datum/Betrag ausgewählt)` : '';
      console.log(`Name-Match gewählt: ${contract.mieter} (matchedParts=${matchedParts}, Kandidaten gesamt=${nameMatchCandidates.length})`);
      return {
        ...payment,
        mietvertrag_id: contract.id,
        kategorie: nameKategorie,
        zuordnungsgrund: `Namen-Match: "${matchedNames.join(', ')}" für ${contract.mieter}${multiInfo}`,
        confidence: matchedParts >= 2 ? 90 : 80,
        selected: true
      };
    }
  }
  
  // 4. Location/Street-Match (property address keywords in verwendungszweck)
  // Dynamisch aus Immobilien-Daten extrahiert statt hardcoded
  for (const contract of contracts) {
    const immobilie = contract.immobilie.toLowerCase();
    // Extrahiere relevante Wörter aus Immobilien-Name und Adresse (mind. 4 Zeichen, keine Zahlen)
    const locationWords = immobilie
      .split(/[\s,.\-\/]+/)
      .filter(w => w.length >= 6 && !/^\d+$/.test(w))
      // Filtere generische Wörter raus die zu False-Positives führen
      .filter(w => !["straße", "strasse", "gasse", "platz", "ring", "allee", "graben", "nord", "sued", "west", "ost", "neue", "alte", "objekt"].includes(w));

    for (const keyword of locationWords) {
      if (verwendungszweck.includes(keyword)) {
        console.log(`Location-Match found: "${keyword}" for ${contract.mieter} at ${contract.immobilie}`);
        return {
          ...payment,
          mietvertrag_id: contract.id,
          kategorie: bka ? "Betriebskostenabrechnung" : "Miete",
          zuordnungsgrund: `Orts-Match: "${keyword}" für ${contract.mieter}`,
          confidence: 75,
          selected: true
        };
      }
    }
  }

  // 5. Amount-Match with tolerance (LAST RESORT - only if unique match and NO other indicators)
  // This should be the weakest signal!
  const amountMatches = contracts.filter(c =>
    Math.abs(c.gesamtmiete - payment.betrag) <= BETRAG_TOLERANZ && payment.betrag > 0
  );

  if (amountMatches.length === 1) {
    const contract = amountMatches[0];
    const kautionImText = verwendungszweck.includes("kaution") ||
                          verwendungszweck.includes("depot") ||
                          verwendungszweck.includes("sicherheitsleistung") ||
                          verwendungszweck.includes("mietkaution");
    const isKaution = kautionImText &&
                      contract.kaution &&
                      Math.abs(payment.betrag - contract.kaution) <= BETRAG_TOLERANZ;
    // LOW confidence - user should verify!
    return {
      ...payment,
      mietvertrag_id: contract.id,
      kategorie: isKaution ? "Mietkaution" : bka ? "Betriebskostenabrechnung" : "Miete",
      zuordnungsgrund: `⚠️ NUR Betrags-Match (±${BETRAG_TOLERANZ}€): ${contract.gesamtmiete}€ - BITTE PRÜFEN!`,
      confidence: 40, // Lowered from 60 to 40!
      selected: false, // NOT auto-selected!
    };
  }
  
  return null;
}

// ============= BG-ZAHLUNG REGELBASIERTES MATCHING =============

/**
 * Dediziertes regelbasiertes Matching für BG-Zahlungen (Bundesagentur für Arbeit / Jobcenter).
 * BG-Zahlungen enthalten IMMER den Mieternamen im Verwendungszweck.
 * 
 * Strategie:
 * 1. Jeden Vertragsnachnamen (≥4 Zeichen) als exakten Substring im Verwendungszweck suchen
 * 2. Fuzzy-Matching (Levenshtein ≤1) für Schreibvarianten (z.B. "Hickes" ↔ "Hickey")
 * 3. Adress-Match als Tiebreaker bei mehreren Namens-Treffern
 * 4. Kaution-Erkennung wenn "Kaution" im Text + Betrag passt
 */
function matchBGPaymentByName(payment: Payment, contracts: ContractInfo[]): ProcessedPayment | null {
  const verwendungszweck = (payment.verwendungszweck || "").toLowerCase();
  
  if (!verwendungszweck) return null;
  
  interface BGMatch {
    contract: ContractInfo;
    matchedName: string;
    isExact: boolean; // exact substring vs fuzzy
    exactMatchCount: number; // how many name parts matched exactly (higher = better)
    hasAddressMatch: boolean;
  }
  
  const matches: BGMatch[] = [];
  
  for (const contract of contracts) {
    if (!contract.mieterNamen || contract.mieterNamen.length === 0) continue;

    // Count ALL matching name parts instead of breaking at the first hit.
    // A contract where BOTH "michael" AND "piper" match scores higher than one
    // where only "michael" matches (e.g. Michael Rittweger sharing a first name).
    let exactMatchCount = 0;
    let fuzzyMatchCount = 0;
    let bestNameMatch: { name: string; isExact: boolean } | null = null;

    const words = verwendungszweck.split(/[\s\/,.\-;:]+/).filter(w => w.length >= 4);

    for (const name of contract.mieterNamen) {
      // Only match names ≥4 chars to avoid false positives with short first names
      if (name.length < 4) continue;

      // 1. Exact substring match
      if (verwendungszweck.includes(name)) {
        exactMatchCount++;
        if (!bestNameMatch) bestNameMatch = { name, isExact: true };
        continue;
      }

      // 2. Fuzzy match — catches "Hickes" ↔ "Hickey", "Vaduva" ↔ "Waduva" etc.
      for (const word of words) {
        if (Math.abs(word.length - name.length) > 2) continue;
        const distance = levenshteinDistance(word, name);
        if (distance <= 1 && distance > 0) {
          fuzzyMatchCount++;
          if (!bestNameMatch) bestNameMatch = { name, isExact: false };
          break;
        }
      }
    }

    if (!bestNameMatch) continue;
    
    // Check for address match as tiebreaker
    let hasAddressMatch = false;
    const immobilieLower = contract.immobilie.toLowerCase();
    // Extract meaningful location words from immobilie (≥4 chars, no pure numbers)
    const locationWords = immobilieLower
      .split(/[\s,.\-\/]+/)
      .filter(w => w.length >= 6 && !/^\d+$/.test(w))
      .filter(w => !["straße", "strasse", "gasse", "platz", "ring", "allee", "graben", "nord", "sued", "west", "ost", "neue", "alte", "objekt"].includes(w));
    
    for (const locWord of locationWords) {
      if (verwendungszweck.includes(locWord)) {
        hasAddressMatch = true;
        break;
      }
    }
    
    matches.push({
      contract,
      matchedName: bestNameMatch.name,
      isExact: bestNameMatch.isExact,
      exactMatchCount,
      hasAddressMatch,
    });
  }
  
  if (matches.length === 0) return null;
  
  // Select best match
  let bestMatch: BGMatch;
  
  if (matches.length === 1) {
    bestMatch = matches[0];
  } else {
    // Multiple matches — prioritize: exactMatchCount (most name parts) > address > exact > fuzzy
    matches.sort((a, b) => {
      // Most name parts matched wins (e.g. "michael" + "piper" beats "michael" only)
      if (b.exactMatchCount !== a.exactMatchCount) return b.exactMatchCount - a.exactMatchCount;
      const scoreA = (a.isExact ? 2 : 0) + (a.hasAddressMatch ? 1 : 0);
      const scoreB = (b.isExact ? 2 : 0) + (b.hasAddressMatch ? 1 : 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      // Tiebreak by contract status (aktiv > gekündigt > beendet)
      const statusPriority: Record<string, number> = { "aktiv": 0, "gekuendigt": 1, "beendet": 2 };
      return (statusPriority[a.contract.status] ?? 99) - (statusPriority[b.contract.status] ?? 99);
    });
    bestMatch = matches[0];
    console.log(`BG-Match: ${matches.length} Kandidaten, gewählt: ${bestMatch.contract.mieter} (exactCount=${bestMatch.exactMatchCount}, address=${bestMatch.hasAddressMatch})`);
  }

  // Also filter by date if possible
  const dateValidMatches = matches.filter(m => isPaymentInContractPeriod(payment.buchungsdatum, m.contract));
  if (dateValidMatches.length === 1) {
    bestMatch = dateValidMatches[0];
  } else if (dateValidMatches.length > 1) {
    // Re-sort date-valid matches with same priority
    dateValidMatches.sort((a, b) => {
      if (b.exactMatchCount !== a.exactMatchCount) return b.exactMatchCount - a.exactMatchCount;
      const scoreA = (a.isExact ? 2 : 0) + (a.hasAddressMatch ? 1 : 0);
      const scoreB = (b.isExact ? 2 : 0) + (b.hasAddressMatch ? 1 : 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      const statusPriority: Record<string, number> = { "aktiv": 0, "gekuendigt": 1, "beendet": 2 };
      return (statusPriority[a.contract.status] ?? 99) - (statusPriority[b.contract.status] ?? 99);
    });
    bestMatch = dateValidMatches[0];
  }
  
  // Determine category: Kaution or Miete
  let kategorie = "Miete";
  const kautionInText = verwendungszweck.includes("kaution") ||
                        verwendungszweck.includes("depot") ||
                        verwendungszweck.includes("sicherheitsleistung") ||
                        verwendungszweck.includes("mietkaution");
  if (kautionInText && bestMatch.contract.kaution &&
      Math.abs(payment.betrag - bestMatch.contract.kaution) <= BETRAG_TOLERANZ) {
    kategorie = "Mietkaution";
  }
  
  const confidence = bestMatch.isExact ? 90 : 80;
  const matchDetail = bestMatch.isExact ? "Exakter Namens-Match" : "Fuzzy-Namens-Match";
  const addressDetail = bestMatch.hasAddressMatch ? " + Adress-Match" : "";
  
  console.log(`BG-Zahlung regelbasiert zugeordnet: "${bestMatch.matchedName}" → ${bestMatch.contract.mieter} (${matchDetail}${addressDetail}, confidence=${confidence})`);
  
  return {
    ...payment,
    mietvertrag_id: bestMatch.contract.id,
    kategorie,
    zuordnungsgrund: `BG-Zahlung ${matchDetail}${addressDetail}: "${bestMatch.matchedName}" → ${bestMatch.contract.mieter}`,
    confidence,
    selected: true
  };
}

// ============= AI PROCESSING =============

async function processBGZahlung(
  payment: Payment, 
  contractContext: string
): Promise<ProcessedPayment> {
  const systemPrompt = `Du bist ein Experte für die Zuordnung von BG-Zahlungen (Bürgergeld/Jobcenter) in einer Immobilienverwaltung.

KONTEXT - Aktive Mietverträge:
${contractContext}

AUFGABE:
Analysiere die Zahlung vom Jobcenter/Sozialamt und ordne sie dem richtigen Mieter zu.
- Extrahiere den Mieternamen aus dem Verwendungszweck
- Vergleiche mit den Mieternamen in den Verträgen
- Prüfe ob der Betrag zur Miete oder Kaution passt
- Bei "Kaution" im Verwendungszweck UND passendem Betrag → "Mietkaution"
- Sonst → "Miete"
- BG-Zahlungen sind IMMER Mietzahlungen oder Mietkautionen, NIEMALS Nichtmiete!`;

  const userPrompt = `BG-Zahlung (Jobcenter) analysieren:
- Betrag: ${payment.betrag} €
- Verwendungszweck: ${payment.verwendungszweck}
- Datum: ${payment.buchungsdatum}

Finde den passenden Mieter und kategorisiere die Zahlung. Dies ist IMMER eine Miete oder Mietkaution!`;

  try {
    const result = await callAI(systemPrompt, userPrompt);
    // BG-Zahlungen sind NIEMALS Nichtmiete — override if AI says so
    let kategorie = result.kategorie || "Miete";
    if (kategorie === "Nichtmiete" || kategorie === "Ignorieren") {
      kategorie = "Miete";
      console.log(`BG-Zahlung AI override: Kategorie "${result.kategorie}" → "Miete" (BG-Zahlungen sind immer Miete)`);
    }
    return {
      ...payment,
      mietvertrag_id: result.mietvertrag_id || null,
      kategorie,
      zuordnungsgrund: result.zuordnungsgrund,
      confidence: result.confidence,
      selected: true
    };
  } catch (error) {
    console.error("BG-Zahlung AI Error:", error);
    return {
      ...payment,
      mietvertrag_id: null,
      kategorie: "Miete",
      zuordnungsgrund: "AI-Fehler bei BG-Zahlung",
      confidence: 0,
      selected: false
    };
  }
}

async function processRuecklastschrift(
  payment: Payment, 
  contractContext: string
): Promise<ProcessedPayment> {
  const systemPrompt = `Du bist ein Experte für die Zuordnung von Rücklastschriften in einer Immobilienverwaltung.

KONTEXT - Aktive Mietverträge:
${contractContext}

AUFGABE:
Analysiere die Rücklastschrift und finde den zugehörigen Mietvertrag.
- Suche im Verwendungszweck nach Hinweisen auf Objekt, Einheit oder Mietername
- Die Original-Lastschrift wurde vom Mieterkonto eingezogen und dann zurückgebucht
- Kategorie ist IMMER "Rücklastschrift"`;

  const userPrompt = `Rücklastschrift analysieren:
- Betrag: ${payment.betrag} €
- IBAN: ${payment.iban}
- Verwendungszweck: ${payment.verwendungszweck}
- Empfänger: ${payment.empfaengername || "N/A"}
- Datum: ${payment.buchungsdatum}`;

  try {
    const result = await callAI(systemPrompt, userPrompt);
    return {
      ...payment,
      mietvertrag_id: result.mietvertrag_id || null,
      kategorie: "Rücklastschrift",
      zuordnungsgrund: result.zuordnungsgrund,
      confidence: result.confidence,
      selected: true
    };
  } catch (error) {
    console.error("Rücklastschrift AI Error:", error);
    return {
      ...payment,
      mietvertrag_id: null,
      kategorie: "Rücklastschrift",
      zuordnungsgrund: "AI-Fehler bei Rücklastschrift",
      confidence: 0,
      selected: false
    };
  }
}

// ============= STANDARD PAYMENT AI PROCESSING =============

async function processStandardPayment(
  payment: Payment, 
  contractContext: string,
  nichtmieteVerdacht: boolean = false
): Promise<ProcessedPayment> {
  const verwendungszweck = (payment.verwendungszweck || "").toLowerCase();
  
  // Check if payment looks like rent or BKA based on keywords
  const looksLikeRent = verwendungszweck.includes("miete") ||
                        verwendungszweck.includes("miet") ||
                        verwendungszweck.includes("bv.") ||
                        isBetriebskostenabrechnung(verwendungszweck);
  
  if (!looksLikeRent && !nichtmieteVerdacht) {
    // Doesn't look like rent, skip AI
    return {
      ...payment,
      mietvertrag_id: null,
      kategorie: "Nichtmiete",
      zuordnungsgrund: "Keine Miet-Keywords erkannt",
      confidence: 50,
      selected: false
    };
  }

  const nichtmieteHinweis = nichtmieteVerdacht 
    ? `\n\nHINWEIS: Diese Zahlung wurde regelbasiert als mögliche Nichtmiete erkannt (Empfänger/Verwendungszweck passt zu bekannten Versorgern, Kommunen oder Darlehen). Prüfe trotzdem sorgfältig, ob es sich vielleicht doch um eine Mietzahlung handelt. Im Zweifelsfall kategorisiere als "Nichtmiete".`
    : '';

  const systemPrompt = `Du bist ein Experte für die Zuordnung von Mietzahlungen in einer Immobilienverwaltung.

KONTEXT - Aktive Mietverträge:
${contractContext}

AUFGABE:
Analysiere diese Zahlung und ordne sie dem richtigen Mieter zu.
- Extrahiere Namen aus dem Verwendungszweck (z.B. "Miete Salo Razgeen" → Suche nach "Salo" oder "Razgeen")
- Extrahiere Adressen/Immobilien-Namen aus dem KONTEXT oben und suche nach Übereinstimmungen im Verwendungszweck
- WICHTIG: Wenn "Miete" im Text steht, ist es IMMER eine Mietzahlung, NIEMALS Nichtmiete!
- Bei Kaution im Text UND passendem Betrag → Mietkaution
- Bei Mieternamen im Text → Miete für diesen Mieter
- Kommunale Zahlungen (Grundsteuer, Straßenreinigung, Schmutzwasser, Regenwasser) von Stadtkassen sind KEINE Mietzahlungen, auch wenn der Ortsname einer Immobilie vorkommt!
- Zahlungen an Versorgungsunternehmen, Versicherungen, Banken sind in der Regel Nichtmiete${nichtmieteHinweis}`;

  const userPrompt = `Zahlung analysieren:
- Betrag: ${payment.betrag} €
- IBAN: ${payment.iban}
- Verwendungszweck: ${payment.verwendungszweck}
- Empfänger: ${payment.empfaengername || "N/A"}
- Datum: ${payment.buchungsdatum}

Finde den passenden Mieter. Wenn "Miete" im Text steht, kategorisiere als "Miete"!`;

  try {
    const result = await callAI(systemPrompt, userPrompt);
    
    // Override: If "Miete" is in the text, force category to "Miete"
    let kategorie = result.kategorie || "Miete";
    if (verwendungszweck.includes("miete") && kategorie === "Nichtmiete") {
      kategorie = "Miete";
    }
    
    return {
      ...payment,
      mietvertrag_id: result.mietvertrag_id || null,
      kategorie: kategorie,
      zuordnungsgrund: result.zuordnungsgrund,
      confidence: result.confidence,
      selected: result.mietvertrag_id ? true : false
    };
  } catch (error) {
    console.error("Standard Payment AI Error:", error);
    // Fallback: If "Miete" in text, still categorize as Miete
    return {
      ...payment,
      mietvertrag_id: null,
      kategorie: verwendungszweck.includes("miete") ? "Miete" : "Nichtmiete",
      zuordnungsgrund: "AI-Fehler - manuelle Prüfung empfohlen",
      confidence: 0,
      selected: false
    };
  }
}

// ============= MAIN HANDLER =============

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth check
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { error: authError } = await authClient.auth.getUser();
  if (authError) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { payments, dryRun = true } = await req.json();

    if (!payments || !Array.isArray(payments)) {
      return new Response(
        JSON.stringify({ error: "payments Array erforderlich" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Received ${payments.length} payments (dryRun: ${dryRun})`);

    // Load DB rules, contracts, and sonderfall rules in parallel
    const [nichtmieteRegeln, contracts, sonderfallRegeln] = await Promise.all([
      getNichtmieteRegeln(supabase),
      getContractContext(supabase),
      getSonderfallRegeln(supabase)
    ]);
    
    console.log(`Loaded ${nichtmieteRegeln.length} Nichtmiete-Regeln, ${sonderfallRegeln.length} Sonderfall-Regeln, ${contracts.length} contracts`);
    const contractContextString = JSON.stringify(contracts, null, 2);
    
    // Build Nichtmiete-Regeln context for AI
    const nichtmieteRegelnContext = nichtmieteRegeln.length > 0
      ? `\n\nWICHTIG - Bekannte Nichtmiete-Empfänger/Muster (aus Datenbank-Regeln):\n${nichtmieteRegeln.map(r => `- Typ: ${r.regel_typ}, Wert: "${r.wert}"${r.beschreibung ? ` (${r.beschreibung})` : ''}`).join('\n')}\nDiese Muster deuten STARK auf Nichtmiete hin (z.B. Versorger, kommunale Abgaben, Darlehen, Erstattungen). Prüfe aber trotzdem den Kontext - in seltenen Fällen könnte eine Zahlung mit solchem Empfänger doch eine Miete sein.`
      : '';

    // ============= DUPLIKATSPRÜFUNG (Hash + Fallback) =============
    
    // Schritt 1: Hashes für alle eingehenden Zahlungen berechnen
    const paymentHashes = await Promise.all(
      payments.map(async (payment: Payment) => ({
        payment,
        hash: await computePaymentHash(payment)
      }))
    );
    
    // Schritt 2: Intra-Batch Duplikate erkennen (gleicher Hash im selben Upload)
    const seenHashes = new Set<string>();
    const intraBatchDuplicates: typeof paymentHashes = [];
    const uniqueInBatch: typeof paymentHashes = [];
    
    for (const item of paymentHashes) {
      if (seenHashes.has(item.hash)) {
        intraBatchDuplicates.push(item);
      } else {
        seenHashes.add(item.hash);
        uniqueInBatch.push(item);
      }
    }
    
    if (intraBatchDuplicates.length > 0) {
      console.log(`${intraBatchDuplicates.length} Intra-Batch-Duplikate entfernt`);
    }
    
    // Schritt 3: DB-Duplikatsprüfung (bestehend + Hash-Vergleich)
    const duplicateChecks = await Promise.all(
      uniqueInBatch.map(async ({ payment, hash }) => {
        const betrag = payment.betrag;
        const iban = payment.iban?.trim() || "";
        const verwendungszweck = payment.verwendungszweck?.trim() || "";

        const candidateDates = Array.from(
          new Set([payment.buchungsdatum, payment.wertstellungsdatum].filter(Boolean) as string[])
        );

        let match: { id: string } | undefined;

        // Primäre Prüfung: Exakter Match auf Datum + Betrag + IBAN + Verwendungszweck
        if (candidateDates.length > 0) {
          const { data } = await supabase
            .from("zahlungen")
            .select("id, iban, verwendungszweck, buchungsdatum, empfaengername")
            .eq("betrag", betrag)
            .in("buchungsdatum", candidateDates)
            .limit(50);

          const rows = (data as any[]) ?? [];
          
          // Hash-basierter Vergleich: Berechne Hash für jeden DB-Eintrag
          for (const row of rows) {
            const dbPayment: Payment = {
              buchungsdatum: row.buchungsdatum,
              betrag: row.betrag ?? betrag,
              iban: (row.iban ?? "").toString().trim(),
              verwendungszweck: (row.verwendungszweck ?? "").toString().trim(),
              empfaengername: (row.empfaengername ?? "").toString().trim()
            };
            const dbHash = await computePaymentHash(dbPayment);
            if (dbHash === hash) {
              match = { id: row.id };
              break;
            }
          }
          
          // Fallback: Klassischer Vergleich (IBAN + Verwendungszweck)
          if (!match) {
            match = rows.find((row) => {
              const dbIban = (row.iban ?? "").toString().trim();
              const dbVz = (row.verwendungszweck ?? "").toString().trim();
              return dbIban === iban && dbVz === verwendungszweck;
            });
          }
        }

        // Fallback: date drift ±5 days
        if (!match && payment.buchungsdatum) {
          const base = new Date(`${payment.buchungsdatum}T00:00:00Z`);
          if (!Number.isNaN(base.getTime())) {
            const from = new Date(base);
            from.setUTCDate(from.getUTCDate() - 5);
            const to = new Date(base);
            to.setUTCDate(to.getUTCDate() + 5);

            const fromIso = from.toISOString().slice(0, 10);
            const toIso = to.toISOString().slice(0, 10);

            const { data } = await supabase
              .from("zahlungen")
              .select("id, iban, verwendungszweck, buchungsdatum")
              .eq("betrag", betrag)
              .gte("buchungsdatum", fromIso)
              .lte("buchungsdatum", toIso)
              .limit(200);

            const rows = (data as any[]) ?? [];
            match = rows.find((row) => {
              const dbIban = (row.iban ?? "").toString().trim();
              const dbVz = (row.verwendungszweck ?? "").toString().trim();
              return dbIban === iban && dbVz === verwendungszweck;
            });
          }
        }

        return {
          payment,
          isDuplicate: !!match,
          existingId: match?.id || null,
        };
      })
    );

    const newPayments = duplicateChecks.filter(c => !c.isDuplicate).map(c => c.payment);
    const duplicates = [
      ...duplicateChecks.filter(c => c.isDuplicate).map(c => ({
        ...c.payment,
        existingId: c.existingId
      })),
      ...intraBatchDuplicates.map(({ payment }) => ({
        ...payment,
        existingId: null,
        zuordnungsgrund: "Intra-Batch-Duplikat"
      }))
    ];

    console.log(`Duplikatsprüfung: ${newPayments.length} neue, ${duplicates.length} bereits vorhanden (davon ${intraBatchDuplicates.length} Intra-Batch)`);

    if (newPayments.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          dryRun,
          stats: {
            total: payments.length,
            neue: 0,
            duplikate: duplicates.length,
            zugeordnet: 0,
            nicht_zugeordnet: 0,
            nach_kategorie: { miete: 0, mietkaution: 0, ruecklastschrift: 0, nichtmiete: 0, betriebskostenabrechnung: 0 },
            durchschnittliche_konfidenz: 0
          },
          results: [],
          duplicates
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: ProcessedPayment[] = [];
    const needsAI: { payment: Payment; type: string }[] = [];

    // PHASE 1: Fast rule-based matching
    for (const payment of newPayments) {
      // FIRST: Check DB-basierte Sonderfall-Regeln BEFORE any other logic
      const sonderfallResult = checkSonderfallRegeln(payment, sonderfallRegeln, contracts);
      if (sonderfallResult) {
        results.push(sonderfallResult);
        continue;
      }
      
      const paymentType = categorizePaymentType(payment, nichtmieteRegeln);
      
      if (paymentType === "nichtmiete") {
        // Statt hartem Block → an KI weiterleiten mit Nichtmiete-Hinweis
        needsAI.push({ payment, type: "nichtmiete_verdacht" });
      } else if (paymentType === "retoure") {
        const ibanTextMatch = matchRuecklastschriftByVerwendungszweckIban(payment, contracts);
        if (ibanTextMatch) {
          results.push(ibanTextMatch);
        } else {
          const ruleMatch = matchPaymentByRules(payment, contracts, sonderfallRegeln);
          if (ruleMatch) {
            results.push({
              ...ruleMatch,
              kategorie: "Rücklastschrift",
              zuordnungsgrund: `Rücklastschrift: ${ruleMatch.zuordnungsgrund}`
            });
          } else {
            needsAI.push({ payment, type: "retoure" });
          }
        }
      } else if (paymentType === "bg_zahlung") {
        // BG-Zahlung: Erst regelbasiertes Namens-Matching, dann KI als Fallback
        const bgMatch = matchBGPaymentByName(payment, contracts);
        if (bgMatch) {
          results.push(bgMatch);
        } else {
          console.log(`BG-Zahlung: Kein regelbasierter Match für "${payment.verwendungszweck}" — weiter an KI`);
          needsAI.push({ payment, type: "bg_zahlung" });
        }
      } else {
        const ruleMatch = matchPaymentByRules(payment, contracts, sonderfallRegeln);
        if (ruleMatch) {
          results.push(ruleMatch);
        } else {
          if (payment.betrag < 0) {
            results.push({
              ...payment,
              mietvertrag_id: null,
              kategorie: "Nichtmiete",
              zuordnungsgrund: "Abbuchung ohne Vertragszuordnung",
              confidence: 50,
              selected: true
            });
          } else {
            needsAI.push({ payment, type: "standard" });
          }
        }
      }
    }

    console.log(`Rule-based: ${results.length} matched, ${needsAI.length} need AI`);

    // PHASE 2: AI processing (limited batch)
    const MAX_AI_CALLS = 20;
    const aiQueue = needsAI.slice(0, MAX_AI_CALLS);
    const skippedAI = needsAI.slice(MAX_AI_CALLS);

    for (const { payment, type } of aiQueue) {
      let processed: ProcessedPayment;
      
      console.log(`AI Processing: ${payment.betrag}€, Type: ${type}`);
      
      if (type === "bg_zahlung") {
        processed = await processBGZahlung(payment, contractContextString + nichtmieteRegelnContext);
      } else if (type === "retoure") {
        processed = await processRuecklastschrift(payment, contractContextString + nichtmieteRegelnContext);
      } else if (type === "nichtmiete_verdacht") {
        // Regelbasiert als Nichtmiete erkannt, KI soll final entscheiden
        processed = await processStandardPayment(payment, contractContextString + nichtmieteRegelnContext, true);
      } else if (type === "standard") {
        processed = await processStandardPayment(payment, contractContextString + nichtmieteRegelnContext);
      } else {
        processed = {
          ...payment,
          mietvertrag_id: null,
          kategorie: "Nichtmiete",
          zuordnungsgrund: "Keine automatische Zuordnung möglich",
          confidence: 0,
          selected: false
        };
      }
      
      results.push(processed);
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    for (const { payment } of skippedAI) {
      // For skipped payments, check if they look like rent based on keywords
      const vzLower = (payment.verwendungszweck || "").toLowerCase();
      const looksLikeRent = vzLower.includes("miete") || vzLower.includes("miet") || vzLower.includes("bv.");
      
      results.push({
        ...payment,
        mietvertrag_id: null,
        kategorie: looksLikeRent ? "Miete" : "Nichtmiete",
        zuordnungsgrund: "Nicht verarbeitet (Batch-Limit) - manuelle Prüfung empfohlen",
        confidence: 0,
        selected: false
      });
    }

    // Optional: Save to DB if not dryRun
    if (!dryRun) {
      for (const result of results) {
        if (result.mietvertrag_id && result.selected !== false) {
          const { error } = await supabase
            .from("zahlungen")
            .update({
              mietvertrag_id: result.mietvertrag_id,
              kategorie: result.kategorie
            })
            .eq("buchungsdatum", result.buchungsdatum)
            .eq("betrag", result.betrag)
            .eq("iban", result.iban);

          if (error) {
            console.error("DB Update Error:", error);
          }
        }
      }
    }

    // Statistics
    const stats = {
      total: payments.length,
      neue: newPayments.length,
      duplikate: duplicates.length,
      zugeordnet: results.filter(r => r.mietvertrag_id).length,
      nicht_zugeordnet: results.filter(r => !r.mietvertrag_id).length,
      nach_kategorie: {
        miete: results.filter(r => r.kategorie === "Miete").length,
        mietkaution: results.filter(r => r.kategorie === "Mietkaution").length,
        ruecklastschrift: results.filter(r => r.kategorie === "Rücklastschrift").length,
        nichtmiete: results.filter(r => r.kategorie === "Nichtmiete").length,
        betriebskostenabrechnung: results.filter(r => r.kategorie === "Betriebskostenabrechnung").length,
      },
      durchschnittliche_konfidenz: results.length > 0 
        ? Math.round(results.reduce((sum, r) => sum + r.confidence, 0) / results.length)
        : 0
    };

    return new Response(
      JSON.stringify({ 
        success: true, 
        dryRun,
        stats,
        results,
        duplicates
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("process-payments error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
