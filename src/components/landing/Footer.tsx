import { BrandMark } from "@/components/BrandMark";
import { buildDeliveryUrl, buildPartnersUrl } from "@/lib/domains";
import { Link } from "react-router-dom";

export const Footer = () => {
  return (
    <footer className="border-t border-white/10 bg-[var(--hype-dark)] text-white">
      <div className="container mx-auto px-4 py-12">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <BrandMark className="mb-4" inverted />
            <p className="text-sm leading-relaxed text-white/62">
              Hype Delivery separa o delivery em hypedelivery.com.br e o portal exclusivo de lojas parceiras em parceiros.hypedelivery.com.br.
            </p>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold text-white">Produto</h4>
            <ul className="space-y-2 text-sm text-white/62">
              <li><a href="#beneficios" className="hover:text-primary">Benefícios</a></li>
              <li><a href="#como-funciona" className="hover:text-primary">Como Funciona</a></li>
              <li><a href="#planos" className="hover:text-primary">Planos e Preços</a></li>
              <li><a href={buildDeliveryUrl("/")} className="hover:text-primary font-bold text-primary">Ver Delivery</a></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold text-white">Acesso Rápido</h4>
            <ul className="space-y-2 text-sm text-white/62">
              <li><Link to="/cliente" className="hover:text-primary">Painel do Cliente</Link></li>
              <li><Link to="/lojista/entrar" className="hover:text-primary">Portal do Lojista</Link></li>
              <li><Link to="/admin/entrar" className="hover:text-primary">Portal Administrativo</Link></li>
              <li><Link to="/cadastrar-loja" className="hover:text-primary font-bold text-primary">Abrir minha Loja</Link></li>
              <li><a href={buildPartnersUrl("/")} className="hover:text-primary">Domínio de Parceiros</a></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold text-white">Contato</h4>
            <ul className="space-y-2 text-sm text-white/62">
              <li><a href="https://instagram.com/JVKRT" target="_blank" rel="noopener noreferrer" className="hover:text-primary">Instagram: @JVKRT</a></li>
              <li><a href="https://wa.me/5527995288081" target="_blank" rel="noopener noreferrer" className="hover:text-primary">WhatsApp: (27) 99528-8081</a></li>
              <li><a href="mailto:contato@hypedelivery.com.br" className="hover:text-primary">contato@hypedelivery.com.br</a></li>
            </ul>
          </div>
        </div>
        <div className="mt-12 border-t border-white/10 pt-6 text-xs text-white/45 flex flex-col md:flex-row justify-between items-center gap-4">
          <span>&copy; {new Date().getFullYear()} Hype Delivery. Todos os direitos reservados.</span>
          <div className="flex gap-6">
            <Link to="/termos" className="hover:underline">Termos</Link>
            <Link to="/privacidade" className="hover:underline">Privacidade</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

