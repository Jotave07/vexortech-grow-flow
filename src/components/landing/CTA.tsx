import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export const CTA = () => {
  return (
    <section className="bg-primary py-20 text-primary-foreground md:py-24">
      <div className="container mx-auto flex flex-col gap-8 px-4 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <p className="mb-3 text-sm font-semibold uppercase text-primary-foreground/70">Pronto para operar</p>
          <h2 className="text-3xl font-bold md:text-5xl">Venda no seu link, acompanhe no seu painel, mantenha sua margem.</h2>
        </div>
        <Button variant="secondary" size="xl" className="w-full shrink-0 md:w-auto" asChild>
          <Link to="/cadastrar">
            Criar minha loja
            <ArrowRight className="h-5 w-5" />
          </Link>
        </Button>
      </div>
    </section>
  );
};
