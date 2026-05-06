import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Store } from "lucide-react";
import { AuthShell } from "./AuthShell";

const MerchantLogin = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const redirect = new URLSearchParams(location.search).get("redirect");
  const from = (location.state as { from?: string } | null)?.from || redirect || null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data: { user }, error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
      setLoading(false);
      toast.error(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos" : error.message);
      return;
    }

    const { data: roleData } = await supabase.from("user_roles" as any).select("role").eq("user_id", user?.id || "").maybeSingle();
    const role = (roleData as any)?.role || "customer";
    
    setLoading(false);
    
    if (role === "store_owner" || role === "super_admin") {
      toast.success("Bem-vindo ao seu painel!");
      navigate(from || "/lojista", { replace: true });
    } else {
      toast.error("Esta conta não tem permissão de lojista.");
      await supabase.auth.signOut();
    }
  };

  return (
    <AuthShell theme="merchant" title="Acesso do Lojista" subtitle="Gerencie suas vendas e produtos">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail Corporativo</Label>
          <Input 
            id="email" 
            type="email" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            required 
            className="border-orange-200 focus:border-orange-500 focus:ring-orange-500"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha de Acesso</Label>
          <Input 
            id="password" 
            type="password" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            required 
            className="border-orange-200 focus:border-orange-500 focus:ring-orange-500"
          />
        </div>
        <div className="text-right">
          <Link to="/recuperar-senha" title="Recuperar Senha" className="text-sm text-orange-600 hover:text-orange-700 font-semibold">Esqueci minha senha</Link>
        </div>
        <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold h-11" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Store className="h-4 w-4 mr-2" />} 
          Entrar no Painel
        </Button>
      </form>
      <div className="mt-6 pt-6 border-t border-orange-100 text-center">
        <p className="text-sm text-muted-foreground">
          Ainda não tem uma loja? <Link to="/cadastrar-loja" className="text-orange-600 font-bold hover:underline">Comece agora</Link>
        </p>
      </div>
    </AuthShell>
  );
};

export default MerchantLogin;
