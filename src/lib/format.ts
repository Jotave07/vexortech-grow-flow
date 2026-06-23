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

const cleanAddressPart = (value: unknown) => String(value ?? "").trim();

const normalizedForCompare = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export const formatDeliveryAddressLines = (order: {
  delivery_address?: string | null;
  delivery_type?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
}) => {
  const address = cleanAddressPart(order?.delivery_address);
  const neighborhood = cleanAddressPart(order?.neighborhood);
  const city = cleanAddressPart(order?.city);
  const state = cleanAddressPart(order?.state).toUpperCase();
  const cityState = [city, state].filter(Boolean).join("/");
  const cep = formatCEP(cleanAddressPart(order?.zip_code));
  const foldedAddress = normalizedForCompare(address);
  const details = [
    neighborhood && !foldedAddress.includes(normalizedForCompare(neighborhood)) ? `Bairro: ${neighborhood}` : "",
    cityState && !foldedAddress.includes(normalizedForCompare(cityState)) ? cityState : "",
    cep ? `CEP: ${cep}` : "",
  ].filter(Boolean);

  if (!address && !details.length) return ["Retirada no local"];
  return [address, details.join(" - ")].filter(Boolean);
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
  aguardando_pagamento: "Aguardando Pagamento",
  confirmado: "Confirmado",
  em_preparo: "Em preparo",
  saiu_para_entrega: "Saiu para entrega",
  pronto_para_retirada: "Pronto para retirada",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

export const STATUS_COLORS: Record<string, string> = {
  novo: "bg-muted text-muted-foreground border-border",
  aguardando_pagamento: "bg-status-amber/10 text-status-amber border-status-amber/20",
  confirmado: "bg-primary/15 text-primary-foreground border-primary/35",
  em_preparo: "bg-primary/15 text-primary-foreground border-primary/35",
  saiu_para_entrega: "bg-muted text-muted-foreground border-border",
  pronto_para_retirada: "bg-muted text-muted-foreground border-border",
  entregue: "bg-primary text-primary-foreground border-primary",
  cancelado: "bg-destructive/10 text-destructive border-destructive/20",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: "PIX",
  dinheiro: "Dinheiro",
  cartao_credito_entrega: "Cartão de Crédito (na entrega)",
  cartao_debito_entrega: "Cartão de Débito (na entrega)",
  cartao_entrega: "Cartão (na entrega)",
};
