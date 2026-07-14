import path from "node:path";
import { Buffer } from "node:buffer";
import { assertActiveMerchantSubscription, getActor } from "./auth";
import { parseBearerToken } from "./db";
import {
  downloadObjectFromSupabaseStorage,
  getSupabasePublicObjectUrl,
  hasSupabaseAdminConfig,
  uploadObjectToSupabaseStorage,
} from "./supabase";

const publicBuckets = new Set(["store-assets", "logos", "banners", "products"]);
const privateBuckets = new Set(["documents", "receipts", "internal-attachments"]);
const allowedTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".pdf", "application/pdf"],
]);
const maxUploadBytes = 5 * 1024 * 1024;

const hasPrefix = (bytes: Buffer, signature: number[]) =>
  signature.every((value, index) => bytes[index] === value);

const matchesFileSignature = (bytes: Buffer, contentType: string) => {
  if (contentType === "image/jpeg") return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (contentType === "image/png") return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (contentType === "image/gif") {
    const header = bytes.subarray(0, 6).toString("ascii");
    return header === "GIF87a" || header === "GIF89a";
  }
  if (contentType === "image/webp") {
    return bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (contentType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  return false;
};

const safePart = (value: string) => {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized.includes("..")) throw new Error("Caminho de arquivo invalido.");
  return normalized;
};

export const uploadStorageFile = async (form: FormData, token?: string) => {
  if (!hasSupabaseAdminConfig()) {
    return { data: null, error: { message: "Supabase Storage nao configurado no servidor." } };
  }

  const actor = await getActor(token);
  if (!actor) return { data: null, error: { message: "Nao autorizado." } };

  const bucket = safePart(String(form.get("bucket") || ""));
  const objectPath = safePart(String(form.get("path") || ""));
  const upsert = String(form.get("upsert") || "false") === "true";
  const file = form.get("file");

  if (!bucket || !objectPath || !file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return { data: null, error: { message: "Upload invalido." } };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length) return { data: null, error: { message: "Arquivo vazio." } };
  if (bytes.length > maxUploadBytes) return { data: null, error: { message: "Arquivo excede o limite permitido." } };
  const ext = path.extname(objectPath).toLowerCase();
  const expectedType = allowedTypes.get(ext);
  if (!expectedType) return { data: null, error: { message: "Tipo de arquivo nao permitido." } };
  const fileType = String((file as File).type || "");
  if (fileType && fileType !== expectedType) return { data: null, error: { message: "MIME do arquivo nao corresponde a extensao." } };
  if (!matchesFileSignature(bytes, expectedType)) {
    return { data: null, error: { message: "Conteudo do arquivo nao corresponde ao tipo permitido." } };
  }
  if (!publicBuckets.has(bucket) && !privateBuckets.has(bucket)) {
    return { data: null, error: { message: "Bucket nao permitido." } };
  }

  const [pathStoreId] = objectPath.split("/");
  if (pathStoreId && !actor.admin && !actor.ownedStoreIds.includes(pathStoreId)) {
    return { data: null, error: { message: "Arquivo fora do escopo da loja." } };
  }
  if (publicBuckets.has(bucket)) await assertActiveMerchantSubscription(actor, pathStoreId);

  await uploadObjectToSupabaseStorage({
    bucket,
    path: objectPath,
    bytes,
    contentType: expectedType,
    upsert,
  });
  return { data: { path: objectPath, fullPath: `${bucket}/${objectPath}` }, error: null };
};

export const serveStorageFile = async (bucket: string, objectPath: string, request?: Request) => {
  if (!hasSupabaseAdminConfig()) return new Response("Supabase Storage not configured", { status: 503 });

  const safeBucket = safePart(bucket);
  const safeObjectPath = safePart(objectPath);
  if (!publicBuckets.has(safeBucket) && !privateBuckets.has(safeBucket)) return new Response("Not found", { status: 404 });

  if (publicBuckets.has(safeBucket)) {
    const publicUrl = getSupabasePublicObjectUrl(safeBucket, safeObjectPath);
    return Response.redirect(publicUrl, 302);
  }

  const actor = await getActor(request ? parseBearerToken(request) : "");
  const [pathStoreId] = safeObjectPath.split("/");
  if (!actor || (!actor.admin && pathStoreId && !actor.ownedStoreIds.includes(pathStoreId))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const object = await downloadObjectFromSupabaseStorage(safeBucket, safeObjectPath);
  if (!object || object.contentType === "application/octet-stream") return new Response("Not found", { status: 404 });
  const fileName = path.basename(safeObjectPath).replace(/[\r\n"]/g, "_") || "arquivo";
  const responseBytes = Uint8Array.from(object.bytes);
  return new Response(responseBytes, {
    headers: {
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Length": String(object.bytes.length),
      "Content-Type": object.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
};
