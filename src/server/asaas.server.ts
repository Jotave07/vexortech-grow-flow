/**
 * Asaas API Integration Utility
 */

const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_ENVIRONMENT = process.env.ASAAS_ENVIRONMENT || 'production';
const ASAAS_URL = ASAAS_ENVIRONMENT === 'sandbox' 
  ? 'https://sandbox.asaas.com/api/v3' 
  : 'https://www.asaas.com/api/v3';

console.log(`Asaas integration initialized in ${ASAAS_ENVIRONMENT} mode`);

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

async function asaasRequest(endpoint: string, method: string, apiKey: string, body?: any) {
  const url = `${ASAAS_URL}${endpoint}`;
  console.log(`Asaas Request: ${method} ${url}`);
  
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'access_token': apiKey,
        'User-Agent': 'VexorDelivery/1.0',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error(`Asaas Error (${response.status}):`, JSON.stringify(data));
      return { 
        errors: data.errors || [{ description: data.message || 'Erro desconhecido no Asaas' }] 
      };
    }

    return data;
  } catch (error) {
    console.error(`Asaas Network/Fetch Error:`, error);
    return { 
      errors: [{ description: 'Falha na comunicação com o gateway de pagamento.' }] 
    };
  }
}

export const asaas = {
  /**
   * Global (Platform) API calls
   */
  async createCustomer(data: AsaasCustomer, apiKey?: string) {
    const key = apiKey || ASAAS_API_KEY;
    if (!key) return { errors: [{ description: 'API Key do Asaas não configurada.' }] };
    return asaasRequest('/customers', 'POST', key, data);
  },

  async createSubscription(data: AsaasSubscription) {
    if (!ASAAS_API_KEY) return { errors: [{ description: 'API Key do Asaas não configurada.' }] };
    return asaasRequest('/subscriptions', 'POST', ASAAS_API_KEY, data);
  },

  /**
   * Store-level API calls (using store's own API Key)
   */
  async createStorePayment(storeApiKey: string, data: any) {
    return asaasRequest('/payments', 'POST', storeApiKey, {
      ...data,
      billingType: 'PIX', // Initially PIX only for stores
    });
  },

  async getPixQrCode(storeApiKey: string, paymentId: string) {
    return asaasRequest(`/payments/${paymentId}/pixQrCode`, 'GET', storeApiKey);
  }
};
