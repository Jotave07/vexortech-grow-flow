import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { BrandMark } from "@/components/BrandMark";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const schema = z.object({
  email: z.string().trim().email("E-mail invalido").max(255),
  password: z.string().min(6, "Minimo 6 caracteres").max(100),
});

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const redirect = new URLSearchParams(location.search).get("redirect");
  const from = (location.state as { from?: string } | null)?.from || redirect || null;
  const safeFrom = from && from.startsWith("/") ? from : null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { data: { user }, error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
    setLoading(true);
    if (error) {
      setLoading(false);
      toast.error(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos" : error.message);
      return;
    }

    // Check role for redirection
    let role = "customer";
    if (user?.email === "jvieira@vexortech.com.br") {
      role = "super_admin";
    } else {
      const { data: roleData } = await supabase.from("user_roles" as any).select("role").eq("user_id", user?.id || "").maybeSingle();
      if ((roleData as any)?.role) {
        role = (roleData as any).role;
      }
    }
    
    setLoading(false);
    toast.success("Bem-vindo!");
    
    if (role === "super_admin") {
      navigate("/admin", { replace: true });
    } else if (role === "store_owner") {
      navigate(safeFrom || "/lojista", { replace: true });
    } else {
      navigate(safeFrom || "/cliente", { replace: true });
    }
  };

  return (
    <div className="auth-shell">
      <BrandMark to="/" className="mb-8" />
      <Card className="auth-card">
        <h1 className="mb-2 text-2xl font-bold">Entrar na sua conta</h1>
        <p className="mb-6 text-sm text-muted-foreground">Acesse sua conta para continuar</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="password">Senha</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="text-right">
            <Link to="/recuperar-senha" className="text-sm text-primary hover:underline">Esqueci minha senha</Link>
          </div>
          <Button type="submit" variant="hero" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Entrar
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Nao tem conta? <Link to={safeFrom ? `/cadastrar?redirect=${encodeURIComponent(safeFrom)}` : "/cadastrar"} className="text-primary hover:underline">Cadastre-se</Link>
        </p>
      </Card>
    </div>
  );
};

export default Login;
