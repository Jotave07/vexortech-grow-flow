/**
 * Asaas API Integration Utility
 */

const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = 'https://www.asaas.com/api/v3';

interface AsaasCustomer {
  name: string;
  email: string;
  cpfCnpj: string;
  mobilePhone?: string;
}

interface AsaasSubscription {
  customer: string;
  billingType: 'PIX' | 'CREDIT_CARD' | 'BOLETO';
  value: number;
  nextDueDate: string;
  cycle: 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  description?: string;
  externalReference?: string;
}

export const asaas = {
  /**
   * Global (Platform) API calls
   */
  async createCustomer(data: AsaasCustomer) {
    const response = await fetch(`${ASAAS_URL}/customers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access_token': ASAAS_API_KEY!,
      },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  async createSubscription(data: AsaasSubscription) {
    const response = await fetch(`${ASAAS_URL}/subscriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access_token': ASAAS_API_KEY!,
      },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  /**
   * Store-level API calls (using store's own API Key)
   */
  async createStorePayment(storeApiKey: string, data: any) {
    const response = await fetch(`${ASAAS_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access_token': storeApiKey,
      },
      body: JSON.stringify({
        ...data,
        billingType: 'PIX', // Initially PIX only for stores
      }),
    });
    return response.json();
  },

  async getPixQrCode(storeApiKey: string, paymentId: string) {
    const response = await fetch(`${ASAAS_URL}/payments/${paymentId}/pixQrCode`, {
      method: 'GET',
      headers: {
        'access_token': storeApiKey,
      },
    });
    return response.json();
  }
};
