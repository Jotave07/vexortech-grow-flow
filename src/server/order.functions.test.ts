import { describe, expect, it, vi } from "vitest";
import { createCheckoutOrderForActor } from "./order.functions";

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
  accept_orders_when_closed: true,
  is_open: true,
  business_hours: {},
  delivery_fee: 5,
  min_order_value: 0,
};

const checkoutInput = {
  storeId: store.id,
  idempotencyKey: "idem-123456",
  items: [{
    productId: "44444444-4444-4444-8444-444444444444",
    quantity: 2,
    notes: "sem cebola",
    options: [{
      optionId: "55555555-5555-4555-8555-555555555555",
      itemId: "66666666-6666-4666-8666-666666666666",
    }],
  }],
  customer: {
    name: "Maria",
    phone: "11999999999",
    document: "12345678901",
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
};

const createCheckoutDeps = (options: { existingOrder?: any; createPayment?: any } = {}) => {
  const inserted: Record<string, number> = {};
  const client = {
    query: vi.fn(async (sql: string, params?: any[]) => {
      if (sql.includes("FROM public.stores")) return { rows: [store] };
      if (sql.includes("FROM public.store_settings")) return { rows: [settings] };
      if (sql.includes("FROM public.products") && !sql.includes("product_options")) {
        return { rows: [{ id: checkoutInput.items[0].productId, store_id: store.id, name: "Pizza", price: 20, promo_price: null, is_active: true, is_available: true }] };
      }
      if (sql.includes("FROM public.product_options po")) {
        return { rows: [{ id: checkoutInput.items[0].options[0].optionId, product_id: checkoutInput.items[0].productId, name: "Borda", is_required: true, min_choices: 1, max_choices: 1 }] };
      }
      if (sql.includes("FROM public.product_option_items poi")) {
        return { rows: [{ id: checkoutInput.items[0].options[0].itemId, option_id: checkoutInput.items[0].options[0].optionId, name: "Catupiry", extra_price: 3, is_active: true }] };
      }
      if (sql.includes("FROM public.delivery_zones")) return { rows: [] };
      if (sql.includes("FROM public.coupons")) return { rows: [] };
      if (sql.includes("FROM public.customers")) return { rows: [] };
      if (sql.includes("INSERT INTO public.customers")) return { rows: [{ id: "77777777-7777-4777-8777-777777777777" }] };
      if (sql.includes("WHERE idempotency_key")) return { rows: options.existingOrder ? [options.existingOrder] : [] };
      if (sql.includes("INSERT INTO public.orders")) {
        inserted.orders = (inserted.orders || 0) + 1;
        return { rows: [{ id: "88888888-8888-4888-8888-888888888888", store_id: store.id, public_token: "public-token", payment_method: "pix" }] };
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
    createPayment: options.createPayment || vi.fn(async () => ({ paymentId: "asaas-payment", pixCode: "pix-code" })),
    notifyOrderCreated: vi.fn(async () => null),
  };

  return { deps, client, inserted };
};

describe("createCheckoutOrderForActor", () => {
  it("creates customer, order, item, option and one PIX payment from server-side prices", async () => {
    const { deps, inserted } = createCheckoutDeps();

    const result = await createCheckoutOrderForActor(checkoutInput, actor as any, deps as any);

    expect(result).toMatchObject({
      orderId: "88888888-8888-4888-8888-888888888888",
      publicToken: "public-token",
      payment: { paymentId: "asaas-payment", pixCode: "pix-code" },
    });
    expect(inserted).toMatchObject({ orders: 1, items: 1, options: 1, history: 1 });
    expect(deps.createPayment).toHaveBeenCalledTimes(1);
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
  });

  it("keeps the order recoverable when PIX creation fails", async () => {
    const { deps, inserted } = createCheckoutDeps({
      createPayment: vi.fn(async () => {
        throw new Error("gateway fora");
      }),
    });

    const result = await createCheckoutOrderForActor(checkoutInput, actor as any, deps as any);

    expect(result).toMatchObject({
      publicToken: "public-token",
      payment: { status: "falhou", error: "gateway fora" },
    });
    expect(inserted.orders).toBe(1);
  });
});
