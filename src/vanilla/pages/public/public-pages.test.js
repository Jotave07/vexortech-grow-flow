import { describe, expect, it } from "vitest";
import { normalizeDocument, validDocument } from "./checkout.js";
import { routes as checkoutRoutes } from "./checkout.js";
import { routes as homeRoutes } from "./home.js";
import { routes as paymentRoutes } from "./payment.js";
import { routes as storeRoutes, storeCanBuildCart } from "./store.js";
import { currentStep, parseOptions } from "./tracking.js";
import { routes as trackingRoutes } from "./tracking.js";

describe("public page domain helpers", () => {
  it("validates CPF and CNPJ check digits", () => {
    expect(validDocument("529.982.247-25")).toBe(true);
    expect(validDocument("04.252.011/0001-10")).toBe(true);
    expect(validDocument("12.ABC.345/01DE-35")).toBe(true);
    expect(normalizeDocument("12.abc.345/01de-35")).toBe("12ABC34501DE35");
    expect(validDocument("111.111.111-11")).toBe(false);
    expect(validDocument("12.ABC.345/01DE-36")).toBe(false);
    expect(validDocument("529.982.247-24")).toBe(false);
    expect(validDocument("")).toBe(true);
  });

  it("keeps tracking progress at the furthest known safe step", () => {
    expect(currentStep("em_preparo", [])).toBe(1);
    expect(currentStep("cancelado", [{ status: "em_preparo" }, { status: "saiu_para_entrega" }])).toBe(2);
    expect(currentStep("desconhecido", [])).toBe(0);
  });

  it("parses only array-shaped item options", () => {
    expect(parseOptions('[{"name":"Extra"}]')).toEqual([{ name: "Extra" }]);
    expect(parseOptions('{"name":"Extra"}')).toEqual([]);
    expect(parseOptions("invalid")).toEqual([]);
  });

  it("preserves every public route and protects checkout", () => {
    const routes = [...homeRoutes, ...storeRoutes, ...checkoutRoutes, ...trackingRoutes, ...paymentRoutes];
    expect(new Set(routes.map((route) => route.pattern))).toEqual(new Set([
      "/", "/lojas", "/vendas", "/vendas/lojas",
      "/loja/:slug", "/vendas/loja/:slug",
      "/loja/:slug/checkout", "/vendas/loja/:slug/checkout",
      "/pedido/:token", "/vendas/pedido/:token",
      "/pedido/:token/sucesso", "/vendas/pedido/:token/sucesso",
      "/pedido/:token/cancelado", "/vendas/pedido/:token/cancelado",
    ]));
    expect(checkoutRoutes.every((route) => route.auth === "customer")).toBe(true);
  });

  it("lets customers build a cart while a healthy store is closed", () => {
    expect(storeCanBuildCart({ is_active: true, is_suspended: false })).toBe(true);
    expect(storeCanBuildCart({ is_active: false, is_suspended: false })).toBe(false);
    expect(storeCanBuildCart({ is_active: true, is_suspended: true })).toBe(false);
  });
});
