import {
  alertBox,
  brandLink,
  createPage,
  debounce,
  emptyState,
  errorState,
  h,
  imageOrFallback,
  loadingState,
  main,
  money,
  navLink,
  normalizeText,
  publicError,
  replaceMain,
  safeExternalLink,
  salesPath,
  shellHeader,
  unwrap,
} from "./shared.js";

const STORE_COLUMNS = "id, name, public_name, slug, city, state, logo_url, is_active, is_suspended";
const PUBLIC_STORE_LIMIT = 200;

function storeCard(ctx, store) {
  const name = String(store.public_name || store.name || "Loja");
  const location = [store.city, store.state].filter(Boolean).join(" / ");
  const href = salesPath(ctx, `/loja/${encodeURIComponent(store.slug)}`);
  const link = navLink(ctx, href, "", "vxp-store-card__link");
  link.append(
    imageOrFallback({ src: store.logo_url, alt: `Logo de ${name}`, className: "vxp-avatar", fallback: name.slice(0, 1).toUpperCase() }),
    h("span", { className: "vxp-stack vxp-stack--xs vxp-grow" },
      h("strong", { text: name }),
      location ? h("span", { className: "vxp-small vxp-muted", text: location }) : h("span", { className: "vxp-small vxp-muted", text: "Localização não informada" }),
      h("span", { className: "vxp-eyebrow", text: "Ver cardápio" }),
    ),
    h("span", { ariaHidden: "true", text: "→" }),
  );
  return h("article", { className: "vxp-card vxp-store-card" }, link);
}

function listContent(ctx, stores, isHome, registerCleanup) {
  const section = h("section", { id: "stores", className: "vxp-stack vxp-stack--lg", "aria-labelledby": "stores-title" });
  const heading = h("div", { className: "vxp-stack vxp-stack--xs" },
    h("p", { className: "vxp-eyebrow", text: isHome ? "Peça perto de você" : "Lojas disponíveis" }),
    h("h1", { id: "stores-title", className: "vxp-title", text: isHome ? "O que você quer pedir hoje?" : "Escolha uma loja" }),
    h("p", { className: "vxp-subtitle", text: "Busque pelo nome da loja ou pela cidade e abra o cardápio para montar seu pedido." }),
  );
  const search = h("input", {
    className: "vxp-input",
    type: "search",
    name: "store-search",
    autocomplete: "off",
    placeholder: "Nome da loja ou cidade",
    "aria-label": "Buscar lojas por nome ou cidade",
  });
  const count = h("p", { className: "vxp-small vxp-muted", role: "status", "aria-live": "polite" });
  const grid = h("div", { className: "vxp-grid" });

  const render = (query = "") => {
    const term = normalizeText(query.trim());
    const filtered = stores.filter((store) => !term || [store.name, store.public_name, store.city, store.state].some((value) => normalizeText(value).includes(term)));
    grid.replaceChildren();
    count.textContent = `${filtered.length} ${filtered.length === 1 ? "loja encontrada" : "lojas encontradas"}`;
    if (!filtered.length) {
      grid.append(emptyState({
        iconText: "⌕",
        title: term ? "Nenhuma loja encontrada" : "Nenhuma loja disponível",
        message: term ? "Tente buscar com outro nome ou cidade." : "Volte em alguns minutos para conferir novas opções.",
      }));
      return;
    }
    const fragment = document.createDocumentFragment();
    filtered.forEach((store) => fragment.append(storeCard(ctx, store)));
    grid.append(fragment);
  };
  const onSearch = debounce(() => render(search.value), 160);
  search.addEventListener("input", onSearch);
  registerCleanup?.(onSearch.cancel);
  render();

  section.append(
    heading,
    h("div", { className: "vxp-card vxp-card__body vxp-stack vxp-stack--sm" },
      h("div", { className: "vxp-search" }, h("span", { className: "vxp-search__icon", ariaHidden: "true", text: "⌕" }), search),
      count,
    ),
    grid,
  );
  return section;
}

function consumerHero() {
  return h("section", { className: "vxp-consumer-hero", "aria-labelledby": "consumer-hero-title" },
    h("div", { className: "vxp-consumer-hero__copy vxp-stack vxp-stack--lg" },
      h("span", { className: "vxp-badge vxp-badge--success", text: "Delivery simples, do seu jeito" }),
      h("div", { className: "vxp-stack vxp-stack--sm" },
        h("h1", { id: "consumer-hero-title", className: "vxp-consumer-headline", text: "Seu pedido favorito, a caminho." }),
        h("p", { className: "vxp-subtitle", text: "Encontre lojas, monte sua sacola e acompanhe cada etapa sem sair da Hype Delivery." }),
      ),
      h("a", { className: "vxp-btn vxp-consumer-hero__cta", href: "#stores", text: "Explorar lojas" }),
    ),
    h("div", { className: "vxp-delivery-scene", role: "img", "aria-label": "Ilustração animada de uma entrega a caminho" },
      h("div", { className: "vxp-delivery-status" },
        h("span", { className: "vxp-delivery-status__pulse", ariaHidden: "true" }),
        h("span", { className: "vxp-stack vxp-stack--xs" },
          h("strong", { text: "Pedido confirmado" }),
          h("small", { className: "vxp-muted", text: "A loja já está preparando" }),
        ),
      ),
      h("div", { className: "vxp-delivery-route", ariaHidden: "true" },
        h("span", { className: "vxp-delivery-route__point vxp-delivery-route__point--start" }),
        h("span", { className: "vxp-delivery-route__track" }),
        h("span", { className: "vxp-delivery-route__rider", text: "🛵" }),
        h("span", { className: "vxp-delivery-route__point vxp-delivery-route__point--finish", text: "⌂" }),
      ),
      h("div", { className: "vxp-delivery-caption" },
        h("span", { className: "vxp-muted vxp-small", text: "Do pedido à sua porta" }),
        h("strong", { text: "Acompanhe em tempo real" }),
      ),
    ),
  );
}

export function renderStores(ctx) {
  const root = createPage(ctx, { label: "Lojas para pedir" });
  const path = String(ctx?.location?.pathname || ctx?.pathname || globalThis.location?.pathname || "");
  const isHome = path === "/" || path === "/vendas" || !path;
  root.append(shellHeader(ctx, { title: "Hype Delivery" }), main(loadingState("Carregando lojas próximas…")));

  const load = async () => {
    try {
      const data = await unwrap(
        ctx.api.from("stores")
          .select(STORE_COLUMNS)
          .eq("is_active", true)
          .eq("is_suspended", false)
          .order("name", { ascending: true })
          .limit(PUBLIC_STORE_LIMIT),
      );
      if (root.pageSignal.aborted) return;
      const stores = Array.isArray(data) ? data : [];
      const content = listContent(ctx, stores, isHome, root.addCleanup);
      replaceMain(root, main(
        isHome ? h("div", { className: "vxp-stack vxp-stack--lg" }, consumerHero(), content) : content,
        `vxp-shell vxp-main${isHome ? " vxp-main--home" : ""}`,
      ));
    } catch {
      if (root.pageSignal.aborted) return;
      replaceMain(root, main(errorState({
        title: "Não foi possível carregar as lojas",
        message: "Verifique sua conexão e tente novamente.",
        retry: () => {
          replaceMain(root, main(loadingState("Carregando lojas…")));
          void load();
        },
      })));
    }
  };
  void load();
  return root;
}

const NICHES = ["Restaurantes", "Hamburguerias", "Pizzarias", "Açaíterias", "Padarias", "Mercados", "Lanchonetes", "Docerias", "Marmitarias", "Petiscos e bebidas"];
const BENEFITS = [
  ["Margem preservada", "Receba o valor dos pedidos sem uma taxa por venda corroendo o resultado."],
  ["Link da sua loja", "Divulgue uma vitrine pública em redes sociais, WhatsApp, Google e materiais físicos."],
  ["Fila de pedidos", "Acompanhe status, histórico e próximas ações em um único painel."],
  ["Entrega por região", "Defina bairros, taxas, pedido mínimo e tempo estimado."],
  ["Cupons controlados", "Crie descontos com validade, limite de uso e pedido mínimo, conforme o plano."],
  ["Base de clientes", "Entenda histórico, ticket médio e dados úteis para relacionamento."],
];
const PARTNER_STEPS = [
  ["01", "Configure a loja", "Cadastre horários, pagamentos, entrega, retirada e identidade visual."],
  ["02", "Monte o cardápio", "Organize categorias, produtos, fotos, promoções e adicionais."],
  ["03", "Venda no link público", "O cliente monta o carrinho e confirma o pedido pelo celular."],
  ["04", "Acompanhe no painel", "Sua equipe recebe o pedido e atualiza cada etapa com clareza."],
  ["05", "Meça e ajuste", "Relatórios ajudam a melhorar produtos, atendimento e operação."],
];

function partnerHost(ctx) {
  const hostname = String(ctx?.location?.hostname || globalThis.location?.hostname || "").toLocaleLowerCase("pt-BR");
  return hostname.startsWith("parceiros.");
}

function deliveryHref(ctx, path = "/") {
  const hostname = String(ctx?.location?.hostname || globalThis.location?.hostname || "").toLocaleLowerCase("pt-BR");
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || !hostname) return path;
  return `https://hypedelivery.com.br${path.startsWith("/") ? path : `/${path}`}`;
}

function planFeatures(plan) {
  const list = [
    Number(plan.max_products) > 0 ? `${plan.max_products} produtos` : "Produtos ilimitados",
    Number(plan.max_orders_per_month) > 0 ? `${plan.max_orders_per_month} pedidos por mês` : "Pedidos ilimitados",
    "Link público",
    "Gestão de produtos",
  ];
  if (plan.allows_coupons) list.push("Cupons");
  if (plan.allows_advanced_reports) list.push("Relatórios completos");
  if (plan.allows_custom_branding) list.push("Personalização visual");
  return list;
}

function plansSection(ctx, plans) {
  const grid = h("div", { className: "vxp-grid" });
  plans.forEach((plan, index) => {
    const price = Number(plan.price_monthly) > 0 ? `${money(ctx, plan.price_monthly)} / mês` : "Sob consulta";
    grid.append(h("article", { className: `vxp-card vxp-card__body vxp-stack ${index === 1 ? "vxp-card--accent" : ""}`.trim() },
      index === 1 ? h("span", { className: "vxp-badge vxp-badge--success", text: "Mais escolhido" }) : null,
      h("h3", { className: "vxp-title vxp-title--sm", text: plan.name }),
      plan.description ? h("p", { className: "vxp-small vxp-muted", text: plan.description }) : null,
      h("strong", { className: "vxp-landing-price", text: price }),
      h("ul", { className: "vxp-feature-list" }, planFeatures(plan).map((feature) => h("li", { text: feature }))),
      navLink(ctx, "/cadastrar-loja", Number(plan.price_monthly) > 0 ? `Assinar ${plan.name}` : "Falar com vendas", `vxp-btn ${index === 1 ? "" : "vxp-btn--secondary"}`.trim()),
    ));
  });
  return h("section", { id: "planos", className: "vxp-landing-section", "aria-labelledby": "plans-title" },
    h("div", { className: "vxp-shell vxp-stack vxp-stack--lg" },
      h("div", { className: "vxp-stack vxp-stack--xs" },
        h("p", { className: "vxp-eyebrow", text: "Planos" }),
        h("h2", { id: "plans-title", className: "vxp-title", text: "Custo previsível para vender com independência." }),
        h("p", { className: "vxp-subtitle", text: "Escolha uma capacidade compatível com a sua operação e mude conforme a loja crescer." }),
      ),
      plans.length ? grid : alertBox("Os planos não estão disponíveis agora. Você ainda pode cadastrar a loja e falar com a equipe.", "warning"),
    ),
  );
}

export function renderPartnerLanding(ctx) {
  const root = createPage(ctx, { className: "vxp-landing", label: "Portal de lojas parceiras Hype Delivery" });
  const deliveryUrl = deliveryHref(ctx, "/lojas");
  const deliveryLink = /^https?:/i.test(deliveryUrl)
    ? safeExternalLink(deliveryUrl, "Ver delivery", "vxp-btn vxp-btn--secondary")
    : navLink(ctx, deliveryUrl, "Ver delivery", "vxp-btn vxp-btn--secondary");
  const partnerBrand = brandLink(ctx, partnerHost(ctx) ? "/" : "/vendas", "Hype Delivery", "vxp-brand vxp-grow");
  const header = h("header", { className: "vxp-header" },
    h("nav", { className: "vxp-shell vxp-header__inner", "aria-label": "Navegação principal" },
      partnerBrand,
      h("div", { className: "vxp-landing-nav" },
        h("a", { href: "#beneficios", text: "Benefícios" }),
        h("a", { href: "#como-funciona", text: "Como funciona" }),
        h("a", { href: "#planos", text: "Planos" }),
      ),
      navLink(ctx, "/lojista/entrar", "Entrar", "vxp-btn vxp-btn--ghost vxp-btn--compact"),
      navLink(ctx, "/cadastrar-loja", "Abrir loja", "vxp-btn vxp-btn--compact"),
    ),
  );
  const hero = h("section", { className: "vxp-landing-hero", "aria-labelledby": "partner-title" },
    h("div", { className: "vxp-shell vxp-landing-hero__grid" },
      h("div", { className: "vxp-stack vxp-stack--lg" },
        h("span", { className: "vxp-badge vxp-badge--success", text: "Portal exclusivo para lojas parceiras" }),
        h("h1", { id: "partner-title", className: "vxp-landing-headline", text: "Delivery Hype para lojas que querem vender direto." }),
        h("p", { className: "vxp-subtitle", text: "Crie, configure e administre sua operação em um portal próprio. O cliente encontra cardápio, checkout, pagamento, entrega e acompanhamento em um fluxo completo." }),
        h("div", { className: "vxp-row vxp-row--wrap" }, navLink(ctx, "/cadastrar-loja", "Cadastrar loja parceira", "vxp-btn"), deliveryLink),
        h("ul", { className: "vxp-landing-proof" },
          h("li", { text: "Ambiente exclusivo para parceiros" }),
          h("li", { text: "Delivery público separado" }),
          h("li", { text: "Fluxo de ponta a ponta" }),
        ),
      ),
      imageOrFallback({ src: "/brand/hype-delivery-brand.webp", alt: "Hype Delivery", className: "vxp-landing-hero__image", fallback: "HYPE", eager: true, width: 768, height: 768 }),
    ),
  );
  const niches = h("section", { id: "nichos", className: "vxp-landing-section", "aria-labelledby": "niches-title" },
    h("div", { className: "vxp-shell vxp-stack vxp-stack--lg" },
      h("div", { className: "vxp-stack vxp-stack--xs" }, h("p", { className: "vxp-eyebrow", text: "Segmentos" }), h("h2", { id: "niches-title", className: "vxp-title", text: "Feito para negócios que precisam vender com agilidade." }), h("p", { className: "vxp-subtitle", text: "A estrutura atende retirada, entrega própria ou operação híbrida." })),
      h("div", { className: "vxp-niche-grid" }, NICHES.map((niche) => h("div", { className: "vxp-card vxp-card__body vxp-niche", text: niche }))),
    ),
  );
  const benefits = h("section", { id: "beneficios", className: "vxp-landing-section vxp-landing-band", "aria-labelledby": "benefits-title" },
    h("div", { className: "vxp-shell vxp-stack vxp-stack--lg" },
      h("div", { className: "vxp-stack vxp-stack--xs" }, h("p", { className: "vxp-eyebrow", text: "Controle operacional" }), h("h2", { id: "benefits-title", className: "vxp-title", text: "O essencial do delivery em um sistema sob sua marca." }), h("p", { className: "vxp-subtitle", text: "Menos ruído para aceitar pedidos, organizar produtos e entender vendas." })),
      h("div", { className: "vxp-grid" }, BENEFITS.map(([title, description]) => h("article", { className: "vxp-card vxp-card__body vxp-stack vxp-stack--xs" }, h("h3", { text: title }), h("p", { className: "vxp-small vxp-muted", text: description })))),
    ),
  );
  const flow = h("section", { id: "como-funciona", className: "vxp-landing-section", "aria-labelledby": "flow-title" },
    h("div", { className: "vxp-shell vxp-stack vxp-stack--lg" },
      h("div", { className: "vxp-stack vxp-stack--xs" }, h("p", { className: "vxp-eyebrow", text: "Fluxo completo" }), h("h2", { id: "flow-title", className: "vxp-title", text: "Da vitrine ao pedido entregue sem trocar de ferramenta." })),
      h("ol", { className: "vxp-flow-grid" }, PARTNER_STEPS.map(([number, title, description]) => h("li", { className: "vxp-card vxp-card__body vxp-stack vxp-stack--xs" }, h("span", { className: "vxp-eyebrow", text: number }), h("strong", { text: title }), h("p", { className: "vxp-small vxp-muted", text: description })))),
    ),
  );
  const plansMount = h("div", null, loadingState("Carregando planos…"));
  const cta = h("section", { className: "vxp-landing-cta" },
    h("div", { className: "vxp-shell vxp-row vxp-row--between vxp-row--wrap" },
      h("div", { className: "vxp-stack vxp-stack--xs" }, h("p", { className: "vxp-eyebrow", text: "Próximo passo" }), h("h2", { className: "vxp-title", text: "Sua loja pronta para vender direto." })),
      navLink(ctx, "/cadastrar-loja", "Criar loja parceira", "vxp-btn"),
    ),
  );
  const footer = h("footer", { className: "vxp-footer" },
    h("div", { className: "vxp-shell vxp-stack vxp-stack--sm" },
      h("strong", { text: "Hype Delivery" }),
      h("span", { text: "Portal de parceiros e delivery público em ambientes separados." }),
      h("span", { className: "vxp-small", text: `© ${new Date().getFullYear()} Hype Delivery. Todos os direitos reservados.` }),
    ),
  );
  root.append(header, h("main", { id: "main-content", tabindex: "-1" }, hero, niches, benefits, flow, plansMount, cta), footer);

  const loadPlans = async () => {
    try {
      const plans = await unwrap(
        ctx.api.from("plans")
          .select("id, name, description, price_monthly, max_products, max_orders_per_month, allows_coupons, allows_advanced_reports, allows_custom_branding, is_active, sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
      );
      if (!root.pageSignal.aborted) plansMount.replaceChildren(plansSection(ctx, Array.isArray(plans) ? plans : []));
    } catch (error) {
      if (!root.pageSignal.aborted) plansMount.replaceChildren(h("section", { className: "vxp-landing-section" }, h("div", { className: "vxp-shell" }, alertBox(publicError(error, "Não foi possível carregar os planos agora."), "warning"))));
    }
  };
  void loadPlans();
  return root;
}

export function renderDomainHome(ctx) {
  return partnerHost(ctx) ? renderPartnerLanding(ctx) : renderStores(ctx);
}

export const routes = [
  { pattern: "/", title: "Hype Delivery", render: renderDomainHome },
  { pattern: "/lojas", title: "Lojas | Hype Delivery", render: renderStores },
  { pattern: "/vendas", title: "Parceiros | Hype Delivery", render: renderPartnerLanding },
  { pattern: "/vendas/lojas", title: "Lojas | Hype Delivery", render: renderStores },
];
