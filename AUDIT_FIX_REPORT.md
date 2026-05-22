# AUDIT_FIX_REPORT

Data: 2026-05-22
Branch: `fix/orders-delivery-evolution-sql-production`
Release implantada: `20260522100034`
Status: PRODUCAO BLOQUEADA PARA APROVACAO PLENA

## 1. Problemas Encontrados

- P0: funcoes publicas de assinatura/Asaas permitiam tentativa de checkout ou teste de gateway sem contexto autenticado de dono/admin.
- P0: cadastro publico aceitava metadados de papel/conta, permitindo tentativa de escalacao de perfil.
- P0: usuario com papel `admin` em escopo de loja podia ser tratado como admin global em alguns fluxos.
- P0: API generica de query permitia mutacoes operacionais/financeiras por usuarios nao-admin em tabelas sensiveis.
- P0: logs do Asaas podiam registrar dados excessivos de request/resposta quando debugado.
- P1: tela de pedidos precisava manter historico consultavel com intervalo personalizado e filtros de status/busca.
- P1: configuracao do parceiro ainda mantinha vestigio de regra financeira de frete no payload de salvamento.
- P1: migration duplicada fora da pasta oficial podia confundir auditoria e testes de schema.
- Risco de producao: testes automatizados e smoke foram aprovados, mas ainda nao houve transacao Asaas real/sandbox nem envio Evolution real controlado neste ciclo.

## 2. Arquivos Alterados

- `.env.example`
- `AUDIT_FIX_REPORT.md`
- `DEPLOY_RUNBOOK.md`
- `src/backend/auth.ts`
- `src/backend/auth-security.test.ts`
- `src/backend/functions.ts`
- `src/backend/query.ts`
- `src/functions/asaas.ts`
- `src/lib/auth/roles.ts`
- `src/pages/lojista/Orders.tsx`
- `src/pages/lojista/Settings.tsx`
- `src/pages/lojista/Subscription.tsx`
- `src/server/asaas.server.ts`
- `src/server/order-security-migration.test.ts`
- `src/server/subscription.service.ts`
- `src/server/subscription.service.test.ts`
- `src/services/subscription-billing.ts`

Arquivo removido:

- `migrations/20260521123000_secure_checkout_orders_payments.sql`

## 3. Migrations Criadas ou Validadas

- Nenhuma migration nova foi criada neste ciclo.
- Foram validadas no banco remoto as migrations oficiais em `db/migrations`.
- A migration oficial mais recente aplicada e validada foi `20260521190000`.
- A migration obsoleta fora da pasta oficial `migrations/20260521123000_secure_checkout_orders_payments.sql` foi removida para evitar divergencia de auditoria.

Itens conferidos por `db:check`:

- `orders.public_token`, default e indice unico.
- Indices de idempotencia de pedidos e pagamentos.
- Colunas de frete, distancia, estimativa e regiao em `orders`.
- Colunas de regras de entrega em `delivery_zones`.
- Tabela `notification_events` e indice unico de idempotencia.
- RPCs publicas e colunas financeiras de itens.

## 4. Comandos Executados

Local:

- `npm ci` => aprovado, 0 vulnerabilidades.
- `npm run typecheck` => aprovado.
- `npm run lint` => aprovado com 11 warnings antigos de Fast Refresh.
- `npm test` => aprovado, 14 arquivos e 45 testes.
- `npm run build` => aprovado.
- `npm run e2e` => aprovado, 22 testes Playwright.
- `npm audit` => aprovado, 0 vulnerabilidades.
- `rg --pcre2 "ANY\(\$[0-9]+\)(?!::)|hashtextextended\(\$[0-9]+,\s*0\)" src/backend src/server src/functions` => sem ocorrencias.
- `git ls-files .env` => sem resultado; `.env` nao esta versionado.

Local sem variavel de banco:

- `npm run db:migrate` => bloqueado localmente por `DATABASE_URL` vazio no `.env` local.
- `npm run db:check` => bloqueado localmente por `DATABASE_URL` vazio no `.env` local.

Remoto na VPS:

- Backup criado antes do deploy em `/var/www/vexortech/backups/backup-before-20260522100034.sql`.
- `npm ci --include=dev` => aprovado.
- `npm run typecheck` => aprovado.
- `npm run lint` => aprovado com 11 warnings antigos de Fast Refresh.
- `npm test` => aprovado, 14 arquivos e 45 testes.
- `npm run build` => aprovado.
- `npm run db:migrate` => aprovado.
- `npm run db:check` => aprovado.
- `npm prune --omit=dev` => aprovado.
- `systemctl restart vexortech` => aprovado.
- `curl https://hypedelivery.com.br/api/health` => aprovado.

Smoke test real em producao:

- Playwright headless em `https://hypedelivery.com.br`.
- Viewports: 390x844 e 1366x768.
- Rotas: `/`, `/lojas`, `/entrar`, `/cadastrar`, `/recuperar-senha`, `/lojista/entrar`, `/admin/entrar`, `/pedido/token-inexistente`, `/loja/slug-inexistente`.
- Resultado: HTTP 200, conteudo visivel, sem erros de console/pagina e sem overflow horizontal nas rotas testadas.

## 5. Resultado dos Comandos

- Typecheck: aprovado local e remoto.
- Lint: aprovado local e remoto, com warnings nao bloqueantes de Fast Refresh.
- Testes unitarios/integracao: aprovados local e remoto.
- E2E local: aprovado.
- Build: aprovado local e remoto.
- Migrations remotas: aprovadas.
- Schema remoto: aprovado.
- Healthcheck remoto e publico: aprovado.
- Smoke publico real: aprovado nas rotas testadas.

## 6. Como o Erro $1 Foi Eliminado

- `src/backend/query.ts` ja usa mapa central `columnTypes` com tipos PostgreSQL por tabela/coluna.
- Filtros `.in()` geram `ANY($n::<tipo>[])`, como `uuid[]`, `text[]`, `integer[]`, `numeric[]` ou `boolean[]`.
- Relacoes aninhadas usam cast explicito no `ANY`.
- Colunas nao mapeadas falham com erro claro em vez de SQL ambiguo.
- Advisory locks usam `hashtextextended($1::text, 0::bigint)`.
- A varredura final nao encontrou `ANY($n)` sem cast nem `hashtextextended($1, 0)`.

## 7. Como a Tela de Pedidos Foi Corrigida

- O kanban operacional permanece restrito aos status em movimento.
- Pedidos `entregue`, `cancelado` e `estornado` ficam fora do quadro principal.
- O historico possui filtros de periodo, incluindo hoje, ultimos 7 dias, ultimos 30 dias e intervalo personalizado.
- O historico mantem filtros de status e busca por cliente/numero.
- Atualizacao de status segue via funcao server-side `update-order-status`, mantendo validacao, historico e notificacoes no servidor.

## 8. Como o Frete Foi Corrigido

- A configuracao do parceiro salva somente entrega/retirada, endereco, coordenadas e `delivery_radius_km`.
- O payload de `Settings.tsx` nao salva mais `min_order_value` como regra de frete do cadastro.
- A tela informa que valores de frete ficam na aba Entregas.
- O checkout usa quote server-side e o pedido grava frete final, regiao, distancia, estimativas e referencia.

## 9. Como a Evolution Foi Corrigida

- As configuracoes de Evolution sao lidas de variaveis de ambiente.
- Telefone de automacao e URL publica nao ficam hardcoded no codigo.
- Notificacoes de novo pedido/status usam destinatarios de cadastro.
- `notification_events` garante idempotencia dos envios.
- Ainda falta executar um envio real controlado em producao ou sandbox oficial para aprovacao plena.

## 10. Correcoes de Seguranca Adicionais

- `create-subscription-checkout` agora e uma server function autenticada.
- A criacao de assinatura valida dono da loja ou admin global antes de chamar Asaas.
- `test-payment-gateway` exige usuario autenticado e dono/admin.
- Funcoes publicas antigas de assinatura/teste Asaas foram desativadas com erro explicito.
- Cadastro publico sanitiza metadados e forca papel de cliente.
- Admin global agora depende de perfil/papel sem `store_id` ou lista `ADMIN_EMAILS`; papel admin de loja nao vira admin de plataforma.
- API generica bloqueia escalacao de papel e mutacoes sensiveis em tabelas financeiras/operacionais para nao-admin.
- Logs do Asaas foram reduzidos e redigidos; debug detalhado depende de `PAYMENT_GATEWAY_DEBUG`.

## 11. Instrucoes de Deploy

1. Fazer backup antes de aplicar:

```bash
pg_dump "$DATABASE_URL" > backup-before-fix-$(date +%Y%m%d-%H%M%S).sql
```

2. Configurar variaveis no ambiente da VPS, sem versionar secrets:

```bash
DATABASE_URL=...
PUBLIC_APP_URL=...
JWT_SECRET=...
ADMIN_EMAILS=...
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

3. Validar e publicar:

```bash
npm ci --include=dev
npm run typecheck
npm run lint
npm test
npm run build
npm run db:migrate
npm run db:check
npm prune --omit=dev
sudo systemctl restart vexortech
sudo systemctl status vexortech --no-pager
journalctl -u vexortech -n 200 --no-pager
curl -f "$PUBLIC_APP_URL/api/health"
```

Detalhes adicionais estao em `DEPLOY_RUNBOOK.md`.

## 12. Instrucoes de Rollback

1. Voltar o symlink/release ativa para a versao anterior.
2. Reiniciar o servico.
3. Validar `systemctl status vexortech --no-pager`.
4. Validar `curl -f "$PUBLIC_APP_URL/api/health"`.
5. Se houver necessidade de voltar dados, restaurar o backup criado antes do deploy:

```bash
psql "$DATABASE_URL" < backup-before-fix-YYYYMMDD-HHMMSS.sql
```

As migrations validadas sao majoritariamente idempotentes e aditivas. Em rollback comum, voltar codigo e reiniciar deve ser suficiente; restaure banco apenas se a analise exigir.

## 13. Riscos Remanescentes

- PRODUCAO BLOQUEADA para aprovacao plena porque nao foi executado pedido real com cobranca Asaas em sandbox/producao controlada.
- PRODUCAO BLOQUEADA para aprovacao plena porque nao foi executado envio real Evolution para loja/cliente neste ciclo.
- PRODUCAO BLOQUEADA para aprovacao plena porque nao houve teste manual autenticado completo com usuarios reais de loja, admin e cliente apos deploy.
- `lint` ainda mostra 11 warnings antigos de Fast Refresh, sem falha.
- O build ainda mostra warnings conhecidos de diretivas `"use client"` de bibliotecas terceiras.
- Recomenda-se rotacionar todas as credenciais compartilhadas durante o atendimento.

## 14. Validacao Real do Carrinho e Erro `$1` em Producao

Data/hora: 2026-05-22, apos deploy da release `20260522100034`.

Objetivo:

- Reproduzir no site em producao o erro `could not determine data type of parameter $1` ao enviar pedido pelo carrinho.
- Confirmar gravacao real em `orders`, `order_items` e `order_status_history`.

Testes executados:

- API real de checkout com retirada/dinheiro.
- API real de checkout com entrega/dinheiro, quote de frete, regiao, distancia e taxa.
- UI real em producao com carrinho, retirada/dinheiro, envio e tracking.
- UI real em producao com carrinho, entrega/dinheiro, quote de frete, envio e tracking.
- UI real em producao com carrinho contendo multiplos produtos, retirada/dinheiro, envio e tracking.
- Consulta direta no banco de producao confirmando pedidos, itens e historico.
- Busca em logs do servico por `could not determine data type` e `parameter $1`.
- Testes automatizados focados: `npm test -- src/backend/query.test.ts src/server/order.functions.test.ts src/server/order-security-migration.test.ts`.

Resultado:

- Nao foi possivel reproduzir o erro `$1` na release atual.
- Todos os envios reais testados gravaram pedido corretamente.
- O fluxo com multiplos produtos executou as validacoes de carrinho com `.in(...)` e gravou itens corretamente.
- Logs recentes do servico nao registraram `could not determine data type of parameter $1`.
- Pedidos teste foram marcados como `cancelado` apos a validacao para nao poluir a tela operacional, mantendo historico de auditoria.
- Healthcheck publico apos os testes: aprovado.

Evidencia objetiva:

- 5 pedidos teste foram criados e validados no banco durante a investigacao.
- Os 5 pedidos teste possuem registros em `order_items`.
- Os 5 pedidos teste possuem historico inicial `novo`.
- Apos limpeza operacional, os 5 pedidos teste ficaram em `cancelado`.
- Contagem de pedidos teste restantes em status operacional: 0.
- Vitest focado: 3 arquivos, 11 testes passando.
