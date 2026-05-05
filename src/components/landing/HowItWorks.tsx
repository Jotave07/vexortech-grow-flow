import { motion, Variants } from "framer-motion";

const steps = [
  { n: "01", t: "Configure a loja", d: "Cadastro, horários, pagamentos, entrega, retirada e identidade visual." },
  { n: "02", t: "Monte o cardápio", d: "Categorias, produtos, fotos, preços promocionais e adicionais." },
  { n: "03", t: "Venda no link público", d: "O cliente escolhe itens, informa dados, aplica cupom e confirma o pedido." },
  { n: "04", t: "Acompanhe no painel", d: "Sua equipe atualiza status e conversa com o cliente quando necessário." },
  { n: "05", t: "Meça e ajuste", d: "Relatórios, clientes e produtos mais vendidos ajudam a melhorar a operação." },
];

const containerVariants: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
    },
  },
};

const itemVariants: Variants = {
  initial: { opacity: 0, x: -20 },
  animate: { 
    opacity: 1, 
    x: 0,
    transition: { duration: 0.5, ease: "easeOut" }
  },
};

export const HowItWorks = () => {
  return (
    <section id="como-funciona" className="section-band py-20 md:py-24">
      <div className="container mx-auto px-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-12 max-w-2xl"
        >
          <p className="mb-3 text-sm font-semibold uppercase text-primary">Fluxo completo</p>
          <h2 className="mb-4 text-3xl font-bold md:text-5xl">Da vitrine ao pedido entregue sem trocar de ferramenta.</h2>
          <p className="text-lg text-muted-foreground">A experiência cobre cliente, loja e administração sem esconder etapas importantes.</p>
        </motion.div>

        <motion.div 
          variants={containerVariants}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: "-50px" }}
          className="grid gap-3 lg:grid-cols-5"
        >
          {steps.map((step) => (
            <motion.div 
              key={step.n} 
              variants={itemVariants}
              whileHover={{ scale: 1.02 }}
              className="rounded-lg border border-border bg-card p-5 shadow-card transition-all hover:border-primary/30"
            >
              <div className="mb-5 text-sm font-semibold text-accent">{step.n}</div>
              <h3 className="mb-2 text-base font-semibold">{step.t}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.d}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

