import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { jsPDF } from 'npm:jspdf@2.5.2';

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

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { 
      mietvertragId, 
      mahnstufe,
      offeneForderungen,
      mahngebuehren,
      verzugszinsen,
      zusaetzlicheKosten,
      zahlungsfristTage
    } = await req.json();

    if (!mietvertragId) {
      throw new Error('Mietvertrag ID ist erforderlich');
    }

    console.log('Generating Mahnung PDF for contract:', mietvertragId, 'Mahnstufe:', mahnstufe);

    // Fetch contract details
    const { data: vertrag, error: vertragError } = await supabaseClient
      .from('mietvertrag')
      .select(`
        id,
        kaltmiete,
        betriebskosten,
        start_datum,
        mahnstufe,
        einheiten!inner(
          id,
          immobilien!inner(
            name,
            adresse
          )
        ),
        mietvertrag_mieter!inner(
          mieter!inner(
            vorname,
            nachname,
            hauptmail
          )
        )
      `)
      .eq('id', mietvertragId)
      .single();

    if (vertragError) throw vertragError;

    const mieterName = `${vertrag.mietvertrag_mieter[0].mieter.vorname} ${vertrag.mietvertrag_mieter[0].mieter.nachname}`;
    const mieterVorname = vertrag.mietvertrag_mieter[0].mieter.vorname;
    const mieterNachname = vertrag.mietvertrag_mieter[0].mieter.nachname;
    const immobilieName = vertrag.einheiten.immobilien.name;
    const adresse = vertrag.einheiten.immobilien.adresse;
    
    const datum = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const zahlungsfrist = new Date();
    zahlungsfrist.setDate(zahlungsfrist.getDate() + (zahlungsfristTage || 14));
    const zahlungsfristStr = zahlungsfrist.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    // Calculate totals
    const offeneForderungenBetrag = offeneForderungen.reduce((sum: number, f: any) => sum + (f.sollbetrag || 0), 0);
    const gesamtbetrag = offeneForderungenBetrag + (mahngebuehren || 0) + (verzugszinsen || 0) + (zusaetzlicheKosten || 0);

    // Create PDF with jsPDF
    const doc = new jsPDF();
    
    let yPos = 15;
    
    // Logo (would need to be added as base64 or URL in production)
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 102, 153); // Blue color for branding
    doc.text('NiImmo Wohnungsbaugesellschaft', 20, yPos);
    yPos += 10;
    
    // Company header info
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(100);
    doc.text('NiImmo Wohnungsbaugesellschaft · Egestorffstraße 11 · 31319 Sehnde', 20, yPos);
    yPos += 10;
    
    // Contact box on the right
    const contactX = 140;
    const contactY = 25;
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text('Kontakt:', contactX, contactY);
    doc.setFont(undefined, 'normal');
    doc.text('Tel. 05138 - 600 72 72', contactX, contactY + 5);
    doc.text('Fax 05138 - 600 72 79', contactX, contactY + 10);
    doc.text('info@niimmo.de', contactX, contactY + 15);
    doc.text('Egestorffstraße 11, 31319 Sehnde', contactX, contactY + 20);
    
    yPos += 10;
    
    // Sender line (small)
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(`${immobilieName} · ${adresse}`, 20, yPos);
    yPos += 10;
    
    // Recipient
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text(mieterName, 20, yPos);
    yPos += 6;
    doc.text(adresse, 20, yPos);
    yPos += 15;
    
    // Date
    doc.setFontSize(10);
    doc.text(datum, 150, yPos);
    yPos += 15;
    
    // Subject
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    const mahnungTitle = mahnstufe === 1 ? '1. Zahlungserinnerung' : 
                         mahnstufe === 2 ? '2. Mahnung' : 
                         '3. Mahnung / Letzte Zahlungsaufforderung';
    doc.text(mahnungTitle, 20, yPos);
    yPos += 12;
    
    // Body text
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    const anrede = mahnstufe === 1 ? `Sehr geehrte/r ${mieterName},` :
                   mahnstufe === 2 ? `Sehr geehrte/r ${mieterName},` :
                   `Sehr geehrte/r ${mieterName}!`;
    doc.text(anrede, 20, yPos);
    yPos += 10;
    
    // Main text based on Mahnstufe
    let mainText: string[];
    if (mahnstufe === 1) {
      mainText = [
        'wir möchten Sie daran erinnern, dass folgende Zahlungen noch nicht bei uns',
        'eingegangen sind:'
      ];
    } else if (mahnstufe === 2) {
      mainText = [
        'trotz unserer Zahlungserinnerung vom ' + datum + ' sind folgende Beträge noch',
        'immer nicht bei uns eingegangen:'
      ];
    } else {
      mainText = [
        'trotz mehrmaliger Aufforderung sind folgende Zahlungen noch immer nicht',
        'eingegangen. Wir fordern Sie hiermit letztmalig zur Zahlung auf:'
      ];
    }
    
    mainText.forEach(line => {
      doc.text(line, 20, yPos);
      yPos += 6;
    });
    yPos += 6;
    
    // Table - Open Claims
    doc.setFont(undefined, 'bold');
    doc.setFillColor(245, 245, 245);
    doc.rect(20, yPos - 5, 175, 8, 'F');
    doc.text('Offene Forderungen:', 20, yPos);
    yPos += 10;
    
    doc.setFont(undefined, 'normal');
    offeneForderungen.forEach((forderung: any) => {
      const monat = forderung.sollmonat || 'N/A';
      const betrag = (forderung.sollbetrag || 0).toFixed(2);
      doc.text(`Miete ${monat}`, 25, yPos);
      doc.text(`${betrag} €`, 160, yPos, { align: 'right' });
      yPos += 6;
    });
    yPos += 4;
    
    // Costs
    if (mahngebuehren > 0) {
      doc.text('Mahngebühren', 25, yPos);
      doc.text(`${mahngebuehren.toFixed(2)} €`, 160, yPos, { align: 'right' });
      yPos += 6;
    }
    
    if (verzugszinsen > 0) {
      doc.text('Verzugszinsen', 25, yPos);
      doc.text(`${verzugszinsen.toFixed(2)} €`, 160, yPos, { align: 'right' });
      yPos += 6;
    }
    
    if (zusaetzlicheKosten > 0) {
      doc.text('Zusätzliche Kosten', 25, yPos);
      doc.text(`${zusaetzlicheKosten.toFixed(2)} €`, 160, yPos, { align: 'right' });
      yPos += 6;
    }
    
    // Total
    yPos += 2;
    doc.setFont(undefined, 'bold');
    doc.setFillColor(249, 249, 249);
    doc.rect(20, yPos - 5, 175, 8, 'F');
    doc.text('Gesamtbetrag:', 25, yPos);
    doc.text(`${gesamtbetrag.toFixed(2)} €`, 160, yPos, { align: 'right' });
    yPos += 15;
    
    // Payment request
    doc.setFont(undefined, 'normal');
    const zahlungsText = `Wir bitten Sie, den Gesamtbetrag von ${gesamtbetrag.toFixed(2)} € bis zum ${zahlungsfristStr}`;
    doc.text(zahlungsText, 20, yPos);
    yPos += 6;
    doc.text('auf unser Konto zu überweisen.', 20, yPos);
    yPos += 12;
    
    // Warning text based on Mahnstufe
    if (mahnstufe >= 2) {
      doc.setFontSize(10);
      doc.setTextColor(150, 0, 0);
      const warnText = mahnstufe === 2 ?
        'Bei ausbleibender Zahlung behalten wir uns rechtliche Schritte vor.' :
        'Bei ausbleibender Zahlung werden wir ohne weitere Ankündigung rechtliche Schritte einleiten.';
      doc.text(warnText, 20, yPos);
      yPos += 12;
      doc.setTextColor(0);
      doc.setFontSize(11);
    }
    
    // Signature
    doc.text('Mit freundlichen Grüßen', 20, yPos);
    yPos += 10;
    doc.text(immobilieName, 20, yPos);
    
    // Footer with company details
    yPos = 255;
    doc.setFontSize(7);
    doc.setTextColor(80);
    doc.line(20, yPos, 190, yPos);
    yPos += 4;
    
    // Left column
    doc.setFont(undefined, 'bold');
    doc.text('Vertretungsberechtigte Geschäftsführer:', 20, yPos);
    doc.setFont(undefined, 'normal');
    doc.text('Ayhan Yeyrek, Dennis Mikyas', 20, yPos + 3);
    
    doc.setFont(undefined, 'bold');
    doc.text('Registergericht:', 20, yPos + 8);
    doc.setFont(undefined, 'normal');
    doc.text('Amtsgericht Hildesheim Handelsregister B', 20, yPos + 11);
    doc.text('HRB 208111', 20, yPos + 14);
    
    doc.setFont(undefined, 'bold');
    doc.text('Gewerbeerlaubnis nach § 34 C GewO; Aufsichtsbehörde:', 20, yPos + 19);
    doc.setFont(undefined, 'normal');
    doc.text('IHK Hannover', 20, yPos + 22);
    
    doc.setFont(undefined, 'bold');
    doc.text('Steuer-Nummer:', 20, yPos + 27);
    doc.setFont(undefined, 'normal');
    doc.text('16/204/50884', 20, yPos + 30);
    
    // Right column
    doc.setFont(undefined, 'bold');
    doc.text('Mitglied in:', 120, yPos);
    doc.setFont(undefined, 'normal');
    doc.text('IHK Industrie- und Handelskammer', 120, yPos + 3);
    doc.text('Hannover', 120, yPos + 6);
    
    // Generate PDF as ArrayBuffer
    const pdfArrayBuffer = doc.output('arraybuffer');
    const pdfBlob = new Uint8Array(pdfArrayBuffer);

    // Generate filename
    const fileName = `Mahnung_Stufe${mahnstufe}_${mieterVorname}_${mieterNachname}_${datum.replace(/\./g, '-')}.pdf`;
    const filePath = `mahnungen/${mietvertragId}/${fileName}`;

    // Upload to storage
    const { error: uploadError } = await supabaseClient.storage
      .from('dokumente')
      .upload(filePath, pdfBlob, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw new Error('Failed to upload PDF to storage');
    }

    // Save document reference in database
    const { error: dbError } = await supabaseClient
      .from('dokumente')
      .insert({
        titel: `${mahnungTitle} ${datum}`,
        pfad: filePath,
        kategorie: 'Schriftverkehr',
        dateityp: 'application/pdf',
        mietvertrag_id: mietvertragId,
      });

    if (dbError) {
      console.error('Database error:', dbError);
    }

    console.log('Mahnung PDF successfully created and saved:', filePath);

    // Return success response
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Mahnung PDF erfolgreich erstellt',
        filePath,
        fileName
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error generating Mahnung PDF:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
