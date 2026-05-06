import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
import { useAuth } from "@/contexts/AuthContext";
import { formatBRL, formatDoc } from "@/lib/format";

const schema = z.object({
  full_name: z.string().trim().min(2, "Informe seu nome").max(100),
  document: z.string().trim().min(11, "Informe um CPF ou CNPJ válido").max(18),
  email: z.string().trim().email("E-mail invalido").max(255),
  password: z.string().min(6, "Minimo 6 caracteres").max(100),
  confirmPassword: z.string().min(6, "Confirme sua senha"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "As senhas não coincidem",
  path: ["confirmPassword"],
});

const Signup = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, signOut } = useAuth();
  const redirect = new URLSearchParams(location.search).get("redirect");
  const [form, setForm] = useState({ full_name: "", document: "", email: "", password: "", confirmPassword: "" });
  const [loading, setLoading] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState<{ score: number; label: string; color: string }>({ score: 0, label: "", color: "" });

  // Only sign out if the user is already logged in and tries to access signup, 
  // but we should probably just redirect them to their panel instead.
  useEffect(() => {
    if (user && profile) {
      navigate(redirect || "/meu-painel", { replace: true });
    }
  }, [user, profile, navigate, redirect]);

  const checkPasswordStrength = (pass: string) => {
    if (!pass) return { score: 0, label: "", color: "" };
    let score = 0;
    if (pass.length >= 6) score++;
    if (pass.length >= 10) score++;
    if (/[A-Z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;

    if (score <= 2) return { score, label: "Fraca", color: "bg-red-500" };
    if (score <= 4) return { score, label: "Média", color: "bg-orange-500" };
    return { score, label: "Forte", color: "bg-green-500" };
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pass = e.target.value;
    setForm({ ...form, password: pass });
    setPasswordStrength(checkPasswordStrength(pass));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { data: signUpData, error } = await supabase.auth.signUp({
      email: parsed.data.email.toLowerCase(),
      password: parsed.data.password,
      options: {
        emailRedirectTo: window.location.origin + "/meu-painel",
        data: { 
          full_name: parsed.data.full_name.toUpperCase(),
          document: parsed.data.document.replace(/\D/g, "")
        },
      },
    });

    if (!error && signUpData.user) {
      // Create initial profile and role
      const { error: profileErr } = await supabase.from("profiles").insert({
        user_id: signUpData.user.id,
        full_name: parsed.data.full_name.toUpperCase(),
        document: parsed.data.document.replace(/\D/g, ""),
        email: parsed.data.email.toLowerCase(),
        role: "customer"
      });

      if (profileErr) {
        console.error("Error creating profile:", profileErr);
      }

      await supabase.from("user_roles").insert({
        user_id: signUpData.user.id,
        role: "customer"
      });
    }
    setLoading(false);
    if (error) {
      if (error.message.includes("already")) {
        toast.info("Este e-mail já possui conta. Redirecionando para login...");
        const loginUrl = redirect ? `/entrar?redirect=${encodeURIComponent(redirect)}` : "/entrar";
        setTimeout(() => navigate(loginUrl, { replace: true }), 2000);
        return;
      }
      toast.error(error.message);
      return;
    }
    toast.success("Conta criada! Bem-vindo.");
    
    if (redirect) {
      navigate(redirect, { replace: true });
    } else {
      navigate("/meu-painel", { replace: true });
    }
  };

  return (
    <div className="auth-shell py-8">
      <BrandMark to="/" className="mb-8" />
      <Card className="auth-card">
        <h1 className="mb-2 text-2xl font-bold">Criar conta de cliente</h1>
        <p className="mb-6 text-sm text-muted-foreground">Cadastre-se para realizar seus pedidos e acompanhar seu histórico.</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="full_name">Seu nome</Label>
            <Input id="full_name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
          </div>
          <div>
            <Label htmlFor="document">CPF ou CNPJ</Label>
            <Input 
              id="document" 
              value={formatDoc(form.document)} 
              onChange={(e) => setForm({ ...form, document: e.target.value })} 
              required 
              placeholder="000.000.000-00" 
            />
          </div>
          <div>
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div>
            <Label htmlFor="password">Senha</Label>
            <Input id="password" type="password" value={form.password} onChange={handlePasswordChange} required minLength={6} />
            {form.password && (
              <div className="mt-2 space-y-1">
                <div className="flex gap-1 h-1.5">
                  <div className={`h-full flex-1 rounded-full ${passwordStrength.score >= 1 ? passwordStrength.color : 'bg-muted'}`} />
                  <div className={`h-full flex-1 rounded-full ${passwordStrength.score >= 3 ? passwordStrength.color : 'bg-muted'}`} />
                  <div className={`h-full flex-1 rounded-full ${passwordStrength.score >= 5 ? passwordStrength.color : 'bg-muted'}`} />
                </div>
                <p className={`text-[10px] font-bold uppercase tracking-wider text-right ${passwordStrength.color.replace('bg-', 'text-')}`}>
                  Senha {passwordStrength.label}
                </p>
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="confirmPassword">Confirmar Senha</Label>
            <Input id="confirmPassword" type="password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} required minLength={6} />
          </div>
          <Button type="submit" variant="hero" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Criar minha conta
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Ja tem conta? <Link to={redirect ? `/entrar?redirect=${encodeURIComponent(redirect)}` : "/entrar"} className="text-primary hover:underline">Entrar</Link>
        </p>
      </Card>
    </div>
  );
};

export default Signup;
