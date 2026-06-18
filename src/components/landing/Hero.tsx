import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, PlayCircle, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { buildDeliveryUrl } from "@/lib/domains";

export const Hero = () => {
  return (
    <section className="relative min-h-[86svh] overflow-hidden bg-white pt-24 text-black md:pt-28">
      <div className="absolute inset-0 bg-gradient-hero" />
      <div className="absolute bottom-0 right-0 top-16 hidden w-[54vw] bg-black lg:block" />
      <img
        src="/brand/hype-delivery-brand.png"
        alt="Hype Delivery"
        loading="eager"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
        className="pointer-events-none absolute bottom-0 right-0 hidden h-[calc(100%-4rem)] w-[54vw] object-cover object-center lg:block"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,#ffffff_0%,#ffffff_46%,rgba(255,255,255,0.72)_58%,rgba(255,255,255,0)_82%)]" />
      <div className="absolute inset-x-0 bottom-0 h-28 bg-[linear-gradient(180deg,transparent_0%,var(--background)_100%)]" />

      <div className="container relative mx-auto px-4 pb-20">
        <div className="grid items-center gap-12 lg:min-h-[calc(86svh-7rem)] lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
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
              className="mb-6 inline-flex items-center gap-2 rounded-none border border-primary/45 bg-primary/15 px-4 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-black backdrop-blur"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Portal exclusivo para lojas parceiras
            </motion.div>

            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="font-display mb-6 text-4xl font-black leading-[1.02] md:text-6xl lg:text-7xl"
            >
              Delivery HYPE para lojas que querem vender direto.
            </motion.h1>

            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="mb-10 max-w-2xl text-lg leading-relaxed text-black/70 md:text-xl"
            >
              O parceiros.hypedelivery.com.br e exclusivo para lojas parceiras criarem, configurarem e administrarem suas operacoes. O hypedelivery.com.br e a area de delivery, com vitrine, cardapio, checkout, pedidos, pagamentos, entrega e acompanhamento funcionando de ponta a ponta.
            </motion.p>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="flex flex-col gap-3 sm:flex-row"
            >
              <Button variant="hero" size="xl" className="group" asChild>
                <Link to="/cadastrar-loja">
                  Cadastrar loja parceira
                  <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
              <Button variant="outline" size="xl" className="bg-white/80" asChild>
                <a href={buildDeliveryUrl("/")}>
                  <PlayCircle className="h-5 w-5" />
                  Ver delivery
                </a>
              </Button>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.8 }}
              className="mt-12 grid max-w-2xl grid-cols-1 gap-3 text-sm text-black/60 sm:grid-cols-3"
            >
              <span className="border-l-4 border-primary pl-3">Parceiros em ambiente exclusivo</span>
              <span className="border-l-4 border-primary pl-3">Delivery em hypedelivery.com.br</span>
              <span className="border-l-4 border-primary pl-3">Fluxo revisado de ponta a ponta</span>
            </motion.div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4, duration: 1, ease: "easeOut" }}
            className="relative hidden lg:block"
          >
            <div className="h-[34rem]" />
          </motion.div>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.8 }}
          className="relative mt-10 block overflow-hidden rounded-none bg-black lg:hidden"
        >
          <img src="/brand/hype-delivery-brand.png" alt="Hype Delivery" loading="eager" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="h-full w-full object-cover" />
        </motion.div>
      </div>
    </section>
  );
};
