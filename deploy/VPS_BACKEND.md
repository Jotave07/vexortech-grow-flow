# Hype Delivery na VPS

Este deploy roda a aplicacao na VPS com Supabase como backend unico:

- Banco PostgreSQL no Supabase.
- Auth no Supabase Auth, incluindo login por e-mail, Google e Apple.
- Recuperacao de conta pelo Supabase Auth.
- Storage no Supabase Storage.
- APIs de dominio, webhooks, realtime SSE e integracoes rodando no app Node da VPS.
- Nginx/systemd mantendo o dominio no ar.

Nao configure fallback de auth local, `JWT_SECRET` ou `STORAGE_DIR`.

## Variaveis de ambiente

Crie `/etc/vexortech/vexortech.env` baseado em `.env.example`.

Obrigatorias em producao:

```env
NODE_ENV=production
PORT=3000
PUBLIC_APP_URL=https://hypedelivery.com.br

DATABASE_URL=postgres://usuario:senha@host.supabase.co:5432/postgres
DATABASE_SSL_REJECT_UNAUTHORIZED=false

NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
SUPABASE_SECRET_KEY=sb_secret_xxx

GOOGLE_MAPS_API_KEY=
ASAAS_API_KEY=
ASAAS_ENVIRONMENT=production
NEXT_PUBLIC_ASAAS_ENVIRONMENT=production
ASAAS_WEBHOOK_SECRET=

EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE=
EVOLUTION_AUTOMATION_PHONE=
```

## Build e servico

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run db:migrate
npm run db:check
sudo cp deploy/vexortech.service /etc/systemd/system/vexortech.service
sudo systemctl daemon-reload
sudo systemctl enable --now vexortech
curl -f "$PUBLIC_APP_URL/api/health"
```

## Nginx

Use `deploy/nginx-vexortech.conf`. As rotas `/api/` precisam de `proxy_buffering off` para o realtime SSE. A rota `/storage/` permanece proxyada para o app, mas o app redireciona/serve arquivos a partir do Supabase Storage.
