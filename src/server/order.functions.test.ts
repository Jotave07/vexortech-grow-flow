import { describe, expect, it, vi } from "vitest";
import { createCheckoutOrderForActor } from "./order.functions";
import { deliveryConfigurationFingerprint } from "./delivery.service";

const actor = {
  user: { id: "11111111-1111-4111-8111-111111111111", email: "buyer@example.com" },
  profile: null,
  roles: new Set(["customer"]),
  admin: false,
  ownedStoreIds: [],
};

const store = {
  id: "22222222-2222-4222-8222-222222222222",
  owner_user_id: "33333333-3333-4333-8333-333333333333",
  is_active: true,
  is_suspended: false,
  delivery_fee: 4,
  min_order_amount: 0,
};

const settings = {
  allow_delivery: true,
  allow_pickup: true,
  accept_pix: true,
  accept_cash: true,
  accept_card_on_delivery: true,
  pix_key: "pix@loja.com.br",
  accept_orders_when_closed: true,
  is_open: true,
  business_hours: {},
  delivery_fee: 5,
  min_order_value: 0,
};

const checkoutInput = {
  storeId: store.id,
  idempotencyKey: "idem-123456",
  items: [
    {
      productId: "44444444-4444-4444-8444-444444444444",
      quantity: 2,
      notes: "sem cebola",
      options: [
        {
          optionId: "55555555-5555-4555-8555-555555555555",
          itemId: "66666666-6666-4666-8666-666666666666",
        },
      ],
    },
  ],
  customer: {
    name: "Maria",
    phone: "11999999999",
    document: "52998224725",
    email: "buyer@example.com",
  },
  delivery: {
    type: "entrega" as const,
    zipCode: "01001000",
    street: "Rua A",
    number: "10",
    neighborhood: "Centro",
    city: "Sao Paulo",
    state: "SP",
    regionId: null,
  },
  paymentMethod: "pix" as const,
  changeFor: null,
  couponCode: null,
  notes: "entregar na portaria",
  reference: "bloco B",
};

const createCheckoutDeps = (
  options: {
    existingCustomer?: any;
    existingOrder?: any;
    createPayment?: any;
    settings?: Record<string, unknown>;
  } = {},
) => {
  const inserted: Record<string, number> = {};
  const client = {
    query: vi.fn(async (sql: string, params?: any[]) => {
      if (sql.includes("FROM public.stores")) return { rows: [store] };
      if (sql.includes("FROM public.store_settings")) {
        return { rows: [{ ...settings, ...(options.settings || {}) }] };
      }
      if (sql.includes("FROM public.products") && !sql.includes("product_options")) {
        return {
          rows: [
            {
              id: checkoutInput.items[0].productId,
              store_id: store.id,
              name: "Pizza",
              price: 20,
              promo_price: null,
              is_active: true,
              is_available: true,
            },
          ],
        };
      }
      if (sql.includes("FROM public.product_options po")) {
        return {
          rows: [
            {
              id: checkoutInput.items[0].options[0].optionId,
              product_id: checkoutInput.items[0].productId,
              name: "Borda",
              is_required: true,
              min_choices: 1,
              max_choices: 1,
            },
          ],
        };
      }
      if (sql.includes("FROM public.product_option_items poi")) {
        return {
          rows: [
            {
              id: checkoutInput.items[0].options[0].itemId,
              option_id: checkoutInput.items[0].options[0].optionId,
              name: "Catupiry",
              extra_price: 3,
              is_active: true,
            },
          ],
        };
      }
      if (sql.includes("FROM public.delivery_zones")) return { rows: [] };
      if (sql.includes("FROM public.coupons")) return { rows: [] };
      if (sql.includes("FROM public.customers"))
        return { rows: options.existingCustomer ? [options.existingCustomer] : [] };
      if (sql.includes("UPDATE public.customers"))
        return {
          rows: [{ id: options.existingCustomer?.id || "77777777-7777-4777-8777-777777777777" }],
        };
      if (sql.includes("INSERT INTO public.customers"))
        return { rows: [{ id: "77777777-7777-4777-8777-777777777777" }] };
      if (sql.includes("idempotency_key = $1"))
        return { rows: options.existingOrder ? [options.existingOrder] : [] };
      if (sql.includes("INSERT INTO public.orders")) {
        inserted.orders = (inserted.orders || 0) + 1;
        return {
          rows: [
            {
              id: "88888888-8888-4888-8888-888888888888",
              store_id: store.id,
              public_token: "public-token",
              payment_method: params?.[14] || "pix",
              status: params?.[7] || "novo",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO public.order_items")) {
        inserted.items = (inserted.items || 0) + 1;
        return { rows: [{ id: "99999999-9999-4999-8999-999999999999" }] };
      }
      if (sql.includes("INSERT INTO public.order_item_options")) {
        inserted.options = (inserted.options || 0) + 1;
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO public.order_status_history")) {
        inserted.history = (inserted.history || 0) + 1;
        return { rows: [] };
      }
      return { rows: [] };
    }),
  };

  const deps = {
    getActor: vi.fn(),
    withTransaction: vi.fn(async (fn: any) => fn(client)),
    createPayment:
      options.createPayment ||
      vi.fn(async () => ({ paymentId: "manual-pix-payment", pixCode: "pix-code", manual: true })),
    notifyOrderCreated: vi.fn(async () => null),
    quoteDelivery: vi.fn(async () => ({
      available: true,
      fee: 7.5,
      distanceKm: 2.4,
      estimatedMin: 42,
      estimatedMax: 53,
      regionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      regionName: "Centro",
      source: "region",
      configurationFingerprint: deliveryConfigurationFingerprint(
        store,
        { ...settings, ...(options.settings || {}) },
        [],
      ),
    })),
  };

  return { deps, client, inserted };
};

describe("createCheckoutOrderForActor", () => {
  it("creates customer, order, item, option and one PIX payment from server-side prices", async () => {
    const { deps, inserted, client } = createCheckoutDeps();

    const result = await createCheckoutOrderForActor(checkoutInput, actor as any, deps as any);

    expect(result).toMatchObject({
      orderId: "88888888-8888-4888-8888-888888888888",
      publicToken: "public-token",
      payment: { paymentId: "manual-pix-payment", pixCode: "pix-code", manual: true },
    });
    expect(inserted).toMatchObject({ orders: 1, items: 1, options: 1, history: 1 });
    expect(deps.createPayment).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("notes, subtotal, options_total"),
      expect.arrayContaining(["sem cebola", 46, 3]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("option_id"),
      expect.arrayContaining([checkoutInput.items[0].options[0].optionId]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO public.orders"),
      expect.arrayContaining(["entregar na portaria", "bloco B"]),
    );
  });

  it("returns the same order for the same idempotency key without inserting another order", async () => {
    const { deps, inserted } = createCheckoutDeps({
      existingOrder: {
        id: "existing-order",
        store_id: store.id,
        public_token: "same-public-token",
        payment_method: "pix",
      },
    });

    const result = await createCheckoutOrderForActor(checkoutInput, actor as any, deps as any);

    expect(result).toMatchObject({ orderId: "existing-order", publicToken: "same-public-token" });
    expect(inserted.orders || 0).toBe(0);
    expect(deps.createPayment).toHaveBeenCalledTimes(1);
    expect(deps.quoteDelivery).not.toHaveBeenCalled();
  });

  it("updates an existing customer before creating a new order for the same user", async () => {
    const { deps, inserted, client } = createCheckoutDeps({
      existingCustomer: { id: "77777777-7777-4777-8777-777777777777" },
    });

    await createCheckoutOrderForActor(
      { ...checkoutInput, idempotencyKey: "idem-second-order" },
      actor as any,
      deps as any,
    );

    expect(inserted.orders).toBe(1);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE public.customers"),
      expect.arrayContaining(["MARIA", "11999999999", "52998224725", "RUA A", "10"]),
    );
    const updateCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE public.customers"),
    );
    expect(updateCall?.[0]).toContain("full_name = $1");
    expect(updateCall?.[0]).toContain("WHERE id = $11");
  });

  it("preserves an existing customer address when creating a pickup order", async () => {
    const existingCustomer = {
      id: "77777777-7777-4777-8777-777777777777",
      street: "RUA SALVA",
      number: "45",
      neighborhood: "CENTRO",
      city: "SAO PAULO",
      state: "SP",
      zip_code: "01001000",
    };
    const { deps, inserted, client } = createCheckoutDeps({ existingCustomer });
    const pickupInput = {
      ...checkoutInput,
      idempotencyKey: "pickup-preserves-address",
      paymentMethod: "dinheiro" as const,
      delivery: {
        type: "retirada" as const,
        zipCode: null,
        street: null,
        number: null,
        complement: null,
        neighborhood: null,
        city: null,
        state: null,
        regionId: null,
      },
    };

    await createCheckoutOrderForActor(pickupInput, actor as any, deps as any);

    const updateCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE public.customers"),
    );
    expect(updateCall?.[0]).not.toContain("street =");
    expect(updateCall?.[0]).not.toContain("registration_completed = true");
    expect(updateCall?.[1]).toEqual(["MARIA", "11999999999", "52998224725", existingCustomer.id]);
    expect(inserted.orders).toBe(1);
    expect(deps.quoteDelivery).not.toHaveBeenCalled();
  });

  it("keeps the order recoverable when PIX creation fails", async () => {
    const { deps, inserted } = createCheckoutDeps({
      createPayment: vi.fn(async () => {
        throw new Error("chave Pix ausente");
      }),
    });

    const result = await createCheckoutOrderForActor(checkoutInput, actor as any, deps as any);

    expect(result).toMatchObject({
      publicToken: "public-token",
      payment: { status: "falhou", error: "chave Pix ausente" },
    });
    expect(inserted.orders).toBe(1);
  });

  it.each(["retirada", "entrega"] as const)(
    "enforces the global minimum order server-side for %s",
    async (deliveryType) => {
      const { deps, inserted } = createCheckoutDeps({ settings: { min_order_value: 50 } });
      const input = {
        ...checkoutInput,
        idempotencyKey: `minimum-${deliveryType}`,
        delivery: { ...checkoutInput.delivery, type: deliveryType },
      };

      await expect(
        createCheckoutOrderForActor(input as any, actor as any, deps as any),
      ).rejects.toThrow("Pedido minimo de R$ 50.00 nao atingido");
      expect(inserted.orders || 0).toBe(0);
      if (deliveryType === "retirada") expect(deps.quoteDelivery).not.toHaveBeenCalled();
    },
  );

  it.each(["cancelado", "expirado", "entregue"])(
    "returns only tracking data when an idempotent retry finds a terminal %s order",
    async (status) => {
      const { deps, inserted } = createCheckoutDeps({
        existingOrder: {
          id: "existing-terminal-order",
          store_id: store.id,
          public_token: "terminal-public-token",
          payment_method: "pix",
          order_number: 91,
          status,
        },
      });

      const result = await createCheckoutOrderForActor(checkoutInput, actor as any, deps as any);

      expect(result).toEqual({
        orderId: "existing-terminal-order",
        publicToken: "terminal-public-token",
        orderNumber: 91,
        payment: null,
        terminalStatus: status,
      });
      expect(inserted.orders || 0).toBe(0);
      expect(deps.createPayment).not.toHaveBeenCalled();
      expect(deps.notifyOrderCreated).not.toHaveBeenCalled();
      expect(deps.quoteDelivery).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["zipCode", "", "CEP"],
    ["street", "", "rua"],
    ["number", "", "numero"],
    ["neighborhood", "", "bairro"],
    ["city", "", "cidade"],
    ["state", "X", "UF"],
  ])("rejects delivery without a valid server-side %s", async (field, value, message) => {
    const { deps, inserted } = createCheckoutDeps();
    const invalidInput = {
      ...checkoutInput,
      delivery: { ...checkoutInput.delivery, [field]: value },
    };

    await expect(
      createCheckoutOrderForActor(invalidInput, actor as any, deps as any),
    ).rejects.toThrow(message);
    expect(inserted.orders || 0).toBe(0);
    expect(deps.withTransaction).not.toHaveBeenCalled();
    expect(deps.quoteDelivery).not.toHaveBeenCalled();
  });

  it("keeps pickup valid without delivery address fields", async () => {
    const { deps, inserted, client } = createCheckoutDeps();
    const pickupInput = {
      ...checkoutInput,
      idempotencyKey: "pickup-no-address",
      paymentMethod: "dinheiro" as const,
      delivery: {
        type: "retirada" as const,
        zipCode: null,
        street: null,
        number: null,
        complement: null,
        neighborhood: null,
        city: null,
        state: null,
        regionId: null,
      },
    };

    await expect(
      createCheckoutOrderForActor(pickupInput, actor as any, deps as any),
    ).resolves.toMatchObject({ orderId: "88888888-8888-4888-8888-888888888888" });
    expect(inserted.orders).toBe(1);
    expect(deps.quoteDelivery).not.toHaveBeenCalled();
    expect(deps.createPayment).not.toHaveBeenCalled();
    const insertCustomerCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO public.customers"),
    );
    expect(insertCustomerCall?.[1]?.slice(5, 12)).toEqual(Array(7).fill(null));
    expect(insertCustomerCall?.[1]?.at(-1)).toBe(false);
  });
});
