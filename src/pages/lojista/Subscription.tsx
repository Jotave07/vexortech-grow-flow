import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Tables } from "@/integrations/backend/types";
import { backend } from "@/integrations/backend/client";
import { useSubscriptionStatus } from "@/hooks/use-subscription-status";
import { cancelSubscription, createSubscriptionCheckout, syncSubscriptionStatus } from "@/services/subscription-billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowUpRight, CheckCircle2, CreditCard, Loader2, LockKeyhole, RefreshCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  getFeatureLabel,
  getPlanLimits,
  getPlanUsageProgress,
  getStatusMeta,
  normalizePlan,
  type NormalizedPlan,
  type SubscriptionAccessState,
  type SubscriptionFeature,
} from "@/lib/subscription";
import { formatBRL, formatCEP, formatDoc, formatPhone } from "@/lib/format";

const formatDate = (value?: string | null) => {
  if (!value) return "Nao informado";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Nao informado";
  return date.toLocaleDateString("pt-BR");
};

type PlanRow = Tables<"plans">;

type CardCheckoutForm = {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
  holderInfoName: string;
  holderInfoEmail: string;
  holderInfoDocument: string;
  holderInfoPhone: string;
  postalCode: string;
  addressNumber: string;
  addressComplement: string;
};

type SubscriptionTimelineCard = {
  label: string;
  value: string;
  detail?: string;
};

const emptyCardForm: CardCheckoutForm = {
  holderName: "",
  number: "",
  expiryMonth: "",
  expiryYear: "",
  ccv: "",
  holderInfoName: "",
  holderInfoEmail: "",
  holderInfoDocument: "",
  holderInfoPhone: "",
  postalCode: "",
  addressNumber: "",
  addressComplement: "",
};

const onlyDigits = (value: string) => value.replace(/\D/g, "");

const COMPARABLE_FEATURES: SubscriptionFeature[] = [
  "coupons",
  "advancedReports",
  "customBranding",
  "customDomain",
  "advancedDelivery",
  "automations",
  "paymentIntegrations",
  "multiStore",
  "internalUsers",
];

const Subscription = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [submittingPlanId, setSubmittingPlanId] = useState<string | null>(null);
  const {
    loading,
    accessState,
    message,
    subscription,
    plan,
    store,
    isPlatformAdmin,
    user,
    refresh,
  } = useSubscriptionStatus();
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [canceling, setCanceling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [autoSyncedSubscriptionId, setAutoSyncedSubscriptionId] = useState<string | null>(null);
  const [showUpgradeOptions, setShowUpgradeOptions] = useState(false);
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [cardForm, setCardForm] = useState<CardCheckoutForm>(emptyCardForm);

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    const { data, error } = await (backend
      .from("plans" as any)
      .select("*")
      .eq("is_active", true)
      .gt("price_monthly", 0)
      .order("sort_order") as any);

    if (error) {
      toast.error("Nao foi possivel carregar os planos pagos.");
      setPlansLoading(false);
      return;
    }

    const nextPlans = (data ?? []) as PlanRow[];
    setPlans(nextPlans);
    setSelectedPlanId((current) => current || subscription?.plan_id || store?.plan_id || nextPlans[0]?.id || "");
    setPlansLoading(false);
  }, [store?.plan_id, subscription?.plan_id]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    if (!selectedPlanId && (subscription?.plan_id || store?.plan_id || plans[0]?.id)) {
      setSelectedPlanId(subscription?.plan_id || store?.plan_id || plans[0]?.id || "");
    }
  }, [plans, selectedPlanId, store?.plan_id, subscription?.plan_id]);

  useEffect(() => {
    setCardForm((current) => ({
      ...current,
      holderName: current.holderName || store?.name || "",
      holderInfoName: current.holderInfoName || store?.name || "",
      holderInfoEmail: current.holderInfoEmail || user?.email || "",
      holderInfoDocument: current.holderInfoDocument || formatDoc(store?.document),
      holderInfoPhone: current.holderInfoPhone || formatPhone(store?.whatsapp || store?.whatsapp_number),
      postalCode: current.postalCode || formatCEP(store?.zip_code),
      addressNumber: current.addressNumber || store?.address_number || "",
      addressComplement: current.addressComplement || store?.address_complement || "",
    }));
  }, [
    store?.address_complement,
    store?.address_number,
    store?.document,
    store?.name,
    store?.whatsapp,
    store?.whatsapp_number,
    store?.zip_code,
    user?.email,
  ]);

  const currentPlan = useMemo(() => normalizePlan(plan ?? null), [plan]);
  const selectedPlan = useMemo(
    () => normalizePlan(plans.find((item) => item.id === selectedPlanId) ?? null),
    [plans, selectedPlanId],
  );
  const subscriptionStatusValue = String((subscription as any)?.status || "");
  const hasCurrentSubscription = Boolean(subscription && subscriptionStatusValue !== "cancelada" && subscriptionStatusValue !== "encerrada");
  const hasActiveSubscription = subscriptionStatusValue === "ativa" || subscriptionStatusValue === "trial";
  const canSelectInitialPlan = !hasCurrentSubscription || accessState === "no_plan" || accessState === "canceled";
  const currentPlanPrice = currentPlan?.priceMonthly ?? 0;
  const upgradePlans = useMemo(
    () => plans.filter((item) => item.id !== currentPlan?.id && Number(item.price_monthly ?? 0) > currentPlanPrice),
    [currentPlan?.id, currentPlanPrice, plans],
  );
  const visiblePlans = showUpgradeOptions ? upgradePlans : plans;
  const showPlanCatalog = canSelectInitialPlan || showUpgradeOptions;
  const activePlan = currentPlan ?? selectedPlan;
  const checkoutPlan = selectedPlan ?? (canSelectInitialPlan ? activePlan : null);
  const summaryPlan = showUpgradeOptions ? checkoutPlan : activePlan;
  const subscriptionMeta = getStatusMeta(subscription);
  const limits = getPlanLimits(activePlan);
  const accessParam = (searchParams.get("state") as SubscriptionAccessState | null) ?? accessState;
  const redirectPath = searchParams.get("redirect") || "/lojista";
  const timelineCards = useMemo(
    () => getSubscriptionTimelineCards(subscription, currentPlan?.name),
    [currentPlan?.name, subscription],
  );

  const usageCards = useMemo(
    () => [
      { label: "Produtos", current: 0, limit: limits.products },
      { label: "Pedidos por mes", current: 0, limit: limits.monthlyOrders },
      { label: "Usuarios internos", current: 1, limit: limits.internalUsers },
      { label: "Lojas/unidades", current: 1, limit: limits.stores },
    ],
    [limits.internalUsers, limits.monthlyOrders, limits.products, limits.stores],
  );

  useEffect(() => {
    if (!hasActiveSubscription && showUpgradeOptions) {
      setShowUpgradeOptions(false);
    }
  }, [hasActiveSubscription, showUpgradeOptions]);

  useEffect(() => {
    if (!showUpgradeOptions) return;
    if (upgradePlans.length === 0) {
      setSelectedPlanId("");
      return;
    }
    if (!upgradePlans.some((item) => item.id === selectedPlanId)) {
      setSelectedPlanId(upgradePlans[0].id);
    }
  }, [selectedPlanId, showUpgradeOptions, upgradePlans]);

  const syncCurrentSubscription = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!store?.id) return null;
    setSyncing(true);
    try {
      const result = await syncSubscriptionStatus(store.id);
      await refresh();
      if (!options.silent) {
        toast.success(result.status === "ativa" ? "Pagamento confirmado. Assinatura ativa." : "Status da assinatura atualizado.");
      }
      return result;
    } catch (error) {
      if (!options.silent) {
        toast.error(error instanceof Error ? error.message : "Nao foi possivel atualizar o status da assinatura.");
      }
      return null;
    } finally {
      setSyncing(false);
    }
  }, [refresh, store?.id]);

  const gatewaySubscriptionId = (subscription as any)?.asaas_subscription_id || null;
  useEffect(() => {
    if (!store?.id || !gatewaySubscriptionId || (subscription as any)?.status !== "pendente_pagamento") return;
    if (autoSyncedSubscriptionId === gatewaySubscriptionId) return;
    setAutoSyncedSubscriptionId(gatewaySubscriptionId);
    void syncCurrentSubscription({ silent: true });
  }, [autoSyncedSubscriptionId, gatewaySubscriptionId, store?.id, subscription, syncCurrentSubscription]);

  const startCheckout = async () => {
    if (!store?.id) {
      toast.error("Nao foi possivel localizar a loja desta conta.");
      return;
    }

    if (!selectedPlanId || !checkoutPlan) {
      toast.error("Escolha um plano para ativar sua loja.");
      return;
    }

    if (hasActiveSubscription) {
      if (!showUpgradeOptions) {
        toast.info("Sua assinatura esta ativa. Abra as opcoes de upgrade para trocar de plano.");
        return;
      }
      if (checkoutPlan.id === currentPlan?.id || checkoutPlan.priceMonthly <= currentPlanPrice) {
        toast.error("Escolha um plano superior para continuar com o upgrade.");
        return;
      }
      if (!confirm(`Confirmar upgrade para ${checkoutPlan.name}? A troca cria uma nova recorrencia no gateway e cancela a recorrencia anterior apos a validacao.`)) {
        return;
      }
    }

    setCardDialogOpen(true);
    return;
    /*

    setSubmittingPlanId(selectedPlanId);

    try {
      const { data: profileData } = await (backend.from("profiles" as any).select("*").eq("user_id", store.owner_user_id).single() as any);
      
      if (!store.document) {
        toast.error("Por favor, preencha o CPF/CNPJ da sua loja nas configurações antes de assinar.");
        setSubmittingPlanId(null);
        return;
      }

      const existingSubscriptionId = (subscription as any)?.asaas_subscription_id;
      const checkout = existingSubscriptionId
        ? await updateSubscriptionPlan({
            planId: selectedPlanId,
            storeId: store.id,
            billingType: "CREDIT_CARD",
          })
        : await createSubscriptionCheckout({
            planId: selectedPlanId,
            storeId: store.id,
            billingType: "CREDIT_CARD",
            customerData: {
              name: profileData?.full_name || "Lojista",
              email: user?.email || "",
              cpfCnpj: store.document.replace(/\D/g, ""),
              mobilePhone: store.whatsapp || "",
            }
          });

      await refresh();
      if (checkout.checkoutUrl) window.location.href = checkout.checkoutUrl;
      else {
        setSubmittingPlanId(null);
        toast.success("Assinatura atualizada.");
      }
    } catch (error) {
      setSubmittingPlanId(null);
      toast.error(
        error instanceof Error
          ? error.message
          : "Nao foi possivel iniciar o checkout da assinatura.",
      );
    }
    */
  };

  const updateCardForm = (field: keyof CardCheckoutForm, value: string) => {
    setCardForm((current) => ({ ...current, [field]: value }));
  };

  const submitCardCheckout = async () => {
    if (!store?.id || !selectedPlanId || !checkoutPlan) return;
    if (hasActiveSubscription && (!showUpgradeOptions || checkoutPlan.priceMonthly <= currentPlanPrice)) {
      toast.error("Escolha um plano superior antes de validar o upgrade.");
      return;
    }

    const cardNumber = onlyDigits(cardForm.number);
    const expiryMonth = onlyDigits(cardForm.expiryMonth).padStart(2, "0");
    const expiryYearDigits = onlyDigits(cardForm.expiryYear);
    const expiryYear = expiryYearDigits.length === 2 ? `20${expiryYearDigits}` : expiryYearDigits;
    const holderDocument = onlyDigits(cardForm.holderInfoDocument || store.document || "");
    const postalCode = onlyDigits(cardForm.postalCode || store.zip_code || "");
    const phone = onlyDigits(cardForm.holderInfoPhone || store.whatsapp || "");
    const holderName = cardForm.holderName.trim();
    const holderInfoName = cardForm.holderInfoName.trim() || holderName;
    const holderInfoEmail = cardForm.holderInfoEmail.trim() || user?.email || "";

    if (!holderName || cardNumber.length < 13 || !expiryMonth || expiryYear.length !== 4 || onlyDigits(cardForm.ccv).length < 3) {
      toast.error("Revise os dados do cartao.");
      return;
    }
    if (!holderInfoName || !holderInfoEmail || holderDocument.length < 11 || postalCode.length !== 8 || !cardForm.addressNumber.trim()) {
      toast.error("Revise os dados do titular do cartao.");
      return;
    }

    setSubmittingPlanId(selectedPlanId);

    try {
      const { data: profileData } = await (backend.from("profiles" as any).select("*").eq("user_id", store.owner_user_id).single() as any);

      const checkout = await createSubscriptionCheckout({
        planId: selectedPlanId,
        storeId: store.id,
        billingType: "CREDIT_CARD",
        cardData: {
          creditCard: {
            holderName,
            number: cardNumber,
            expiryMonth,
            expiryYear,
            ccv: onlyDigits(cardForm.ccv),
          },
          creditCardHolderInfo: {
            name: holderInfoName,
            email: holderInfoEmail,
            cpfCnpj: holderDocument,
            postalCode,
            addressNumber: cardForm.addressNumber.trim(),
            addressComplement: cardForm.addressComplement.trim() || null,
            mobilePhone: phone || undefined,
          },
        },
        customerData: {
          name: profileData?.full_name || holderInfoName || "Lojista",
          email: user?.email || holderInfoEmail,
          cpfCnpj: onlyDigits(store.document || holderDocument),
          mobilePhone: store.whatsapp || phone,
        },
      });

      await syncCurrentSubscription({ silent: true });
      await refresh();
      setCardDialogOpen(false);
      toast.success(
        checkout.mode === "active"
          ? "Assinatura ja esta ativa."
          : showUpgradeOptions
            ? "Cartao validado. Upgrade enviado para confirmacao."
            : "Cartao validado. Assinatura enviada para confirmacao.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel validar a assinatura.");
    } finally {
      setSubmittingPlanId(null);
    }
  };

  const cancelCurrentSubscription = async () => {
    if (!store?.id || !subscription) return;
    if (!confirm("Cancelar a recorrencia da assinatura? Sua loja continua ativa ate o fim do periodo ja pago.")) return;
    setCanceling(true);
    try {
      const result = await cancelSubscription(store.id);
      await refresh();
      toast.success(`Assinatura cancelada. A loja fica ativa ate ${formatDate(result.cancellationEffectiveAt)}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel cancelar a assinatura.");
    } finally {
      setCanceling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const canReturnToApp = isPlatformAdmin || accessState === "active";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/45 px-3 py-1 text-xs font-medium text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Assinatura da plataforma
          </div>
          <div>
            <h1 className="text-2xl font-bold md:text-3xl">Assinatura e acesso da loja</h1>
            <p className="text-sm text-muted-foreground">
              A assinatura da plataforma e cobrada de forma recorrente no cartao de credito do lojista. Os pagamentos dos pedidos da loja continuam separados.
            </p>
          </div>
        </div>

        {canReturnToApp && (
          <Button variant="outline" onClick={() => navigate(redirectPath, { replace: true })}>
            Voltar ao painel
          </Button>
        )}
      </div>

      <Card className="border-primary/15 bg-gradient-to-br from-card to-secondary/35">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-xl">Status da assinatura</CardTitle>
              <CardDescription>{message}</CardDescription>
            </div>
            <Badge variant={subscriptionMeta.tone}>{subscriptionMeta.label}</Badge>
          </div>

          <div className="rounded-lg border border-border bg-background/75 p-4 text-sm text-muted-foreground">
            {getStateSummary(accessParam)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {timelineCards.map((item) => (
              <div key={item.label} className="rounded-lg border border-border bg-background/75 p-3">
                <div className="text-xs text-muted-foreground">{item.label}</div>
                <div className="mt-1 font-semibold">{item.value}</div>
                {item.detail && <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>}
              </div>
            ))}
          </div>
          {(subscription as any)?.status === "cancelada" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
              Sua assinatura foi cancelada, mas sua loja permanecera ativa ate {formatDate((subscription as any)?.cancellation_effective_at || (subscription as any)?.current_period_end)}.
            </div>
          )}
        </CardHeader>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              {showPlanCatalog ? (showUpgradeOptions ? "Planos para upgrade" : "Escolha um plano pago") : "Assinatura protegida"}
            </CardTitle>
            <CardDescription>
              {showPlanCatalog
                ? "Apenas o plano escolhido nesta etapa abre validacao de cartao. O plano atual permanece intacto ate a confirmacao."
                : "Sua assinatura atual fica visivel para consulta. Dados de cartao e troca de plano aparecem somente em upgrade."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!showPlanCatalog ? (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-background p-2">
                    <LockKeyhole className="h-4 w-4 text-primary" />
                  </div>
                  <div className="space-y-2">
                    <div className="font-semibold">Nenhuma acao de cartao pendente</div>
                    <p className="text-sm text-muted-foreground">
                      O plano ativo nao pode ser sobrescrito por engano nesta tela. Para trocar de plano, abra o comparativo de upgrade e confirme um plano superior.
                    </p>
                  </div>
                </div>
              </div>
            ) : plansLoading ? (
              <div className="rounded-lg border border-border bg-secondary/25 p-4 text-sm text-muted-foreground">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Carregando planos...
              </div>
            ) : visiblePlans.length === 0 ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                {showUpgradeOptions
                  ? "Nenhum plano superior esta disponivel no momento."
                  : "Nenhum plano pago esta disponivel no momento. Revise a tabela de planos antes de liberar novos cadastros."}
              </div>
            ) : (
              <RadioGroup value={selectedPlanId} onValueChange={setSelectedPlanId} className="space-y-3">
                {visiblePlans.map((item) => {
                  const normalized = normalizePlan(item);
                  const isCurrent = subscription?.plan_id === item.id;
                  const upgradeHighlights = normalized ? getUpgradeHighlights(currentPlan, normalized) : [];

                  return (
                    <label
                      key={item.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-smooth ${
                        selectedPlanId === item.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/35"
                      }`}
                    >
                      <RadioGroupItem value={item.id} className="mt-0.5" />
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{item.name}</span>
                              {isCurrent && <Badge variant="secondary">Plano atual</Badge>}
                            </div>
                            {item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-semibold text-primary">{formatBRL(item.price_monthly)}</div>
                            <div className="text-xs text-muted-foreground">cobranca mensal</div>
                          </div>
                        </div>

                        {normalized && (
                          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                            <div>Produtos: {normalized.limits.products ?? "Ilimitado"}</div>
                            <div>Pedidos por mes: {normalized.limits.monthlyOrders ?? "Ilimitado"}</div>
                            <div>Usuarios internos: {normalized.limits.internalUsers ?? "Ilimitado"}</div>
                            <div>Lojas/unidades: {normalized.limits.stores ?? "Ilimitado"}</div>
                          </div>
                        )}
                        {showUpgradeOptions && upgradeHighlights.length > 0 && (
                          <div className="rounded-lg border border-primary/15 bg-primary/5 p-3">
                            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
                              <ArrowUpRight className="h-3.5 w-3.5" />
                              Evolucao sobre o plano atual
                            </div>
                            <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                              {upgradeHighlights.slice(0, 6).map((highlight) => (
                                <div key={highlight} className="flex items-start gap-2">
                                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                                  <span>{highlight}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </RadioGroup>
            )}

            <div className="flex flex-wrap gap-3">
              <div className="w-full rounded-lg border border-border bg-secondary/25 p-4 text-sm text-muted-foreground">
                O pagamento da mensalidade abre aqui no painel, com validacao segura pelo Asaas. A cobranca entra na conta administradora da plataforma, sem expor token do administrador ao lojista.
              </div>
              {hasActiveSubscription && !showUpgradeOptions && upgradePlans.length > 0 && (
                <Button variant="hero" onClick={() => setShowUpgradeOptions(true)}>
                  <ArrowUpRight className="h-4 w-4" />
                  Comparar upgrades
                </Button>
              )}
              {showUpgradeOptions && (
                <Button variant="outline" onClick={() => setShowUpgradeOptions(false)} disabled={submittingPlanId !== null}>
                  Ocultar upgrades
                </Button>
              )}
              {showPlanCatalog && visiblePlans.length > 0 && (
                <Button
                  variant="hero"
                  onClick={() => void startCheckout()}
                  disabled={plansLoading || !selectedPlanId || submittingPlanId !== null}
                >
                  {submittingPlanId ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  {showUpgradeOptions ? "Confirmar upgrade com cartao" : subscription ? "Informar cartao da assinatura" : "Informar cartao e assinar"}
                </Button>
              )}
              {subscription && (subscription as any).status !== "cancelada" && (
                <Button variant="outline" onClick={() => void cancelCurrentSubscription()} disabled={canceling || submittingPlanId !== null}>
                  {canceling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Cancelar assinatura
                </Button>
              )}
              <Button variant="outline" onClick={() => void syncCurrentSubscription()} disabled={submittingPlanId !== null || syncing}>
                <RefreshCcw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                Atualizar status
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-secondary/25 p-4 text-sm text-muted-foreground">
              Os dados do cartao sao enviados apenas para validacao no gateway e nao sao armazenados pela plataforma. A ativacao da assinatura acontece pelo retorno do Asaas e pelo webhook configurado no painel administrativo.
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Resumo do plano</CardTitle>
              <CardDescription>Visao rapida do contrato atual e dos limites conhecidos.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-background/70 p-4">
                <div className="text-sm text-muted-foreground">{showUpgradeOptions ? "Plano em analise" : "Plano atual"}</div>
                <div className="mt-1 text-xl font-semibold">{summaryPlan?.name ?? "Nenhum plano escolhido"}</div>
                <div className="mt-1 text-sm text-muted-foreground">{subscriptionMeta.detail}</div>
              </div>

              <div className="rounded-lg border border-border bg-background/70 p-4">
                <div className="text-sm text-muted-foreground">Mensalidade</div>
                <div className="mt-1 text-2xl font-bold">{formatBRL(summaryPlan?.priceMonthly ?? 0)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Renovacao e liberacao dependem do status enviado pelo gateway e confirmado via webhook.
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Consumo e limites</CardTitle>
              <CardDescription>Base pronta para bloquear recursos pelo plano sem espalhar regra entre componentes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {usageCards.map((item) => {
                const progress = getPlanUsageProgress(item.current, item.limit);

                return (
                  <div key={item.label} className="space-y-2">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium">{item.label}</span>
                      <span className="text-muted-foreground">{progress.label}</span>
                    </div>
                    <Progress value={progress.unlimited ? 12 : progress.value} className="h-2.5" />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={cardDialogOpen}
        onOpenChange={(open) => {
          if (submittingPlanId === null) setCardDialogOpen(open);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{showUpgradeOptions ? "Confirmar upgrade com cartao" : "Assinar com cartao de credito"}</DialogTitle>
            <DialogDescription>
              {checkoutPlan ? `${checkoutPlan.name} - ${formatBRL(checkoutPlan.priceMonthly)} por mes` : "Informe os dados para validar a assinatura."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CreditCard className="h-4 w-4 text-primary" />
                Dados do cartao
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="card-holder-name">Nome impresso no cartao</Label>
                  <Input
                    id="card-holder-name"
                    autoComplete="cc-name"
                    value={cardForm.holderName}
                    onChange={(event) => updateCardForm("holderName", event.target.value)}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="card-number">Numero do cartao</Label>
                  <Input
                    id="card-number"
                    inputMode="numeric"
                    autoComplete="cc-number"
                    maxLength={19}
                    value={cardForm.number}
                    onChange={(event) => updateCardForm("number", onlyDigits(event.target.value))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="card-expiry-month">Mes</Label>
                    <Input
                      id="card-expiry-month"
                      inputMode="numeric"
                      autoComplete="cc-exp-month"
                      maxLength={2}
                      value={cardForm.expiryMonth}
                      onChange={(event) => updateCardForm("expiryMonth", onlyDigits(event.target.value).slice(0, 2))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="card-expiry-year">Ano</Label>
                    <Input
                      id="card-expiry-year"
                      inputMode="numeric"
                      autoComplete="cc-exp-year"
                      maxLength={4}
                      value={cardForm.expiryYear}
                      onChange={(event) => updateCardForm("expiryYear", onlyDigits(event.target.value).slice(0, 4))}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="card-cvv">CVV</Label>
                  <Input
                    id="card-cvv"
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    maxLength={4}
                    value={cardForm.ccv}
                    onChange={(event) => updateCardForm("ccv", onlyDigits(event.target.value).slice(0, 4))}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Titular e endereco
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="holder-info-name">Nome do titular</Label>
                  <Input
                    id="holder-info-name"
                    value={cardForm.holderInfoName}
                    onChange={(event) => updateCardForm("holderInfoName", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="holder-info-email">E-mail</Label>
                  <Input
                    id="holder-info-email"
                    type="email"
                    autoComplete="email"
                    value={cardForm.holderInfoEmail}
                    onChange={(event) => updateCardForm("holderInfoEmail", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="holder-info-document">CPF/CNPJ</Label>
                  <Input
                    id="holder-info-document"
                    inputMode="numeric"
                    value={cardForm.holderInfoDocument}
                    onChange={(event) => updateCardForm("holderInfoDocument", formatDoc(event.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="holder-info-phone">Celular</Label>
                  <Input
                    id="holder-info-phone"
                    inputMode="tel"
                    autoComplete="tel"
                    value={cardForm.holderInfoPhone}
                    onChange={(event) => updateCardForm("holderInfoPhone", formatPhone(event.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="holder-postal-code">CEP</Label>
                  <Input
                    id="holder-postal-code"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    value={cardForm.postalCode}
                    onChange={(event) => updateCardForm("postalCode", formatCEP(event.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="holder-address-number">Numero</Label>
                  <Input
                    id="holder-address-number"
                    autoComplete="address-line2"
                    value={cardForm.addressNumber}
                    onChange={(event) => updateCardForm("addressNumber", event.target.value)}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="holder-address-complement">Complemento</Label>
                  <Input
                    id="holder-address-complement"
                    autoComplete="address-line3"
                    value={cardForm.addressComplement}
                    onChange={(event) => updateCardForm("addressComplement", event.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setCardDialogOpen(false)} disabled={submittingPlanId !== null}>
              Cancelar
            </Button>
            <Button type="button" variant="hero" onClick={() => void submitCardCheckout()} disabled={submittingPlanId !== null}>
              {submittingPlanId ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              Validar assinatura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const formatLimitValue = (value: number | null | undefined) =>
  value === null || value === undefined ? "Ilimitado" : String(value);

const getSubscriptionTimelineCards = (subscription: any, planName?: string | null): SubscriptionTimelineCard[] => {
  const status = String(subscription?.status || "");
  const isActive = status === "ativa" || status === "trial";
  const isCanceled = status === "cancelada";
  const isPaymentAttention = status === "pendente_pagamento" || status === "inadimplente";
  const billingType = subscription?.billing_type || "CREDIT_CARD";
  const periodStart = subscription?.current_period_start || subscription?.next_due_date;
  const periodEnd = subscription?.current_period_end || subscription?.cancellation_effective_at;
  const cycleLabel = periodStart || periodEnd
    ? `${formatDate(periodStart)} ate ${formatDate(periodEnd)}`
    : "Nao informado";

  if (isActive) {
    return [
      { label: "Plano atual", value: planName || "Nao informado" },
      { label: "Proxima renovacao", value: formatDate(periodEnd || subscription?.next_due_date) },
      { label: "Ciclo vigente", value: cycleLabel },
      { label: "Cobranca", value: billingType },
    ];
  }

  if (isPaymentAttention) {
    return [
      { label: "Plano atual", value: planName || "Nao informado" },
      { label: "Vencimento da cobranca", value: formatDate(subscription?.next_due_date) },
      { label: "Status do pagamento", value: formatPaymentStatus(subscription?.last_payment_status) },
      { label: "Cobranca", value: billingType },
    ];
  }

  if (isCanceled) {
    return [
      { label: "Plano atual", value: planName || "Nao informado" },
      { label: "Acesso ate", value: formatDate(subscription?.cancellation_effective_at || subscription?.current_period_end) },
      { label: "Recorrencia", value: "Cancelada" },
      { label: "Cobranca", value: billingType },
    ];
  }

  return [
    { label: "Plano atual", value: planName || "Nao informado" },
    { label: "Vencimento da cobranca", value: formatDate(subscription?.next_due_date) },
    { label: "Periodo atual", value: cycleLabel },
    { label: "Cobranca", value: billingType },
  ];
};

const formatPaymentStatus = (value?: string | null) => {
  if (!value) return "Aguardando retorno";
  const normalized = String(value).toUpperCase();
  if (["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH", "PAID"].includes(normalized)) return "Confirmado";
  if (["OVERDUE", "FAILED", "PAST_DUE"].includes(normalized)) return "Em atraso";
  if (["PENDING"].includes(normalized)) return "Pendente";
  return value;
};

const hasLimitUpgrade = (current: number | null | undefined, next: number | null | undefined) => {
  if (next === null || next === undefined) return current !== null && current !== undefined;
  if (current === null || current === undefined) return false;
  return next > current;
};

const getUpgradeHighlights = (currentPlan: NormalizedPlan | null, nextPlan: NormalizedPlan) => {
  const currentLimits = currentPlan?.limits;
  const highlights: string[] = [];

  if ((currentPlan?.priceMonthly ?? 0) !== nextPlan.priceMonthly) {
    highlights.push(`Mensalidade: ${formatBRL(currentPlan?.priceMonthly ?? 0)} para ${formatBRL(nextPlan.priceMonthly)}`);
  }

  const limitPairs: Array<[string, keyof NormalizedPlan["limits"]]> = [
    ["Produtos", "products"],
    ["Pedidos por mes", "monthlyOrders"],
    ["Usuarios internos", "internalUsers"],
    ["Lojas/unidades", "stores"],
  ];

  for (const [label, key] of limitPairs) {
    const current = currentLimits?.[key];
    const next = nextPlan.limits[key];
    if (hasLimitUpgrade(current, next)) {
      highlights.push(`${label}: ${formatLimitValue(current)} para ${formatLimitValue(next)}`);
    }
  }

  for (const feature of COMPARABLE_FEATURES) {
    if (!currentPlan?.capabilities[feature] && nextPlan.capabilities[feature]) {
      highlights.push(`Desbloqueia ${getFeatureLabel(feature).toLowerCase()}`);
    }
  }

  return highlights;
};

const getStateSummary = (state: SubscriptionAccessState) => {
  switch (state) {
    case "no_plan":
      return "Escolha um plano para ativar sua loja. Enquanto isso, o painel principal permanece bloqueado.";
    case "pending_payment":
      return "Sua assinatura ainda nao esta ativa. Conclua o pagamento para acessar o painel.";
    case "past_due":
      return "Existe uma cobranca pendente. Regularize o pagamento recorrente para restaurar os recursos.";
    case "canceled":
      return "A recorrencia foi cancelada. Escolha um novo plano para retomar a operacao da loja.";
    case "blocked":
      return "O acesso foi bloqueado temporariamente. Revise a assinatura e o status da loja para continuar.";
    default:
      return "A assinatura esta ativa e o painel pode ser usado normalmente, respeitando os limites do plano.";
  }
};

export default Subscription;
