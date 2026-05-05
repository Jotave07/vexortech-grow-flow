import { BrandMark } from "@/components/BrandMark";

export const Footer = () => {
  return (
    <footer className="border-t border-border bg-background">
      <div className="container mx-auto px-4 py-12">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <BrandMark className="mb-4" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              Delivery proprio para negocios locais venderem com autonomia.
            </p>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold">Produto</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#beneficios" className="hover:text-foreground">Beneficios</a></li>
              <li><a href="#como-funciona" className="hover:text-foreground">Fluxo</a></li>
              <li><a href="#planos" className="hover:text-foreground">Planos</a></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold">Operacao</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#nichos" className="hover:text-foreground">Segmentos</a></li>
              <li><a href="/entrar" className="hover:text-foreground">Painel</a></li>
              <li><a href="/cadastrar" className="hover:text-foreground">Criar conta</a></li>
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
        <div className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} VexorTech. Todos os direitos reservados.
        </div>
      </div>
    </footer>
  );
};
