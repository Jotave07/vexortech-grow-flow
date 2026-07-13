import { ui } from "./ui.js";

const publicNav = [
  ["/lojas", "Lojas"],
  ["/vendas", "Seja parceiro"],
];
const merchantNav = [
  ["/lojista", "Visao geral"],
  ["/lojista/pedidos", "Pedidos"],
  ["/lojista/cardapio", "Cardapio"],
  ["/lojista/categorias", "Categorias"],
  ["/lojista/clientes", "Clientes"],
  ["/lojista/cupons", "Cupons"],
  ["/lojista/entregas", "Entregas"],
  ["/lojista/entregadores", "Entregadores"],
  ["/lojista/relatorios", "Relatorios"],
  ["/lojista/configuracoes", "Configuracoes"],
  ["/lojista/usuarios", "Usuarios"],
  ["/lojista/assinatura", "Assinatura"],
];
const adminNav = [
  ["/admin", "Visao geral"],
  ["/admin/lojas", "Lojas"],
  ["/admin/parceiros", "Parceiros"],
  ["/admin/cadastros", "Cadastros"],
  ["/admin/planos", "Planos"],
  ["/admin/pedidos", "Pedidos"],
  ["/admin/financeiro", "Financeiro"],
  ["/admin/configuracoes", "Configuracoes"],
];

const link = ([href, label], currentPath) => ui.el("a", {
  href,
  class: currentPath === href || (href !== "/" && currentPath.startsWith(`${href}/`)) ? "nav-link is-active" : "nav-link",
  "aria-current": currentPath === href ? "page" : null,
}, label);

const brand = () => ui.el("a", { href: "/", class: "brand", "aria-label": "Hype Delivery - inicio" },
  ui.el("img", { src: "/brand/hype-icon.svg", alt: "", width: "44", height: "44", "aria-hidden": "true" }),
  ui.el("span", {}, "Hype Delivery"),
);

const publicHeader = (ctx) => ui.el("header", { class: "site-header" },
  ui.el("div", { class: "container site-header__inner" },
    brand(),
    ui.el("nav", { class: "site-nav", "aria-label": "Navegacao principal" }, publicNav.map((item) => link(item, ctx.path))),
    ui.el("div", { class: "site-header__actions" },
      ctx.auth.session
        ? ui.button("Minha conta", { variant: "secondary", onClick: () => ctx.navigate(ctx.auth.role === "store_owner" ? "/lojista" : ctx.auth.role === "super_admin" ? "/admin" : "/cliente") })
        : ui.button("Entrar", { variant: "secondary", onClick: () => ctx.navigate("/entrar") }),
    ),
  ),
);

const panelShell = (ctx, content, kind) => {
  const navigation = kind === "admin" ? adminNav : merchantNav;
  const title = kind === "admin" ? "Administracao" : (ctx.auth.store?.name || "Painel da loja");
  const sidebar = ui.el("aside", { id: "panel-sidebar", class: "panel-sidebar", "aria-label": title },
    brand(),
    ui.el("p", { class: "panel-sidebar__eyebrow", text: title }),
    ui.el("nav", { class: "panel-nav" }, navigation.map((item) => link(item, ctx.path))),
    ui.button("Sair", { variant: "ghost", onClick: async () => { await ctx.auth.signOut(); ctx.navigate("/"); } }),
  );
  const backdrop = ui.el("button", {
    type: "button",
    class: "panel-backdrop",
    "aria-label": "Fechar menu",
    tabindex: "-1",
  });
  let shell;
  const closeMenu = ({ restoreFocus = false } = {}) => {
    sidebar.classList.remove("is-open");
    shell?.classList.remove("is-menu-open");
    toggle.setAttribute("aria-expanded", "false");
    backdrop.setAttribute("tabindex", "-1");
    if (restoreFocus) toggle.focus();
  };
  const openMenu = () => {
    sidebar.classList.add("is-open");
    shell?.classList.add("is-menu-open");
    toggle.setAttribute("aria-expanded", "true");
    backdrop.setAttribute("tabindex", "0");
    sidebar.querySelector("a, button")?.focus();
  };
  const toggle = ui.button("Menu", {
    variant: "secondary",
    ariaLabel: "Abrir ou fechar menu",
    onClick: () => {
      if (sidebar.classList.contains("is-open")) closeMenu();
      else openMenu();
    },
  });
  toggle.classList.add("panel-menu-toggle");
  toggle.setAttribute("aria-controls", "panel-sidebar");
  toggle.setAttribute("aria-expanded", "false");
  backdrop.addEventListener("click", () => closeMenu({ restoreFocus: true }));
  sidebar.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });
  sidebar.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
      return;
    }
    if (event.key !== "Tab" || !sidebar.classList.contains("is-open") || !globalThis.matchMedia?.("(max-width: 60rem)").matches) return;
    const focusable = [...sidebar.querySelectorAll("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])")];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  shell = ui.el("div", { class: "panel-shell" }, sidebar, backdrop,
    ui.el("div", { class: "panel-main" },
      ui.el("header", { class: "panel-topbar" }, toggle, ui.el("strong", { text: title })),
      ui.el("main", { id: "main-content", class: "panel-content", tabindex: "-1" }, content),
    ),
  );
  return shell;
};

const publicShell = (ctx, content) => ui.el("div", { class: "site-shell" },
  publicHeader(ctx),
  ui.el("main", { id: "main-content", tabindex: "-1" }, content),
  ui.el("footer", { class: "site-footer" },
    ui.el("div", { class: "container site-footer__inner" },
      ui.el("span", { text: `© ${new Date().getFullYear()} Hype Delivery` }),
      ui.el("nav", { "aria-label": "Informacoes legais" },
        ui.el("a", { href: "/termos" }, "Termos"), ui.el("a", { href: "/privacidade" }, "Privacidade"),
      ),
    ),
  ),
);

export const applyLayout = (ctx, content, route) => {
  const layout = route.layout || (ctx.path.startsWith("/admin") && ctx.path !== "/admin/entrar"
    ? "admin"
    : ctx.path.startsWith("/lojista") && ctx.path !== "/lojista/entrar"
      ? "merchant"
      : "public");
  if (layout === "none") return content;
  if (layout === "admin" || layout === "merchant") return panelShell(ctx, content, layout);
  return publicShell(ctx, content);
};
