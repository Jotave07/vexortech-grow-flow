import { describe, it, expect } from "vitest";
import {
  calcularValorRepasse,
  calcularTaxaPlataforma,
  toCents,
  toReais,
  moneyEquals,
} from "./financial.calc";

describe("toCents/toReais", () => {
  it("converte sem erro de float binario", () => {
    expect(toCents(0.1 + 0.2)).toBe(30); // 0.30000000000000004 -> 30
    expect(toCents("19.99")).toBe(1999);
    expect(toReais(1999)).toBe(19.99);
    expect(toCents(null)).toBe(0);
  });
});

describe("calcularValorRepasse", () => {
  it("aplica taxa percentual + fixa", () => {
    const r = calcularValorRepasse({
      totalPaid: 100,
      taxaPercentual: 10,
      taxaFixa: 1,
    });
    expect(r.baseAmount).toBe(100);
    expect(r.feePercentAmount).toBe(10);
    expect(r.feeFixedAmount).toBe(1);
    expect(r.platformFee).toBe(11);
    expect(r.transferAmount).toBe(89);
    expect(r.blocked).toBe(false);
  });

  it("desconta reembolso da base", () => {
    const r = calcularValorRepasse({
      totalPaid: 100,
      refundedAmount: 40,
      taxaPercentual: 10,
      taxaFixa: 0,
    });
    expect(r.baseAmount).toBe(60);
    expect(r.platformFee).toBe(6);
    expect(r.transferAmount).toBe(54);
  });

  it("bloqueia quando repasse <= 0", () => {
    const r = calcularValorRepasse({
      totalPaid: 5,
      taxaPercentual: 0,
      taxaFixa: 5,
    });
    expect(r.transferAmount).toBe(0);
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toBeTruthy();
  });

  it("bloqueia quando reembolso zera a base", () => {
    const r = calcularValorRepasse({
      totalPaid: 50,
      refundedAmount: 50,
      taxaPercentual: 10,
    });
    expect(r.baseAmount).toBe(0);
    expect(r.transferAmount).toBe(0);
    expect(r.blocked).toBe(true);
  });

  it("arredonda taxa percentual ao centavo", () => {
    // 33.33 * 8.5% = 2.83305 -> 2.83
    const r = calcularValorRepasse({ totalPaid: 33.33, taxaPercentual: 8.5 });
    expect(r.feePercentAmount).toBe(2.83);
    expect(r.transferAmount).toBe(30.5);
  });

  it("sem taxas devolve o total integral", () => {
    const r = calcularValorRepasse({ totalPaid: 75.4 });
    expect(r.transferAmount).toBe(75.4);
    expect(r.platformFee).toBe(0);
    expect(r.blocked).toBe(false);
  });
});

describe("calcularTaxaPlataforma", () => {
  it("calcula sobre o total integral (sem reembolso)", () => {
    const r = calcularTaxaPlataforma({ totalPaid: 200, taxaPercentual: 5, taxaFixa: 2 });
    expect(r.feePercentAmount).toBe(10);
    expect(r.feeFixedAmount).toBe(2);
    expect(r.platformFee).toBe(12);
  });
});

describe("moneyEquals", () => {
  it("tolera 1 centavo", () => {
    expect(moneyEquals(10.0, 10.009)).toBe(true);
    expect(moneyEquals(10.0, 10.02)).toBe(false);
    expect(moneyEquals("99.90", 99.9)).toBe(true);
  });
});
