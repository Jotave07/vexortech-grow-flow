/**
 * Cliente Asaas da CONTA CENTRAL da plataforma (modelo centralizado).
 *
 * Usa ASAAS_API_KEY (chave da plataforma) para:
 *  - receber todos os PIX de pedido na conta central;
 *  - estornar o cliente (refund);
 *  - repassar (transfer PIX) ao lojista apos a entrega.
 *
 * NAO confundir com src/server/asaas.server.ts, que opera com a chave de cada
 * loja (modelo descentralizado legado) e com assinaturas da plataforma.
 *
 * Toda chamada loga request/response mascarando dados sensiveis e NUNCA lanca:
 * em erro retorna { errors: [{ description }] } (mesmo contrato do client legado).
 */

const ENV = (process.env.ASAAS_ENVIRONMENT || "production").trim().toLowerCase();
const BASE_URL =
  ENV === "sandbox"
    ? "https://sandbox.asaas.com/api/v3"
    : "https://www.asaas.com/api/v3";

const platformKey = () => (process.env.ASAAS_API_KEY || "").trim();

export type AsaasError = { errors: Array<{ code?: string; description: string }> };
export const isAsaasError = (v: any): v is AsaasError => Boolean(v?.errors?.length);

const errDescription = (data: any, fallback: string) =>
  String(data?.errors?.[0]?.description || data?.message || fallback);

const mask = (s?: string | null) => {
  const v = String(s ?? "");
  if (v.length <= 4) return "***";
  return `${v.slice(0, 2)}***${v.slice(-2)}`;
};

type ReqOptions = { idempotencyKey?: string };

const request = async (
  endpoint: string,
  method: string,
  body?: unknown,
  options?: ReqOptions,
): Promise<any> => {
  const key = platformKey();
  if (!key) {
    return { errors: [{ description: "ASAAS_API_KEY (conta central) nao configurada." }] };
  }

  const url = `${BASE_URL}${endpoint}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    access_token: key,
    "User-Agent": "vexortech-central/1.0",
  };
  if (options?.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const logBase = {
    scope: "asaas:central",
    method,
    url,
    idempotencyKey: options?.idempotencyKey || null,
    accessToken: mask(key),
  };

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data: any;
    try {
      data = await response.json();
    } catch {
      data = { message: "Resposta invalida do gateway" };
    }

    if (!response.ok) {
      console.error(JSON.stringify({ ...logBase, event: "asaas.error", status: response.status }));
      return {
        errors: data?.errors || [{ description: data?.message || `Erro ${response.status} no Asaas` }],
      };
    }

    if (process.env.SQL_DEBUG === "true") {
      console.debug(JSON.stringify({ ...logBase, event: "asaas.ok", status: response.status }));
    }
    return data;
  } catch (error: any) {
    console.error(JSON.stringify({ ...logBase, event: "asaas.network_error", message: error?.message }));
    return { errors: [{ description: "Falha na comunicacao com o gateway de pagamento." }] };
  }
};

export type AsaasPixKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP";

export type CentralPaymentStatus = "pendente" | "pago" | "falhou" | "cancelado" | "estornado";
export type CentralTransferStatus =
  | "PROCESSANDO"
  | "ENVIADO"
  | "FALHOU"
  | "CANCELADO";

export const asaasCentral = {
  isConfigured: () => Boolean(platformKey()),
  baseUrl: BASE_URL,
  environment: ENV,

  // ---- Customer (na conta central) ----
  createCustomer: (data: { name: string; email?: string; cpfCnpj: string; mobilePhone?: string }) =>
    request("/customers", "POST", data),

  findCustomerByDocument: (cpfCnpj: string) =>
    request(`/customers?cpfCnpj=${encodeURIComponent(cpfCnpj)}&limit=1`, "GET"),

  // ---- Cobranca PIX (entrada na conta central) ----
  createPixPayment: (
    data: {
      customer: string;
      value: number;
      dueDate: string;
      description?: string;
      externalReference?: string;
    },
    options?: ReqOptions,
  ) => request("/payments", "POST", { ...data, billingType: "PIX" }, options),

  findPaymentByExternalReference: (externalReference: string) =>
    request(`/payments?externalReference=${encodeURIComponent(externalReference)}&limit=1`, "GET"),

  getPixQrCode: (paymentId: string) => request(`/payments/${paymentId}/pixQrCode`, "GET"),
  getPayment: (paymentId: string) => request(`/payments/${paymentId}`, "GET"),

  refundPayment: (paymentId: string, value: number, description: string) =>
    request(`/payments/${paymentId}/refund`, "POST", { value, description }),

  // ---- Repasse (transfer PIX para a chave do lojista) ----
  createPixTransfer: (
    data: {
      value: number;
      pixAddressKey: string;
      pixAddressKeyType: AsaasPixKeyType;
      description?: string;
      externalReference?: string;
    },
    options?: ReqOptions,
  ) =>
    request(
      "/transfers",
      "POST",
      {
        value: data.value,
        operationType: "PIX",
        pixAddressKey: data.pixAddressKey,
        pixAddressKeyType: data.pixAddressKeyType,
        description: data.description,
        externalReference: data.externalReference,
      },
      options,
    ),

  getTransfer: (transferId: string) => request(`/transfers/${transferId}`, "GET"),

  // ---- Saldo (para conferir capacidade de estorno/repasse) ----
  getBalance: () => request("/finance/balance", "GET"),

  myAccount: () => request("/myAccount", "GET"),

  mapPaymentStatus: (status?: string): CentralPaymentStatus => {
    if (status === "RECEIVED" || status === "CONFIRMED" || status === "RECEIVED_IN_CASH") return "pago";
    if (status === "REFUNDED" || status === "PARTIALLY_REFUNDED" || status === "REFUND_REQUESTED")
      return "estornado";
    if (status === "DELETED") return "cancelado";
    if (status === "OVERDUE") return "falhou";
    return "pendente";
  },

  /** Mapeia status de transferencia Asaas para o status interno de repasse. */
  mapTransferStatus: (status?: string): CentralTransferStatus => {
    switch (status) {
      case "DONE":
        return "ENVIADO";
      case "FAILED":
        return "FALHOU";
      case "CANCELLED":
        return "CANCELADO";
      case "PENDING":
      case "BANK_PROCESSING":
      case "IN_BANK_PROCESSING":
      default:
        return "PROCESSANDO";
    }
  },
};

/** Normaliza/valida o tipo de chave PIX para o enum aceito pelo Asaas. */
export const normalizePixKeyType = (raw?: string | null): AsaasPixKeyType | null => {
  const v = String(raw ?? "").trim().toUpperCase();
  const map: Record<string, AsaasPixKeyType> = {
    CPF: "CPF",
    CNPJ: "CNPJ",
    EMAIL: "EMAIL",
    "E-MAIL": "EMAIL",
    PHONE: "PHONE",
    CELULAR: "PHONE",
    TELEFONE: "PHONE",
    EVP: "EVP",
    ALEATORIA: "EVP",
    RANDOM: "EVP",
    CHAVE_ALEATORIA: "EVP",
  };
  return map[v] ?? null;
};
