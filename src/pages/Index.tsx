import { Navbar } from "@/components/landing/Navbar";
import { Hero } from "@/components/landing/Hero";
import { Niches } from "@/components/landing/Niches";
import { Benefits } from "@/components/landing/Benefits";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Pricing } from "@/components/landing/Pricing";
import { CTA } from "@/components/landing/CTA";
import { AppShowcase } from "@/components/landing/AppShowcase";
import { Footer } from "@/components/landing/Footer";

/**
 * Recepcao / Landing.
 *
 * Layout inspirado na referencia Menu_Principal_Lojas (estrutura apenas):
 *   1. Hero informativo com imagem + headline (componente Hero, ja contem CTA).
 *   2. Linha de CATEGORIAS / segmentos (componente Niches = grid de nichos em circulos).
 *   3. Blocos de DESTAQUE / ofertas e como funciona (Benefits + HowItWorks).
 *   4. Planos/ofertas com dado real do backend (Pricing -> tabela "plans").
 *   5. Chamada final + rodape (CTA + Footer).
 *
 * Observacao sobre dados: este arquivo apenas compoe os componentes de landing.
 * Toda a fiacao de dados/hooks (useAuth/getUserRoles em Navbar, useNavigate,
 * backend.from("plans") em Pricing, etc.) vive DENTRO de cada componente filho
 * e e preservada integralmente ao mante-los renderizados aqui.
 *
 * A referencia tambem sugere "cards de ofertas/pratos em destaque" e "grid de
 * parceiros com logo". Nao existe query de lojas/ofertas conectada nesta tela
 * (apenas "plans"), portanto esses blocos foram OMITIDOS para nao fabricar dados
 * (regra inegociavel nro 2). As cores/fontes/logo HYPE sao mantidas pelos
 * componentes existentes.
 */
const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        {/* Hero informativo: imagem apresentavel + headline + CTAs */}
        <Hero />

        {/* Linha de categorias / segmentos (estilo circulos da referencia) */}
        <Niches />

        {/* Destaques: beneficios e fluxo de uso */}
        <Benefits />
        <HowItWorks />

        {/* Ofertas / planos com dado real (plans) do backend */}
        <Pricing />

        {/* Chamada final */}
        <CTA />

        {/* Vitrine interativa com slides animados */}
        <AppShowcase />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
