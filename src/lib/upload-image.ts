/**
 * Utilitário compartilhado de upload de imagens para Supabase Storage.
 * Padroniza validação, naming e tratamento de erros para uploads de loja.
 */

import { getSupabaseBrowserClient } from "@/integrations/supabase/client";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export type ImageType = "logo" | "cover" | "product";

export interface UploadResult {
  url: string | null;
  error?: string;
}

/**
 * Faz upload de uma imagem para o bucket store-assets do Supabase.
 * O caminho é gerado automaticamente: {storeId}/{type}s/{uuid}.{ext}
 */
export async function uploadStoreImage(
  file: File,
  storeId: string,
  type: ImageType,
): Promise<UploadResult> {
  // Validação de tipo
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { url: null, error: "Formato inválido. Use JPG, PNG, WebP ou GIF." };
  }

  // Validação de tamanho
  if (file.size > MAX_SIZE) {
    return { url: null, error: `Arquivo muito grande. Máximo: ${MAX_SIZE / 1024 / 1024} MB.` };
  }

  // Gera nome único
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const path = `${storeId}/${type}s/${fileName}`;

  try {
    const client = getSupabaseBrowserClient();
    if (!client) {
      return { url: null, error: "Cliente Supabase não inicializado." };
    }

    const { error: uploadError } = await client.storage
      .from("store-assets")
      .upload(path, file, {
        cacheControl: "public, max-age=31536000",
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return { url: null, error: uploadError.message || "Erro ao fazer upload da imagem." };
    }

    const { data: urlData } = client.storage
      .from("store-assets")
      .getPublicUrl(path);

    return { url: urlData.publicUrl };
  } catch (err: any) {
    console.error("Upload exception:", err);
    return { url: null, error: err?.message || "Erro inesperado no upload." };
  }
}

/**
 * Retorna a URL pública para um caminho no bucket store-assets.
 */
export function getStoreImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const client = getSupabaseBrowserClient();
  if (!client) return null;
  const { data } = client.storage.from("store-assets").getPublicUrl(path);
  return data.publicUrl;
}
