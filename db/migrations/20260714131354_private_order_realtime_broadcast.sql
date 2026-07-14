BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Tickets live outside every exposed Data API schema. They are deliberately
-- short-lived capabilities: the browser receives only a random UUID topic,
-- while order rows remain behind the cookie-authenticated BFF.
CREATE SCHEMA IF NOT EXISTS hype_private;
REVOKE ALL ON SCHEMA hype_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS hype_private.order_realtime_tickets (
  ticket_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT order_realtime_tickets_expiry_window_chk CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '15 minutes'
  )
);

ALTER TABLE hype_private.order_realtime_tickets ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS order_realtime_tickets_store_expiry_idx
  ON hype_private.order_realtime_tickets (store_id, expires_at);

CREATE INDEX IF NOT EXISTS order_realtime_tickets_expiry_idx
  ON hype_private.order_realtime_tickets (expires_at);

COMMENT ON TABLE hype_private.order_realtime_tickets IS
  'Short-lived, server-issued capabilities for private order invalidation channels.';

REVOKE ALL ON TABLE hype_private.order_realtime_tickets FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hype_private.issue_order_realtime_ticket(
  _store_id uuid,
  _actor_user_id uuid
)
RETURNS TABLE (ticket_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  issued_at timestamptz := clock_timestamp();
  issued_ticket_id uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.stores AS store
    WHERE store.id = _store_id
      AND COALESCE(store.is_active, true)
      AND NOT COALESCE(store.is_suspended, false)
  ) THEN
    RAISE EXCEPTION 'Store is not active for Realtime tickets'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize renewals for one actor/store pair so concurrent requests cannot
  -- race past the eight-ticket fan-out ceiling.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hype-order-realtime-ticket:' || _store_id::text || ':' || _actor_user_id::text,
      0
    )
  );

  -- Bounded opportunistic cleanup avoids an unbounded DELETE in a request
  -- transaction. SKIP LOCKED keeps concurrent ticket renewals independent.
  WITH expired AS (
    SELECT ticket.ticket_id
    FROM hype_private.order_realtime_tickets AS ticket
    WHERE ticket.expires_at <= issued_at
    ORDER BY ticket.expires_at
    LIMIT 500
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM hype_private.order_realtime_tickets AS ticket
  USING expired
  WHERE ticket.ticket_id = expired.ticket_id;

  -- Limit a single actor/store pair to eight simultaneous tabs/tickets. This
  -- bounds fan-out even if the ticket endpoint is retried aggressively.
  WITH excess AS (
    SELECT ticket.ticket_id
    FROM hype_private.order_realtime_tickets AS ticket
    WHERE ticket.store_id = _store_id
      AND ticket.actor_user_id = _actor_user_id
      AND ticket.expires_at > issued_at
    ORDER BY ticket.created_at DESC
    OFFSET 7
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM hype_private.order_realtime_tickets AS ticket
  USING excess
  WHERE ticket.ticket_id = excess.ticket_id;

  RETURN QUERY
  INSERT INTO hype_private.order_realtime_tickets AS issued_ticket (
    ticket_id,
    store_id,
    actor_user_id,
    created_at,
    expires_at
  )
  VALUES (
    issued_ticket_id,
    _store_id,
    _actor_user_id,
    issued_at,
    issued_at + interval '10 minutes'
  )
  RETURNING
    issued_ticket.ticket_id,
    issued_ticket.expires_at;
END;
$function$;

REVOKE ALL ON FUNCTION hype_private.issue_order_realtime_ticket(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- The direct database runtime can issue a ticket but cannot enumerate, alter
-- or delete the private ticket table. The role is optional in local shadows.
DO $runtime_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vexortech_runtime') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA hype_private TO vexortech_runtime';
    EXECUTE 'GRANT EXECUTE ON FUNCTION hype_private.issue_order_realtime_ticket(uuid, uuid) TO vexortech_runtime';
  END IF;
END
$runtime_grant$;

CREATE OR REPLACE FUNCTION hype_private.can_receive_store_order_topic(_topic text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  requested_ticket_id uuid;
BEGIN
  IF _topic IS NULL OR _topic !~ '^hype:store-orders:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;

  BEGIN
    requested_ticket_id := pg_catalog.split_part(_topic, ':', 3)::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN false;
  END;

  RETURN EXISTS (
    SELECT 1
    FROM hype_private.order_realtime_tickets AS ticket
    JOIN public.stores AS store ON store.id = ticket.store_id
    WHERE ticket.ticket_id = requested_ticket_id
      AND ticket.expires_at > statement_timestamp()
      AND COALESCE(store.is_active, true)
      AND NOT COALESCE(store.is_suspended, false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION hype_private.can_receive_store_order_topic(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA hype_private TO anon, authenticated;
GRANT EXECUTE ON FUNCTION hype_private.can_receive_store_order_topic(text) TO anon, authenticated;

-- A permissive receive policy makes a valid ticket joinable. The restrictive
-- guard is neutral outside the Hype namespace, while preventing a pre-existing
-- broad policy from admitting expired/unknown Hype topics.
DROP POLICY IF EXISTS hype_store_order_broadcast_receive ON realtime.messages;
CREATE POLICY hype_store_order_broadcast_receive
  ON realtime.messages
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND (SELECT hype_private.can_receive_store_order_topic((SELECT realtime.topic())))
  );

DROP POLICY IF EXISTS hype_store_order_broadcast_ticket_guard ON realtime.messages;
CREATE POLICY hype_store_order_broadcast_ticket_guard
  ON realtime.messages
  AS RESTRICTIVE
  FOR SELECT
  TO anon, authenticated
  USING (
    (SELECT realtime.topic()) !~ '^hype:store-orders:'
    OR (
      realtime.messages.extension = 'broadcast'
      AND (SELECT hype_private.can_receive_store_order_topic((SELECT realtime.topic())))
    )
  );

-- Hype topics are database-publish-only even after their tickets expire. This
-- blocks forged client invalidations if another permissive INSERT policy exists.
DROP POLICY IF EXISTS hype_store_order_broadcast_database_only ON realtime.messages;
CREATE POLICY hype_store_order_broadcast_database_only
  ON realtime.messages
  AS RESTRICTIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (SELECT realtime.topic()) !~ '^hype:store-orders:'
  );

CREATE OR REPLACE FUNCTION hype_private.broadcast_store_order_invalidation()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  target_store_id uuid;
  active_ticket record;
  broadcast_at timestamptz := statement_timestamp();
BEGIN
  target_store_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.store_id ELSE NEW.store_id END;

  BEGIN
    DELETE FROM hype_private.order_realtime_tickets AS ticket
    WHERE ticket.store_id = target_store_id
      AND ticket.expires_at <= broadcast_at;

    FOR active_ticket IN
      SELECT ticket.ticket_id
      FROM hype_private.order_realtime_tickets AS ticket
      WHERE ticket.store_id = target_store_id
        AND ticket.expires_at > broadcast_at
    LOOP
      PERFORM realtime.send(
        pg_catalog.jsonb_build_object(
          'version', 1,
          'table', 'orders'
        ),
        'orders-invalidated',
        'hype:store-orders:' || active_ticket.ticket_id::text,
        true
      );
    END LOOP;
  EXCEPTION
    WHEN OTHERS THEN
      -- Realtime only reduces latency. The 20-second reconciliation remains
      -- active, so a Broadcast failure must never roll back the order itself.
      RAISE WARNING 'order realtime invalidation failed for store %: %', target_store_id, SQLERRM;
  END;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION hype_private.broadcast_store_order_invalidation()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_private_broadcast_invalidation ON public.orders;
CREATE TRIGGER orders_private_broadcast_invalidation
  AFTER INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION hype_private.broadcast_store_order_invalidation();

CREATE OR REPLACE FUNCTION hype_private.revoke_store_order_realtime_tickets()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF OLD.is_active IS DISTINCT FROM NEW.is_active
    OR OLD.is_suspended IS DISTINCT FROM NEW.is_suspended
    OR OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id
  THEN
    DELETE FROM hype_private.order_realtime_tickets AS ticket
    WHERE ticket.store_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION hype_private.revoke_store_order_realtime_tickets()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stores_revoke_order_realtime_tickets ON public.stores;
CREATE TRIGGER stores_revoke_order_realtime_tickets
  AFTER UPDATE OF is_active, is_suspended, owner_user_id ON public.stores
  FOR EACH ROW
  EXECUTE FUNCTION hype_private.revoke_store_order_realtime_tickets();

COMMIT;
