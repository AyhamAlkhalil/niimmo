// Shared calculation logic from MietvertragDetailsModal
export interface RueckstandsBerechnung {
  gesamtForderungen: number;
  gesamtZahlungen: number;
  rueckstand: number;
}

export const calculateMietvertragRueckstand = (
  mietvertrag: any,
  forderungen: any[],
  zahlungen: any[]
): RueckstandsBerechnung => {
  if (!mietvertrag || !forderungen || !zahlungen) {
    return { gesamtForderungen: 0, gesamtZahlungen: 0, rueckstand: 0 };
  }
  
  // Bestimme Startdatum: Mietvertragsbeginn (ohne künstliche Begrenzung auf 2025)
  // Alle Forderungen verwenden - ohne Filterung nach Startdatum
  const alleForderungenAbStart = forderungen.filter(f => {
    if (!f.sollmonat) return false;
    return true;
  });
  
  // Vereinfachte Vorauszahlungs-Logik basierend auf zugeordneter_monat aus DB
  const processVorauszahlungen = (zahlungen: any[], forderungen: any[]) => {
    // Sammle alle Forderungsmonate
    // sollmonat ist DATE ('YYYY-MM-DD'), normalisieren auf 'YYYY-MM' für Vergleich mit zugeordneter_monat
    const forderungsmonate = new Set(forderungen.map(f => f.sollmonat?.slice(0, 7)).filter(Boolean));
    
    // Gruppiere Zahlungen nach zugeordnetem Monat (kommt jetzt aus der DB)
    const zahlungenByMonth = new Map<string, any[]>();
    zahlungen.forEach(z => {
      if (!z.zugeordneter_monat) return;
      const zugeordneterMonat = z.zugeordneter_monat; // YYYY-MM aus DB
      if (!zahlungenByMonth.has(zugeordneterMonat)) {
        zahlungenByMonth.set(zugeordneterMonat, []);
      }
      zahlungenByMonth.get(zugeordneterMonat)!.push(z);
    });
    
    // Verarbeite Vorauszahlungen - verschiebe zu nächstem Forderungsmonat wenn kein passender existiert
    const verarbeiteteZahlungen = [...zahlungen];
    
    zahlungenByMonth.forEach((monthZahlungen, zahlungsmonat) => {
      // Wenn es für diesen Monat keine Forderung gibt
      if (!forderungsmonate.has(zahlungsmonat)) {
        // Finde den nächsten Monat mit Forderung
        const naechsterForderungsmonat = Array.from(forderungsmonate)
          .filter(fm => fm > zahlungsmonat)
          .sort()[0];
        
        if (naechsterForderungsmonat) {
          // Verschiebe alle Zahlungen dieses Monats zum nächsten Forderungsmonat
          monthZahlungen.forEach(zahlung => {
            const zahlungsIndex = verarbeiteteZahlungen.findIndex(z => z.id === zahlung.id);
            if (zahlungsIndex !== -1) {
              // Verwende zugeordneter_monat für die Verschiebung
              verarbeiteteZahlungen[zahlungsIndex] = {
                ...zahlung,
                zugeordneter_monat: naechsterForderungsmonat,
                _verschoben_von: zahlungsmonat // Für Debugging
              };
            }
          });
        }
      }
    });
    
    return verarbeiteteZahlungen;
  };

  // Filtere Zahlungen nach Kategorie (ohne Zeitraum-Filter)
  // Bug-Fix: kategorie === null (unkategorisierte Zahlungen) werden NICHT mehr als Miete gezählt
  // BKA-Zahlungseingänge (Kategorie 'Betriebskostenabrechnung') werden als Ausgleich gewertet
  const relevanteZahlungen = zahlungen.filter(z => {
    if (!z.buchungsdatum) return false;

    return z.kategorie === 'Miete' ||
           z.kategorie === 'Rücklastschrift' ||
           z.kategorie === 'Betriebskostenabrechnung';
  });

  // Wende Vorauszahlungs-Intelligenz an (jetzt basierend auf DB-Feld zugeordneter_monat)
  const verarbeiteteZahlungen = processVorauszahlungen(relevanteZahlungen, alleForderungenAbStart);
  
  // ALLE Forderungen sind sofort als Rückstand zu bewerten (keine Fälligkeitsprüfung)
  // Erst wenn eine Zahlung da ist, verschwindet der Rückstand
  const relevanteForderungen = alleForderungenAbStart;
  
  // Berechne Gesamtforderungen
  const gesamtForderungen = relevanteForderungen.reduce((sum, f) => sum + (Number(f.sollbetrag) || 0), 0);
  
  // Berechne Gesamtzahlungen - ALLE Zahlungen werden direkt eingerechnet (keine Bestätigungslogik)
  let gesamtZahlungen = 0;
  
  for (const zahlung of verarbeiteteZahlungen) {
    const zahlungsBetrag = Number(zahlung.betrag) || 0;
    gesamtZahlungen += zahlungsBetrag;
  }
  
  // Bug-Fix: Rücklastschrift-Gebühren werden NICHT mehr manuell abgezogen,
  // da der DB-Trigger bereits eine Mietforderung dafür erstellt (sonst doppelte Belastung)
  const rueckstand = gesamtForderungen - gesamtZahlungen;
  
  return { gesamtForderungen, gesamtZahlungen, rueckstand };
};

// Einfache Berechnung für Miete-Zahlungen (alle mit Kategorie "Miete")
export const calculateMieteZahlungen = (zahlungen: any[]): number => {
  return zahlungen
    .filter(z => z.kategorie === 'Miete')
    .reduce((sum, z) => sum + (Number(z.betrag) || 0), 0);
};

// Berechnung der gesamten Rücklastschrift-Gebühren
export const calculateRuecklastschriftGebuehren = (zahlungen: any[]): number => {
  return zahlungen
    .filter(z => z.kategorie === 'Rücklastschrift')
    .reduce((sum, z) => sum + (Number(z.ruecklastschrift_gebuehr) || 0), 0);
};
