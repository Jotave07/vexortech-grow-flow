# Hype Delivery na VPS

Este deploy roda a aplicacao inteira na VPS com:

- Auth proprio em `auth.users`
- PostgreSQL direto pelo backend Node
- Storage local em `STORAGE_DIR`
- Realtime por Server-Sent Events em `/api/backend?stream=realtime`
- RPCs publicas recriadas como funcoes SQL
- Functions administrativas em `/api/backend`

## Variaveis de ambiente

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

## Build e servico

```bash
npm ci
npm run build
sudo cp deploy/vexortech.service /etc/systemd/system/vexortech.service
sudo systemctl daemon-reload
sudo systemctl enable --now vexortech
```

## Nginx

Use `deploy/nginx-vexortech.conf`. As rotas `/api/` precisam de `proxy_buffering off` para o realtime SSE, e `/storage/` precisa aceitar upload de imagens.
