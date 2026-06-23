import { format, getDay } from "date-fns";

export type BusinessHours = {
  [key: string]: {
    open: string;
    close: string;
    enabled: boolean;
  };
};

const DAYS_MAP: { [key: number]: string } = {
  0: "sun",
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
};

const DAY_LABELS: Record<string, string> = {
  sun: "Domingo",
  mon: "Segunda",
  tue: "Terça",
  wed: "Quarta",
  thu: "Quinta",
  fri: "Sexta",
  sat: "Sábado",
};

const getBrazilDate = () => new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));

const toMinutes = (time?: string) => {
  const [hours, minutes] = String(time || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

const isWithinRange = (current: number, open: number, close: number) => {
  if (close < open) return current >= open || current <= close;
  return current >= open && current <= close;
};

export function isStoreOpen(businessHours: BusinessHours, manualStatus?: boolean): boolean {
  if (manualStatus === true) return true;
  if (manualStatus === false) return false;
  if (!businessHours) return false;

  const now = getBrazilDate();
  const currentDayIndex = getDay(now);
  const currentTime = toMinutes(format(now, "HH:mm"));
  if (currentTime === null) return false;

  const todayName = DAYS_MAP[currentDayIndex];
  const today = businessHours[todayName];
  const todayOpen = toMinutes(today?.open);
  const todayClose = toMinutes(today?.close);

  if (today?.enabled && todayOpen !== null && todayClose !== null && isWithinRange(currentTime, todayOpen, todayClose)) {
    return true;
  }

  const previousDayName = DAYS_MAP[(currentDayIndex + 6) % 7];
  const previous = businessHours[previousDayName];
  const previousOpen = toMinutes(previous?.open);
  const previousClose = toMinutes(previous?.close);

  return Boolean(
    previous?.enabled &&
    previousOpen !== null &&
    previousClose !== null &&
    previousClose < previousOpen &&
    currentTime <= previousClose,
  );
}

export function getNextOpeningTime(businessHours: BusinessHours): string {
  if (!businessHours) return "Indisponível";

  const now = getBrazilDate();
  const currentDay = getDay(now);
  const currentTime = toMinutes(format(now, "HH:mm")) ?? 0;

  for (let i = 0; i < 7; i++) {
    const nextDay = (currentDay + i) % 7;
    const dayName = DAYS_MAP[nextDay];
    const config = businessHours[dayName];
    const openTime = toMinutes(config?.open);

    if (config?.enabled && openTime !== null) {
      if (i === 0 && openTime <= currentTime) continue;
      const dayLabel = i === 0 ? "Hoje" : i === 1 ? "Amanhã" : DAY_LABELS[dayName];
      return `${dayLabel} às ${config.open}`;
    }
  }

  return "Indisponível";
}
