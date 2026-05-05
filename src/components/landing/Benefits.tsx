import { Ban, Bell, Link2, MapPin, MessageCircle, Tag, Users } from "lucide-react";
import { motion } from "framer-motion";

const benefits = [
  { icon: Ban, title: "Margem preservada", desc: "Receba o valor dos pedidos sem taxa por venda corroendo o resultado." },
  { icon: Link2, title: "Link de loja", desc: "Uma vitrine pública para divulgar em redes sociais, WhatsApp, Google e materiais físicos." },
  { icon: Bell, title: "Fila em tempo real", desc: "Pedidos entram no painel com status, histórico e ação rápida para a equipe." },
  { icon: MapPin, title: "Entrega por região", desc: "Defina bairros, taxas, mínimo e tempo estimado de forma simples." },
  { icon: Tag, title: "Cupons controlados", desc: "Crie descontos com validade, limite de uso e pedido mínimo." },
  { icon: Users, title: "Base de clientes", desc: "Acompanhe histórico, ticket médio e dados úteis para relacionamento." },
  { icon: MessageCircle, title: "Contato direto", desc: "Leve clientes para WhatsApp quando fizer sentido, sem perder o registro do pedido." },
];

const containerVariants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.5, ease: "easeOut" }
  },
};

export const Benefits = () => {
  return (
    <section id="beneficios" className="py-20 md:py-24">
      <div className="container mx-auto px-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-12 max-w-2xl"
        >
          <p className="mb-3 text-sm font-semibold uppercase text-primary">Controle operacional</p>
          <h2 className="mb-4 text-3xl font-bold md:text-5xl">O essencial do delivery em um sistema sob sua marca.</h2>
          <p className="text-lg text-muted-foreground">Menos ruído, mais clareza para aceitar pedidos, organizar produtos e entender vendas.</p>
        </motion.div>

        <motion.div 
          variants={containerVariants}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: "-100px" }}
          className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        >
          {benefits.map((benefit) => (
            <motion.div 
              key={benefit.title} 
              variants={itemVariants}
              whileHover={{ y: -5 }}
              className="group vexor-panel border border-border bg-card p-6 shadow-card transition-smooth hover:border-primary/45 hover:shadow-elegant"
            >
              <div className="mb-5 inline-flex h-11 w-11 items-center justify-center border border-primary/35 bg-primary/10 text-primary transition-smooth group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">
                <benefit.icon className="h-5 w-5" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">{benefit.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{benefit.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};
