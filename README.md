# Hype Delivery

Plataforma de delivery com loja pública, carrinho, checkout, acompanhamento de pedido, painel do lojista e painel administrativo. O frontend entregue ao navegador é composto somente por HTML semântico, CSS e módulos JavaScript nativos. React, TanStack, Tailwind, Radix e as demais bibliotecas de interface do legado não fazem parte do runtime final.

O servidor Node centraliza autenticação, autorização, consultas, uploads, realtime, webhooks e integrações. PostgreSQL/Supabase é a origem de dados; Supabase Auth e Storage continuam sendo usados por adaptadores server-side, com Asaas, Evolution e Google Maps habilitados por configuração.

## Estado da modernização

Revisão deste estado: **2026-07-13**.

- Runtime do navegador sem framework e sem dependências externas de componentes.
- 46 padrões de rota endereçáveis, além do fallback `404`, preservados em módulos públicos, de autenticação, lojista, administrador e cliente.
- Dependências de produção reduzidas de 64 para 2: `pg` e `zod`.
- Legado e resíduos inventariados antes da remoção e preservados em quarentena local verificável.
- O gate consolidado atual aprovou typecheck, lint, build, 320/320 testes em 33 arquivos e 104/104 cenários E2E em Chromium, Chrome, Firefox e WebKit.
- Os números históricos de 192 testes unitários e 26 cenários E2E pertencem ao snapshot de 2026-07-10 e não substituem a evidência atual.
- A revisão documental de 2026-07-13 não afirma que migrations foram aplicadas no banco remoto, que integrações reais foram homologadas ou que o deploy atual já ocorreu.

Consulte o [relatório completo da modernização](docs/MODERNIZATION_REPORT.md), o [relatório consolidado de testes](docs/TEST_REPORT.md) e o [runbook de deploy](DEPLOY_RUNBOOK.md).

## Requisitos

- Node.js `>= 22.12.0`.
- npm compatível com o `package-lock.json`.
- PostgreSQL acessível, preferencialmente o banco do projeto Supabase.
- Variáveis de ambiente descritas em `.env.example`.

## Instalação e validação

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Para executar o gate E2E completo, incluindo o build usado pelo Playwright:

```bash
npm run e2e
```

O build gera:

- `dist/`: HTML, CSS, JavaScript e assets do navegador.
- `.output/server/vanilla-server.js`: servidor Node compilado.

Para iniciar com variáveis já exportadas no shell:

```bash
npm start
```

Para desenvolvimento local usando um arquivo `.env`, use o suporte nativo do Node:

```bash
npm run build
node --env-file=.env .output/server/vanilla-server.js
```

O servidor escuta `PORT=3000` por padrão. Em produção, mantenha `HOST=127.0.0.1` e publique a aplicação por Nginx.

> O servidor da aplicação não carrega `.env` por conta própria. O systemd carrega `/etc/vexortech/vexortech.env`; `db:migrate` e `db:check` são os únicos scripts que leem `.env` diretamente.

## Dois modos de desenvolvimento

### Modo integrado

Compile cliente e servidor e inicie a aplicação em uma única porta:

```bash
# Exporte as variáveis no shell antes deste comando.
npm run dev
```

Esse modo recompila uma vez e inicia `.output/server/vanilla-server.js`; não oferece hot reload.

### Cliente Vite com proxy

Use dois terminais quando precisar de atualização rápida do frontend:

```bash
# Terminal 1: recompilar quando o backend mudar e iniciar a API na porta 3000.
npm run dev:server:build
node --env-file=.env .output/server/vanilla-server.js
```

```bash
# Terminal 2: frontend com hot reload em http://127.0.0.1:4173.
npm run dev:client
```

O Vite encaminha `/api` e `/storage` para `127.0.0.1:3000`. Vite é usado apenas como ferramenta de desenvolvimento/build; não existe framework no código entregue ao navegador.

## Banco e migrations

Faça backup antes de aplicar qualquer migration:

```bash
npm run db:migrate
npm run db:check
```

O runner usa `DATABASE_URL` ou as variáveis `POSTGRES_*`, aplica os arquivos de `db/migrations` em ordem e registra versão e checksum em `public.schema_migrations`. Não altere uma migration já aplicada; crie outra com timestamp posterior.

No snapshot histórico de 2026-07-10, o relatório destacava estas três migrations:

- `20260624090000_cursor_pagination_indexes.sql`;
- `20260624100000_asaas_central_escrow.sql`;
- `20260624110000_checkout_integrity.sql`.

Desde então, o histórico continuou evoluindo. Na revisão de 2026-07-13, a migration mais recente no repositório é `20260713153000_provision_vexortech_runtime.sql`; `db:migrate` aplica todos os arquivos pendentes em ordem, e `db:check` valida o contrato esperado. A presença dos arquivos no Git não comprova aplicação no Supabase remoto: confirme backup, histórico e schema check durante o procedimento controlado, sem inferir que o deploy já ocorreu.

A migration cria `vexortech_runtime` como `LOGIN` sem senha armazenada no repositório. Na primeira implantação, execute `db:migrate` com a conexão administrativa, defina imediatamente uma senha SCRAM aleatória para a role por um canal secreto e só então grave sua URL em `vexortech.env`, execute `db:check` e inicie o candidato. `migrate.env` continua usando a role administrativa; nunca reutilize a senha da VPS ou do usuário `postgres`.

O contrato limita objetos persistentes, schemas gerenciados, RPCs e grant options. Ele aceita apenas `TEMPORARY` herdado do `PUBLIC`, padrão do PostgreSQL: esse privilégio não pode ser negado a uma única role sem revogação global, que afetaria serviços gerenciados do Supabase.

No PostgreSQL 16+, um criador `CREATEROLE` não-superuser recebe automaticamente um vínculo administrativo sobre a role criada. O contrato aceita somente esse vínculo quando `SET` e `INHERIT` estão desativados e o grantor é o superuser bootstrap; qualquer membership capaz de exercer privilégios reprova o health check.

## Estrutura principal

| Caminho                  | Responsabilidade                                                                  |
| ------------------------ | --------------------------------------------------------------------------------- |
| `index.html`             | Documento HTML de entrada, sem scripts ou estilos inline.                         |
| `src/vanilla/core`       | API same-origin, autenticação, roteador, layout e componentes DOM seguros.        |
| `src/vanilla/pages`      | Páginas públicas, autenticação, cliente, lojista e administrador.                 |
| `src/vanilla/styles.css` | Tokens e estilos globais.                                                         |
| `src/backend`            | Auth, gateway de consultas/RPC, storage, realtime, webhooks e funções de domínio. |
| `src/server`             | Pedidos, pagamentos, assinaturas, entrega, ledger e servidor HTTP.                |
| `src/services`           | CEP, geocodificação, mapas e distância.                                           |
| `db/migrations`          | Evolução versionada do schema PostgreSQL.                                         |
| `scripts`                | Migração, verificação de schema, inventário, otimização e quarentena.             |
| `deploy`                 | Configuração de Nginx, systemd e operação na VPS.                                 |
| `docs`                   | Inventários, evidências e relatórios da modernização.                             |

## Rotas

O roteador nativo mantém as superfícies existentes:

- públicas: `/`, `/vendas`, `/lojas`, `/loja/:slug`, checkout, pagamento e acompanhamento;
- autenticação: entrada, cadastro, recuperação, redefinição, cadastro de loja e onboarding;
- cliente: `/cliente` e o alias legado `/cliente/assinatura`;
- lojista: visão geral, assinatura, pedidos, cardápio, categorias, clientes, cupons, entregas, entregadores, relatórios, configurações e usuários;
- administrador: visão geral, lojas/parceiros, cadastros, planos, pedidos, financeiro e configurações/saúde;
- legais: `/termos` e `/privacidade`.

Rotas privadas possuem guarda de papel no navegador e autorização obrigatória no servidor. O painel do lojista também exige assinatura ativa para operações protegidas, exceto na própria tela de assinatura.

## Segurança operacional

- Nunca versionar `.env`, chaves privadas, tokens, dumps ou o ZIP de quarentena.
- O fluxo OAuth usa Authorization Code + PKCE, cookies `HttpOnly`, origem allowlist e redirecionamento interno validado.
- O navegador chama apenas `/api/backend` e `/storage`; credenciais administrativas permanecem no servidor.
- O webhook Asaas exige segredo em produção e o servidor falha ao iniciar sem essa configuração.
- O arquivo MCP que continha PAT foi retirado do código ativo, mas remoção do worktree não apaga histórico: revogue/rotacione o PAT e as credenciais encontradas em scripts legados antes do deploy.
- A quarentena pode conter material sensível legado. Mantenha-a local, com acesso restrito, e não a publique junto da release.

## Documentação

- [Modernização e os 22 entregáveis](docs/MODERNIZATION_REPORT.md)
- [Inventário antes da modernização](docs/project-inventory-before-modernization.csv)
- [Inventário técnico final](docs/project-inventory.csv)
- [Arquivos removidos e justificativas](docs/project-removed-files.csv)
- [Relatório consolidado de testes](docs/TEST_REPORT.md)
- [Deploy e rollback](DEPLOY_RUNBOOK.md)
- [Arquitetura da VPS](deploy/VPS_BACKEND.md)
