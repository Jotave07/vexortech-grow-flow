import { describe, expect, it } from "vitest";
import { formatCep, isValidCep, normalizeCep } from "./zipCode";

describe("zip code helpers", () => {
  it("normalizes and formats valid Brazilian CEP values", () => {
    expect(normalizeCep("01001-000")).toBe("01001000");
    expect(formatCep("01001000")).toBe("01001-000");
    expect(isValidCep("01001-000")).toBe(true);
  });

  it("rejects malformed and repeated CEP values", () => {
    expect(isValidCep("123")).toBe(false);
    expect(isValidCep("00000-000")).toBe(false);
    expect(isValidCep("11111-111")).toBe(false);
  });
});
