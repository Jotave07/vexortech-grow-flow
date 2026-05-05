import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

export const CTA = () => {
  return (
    <section className="relative overflow-hidden bg-primary py-20 text-primary-foreground md:py-24">
      {/* Background decoration */}
      <motion.div 
        animate={{ 
          scale: [1, 1.1, 1],
          opacity: [0.1, 0.2, 0.1],
          rotate: [0, 90, 0]
        }}
        transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
        className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-white/20 blur-3xl"
      />
      
      <div className="container relative z-10 mx-auto flex flex-col gap-8 px-4 md:flex-row md:items-center md:justify-between">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-2xl"
        >
          <p className="mb-3 text-sm font-semibold uppercase text-primary-foreground/70">Pronto para operar</p>
          <h2 className="text-3xl font-bold md:text-5xl">Venda no seu link, acompanhe no seu painel, mantenha sua margem.</h2>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="shrink-0 md:w-auto"
        >
          <Button variant="secondary" size="xl" className="group w-full md:w-auto" asChild>
            <Link to="/cadastrar">
              Criar minha loja
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
        </motion.div>
      </div>
    </section>
  );
};
