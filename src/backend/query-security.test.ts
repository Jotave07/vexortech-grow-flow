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
};

const customerActor = {
  user: { id: USER_ID, email: "customer@example.com" },
  profile: { user_id: USER_ID, store_id: null, role: "customer" },
  roles: new Set(["customer"]),
  admin: false,
  ownedStoreIds: [],
};

const adminActor = {
  ...ownerActor,
  admin: true,
  roles: new Set(["admin"]),
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
          pix_key: "merchant-private-pix-key",
          asaas_api_key: "asaas-secret",
          payment_gateway_api_key: "gateway-secret",
          payment_gateway_config: { secret: true },
        },
      ],
    });

    const result = await executeQueryPayload(selectPayload("store_settings"));
    expect(result.data).toEqual([
      {
        id: "44444444-4444-4444-8444-444444444444",
        store_id: STORE_ID,
        accept_pix: true,
        pix_key: "[configured]",
        pix_gateway_configured: true,
      },
    ]);
    expect(JSON.stringify(result.data)).not.toContain("asaas-secret");
    expect(JSON.stringify(result.data)).not.toContain("gateway-secret");
    expect(JSON.stringify(result.data)).not.toContain("merchant-private-pix-key");
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
    expect(mocks.withTransaction).not.toHaveBeenCalled();
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
    expect(mocks.txQuery).toHaveBeenCalledTimes(2);
    expect(mocks.publishRealtime).not.toHaveBeenCalled();
  });

  it("allows only the review unique key for a non-admin upsert", async () => {
    mocks.getActor.mockResolvedValue(customerActor);
    mocks.query.mockResolvedValue({ rows: [{ id: "66666666-6666-4666-8666-666666666666" }] });

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
    expect(mocks.txQuery).not.toHaveBeenCalled();
  });

  it("guards a review conflict by the existing user and tenant", async () => {
    const reviewId = "77777777-7777-4777-8777-777777777777";
    mocks.getActor.mockResolvedValue(customerActor);
    mocks.query.mockResolvedValue({ rows: [{ id: "66666666-6666-4666-8666-666666666666" }] });
    mocks.txQuery
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
    const upsertSql = mocks.txQuery.mock.calls[0][0] as string;
    expect(upsertSql).toContain('INSERT INTO public."store_reviews" AS target');
    expect(upsertSql).toContain('target."user_id" = EXCLUDED."user_id"');
    expect(upsertSql).toContain('target."store_id" = EXCLUDED."store_id"');
    expect(upsertSql).not.toContain('"store_id" = EXCLUDED."store_id",');
  });
});
