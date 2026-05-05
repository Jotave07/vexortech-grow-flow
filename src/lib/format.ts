export const formatBRL = (value: number | null | undefined) => {
  const v = Number(value ?? 0);
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

export const formatPhone = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return phone;
};

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

export const onlyDigits = (s: string) => s.replace(/\D/g, "");

export const buildWhatsAppLink = (phone: string, message: string) => {
  const digits = onlyDigits(phone);
  const num = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
};

export const STATUS_LABELS: Record<string, string> = {
  novo: "Novo",
  confirmado: "Confirmado",
  em_preparo: "Em preparo",
  saiu_para_entrega: "Saiu para entrega",
  pronto_para_retirada: "Pronto para retirada",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

export const STATUS_COLORS: Record<string, string> = {
  novo: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  confirmado: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  em_preparo: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  saiu_para_entrega: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  pronto_para_retirada: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  entregue: "bg-green-500/10 text-green-500 border-green-500/20",
  cancelado: "bg-red-500/10 text-red-500 border-red-500/20",
};
