import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { backend } from "@/integrations/backend/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { 
  Loader2, 
  Rocket, 
  CheckCircle2, 
  ShieldCheck, 
  TrendingUp, 
  Smartphone,
  ChevronRight,
  Clock,
  MapPin,
  Banknote,
  Percent
} from "lucide-react";
import { formatDoc } from "@/lib/format";
import { BrandMark } from "@/components/BrandMark";
import { buildDeliveryUrl } from "@/lib/domains";
import { SocialAuthButtons } from "./SocialAuthButtons";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const MerchantSignup = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: "", document: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const oauthRedirect =
    typeof window !== "undefined" ? `${window.location.origin}/onboarding` : undefined;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    const { data: signUpData, error } = await backend.auth.signUp({
      email: form.email.trim().toLowerCase(),
      password: form.password,
      options: {
        data: { 
          full_name: form.full_name.toUpperCase(),
          document: form.document.replace(/\D/g, ""),
          account_type: "store_owner",
          role: "store_owner",
        },
      },
    });

    if (error) {
      setLoading(false);
      toast.error(error.message);
      return;
    }

    if (signUpData.user && !signUpData.session) {
      setLoading(false);
      toast.success("Conta criada. Verifique seu e-mail para ativar o acesso.");
      navigate("/lojista/entrar", { replace: true });
      return;
    }

    if (signUpData.user) {
      toast.success("Conta criada! Vamos configurar sua loja.");
      navigate("/onboarding", { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/90 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <BrandMark to="/" animated className="max-w-[10rem]" />
          <div className="flex items-center gap-4">
            <Link to="/lojista/entrar" className="hidden text-sm font-semibold text-muted-foreground hover:text-primary md:block transition-colors">
              Já é parceiro? Entrar
            </Link>
            <Button variant="outline" className="border-primary/45 text-foreground hover:bg-primary/15 md:hidden" asChild>
              <Link to="/lojista/entrar">Login</Link>
            </Button>
            <Button className="bg-primary hover:bg-[var(--hype-green-dark)] text-primary-foreground font-bold shadow-[0_4px_12px_rgba(178,216,63,0.28)]" asChild>
              <a href="#cadastro">Cadastrar Agora</a>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className="relative overflow-hidden bg-background py-16 md:py-24">
          <div className="absolute inset-0 z-0">
            <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1556742049-139422cb0f5c?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center opacity-15 mix-blend-overlay" />
            <div className="absolute inset-0 bg-black/75" />
          </div>

          <div className="container relative z-10 mx-auto px-4">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              {/* Headline */}
              <div className="max-w-2xl text-foreground">
                <div className="mb-4 inline-flex items-center rounded-md bg-primary/15 px-3 py-1 text-sm font-bold text-primary ring-1 ring-inset ring-primary/25">
                  <span className="mr-2 h-2 w-2 rounded-md bg-primary" />
                  Seja um Parceiro Oficial
                </div>
                <h1 className="mb-6 text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl italic uppercase">
                  Venda muito mais com a nossa <span className="text-primary">Tecnologia</span>
                </h1>
                <p className="mb-8 text-lg text-foreground/70 md:text-xl">
                  Leve seu negócio para o próximo nível. Cadastre sua loja hoje e comece a receber pedidos online com taxas reduzidas e gestão simplificada.
                </p>
                
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    "Sem taxa de adesão",
                    "Pagamento rápido",
                    "Suporte prioritário",
                    "Gestão 100% digital"
                  ].map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-foreground/85 font-medium">
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Form Card */}
              <div id="cadastro" className="relative">
                <Card className="mx-auto w-full max-w-lg border border-border p-6 shadow-2xl shadow-black/10 sm:p-8">
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold text-foreground italic uppercase tracking-tight">Comece agora mesmo</h2>
                    <p className="text-muted-foreground">Preencha os dados para criar sua loja.</p>
                  </div>

                  <form onSubmit={onSubmit} className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="full_name" className="text-foreground font-semibold">Seu Nome Completo</Label>
                      <Input 
                        id="full_name" 
                        placeholder="Ex: João Silva"
                        value={form.full_name} 
                        onChange={(e) => setForm({ ...form, full_name: e.target.value })} 
                        required 
                        className="h-12 border-border focus-visible:ring-primary"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="document" className="text-foreground font-semibold">CPF ou CNPJ</Label>
                      <Input 
                        id="document" 
                        value={formatDoc(form.document)} 
                        onChange={(e) => setForm({ ...form, document: e.target.value })} 
                        required 
                        placeholder="00.000.000/0001-00"
                        className="h-12 border-border focus-visible:ring-primary"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-foreground font-semibold">E-mail Profissional</Label>
                      <Input 
                        id="email" 
                        type="email" 
                        placeholder="seu@email.com"
                        value={form.email} 
                        onChange={(e) => setForm({ ...form, email: e.target.value })} 
                        required 
                        className="h-12 border-border focus-visible:ring-primary"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password" className="text-foreground font-semibold">Crie uma Senha</Label>
                      <Input 
                        id="password" 
                        type="password" 
                        placeholder="Mínimo 6 caracteres"
                        value={form.password} 
                        onChange={(e) => setForm({ ...form, password: e.target.value })} 
                        required 
                        minLength={6}
                        className="h-12 border-border focus-visible:ring-primary"
                      />
                    </div>

                    <Button 
                      type="submit" 
                      className="w-full bg-primary hover:bg-[var(--hype-green-dark)] text-primary-foreground font-bold h-12 shadow-[0_4px_12px_rgba(178,216,63,0.25)] transition-all active:scale-[0.98]" 
                      disabled={loading}
                    >
                      {loading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <>
                          <Rocket className="mr-2 h-5 w-5" /> 
                          CRIAR MINHA LOJA GRÁTIS
                        </>
                      )}
                    </Button>

                    <p className="text-center text-xs text-muted-foreground">
                      Ao se cadastrar, você concorda com nossos <Link to="/termos" className="underline hover:text-primary">Termos de Uso</Link> e <Link to="/privacidade" className="underline hover:text-primary">Política de Privacidade</Link>.
                    </p>
                  </form>
                  <div className="mt-5">
                    <SocialAuthButtons context="merchant_signup" redirectTo={oauthRedirect} />
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section id="beneficios" className="bg-muted py-20">
          <div className="container mx-auto px-4 text-center">
            <h2 className="mb-4 text-3xl font-black uppercase italic tracking-tight text-foreground md:text-4xl">
              Por que ser um <span className="text-[var(--hype-green-dark)]">parceiro</span>?
            </h2>
            <p className="mx-auto mb-16 max-w-2xl text-muted-foreground">
              Oferecemos todas as ferramentas que você precisa para digitalizar suas vendas e crescer de forma sustentável.
            </p>

            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: <TrendingUp className="h-8 w-8 text-[var(--hype-green-dark)]" />,
                  title: "Aumento de Vendas",
                  desc: "Alcance clientes que preferem comprar online e aumente seu faturamento."
                },
                {
                  icon: <ShieldCheck className="h-8 w-8 text-[var(--hype-green-dark)]" />,
                  title: "Segurança Total",
                  desc: "Plataforma robusta com pagamentos integrados e proteção contra fraudes."
                },
                {
                  icon: <Smartphone className="h-8 w-8 text-[var(--hype-green-dark)]" />,
                  title: "Gestão na Mão",
                  desc: "Acompanhe pedidos, estoque e relatórios de onde você estiver pelo celular."
                },
                {
                  icon: <Clock className="h-8 w-8 text-[var(--hype-green-dark)]" />,
                  title: "Agilidade",
                  desc: "Receba pedidos instantaneamente e otimize sua operação de entrega."
                }
              ].map((benefit, idx) => (
                <Card key={idx} className="group border-0 p-8 shadow-sm transition-all hover:-translate-y-2 hover:shadow-xl">
                  <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-md bg-primary/10 transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <div className="transition-transform group-hover:scale-110">
                      {benefit.icon}
                    </div>
                  </div>
                  <h3 className="mb-2 text-xl font-bold text-foreground">{benefit.title}</h3>
                  <p className="text-muted-foreground">{benefit.desc}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Steps Section */}
        <section className="py-20">
          <div className="container mx-auto px-4">
            <div className="flex flex-col items-center gap-12 lg:flex-row">
              <div className="lg:w-1/2">
                <img
                  src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=2026&auto=format&fit=crop"
                  alt="Gestão de Negócios"
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  className="rounded-md shadow-2xl"
                />
              </div>
              <div className="lg:w-1/2">
                <h2 className="mb-8 text-3xl font-black uppercase italic tracking-tight text-foreground md:text-4xl">
                  Como começar em <span className="text-[var(--hype-green-dark)]">3 passos</span>
                </h2>
                <div className="space-y-8">
                  {[
                    {
                      step: "01",
                      title: "Faça seu cadastro",
                      desc: "Preencha os dados da sua loja e do responsável. É rápido e 100% online."
                    },
                    {
                      step: "02",
                      title: "Configure seu cardápio",
                      desc: "Adicione seus produtos, fotos e preços de forma intuitiva no painel."
                    },
                    {
                      step: "03",
                      title: "Comece a vender",
                      desc: "Ative sua loja e comece a receber pedidos. Simples assim!"
                    }
                  ].map((item, idx) => (
                    <div key={idx} className="flex gap-6">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary text-lg font-black text-primary-foreground italic">
                        {item.step}
                      </div>
                      <div>
                        <h3 className="mb-2 text-xl font-bold text-foreground">{item.title}</h3>
                        <p className="text-muted-foreground">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing/Mini Section (Optional but good for conversions) */}
        <section className="bg-background py-16 text-foreground">
          <div className="container mx-auto px-4 text-center">
            <h2 className="mb-12 text-3xl font-black uppercase italic tracking-tight md:text-4xl">Transparência é o nosso lema</h2>
            <div className="grid gap-8 md:grid-cols-3">
              {[
                { icon: <Percent className="h-6 w-6" />, label: "Taxas Competitivas", value: "Melhores do Mercado" },
                { icon: <MapPin className="h-6 w-6" />, label: "Raio de Entrega", value: "Você Define" },
                { icon: <Banknote className="h-6 w-6" />, label: "Repasses", value: "Semanais" }
              ].map((item, idx) => (
                <div key={idx} className="rounded-md bg-background/10 p-6 backdrop-blur-sm">
                  <div className="mb-4 flex justify-center">{item.icon}</div>
                  <p className="text-foreground/70">{item.label}</p>
                  <p className="text-2xl font-black uppercase italic">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="bg-background py-20">
          <div className="container mx-auto max-w-3xl px-4">
            <h2 className="mb-12 text-center text-3xl font-black uppercase italic tracking-tight text-foreground md:text-4xl">
              Dúvidas <span className="text-[var(--hype-green-dark)]">Frequentes</span>
            </h2>
            <Accordion type="single" collapsible className="w-full">
              {[
                {
                  q: "Preciso ter CNPJ para me cadastrar?",
                  a: "Sim, aceitamos MEI e outros tipos de CNPJ para garantir a segurança e profissionalismo da plataforma."
                },
                {
                  q: "Quanto tempo demora para minha loja ser aprovada?",
                  a: "Após o preenchimento completo, nossa equipe revisa os dados em até 24 horas úteis."
                },
                {
                  q: "Posso vender qualquer tipo de produto?",
                  a: "Aceitamos a maioria dos segmentos de varejo e alimentação, desde que respeitem as normas legais vigentes."
                },
                {
                  q: "Como recebo o valor das minhas vendas?",
                  a: "Os valores são repassados automaticamente para a conta bancária cadastrada, seguindo o cronograma de repasses escolhido."
                }
              ].map((item, idx) => (
                <AccordionItem key={idx} value={`item-${idx}`} className="border-border">
                  <AccordionTrigger className="text-left font-bold text-foreground hover:text-primary">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* Final CTA */}
        <section className="bg-background py-20">
          <div className="container mx-auto px-4 text-center">
            <h2 className="mb-8 text-3xl font-black uppercase italic tracking-tight text-foreground md:text-5xl">
              Pronto para <span className="text-primary">escalar</span> seu negócio?
            </h2>
            <p className="mx-auto mb-10 max-w-2xl text-lg text-muted-foreground">
              Não perca mais tempo com processos manuais. Junte-se a centenas de lojistas que já estão lucrando com nossa plataforma.
            </p>
            <Button size="lg" className="h-14 bg-primary px-10 text-lg font-black text-primary-foreground hover:bg-[var(--hype-green-dark)] shadow-xl shadow-black/10 active:scale-95 transition-all" asChild>
              <a href="#cadastro">
                CRIAR MINHA LOJA AGORA <ChevronRight className="ml-2 h-5 w-5" />
              </a>
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-background py-12">
        <div className="container mx-auto px-4">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <BrandMark compact className="opacity-80" />
            <div className="flex gap-8">
              <Link to="/" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">Portal Parceiro</Link>
              <a href={buildDeliveryUrl("/")} className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">Delivery</a>
              <a href={buildDeliveryUrl("/entrar")} className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">Sou Cliente</a>
            </div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest italic">
              © {new Date().getFullYear()} Hype Delivery. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default MerchantSignup;
