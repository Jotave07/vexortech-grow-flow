import { describe, expect, it } from "vitest";
import { buildWhatsAppLink, formatBRL, formatCEP, formatDoc, slugify } from "./format";

describe("format helpers", () => {
  it("formats Brazilian currency, documents and CEP", () => {
    expect(formatBRL(12.5)).toContain("12,50");
    expect(formatBRL(12.5)).toContain("R$");
    expect(formatDoc("12345678901")).toBe("123.456.789-01");
    expect(formatDoc("12345678000199")).toBe("12.345.678/0001-99");
    expect(formatCEP("01001000")).toBe("01001-000");
  });

  it("normalizes slugs without corrupting accents", () => {
    expect(slugify("Ação São Paulo Área Configurações")).toBe(
      "acao-sao-paulo-area-configuracoes",
    );
  });

  it("keeps accented WhatsApp messages recoverable after URL encoding", () => {
    const message = "Olá João, sua Ação em São Paulo tem Informações de Endereço.";
    const link = buildWhatsAppLink("(11) 98765-4321", message);

    expect(new URL(link).searchParams.get("text")).toBe(message);
  });
});
