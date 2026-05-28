import { describe, expect, it } from "vitest";
import { getStoreProfileVerification, getUserProfileVerification } from "./profile-verification";

describe("profile verification", () => {
  it("marks complete store profiles without letting them claim admin verification", () => {
    const result = getStoreProfileVerification(
      {
        name: "Loja QA",
        public_name: "Loja QA",
        document: "12.345.678/0001-90",
        whatsapp: "(11) 99999-9999",
        address: "Rua Teste",
        address_number: "10",
        neighborhood: "Centro",
        city: "Sao Paulo",
        state: "SP",
        zip_code: "01001-000",
        logo_url: "https://example.com/logo.png",
        cover_url: "https://example.com/cover.png",
        description: "Cardapio completo",
      },
      { allow_delivery: true, avg_prep_time_minutes: 30, accept_pix: true, pix_key: "pix@example.com" },
    );

    expect(result.score).toBe(100);
    expect(result.status).toBe("complete");
    expect(result.label).toBe("Perfil completo");
  });

  it("prioritizes platform verification when available", () => {
    const result = getStoreProfileVerification({ name: "Loja QA", is_verified: true });

    expect(result.status).toBe("verified");
    expect(result.label).toBe("Verificada");
  });

  it("scores customer profile completion", () => {
    const result = getUserProfileVerification(
      {
        full_name: "Cliente QA",
        phone: "(11) 99999-9999",
        document: "123.456.789-01",
        zip_code: "01001-000",
        street: "Rua Teste",
        number: "10",
        neighborhood: "Centro",
        city: "Sao Paulo",
        state: "SP",
      },
      { email: "cliente@example.com" },
    );

    expect(result.score).toBe(100);
    expect(result.label).toBe("Perfil verificado");
  });
});
