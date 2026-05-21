# AUDIT_FIX_REPORT

Data: 2026-05-21
Branch: `fix/orders-delivery-evolution-sql-production`

## 1. Problemas Encontrados

- Query builder gerava `ANY($n)` sem cast em filtros `.in()` e carregamento de relacoes, causando risco direto do erro PostgreSQL `could not determine data type of parameter $1`.
- Advisory locks usavam `hashtextextended($1, 0)` sem tipagem explicita.
- Tela operacional misturava pedidos em andamento com `entregue`, `cancelado` e `estornado`, e a rolagem horizontal ficava presa ao fim da pagina.
- Configuracao do parceiro misturava localizacao/raio com precificacao de frete.
- Checkout e frontend tinham caminhos de calculo de frete separados do servidor.
- Evolution usava configuracao insuficiente para ambiente de producao, sem idempotencia central para notificacoes.
- Funcoes financeiras publicas ainda aceitavam operacoes sensiveis sem `publicToken` ou sem contexto autenticado.
- Schema existente nao garantia todas as colunas/indices para frete, token publico, status operacional e notificacoes.

## 2. Arquivos Alterados

- `.env.example`
- `README.md`
- `DEPLOY_RUNBOOK.md`
- `scripts/check-schema.mjs`
- `src/backend/env.ts`
- `src/backend/functions.ts`
- `src/backend/query.ts`
- `src/backend/query.test.ts`
- `src/functions/asaas.ts`
- `src/functions/evolution.ts`
- `src/functions/evolution.server.ts`
- `src/integrations/backend/types.ts`
- `src/lib/delivery.ts`
- `src/pages/lojista/Orders.tsx`
- `src/pages/lojista/Settings.tsx`
- `src/pages/lojista/Zones.tsx`
- `src/pages/public/PublicCheckout.tsx`
- `src/routes/api/health.ts`
- `src/server/asaas.service.ts`
- `src/server/asaas.service.test.ts`
- `src/server/delivery.service.ts`
- `src/server/delivery.service.test.ts`
- `src/server/order-status.service.ts`
- `src/server/order.functions.ts`
- `src/server/order.functions.test.ts`
- `src/server/payment-gateways.ts`
- `src/services/delivery/deliveryQuoteService.ts`

## 3. Migrations Criadas

- `db/migrations/20260521180000_generic_pix_gateway.sql`
- `db/migrations/20260521190000_orders_delivery_evolution.sql`

A migration de frete/pedidos/Evolution garante, de forma idempotente:

- `store_settings.delivery_radius_km`
- coordenadas e campos de endereco em `stores`
- colunas de regiao, valores, tempo e prioridade em `delivery_zones`
- token publico, idempotencia, regiao, distancia, estimativas e timestamps operacionais em `orders`
- indices de busca operacional, regioes e idempotencia
- tabela `notification_events` com indice unico para evitar notificacoes duplicadas

## 4. Comandos Executados

Baseline antes das correcoes:

- `npm ci` => ok
- `npm run typecheck` => ok
- `npm run lint` => ok, com 11 warnings preexistentes de Fast Refresh
- `npm test` => ok
- `npm run build` => ok

Validacao final:

- `npm run typecheck` => ok
- `npm run lint` => ok, com 11 warnings preexistentes de Fast Refresh
- `npm test` => ok, 12 arquivos e 38 testes passando
- `npm run build` => ok
- `npm run db:migrate` => primeira tentativa local falhou sem `DATABASE_URL`; executado depois via tunel SSH para o Postgres interno do VPS => ok
- `npm run db:check` => executado via tunel SSH para o Postgres interno do VPS => ok

Varreduras:

- `rg --pcre2 "ANY\(\$[0-9]+\)(?!::)|hashtextextended\(\$[0-9]+,\s*0\)" src/backend src/server src/functions` => sem ocorrencias
- `git ls-files .env` => sem resultado; `.env` nao esta versionado
- Varredura de URL/telefone/token/senha sensivel em codigo e docs versionados => limpa apos remocao de residuos antigos

## 5. Resultado dos Comandos

- Typecheck: aprovado.
- Lint: aprovado, mantendo apenas warnings historicos de Fast Refresh.
- Testes: aprovados.
- Build: aprovado.
- Migrations: aprovadas no banco remoto via tunel SSH.
- Schema check: aprovado, incluindo `public_token`, indices de pagamento/idempotencia, colunas de frete e tabela de notificacoes.

## 6. Como o Erro $1 Foi Eliminado

- `src/backend/query.ts` agora possui mapa central `columnTypes` com tipos PostgreSQL por tabela/coluna.
- `.in()` gera sempre `ANY($n::<tipo>[])`, como `uuid[]`, `text[]`, `integer[]`, `numeric[]` ou `boolean[]`.
- Relacoes aninhadas usam o tipo da chave local para gerar `WHERE foreign = ANY($1::<tipo>[])`.
- Colunas nao mapeadas geram erro claro em vez de SQL ambiguo.
- Advisory locks foram corrigidos para `hashtextextended($1::text, 0::bigint)`.

## 7. Como a Tela de Pedidos Foi Corrigida

- O kanban principal busca somente status operacionais: `aguardando_pagamento`, `novo`, `confirmado`, `em_preparo`, `saiu_para_entrega`, `pronto_para_retirada`.
- `entregue`, `cancelado` e `estornado` foram removidos do kanban e enviados para Historico.
- Historico lista finais com periodo, status, busca e paginacao de 25 itens.
- O quadro usa altura baseada no viewport, rolagem horizontal propria e colunas com rolagem vertical independente.
- Atualizacao de status saiu do frontend direto para a funcao server-side `update-order-status`.
- Realtime atualiza estado local sem reload completo e remove do kanban pedidos finalizados.

## 8. Como o Frete Foi Corrigido

- `Settings.tsx` ficou restrito a entrega/retirada, endereco, coordenadas, geocodificacao e raio global `delivery_radius_km`.
- Precificacao e regras foram movidas para a aba Entregas (`Zones.tsx`).
- Criado `src/server/delivery.service.ts` como fonte unica de quote server-side.
- Checkout chama `quote-delivery`, valida endereco e recalcula o frete no servidor antes de criar pedido.
- Pedido salva `delivery_region_id`, `delivery_fee`, `distance_km`, `delivery_source`, `estimated_min`, `estimated_max` e `delivery_reference`.
- Testes cobrem raio, regiao, bairro, taxa fixa/por km, min/max fee, pedido minimo e endereco invalido.

## 9. Como a Evolution Foi Corrigida

- Configuracao vem de env: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `EVOLUTION_AUTOMATION_PHONE`, `EVOLUTION_SEND_CUSTOMER_CONFIRMATION` e `PUBLIC_APP_URL`.
- Removido uso de telefone/URL hardcoded em codigo versionado.
- Novo pedido notifica a loja com cliente, itens, totais, entrega/retirada, endereco e link.
- Cliente recebe confirmacao em producao ou quando `EVOLUTION_SEND_CUSTOMER_CONFIRMATION=true`.
- Mudancas para `saiu_para_entrega` e `pronto_para_retirada` notificam o cliente.
- `notification_events` torna os envios idempotentes por provider, evento, pedido e telefone.

## 10. Instrucoes de Deploy

1. Fazer backup antes de aplicar:

```bash
pg_dump "$DATABASE_URL" > backup-before-fix-$(date +%Y%m%d-%H%M%S).sql
```

2. Configurar variaveis no ambiente da VPS, sem versionar secrets:

```bash
DATABASE_URL=...
PUBLIC_APP_URL=...
JWT_SECRET=...
ASAAS_API_KEY=...
ASAAS_WEBHOOK_SECRET=...
ASAAS_ENVIRONMENT=production
EVOLUTION_API_URL=...
EVOLUTION_API_KEY=...
EVOLUTION_INSTANCE=...
EVOLUTION_AUTOMATION_PHONE=...
EVOLUTION_SEND_CUSTOMER_CONFIRMATION=true
STORAGE_DIR=...
NODE_ENV=production
```

3. Rodar:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run db:migrate
npm run db:check
sudo systemctl restart vexortech
sudo systemctl status vexortech --no-pager
journalctl -u vexortech -n 200 --no-pager
curl -f "$PUBLIC_APP_URL/api/health"
```

Detalhes adicionais estao em `DEPLOY_RUNBOOK.md`.

## 11. Instrucoes de Rollback

1. Apontar a release ativa para a versao anterior ou fazer checkout do commit anterior.
2. Reiniciar o servico anterior.
3. Se necessario por compatibilidade de schema, restaurar o backup:

```bash
psql "$DATABASE_URL" < backup-before-fix-YYYYMMDD-HHMMSS.sql
```

4. Rodar `npm run db:check` e validar `/api/health`.

As migrations novas sao majoritariamente `ADD COLUMN IF NOT EXISTS`/indices idempotentes, entao rollback de codigo normalmente e suficiente; restaure banco apenas se precisar voltar dados/schema.

## 12. Riscos Remanescentes

- O teste de checkout foi coberto por suite automatizada do servidor; nao criei pedido real em producao para evitar efeito financeiro/notificacao real.
- `lint` permanece com 11 warnings antigos de Fast Refresh, sem erro.
- Estorno PIX pago em cancelamento fica marcado para fluxo seguro/auditoria quando nao for possivel estornar automaticamente.
- Apos deploy, validar manualmente um pedido real de baixo valor com Evolution e Asaas em ambiente controlado.
- As credenciais compartilhadas durante atendimento devem ser rotacionadas fora do repositorio.
