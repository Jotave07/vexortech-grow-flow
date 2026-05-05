import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, PlayCircle, ShieldCheck } from "lucide-react";

export const Hero = () => {
  return (
    <section className="relative min-h-[86svh] overflow-hidden pt-24 text-white md:pt-28">
      <div className="absolute inset-0 bg-gradient-hero" />
      <div className="absolute inset-0 opacity-90 [background:linear-gradient(135deg,transparent_0_18%,hsl(333_100%_50%_/_0.1)_18%_19%,transparent_19%_100%),linear-gradient(90deg,transparent_0_68%,hsl(188_100%_50%_/_0.08)_68%_69%,transparent_69%_100%),linear-gradient(315deg,transparent_0_78%,hsl(17_100%_50%_/_0.1)_78%_79%,transparent_79%_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_62%,hsl(var(--background))_100%)]" />

      <div className="container relative mx-auto flex min-h-[68svh] items-center px-4 pb-20">
        <div className="max-w-3xl animate-fade-up">
          <div className="mb-6 inline-flex items-center gap-2 border border-white/20 bg-black/30 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.12em] text-white backdrop-blur">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Operacao propria para vender sem intermediarios
          </div>

          <h1 className="mb-6 max-w-3xl text-4xl font-bold leading-[1.05] md:text-6xl lg:text-7xl">
            VexorTech Delivery
          </h1>

          <p className="mb-10 max-w-2xl text-lg leading-relaxed text-white/78 md:text-xl">
            Cardapio online, pedidos, clientes, entregas e relatorios em um painel feito para restaurantes e negocios locais assumirem o controle do delivery.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button variant="hero" size="xl" className="group" asChild>
              <Link to="/cadastrar">
                Criar minha loja
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button variant="outline" size="xl" className="border-white/25 bg-black/30 text-white hover:border-primary hover:bg-white/10" asChild>
              <a href="#como-funciona">
                <PlayCircle className="h-5 w-5" />
                Ver fluxo
              </a>
            </Button>
          </div>

          <div className="mt-12 grid max-w-2xl grid-cols-1 gap-3 text-sm text-white/76 sm:grid-cols-3">
            <span className="border-l border-primary pl-3">Sem comissao por pedido</span>
            <span className="border-l border-primary pl-3">Checkout proprio</span>
            <span className="border-l border-primary pl-3">Pedidos em tempo real</span>
          </div>
        </div>
      </div>
    </section>
  );
};
