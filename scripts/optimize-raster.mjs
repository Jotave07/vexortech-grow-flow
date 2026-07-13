import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

/* global createImageBitmap, document */

const [inputPath, outputPath, maximumSize = "768", quality = "0.84"] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error("Uso: node scripts/optimize-raster.mjs <entrada> <saida.webp> [tamanho-maximo] [qualidade]");
  process.exit(1);
}

const source = await fs.readFile(path.resolve(inputPath));
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const encoded = await page.evaluate(async ({ bytes, maximum, outputQuality }) => {
    const binary = Uint8Array.from(atob(bytes), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([binary], { type: "image/png" }));
    const scale = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d", { alpha: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/webp", outputQuality).split(",")[1];
  }, {
    bytes: source.toString("base64"),
    maximum: Math.max(1, Number(maximumSize)),
    outputQuality: Math.min(1, Math.max(0.1, Number(quality))),
  });

  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(path.resolve(outputPath), Buffer.from(encoded, "base64"));
  const before = source.byteLength;
  const after = (await fs.stat(path.resolve(outputPath))).size;
  console.log(JSON.stringify({ input: inputPath, output: outputPath, before, after, reduction: `${Math.round((1 - after / before) * 100)}%` }));
} finally {
  await browser.close();
}
