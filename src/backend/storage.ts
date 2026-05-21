import fs from "node:fs/promises";
import path from "node:path";
import { getActor } from "./auth";

const rootDir = () => path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), ".data", "storage"));

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
  await fs.writeFile(target, bytes);
  return { data: { path: objectPath, fullPath: `${bucket}/${objectPath}` }, error: null };
};

export const serveStorageFile = async (bucket: string, objectPath: string) => {
  const safeBucket = safePart(bucket);
  const safeObjectPath = safePart(objectPath);
  const target = path.resolve(rootDir(), safeBucket, safeObjectPath);
  if (!target.startsWith(path.resolve(rootDir()))) return new Response("Not found", { status: 404 });

  try {
    const bytes = await fs.readFile(target);
    return new Response(bytes, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": contentType(target),
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
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
};
