BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- The deploy sets a random SCRAM password through the administrative
-- connection after migrations finish. A newly-created LOGIN role with a NULL
-- password cannot authenticate in the meantime, and no credential is stored
-- in Git or migration history.
DO $runtime_role$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'vexortech_runtime'
  ) THEN
    EXECUTE '
      CREATE ROLE vexortech_runtime
        LOGIN
        PASSWORD NULL
        NOINHERIT
        CONNECTION LIMIT 30
    ';
  END IF;
END
$runtime_role$;

-- Supabase's postgres login is deliberately not a real superuser. PostgreSQL
-- does not let a non-superuser reaffirm NOSUPERUSER and can restrict changes to
-- REPLICATION/BYPASSRLS, so assert the safe defaults instead of ALTERing those
-- properties. A pre-existing privileged role is an explicit provisioning error.
DO $runtime_attributes$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'vexortech_runtime'
      AND (
        rolsuper
        OR rolcreatedb
        OR rolcreaterole
        OR rolreplication
        OR rolbypassrls
      )
  ) THEN
    RAISE EXCEPTION
      'vexortech_runtime has privileged role attributes; remove them with an authorized administrator';
  END IF;
END
$runtime_attributes$;

-- Reapplying this migration must not erase a password already provisioned by
-- the deploy. ALTER ROLE LOGIN changes attributes but preserves the password.
ALTER ROLE vexortech_runtime
  LOGIN
  NOINHERIT
  CONNECTION LIMIT 30;

ALTER ROLE vexortech_runtime RESET ALL;
DO $runtime_database_settings$
BEGIN
  EXECUTE pg_catalog.format(
    'ALTER ROLE %I IN DATABASE %I RESET ALL',
    'vexortech_runtime',
    current_database()
  );
END
$runtime_database_settings$;

ALTER ROLE vexortech_runtime SET search_path = pg_catalog, public;
ALTER ROLE vexortech_runtime SET statement_timeout = '30s';
ALTER ROLE vexortech_runtime SET idle_in_transaction_session_timeout = '15s';

DO $runtime_settings_contract$
DECLARE
  runtime_role_oid oid;
BEGIN
  SELECT oid
  INTO runtime_role_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vexortech_runtime';

  IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_db_role_setting AS role_setting
      WHERE role_setting.setrole = runtime_role_oid
        AND role_setting.setdatabase = 0
        AND role_setting.setconfig @> ARRAY[
          'search_path=pg_catalog, public',
          'statement_timeout=30s',
          'idle_in_transaction_session_timeout=15s'
        ]::text[]
        AND pg_catalog.cardinality(role_setting.setconfig) = 3
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_db_role_setting AS database_role_setting
      JOIN pg_catalog.pg_database AS configured_database
        ON configured_database.oid = database_role_setting.setdatabase
      WHERE database_role_setting.setrole = runtime_role_oid
        AND configured_database.datname = current_database()
    )
  THEN
    RAISE EXCEPTION 'vexortech_runtime role settings do not match the runtime contract';
  END IF;
END
$runtime_settings_contract$;

-- The runtime is intentionally standalone. Membership in a privileged role
-- would make the direct grants below an incomplete security boundary.
DO $runtime_memberships$
DECLARE
  inherited_role record;
  member_role record;
BEGIN
  FOR inherited_role IN
    SELECT parent_role.rolname
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS parent_role
      ON parent_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS child_role
      ON child_role.oid = membership.member
    WHERE child_role.rolname = 'vexortech_runtime'
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE %I FROM %I',
      inherited_role.rolname,
      'vexortech_runtime'
    );
  END LOOP;

  -- PostgreSQL 16+ automatically grants the non-superuser role creator an
  -- ADMIN-only membership with SET/INHERIT disabled and the bootstrap
  -- superuser as grantor. The creator cannot revoke that grant. Preserve only
  -- that non-effective administrative relationship and remove every membership
  -- that could actually exercise runtime privileges.
  FOR member_role IN
    SELECT child_role.rolname
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS parent_role
      ON parent_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS child_role
      ON child_role.oid = membership.member
    LEFT JOIN pg_catalog.pg_roles AS grantor_role
      ON grantor_role.oid = membership.grantor
    WHERE parent_role.rolname = 'vexortech_runtime'
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
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE %I FROM %I',
      'vexortech_runtime',
      member_role.rolname
    );
  END LOOP;
END
$runtime_memberships$;

-- Table owners normally bypass RLS. Abort instead of silently accepting a
-- pre-existing role that owns database objects.
DO $runtime_ownership$
DECLARE
  runtime_role_oid oid;
BEGIN
  SELECT oid
  INTO runtime_role_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'vexortech_runtime';

  IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_database WHERE datdba = runtime_role_oid
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_shdepend AS ownership_dependency
      WHERE ownership_dependency.refclassid = 'pg_catalog.pg_authid'::regclass
        AND ownership_dependency.refobjid = runtime_role_oid
        AND ownership_dependency.deptype = 'o'
    )
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner = runtime_role_oid
    )
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_class WHERE relowner = runtime_role_oid
    )
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc WHERE proowner = runtime_role_oid
    )
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_type WHERE typowner = runtime_role_oid
    )
  THEN
    RAISE EXCEPTION
      'vexortech_runtime owns database objects; reassign ownership before provisioning';
  END IF;
END
$runtime_ownership$;

DO $database_access$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',
    current_database(),
    'vexortech_runtime'
  );
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO %I',
    current_database(),
    'vexortech_runtime'
  );
END
$database_access$;

REVOKE ALL PRIVILEGES ON SCHEMA public FROM vexortech_runtime;
GRANT USAGE ON SCHEMA public TO vexortech_runtime;

-- Auth, Storage and Realtime are consumed through their HTTP services. Direct
-- database namespace access would expand the runtime trust boundary.
DO $managed_schema_access$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS managed_schema
    WHERE managed_schema.nspname IN ('auth', 'storage', 'realtime')
      AND (
        pg_catalog.has_schema_privilege(
          'vexortech_runtime',
          managed_schema.oid,
          'USAGE'
        )
        OR pg_catalog.has_schema_privilege(
          'vexortech_runtime',
          managed_schema.oid,
          'CREATE'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'vexortech_runtime has direct access to a managed Supabase schema';
  END IF;
END
$managed_schema_access$;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM vexortech_runtime;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM vexortech_runtime;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM vexortech_runtime;

-- New objects must be reviewed explicitly in a later migration rather than
-- inheriting broad runtime access.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM vexortech_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM vexortech_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM vexortech_runtime;

GRANT SELECT ON TABLE
  public.audit_logs,
  public.categories,
  public.coupons,
  public.customer_addresses,
  public.customer_favorites,
  public.customers,
  public.delivery_drivers,
  public.delivery_zones,
  public.financial_movements,
  public.notification_events,
  public.order_item_options,
  public.order_items,
  public.order_status_history,
  public.orders,
  public.payment_events,
  public.payments,
  public.plans,
  public.product_option_items,
  public.product_options,
  public.products,
  public.profiles,
  public.schema_migrations,
  public.store_reviews,
  public.store_settings,
  public.stores,
  public.subscriptions,
  public.user_roles
TO vexortech_runtime;

GRANT INSERT ON TABLE
  public.categories,
  public.coupons,
  public.customer_addresses,
  public.customer_favorites,
  public.customers,
  public.delivery_drivers,
  public.delivery_zones,
  public.financial_movements,
  public.notification_events,
  public.order_item_options,
  public.order_items,
  public.order_status_history,
  public.orders,
  public.payment_events,
  public.payments,
  public.plans,
  public.product_option_items,
  public.product_options,
  public.products,
  public.profiles,
  public.store_reviews,
  public.store_settings,
  public.stores,
  public.subscriptions,
  public.user_roles
TO vexortech_runtime;

GRANT UPDATE ON TABLE
  public.categories,
  public.coupons,
  public.customer_addresses,
  public.customer_favorites,
  public.customers,
  public.delivery_drivers,
  public.delivery_zones,
  public.financial_movements,
  public.notification_events,
  public.orders,
  public.payment_events,
  public.payments,
  public.plans,
  public.product_option_items,
  public.product_options,
  public.products,
  public.profiles,
  public.store_reviews,
  public.store_settings,
  public.stores,
  public.subscriptions
TO vexortech_runtime;

GRANT DELETE ON TABLE
  public.categories,
  public.coupons,
  public.customer_addresses,
  public.customer_favorites,
  public.delivery_drivers,
  public.delivery_zones,
  public.plans,
  public.product_option_items,
  public.product_options,
  public.products,
  public.profiles,
  public.store_reviews,
  public.user_roles
TO vexortech_runtime;

GRANT USAGE ON SEQUENCE public.orders_order_number_seq
TO vexortech_runtime;

GRANT EXECUTE ON FUNCTION public.is_vexor_admin(uuid)
TO vexortech_runtime;
GRANT EXECUTE ON FUNCTION public.get_public_order_items(text)
TO vexortech_runtime;
GRANT EXECUTE ON FUNCTION public.get_public_order_status_history(text)
TO vexortech_runtime;
GRANT EXECUTE ON FUNCTION public.get_store_rating(uuid)
TO vexortech_runtime;

-- The financial ledger keeps the policy created by the preceding migration;
-- health and schema checks intentionally validate it without altering it here.
DO $runtime_policies$
DECLARE
  table_name text;
  relation_oid oid;
  rls_enabled boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS financial_table
    JOIN pg_catalog.pg_policy AS server_policy
      ON server_policy.polrelid = financial_table.oid
    WHERE financial_table.oid = 'public.financial_movements'::regclass
      AND financial_table.relrowsecurity IS TRUE
      AND server_policy.polname = 'financial_movements_server_access'
      AND server_policy.polcmd = '*'
      AND server_policy.polpermissive IS TRUE
      AND server_policy.polroles = ARRAY[0::oid]
      AND pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.regexp_replace(
            pg_catalog.lower(
              pg_catalog.pg_get_expr(
                server_policy.polqual,
                server_policy.polrelid
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
                server_policy.polwithcheck,
                server_policy.polrelid
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
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policy AS restrictive_policy
        WHERE restrictive_policy.polrelid = financial_table.oid
          AND restrictive_policy.polpermissive IS FALSE
          AND (
            0::oid = ANY (restrictive_policy.polroles)
            OR (
              SELECT runtime_role.oid
              FROM pg_catalog.pg_roles AS runtime_role
              WHERE runtime_role.rolname = 'vexortech_runtime'
            ) = ANY (restrictive_policy.polroles)
          )
      )
  ) THEN
    RAISE EXCEPTION
      'financial_movements RLS policy does not match the required server-only contract';
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'audit_logs',
    'categories',
    'coupons',
    'customer_addresses',
    'customer_favorites',
    'customers',
    'delivery_drivers',
    'delivery_zones',
    'notification_events',
    'order_item_options',
    'order_items',
    'order_status_history',
    'orders',
    'payment_events',
    'payments',
    'plans',
    'product_option_items',
    'product_options',
    'products',
    'profiles',
    'schema_migrations',
    'store_reviews',
    'store_settings',
    'stores',
    'subscriptions',
    'user_roles'
  ]::text[]
  LOOP
    relation_oid := pg_catalog.to_regclass(
      pg_catalog.format('%I.%I', 'public', table_name)
    );

    IF relation_oid IS NULL THEN
      RAISE EXCEPTION 'Required runtime table public.% is missing', table_name;
    END IF;

    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      'vexortech_runtime_direct_access',
      'public',
      table_name
    );

    SELECT table_relation.relrowsecurity
    INTO rls_enabled
    FROM pg_catalog.pg_class AS table_relation
    WHERE table_relation.oid = relation_oid;

    IF table_name = ANY (ARRAY[
        'audit_logs',
        'customer_addresses',
        'customer_favorites',
        'delivery_drivers'
      ]::text[])
      AND rls_enabled IS NOT TRUE
    THEN
      RAISE EXCEPTION 'Required RLS is disabled on public.%', table_name;
    END IF;

    IF rls_enabled THEN
      EXECUTE pg_catalog.format(
        'CREATE POLICY %I ON %I.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)',
        'vexortech_runtime_direct_access',
        'public',
        table_name,
        'vexortech_runtime'
      );

      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policy AS restrictive_policy
        WHERE restrictive_policy.polrelid = relation_oid
          AND restrictive_policy.polpermissive IS FALSE
          AND (
            0::oid = ANY (restrictive_policy.polroles)
            OR (
              SELECT runtime_role.oid
              FROM pg_catalog.pg_roles AS runtime_role
              WHERE runtime_role.rolname = 'vexortech_runtime'
            ) = ANY (restrictive_policy.polroles)
          )
      ) THEN
        RAISE EXCEPTION
          'Restrictive RLS policy applies to vexortech_runtime on public.%',
          table_name;
      END IF;
    END IF;
  END LOOP;
END
$runtime_policies$;

COMMIT;
