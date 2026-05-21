import { asaas } from "./asaas.server";

export type PublicPaymentStatus = "pendente" | "pago" | "falhou" | "cancelado" | "estornado";

export type PixGatewayConfig = {
  provider: string;
  apiKey: string;
  config: Record<string, unknown>;
};

export type PixPaymentGateway = {
  provider: string;
  createCustomer: (config: PixGatewayConfig, data: {
    name: string;
    email: string;
    cpfCnpj: string;
    mobilePhone?: string;
  }) => Promise<any>;
  createPixPayment: (
    config: PixGatewayConfig,
    data: Record<string, unknown>,
    options?: { idempotencyKey?: string },
  ) => Promise<any>;
  findPaymentByExternalReference: (config: PixGatewayConfig, externalReference: string) => Promise<any>;
  getPixQrCode: (config: PixGatewayConfig, paymentId: string) => Promise<any>;
  getPayment: (config: PixGatewayConfig, paymentId: string) => Promise<any>;
  refundPayment: (config: PixGatewayConfig, paymentId: string, value: number, description: string) => Promise<any>;
  mapPaymentStatus: (gatewayStatus?: string) => PublicPaymentStatus;
};

const clean = (value: unknown) => {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
};

export const normalizePixGatewayProvider = (provider?: string | null) =>
  String(provider || "asaas").trim().toLowerCase() || "asaas";

const asaasPixGateway: PixPaymentGateway = {
  provider: "asaas",
  createCustomer: (config, data) => asaas.createCustomer(data, config.apiKey),
  createPixPayment: (config, data, options) => asaas.createStorePayment(config.apiKey, data, options),
  findPaymentByExternalReference: (config, externalReference) =>
    asaas.findPaymentByExternalReference(config.apiKey, externalReference),
  getPixQrCode: (config, paymentId) => asaas.getPixQrCode(config.apiKey, paymentId),
  getPayment: (config, paymentId) => asaas.getPayment(config.apiKey, paymentId),
  refundPayment: (config, paymentId, value, description) =>
    asaas.refundPayment(config.apiKey, paymentId, value, description),
  mapPaymentStatus: (gatewayStatus) => {
    if (gatewayStatus === "RECEIVED" || gatewayStatus === "CONFIRMED" || gatewayStatus === "RECEIVED_IN_CASH") return "pago";
    if (gatewayStatus === "REFUNDED" || gatewayStatus === "PARTIALLY_REFUNDED") return "estornado";
    if (gatewayStatus === "DELETED" || gatewayStatus === "CANCELLED") return "cancelado";
    if (gatewayStatus === "OVERDUE") return "falhou";
    return "pendente";
  },
};

export const pixPaymentGateways: Record<string, PixPaymentGateway> = {
  asaas: asaasPixGateway,
};

export const resolvePixGatewayConfig = (
  settings: any,
  gateways: Record<string, PixPaymentGateway> = pixPaymentGateways,
) => {
  const provider = normalizePixGatewayProvider(settings?.payment_gateway_provider || (settings?.asaas_api_key ? "asaas" : null));
  const apiKey = clean(settings?.payment_gateway_api_key) || clean(settings?.asaas_api_key);
  if (!apiKey) return null;

  const gateway = gateways[provider];
  if (!gateway) {
    throw new Error(`Gateway de pagamento "${provider}" nao suportado para PIX.`);
  }

  return {
    provider,
    apiKey,
    config: asRecord(settings?.payment_gateway_config),
    gateway,
  };
};

export const hasPixGatewayConfig = (settings: any, gateways: Record<string, PixPaymentGateway> = pixPaymentGateways) => {
  try {
    return Boolean(resolvePixGatewayConfig(settings, gateways));
  } catch {
    return false;
  }
};

export const testPixGatewayConnection = async (provider: string | null | undefined, apiKey: string) => {
  const normalizedProvider = normalizePixGatewayProvider(provider);
  if (normalizedProvider !== "asaas") {
    return { success: false, message: "Gateway de pagamento ainda nao suportado para teste automatico." };
  }

  const response = await fetch(`${process.env.ASAAS_ENVIRONMENT === "sandbox" ? "https://sandbox.asaas.com/api/v3" : "https://www.asaas.com/api/v3"}/customers?limit=1`, {
    headers: {
      access_token: apiKey,
      "User-Agent": "HypeDelivery/1.0",
    },
  });

  if (response.ok) {
    return { success: true, message: "Conexao estabelecida com sucesso." };
  }

  const errorData = await response.json().catch(() => ({}));
  return {
    success: false,
    message: errorData.errors?.[0]?.description || "Falha ao conectar com o gateway. Verifique sua chave de API.",
  };
};
