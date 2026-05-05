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

export function isStoreOpen(businessHours: BusinessHours, manualStatus?: boolean): boolean {
  if (manualStatus === false) return false;
  if (!businessHours) return false;
  
  const now = new Date();
  const dayName = DAYS_MAP[getDay(now)];
  const config = businessHours[dayName];

  if (!config || !config.enabled) return false;

  const currentTimeStr = format(now, "HH:mm");
  const openTime = config.open;
  const closeTime = config.close;

  if (closeTime < openTime) {
    return currentTimeStr >= openTime || currentTimeStr <= closeTime;
  }

  return currentTimeStr >= openTime && currentTimeStr <= closeTime;
}

export function getNextOpeningTime(businessHours: BusinessHours): string {
  if (!businessHours) return "Indisponível";
  
  const now = new Date();
  const currentDay = getDay(now);

  for (let i = 0; i < 7; i++) {
    const nextDay = (currentDay + i) % 7;
    const dayName = DAYS_MAP[nextDay];
    const config = businessHours[dayName];

    if (config && config.enabled) {
      if (i === 0) {
        const currentTimeStr = format(now, "HH:mm");
        if (config.open > currentTimeStr) {
          return `Hoje às ${config.open}`;
        }
      } else {
        const dayLabel = i === 1 ? "Amanhã" : dayName.charAt(0).toUpperCase() + dayName.slice(1);
        return `${dayLabel} às ${config.open}`;
      }
    }
  }

  return "Indisponível";
}
