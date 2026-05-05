import { motion, useReducedMotion } from "framer-motion";
import { Bike, CheckCircle2, Package, CreditCard, Clock, MapPin } from "lucide-react";

export const HeroAnimation = () => {
  const shouldReduceMotion = useReducedMotion();

  const containerVariants = {
    initial: { opacity: 0 },
    animate: {
      opacity: 1,
      transition: {
        staggerChildren: 0.8,
        delayChildren: 0.5,
      },
    },
  };

  const itemVariants = {
    initial: { opacity: 0, scale: 0.8, y: 10 },
    animate: { 
      opacity: 1, 
      scale: 1, 
      y: 0,
      transition: { type: "spring", stiffness: 260, damping: 20 }
    },
  };

  const lineVariants = {
    initial: { scaleX: 0, originX: 0 },
    animate: { 
      scaleX: 1,
      transition: { duration: 0.8, ease: "easeInOut" }
    }
  };

  if (shouldReduceMotion) {
    return (
      <div className="flex flex-col items-center gap-6 p-8 opacity-80">
        <div className="flex gap-4">
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-full bg-primary/20 p-3"><Package className="h-6 w-6 text-primary" /></div>
            <span className="text-[10px] font-bold uppercase text-white/60">Pedido</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-full bg-primary/20 p-3"><CreditCard className="h-6 w-6 text-primary" /></div>
            <span className="text-[10px] font-bold uppercase text-white/60">Pagamento</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-full bg-primary p-3"><Bike className="h-6 w-6 text-white" /></div>
            <span className="text-[10px] font-bold uppercase text-primary">Entrega</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/40 p-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            <span className="text-sm font-medium text-white">Seu pedido está a caminho</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[350px] w-full items-center justify-center py-10">
      {/* Background Glow */}
      <div className="absolute inset-0 z-0">
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3]
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-[80px]" 
        />
      </div>

      <motion.div 
        variants={containerVariants}
        initial="initial"
        animate="animate"
        className="relative z-10 flex flex-col items-center gap-12"
      >
        {/* Step Icons Row */}
        <div className="relative flex items-center gap-8 md:gap-16">
          {/* Progress Lines */}
          <div className="absolute left-0 top-1/2 z-0 h-[2px] w-full -translate-y-1/2 bg-white/5" />
          
          {/* Step 1: Order */}
          <div className="relative flex flex-col items-center gap-3">
            <motion.div variants={itemVariants} className="group relative z-10">
              <div className="rounded-full border border-white/10 bg-black/40 p-4 backdrop-blur transition-colors group-hover:border-primary/50">
                <Package className="h-7 w-7 text-primary" />
              </div>
              <motion.div 
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" 
              />
            </motion.div>
            <motion.span variants={itemVariants} className="text-[10px] font-black uppercase tracking-widest text-white/50">Recebido</motion.span>
          </div>

          {/* Line 1 */}
          <motion.div variants={lineVariants} className="absolute left-[56px] top-[26px] z-0 h-[2px] w-[32px] bg-primary/60 md:w-[64px]" />

          {/* Step 2: Payment */}
          <div className="relative flex flex-col items-center gap-3">
            <motion.div variants={itemVariants} className="group relative z-10">
              <div className="rounded-full border border-white/10 bg-black/40 p-4 backdrop-blur transition-colors group-hover:border-primary/50">
                <CreditCard className="h-7 w-7 text-primary" />
              </div>
              <motion.div 
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 1.6, type: "spring" }}
                className="absolute -bottom-1 -right-1 rounded-full bg-black"
              >
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              </motion.div>
            </motion.div>
            <motion.span variants={itemVariants} className="text-[10px] font-black uppercase tracking-widest text-white/50">Pago</motion.span>
          </div>

          {/* Line 2 */}
          <motion.div 
            initial={{ scaleX: 0, originX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 2.1, duration: 0.8 }}
            className="absolute left-[144px] top-[26px] z-0 h-[2px] w-[32px] bg-primary/60 md:left-[210px] md:w-[64px]" 
          />

          {/* Step 3: Preparation */}
          <div className="relative flex flex-col items-center gap-3">
            <motion.div variants={itemVariants} className="group relative z-10">
              <div className="rounded-full border border-white/10 bg-black/40 p-4 backdrop-blur transition-colors group-hover:border-primary/50">
                <Clock className="h-7 w-7 text-primary" />
              </div>
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 rounded-full border-2 border-primary/20 border-t-primary" 
              />
            </motion.div>
            <motion.span variants={itemVariants} className="text-[10px] font-black uppercase tracking-widest text-white/50">Preparo</motion.span>
          </div>
        </div>

        {/* Big Delivery Card */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 3, type: "spring", damping: 15 }}
          className="relative w-full max-w-[280px]"
        >
          <div className="vexor-panel overflow-hidden border border-white/15 bg-black/60 p-5 shadow-2xl backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                  <Bike className="h-5 w-5 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-black uppercase tracking-tighter text-white">Status da Entrega</span>
                  <span className="text-[10px] text-white/40">Pedido #2492</span>
                </div>
              </div>
              <Badge className="bg-primary/20 text-[10px] font-bold text-primary">Em Rota</Badge>
            </div>

            <div className="space-y-4">
              <div className="relative flex items-start gap-3">
                <div className="mt-1 flex flex-col items-center">
                  <div className="h-2 w-2 rounded-full bg-primary" />
                  <div className="h-10 w-[1px] border-l border-dashed border-white/20" />
                  <div className="h-2 w-2 rounded-full border border-white/40" />
                </div>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold text-white">Restaurante Vexor</span>
                    <span className="text-[10px] text-white/50">Saiu do estabelecimento às 19:42</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold text-white/40">Seu Endereço</span>
                    <span className="text-[10px] text-white/30">Chegada prevista em 12 min</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Moving Scooter Route Visual */}
            <div className="mt-6 relative h-10 w-full overflow-hidden rounded-lg bg-white/5">
              <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-white/10" />
              <motion.div 
                animate={{ 
                  x: ["0%", "85%", "0%"]
                }}
                transition={{ 
                  duration: 8, 
                  repeat: Infinity, 
                  ease: "easeInOut"
                }}
                className="absolute top-1/2 -mt-3 flex items-center"
              >
                <div className="relative">
                  <Bike className="h-6 w-6 text-primary" />
                  <motion.div 
                    animate={{ opacity: [0, 1, 0], scale: [0.5, 1.5, 0.5] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="absolute -left-1 -top-1 h-8 w-8 rounded-full bg-primary/20" 
                  />
                </div>
                {/* Visual trail */}
                <div className="h-4 w-12 bg-gradient-to-r from-primary/0 to-primary/20" />
              </motion.div>
              
              <div className="absolute right-4 top-1/2 -mt-2">
                <MapPin className="h-4 w-4 text-emerald-500" />
              </div>
            </div>
          </div>

          {/* Notification Pop-up */}
          <motion.div 
            initial={{ scale: 0, opacity: 0, x: 20, y: -20 }}
            animate={{ scale: 1, opacity: 1, x: 40, y: -10 }}
            transition={{ delay: 5, type: "spring", stiffness: 200 }}
            className="absolute -right-4 -top-8 z-20 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-black/80 px-3 py-2 shadow-xl backdrop-blur md:-right-8"
          >
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500">
              <CheckCircle2 className="h-3 w-3 text-black" />
            </div>
            <span className="whitespace-nowrap text-[10px] font-black uppercase tracking-widest text-emerald-500">Pedido Entregue!</span>
          </motion.div>
        </motion.div>

        {/* Floating Icons */}
        <motion.div 
          animate={{ 
            y: [0, -15, 0],
            rotate: [0, 5, 0]
          }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -left-8 top-10 opacity-20 md:-left-20"
        >
          <Package className="h-10 w-10 text-primary" />
        </motion.div>

        <motion.div 
          animate={{ 
            y: [0, 15, 0],
            rotate: [0, -8, 0]
          }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute -right-8 top-40 opacity-20 md:-right-20"
        >
          <MapPin className="h-8 w-8 text-primary" />
        </motion.div>
      </motion.div>
    </div>
  );
};