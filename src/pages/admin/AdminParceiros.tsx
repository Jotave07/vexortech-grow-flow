import { useEffect, useMemo, useState } from "react";
import { backend } from "@/integrations/backend/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Search,
  ExternalLink,
  Pause,
  Play,
  Trash2,
  ShieldCheck,
  Store as StoreIcon,
  CheckCircle2,
  Layers,
  MapPin,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";
import { buildDeliveryUrl } from "@/lib/domains";
import { cn } from "@/lib/utils";
import { cancelSubscription, updateSubscriptionPlan } from "@/services/subscription-billing";

const AdminParceiros = () => {
  const [stores, setStores] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [selected, setSelected] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: s }, { data: p }] = await Promise.all([
      backend
        .from("stores")
        .select("*, subscriptions(status, plan_id, asaas_subscription_id, billing_type, plans(name, price_monthly))")
        .order("created_at", { ascending: false }),
      backend.from("plans").select("*").order("sort_order"),
    ]);

    const ownerUserIds = Array.from(
      new Set((s ?? []).map((store: any) => store.owner_user_id).filter(Boolean)),
    );
    const { data: profilesData } = ownerUserIds.length
      ? await backend
          .from("profiles")
          .select("id, user_id, store_id, is_exempt, role, email")
          .in("user_id", ownerUserIds)
      : { data: [] as any[] };

    const storesWithExempt = (s ?? []).map((store: any) => {
      const ownerProfile = (profilesData ?? []).find(
        (prof: any) => prof.user_id === store.owner_user_id || prof.store_id === store.id,
      );
      return {
        ...store,
        is_exempt: ownerProfile?.is_exempt || false,
        owner_profile_id: ownerProfile?.id,
      };
    });

    setStores(storesWithExempt);
    setPlans(p ?? []);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stores.filter((s) => {
      if (q) {
        const matches =
          s.name?.toLowerCase().includes(q) ||
          s.slug?.toLowerCase().includes(q) ||
          s.email?.toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (statusFilter === "active" && (!s.is_active || s.is_suspended)) return false;
      if (statusFilter === "review" && (s.is_active || s.is_suspended)) return false;
      if (statusFilter === "suspended" && !s.is_suspended) return false;
      if (planFilter !== "all") {
        const pid = s.subscriptions?.[0]?.plan_id;
        if (planFilter === "none" && pid) return false;
        if (planFilter !== "none" && pid !== planFilter) return false;
      }
      return true;
    });
  }, [stores, search, statusFilter, planFilter]);

  const summary = useMemo(() => {
    const total = stores.length;
    const active = stores.filter((s) => s.is_active && !s.is_suspended).length;
    const review = stores.filter((s) => !s.is_active && !s.is_suspended).length;
    return { total, active, review };
  }, [stores]);

  const toggleSuspend = async (store: any) => {
    const { error } = await backend
      .from("stores")
      .update({ is_suspended: !store.is_suspended })
      .eq("id", store.id);
    if (error) return toast.error(error.message);
    toast.success(store.is_suspended ? "Parceiro reativado" : "Parceiro suspenso");
    load();
  };

  const toggleExempt = async (store: any) => {
    if (!store.owner_profile_id) {
      return toast.error("Dono da loja não encontrado no sistema de perfis.");
    }
    const newValue = !store.is_exempt;
    const { error } = await backend
      .from("profiles")
      .update({ is_exempt: newValue })
      .eq("id", store.owner_profile_id);
    if (error) return toast.error(error.message);
    toast.success(newValue ? "Parceiro marcado como Isento (Acesso Total)" : "Isenção removida");
    load();
  };

  const changePlan = async (store: any, planId: string) => {
    if (planId === "cortesia") {
      const courtesyPlan = plans.find(
        (p) => p.slug?.toLowerCase() === "premium_cortesia" || p.slug?.toLowerCase() === "isento",
      );
      const targetPlanId = courtesyPlan?.id || null;
      const sub = store.subscriptions?.[0];
      const tid = toast.loading("Aplicando cortesia sem gerar cobranca...");

      try {
        if (!store.owner_profile_id) {
          throw new Error("Dono da loja nao encontrado no sistema de perfis.");
        }

        if (sub?.asaas_subscription_id && !["cancelada", "encerrada"].includes(String(sub.status || ""))) {
          await cancelSubscription(store.id);
        }

        if (sub && !sub.asaas_subscription_id) {
          await backend
            .from("subscriptions")
            .update({
              plan_id: targetPlanId,
              status: "cancelada",
              canceled_at: new Date().toISOString(),
              cancellation_effective_at: new Date().toISOString(),
            })
            .eq("store_id", store.id);
        }

        await backend
          .from("profiles")
          .update({ is_exempt: true })
          .eq("id", store.owner_profile_id);

        await backend
          .from("stores")
          .update({ plan_id: targetPlanId, is_active: true })
          .eq("id", store.id);

        toast.success(
          targetPlanId
            ? "Cortesia aplicada e acesso liberado sem cobranca."
            : "Cortesia aplicada sem plano de referencia. Crie um plano isento para catalogar melhor.",
          { id: tid },
        );
      } catch (error: any) {
        toast.error(error?.message || "Nao foi possivel aplicar cortesia.", { id: tid });
      } finally {
        load();
      }
    } else {
      const sub = store.subscriptions?.[0];
      if (!sub?.asaas_subscription_id) {
        toast.error("Esta loja ainda nao possui assinatura Asaas. O lojista precisa iniciar o checkout pelo painel.");
        return;
      }

      const tid = toast.loading("Atualizando assinatura no Asaas...");
      try {
        await updateSubscriptionPlan({
          storeId: store.id,
          planId,
          billingType: sub.billing_type === "BOLETO" ? "BOLETO" : "CREDIT_CARD",
        });
        if (store.owner_profile_id && store.is_exempt) {
          await backend.from("profiles").update({ is_exempt: false }).eq("id", store.owner_profile_id);
        }
        toast.success("Plano alterado no Asaas e sincronizado localmente.", { id: tid });
      } catch (error: any) {
        toast.error(error?.message || "Nao foi possivel alterar o plano no Asaas.", { id: tid });
      } finally {
        load();
      }
    }
  };

  const remove = async (store: any) => {
    if (
      !confirm(
        `EXCLUIR PERMANENTEMENTE o parceiro "${store.name}"? Isso apaga TODOS os dados, inclusive o acesso do lojista.`,
      )
    )
      return;

    setLoading(true);
    const { data, error } = await backend.functions.invoke("admin-delete-store", {
      body: { store_id: store.id },
    });

    if (error || data?.error) {
      setLoading(false);
      return toast.error(error?.message || data?.error || "Erro ao excluir parceiro");
    }

    toast.success("Parceiro e usuário excluídos com sucesso");
    setSelected(null);
    load();
  };

  if (loading)
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tight">Parceiros</h1>
          <p className="font-medium text-muted-foreground">
            Lojas parceiras conectadas à plataforma HYPE Delivery.
          </p>
        </div>
      </div>

      {/* Tiles de resumo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryTile label="Total de Parceiros" value={String(summary.total)} icon={StoreIcon} tone="primary" />
        <SummaryTile label="Abertos" value={String(summary.active)} icon={CheckCircle2} tone="info" />
        <SummaryTile label="Em Análise" value={String(summary.review)} icon={Layers} tone="amber" />
      </div>

      {/* Busca + filtros */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por nome, slug ou e-mail..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="active">Abertos</SelectItem>
                <SelectItem value="review">Em análise</SelectItem>
                <SelectItem value="suspended">Fechados</SelectItem>
              </SelectContent>
            </Select>
            <Select value={planFilter} onValueChange={setPlanFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Plano" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os planos</SelectItem>
                <SelectItem value="none">Sem plano</SelectItem>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* Grade de cards de parceiro padronizados e compactos */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((s) => (
          <PartnerCard
            key={s.id}
            store={s}
            onOpen={() => setSelected(s)}
            onSuspend={() => toggleSuspend(s)}
          />
        ))}
      </div>
      {filtered.length === 0 && (
        <Card className="p-12 text-center">
          <StoreIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm italic text-muted-foreground">
            Nenhum parceiro encontrado com os filtros atuais.
          </p>
        </Card>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-black uppercase tracking-tight">{selected?.name}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="rounded-none border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-1.5">
                <div>
                  Slug: <span className="font-mono text-foreground">/{selected.slug}</span>
                </div>
                <div>
                  E-mail: <span className="text-foreground">{selected.email ?? "—"}</span>
                </div>
                <div>
                  Telefone: <span className="text-foreground">{selected.phone ?? "—"}</span>
                </div>
                <div>
                  Cidade:{" "}
                  <span className="text-foreground">
                    {selected.city ?? "—"} {selected.state && `/${selected.state}`}
                  </span>
                </div>
                <div>
                  Cadastro:{" "}
                  <span className="text-foreground">
                    {new Date(selected.created_at).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-none border border-border bg-muted/30 p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="exempt-mode" className="text-sm font-bold flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" /> Parceiro Isento
                  </Label>
                  <p className="text-[10px] text-muted-foreground">
                    Bypassa todas as travas de assinatura e pagamento.
                  </p>
                </div>
                <Switch
                  id="exempt-mode"
                  checked={selected.is_exempt}
                  onCheckedChange={() => toggleExempt(selected)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  Plano de Referência
                </label>
                <Select
                  value={
                    selected.is_exempt ? "cortesia" :
                    selected.subscriptions?.[0]?.plan_id ||
                    (selected.subscriptions?.[0]?.status === "ativa" &&
                    !selected.subscriptions?.[0]?.plan_id
                      ? "cortesia"
                      : "")
                  }
                  onValueChange={(v) => changePlan(selected, v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cortesia">Cortesia (Plano Isento)</SelectItem>
                    {plans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} — {formatBRL(p.price_monthly)}/mês
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <Button
                  asChild
                  variant="outline"
                  className="font-bold uppercase tracking-widest text-xs"
                >
                  <a
                    href={buildDeliveryUrl(`/loja/${selected.slug}`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" /> Abrir loja pública
                  </a>
                </Button>
                <Button
                  variant={selected.is_suspended ? "hero" : "outline"}
                  className="font-bold uppercase tracking-widest text-xs"
                  onClick={() => toggleSuspend(selected)}
                >
                  {selected.is_suspended ? (
                    <>
                      <Play className="h-4 w-4" /> Reativar
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4" /> Suspender
                    </>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  className="font-bold uppercase tracking-widest text-xs"
                  onClick={() => remove(selected)}
                >
                  <Trash2 className="h-4 w-4" /> Excluir parceiro
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const TONES: Record<string, string> = {
  primary: "text-[var(--hype-green-dark)] bg-primary/10",
  info: "text-[var(--hype-green-dark)] bg-primary/10",
  amber: "text-amber-600 bg-amber-50",
};

const SummaryTile = ({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: any;
  tone: keyof typeof TONES;
}) => (
  <Card className="group p-5 transition-smooth hover:border-primary">
    <div className="mb-3 flex items-center justify-between">
      <div className={cn("rounded-none p-2", TONES[tone])}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
    <div className="mb-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
      {label}
    </div>
    <div className="text-2xl font-black tracking-tighter">{value}</div>
  </Card>
);

const PartnerStatusBadge = ({ store }: { store: any }) => {
  if (store.is_suspended) {
    return (
      <Badge
        variant="secondary"
        className="bg-muted text-muted-foreground border-border text-[10px] font-bold uppercase tracking-widest"
      >
        Fechada
      </Badge>
    );
  }
  if (!store.is_active) {
    return (
      <Badge
        variant="outline"
        className="bg-amber-50 text-amber-600 border-amber-200 text-[10px] font-bold uppercase tracking-widest"
      >
        Em análise
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="bg-primary/10 text-[var(--hype-green-dark)] border-primary/30 text-[10px] font-bold uppercase tracking-widest"
    >
      Aberta
    </Badge>
  );
};

const PartnerCard = ({
  store,
  onOpen,
  onSuspend,
}: {
  store: any;
  onOpen: () => void;
  onSuspend: () => void;
}) => {
  const sub = store.subscriptions?.[0];
  const planName = sub?.plans?.name ?? "Sem plano";
  const location = [store.city, store.state].filter(Boolean).join("/");

  return (
    <Card className="group flex flex-col overflow-hidden p-0 transition-smooth hover:border-primary">
      <div className="flex items-start gap-3 p-4">
        {/* Retrato da loja em tamanho padronizado e compacto */}
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-none border border-border bg-muted">
          {store.logo_url ? (
            <img src={store.logo_url} alt={store.name} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground/50">
              <StoreIcon className="h-6 w-6" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {/* Nome em posição padronizada */}
          <div className="truncate text-sm font-black tracking-tight">{store.name}</div>
          <div className="truncate text-xs font-medium text-muted-foreground">/{store.slug}</div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <PartnerStatusBadge store={store} />
            {store.is_exempt && (
              <Badge
                variant="outline"
                className="bg-primary/10 text-[var(--hype-green-dark)] border-primary/30 text-[10px] font-bold uppercase tracking-widest"
              >
                <ShieldCheck className="mr-1 h-3 w-3" /> Isenta
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Métricas — somente dados existentes na fiação */}
      <div className="grid grid-cols-2 gap-px border-t border-border bg-border">
        <div className="bg-card p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Plano
          </div>
          <div className="truncate text-sm font-black">{planName}</div>
        </div>
        <div className="bg-card p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Mensalidade
          </div>
          <div className="truncate text-sm font-black">
            {sub?.plans?.price_monthly ? formatBRL(sub.plans.price_monthly) : "—"}
          </div>
        </div>
        <div className="bg-card p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Local
          </div>
          <div className="flex items-center gap-1 truncate text-sm font-black">
            <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" /> {location || "—"}
          </div>
        </div>
        <div className="bg-card p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Cadastro
          </div>
          <div className="truncate text-sm font-black">
            {new Date(store.created_at).toLocaleDateString("pt-BR")}
          </div>
        </div>
      </div>

      {/* Ações */}
      <div className="mt-auto flex items-center gap-2 border-t border-border bg-muted/30 p-3">
        <Button
          asChild
          variant="outline"
          size="sm"
          className="flex-1 font-bold uppercase tracking-widest text-[10px]"
        >
          <a
            href={buildDeliveryUrl(`/loja/${store.slug}`)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5" /> Ver
          </a>
        </Button>
        <Button
          variant="hero"
          size="sm"
          className="flex-1 font-bold uppercase tracking-widest text-[10px]"
          onClick={onOpen}
        >
          <Pencil className="h-3.5 w-3.5" /> Gerir
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          title={store.is_suspended ? "Reativar" : "Suspender"}
          onClick={onSuspend}
        >
          {store.is_suspended ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </Button>
      </div>
    </Card>
  );
};

export default AdminParceiros;
