import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.resolve(process.argv[2] || "docs/project-inventory.csv");
const excludedDirectories = new Set([
  ".git",
  ".output",
  "dist",
  "node_modules",
  "quarantine",
  "test-results",
]);

const slash = (value) => value.split(path.sep).join("/");
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

const legacyPatterns = [
  /^src\/(App|main|client|router|routeTree\.gen)\.(tsx?|jsx?)$/,
  /^src\/(components|contexts|hooks|pages|routes|ui)\//,
  /^src\/styles\.css$/,
  /^src\/functions\/(asaas|evolution)\.ts$/,
  /^src\/integrations\/(supabase\/client|backend\/client)\.ts$/,
  /^vite\.config\.ts$/,
  /^components\.json$/,
];

const classify = (relative) => {
  if (legacyPatterns.some((pattern) => pattern.test(relative))) {
    return ["obsoleto", "Frontend React/TanStack substituido pela implementacao nativa; candidato a quarentena."];
  }
  if (/^(dist|\.output|\.tanstack|artifacts|_deploy|_port)\//.test(relative)
    || /(^|\/)(\.build|\.lint|\.migrate|\.dbcheck|\.codex[^/]*)\.log$/.test(relative)
    || /^\.wf-/.test(relative)) {
    return ["nao_utilizado", "Artefato gerado, log ou residuo operacional; nao integra o codigo-fonte."];
  }
  if (/^claude-cookbooks-main\//.test(relative)) {
    return ["nao_utilizado", "Copia de material terceiro sem imports ou participacao no build da aplicacao."];
  }
  if (/^(src\/(backend|server|vanilla)|db\/migrations|deploy|scripts\/migrate|package(-lock)?\.json|tsconfig\.json|vite\.vanilla\.config\.mjs|vitest\.config\.ts|eslint\.config\.js|index\.html|\.env\.example)/.test(relative)) {
    return ["critico", "Necessario ao runtime nativo, persistencia, seguranca, build ou operacao."];
  }
  if (/^(src\/(integrations\/backend|lib|services|types)|public\/|tests\/|playwright\.config\.ts)/.test(relative)) {
    return ["em_uso", "Importado pelo runtime/testes ou recurso estatico da aplicacao."];
  }
  if (/\.(md|txt|json|sql|ya?ml)$/.test(relative)) {
    return ["possivelmente_em_uso", "Documento, dado ou configuracao preservado para revisao manual."];
  }
  return ["possivelmente_em_uso", "Sem prova suficiente para remocao automatica; preservado."];
};

const files = [];
const walk = async (directory) => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute);
    else if (entry.isFile()) files.push(absolute);
  }
};

await walk(root);
files.sort((left, right) => slash(path.relative(root, left)).localeCompare(slash(path.relative(root, right))));

const rows = [];
const firstByHash = new Map();
for (const absolute of files) {
  const relative = slash(path.relative(root, absolute));
  const content = await fs.readFile(absolute);
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  const stat = await fs.stat(absolute);
  let [status, reason] = classify(relative);
  const duplicateOf = firstByHash.get(hash) || "";
  if (!duplicateOf) firstByHash.set(hash, relative);
  else if (status !== "critico") {
    status = "duplicado";
    reason = `Conteudo identico a ${duplicateOf}; revisar antes de excluir.`;
  }
  rows.push([relative, stat.size, status, reason, hash, duplicateOf]);
}

await fs.mkdir(path.dirname(output), { recursive: true });
const header = ["caminho", "bytes", "classificacao", "justificativa", "sha256", "duplicado_de"];
await fs.writeFile(output, [header, ...rows].map((row) => row.map(csv).join(",")).join("\n") + "\n", "utf8");
console.log(JSON.stringify({ output: slash(path.relative(root, output)), files: rows.length }));
