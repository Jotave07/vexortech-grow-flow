import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { formatDoc } from "@/lib/format";
import { AuthShell } from "./AuthShell";

const Signup = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshProfile } = useAuth();
  const redirect = new URLSearchParams(location.search).get("redirect");
  const [form, setForm] = useState({ full_name: "", document: "", email: "", password: "", confirmPassword: "" });
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast.error("As senhas não coincidem");
      return;
    }

    setLoading(true);
    const { data: signUpData, error } = await supabase.auth.signUp({
      email: form.email.toLowerCase(),
      password: form.password,
      options: {
        data: { 
          full_name: form.full_name.toUpperCase(),
          document: form.document.replace(/\D/g, "")
        },
      },
    });

    if (error) {
      setLoading(false);
      toast.error(error.message);
      return;
    }

    if (signUpData.user) {
      await supabase.from("profiles").update({
        full_name: form.full_name.toUpperCase(),
        document: form.document.replace(/\D/g, ""),
        email: form.email.toLowerCase(),
      } as any).eq("user_id", signUpData.user.id);
    }
    
    setLoading(false);
    toast.success("Conta criada! Bem-vindo.");
    await refreshProfile();
    
    if (redirect) {
      navigate(redirect, { replace: true });
    } else {
      navigate("/cliente", { replace: true });
    }
  };

  return (
    <AuthShell theme="customer" title="Criar Conta" subtitle="Cadastre-se para realizar seus pedidos">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="full_name">Seu Nome</Label>
          <Input id="full_name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required className="border-emerald-200" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="document">CPF ou CNPJ</Label>
          <Input 
            id="document" 
            value={formatDoc(form.document)} 
            onChange={(e) => setForm({ ...form, document: e.target.value })} 
            required 
            placeholder="000.000.000-00" 
            className="border-emerald-200"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className="border-emerald-200" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input id="password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} className="border-emerald-200" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirmar Senha</Label>
          <Input id="confirmPassword" type="password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} required minLength={6} className="border-emerald-200" />
        </div>
        <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-11" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />} 
          Criar minha conta
        </Button>
      </form>
      <div className="mt-6 pt-6 border-t border-emerald-100 text-center">
        <p className="text-sm text-muted-foreground">
          Já tem conta? <Link to={redirect ? `/entrar?redirect=${encodeURIComponent(redirect)}` : "/entrar"} className="text-emerald-600 font-bold hover:underline">Entrar</Link>
        </p>
      </div>
    </AuthShell>
  );
};

export default Signup;
