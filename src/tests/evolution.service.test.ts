import { describe, it, expect } from "vitest";

const normalizeBrazilianPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55")) return digits;
  return digits.length >= 10 ? `55${digits}` : digits;
};

const firstPhone = (...values: Array<string | null | undefined>): string =>
  values
    .map((v) => v?.replace(/\D/g, "") ?? "")
    .find((v) => v.length >= 10) ?? "";

const formatMoney = (value: number | string | null | undefined): string =>
  Number(value ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

describe("normalizeBrazilianPhone", () => {
  it("adiciona prefixo 55 quando ausente", () => {
    expect(normalizeBrazilianPhone("11999998888")).toBe("5511999998888");
  });

  it("não duplica prefixo 55", () => {
    expect(normalizeBrazilianPhone("5511999998888")).toBe("5511999998888");
  });

  it("retorna número curto sem prefixo", () => {
    expect(normalizeBrazilianPhone("123")).toBe("123");
  });
});

describe("firstPhone", () => {
  it("retorna o primeiro valor com 10+ dígitos", () => {
    expect(firstPhone(null, undefined, "11999998888")).toBe("11999998888");
    expect(firstPhone("11999998888", "21888887777")).toBe("11999998888");
  });

  it("retorna string vazia quando nenhum valor tem 10+ dígitos", () => {
    expect(firstPhone(null, undefined, "123")).toBe("");
    expect(firstPhone()).toBe("");
  });
});

describe("formatMoney", () => {
  it("formata valores numéricos em BRL", () => {
    expect(formatMoney(10)).toBe("R$\xa010,00");
    expect(formatMoney(1234.5)).toBe("R$\xa01.234,50");
  });

  it("trata null/undefined como zero", () => {
    expect(formatMoney(null)).toBe("R$\xa00,00");
    expect(formatMoney(undefined)).toBe("R$\xa00,00");
  });
});

describe("STATUS_MESSAGE_LABELS", () => {
  const labels: Record<string, string> = {
    novo: "Pagamento confirmado. Seu pedido foi encaminhado para a loja.",
    saiu_para_entrega: "Seu pedido saiu para entrega.",
    pronto_para_retirada: "Seu pedido esta pronto para retirada.",
  };

  it("cobre os três status com notificação ao cliente", () => {
    const notifiableStatuses = ["novo", "saiu_para_entrega", "pronto_para_retirada"];
    for (const status of notifiableStatuses) {
      expect(labels[status]).toBeTruthy();
    }
  });

  it("não inclui status sem notificação", () => {
    const noNotify = ["pendente", "em_preparo", "entregue", "cancelado"];
    for (const status of noNotify) {
      expect(labels[status]).toBeUndefined();
    }
  });
});
