import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { BrandMark } from "@/components/BrandMark";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { slugify, formatPhone, formatDoc } from "@/lib/format";
import { z } from "zod";

const schema = z.object({
  name: z.string().trim().min(2, "Nome muito curto").max(100),
  slug: z.string().trim().min(3, "Slug muito curto").max(50).regex(/^[a-z0-9-]+$/, "Use apenas letras, numeros e hifen"),
  description: z.string().max(500).optional(),
  whatsapp: z.string().trim().min(10, "WhatsApp invalido").max(20),
  document: z.string().trim().min(11, "CPF ou CNPJ inválido").max(18),
  city: z.string().trim().min(2, "Informe sua cidade").max(100),
  state: z.string().trim().length(2, "UF deve ter 2 letras"),
});

const Onboarding = () => {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading, refreshProfile } = useAuth();
  const [form, setForm] = useState({ name: "", slug: "", description: "", whatsapp: "", document: "", city: "", state: "" });
  const [loading, setLoading] = useState(false);
  const publicBaseUrl = `${window.location.host}/loja/`;

  useEffect(() => {
    if (!authLoading && profile?.store_id) navigate("/app", { replace: true });
  }, [authLoading, profile, navigate]);

  useEffect(() => {
    if (form.name && !form.slug) setForm((f) => ({ ...f, slug: slugify(form.name) }));
  }, [form.name, form.slug]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
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
        slug: parsed.data.slug,
        name: parsed.data.name.toUpperCase(),
        description: parsed.data.description?.toUpperCase() || null,
        whatsapp: parsed.data.whatsapp.replace(/\D/g, ""),
        phone: parsed.data.whatsapp.replace(/\D/g, ""),
        document: parsed.data.document.replace(/\D/g, ""),
        city: parsed.data.city.toUpperCase(),
        state: parsed.data.state.toUpperCase(),
        email: user.email?.toUpperCase(),
      })
      .select()
      .single();

    if (storeErr || !store) {
      setLoading(false);
      return toast.error("Erro ao criar loja: " + (storeErr?.message ?? "desconhecido"));
    }

    await Promise.all([
      supabase.from("store_settings").insert({ store_id: store.id }),
      supabase.from("profiles").update({ store_id: store.id, full_name: profile?.full_name ?? null } as any).eq("user_id", user.id),
      supabase.from("user_roles").insert({ user_id: user.id, role: "store_owner", store_id: store.id }),
    ]);

    setLoading(false);
    await refreshProfile();
    toast.success("Loja criada!");
    
    if (profile?.is_exempt) {
      navigate("/app", { replace: true });
    } else {
      navigate("/app/assinatura", { replace: true });
    }
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="whatsapp">WhatsApp *</Label>
              <Input id="whatsapp" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: formatPhone(e.target.value) })} placeholder="(11) 99999-9999" required />
            </div>
            <div>
              <Label htmlFor="document">CPF ou CNPJ *</Label>
              <Input id="document" value={form.document} onChange={(e) => setForm({ ...form, document: formatDoc(e.target.value) })} placeholder="000.000.000-00" required />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label htmlFor="city">Cidade *</Label>
              <Input id="city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value.toUpperCase() })} required />
            </div>
            <div>
              <Label htmlFor="state">UF *</Label>
              <Input id="state" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} placeholder="ES" required />
            </div>
          </div>
          <Button type="submit" variant="hero" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Criar loja e seguir para assinatura
          </Button>
        </form>
      </Card>
    </div>
  );
};

export default Onboarding;