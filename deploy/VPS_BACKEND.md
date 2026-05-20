# Hype Delivery sem Supabase

Este deploy roda a aplicacao inteira na VPS com:

- Auth proprio em `auth.users`
- PostgreSQL direto pelo backend Node
- Storage local em `STORAGE_DIR`
- Realtime por Server-Sent Events em `/api/backend?stream=realtime`
- RPCs publicas recriadas como funcoes SQL
- Functions administrativas em `/api/backend`

## 1. Variaveis de ambiente

Crie `/etc/vexortech/vexortech.env` baseado em `.env.example`.

Obrigatorias:

```env
NODE_ENV=production
PORT=3000
PUBLIC_APP_URL=https://hypedelivery.com.br
DATABASE_URL=postgres://usuario:senha@host:5432/hype_delivery
JWT_SECRET=gere-um-segredo-longo
STORAGE_DIR=/var/www/vexortech-grow-flow/storage
```

## 2. Banco

No primeiro deploy:

```bash
npm ci
npm run db:bootstrap
```

Para importar dados publicos do projeto antigo uma unica vez, preencha temporariamente as variaveis antigas de Supabase no `.env` local e rode:

```bash
npm run db:migrate-from-supabase
```

Observacao: senhas do Supabase Auth nao sao exportaveis pelo anon key. Usuarios migrados sem acesso direto ao banco de auth antigo precisam redefinir senha pelo fluxo de recuperacao, com SMTP configurado.

## 3. Build e servico

```bash
npm run build
sudo cp deploy/vexortech.service /etc/systemd/system/vexortech.service
sudo systemctl daemon-reload
sudo systemctl enable --now vexortech
```

## 4. Nginx

Use `deploy/nginx-vexortech.conf`. As rotas `/api/` precisam de `proxy_buffering off` para o realtime SSE, e `/storage/` precisa aceitar upload de imagens.
