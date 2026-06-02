interface ContractCreatedPayload {
  contractId: string;
  unitId: string;
  tenants: Array<{
    id: string;
    name: string;
    email?: string;
    role: string;
  }>;
  contractData: {
    rent: number;
    operatingCosts: number;
    deposit?: number;
    startDate: string;
    endDate?: string;
  };
  property: {
    name: string;
    address: string;
  };
  timestamp: string;
}

export class ContractWebhookService {
  private static WEBHOOK_URL = process.env.VITE_CONTRACT_WEBHOOK_URL || 'https://your-external-system.com/webhook/contract-created';

  static async notifyContractCreated(payload: ContractCreatedPayload): Promise<boolean> {
    try {
      const response = await fetch(this.WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Source': 'lovable-rental-management'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        return false;
      }

      return true;

    } catch (error: unknown) {
      console.error('[ContractWebhookService] notifyContractCreated fehlgeschlagen:', error);
      return false;
    }
  }

  static async notifyContractTerminated(contractId: string, terminationDate: string): Promise<boolean> {
    try {
      const payload = {
        contractId,
        terminationDate,
        event: 'contract_terminated',
        timestamp: new Date().toISOString(),
        source: 'lovable-rental-management'
      };

      const response = await fetch(this.WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Source': 'lovable-rental-management'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        console.error('[ContractWebhookService] notifyContractTerminated HTTP-Fehler:', response.status, response.statusText);
      }
      return response.ok;

    } catch (error: unknown) {
      console.error('[ContractWebhookService] notifyContractTerminated fehlgeschlagen:', error);
      return false;
    }
  }
}