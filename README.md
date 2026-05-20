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
npm run dev
npm run lint
npm run build
npm run start
```

## Ambiente

Copie `.env.example` para `.env` no desenvolvimento local. Em producao, a VPS usa `/etc/vexortech/vexortech.env`.
