import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

export const CTA = () => {
  return (
    <section className="relative overflow-hidden bg-[var(--hype-dark)] py-20 text-white md:py-24">
      <motion.div 
        animate={{ 
          opacity: [0.08, 0.18, 0.08],
          x: ["-8%", "8%", "-8%"]
        }}
        transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
        className="absolute inset-x-0 top-0 h-1 bg-primary"
      />
      
      <div className="container relative z-10 mx-auto flex flex-col gap-8 px-4 md:flex-row md:items-center md:justify-between">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-2xl"
        >
          <p className="mb-3 text-sm font-black uppercase tracking-widest text-primary">Operacao separada por dominio</p>
          <h2 className="text-3xl font-bold md:text-5xl">parceiros.vexortech.com.br para lojas parceiras. vexortech.com.br para o delivery completo.</h2>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="shrink-0 md:w-auto"
        >
          <Button variant="secondary" size="xl" className="group w-full md:w-auto" asChild>
            <Link to="/cadastrar-loja">
              Criar loja parceira
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
        </motion.div>
      </div>
    </section>
  );
};
