import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    const { data: signUpData, error } = await supabase.auth.signUp({
      email: form.email.toLowerCase(),
      password: form.password,
      options: {
        data: { 
          full_name: form.full_name.toUpperCase(),
          document: form.document.replace(/\D/g, "")
        },
      },
    });

    if (error) {
      setLoading(false);
      toast.error(error.message);
      return;
    }

    if (signUpData.user) {
      toast.success("Conta criada! Vamos configurar sua loja.");
      navigate("/onboarding", { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-slate-100 bg-white/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <BrandMark to="/" animated className="max-w-[10rem]" />
          <div className="flex items-center gap-4">
            <Link to="/lojista/entrar" className="hidden text-sm font-semibold text-slate-600 hover:text-orange-600 md:block transition-colors">
              Já é parceiro? Entrar
            </Link>
            <Button variant="outline" className="border-orange-200 text-orange-600 hover:bg-orange-50 md:hidden" asChild>
              <Link to="/lojista/entrar">Login</Link>
            </Button>
            <Button className="bg-orange-600 hover:bg-orange-700 text-white font-bold shadow-md shadow-orange-100" asChild>
              <a href="#cadastro">Cadastrar Agora</a>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className="relative overflow-hidden bg-slate-950 py-16 md:py-24">
          {/* Background Decorative Elements */}
          <div className="absolute inset-0 z-0">
            <div className="absolute -left-10 top-1/4 h-64 w-64 rounded-full bg-orange-600/20 blur-[100px]" />
            <div className="absolute -right-10 bottom-1/4 h-64 w-64 rounded-full bg-orange-500/10 blur-[100px]" />
            <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1556742049-139422cb0f5c?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center opacity-10 mix-blend-overlay" />
          </div>

          <div className="container relative z-10 mx-auto px-4">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              {/* Headline */}
              <div className="max-w-2xl text-white">
                <div className="mb-4 inline-flex items-center rounded-full bg-orange-500/10 px-3 py-1 text-sm font-bold text-orange-400 ring-1 ring-inset ring-orange-500/20">
                  <span className="mr-2 h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
                  Seja um Parceiro Oficial
                </div>
                <h1 className="mb-6 text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl italic uppercase">
                  Venda muito mais com a nossa <span className="text-orange-500">Tecnologia</span>
                </h1>
                <p className="mb-8 text-lg text-slate-300 md:text-xl">
                  Leve seu negócio para o próximo nível. Cadastre sua loja hoje e comece a receber pedidos online com taxas reduzidas e gestão simplificada.
                </p>
                
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    "Sem taxa de adesão",
                    "Pagamento rápido",
                    "Suporte prioritário",
                    "Gestão 100% digital"
                  ].map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-slate-200 font-medium">
                      <CheckCircle2 className="h-5 w-5 text-orange-500" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Form Card */}
              <div id="cadastro" className="relative">
                <Card className="mx-auto w-full max-w-lg border-0 p-6 shadow-2xl shadow-orange-950/20 sm:p-8">
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold text-slate-900 italic uppercase tracking-tight">Comece agora mesmo</h2>
                    <p className="text-slate-500">Preencha os dados para criar sua loja.</p>
                  </div>

                  <form onSubmit={onSubmit} className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="full_name" className="text-slate-700 font-semibold">Seu Nome Completo</Label>
                      <Input 
                        id="full_name" 
                        placeholder="Ex: João Silva"
                        value={form.full_name} 
                        onChange={(e) => setForm({ ...form, full_name: e.target.value })} 
                        required 
                        className="h-12 border-slate-200 focus-visible:ring-orange-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="document" className="text-slate-700 font-semibold">CPF ou CNPJ</Label>
                      <Input 
                        id="document" 
                        value={formatDoc(form.document)} 
                        onChange={(e) => setForm({ ...form, document: e.target.value })} 
                        required 
                        placeholder="00.000.000/0001-00"
                        className="h-12 border-slate-200 focus-visible:ring-orange-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-slate-700 font-semibold">E-mail Profissional</Label>
                      <Input 
                        id="email" 
                        type="email" 
                        placeholder="seu@email.com"
                        value={form.email} 
                        onChange={(e) => setForm({ ...form, email: e.target.value })} 
                        required 
                        className="h-12 border-slate-200 focus-visible:ring-orange-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password" className="text-slate-700 font-semibold">Crie uma Senha</Label>
                      <Input 
                        id="password" 
                        type="password" 
                        placeholder="Mínimo 6 caracteres"
                        value={form.password} 
                        onChange={(e) => setForm({ ...form, password: e.target.value })} 
                        required 
                        minLength={6}
                        className="h-12 border-slate-200 focus-visible:ring-orange-500"
                      />
                    </div>

                    <Button 
                      type="submit" 
                      className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold h-12 shadow-lg shadow-orange-100 transition-all active:scale-[0.98]" 
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

                    <p className="text-center text-xs text-slate-400">
                      Ao se cadastrar, você concorda com nossos <Link to="/termos" className="underline hover:text-orange-500">Termos de Uso</Link> e <Link to="/privacidade" className="underline hover:text-orange-500">Política de Privacidade</Link>.
                    </p>
                  </form>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section id="beneficios" className="bg-slate-50 py-20">
          <div className="container mx-auto px-4 text-center">
            <h2 className="mb-4 text-3xl font-black uppercase italic tracking-tight text-slate-900 md:text-4xl">
              Por que ser um <span className="text-orange-600">parceiro</span>?
            </h2>
            <p className="mx-auto mb-16 max-w-2xl text-slate-600">
              Oferecemos todas as ferramentas que você precisa para digitalizar suas vendas e crescer de forma sustentável.
            </p>

            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: <TrendingUp className="h-8 w-8 text-orange-600" />,
                  title: "Aumento de Vendas",
                  desc: "Alcance clientes que preferem comprar online e aumente seu faturamento."
                },
                {
                  icon: <ShieldCheck className="h-8 w-8 text-orange-600" />,
                  title: "Segurança Total",
                  desc: "Plataforma robusta com pagamentos integrados e proteção contra fraudes."
                },
                {
                  icon: <Smartphone className="h-8 w-8 text-orange-600" />,
                  title: "Gestão na Mão",
                  desc: "Acompanhe pedidos, estoque e relatórios de onde você estiver pelo celular."
                },
                {
                  icon: <Clock className="h-8 w-8 text-orange-600" />,
                  title: "Agilidade",
                  desc: "Receba pedidos instantaneamente e otimize sua operação de entrega."
                }
              ].map((benefit, idx) => (
                <Card key={idx} className="group border-0 p-8 shadow-sm transition-all hover:-translate-y-2 hover:shadow-xl">
                  <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 transition-colors group-hover:bg-orange-600 group-hover:text-white">
                    <div className="transition-transform group-hover:scale-110">
                      {benefit.icon}
                    </div>
                  </div>
                  <h3 className="mb-2 text-xl font-bold text-slate-900">{benefit.title}</h3>
                  <p className="text-slate-500">{benefit.desc}</p>
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
                  className="rounded-3xl shadow-2xl"
                />
              </div>
              <div className="lg:w-1/2">
                <h2 className="mb-8 text-3xl font-black uppercase italic tracking-tight text-slate-900 md:text-4xl">
                  Como começar em <span className="text-orange-600">3 passos</span>
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
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-orange-600 text-lg font-black text-white italic">
                        {item.step}
                      </div>
                      <div>
                        <h3 className="mb-2 text-xl font-bold text-slate-900">{item.title}</h3>
                        <p className="text-slate-600">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing/Mini Section (Optional but good for conversions) */}
        <section className="bg-orange-600 py-16 text-white">
          <div className="container mx-auto px-4 text-center">
            <h2 className="mb-12 text-3xl font-black uppercase italic tracking-tight md:text-4xl">Transparência é o nosso lema</h2>
            <div className="grid gap-8 md:grid-cols-3">
              {[
                { icon: <Percent className="h-6 w-6" />, label: "Taxas Competitivas", value: "Melhores do Mercado" },
                { icon: <MapPin className="h-6 w-6" />, label: "Raio de Entrega", value: "Você Define" },
                { icon: <Banknote className="h-6 w-6" />, label: "Repasses", value: "Semanais" }
              ].map((item, idx) => (
                <div key={idx} className="rounded-2xl bg-white/10 p-6 backdrop-blur-sm">
                  <div className="mb-4 flex justify-center">{item.icon}</div>
                  <p className="text-orange-100">{item.label}</p>
                  <p className="text-2xl font-black uppercase italic">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="bg-white py-20">
          <div className="container mx-auto max-w-3xl px-4">
            <h2 className="mb-12 text-center text-3xl font-black uppercase italic tracking-tight text-slate-900 md:text-4xl">
              Dúvidas <span className="text-orange-600">Frequentes</span>
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
                <AccordionItem key={idx} value={`item-${idx}`} className="border-slate-100">
                  <AccordionTrigger className="text-left font-bold text-slate-800 hover:text-orange-600">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-slate-600">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* Final CTA */}
        <section className="bg-slate-950 py-20">
          <div className="container mx-auto px-4 text-center">
            <h2 className="mb-8 text-3xl font-black uppercase italic tracking-tight text-white md:text-5xl">
              Pronto para <span className="text-orange-600 text-glow-orange">escalar</span> seu negócio?
            </h2>
            <p className="mx-auto mb-10 max-w-2xl text-lg text-slate-400">
              Não perca mais tempo com processos manuais. Junte-se a centenas de lojistas que já estão lucrando com nossa plataforma.
            </p>
            <Button size="lg" className="h-14 bg-orange-600 px-10 text-lg font-black hover:bg-orange-700 shadow-xl shadow-orange-950/20 active:scale-95 transition-all" asChild>
              <a href="#cadastro">
                CRIAR MINHA LOJA AGORA <ChevronRight className="ml-2 h-5 w-5" />
              </a>
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-white py-12">
        <div className="container mx-auto px-4">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <BrandMark compact className="opacity-80" />
            <div className="flex gap-8">
              <Link to="/" className="text-sm font-medium text-slate-500 hover:text-orange-600 transition-colors">Página Inicial</Link>
              <Link to="/lojas" className="text-sm font-medium text-slate-500 hover:text-orange-600 transition-colors">Lojas</Link>
              <Link to="/entrar" className="text-sm font-medium text-slate-500 hover:text-orange-600 transition-colors">Sou Cliente</Link>
            </div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest italic">
              © {new Date().getFullYear()} VexorTech. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default MerchantSignup;