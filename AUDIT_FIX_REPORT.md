# Audit Fix Report

Data: 2026-05-21
Branch: `fix/production-hardening-checkout-payments`

## Comandos Executados

Saidas completas foram salvas localmente em:

- Baseline: `audit-logs/baseline-20260521-141549/`
- Validacao final: `audit-logs/final-20260521-143400/`

Baseline:

- `node -v` => ok (`v24.14.0`)
- `npm -v` => ok (`11.9.0`)
- `npm ci` => ok
- `npm run typecheck` => ok
- `npm run lint` => ok, com 11 warnings existentes de Fast Refresh
- `npm test` => ok
- `npm run build` => ok
- `npm run e2e` => ok

Validacao final:

- `npm run typecheck` => ok
- `npm run lint` => ok, com 11 warnings existentes de Fast Refresh
- `npm test` => ok
- `npm run build` => ok
- `npm run db:migrate` => falhou localmente porque `.env` nao possui `DATABASE_URL` nem `POSTGRES_*` completos
- `npm run db:check` => falhou localmente pelo mesmo motivo

Tambem foram executadas varreduras:

- `rg --pcre2 "ANY\(\$[0-9]+\)(?!::)|hashtextextended\(\$[0-9]+,\s*0\)" src/backend src/server src/functions` => sem ocorrencias
- `rg "@supabase/supabase-js|integrations/supabase"` => sem ocorrencias em `src`/`package.json`

## Erros Encontrados

1. Risco direto do erro PostgreSQL `could not determine data type of parameter $1`:
   - `src/backend/query.ts` gerava `.in()` como `col = ANY($n)` sem cast.
   - Relacoes aninhadas carregavam `WHERE foreign = ANY($1)` sem cast.
   - Advisory locks usavam `hashtextextended($1, 0)` sem cast.

2. `db:migrate` e `db:check` nao puderam ser validados neste ambiente porque as variaveis de banco locais estao vazias. Docker esta instalado, mas o daemon Docker Desktop nao esta rodando.

3. Lint permanece com 11 warnings de `react-refresh/only-export-components`; nao sao erros de build.

## Correcoes Aplicadas

- Query builder:
  - Adicionado mapa central de tipos PostgreSQL por coluna.
  - `.in()` agora gera `ANY($n::uuid[])`, `ANY($n::text[])`, etc.
  - Colunas desconhecidas usam `IN ($n, ...)` em vez de `ANY($n)` sem tipo.
  - Relacoes aninhadas agora carregam arrays com cast explicito.

- Checkout:
  - Advisory lock com `hashtextextended($1::text, 0::bigint)`.
  - Input aceita `notes` e `reference`.
  - `order_items` persiste `notes`, `subtotal` e `options_total`.
  - `order_item_options` persiste `option_id`.

- Asaas/PIX:
  - Advisory locks com casts.
  - `getOrderPaymentInfo`/`syncPaymentStatus` aceitam `publicToken`.
  - Tracking e checkout enviam `publicToken` para operacoes publicas de PIX.
  - Sync e webhook validam divergencia de valor antes de marcar pagamento como pago.

- Webhook Asaas:
  - Mantida exigencia de secret em producao e comparacao segura.
  - Adicionada auditoria em `payment_events`.
  - Payload auditado e redigido.
  - Eventos sem payment/order local nao confirmam pedidos.
  - Valor divergente nao confirma pedido.

- Evolution API:
  - Adicionada configuracao `EVOLUTION_SENDER_PHONE`.
  - `.env` local foi atualizado para `EVOLUTION_SENDER_PHONE=11971582072`.
  - `.env.example` documenta o numero remetente `11971582072`.
  - Selecionador da instancia Evolution evita usar outra instancia conectada quando o telefone remetente esperado nao bate.

- Realtime:
  - `/api/backend` passa `request` ao stream.
  - Cliente envia `table`, `event` e `filter` para o SSE.
  - Servidor filtra por token publico/loja/admin antes de enviar eventos.
  - Payload publico de tracking fica redigido para status do pedido.

- Storage:
  - Buckets publicos e privados definidos.
  - Upload valida bucket, MIME/extensao, tamanho e escopo da loja.
  - Arquivos privados exigem autorizacao.
  - SVG nao e servido por padrao.

- Ambiente/deploy:
  - `.env` permanece ignorado.
  - `.gitignore` ignora `audit-logs/` e `test-results/`.
  - Validacao de runtime exige `PUBLIC_APP_URL`, `STORAGE_DIR`, banco e segredo forte em producao.
  - Healthcheck `/api/health` valida env, DB, migrations e storage.

## Migrations Criadas

- `db/migrations/20260521143000_production_hardening.sql`
  - Cria schema minimo funcional para backend proprio em banco limpo.
  - Garante `orders.public_token` com default `gen_random_uuid()::text`, backfill, `NOT NULL` e indice unico.
  - Garante idempotencia de checkout por `(store_id, customer_id, idempotency_key)`.
  - Garante colunas e constraints de `payments`.
  - Garante colunas financeiras de `order_items` e `option_id` em `order_item_options`.
  - Cria `payment_events`.
  - Cria RPCs publicas seguras por token.
  - Revoga grants perigosos de `anon`, se a role existir.

Scripts adicionados:

- `npm run db:migrate`
- `npm run db:check`

## Arquivos Alterados

- `.env.example`
- `.gitignore`
- `README.md`
- `package.json`
- `db/schema.sql`
- `db/migrations/20260521143000_production_hardening.sql`
- `scripts/migrate.mjs`
- `scripts/check-schema.mjs`
- `src/backend/db.ts`
- `src/backend/env.ts`
- `src/backend/query.ts`
- `src/backend/query.test.ts`
- `src/backend/realtime.ts`
- `src/backend/storage.ts`
- `src/backend/webhooks.ts`
- `src/backend/webhooks.test.ts`
- `src/functions/asaas.ts`
- `src/functions/evolution.server.ts`
- `src/integrations/backend/client.ts`
- `src/pages/public/OrderTracking.tsx`
- `src/pages/public/PublicCheckout.tsx`
- `src/routes/api/backend.ts`
- `src/routes/api/health.ts`
- `src/routes/storage/$.ts`
- `src/server/asaas.service.ts`
- `src/server/order.functions.ts`
- `src/server/order.functions.test.ts`

## Deploy na VPS

1. Fazer backup do banco.
2. Atualizar codigo na release em `/var/www/vexortech/current`.
3. Garantir `/etc/vexortech/vexortech.env` com:
   - `NODE_ENV=production`
   - `PUBLIC_APP_URL`
   - `DATABASE_URL` ou `POSTGRES_*`
   - `JWT_SECRET` forte
   - `STORAGE_DIR`
   - `ASAAS_WEBHOOK_SECRET`
   - `EVOLUTION_API_KEY`
   - `EVOLUTION_INSTANCE`
   - `EVOLUTION_SENDER_PHONE=11971582072`
4. Executar:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run db:migrate
npm run db:check
sudo systemctl restart vexortech
curl -f https://hypedelivery.com.br/api/health
```

## Rollback

1. Parar o servico.
2. Voltar o symlink `/var/www/vexortech/current` para a release anterior.
3. Restaurar backup do banco caso a migration ja tenha sido aplicada.
4. Reiniciar servico e validar `/api/health`.

## Riscos Remanescentes

- `db:migrate` e `db:check` precisam ser executados contra PostgreSQL real; nao foram validados localmente por ausencia de credenciais e Docker daemon parado.
- Algumas `createServerFn` financeiras ainda dependem de evolucao de autorizacao completa por actor/request em TanStack Start. As rotas publicas de PIX agora usam `publicToken`, mas refund/subscription ainda devem ser revisadas com contexto autenticado server-side.
- Auth ainda usa token em cliente; migracao para cookie `httpOnly`/reset token one-time-use permanece recomendada.
- Warnings de Fast Refresh continuam por arquivos que exportam componentes e constantes.
