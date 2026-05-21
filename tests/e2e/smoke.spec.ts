import { expect, test, type Page } from "@playwright/test";

const MOJIBAKE_PATTERN = /(Ã[\u00a0-\u00bf]|Â[\u0080-\u00bf]|â[\u0080-\u00bf])/;
const CRITICAL_ROUTES = [
  "/",
  "/vendas",
  "/lojas",
  "/entrar",
  "/cadastrar",
  "/recuperar-senha",
  "/redefinir-senha",
  "/lojista/entrar",
  "/admin/entrar",
  "/pedido/token-inexistente",
  "/loja/slug-inexistente",
  "/rota-inexistente",
];

const VIEWPORTS = [
  { width: 320, height: 760 },
  { width: 375, height: 812 },
  { width: 414, height: 896 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

const attachErrorCollectors = (page: Page) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  return { consoleErrors, pageErrors };
};

const waitForSettledUi = async (page: Page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(300);
};

const expectNoEncodingRegression = async (page: Page) => {
  const bodyText = await page.locator("body").innerText();
  const html = await page.content();

  expect(bodyText).not.toMatch(MOJIBAKE_PATTERN);
  expect(html).not.toMatch(MOJIBAKE_PATTERN);
};

const expectNoHorizontalOverflow = async (page: Page) => {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 3);
};

test.describe("public route smoke and encoding", () => {
  for (const route of CRITICAL_ROUTES) {
    test(`renders ${route} without console errors or mojibake`, async ({ page }) => {
      const errors = attachErrorCollectors(page);

      await page.goto(route);
      await waitForSettledUi(page);

      await expect(page.locator("body")).not.toHaveText("");
      await expectNoEncodingRegression(page);
      await expectNoHorizontalOverflow(page);
      expect(errors.pageErrors).toEqual([]);
      expect(errors.consoleErrors).toEqual([]);
    });
  }
});

test.describe("responsive layout", () => {
  for (const viewport of VIEWPORTS) {
    test(`home has no horizontal overflow at ${viewport.width}px`, async ({ page }) => {
      const errors = attachErrorCollectors(page);
      await page.setViewportSize(viewport);

      await page.goto("/");
      await waitForSettledUi(page);

      await expectNoEncodingRegression(page);
      await expectNoHorizontalOverflow(page);
      expect(errors.pageErrors).toEqual([]);
      expect(errors.consoleErrors).toEqual([]);
    });
  }
});

test.describe("auth and protected flows", () => {
  test("redirects unauthenticated users to the correct login surfaces", async ({ page }) => {
    await page.goto("/lojista");
    await waitForSettledUi(page);
    await expect(page).toHaveURL(/\/lojista\/entrar$/);

    await page.goto("/admin");
    await waitForSettledUi(page);
    await expect(page).toHaveURL(/\/admin\/entrar$/);

    await page.goto("/cliente");
    await waitForSettledUi(page);
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test("validates mismatched customer signup passwords before API submission", async ({ page }) => {
    const errors = attachErrorCollectors(page);

    await page.goto("/cadastrar");
    await waitForSettledUi(page);
    await page.getByLabel("Seu Nome").fill("João QA");
    await page.getByLabel("CPF ou CNPJ").fill("12345678901");
    await page.getByLabel("E-mail").fill("joao.qa@example.com");
    await page.getByLabel("Senha", { exact: true }).fill("123456");
    await page.getByLabel("Confirmar Senha").fill("654321");
    await page.getByRole("button", { name: "Criar minha conta" }).click();

    await expect(page.getByText("As senhas não coincidem")).toBeVisible();
    expect(errors.pageErrors).toEqual([]);
    expect(errors.consoleErrors).toEqual([]);
  });
});

test.describe("marketplace forms", () => {
  test("shows clear validation feedback for invalid CEP", async ({ page }) => {
    const errors = attachErrorCollectors(page);

    await page.goto("/lojas");
    await waitForSettledUi(page);
    await page.getByPlaceholder("Buscar endereço e número (ou CEP)").fill("123");
    await page.getByRole("button", { name: "Confirmar localização" }).click();

    await expect(page.getByText("CEP inválido")).toBeVisible();
    expect(errors.pageErrors).toEqual([]);
    expect(errors.consoleErrors).toEqual([]);
  });
});
