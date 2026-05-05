export const formatBRL = (value: number | null | undefined) => {
  const v = Number(value ?? 0);
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

export const formatPhone = (phone: string | null | undefined) => {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return phone;
};

export const formatCPF = (cpf: string | null | undefined) => {
  if (!cpf) return "";
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return cpf;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

export const formatCNPJ = (cnpj: string | null | undefined) => {
  if (!cnpj) return "";
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return cnpj;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};

export const formatCEP = (cep: string | null | undefined) => {
  if (!cep) return "";
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) return cep;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};

export const formatDoc = (doc: string | null | undefined) => {
  if (!doc) return "";
  const digits = doc.replace(/\D/g, "");
  if (digits.length === 11) return formatCPF(digits);
  if (digits.length === 14) return formatCNPJ(digits);
  return doc;
};

export const formatCurrency = (value: number | string | null | undefined) => {
  const v = Number(value ?? 0);
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

export const formatDate = (date: string | Date | null | undefined) => {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("pt-BR");
};

export const formatDateTime = (date: string | Date | null | undefined) => {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
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
