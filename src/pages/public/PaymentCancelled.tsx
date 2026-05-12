import { Link, useParams, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { XCircle } from "lucide-react";

const PaymentCancelled = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-6 text-center space-y-4">
        <XCircle className="h-14 w-14 text-destructive mx-auto" />
        <h1 className="text-xl font-bold">Pagamento cancelado</h1>
        <p className="text-sm text-muted-foreground">
          Você cancelou o checkout. Nenhum valor foi cobrado e o pedido ficou aguardando pagamento.
        </p>
        <div className="flex flex-col gap-2">
          <Button asChild variant="hero">
            <Link to={`/pedido/${token}`}>Ver pedido</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default PaymentCancelled;
