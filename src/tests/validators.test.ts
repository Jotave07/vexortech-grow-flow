import { describe, it, expect } from "vitest";
import {
  isValidCPF,
  isValidCNPJ,
  isValidDocument,
  formatCPF,
  formatCNPJ,
  formatDocument,
  normalizeDocument,
} from "@/lib/validators";

describe("isValidCPF", () => {
  it("aceita CPFs válidos", () => {
    expect(isValidCPF("529.982.247-25")).toBe(true);
    expect(isValidCPF("52998224725")).toBe(true);
    expect(isValidCPF("111.444.777-35")).toBe(true);
  });

  it("rejeita sequências triviais", () => {
    expect(isValidCPF("000.000.000-00")).toBe(false);
    expect(isValidCPF("111.111.111-11")).toBe(false);
    expect(isValidCPF("999.999.999-99")).toBe(false);
  });

  it("rejeita CPFs com dígito verificador errado", () => {
    expect(isValidCPF("529.982.247-26")).toBe(false);
    expect(isValidCPF("529.982.247-00")).toBe(false);
  });

  it("rejeita entradas com menos de 11 dígitos", () => {
    expect(isValidCPF("529.982.247")).toBe(false);
    expect(isValidCPF("123")).toBe(false);
  });
});

describe("isValidCNPJ", () => {
  it("aceita CNPJs válidos", () => {
    expect(isValidCNPJ("11.222.333/0001-81")).toBe(true);
    expect(isValidCNPJ("11222333000181")).toBe(true);
    expect(isValidCNPJ("45.283.163/0001-67")).toBe(true);
    expect(isValidCNPJ("12.ABC.345/01DE-35")).toBe(true);
  });

  it("rejeita sequências triviais", () => {
    expect(isValidCNPJ("00.000.000/0000-00")).toBe(false);
    expect(isValidCNPJ("11.111.111/1111-11")).toBe(false);
  });

  it("rejeita CNPJs com dígito verificador errado", () => {
    expect(isValidCNPJ("11.222.333/0001-82")).toBe(false);
    expect(isValidCNPJ("45.283.163/0001-68")).toBe(false);
    expect(isValidCNPJ("12.ABC.345/01DE-36")).toBe(false);
  });

  it("rejeita entradas com menos de 14 dígitos", () => {
    expect(isValidCNPJ("11.222.333/0001")).toBe(false);
  });
});

describe("isValidDocument", () => {
  it("delega para CPF quando há 11 dígitos", () => {
    expect(isValidDocument("529.982.247-25")).toBe(true);
    expect(isValidDocument("529.982.247-26")).toBe(false);
  });

  it("delega para CNPJ quando há 14 dígitos", () => {
    expect(isValidDocument("11.222.333/0001-81")).toBe(true);
    expect(isValidDocument("11.222.333/0001-82")).toBe(false);
  });
});

describe("formatCPF", () => {
  it("formata corretamente", () => {
    expect(formatCPF("52998224725")).toBe("529.982.247-25");
    expect(formatCPF("529.982.247-25")).toBe("529.982.247-25");
  });

  it("trunca em 11 dígitos", () => {
    expect(formatCPF("529982247251234")).toBe("529.982.247-25");
  });
});

describe("formatCNPJ", () => {
  it("formata corretamente", () => {
    expect(formatCNPJ("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatCNPJ("11.222.333/0001-81")).toBe("11.222.333/0001-81");
    expect(formatCNPJ("12abc34501de35")).toBe("12.ABC.345/01DE-35");
  });
});

describe("normalizeDocument", () => {
  it("preserva letras do CNPJ alfanumerico e remove apenas a mascara", () => {
    expect(normalizeDocument("12.Abc.345/01de-35")).toBe("12ABC34501DE35");
  });
});

describe("formatDocument", () => {
  it("detecta CPF vs CNPJ", () => {
    expect(formatDocument("52998224725")).toBe("529.982.247-25");
    expect(formatDocument("11222333000181")).toBe("11.222.333/0001-81");
  });
});
