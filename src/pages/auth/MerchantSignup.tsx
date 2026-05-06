import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Rocket } from "lucide-react";
import { AuthShell } from "./AuthShell";
import { formatDoc } from "@/lib/format";

const MerchantSignup = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: "", document: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      // The trigger handle_new_user should create the customer role by default.
      // We need to upgrade it to store_owner eventually in onboarding, 
      // but for now, we just ensure they can access the onboarding.
      toast.success("Conta criada! Vamos configurar sua loja.");
      navigate("/onboarding", { replace: true });
    }
  };

  return (
    <AuthShell theme="merchant" title="Crie sua Loja" subtitle="Junte-se a milhares de lojistas no HYPE">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="full_name">Seu Nome Completo</Label>
          <Input 
            id="full_name" 
            value={form.full_name} 
            onChange={(e) => setForm({ ...form, full_name: e.target.value })} 
            required 
            className="border-orange-200"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="document">CPF ou CNPJ</Label>
          <Input 
            id="document" 
            value={formatDoc(form.document)} 
            onChange={(e) => setForm({ ...form, document: e.target.value })} 
            required 
            placeholder="00.000.000/0001-00"
            className="border-orange-200"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">E-mail Profissional</Label>
          <Input 
            id="email" 
            type="email" 
            value={form.email} 
            onChange={(e) => setForm({ ...form, email: e.target.value })} 
            required 
            className="border-orange-200"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input 
            id="password" 
            type="password" 
            value={form.password} 
            onChange={(e) => setForm({ ...form, password: e.target.value })} 
            required 
            minLength={6}
            className="border-orange-200"
          />
        </div>
        <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold h-11 shadow-lg" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Rocket className="h-4 w-4 mr-2" />} 
          Criar minha conta de lojista
        </Button>
      </form>
      <div className="mt-6 pt-6 border-t border-orange-100 text-center">
        <p className="text-sm text-muted-foreground">
          Já tem conta? <Link to="/lojista/entrar" className="text-orange-600 font-bold hover:underline">Entrar no painel</Link>
        </p>
      </div>
    </AuthShell>
  );
};

export default MerchantSignup;
