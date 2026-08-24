/**
 * Service für den Upload von Mietvertrags-PDFs an einen externen Webhook
 * zur automatischen Extraktion von Vertragsdaten
 */

export interface MieterData {
  vorname: string;
  nachname: string;
  hauptmail?: string;
  telnr?: string;
  geburtsdatum?: string;
  rolle: 'hauptmieter' | 'mitmieter';
}

export interface ExtractedContractData {
  // Mieter-Informationen
  mieter?: MieterData[];
  
  // Vertragsdaten
  kaltmiete?: number;
  betriebskosten?: number;
  kaution_betrag?: number;
  start_datum?: string;
  ende_datum?: string | null;
  lastschrift?: boolean;
  bankkonto_mieter?: string;
  ruecklastschrift_gebuehr?: number;
  verwendungszweck?: string;
  
  // Zählerstände
  strom_einzug?: number;
  gas_einzug?: number;
  kaltwasser_einzug?: number;
  warmwasser_einzug?: number;
}

export interface WebhookResponse {
  success: boolean;
  extractedData?: ExtractedContractData;
  error?: string;
  confidence?: 'high' | 'medium' | 'low';
  fieldsExtracted?: number;
}

export class ContractPdfWebhookService {
  // Webhook URL - kann später über Config/Environment konfiguriert werden
  private static WEBHOOK_URL = 'https://k01-2025-u36730.vm.elestio.app/webhook/02f564b6-f103-4d5d-a631-a5dc2c795d00';
  
  /**
   * Sendet ein PDF-Dokument an den Webhook zur Verarbeitung
   */
  static async uploadAndExtractContract(file: File): Promise<WebhookResponse> {
    try {
      // Erstelle FormData für Multipart-Upload
      const formData = new FormData();
      formData.append('pdf', file, file.name);
      formData.append('filename', file.name);
      formData.append('filesize', file.size.toString());
      formData.append('mimetype', file.type);
      
      // Optional: Zusätzliche Metadaten mitschicken
      formData.append('timestamp', new Date().toISOString());
      formData.append('source', 'niimmo-dashboard');
      
      // Sende Request an Webhook
      const response = await fetch(this.WEBHOOK_URL, {
        method: 'POST',
        body: formData,
        // Keine Content-Type Header setzen - wird automatisch mit boundary gesetzt
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Webhook-Fehler (Status ${response.status}): ${errorText || 'Unbekannter Fehler'}`);
      }

      // Parse JSON-Response
      const responseText = await response.text();

      // Versuche JSON zu parsen
      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error(`Ungültige JSON-Antwort vom Webhook: ${responseText.substring(0, 100)}`);
      }

      
      // Prüfe ob die Response das erwartete Format hat
      if (!data.success && data.message) {
        // n8n hat den Workflow gestartet, aber noch keine Daten extrahiert
        throw new Error(`Webhook-Workflow wurde gestartet, aber keine Daten zurückgegeben. Bitte konfigurieren Sie den n8n-Workflow, um die extrahierten Daten direkt zurückzugeben (nicht asynchron).`);
      }
      
      // Wenn success fehlt, aber extractedData vorhanden ist, setze success=true
      if (!Object.prototype.hasOwnProperty.call(data, 'success') && data.extractedData) {
        data.success = true;
      }
      
      return data as WebhookResponse;
      
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Unbekannter Fehler beim Upload',
      };
    }
  }
  
  /**
   * Validiert extrahierte Vertragsdaten auf Plausibilität
   */
  static validateExtractedData(data: ExtractedContractData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Validiere Miete
    if (data.kaltmiete !== undefined) {
      if (data.kaltmiete < 0) {
        errors.push('Kaltmiete kann nicht negativ sein');
      }
      if (data.kaltmiete > 20000) {
        errors.push('Kaltmiete erscheint unrealistisch hoch (> 20.000€)');
      }
    }
    
    // Validiere Betriebskosten
    if (data.betriebskosten !== undefined) {
      if (data.betriebskosten < 0) {
        errors.push('Betriebskosten können nicht negativ sein');
      }
      if (data.betriebskosten > 5000) {
        errors.push('Betriebskosten erscheinen unrealistisch hoch (> 5.000€)');
      }
    }
    
    // Validiere Kaution
    if (data.kaution_betrag !== undefined) {
      if (data.kaution_betrag < 0) {
        errors.push('Kaution kann nicht negativ sein');
      }
      // Kaution sollte typischerweise 2-3 Kaltmieten sein
      if (data.kaltmiete && data.kaution_betrag > data.kaltmiete * 5) {
        errors.push('Kaution erscheint unrealistisch hoch (> 5x Kaltmiete)');
      }
    }
    
    // Validiere Datum
    if (data.start_datum) {
      const startDate = new Date(data.start_datum);
      const now = new Date();
      const tenYearsAgo = new Date(now.getFullYear() - 10, now.getMonth(), now.getDate());
      const fiveYearsForward = new Date(now.getFullYear() + 5, now.getMonth(), now.getDate());
      
      if (isNaN(startDate.getTime())) {
        errors.push('Start-Datum ist ungültig');
      } else if (startDate < tenYearsAgo) {
        errors.push('Start-Datum liegt mehr als 10 Jahre zurück');
      } else if (startDate > fiveYearsForward) {
        errors.push('Start-Datum liegt mehr als 5 Jahre in der Zukunft');
      }
    }
    
    // Validiere End-Datum
    if (data.ende_datum && data.start_datum) {
      const endDate = new Date(data.ende_datum);
      const startDate = new Date(data.start_datum);
      
      if (isNaN(endDate.getTime())) {
        errors.push('End-Datum ist ungültig');
      } else if (endDate <= startDate) {
        errors.push('End-Datum muss nach Start-Datum liegen');
      }
    }
    
    // Validiere Mieter-Daten
    if (data.mieter && data.mieter.length > 0) {
      data.mieter.forEach((mieter, index) => {
        if (!mieter.vorname || !mieter.nachname) {
          errors.push(`Mieter ${index + 1}: Vor- und Nachname sind erforderlich`);
        }
        if (mieter.hauptmail && !mieter.hauptmail.includes('@')) {
          errors.push(`Mieter ${index + 1}: E-Mail-Format erscheint ungültig`);
        }
      });
      
      const hauptmieterCount = data.mieter.filter(m => m.rolle === 'hauptmieter').length;
      if (hauptmieterCount === 0) {
        errors.push('Mindestens ein Hauptmieter erforderlich');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Formatiert extrahierte Daten für das Formular
   */
  static formatDataForForm(data: ExtractedContractData) {
    const formatted: any = {};
    
    // Finanz-Felder
    if (data.kaltmiete !== undefined) formatted.kaltmiete = data.kaltmiete.toString();
    if (data.betriebskosten !== undefined) formatted.betriebskosten = data.betriebskosten.toString();
    if (data.kaution_betrag !== undefined) formatted.kaution_betrag = data.kaution_betrag.toString();
    if (data.ruecklastschrift_gebuehr !== undefined) formatted.ruecklastschrift_gebuehr = data.ruecklastschrift_gebuehr.toString();
    
    // Datums-Felder
    if (data.start_datum) formatted.start_datum = data.start_datum;
    if (data.ende_datum) formatted.ende_datum = data.ende_datum;
    
    // Text-Felder
    if (data.verwendungszweck) formatted.verwendungszweck = data.verwendungszweck;
    if (data.bankkonto_mieter) formatted.bankkonto_mieter = data.bankkonto_mieter;
    
    // Boolean
    if (data.lastschrift !== undefined) formatted.lastschrift = data.lastschrift;
    
    // Zählerstände
    if (data.strom_einzug !== undefined) formatted.strom_einzug = data.strom_einzug.toString();
    if (data.gas_einzug !== undefined) formatted.gas_einzug = data.gas_einzug.toString();
    if (data.kaltwasser_einzug !== undefined) formatted.kaltwasser_einzug = data.kaltwasser_einzug.toString();
    if (data.warmwasser_einzug !== undefined) formatted.warmwasser_einzug = data.warmwasser_einzug.toString();
    
    return formatted;
  }
}

/**
 * ERWARTETES JSON-FORMAT VOM WEBHOOK:
 * 
 * {
 *   "success": true,
 *   "extractedData": {
 *     "mieter": [
 *       {
 *         "vorname": "Max",
 *         "nachname": "Mustermann",
 *         "hauptmail": "max.mustermann@email.de",
 *         "telnr": "+49 123 456789",
 *         "geburtsdatum": "1990-01-15",
 *         "rolle": "hauptmieter"
 *       },
 *       {
 *         "vorname": "Maria",
 *         "nachname": "Mustermann",
 *         "hauptmail": "maria.mustermann@email.de",
 *         "telnr": "+49 123 456790",
 *         "geburtsdatum": "1992-03-20",
 *         "rolle": "mitmieter"
 *       }
 *     ],
 *     "kaltmiete": 850.00,
 *     "betriebskosten": 150.00,
 *     "kaution_betrag": 2550.00,
 *     "start_datum": "2025-01-01",
 *     "ende_datum": null,
 *     "lastschrift": true,
 *     "bankkonto_mieter": "DE89 3704 0044 0532 0130 00",
 *     "ruecklastschrift_gebuehr": 7.50,
 *     "verwendungszweck": "Miete Wohnung 3a, Saarstraße 37",
 *     "strom_einzug": 12345,
 *     "gas_einzug": 23456,
 *     "kaltwasser_einzug": 34567,
 *     "warmwasser_einzug": 45678
 *   },
 *   "confidence": "high",
 *   "fieldsExtracted": 18
 * }
 * 
 * FEHLER-FORMAT:
 * {
 *   "success": false,
 *   "error": "Fehler bei der PDF-Verarbeitung: [Detaillierte Fehlermeldung]"
 * }
 * 
 * NOTES:
 * - Alle Felder sind optional (außer success)
 * - Datums-Format: YYYY-MM-DD (ISO 8601)
 * - Zahlen als Number, nicht als String
 * - mieter ist ein Array, kann 1-n Mieter enthalten
 * - rolle muss entweder "hauptmieter" oder "mitmieter" sein
 * - Mindestens ein hauptmieter sollte vorhanden sein
 * - confidence gibt Auskunft über die Extraktion: "high", "medium", "low"
 * - fieldsExtracted zählt die erfolgreich extrahierten Felder
 */
