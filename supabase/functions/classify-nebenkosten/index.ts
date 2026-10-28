import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// Auf 2.49.1 wie die übrigen Functions (28.10.2026, Projektregel: exakte, einheitliche Version).
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
 * PostgREST liefert still höchstens 1000 Zeilen. Bis zum 28.10.2026 lasen beide Abfragen ohne
 * range() — live 639 offene Nichtmiete-Zahlungen und 403 Klassifizierungen, ab 1000 hätten
 * still Daten gefehlt. Die Seiten laufen nacheinander mit eindeutiger Sortierung.
 */
const SEITENGROESSE = 1000;

async function alleSeiten<T>(
  seite: (von: number, bis: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const alle: T[] = [];
  for (let von = 0; ; von += SEITENGROESSE) {
    const { data, error } = await seite(von, von + SEITENGROESSE - 1);
    if (error) throw error;
    const zeilen = data ?? [];
    alle.push(...zeilen);
    if (zeilen.length < SEITENGROESSE) return alle;
  }
}

interface KlassifizierungZeile {
  zahlung_id: string;
  is_betriebskosten: boolean;
  confidence: string;
  category: string;
  suggested_immobilie_id: string | null;
  reasoning: string | null;
}

interface Zahlung {
  id: string;
  betrag: number;
  buchungsdatum: string;
  verwendungszweck: string | null;
  empfaengername: string | null;
  iban: string | null;
  kategorie: string | null;
  immobilie_id: string | null;
}

interface Immobilie {
  id: string;
  name: string;
  adresse: string;
}

interface ClassificationResult {
  zahlung_id: string;
  is_betriebskosten: boolean;
  confidence: "high" | "medium" | "low";
  category: string;
  suggested_immobilie_id: string | null;
  suggested_immobilie_name: string | null;
  reasoning: string;
  zahlung?: Zahlung;
}

// Regex patterns for filtering and classification
const EXCLUDE_PATTERNS = [
  /darlehen/i,
  /kredit/i,
  /tilgung/i,
  /zins(en)?/i,
  /bank\s*(geb|entgelt)/i,
  /kontoführung/i,
  /sollzins/i,
  /habenzins/i,
  /annuität/i,
  /hypothek/i,
  /baufinanzierung/i,
  /ratenkredit/i,
  /immobilienfinanzierung/i,
];

// Known utility providers - direct classification without AI
const BETRIEBSKOSTEN_PATTERNS: { pattern: RegExp; category: string }[] = [
  // Strom
  { pattern: /avacon/i, category: "Strom" },
  { pattern: /evi\s+energie/i, category: "Strom" },
  { pattern: /stadtwerk.*strom/i, category: "Strom" },
  { pattern: /enercity/i, category: "Strom" },
  { pattern: /e\.on/i, category: "Strom" },
  { pattern: /vattenfall/i, category: "Strom" },
  { pattern: /rwe/i, category: "Strom" },
  { pattern: /ewe.*strom/i, category: "Strom" },
  
  // Gas/Heizung
  { pattern: /stadtwerk.*gas/i, category: "Gas" },
  { pattern: /ewe.*gas/i, category: "Gas" },
  { pattern: /heizöl/i, category: "Heizung" },
  { pattern: /brennstoff/i, category: "Heizung" },
  { pattern: /fernwärme/i, category: "Heizung" },
  
  // Wasser/Abwasser
  { pattern: /wasserzweckverband/i, category: "Wasser" },
  { pattern: /wasserwerk/i, category: "Wasser" },
  { pattern: /wasserverband/i, category: "Wasser" },
  { pattern: /stadtwerk.*wasser/i, category: "Wasser" },
  { pattern: /abwasser/i, category: "Abwasser" },
  { pattern: /entwässerung/i, category: "Abwasser" },
  { pattern: /kanal(isation)?/i, category: "Abwasser" },
  
  // Müll
  { pattern: /müll/i, category: "Müll" },
  { pattern: /abfall/i, category: "Müll" },
  { pattern: /entsorgung/i, category: "Müll" },
  { pattern: /aha.*zweckverband/i, category: "Müll" },
  
  // Versicherung
  { pattern: /versicherung/i, category: "Versicherung" },
  { pattern: /haftpflicht/i, category: "Versicherung" },
  { pattern: /gebäudeversicherung/i, category: "Versicherung" },
  { pattern: /allianz/i, category: "Versicherung" },
  { pattern: /axa/i, category: "Versicherung" },
  { pattern: /huk.?coburg/i, category: "Versicherung" },
  
  // Grundsteuer
  { pattern: /grundsteuer/i, category: "Grundsteuer" },
  { pattern: /gemeinde.*steuer/i, category: "Grundsteuer" },
  { pattern: /stadt.*steuer/i, category: "Grundsteuer" },
  
  // Hausmeister/Wartung
  { pattern: /hausmeister/i, category: "Hausmeister" },
  { pattern: /schornsteinfeger/i, category: "Wartung" },
  { pattern: /kaminkehrer/i, category: "Wartung" },
  { pattern: /heizungswartung/i, category: "Wartung" },
  { pattern: /wartung/i, category: "Wartung" },
  { pattern: /gartenpflege/i, category: "Wartung" },
  { pattern: /winterdienst/i, category: "Wartung" },
  { pattern: /treppenhausreinigung/i, category: "Wartung" },
  
  // Generische Stadtwerke
  { pattern: /stadtwerk/i, category: "Strom" },
];

function classifyWithRegex(zahlung: Zahlung): ClassificationResult | null | undefined {
  const text = `${zahlung.empfaengername || ""} ${zahlung.verwendungszweck || ""}`;
  
  // Check if should be excluded (Darlehen etc.)
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(text)) {
      return null; // Skip this payment entirely
    }
  }
  
  // Check for known Betriebskosten patterns
  for (const { pattern, category } of BETRIEBSKOSTEN_PATTERNS) {
    if (pattern.test(text)) {
      return {
        zahlung_id: zahlung.id,
        is_betriebskosten: true,
        confidence: "high",
        category,
        suggested_immobilie_id: null,
        suggested_immobilie_name: null,
        reasoning: `Automatisch erkannt: ${category} (${zahlung.empfaengername || 'Unbekannt'})`,
        zahlung,
      };
    }
  }
  
  return undefined; // Needs AI classification
}

function tryMatchImmobilie(zahlung: Zahlung, immobilien: Immobilie[]): string | null {
  const text = `${zahlung.empfaengername || ""} ${zahlung.verwendungszweck || ""}`.toLowerCase();
  
  for (const imm of immobilien) {
    // Check if address parts are in the text
    const addressParts = imm.adresse.toLowerCase().split(/[\s,]+/).filter(p => p.length > 3);
    const nameParts = imm.name.toLowerCase().split(/[\s,]+/).filter(p => p.length > 3);
    
    for (const part of [...addressParts, ...nameParts]) {
      if (text.includes(part)) {
        return imm.id;
      }
    }
  }
  
  return null;
}

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
  const { data: userData, error: authError } = await authClient.auth.getUser();
  if (authError || !userData?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Die Antwort enthaelt ganze Zahlungszeilen (IBAN, Verwendungszweck, Betrag), die
  // Function liest und schreibt mit Service-Role. Bis zum 27.10.2026 genuegte jedes
  // Login -- der Hausmeister bekam so Zahlungsdaten, die ihm die RLS verwehrt, und
  // konnte mit force:true beliebig viele KI-Aufrufe ausloesen. Wie in send-mahnung.
  const rollenClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: istAdmin, error: rolleError } = await rollenClient.rpc('is_admin', { _user_id: userData.user.id });
  if (rolleError || istAdmin !== true) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const forceReclassify = body.force === true;

    // Fetch all unassigned Nichtmiete payments (seitenweise, siehe alleSeiten)
    const zahlungen = await alleSeiten<Zahlung>((von, bis) =>
      supabase
        .from("zahlungen")
        .select("*")
        .eq("kategorie", "Nichtmiete")
        .is("immobilie_id", null)
        .order("buchungsdatum", { ascending: false })
        .order("id")
        .range(von, bis)
    );

    // Fetch all Immobilien
    const { data: immobilien, error: immobilienError } = await supabase
      .from("immobilien")
      .select("id, name, adresse");

    if (immobilienError) throw immobilienError;

    // Fetch existing cached classifications (seitenweise, siehe alleSeiten)
    const existingClassifications = await alleSeiten<KlassifizierungZeile>((von, bis) =>
      supabase
        .from("nebenkosten_klassifizierungen")
        .select("*")
        .eq("bestaetigt", false)
        .eq("uebersprungen", false)
        .order("id")
        .range(von, bis)
    );

    const existingClassMap = new Map(
      (existingClassifications || []).map(c => [c.zahlung_id, c])
    );

    if (!zahlungen || zahlungen.length === 0) {
      return new Response(
        JSON.stringify({ 
          classifications: [], 
          excluded: [],
          message: "Keine unzugeordneten Zahlungen gefunden",
          immobilien: immobilien || [],
          from_cache: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter: which payments need classification?
    const needsClassification: Zahlung[] = [];
    const cachedResults: ClassificationResult[] = [];

    for (const zahlung of zahlungen) {
      const existing = existingClassMap.get(zahlung.id);
      
      if (existing && !forceReclassify) {
        // Use cached result
        cachedResults.push({
          zahlung_id: existing.zahlung_id,
          is_betriebskosten: existing.is_betriebskosten,
          confidence: existing.confidence as "high" | "medium" | "low",
          category: existing.category,
          suggested_immobilie_id: existing.suggested_immobilie_id,
          suggested_immobilie_name: immobilien?.find(i => i.id === existing.suggested_immobilie_id)?.name || null,
          reasoning: existing.reasoning || "",
          zahlung,
        });
      } else {
        needsClassification.push(zahlung);
      }
    }

    // If all are cached, return immediately
    if (needsClassification.length === 0) {
      return new Response(
        JSON.stringify({
          classifications: cachedResults,
          excluded_count: 0,
          auto_classified: 0,
          ai_classified: 0,
          cached_count: cachedResults.length,
          total_unassigned: zahlungen.length,
          immobilien: immobilien || [],
          from_cache: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const autoClassified: ClassificationResult[] = [];
    const needsAI: Zahlung[] = [];
    const excluded: Zahlung[] = [];

    // First pass: Regex classification for new payments
    for (const zahlung of needsClassification) {
      const result = classifyWithRegex(zahlung);
      
      if (result === null) {
        // Excluded (Darlehen etc.)
        excluded.push(zahlung);
      } else if (result) {
        // Auto-classified as Betriebskosten
        const suggestedImmobilie = tryMatchImmobilie(zahlung, immobilien || []);
        result.suggested_immobilie_id = suggestedImmobilie;
        result.suggested_immobilie_name = immobilien?.find(i => i.id === suggestedImmobilie)?.name || null;
        autoClassified.push(result);
      } else {
        // Needs AI classification
        needsAI.push(zahlung);
      }
    }

    console.log(`Cached: ${cachedResults.length}, Auto-classified: ${autoClassified.length}, Needs AI: ${needsAI.length}, Excluded: ${excluded.length}`);

    // Only call AI if we have uncertain payments and not too many
    let aiClassified: ClassificationResult[] = [];
    
    if (needsAI.length > 0 && needsAI.length <= 30) {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      
      if (LOVABLE_API_KEY) {
        const immobilienContext = (immobilien || [])
          .map((i: Immobilie) => `- ID: ${i.id}, Name: "${i.name}", Adresse: "${i.adresse}"`)
          .join("\n");

        const zahlungenContext = needsAI
          .map((z: Zahlung) => 
            `ID: ${z.id} | Betrag: ${z.betrag}€ | Empfänger: "${z.empfaengername || 'N/A'}" | Zweck: "${z.verwendungszweck || 'N/A'}"`
          )
          .join("\n");

        const systemPrompt = `Du klassifizierst Zahlungen für Immobilien-Betriebskosten.
Betriebskosten sind: Strom, Gas, Wasser, Abwasser, Müll, Versicherung, Grundsteuer, Hausmeister, Wartung.
KEINE Betriebskosten: Private Ausgaben, Miete, Gehälter, Investitionen.

Antworte nur mit der Funktion classify_payments.`;

        const userPrompt = `IMMOBILIEN:\n${immobilienContext}\n\nZAHLUNGEN:\n${zahlungenContext}`;

        try {
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
                    name: "classify_payments",
                    description: "Klassifiziere Zahlungen",
                    parameters: {
                      type: "object",
                      properties: {
                        classifications: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              zahlung_id: { type: "string" },
                              is_betriebskosten: { type: "boolean" },
                              confidence: { type: "string", enum: ["high", "medium", "low"] },
                              category: { type: "string" },
                              suggested_immobilie_id: { type: "string", nullable: true },
                              reasoning: { type: "string" },
                            },
                            required: ["zahlung_id", "is_betriebskosten", "confidence", "category", "reasoning"],
                          },
                        },
                      },
                      required: ["classifications"],
                    },
                  },
                },
              ],
              tool_choice: { type: "function", function: { name: "classify_payments" } },
            }),
          });

          if (response.ok) {
            const aiResult = await response.json();
            const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
            
            if (toolCall?.function?.name === "classify_payments") {
              const parsedArgs = JSON.parse(toolCall.function.arguments);
              const aiResults = parsedArgs.classifications || [];
              
              const zahlungenMap = new Map(needsAI.map(z => [z.id, z]));
              aiClassified = aiResults.map((c: any) => ({
                ...c,
                suggested_immobilie_name: immobilien?.find(i => i.id === c.suggested_immobilie_id)?.name || null,
                zahlung: zahlungenMap.get(c.zahlung_id),
              }));
            }
          } else {
            console.error("AI response not ok:", response.status);
          }
        } catch (aiError) {
          console.error("AI classification error:", aiError);
        }
      }
    } else if (needsAI.length > 30) {
      // Too many for AI - classify as low confidence
      aiClassified = needsAI.slice(0, 50).map(z => ({
        zahlung_id: z.id,
        is_betriebskosten: true,
        confidence: "low" as const,
        category: "Sonstige",
        suggested_immobilie_id: tryMatchImmobilie(z, immobilien || []),
        suggested_immobilie_name: null,
        reasoning: "Manuell prüfen - automatische Klassifizierung nicht möglich",
        zahlung: z,
      }));
    }

    // Save new classifications to cache
    const newClassifications = [...autoClassified, ...aiClassified];
    
    if (newClassifications.length > 0) {
      const toInsert = newClassifications.map(c => ({
        zahlung_id: c.zahlung_id,
        is_betriebskosten: c.is_betriebskosten,
        confidence: c.confidence,
        category: c.category,
        suggested_immobilie_id: c.suggested_immobilie_id,
        reasoning: c.reasoning,
      }));

      // Upsert to handle re-classification
      const { error: insertError } = await supabase
        .from("nebenkosten_klassifizierungen")
        .upsert(toInsert, { onConflict: "zahlung_id" });

      if (insertError) {
        console.error("Error caching classifications:", insertError);
      } else {
        console.log(`Cached ${toInsert.length} new classifications`);
      }
    }

    // Combine all results: cached + new
    const allClassifications = [...cachedResults, ...autoClassified, ...aiClassified];

    return new Response(
      JSON.stringify({
        classifications: allClassifications,
        excluded_count: excluded.length,
        auto_classified: autoClassified.length,
        ai_classified: aiClassified.length,
        cached_count: cachedResults.length,
        new_count: newClassifications.length,
        total_unassigned: zahlungen.length,
        immobilien: immobilien || [],
        from_cache: cachedResults.length > 0 && newClassifications.length === 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("classify-nebenkosten error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});