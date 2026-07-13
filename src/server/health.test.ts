import { describe, expect, it, vi } from "vitest";
import {
  createCachedHealthEvaluator,
  evaluateHealth,
  HEALTH_CACHE_TTL_MS,
  HEALTH_DATABASE_PROBE_SQL,
  HEALTH_SCHEMA_SQL,
  isHealthRequestMethodAllowed,
  isSupabaseProjectRefAligned,
  REQUIRED_MIGRATION_VERSION,
  RUNTIME_FUNCTION_SIGNATURES,
  RUNTIME_RLS_TABLES,
  RUNTIME_ROLE_NAME,
  RUNTIME_TABLE_PRIVILEGES,
  type HealthDependencies,
  type HealthRuntimeConfig,
} from "./health";

const DUMMY_PROJECT_REF = "abcdefghijklmnopqrst";
const OTHER_DUMMY_PROJECT_REF = "zyxwvutsrqponmlkjihg";

const directRuntimeConfig: HealthRuntimeConfig = {
  production: true,
  nextPublicSupabaseUrl: `https://${DUMMY_PROJECT_REF}.supabase.co`,
  databaseUrl: `postgresql://${RUNTIME_ROLE_NAME}@db.${DUMMY_PROJECT_REF}.supabase.co/postgres`,
};

const successfulProbeRow = {
  ok: 1,
  database_writable: true,
  runtime_role_least_privilege: true,
  runtime_table_privileges: true,
  runtime_sequence_privileges: true,
  runtime_function_privileges: true,
  runtime_rls_policies: true,
};

const successfulSchemaRow = {
  required_migration: true,
  latest_migration: REQUIRED_MIGRATION_VERSION,
  subscription_gateway_columns: true,
  subscription_contract_prices: true,
  webhook_recovery_backlog_healthy: true,
  financial_movements_rls: true,
  financial_movements_no_client_grants: true,
  runtime_role_contract: true,
  runtime_rls_contract: true,
};

const dependencies = (
  options: {
    probeRow?: Record<string, unknown>;
    schemaRow?: Record<string, unknown>;
    runtimeConfig?: HealthRuntimeConfig;
  } = {},
): HealthDependencies & { query: ReturnType<typeof vi.fn> } => ({
  validateRuntimeEnv: vi.fn(),
  runtimeConfig: options.runtimeConfig ?? directRuntimeConfig,
  query: vi
    .fn()
    .mockResolvedValueOnce({ rows: [options.probeRow ?? successfulProbeRow] })
    .mockResolvedValueOnce({ rows: [options.schemaRow ?? successfulSchemaRow] }),
});

describe("Supabase project identity", () => {
  it("aligns a direct database host with the public project URL", () => {
    expect(isSupabaseProjectRefAligned(directRuntimeConfig)).toBe(true);
  });

  it("aligns a Supavisor pooler using postgres.<ref> as the username", () => {
    expect(
      isSupabaseProjectRefAligned({
        production: true,
        nextPublicSupabaseUrl: `https://${DUMMY_PROJECT_REF}.supabase.co`,
        databaseUrl: `postgresql://postgres.${DUMMY_PROJECT_REF}@aws-0-sa-east-1.pooler.supabase.com/postgres`,
      }),
    ).toBe(true);
  });

  it("aligns a Supavisor pooler using a dedicated runtime role", () => {
    expect(
      isSupabaseProjectRefAligned({
        production: true,
        nextPublicSupabaseUrl: `https://${DUMMY_PROJECT_REF}.supabase.co`,
        databaseUrl: `postgresql://vexortech_runtime.${DUMMY_PROJECT_REF}@aws-0-sa-east-1.pooler.supabase.com/postgres`,
      }),
    ).toBe(true);
  });

  it("aligns split POSTGRES_* configuration for direct and pooled hosts", () => {
    expect(
      isSupabaseProjectRefAligned({
        production: true,
        nextPublicSupabaseUrl: `https://${DUMMY_PROJECT_REF}.supabase.co`,
        postgresHost: `db.${DUMMY_PROJECT_REF}.supabase.co`,
        postgresUser: "postgres",
      }),
    ).toBe(true);
    expect(
      isSupabaseProjectRefAligned({
        production: true,
        nextPublicSupabaseUrl: `https://${DUMMY_PROJECT_REF}.supabase.co`,
        postgresHost: "aws-0-sa-east-1.pooler.supabase.com",
        postgresUser: `postgres.${DUMMY_PROJECT_REF}`,
      }),
    ).toBe(true);
  });

  it("fails closed in production for a mismatch or an unidentifiable database", () => {
    expect(
      isSupabaseProjectRefAligned({
        ...directRuntimeConfig,
        nextPublicSupabaseUrl: `https://${OTHER_DUMMY_PROJECT_REF}.supabase.co`,
      }),
    ).toBe(false);
    expect(
      isSupabaseProjectRefAligned({
        production: true,
        nextPublicSupabaseUrl: `https://${DUMMY_PROJECT_REF}.supabase.co`,
        databaseUrl: "postgresql://postgres@database.internal/postgres",
      }),
    ).toBe(false);
  });

  it("does not require Supabase project inference outside production", () => {
    expect(isSupabaseProjectRefAligned({ production: false })).toBe(true);
  });
});

describe("health readiness checks", () => {
  it("reports ready only when runtime, project, database and schema posture pass", async () => {
    const deps = dependencies();

    await expect(evaluateHealth(deps)).resolves.toEqual({
      status: "ok",
      checks: {
        runtimeEnv: true,
        supabaseProjectRefAligned: true,
        database: true,
        databaseWritable: true,
        runtimeRoleLeastPrivilege: true,
        runtimeTablePrivileges: true,
        runtimeSequencePrivileges: true,
        runtimeFunctionPrivileges: true,
        runtimeRlsPolicies: true,
        requiredMigration: true,
        subscriptionGatewayColumns: true,
        subscriptionContractPrices: true,
        webhookRecoveryBacklogHealthy: true,
        financialMovementsRls: true,
        financialMovementsNoClientGrants: true,
      },
      latestMigration: REQUIRED_MIGRATION_VERSION,
    });
    expect(deps.query).toHaveBeenNthCalledWith(1, HEALTH_DATABASE_PROBE_SQL);
    expect(deps.query).toHaveBeenNthCalledWith(2, HEALTH_SCHEMA_SQL, [REQUIRED_MIGRATION_VERSION]);
  });

  it.each([
    ["required migration", { required_migration: false }],
    ["subscription gateway columns", { subscription_gateway_columns: false }],
    ["subscription contract prices", { subscription_contract_prices: false }],
    ["webhook recovery backlog", { webhook_recovery_backlog_healthy: false }],
    ["financial_movements RLS", { financial_movements_rls: false }],
    ["financial_movements grants", { financial_movements_no_client_grants: false }],
    ["runtime role contract", { runtime_role_contract: false }],
    ["runtime RLS contract", { runtime_rls_contract: false }],
  ])("fails closed when %s does not pass", async (_name, override) => {
    const result = await evaluateHealth({
      ...dependencies({ schemaRow: { ...successfulSchemaRow, ...override } }),
    });

    expect(result.status).toBe("error");
    expect(Object.values(result.checks)).toContain(false);
    expect(result.latestMigration).toBe(REQUIRED_MIGRATION_VERSION);
  });

  it("fails readiness when the database is in recovery or read-only mode", async () => {
    const result = await evaluateHealth(
      dependencies({ probeRow: { ok: 1, database_writable: false } }),
    );

    expect(result.status).toBe("error");
    expect(result.checks.database).toBe(true);
    expect(result.checks.databaseWritable).toBe(false);
    expect(result.checks.requiredMigration).toBe(true);
  });

  it.each([
    ["runtime role", "runtime_role_least_privilege", "runtimeRoleLeastPrivilege"],
    ["table privileges", "runtime_table_privileges", "runtimeTablePrivileges"],
    ["sequence privileges", "runtime_sequence_privileges", "runtimeSequencePrivileges"],
    ["function privileges", "runtime_function_privileges", "runtimeFunctionPrivileges"],
    ["RLS policies", "runtime_rls_policies", "runtimeRlsPolicies"],
  ] as const)("fails closed when the %s probe fails", async (_name, rowField, checkField) => {
    const result = await evaluateHealth(
      dependencies({ probeRow: { ...successfulProbeRow, [rowField]: false } }),
    );

    expect(result.status).toBe("error");
    expect(result.checks[checkField]).toBe(false);
  });

  it("requires the exact effective privilege matrix for every runtime table", () => {
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("has_table_privilege");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("has_any_column_privilege");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("has_schema_privilege");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("current_user");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("row_security_active");
    for (const [tableName, privileges] of Object.entries(RUNTIME_TABLE_PRIVILEGES)) {
      expect(HEALTH_DATABASE_PROBE_SQL).toContain(`('${tableName}'::name)`);
      for (const privilege of privileges) {
        expect(HEALTH_DATABASE_PROBE_SQL).toContain(`('${tableName}'::name, '${privilege}'::text)`);
      }
    }
    expect(RUNTIME_TABLE_PRIVILEGES.notification_events).toEqual(["SELECT", "INSERT", "UPDATE"]);
    expect(RUNTIME_TABLE_PRIVILEGES.user_roles).not.toContain("UPDATE");
    expect(RUNTIME_TABLE_PRIVILEGES.financial_movements).not.toContain("DELETE");
  });

  it("checks the dedicated role, sequence, RPC and RLS boundaries", () => {
    expect(HEALTH_DATABASE_PROBE_SQL).toContain(`role_state.rolname = '${RUNTIME_ROLE_NAME}'`);
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("NOT role_state.rolbypassrls");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("NOT role_state.rolinherit");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("role_state.rolconnlimit = 30");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("pg_auth_members");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("inherit_option");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("set_option");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("pg_shdepend");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("'auth', 'storage', 'realtime'");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("WITH GRANT OPTION");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("current_setting('search_path')");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("has_sequence_privilege");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("orders_order_number_seq");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("has_function_privilege");
    for (const signature of RUNTIME_FUNCTION_SIGNATURES) {
      expect(HEALTH_DATABASE_PROBE_SQL).toContain(`('${signature}'::text)`);
    }
    for (const tableName of RUNTIME_RLS_TABLES) {
      expect(HEALTH_DATABASE_PROBE_SQL).toContain(`('${tableName}'::name)`);
    }
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("vexortech_runtime_direct_access");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("financial_movements_server_access");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("pg_get_expr");
    expect(HEALTH_DATABASE_PROBE_SQL).toContain("restrictive_policy.polpermissive IS FALSE");
    expect(HEALTH_SCHEMA_SQL).toContain("schema_required_rls_tables");
  });

  it("fails readiness when the configured Supabase projects differ", async () => {
    const result = await evaluateHealth(
      dependencies({
        runtimeConfig: {
          ...directRuntimeConfig,
          nextPublicSupabaseUrl: `https://${OTHER_DUMMY_PROJECT_REF}.supabase.co`,
        },
      }),
    );

    expect(result.status).toBe("error");
    expect(result.checks.supabaseProjectRefAligned).toBe(false);
  });

  it("does not query or expose details when runtime validation fails", async () => {
    const deps = dependencies();
    deps.validateRuntimeEnv = vi.fn(() => {
      throw new Error("dummy-runtime-error");
    });

    const result = await evaluateHealth(deps);

    expect(result.status).toBe("error");
    expect(deps.query).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("dummy-runtime-error");
  });

  it("fails closed without exposing details when the database probe rejects", async () => {
    const deps = dependencies();
    deps.query = vi.fn().mockRejectedValueOnce(new Error("dummy-database-error"));

    const result = await evaluateHealth(deps);

    expect(result).toEqual({
      status: "error",
      checks: {
        runtimeEnv: true,
        supabaseProjectRefAligned: true,
        database: false,
        databaseWritable: false,
        runtimeRoleLeastPrivilege: false,
        runtimeTablePrivileges: false,
        runtimeSequencePrivileges: false,
        runtimeFunctionPrivileges: false,
        runtimeRlsPolicies: false,
        requiredMigration: false,
        subscriptionGatewayColumns: false,
        subscriptionContractPrices: false,
        webhookRecoveryBacklogHealthy: false,
        financialMovementsRls: false,
        financialMovementsNoClientGrants: false,
      },
      latestMigration: null,
    });
    expect(JSON.stringify(result)).not.toContain("dummy-database-error");
  });

  it("bounds a stalled database probe without exposing timeout details", async () => {
    const deps = dependencies();
    deps.queryTimeoutMs = 5;
    deps.query = vi.fn(() => new Promise<never>(() => undefined));

    const result = await evaluateHealth(deps);

    expect(result.status).toBe("error");
    expect(result.checks.database).toBe(false);
    expect(JSON.stringify(result)).not.toContain("timed out");
  });

  it("does not expose database errors and leaves schema checks false", async () => {
    const deps = dependencies();
    deps.query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [successfulProbeRow] })
      .mockRejectedValueOnce(new Error("dummy-schema-error"));

    const result = await evaluateHealth(deps);

    expect(result).toEqual({
      status: "error",
      checks: {
        runtimeEnv: true,
        supabaseProjectRefAligned: true,
        database: true,
        databaseWritable: true,
        runtimeRoleLeastPrivilege: true,
        runtimeTablePrivileges: true,
        runtimeSequencePrivileges: true,
        runtimeFunctionPrivileges: true,
        runtimeRlsPolicies: true,
        requiredMigration: false,
        subscriptionGatewayColumns: false,
        subscriptionContractPrices: false,
        webhookRecoveryBacklogHealthy: false,
        financialMovementsRls: false,
        financialMovementsNoClientGrants: false,
      },
      latestMigration: null,
    });
    expect(JSON.stringify(result)).not.toContain("dummy-schema-error");
  });

  it("requires the database probe to return its expected row", async () => {
    const deps = dependencies();
    deps.query = vi.fn().mockResolvedValueOnce({ rows: [] });

    const result = await evaluateHealth(deps);

    expect(result.status).toBe("error");
    expect(result.checks.database).toBe(false);
    expect(result.checks.databaseWritable).toBe(false);
    expect(deps.query).toHaveBeenCalledTimes(1);
  });

  it("checks table, column, PUBLIC and PostgreSQL 17 MAINTAIN privileges", () => {
    expect(HEALTH_SCHEMA_SQL).toContain("has_any_column_privilege");
    expect(HEALTH_SCHEMA_SQL).toContain("public_table_acl.grantee = 0");
    expect(HEALTH_SCHEMA_SQL).toContain("public_column_acl.grantee = 0");
    expect(HEALTH_SCHEMA_SQL).toContain("'MAINTAIN'");
    expect(HEALTH_SCHEMA_SQL).toContain("server_version_num");
  });

  it("checks the reconciled subscription gateway column contract", () => {
    expect(HEALTH_SCHEMA_SQL).toContain("gateway_action_pending");
    expect(HEALTH_SCHEMA_SQL).toContain("gateway_paused_for_dispute");
    expect(HEALTH_SCHEMA_SQL).toContain("billing_exemption_pending");
    expect(HEALTH_SCHEMA_SQL).toContain("data_type = 'text'");
    expect(HEALTH_SCHEMA_SQL).toContain("data_type = 'boolean'");
    expect(HEALTH_SCHEMA_SQL).toContain("attnotnull IS TRUE");
    expect(HEALTH_SCHEMA_SQL).toContain("default_expression IN ('false', 'false::boolean')");
  });

  it("fails readiness when a gateway subscription has no positive contract price", () => {
    expect(HEALTH_SCHEMA_SQL).toContain("asaas_subscription_id");
    expect(HEALTH_SCHEMA_SQL).toContain("contract_price_monthly IS NULL");
    expect(HEALTH_SCHEMA_SQL).toContain("contract_price_monthly <= 0");
    expect(HEALTH_SCHEMA_SQL).toContain("subscription_contract_prices");
  });

  it("fails readiness for stale webhook work without exposing event details", () => {
    expect(HEALTH_SCHEMA_SQL).toContain("processed IS FALSE");
    expect(HEALTH_SCHEMA_SQL).toContain("gateway_action_pending IS NOT NULL");
    expect(HEALTH_SCHEMA_SQL).toContain("billing_exemption_pending IS TRUE");
    expect(HEALTH_SCHEMA_SQL).toContain("interval '10 minutes'");
  });
});

describe("health readiness cache", () => {
  it("coalesces concurrent checks and reuses the result only within the short TTL", async () => {
    let clock = 1_000;
    const report = await evaluateHealth(dependencies());
    const evaluator = vi.fn().mockResolvedValue(report);
    const loadHealth = createCachedHealthEvaluator(evaluator, {
      ttlMs: HEALTH_CACHE_TTL_MS,
      now: () => clock,
    });

    const [first, concurrent] = await Promise.all([loadHealth(), loadHealth()]);
    expect(evaluator).toHaveBeenCalledTimes(1);
    expect(concurrent).toBe(first);

    clock += HEALTH_CACHE_TTL_MS - 1;
    await expect(loadHealth()).resolves.toBe(first);
    expect(evaluator).toHaveBeenCalledTimes(1);

    clock += 2;
    await expect(loadHealth()).resolves.toBe(first);
    expect(evaluator).toHaveBeenCalledTimes(2);
  });
});

describe("health request methods", () => {
  it.each(["GET", "HEAD"])("allows %s", (method) => {
    expect(isHealthRequestMethodAllowed(method)).toBe(true);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("rejects %s", (method) => {
    expect(isHealthRequestMethodAllowed(method)).toBe(false);
  });
});
