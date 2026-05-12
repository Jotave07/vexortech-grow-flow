import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, AlertCircle, Clock } from "lucide-react";
import { formatBRL } from "@/lib/format";

const POLL_MS = 2500;
const MAX_POLLS = 24; // ~60s

const PaymentSuccess = () => {
  const { token } = useParams<{ token: string }>();
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const [order, setOrder] = useState<any>(null);
  const navigate = useNavigate();
  const [polls, setPolls] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let attempts = 0;

    const tick = async () => {
      attempts += 1;
      const { data } = await supabase.rpc("get_public_order", { _token: token });
      const o = data?.[0] ?? null;
      if (cancelled) return;
      setOrder(o);
      setLoading(false);
      setPolls(attempts);
      if (o?.payment_status === "pago" || o?.payment_status === "falhou" || o?.payment_status === "cancelado" || o?.payment_status === "expirado") return;
      if (attempts >= MAX_POLLS) return;
      setTimeout(tick, POLL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-muted-foreground">Pedido não encontrado.</p>
      </div>
    );
  }

  const paid = order.payment_status === "pago";
  const failed = order.payment_status === "falhou" || order.payment_status === "cancelado" || order.payment_status === "expirado";
  const pending = !paid && !failed;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-6 text-center space-y-4">
        {paid && (
          <>
            <CheckCircle2 className="h-14 w-14 text-green-600 mx-auto" />
            <h1 className="text-xl font-bold">Pagamento confirmado!</h1>
            <p className="text-sm text-muted-foreground">
              Pedido <strong>#{order.order_number}</strong> recebido pela loja.
            </p>
          </>
        )}
        {pending && (
          <>
            <Clock className="h-14 w-14 text-primary mx-auto animate-pulse" />
            <h1 className="text-xl font-bold">Confirmando pagamento…</h1>
            <p className="text-sm text-muted-foreground">
              Aguardando a confirmação do pagamento. Isso costuma levar alguns segundos.
            </p>
            {polls >= MAX_POLLS && (
              <p className="text-xs text-muted-foreground">
                Ainda não recebemos a confirmação automática. Você pode acompanhar abaixo — o status será atualizado assim que o pagamento for detectado.
              </p>
            )}
          </>
        )}
        {failed && (
          <>
            <AlertCircle className="h-14 w-14 text-destructive mx-auto" />
            <h1 className="text-xl font-bold">Pagamento não confirmado</h1>
            <p className="text-sm text-muted-foreground">
              Nenhum valor foi cobrado. Você pode tentar novamente ou escolher outro método.
            </p>
          </>
        )}

        <div className="border-t pt-3 text-sm">
          <div className="flex justify-between"><span>Total</span><strong className="text-primary">{formatBRL(order.total)}</strong></div>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <Button asChild variant="hero" className="w-full">
            <Link to={`/pedido/${token}`}>Acompanhar pedido</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default PaymentSuccess;
