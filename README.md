# Hype Delivery

Aplicacao de delivery com painel administrativo, painel do lojista, loja publica, checkout, acompanhamento de pedido, integracao Asaas, WhatsApp/Evolution, storage local e backend proprio em Node + PostgreSQL.

## Estrutura

- `src/backend`: autenticacao, consultas, RPCs, storage, realtime e webhooks.
- `src/integrations/backend`: cliente usado pelo frontend para auth, queries, storage, functions e realtime.
- `src/pages`: telas publicas, lojista, cliente e administrador.
- `src/routes`: rotas TanStack Start, APIs e storage.
- `deploy`: arquivos de systemd, Nginx e notas de deploy da VPS.
- `public` e `src/assets`: imagens e assets da aplicacao.

## Scripts

```bash
npm ci
npm run typecheck
npm run dev
npm run lint
npm test
npm run build
npm run db:migrate
npm run db:check
npm run start
```

## Ambiente

Copie `.env.example` para `.env` no desenvolvimento local. Em producao, a VPS usa `/etc/vexortech/vexortech.env`.

Variaveis criticas em producao:

- `DATABASE_URL` ou `POSTGRES_HOST`/`POSTGRES_DATABASE`/`POSTGRES_USER`/`POSTGRES_PASSWORD`
- `JWT_SECRET` forte, com pelo menos 32 caracteres
- `PUBLIC_APP_URL`
- `STORAGE_DIR`
- `ASAAS_WEBHOOK_SECRET`
- `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` e `EVOLUTION_AUTOMATION_PHONE` quando Evolution estiver ativo

## Deploy Seguro

1. Atualize o codigo na VPS em `/var/www/vexortech/current` ou mantenha esse caminho como symlink para a release ativa.
2. Configure `/etc/vexortech/vexortech.env` sem versionar secrets.
3. Execute:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run db:migrate
npm run db:check
sudo systemctl restart vexortech
curl -f "$PUBLIC_APP_URL/api/health"
```

Rollback: volte o symlink `/var/www/vexortech/current` para a release anterior, restaure o backup do banco se a migration ja tiver sido aplicada, rode `npm run db:check` e reinicie o servico.
