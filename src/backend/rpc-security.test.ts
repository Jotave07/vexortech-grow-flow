import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  query: vi.fn(),
}));

vi.mock("./auth", () => ({ getActor: mocks.getActor }));
vi.mock("./db", () => ({ query: mocks.query }));

import { executeRpc } from "./rpc";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

describe("RPC authorization", () => {
  beforeEach(() => {
    mocks.getActor.mockReset();
    mocks.query.mockReset();
  });

  it("authenticates before calling is_vexor_admin", async () => {
    mocks.getActor.mockResolvedValue(null);
    const result = await executeRpc("is_vexor_admin", { _user_id: USER_ID }, {});
    expect(result.error?.message).toContain("nao autorizado");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("blocks a non-admin from probing another user's admin status", async () => {
    mocks.getActor.mockResolvedValue({ user: { id: USER_ID }, admin: false });
    const result = await executeRpc("is_vexor_admin", { _user_id: OTHER_ID }, { token: "valid" });
    expect(result.error?.message).toContain("outro usuario");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("allows an authenticated user to query only their own status", async () => {
    mocks.getActor.mockResolvedValue({ user: { id: USER_ID }, admin: false });
    mocks.query.mockResolvedValue({ rows: [{ value: false }] });
    const result = await executeRpc("is_vexor_admin", { _user_id: USER_ID }, { token: "valid" });
    expect(result).toEqual({ data: false, error: null });
    expect(mocks.query).toHaveBeenCalledWith(
      "SELECT public.is_vexor_admin($1::uuid) AS value",
      [USER_ID],
    );
  });
});
