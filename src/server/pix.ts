const onlyDigits = (value: string) => value.replace(/\D/g, "");

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, "0")}${value}`;

const crc16 = (payload: string) => {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
};

// EMV-safe: uppercase + strip accents only (matches qrcode-pix behavior)
const emvSafe = (value: string, max: number) =>
  String(value || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .substring(0, max);

const sanitizeTxid = (value: string, max: number) =>
  String(value || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .substring(0, max)
    .toUpperCase()
    || "***";

const sanitizeDescription = (value: string, max: number) =>
  String(value || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 $%*+\-./:]/g, " ")
    .trim()
    .substring(0, max);

export const isPixCopyPastePayload = (value: unknown) =>
  String(value ?? "").trim().startsWith("000201");

/** Strip formatting from a PIX key based on its type, producing the clean key for EMV. */
export const cleanPixKey = (raw: string, keyType?: string | null): string => {
  const trimmed = String(raw || "").trim();
  switch (keyType) {
    case "cpf":
      return onlyDigits(trimmed).slice(0, 11);
    case "cnpj":
      return onlyDigits(trimmed).slice(0, 14);
    case "phone":
      return `+55${onlyDigits(trimmed).replace(/^55/, "").slice(0, 11)}`;
    case "email":
      return trimmed.toLowerCase();
    case "evp":
    case "random":
      return trimmed; // UUID, no cleaning needed
    default:
      return onlyDigits(trimmed) || trimmed;
  }
};

export const createPixCopyPastePayload = ({
  pixKey,
  pixKeyType,
  amount,
  merchantName,
  merchantCity,
  txid,
  description,
}: {
  pixKey: string;
  pixKeyType?: string | null;
  amount: number;
  merchantName: string;
  merchantCity: string;
  txid: string;
  description?: string;
}) => {
  const rawKey = String(pixKey || "").trim();
  if (!rawKey) throw new Error("Chave Pix da loja nao configurada.");
  if (isPixCopyPastePayload(rawKey)) return rawKey;

  const key = cleanPixKey(rawKey, pixKeyType);
  if (!key) throw new Error("Chave Pix invalida apos limpeza.");

  const gui = field("00", "BR.GOV.BCB.PIX");
  const descriptionField = description ? field("02", sanitizeDescription(description, 72)) : "";
  const merchantAccount = field("26", `${gui}${field("01", key)}${descriptionField}`);

  const additionalData = field("62", field("05", sanitizeTxid(txid || "***", 25)));

  const payloadWithoutCrc = [
    field("00", "01"),
    merchantAccount,
    field("52", "0000"),
    field("53", "986"),
    amount > 0 ? field("54", amount.toFixed(2)) : "",
    field("58", "BR"),
    field("59", emvSafe(merchantName || "LOJA", 25) || "LOJA"),
    field("60", emvSafe(merchantCity || "BRASIL", 15) || "BRASIL"),
    additionalData,
    "6304",
  ].join("");

  return `${payloadWithoutCrc}${crc16(payloadWithoutCrc)}`;
};
