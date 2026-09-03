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

    const { mietvertragId, neueKaltmiete, neueBetriebskosten } = await req.json();

    if (!mietvertragId) {
      throw new Error('Mietvertrag ID ist erforderlich');
    }

    console.log('Generating rent increase PDF for contract:', mietvertragId);

    // Fetch contract details
    const { data: vertrag, error: vertragError } = await supabaseClient
      .from('mietvertrag')
      .select(`
        id,
        kaltmiete,
        betriebskosten,
        start_datum,
        letzte_mieterhoehung_am,
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
    const aktuelleKaltmiete = vertrag.kaltmiete;
    const aktuelleBetriebskosten = vertrag.betriebskosten || 0;
    const aktuelleGesamtmiete = aktuelleKaltmiete + aktuelleBetriebskosten;
    
    const neueKaltmieteValue = neueKaltmiete || aktuelleKaltmiete * 1.04;
    const neueBetriebskostenValue = neueBetriebskosten !== undefined ? neueBetriebskosten : aktuelleBetriebskosten;
    const neueGesamtmiete = neueKaltmieteValue + neueBetriebskostenValue;
    const erhoehung = neueGesamtmiete - aktuelleGesamtmiete;
    const erhoehungProzent = ((erhoehung / aktuelleGesamtmiete) * 100).toFixed(2);
    
    const datum = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const wirksamDatum = new Date();
    wirksamDatum.setMonth(wirksamDatum.getMonth() + 3);
    const wirksamDatumStr = wirksamDatum.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    // Create PDF with jsPDF
    const doc = new jsPDF();
    
    let yPos = 15;
    
    // Logo and company branding
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 102, 153); // Blue color for branding
    doc.text('NilImmo Gruppe', 20, yPos);
    yPos += 10;
    
    // Company header info
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(100);
    doc.text('NilImmo Projektentwicklung & Bau GmbH · Egonstraße 11 · 31319 Sehnde', 20, yPos);
    yPos += 10;
    
    // Contact box on the right
    const contactX = 140;
    const contactY = 25;
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text('Rückfragen richten Sie bitte an:', contactX, contactY);
    doc.setFont(undefined, 'bold');
    doc.text('Dennis Baris Mikyas', contactX, contactY + 5);
    doc.setFont(undefined, 'normal');
    doc.text('📱 01583 - 600 72 72', contactX, contactY + 10);
    doc.text('☎ 05138 - 600 72 79', contactX, contactY + 15);
    doc.text('✉ mikyas@nilimmo.de', contactX, contactY + 20);
    doc.text('📍 Egestorffstraße 11, 31319 Sehnde', contactX, contactY + 25);
    
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
    doc.text('Mieterhöhung gemäß § 558 BGB', 20, yPos);
    yPos += 12;
    
    // Body text
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.text(`Sehr geehrte/r ${mieterName},`, 20, yPos);
    yPos += 10;
    
    const text1 = `hiermit erhöhen wir die Miete für die von Ihnen gemietete Wohnung in`;
    doc.text(text1, 20, yPos);
    yPos += 6;
    doc.text(`${immobilieName}, ${adresse}, zum ${wirksamDatumStr}.`, 20, yPos);
    yPos += 10;
    
    doc.text('Die Mieterhöhung stellt sich wie folgt dar:', 20, yPos);
    yPos += 12;
    
    // Table
    const colWidths = [70, 35, 35, 35];
    const colX = [20, 90, 125, 160];
    
    // Table header
    doc.setFont(undefined, 'bold');
    doc.setFillColor(245, 245, 245);
    doc.rect(20, yPos - 5, 175, 8, 'F');
    doc.text('Position', colX[0] + 2, yPos);
    doc.text('Aktuell', colX[1] + 2, yPos);
    doc.text('Neu', colX[2] + 2, yPos);
    doc.text('Differenz', colX[3] + 2, yPos);
    yPos += 10;
    
    // Table rows
    doc.setFont(undefined, 'normal');
    
    // Kaltmiete
    doc.text('Kaltmiete', colX[0] + 2, yPos);
    doc.text(`${aktuelleKaltmiete.toFixed(2)} €`, colX[1] + 2, yPos);
    doc.text(`${neueKaltmieteValue.toFixed(2)} €`, colX[2] + 2, yPos);
    doc.text(`${(neueKaltmieteValue - aktuelleKaltmiete).toFixed(2)} €`, colX[3] + 2, yPos);
    yPos += 8;
    
    // Betriebskosten
    doc.text('Betriebskosten', colX[0] + 2, yPos);
    doc.text(`${aktuelleBetriebskosten.toFixed(2)} €`, colX[1] + 2, yPos);
    doc.text(`${neueBetriebskostenValue.toFixed(2)} €`, colX[2] + 2, yPos);
    doc.text(`${(neueBetriebskostenValue - aktuelleBetriebskosten).toFixed(2)} €`, colX[3] + 2, yPos);
    yPos += 8;
    
    // Total
    doc.setFont(undefined, 'bold');
    doc.setFillColor(249, 249, 249);
    doc.rect(20, yPos - 5, 175, 8, 'F');
    doc.text('Gesamtmiete', colX[0] + 2, yPos);
    doc.text(`${aktuelleGesamtmiete.toFixed(2)} €`, colX[1] + 2, yPos);
    doc.text(`${neueGesamtmiete.toFixed(2)} €`, colX[2] + 2, yPos);
    doc.text(`${erhoehung.toFixed(2)} €`, colX[3] + 2, yPos);
    yPos += 8;
    
    // Increase percentage
    doc.setFillColor(255, 243, 205);
    doc.rect(20, yPos - 5, 175, 8, 'F');
    doc.text('Erhöhung in %', colX[0] + 2, yPos);
    doc.text(`${erhoehungProzent}%`, colX[3] + 2, yPos);
    yPos += 15;
    
    // More body text
    doc.setFont(undefined, 'normal');
    const text2 = `Die erhöhte Miete wird zum ${wirksamDatumStr} fällig. Wir bitten Sie, Ihre Zahlungen`;
    doc.text(text2, 20, yPos);
    yPos += 6;
    doc.text('entsprechend anzupassen.', 20, yPos);
    yPos += 12;
    
    const legalText = doc.splitTextToSize(
      'Gemäß § 558b BGB haben Sie das Recht, der Mieterhöhung bis zum Ende des zweiten Kalendermonats nach dem Zugang dieses Erhöhungsverlangens zu widersprechen. Sofern Sie nicht widersprechen, gilt Ihre Zustimmung als erteilt.',
      170
    );
    doc.text(legalText, 20, yPos);
    yPos += (legalText.length * 6) + 15;
    
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
    const fileName = `Mieterhoehung_${mieterVorname}_${mieterNachname}_${datum.replace(/\./g, '-')}.pdf`;
    const filePath = `mieterhoehungen/${mietvertragId}/${fileName}`;

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
        titel: `Mieterhöhung ${datum}`,
        pfad: filePath,
        kategorie: 'Schriftverkehr',
        dateityp: 'application/pdf',
        mietvertrag_id: mietvertragId,
      });

    if (dbError) {
      console.error('Database error:', dbError);
    }

    console.log('Mieterhöhung PDF successfully created and saved:', filePath);

    // Return success response
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Mieterhöhung PDF erfolgreich erstellt',
        filePath,
        fileName
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error generating rent increase PDF:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
