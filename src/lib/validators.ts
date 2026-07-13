export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Normal form shared by legacy numeric and 2026 alphanumeric CNPJ values. */
export function normalizeDocument(value: string): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 14);
}

export function formatCPF(digits: string): string {
  const d = onlyDigits(digits).padStart(11, "0").slice(0, 11);
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

export function formatCNPJ(digits: string): string {
  const d = normalizeDocument(digits).padStart(14, "0").slice(0, 14);
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

export function formatDocument(value: string): string {
  const normalized = normalizeDocument(value);
  if (/^\d{0,11}$/.test(normalized)) {
    return normalized
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  }
  return normalized
    .replace(/^([A-Z0-9]{2})([A-Z0-9])/, "$1.$2")
    .replace(/^([A-Z0-9]{2})\.([A-Z0-9]{3})([A-Z0-9])/, "$1.$2.$3")
    .replace(/^([A-Z0-9]{2})\.([A-Z0-9]{3})\.([A-Z0-9]{3})([A-Z0-9])/, "$1.$2.$3/$4")
    .replace(/^([A-Z0-9]{2})\.([A-Z0-9]{3})\.([A-Z0-9]{3})\/([A-Z0-9]{4})(\d)/, "$1.$2.$3/$4-$5");
}

export function isValidCPF(value: string): boolean {
  const digits = onlyDigits(value);

  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const calcDigit = (base: string, weights: number[]): number => {
    const sum = base
      .split("")
      .reduce((acc, ch, i) => acc + parseInt(ch, 10) * weights[i], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const weights1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calcDigit(digits.slice(0, 9), weights1);
  if (d1 !== parseInt(digits[9], 10)) return false;

  const d2 = calcDigit(digits.slice(0, 10), weights2);
  if (d2 !== parseInt(digits[10], 10)) return false;

  return true;
}

export function isValidCNPJ(value: string): boolean {
  const digits = normalizeDocument(value);

  if (!/^[A-Z0-9]{12}\d{2}$/.test(digits)) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const calcDigit = (base: string, weights: number[]): number => {
    const sum = base
      .split("")
      // Receita Federal maps each character to its ASCII code minus 48.
      // Numeric CNPJs therefore keep the legacy calculation unchanged.
      .reduce((acc, ch, i) => acc + (ch.charCodeAt(0) - 48) * weights[i], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calcDigit(digits.slice(0, 12), weights1);
  if (d1 !== parseInt(digits[12], 10)) return false;

  const d2 = calcDigit(digits.slice(0, 13), weights2);
  if (d2 !== parseInt(digits[13], 10)) return false;

  return true;
}

export function isValidDocument(value: string): boolean {
  const normalized = normalizeDocument(value);
  if (/^\d{11}$/.test(normalized)) return isValidCPF(normalized);
  return isValidCNPJ(normalized);
}

export function isValidEmail(email: string): boolean {
  const re =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
  return re.test(email);
}

export function validateDocument(value: string): {
  valid: boolean;
  type: "cpf" | "cnpj" | null;
  formatted: string;
  error?: string;
} {
  const digits = normalizeDocument(value);

  if (digits.length === 0) {
    return {
      valid: false,
      type: null,
      formatted: "",
      error: "Documento não informado.",
    };
  }

  if (/^\d{0,11}$/.test(digits)) {
    const valid = isValidCPF(digits);
    return {
      valid,
      type: "cpf",
      formatted: formatCPF(digits),
      ...(valid ? {} : { error: "CPF inválido." }),
    };
  }

  if (digits.length <= 14) {
    const valid = isValidCNPJ(digits);
    return {
      valid,
      type: "cnpj",
      formatted: formatCNPJ(digits),
      ...(valid ? {} : { error: "CNPJ inválido." }),
    };
  }

  return {
    valid: false,
    type: null,
    formatted: value,
    error: "Documento com tamanho inválido.",
  };
}

export async function checkEmailUnique(backend: any, email: string): Promise<boolean> {
  try {
    const { data } = await backend
      .from("stores")
      .select("id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    return data === null;
  } catch {
    return true;
  }
}
