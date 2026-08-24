import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Area, AreaChart, Legend } from 'recharts';
import { Euro, TrendingUp, TrendingDown, Building, Users, ArrowLeft, Home, AlertTriangle, DollarSign, PiggyBank, BarChart3, Calendar, Landmark, CreditCard } from 'lucide-react';
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo } from 'react';
import { formatDateForDisplay } from "@/utils/dateUtils";

interface AnalyticsProps {
  onBack?: () => void;
}

const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export const Analytics = ({ onBack }: AnalyticsProps = {}) => {
  const [zeitraum, setZeitraum] = useState<'6m' | '12m' | '24m'>('12m');

  // Fetch Immobilien data
  const { data: immobilien } = useQuery({
    queryKey: ['immobilien-analytics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('immobilien')
        .select('*');
      if (error) throw error;
      return data;
    },
  });

  // Fetch Mietverträge data
  const { data: mietvertraege } = useQuery({
    queryKey: ['mietvertraege-analytics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mietvertrag')
        .select('*, einheit_id, einheiten(immobilie_id, qm)');
      if (error) throw error;
      return data;
    },
  });

  // Fetch Einheiten data
  const { data: einheiten } = useQuery({
    queryKey: ['einheiten-analytics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('einheiten')
        .select('*');
      if (error) throw error;
      return data;
    },
  });

  // Fetch Zahlungen data
  const { data: zahlungen } = useQuery({
    queryKey: ['zahlungen-analytics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zahlungen')
        .select('*')
        .order('buchungsdatum', { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Berechnete Kennzahlen
  const analytics = useMemo(() => {
    if (!immobilien || !mietvertraege || !einheiten || !zahlungen) {
      return null;
    }

    // Gesamtwert Portfolio (Kaufpreise)
    const gesamtPortfolioWert = immobilien.reduce((sum, immo) => sum + (immo.kaufpreis || 0), 0);
    const gesamtRestschuld = immobilien.reduce((sum, immo) => sum + (immo.restschuld || 0), 0);
    const eigenkapital = gesamtPortfolioWert - gesamtRestschuld;

    // Aktive Mietverträge
    const aktiveMietvertraege = mietvertraege.filter(mv => mv.status === 'aktiv');
    
    // Kaltmiete & Betriebskosten pro Monat
    const monatlicheKaltmiete = aktiveMietvertraege.reduce((sum, mv) => sum + (mv.kaltmiete || 0), 0);
    const monatlicheBetriebskosten = aktiveMietvertraege.reduce((sum, mv) => sum + (mv.betriebskosten || 0), 0);
    const jahresertrag = (monatlicheKaltmiete + monatlicheBetriebskosten) * 12;

    // Rendite berechnen
    const bruttoRendite = gesamtPortfolioWert > 0 ? (jahresertrag / gesamtPortfolioWert) * 100 : 0;

    // Leerstandsquote
    const gesamtEinheiten = einheiten.length;
    const vermieteteEinheiten = aktiveMietvertraege.length;
    const leerstandsQuote = gesamtEinheiten > 0 ? ((gesamtEinheiten - vermieteteEinheiten) / gesamtEinheiten) * 100 : 0;
    const vermietungsgrad = 100 - leerstandsQuote;

    // Durchschnittliche Miete pro m²
    let gesamtQm = 0;
    let gesamtMiete = 0;
    aktiveMietvertraege.forEach(mv => {
      const einheit = einheiten.find(e => e.id === mv.einheit_id);
      if (einheit?.qm) {
        gesamtQm += einheit.qm;
        gesamtMiete += mv.kaltmiete || 0;
      }
    });
    const mieteProm2 = gesamtQm > 0 ? gesamtMiete / gesamtQm : 0;

    // Finanzierungs-Zahlungen (Darlehen, Kredit, etc.)
    const finanzierungsPatterns = [
      /darlehen/i, /kredit/i, /tilgung/i, /zins(en)?/i, /annuität/i,
      /hypothek/i, /baufinanzierung/i, /ratenkredit/i, /immobilienfinanzierung/i
    ];
    
    const finanzierungsZahlungen = zahlungen.filter(z => {
      const text = `${z.empfaengername || ''} ${z.verwendungszweck || ''}`;
      return finanzierungsPatterns.some(pattern => pattern.test(text));
    });

    // Finanzierungszahlungen nach Monat gruppieren
    const finanzierungNachMonat: Record<string, number> = {};
    finanzierungsZahlungen.forEach(z => {
      const datum = new Date(z.buchungsdatum);
      const monatKey = `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}`;
      if (!finanzierungNachMonat[monatKey]) {
        finanzierungNachMonat[monatKey] = 0;
      }
      finanzierungNachMonat[monatKey] += Math.abs(z.betrag);
    });

    // Gesamte Finanzierungskosten
    const gesamtFinanzierung = finanzierungsZahlungen.reduce((sum, z) => sum + Math.abs(z.betrag), 0);
    const monatlicheFinanzierung = Object.keys(finanzierungNachMonat).length > 0 
      ? gesamtFinanzierung / Object.keys(finanzierungNachMonat).length 
      : 0;

    // Zahlungen nach Monat gruppieren
    const zahlungenNachMonat = zahlungen.reduce((acc: any, z) => {
      const datum = new Date(z.buchungsdatum);
      const monatKey = `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}`;
      if (!acc[monatKey]) {
        acc[monatKey] = { kaltmiete: 0, betriebskosten: 0, sonstige: 0, finanzierung: 0 };
      }
      
      // Check if it's a financing payment
      const text = `${z.empfaengername || ''} ${z.verwendungszweck || ''}`;
      const isFinanzierung = finanzierungsPatterns.some(pattern => pattern.test(text));
      
      if (isFinanzierung) {
        acc[monatKey].finanzierung += Math.abs(z.betrag);
      } else if (z.kategorie === 'Miete') {
        acc[monatKey].kaltmiete += z.betrag;
      } else if (z.kategorie === 'Mietkaution') {
        acc[monatKey].betriebskosten += z.betrag;
      } else {
        acc[monatKey].sonstige += z.betrag;
      }
      return acc;
    }, {});

    // Monatliche Einnahmen für Charts
    const heute = new Date();
    const monate = [];
    const monatNamen = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    const anzahlMonate = zeitraum === '6m' ? 6 : zeitraum === '12m' ? 12 : 24;
    
    for (let i = anzahlMonate - 1; i >= 0; i--) {
      const datum = new Date(heute.getFullYear(), heute.getMonth() - i, 1);
      const monatKey = `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}`;
      const daten = zahlungenNachMonat[monatKey] || { kaltmiete: 0, betriebskosten: 0, sonstige: 0 };
      
      monate.push({
        monat: anzahlMonate <= 12 ? monatNamen[datum.getMonth()] : monatKey,
        kaltmiete: daten.kaltmiete,
        betriebskosten: daten.betriebskosten,
        sonstige: daten.sonstige,
        gesamt: daten.kaltmiete + daten.betriebskosten + daten.sonstige,
      });
    }

    // Wertentwicklung (simuliert mit 2-3% jährlicher Wertsteigerung)
    const wertentwicklung = [];
    const wertsteigerungProzent = 2.5; // 2.5% pro Jahr
    for (let i = anzahlMonate - 1; i >= 0; i--) {
      const datum = new Date(heute.getFullYear(), heute.getMonth() - i, 1);
      const monateZurueck = i;
      const wertFaktor = Math.pow(1 - (wertsteigerungProzent / 12 / 100), monateZurueck);
      const historischerWert = gesamtPortfolioWert * wertFaktor;
      
      wertentwicklung.push({
        monat: anzahlMonate <= 12 ? monatNamen[datum.getMonth()] : `${datum.getMonth() + 1}/${datum.getFullYear()}`,
        wert: Math.round(historischerWert),
        datum: datum.toISOString(),
      });
    }

    // Prognose für nächste 12 Monate
    const prognose = [];
    for (let i = 1; i <= 12; i++) {
      const datum = new Date(heute.getFullYear(), heute.getMonth() + i, 1);
      const wertFaktor = Math.pow(1 + (wertsteigerungProzent / 12 / 100), i);
      const prognostizierterwert = gesamtPortfolioWert * wertFaktor;
      
      prognose.push({
        monat: monatNamen[datum.getMonth()],
        wert: Math.round(prognostizierterwert),
        datum: datum.toISOString(),
        isPrognose: true,
      });
    }

    // Kombiniere Wertentwicklung mit Prognose
    const wertentwicklungMitPrognose = [...wertentwicklung.slice(-6), ...prognose.slice(0, 12)];

    // Portfolio Verteilung
    const portfolioVerteilung = immobilien.map(immo => ({
      name: immo.name,
      wert: immo.kaufpreis || 0,
      restschuld: immo.restschuld || 0,
      eigenkapital: (immo.kaufpreis || 0) - (immo.restschuld || 0),
    }));

    // Cashflow Berechnung
    const cashflowData = monate.map(monat => {
      // Angenommene Ausgaben (30% der Einnahmen als Beispiel)
      const ausgaben = monat.gesamt * 0.30;
      const nettoCashflow = monat.gesamt - ausgaben;
      
      return {
        monat: monat.monat,
        einnahmen: monat.gesamt,
        ausgaben: ausgaben,
        nettoCashflow: nettoCashflow,
      };
    });

    // ROI Berechnung
    const investiertesMittel = gesamtPortfolioWert;
    const jahresNettoertrag = jahresertrag * 0.7; // 30% Ausgaben abgezogen
    const roi = investiertesMittel > 0 ? (jahresNettoertrag / investiertesMittel) * 100 : 0;

    // Objekte nach Rendite
    const objekteNachRendite = immobilien.map(immo => {
      const immobilienMietvertraege = aktiveMietvertraege.filter(mv => {
        const einheit = einheiten.find(e => e.id === mv.einheit_id);
        return einheit?.immobilie_id === immo.id;
      });
      
      const jahresmiete = immobilienMietvertraege.reduce((sum, mv) => 
        sum + ((mv.kaltmiete || 0) + (mv.betriebskosten || 0)) * 12, 0
      );
      
      const rendite = immo.kaufpreis > 0 ? (jahresmiete / immo.kaufpreis) * 100 : 0;
      
      return {
        name: immo.name,
        wert: immo.kaufpreis || 0,
        jahresmiete,
        rendite,
        status: rendite > 5 ? 'gut' : rendite > 3 ? 'mittel' : 'niedrig',
      };
    }).sort((a, b) => b.rendite - a.rendite);

    return {
      gesamtPortfolioWert,
      gesamtRestschuld,
      eigenkapital,
      monatlicheKaltmiete,
      monatlicheBetriebskosten,
      jahresertrag,
      bruttoRendite,
      leerstandsQuote,
      vermietungsgrad,
      vermieteteEinheiten,
      gesamtEinheiten,
      mieteProm2,
      monatlicheEinnahmen: monate,
      wertentwicklung,
      wertentwicklungMitPrognose,
      portfolioVerteilung,
      cashflowData,
      roi,
      objekteNachRendite,
      // Finanzierungsdaten
      finanzierungsZahlungen,
      gesamtFinanzierung,
      monatlicheFinanzierung,
      finanzierungNachMonat,
    };
  }, [immobilien, mietvertraege, einheiten, zahlungen, zeitraum]);

  if (!analytics) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Lade Analytics-Daten...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 sm:mb-8">
          {onBack && (
            <Button
              variant="ghost"
              onClick={onBack}
              className="mb-4 hover:bg-gray-100"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Zurück zum Dashboard
            </Button>
          )}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
            <div>
              <h1 className="text-xl sm:text-3xl font-bold text-gray-900 mb-1 sm:mb-2">Analytics Dashboard</h1>
              <p className="text-gray-600 text-sm hidden sm:block">Umfassende Übersicht über Portfolio-Werte, Renditen, Prognosen und Wirtschaftlichkeit</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Calendar className="h-4 w-4 text-gray-500" />
              <Select value={zeitraum} onValueChange={(value: any) => setZeitraum(value)}>
                <SelectTrigger className="w-[160px] sm:w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="6m">Letzte 6 Monate</SelectItem>
                  <SelectItem value="12m">Letzte 12 Monate</SelectItem>
                  <SelectItem value="24m">Letzte 24 Monate</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Top KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-blue-900">Portfolio-Gesamtwert</CardTitle>
              <Building className="h-5 w-5 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-900">
                {analytics.gesamtPortfolioWert.toLocaleString('de-DE')}€
              </div>
              <p className="text-xs text-blue-700 mt-1">
                {immobilien?.length || 0} Immobilien
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-green-900">Brutto-Rendite</CardTitle>
              <TrendingUp className="h-5 w-5 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-900">
                {analytics.bruttoRendite.toFixed(2)}%
              </div>
              <p className="text-xs text-green-700 mt-1">
                {analytics.jahresertrag.toLocaleString('de-DE')}€ p.a.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-purple-900">Eigenkapital</CardTitle>
              <PiggyBank className="h-5 w-5 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-900">
                {analytics.eigenkapital.toLocaleString('de-DE')}€
              </div>
              <p className="text-xs text-purple-700 mt-1">
                {((analytics.eigenkapital / analytics.gesamtPortfolioWert) * 100).toFixed(1)}% Quote
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-orange-900">Vermietungsgrad</CardTitle>
              <Users className="h-5 w-5 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-900">
                {analytics.vermietungsgrad.toFixed(1)}%
              </div>
              <p className="text-xs text-orange-700 mt-1">
                {analytics.vermieteteEinheiten} von {analytics.gesamtEinheiten} Einheiten
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-emerald-900">ROI</CardTitle>
              <DollarSign className="h-5 w-5 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-900">
                {analytics.roi.toFixed(2)}%
              </div>
              <p className="text-xs text-emerald-700 mt-1">
                Return on Investment
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Wertentwicklung & Prognose - Hauptsektion */}
        <div className="mb-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Wertentwicklung & Prognose
              </CardTitle>
              <CardDescription>
                Historische Entwicklung und 12-Monats-Prognose des Portfolio-Gesamtwerts
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={analytics.wertentwicklungMitPrognose}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="monat" />
                    <YAxis tickFormatter={(value) => `${(value / 1000).toFixed(0)}k€`} />
                    <Tooltip 
                      formatter={(value: any) => [`${value.toLocaleString('de-DE')}€`, 'Portfolio-Wert']}
                      labelFormatter={(label, payload) => {
                        if (payload && payload[0]?.payload?.isPrognose) {
                          return `${label} (Prognose)`;
                        }
                        return label;
                      }}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="wert" 
                      stroke="#3B82F6" 
                      strokeWidth={3}
                      dot={(props: any) => {
                        const { cx, cy, payload } = props;
                        return (
                          <circle
                            cx={cx}
                            cy={cy}
                            r={4}
                            fill={payload.isPrognose ? '#F59E0B' : '#3B82F6'}
                            stroke={payload.isPrognose ? '#F59E0B' : '#3B82F6'}
                            strokeWidth={2}
                          />
                        );
                      }}
                      name="Portfolio-Wert"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-0.5 bg-blue-600"></div>
                    <span className="text-gray-700">Ist-Werte</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-0.5 bg-orange-500 border-dashed border-t-2 border-orange-500"></div>
                    <span className="text-gray-700">Prognose (basierend auf 2,5% p.a.)</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Erträge & Cashflow */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Monatliche Einnahmen */}
          <Card>
            <CardHeader>
              <CardTitle>Monatliche Einnahmen</CardTitle>
              <CardDescription>Entwicklung nach Kategorien</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.monatlicheEinnahmen}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="monat" />
                    <YAxis tickFormatter={(value) => `${(value / 1000).toFixed(0)}k€`} />
                    <Tooltip formatter={(value: any) => [`${value.toLocaleString('de-DE')}€`, '']} />
                    <Legend />
                    <Bar dataKey="kaltmiete" stackId="a" fill="#10B981" name="Kaltmiete" />
                    <Bar dataKey="betriebskosten" stackId="a" fill="#3B82F6" name="Betriebskosten" />
                    <Bar dataKey="sonstige" stackId="a" fill="#F59E0B" name="Sonstige" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Cashflow-Analyse */}
          <Card>
            <CardHeader>
              <CardTitle>Cashflow-Analyse</CardTitle>
              <CardDescription>Einnahmen vs. Ausgaben (geschätzt)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analytics.cashflowData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="monat" />
                    <YAxis tickFormatter={(value) => `${(value / 1000).toFixed(0)}k€`} />
                    <Tooltip formatter={(value: any) => [`${value.toLocaleString('de-DE')}€`, '']} />
                    <Legend />
                    <Area 
                      type="monotone" 
                      dataKey="einnahmen" 
                      stackId="1" 
                      stroke="#10B981" 
                      fill="#10B981" 
                      name="Einnahmen"
                    />
                    <Area 
                      type="monotone" 
                      dataKey="ausgaben" 
                      stackId="2" 
                      stroke="#EF4444" 
                      fill="#EF4444" 
                      name="Ausgaben"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Portfolio-Analyse & Objektvergleich */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Leerstandsquote Donut */}
          <Card>
            <CardHeader>
              <CardTitle>Vermietungsstatus</CardTitle>
              <CardDescription>Verteilung vermietet vs. leerstehend</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Vermietet', value: analytics.vermieteteEinheiten, color: '#10B981' },
                        { name: 'Leerstehend', value: analytics.gesamtEinheiten - analytics.vermieteteEinheiten, color: '#EF4444' },
                      ]}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent, value }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                      innerRadius={60}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      <Cell fill="#10B981" />
                      <Cell fill="#EF4444" />
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div className="text-center p-3 bg-green-50 rounded-lg">
                  <p className="text-sm text-gray-600">Vermietungsgrad</p>
                  <p className="text-2xl font-bold text-green-600">{analytics.vermietungsgrad.toFixed(1)}%</p>
                </div>
                <div className="text-center p-3 bg-red-50 rounded-lg">
                  <p className="text-sm text-gray-600">Leerstand</p>
                  <p className="text-2xl font-bold text-red-600">{analytics.leerstandsQuote.toFixed(1)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Portfolio Verteilung */}
          <Card>
            <CardHeader>
              <CardTitle>Portfolio-Verteilung nach Objekten</CardTitle>
              <CardDescription>Kaufpreis und Eigenkapital pro Immobilie</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.portfolioVerteilung}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                    <YAxis tickFormatter={(value) => `${(value / 1000).toFixed(0)}k€`} />
                    <Tooltip 
                      formatter={(value: any) => [`${value.toLocaleString('de-DE')}€`, '']}
                    />
                    <Legend />
                    <Bar dataKey="wert" fill="#3B82F6" name="Kaufpreis" />
                    <Bar dataKey="eigenkapital" fill="#10B981" name="Eigenkapital" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Objekte nach Rendite - Investment-Analyse */}
        <div className="mb-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Objekte nach Rendite & Investment-Potenzial
              </CardTitle>
              <CardDescription>Sortiert nach Brutto-Rendite - Grün = gut (&gt;5%), Gelb = mittel (3-5%), Rot = niedrig (&lt;3%)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {analytics.objekteNachRendite.map((objekt, index) => (
                  <div 
                    key={index}
                    className={`p-4 rounded-lg border-2 flex items-center justify-between ${
                      objekt.status === 'gut' 
                        ? 'bg-green-50 border-green-200' 
                        : objekt.status === 'mittel'
                        ? 'bg-yellow-50 border-yellow-200'
                        : 'bg-red-50 border-red-200'
                    }`}
                  >
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900">{objekt.name}</h4>
                      <p className="text-sm text-gray-600">
                        Wert: {objekt.wert.toLocaleString('de-DE')}€ | Jahresmiete: {objekt.jahresmiete.toLocaleString('de-DE')}€
                      </p>
                    </div>
                    <div className="text-right">
                      <div className={`text-2xl font-bold ${
                        objekt.status === 'gut' 
                          ? 'text-green-600' 
                          : objekt.status === 'mittel'
                          ? 'text-yellow-600'
                          : 'text-red-600'
                      }`}>
                        {objekt.rendite.toFixed(2)}%
                      </div>
                      <p className="text-xs text-gray-500">Rendite</p>
                    </div>
                    {objekt.status === 'niedrig' && (
                      <AlertTriangle className="h-6 w-6 text-red-500 ml-4" />
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Finanzierungsübersicht */}
        {analytics.finanzierungsZahlungen.length > 0 && (
          <div className="mb-8">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Landmark className="h-5 w-5" />
                  Finanzierung & Darlehen
                </CardTitle>
                <CardDescription>
                  Übersicht aller Darlehensraten, Tilgungen und Zinszahlungen
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                    <div className="flex items-center gap-2 mb-2">
                      <CreditCard className="h-5 w-5 text-red-600" />
                      <span className="text-sm font-medium text-red-900">Gesamt Finanzierung</span>
                    </div>
                    <div className="text-2xl font-bold text-red-700">
                      {analytics.gesamtFinanzierung.toLocaleString('de-DE')}€
                    </div>
                    <p className="text-xs text-red-600 mt-1">
                      {analytics.finanzierungsZahlungen.length} Zahlungen
                    </p>
                  </div>
                  <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingDown className="h-5 w-5 text-orange-600" />
                      <span className="text-sm font-medium text-orange-900">Ø Monatlich</span>
                    </div>
                    <div className="text-2xl font-bold text-orange-700">
                      {analytics.monatlicheFinanzierung.toLocaleString('de-DE', { maximumFractionDigits: 0 })}€
                    </div>
                    <p className="text-xs text-orange-600 mt-1">
                      Durchschnitt pro Monat
                    </p>
                  </div>
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-center gap-2 mb-2">
                      <Building className="h-5 w-5 text-blue-600" />
                      <span className="text-sm font-medium text-blue-900">Restschuld</span>
                    </div>
                    <div className="text-2xl font-bold text-blue-700">
                      {analytics.gesamtRestschuld.toLocaleString('de-DE')}€
                    </div>
                    <p className="text-xs text-blue-600 mt-1">
                      Alle Immobilien
                    </p>
                  </div>
                </div>

                {/* Letzte Finanzierungszahlungen */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">Letzte Zahlungen</h4>
                  <div className="max-h-[300px] overflow-y-auto space-y-2">
                    {analytics.finanzierungsZahlungen.slice(0, 20).map((zahlung: any, index: number) => (
                      <div 
                        key={zahlung.id || index}
                        className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                      >
                        <div className="flex-1">
                          <p className="font-medium text-sm">{zahlung.empfaengername || 'Unbekannt'}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-md">
                            {zahlung.verwendungszweck?.substring(0, 60)}...
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-red-600">
                            -{Math.abs(zahlung.betrag).toLocaleString('de-DE')}€
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(zahlung.buchungsdatum).toLocaleDateString('de-DE')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Zusammenfassung & Weitere Kennzahlen */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="bg-gradient-to-br from-blue-50 to-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-700">Jahresertrag (Brutto)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                {analytics.jahresertrag.toLocaleString('de-DE')}€
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {analytics.monatlicheKaltmiete.toLocaleString('de-DE')}€/Monat
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-50 to-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-700">Ø Miete pro m²</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {analytics.mieteProm2.toFixed(2)}€
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Kaltmiete
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-50 to-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-700">Restschuld</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">
                {analytics.gesamtRestschuld.toLocaleString('de-DE')}€
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {((analytics.gesamtRestschuld / analytics.gesamtPortfolioWert) * 100).toFixed(1)}% vom Gesamtwert
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-50 to-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-700">Gesamtfläche</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">
                {einheiten?.reduce((sum, e) => sum + (e.qm || 0), 0).toFixed(0)} m²
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {analytics.gesamtEinheiten} Einheiten
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};