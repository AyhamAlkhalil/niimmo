import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

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

interface RentIncreaseEligibility {
  mietvertrag_id: string;
  current_kaltmiete: number;
  current_betriebskosten: number;
  letzte_mieterhoehung_am: string | null;
  start_datum: string;
  is_eligible: boolean;
  months_since_last_increase: number;
  months_since_start: number;
  reason: string;
  einheit_id?: string;
  immobilie_id?: string;
  immobilie_name?: string;
  immobilie_adresse?: string;
  mieter?: Array<{
    vorname: string;
    nachname: string;
    hauptmail: string | null;
    telnr: string | null;
  }>;
}

/** Heutiger Kalendertag in deutscher Zeit als JJJJ-MM-TT; die Function läuft in UTC. */
function berlinerHeute(jetzt: Date): string {
  const [tag, monat, jahr] = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(jetzt)
    .split('.');
  return `${jahr}-${monat}-${tag}`;
}

/** JJJJ-MM-TT um ganze Monate verschoben; fehlt der Tag im Zielmonat, gilt der Monatsletzte (31.01. + 1 → 28.02.). */
function plusMonate(iso: string, monate: number): string {
  const [jahr, monat, tag] = iso.slice(0, 10).split('-').map(Number);
  const letzterTag = new Date(Date.UTC(jahr, monat - 1 + monate + 1, 0)).getUTCDate();
  return new Date(Date.UTC(jahr, monat - 1 + monate, Math.min(tag, letzterTag))).toISOString().slice(0, 10);
}

/** Wie wirksamAbTag() in src/utils/mieterhoehungRegeln.ts: Beginn des dritten Kalendermonats nach Zugang (§ 558b Abs. 1 BGB). */
function wirksamAbTag(zugangIso: string): string {
  const [jahr, monat] = zugangIso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(jahr, monat - 1 + 3, 1)).toISOString().slice(0, 10);
}

/**
 * § 558 Abs. 1 BGB, gerechnet ab der letzten Erhöhung (letzte_mieterhoehung_am ist deren Wirksamwerden)
 * oder dem Mietbeginn:
 * - Satz 2: Das Verlangen darf frühestens ein Jahr danach gestellt werden.
 * - Satz 1: Zum Wirksamwerden muss die Miete seit 15 Monaten unverändert sein.
 * Bis zum 28.10.2026 verlangte die Liste 15 Monate bis heute und bot jede Erhöhung rund drei Monate zu
 * spät an. moeglichAb ist der früheste Zugang, an dem beides erfüllt ist.
 */
function erhoehungsfrist(referenzIso: string, heuteIso: string): { zulaessig: boolean; moeglichAb: string } {
  const jahresfrist = plusMonate(referenzIso, 12);
  const unveraendertBis = plusMonate(referenzIso, 15);
  // Wirksam wird ein Verlangen am Monatsersten drei Monate nach Zugang; liegt unveraendertBis nicht auf
  // einem Monatsersten, reicht erst der Zugang im Monat danach
  const [jahr, monat, tag] = unveraendertBis.split('-').map(Number);
  const fruehesterZugang = new Date(Date.UTC(jahr, monat - 1 - 3 + (tag > 1 ? 1 : 0), 1)).toISOString().slice(0, 10);
  return {
    zulaessig: heuteIso >= jahresfrist && wirksamAbTag(heuteIso) >= unveraendertBis,
    moeglichAb: jahresfrist > fruehesterZugang ? jahresfrist : fruehesterZugang,
  };
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
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
  // Die Antwort enthält Mieten und Kontaktdaten aller Mieter, gelesen mit Service-Role. Bis zum
  // 27.10.2026 genügte jedes Login (auch der Hausmeister). Wie in process-payments.
  const rollenClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: istAdmin, error: rolleError } = await rollenClient.rpc('is_admin', { _user_id: userData.user.id });
  if (rolleError || istAdmin !== true) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Checking rent increase eligibility...');

    // Fetch all active rental contracts with unit, property and tenant info
    const { data: contracts, error } = await supabase
      .from('mietvertrag')
      .select(`
        id,
        kaltmiete,
        betriebskosten,
        letzte_mieterhoehung_am,
        start_datum,
        status,
        mietanpassung_art,
        einheit_id,
        einheiten!inner(
          zaehler,
          immobilie_id,
          immobilien!inner(
            name,
            adresse
          )
        ),
        mietvertrag_mieter!inner(
          mieter!inner(
            vorname,
            nachname,
            hauptmail,
            telnr
          )
        )
      `)
      .eq('status', 'aktiv');

    if (error) {
      console.error('Error fetching contracts:', error);
      throw error;
    }

    const eligibleContracts: RentIncreaseEligibility[] = [];
    const currentDate = new Date();
    const heuteIso = berlinerHeute(currentDate);

    for (const contract of contracts || []) {
      // Staffel- und Indexmiete schließen die Erhöhung nach § 558 aus (§§ 557a Abs. 2, 557b Abs. 2
      // BGB); bis zum 27.10.2026 wurden auch sie angeboten
      if (contract.mietanpassung_art === 'staffel' || contract.mietanpassung_art === 'index') continue;
      const startDate = new Date(contract.start_datum);
      const lastIncreaseDate = contract.letzte_mieterhoehung_am 
        ? new Date(contract.letzte_mieterhoehung_am) 
        : null;

      // Calculate months since start
      const monthsSinceStart = Math.floor(
        (currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      );

      // Calculate months since last increase (or since start if never increased)
      const referenceDate = lastIncreaseDate || startDate;
      const monthsSinceLastIncrease = Math.floor(
        (currentDate.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      );

      let isEligible = false;
      let reason = '';

      // § 558 Abs. 1 BGB: Verlangen nach 12 Monaten, 15 Monate unverändert zum Wirksamwerden (erhoehungsfrist)
      const referenzIso = contract.letzte_mieterhoehung_am || contract.start_datum;
      const frist = referenzIso ? erhoehungsfrist(String(referenzIso), heuteIso) : null;
      if (frist?.zulaessig) {
        isEligible = true;
        reason = lastIncreaseDate 
          ? `${monthsSinceLastIncrease} Monate seit letzter Erhöhung`
          : `${monthsSinceStart} Monate seit Vertragsbeginn`;
      } else if (frist) {
        reason = `Verlangen möglich ab ${frist.moeglichAb.split('-').reverse().join('.')}`;
      } else {
        reason = 'Ohne Mietbeginn lässt sich die Frist nicht prüfen';
      }

      const eligibilityInfo: RentIncreaseEligibility = {
        mietvertrag_id: contract.id,
        current_kaltmiete: contract.kaltmiete,
        current_betriebskosten: contract.betriebskosten || 0,
        letzte_mieterhoehung_am: contract.letzte_mieterhoehung_am,
        start_datum: contract.start_datum,
        is_eligible: isEligible,
        months_since_last_increase: monthsSinceLastIncrease,
        months_since_start: monthsSinceStart,
        reason,
        einheit_id: contract.einheit_id,
        immobilie_id: contract.einheiten?.immobilie_id,
        immobilie_name: contract.einheiten?.immobilien?.name || 'Unbekannt',
        immobilie_adresse: contract.einheiten?.immobilien?.adresse || 'Unbekannt',
        mieter: contract.mietvertrag_mieter?.map((mm: any) => ({
          vorname: mm.mieter?.vorname || '',
          nachname: mm.mieter?.nachname || '',
          hauptmail: mm.mieter?.hauptmail || null,
          telnr: mm.mieter?.telnr || null
        })) || []
      };

      eligibleContracts.push(eligibilityInfo);
    }

    // Filter for only eligible contracts
    const eligibleOnly = eligibleContracts.filter(c => c.is_eligible);

    console.log(`Found ${eligibleOnly.length} contracts eligible for rent increase`);

    return new Response(
      JSON.stringify({
        success: true,
        eligible_contracts: eligibleOnly,
        total_eligible: eligibleOnly.length,
        all_contracts: eligibleContracts
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    console.error('Error in rent increase eligibility check:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Die Prüfung der möglichen Mieterhöhungen ist fehlgeschlagen.'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
}

serve(handler)