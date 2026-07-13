import { describe, expect, it } from "vitest";
import { businessTodayIsoDate, nextFutureMonthlyDueDate } from "./billing-date";

describe("billing civil dates", () => {
  it("uses Sao Paulo's civil day at the UTC date boundary", () => {
    const lateEveningInBrazil = new Date("2026-07-14T02:30:00.000Z");

    expect(businessTodayIsoDate(lateEveningInBrazil)).toBe("2026-07-13");
    expect(nextFutureMonthlyDueDate("2026-07-14", lateEveningInBrazil)).toBe("2026-07-14");
  });

  it("advances an aged ACTIVE replay to a future monthly due date", () => {
    expect(nextFutureMonthlyDueDate("2026-05-31", new Date("2026-07-13T15:00:00.000Z"))).toBe(
      "2026-07-31",
    );
  });

  it("preserves the monthly anchor after a short month", () => {
    expect(nextFutureMonthlyDueDate("2026-01-31", new Date("2026-02-28T15:00:00.000Z"))).toBe(
      "2026-03-31",
    );
  });
});
