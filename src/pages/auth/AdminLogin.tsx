import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { backend } from "@/integrations/backend/client";
import { getPrimaryRole } from "@/lib/auth/roles";
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
    const { data: { user }, error } = await backend.auth.signInWithPassword({ email: email.trim(), password });
    
    if (error) {
      setLoading(false);
      toast.error("Credenciais inválidas");
      return;
    }

    const role = await getPrimaryRole(user?.id || "");
    
    setLoading(false);
    
    if (role === "super_admin") {
      toast.success("Acesso autorizado!");
      navigate("/admin", { replace: true });
    } else {
      toast.error("Acesso negado. Apenas administradores.");
      await backend.auth.signOut();
    }
  };

  return (
    <AuthShell theme="admin" title="Terminal Admin" subtitle="Acesso restrito a administradores do sistema">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail Administrativo</Label>
          <Input 
            id="email" 
            type="email" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            required 
            className="border-border focus:border-primary focus:ring-primary"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Chave de Acesso</Label>
          <Input 
            id="password" 
            type="password" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            required 
            className="border-border focus:border-primary focus:ring-primary"
          />
        </div>
        <Button type="submit" className="h-12 w-full font-black uppercase" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />} 
          Validar Credenciais
        </Button>
      </form>
    </AuthShell>
  );
};

export default AdminLogin;
