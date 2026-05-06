import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, ShieldCheck, UserCog } from "lucide-react";
import { toast } from "sonner";

const ROLES: { value: string; label: string }[] = [
  { value: "store_owner", label: "Dono" },
  { value: "store_manager", label: "Gerente" },
  { value: "store_attendant", label: "Atendente" },
];

const Users = () => {
  const { store } = useOutletContext<{ store: any }>();
  const { user } = useAuth();
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!store?.id) return;
    setLoading(true);
    // members are profiles linked to this store
    const { data: profiles } = await supabase.from("profiles").select("*").eq("store_id", store.id);
    if (!profiles?.length) { setMembers([]); setLoading(false); return; }
    const userIds = profiles.map((p) => p.user_id);
    const { data: roles } = await supabase.from("user_roles").select("*").in("user_id", userIds);
    const merged = profiles.map((p) => ({
      ...p,
      roles: (roles ?? []).filter((r) => r.user_id === p.user_id).map((r) => r.role),
    }));
    setMembers(merged);
    setLoading(false);
  }, [store?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (member: any) => {
    if (member.user_id === store.owner_user_id) return toast.error("Não é possível remover o dono");
    if (member.user_id === user?.id) return toast.error("Você não pode remover a si mesmo aqui");
    if (!confirm(`Remover ${member.full_name ?? member.email}?`)) return;
    await supabase.from("profiles").update({ store_id: null }).eq("id", member.id);
    await supabase.from("user_roles").delete().eq("user_id", member.user_id).eq("store_id", store.id);
    toast.success("Removido");
    load();
  };

  if (loading) return <div className="py-20 text-center"><Loader2 className="h-8 w-8 animate-spin inline text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Usuários</h1>
        <p className="text-muted-foreground">Equipe da loja ({members.length}).</p>
      </div>

      <Card className="p-5 text-sm space-y-2 bg-primary/5 border-primary/20">
        <div className="flex items-center gap-2 font-medium"><UserCog className="h-4 w-4 text-primary" /> Como adicionar membros</div>
        <p className="text-muted-foreground">
          Por enquanto, novos membros se cadastram em <span className="font-mono text-foreground">/cadastrar</span>, fazem login,
          e o dono pode vincular o usuário à loja. (Convite por e-mail será adicionado em breve.)
        </p>
      </Card>

      <div className="space-y-3">
        {members.map((m) => {
          const isOwner = m.user_id === store.owner_user_id;
          const isMe = m.user_id === user?.id;
          return (
            <Card key={m.id} className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                {(m.full_name ?? m.email ?? "?").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium flex items-center gap-2">
                  {m.full_name ?? "Sem nome"}
                  {isOwner && <Badge><ShieldCheck className="h-3 w-3" /> Dono</Badge>}
                  {isMe && <Badge variant="secondary">Você</Badge>}
                </div>
                <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                <div className="flex gap-1 mt-1">
                  {m.roles.length === 0 && <Badge variant="outline" className="text-xs">Sem papel</Badge>}
                  {m.roles.map((r: string) => (
                    <Badge key={r} variant="outline" className="text-xs">{ROLES.find((x) => x.value === r)?.label ?? r}</Badge>
                  ))}
                </div>
              </div>
              {!isOwner && (
                <Button variant="ghost" size="icon" onClick={() => remove(m)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};
export default Users;
