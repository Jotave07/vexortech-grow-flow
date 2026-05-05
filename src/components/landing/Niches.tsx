import { Beef, Cake, Croissant, IceCream, Pizza, Salad, Sandwich, ShoppingBasket, UtensilsCrossed, Wine } from "lucide-react";
import { motion, Variants } from "framer-motion";

const niches = [
  { icon: UtensilsCrossed, name: "Restaurantes" },
  { icon: Beef, name: "Hamburguerias" },
  { icon: Pizza, name: "Pizzarias" },
  { icon: IceCream, name: "Açaíterias" },
  { icon: Croissant, name: "Padarias" },
  { icon: ShoppingBasket, name: "Mercados" },
  { icon: Sandwich, name: "Lanchonetes" },
  { icon: Cake, name: "Docerias" },
  { icon: Salad, name: "Marmitarias" },
  { icon: Wine, name: "Petiscos e bebidas" },
];

const containerVariants: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemVariants: Variants = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { 
    opacity: 1, 
    scale: 1,
    transition: { duration: 0.3, ease: "easeOut" }
  },
};

export const Niches = () => {
  return (
    <section id="nichos" className="py-20 md:py-24">
      <div className="container mx-auto px-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-12 max-w-2xl"
        >
          <p className="mb-3 text-sm font-semibold uppercase text-primary">Segmentos</p>
          <h2 className="mb-4 text-3xl font-bold md:text-5xl">Feito para negócios que precisam vender com agilidade.</h2>
          <p className="text-lg text-muted-foreground">A estrutura serve para estabelecimentos com retirada, entrega própria ou operação híbrida.</p>
        </motion.div>

        <motion.div 
          variants={containerVariants}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: "-50px" }}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5"
        >
          {niches.map((niche) => (
            <motion.div 
              key={niche.name} 
              variants={itemVariants}
              whileHover={{ scale: 1.05, borderColor: "hsl(var(--primary) / 0.45)" }}
              className="group flex min-h-32 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-5 text-center shadow-card transition-colors"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-md bg-secondary text-primary transition-smooth group-hover:bg-primary group-hover:text-primary-foreground">
                <niche.icon className="h-5 w-5" />
              </div>
              <span className="text-sm font-medium">{niche.name}</span>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

