import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, LogIn } from "lucide-react";
import { getUserRoles } from "@/lib/auth/roles";
import { AuthShell } from "./AuthShell";

const Login = () => {
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
    const { data: { user }, error } = await supabase.auth.signInWithPassword({ 
      email: email.trim(), 
      password: password 
    });
    
    if (error) {
      setLoading(false);
      toast.error(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos" : error.message);
      return;
    }

    const roles = await getUserRoles(user?.id || "");
    let role = "customer";
    if (roles.includes("super_admin")) role = "super_admin";
    else if (roles.includes("store_owner")) role = "store_owner";
    
    setLoading(false);
    toast.success("Bem-vindo!");
    
    if (role === "super_admin") {
      navigate("/admin", { replace: true });
    } else if (from) {
      // Se veio de um redirecionamento (ex: checkout), segue para lá independente do papel
      navigate(from, { replace: true });
    } else if (role === "store_owner") {
      // Se é lojista e não tem redirecionamento, vai para o painel de lojista
      navigate("/lojista", { replace: true });
    } else {
      // Por padrão vai para a lista de lojas para clientes
      navigate("/", { replace: true });
    }
  };

  return (
    <AuthShell theme="customer" title="Entrar" subtitle="Acesse sua conta de cliente para pedir">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input 
            id="email" 
            type="email" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            required 
            className="border-emerald-200 focus:border-emerald-500"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input 
            id="password" 
            type="password" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            required 
            className="border-emerald-200 focus:border-emerald-500"
          />
        </div>
        <div className="text-right">
          <Link to="/recuperar-senha" title="Recuperar Senha" className="text-sm text-emerald-600 hover:text-emerald-700 font-semibold">Esqueci minha senha</Link>
        </div>
        <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-11" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LogIn className="h-4 w-4 mr-2" />} 
          Entrar na Conta
        </Button>
      </form>
      <div className="mt-6 pt-6 border-t border-emerald-100 text-center">
        <p className="text-sm text-muted-foreground">
          Ainda não tem conta? <Link to={from ? `/cadastrar?redirect=${encodeURIComponent(from)}` : "/cadastrar"} className="text-emerald-600 font-bold hover:underline">Cadastre-se</Link>
        </p>
      </div>
    </AuthShell>
  );
};

export default Login;
