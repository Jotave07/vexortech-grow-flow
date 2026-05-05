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
  
  // Usar fuso horário de Brasília (BRT) para garantir consistência
  // Independentemente de onde o dispositivo do cliente esteja
  const now = new Date();
  const brTime = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "long"
  }).formatToParts(now);

  const getPart = (type: string) => brTime.find(p => p.type === type)?.value;
  const hour = getPart("hour");
  const minute = getPart("minute");
  const currentTimeStr = `${hour}:${minute}`;
  
  // Mapeamento de dia da semana do Intl para o nosso DAYS_MAP
  const weekday = getPart("weekday")?.toLowerCase() || "";
  let dayName = "mon";
  if (weekday.includes("domingo")) dayName = "sun";
  else if (weekday.includes("segunda")) dayName = "mon";
  else if (weekday.includes("terça")) dayName = "tue";
  else if (weekday.includes("quarta")) dayName = "wed";
  else if (weekday.includes("quinta")) dayName = "thu";
  else if (weekday.includes("sexta")) dayName = "fri";
  else if (weekday.includes("sábado")) dayName = "sat";

  const config = businessHours[dayName];

  if (!config || !config.enabled) return false;

  const openTime = config.open;
  const closeTime = config.close;

  // Lógica para horários que atravessam a meia-noite (ex: 18:00 às 02:00)
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
