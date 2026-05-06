import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { AuthShell } from "./AuthShell";

const AdminLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data: { user }, error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
      setLoading(false);
      toast.error("Credenciais inválidas");
      return;
    }

    const { data: roleData } = await supabase.from("user_roles" as any).select("role").eq("user_id", user?.id || "").maybeSingle();
    const role = (roleData as any)?.role || "customer";
    
    setLoading(false);
    
    if (role === "super_admin" || user?.email === "jvieira@vexortech.com.br") {
      toast.success("Acesso autorizado!");
      navigate("/admin", { replace: true });
    } else {
      toast.error("Acesso negado. Apenas administradores.");
      await supabase.auth.signOut();
    }
  };

  return (
    <AuthShell theme="admin" title="Terminal Admin" subtitle="Acesso restrito a administradores do sistema">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-zinc-400">E-mail Administrativo</Label>
          <Input 
            id="email" 
            type="email" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            required 
            className="bg-zinc-800 border-zinc-700 text-white focus:border-red-500 focus:ring-red-500"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className="text-zinc-400">Chave de Acesso</Label>
          <Input 
            id="password" 
            type="password" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            required 
            className="bg-zinc-800 border-zinc-700 text-white focus:border-red-500 focus:ring-red-500"
          />
        </div>
        <Button type="submit" className="w-full bg-red-700 hover:bg-red-800 text-white font-black uppercase h-12 shadow-[0_0_15px_rgba(185,28,28,0.3)]" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />} 
          Validar Credenciais
        </Button>
      </form>
    </AuthShell>
  );
};

export default AdminLogin;
