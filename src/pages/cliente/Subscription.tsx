import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { backend } from "@/integrations/backend/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscriptionStatus } from "@/hooks/use-subscription-status";
import {
  cancelSubscription,
  syncSubscriptionStatus,
} from "@/services/subscription-billing";
import type { Tables } from "@/integrations/backend/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowUpRight,
  CheckCircle2,
  CreditCard,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  getStatusMeta,
  normalizePlan,
} from "@/lib/subscription";
import { formatBRL, formatDate } from "@/lib/format";
import { toast } from "sonner";

type PlanRow = Tables<"plans">;

const CustomerSubscription = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const {
    loading: statusLoading,
    accessState,
    message,
    subscription,
    plan,
    store,
    refresh,
  } = useSubscriptionStatus();

  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/entrar", { replace: true });
    }
  }, [authLoading, user, navigate]);

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    const { data, error } = await (backend
      .from("plans" as any)
      .select("*")
      .eq("is_active", true)
      .order("sort_order") as any);

    if (error) {
      toast.error("Nao foi possivel carregar os planos disponiveis.");
      setPlansLoading(false);
      return;
    }

    setPlans((data ?? []) as PlanRow[]);
    setPlansLoading(false);
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const currentPlan = useMemo(() => normalizePlan(plan ?? null), [plan]);
  const subscriptionMeta = getStatusMeta(subscription);
  const subscriptionStatusValue = String((subscription as any)?.status || "");
  const hasSubscription = Boolean(
    subscription &&
      subscriptionStatusValue !== "cancelada" &&
      subscriptionStatusValue !== "encerrada",
  );
  const nextCharge = formatDate(
    (subscription as any)?.current_period_end || (subscription as any)?.next_due_date,
  );

  const comparablePlans = useMemo(
    () => plans.filter((item) => item.id !== currentPlan?.id).slice(0, 3),
    [plans, currentPlan?.id],
  );

  const handleSync = useCallback(async () => {
    if (!store?.id) {
      toast.info("Nao ha assinatura ativa para atualizar.");
      return;
    }
    setSyncing(true);
    try {
      const result = await syncSubscriptionStatus(store.id);
      await refresh();
      toast.success(
        result.status === "ativa"
          ? "Pagamento confirmado. Assinatura ativa."
          : "Status da assinatura atualizado.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Nao foi possivel atualizar o status da assinatura.",
      );
    } finally {
      setSyncing(false);
    }
  }, [store?.id, refresh]);

  const handleCancel = useCallback(async () => {
    if (!store?.id || !subscription) return;
    setCanceling(true);
    try {
      const result = await cancelSubscription(store.id);
      await refresh();
      toast.success(
        `Assinatura cancelada. Acesso garantido ate ${formatDate(
          result?.cancellationEffectiveAt,
        )}.`,
      );
      setCancelDialogOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Nao foi possivel cancelar a assinatura.",
      );
    } finally {
      setCanceling(false);
    }
  }, [store?.id, subscription, refresh]);

  if (authLoading || statusLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Cabecalho */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-none border border-border bg-muted px-3 py-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Minha assinatura
          </div>
          <h1 className="text-3xl font-black uppercase tracking-tighter italic">
            Plano e assinatura
          </h1>
          <p className="max-w-xl text-sm font-medium text-muted-foreground">
            Acompanhe o status da sua assinatura, compare planos e gerencie sua
            cobranca recorrente.
          </p>
        </div>
        <Button
          variant="outline"
          className="rounded-none border-border font-black uppercase tracking-widest text-[10px] h-11"
          onClick={() => void handleSync()}
          disabled={syncing}
        >
          <RefreshCcw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
          Atualizar status
        </Button>
      </div>

      {/* Card: Plano Atual */}
      <Card className="overflow-hidden border border-border bg-[var(--hype-dark)] text-white rounded-none shadow-[var(--shadow-green)]">
        <div className="p-8 border-b-4 border-primary">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-white/62">
                Plano atual
              </div>
              <h2 className="text-2xl font-black uppercase tracking-tight italic">
                {currentPlan?.name || "Nenhum plano ativo"}
              </h2>
              <p className="text-sm font-medium text-white/70 max-w-md">{message}</p>
            </div>
            <Badge
              variant={subscriptionMeta.tone}
              className="rounded-none px-4 py-1 text-[10px] font-black uppercase tracking-widest"
            >
              {subscriptionMeta.label}
            </Badge>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-none border border-white/10 bg-white/5 p-4">
              <div className="text-[10px] font-black uppercase tracking-widest text-white/62">
                Mensalidade
              </div>
              <div className="mt-1 text-xl font-black text-primary">
                {formatBRL(currentPlan?.priceMonthly ?? 0)}
              </div>
            </div>
            {hasSubscription && nextCharge && (
              <div className="rounded-none border border-white/10 bg-white/5 p-4">
                <div className="text-[10px] font-black uppercase tracking-widest text-white/62">
                  Proxima cobranca
                </div>
                <div className="mt-1 text-lg font-black">{nextCharge}</div>
              </div>
            )}
            <div className="rounded-none border border-white/10 bg-white/5 p-4">
              <div className="text-[10px] font-black uppercase tracking-widest text-white/62">
                Situacao
              </div>
              <div className="mt-1 text-sm font-bold text-white/85">
                {subscriptionMeta.detail}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Comparativo de planos */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-black uppercase tracking-tight italic">
            {hasSubscription ? "Conheca outros planos" : "Escolha o seu plano"}
          </h3>
        </div>

        {plansLoading ? (
          <Card className="flex items-center gap-3 border border-border bg-white p-6 text-sm font-bold text-muted-foreground rounded-none">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Carregando planos...
          </Card>
        ) : comparablePlans.length === 0 ? (
          <Card className="border-2 border-dashed border-border bg-white p-12 text-center rounded-none">
            <CreditCard className="mx-auto mb-3 h-10 w-10 text-black/10" />
            <h4 className="font-black uppercase tracking-tight">
              Nenhum plano adicional disponivel
            </h4>
            <p className="mt-1 text-sm text-muted-foreground">
              Voce ja esta no melhor plano ou nao ha planos para comparar no
              momento.
            </p>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {comparablePlans.map((item) => {
              const normalized = normalizePlan(item);
              const isUpgrade =
                Number(item.price_monthly ?? 0) >
                Number(currentPlan?.priceMonthly ?? 0);

              return (
                <Card
                  key={item.id}
                  className="flex flex-col border border-border bg-white p-6 rounded-none shadow-card transition-all hover:border-primary/40 hover:shadow-[var(--shadow-green)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-lg font-black uppercase tracking-tight italic">
                        {item.name}
                      </h4>
                      {item.description && (
                        <p className="mt-1 text-xs font-medium text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                    </div>
                    {isUpgrade && (
                      <Badge className="rounded-none bg-primary px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-primary-foreground">
                        Upgrade
                      </Badge>
                    )}
                  </div>

                  <div className="mt-4 flex items-end gap-1">
                    <span className="text-3xl font-black text-primary">
                      {formatBRL(item.price_monthly)}
                    </span>
                    <span className="mb-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      /mes
                    </span>
                  </div>

                  {normalized && (
                    <ul className="mt-5 flex-1 space-y-2 text-sm font-medium text-foreground/80">
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                        Produtos: {normalized.limits.products ?? "Ilimitado"}
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                        Pedidos/mes: {normalized.limits.monthlyOrders ?? "Ilimitado"}
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                        Usuarios: {normalized.limits.internalUsers ?? "Ilimitado"}
                      </li>
                      {normalized.marketingFeatures.slice(0, 3).map((feature) => (
                        <li key={feature} className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Gerenciar assinatura */}
      <section className="space-y-4">
        <h3 className="text-xl font-black uppercase tracking-tight italic">
          Gerenciar assinatura
        </h3>
        <Card className="border border-border bg-white p-6 rounded-none shadow-card">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-black uppercase tracking-tight">
                <CreditCard className="h-4 w-4 text-primary" />
                Pagamento e cobranca
              </div>
              <p className="text-sm font-medium text-muted-foreground">
                Atualize o status junto ao provedor de pagamento ou cancele a
                renovacao automatica quando precisar.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                className="rounded-none border-border font-black uppercase tracking-widest text-[10px] h-11"
                onClick={() => void handleSync()}
                disabled={syncing}
              >
                <RefreshCcw
                  className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`}
                />
                Atualizar pagamento
              </Button>
              {hasSubscription && store?.id && (
                <Button
                  variant="outline"
                  className="rounded-none border-[#ff2d55]/30 text-[#ff2d55] hover:bg-[#ff2d55] hover:text-white font-black uppercase tracking-widest text-[10px] h-11 transition-colors"
                  onClick={() => setCancelDialogOpen(true)}
                  disabled={canceling}
                >
                  Cancelar assinatura
                </Button>
              )}
            </div>
          </div>

          {(accessState === "no_plan" || accessState === "canceled") && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-none border border-primary/20 bg-primary/5 p-4">
              <p className="text-sm font-bold text-foreground">
                Voce ainda nao possui uma assinatura ativa.
              </p>
              <Button
                variant="hero"
                className="rounded-none font-black uppercase tracking-widest text-[10px] h-11"
                asChild
              >
                <Link to="/">
                  <ArrowUpRight className="h-4 w-4 mr-2" />
                  Explorar planos
                </Link>
              </Button>
            </div>
          )}
        </Card>
      </section>

      {/* Dialogo de cancelamento */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="border border-border rounded-none">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black uppercase italic tracking-tighter">
              Cancelar assinatura
            </DialogTitle>
            <DialogDescription className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              A recorrencia sera cancelada e nao havera nova cobranca. Seu acesso
              permanece ativo ate o fim do periodo ja pago.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-4 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="rounded-none border-border font-black uppercase tracking-widest text-[10px] h-12"
              onClick={() => setCancelDialogOpen(false)}
              disabled={canceling}
            >
              Voltar
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="rounded-none font-black uppercase tracking-widest text-[10px] h-12"
              onClick={() => void handleCancel()}
              disabled={canceling}
            >
              {canceling ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Confirmar cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomerSubscription;
