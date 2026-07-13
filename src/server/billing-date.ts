export const BILLING_TIME_ZONE = "America/Sao_Paulo";

const dateParts = (value: Date, timeZone = BILLING_TIME_ZONE) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return { year: part("year"), month: part("month"), day: part("day") };
};

export const businessTodayIsoDate = (now = new Date()) => {
  const { year, month, day } = dateParts(now);
  return `${year}-${month}-${day}`;
};

export const normalizeGatewayDate = (value: unknown) => {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = raw ? new Date(raw) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
};

export const nextFutureMonthlyDueDate = (value: unknown, now = new Date()) => {
  const normalized = normalizeGatewayDate(value);
  if (!normalized) return null;
  const today = businessTodayIsoDate(now);
  let [year, month, day] = normalized.split("-").map(Number);
  const anchorDay = day;

  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
      day,
    ).padStart(2, "0")}`;
    if (candidate > today) return candidate;

    const lastDayOfNextMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const nextMonth = new Date(Date.UTC(year, month, 1));
    year = nextMonth.getUTCFullYear();
    month = nextMonth.getUTCMonth() + 1;
    day = Math.min(anchorDay, lastDayOfNextMonth);
  }
  return null;
};
