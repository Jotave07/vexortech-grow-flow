import fs from "node:fs/promises";
import path from "node:path";
import { getActor } from "./auth";
import { parseBearerToken } from "./db";

const rootDir = () => path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), ".data", "storage"));
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

const safePart = (value: string) => {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized.includes("..")) throw new Error("Caminho de arquivo invalido.");
  return normalized;
};

export const uploadStorageFile = async (form: FormData, token?: string) => {
  const actor = await getActor(token);
  if (!actor) return { data: null, error: { message: "Nao autorizado." } };

  const bucket = safePart(String(form.get("bucket") || ""));
  const objectPath = safePart(String(form.get("path") || ""));
  const upsert = String(form.get("upsert") || "false") === "true";
  const file = form.get("file");

  if (!bucket || !objectPath || !file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return { data: null, error: { message: "Upload invalido." } };
  }

  const target = path.resolve(rootDir(), bucket, objectPath);
  if (!target.startsWith(path.resolve(rootDir()))) throw new Error("Caminho fora do armazenamento.");
  await fs.mkdir(path.dirname(target), { recursive: true });

  if (!upsert) {
    try {
      await fs.access(target);
      return { data: null, error: { message: "Arquivo ja existe." } };
    } catch {
      // File does not exist; continue.
    }
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > maxUploadBytes) return { data: null, error: { message: "Arquivo excede o limite permitido." } };
  const ext = path.extname(objectPath).toLowerCase();
  const expectedType = allowedTypes.get(ext);
  if (!expectedType) return { data: null, error: { message: "Tipo de arquivo nao permitido." } };
  const fileType = String((file as File).type || "");
  if (fileType && fileType !== expectedType) return { data: null, error: { message: "MIME do arquivo nao corresponde a extensao." } };
  if (!publicBuckets.has(bucket) && !privateBuckets.has(bucket)) {
    return { data: null, error: { message: "Bucket nao permitido." } };
  }

  const [pathStoreId] = objectPath.split("/");
  if (pathStoreId && !actor.admin && !actor.ownedStoreIds.includes(pathStoreId)) {
    return { data: null, error: { message: "Arquivo fora do escopo da loja." } };
  }

  await fs.writeFile(target, bytes);
  return { data: { path: objectPath, fullPath: `${bucket}/${objectPath}` }, error: null };
};

export const serveStorageFile = async (bucket: string, objectPath: string, request?: Request) => {
  const safeBucket = safePart(bucket);
  const safeObjectPath = safePart(objectPath);
  if (!publicBuckets.has(safeBucket)) {
    if (!privateBuckets.has(safeBucket)) return new Response("Not found", { status: 404 });
    const actor = await getActor(request ? parseBearerToken(request) : "");
    const [pathStoreId] = safeObjectPath.split("/");
    if (!actor || (!actor.admin && pathStoreId && !actor.ownedStoreIds.includes(pathStoreId))) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  const target = path.resolve(rootDir(), safeBucket, safeObjectPath);
  if (!target.startsWith(path.resolve(rootDir()))) return new Response("Not found", { status: 404 });

  try {
    const type = contentType(target);
    if (type === "application/octet-stream") return new Response("Not found", { status: 404 });
    const bytes = await fs.readFile(target);
    return new Response(bytes, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": type,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};

const contentType = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  if ([".jpg", ".jpeg"].includes(ext)) return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
};
