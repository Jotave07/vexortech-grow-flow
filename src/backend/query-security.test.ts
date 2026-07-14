import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  assertActiveMerchantSubscription: vi.fn(),
  query: vi.fn(),
  txQuery: vi.fn(),
  withTransaction: vi.fn(),
  publishRealtime: vi.fn(),
}));

vi.mock("./auth", () => ({
  getActor: mocks.getActor,
  assertActiveMerchantSubscription: mocks.assertActiveMerchantSubscription,
}));
vi.mock("./realtime", () => ({ publishRealtime: mocks.publishRealtime }));
vi.mock("./db", () => ({
  query: mocks.query,
  quoteIdent: (value: string) => `"${String(value).replaceAll('"', '""')}"`,
  withTransaction: mocks.withTransaction,
}));

import { executeQueryPayload } from "./query";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_STORE_ID = "33333333-3333-4333-8333-333333333333";

const selectPayload = (table: string) => ({
  table,
  operation: "select" as const,
  select: "*",
  filters: [],
  orders: [],
});

const ownerActor = {
  user: { id: USER_ID, email: "owner@example.com" },
  profile: { user_id: USER_ID, store_id: STORE_ID, role: "store_owner" },
  roles: new Set(["store_owner"]),
  admin: false,
  ownedStoreIds: [STORE_ID],
  accessibleStoreIds: [STORE_ID],
};

const customerActor = {
  user: { id: USER_ID, email: "customer@example.com" },
  profile: { user_id: USER_ID, store_id: null, role: "customer" },
  roles: new Set(["customer"]),
  admin: false,
  ownedStoreIds: [],
  accessibleStoreIds: [],
};

const adminActor = {
  ...ownerActor,
  admin: true,
  roles: new Set(["admin"]),
};

const multiStoreOwner = {
  ...ownerActor,
  ownedStoreIds: [STORE_ID, OTHER_STORE_ID],
  accessibleStoreIds: [STORE_ID, OTHER_STORE_ID],
};

describe("query gateway security", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.withTransaction.mockImplementation(async (fn: any) => fn({ query: mocks.txQuery }));
    mocks.assertActiveMerchantSubscription.mockResolvedValue(undefined);
  });

  it("uses an explicit anonymous projection and strips unexpected store secrets defensively", async () => {
    mocks.getActor.mockResolvedValue(null);
    mocks.query.mockResolvedValue({
      rows: [
        {
          id: STORE_ID,
          name: "Safe Store",
          slug: "safe-store",
          owner_user_id: USER_ID,
          document: "12345678900",
          email: "private@example.com",
          verification_notes: "internal",
        },
      ],
    });

    const result = await executeQueryPayload(selectPayload("stores"));
    const sql = mocks.query.mock.calls[0][0] as string;
    expect(sql).not.toMatch(/^SELECT \* /);
    expect(sql).not.toContain('"document"');
    expect(sql).not.toContain('"owner_user_id"');
    expect(result.data).toEqual([{ id: STORE_ID, name: "Safe Store", slug: "safe-store" }]);
  });

  it("never returns payment credentials from public store settings", async () => {
    mocks.getActor.mockResolvedValue(null);
    mocks.query.mockResolvedValue({
      rows: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          store_id: STORE_ID,
          accept_pix: true,
          pix_checkout_available: true,
          pix_key: "merchant-private-pix-key",
          asaas_api_key: "asaas-secret",
          payment_gateway_api_key: "gateway-secret",
          payment_gateway_config: { secret: true },
          order_realtime_capability: "55555555-5555-4555-8555-555555555555",
        },
      ],
    });

    const result = await executeQueryPayload(selectPayload("store_settings"));
    expect(result.data).toEqual([
      {
        id: "44444444-4444-4444-8444-444444444444",
        store_id: STORE_ID,
        accept_pix: true,
        pix_checkout_available: true,
        pix_key: "[configured]",
        pix_gateway_configured: true,
      },
    ]);
    expect(JSON.stringify(result.data)).not.toContain("asaas-secret");
    expect(JSON.stringify(result.data)).not.toContain("gateway-secret");
    expect(JSON.stringify(result.data)).not.toContain("merchant-private-pix-key");
    expect(JSON.stringify(result.data)).not.toContain("55555555-5555-4555-8555-555555555555");
  });

  it.each([
    ["owner", ownerActor],
    ["token administrator", adminActor],
  ])("keeps store-setting credentials private from an authenticated %s", async (_label, actor) => {
    mocks.getActor.mockResolvedValue(actor);
    mocks.query.mockResolvedValue({
      rows: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          store_id: STORE_ID,
          is_open: true,
          allow_delivery: true,
          delivery_fee: 7.5,
          asaas_api_key: "asaas-secret",
          asaas_wallet_id: "wallet-secret",
          payment_gateway_api_key: "gateway-secret",
          payment_gateway_config: { token: "config-secret" },
          payment_gateway_provider: "private-provider",
        },
      ],
    });

    const result = await executeQueryPayload(
      {
        ...selectPayload("store_settings"),
        filters: [{ op: "eq", column: "store_id", value: STORE_ID }],
      },
      { token: "authenticated-token" },
    );

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        id: "44444444-4444-4444-8444-444444444444",
        store_id: STORE_ID,
        is_open: true,
        allow_delivery: true,
        delivery_fee: 7.5,
      },
    ]);
    expect(mocks.query.mock.calls[0]?.[0]).not.toMatch(/^SELECT \* /);
    expect(JSON.stringify(result.data)).not.toMatch(/secret|private-provider/);
  });

  it.each(["asaas_api_key", "payment_gateway_api_key", "payment_gateway_config"])(
    "rejects an authenticated browser request for store_settings.%s",
    async (column) => {
      mocks.getActor.mockResolvedValue(ownerActor);

      const result = await executeQueryPayload(
        {
          ...selectPayload("store_settings"),
          select: column,
          filters: [{ op: "eq", column: "store_id", value: STORE_ID }],
        },
        { token: "owner-token" },
      );

      expect(result.error?.message).toContain("projecao publica");
      expect(mocks.query).not.toHaveBeenCalled();
    },
  );

  it("returns the Realtime capability only through its authorized function, never the query gateway", async () => {
    mocks.query.mockResolvedValue({
      rows: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          store_id: STORE_ID,
          pix_key: "admin-visible-private-setting",
          order_realtime_capability: "55555555-5555-4555-8555-555555555555",
        },
      ],
    });

    const wildcard = await executeQueryPayload(selectPayload("store_settings"), { admin: true });
    expect(wildcard.data).toEqual([
      {
        id: "44444444-4444-4444-8444-444444444444",
        store_id: STORE_ID,
        pix_key: "admin-visible-private-setting",
      },
    ]);

    const explicit = await executeQueryPayload(
      { ...selectPayload("store_settings"), select: "order_realtime_capability" },
      { admin: true },
    );
    expect(explicit.error?.message).toContain("somente pela funcao autorizada");

    const mutation = await executeQueryPayload(
      {
        table: "store_settings",
        operation: "update",
        values: { order_realtime_capability: "66666666-6666-4666-8666-666666666666" },
        filters: [{ op: "eq", column: "store_id", value: STORE_ID }],
        orders: [],
      },
      { admin: true },
    );
    expect(mutation.error?.message).toContain("gerenciada somente pelo banco");
  });

  it("uses a public SQL projection for an owner's unscoped public-store lookup", async () => {
    mocks.getActor.mockResolvedValue(ownerActor);
    mocks.query.mockResolvedValue({
      rows: [
        { id: OTHER_STORE_ID, slug: "competitor", name: "Competitor", document: "private-doc" },
      ],
    });

    const result = await executeQueryPayload(
      {
        ...selectPayload("stores"),
        filters: [{ op: "eq", column: "slug", value: "competitor" }],
      },
      { token: "valid" },
    );

    const sql = mocks.query.mock.calls[0][0] as string;
    expect(sql).not.toMatch(/^SELECT \* /);
    expect(sql).not.toContain('"document"');
    expect(result.data).toEqual([{ id: OTHER_STORE_ID, slug: "competitor", name: "Competitor" }]);
  });

  it("preserves private fields when an owner query is provably scoped to their store", async () => {
    mocks.getActor.mockResolvedValue(ownerActor);
    mocks.query.mockResolvedValue({
      rows: [
        { id: STORE_ID, owner_user_id: USER_ID, slug: "own", name: "Own", document: "owner-doc" },
      ],
    });

    const result = await executeQueryPayload(
      {
        ...selectPayload("stores"),
        filters: [{ op: "eq", column: "id", value: STORE_ID }],
      },
      { token: "valid" },
    );

    const sql = mocks.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/^SELECT \* /);
    expect(result.data).toEqual([
      {
        id: STORE_ID,
        owner_user_id: USER_ID,
        slug: "own",
        name: "Own",
        document: "owner-doc",
      },
    ]);
  });

  it("rejects a tenant reassignment before issuing an update", async () => {
    mocks.getActor.mockResolvedValue(ownerActor);
    const result = await executeQueryPayload(
      {
        table: "products",
        operation: "update",
        values: { store_id: OTHER_STORE_ID },
        filters: [{ op: "eq", column: "id", value: "55555555-5555-4555-8555-555555555555" }],
        orders: [],
      },
      { token: "valid" },
    );

    expect(result.error?.message).toContain("Tenant");
    expect(mocks.withTransaction).toHaveBeenCalledOnce();
    expect(mocks.txQuery).not.toHaveBeenCalled();
  });

  it.each([
    ["stores", "insert", { id: STORE_ID, owner_user_id: USER_ID, name: "Loja indevida" }, []],
    [
      "profiles",
      "update",
      { role: "store_owner" },
      [{ op: "eq", column: "user_id", value: USER_ID }],
    ],
    ["profiles", "update", { role: "admin" }, [{ op: "eq", column: "user_id", value: USER_ID }]],
    ["user_roles", "insert", { user_id: USER_ID, store_id: STORE_ID, role: "store_owner" }, []],
    ["user_roles", "delete", undefined, [{ op: "eq", column: "user_id", value: USER_ID }]],
    ["store_settings", "insert", { store_id: STORE_ID, is_open: true }, []],
    [
      "store_settings",
      "update",
      { is_open: true },
      [{ op: "eq", column: "store_id", value: STORE_ID }],
    ],
    ["store_settings", "delete", undefined, [{ op: "eq", column: "store_id", value: STORE_ID }]],
  ] as const)(
    "blocks a customer's generic %s %s before opening a transaction",
    async (table, operation, values, filters) => {
      mocks.getActor.mockResolvedValue(customerActor);

      const result = await executeQueryPayload(
        { table, operation, values, filters: [...filters], orders: [] } as any,
        { token: "customer-token" },
      );

      expect(result.error?.message).toContain("somente por fluxo seguro do servidor");
      expect(mocks.withTransaction).not.toHaveBeenCalled();
    },
  );

  it.each(["profiles", "user_roles"])(
    "preserves an authenticated user's scoped %s reads",
    async (table) => {
      mocks.getActor.mockResolvedValue(customerActor);
      mocks.query.mockResolvedValue({
        rows: [{ id: "44444444-4444-4444-8444-444444444444", user_id: USER_ID, role: "customer" }],
      });

      const result = await executeQueryPayload(
        {
          ...selectPayload(table),
          filters: [{ op: "eq", column: "user_id", value: USER_ID }],
        },
        { token: "customer-token" },
      );

      expect(result.error).toBeNull();
      expect(result.data).toEqual([
        { id: "44444444-4444-4444-8444-444444444444", user_id: USER_ID, role: "customer" },
      ]);
      expect(mocks.query.mock.calls[0]?.[0]).toContain('"user_id" =');
    },
  );

  it("rejects a customer mutation of a merchant table before any write", async () => {
    mocks.getActor.mockResolvedValue(customerActor);

    const result = await executeQueryPayload(
      {
        table: "products",
        operation: "insert",
        values: {
          id: "55555555-5555-4555-8555-555555555555",
          store_id: STORE_ID,
          name: "Produto",
        },
        filters: [],
        orders: [],
      },
      { token: "customer-token" },
    );

    expect(result.error?.message).toContain("Tenant");
    expect(mocks.assertActiveMerchantSubscription).not.toHaveBeenCalled();
    expect(mocks.withTransaction).toHaveBeenCalledOnce();
    expect(mocks.txQuery).not.toHaveBeenCalled();
  });

  it("checks every store in a batched merchant mutation before writing any row", async () => {
    mocks.getActor.mockResolvedValue(multiStoreOwner);
    mocks.assertActiveMerchantSubscription
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Assinatura inativa."));

    const result = await executeQueryPayload(
      {
        table: "products",
        operation: "insert",
        values: [
          { id: "55555555-5555-4555-8555-555555555555", store_id: STORE_ID, name: "A" },
          { id: "66666666-6666-4666-8666-666666666666", store_id: OTHER_STORE_ID, name: "B" },
        ],
        filters: [],
        orders: [],
      },
      { token: "owner-token" },
    );

    expect(result.error?.message).toContain("Assinatura inativa");
    expect(mocks.assertActiveMerchantSubscription.mock.calls).toEqual([
      [
        multiStoreOwner,
        STORE_ID,
        expect.objectContaining({ execute: expect.any(Function), lock: true }),
      ],
      [
        multiStoreOwner,
        OTHER_STORE_ID,
        expect.objectContaining({ execute: expect.any(Function), lock: true }),
      ],
    ]);
    expect(mocks.withTransaction).toHaveBeenCalledOnce();
    expect(mocks.txQuery).not.toHaveBeenCalled();
  });

  it("checks only the exact product target and does not let an unrelated inactive store block it", async () => {
    const productId = "55555555-5555-4555-8555-555555555555";
    mocks.getActor.mockResolvedValue(multiStoreOwner);
    mocks.assertActiveMerchantSubscription.mockImplementation(async (_actor, storeId) => {
      if (storeId === OTHER_STORE_ID) throw new Error("Assinatura inativa.");
    });
    mocks.txQuery
      .mockResolvedValueOnce({ rows: [{ id: productId, store_id: STORE_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: productId, store_id: STORE_ID, name: "Atualizado" }] })
      .mockResolvedValueOnce({ rows: [{ id: productId }] });

    const result = await executeQueryPayload(
      {
        table: "products",
        operation: "update",
        values: { name: "Atualizado" },
        filters: [{ op: "eq", column: "id", value: productId }],
        orders: [],
      },
      { token: "multi-store-owner-token" },
    );

    expect(result.error).toBeNull();
    expect(mocks.assertActiveMerchantSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.assertActiveMerchantSubscription).toHaveBeenCalledWith(
      multiStoreOwner,
      STORE_ID,
      expect.objectContaining({ execute: expect.any(Function), lock: true }),
    );
    expect(mocks.txQuery.mock.calls[0]?.[0]).toMatch(/FOR UPDATE/);
    expect(mocks.txQuery.mock.calls[1]?.[0]).toContain("WHERE id = ANY($1::uuid[])");
    expect(mocks.txQuery.mock.calls[1]?.[1]?.[0]).toEqual([productId]);
  });

  it("resolves every actual store matched by an OR filter before an update", async () => {
    const productA = "55555555-5555-4555-8555-555555555555";
    const productB = "66666666-6666-4666-8666-666666666666";
    mocks.getActor.mockResolvedValue(multiStoreOwner);
    mocks.txQuery.mockResolvedValueOnce({
      rows: [
        { id: productA, store_id: STORE_ID },
        { id: productB, store_id: OTHER_STORE_ID },
      ],
    });
    mocks.assertActiveMerchantSubscription
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Assinatura inativa."));

    const result = await executeQueryPayload(
      {
        table: "products",
        operation: "update",
        values: { is_active: false },
        filters: [
          {
            op: "or",
            filters: [
              { op: "eq", column: "id", value: productA },
              { op: "eq", column: "id", value: productB },
            ],
          },
        ],
        orders: [],
      },
      { token: "multi-store-owner-token" },
    );

    expect(result.error?.message).toContain("Assinatura inativa");
    expect(mocks.txQuery).toHaveBeenCalledOnce();
    expect(mocks.txQuery.mock.calls[0]?.[0]).toMatch(/\bOR\b/);
    expect(mocks.txQuery.mock.calls[0]?.[0]).toMatch(/FOR UPDATE/);
    expect(mocks.assertActiveMerchantSubscription.mock.calls.map((call) => call[1])).toEqual([
      STORE_ID,
      OTHER_STORE_ID,
    ]);
  });

  it("resolves the exact inactive product store before a delete by id", async () => {
    const productId = "55555555-5555-4555-8555-555555555555";
    mocks.getActor.mockResolvedValue(multiStoreOwner);
    mocks.txQuery.mockResolvedValueOnce({
      rows: [{ id: productId, store_id: OTHER_STORE_ID }],
    });
    mocks.assertActiveMerchantSubscription.mockRejectedValueOnce(new Error("Assinatura inativa."));

    const result = await executeQueryPayload(
      {
        table: "products",
        operation: "delete",
        filters: [{ op: "eq", column: "id", value: productId }],
        orders: [],
      },
      { token: "multi-store-owner-token" },
    );

    expect(result.error?.message).toContain("Assinatura inativa");
    expect(mocks.txQuery).toHaveBeenCalledOnce();
    expect(mocks.txQuery.mock.calls[0]?.[0]).toMatch(/FOR UPDATE/);
    expect(mocks.assertActiveMerchantSubscription).toHaveBeenCalledWith(
      multiStoreOwner,
      OTHER_STORE_ID,
      expect.objectContaining({ execute: expect.any(Function), lock: true }),
    );
  });

  it.each([
    ["product_options", "product_options target", "JOIN public.products product"],
    [
      "product_option_items",
      "product_option_items target",
      "JOIN public.product_options option_row",
    ],
  ])(
    "resolves the actual inactive tenant for a %s update through its locked relations",
    async (table, targetSql, relationSql) => {
      const targetId = "77777777-7777-4777-8777-777777777777";
      mocks.getActor.mockResolvedValue(multiStoreOwner);
      mocks.txQuery.mockResolvedValueOnce({ rows: [{ id: targetId, store_id: OTHER_STORE_ID }] });
      mocks.assertActiveMerchantSubscription.mockRejectedValueOnce(
        new Error("Assinatura inativa."),
      );

      const result = await executeQueryPayload(
        {
          table,
          operation: "update",
          values: { name: "Alterado" },
          filters: [{ op: "eq", column: "id", value: targetId }],
          orders: [],
        },
        { token: "multi-store-owner-token" },
      );

      expect(result.error?.message).toContain("Assinatura inativa");
      expect(mocks.txQuery).toHaveBeenCalledOnce();
      const lockSql = mocks.txQuery.mock.calls[0]?.[0] as string;
      expect(lockSql).toContain(targetSql);
      expect(lockSql).toContain(relationSql);
      expect(lockSql).toContain("FOR UPDATE OF target");
      expect(lockSql).toContain("FOR SHARE OF");
      expect(mocks.assertActiveMerchantSubscription).toHaveBeenCalledWith(
        multiStoreOwner,
        OTHER_STORE_ID,
        expect.objectContaining({ execute: expect.any(Function), lock: true }),
      );
    },
  );

  it.each([
    [
      "categories",
      { id: "55555555-5555-4555-8555-555555555555", store_id: STORE_ID, name: "Categoria" },
    ],
    [
      "products",
      { id: "66666666-6666-4666-8666-666666666666", store_id: STORE_ID, name: "Produto" },
    ],
  ])("allows an active associated owner to mutate merchant table %s", async (table, values) => {
    mocks.getActor.mockResolvedValue(ownerActor);
    mocks.txQuery
      .mockResolvedValueOnce({ rows: [values] })
      .mockResolvedValueOnce({ rows: [{ id: values.id }] });

    const result = await executeQueryPayload(
      { table, operation: "insert", values, filters: [], orders: [] },
      { token: "owner-token" },
    );

    expect(result.error).toBeNull();
    expect(mocks.assertActiveMerchantSubscription).toHaveBeenCalledWith(
      ownerActor,
      STORE_ID,
      expect.objectContaining({ execute: expect.any(Function), lock: true }),
    );
    expect(mocks.txQuery).toHaveBeenCalledTimes(2);
  });

  it("uses an explicit staff assignment without treating it as store ownership", async () => {
    const staffActor = {
      ...customerActor,
      profile: { user_id: USER_ID, store_id: STORE_ID, role: "store_manager" },
      roles: new Set(["store_manager"]),
      accessibleStoreIds: [STORE_ID],
    };
    const values = {
      id: "66666666-6666-4666-8666-666666666666",
      store_id: STORE_ID,
      name: "Produto do time",
    };
    mocks.getActor.mockResolvedValue(staffActor);
    mocks.txQuery
      .mockResolvedValueOnce({ rows: [values] })
      .mockResolvedValueOnce({ rows: [{ id: values.id }] });

    const result = await executeQueryPayload(
      { table: "products", operation: "insert", values, filters: [], orders: [] },
      { token: "staff-token" },
    );

    expect(result.error).toBeNull();
    expect(mocks.assertActiveMerchantSubscription).toHaveBeenCalledWith(
      staffActor,
      STORE_ID,
      expect.objectContaining({ execute: expect.any(Function), lock: true }),
    );
  });

  it("accepts a product batch only when every category belongs to the product store", async () => {
    const productA = "55555555-5555-4555-8555-555555555555";
    const productB = "66666666-6666-4666-8666-666666666666";
    const categoryA = "77777777-7777-4777-8777-777777777777";
    const categoryB = "88888888-8888-4888-8888-888888888888";
    const values = [
      { id: productA, store_id: STORE_ID, category_id: categoryA, name: "A" },
      { id: productB, store_id: OTHER_STORE_ID, category_id: categoryB, name: "B" },
    ];
    mocks.getActor.mockResolvedValue(multiStoreOwner);
    mocks.txQuery
      .mockResolvedValueOnce({ rows: values })
      .mockResolvedValueOnce({
        rows: [
          { id: categoryA, store_id: STORE_ID },
          { id: categoryB, store_id: OTHER_STORE_ID },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: productA }, { id: productB }] });

    const result = await executeQueryPayload(
      { table: "products", operation: "insert", values, filters: [], orders: [] },
      { token: "multi-store-owner-token" },
    );

    expect(result.error).toBeNull();
    expect(mocks.txQuery).toHaveBeenCalledTimes(3);
    const categoryLockSql = mocks.txQuery.mock.calls[1]?.[0] as string;
    expect(categoryLockSql).toContain("FROM public.categories");
    expect(categoryLockSql).toContain("FOR SHARE");
  });

  it("rolls back a product insert whose category belongs to another store", async () => {
    const productId = "55555555-5555-4555-8555-555555555555";
    const categoryId = "77777777-7777-4777-8777-777777777777";
    const values = {
      id: productId,
      store_id: STORE_ID,
      category_id: categoryId,
      name: "Produto cruzado",
    };
    mocks.getActor.mockResolvedValue(ownerActor);
    mocks.txQuery
      .mockResolvedValueOnce({ rows: [values] })
      .mockResolvedValueOnce({ rows: [{ id: categoryId, store_id: OTHER_STORE_ID }] });

    const result = await executeQueryPayload(
      { table: "products", operation: "insert", values, filters: [], orders: [] },
      { token: "owner-token" },
    );

    expect(result.error?.message).toContain("mesma loja");
    expect(mocks.txQuery).toHaveBeenCalledTimes(2);
    expect(mocks.publishRealtime).not.toHaveBeenCalled();
  });

  it("rolls back a product update that assigns a category from another store", async () => {
    const productId = "55555555-5555-4555-8555-555555555555";
    const categoryId = "77777777-7777-4777-8777-777777777777";
    mocks.getActor.mockResolvedValue(ownerActor);
    mocks.txQuery
      .mockResolvedValueOnce({ rows: [{ id: productId, store_id: STORE_ID }] })
      .mockResolvedValueOnce({
        rows: [{ id: productId, store_id: STORE_ID, category_id: categoryId }],
      })
      .mockResolvedValueOnce({ rows: [{ id: categoryId, store_id: OTHER_STORE_ID }] });

    const result = await executeQueryPayload(
      {
        table: "products",
        operation: "update",
        values: { category_id: categoryId },
        filters: [{ op: "eq", column: "id", value: productId }],
        orders: [],
      },
      { token: "owner-token" },
    );

    expect(result.error?.message).toContain("mesma loja");
    expect(mocks.txQuery).toHaveBeenCalledTimes(3);
    expect(mocks.txQuery.mock.calls[1]?.[0]).toContain("WHERE id = ANY($1::uuid[])");
    expect(mocks.publishRealtime).not.toHaveBeenCalled();
  });

  it("validates product categories for privileged upsert batches too", async () => {
    const productA = "55555555-5555-4555-8555-555555555555";
    const productB = "66666666-6666-4666-8666-666666666666";
    const categoryA = "77777777-7777-4777-8777-777777777777";
    const categoryB = "88888888-8888-4888-8888-888888888888";
    mocks.txQuery
      .mockResolvedValueOnce({
        rows: [
          { id: productA, store_id: STORE_ID, category_id: categoryA },
          { id: productB, store_id: STORE_ID, category_id: categoryB },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: categoryA, store_id: STORE_ID },
          { id: categoryB, store_id: OTHER_STORE_ID },
        ],
      });

    const result = await executeQueryPayload(
      {
        table: "products",
        operation: "upsert",
        values: [
          { id: productA, store_id: STORE_ID, category_id: categoryA, name: "Admin A" },
          { id: productB, store_id: STORE_ID, category_id: categoryB, name: "Admin B" },
        ],
        upsertOptions: { onConflict: "id" },
        filters: [],
        orders: [],
      },
      { admin: true },
    );

    expect(result.error?.message).toContain("mesma loja");
    expect(mocks.txQuery).toHaveBeenCalledTimes(2);
    expect(mocks.txQuery.mock.calls[0]?.[0]).toContain("ON CONFLICT");
    expect(mocks.getActor).not.toHaveBeenCalled();
    expect(mocks.publishRealtime).not.toHaveBeenCalled();
  });

  it.each([
    ["profiles", { is_exempt: true }],
    ["profiles", { billing_exemption_pending: false }],
    ["stores", { is_suspended: true }],
    ["subscriptions", { status: "ativa" }],
  ])(
    "forces token-authenticated admins to use billing-aware functions for %s",
    async (table, values) => {
      mocks.getActor.mockResolvedValue(adminActor);

      const result = await executeQueryPayload(
        {
          table,
          operation: "update",
          values,
          filters: [{ op: "eq", column: "id", value: STORE_ID }],
          orders: [],
        },
        { token: "admin-token" },
      );

      expect(result.error?.message).toMatch(/funcao/i);
      expect(mocks.getActor).not.toHaveBeenCalled();
      expect(mocks.withTransaction).not.toHaveBeenCalled();
    },
  );

  it("post-validates returned rows inside the transaction boundary", async () => {
    mocks.getActor.mockResolvedValue(ownerActor);
    mocks.txQuery
      .mockResolvedValueOnce({
        rows: [{ id: "55555555-5555-4555-8555-555555555555", store_id: STORE_ID }],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: "55555555-5555-4555-8555-555555555555", store_id: OTHER_STORE_ID, name: "Moved" },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await executeQueryPayload(
      {
        table: "products",
        operation: "update",
        values: { name: "Moved" },
        filters: [{ op: "eq", column: "id", value: "55555555-5555-4555-8555-555555555555" }],
        orders: [],
      },
      { token: "valid" },
    );

    expect(result.error?.message).toContain("saiu do escopo autorizado");
    expect(mocks.txQuery).toHaveBeenCalledTimes(3);
    expect(mocks.publishRealtime).not.toHaveBeenCalled();
  });

  it("allows only the review unique key for a non-admin upsert", async () => {
    mocks.getActor.mockResolvedValue(customerActor);
    mocks.txQuery.mockResolvedValueOnce({
      rows: [{ id: "66666666-6666-4666-8666-666666666666" }],
    });

    const result = await executeQueryPayload(
      {
        table: "store_reviews",
        operation: "upsert",
        values: {
          store_id: STORE_ID,
          order_id: "66666666-6666-4666-8666-666666666666",
          rating: 5,
        },
        upsertOptions: { onConflict: "id" },
        filters: [],
        orders: [],
      },
      { token: "valid" },
    );

    expect(result.error?.message).toContain("Upsert nao permitido");
    expect(mocks.withTransaction).toHaveBeenCalledOnce();
    expect(mocks.txQuery).toHaveBeenCalledOnce();
  });

  it("guards a review conflict by the existing user and tenant", async () => {
    const reviewId = "77777777-7777-4777-8777-777777777777";
    mocks.getActor.mockResolvedValue(customerActor);
    mocks.txQuery
      .mockResolvedValueOnce({ rows: [{ id: "66666666-6666-4666-8666-666666666666" }] })
      .mockResolvedValueOnce({ rows: [{ id: reviewId, store_id: STORE_ID, user_id: USER_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: reviewId }] });

    const result = await executeQueryPayload(
      {
        table: "store_reviews",
        operation: "upsert",
        values: {
          store_id: STORE_ID,
          order_id: "66666666-6666-4666-8666-666666666666",
          rating: 5,
          comment: "Great",
        },
        upsertOptions: { onConflict: "order_id" },
        filters: [],
        orders: [],
      },
      { token: "valid" },
    );

    expect(result.error).toBeNull();
    const upsertSql = mocks.txQuery.mock.calls[1][0] as string;
    expect(upsertSql).toContain('INSERT INTO public."store_reviews" AS target');
    expect(upsertSql).toContain('target."user_id" = EXCLUDED."user_id"');
    expect(upsertSql).toContain('target."store_id" = EXCLUDED."store_id"');
    expect(upsertSql).not.toContain('"store_id" = EXCLUDED."store_id",');
  });

  it.each([
    ["negative fee", { fee: -0.01 }],
    ["NaN fee", { fee: "NaN" }],
    ["infinite fee", { fee_per_km: "Infinity" }],
    ["inverted bounds", { min_fee: 30, max_fee: 10 }],
    ["invalid radius", { max_radius_km: 0 }],
    ["invalid timing", { base_prep_time: 1.5 }],
  ])("rejects a delivery zone with %s before issuing SQL", async (_label, invalidValues) => {
    mocks.getActor.mockResolvedValue(ownerActor);

    const result = await executeQueryPayload(
      {
        table: "delivery_zones",
        operation: "insert",
        values: {
          store_id: STORE_ID,
          name: "Centro",
          city: "VILA VELHA",
          state: "ES",
          ...invalidValues,
        },
        filters: [],
        orders: [],
      },
      { token: "owner-token" },
    );

    expect(result.error?.message).toMatch(/regiao|taxa|raio|preparo/i);
    expect(mocks.txQuery).not.toHaveBeenCalled();
    expect(mocks.publishRealtime).not.toHaveBeenCalled();
  });
});
