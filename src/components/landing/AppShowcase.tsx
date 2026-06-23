import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, ShoppingBag, Bike, CreditCard, Star } from "lucide-react";
import { cn } from "@/lib/utils";

const slides = [
  {
    id: 1,
    title: "Peça em segundos",
    subtitle: "Cardápio digital completo com fotos, preços e opções de personalização.",
    icon: ShoppingBag,
    color: "from-[var(--hype-green)]/20 to-emerald-500/10",
    accent: "bg-[var(--hype-green)]",
  },
  {
    id: 2,
    title: "Acompanhe em tempo real",
    subtitle: "Do preparo até a entrega, saiba exatamente onde está seu pedido.",
    icon: Bike,
    color: "from-blue-500/20 to-cyan-500/10",
    accent: "bg-blue-500",
  },
  {
    id: 3,
    title: "Pagamento simplificado",
    subtitle: "Pague com Pix, cartão ou dinheiro com total segurança.",
    icon: CreditCard,
    color: "from-amber-500/20 to-orange-500/10",
    accent: "bg-amber-500",
  },
  {
    id: 4,
    title: "As melhores lojas",
    subtitle: "Restaurantes, mercados e farmácias com qualidade verificada.",
    icon: Star,
    color: "from-purple-500/20 to-pink-500/10",
    accent: "bg-purple-500",
  },
];

export const AppShowcase = () => {
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = (index: number, dir: number) => {
    setDirection(dir);
    setCurrent(index);
  };

  const next = () => {
    const nextIndex = (current + 1) % slides.length;
    goTo(nextIndex, 1);
  };

  const prev = () => {
    const prevIndex = (current - 1 + slides.length) % slides.length;
    goTo(prevIndex, -1);
  };

  useEffect(() => {
    intervalRef.current = setInterval(next, 6000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [current]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { prev(); }
    if (e.key === "ArrowRight") { next(); }
  };

  const slideVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? 300 : -300, opacity: 0, scale: 0.92 }),
    center: { x: 0, opacity: 1, scale: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -300 : 300, opacity: 0, scale: 0.92 }),
  };

  const Slide = slides[current];

  return (
    <section className="relative overflow-hidden border-t border-border bg-gradient-to-b from-background to-muted/30 py-16 md:py-24">
      {/* Background decorative blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          animate={{ x: ["-20%", "20%", "-20%"], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-32 left-1/4 h-[500px] w-[500px] rounded-full bg-[var(--hype-green)]/10 blur-[100px]"
        />
        <motion.div
          animate={{ x: ["20%", "-10%", "20%"], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute -bottom-40 right-1/4 h-[400px] w-[400px] rounded-full bg-primary/10 blur-[100px]"
        />
      </div>

      <div className="container relative z-10 mx-auto px-4">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-10 text-center"
        >
          <h2 className="text-3xl font-black uppercase tracking-tight md:text-4xl">
            Por que escolher a{" "}
            <span className="text-[var(--hype-green)]">Hype</span>?
          </h2>
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            Tudo que você precisa em um só lugar, direto no seu celular.
          </p>
        </motion.div>

        {/* Carousel */}
        <div
          className="relative mx-auto max-w-2xl"
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="region"
          aria-roledescription="carousel"
          aria-label="Diferenciais Hype Delivery"
        >
          {/* Slide container */}
          <div className="relative h-[260px] overflow-hidden rounded-2xl md:h-[280px]">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={current}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "spring", stiffness: 280, damping: 26 }}
                className={cn(
                  "absolute inset-0 flex flex-col items-center justify-center gap-6 bg-gradient-to-br p-8 md:p-12",
                  Slide.color,
                )}
              >
                <div className={cn("rounded-2xl p-5 shadow-lg", Slide.accent, "bg-opacity-90")}>
                  <Slide.icon className="h-10 w-10 text-white" />
                </div>
                <div className="text-center">
                  <h3 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">
                    {Slide.title}
                  </h3>
                  <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                    {Slide.subtitle}
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Navigation arrows */}
          <button
            onClick={(e) => { e.stopPropagation(); prev(); }}
            className="absolute left-2 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 shadow-md backdrop-blur transition-all hover:bg-background hover:border-[var(--hype-green)]/30 md:-left-5"
            aria-label="Slide anterior"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); next(); }}
            className="absolute right-2 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 shadow-md backdrop-blur transition-all hover:bg-background hover:border-[var(--hype-green)]/30 md:-right-5"
            aria-label="Próximo slide"
          >
            <ArrowRight className="h-4 w-4" />
          </button>

          {/* Dots */}
          <div className="mt-6 flex items-center justify-center gap-2">
            {slides.map((_, index) => (
              <button
                key={index}
                onClick={() => goTo(index, index > current ? 1 : -1)}
                className={cn(
                  "h-2.5 rounded-full transition-all duration-300",
                  index === current
                    ? "w-8 bg-[var(--hype-green)]"
                    : "w-2.5 bg-muted-foreground/30 hover:bg-muted-foreground/50",
                )}
                aria-label={`Ir para slide ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
