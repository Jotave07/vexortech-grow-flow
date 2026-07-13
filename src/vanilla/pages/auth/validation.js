export const digitsOnly = (value) => String(value ?? "").replace(/\D/g, "");

export const normalizeDocument = (value) =>
  String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 14);

const allEqual = (value) => /^(\d)\1+$/.test(value);

export function isValidCpf(value) {
  const cpf = digitsOnly(value);
  if (cpf.length !== 11 || allEqual(cpf)) return false;
  const digit = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1)
      sum += Number(cpf[index]) * (length + 1 - index);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

export function isValidCnpj(value) {
  const cnpj = normalizeDocument(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calculate = (length) => {
    const weights =
      length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce(
      (total, weight, index) => total + (cnpj[index].charCodeAt(0) - 48) * weight,
      0,
    );
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calculate(12) === Number(cnpj[12]) && calculate(13) === Number(cnpj[13]);
}

export const isValidDocument = (value) => {
  const normalized = normalizeDocument(value);
  return /^\d{11}$/.test(normalized) ? isValidCpf(normalized) : isValidCnpj(normalized);
};

export function slugify(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function safeInternalRedirect(value, fallback = null, allowedPrefix = null) {
  if (typeof value !== "string") return fallback;
  const path = value.trim();
  const hasControlCharacter = [...path].some((character) => character.charCodeAt(0) < 32);
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || hasControlCharacter)
    return fallback;
  if (
    allowedPrefix &&
    path !== allowedPrefix &&
    !path.startsWith(`${allowedPrefix}/`) &&
    !path.startsWith(`${allowedPrefix}?`)
  )
    return fallback;
  return path;
}

export function nextPathForRole(role, redirect = null, mode = "customer") {
  if (mode === "admin") return role === "super_admin" ? "/admin" : null;
  if (mode === "merchant") {
    if (!new Set(["store_owner", "super_admin"]).has(role)) return null;
    return safeInternalRedirect(redirect, "/lojista", "/lojista");
  }
  if (role === "super_admin") return "/admin";
  const safe = safeInternalRedirect(redirect);
  if (safe) return safe;
  if (role === "store_owner") return "/lojista";
  return "/";
}

export function validateOnboarding(input) {
  const required = [
    ["name", "Informe o nome do estabelecimento."],
    ["slug", "Informe o endereco publico da loja."],
    ["whatsapp", "Informe o WhatsApp."],
    ["document", "Informe o CPF ou CNPJ."],
    ["city", "Informe a cidade."],
    ["state", "Informe a UF."],
  ];
  for (const [key, message] of required)
    if (!String(input[key] ?? "").trim()) return { field: key, message };
  if (String(input.name).trim().length < 2)
    return { field: "name", message: "O nome precisa ter ao menos 2 caracteres." };
  if (!/^[a-z0-9-]{3,50}$/.test(String(input.slug)))
    return { field: "slug", message: "Use de 3 a 50 letras minusculas, numeros ou hifens." };
  if (digitsOnly(input.whatsapp).length < 10)
    return { field: "whatsapp", message: "Informe um WhatsApp com DDD." };
  if (!isValidDocument(input.document))
    return { field: "document", message: "Informe um CPF ou CNPJ valido." };
  if (!/^[A-Za-z]{2}$/.test(String(input.state).trim()))
    return { field: "state", message: "A UF deve ter duas letras." };
  if (String(input.description ?? "").length > 500)
    return { field: "description", message: "A descricao deve ter no maximo 500 caracteres." };
  return null;
}
