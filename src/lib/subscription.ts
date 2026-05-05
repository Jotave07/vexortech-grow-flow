import type { Tables } from "@/integrations/supabase/types";

export type PlanRecord = Tables<"plans">;
export type SubscriptionRecord = Tables<"subscriptions">;
export type SubscriptionAccessState =
  | "no_plan"
  | "pending_payment"
  | "active"
  | "past_due"
  | "canceled"
  | "blocked";

export type SubscriptionFeature =
  | "coupons"
  | "advancedReports"
  | "customBranding"
  | "customDomain"
  | "advancedDelivery"
  | "automations"
  | "paymentIntegrations"
  | "multiStore"
  | "internalUsers";

export type SubscriptionLimitKey =
  | "products"
  | "monthlyOrders"
  | "stores"
  | "internalUsers";

export type PlanLimits = Record<SubscriptionLimitKey, number | null>;
export type PlanCapabilities = Record<SubscriptionFeature, boolean>;

export type NormalizedPlan = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  marketingFeatures: string[];
  limits: PlanLimits;
  capabilities: PlanCapabilities;
};

type PlanPreset = {
  limits: Partial<PlanLimits>;
  capabilities: Partial<PlanCapabilities>;
};

const PLAN_PRESETS: Record<string, PlanPreset> = {
  inicial: {
    limits: {
      products: 75,
      monthlyOrders: 300,
      stores: 1,
      internalUsers: 1,
    },
    capabilities: {
      coupons: false,
      advancedReports: false,
      customBranding: false,
      customDomain: false,
      advancedDelivery: false,
      automations: false,
      paymentIntegrations: false,
      multiStore: false,
      internalUsers: false,
    },
  },
  basico: {
    limits: {
      products: 75,
      monthlyOrders: 300,
      stores: 1,
      internalUsers: 1,
    },
    capabilities: {
      coupons: false,
      advancedReports: false,
      customBranding: false,
      customDomain: false,
      advancedDelivery: false,
      automations: false,
      paymentIntegrations: false,
      multiStore: false,
      internalUsers: false,
    },
  },
  profissional: {
    limits: {
      products: 300,
      monthlyOrders: 2000,
      stores: 1,
      internalUsers: 5,
    },
    capabilities: {
      coupons: true,
      advancedReports: true,
      customBranding: true,
      customDomain: false,
      advancedDelivery: true,
      automations: true,
      paymentIntegrations: true,
      multiStore: false,
      internalUsers: true,
    },
  },
  white_label: {
    limits: {
      products: null,
      monthlyOrders: null,
      stores: 5,
      internalUsers: 25,
    },
    capabilities: {
      coupons: true,
      advancedReports: true,
      customBranding: true,
      customDomain: true,
      advancedDelivery: true,
      automations: true,
      paymentIntegrations: true,
      multiStore: true,
      internalUsers: true,
    },
  },
};

const DEFAULT_LIMITS: PlanLimits = {
  products: null,
  monthlyOrders: null,
  stores: 1,
  internalUsers: 1,
};

const PREMIUM_PLAN_SLUGS = ["premium_cortesia", "isento"];

const DEFAULT_CAPABILITIES: PlanCapabilities = {
  coupons: false,
  advancedReports: false,
  customBranding: false,
  customDomain: false,
  advancedDelivery: false,
  automations: false,
  paymentIntegrations: false,
  multiStore: false,
  internalUsers: false,
};

const FEATURE_LABELS: Record<SubscriptionFeature, string> = {
  coupons: "Cupons de desconto",
  advancedReports: "Relatorios avancados",
  customBranding: "Marca personalizada",
  customDomain: "Dominio proprio",
  advancedDelivery: "Configuracoes avancadas de entrega",
  automations: "Automacoes operacionais",
  paymentIntegrations: "Integracoes de pagamento",
  multiStore: "Multiunidades",
  internalUsers: "Usuarios internos adicionais",
};

const STATUS_LABELS: Record<SubscriptionRecord["status"], string> = {
  trial: "Periodo de teste",
  ativa: "Ativa",
  suspensa: "Suspensa",
  cancelada: "Cancelada",
  pendente_pagamento: "Pagamento pendente",
  inadimplente: "Pagamento em atraso",
  bloqueada: "Bloqueada",
};

const STATUS_TONES: Record<SubscriptionRecord["status"], "default" | "secondary" | "destructive"> = {
  trial: "secondary",
  ativa: "default",
  suspensa: "destructive",
  cancelada: "secondary",
  pendente_pagamento: "secondary",
  inadimplente: "destructive",
  bloqueada: "destructive",
};

export const normalizePlan = (plan: Partial<PlanRecord> | null | undefined): NormalizedPlan | null => {
  if (!plan?.id || !plan.slug || !plan.name) return null;

  const preset = PLAN_PRESETS[plan.slug] ?? { limits: {}, capabilities: {} };
  const features = Array.isArray(plan.features) ? plan.features.filter((item): item is string => typeof item === "string") : [];

  const limits: PlanLimits = {
    ...DEFAULT_LIMITS,
    ...preset.limits,
    products: plan.max_products ?? preset.limits.products ?? DEFAULT_LIMITS.products,
  };

  const capabilities: PlanCapabilities = {
    ...DEFAULT_CAPABILITIES,
    ...preset.capabilities,
    coupons: plan.allows_coupons ?? preset.capabilities.coupons ?? DEFAULT_CAPABILITIES.coupons,
    advancedReports: plan.allows_advanced_reports ?? preset.capabilities.advancedReports ?? DEFAULT_CAPABILITIES.advancedReports,
    customBranding: plan.allows_custom_branding ?? preset.capabilities.customBranding ?? DEFAULT_CAPABILITIES.customBranding,
    customDomain: plan.allows_custom_domain ?? preset.capabilities.customDomain ?? DEFAULT_CAPABILITIES.customDomain,
  };

  return {
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    description: plan.description ?? null,
    priceMonthly: Number(plan.price_monthly ?? 0),
    marketingFeatures: features,
    limits,
    capabilities,
  };
};

export const getPlanLimits = (plan: Partial<PlanRecord> | null | undefined) => normalizePlan(plan)?.limits ?? DEFAULT_LIMITS;

export const canUseFeature = (plan: Partial<PlanRecord> | null | undefined, feature: SubscriptionFeature) =>
  normalizePlan(plan)?.capabilities[feature] ?? false;

export const hasReachedLimit = (currentUsage: number, planLimit: number | null | undefined) =>
  planLimit !== null && planLimit !== undefined && currentUsage >= planLimit;

export const getUpgradeMessage = (feature: SubscriptionFeature) =>
  `${FEATURE_LABELS[feature]} faz parte de um plano superior. Atualize para desbloquear este recurso.`;

export const getFeatureLabel = (feature: SubscriptionFeature) => FEATURE_LABELS[feature];

export const getStatusMeta = (
  subscription: Pick<SubscriptionRecord, "status" | "trial_ends_at" | "current_period_end"> | null | undefined,
) => {
  if (!subscription) {
    return {
      label: "Sem assinatura",
      tone: "secondary" as const,
      detail: "Escolha um plano para habilitar os recursos pagos da plataforma.",
    };
  }

  if (subscription.status === "trial" && subscription.trial_ends_at) {
    return {
      label: STATUS_LABELS[subscription.status],
      tone: STATUS_TONES[subscription.status],
      detail: `Teste ate ${formatDate(subscription.trial_ends_at)}.`,
    };
  }

  if (subscription.status === "ativa" && subscription.current_period_end) {
    return {
      label: STATUS_LABELS[subscription.status],
      tone: STATUS_TONES[subscription.status],
      detail: `Renovacao prevista para ${formatDate(subscription.current_period_end)}.`,
    };
  }

  return {
    label: STATUS_LABELS[subscription.status],
    tone: STATUS_TONES[subscription.status],
    detail: subscription.status === "cancelada"
      ? "O plano nao sera renovado automaticamente."
      : subscription.status === "suspensa"
        ? "Regularize o pagamento para restabelecer o acesso completo."
        : "Assinatura em andamento.",
  };
};

export const getPlanUsageProgress = (usage: number, limit: number | null | undefined) => {
  if (limit === null || limit === undefined || limit <= 0) {
    return {
      value: 0,
      label: `${usage} usado(s)`,
      unlimited: true,
    };
  }

  const ratio = Math.min(100, Math.round((usage / limit) * 100));

  return {
    value: ratio,
    label: `${usage} de ${limit}`,
    unlimited: false,
  };
};

export const isPaidPlan = (plan: (Partial<PlanRecord> & { priceMonthly?: number }) | null | undefined) => {
  if (!plan) return false;
  const isPremiumCourtesy = plan.slug && PREMIUM_PLAN_SLUGS.includes(plan.slug);
  return Number(plan?.price_monthly ?? plan?.priceMonthly ?? 0) > 0 || isPremiumCourtesy;
};

export const getSubscriptionAccessState = ({
  subscription,
  plan,
  isPlatformAdmin = false,
  storeSuspended = false,
}: {
  subscription: Pick<SubscriptionRecord, "status" | "last_payment_status"> | null | undefined;
  plan: Partial<PlanRecord> | null | undefined;
  isPlatformAdmin?: boolean;
  storeSuspended?: boolean;
}): SubscriptionAccessState => {
  if (isPlatformAdmin) return "active";
  if (storeSuspended) return "blocked";
  if (!subscription || !plan || !isPaidPlan(plan)) return "no_plan";

  if (subscription.status === "ativa") return "active";
  
  // If subscription is canceled, check if we're still within the paid period
  if (subscription.status === "cancelada") {
    const periodEnd = (subscription as any).current_period_end;
    if (periodEnd && new Date(periodEnd) > new Date()) {
      return "active";
    }
    return "canceled";
  }

  if (subscription.status === "trial") return "active";
  if (subscription.status === "inadimplente") return "past_due";
  if (subscription.status === "bloqueada" || subscription.status === "suspensa") return "blocked";
  if (subscription.status === "pendente_pagamento") return "pending_payment";

  if (subscription.last_payment_status === "failed" || subscription.last_payment_status === "past_due") return "past_due";
  return "pending_payment";
};

export const getSubscriptionAccessMessage = (state: SubscriptionAccessState) => {
  switch (state) {
    case "no_plan":
      return "Escolha um plano para ativar sua loja.";
    case "pending_payment":
      return "Sua assinatura ainda nao esta ativa. Conclua o pagamento para acessar o painel.";
    case "past_due":
      return "Existe uma cobranca pendente. Regularize sua assinatura para reativar o acesso.";
    case "canceled":
      return "Sua assinatura foi cancelada. Escolha um novo plano para voltar a operar.";
    case "blocked":
      return "O acesso da loja esta bloqueado temporariamente. Revise a assinatura para continuar.";
    default:
      return "Assinatura ativa.";
  }
};

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
