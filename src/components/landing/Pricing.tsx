import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/format";

const buildFeatures = (plan: any) => {
  const features: string[] = [];

  if (plan.max_products) features.push(`${plan.max_products} produtos`);
  else features.push("Produtos ilimitados");

  features.push("Link publico");
  features.push("Gestao de produtos");

  if (plan.allows_coupons) features.push("Cupons");
  if (plan.allows_advanced_reports) features.push("Relatorios completos");
  if (plan.allows_custom_branding) features.push("Personalizacao visual");
  if (plan.allows_custom_domain) features.push("Dominio proprio");

  return features;
};

export const Pricing = () => {
  const [plans, setPlans] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("plans").select("*").eq("is_active", true).order("sort_order").then(({ data }) => {
      setPlans(data ?? []);
    });
  }, []);

  const displayPlans = useMemo(() => {
    return plans.map((plan, index) => ({
      ...plan,
      features: buildFeatures(plan),
      highlight: index === 1,
      priceLabel: Number(plan.price_monthly) > 0 ? formatBRL(plan.price_monthly) : "Sob consulta",
      period: Number(plan.price_monthly) > 0 ? "/mes" : "",
      cta: Number(plan.price_monthly) > 0 ? `Assinar ${plan.name}` : "Falar com vendas",
      variant: index === 1 ? "hero" : "outline",
    }));
  }, [plans]);

  return (
    <section id="planos" className="section-band py-20 md:py-24">
      <div className="container mx-auto px-4">
        <div className="mb-12 max-w-2xl">
          <p className="mb-3 text-sm font-semibold uppercase text-primary">Planos</p>
          <h2 className="mb-4 text-3xl font-bold md:text-5xl">Custo previsivel para uma operacao mais independente.</h2>
          <p className="text-lg text-muted-foreground">Sem taxa por pedido e com troca de plano conforme a loja cresce.</p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {displayPlans.map((plan) => (
            <div key={plan.id} className={`vexor-panel relative flex flex-col border bg-card p-7 shadow-card transition-smooth ${plan.highlight ? "border-primary shadow-elegant" : "border-border hover:border-primary/40"}`}>
              {plan.highlight && (
                <div className="absolute -top-3 left-5 border border-primary bg-primary px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary-foreground">
                  Mais escolhido
                </div>
              )}
              <h3 className="text-xl font-semibold">{plan.name}</h3>
              <p className="mb-6 mt-2 min-h-12 text-sm text-muted-foreground">{plan.description}</p>
              <div className="mb-6 flex items-baseline gap-1">
                <span className="text-4xl font-bold">{plan.priceLabel}</span>
                <span className="text-sm text-muted-foreground">{plan.period}</span>
              </div>
              <ul className="mb-8 space-y-3">
                {plan.features.map((feature: string) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Button variant={plan.variant as "hero" | "outline"} size="lg" className="mt-auto w-full" asChild>
                <Link to="/cadastrar">{plan.cta}</Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
