import { Ban, Bell, Link2, MapPin, MessageCircle, Tag, Users } from "lucide-react";

const benefits = [
  { icon: Ban, title: "Margem preservada", desc: "Receba o valor dos pedidos sem taxa por venda corroendo o resultado." },
  { icon: Link2, title: "Link de loja", desc: "Uma vitrine publica para divulgar em redes sociais, WhatsApp, Google e materiais fisicos." },
  { icon: Bell, title: "Fila em tempo real", desc: "Pedidos entram no painel com status, historico e acao rapida para a equipe." },
  { icon: MapPin, title: "Entrega por regiao", desc: "Defina bairros, taxas, minimo e tempo estimado de forma simples." },
  { icon: Tag, title: "Cupons controlados", desc: "Crie descontos com validade, limite de uso e pedido minimo." },
  { icon: Users, title: "Base de clientes", desc: "Acompanhe historico, ticket medio e dados uteis para relacionamento." },
  { icon: MessageCircle, title: "Contato direto", desc: "Leve clientes para WhatsApp quando fizer sentido, sem perder o registro do pedido." },
];

export const Benefits = () => {
  return (
    <section id="beneficios" className="py-20 md:py-24">
      <div className="container mx-auto px-4">
        <div className="mb-12 max-w-2xl">
          <p className="mb-3 text-sm font-semibold uppercase text-primary">Controle operacional</p>
          <h2 className="mb-4 text-3xl font-bold md:text-5xl">O essencial do delivery em um sistema sob sua marca.</h2>
          <p className="text-lg text-muted-foreground">Menos ruido, mais clareza para aceitar pedidos, organizar produtos e entender vendas.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {benefits.map((benefit) => (
            <div key={benefit.title} className="group vexor-panel border border-border bg-card p-6 shadow-card transition-smooth hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-elegant">
              <div className="mb-5 inline-flex h-11 w-11 items-center justify-center border border-primary/35 bg-primary/10 text-primary transition-smooth group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">
                <benefit.icon className="h-5 w-5" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">{benefit.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{benefit.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
