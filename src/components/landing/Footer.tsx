import { BrandMark } from "@/components/BrandMark";
import { Link } from "react-router-dom";

export const Footer = () => {
  return (
    <footer className="border-t border-border bg-background">
      <div className="container mx-auto px-4 py-12">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <BrandMark className="mb-4" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              Marketplace de delivery moderno para negócios locais venderem com autonomia e inteligência.
            </p>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold">Produto</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#beneficios" className="hover:text-foreground">Benefícios</a></li>
              <li><a href="#como-funciona" className="hover:text-foreground">Como Funciona</a></li>
              <li><a href="#planos" className="hover:text-foreground">Planos e Preços</a></li>
              <li><Link to="/" className="hover:text-foreground font-medium text-emerald-600">Ver Marketplace</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold">Acesso Rápido</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link to="/cliente" className="hover:text-foreground">Painel do Cliente</Link></li>
              <li><Link to="/lojista/entrar" className="hover:text-foreground">Portal do Lojista</Link></li>
              <li><Link to="/admin/entrar" className="hover:text-foreground">Portal Administrativo</Link></li>
              <li><Link to="/cadastrar-loja" className="hover:text-foreground font-medium text-primary">Abrir minha Loja</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold text-black">Contato</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="https://instagram.com/JVKRT" target="_blank" rel="noopener noreferrer" className="hover:text-black">Instagram: @JVKRT</a></li>
              <li><a href="https://wa.me/5527995288081" target="_blank" rel="noopener noreferrer" className="hover:text-black">WhatsApp: (27) 99528-8081</a></li>
              <li><a href="mailto:jvieira@vexortech.com.br" className="hover:text-black">jvieira@vexortech.com.br</a></li>
            </ul>
          </div>
        </div>
        <div className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground flex flex-col md:flex-row justify-between items-center gap-4">
          <span>&copy; {new Date().getFullYear()} VexorTech. Todos os direitos reservados.</span>
          <div className="flex gap-6">
            <Link to="/termos" className="hover:underline">Termos</Link>
            <Link to="/privacidade" className="hover:underline">Privacidade</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};
