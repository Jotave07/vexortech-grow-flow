import { chromium } from "@playwright/test";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:4175";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const consoleErrors = [];
const failedResponses = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("response", (response) => {
  if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
});

const open = async (path) => {
  await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
  await page.locator(".merchant-page[data-page-state='ready']").waitFor();
};

await open("/src/vanilla/pages/merchant/settings-deliveries-visual-harness.html?view=settings");
await page.screenshot({ path: "artifacts/ui-eval-merchant-settings-native.png", fullPage: true });
const settingsOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
await page.getByLabel("Cor principal", { exact: true }).fill("#7c3aed");
const previewLabel = await page.locator(".merchant-brand-preview").getAttribute("aria-label");
await page.setViewportSize({ width: 375, height: 812 });
await page.reload({ waitUntil: "networkidle" });
await page.locator(".merchant-page[data-page-state='ready']").waitFor();
await page.screenshot({ path: "artifacts/ui-eval-merchant-settings-native-mobile.png", fullPage: true });
const settingsMobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

await page.setViewportSize({ width: 1440, height: 900 });
await open("/src/vanilla/pages/merchant/settings-deliveries-visual-harness.html?view=deliveries");
await page.screenshot({ path: "artifacts/ui-eval-merchant-deliveries-native.png", fullPage: true });
const deliveriesOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
await page.getByRole("button", { name: "Testar endereço", exact: true }).click();
await page.getByLabel("CEP", { exact: true }).fill("01310-100");
await page.getByRole("button", { name: "Calcular entrega", exact: true }).click();
await page.getByText("Entrega disponível", { exact: true }).waitFor();
const quoteText = await page.locator(".merchant-quote-result").innerText();

await page.setViewportSize({ width: 375, height: 812 });
await page.reload({ waitUntil: "networkidle" });
await page.locator(".merchant-page[data-page-state='ready']").waitFor();
await page.screenshot({ path: "artifacts/ui-eval-merchant-deliveries-native-mobile.png", fullPage: true });
const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

await browser.close();
console.log(JSON.stringify({
  settingsOverflow,
  settingsMobileOverflow,
  deliveriesOverflow,
  mobileOverflow,
  previewUpdated: previewLabel?.includes("#7c3aed") || false,
  quoteText,
  consoleErrors,
  failedResponses,
}, null, 2));
