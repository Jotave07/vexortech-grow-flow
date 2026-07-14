# Contrato das páginas do lojista

## Shell

Cada rota exportada por `index.js` usa `auth: "store_owner"`, `layout: "merchant"` e retorna um `HTMLElement` (`section.merchant-page`). O elemento pode expor:

- `ready: Promise`, para testes ou instrumentação aguardarem a primeira carga;
- `cleanup(): void`, chamado pelo roteador ao desmontar a rota para cancelar polling e demais recursos.

O `ctx` necessário é:

- `ctx.api.from(table)`: builder com `select`, `insert`, `update`, `upsert`, `delete`, filtros, `order`, `limit`, `single` e `maybeSingle`;
- `ctx.api.upload(bucket, path, file, options)`: upload multipart autenticado. Produtos e identidade visual usam o bucket público `store-assets`, caminho iniciado pelo `store_id`, limite de 5 MB, tipos JPG/PNG/WebP/GIF e nomes únicos sem `upsert`;
- `ctx.api.fn(name, body)`: funções autenticadas descritas abaixo;
- `ctx.auth.require("store_owner")`, `ctx.auth.role`, `ctx.auth.profile`, `ctx.auth.session`, `ctx.auth.store` ou `ctx.auth.stores[0]`;
- `ctx.ui.document`, `ctx.ui.el`, `ctx.ui.toast`, `ctx.ui.confirm`, `ctx.ui.loading`, `ctx.ui.empty`, `ctx.ui.money` e `ctx.ui.date`;
- `ctx.navigate(path)`, somente para navegação interna;
- `ctx.params` e `ctx.query` (`URLSearchParams` ou objeto simples).

O identificador da loja é resolvido, nesta ordem, por `params.storeId`, `auth.store.id`, `auth.stores[0].id`, perfil ou sessão. A ausência desse vínculo interrompe a operação sem consultar dados globais.

## Dados

As páginas dependem das tabelas `stores`, `store_settings`, `categories`, `products`, `product_options`, `product_option_items`, `customers`, `coupons`, `orders`, `order_items`, `order_item_options`, `payments`, `delivery_zones`, `delivery_drivers`, `plans`, `subscriptions`, `profiles` e `user_roles`.

Leituras e mutações próprias da loja carregam `store_id`; operações por `id` também mantêm o filtro de loja quando a tabela o oferece. RLS e autorização do backend continuam obrigatórias: o filtro do cliente é defesa adicional, não uma fronteira de segurança.

Na gestão de adicionais, a UI primeiro confirma que o produto pertence à loja selecionada. Grupos sempre carregam `product_id`; itens sempre carregam `option_id`; updates e deletes repetem esses filtros junto com o `id`. Grupos opcionais usam mínimo zero, grupos obrigatórios usam mínimo de pelo menos um, o máximo fica entre 1 e 50 e nunca pode ser menor que o mínimo. Um item ativo não pode ser desativado ou excluído quando isso reduzir as escolhas ativas abaixo do mínimo do grupo.

As configurações comerciais são persistidas exclusivamente por `merchant-update-settings`, que atualiza `stores` e `store_settings` na mesma transação. Logo e capa usam caminhos únicos `store_id/branding/{logo|cover}/...`; a URL só entra no formulário depois que o servidor confirma exatamente o caminho solicitado. A agenda semanal usa as chaves `mon` a `sun`, com `enabled`, `open` e `close`. No contrato atual, `is_open` continua sendo o estado operacional manual que prevalece sobre a agenda; a interface deixa essa consequência explícita.

Regras de entrega persistem todos os campos usados por `quote-delivery`: faixa de CEP, bairro/cidade/UF, raio próprio, prioridade, taxa base e por km, limites mínimo/máximo, pedido mínimo, preparo base, minutos por km e tempo adicional. Faixa de CEP vence bairro, que vence cidade/UF; prioridade desempata apenas regras do mesmo nível. O preenchimento e o teste de CEP passam por `quote-delivery`, portanto o navegador não consulta um provedor geográfico diretamente e exibe o endereço normalizado pelo servidor.

## Funções autenticadas

- `update-order-status`: `{ orderId, storeId, status }`;
- `approve-manual-pix`: `{ orderId, storeId }`; a UI só oferece a ação quando método, status e provedor comprovam Pix manual pendente;
- `merchant-update-settings`: `{ storeId, store, settings }`, atualizando os dois registros atomicamente;
- `quote-delivery`: `{ storeId, subtotal, address }`, retornando `available`, `fee`, `estimatedMin`, `estimatedMax` e `reason` quando aplicável;
- `create-subscription-checkout`: `{ storeId, planId, billingType, customerData }`;
- `update-subscription-plan`: `{ storeId, planId, billingType }`;
- `sync-subscription-status` e `cancel-subscription`: `{ storeId }`.

Todas seguem o envelope `{ data, error }`; `error.message` é apresentado de forma recuperável. URLs externas de cobrança devem ser oferecidas como link explícito ao usuário, pois `ctx.navigate` é reservado às rotas da aplicação.

Quando uma operação autenticada recebe um envelope de sessão inválida, expirada, não autenticada ou não autorizada, o cliente solicita uma única renovação pelo cookie HttpOnly, repete a operação uma vez e nunca expõe tokens ao JavaScript. Se a renovação também falhar, a identidade local é limpa e a rota do lojista direciona ao login preservando `redirect`; falhas técnicas de sessão não podem ser apresentadas como pendência de assinatura. Lojistas isentos ainda precisam ter uma loja ativa e não suspensa, mas não consultam `subscriptions` para entrar nas demais rotas.

## CSP e acessibilidade

`merchant.css` é importado como asset estático. Nenhuma página injeta `<style>`, usa atributo `style`, `innerHTML`, React, Tailwind ou biblioteca de componentes. Tabelas têm cabeçalhos e legendas, diálogos têm nome acessível, estados assíncronos usam regiões vivas e os controles permanecem operáveis por teclado. A prévia de cores é desenhada em `canvas` com alternativa textual acessível; raios usam `meter`, rótulo e valor numérico, sem depender apenas da cor.
