// Abgeschaltet am 27.10.2026. Die Sollstellung erzeugt die SQL-Funktion generate_monthly_mietforderungen
// (pg_cron 05:00 UTC, je Vertrag und Monat einmal, Tabelle sollstellung_monate); die Fälligkeit setzt
// update_faellige_forderungen. Diese Function hatte keinen Aufrufer mehr (Cron-Job 3 gelöscht),
// prüfte aber nur das Login: Jedes Konto, auch der Hausmeister, konnte damit geminderte Monatsmieten
// zurücksetzen, gelöschte neu anlegen und Rücklastschrift-Gebühren auf die volle Miete hochsetzen
// bzw. Forderungsbeträge lesen, die die RLS verwehrt. Der alte Stand liegt in der Git-Historie.

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

Deno.serve((req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  return new Response(
    JSON.stringify({ error: 'Diese Funktion ist abgeschaltet. Die Sollstellung läuft in der Datenbank (generate_monthly_mietforderungen).' }),
    { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
