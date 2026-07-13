import { expect, test, type Page } from "@playwright/test";

const MOJIBAKE_PATTERN = /(\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]|\u00e2[\u0080-\u00bf])/;
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
  "/cadastrar-loja",
  "/termos",
  "/privacidade",
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
  expect(await page.locator("body").innerText()).not.toMatch(MOJIBAKE_PATTERN);
  expect(await page.content()).not.toMatch(MOJIBAKE_PATTERN);
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
    await expect(page).toHaveURL(/\/lojista\/entrar\?redirect=%2Flojista$/);

    await page.goto("/admin");
    await waitForSettledUi(page);
    await expect(page).toHaveURL(/\/admin\/entrar\?redirect=%2Fadmin$/);

    await page.goto("/cliente");
    await waitForSettledUi(page);
    await expect(page).toHaveURL(/\/entrar\?redirect=%2Fcliente$/);
  });

  test("validates mismatched customer signup passwords before API submission", async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.goto("/cadastrar");
    await waitForSettledUi(page);
    await page.getByLabel("Nome completo").fill("João QA");
    await page.getByLabel("CPF ou CNPJ").fill("52998224725");
    await page.getByLabel("E-mail").fill("joao.qa@example.com");
    await page.locator('input[name="password"]').fill("12345678");
    await page.locator('input[name="password_confirmation"]').fill("87654321");
    await page.getByLabel(/Li e concordo/).check();
    await page.getByRole("button", { name: "Criar minha conta" }).click();
    await expect(page.getByText("As senhas nao coincidem.")).toBeVisible();
    expect(errors.pageErrors).toEqual([]);
    expect(errors.consoleErrors).toEqual([]);
  });
});

test.describe("marketplace forms", () => {
  test("filters stores without duplicate network requests", async ({ page }) => {
    const errors = attachErrorCollectors(page);
    let storeQueries = 0;
    await page.route("**/api/backend", async (route) => {
      const body = route.request().postDataJSON();
      if (body?.kind === "query" && body?.query?.table === "stores") {
        storeQueries += 1;
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            data: [
              { id: "1", name: "Burger Hype", slug: "burger-hype", city: "Sao Paulo", state: "SP", is_active: true, is_suspended: false },
              { id: "2", name: "Pizza da Vila", slug: "pizza-vila", city: "Campinas", state: "SP", is_active: true, is_suspended: false },
            ],
            error: null,
          }),
        });
        return;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: null, error: { message: "Sessao ausente." } }) });
    });

    await page.goto("/lojas");
    await waitForSettledUi(page);
    await expect(page.getByText("Burger Hype")).toBeVisible();
    await page.getByRole("searchbox", { name: "Buscar lojas por nome ou cidade" }).fill("Campinas");
    await expect(page.getByText("Pizza da Vila")).toBeVisible();
    await expect(page.getByText("Burger Hype")).toBeHidden();
    expect(storeQueries).toBe(1);
    expect(errors.pageErrors).toEqual([]);
    expect(errors.consoleErrors).toEqual([]);
  });
});

test.describe("native security contract", () => {
  test("serves strict CSP without inline executable content", async ({ page }) => {
    const response = await page.goto("/vendas");
    const csp = response?.headers()["content-security-policy"] || "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toContain("'unsafe-inline'");
    await expect(page.locator("script:not([src]), style, [style]")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Delivery Hype para lojas/ })).toBeVisible();
  });
});
