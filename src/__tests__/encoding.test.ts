import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { TextDecoder } from "node:util";

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".ts",
  ".tsx",
]);
const IGNORED_DIRECTORIES = new Set([".git", ".output", ".vinxi", "dist", "node_modules"]);
const MOJIBAKE_PATTERN = /(Ã[\u00a0-\u00bf]|Â[\u0080-\u00bf]|â[\u0080-\u00bf])/;

const collectTextFiles = (directory: string): string[] => {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : collectTextFiles(fullPath);
    }

    if (basename(fullPath) === ".env") return [];
    if (basename(fullPath) === ".env.example") return [fullPath];
    return TEXT_EXTENSIONS.has(extname(entry.name)) ? [fullPath] : [];
  });
};

describe("UTF-8 and Portuguese accents", () => {
  it("keeps source text files valid UTF-8 and free of common mojibake sequences", () => {
    const files = collectTextFiles(process.cwd());
    const invalidUtf8: string[] = [];
    const mojibake: string[] = [];

    for (const file of files) {
      const bytes = readFileSync(file);
      let text = "";

      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        invalidUtf8.push(relative(process.cwd(), file));
        continue;
      }

      const match = text.match(MOJIBAKE_PATTERN);
      if (match) {
        mojibake.push(`${relative(process.cwd(), file)}: ${match[0]}`);
      }
    }

    expect({ invalidUtf8, mojibake }).toEqual({ invalidUtf8: [], mojibake: [] });
  });

  it("preserves representative Brazilian Portuguese strings", () => {
    const samples = [
      "João",
      "Ação",
      "Informações",
      "Usuário",
      "Não",
      "Endereço",
      "Configurações",
      "São Paulo",
      "Descrição",
      "Área",
    ];

    expect(samples.join(" | ")).toBe(
      "João | Ação | Informações | Usuário | Não | Endereço | Configurações | São Paulo | Descrição | Área",
    );
  });
});
