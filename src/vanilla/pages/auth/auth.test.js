import { describe, expect, it } from "vitest";
import { routes } from "./index.js";
import {
  isValidDocument,
  nextPathForRole,
  normalizeDocument,
  safeInternalRedirect,
  slugify,
  validateOnboarding,
} from "./validation.js";

describe("contrato das rotas de autenticacao vanilla", () => {
  it("preserva todas as rotas publicas e protege o onboarding", () => {
    expect(routes.map((route) => route.pattern)).toEqual([
      "/entrar",
      "/cadastrar",
      "/recuperar-senha",
      "/redefinir-senha",
      "/lojista/entrar",
      "/cadastrar-loja",
      "/admin/entrar",
      "/onboarding",
    ]);
    expect(routes.find((route) => route.pattern === "/onboarding")?.auth).toBe("store_owner");
    expect(routes.every((route) => typeof route.render === "function" && route.title)).toBe(true);
  });

  it("bloqueia redirecionamentos externos e separa papeis", () => {
    expect(safeInternalRedirect("https://evil.test/admin")).toBeNull();
    expect(safeInternalRedirect("//evil.test/admin")).toBeNull();
    expect(safeInternalRedirect("/lojista/pedidos", null, "/lojista")).toBe("/lojista/pedidos");
    expect(safeInternalRedirect("/admin", null, "/lojista")).toBeNull();
    expect(nextPathForRole("customer", "/lojas", "customer")).toBe("/lojas");
    expect(nextPathForRole("customer", null, "merchant")).toBeNull();
    expect(nextPathForRole("super_admin", null, "admin")).toBe("/admin");
  });
});

describe("validacao nativa de cadastro", () => {
  it("valida CPF/CNPJ e normaliza slug sem bibliotecas", () => {
    expect(isValidDocument("529.982.247-25")).toBe(true);
    expect(isValidDocument("04.252.011/0001-10")).toBe(true);
    expect(isValidDocument("12.ABC.345/01DE-35")).toBe(true);
    expect(isValidDocument("111.111.111-11")).toBe(false);
    expect(normalizeDocument("12.Abc.345/01de-35")).toBe("12ABC34501DE35");
    expect(slugify("  Acaí & Café do João  ")).toBe("acai-cafe-do-joao");
  });

  it("retorna erro acionavel no primeiro campo invalido do onboarding", () => {
    const valid = {
      name: "Loja Hype",
      slug: "loja-hype",
      whatsapp: "11999999999",
      document: "52998224725",
      city: "Sao Paulo",
      state: "SP",
      description: "",
    };
    expect(validateOnboarding(valid)).toBeNull();
    expect(validateOnboarding({ ...valid, slug: "URL invalida" })).toEqual(
      expect.objectContaining({ field: "slug" }),
    );
    expect(validateOnboarding({ ...valid, state: "S" })).toEqual(
      expect.objectContaining({ field: "state" }),
    );
  });
});
