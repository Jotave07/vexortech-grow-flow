import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { useSubscriptionStatus } from "@/hooks/use-subscription-status";
import { createSubscriptionCheckout } from "@/services/subscription-billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Lock, RefreshCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  getPlanLimits,
  getPlanUsageProgress,
  getStatusMeta,
  normalizePlan,
  type SubscriptionAccessState,
} from "@/lib/subscription";
import { formatBRL } from "@/lib/format";

type PlanRow = Tables<"plans">;

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

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    const { data, error } = await supabase
      .from("plans")
      .select("*")
      .eq("is_active", true)
      .gt("price_monthly", 0)
      .order("sort_order");

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

  const activePlan = useMemo(
    () => normalizePlan(plan ?? plans.find((item) => item.id === selectedPlanId) ?? null),
    [plan, plans, selectedPlanId],
  );
  const subscriptionMeta = getStatusMeta(subscription);
  const limits = getPlanLimits(activePlan);
  const accessParam = (searchParams.get("state") as SubscriptionAccessState | null) ?? accessState;
  const redirectPath = searchParams.get("redirect") || "/app";

  const usageCards = useMemo(
    () => [
      { label: "Produtos", current: 0, limit: limits.products },
      { label: "Pedidos por mes", current: 0, limit: limits.monthlyOrders },
      { label: "Usuarios internos", current: 1, limit: limits.internalUsers },
      { label: "Lojas/unidades", current: 1, limit: limits.stores },
    ],
    [limits.internalUsers, limits.monthlyOrders, limits.products, limits.stores],
  );

  const startCheckout = async () => {
    if (!store?.id) {
      toast.error("Nao foi possivel localizar a loja desta conta.");
      return;
    }

    if (!selectedPlanId) {
      toast.error("Escolha um plano para ativar sua loja.");
      return;
    }

    setSubmittingPlanId(selectedPlanId);

    const updatePayload = {
      plan_id: selectedPlanId,
      provider: "asaas",
      status: "pendente_pagamento" as const,
      last_payment_status: "pending",
    };

    const storeUpdate = await supabase
      .from("stores")
      .update({ plan_id: selectedPlanId })
      .eq("id", store.id);

    if (storeUpdate.error) {
      setSubmittingPlanId(null);
      toast.error(storeUpdate.error.message);
      return;
    }

    const subscriptionMutation = subscription
      ? supabase.from("subscriptions").update(updatePayload).eq("id", subscription.id)
      : supabase.from("subscriptions").insert({
        ...updatePayload,
        store_id: store.id,
      });

    const { error: subscriptionError } = await subscriptionMutation;

    if (subscriptionError) {
      setSubmittingPlanId(null);
      toast.error(subscriptionError.message);
      return;
    }

    try {
      const { data: profileData } = await supabase.from("profiles").select("*").eq("user_id", store.owner_user_id).single();
      
      const checkout = await createSubscriptionCheckout({
        planId: selectedPlanId,
        storeId: store.id,
        customerData: {
          name: profileData?.full_name || "Lojista",
          email: user?.email || "",
          cpfCnpj: "", // Lojista preencherá no Asaas se necessário
          mobilePhone: store.whatsapp || "",
        }
      });

      await refresh();
      window.location.href = checkout.checkoutUrl;
    } catch (error) {
      setSubmittingPlanId(null);
      toast.error(
        error instanceof Error
          ? error.message
          : "Nao foi possivel iniciar o checkout da assinatura.",
      );
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
        </CardHeader>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Escolha um plano pago</CardTitle>
            <CardDescription>
              Nao existe fluxo comercial gratuito. O acesso completo so e liberado apos a confirmacao do pagamento recorrente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {plansLoading ? (
              <div className="rounded-lg border border-border bg-secondary/25 p-4 text-sm text-muted-foreground">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Carregando planos...
              </div>
            ) : plans.length === 0 ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                Nenhum plano pago esta disponivel no momento. Revise a tabela de planos antes de liberar novos cadastros.
              </div>
            ) : (
              <RadioGroup value={selectedPlanId} onValueChange={setSelectedPlanId} className="space-y-3">
                {plans.map((item) => {
                  const normalized = normalizePlan(item);
                  const isCurrent = subscription?.plan_id === item.id;

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
                      </div>
                    </label>
                  );
                })}
              </RadioGroup>
            )}

            <div className="flex flex-wrap gap-3">
              <Button
                variant="hero"
                onClick={() => void startCheckout()}
                disabled={plansLoading || !selectedPlanId || submittingPlanId !== null}
              >
                {submittingPlanId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                {subscription ? "Regularizar assinatura" : "Prosseguir para pagamento"}
              </Button>
              <Button variant="outline" onClick={() => void refresh()} disabled={submittingPlanId !== null}>
                <RefreshCcw className="h-4 w-4" />
                Atualizar status
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-secondary/25 p-4 text-sm text-muted-foreground">
              O checkout de assinatura deve ser criado por uma Edge Function segura. O front-end nunca armazena dados do cartao e nao marca pagamento como aprovado por conta propria.
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
                <div className="text-sm text-muted-foreground">Plano selecionado</div>
                <div className="mt-1 text-xl font-semibold">{activePlan?.name ?? "Nenhum plano escolhido"}</div>
                <div className="mt-1 text-sm text-muted-foreground">{subscriptionMeta.detail}</div>
              </div>

              <div className="rounded-lg border border-border bg-background/70 p-4">
                <div className="text-sm text-muted-foreground">Mensalidade</div>
                <div className="mt-1 text-2xl font-bold">{formatBRL(activePlan?.priceMonthly ?? 0)}</div>
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
    </div>
  );
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
