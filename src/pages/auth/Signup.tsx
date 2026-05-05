import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { BrandMark } from "@/components/BrandMark";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { formatBRL } from "@/lib/format";

const schema = z.object({
  full_name: z.string().trim().min(2, "Informe seu nome").max(100),
  email: z.string().trim().email("E-mail invalido").max(255),
  password: z.string().min(6, "Minimo 6 caracteres").max(100),
});

const Signup = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: window.location.origin + "/onboarding",
        data: { full_name: parsed.data.full_name },
      },
    });
    setLoading(false);
    if (error) {
      if (error.message.includes("already")) {
        toast.info("Este e-mail já possui conta. Redirecionando para login...");
        setTimeout(() => navigate("/entrar", { replace: true }), 2000);
        return;
      }
      toast.error(error.message);
      return;
    }
    toast.success("Conta criada! Bem-vindo.");
    navigate("/onboarding", { replace: true });
  };

  return (
    <div className="auth-shell py-8">
      <BrandMark to="/" className="mb-8" />
      <Card className="auth-card">
        <h1 className="mb-2 text-2xl font-bold">Criar sua conta</h1>
        <p className="mb-6 text-sm text-muted-foreground">Comece a vender online em minutos.</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="full_name">Seu nome</Label>
            <Input id="full_name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
          </div>
          <div>
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div>
            <Label htmlFor="password">Senha</Label>
            <Input id="password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
          </div>
          <Button type="submit" variant="hero" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Criar minha conta
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Ja tem conta? <Link to="/entrar" className="text-primary hover:underline">Entrar</Link>
        </p>
      </Card>
    </div>
  );
};

export default Signup;
