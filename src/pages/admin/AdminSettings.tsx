import { useCallback, useEffect, useMemo, useState } from "react";
import { backend } from "@/integrations/backend/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CreditCard,
  ExternalLink,
  Globe,
  Key,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";

type SubscriptionRow = {
  id: string;
  store_id: string;
  plan_id?: string | null;
  status?: string | null;
  billing_type?: string | null;
  last_payment_status?: string | null;
  next_due_date?: string | null;
  current_period_end?: string | null;
  asaas_subscription_id?: string | null;
  updated_at?: string | null;
  stores?: { name?: string | null; slug?: string | null; owner_user_id?: string | null } | null;
  plans?: { name?: string | null; price_monthly?: number | string | null } | null;
};

const statusMeta: Record<string, { label: string; className: string }> = {
  ativa: { label: "Ativa", className: "bg-emerald-500/15 text-emerald-700 border-emerald-500/20" },
  trial: { label: "Trial", className: "bg-primary/15 text-foreground border-primary/20" },
  pendente_pagamento: { label: "Pendente", className: "bg-amber-500/15 text-amber-700 border-amber-500/20" },
  inadimplente: { label: "Inadimplente", className: "bg-destructive/10 text-destructive border-destructive/20" },
  cancelada: { label: "Cancelada", className: "bg-muted text-muted-foreground border-border" },
  encerrada: { label: "Encerrada", className: "bg-muted text-muted-foreground border-border" },
};

const formatDate = (value?: string | null) => {
  if (!value) return "Sem data";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sem data" : date.toLocaleDateString("pt-BR");
};

const initialsFor = (name?: string | null) =>
  String(name || "Loja")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "L";

const AdminSettings = () => {
  const [loading, setLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const environment = import.meta.env.NEXT_PUBLIC_ASAAS_ENVIRONMENT || import.meta.env.VITE_ASAAS_ENVIRONMENT || "production";

  const loadSubscriptions = useCallback(async () => {
    setLoading(true);
    const { data, error } = await backend
      .from("subscriptions")
      .select("*, stores(name, slug, owner_user_id), plans(name, price_monthly)")
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) {
      toast.error("Nao foi possivel carregar assinaturas.");
      setSubscriptions([]);
    } else {
      setSubscriptions((data ?? []) as SubscriptionRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadSubscriptions();
  }, [loadSubscriptions]);

  const summary = useMemo(() => {
    const active = subscriptions.filter((item) => item.status === "ativa" || item.status === "trial");
    const billableActive = active.filter((item) => Boolean(item.asaas_subscription_id));
    const pending = subscriptions.filter((item) => item.status === "pendente_pagamento");
    const risk = subscriptions.filter((item) => item.status === "inadimplente" || item.status === "pendente_pagamento");
    const canceled = subscriptions.filter((item) => item.status === "cancelada" || item.status === "encerrada");
    const mrr = billableActive.reduce((total, item) => total + Number(item.plans?.price_monthly || 0), 0);
    const nextRenewal = active
      .map((item) => item.next_due_date || item.current_period_end)
      .filter(Boolean)
      .sort()[0] || null;

    return {
      active: active.length,
      billableActive: billableActive.length,
      pending: pending.length,
      risk: risk.length,
      churn: subscriptions.length ? canceled.length / subscriptions.length : 0,
      mrr,
      nextRenewal,
    };
  }, [subscriptions]);

  // Overview de planos derivado APENAS das assinaturas reais ja carregadas
  // (relacao plans). Nenhum dado fabricado: agrupa por nome do plano.
  const plansOverview = useMemo(() => {
    const map = new Map<string, { name: string; price: number; total: number; active: number }>();
    for (const item of subscriptions) {
      const name = item.plans?.name || "Sem plano";
      const price = Number(item.plans?.price_monthly || 0);
      const entry = map.get(name) || { name, price, total: 0, active: 0 };
      entry.price = price || entry.price;
      entry.total += 1;
      if ((item.status === "ativa" || item.status === "trial") && item.asaas_subscription_id) entry.active += 1;
      map.set(name, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.price - a.price);
  }, [subscriptions]);

  const syncSubscription = async (subscription: SubscriptionRow) => {
    if (!subscription.store_id) return;
    setSyncingId(subscription.id);
    const tid = toast.loading("Consultando status no Asaas...");
    try {
      const { data, error } = await backend.functions.invoke("sync-subscription-status", {
        body: { storeId: subscription.store_id },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error || "Falha ao sincronizar assinatura.");
      toast.success(data?.status === "ativa" ? "Pagamento confirmado. Assinatura ativa." : "Assinatura sincronizada.", { id: tid });
      await loadSubscriptions();
    } catch (error: any) {
      toast.error(error?.message || "Nao foi possivel sincronizar a assinatura.", { id: tid });
    } finally {
      setSyncingId(null);
    }
  };

  const cleanupOrphans = async () => {
    if (!confirm("Deseja remover usuarios orfaos da autenticacao Supabase? Esta acao nao pode ser desfeita.")) return;

    const tid = toast.loading("Varrendo autenticacao Supabase...");
    try {
      const { data, error } = await backend.functions.invoke("admin-delete-store", {
        body: { action: "cleanup_orphans" },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      toast.success(`${data.deleted_count || 0} registro(s) orfao(s) removido(s).`, { id: tid });
    } catch (error: any) {
      toast.error(error?.message || "Erro ao limpar usuarios orfaos.", { id: tid });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Assinaturas e plataforma</h1>
          <p className="text-muted-foreground">Controle de mensalidades Asaas, pagamentos e operacao Supabase da Hype.</p>
        </div>
        <Button variant="hero" onClick={loadSubscriptions} disabled={loading} className="h-11 font-black uppercase tracking-widest text-xs">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          Atualizar painel
        </Button>
      </div>

      {/* Metricas (somente dados reais do summary) */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={CreditCard} label="MRR ativo" value={formatBRL(summary.mrr)} detail={`${summary.billableActive} assinatura(s) Asaas`} />
        <MetricCard icon={Users} label="Assinaturas ativas" value={summary.active} detail="Inclui trial liberado" />
        <MetricCard icon={Activity} label="Pendentes" value={summary.pending} detail="Aguardando validacao" tone="warning" />
        <MetricCard icon={AlertTriangle} label="Risco" value={summary.risk} detail="Pendente ou inadimplente" tone="danger" />
        <MetricCard icon={CalendarDays} label="Proxima renovacao" value={formatDate(summary.nextRenewal)} detail={`${Math.round(summary.churn * 100)}% canceladas/encerradas`} />
      </div>

      {/* Overview de planos (derivado das assinaturas reais; omitido se vazio) */}
      {plansOverview.length > 0 && (
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <CardTitle>Planos contratados</CardTitle>
            </div>
            <CardDescription>Distribuicao das assinaturas por plano da plataforma Hype.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 pt-6">
            {plansOverview.map((plan) => (
              <div
                key={plan.name}
                className="rounded-md border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-black tracking-tight">{plan.name}</div>
                    <div className="text-xs text-muted-foreground">{formatBRL(plan.price)}/mes</div>
                  </div>
                  <Badge variant="outline" className="rounded-md border-primary/20 bg-primary/15 text-[10px] font-black uppercase text-foreground">
                    {plan.active} ativas
                  </Badge>
                </div>
                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <div className="text-2xl font-black tracking-tight">{plan.total}</div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">assinantes</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-black text-primary-foreground">
                      <span className="text-foreground">{formatBRL(plan.active * plan.price)}</span>
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">MRR do plano</div>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Tabela de assinaturas: assinante, plano, status, proxima cobranca */}
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <CardTitle>Gestao de assinaturas</CardTitle>
            </div>
            <CardDescription>
              Sincronize status, confira vencimentos e acompanhe o cadastro gerado para cada loja.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : subscriptions.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhuma assinatura encontrada.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Assinante</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Pagamento</TableHead>
                    <TableHead>Proxima cobranca</TableHead>
                    <TableHead className="text-right">Acao</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.map((subscription) => {
                    const status = String(subscription.status || "sem_status");
                    const meta = statusMeta[status] || { label: status, className: "bg-muted text-muted-foreground border-border" };
                    const storeName = subscription.stores?.name || "Loja sem nome";
                    return (
                      <TableRow key={subscription.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/15 text-xs font-black text-foreground">
                              {initialsFor(storeName)}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-semibold">{storeName}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                {subscription.stores?.slug ? `/${subscription.stores.slug}` : subscription.store_id}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-semibold">{subscription.plans?.name || "Sem plano"}</div>
                          <div className="text-xs text-muted-foreground">{formatBRL(Number(subscription.plans?.price_monthly || 0))}/mes</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("rounded-md font-black uppercase text-[10px]", meta.className)}>
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{subscription.last_payment_status || "Nao consultado"}</div>
                          <div className="text-xs text-muted-foreground">{subscription.billing_type || "Sem forma"}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{formatDate(subscription.next_due_date || subscription.current_period_end)}</div>
                          <div className="text-xs text-muted-foreground">Atualizado em {formatDate(subscription.updated_at)}</div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9"
                            onClick={() => syncSubscription(subscription)}
                            disabled={syncingId === subscription.id}
                          >
                            {syncingId === subscription.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                            Sincronizar
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <CardTitle>Asaas plataforma</CardTitle>
              </div>
              <CardDescription>Conta mestra das mensalidades das lojas.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-black uppercase tracking-widest">Ambiente</Label>
                  <Badge variant={environment === "production" ? "default" : "secondary"} className="font-black uppercase text-[10px]">
                    {environment}
                  </Badge>
                </div>
                <div className="relative">
                  <Input
                    type="password"
                    value="Configurado no servidor"
                    readOnly
                    className="h-12 rounded-md border border-dashed border-primary/20 bg-background font-bold"
                  />
                  <Key className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                </div>
              </div>
              <Button variant="outline" className="h-11 w-full justify-center font-black uppercase tracking-widest text-xs" asChild>
                <a href="https://www.asaas.com" target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" /> Abrir Asaas
                </a>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                <CardTitle>Webhook</CardTitle>
              </div>
              <CardDescription>URL unica para assinaturas e pagamentos das lojas.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 rounded-md border border-dashed border-border bg-muted/30 p-4">
                <Input
                  value={`${window.location.origin}/api/webhooks/asaas`}
                  readOnly
                  className="rounded-md border-border bg-background font-mono text-[10px]"
                />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Configure o token secreto no painel Asaas e no servidor.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-destructive/20 bg-destructive/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                <CardTitle>Manutencao Supabase</CardTitle>
              </div>
              <CardDescription>Remove usuarios sem perfil ou loja vinculada.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="destructive" className="h-11 w-full font-black uppercase tracking-widest text-xs" onClick={cleanupOrphans}>
                Executar limpeza segura
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

const MetricCard = ({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: any;
  label: string;
  value: string | number;
  detail: string;
  tone?: "default" | "warning" | "danger";
}) => {
  const toneClass = {
    default: "bg-primary/15 text-foreground",
    warning: "bg-amber-100 text-amber-700",
    danger: "bg-destructive/10 text-destructive",
  }[tone];

  return (
    <Card className="rounded-md border-border p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className="mt-1 truncate text-2xl font-black tracking-tight">{value}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>
        </div>
        <div className={cn("rounded-md p-3", toneClass)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
};

export default AdminSettings;
