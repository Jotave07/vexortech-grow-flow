import { describe, expect, it } from "vitest";
import { resolveActorAdmin, sanitizePublicSignupMetadata } from "./auth";
import { assertSafePatchForNonAdmin } from "./query";

describe("backend authorization hardening", () => {
  it("forces public signups to start as customer even if a role is supplied", () => {
    expect(sanitizePublicSignupMetadata({
      full_name: "Mallory",
      account_type: "super_admin",
      role: "admin",
    })).toMatchObject({
      full_name: "Mallory",
      account_type: "customer",
      role: "customer",
    });
  });

  it("does not treat store-scoped admin roles as platform admin", () => {
    expect(resolveActorAdmin({
      email: "owner@example.com",
      profileRole: "store_owner",
      roleRows: [{ role: "admin", store_id: "11111111-1111-4111-8111-111111111111" }],
    })).toBe(false);

    expect(resolveActorAdmin({
      email: "owner@example.com",
      profileRole: "admin",
      profileStoreId: "11111111-1111-4111-8111-111111111111",
      roleRows: [],
    })).toBe(false);

    expect(resolveActorAdmin({
      email: "admin@example.com",
      profileRole: "customer",
      roleRows: [{ role: "admin", store_id: null }],
    })).toBe(true);
  });

  it("blocks non-admin role escalation through generic mutations", () => {
    expect(() => assertSafePatchForNonAdmin("profiles", "update", { role: "super_admin" })).toThrow(
      "Papel administrativo",
    );
    expect(() => assertSafePatchForNonAdmin("user_roles", "insert", { role: "admin" })).toThrow(
      "Papel administrativo",
    );
    expect(() => assertSafePatchForNonAdmin("profiles", "update", { role: "store_owner" })).not.toThrow();
  });

  it("blocks generic financial and operational mutations", () => {
    expect(() => assertSafePatchForNonAdmin("orders", "update", { status: "entregue" })).toThrow(
      "funcoes seguras",
    );
    expect(() => assertSafePatchForNonAdmin("payments", "update", { status: "pago" })).toThrow(
      "dados financeiros",
    );
    expect(() => assertSafePatchForNonAdmin("subscriptions", "insert", { status: "ativa" })).toThrow(
      "dados financeiros",
    );
    expect(() => assertSafePatchForNonAdmin("orders", "update", { is_seen: true })).not.toThrow();
  });

  it("blocks owner updates to platform-controlled store fields", () => {
    expect(() => assertSafePatchForNonAdmin("stores", "update", { plan_id: "11111111-1111-4111-8111-111111111111" })).toThrow(
      "Campo de loja protegido",
    );
    expect(() => assertSafePatchForNonAdmin("stores", "update", { is_suspended: false })).toThrow(
      "Campo de loja protegido",
    );
    expect(() => assertSafePatchForNonAdmin("stores", "update", { is_verified: true })).toThrow(
      "Campo de loja protegido",
    );
  });
});
