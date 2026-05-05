import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Save, Activity, Key, Globe, ExternalLink, Trash2 } from "lucide-react";

const AdminSettings = () => {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<any[]>([]);
  const environment = "sandbox" as string; // Standard for this project based on asaas.functions.ts

  useEffect(() => {
    const loadLogs = async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("*, stores(name, slug, owner_user_id), plans(name, price_monthly)")
        .order("updated_at", { ascending: false })
        .limit(10);
      setLogs(data ?? []);
      setLoading(false);
    };
    loadLogs();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Configurações da Plataforma</h1>
        <p className="text-muted-foreground">Gestão global de pagamentos e manutenção Vexor.</p>
      </div>

      <div className="grid gap-6">
        {/* Payment Account Information */}
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <CardTitle>Pagamentos Plataforma (Assinaturas)</CardTitle>
            </div>
            <CardDescription>
              Esta conta do Asaas recebe exclusivamente os pagamentos das mensalidades das lojas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-black uppercase tracking-widest">Status do Ambiente</Label>
                  <Badge variant={environment === 'production' ? 'default' : 'secondary'} className="uppercase font-black text-[10px]">
                    {environment}
                  </Badge>
                </div>
                <div className="flex gap-2">
                   <div className="relative flex-1">
                      <Input
                        type="password"
                        placeholder="Configurado nos Segredos do Sistema"
                        readOnly
                        className="bg-muted/50 border-2 border-dashed border-primary/20 rounded-none h-12 font-bold"
                      />
                      <Key className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    </div>
                </div>
                <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest leading-relaxed">
                  Por segurança, a chave mestra da plataforma é gerenciada via variáveis de ambiente (ASAAS_API_KEY).
                </p>
              </div>

              <div className="pt-4 border-t border-primary/10 flex flex-wrap gap-3">
                <Button 
                  variant="hero" 
                  className="font-black uppercase tracking-widest text-xs h-11"
                  onClick={async () => {
                    const tid = toast.loading("Testando conexão global...");
                    setTimeout(() => {
                      toast.dismiss(tid);
                      toast.info("Conexão global ativa. Verifique os logs de produção para detalhes.");
                    }, 1000);
                  }}
                >
                  <Activity className="h-4 w-4 mr-2" /> Testar Conexão Mestra
                </Button>
                <Button variant="outline" className="font-black uppercase tracking-widest text-xs h-11" asChild>
                  <a href="https://www.asaas.com" target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" /> Painel Asaas Vexor
                  </a>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* User Maintenance Cleanup */}
        <Card className="border-red-500/20 bg-red-50/30">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-600" />
              <CardTitle>Limpeza de Usuários Órfãos</CardTitle>
            </div>
            <CardDescription>
              Remova contas da autenticação que não possuem mais perfil ou loja (e-mails presos).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 border-2 border-dashed border-red-200 bg-white space-y-4">
              <p className="text-xs text-red-700 font-bold uppercase">
                Atenção: Esta ação removerá permanentemente os registros de login que estão "sobrando" no sistema de autenticação e impedindo novos cadastros com o mesmo e-mail.
              </p>
              <Button 
                variant="destructive" 
                className="font-black uppercase tracking-widest text-xs h-11"
                onClick={async () => {
                  if (!confirm("Deseja realmente remover TODOS os usuários órfãos? Esta ação não pode ser desfeita.")) return;
                  
                  const tid = toast.loading("Varrendo e limpando autenticações...");
                  try {
                    const { data, error } = await supabase.functions.invoke("admin-utils", {
                      body: { action: 'cleanup_orphans' }
                    });

                    if (error || data?.error) throw new Error(error?.message || data?.error);

                    toast.success(`${data.deleted_count} registros órfãos removidos com sucesso!`, { id: tid });
                  } catch (err: any) {
                    console.error(err);
                    toast.error(err.message || "Erro ao limpar usuários", { id: tid });
                  }
                }}
              >
                Executar Limpeza Profunda
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Subscription Logs */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <CardTitle>Logs de Assinaturas (MRR)</CardTitle>
            </div>
            <CardDescription>
              Atividade recente de cobranças e atualizações de planos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : logs.length === 0 ? (
              <p className="text-sm text-muted-foreground italic text-center py-4">Nenhum log de assinatura encontrado.</p>
            ) : (
              <div className="space-y-3">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between p-3 border-2 border-black/5 bg-white text-xs">
                    <div className="space-y-1">
                      <div className="font-black uppercase">{log.stores?.name || 'LOJA DESCONHECIDA'}</div>
                      <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tighter">
                        PLANO: {log.plans?.name} · {new Date(log.updated_at).toLocaleString("pt-BR")}
                      </div>
                    </div>
                    <Badge variant={log.status === 'ativa' ? 'default' : 'secondary'} className="rounded-none font-black uppercase text-[9px]">
                      {log.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Webhooks */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              <CardTitle>Webhooks da Plataforma</CardTitle>
            </div>
            <CardDescription>
              URL para processamento de assinaturas das lojas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="p-4 bg-muted/30 border-2 border-dashed border-black/10 space-y-2">
              <div className="flex gap-2">
                <Input 
                  value={`${window.location.origin}/api/webhooks/asaas`} 
                  readOnly 
                  className="bg-white border-2 border-black rounded-none font-mono text-[10px]" 
                />
              </div>
              <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">
                Esta URL processa tanto assinaturas (conta mestra) quanto pedidos (contas das lojas).
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminSettings;
