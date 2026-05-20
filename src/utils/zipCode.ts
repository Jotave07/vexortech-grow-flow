export const normalizeCep = (cep: string) => cep.replace(/\D/g, "");

export const isValidCep = (cep: string) => {
  const normalized = normalizeCep(cep);
  return /^[0-9]{8}$/.test(normalized) && !/^(\d)\1{7}$/.test(normalized);
};

export const formatCep = (cep: string) => {
  const normalized = normalizeCep(cep);
  if (normalized.length !== 8) return normalized;
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
};
