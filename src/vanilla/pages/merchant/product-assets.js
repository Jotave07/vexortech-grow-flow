const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_TYPE = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
});

const TYPE_BY_EXTENSION = Object.freeze({
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
});

const extensionOf = (name) => String(name || "").toLocaleLowerCase("pt-BR").split(".").pop();

export function validateProductImage(file) {
  if (!file) return null;
  if (typeof file.size !== "number" || file.size <= 0) return "Selecione uma imagem valida.";
  if (file.size > MAX_IMAGE_BYTES) return "A imagem deve ter no maximo 5 MB.";
  const extension = extensionOf(file.name);
  const inferredType = TYPE_BY_EXTENSION[extension];
  const declaredType = String(file.type || "").toLocaleLowerCase("pt-BR");
  if (!inferredType || (declaredType && !EXTENSION_BY_TYPE[declaredType])) {
    return "Use uma imagem JPG, PNG, WebP ou GIF.";
  }
  if (declaredType && declaredType !== inferredType) {
    return "O tipo da imagem nao corresponde a extensao do arquivo.";
  }
  return null;
}

const randomId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export function productImagePath(storeId, productId, file, createId = randomId) {
  const issue = validateProductImage(file);
  if (issue) throw new Error(issue);
  if (!storeId || !productId) throw new Error("Loja e produto sao obrigatorios para enviar a imagem.");
  const declaredType = String(file.type || "").toLocaleLowerCase("pt-BR");
  const extension = EXTENSION_BY_TYPE[declaredType] || extensionOf(file.name).replace("jpeg", "jpg");
  return `${storeId}/products/${productId}/${createId()}.${extension}`;
}

export function storageObjectUrl(bucket, objectPath) {
  const encodedPath = String(objectPath || "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
  if (!bucket || !encodedPath) throw new Error("Caminho da imagem invalido.");
  return `/storage/${encodeURIComponent(bucket)}/${encodedPath}`;
}

export async function uploadProductImage(ctx, { file, storeId, productId }) {
  const issue = validateProductImage(file);
  if (issue) throw new Error(issue);
  if (!ctx?.api?.upload) throw new Error("Upload de imagem indisponivel.");
  const bucket = "store-assets";
  const objectPath = productImagePath(storeId, productId, file);
  const result = await ctx.api.upload(bucket, objectPath, file, { upsert: false });
  if (result?.error) throw new Error(result.error.message || "Nao foi possivel enviar a imagem.");
  const confirmedPath = result?.data?.path || objectPath;
  if (confirmedPath !== objectPath) throw new Error("O servidor retornou um caminho de imagem inesperado.");
  return storageObjectUrl(bucket, confirmedPath);
}

export { MAX_IMAGE_BYTES };
