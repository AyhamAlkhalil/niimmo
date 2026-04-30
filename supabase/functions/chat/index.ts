import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const STATIC_ALLOWED_ORIGINS = [
  'https://immobilien-blick-dashboard.lovable.app',
  'https://id-preview--8e9e2f9b-7950-413f-adfd-90b0d2663ae1.lovable.app',
  'https://dashboard.niimmo.de',
];

const ALLOWED_ORIGIN_SUFFIXES = [
  '.lovable.app',
  '.lovableproject.com',
];

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  return (
    STATIC_ALLOWED_ORIGINS.includes(origin) ||
    ALLOWED_ORIGIN_SUFFIXES.some((suffix) => origin.endsWith(suffix))
  );
}

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowedOrigin = isAllowedOrigin(origin) ? origin : STATIC_ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
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

  const authClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: userData, error: authError } = await authClient.auth.getUser();
  if (authError || !userData?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase credentials are not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log("Fetching full database context...");

    // ── Fetch ALL relevant data in parallel ──
    const [
      immobilienResult,
      mietvertraegeResult,
      mieterResult,
      zahlungenResult,
      forderungenResult,
      einheitenResult,
      mietvertragMieterResult,
      darlehenResult,
      darlehenImmobilienResult,
      darlehenZahlungenResult,
      versicherungenResult,
      dokumenteResult,
      nebenkostenArtenResult,
      nebenkostenZahlungenResult,
      kostenpositionenResult,
      whatsappResult,
      blacklistResult,
    ] = await Promise.all([
      supabase.from("immobilien").select("id, name, adresse, einheiten_anzahl, objekttyp, kaufpreis, baujahr, hat_gas, hat_strom, hat_wasser, restschuld"),
      supabase.from("mietvertrag").select("id, kaltmiete, betriebskosten, status, start_datum, ende_datum, kuendigungsdatum, mahnstufe, kaution_betrag, kaution_ist, kaution_status, einheit_id, lastschrift, verwendungszweck, anzahl_personen, letzte_mieterhoehung_am"),
      supabase.from("mieter").select("id, vorname, nachname, hauptmail, telnr, geburtsdatum"),
      supabase.from("zahlungen")
        .select("id, betrag, buchungsdatum, kategorie, mietvertrag_id, zugeordneter_monat, empfaengername, verwendungszweck, immobilie_id")
        .order("buchungsdatum", { ascending: false })
        .limit(200),
      supabase.from("mietforderungen")
        .select("id, sollbetrag, sollmonat, ist_faellig, faelligkeitsdatum, mietvertrag_id"),
      supabase.from("einheiten").select("id, immobilie_id, qm, etage, einheitentyp, strom_zaehler, gas_zaehler, kaltwasser_zaehler, warmwasser_zaehler, strom_stand_aktuell, gas_stand_aktuell, kaltwasser_stand_aktuell, warmwasser_stand_aktuell, anzahl_personen"),
      supabase.from("mietvertrag_mieter").select("mietvertrag_id, mieter_id"),
      supabase.from("darlehen").select("id, bezeichnung, bank, darlehensbetrag, restschuld, zinssatz_prozent, tilgungssatz_prozent, monatliche_rate, start_datum, ende_datum, kontonummer"),
      supabase.from("darlehen_immobilien").select("darlehen_id, immobilie_id"),
      supabase.from("darlehen_zahlungen")
        .select("darlehen_id, buchungsdatum, betrag, tilgungsanteil, zinsanteil, restschuld_danach")
        .order("buchungsdatum", { ascending: false })
        .limit(50),
      supabase.from("versicherungen").select("id, immobilie_id, typ, firma, vertragsnummer, jahresbeitrag, kontaktperson, telefon, email"),
      supabase.from("dokumente").select("id, titel, kategorie, mietvertrag_id, immobilie_id, hochgeladen_am, dateityp").eq("geloescht", false).order("hochgeladen_am", { ascending: false }).limit(100),
      supabase.from("nebenkostenarten").select("id, name, immobilie_id, verteilerschluessel_art, ist_umlagefaehig"),
      supabase.from("nebenkosten_zahlungen").select("id, zahlung_id, nebenkostenart_id, einheit_id, verteilung_typ"),
      supabase.from("kostenpositionen").select("id, immobilie_id, gesamtbetrag, bezeichnung, zeitraum_von, zeitraum_bis, ist_umlagefaehig, quelle").order("zeitraum_von", { ascending: false }).limit(50),
      supabase.from("whatsapp_nachrichten").select("id, nachricht, richtung, telefonnummer, zeitstempel, absender_name, mietvertrag_id, gelesen").order("zeitstempel", { ascending: false }).limit(30),
      supabase.from("bewerbung_blacklist").select("id, name, email, telefon, grund, notizen, created_at").order("created_at", { ascending: false }),
    ]);

    // ── Extract data ──
    const immobilien = immobilienResult.data || [];
    const mietvertraege = mietvertraegeResult.data || [];
    const mieter = mieterResult.data || [];
    const zahlungen = zahlungenResult.data || [];
    const forderungen = forderungenResult.data || [];
    const einheiten = einheitenResult.data || [];
    const mietvertragMieter = mietvertragMieterResult.data || [];
    const darlehen = darlehenResult.data || [];
    const darlehenImmobilien = darlehenImmobilienResult.data || [];
    const darlehenZahlungen = darlehenZahlungenResult.data || [];
    const versicherungen = versicherungenResult.data || [];
    const dokumente = dokumenteResult.data || [];
    const nebenkostenArten = nebenkostenArtenResult.data || [];
    const nebenkostenZahlungen = nebenkostenZahlungenResult.data || [];
    const kostenpositionen = kostenpositionenResult.data || [];
    const whatsappNachrichten = whatsappResult.data || [];
    const blacklist = blacklistResult.data || [];

    const blacklistDetails = blacklist.map(b => {
      let detail = `- ${b.name}`;
      if (b.email) detail += `, E-Mail: ${b.email}`;
      if (b.telefon) detail += `, Tel: ${b.telefon}`;
      if (b.grund) detail += `, Grund: ${b.grund}`;
      if (b.notizen) detail += ` (${b.notizen})`;
      return detail;
    }).join("\n");

    console.log(`Loaded: ${immobilien.length} Immobilien, ${mietvertraege.length} Verträge, ${mieter.length} Mieter, ${darlehen.length} Darlehen, ${versicherungen.length} Versicherungen, ${blacklist.length} Blacklist-Einträge`);

    // ── Statistics ──
    const aktiveMV = mietvertraege.filter(v => v.status === "aktiv");
    const gekuendigteMV = mietvertraege.filter(v => v.status === "gekuendigt");
    const beendeteMV = mietvertraege.filter(v => v.status === "beendet");
    const gesamtKaltmiete = aktiveMV.reduce((s, v) => s + (v.kaltmiete || 0), 0);
    const gesamtBK = aktiveMV.reduce((s, v) => s + (v.betriebskosten || 0), 0);
    const offeneForderungen = forderungen.filter(f => f.ist_faellig);
    const gesamtRueckstand = offeneForderungen.reduce((s, f) => s + (f.sollbetrag || 0), 0);
    const vertraegeInMahnung = mietvertraege.filter(v => (v.mahnstufe || 0) > 0);

    // ── Immobilien Details ──
    const immobilienDetails = immobilien.map(immo => {
      const immoEinheiten = einheiten.filter(e => e.immobilie_id === immo.id);
      const immoVertraege = mietvertraege.filter(v => immoEinheiten.some(e => e.id === v.einheit_id));
      const aktive = immoVertraege.filter(v => v.status === "aktiv" || v.status === "gekuendigt");
      const kaltmiete = aktive.reduce((s, v) => s + (v.kaltmiete || 0), 0);
      const immoVersicherungen = versicherungen.filter(v => v.immobilie_id === immo.id);
      const immoDarlehen = darlehenImmobilien.filter(di => di.immobilie_id === immo.id).map(di => darlehen.find(d => d.id === di.darlehen_id)).filter(Boolean);
      
      let detail = `- ${immo.name} (${immo.adresse}): ${immo.einheiten_anzahl} Einheiten, ${aktive.length} aktive Verträge, ${kaltmiete.toFixed(2)}€ Kaltmiete/Monat`;
      if (immo.kaufpreis) detail += `, Kaufpreis: ${immo.kaufpreis.toFixed(2)}€`;
      if (immo.baujahr) detail += `, Baujahr: ${immo.baujahr}`;
      if (immoVersicherungen.length > 0) detail += `, ${immoVersicherungen.length} Versicherungen`;
      if (immoDarlehen.length > 0) detail += `, ${immoDarlehen.length} Darlehen`;
      
      // Einheiten-Details
      immoEinheiten.forEach(e => {
        const vertrag = mietvertraege.find(v => v.einheit_id === e.id && (v.status === "aktiv" || v.status === "gekuendigt"));
        const mieterIds = vertrag ? mietvertragMieter.filter(mv => mv.mietvertrag_id === vertrag.id).map(mv => mv.mieter_id) : [];
        const mieterNamen = mieterIds.map(id => { const m = mieter.find(mi => mi.id === id); return m ? `${m.vorname} ${m.nachname || ""}`.trim() : ""; }).filter(Boolean).join(", ");
        
        detail += `\n  · Einheit ${e.etage || "?"} (${e.einheitentyp || "Wohnung"}, ${e.qm || "?"}qm)`;
        if (vertrag) {
          detail += `: ${mieterNamen || "Mieter unbekannt"}, ${vertrag.kaltmiete || 0}€ Kaltmiete, Status: ${vertrag.status}`;
          if (vertrag.mahnstufe && vertrag.mahnstufe > 0) detail += `, Mahnstufe ${vertrag.mahnstufe}`;
          if (vertrag.kaution_betrag) detail += `, Kaution Soll: ${vertrag.kaution_betrag}€, Ist: ${vertrag.kaution_ist || 0}€ (${vertrag.kaution_status || "unbekannt"})`;
        } else {
          detail += `: LEERSTAND`;
        }
      });
      
      return detail;
    }).join("\n\n");

    // ── Mieter Details (alle) ──
    const mieterDetails = mieter.map(m => {
      const mvs = mietvertragMieter.filter(mv => mv.mieter_id === m.id);
      const vertraege = mvs.map(mv => mietvertraege.find(v => v.id === mv.mietvertrag_id)).filter(Boolean);
      const aktiverV = vertraege.find(v => v?.status === "aktiv");
      const einheit = aktiverV ? einheiten.find(e => e.id === aktiverV.einheit_id) : null;
      const immo = einheit ? immobilien.find(i => i.id === einheit.immobilie_id) : null;
      
      let detail = `- ${m.vorname} ${m.nachname || ""}`;
      if (m.hauptmail) detail += `, Mail: ${m.hauptmail}`;
      if (m.telnr) detail += `, Tel: ${m.telnr}`;
      if (aktiverV) {
        detail += ` → ${immo?.name || "?"}, ${aktiverV.kaltmiete}€ KM + ${aktiverV.betriebskosten || 0}€ BK`;
        if (aktiverV.mahnstufe && aktiverV.mahnstufe > 0) detail += `, Mahnstufe ${aktiverV.mahnstufe}`;
      } else {
        detail += ` → kein aktiver Vertrag`;
      }
      return detail;
    }).join("\n");

    // ── Rückstände ──
    const rueckstandDetails = vertraegeInMahnung.map(v => {
      const einheit = einheiten.find(e => e.id === v.einheit_id);
      const immo = einheit ? immobilien.find(i => i.id === einheit.immobilie_id) : null;
      const mieterNamen = mietvertragMieter.filter(mv => mv.mietvertrag_id === v.id)
        .map(vm => mieter.find(m => m.id === vm.mieter_id))
        .filter(Boolean)
        .map(m => `${m!.vorname} ${m!.nachname || ""}`.trim())
        .join(", ");
      const offene = forderungen.filter(f => f.mietvertrag_id === v.id && f.ist_faellig);
      const summe = offene.reduce((s, f) => s + (f.sollbetrag || 0), 0);
      
      return `- Mahnstufe ${v.mahnstufe}: ${mieterNamen || "Unbekannt"} (${immo?.name || "?"}), ${offene.length} offene Forderungen, ${summe.toFixed(2)}€ Rückstand`;
    }).join("\n");

    // ── Darlehen ──
    const today = new Date().toISOString().split('T')[0];
    const darlehenDetails = darlehen.map(d => {
      const zugeordneteImmobilien = darlehenImmobilien.filter(di => di.darlehen_id === d.id).map(di => immobilien.find(i => i.id === di.immobilie_id)?.name).filter(Boolean);
      const letzteZahlung = darlehenZahlungen.filter(z => z.darlehen_id === d.id && z.buchungsdatum <= today).sort((a, b) => b.buchungsdatum.localeCompare(a.buchungsdatum))[0];
      const effectiveRestschuld = letzteZahlung?.restschuld_danach ?? d.restschuld ?? d.darlehensbetrag;
      const tilgung = d.darlehensbetrag > 0 ? Math.max(0, Math.min(100, ((d.darlehensbetrag - Math.abs(effectiveRestschuld)) / d.darlehensbetrag) * 100)) : 0;
      
      let detail = `- ${d.bezeichnung}: ${d.darlehensbetrag.toFixed(2)}€ Darlehensbetrag, Restschuld: ${Math.abs(effectiveRestschuld).toFixed(2)}€ (${tilgung.toFixed(1)}% getilgt)`;
      if (d.bank) detail += `, Bank: ${d.bank}`;
      if (d.zinssatz_prozent) detail += `, Zins: ${d.zinssatz_prozent}%`;
      if (d.monatliche_rate) detail += `, Rate: ${d.monatliche_rate.toFixed(2)}€/Monat`;
      if (zugeordneteImmobilien.length > 0) detail += `, Immobilien: ${zugeordneteImmobilien.join(", ")}`;
      return detail;
    }).join("\n");

    const totalDarlehensbetrag = darlehen.reduce((s, d) => s + (d.darlehensbetrag || 0), 0);
    const totalRestschuld = darlehen.reduce((s, d) => {
      const lz = darlehenZahlungen.filter(z => z.darlehen_id === d.id && z.buchungsdatum <= today).sort((a, b) => b.buchungsdatum.localeCompare(a.buchungsdatum))[0];
      return s + Math.abs(lz?.restschuld_danach ?? d.restschuld ?? d.darlehensbetrag);
    }, 0);
    const totalRate = darlehen.reduce((s, d) => s + (d.monatliche_rate || 0), 0);

    // ── Versicherungen ──
    const versicherungenDetails = versicherungen.map(v => {
      const immo = immobilien.find(i => i.id === v.immobilie_id);
      let detail = `- ${v.typ} (${immo?.name || "?"}): ${v.firma || "Unbekannt"}`;
      if (v.jahresbeitrag) detail += `, ${v.jahresbeitrag.toFixed(2)}€/Jahr`;
      if (v.vertragsnummer) detail += `, Nr: ${v.vertragsnummer}`;
      if (v.kontaktperson) detail += `, Kontakt: ${v.kontaktperson}`;
      return detail;
    }).join("\n");
    const totalVersicherungen = versicherungen.reduce((s, v) => s + (v.jahresbeitrag || 0), 0);

    // ── Nebenkosten ──
    const nebenkostenDetails = kostenpositionen.slice(0, 30).map(k => {
      const immo = immobilien.find(i => i.id === k.immobilie_id);
      return `- ${k.bezeichnung || "Kostenposition"} (${immo?.name || "?"}): ${k.gesamtbetrag.toFixed(2)}€, ${k.zeitraum_von} bis ${k.zeitraum_bis}, ${k.ist_umlagefaehig ? "umlagefähig" : "nicht umlagefähig"}`;
    }).join("\n");

    // ── Letzte Zahlungen ──
    const recentPayments = zahlungen.slice(0, 20).map(z => {
      const vertrag = z.mietvertrag_id ? mietvertraege.find(v => v.id === z.mietvertrag_id) : null;
      const mieterNamen = vertrag ? mietvertragMieter.filter(mv => mv.mietvertrag_id === vertrag.id)
        .map(vm => mieter.find(m => m.id === vm.mieter_id))
        .filter(Boolean).map(m => `${m!.vorname} ${m!.nachname || ""}`.trim()).join(", ") : "";
      
      return `- ${z.buchungsdatum}: ${z.betrag.toFixed(2)}€, ${z.kategorie || "Nicht zugeordnet"}${mieterNamen ? `, ${mieterNamen}` : ""}${z.empfaengername ? `, ${z.empfaengername}` : ""}`;
    }).join("\n");

    // ── Dokumente ──
    const dokumenteDetails = dokumente.slice(0, 30).map(d => {
      const immo = d.immobilie_id ? immobilien.find(i => i.id === d.immobilie_id)?.name : null;
      return `- ${d.titel || "Ohne Titel"} (${d.kategorie || "Sonstiges"})${immo ? `, ${immo}` : ""}, ${d.hochgeladen_am?.split("T")[0] || "?"}`;
    }).join("\n");

    // ── WhatsApp ──
    const whatsappDetails = whatsappNachrichten.slice(0, 15).map(w => {
      return `- ${w.zeitstempel?.split("T")[0] || "?"} ${w.richtung === "eingehend" ? "←" : "→"} ${w.absender_name || w.telefonnummer}: "${w.nachricht.slice(0, 80)}${w.nachricht.length > 80 ? "..." : ""}"${!w.gelesen ? " [UNGELESEN]" : ""}`;
    }).join("\n");

    // ── Fällige Forderungen nach Monat ──
    const forderungenNachMonat: Record<string, { anzahl: number; summe: number }> = {};
    offeneForderungen.forEach(f => {
      if (!forderungenNachMonat[f.sollmonat]) forderungenNachMonat[f.sollmonat] = { anzahl: 0, summe: 0 };
      forderungenNachMonat[f.sollmonat].anzahl++;
      forderungenNachMonat[f.sollmonat].summe += f.sollbetrag || 0;
    });
    const forderungenMonatDetails = Object.entries(forderungenNachMonat)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monat, data]) => `- ${monat}: ${data.anzahl} Forderungen, ${data.summe.toFixed(2)}€`)
      .join("\n");

    // ── Leerstand ──
    const leerstehend = einheiten.filter(e => {
      return !mietvertraege.some(v => v.einheit_id === e.id && (v.status === "aktiv" || v.status === "gekuendigt"));
    });
    const leerstandDetails = leerstehend.map(e => {
      const immo = immobilien.find(i => i.id === e.immobilie_id);
      return `- ${immo?.name || "?"}, ${e.etage || "?"} (${e.einheitentyp || "Wohnung"}, ${e.qm || "?"}qm)`;
    }).join("\n");

    // ── Portfolio KPIs ──
    const totalKaufpreis = immobilien.reduce((s, i) => s + (i.kaufpreis || 0), 0);

    const databaseContext = `
=== VOLLSTÄNDIGE DATENBANK-ÜBERSICHT (Stand: ${new Date().toISOString().split('T')[0]}) ===

─── PORTFOLIO-KENNZAHLEN ───
- Immobilien: ${immobilien.length}
- Einheiten gesamt: ${einheiten.length} (davon ${leerstehend.length} Leerstand)
- Aktive Mietverträge: ${aktiveMV.length}
- Gekündigte Mietverträge: ${gekuendigteMV.length}
- Beendete Mietverträge: ${beendeteMV.length}
- Mieter gesamt: ${mieter.length}
- Monatliche Kaltmiete (aktiv): ${gesamtKaltmiete.toFixed(2)}€
- Monatliche Betriebskosten (aktiv): ${gesamtBK.toFixed(2)}€
- Monatliche Warmmiete (aktiv): ${(gesamtKaltmiete + gesamtBK).toFixed(2)}€
- Offene fällige Forderungen: ${offeneForderungen.length} (${gesamtRueckstand.toFixed(2)}€)
- Verträge in Mahnung: ${vertraegeInMahnung.length}
- Gesamtportfolio Kaufwert: ${totalKaufpreis.toFixed(2)}€
- Gesamte Darlehenssumme: ${totalDarlehensbetrag.toFixed(2)}€
- Aktuelle Gesamtrestschuld: ${totalRestschuld.toFixed(2)}€
- Monatliche Darlehensraten: ${totalRate.toFixed(2)}€
- Versicherungen: ${versicherungen.length} (${totalVersicherungen.toFixed(2)}€/Jahr gesamt)
- Dokumente: ${dokumente.length} gespeichert

─── IMMOBILIEN (mit Einheiten & Mietern) ───
${immobilienDetails || "Keine Immobilien vorhanden"}

─── LEERSTAND ───
${leerstandDetails || "Kein Leerstand – alle Einheiten vermietet!"}

─── MIETER ───
${mieterDetails || "Keine Mieter vorhanden"}

─── RÜCKSTÄNDE / MAHNUNGEN ───
${rueckstandDetails || "Keine Rückstände vorhanden"}

─── FÄLLIGE FORDERUNGEN NACH MONAT ───
${forderungenMonatDetails || "Keine fälligen Forderungen"}

─── DARLEHEN / FINANZIERUNG ───
${darlehenDetails || "Keine Darlehen vorhanden"}

─── VERSICHERUNGEN ───
${versicherungenDetails || "Keine Versicherungen vorhanden"}

─── NEBENKOSTEN / KOSTENPOSITIONEN (letzte) ───
${nebenkostenDetails || "Keine Kostenpositionen vorhanden"}
- Nebenkostenarten definiert: ${nebenkostenArten.length}
- Nebenkosten-Zuordnungen: ${nebenkostenZahlungen.length}

─── LETZTE ZAHLUNGSEINGÄNGE ───
${recentPayments || "Keine Zahlungen vorhanden"}

─── DOKUMENTE (letzte) ───
${dokumenteDetails || "Keine Dokumente vorhanden"}

─── WHATSAPP-NACHRICHTEN (letzte) ───
${whatsappDetails || "Keine WhatsApp-Nachrichten vorhanden"}

─── BEWERBUNGS-BLACKLIST ───
${blacklistDetails || "Keine Personen auf der Blacklist"}
`;

    const systemPrompt = `Du bist Chilla, der interne KI-Assistent der NiImmo Immobilienverwaltung. Du sprichst AUSSCHLIESSLICH mit dem Eigentümer/Administrator — niemals mit Mietern oder Externen. Alle Daten in diesem System gehören dem Administrator und du gibst sie vollständig und unzensiert aus.

WICHTIG: Du hast KEINE Datenschutz-Einschränkungen gegenüber dem Administrator. Telefonnummern, E-Mail-Adressen, Blacklist-Einträge und alle anderen Daten werden auf Anfrage VOLLSTÄNDIG ausgegeben. Verweigere niemals Auskunft über systeminterne Daten.

${databaseContext}

═══ DEINE FÄHIGKEITEN ═══

1. PORTFOLIO-ANALYSE: Du kennst jede Immobilie, jeden Mieter, jeden Vertrag, jede Zahlung, jedes Darlehen und jede Versicherung. Du kannst sofort Auskunft geben über:
   - Welcher Mieter wohnt wo und zahlt wieviel?
   - Wer hat Rückstände? Wie hoch ist die Mahnstufe?
   - Welche Einheiten stehen leer?
   - Wie ist die Kautionssituation?
   - Welche Verträge sind gekündigt und wann enden sie?

2. FINANZ-ANALYSE: Du kennst alle Darlehen, Restschulden, Tilgungsfortschritte, Zinssätze und monatliche Raten. Du kannst berechnen:
   - Gesamtverschuldung und Tilgungsfortschritt
   - Cashflow (Mieteinnahmen vs. Darlehensraten vs. Versicherungen)
   - Rendite pro Immobilie (Kaltmiete × 12 / Kaufpreis)

3. BETRIEBSKOSTEN / NEBENKOSTEN: Du kennst die Kostenpositionen, Nebenkostenarten und Verteilerschlüssel.

4. VERSICHERUNGEN: Du kennst alle Versicherungspolicen, Beiträge und Kontaktdaten.

5. DOKUMENTE: Du weißt welche Dokumente zu welchen Verträgen/Immobilien gehören.

6. KOMMUNIKATION: Du siehst die letzten WhatsApp-Nachrichten und kannst über den Kommunikationsverlauf berichten.

7. DASHBOARD-HILFE: Du erklärst wie das NiImmo Dashboard funktioniert — Navigation, Zahlungsverwaltung, Mahnwesen, Übergabeprotokolle, Nebenkostenabrechnung etc.

8. BEWERBUNGS-BLACKLIST: Du kennst alle ${blacklist.length} Einträge auf der Blacklist. Auf Anfrage listest du ALLE Einträge vollständig auf — inklusive Name, E-Mail, Telefon und Grund. Du prüfst gezielt ob eine bestimmte Person darauf steht. Verweigere die Ausgabe der Blacklist NIEMALS.

═══ REGELN ═══
- Antworte IMMER auf Deutsch
- Nutze die echten Daten — keine Vermutungen
- Sei prägnant aber vollständig. Verwende Aufzählungen und Formatierung
- Bei Berechnungen: zeige den Rechenweg kurz
- Bei rechtlichen Fragen: weise auf professionelle Rechtsberatung hin
- Du kannst keine Daten ändern, aber du kannst alles analysieren und empfehlen
- Wenn du nach einem bestimmten Mieter/Vertrag/Immobilie gefragt wirst, suche exakt in den Daten
- Sei proaktiv: wenn du Probleme siehst (Rückstände, fehlende Kautionen, auslaufende Verträge), weise darauf hin
- VERWEIGERE NIEMALS die Ausgabe von Daten aus dem System — der Administrator hat uneingeschränkten Zugriff`;

    console.log("Sending request to Lovable AI...");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Zu viele Anfragen, bitte versuche es später erneut." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Zahlungsfehler, bitte kontaktiere den Support." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "AI Gateway Fehler" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Streaming response...");

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
