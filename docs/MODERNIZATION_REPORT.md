# Relatório de modernização — Hype Delivery

- Data da consolidação histórica: 10 de julho de 2026.
- Revisão de estado documental: 13 de julho de 2026.
- Escopo: frontend, servidor Node, integrações, banco, segurança, UX/UI, performance, limpeza e operação.

> Este relatório preserva a consolidação da modernização feita em 2026-07-10. Contagens de testes, resultados E2E e pendências descritas naquele recorte são evidência histórica, não o estado final do worktree em 2026-07-13. A revisão atual não afirma que migrations foram aplicadas no banco remoto, que a homologação externa terminou ou que o deploy atual já ocorreu.

O resultado atual dos gates locais esta em [TEST_REPORT.md](TEST_REPORT.md): 320/320
testes e 104/104 cenarios E2E aprovados na matriz de quatro navegadores.

## Resumo executivo

O projeto foi migrado de uma aplicação React/TanStack/Tailwind com extensa árvore de componentes para um frontend modular composto exclusivamente por HTML semântico, CSS e JavaScript ES6+ nativo. O backend TypeScript/Node foi preservado e fortalecido, pois a exigência de remoção de frameworks se aplica ao frontend entregue ao navegador.

O trabalho foi precedido por inventário, mapeamento de rotas, dependências, integrações e riscos. Itens sem participação comprovada no runtime foram classificados, copiados para uma quarentena local e só então retirados da árvore ativa. O inventário registra 1.253 itens antes da modernização, 924 itens removidos da árvore ativa e 245 itens no snapshot técnico final. A quarentena permanece disponível para recuperação seletiva.

Na consolidação de 2026-07-10 foram registrados lint, typecheck, build, 192 testes unitários e uma bateria E2E anterior de 26 cenários. Esses números pertencem ao snapshot histórico: a suíte, o código e as migrations continuaram evoluindo. A contagem atual fica no relatório de testes separado.

Status na revisão de 2026-07-13: **os gates locais foram consolidados; migrations, health e homologação externa continuam condicionados à execução controlada na VPS e não são presumidos por este documento**.

---

## 1. Diagnóstico inicial

O diagnóstico foi concluído antes das alterações estruturais. O snapshot correspondente está em [project-inventory-before-modernization.csv](project-inventory-before-modernization.csv).

### Estrutura encontrada

- Aplicação principal em `src`, misturando páginas e componentes React, rotas TanStack, hooks, integrações browser-side, serviços e backend TypeScript.
- Backend Node/PostgreSQL com Supabase Auth/Storage, Asaas, Evolution, Google Maps, SSE e regras financeiras.
- Múltiplos resíduos operacionais: `artifacts`, capturas, logs, cópias `_deploy`, patches sobrepostos e scripts pontuais de deploy.
- Uma cópia sem relação com o produto, `claude-cookbooks-main`, concentrando grande parte do volume do repositório.
- Assets raster grandes e referências visuais servidas ou mantidas junto ao código ativo.
- Duas gerações de frontend convivendo no worktree durante a migração: legado TSX e implementação nativa.

### Tecnologias e dependências identificadas

O frontend inicial usava React 19, React DOM, React Router, TanStack Router/Start/Query, Tailwind CSS, Radix UI, React Hook Form, Framer Motion, Recharts, Sonner, Lucide React, Vaul, Embla, `cmdk`, `input-otp`, `react-day-picker`, `react-resizable-panels`, `canvas-confetti`, `next-themes` e outros utilitários de componentes. Vite/Nitro compunham a camada de build/servidor.

O backend utilizava Node, TypeScript, `pg`, Zod, PostgreSQL/Supabase, Asaas, Evolution e APIs de mapas/CEP. Essas integrações de negócio foram preservadas; o acesso do navegador foi concentrado no servidor same-origin.

O `package.json` original possuía 64 dependências de produção e 19 de desenvolvimento. O estado final possui 2 dependências de produção e 11 ferramentas de desenvolvimento.

### Duplicação, código morto e resíduos

O inventário inicial classificou:

| Classificação        |     Itens |           Bytes |
| -------------------- | --------: | --------------: |
| Crítico              |       137 |       1.322.841 |
| Em uso               |        48 |         270.258 |
| Possivelmente em uso |       116 |       2.544.309 |
| Duplicado            |        50 |      11.019.536 |
| Obsoleto             |       145 |         962.840 |
| Não utilizado        |       757 |     214.263.375 |
| **Total**            | **1.253** | **230.383.159** |

Os grupos predominantes eram material externo sem import no produto, artefatos de build/depuração, versões duplicadas de deploy e patch, páginas/componentes TSX substituídos e assets originais já convertidos. A justificativa por caminho está no CSV, inclusive hash e referência do duplicado quando identificada.

### Rotas e fluxos mapeados

Foram preservadas as superfícies públicas, de autenticação, cliente, lojista, administrador e legais. No estado final são 46 padrões de rota endereçáveis e um fallback `404`:

- público: `/`, `/vendas`, `/lojas`, `/vendas/lojas`, `/loja/:slug`, `/vendas/loja/:slug`, checkout, acompanhamento e resultados de pagamento;
- autenticação: `/entrar`, `/cadastrar`, `/recuperar-senha`, `/redefinir-senha`, `/lojista/entrar`, `/cadastrar-loja`, `/admin/entrar` e `/onboarding`;
- cliente: `/cliente` e o alias `/cliente/assinatura`;
- lojista: `/lojista`, assinatura, pedidos, cardápio, categorias, clientes, cupons, entregas, entregadores, relatórios, configurações e usuários;
- administrador: `/admin`, lojas/parceiros, cadastros, planos, pedidos, financeiro e configurações/saúde;
- legal: `/termos` e `/privacidade`.

Fluxos principais mapeados:

1. Cliente encontra uma loja, escolhe produtos e opções, mantém carrinho por loja, autentica-se, informa entrega/retirada, recebe cotação, seleciona pagamento, cria o pedido e acompanha o token público.
2. Lojista cadastra-se, conclui onboarding e assinatura, configura loja/entrega/Pix, administra cardápio/equipe e opera a fila de pedidos.
3. Administrador gerencia lojas, cadastros, planos, pedidos, conciliação financeira e saúde/configuração não secreta da plataforma.
4. Asaas confirma cobranças por webhook; Evolution envia notificações; Google Maps/ViaCEP apoiam endereço, distância e entrega; SSE atualiza telas em tempo real.

### Riscos iniciais

- Fluxo OAuth e tokens com responsabilidade excessiva no navegador, contexto de papel manipulável e redirecionamentos que exigiam restrição mais forte.
- Gateway genérico de consultas com projeções públicas, escopo de tenant e mutações privilegiadas insuficientemente centralizados.
- Possibilidade de escalada de papel por metadados de cadastro e regras administrativas permissivas.
- Checkout suscetível a confiar em preço, opções, frete ou disponibilidade enviados pelo cliente; idempotência incompleta.
- Mudanças de status de pedido desconectadas do ledger, repasse e estorno.
- Webhook com riscos de repetição, concorrência, evento sem identificador e falha aberta quando o segredo não estivesse configurado.
- Realtime/SSE com credencial pública inadequada, risco de exposição de PII e limpeza/limites incompletos.
- Upload sem validação completa de extensão, MIME, assinatura do arquivo, tamanho, bucket e pertencimento.
- PAT em configuração MCP versionada e credenciais embutidas em scripts legados de deploy. Valores não são reproduzidos neste relatório.
- CSS/componentes duplicados, carregamento amplo de módulos, imagens grandes, múltiplas requisições e resíduos volumosos.
- Foco, contraste, navegação por teclado, modais, tabelas e menus mobile inconsistentes entre componentes legados.

### Impacto previsto da remoção dos frameworks

A remoção não poderia ser apenas visual. Exigia substituir roteamento, guards, sessão, formulários, validações, modais, toast, menus, tabelas, filtros, estados de carregamento, responsividade, animações, gráficos/resumos e testes. Também exigia trocar o servidor TanStack/Nitro, manter aliases de rota e retirar dependências somente depois da paridade. Esse risco motivou a migração incremental, os módulos nativos paralelos, a bateria de testes e a quarentena.

## 2. Inventário dos arquivos

Há três fontes canônicas:

- [inventário antes da modernização](project-inventory-before-modernization.csv): caminho, bytes, classificação, justificativa, SHA-256 e duplicado de referência;
- [inventário técnico final](project-inventory.csv): itens mantidos no snapshot final;
- [arquivos removidos](project-removed-files.csv): itens retirados da árvore ativa, com justificativa e SHA-256.

Resumo dos snapshots:

| Snapshot                | Itens |       Bytes |
| ----------------------- | ----: | ----------: |
| Antes da modernização   | 1.253 | 230.383.159 |
| Removidos/quarentenados |   924 | 217.484.407 |
| Técnico final           |   245 |   3.752.607 |

O inventário técnico final foi gerado depois da quarentena e da redução de dependências, mas antes da criação destes relatórios narrativos Markdown; por isso os próprios relatórios não alteram sua contagem. Pastas geradas como `node_modules`, `dist`, `.output` e o ZIP local de quarentena não devem ser interpretadas como código-fonte mantido.

## 3. Lista dos arquivos removidos

A relação exaustiva está em [project-removed-files.csv](project-removed-files.csv):

| Classificação de remoção |   Itens |           Bytes | Motivo predominante                                                                        |
| ------------------------ | ------: | --------------: | ------------------------------------------------------------------------------------------ |
| Não utilizado            |     648 |     208.916.340 | Sem import, rota ou participação em build/testes ativos.                                   |
| Duplicado                |     127 |       4.120.921 | Cópia de arquivo já preservado ou artefato redundante.                                     |
| Obsoleto                 |     145 |       4.395.337 | Frontend/framework legado ou asset substituído.                                            |
| Crítico removido         |       4 |          51.809 | Script legado inseguro, preservado apenas em quarentena e sujeito a rotação de credencial. |
| **Total**                | **924** | **217.484.407** |                                                                                            |

Grupos removidos:

- frontend React/TSX, rotas TanStack, hooks e componentes UI substituídos por módulos nativos;
- configuração Tailwind/React/TanStack e arquivos de estilo/componentes correspondentes;
- `claude-cookbooks-main`, sem import, rota ou participação no build do produto;
- logs, screenshots antigas, artefatos, patches, cópias `_deploy` e relatórios intermediários;
- scripts de deploy com fluxo inseguro ou credenciais embutidas;
- assets raster originais substituídos por WebP;
- serviços browser-side redundantes após a centralização same-origin.

### Quarentena

- Caminho local: `quarantine/legacy-and-residue-20260710.zip`.
- Arquivos: **924**.
- Tamanho lógico dos arquivos: **217.484.407 bytes**.
- Tamanho do ZIP: **173.142.924 bytes**.
- SHA-256: `a307cb612a95d1b16b969bcf2ee14812b5631f1dd8bc5ece5b2db15ea4c2a909`.

O ZIP é local e ignorado pelo repositório. Ele pode conter arquivos historicamente sensíveis e não deve ser publicado, enviado à VPS ou anexado a releases. Recomenda-se cópia externa criptografada com controle de acesso e retenção definida.

## 4. Lista dos arquivos mantidos e justificativa

O inventário final classifica 245 itens:

| Classificação        | Itens |     Bytes | Regra de manutenção                                                                          |
| -------------------- | ----: | --------: | -------------------------------------------------------------------------------------------- |
| Crítico              |   151 | 1.327.076 | Necessário ao runtime, persistência, segurança, build ou operação.                           |
| Em uso               |    17 |   143.069 | Referenciado diretamente pelo runtime/testes ou servido como asset.                          |
| Possivelmente em uso |    77 | 2.282.462 | Documento, evidência ou configuração preservado por não haver prova suficiente para remoção. |

Foram mantidos por domínio:

- `src/vanilla`: única implementação ativa do frontend;
- `src/backend`, `src/server`, `src/services` e `src/integrations/backend`: regras de domínio, persistência e integrações;
- `db/migrations` e `db/schema.sql`: histórico e contrato do banco;
- `public`: manifesto, ícone e marca otimizada usados no build;
- `scripts`: migração, schema check, inventário, otimização e quarentena reproduzível;
- `tests`, arquivos `*.test.*` e `docs/evidence`: prevenção de regressão e evidência visual;
- `deploy`, `.env.example` e configurações raiz: operação, segurança e tooling;
- documentos e referências com uso incerto foram conservados, em vez de removidos por suposição.

## 5. Frameworks e dependências removidos

Foram removidos do runtime e do lockfile:

- React, React DOM e React Router;
- TanStack React Router, React Start, React Query e plugins de rota;
- Tailwind CSS, plugin Vite, `tailwind-merge` e `tw-animate-css`;
- toda a suíte `@radix-ui/react-*`;
- React Hook Form e resolvers;
- Framer Motion, Recharts, Sonner, Lucide React, Vaul, Embla, `cmdk`, `input-otp`, `react-day-picker`, `react-resizable-panels`, `canvas-confetti` e `next-themes`;
- `@react-google-maps/api` e o SDK browser-side `@supabase/supabase-js`;
- utilitários que deixaram de ser necessários, como `clsx`, `class-variance-authority`, `date-fns`, `lru-cache`, `chokidar` e `tslib`;
- Nitro, plugins/tipos/lints específicos de React e `vite-tsconfig-paths`.

Estado final:

- dependências de produção: `pg` e `zod`, ambas server-side;
- ferramentas de desenvolvimento: TypeScript, Vite, ESLint, Prettier, Vitest, Playwright e tipos Node/PostgreSQL;
- navegador: zero pacote de framework ou componente; apenas HTML, CSS e JavaScript modular gerados pelo projeto.

Vite permanece como bundler/minificador e servidor de desenvolvimento, não como framework do runtime.

## 6. Estrutura final de pastas

```text
.
├── index.html
├── public/
│   ├── brand/
│   └── manifest.webmanifest
├── src/
│   ├── vanilla/
│   │   ├── core/          # api, auth, router, layout e UI DOM
│   │   ├── pages/
│   │   │   ├── public/
│   │   │   ├── auth/
│   │   │   ├── merchant/
│   │   │   └── admin/
│   │   ├── main.js
│   │   └── styles.css
│   ├── backend/           # auth, query/RPC, storage, realtime, webhooks
│   ├── server/            # HTTP e serviços de domínio/financeiro
│   ├── services/          # mapas, distância e CEP
│   ├── integrations/      # contrato do gateway backend
│   ├── lib/               # validações e horários puros
│   ├── functions/         # integração Evolution server-side
│   ├── types/
│   └── tests/
├── db/
│   └── migrations/
├── scripts/
├── tests/e2e/
├── deploy/
├── docs/
└── quarantine/            # ZIP local ignorado; nunca entra na release
```

`dist` e `.output` são produtos de build e podem ser recriados; `node_modules` é instalado por `npm ci`.

## 7. Relação dos arquivos criados

A relação final completa está em [project-inventory.csv](project-inventory.csv). Principais criações:

- entrada/build: `index.html`, `vite.vanilla.config.mjs`, `eslint.config.js`, `.prettierrc`, `.prettierignore`;
- servidor: `src/server/vanilla-server.ts`;
- frontend: todo o diretório `src/vanilla`, incluindo core, CSS, páginas, modelos, impressão, assets, harnesses e testes;
- marca/PWA: `public/brand/hype-delivery-brand.webp` e `public/manifest.webmanifest`;
- migrations destacadas no recorte de 2026-07-10: `20260624090000_cursor_pagination_indexes.sql`, `20260624100000_asaas_central_escrow.sql` e `20260624110000_checkout_integrity.sql`; o histórico atual inclui migrations posteriores, até `20260713153000_provision_vexortech_runtime.sql` na revisão de 2026-07-13;
- segurança/testes: novos testes de signup público, Supabase/PKCE, query gateway, RPC, realtime, query builder, ciclo de pedido, geolocalização e módulos nativos;
- manutenção: `scripts/inventory-project.mjs`, `scripts/optimize-raster.mjs` e `scripts/quarantine-legacy.ps1`;
- evidências: imagens em `docs/evidence` para produtos, opções, upload, assinatura, cartão, configurações, entregas, tracking e painel administrativo;
- documentação: este relatório e o [relatório consolidado de testes](TEST_REPORT.md).

## 8. Relação dos arquivos modificados

Arquivos modificados pela modernização, agrupados:

- configuração: `.env.example`, `.gitignore`, `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`;
- deploy: `deploy/nginx-vexortech.conf`, `deploy/vexortech.service`, `scripts/migrate.mjs`;
- backend: `src/backend/auth.ts`, `env.ts`, `functions.ts`, `query.ts`, `realtime.ts`, `rpc.ts`, `storage.ts`, `supabase.ts`, `webhooks.ts` e testes associados;
- contrato de integração: `src/integrations/backend/compat-types.ts` e `query-builder.ts`;
- regras compartilhadas: `src/lib/opening-hours.ts`, `src/lib/validators.ts` e testes;
- domínio: `src/server/asaas.service.ts`, `delivery.service.ts`, `order.functions.ts`, `order.lifecycle.ts`, `pix.ts`, `subscription.service.ts` e testes;
- geolocalização: `src/services/viacep.ts` e teste;
- E2E: `tests/e2e/smoke.spec.ts`.

`src/server/refund.service.ts` já estava modificado no worktree antes desta modernização e foi deliberadamente preservado sem sobrescrever a alteração do usuário; por isso não é atribuído a este trabalho, embora apareça como modificado no Git local.

Os 924 caminhos retirados não são repetidos aqui; [project-removed-files.csv](project-removed-files.csv) é a relação auditável e evita omissões.

## 9. Relação das funções refatoradas

| Domínio             | Funções/contratos principais                                                                              | Resultado                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Autenticação        | cadastro público/lojista, login, refresh, logout, recuperação, OAuth URL/code exchange, sessão e claims   | PKCE, cookies seguros, papel reconciliado no servidor, redirecionamento allowlist e refresh automático.           |
| Perfis e assinatura | criação de linhas da aplicação, papel administrativo, `assertActiveMerchantSubscription`                  | Cadastro não promove papel arbitrário; operações do lojista falham fechadas sem assinatura ativa.                 |
| Servidor HTTP       | roteamento, `backendHandler`, cookies, origem/host, IP confiável, rate limit, arquivos estáticos e health | API same-origin, limites por ação, proteção a path traversal, cache correto e encerramento de stream.             |
| Query gateway       | serialização do query builder, AST de filtros, casts, projeções, mutations e `maybeSingle`                | SQL parametrizado, profundidade limitada, campos públicos explícitos, tenant e privilégios validados.             |
| Storage             | upload e leitura de objeto                                                                                | Validação de tamanho/MIME/extensão/assinatura, caminho pertencente à loja, bucket permitido e assinatura privada. |
| Realtime            | criação/publicação de stream                                                                              | Autenticação, credencial pública fora da URL, redação de PII, limites por principal e cleanup.                    |
| Checkout            | `createCheckoutOrderHandler`, cotação, cupom, opções e idempotência                                       | Preços, estoque, desconto, frete e total recalculados no servidor; retry não duplica pedido.                      |
| Pedidos             | transição, entrega, cancelamento, Pix manual e histórico                                                  | Estados explícitos, confirmação, idempotência, ledger/repasse/estorno e notificação coordenados.                  |
| Asaas/webhooks      | cobrança central/manual, claim de evento, assinatura, estorno e retry                                     | Webhook fail-closed, processamento atômico e idempotente, reembolso parcial cumulativo.                           |
| Configurações       | `merchant-update-settings`                                                                                | Loja e `store_settings` atualizados na mesma transação com validação de cores, Pix, horários, endereço e assets.  |
| Geolocalização      | CEP, coordenadas, reverse geocode, distância e quote                                                      | Coordenadas validadas, APIs externas server-side e cotação canônica usada pelo checkout.                          |
| Frontend core       | `createRouter`, `auth`, `api`, `applyLayout` e helpers DOM                                                | Roteamento/guards, retry de sessão, cleanup, foco, menus, toast, modal e botões sem framework.                    |
| Páginas             | módulos públicos, auth, lojista e admin                                                                   | Paridade de rota e recursos com carregamento sob demanda e componentes nativos reutilizáveis.                     |

## 10. Melhorias de segurança aplicadas

- OAuth Authorization Code + PKCE; contexto de lojista assinado no servidor, verifier protegido e troca do código server-side.
- Sessão em cookies `HttpOnly`, `SameSite=Lax` e `Secure` em produção; remoção de tokens OAuth/Supabase legados do Web Storage.
- Refresh automático de sessão com retry único e logout que só limpa estado local após resposta válida.
- Cadastro público sempre inicia como cliente; promoção de papel e administração não dependem de e-mail ou metadado enviado pelo navegador.
- Redirects limitados a origens configuradas; loopback aceito apenas fora de produção.
- Verificação de `Origin`, host de produção, proxy/IP confiável, bind loopback e rate limits de API, autenticação e funções sensíveis.
- Gateway de consulta com SQL parametrizado, AST tipada, allowlists de tabelas/campos, projeções públicas e verificação transacional de tenant.
- Campos financeiros, segredos Pix, documentos e dados privados removidos de consultas públicas.
- Assinatura ativa verificada no frontend e obrigatoriamente no backend para mutações do lojista.
- Checkout não confia em preço, subtotal, desconto, opção, estoque, forma de pagamento ou frete do cliente.
- Idempotência local e constraints únicas para pedido/pagamento; lock transacional em operações críticas.
- Webhook Asaas autenticado, claim atômico, lease/retry e idempotência por evento/recurso/payload; divergência de valor não marca pedido pago.
- Entrega e cancelamento passam pelo ciclo financeiro; Pix pendente não conclui pedido e cancelamento pago bloqueia repasse/inicia estorno.
- Uploads limitados, inspecionados e escopados; `upsert` inseguro removido.
- Realtime autenticado, redigido, limitado e abortado ao desconectar.
- DOM criado com `createElement`, `textContent` e atributos controlados; não há `innerHTML`, handler inline ou estilo inline no frontend ativo.
- CSP estrita sem `unsafe-inline`, HSTS, `nosniff`, `DENY`, Referrer Policy, Permissions Policy e CORP.
- Assets inexistentes retornam `404`, caminhos são normalizados e HTML não recebe cache persistente.
- Produção falha ao iniciar quando banco, URL HTTPS, Supabase, segredo PKCE ou segredo de webhook obrigatório estão ausentes.

## 11. Melhorias de performance aplicadas

- Remoção de 924 arquivos/resíduos da árvore ativa e redução das dependências de produção de 64 para 2.
- Rotas administrativas, públicas, auth e lojista carregadas com `import()` sob demanda e chunks CSS/JS separados.
- Build atual de referência: entrada JS de 39.557 bytes, maior chunk de rota de 36.770 bytes, CSS global de 68.563 bytes e CSS do lojista de 28.096 bytes, antes de compressão HTTP.
- Marca principal convertida de PNG de 1.497.047 bytes para WebP de 86.272 bytes, redução aproximada de 94,2%; raster de referência de 1.227.786 bytes saiu do runtime.
- Dimensões explícitas, prioridade apenas na imagem principal e lazy loading onde aplicável para reduzir layout shift e tráfego.
- Cache imutável de um ano para assets com hash; HTML `no-store`; cache curto para assets sem hash; gzip no Nginx.
- Pesquisas locais com debounce e uma única carga de lojas no cenário testado, sem requisição duplicada por filtro.
- Realtime SSE com polling de fallback, timers/listeners encerrados no cleanup e reconexão controlada.
- Renderização com `replaceChildren`, fragmentos e atualização dirigida por estado, sem ciclo de renderização de framework.
- Minificação apenas no build de produção e sourcemap desativado no artefato publicado.

## 12. Melhorias de acessibilidade aplicadas

- Estrutura semântica com `main`, `section`, `article`, headings, tabelas, formulários, labels e botões reais.
- Link de salto para `#main-content`, foco visível e foco reposicionado após navegação.
- Modais/dialogs com foco inicial, fechamento por Escape e restauração de foco.
- Menus com `aria-expanded`, navegação por teclado e fechamento controlado.
- Toasts, atualizações de fila, histórico e erros com regiões `aria-live` apropriadas.
- Botões somente-ícone com nome acessível; estados `disabled`, `loading`, `aria-busy` e `aria-pressed` quando aplicável.
- Erros associados aos campos e mensagens acionáveis próximas do controle.
- Status acompanhados de texto/ícone, sem depender somente de cor.
- Imagens com texto alternativo e fallback; links externos com `noopener noreferrer`.
- CSS respeita `prefers-reduced-motion`; transições não bloqueiam interação.
- No snapshot histórico, o layout responsivo foi validado sem overflow horizontal na home em 320, 375, 414, 768, 1.024, 1.280 e 1.440 px.

A automação registrada naquele snapshot foi executada em Chromium. A configuração atual do Playwright também define projetos Chrome, Firefox e WebKit, mas este relatório não afirma que a matriz atual completa já foi executada; tecnologias assistivas reais continuam parte da homologação manual recomendada.

## 13. Melhorias visuais aplicadas

- Identidade Hype preservada; paleta, superfícies, tipografia, raios, sombras, espaçamento e transições centralizados em variáveis CSS.
- Marca oficial convertida para WebP sem introduzir nova paleta.
- Componentes nativos reutilizáveis para botão, campo, card, badge, tabela, modal, toast, confirmação, estado vazio, erro e carregamento.
- Estados coerentes de hover, focus, active, disabled, loading, success, warning e error.
- Sidebar/painel, cabeçalhos, navegação pública, formulários, tabelas e cards padronizados.
- Tabelas usam contenção/alternativa responsiva; checkout e painéis reorganizam grids em mobile, sem simples redução proporcional.
- Microinterações em menu, modal, toast, botões, carrinho, etapas e mudança de status com CSS/JS nativo e reduced motion.
- Evidências visuais preservadas em [docs/evidence](evidence), incluindo desktop/mobile de produtos, configurações e entregas, além de assinatura, cartão, tracking e configurações administrativas.

## 14. Melhorias em gestão de pedidos

- Tabela, Kanban e visão de cozinha com métricas, fila priorizada, urgência e oportunidades de agrupamento.
- Pesquisa, filtro por status/modalidade/período, ordenação determinística e paginação.
- Histórico separado com período predefinido ou personalizado, status, pesquisa e paginação.
- Detalhe com cliente, endereço, referência, itens, quantidades, adicionais, observações, subtotal, desconto, frete, total e pagamento.
- Links de WhatsApp e mapa construídos com origem fixa e dados codificados; impressão cria documento seguro, sem HTML arbitrário.
- Atualização por SSE, reconexão e polling de fallback; som é opt-in e usa Web Audio, sem asset externo.
- Transições explícitas para entrega e retirada; finalização passa por `merchant-mark-delivered` e cancelamento por `merchant-cancel-order`.
- Pix manual só pode ser confirmado quando a proveniência é inequivocamente manual e pendente.
- Ações críticas exigem confirmação, motivo quando necessário, estado ocupado e bloqueio de envio repetido.
- Entrega idempotente não duplica total/histórico; cancelamento pago bloqueia repasse e agenda estorno sem duplicar efeitos.
- Realtime e Evolution são acionados após a mudança persistida; falhas auxiliares não deixam a transação principal em estado ambíguo.

Não foi criada uma edição irrestrita de pedidos já financeiros. Alterações ocorrem por comandos de ciclo de vida validados, o que preserva integridade em vez de permitir mutation genérica de valores/status.

## 15. Melhorias em geolocalização

- Solicitação acionada pelo usuário com explicação de uso; nenhum prompt automático repetitivo.
- Tratamento distinto de permissão negada, indisponibilidade, timeout e navegador sem suporte.
- Retry apenas para erros recuperáveis e fallback permanente para endereço manual.
- Latitude/longitude devem ser finitas e respeitar os limites geográficos antes de qualquer chamada.
- Reverse geocode executado no servidor, preenche CEP/logradouro/bairro/cidade/UF e pede confirmação do número.
- Consulta CEP usa função same-origin, evitando ampliar a CSP para terceiros no navegador.
- Cotação de entrega usa endereço canônico, raio global, regiões de CEP/cidade/bairro, taxa fixa/por km, mínimo/máximo, pedido mínimo e frete grátis da loja.
- Falha de validação server-side fecha o fluxo; coordenada do cliente não substitui o endereço confirmado.
- Dados de localização não são colocados em logs ou URLs internos; abertura do mapa usa endereço codificado somente após ação do lojista.

Validação real de Google Maps e comportamento de GPS em dispositivos físicos depende das credenciais e da homologação descritas na seção 19.

## 16. Melhorias no checkout

- Fluxo progressivo em três etapas: dados, entrega e pagamento/revisão.
- Carrinho por loja com assinatura de produto/opções, normalização de dados persistidos e totais em centavos.
- Validação próxima ao campo para nome, telefone, e-mail, CPF/CNPJ, CEP, endereço, número, localização, modalidade e troco.
- Suporte a CPF e CNPJ, inclusive formato alfanumérico, com dígitos verificadores.
- Entrega e retirada possuem contratos distintos; a cotação é sempre confirmada no servidor.
- Formas expostas conforme configuração da loja: PIX, dinheiro e cartão de crédito/débito na entrega.
- Preços, opções obrigatórias, limites, disponibilidade, cupom, desconto, frete e total são recalculados no backend.
- Chave de idempotência, advisory lock e constraint única protegem contra clique duplo/retry; reutilização com carrinho diferente é rejeitada.
- Botão final possui estado ocupado e feedback; falha de geração do PIX mantém o pedido recuperável.
- Sucesso PIX exibe QR/copia e cola quando disponível; demais pagamentos encaminham ao acompanhamento.
- Dados preenchidos e carrinho são preservados enquanto o pedido não conclui; `beforeunload` alerta sobre abandono com dados pendentes.
- Respostas de erro são normalizadas e não exibem stack, SQL ou segredo.

O backend suporta cupom e valida desconto, mas a UI atual envia `couponCode: null` e não apresenta campo promocional. Caso a entrada de cupom faça parte do produto público, ela deve ser especificada e acrescentada como evolução, sem alterar a regra server-side existente.

## 17. Testes registrados na consolidação histórica

O quadro abaixo preserva a evidência registrada em 2026-07-10. Ele não representa a contagem nem o resultado final da suíte atual.

| Momento                                               | Typecheck | Lint     |                    Unitários | Build    |                                      E2E |
| ----------------------------------------------------- | --------- | -------- | ---------------------------: | -------- | ---------------------------------------: |
| Antes da quarentena (histórico)                       | Aprovado  | Aprovado |                221 aprovados | Aprovado |                          26/26 aprovados |
| Após quarentena e redução de dependências (histórico) | Aprovado  | Aprovado | 192 aprovados em 29 arquivos | Aprovado | Repetição não registrada naquele recorte |

Os 26 E2E históricos cobriram 15 rotas críticas, 7 larguras, redirecionamento de guards, validação de cadastro, filtro sem request duplicado e CSP/ausência de código inline. Eles continuam como evidência do snapshot; a execução atual separada esta registrada em [TEST_REPORT.md](TEST_REPORT.md).

## 18. Problemas encontrados

- Repositório ativo misturava produto, material externo volumoso, artefatos, patches e cópias de deploy.
- Frontend legado dependia de dezenas de pacotes e mantinha comportamentos duplicados entre componentes.
- Assets originais muito maiores que a versão necessária ao navegador.
- Papéis, tenant, consultas públicas, checkout, webhook, uploads e SSE exigiam controles server-side adicionais.
- Entrega/cancelamento podiam divergir de pagamento, ledger, repasse ou estorno.
- Scripts legados continham credenciais/fluxos inseguros; arquivo MCP versionado continha PAT.
- Alguns documentos e referências não puderam ser provados como descartáveis e foram mantidos como `possivelmente_em_uso`.
- O checkout possui suporte backend a cupom, mas não expõe o campo na interface atual.
- A evidência E2E histórica usava apenas Chromium; a matriz atual de Chromium, Chrome, Firefox e WebKit esta registrada separadamente em [TEST_REPORT.md](TEST_REPORT.md).

## 19. Pendências de backend ou infraestrutura

Registro revisado em 2026-07-13. Os itens 1 e 2 nasceram no snapshot de 2026-07-10 e devem ser confirmados contra o ambiente atual; este relatório não presume credenciais disponíveis, migrations remotas aplicadas ou deploy concluído.

Bloqueadores para declarar produção homologada:

1. Na consolidação histórica não havia `DATABASE_URL` nem conjunto `POSTGRES_*`; a revisão documental atual não revalida nem expõe credenciais do ambiente.
2. Verificar todo o histórico pendente com backup, `npm run db:migrate` e `npm run db:check`, incluindo `20260713142207_reconcile_financial_schema.sql` e `20260713153000_provision_vexortech_runtime.sql`; provisionar a senha secreta da role runtime entre migrate e check/candidato e não limitar a conferência às três migrations destacadas em 2026-07-10.
3. Não havia credenciais/ambiente real de Supabase para validar cadastro, login, refresh, OAuth Google/Apple, recuperação, storage e RLS ponta a ponta.
4. Não havia conta/segredo de sandbox Asaas para validar cobrança, webhook, assinatura, Pix, estorno e repasse reais.
5. Não havia instância Evolution disponível para validar entrega e retry de mensagens reais.
6. Google Maps/GPS e reverse geocode precisam de chave válida e teste em dispositivos móveis reais; o fallback manual já está implementado.
7. Concluido no gate local de 2026-07-13: matriz atual registrada em [TEST_REPORT.md](TEST_REPORT.md).
8. Executar smoke autenticado com papéis cliente, lojista ativo/inadimplente e super admin em dados de homologação.
9. Validar Firefox, Edge, Safari/iOS e Android, além de navegação por leitor de tela.
10. Revogar e rotacionar obrigatoriamente o PAT MCP e qualquer credencial presente nos scripts removidos. A remoção do arquivo não apaga clones, logs, ZIP ou histórico Git; se houve publicação, reescrever o histórico com procedimento coordenado.
11. Guardar o ZIP de quarentena em repositório seguro externo e definir retenção; ele não deve ir para produção.

Nenhum valor secreto foi incluído nos relatórios.

## 20. Instruções para executar o projeto

Requisito: Node `>=22.12.0`.

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
node --env-file=.env .output/server/vanilla-server.js
```

Com variáveis já exportadas, `npm start` executa o mesmo servidor. O modo integrado e o modo cliente Vite + API em dois terminais estão descritos no [README](../README.md#dois-modos-de-desenvolvimento).

Banco:

```bash
# Sempre depois de backup e com DATABASE_URL/POSTGRES_* corretos.
npm run db:migrate
npm run db:check
```

Produção:

```bash
npm ci --include=dev
npm run typecheck
npm run lint
npm test
npm run e2e
npm run db:migrate
npm run db:check
npm run build
npm prune --omit=dev
node .output/server/vanilla-server.js
```

Use systemd/Nginx conforme [DEPLOY_RUNBOOK.md](../DEPLOY_RUNBOOK.md) e [deploy/VPS_BACKEND.md](../deploy/VPS_BACKEND.md). O servidor Node não lê `.env` automaticamente; em produção, o unit systemd lê `/etc/vexortech/vexortech.env`.

## 21. Instruções para manutenção

- Frontend novo deve permanecer em `src/vanilla`, sem TSX, framework, HTML/CSS/JS inline ou sink `innerHTML`.
- Reutilize helpers DOM/core e tokens CSS; não crie outra biblioteca visual paralela.
- Registre rotas no `index.js` do domínio correto e preserve guard, layout, título, cleanup e teste de inventário.
- Qualquer regra financeira, papel, tenant, preço, desconto, frete ou upload deve ser validado no servidor; validação do browser é apenas UX.
- Mutações do lojista devem verificar pertencimento e assinatura ativa. Mutações administrativas devem exigir `super_admin` real.
- Não edite migration aplicada. Crie arquivo timestampado, faça backup, rode `db:migrate` e `db:check`.
- Ao alterar pedido/pagamento, cubra idempotência, retry, concorrência, histórico, ledger, realtime e notificação.
- Ao alterar OAuth/session, preserve PKCE, cookies `HttpOnly`, allowlist de origem e ausência de token no Web Storage.
- Otimize novos rasters antes de publicar com `npm run optimize:images`; informe `width`/`height` e lazy/eager apropriado.
- Antes de limpeza futura, gere outro inventário com `npm run inventory`, classifique e use `npm run quarantine:dry`; nunca apague sem backup verificável.
- Rotina mínima de PR: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e` e inspeção visual das rotas afetadas; não fixe um piso baseado na contagem histórica.
- Atualize [TEST_REPORT.md](TEST_REPORT.md) sempre que a suite ou a matriz E2E mudar; homologacao externa continua sendo um registro operacional separado.
- Segredos ficam somente no secret manager/arquivo protegido da VPS; nunca em source, documentação, screenshot ou ZIP compartilhado.

## 22. Plano de rollback

### Código e processo

1. Mantenha cada deploy em diretório de release e troque `/var/www/vexortech/current` por symlink atômico.
2. Em falha, aponte o symlink para a release anterior, que deve conter seu próprio `package-lock.json`, `dist` e `.output` compatíveis.
3. Reinicie `vexortech`, valide status/log e execute `/api/health` pelo loopback e domínio.
4. Rode smoke das rotas públicas e guards. Não misture `node_modules` de releases com lockfiles diferentes.

### Banco

1. Faça `pg_dump`/snapshot antes de migration.
2. Não reverta migration por edição do arquivo aplicado.
3. Quando possível, crie migration forward-fix; se a mudança for incompatível e o incidente exigir, restaure o backup de forma coordenada com a release anterior.
4. Execute `npm run db:check` após qualquer recuperação.

### Recuperação seletiva da quarentena

1. Verifique o SHA-256 do ZIP contra o valor da seção 3.
2. Extraia em diretório temporário com acesso restrito, nunca diretamente sobre o projeto.
3. Localize o caminho e hash em [project-removed-files.csv](project-removed-files.csv).
4. Restaure somente o item necessário, revise possíveis segredos/referências e rode toda a validação.
5. Para rollback integral do frontend legado, prefira a release/commit anterior; restaurar o ZIP inteiro no worktree moderno recriaria dependências e configurações incompatíveis.

### Segurança no rollback

Credenciais rotacionadas não devem ser restauradas. O ZIP serve para recuperação de código, não de segredos. Caso o incidente envolva exposição, revogue a credencial antes de restaurar serviço.

---

## Matriz final dos critérios de aceite

| Critério                                  | Situação                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Nenhum framework no frontend              | Atendido no source e no `package.json`; Vite é somente tooling.                                                             |
| HTML, CSS e JavaScript puro               | Atendido no artefato do navegador.                                                                                          |
| Rotas existentes preservadas              | Paridade estrutural e smoke público aprovados; fluxos autenticados reais dependem de homologação.                           |
| Identidade/componentes/responsividade     | Implementado e evidenciado no snapshot histórico; a matriz E2E atual deve ser registrada separadamente.                     |
| Sem referência quebrada/console relevante | Há evidência histórica da bateria anterior; a revisão de 2026-07-13 não a apresenta como confirmação final do commit atual. |
| Segurança e ausência de exposição         | Controles implementados/testados localmente; rotação de credenciais e validação externa obrigatórias.                       |
| Pedidos, geolocalização e checkout        | Regras e testes locais implementados; integrações reais pendentes.                                                          |
| Limpeza com justificativa e rollback      | Atendido por três inventários, ZIP, hashes e plano de recuperação.                                                          |
| Manutenção documentada                    | Atendido por README, este relatório, relatório de testes e runbooks.                                                        |

Conclusão revisada em 2026-07-13: a arquitetura nativa e a trilha de limpeza permanecem documentadas. A liberação para produção continua condicionada aos itens da seção 19, à execução consolidada dos gates atuais, ao schema check e à homologação das integrações reais; este relatório não registra que o deploy atual tenha ocorrido.
