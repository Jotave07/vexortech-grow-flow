import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { BrandMark } from "@/components/BrandMark";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { formatBRL, slugify } from "@/lib/format";
import { z } from "zod";

const schema = z.object({
  name: z.string().trim().min(2, "Nome muito curto").max(100),
  slug: z.string().trim().min(3, "Slug muito curto").max(50).regex(/^[a-z0-9-]+$/, "Use apenas letras, numeros e hifen"),
  description: z.string().max(500).optional(),
  whatsapp: z.string().trim().min(10, "WhatsApp invalido").max(20),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(2).optional(),
});

const Onboarding = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, profile, loading: authLoading, refreshProfile } = useAuth();
  const [form, setForm] = useState({ name: "", slug: "", description: "", whatsapp: "", city: "", state: "" });
  const [plans, setPlans] = useState<any[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const initialPlanId = searchParams.get("plan") || sessionStorage.getItem("selected_plan_id") || "";
  const [selectedPlanId, setSelectedPlanId] = useState(initialPlanId);
  const [loading, setLoading] = useState(false);
  const publicBaseUrl = `${window.location.host}/loja/`;

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");

      if (error) {
        toast.error("Nao foi possivel carregar os planos.");
        setPlansLoading(false);
        return;
      }

      setPlans(data ?? []);
      setSelectedPlanId((current) => current || data?.[0]?.id || "");
      setPlansLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!authLoading && profile?.store_id) navigate("/app", { replace: true });
  }, [authLoading, profile, navigate]);

  useEffect(() => {
    if (form.name && !form.slug) setForm((f) => ({ ...f, slug: slugify(form.name) }));
  }, [form.name, form.slug]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!selectedPlanId) return toast.error("Escolha um plano para ativar sua loja.");
    const parsed = schema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);

    setLoading(true);
    const { data: existing } = await supabase.from("stores").select("id").eq("slug", parsed.data.slug).maybeSingle();
    if (existing) {
      setLoading(false);
      return toast.error("Este endereco ja esta em uso. Escolha outro.");
    }

    const { data: store, error: storeErr } = await supabase
      .from("stores")
      .insert({
        owner_user_id: user.id,
        plan_id: selectedPlanId,
        slug: parsed.data.slug,
        name: parsed.data.name,
        description: parsed.data.description || null,
        whatsapp: parsed.data.whatsapp,
        phone: parsed.data.whatsapp,
        city: parsed.data.city || null,
        state: parsed.data.state || null,
      })
      .select()
      .single();

    if (storeErr || !store) {
      setLoading(false);
      return toast.error("Erro ao criar loja: " + (storeErr?.message ?? "desconhecido"));
    }

    await Promise.all([
      supabase.from("store_settings").insert({ store_id: store.id }),
      supabase.from("profiles").update({ store_id: store.id, full_name: profile?.full_name ?? null }).eq("user_id", user.id),
      supabase.from("user_roles").insert({ user_id: user.id, role: "store_owner", store_id: store.id }),
      supabase.from("subscriptions").insert({
        store_id: store.id,
        plan_id: selectedPlanId,
        status: "pendente_pagamento",
        provider: "stripe",
        last_payment_status: "pending",
      }),
    ]);

    setLoading(false);
    sessionStorage.setItem("selected_plan_id", selectedPlanId);
    await refreshProfile();
    toast.success("Loja criada! Falta concluir a assinatura para liberar o painel.");
    navigate("/app/assinatura?state=pending_payment", { replace: true });
  };

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="auth-shell py-8">
      <BrandMark className="mb-8" />
      <Card className="auth-card max-w-xl">
        <h1 className="mb-2 text-2xl font-bold">Configuração da sua loja</h1>
        <p className="mb-6 text-sm text-muted-foreground">Sua loja será criada e você poderá gerenciar tudo após ativar sua assinatura.</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-3">
            <Label>Plano escolhido</Label>
            {plansLoading ? (
              <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Carregando planos...
              </div>
            ) : plans.length === 0 ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                Nenhum plano ativo disponivel no momento.
              </div>
            ) : (
              <RadioGroup value={selectedPlanId} onValueChange={setSelectedPlanId} className="space-y-2">
                {plans.map((plan) => (
                  <label key={plan.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-smooth ${selectedPlanId === plan.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/35"}`}>
                    <RadioGroupItem value={plan.id} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{plan.name}</span>
                        <span className="text-sm font-semibold text-primary">{formatBRL(plan.price_monthly)}/mes</span>
                      </div>
                      {plan.description && <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>}
                    </div>
                  </label>
                ))}
              </RadioGroup>
            )}
            {selectedPlan && (
              <p className="text-xs text-muted-foreground">
                A assinatura sera criada para o plano <span className="font-medium text-foreground">{selectedPlan.name}</span> e o acesso so sera liberado apos o pagamento.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="name">Nome do estabelecimento *</Label>
            <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Burger Vexor" required />
          </div>
          <div>
            <Label htmlFor="slug">Endereco da loja *</Label>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{publicBaseUrl}</span>
              <Input id="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} placeholder="burger-vexor" required />
            </div>
          </div>
          <div>
            <Label htmlFor="description">Descricao curta</Label>
            <Textarea id="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} />
          </div>
          <div>
            <Label htmlFor="whatsapp">WhatsApp *</Label>
            <Input id="whatsapp" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="(11) 99999-9999" required />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label htmlFor="city">Cidade</Label>
              <Input id="city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="state">UF</Label>
              <Input id="state" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} />
            </div>
          </div>
          <Button type="submit" variant="hero" className="w-full" disabled={loading || plansLoading || !selectedPlanId}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Criar loja e seguir para assinatura
          </Button>
        </form>
      </Card>
    </div>
  );
};

export default Onboarding;
