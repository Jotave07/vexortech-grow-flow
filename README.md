# Hype Delivery

Aplicacao de delivery com painel administrativo, painel do lojista, loja publica, checkout, acompanhamento de pedido, integracao Asaas, WhatsApp/Evolution e backend de dominio em Node conectado ao Supabase/PostgreSQL.

## Estrutura

- `src/backend`: consultas seguras, RPCs, storage, realtime, webhooks e funcoes de dominio.
- `src/integrations/supabase`: cliente Supabase Auth/Storage usado quando as variaveis Supabase estao configuradas.
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

- `DATABASE_URL` apontando para o PostgreSQL/Supabase, ou `POSTGRES_HOST`/`POSTGRES_DATABASE`/`POSTGRES_USER`/`POSTGRES_PASSWORD`
- `DATABASE_SSL_REJECT_UNAUTHORIZED=false` apenas quando o ambiente exigir conexao SSL com CA nao confiavel localmente
- `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` para login e sessao no navegador
- `SUPABASE_SECRET_KEY` no servidor para validar usuarios, criar usuarios administrativos e enviar storage para Supabase
- `JWT_SECRET` forte apenas quando o fallback de autenticacao local estiver ativo
- `PUBLIC_APP_URL`
- `STORAGE_DIR` apenas se storage local for usado; com `SUPABASE_SECRET_KEY`, uploads de buckets publicos usam Supabase Storage
- `GOOGLE_MAPS_API_KEY` para geocoding e distancia de entrega no servidor
- `ASAAS_WEBHOOK_SECRET`
- `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` e `EVOLUTION_AUTOMATION_PHONE` quando Evolution estiver ativo

## Deploy Seguro

Antes do primeiro deploy com Supabase Auth, habilite os provedores Google e Apple no dashboard do Supabase e cadastre as URLs de redirecionamento do dominio:

- `https://seudominio.com.br/entrar`
- `https://seudominio.com.br/lojista`
- `https://seudominio.com.br/onboarding`
- `https://seudominio.com.br/redefinir-senha`

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
