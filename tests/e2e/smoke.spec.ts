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

const CHECKOUT_FIXTURE = Object.freeze({
  userId: "11111111-1111-4111-8111-111111111111",
  storeId: "22222222-2222-4222-8222-222222222222",
  productId: "33333333-3333-4333-8333-333333333333",
});

const installCheckoutFixture = async (
  page: Page,
  functionHandler: (name: string, body: Record<string, unknown>) => Promise<unknown> = async () =>
    null,
) => {
  await page.addInitScript(({ productId }) => {
    localStorage.setItem(
      "vexor_cart_hype",
      JSON.stringify([
        {
          uid: "checkout-layout-fixture",
          product_id: productId,
          product_name: "COCA COLA",
          unit_price: 5,
          quantity: 2,
          options: [],
        },
      ]),
    );
  }, CHECKOUT_FIXTURE);

  await page.route("**/api/backend", async (route) => {
    const payload = route.request().postDataJSON();
    let data: unknown = null;
    if (payload?.kind === "auth" && payload?.action === "sessionFromToken") {
      data = { session: { user: { id: CHECKOUT_FIXTURE.userId, email: "cliente@example.com" } } };
    } else if (payload?.kind === "query") {
      const query = payload.query || {};
      const equals = Object.fromEntries(
        (query.filters || [])
          .filter((filter: any) => filter.op === "eq")
          .map((filter: any) => [filter.column, filter.value]),
      );
      if (query.table === "profiles") {
        data = {
          user_id: CHECKOUT_FIXTURE.userId,
          role: "customer",
          full_name: "Cliente Teste",
          phone: "27999999999",
        };
      } else if (query.table === "user_roles") {
        data = [{ role: "customer", store_id: null }];
      } else if (query.table === "stores" && equals.owner_user_id) {
        data = [];
      } else if (query.table === "stores") {
        data = {
          id: CHECKOUT_FIXTURE.storeId,
          name: "HYPE",
          public_name: "HYPE",
          slug: "hype",
          logo_url: "/brand/hype-icon.svg",
          is_active: true,
          is_suspended: false,
        };
      } else if (query.table === "store_settings") {
        data = {
          store_id: CHECKOUT_FIXTURE.storeId,
          accept_orders_when_closed: true,
          accept_pix: true,
          pix_checkout_available: true,
          accept_cash: true,
          accept_card_on_delivery: true,
          allow_delivery: true,
          allow_pickup: true,
          avg_prep_time_minutes: 30,
          is_open: true,
          min_order_value: 0,
        };
      }
    } else if (payload?.kind === "function") {
      data = await functionHandler(String(payload.name || ""), payload.body || {});
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data, error: null }),
    });
  });
};

const installStoreFixture = async (page: Page) => {
  await page.route("**/api/backend", async (route) => {
    const payload = route.request().postDataJSON();
    let data: unknown = null;
    if (payload?.kind === "auth" && payload?.action === "sessionFromToken") {
      data = { session: null };
    } else if (payload?.kind === "query") {
      const query = payload.query || {};
      if (query.table === "stores") {
        data = {
          id: CHECKOUT_FIXTURE.storeId,
          name: "HYPE",
          public_name: "HYPE Delivery",
          slug: "hype",
          logo_url: "/brand/hype-icon.svg",
          cover_url: null,
          city: "São Paulo",
          state: "SP",
          description: "Entrega rápida e cardápio completo.",
          is_active: true,
          is_suspended: false,
        };
      } else if (query.table === "store_settings") {
        data = {
          store_id: CHECKOUT_FIXTURE.storeId,
          accept_orders_when_closed: true,
          allow_delivery: true,
          allow_pickup: true,
          avg_prep_time_minutes: 30,
          is_open: true,
          min_order_value: 0,
        };
      } else if (query.table === "categories") {
        data = [
          {
            id: "44444444-4444-4444-8444-444444444444",
            store_id: CHECKOUT_FIXTURE.storeId,
            name: "Bebidas",
            sort_order: 1,
            is_active: true,
          },
        ];
      } else if (query.table === "products") {
        data = [
          {
            id: CHECKOUT_FIXTURE.productId,
            store_id: CHECKOUT_FIXTURE.storeId,
            category_id: "44444444-4444-4444-8444-444444444444",
            name: "COCA COLA",
            description: "Lata 350 ml gelada",
            price: 5,
            promo_price: null,
            image_url: null,
            is_active: true,
            is_available: true,
            is_featured: true,
            prep_time_minutes: 1,
            sort_order: 1,
          },
        ];
      } else if (query.table === "store_reviews") {
        data = [];
      } else if (query.table === "product_options" || query.table === "product_option_items") {
        data = [];
      }
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data, error: null }),
    });
  });
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

test.describe("store menu visual regressions", () => {
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[5]]) {
    test(`keeps the official brand, header and product dialog usable at ${viewport.width}px`, async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      await page.setViewportSize(viewport);
      await installStoreFixture(page);
      await page.goto("/loja/hype");

      const brandLogo = page.locator(".vxp-brand__logo");
      await expect(brandLogo).toHaveAttribute("src", "/brand/hype-icon.svg");
      await expect(brandLogo).toBeVisible();
      await expect(page.getByRole("heading", { name: "HYPE Delivery" })).toBeVisible();

      const back = page.locator(".vxp-back-link");
      const brand = page.locator(".vxp-brand");
      const headerGeometry = await page.evaluate(() => {
        const backRect = document.querySelector(".vxp-back-link")?.getBoundingClientRect();
        const brandRect = document.querySelector(".vxp-brand")?.getBoundingClientRect();
        return backRect && brandRect
          ? { backRight: backRect.right, brandLeft: brandRect.left }
          : null;
      });
      expect(headerGeometry).not.toBeNull();
      expect(headerGeometry!.backRight).toBeLessThanOrEqual(headerGeometry!.brandLeft);
      await expect(back).toBeVisible();
      await expect(brand).toBeVisible();

      await page.getByRole("button", { name: /COCA COLA/ }).click();
      const dialog = page.getByRole("dialog", { name: "COCA COLA" });
      await expect(dialog).toBeVisible();
      const addButton = dialog.getByRole("button", { name: /Adicionar/ });
      await expect(addButton).toBeVisible();

      const geometry = await dialog.evaluate((element) => {
        const dialogRect = element.getBoundingClientRect();
        const body = element.querySelector(".vxp-dialog__body");
        const add = [...element.querySelectorAll("button")].find((button) =>
          button.textContent?.includes("Adicionar"),
        );
        const addRect = add?.getBoundingClientRect();
        return {
          dialogBackground: getComputedStyle(element).backgroundColor,
          bodyBackground: body ? getComputedStyle(body).backgroundColor : "missing",
          dialogLeft: dialogRect.left,
          dialogRight: dialogRect.right,
          addBottom: addRect?.bottom ?? Number.POSITIVE_INFINITY,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
        };
      });
      expect(geometry.dialogBackground).not.toMatch(/transparent|rgba\([^)]*,\s*0\)/);
      expect(geometry.bodyBackground).not.toBe("missing");
      expect(geometry.dialogLeft).toBeGreaterThanOrEqual(0);
      expect(geometry.dialogRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(geometry.addBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
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
              {
                id: "1",
                name: "Burger Hype",
                slug: "burger-hype",
                city: "Sao Paulo",
                state: "SP",
                is_active: true,
                is_suspended: false,
              },
              {
                id: "2",
                name: "Pizza da Vila",
                slug: "pizza-vila",
                city: "Campinas",
                state: "SP",
                is_active: true,
                is_suspended: false,
              },
            ],
            error: null,
          }),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: null, error: { message: "Sessao ausente." } }),
      });
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

test.describe("checkout layout and address concurrency", () => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    test(`keeps checkout controls inside the viewport at ${viewport.width}px`, async ({ page }) => {
      const errors = attachErrorCollectors(page);
      await page.setViewportSize(viewport);
      await installCheckoutFixture(page);
      await page.goto("/loja/hype/checkout");
      await expect(page.getByRole("heading", { name: "Pagamento e revisão" })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      const paymentLayout = await page.locator('[data-checkout-step="3"]').evaluate((section) => {
        const bounds = section.getBoundingClientRect();
        const heading = section.querySelector("h2")?.getBoundingClientRect();
        const radios = [...section.querySelectorAll<HTMLInputElement>(".vxp-radio-card input")].map(
          (input) => {
            const rect = input.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          },
        );
        return {
          left: bounds.left,
          right: bounds.right,
          headingWidth: heading?.width || 0,
          radios,
          viewportWidth: document.documentElement.clientWidth,
        };
      });
      expect(paymentLayout.left).toBeGreaterThanOrEqual(0);
      expect(paymentLayout.right).toBeLessThanOrEqual(paymentLayout.viewportWidth + 1);
      expect(paymentLayout.headingWidth).toBeGreaterThan(150);
      expect(paymentLayout.radios.length).toBe(4);
      expect(paymentLayout.radios.every(({ width, height }) => width <= 24 && height <= 24)).toBe(
        true,
      );
      expect(errors.pageErrors).toEqual([]);
      expect(errors.consoleErrors).toEqual([]);
    });
  }

  test("ignores a stale CEP response and keeps the latest lookup busy", async ({ page }) => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let markFirstStarted!: () => void;
    let markSecondStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await installCheckoutFixture(page, async (name, body) => {
      if (name !== "lookup-cep") return null;
      if (body.cep === "11111111") {
        markFirstStarted();
        await firstGate;
        return { street: "Rua Antiga", neighborhood: "Centro", city: "Vila Velha", state: "ES" };
      }
      markSecondStarted();
      await secondGate;
      return { street: "Rua Nova", neighborhood: "Praia", city: "Vila Velha", state: "ES" };
    });
    await page.goto("/loja/hype/checkout");
    const cep = page.getByLabel("CEP");
    const street = page.getByLabel("Rua ou avenida");
    const lookupButton = page.getByRole("button", { name: /Buscar CEP|Buscando/ });

    await cep.fill("11111111");
    await firstStarted;
    await cep.fill("22222222");
    await secondStarted;
    const oldResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/backend") &&
        Boolean(response.request().postData()?.includes('"cep":"11111111"')),
    );
    releaseFirst();
    await oldResponse;
    await page.waitForTimeout(50);
    await expect(street).not.toHaveValue("Rua Antiga");
    await expect(lookupButton).toBeDisabled();

    releaseSecond();
    await expect(street).toHaveValue("Rua Nova");
    await expect(lookupButton).toBeEnabled();
  });

  test("uses browser geolocation, confirms the address and quotes delivery", async ({ page }) => {
    await page.context().grantPermissions(["geolocation"], { origin: "http://127.0.0.1:4173" });
    await page.context().setGeolocation({ latitude: -20.3297, longitude: -40.2925 });
    let quotedCoordinates: unknown = null;
    await installCheckoutFixture(page, async (name, body) => {
      if (name === "reverse-geocode") {
        return {
          cep: "29100-010",
          street: "Avenida Jeronimo Monteiro",
          neighborhood: "Centro",
          city: "Vila Velha",
          state: "ES",
        };
      }
      if (name === "quote-delivery") {
        quotedCoordinates = body.customerCoordinates;
        return {
          available: true,
          fee: 7.5,
          estimatedMin: 35,
          configurationFingerprint: "fixture-fingerprint",
        };
      }
      return null;
    });

    await page.goto("/loja/hype/checkout");
    await page.getByRole("button", { name: "Usar minha localização" }).click();
    await expect(page.getByText("Endereço aproximado preenchido", { exact: false })).toBeVisible();
    await expect(page.getByLabel("CEP")).toHaveValue("29100010");
    await expect(page.getByLabel("Rua ou avenida")).toHaveValue("Avenida Jeronimo Monteiro");
    await expect(page.getByLabel("Cidade")).toHaveValue("Vila Velha");
    await expect(page.getByLabel("UF")).toHaveValue("ES");

    await page.getByLabel("Número").fill("100");
    await expect(page.getByText("Entrega disponível", { exact: false })).toBeVisible();
    expect(quotedCoordinates).toEqual({ lat: -20.3297, lng: -40.2925 });
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
