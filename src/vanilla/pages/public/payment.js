import {
  alertBox,
  createPage,
  emptyState,
  h,
  loadingState,
  main,
  money,
  navLink,
  publicError,
  replaceMain,
  routeParam,
  salesPath,
  shellHeader,
  unwrap,
} from "./shared.js";

const POLL_DELAY = 2500;
const MAX_POLLS = 24;
const FINAL_PAYMENT_STATUSES = new Set(["pago", "falhou", "cancelado", "expirado"]);

function paymentResult(ctx, order, token, attempts, retry) {
  const status = String(order.payment_status || "").toLocaleLowerCase("pt-BR");
  const paid = status === "pago";
  const failed = ["falhou", "cancelado", "expirado"].includes(status);
  const pending = !paid && !failed;
  const tone = paid ? "success" : failed ? "error" : "warning";
  const icon = paid ? "✓" : failed ? "!" : "◷";
  const title = paid ? "Pagamento confirmado" : failed ? "Pagamento não confirmado" : "Confirmando pagamento";
  const description = paid
    ? `O pedido #${order.order_number || "—"} foi recebido pela loja.`
    : failed
      ? "Confira o acompanhamento antes de tentar pagar novamente. O status exibido lá é a referência oficial."
      : "A confirmação costuma levar alguns segundos. Você pode manter esta página aberta ou acompanhar o pedido.";
  const card = h("section", { className: "vxp-card vxp-card__body vxp-stack vxp-stack--lg", "aria-labelledby": "payment-result-title" },
    h("div", { className: "vxp-state__inner" },
      h("span", { className: "vxp-state__icon", ariaHidden: "true", text: icon }),
      h("h1", { id: "payment-result-title", className: "vxp-title vxp-title--sm", text: title }),
      h("p", { className: "vxp-muted", text: description }),
    ),
    alertBox(paid ? "Pagamento aprovado. O preparo pode começar." : failed ? "Não faça um novo pagamento sem conferir o pedido." : "Aguardando retorno seguro do provedor de pagamento.", tone),
    h("div", { className: "vxp-summary" }, h("div", { className: "vxp-summary__line vxp-summary__line--total" }, h("span", { text: "Total" }), h("span", { text: money(ctx, order.total) }))),
    pending && attempts >= MAX_POLLS ? h("div", { className: "vxp-stack vxp-stack--sm" },
      h("p", { className: "vxp-small vxp-muted", text: "A confirmação está demorando mais que o normal. O pedido continuará atualizando no acompanhamento." }),
      h("button", { type: "button", className: "vxp-btn vxp-btn--secondary", text: "Verificar novamente", onClick: retry }),
    ) : null,
    navLink(ctx, salesPath(ctx, `/pedido/${encodeURIComponent(token)}`), "Acompanhar pedido", "vxp-btn vxp-btn--wide"),
  );
  return main(h("div", { className: "vxp-shell--narrow" }, card), "vxp-main");
}

export function renderPaymentSuccess(ctx) {
  const token = routeParam(ctx, "token");
  const root = createPage(ctx, { label: "Retorno do pagamento" });
  root.append(shellHeader(ctx, { title: "Pagamento", compact: true }), main(loadingState("Confirmando pagamento…")));
  if (!token || token === "undefined" || token.length > 180) {
    replaceMain(root, main(emptyState({ iconText: "!", title: "Link incompleto", message: "O retorno do pagamento não contém um pedido válido." })));
    return root;
  }
  let timer = 0;
  let attempts = 0;
  let stopped = false;

  const tick = async (reset = false) => {
    if (reset) {
      attempts = 0;
      stopped = false;
      replaceMain(root, main(loadingState("Confirmando pagamento…")));
    }
    if (root.pageSignal.aborted || stopped) return;
    attempts += 1;
    try {
      const rows = await unwrap(ctx.api.rpc("get_public_order", { _token: token }));
      const order = Array.isArray(rows) ? rows[0] : rows;
      if (!order) {
        if (attempts < 4) {
          timer = globalThis.setTimeout(tick, POLL_DELAY);
          return;
        }
        replaceMain(root, main(emptyState({
          iconText: "○",
          title: "Pedido não encontrado",
          message: "O retorno pode estar incompleto. Abra o link de acompanhamento recebido no checkout.",
          action: h("button", { type: "button", className: "vxp-btn vxp-btn--secondary", text: "Tentar novamente", onClick: () => void tick(true) }),
        })));
      } else {
        replaceMain(root, paymentResult(ctx, order, token, attempts, () => void tick(true)));
        const status = String(order.payment_status || "").toLocaleLowerCase("pt-BR");
        if (FINAL_PAYMENT_STATUSES.has(status) || attempts >= MAX_POLLS) {
          stopped = true;
          return;
        }
        timer = globalThis.setTimeout(tick, POLL_DELAY);
      }
    } catch (error) {
      if (attempts >= 3) {
        replaceMain(root, main(h("div", { className: "vxp-shell--narrow" },
          h("section", { className: "vxp-card vxp-card__body vxp-stack" },
            alertBox(publicError(error, "Não foi possível confirmar o pagamento agora."), "warning"),
            navLink(ctx, salesPath(ctx, `/pedido/${encodeURIComponent(token)}`), "Ver status do pedido", "vxp-btn"),
          ),
        ), "vxp-main"));
        stopped = true;
      } else timer = globalThis.setTimeout(tick, POLL_DELAY);
    }
  };
  root.addCleanup(() => { stopped = true; globalThis.clearTimeout(timer); });
  void tick();
  return root;
}

export function renderPaymentCancelled(ctx) {
  const token = routeParam(ctx, "token");
  const root = createPage(ctx, { label: "Pagamento interrompido" });
  root.append(shellHeader(ctx, { title: "Pagamento", compact: true }));
  const valid = token && token !== "undefined" && token.length <= 180;
  const card = h("section", { className: "vxp-card vxp-card__body vxp-stack vxp-stack--lg", "aria-labelledby": "payment-cancelled-title" },
    h("div", { className: "vxp-state__inner" },
      h("span", { className: "vxp-state__icon", ariaHidden: "true", text: "×" }),
      h("h1", { id: "payment-cancelled-title", className: "vxp-title vxp-title--sm", text: "Pagamento interrompido" }),
      h("p", { className: "vxp-muted", text: "A tela do provedor foi cancelada ou fechada. O pedido pode continuar aguardando pagamento." }),
    ),
    alertBox("Antes de pagar outra vez, confira o status oficial do pedido para evitar cobrança duplicada.", "warning"),
    valid ? navLink(ctx, salesPath(ctx, `/pedido/${encodeURIComponent(token)}`), "Conferir status do pedido", "vxp-btn vxp-btn--wide") : navLink(ctx, salesPath(ctx, "/lojas"), "Voltar às lojas", "vxp-btn vxp-btn--wide"),
  );
  root.append(main(h("div", { className: "vxp-shell--narrow" }, card), "vxp-main"));
  return root;
}

export const routes = [
  { pattern: "/pedido/:token/sucesso", title: "Pagamento | Hype Delivery", render: renderPaymentSuccess },
  { pattern: "/vendas/pedido/:token/sucesso", title: "Pagamento | Hype Delivery", render: renderPaymentSuccess },
  { pattern: "/pedido/:token/cancelado", title: "Pagamento interrompido | Hype Delivery", render: renderPaymentCancelled },
  { pattern: "/vendas/pedido/:token/cancelado", title: "Pagamento interrompido | Hype Delivery", render: renderPaymentCancelled },
];
