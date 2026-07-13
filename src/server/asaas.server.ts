/**
 * Asaas API Integration Utility
 */

const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const configuredAsaasEnvironment = process.env.ASAAS_ENVIRONMENT?.trim().toLowerCase();
const ASAAS_ENVIRONMENT =
  configuredAsaasEnvironment || (process.env.NODE_ENV === "production" ? "production" : "sandbox");
if (!new Set(["sandbox", "production"]).has(ASAAS_ENVIRONMENT)) {
  throw new Error("ASAAS_ENVIRONMENT deve ser sandbox ou production.");
}
const ASAAS_URL =
  ASAAS_ENVIRONMENT === "sandbox"
    ? "https://sandbox.asaas.com/api/v3"
    : "https://www.asaas.com/api/v3";
const PAYMENT_GATEWAY_DEBUG = process.env.PAYMENT_GATEWAY_DEBUG === "true";
const ASAAS_REQUEST_TIMEOUT_MS = 25000;

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
  externalReference?: string;
}

interface AsaasSubscription {
  customer: string;
  billingType: "CREDIT_CARD" | "BOLETO";
  value: number;
  nextDueDate: string;
  cycle: "WEEKLY" | "MONTHLY" | "YEARLY";
  description?: string;
  externalReference?: string;
  creditCard?: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  creditCardHolderInfo?: {
    name: string;
    email: string;
    cpfCnpj: string;
    postalCode: string;
    addressNumber: string;
    addressComplement?: string | null;
    phone?: string;
    mobilePhone?: string;
  };
  remoteIp?: string;
}

type AsaasSubscriptionUpdate = Partial<AsaasSubscription> & {
  status?: "ACTIVE" | "INACTIVE";
};

async function asaasRequest(
  endpoint: string,
  method: string,
  apiKey: string,
  body?: any,
  options?: { idempotencyKey?: string },
) {
  const url = `${ASAAS_URL}${endpoint}`;
  if (PAYMENT_GATEWAY_DEBUG) console.log(`Asaas Request: ${method} ${endpoint}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ASAAS_REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    access_token: apiKey,
    "User-Agent": "HypeDelivery/1.0",
  };

  if (options?.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    let data;
    let jsonParseFailed = false;
    try {
      data = await response.json();
    } catch (e) {
      jsonParseFailed = true;
      console.error("Asaas JSON Parse Error:", e instanceof Error ? e.message : "parse_error");
      data = { message: "Erro ao processar resposta do gateway" };
    }

    if (jsonParseFailed) {
      if (response.ok && (response.status === 204 || method === "DELETE")) {
        return { success: true };
      }
      return {
        status: response.status,
        retryable: response.ok || response.status >= 500 || response.status === 429,
        errors: [{ description: "Resposta invalida do gateway de pagamento." }],
      };
    }

    if (!response.ok) {
      console.error("Asaas Error", {
        status: response.status,
        endpoint,
        errors: summarizeGatewayError(data),
      });
      // 5xx/429 sao indeterminados: a operacao pode ter sido aplicada no gateway.
      // Sinalizamos `retryable` para que o caller decida reconciliar (idealmente via
      // Idempotency-Key) em vez de criar um recurso duplicado.
      return {
        status: response.status,
        retryable: response.status >= 500 || response.status === 429,
        errors: data.errors || [{ description: data.message || "Erro desconhecido no Asaas" }],
      };
    }

    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      // Timeout: a requisicao PODE ter sido processada no Asaas (ex.: assinatura criada)
      // mesmo sem resposta. Marcamos timeout/retryable para o caller reconciliar em vez
      // de assumir falha e recriar (o que duplicaria a cobranca).
      console.error("Asaas Request Timeout", { endpoint, timeoutMs: ASAAS_REQUEST_TIMEOUT_MS });
      return {
        timeout: true,
        retryable: true,
        errors: [{ description: "Tempo esgotado na comunicacao com o gateway de pagamento." }],
      };
    }
    console.error(
      "Asaas Network/Fetch Error:",
      error instanceof Error ? error.message : "network_error",
    );
    return {
      retryable: true,
      errors: [{ description: "Falha na comunicação com o gateway de pagamento." }],
    };
  } finally {
    clearTimeout(timeout);
  }
}

const buildQuery = (params: Record<string, string | number | undefined | null>) => {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const normalized = String(value ?? "").trim();
    if (normalized) searchParams.set(key, normalized);
  }
  const query = searchParams.toString();
  return query ? `?${query}` : "";
};

const normalizeIdentityDocument = (value: unknown) => String(value || "").replace(/\D/g, "");

const subscriptionsForReference = (response: any, data: AsaasSubscription) => {
  const subscriptions = Array.isArray(response?.data) ? response.data : [];
  return subscriptions.filter(
    (subscription: any) =>
      subscription?.id && subscription.externalReference === data.externalReference,
  );
};

const matchingSubscriptionsFromList = (response: any, data: AsaasSubscription) => {
  return subscriptionsForReference(response, data).filter(
    (subscription: any) =>
      subscription.customer === data.customer &&
      subscription.billingType === data.billingType &&
      Math.round(Number(subscription.value) * 100) === Math.round(Number(data.value) * 100),
  );
};

const findExistingSubscription = async (apiKey: string, data: AsaasSubscription) => {
  if (!data.externalReference) return { match: null, duplicate: false };
  const response = await asaasRequest(
    `/subscriptions${buildQuery({
      externalReference: data.externalReference,
      status: "ACTIVE",
      limit: 100,
    })}`,
    "GET",
    apiKey,
  );
  if (response?.errors) {
    return {
      match: null,
      duplicate: false,
      conflict: false,
      lookupError: true,
      retryable: Boolean(response.retryable || response.timeout),
      status: response.status,
    };
  }
  const candidates = subscriptionsForReference(response, data);
  const matches = matchingSubscriptionsFromList(response, data);
  return {
    match: candidates.length === 1 ? matches[0] || null : null,
    duplicate: candidates.length > 1 || response?.hasMore === true,
    conflict: candidates.length === 1 && matches.length === 0,
    lookupError: false,
    retryable: false,
    status: response?.status,
  };
};

const findExistingCustomer = async (apiKey: string, data: AsaasCustomer) => {
  const searches: Record<string, string | number>[] = [];
  if (data.externalReference && data.cpfCnpj) {
    searches.push({ externalReference: data.externalReference, cpfCnpj: data.cpfCnpj, limit: 1 });
  }
  if (data.cpfCnpj) searches.push({ cpfCnpj: data.cpfCnpj, limit: 1 });

  for (const params of searches) {
    const result = await asaasRequest(`/customers${buildQuery(params)}`, "GET", apiKey);
    if (result?.errors) {
      return {
        match: null,
        lookupError: true,
        conflict: false,
        duplicate: false,
        status: result.status,
        retryable: Boolean(result.retryable || result.timeout),
      };
    }
    const candidates = Array.isArray(result?.data)
      ? result.data.filter((customer: any) => customer?.id)
      : [];
    const matches = candidates.filter(
      (customer: any) =>
        normalizeIdentityDocument(customer.cpfCnpj) === normalizeIdentityDocument(data.cpfCnpj),
    );
    if (matches.length === 1 && candidates.length === 1) {
      return {
        match: matches[0],
        lookupError: false,
        conflict: false,
        duplicate: false,
      };
    }
    if (candidates.length > 1 || result?.hasMore === true) {
      return {
        match: null,
        lookupError: false,
        conflict: false,
        duplicate: true,
      };
    }
    if (candidates.length === 1 && matches.length === 0) {
      return {
        match: null,
        lookupError: false,
        conflict: true,
        duplicate: false,
      };
    }
  }

  return { match: null, lookupError: false, conflict: false, duplicate: false };
};

export const asaas = {
  /**
   * Global (Platform) API calls
   */
  async createCustomer(
    data: AsaasCustomer,
    apiKey?: string,
    options?: { idempotencyKey?: string },
  ) {
    const key = apiKey || ASAAS_API_KEY;
    if (!key) return { errors: [{ description: "API Key do Asaas não configurada." }] };
    const existingCustomer = await findExistingCustomer(key, data);
    if (existingCustomer.lookupError) {
      return {
        status: existingCustomer.status,
        retryable: existingCustomer.retryable,
        reconciliationRequired: true,
        errors: [
          {
            description: "Nao foi possivel reconciliar o cliente antes de criar o cadastro.",
          },
        ],
      };
    }
    if (existingCustomer.duplicate || existingCustomer.conflict) {
      return {
        reconciliationRequired: true,
        errors: [
          {
            description: "O documento do cliente exige reconciliacao manual antes do cadastro.",
          },
        ],
      };
    }
    if (existingCustomer.match) return existingCustomer.match;

    const created = await asaasRequest("/customers", "POST", key, data, options);
    if (created?.status === 409 || created?.retryable || created?.timeout) {
      const reconciledCustomer = await findExistingCustomer(key, data);
      if (reconciledCustomer.match) return reconciledCustomer.match;
    }

    return created;
  },

  async createSubscription(data: AsaasSubscription, options?: { idempotencyKey?: string }) {
    if (!ASAAS_API_KEY) return { errors: [{ description: "API Key do Asaas não configurada." }] };
    const existing = await findExistingSubscription(ASAAS_API_KEY, data);
    if (existing.lookupError) {
      return {
        status: existing.status,
        retryable: existing.retryable,
        errors: [
          {
            description:
              "Nao foi possivel reconciliar assinaturas ativas antes de criar uma nova cobranca.",
          },
        ],
        reconciliationRequired: true,
      };
    }
    if (existing.duplicate) {
      console.error("Asaas duplicate active subscriptions found for external reference", {
        externalReference: data.externalReference,
      });
      return {
        errors: [{ description: "Mais de uma assinatura ativa foi encontrada para esta loja." }],
        reconciliationRequired: true,
      };
    }
    if (existing.conflict) {
      console.error("Asaas active subscription conflicts with the requested contract", {
        externalReference: data.externalReference,
      });
      return {
        errors: [
          {
            description:
              "Uma assinatura ativa divergente exige reconciliacao antes de criar outra cobranca.",
          },
        ],
        reconciliationRequired: true,
      };
    }
    if (existing.match) return existing.match;

    const created = await asaasRequest("/subscriptions", "POST", ASAAS_API_KEY, data, options);
    if (created?.retryable || created?.timeout || created?.status === 409) {
      const reconciled = await findExistingSubscription(ASAAS_API_KEY, data);
      if (reconciled.lookupError) return created;
      if (reconciled.duplicate) {
        console.error("Asaas duplicate active subscriptions found after create", {
          externalReference: data.externalReference,
        });
        return {
          errors: [{ description: "Mais de uma assinatura ativa foi encontrada para esta loja." }],
          reconciliationRequired: true,
        };
      }
      if (reconciled.conflict) {
        return {
          errors: [
            {
              description:
                "Uma assinatura ativa divergente exige reconciliacao antes de criar outra cobranca.",
            },
          ],
          reconciliationRequired: true,
        };
      }
      if (reconciled.match) return reconciled.match;
    }
    return created;
  },

  async updateSubscription(subscriptionId: string, data: AsaasSubscriptionUpdate) {
    if (!ASAAS_API_KEY) return { errors: [{ description: "API Key do Asaas não configurada." }] };
    return asaasRequest(`/subscriptions/${subscriptionId}`, "PUT", ASAAS_API_KEY, data);
  },

  async getSubscription(subscriptionId: string) {
    if (!ASAAS_API_KEY) return { errors: [{ description: "API Key do Asaas nao configurada." }] };
    return asaasRequest(
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      "GET",
      ASAAS_API_KEY,
    );
  },

  async cancelSubscription(subscriptionId: string) {
    if (!ASAAS_API_KEY) return { errors: [{ description: "API Key do Asaas não configurada." }] };
    const result = await asaasRequest(`/subscriptions/${subscriptionId}`, "DELETE", ASAAS_API_KEY);
    return result?.status === 404 ? { success: true, alreadyAbsent: true } : result;
  },

  async listSubscriptionPayments(subscriptionId: string) {
    if (!ASAAS_API_KEY) return { errors: [{ description: "API Key do Asaas nao configurada." }] };
    return asaasRequest(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/payments`,
      "GET",
      ASAAS_API_KEY,
    );
  },

  /**
   * Store-level external Pix API calls are disabled by design.
   * Order Pix is paid directly to the store key and approved manually.
   */
  async createStorePayment(storeApiKey: string, data: any, options?: { idempotencyKey?: string }) {
    return {
      errors: [
        {
          description:
            "Pix de pedidos usa chave Pix da loja e confirmacao manual, sem API externa.",
        },
      ],
    };
  },

  async findPaymentByExternalReference(storeApiKey: string, externalReference: string) {
    return { errors: [{ description: "Consulta externa de Pix de pedido desabilitada." }] };
  },

  async getPixQrCode(storeApiKey: string, paymentId: string) {
    return { errors: [{ description: "QR Code externo de Pix de pedido desabilitado." }] };
  },

  async getPayment(storeApiKey: string, paymentId: string) {
    return { errors: [{ description: "Consulta externa de Pix de pedido desabilitada." }] };
  },

  async refundPayment(storeApiKey: string, paymentId: string, value: number, description: string) {
    return { errors: [{ description: "Estorno externo de Pix de pedido desabilitado." }] };
  },
};
