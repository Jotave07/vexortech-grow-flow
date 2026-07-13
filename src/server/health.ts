export const REQUIRED_MIGRATION_VERSION = "20260713153000";
export const HEALTH_QUERY_TIMEOUT_MS = 5_000;
export const HEALTH_CACHE_TTL_MS = 5_000;
export const isHealthRequestMethodAllowed = (method: string) =>
  method === "GET" || method === "HEAD";

export const RUNTIME_ROLE_NAME = "vexortech_runtime";

type RuntimeTablePrivilege = "SELECT" | "INSERT" | "UPDATE" | "DELETE";

export const RUNTIME_TABLE_PRIVILEGES = {
  audit_logs: ["SELECT"],
  categories: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  coupons: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  customer_addresses: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  customer_favorites: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  customers: ["SELECT", "INSERT", "UPDATE"],
  delivery_drivers: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  delivery_zones: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  financial_movements: ["SELECT", "INSERT", "UPDATE"],
  notification_events: ["SELECT", "INSERT", "UPDATE"],
  order_item_options: ["SELECT", "INSERT"],
  order_items: ["SELECT", "INSERT"],
  order_status_history: ["SELECT", "INSERT"],
  orders: ["SELECT", "INSERT", "UPDATE"],
  payment_events: ["SELECT", "INSERT", "UPDATE"],
  payments: ["SELECT", "INSERT", "UPDATE"],
  plans: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  product_option_items: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  product_options: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  products: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  profiles: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  schema_migrations: ["SELECT"],
  store_reviews: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  store_settings: ["SELECT", "INSERT", "UPDATE"],
  stores: ["SELECT", "INSERT", "UPDATE"],
  subscriptions: ["SELECT", "INSERT", "UPDATE"],
  user_roles: ["SELECT", "INSERT", "DELETE"],
} as const satisfies Record<string, readonly RuntimeTablePrivilege[]>;

export const RUNTIME_FUNCTION_SIGNATURES = [
  "public.is_vexor_admin(uuid)",
  "public.get_public_order_items(text)",
  "public.get_public_order_status_history(text)",
  "public.get_store_rating(uuid)",
] as const;

export const RUNTIME_RLS_TABLES = [
  "audit_logs",
  "customer_addresses",
  "customer_favorites",
  "delivery_drivers",
  "financial_movements",
] as const;

const sqlStringLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

const runtimeTablesSql = Object.keys(RUNTIME_TABLE_PRIVILEGES)
  .map((tableName) => `(${sqlStringLiteral(tableName)}::name)`)
  .join(",\n      ");

const runtimeTablePrivilegesSql = Object.entries(RUNTIME_TABLE_PRIVILEGES)
  .flatMap(([tableName, privileges]) =>
    privileges.map(
      (privilege) => `(${sqlStringLiteral(tableName)}::name, ${sqlStringLiteral(privilege)}::text)`,
    ),
  )
  .join(",\n      ");

const runtimeFunctionSignaturesSql = RUNTIME_FUNCTION_SIGNATURES.map(
  (signature) => `(${sqlStringLiteral(signature)}::text)`,
).join(",\n      ");

const runtimeRlsTablesSql = RUNTIME_RLS_TABLES.map(
  (tableName) => `(${sqlStringLiteral(tableName)}::name)`,
).join(",\n      ");

export const HEALTH_DATABASE_PROBE_SQL = `
  WITH runtime_tables(table_name) AS (
    VALUES
      ${runtimeTablesSql}
  ),
  required_table_privileges(table_name, privilege_name) AS (
    VALUES
      ${runtimeTablePrivilegesSql}
  ),
  required_rls_tables(table_name) AS (
    VALUES
      ${runtimeRlsTablesSql}
  ),
  table_privilege_names(privilege_name) AS (
    VALUES
      ('SELECT'::text),
      ('INSERT'::text),
      ('UPDATE'::text),
      ('DELETE'::text),
      ('TRUNCATE'::text),
      ('REFERENCES'::text),
      ('TRIGGER'::text)
  ),
  column_privilege_names(privilege_name) AS (
    VALUES
      ('SELECT'::text),
      ('INSERT'::text),
      ('UPDATE'::text),
      ('REFERENCES'::text)
  ),
  resolved_runtime_tables AS (
    SELECT
      runtime_table.table_name,
      target_table.oid AS table_oid,
      target_table.relrowsecurity
    FROM runtime_tables AS runtime_table
    LEFT JOIN pg_catalog.pg_namespace AS target_schema
      ON target_schema.nspname = 'public'
    LEFT JOIN pg_catalog.pg_class AS target_table
      ON target_table.relnamespace = target_schema.oid
      AND target_table.relname = runtime_table.table_name
      AND target_table.relkind IN ('r', 'p')
  ),
  all_public_relations AS (
    SELECT target_table.oid AS table_oid, target_table.relname AS table_name
    FROM pg_catalog.pg_class AS target_table
    JOIN pg_catalog.pg_namespace AS target_schema
      ON target_schema.oid = target_table.relnamespace
    WHERE target_schema.nspname = 'public'
      AND target_table.relkind IN ('r', 'p', 'v', 'm', 'f')
  ),
  runtime_role AS (
    SELECT role_state.*
    FROM pg_catalog.pg_roles AS role_state
    WHERE role_state.rolname = current_user
  ),
  required_sequence_privileges(sequence_name, privilege_name) AS (
    VALUES ('orders_order_number_seq'::name, 'USAGE'::text)
  ),
  required_functions(function_signature) AS (
    VALUES
      ${runtimeFunctionSignaturesSql}
  ),
  resolved_required_functions AS (
    SELECT
      required.function_signature,
      pg_catalog.to_regprocedure(required.function_signature) AS function_oid
    FROM required_functions AS required
  )
  SELECT
    1 AS ok,
    current_setting('transaction_read_only') = 'off'
      AND NOT pg_catalog.pg_is_in_recovery() AS database_writable,
    COALESCE(
      (
        SELECT
          role_state.rolname = ${sqlStringLiteral(RUNTIME_ROLE_NAME)}
          AND session_user = current_user
          AND role_state.rolcanlogin
          AND NOT role_state.rolinherit
          AND NOT role_state.rolsuper
          AND NOT role_state.rolcreatedb
          AND NOT role_state.rolcreaterole
          AND NOT role_state.rolreplication
          AND NOT role_state.rolbypassrls
          AND role_state.rolconnlimit = 30
          AND pg_catalog.current_setting('search_path') = 'pg_catalog, public'
          AND pg_catalog.current_setting('idle_in_transaction_session_timeout') = '15s'
          AND pg_catalog.has_database_privilege(
            current_user,
            current_database(),
            'CONNECT'
          )
          AND NOT pg_catalog.has_database_privilege(
            current_user,
            current_database(),
            'CONNECT WITH GRANT OPTION'
          )
          AND NOT pg_catalog.has_database_privilege(
            current_user,
            current_database(),
            'CREATE'
          )
          AND pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE')
          AND NOT pg_catalog.has_schema_privilege(
            current_user,
            'public',
            'USAGE WITH GRANT OPTION'
          )
          AND NOT pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_auth_members AS membership
            WHERE membership.member = role_state.oid
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_auth_members AS membership
            LEFT JOIN pg_catalog.pg_roles AS grantor_role
              ON grantor_role.oid = membership.grantor
            WHERE membership.roleid = role_state.oid
              AND NOT (
                membership.admin_option
                AND COALESCE(
                  (pg_catalog.to_jsonb(membership) ->> 'inherit_option')::boolean,
                  true
                ) IS FALSE
                AND COALESCE(
                  (pg_catalog.to_jsonb(membership) ->> 'set_option')::boolean,
                  true
                ) IS FALSE
                AND grantor_role.rolsuper IS TRUE
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_namespace AS managed_schema
            WHERE managed_schema.nspname IN ('auth', 'storage', 'realtime')
              AND (
                pg_catalog.has_schema_privilege(
                  current_user,
                  managed_schema.oid,
                  'USAGE'
                )
                OR pg_catalog.has_schema_privilege(
                  current_user,
                  managed_schema.oid,
                  'CREATE'
                )
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_shdepend AS ownership_dependency
            WHERE ownership_dependency.refclassid = 'pg_catalog.pg_authid'::regclass
              AND ownership_dependency.refobjid = role_state.oid
              AND ownership_dependency.deptype = 'o'
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_database WHERE datdba = role_state.oid
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner = role_state.oid
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_class WHERE relowner = role_state.oid
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc WHERE proowner = role_state.oid
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_type WHERE typowner = role_state.oid
          )
        FROM runtime_role AS role_state
      ),
      false
    ) AS runtime_role_least_privilege,
    NOT EXISTS (
      SELECT 1
      FROM required_table_privileges AS required
      LEFT JOIN resolved_runtime_tables AS runtime_table
        ON runtime_table.table_name = required.table_name
      WHERE runtime_table.table_oid IS NULL
        OR NOT COALESCE(
          pg_catalog.has_table_privilege(
            current_user,
            runtime_table.table_oid,
            required.privilege_name
          ),
          false
        )
        OR pg_catalog.has_table_privilege(
          current_user,
          runtime_table.table_oid,
          required.privilege_name || ' WITH GRANT OPTION'
        )
    )
      AND NOT EXISTS (
        SELECT 1
        FROM all_public_relations AS runtime_table
        CROSS JOIN table_privilege_names AS checked_privilege
        WHERE runtime_table.table_oid IS NOT NULL
          AND pg_catalog.has_table_privilege(
            current_user,
            runtime_table.table_oid,
            checked_privilege.privilege_name
          )
          AND NOT EXISTS (
            SELECT 1
            FROM required_table_privileges AS required
            WHERE required.table_name = runtime_table.table_name
              AND required.privilege_name = checked_privilege.privilege_name
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM all_public_relations AS runtime_table
        CROSS JOIN column_privilege_names AS checked_privilege
        WHERE runtime_table.table_oid IS NOT NULL
          AND pg_catalog.has_any_column_privilege(
            current_user,
            runtime_table.table_oid,
            checked_privilege.privilege_name
          )
          AND NOT EXISTS (
            SELECT 1
            FROM required_table_privileges AS required
            WHERE required.table_name = runtime_table.table_name
              AND required.privilege_name = checked_privilege.privilege_name
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM all_public_relations AS runtime_table
        CROSS JOIN column_privilege_names AS checked_privilege
        WHERE runtime_table.table_oid IS NOT NULL
          AND pg_catalog.has_any_column_privilege(
            current_user,
            runtime_table.table_oid,
            checked_privilege.privilege_name || ' WITH GRANT OPTION'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM all_public_relations AS runtime_table
        WHERE runtime_table.table_oid IS NOT NULL
          AND CASE
            WHEN current_setting('server_version_num')::integer >= 170000
              THEN pg_catalog.has_table_privilege(
                current_user,
                runtime_table.table_oid,
                'MAINTAIN'
              )
            ELSE false
          END
      ) AS runtime_table_privileges,
    NOT EXISTS (
      SELECT 1
      FROM required_sequence_privileges AS required
      WHERE pg_catalog.to_regclass(
          pg_catalog.format('%I.%I', 'public', required.sequence_name)
        ) IS NULL
        OR NOT pg_catalog.has_sequence_privilege(
          current_user,
          pg_catalog.to_regclass(
            pg_catalog.format('%I.%I', 'public', required.sequence_name)
          ),
          required.privilege_name
        )
        OR pg_catalog.has_sequence_privilege(
          current_user,
          pg_catalog.to_regclass(
            pg_catalog.format('%I.%I', 'public', required.sequence_name)
          ),
          required.privilege_name || ' WITH GRANT OPTION'
        )
    )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS sequence_state
        JOIN pg_catalog.pg_namespace AS sequence_schema
          ON sequence_schema.oid = sequence_state.relnamespace
        CROSS JOIN (
          VALUES ('USAGE'::text), ('SELECT'::text), ('UPDATE'::text)
        ) AS checked_privilege(privilege_name)
        WHERE sequence_schema.nspname = 'public'
          AND sequence_state.relkind = 'S'
          AND pg_catalog.has_sequence_privilege(
            current_user,
            sequence_state.oid,
            checked_privilege.privilege_name
          )
          AND NOT EXISTS (
            SELECT 1
            FROM required_sequence_privileges AS required
            WHERE required.sequence_name = sequence_state.relname
              AND required.privilege_name = checked_privilege.privilege_name
          )
      ) AS runtime_sequence_privileges,
    NOT EXISTS (
      SELECT 1
      FROM resolved_required_functions AS required
      WHERE required.function_oid IS NULL
        OR NOT pg_catalog.has_function_privilege(
          current_user,
          required.function_oid,
          'EXECUTE'
        )
        OR pg_catalog.has_function_privilege(
          current_user,
          required.function_oid,
          'EXECUTE WITH GRANT OPTION'
        )
    )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS function_state
        JOIN pg_catalog.pg_namespace AS function_schema
          ON function_schema.oid = function_state.pronamespace
        WHERE function_schema.nspname = 'public'
          AND pg_catalog.has_function_privilege(
            current_user,
            function_state.oid,
            'EXECUTE'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM resolved_required_functions AS required
            WHERE required.function_oid = function_state.oid
          )
      ) AS runtime_function_privileges,
    NOT EXISTS (
      SELECT 1
      FROM resolved_runtime_tables AS runtime_table
      WHERE runtime_table.table_oid IS NULL
        OR (
          EXISTS (
            SELECT 1
            FROM required_rls_tables AS required_rls
            WHERE required_rls.table_name = runtime_table.table_name
          )
          AND runtime_table.relrowsecurity IS NOT TRUE
        )
        OR (
          runtime_table.relrowsecurity
          AND (
            NOT pg_catalog.row_security_active(runtime_table.table_oid)
            OR NOT EXISTS (
              SELECT 1
              FROM pg_catalog.pg_policy AS runtime_policy
              WHERE runtime_policy.polrelid = runtime_table.table_oid
                AND runtime_policy.polcmd = '*'
                AND runtime_policy.polpermissive IS TRUE
                AND runtime_policy.polqual IS NOT NULL
                AND runtime_policy.polwithcheck IS NOT NULL
                AND (
                  (
                    runtime_table.table_name = 'financial_movements'
                    AND runtime_policy.polname = 'financial_movements_server_access'
                    AND runtime_policy.polroles = ARRAY[0::oid]
                    AND pg_catalog.replace(
                      pg_catalog.replace(
                        pg_catalog.regexp_replace(
                          pg_catalog.lower(
                            pg_catalog.pg_get_expr(
                              runtime_policy.polqual,
                              runtime_policy.polrelid
                            )
                          ),
                          '[[:space:]()"]',
                          '',
                          'g'
                        ),
                        '::name[]',
                        ''
                      ),
                      '::name',
                      ''
                    ) IN (
                      'current_user<>allarray[''anon'',''authenticated'',''authenticator'',''service_role'']',
                      'current_user<>all''{anon,authenticated,authenticator,service_role}'''
                    )
                    AND pg_catalog.replace(
                      pg_catalog.replace(
                        pg_catalog.regexp_replace(
                          pg_catalog.lower(
                            pg_catalog.pg_get_expr(
                              runtime_policy.polwithcheck,
                              runtime_policy.polrelid
                            )
                          ),
                          '[[:space:]()"]',
                          '',
                          'g'
                        ),
                        '::name[]',
                        ''
                      ),
                      '::name',
                      ''
                    ) IN (
                      'current_user<>allarray[''anon'',''authenticated'',''authenticator'',''service_role'']',
                      'current_user<>all''{anon,authenticated,authenticator,service_role}'''
                    )
                  )
                  OR (
                    runtime_table.table_name <> 'financial_movements'
                    AND runtime_policy.polname = 'vexortech_runtime_direct_access'
                    AND runtime_policy.polroles = ARRAY[
                      (SELECT role_state.oid FROM runtime_role AS role_state)
                    ]::oid[]
                    AND pg_catalog.regexp_replace(
                      pg_catalog.lower(
                        pg_catalog.pg_get_expr(
                          runtime_policy.polqual,
                          runtime_policy.polrelid
                        )
                      ),
                      '[[:space:]()]',
                      '',
                      'g'
                    ) = 'true'
                    AND pg_catalog.regexp_replace(
                      pg_catalog.lower(
                        pg_catalog.pg_get_expr(
                          runtime_policy.polwithcheck,
                          runtime_policy.polrelid
                        )
                      ),
                      '[[:space:]()]',
                      '',
                      'g'
                    ) = 'true'
                  )
                )
            )
            OR EXISTS (
              SELECT 1
              FROM pg_catalog.pg_policy AS restrictive_policy
              WHERE restrictive_policy.polrelid = runtime_table.table_oid
                AND restrictive_policy.polpermissive IS FALSE
                AND (
                  0::oid = ANY (restrictive_policy.polroles)
                  OR (SELECT role_state.oid FROM runtime_role AS role_state)
                    = ANY (restrictive_policy.polroles)
                )
            )
          )
        )
    ) AS runtime_rls_policies
`;

export const HEALTH_SCHEMA_SQL = `
  WITH financial_table AS (
    SELECT cls.oid, cls.relowner, cls.relacl, cls.relrowsecurity
    FROM pg_catalog.pg_class AS cls
    JOIN pg_catalog.pg_namespace AS ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = 'public'
      AND cls.relname = 'financial_movements'
      AND cls.relkind IN ('r', 'p')
  ),
  subscription_gateway_columns AS (
    SELECT
      column_state.attname,
      pg_catalog.format_type(column_state.atttypid, column_state.atttypmod) AS data_type,
      column_state.attnotnull,
      pg_catalog.pg_get_expr(default_state.adbin, default_state.adrelid) AS default_expression
    FROM pg_catalog.pg_attribute AS column_state
    JOIN pg_catalog.pg_class AS table_state
      ON table_state.oid = column_state.attrelid
    JOIN pg_catalog.pg_namespace AS table_schema
      ON table_schema.oid = table_state.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef AS default_state
      ON default_state.adrelid = column_state.attrelid
      AND default_state.adnum = column_state.attnum
    WHERE table_schema.nspname = 'public'
      AND table_state.relname = 'subscriptions'
      AND table_state.relkind IN ('r', 'p')
      AND column_state.attname IN ('gateway_action_pending', 'gateway_paused_for_dispute')
      AND column_state.attnum > 0
      AND column_state.attisdropped IS FALSE
  ),
  profile_billing_columns AS (
    SELECT
      column_state.attname,
      pg_catalog.format_type(column_state.atttypid, column_state.atttypmod) AS data_type,
      column_state.attnotnull,
      pg_catalog.pg_get_expr(default_state.adbin, default_state.adrelid) AS default_expression
    FROM pg_catalog.pg_attribute AS column_state
    JOIN pg_catalog.pg_class AS table_state
      ON table_state.oid = column_state.attrelid
    JOIN pg_catalog.pg_namespace AS table_schema
      ON table_schema.oid = table_state.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef AS default_state
      ON default_state.adrelid = column_state.attrelid
      AND default_state.adnum = column_state.attnum
    WHERE table_schema.nspname = 'public'
      AND table_state.relname = 'profiles'
      AND table_state.relkind IN ('r', 'p')
      AND column_state.attname = 'billing_exemption_pending'
      AND column_state.attnum > 0
      AND column_state.attisdropped IS FALSE
  ),
  runtime_role_state AS (
    SELECT role_state.*
    FROM pg_catalog.pg_roles AS role_state
    WHERE role_state.rolname = ${sqlStringLiteral(RUNTIME_ROLE_NAME)}
  ),
  schema_runtime_tables(table_name) AS (
    VALUES
      ${runtimeTablesSql}
  ),
  schema_required_rls_tables(table_name) AS (
    VALUES
      ${runtimeRlsTablesSql}
  ),
  resolved_schema_runtime_tables AS (
    SELECT
      runtime_table.table_name,
      target_table.oid AS table_oid,
      target_table.relrowsecurity
    FROM schema_runtime_tables AS runtime_table
    LEFT JOIN pg_catalog.pg_namespace AS target_schema
      ON target_schema.nspname = 'public'
    LEFT JOIN pg_catalog.pg_class AS target_table
      ON target_table.relnamespace = target_schema.oid
      AND target_table.relname = runtime_table.table_name
      AND target_table.relkind IN ('r', 'p')
  )
  SELECT
    EXISTS (
      SELECT 1
      FROM public.schema_migrations
      WHERE version = $1::text
    ) AS required_migration,
    (
      SELECT MAX(version)
      FROM public.schema_migrations
    ) AS latest_migration,
    (
      EXISTS (
        SELECT 1
        FROM subscription_gateway_columns
        WHERE attname = 'gateway_action_pending'
          AND data_type = 'text'
      )
      AND EXISTS (
        SELECT 1
        FROM subscription_gateway_columns
        WHERE attname = 'gateway_paused_for_dispute'
          AND data_type = 'boolean'
          AND attnotnull IS TRUE
          AND default_expression IN ('false', 'false::boolean')
      )
      AND EXISTS (
        SELECT 1
        FROM profile_billing_columns
        WHERE attname = 'billing_exemption_pending'
          AND data_type = 'boolean'
          AND attnotnull IS TRUE
          AND default_expression IN ('false', 'false::boolean')
      )
    ) AS subscription_gateway_columns,
    NOT EXISTS (
      SELECT 1
      FROM public.subscriptions
      WHERE NULLIF(pg_catalog.btrim(asaas_subscription_id), '') IS NOT NULL
        AND (
          contract_price_monthly IS NULL
          OR contract_price_monthly <= 0
        )
    ) AS subscription_contract_prices,
    (
      NOT EXISTS (
        SELECT 1
        FROM public.payment_events
        WHERE processed IS FALSE
          AND COALESCE(processing_started_at, received_at)
            < now() - interval '10 minutes'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.subscriptions
        WHERE gateway_action_pending IS NOT NULL
          AND updated_at < now() - interval '10 minutes'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE billing_exemption_pending IS TRUE
          AND updated_at < now() - interval '10 minutes'
      )
    ) AS webhook_recovery_backlog_healthy,
    COALESCE(
      (SELECT relrowsecurity FROM financial_table),
      false
    ) AS financial_movements_rls,
    COALESCE(
      (
        SELECT
          NOT EXISTS (
            SELECT 1
            FROM (
              VALUES
                ('anon'::name),
                ('authenticated'::name),
                ('authenticator'::name),
                ('service_role'::name)
            ) AS checked_role(role_name)
            WHERE pg_catalog.has_table_privilege(
                checked_role.role_name,
                financial_table.oid,
                'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
              )
              OR pg_catalog.has_any_column_privilege(
                checked_role.role_name,
                financial_table.oid,
                'SELECT,INSERT,UPDATE,REFERENCES'
              )
              OR CASE
                WHEN current_setting('server_version_num')::integer >= 170000
                  THEN pg_catalog.has_table_privilege(
                    checked_role.role_name,
                    financial_table.oid,
                    'MAINTAIN'
                  )
                ELSE false
              END
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.aclexplode(
              COALESCE(
                financial_table.relacl,
                pg_catalog.acldefault('r', financial_table.relowner)
              )
            ) AS public_table_acl
            WHERE public_table_acl.grantee = 0
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_attribute AS column_state
            CROSS JOIN LATERAL pg_catalog.aclexplode(
              COALESCE(column_state.attacl, ARRAY[]::aclitem[])
            ) AS public_column_acl
            WHERE column_state.attrelid = financial_table.oid
              AND column_state.attnum > 0
              AND column_state.attisdropped IS FALSE
              AND public_column_acl.grantee = 0
          )
        FROM financial_table
      ),
      false
    ) AS financial_movements_no_client_grants,
    COALESCE(
      (
        SELECT
          role_state.rolcanlogin
          AND NOT role_state.rolinherit
          AND NOT role_state.rolsuper
          AND NOT role_state.rolcreatedb
          AND NOT role_state.rolcreaterole
          AND NOT role_state.rolreplication
          AND NOT role_state.rolbypassrls
          AND role_state.rolconnlimit = 30
          AND COALESCE(
            (
              SELECT
                role_setting.setconfig @> ARRAY[
                  'search_path=pg_catalog, public',
                  'statement_timeout=30s',
                  'idle_in_transaction_session_timeout=15s'
                ]::text[]
                AND pg_catalog.cardinality(role_setting.setconfig) = 3
              FROM pg_catalog.pg_db_role_setting AS role_setting
              WHERE role_setting.setrole = role_state.oid
                AND role_setting.setdatabase = 0
            ),
            false
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_db_role_setting AS database_role_setting
            JOIN pg_catalog.pg_database AS configured_database
              ON configured_database.oid = database_role_setting.setdatabase
            WHERE database_role_setting.setrole = role_state.oid
              AND configured_database.datname = current_database()
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_auth_members AS membership
            WHERE membership.member = role_state.oid
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_auth_members AS membership
            LEFT JOIN pg_catalog.pg_roles AS grantor_role
              ON grantor_role.oid = membership.grantor
            WHERE membership.roleid = role_state.oid
              AND NOT (
                membership.admin_option
                AND COALESCE(
                  (pg_catalog.to_jsonb(membership) ->> 'inherit_option')::boolean,
                  true
                ) IS FALSE
                AND COALESCE(
                  (pg_catalog.to_jsonb(membership) ->> 'set_option')::boolean,
                  true
                ) IS FALSE
                AND grantor_role.rolsuper IS TRUE
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_namespace AS managed_schema
            WHERE managed_schema.nspname IN ('auth', 'storage', 'realtime')
              AND (
                pg_catalog.has_schema_privilege(
                  role_state.rolname,
                  managed_schema.oid,
                  'USAGE'
                )
                OR pg_catalog.has_schema_privilege(
                  role_state.rolname,
                  managed_schema.oid,
                  'CREATE'
                )
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_shdepend AS ownership_dependency
            WHERE ownership_dependency.refclassid = 'pg_catalog.pg_authid'::regclass
              AND ownership_dependency.refobjid = role_state.oid
              AND ownership_dependency.deptype = 'o'
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_database WHERE datdba = role_state.oid
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner = role_state.oid
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_class WHERE relowner = role_state.oid
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc WHERE proowner = role_state.oid
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_type WHERE typowner = role_state.oid
          )
          AND NOT EXISTS (
            SELECT 1
            FROM resolved_schema_runtime_tables AS runtime_table
            WHERE runtime_table.table_oid IS NULL
          )
        FROM runtime_role_state AS role_state
      ),
      false
    ) AS runtime_role_contract,
    COALESCE(
      (
        SELECT NOT EXISTS (
          SELECT 1
          FROM resolved_schema_runtime_tables AS runtime_table
          WHERE runtime_table.table_oid IS NULL
            OR (
              EXISTS (
                SELECT 1
                FROM schema_required_rls_tables AS required_rls
                WHERE required_rls.table_name = runtime_table.table_name
              )
              AND runtime_table.relrowsecurity IS NOT TRUE
            )
            OR (
              runtime_table.relrowsecurity
              AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_policy AS runtime_policy
                WHERE runtime_policy.polrelid = runtime_table.table_oid
                  AND runtime_policy.polcmd = '*'
                  AND runtime_policy.polpermissive IS TRUE
                  AND runtime_policy.polqual IS NOT NULL
                  AND runtime_policy.polwithcheck IS NOT NULL
                  AND (
                    (
                      runtime_table.table_name = 'financial_movements'
                      AND runtime_policy.polname = 'financial_movements_server_access'
                      AND runtime_policy.polroles = ARRAY[0::oid]
                      AND pg_catalog.replace(
                        pg_catalog.replace(
                          pg_catalog.regexp_replace(
                            pg_catalog.lower(
                              pg_catalog.pg_get_expr(
                                runtime_policy.polqual,
                                runtime_policy.polrelid
                              )
                            ),
                            '[[:space:]()"]',
                            '',
                            'g'
                          ),
                          '::name[]',
                          ''
                        ),
                        '::name',
                        ''
                      ) IN (
                        'current_user<>allarray[''anon'',''authenticated'',''authenticator'',''service_role'']',
                        'current_user<>all''{anon,authenticated,authenticator,service_role}'''
                      )
                      AND pg_catalog.replace(
                        pg_catalog.replace(
                          pg_catalog.regexp_replace(
                            pg_catalog.lower(
                              pg_catalog.pg_get_expr(
                                runtime_policy.polwithcheck,
                                runtime_policy.polrelid
                              )
                            ),
                            '[[:space:]()"]',
                            '',
                            'g'
                          ),
                          '::name[]',
                          ''
                        ),
                        '::name',
                        ''
                      ) IN (
                        'current_user<>allarray[''anon'',''authenticated'',''authenticator'',''service_role'']',
                        'current_user<>all''{anon,authenticated,authenticator,service_role}'''
                      )
                    )
                    OR (
                      runtime_table.table_name <> 'financial_movements'
                      AND runtime_policy.polname = 'vexortech_runtime_direct_access'
                      AND runtime_policy.polroles = ARRAY[role_state.oid]::oid[]
                      AND pg_catalog.regexp_replace(
                        pg_catalog.lower(
                          pg_catalog.pg_get_expr(
                            runtime_policy.polqual,
                            runtime_policy.polrelid
                          )
                        ),
                        '[[:space:]()]',
                        '',
                        'g'
                      ) = 'true'
                      AND pg_catalog.regexp_replace(
                        pg_catalog.lower(
                          pg_catalog.pg_get_expr(
                            runtime_policy.polwithcheck,
                            runtime_policy.polrelid
                          )
                        ),
                        '[[:space:]()]',
                        '',
                        'g'
                      ) = 'true'
                    )
                  )
              )
              OR EXISTS (
                SELECT 1
                FROM pg_catalog.pg_policy AS restrictive_policy
                WHERE restrictive_policy.polrelid = runtime_table.table_oid
                  AND restrictive_policy.polpermissive IS FALSE
                  AND (
                    0::oid = ANY (restrictive_policy.polroles)
                    OR role_state.oid = ANY (restrictive_policy.polroles)
                  )
              )
            )
        )
        FROM runtime_role_state AS role_state
      ),
      false
    ) AS runtime_rls_contract
`;

export type HealthChecks = {
  runtimeEnv: boolean;
  supabaseProjectRefAligned: boolean;
  database: boolean;
  databaseWritable: boolean;
  runtimeRoleLeastPrivilege: boolean;
  runtimeTablePrivileges: boolean;
  runtimeSequencePrivileges: boolean;
  runtimeFunctionPrivileges: boolean;
  runtimeRlsPolicies: boolean;
  requiredMigration: boolean;
  subscriptionGatewayColumns: boolean;
  subscriptionContractPrices: boolean;
  webhookRecoveryBacklogHealthy: boolean;
  financialMovementsRls: boolean;
  financialMovementsNoClientGrants: boolean;
};

export type HealthReport = {
  status: "ok" | "error";
  checks: HealthChecks;
  latestMigration: string | null;
};

type HealthQueryResult = {
  rows: Array<Record<string, unknown>>;
};

export type HealthRuntimeConfig = {
  production: boolean;
  nextPublicSupabaseUrl?: string;
  databaseUrl?: string;
  postgresHost?: string;
  postgresUser?: string;
};

export type HealthDependencies = {
  validateRuntimeEnv: () => void;
  runtimeConfig: HealthRuntimeConfig;
  query: (text: string, params?: unknown[]) => Promise<HealthQueryResult>;
  queryTimeoutMs?: number;
};

const clean = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const validProjectRef = (value: string | undefined) =>
  value && /^[a-z0-9]{8,64}$/.test(value) ? value : null;

const projectRefFromSupabaseUrl = (configuredUrl?: string) => {
  const value = clean(configuredUrl);
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const match = url.hostname.toLowerCase().match(/^([a-z0-9]+)\.supabase\.co$/);
    return validProjectRef(match?.[1]);
  } catch {
    return null;
  }
};

const projectRefFromDatabaseHost = (host: string, username?: string) => {
  const normalizedHost = host.trim().toLowerCase().replace(/\.$/, "");
  const directMatch = normalizedHost.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
  if (directMatch) return validProjectRef(directMatch[1]);

  if (normalizedHost === "pooler.supabase.com" || normalizedHost.endsWith(".pooler.supabase.com")) {
    const normalizedUser = clean(username)?.toLowerCase();
    const separatorIndex = normalizedUser?.lastIndexOf(".") ?? -1;
    if (separatorIndex <= 0 || separatorIndex === (normalizedUser?.length ?? 0) - 1) return null;
    const roleName = normalizedUser?.slice(0, separatorIndex);
    if (!roleName || /\s/.test(roleName)) return null;
    return validProjectRef(normalizedUser?.slice(separatorIndex + 1));
  }

  return null;
};

const projectRefFromDatabaseConfig = (config: HealthRuntimeConfig) => {
  const databaseUrl = clean(config.databaseUrl);
  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) return null;
      return projectRefFromDatabaseHost(parsed.hostname, decodeURIComponent(parsed.username));
    } catch {
      return null;
    }
  }

  const host = clean(config.postgresHost);
  if (!host) return null;
  return projectRefFromDatabaseHost(host, config.postgresUser);
};

export const isSupabaseProjectRefAligned = (config: HealthRuntimeConfig) => {
  if (!config.production) return true;
  const publicProjectRef = projectRefFromSupabaseUrl(config.nextPublicSupabaseUrl);
  const databaseProjectRef = projectRefFromDatabaseConfig(config);
  return Boolean(publicProjectRef && databaseProjectRef && publicProjectRef === databaseProjectRef);
};

const emptyChecks = (): HealthChecks => ({
  runtimeEnv: false,
  supabaseProjectRefAligned: false,
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
});

const reportFor = (checks: HealthChecks, latestMigration: string | null): HealthReport => ({
  status: Object.values(checks).every(Boolean) ? "ok" : "error",
  checks: { ...checks },
  latestMigration,
});

type HealthCacheOptions = {
  ttlMs?: number;
  now?: () => number;
};

export const createCachedHealthEvaluator = (
  evaluator: () => Promise<HealthReport>,
  options: HealthCacheOptions = {},
) => {
  const ttlMs = Math.max(0, options.ttlMs ?? HEALTH_CACHE_TTL_MS);
  const now = options.now ?? Date.now;
  let cached: { report: HealthReport; expiresAt: number } | null = null;
  let inFlight: Promise<HealthReport> | null = null;

  return (): Promise<HealthReport> => {
    const currentTime = now();
    if (cached && cached.expiresAt > currentTime) return Promise.resolve(cached.report);
    if (inFlight) return inFlight;

    inFlight = evaluator()
      .then((report) => {
        cached = { report, expiresAt: now() + ttlMs };
        return report;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
};

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Health query timed out.")), timeoutMs);
    operation.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

export const evaluateHealth = async ({
  validateRuntimeEnv,
  runtimeConfig,
  query,
  queryTimeoutMs = HEALTH_QUERY_TIMEOUT_MS,
}: HealthDependencies): Promise<HealthReport> => {
  const checks = emptyChecks();
  const timeoutMs = Math.max(1, Math.min(queryTimeoutMs, 30_000));

  try {
    validateRuntimeEnv();
    checks.runtimeEnv = true;
    checks.supabaseProjectRefAligned = isSupabaseProjectRefAligned(runtimeConfig);
  } catch {
    return reportFor(checks, null);
  }

  try {
    const probe = await withTimeout(query(HEALTH_DATABASE_PROBE_SQL), timeoutMs);
    checks.database = probe.rows[0]?.ok === 1;
    checks.databaseWritable = probe.rows[0]?.database_writable === true;
    checks.runtimeRoleLeastPrivilege = probe.rows[0]?.runtime_role_least_privilege === true;
    checks.runtimeTablePrivileges = probe.rows[0]?.runtime_table_privileges === true;
    checks.runtimeSequencePrivileges = probe.rows[0]?.runtime_sequence_privileges === true;
    checks.runtimeFunctionPrivileges = probe.rows[0]?.runtime_function_privileges === true;
    checks.runtimeRlsPolicies = probe.rows[0]?.runtime_rls_policies === true;
  } catch {
    return reportFor(checks, null);
  }
  if (!checks.database) return reportFor(checks, null);

  let latestMigration: string | null = null;
  try {
    const result = await withTimeout(
      query(HEALTH_SCHEMA_SQL, [REQUIRED_MIGRATION_VERSION]),
      timeoutMs,
    );
    const row = result.rows[0];
    if (row) {
      checks.requiredMigration = row.required_migration === true;
      checks.subscriptionGatewayColumns = row.subscription_gateway_columns === true;
      checks.subscriptionContractPrices = row.subscription_contract_prices === true;
      checks.webhookRecoveryBacklogHealthy = row.webhook_recovery_backlog_healthy === true;
      checks.financialMovementsRls = row.financial_movements_rls === true;
      checks.financialMovementsNoClientGrants = row.financial_movements_no_client_grants === true;
      checks.runtimeRoleLeastPrivilege =
        checks.runtimeRoleLeastPrivilege && row.runtime_role_contract === true;
      checks.runtimeRlsPolicies = checks.runtimeRlsPolicies && row.runtime_rls_contract === true;
      latestMigration = typeof row.latest_migration === "string" ? row.latest_migration : null;
    }
  } catch {
    // The public response intentionally contains no database error details.
  }

  return reportFor(checks, latestMigration);
};
