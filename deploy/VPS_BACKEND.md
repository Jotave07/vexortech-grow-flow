# Hype Delivery na VPS e no Supabase

A topologia de producao mantem a interface no dominio da Hype e usa o Supabase
como backend gerenciado:

- o Node em `127.0.0.1:3000` entrega `dist/`, responde `/api/health` e permanece
  pronto como fallback do BFF;
- o Nginx termina TLS e encaminha somente `/api/backend`,
  `/api/webhooks/asaas` e `/storage/` para Supabase Edge Functions;
- `hype-api` executa o BFF compartilhado, inclusive Auth, consultas, funcoes de
  dominio e acesso ao Supabase Storage;
- `asaas-webhook` executa o mesmo handler idempotente de webhook;
- PostgreSQL, Auth, Storage e Broadcast privado de pedidos ficam no projeto
  Supabase `sjzdvlqnhhgbqdsvwiqt`;
- o navegador recebe apenas HTML, CSS e JavaScript nativos. Ele conhece somente a
  URL e a chave publicavel do Supabase; chaves secretas nunca entram no build.

O contrato do navegador continua same-origin. Cookies de sessao permanecem
`HttpOnly`, `Secure`, `SameSite=Lax` e `Path=/`; o Nginx preserva cookies, query
string, corpo, metodo e `Set-Cookie` ao chamar a Edge Function.

## Ambientes protegidos

O Node usa `/etc/vexortech/vexortech.env` (`root:www-data`, `0640`), baseado em
`.env.example`. Em producao ele precisa, no minimo:

```env
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
PUBLIC_APP_URL=https://hypedelivery.com.br
PARTNER_APP_URL=https://parceiros.hypedelivery.com.br
APP_ALLOWED_ORIGINS=https://hypedelivery.com.br,https://www.hypedelivery.com.br,https://parceiros.hypedelivery.com.br
AUTH_FLOW_SECRET=valor-aleatorio-com-pelo-menos-32-caracteres
TRUSTED_PROXY_IPS=127.0.0.1,::1

DATABASE_URL=postgres://vexortech_runtime:SENHA@HOST:PORT/postgres
DATABASE_RUNTIME_ROLE=vexortech_runtime
DATABASE_SSL_ROOT_CERT=/etc/vexortech/supabase-root-2021.crt
DATABASE_SSL_REJECT_UNAUTHORIZED=true

NEXT_PUBLIC_SUPABASE_URL=https://sjzdvlqnhhgbqdsvwiqt.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
SUPABASE_SECRET_KEY=REPLACE_WITH_SUPABASE_SECRET_KEY

GOOGLE_MAPS_API_KEY=
ASAAS_API_KEY=
ASAAS_ENVIRONMENT=production
ASAAS_WEBHOOK_SECRET=

EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE=
EVOLUTION_AUTOMATION_PHONE=
```

O Node persistente usa conexao direta quando houver IPv6 ou o pooler de sessao
quando for preciso IPv4. A Edge Function usa uma `DATABASE_URL` separada, no
Supavisor transaction pooler, sempre com a role restrita `vexortech_runtime`.
Nunca use a URL privilegiada disponibilizada por padrao na Edge.

`EDGE_PROXY_SECRET` e configurado somente como secret da Edge e no snippet Nginx
`root:root:0600`. O runbook gera um env-file temporario em `/run`, envia os secrets
com a CLI e o remove ao sair. Nao grave esse segredo em `vexortech.env`, no
frontend, no Git ou em argumento de processo.

Baixe o CA do banco pelo painel Supabase, valide a origem e instale-o em
`/etc/vexortech/supabase-root-2021.crt` com dono `root:www-data` e modo `0640`.
Esse caminho e usado somente pelo Node e pelos runners da VPS; a Edge hospedada
usa o trust store do runtime.

## Nginx e corte reversivel

O virtual host versionado inclui, em cada host HTTPS da aplicacao:

```nginx
include /etc/nginx/snippets/hype-backend-active.conf;
```

Esse caminho e um symlink atomico para um destes arquivos `root:root:0600`:

- `hype-backend-node.conf`: fallback em `127.0.0.1:3000`;
- `hype-backend-edge.conf`: SNI/Host exatos do projeto Supabase e header privado
  de proxy.

O fallback Node continua ativo durante deploy e canarios. O corte muda apenas o
symlink, executa `nginx -t` e recarrega o Nginx; rollback aponta o symlink de volta
ao Node. `/api/health`, assets e documentos HTML nunca passam pela Edge.

`X-Hype-Client-Ip` recebe somente `$remote_addr`, autenticado pelo segredo entre
Nginx e Edge. Nao confie em `X-Forwarded-For` enviado pelo cliente. Se um CDN for
adicionado, configure `set_real_ip_from` apenas com os CIDRs oficiais desse CDN
antes de usar seu header de IP; sem essa allowlist, mantenha `$remote_addr`.

O CSP permite apenas os endpoints HTTPS/WSS exatos do projeto. Supabase Realtime
deve estar com `private_only=true`; o painel de pedidos recebe somente eventos de
invalidacao em canal privado e refaz a leitura autenticada. O polling/SSE do Node
permanece como degradacao segura.

## Procedimento autorizado

Use exclusivamente o [runbook de deploy](../DEPLOY_RUNBOOK.md). Ele exige HEAD
limpo e commitado, artefato pelo SHA, backup verificavel, migrations pelo runner
existente, schema check, Functions e secrets versionados, gate do Realtime,
canarios diretos, blue/green do Node, corte Edge e rollback. A existencia destes
arquivos no repositorio nao comprova que esse corte ja ocorreu em producao.

Os detalhes do handler e dos secrets estao em
[`supabase/EDGE_MIGRATION.md`](../supabase/EDGE_MIGRATION.md).
