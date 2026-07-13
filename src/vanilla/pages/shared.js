export const routes = [
  {
    pattern: "/termos",
    title: "Termos de uso",
    render: ({ ui }) => ui.el("article", { class: "container legal-page" },
      ui.heading("Termos de uso", "Condicoes gerais da plataforma Hype Delivery"),
      ui.el("p", {}, "Ao utilizar a plataforma, voce concorda em fornecer dados verdadeiros, respeitar as regras de cada loja e nao tentar contornar controles de seguranca ou pagamento."),
      ui.el("h2", {}, "Pedidos e pagamentos"),
      ui.el("p", {}, "Precos, disponibilidade, entrega e formas de pagamento sao confirmados no servidor no momento do pedido. Uma solicitacao so e considerada paga apos confirmacao valida."),
      ui.el("h2", {}, "Responsabilidades"),
      ui.el("p", {}, "Lojas parceiras sao responsaveis pela preparacao e entrega. A plataforma registra eventos para suporte, conciliacao e prevencao a fraude."),
    ),
  },
  {
    pattern: "/privacidade",
    title: "Privacidade",
    render: ({ ui }) => ui.el("article", { class: "container legal-page" },
      ui.heading("Aviso de privacidade", "Como os dados necessarios ao servico sao tratados"),
      ui.el("p", {}, "Tratamos identificacao, contato, endereco, localizacao quando autorizada e dados do pedido para executar a compra, prevenir fraude e prestar suporte."),
      ui.el("h2", {}, "Localizacao"),
      ui.el("p", {}, "A localizacao do dispositivo e opcional, usada apenas para auxiliar o preenchimento e a estimativa de entrega. O calculo final utiliza endereco validado no servidor."),
      ui.el("h2", {}, "Seguranca e retencao"),
      ui.el("p", {}, "Acesso e limitado por perfil e loja. Dados financeiros e documentos privados nao sao publicados. Registros sao mantidos pelo periodo necessario a operacao e obrigacoes legais."),
    ),
  },
  {
    pattern: "/cliente",
    auth: "customer",
    title: "Minha conta",
    render: async ({ ui, api, auth, navigate }) => {
      const root = ui.el("div", { class: "container page-stack" }, ui.heading("Minha conta", "Pedidos e dados de cadastro"));
      const result = await api.from("orders").select("*").order("created_at", { ascending: false }).limit(50);
      if (result.error) return root.append(ui.empty("Pedidos indisponiveis", result.error.message)), root;
      const list = ui.el("div", { class: "card-grid" });
      for (const order of result.data || []) {
        list.append(ui.card(
          ui.el("div", { class: "card__header" }, ui.el("strong", {}, `Pedido #${order.order_number || "—"}`), ui.el("span", { class: "badge", text: order.status || "novo" })),
          ui.el("p", {}, ui.money(order.total)),
          ui.button("Acompanhar", { variant: "secondary", onClick: () => navigate(`/pedido/${order.public_token}`) }),
        ));
      }
      root.append((result.data || []).length ? list : ui.empty("Nenhum pedido ainda", "Quando voce fizer um pedido, ele aparecera aqui."),
        ui.button("Sair", { variant: "ghost", onClick: async () => { await auth.signOut(); navigate("/"); } }));
      return root;
    },
  },
  {
    pattern: "/cliente/assinatura",
    auth: "customer",
    title: "Minha conta",
    render: ({ navigate, ui }) => { queueMicrotask(() => navigate("/cliente", { replace: true })); return ui.loading(); },
  },
  {
    pattern: "*",
    title: "Pagina nao encontrada",
    render: ({ ui, navigate }) => ui.el("section", { class: "container not-found" },
      ui.el("p", { class: "not-found__code", text: "404" }), ui.el("h1", { text: "Pagina nao encontrada" }),
      ui.el("p", { text: "O endereco informado nao existe ou foi movido." }),
      ui.button("Voltar ao inicio", { onClick: () => navigate("/") }),
    ),
  },
];
