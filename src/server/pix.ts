const removeAccents = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const sanitize = (value: unknown, max: number) =>
  removeAccents(String(value ?? ""))
    .replace(/[^A-Za-z0-9 $%*+\-./:]/g, " ")
    .trim()
    .slice(0, max);

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, "0")}${value}`;

const crc16 = (payload: string) => {
  let crc = 0xffff;
  for (let index = 0; index < payload.length; index += 1) {
    crc ^= payload.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
};

export const isPixCopyPastePayload = (value: unknown) =>
  String(value ?? "").trim().startsWith("000201");

export const createPixCopyPastePayload = ({
  pixKey,
  amount,
  merchantName,
  merchantCity,
  txid,
}: {
  pixKey: string;
  amount: number;
  merchantName: string;
  merchantCity: string;
  txid: string;
}) => {
  const key = String(pixKey || "").trim();
  if (!key) throw new Error("Chave Pix da loja nao configurada.");
  if (isPixCopyPastePayload(key)) return key;

  const gui = field("00", "BR.GOV.BCB.PIX");
  const merchantAccount = field("26", `${gui}${field("01", key)}`);
  const additionalData = field("62", field("05", sanitize(txid || "***", 25) || "***"));
  const payloadWithoutCrc = [
    field("00", "01"),
    merchantAccount,
    field("52", "0000"),
    field("53", "986"),
    amount > 0 ? field("54", amount.toFixed(2)) : "",
    field("58", "BR"),
    field("59", sanitize(merchantName || "LOJA", 25) || "LOJA"),
    field("60", sanitize(merchantCity || "BRASIL", 15) || "BRASIL"),
    additionalData,
    "6304",
  ].join("");

  return `${payloadWithoutCrc}${crc16(payloadWithoutCrc)}`;
};
