/**
 * Asaas API Integration Utility
 */

const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_ENVIRONMENT = process.env.ASAAS_ENVIRONMENT || 'production';
const ASAAS_URL = ASAAS_ENVIRONMENT === 'sandbox' 
  ? 'https://sandbox.asaas.com/api/v3' 
  : 'https://www.asaas.com/api/v3';
const PAYMENT_GATEWAY_DEBUG = process.env.PAYMENT_GATEWAY_DEBUG === "true";

console.log(`Asaas integration initialized in ${ASAAS_ENVIRONMENT} mode`);

const redactGatewayText = (value: unknown) =>
  String(value ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>")
    .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, "<document>")
    .replace(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, "<document>")
    .replace(/\d{10,15}/g, "<number>");

const summarizeGatewayError = (data: any) => {
  const errors = Array.isArray(data?.errors)
    ? data.errors.map((item: any) => redactGatewayText(item?.description || item?.message))
    : [];
  if (!errors.length && data?.message) errors.push(redactGatewayText(data.message));
  return errors.slice(0, 3);
};

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

async function asaasRequest(
  endpoint: string,
  method: string,
  apiKey: string,
  body?: any,
  options?: { idempotencyKey?: string },
) {
  const url = `${ASAAS_URL}${endpoint}`;
  if (PAYMENT_GATEWAY_DEBUG) console.log(`Asaas Request: ${method} ${endpoint}`);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'access_token': apiKey,
    'User-Agent': 'HypeDelivery/1.0',
  };

  if (options?.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data;
    try {
      data = await response.json();
    } catch (e) {
      console.error("Asaas JSON Parse Error:", e instanceof Error ? e.message : "parse_error");
      data = { message: "Erro ao processar resposta do gateway" };
    }
    
    if (!response.ok) {
      console.error("Asaas Error", {
        status: response.status,
        endpoint,
        errors: summarizeGatewayError(data),
      });
      return { 
        errors: data.errors || [{ description: data.message || 'Erro desconhecido no Asaas' }] 
      };
    }

    return data;
  } catch (error) {
    console.error("Asaas Network/Fetch Error:", error instanceof Error ? error.message : "network_error");
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
  async createStorePayment(storeApiKey: string, data: any, options?: { idempotencyKey?: string }) {
    return asaasRequest('/payments', 'POST', storeApiKey, {
      ...data,
      billingType: 'PIX', // Initially PIX only for stores
    }, options);
  },

  async findPaymentByExternalReference(storeApiKey: string, externalReference: string) {
    const params = new URLSearchParams({
      externalReference,
      limit: "1",
    });
    return asaasRequest(`/payments?${params.toString()}`, 'GET', storeApiKey);
  },

  async getPixQrCode(storeApiKey: string, paymentId: string) {
    return asaasRequest(`/payments/${paymentId}/pixQrCode`, 'GET', storeApiKey);
  },

  async getPayment(storeApiKey: string, paymentId: string) {
    return asaasRequest(`/payments/${paymentId}`, 'GET', storeApiKey);
  },

  async refundPayment(storeApiKey: string, paymentId: string, value: number, description: string) {
    return asaasRequest(`/payments/${paymentId}/refund`, 'POST', storeApiKey, {
      value,
      description
    });
  }
};
