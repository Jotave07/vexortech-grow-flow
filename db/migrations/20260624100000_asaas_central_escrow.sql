-- =====================================================================
-- Migration: Fluxo Asaas PIX centralizado (escrow + repasse + reembolso)
-- Data: 2026-06-24
-- Caracteristica: ADITIVA e NAO-DESTRUTIVA (IF NOT EXISTS em tudo).
--   - Nao altera colunas/dados existentes.
--   - Coexiste com o modelo descentralizado atual (flag financeiro_ativo).
--   - Check de pix_key_type entra como NOT VALID: valida apenas gravacoes
--     novas/atualizadas; linhas legadas (valores antigos) sao preservadas.
-- Aplicar no Supabase (projeto sjzdvlqnhhgbqdsvwiqt).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. store_settings: configuracao financeira do lojista
--    (pix_key / pix_key_type JA EXISTEM nesta tabela)
-- ---------------------------------------------------------------------
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS financeiro_ativo            boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS repasse_automatico          boolean      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS repasse_momento             text         NOT NULL DEFAULT 'APOS_ENTREGA',
  ADD COLUMN IF NOT EXISTS taxa_percentual_plataforma  numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxa_fixa_plataforma        numeric(12,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.store_settings
    ADD CONSTRAINT store_settings_repasse_momento_chk
    CHECK (repasse_momento IN ('APOS_ENTREGA','MANUAL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- NOT VALID: nao verifica linhas existentes (valores legados de pix_key_type),
-- mas passa a exigir o padrao Asaas em toda gravacao/atualizacao futura.
DO $$ BEGIN
  ALTER TABLE public.store_settings
    ADD CONSTRAINT store_settings_pix_key_type_chk
    CHECK (pix_key_type IS NULL OR upper(pix_key_type) IN ('CPF','CNPJ','EMAIL','PHONE','EVP','RANDOM','KEY','COPY_PASTE'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.store_settings
    ADD CONSTRAINT store_settings_taxas_nonneg_chk
    CHECK (taxa_percentual_plataforma >= 0 AND taxa_fixa_plataforma >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 2. orders: sub-status financeiros + campos de repasse/reembolso
--    (status, payment_status, paid_at, delivered_at, cancelled_at,
--     cancel_reason, pix_payload, pix_qr_code JA EXISTEM)
-- ---------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS transfer_status        text          NOT NULL DEFAULT 'NAO_LIBERADO',
  ADD COLUMN IF NOT EXISTS refund_status          text          NOT NULL DEFAULT 'NAO_SOLICITADO',
  ADD COLUMN IF NOT EXISTS asaas_transfer_id      text,
  ADD COLUMN IF NOT EXISTS asaas_event_id_ultimo  text,
  ADD COLUMN IF NOT EXISTS platform_fee_amount    numeric(12,2),
  ADD COLUMN IF NOT EXISTS transfer_amount        numeric(12,2),
  ADD COLUMN IF NOT EXISTS refunded_amount        numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_released_at  timestamptz,
  ADD COLUMN IF NOT EXISTS transfer_released_at    timestamptz,
  ADD COLUMN IF NOT EXISTS transfer_sent_at        timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at             timestamptz;

DO $$ BEGIN
  ALTER TABLE public.orders
    ADD CONSTRAINT orders_transfer_status_chk
    CHECK (transfer_status IN (
      'NAO_LIBERADO','AGUARDANDO_ENTREGA','LIBERADO','PROCESSANDO',
      'ENVIADO','FALHOU','BLOQUEADO','CANCELADO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.orders
    ADD CONSTRAINT orders_refund_status_chk
    CHECK (refund_status IN (
      'NAO_SOLICITADO','PENDENTE','PROCESSANDO','ESTORNADO_TOTAL',
      'ESTORNADO_PARCIAL','FALHOU','NAO_APLICAVEL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_orders_transfer_status
  ON public.orders (transfer_status)
  WHERE transfer_status IN ('AGUARDANDO_ENTREGA','LIBERADO','PROCESSANDO','FALHOU');

CREATE INDEX IF NOT EXISTS idx_orders_asaas_transfer_id
  ON public.orders (asaas_transfer_id);

-- ---------------------------------------------------------------------
-- 3. financial_movements: ledger interno (auditoria/conciliacao)
--    Nunca excluir linhas; correcao = novo movimento de ajuste.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_movements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid REFERENCES public.orders(id) ON DELETE RESTRICT,
  store_id          uuid REFERENCES public.stores(id) ON DELETE RESTRICT,
  type              text NOT NULL,
  nature            text NOT NULL,
  amount            numeric(12,2) NOT NULL,
  status            text NOT NULL DEFAULT 'PENDENTE',
  description       text,
  asaas_payment_id  text,
  asaas_transfer_id text,
  asaas_refund_id   text,
  asaas_event_id    text,
  external_reference text,
  idempotency_key   text NOT NULL,
  metadata_json     jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  confirmed_at      timestamptz,
  failed_at         timestamptz,
  fail_reason       text,
  CONSTRAINT financial_movements_type_chk CHECK (type IN (
    'ENTRADA_PIX','TAXA_PLATAFORMA','REPASSE_LOJISTA','REEMBOLSO_CLIENTE',
    'AJUSTE_MANUAL','ESTORNO_REPASSE','RESERVA_OPERACIONAL')),
  CONSTRAINT financial_movements_nature_chk  CHECK (nature IN ('CREDITO','DEBITO')),
  CONSTRAINT financial_movements_status_chk  CHECK (status IN (
    'PENDENTE','PROCESSANDO','CONFIRMADO','FALHOU','CANCELADO')),
  CONSTRAINT financial_movements_amount_chk  CHECK (amount >= 0)
);

-- idempotencia global de movimentos
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_mov_idempotency
  ON public.financial_movements (idempotency_key);

-- no maximo 1 ENTRADA_PIX e 1 REPASSE_LOJISTA por pedido
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_mov_entrada
  ON public.financial_movements (order_id) WHERE type = 'ENTRADA_PIX';
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_mov_repasse
  ON public.financial_movements (order_id) WHERE type = 'REPASSE_LOJISTA';

CREATE INDEX IF NOT EXISTS idx_fin_mov_payment      ON public.financial_movements (asaas_payment_id);
CREATE INDEX IF NOT EXISTS idx_fin_mov_transfer     ON public.financial_movements (asaas_transfer_id);
CREATE INDEX IF NOT EXISTS idx_fin_mov_extref       ON public.financial_movements (external_reference);
CREATE INDEX IF NOT EXISTS idx_fin_mov_store_created ON public.financial_movements (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fin_mov_order        ON public.financial_movements (order_id);

-- ---------------------------------------------------------------------
-- 4. payment_events: idempotencia por event id + suporte a TRANSFER_*
--    (tabela ja existe; colunas abaixo sao aditivas)
-- ---------------------------------------------------------------------
ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS asaas_event_id   text,
  ADD COLUMN IF NOT EXISTS resource_type    text,
  ADD COLUMN IF NOT EXISTS processed        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS processed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS processing_error text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_events_asaas_event_id
  ON public.payment_events (asaas_event_id) WHERE asaas_event_id IS NOT NULL;

-- financial_movements is server-only. Keep it out of the exposed Data API.
ALTER TABLE public.financial_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.financial_movements FROM anon, authenticated;

COMMIT;

