const steps = [
  { n: "01", t: "Configure a loja", d: "Cadastro, horarios, pagamentos, entrega, retirada e identidade visual." },
  { n: "02", t: "Monte o cardapio", d: "Categorias, produtos, fotos, precos promocionais e adicionais." },
  { n: "03", t: "Venda no link publico", d: "O cliente escolhe itens, informa dados, aplica cupom e confirma o pedido." },
  { n: "04", t: "Acompanhe no painel", d: "Sua equipe atualiza status e conversa com o cliente quando necessario." },
  { n: "05", t: "Meça e ajuste", d: "Relatorios, clientes e produtos mais vendidos ajudam a melhorar a operacao." },
];

export const HowItWorks = () => {
  return (
    <section id="como-funciona" className="section-band py-20 md:py-24">
      <div className="container mx-auto px-4">
        <div className="mb-12 max-w-2xl">
          <p className="mb-3 text-sm font-semibold uppercase text-primary">Fluxo completo</p>
          <h2 className="mb-4 text-3xl font-bold md:text-5xl">Da vitrine ao pedido entregue sem trocar de ferramenta.</h2>
          <p className="text-lg text-muted-foreground">A experiencia cobre cliente, loja e administracao sem esconder etapas importantes.</p>
        </div>

        <div className="grid gap-3 lg:grid-cols-5">
          {steps.map((step) => (
            <div key={step.n} className="rounded-lg border border-border bg-card p-5 shadow-card">
              <div className="mb-5 text-sm font-semibold text-accent">{step.n}</div>
              <h3 className="mb-2 text-base font-semibold">{step.t}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

