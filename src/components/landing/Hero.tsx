import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, PlayCircle, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { HeroAnimation } from "./HeroAnimation";

export const Hero = () => {
  return (
    <section className="relative min-h-[86svh] overflow-hidden pt-24 text-black md:pt-28">
      <div className="absolute inset-0 bg-gradient-hero" />
      <div className="absolute inset-0 opacity-90 [background:linear-gradient(135deg,transparent_0_18%,hsl(333_100%_50%_/_0.1)_18%_19%,transparent_19%_100%),linear-gradient(90deg,transparent_0_68%,hsl(188_100%_50%_/_0.08)_68%_69%,transparent_69%_100%),linear-gradient(315deg,transparent_0_78%,hsl(17_100%_50%_/_0.1)_78%_79%,transparent_79%_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_62%,hsl(var(--background))_100%)]" />

      <div className="container relative mx-auto px-4 pb-20">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="max-w-3xl"
          >
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="mb-6 inline-flex items-center gap-2 border border-black/10 bg-black/5 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.12em] text-black backdrop-blur"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Operação própria para vender sem intermediários
            </motion.div>

            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="mb-6 text-4xl font-bold leading-[1.05] md:text-6xl lg:text-7xl"
            >
              VexorTech
            </motion.h1>

            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="mb-10 max-w-2xl text-lg leading-relaxed text-black/70 md:text-xl"
            >
              Cardápio online, pedidos, clientes, entregas e relatórios em um painel feito para restaurantes e negócios locais assumirem o controle do delivery.
            </motion.p>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="flex flex-col gap-3 sm:flex-row"
            >
              <Button variant="hero" size="xl" className="group" asChild>
                <Link to="/lojas">
                  Pedir Agora
                  <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
              <Button variant="outline" size="xl" className="border-black/15 bg-black/5 text-black hover:border-primary hover:bg-black/10" asChild>
                <a href="#como-funciona">
                  <PlayCircle className="h-5 w-5" />
                  Ver fluxo
                </a>
              </Button>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.8 }}
              className="mt-12 grid max-w-2xl grid-cols-1 gap-3 text-sm text-black/60 sm:grid-cols-3"
            >
              <span className="border-l border-primary pl-3">Sem comissão por pedido</span>
              <span className="border-l border-primary pl-3">Checkout próprio</span>
              <span className="border-l border-primary pl-3">Pedidos em tempo real</span>
            </motion.div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4, duration: 1, ease: "easeOut" }}
            className="relative hidden lg:block"
          >
            <HeroAnimation />
          </motion.div>
        </div>

        {/* Mobile Animation */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.8 }}
          className="mt-16 block lg:hidden"
        >
          <HeroAnimation />
        </motion.div>
      </div>
    </section>
  );
};
