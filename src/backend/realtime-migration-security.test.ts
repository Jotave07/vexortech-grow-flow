import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/20260714131354_private_order_realtime_broadcast.sql",
  import.meta.url,
);
const schemaGateUrl = new URL("../../scripts/check-schema.mjs", import.meta.url);

const policyBody = (sql: string, policyName: string) => {
  const body = sql.match(new RegExp(`CREATE POLICY ${policyName}([\\s\\S]*?);`, "i"))?.[1];
  expect(body, `policy ${policyName} must exist`).toBeDefined();
  return body || "";
};

describe("private order Realtime migration security", () => {
  it("keeps short-lived tickets in an unexposed schema with least-privilege issuance", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS hype_private");
    expect(sql).toContain("SECURITY DEFINER\nSET search_path = ''");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS hype_private.order_realtime_tickets");
    expect(sql).toContain("issued_at + interval '10 minutes'");
    expect(sql).toContain("expires_at <= created_at + interval '15 minutes'");
    expect(sql).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(sql).toContain("hype-order-realtime-ticket:");
    expect(sql).toContain("^hype:store-orders:");
    expect(sql).toContain(
      "REVOKE ALL ON TABLE hype_private.order_realtime_tickets FROM PUBLIC, anon, authenticated",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION hype_private.issue_order_realtime_ticket(uuid, uuid) TO vexortech_runtime",
    );
    expect(sql).not.toMatch(
      /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]{0,100}order_realtime_tickets/i,
    );
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+public\.store_settings[\s\S]{0,100}realtime/i);
  });

  it("scopes restrictive policies to Hype without denying unrelated Broadcast topics", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    const receive = policyBody(sql, "hype_store_order_broadcast_receive");
    const ticketGuard = policyBody(sql, "hype_store_order_broadcast_ticket_guard");
    const databaseOnly = policyBody(sql, "hype_store_order_broadcast_database_only");

    expect(sql).toMatch(/AS PERMISSIVE\s+FOR SELECT\s+TO anon, authenticated/i);
    expect(sql).toMatch(/AS RESTRICTIVE\s+FOR SELECT\s+TO anon, authenticated/i);
    expect(sql).toMatch(/AS RESTRICTIVE\s+FOR INSERT\s+TO anon, authenticated/i);
    expect(sql).not.toMatch(/FOR SELECT[\s\S]{0,200}USING\s*\(\s*true\s*\)/i);

    expect(receive).toMatch(/extension\s*=\s*'broadcast'/i);
    expect(receive).toContain("can_receive_store_order_topic");
    expect(ticketGuard).toMatch(/realtime\.topic\(\)\)\s*!~\s*'\^hype:store-orders:'/i);
    expect(ticketGuard).toMatch(/extension\s*=\s*'broadcast'/i);
    expect(ticketGuard).toContain("can_receive_store_order_topic");
    expect(ticketGuard).not.toMatch(/extension\s*<>\s*'broadcast'/i);
    expect(databaseOnly).toMatch(/realtime\.topic\(\)\)\s*!~\s*'\^hype:store-orders:'/i);
    expect(databaseOnly).not.toMatch(/realtime\.messages\.extension/i);
  });

  it("has the intended RLS truth table for valid, invalid, expired and non-Hype topics", () => {
    const prefix = "hype:store-orders:";
    const receiveAllows = (topic: string, extension: string, ticketValid: boolean) =>
      extension === "broadcast" && topic.startsWith(prefix) && ticketValid;
    const restrictiveReceiveAllows = (topic: string, extension: string, ticketValid: boolean) =>
      !topic.startsWith(prefix) || (extension === "broadcast" && ticketValid);
    const effectiveSelect = (
      topic: string,
      extension: string,
      ticketValid: boolean,
      anotherPermissivePolicyAllows = false,
    ) =>
      (receiveAllows(topic, extension, ticketValid) || anotherPermissivePolicyAllows) &&
      restrictiveReceiveAllows(topic, extension, ticketValid);
    const restrictiveInsertAllows = (topic: string) => !topic.startsWith(prefix);

    const validHypeTopic = `${prefix}22222222-2222-4222-8222-222222222222`;
    const invalidHypeTopic = `${prefix}33333333-3333-4333-8333-333333333333`;
    const expiredHypeTopic = `${prefix}44444444-4444-4444-8444-444444444444`;
    const unrelatedTopic = "another-app:store-orders:public";

    expect(effectiveSelect(validHypeTopic, "broadcast", true)).toBe(true);
    expect(effectiveSelect(invalidHypeTopic, "broadcast", false, true)).toBe(false);
    expect(effectiveSelect(expiredHypeTopic, "broadcast", false, true)).toBe(false);
    expect(restrictiveReceiveAllows(unrelatedTopic, "broadcast", false)).toBe(true);
    expect(effectiveSelect(unrelatedTopic, "broadcast", false, true)).toBe(true);
    expect(restrictiveInsertAllows(validHypeTopic)).toBe(false);
    expect(restrictiveInsertAllows(`${prefix}forged`)).toBe(false);
    expect(restrictiveInsertAllows(unrelatedTopic)).toBe(true);
  });

  it("gates the deployed policy expressions against namespace regressions", async () => {
    const schemaGate = await readFile(schemaGateUrl, "utf8");
    const realtimeGate = schemaGate.match(
      /label: "private order Realtime has exactly three correctly scoped RLS policies"([\s\S]*?)label: "dedicated runtime role/,
    )?.[1];

    expect(realtimeGate).toBeDefined();
    expect(realtimeGate).toContain("'''^hype:store-orders:'''");
    expect(realtimeGate).toContain("!~ 'extension[[:space:]]*=[[:space:]]*''broadcast'''");
    expect(realtimeGate).toContain("!~ '[[:space:]]OR[[:space:]]'");
    expect(realtimeGate).toContain("!~ '[[:space:]]AND[[:space:]]'");
    expect(realtimeGate).toContain(") ~ 'extension'");
    expect(realtimeGate).not.toContain("extension[[:space:]]*<>[[:space:]]*''broadcast'''");
  });

  it("broadcasts only a versioned invalidation and never an order row", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    const sendCall = sql.match(/PERFORM realtime\.send\(([\s\S]*?)\n\s*\);/i)?.[1] || "";

    expect(sendCall).toContain("'table', 'orders'");
    expect(sendCall).toContain("'orders-invalidated'");
    expect(sendCall).toMatch(/,\s*true\s*$/);
    expect(sendCall).not.toMatch(/\b(?:NEW|OLD)\b/);
    expect(sql).not.toContain("realtime.broadcast_changes");
  });

  it("cleans expired tickets and revokes them on suspension, archive or ownership change", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain("ticket.expires_at <= broadcast_at");
    expect(sql).toContain("stores_revoke_order_realtime_tickets");
    expect(sql).toContain("OLD.is_suspended IS DISTINCT FROM NEW.is_suspended");
    expect(sql).toContain("OLD.is_active IS DISTINCT FROM NEW.is_active");
    expect(sql).toContain("OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id");
  });
});
