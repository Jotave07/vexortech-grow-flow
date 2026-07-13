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
PARTNER_APP_URL=https://parceiros.hypedelivery.com.br
APP_ALLOWED_ORIGINS=https://hypedelivery.com.br,https://www.hypedelivery.com.br,https://parceiros.hypedelivery.com.br
AUTH_FLOW_SECRET=gere-um-segredo-aleatorio-com-pelo-menos-32-caracteres
HOST=127.0.0.1
TRUSTED_PROXY_IPS=127.0.0.1,::1

DATABASE_URL=postgres://usuario:senha@host.supabase.co:5432/postgres
DATABASE_SSL_ROOT_CERT=/etc/vexortech/supabase-root-2021.crt
DATABASE_SSL_REJECT_UNAUTHORIZED=true

NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
SUPABASE_SECRET_KEY=REPLACE_WITH_SUPABASE_SECRET_KEY

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

Baixe o CA do projeto pelo painel Supabase, valide a origem e instale-o em
`/etc/vexortech/supabase-root-2021.crt` com dono `root:www-data` e modo `0640`.
Use o mesmo caminho no ambiente de migration. Quando `DATABASE_SSL_ROOT_CERT`
esta definido, a aplicacao força `sslmode=verify-full`; nao combine essa opcao
com `DATABASE_SSL_REJECT_UNAUTHORIZED=false`.

## Build, migration e servico

O unico procedimento autorizado e o [runbook de deploy](../DEPLOY_RUNBOOK.md). Ele
exige gate local, artefato versionado, backup verificavel, migration antes do corte,
candidata em `127.0.0.1:3101`, troca blue/green e rollback automatico. Nao execute
`db:migrate`, nao sobrescreva a unit e nao reinicie o servico fora dessa sequencia.

## Nginx

Use `deploy/nginx-vexortech.conf`. As rotas `/api/` precisam de `proxy_buffering off` para o realtime SSE. A rota `/storage/` permanece proxyada para o app, mas o app redireciona/serve arquivos a partir do Supabase Storage.
