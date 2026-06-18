# Auditoria do Fluxo de Assinaturas (Asaas)

## Resumo

Esta auditoria cobre o fluxo de assinaturas da plataforma (cobranca do lojista) integrado ao gateway Asaas, abrangendo checkout, webhook, cliente Asaas, sincronizacao/cancelamento, UI do lojista, UI administrativa e schema do banco.

- **Total de achados brutos:** 28
- **Achados confirmados:** 28

### Distribuicao por severidade

| Severidade | Quantidade |
|---|---|
| Critical | 0 |
| High | 6 |
| Medium | 11 |
| Low | 11 |
| **Total** | **28** |

---

## Achados confirmados

### Severidade: HIGH

#### 1. Ausencia de lock/idempotencia permite condicao de corrida criando multiplas assinaturas no gateway para a mesma loja
- **Arquivo:linha:** `src/server/subscription.service.ts (createSubscriptionCheckoutHandler, loadStorePlanSubscription + createSubscription)`
- **Dimensao:** checkout
- **Descricao:** Entre o SELECT da assinatura existente (loadStorePlanSubscription, sem FOR UPDATE) e a criacao da nova assinatura no gateway nao ha lock nem chave de idempotencia. Dois cliques/requests concorrentes do mesmo usuario leem ambos existingSubscription como inativo/inexistente, ambos chamam createSubscription criando DUAS assinaturas no Asaas. O ON CONFLICT (store_id) faz o ultimo INSERT sobrescrever o anterior localmente, perdendo a referencia ao primeiro asaas_subscription_id, que fica orfao e ativo no gateway (cobranca dupla). O externalReference e fixo por loja mas nao e usado como idempotency key na chamada ao gateway.
- **Correcao sugerida:** Adquirir lock na linha de subscriptions (SELECT ... FOR UPDATE dentro de transacao) ou usar advisory lock por store_id antes de criar no gateway; enviar uma idempotency key estavel ao gateway para evitar criacao duplicada em retries/concorrencia.
- **Racional da verificacao:** Achado CONFIRMADO no codigo atual de src/server/subscription.service.ts e corroborado por src/server/asaas.server.ts.

  Evidencia verificada:
  1) loadStorePlanSubscription executa o SELECT da assinatura (`SELECT s.* ... FROM public.subscriptions s ... WHERE s.store_id = $1::uuid LIMIT 1`) via Promise.all, SEM FOR UPDATE e SEM transacao envolvente.
  2) createSubscriptionCheckoutHandler le existingSubscription, valida com isActiveSubscription/validateUpgrade, define `const externalReference = `platform-subscription:${data.storeId}`` e em seguida chama `await deps.createSubscription(buildGatewaySubscriptionPayload({...}))` sem qualquer lock, advisory lock ou idempotency key entre o read e a criacao no gateway. Ha inclusive uma chamada de rede intermediaria (createCustomer) que amplia a janela de corrida.
  3) buildGatewaySubscriptionPayload coloca externalReference no corpo do payload, mas NAO como chave de idempotencia. Confirmei em asaas.server.ts que asaasRequest aceita options.idempotencyKey (header 'Idempotency-Key'), porem asaas.createSubscription nao repassa idempotencyKey algum. Logo a capacidade existe e simplesmente nao e usada.
  4) persistSubscription usa INSERT ... ON CONFLICT (store_id) DO UPDATE SET asaas_subscription_id = COALESCE(EXCLUDED.asaas_subscription_id, public.subscriptions.asaas_subscription_id). Como EXCLUDED.asaas_subscription_id e o id da NOVA assinatura (nao nulo), o COALESCE retorna o novo valor, sobrescrevendo o anterior e perdendo a referencia ao primeiro asaas_subscription_id.
  5) O bloco cancelExistingGatewaySubscription so atua se existingSubscription?.asaas_subscription_id existir; em corrida ambos os requests leram esse campo como nulo/inativo, portanto nenhum cancela o outro, deixando a primeira assinatura orfa e ativa no Asaas -> cobranca dupla real.

  Cenario de corrida: dois requests concorrentes do mesmo usuario (double-click/double-submit) leem existingSubscription como inativo/inexistente, ambos chamam createSubscription criando DUAS assinaturas no Asaas; o ON CONFLICT (store_id) protege apenas a linha local mas nao impede a dupla criacao no gateway. Nao ha transacao, FOR UPDATE, advisory lock nem unique constraint do tipo (store_id, status=ativa) que previna.

  Tentei refutar lendo o codigo real e nao encontrei nenhum mecanismo de protecao. A evidencia bate integralmente.

  Severidade high (nao critical): impacto financeiro direto (cobranca duplicada + assinatura orfa ativa no gateway), mas exploravel apenas sob concorrencia de timing (double-submit simultaneo), o que reduz a probabilidade frente a um bug deterministico.

#### 2. Eventos REFUNDED/PARTIALLY_REFUNDED nao revertem o status da assinatura
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/webhooks.ts`
- **Dimensao:** webhook
- **Descricao:** paymentStatusForEvent mapeia PAYMENT_REFUNDED/PAYMENT_PARTIALLY_REFUNDED para 'estornado' e o fluxo segue normalmente. Porem updateSubscriptionIfPresent so calcula status para paidEvents/failedEvents/cancelledEvents; para refundedEvents o ternario cai em 'null' e a funcao retorna sem alterar a assinatura. Resultado: uma assinatura ('platform-subscription:...') que foi paga e depois estornada continua com status 'ativa' e o periodo (current_period_end) intacto, dando acesso indevido apos reembolso.
- **Correcao sugerida:** Adicionar um ramo para refundedEvents (e chargeback) em updateSubscriptionIfPresent que coloque a assinatura em 'cancelada'/'inadimplente' e zere/encurte current_period_end e cancellation_effective_at, ou tratar estorno explicitamente como revogacao de acesso.
- **Racional da verificacao:** Confirmado lendo /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/webhooks.ts. A evidencia bate exatamente com o codigo atual.

  Fluxo verificado:
  1. paymentStatusForEvent mapeia PAYMENT_REFUNDED/PAYMENT_PARTIALLY_REFUNDED para "estornado", entao mappedStatus e truthy e o handler NAO faz o early-return em `if (!mappedStatus)`.
  2. updateSubscriptionIfPresent(event, payment) calcula `status` via ternario que so cobre paidEvents("ativa"), failedEvents("inadimplente"), cancelledEvents("cancelada"); para refundedEvents cai em null. Logo `if (!status) return false;` retorna ANTES do UPDATE em public.subscriptions. Nenhuma coluna (status, current_period_end, canceled_at) e alterada.
  3. De volta no handler, updatedSubscription=false, entao o ramo de early-return para "platform-subscription:" nao dispara. O fluxo segue para withTransaction.
  4. No withTransaction o SELECT faz JOIN entre payments e orders; para uma assinatura de plataforma nao ha order correspondente, entao localPayment e undefined, apenas registra o payment_event e retorna {updated:false}. A assinatura nao e tocada em nenhum ponto.

  Conclusao: uma assinatura paga que recebe reembolso permanece com status 'ativa' e current_period_end intacto, concedendo acesso indevido apos o estorno. refundedEvents nunca participa do calculo de status da assinatura em nenhum lugar do arquivo.

  Severidade ALTA (nao critica): exige webhook de reembolso autenticado (asaas-access-token validado por safeEqual) para uma assinatura previamente paga; impacto e acesso pago continuado indevido, sem corrupcao de dados nem exposicao de dados sensiveis. Nuance: para reembolso parcial nao revogar pode ser aceitavel, mas o reembolso total claramente deveria revogar e cai no mesmo caminho sem tratamento. O evento ainda e auditado em payment_events, mas o efeito de negocio (revogar acesso) nao ocorre.

#### 3. Eventos de CHARGEBACK sao ignorados silenciosamente
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/webhooks.ts`
- **Dimensao:** webhook
- **Descricao:** Nenhum dos Sets (paidEvents, failedEvents, cancelledEvents, refundedEvents) contem PAYMENT_CHARGEBACK_REQUESTED, PAYMENT_CHARGEBACK_DISPUTE nem PAYMENT_AWAITING_CHARGEBACK_REVERSAL. Para esses eventos paymentStatusForEvent retorna null e o handler responde { success: true, ignored: true } sem alterar pagamento, pedido ou assinatura. Um pedido/assinatura ja marcado como 'pago'/'ativa' permanece assim apos um chargeback, causando perda financeira sem rastro de reversao.
- **Correcao sugerida:** Mapear explicitamente os eventos de chargeback do Asaas para um status terminal (ex.: 'estornado'/'contestado') tanto em payments/orders quanto na assinatura, revertendo paid_at e revogando o periodo.
- **Racional da verificacao:** Achado CONFIRMADO no código atual de /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/webhooks.ts.

  Verificacao da evidencia:
  - Os quatro Sets (linhas 6-9) sao: paidEvents={PAYMENT_RECEIVED,PAYMENT_CONFIRMED}, failedEvents={PAYMENT_OVERDUE}, cancelledEvents={PAYMENT_DELETED,PAYMENT_CANCELLED}, refundedEvents={PAYMENT_REFUNDED,PAYMENT_PARTIALLY_REFUNDED}. Nenhum contem PAYMENT_CHARGEBACK_REQUESTED, PAYMENT_CHARGEBACK_DISPUTE nem PAYMENT_AWAITING_CHARGEBACK_REVERSAL.
  - paymentStatusForEvent retorna null para qualquer evento fora desses Sets, logo retorna null para os eventos de chargeback.
  - A linha citada bate exatamente: 'const mappedStatus = paymentStatusForEvent(event); if (!mappedStatus) return Response.json({ success: true, ignored: true });'. O early-return ocorre antes de qualquer atualizacao de payment/order/subscription.

  Tentativas de refutacao (falharam):
  1. Antes do mappedStatus so existem: validacao de runtime/secret, parse JSON, ramo SUBSCRIPTION_* (so para event.startsWith('SUBSCRIPTION_')), e validacao de payload. Eventos PAYMENT_CHARGEBACK_* com payment.id e externalReference/subscription validos passam pela validacao e caem direto no if(!mappedStatus), saindo silenciosamente.
  2. updateSubscriptionIfPresent so e chamada DEPOIS do return de mappedStatus, portanto nunca alcancada para chargeback; alem disso so mapeia ativa/inadimplente/cancelada.
  3. Nenhum tratamento alternativo de reversao existe neste handler, que e o ponto unico de entrada do webhook Asaas.

  Consequencia: pedido permanece payment_status='pago' e assinatura permanece 'ativa' apos um chargeback, sem rastro de reversao -> inconsistencia de estado e perda financeira.

  Severidade: high (e nao critical) porque depende de um evento externo legitimo do adquirente/Asaas, nao e explorable diretamente por atacante, mas causa impacto financeiro/estado incorreto real e silencioso.

#### 4. createSubscription/updateSubscription nao usam Idempotency-Key apesar do timeout de aborto
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/server/asaas.server.ts:asaas.createSubscription`
- **Dimensao:** asaas-client
- **Descricao:** asaasRequest aceita options.idempotencyKey e adiciona o header 'Idempotency-Key' (suportado pela API Asaas v3) somente quando informado. Porem createSubscription e updateSubscription nunca passam esse options. Combinado com o AbortController de 25s, um POST de assinatura com cartao que chega ao Asaas mas cuja resposta demora alem do timeout retorna {errors: [timeout]} ao chamador; uma nova tentativa do usuario (ou retry de fluxo) cria uma segunda assinatura/cobranca duplicada no gateway, pois nada deduplica a requisicao. O externalReference (platform-subscription:storeId) e estavel e poderia servir de base para a chave de idempotencia, mas nao e usado.
- **Correcao sugerida:** Passar um idempotencyKey deterministico nas chamadas de criacao/atualizacao de assinatura, por exemplo derivado de data.externalReference + tipo de operacao, repassando-o a asaasRequest via o parametro options ja existente, para evitar assinaturas duplicadas em caso de timeout/retry.
- **Racional da verificacao:** Achado CONFIRMADO no codigo atual. Em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/server/asaas.server.ts: (1) asaasRequest tem assinatura (endpoint, method, apiKey, body?, options?: { idempotencyKey?: string }) e seta headers['Idempotency-Key'] = options.idempotencyKey somente quando informado; (2) createSubscription chama asaasRequest('/subscriptions','POST',ASAAS_API_KEY,data) e updateSubscription chama asaasRequest(`/subscriptions/${id}`,'PUT',ASAAS_API_KEY,data) — ambos SEM o 4o/5o argumento options, ou seja, nunca enviam Idempotency-Key; (3) existe AbortController com ASAAS_REQUEST_TIMEOUT_MS=25000 que no AbortError retorna { errors: [{ description: 'Tempo esgotado...' }] }. A evidencia bate exatamente.

  Confirmacao do impacto em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/server/subscription.service.ts: externalReference = `platform-subscription:${data.storeId}` e estavel e poderia servir de base de chave. No createSubscriptionCheckoutHandler, em caso de timeout, subscription.errors e truthy e a funcao lanca erro ANTES de persistSubscription, entao o asaas_subscription_id NUNCA e gravado no DB. Numa nova tentativa, loadStorePlanSubscription nao encontra ID persistido, o fluxo cria OUTRA assinatura no Asaas, e cancelExistingGatewaySubscription nao roda para a assinatura orfa (so cancela quando ha asaas_subscription_id persistido). Resultado: duas assinaturas/cobrancas de cartao com mesmo externalReference no gateway, sem deduplicacao. O mesmo padrao de criacao sem idempotencia ocorre no caminho CREDIT_CARD de updateSubscriptionPlanHandler. A infra de idempotencia ja existe e e usada na assinatura de createStorePayment, reforcando que foi propositalmente nao ligada nas assinaturas.

  Severidade high (nao critical): a duplicacao depende de uma janela estreita (resposta do gateway demorar >25s) combinada com retry do usuario/fluxo; ha mitigacoes parciais (ON CONFLICT (store_id) mantem 1 linha local e cancelamento da assinatura conhecida), mas a assinatura orfa do timeout nao tem ID conhecido e nao e cancelada, gerando cobranca duplicada real em cartao do cliente, com impacto financeiro e de confianca.

#### 5. changePlan grava status 'ativa' direto no banco sem passar pelo gateway (Asaas)
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/admin/AdminStores.tsx`
- **Dimensao:** admin-ui
- **Descricao:** A acao de alterar plano no admin faz UPDATE/INSERT direto em subscriptions forcando status: 'ativa' (e is_active: true na store), sem criar/atualizar a assinatura no Asaas. Isso gera inconsistencia entre o status exibido/armazenado ('ativa') e o estado real no gateway. O fluxo legitimo (src/server/subscription.service.ts) grava 'pendente_pagamento' ate confirmacao de pagamento via webhook/sync; o admin curto-circuita esse fluxo, podendo liberar acesso pago sem cobranca ativa e deixando asaas_subscription_id/last_payment_status defasados.
- **Correcao sugerida:** Para planos pagos, acionar o handler de assinatura do servidor (updateSubscriptionPlanHandler/checkout) em vez de forcar status 'ativa' no client. Reservar a gravacao direta de 'ativa' apenas para cortesia/isento e deixar claro na UI que e cortesia, sem mexer no asaas_subscription_id.
- **Racional da verificacao:** Achado CONFIRMADO. A evidencia bate exatamente com o codigo atual.

  Em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/admin/AdminStores.tsx, a funcao changePlan (ramo de plano pago, nao-cortesia) executa:
  - backend.from("subscriptions").update({ plan_id: planId, status: "ativa" }).eq("store_id", store.id)  (quando ja existe sub)
  - backend.from("subscriptions").insert({ store_id: store.id, plan_id: planId, status: "ativa" })  (quando nao existe)
  - backend.from("stores").update({ plan_id: planId, is_active: true }).eq("id", store.id)

  Nenhuma chamada ao Asaas e feita. Nao ha invoke de edge function nem chamada a asaas/subscription service. Note que outras acoes do mesmo arquivo (remove, handleCreateStore) usam backend.functions.invoke(...), provando que existe um caminho server-side disponivel mas que NAO e usado em changePlan. O ramo "cortesia" tem justificativa (plano isento), mas o ramo de plano PAGO grava status 'ativa' diretamente sem cobranca.

  Contraste com o fluxo legitimo confirmado em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/server/subscription.service.ts:
  - createSubscriptionCheckoutHandler e updateSubscriptionPlanHandler criam/atualizam a assinatura no Asaas (createCustomer/createSubscription/updateSubscription) e persistem status 'pendente_pagamento' (persistSubscription com status: "pendente_pagamento" e last_payment_status 'pending').
  - A transicao para 'ativa' so ocorre via syncSubscriptionStatusHandler quando ha pagamento confirmado no gateway (gatewayPaidPaymentStatuses: CONFIRMED/RECEIVED/RECEIVED_IN_CASH).
  - updateSubscriptionPlanHandler inclusive exige asaas_subscription_id existente (lanca "Assinatura existente nao encontrada").

  Portanto o admin curto-circuita o gateway: marca status 'ativa' + is_active true sem criar/atualizar assinatura no Asaas, sem setar asaas_subscription_id/asaas_customer_id/billing_type/last_payment_status/next_due_date, deixando esses campos defasados ou nulos. Isso libera acesso pago sem cobranca ativa e gera inconsistencia entre o estado armazenado e o gateway.

  Severidade: high (e nao critical). E uma rota administrativa (requer privilegio de admin), nao exposta a usuario final, e existe uso legitimo proximo (cortesia/isencao). O impacto e inconsistencia de billing e bypass de cobranca via acao manual de admin, nao uma escalada de privilegio explorada externamente. Mas o problema de codigo existe de fato no ramo de plano pago.

#### 6. Coluna provider referenciada no INSERT/UPSERT de subscriptions nao existe no schema
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/server/subscription.service.ts:~250 (persistSubscription)`
- **Dimensao:** schema
- **Descricao:** A funcao persistSubscription faz INSERT na coluna provider e tambem ON CONFLICT DO UPDATE SET provider = EXCLUDED.provider. Porem a tabela public.subscriptions nunca recebe a coluna provider: a definicao base (db/migrations/20260521143000_production_hardening.sql) cria subscriptions com apenas id, store_id, plan_id, asaas_subscription_id, status, last_payment_status, created_at, updated_at; e a migration 20260526110000_subscription_and_manual_pix.sql adiciona somente asaas_customer_id, billing_type, external_reference, current_period_start, current_period_end, next_due_date, canceled_at, cancellation_effective_at. Nenhuma das 10 migrations adiciona provider em subscriptions (so existe provider em payments e payment_events). Resultado: todo checkout/atualizacao de plano via createSubscriptionCheckoutHandler e updateSubscriptionPlanHandler falha em runtime com erro Postgres 'column "provider" of relation "subscriptions" does not exist'. As demais colusas usadas pelo codigo (asaas_customer_id, asaas_subscription_id, billing_type, external_reference, last_payment_status, next_due_date, current_period_start/end, canceled_at, cancellation_effective_at) existem e estao com tipos coerentes. O UNIQUE(store_id) exigido pelo ON CONFLICT (store_id) esta presente (store_id uuid UNIQUE NOT NULL).
- **Correcao sugerida:** Adicionar a coluna ao schema via nova migration idempotente: ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS provider text DEFAULT 'asaas'; (e opcionalmente UPDATE para backfill). Alternativamente, remover provider do INSERT/ON CONFLICT em persistSubscription se a coluna nao for necessaria. A primeira opcao e a recomendada pois o codigo grava 'asaas' explicitamente.
- **Racional da verificacao:** Confirmado apos leitura do codigo real e de TODAS as 10 migrations + db/schema.sql.

  1) Codigo (src/server/subscription.service.ts, funcao persistSubscription, ~linha 250): o INSERT lista a coluna `provider` e o ON CONFLICT (store_id) DO UPDATE contem `provider = EXCLUDED.provider`. Trecho bate exatamente com a evidencia (VALUES ($1::uuid, $2::uuid, 'asaas', ...) ... ON CONFLICT (store_id) DO UPDATE SET ... provider = EXCLUDED.provider).

  2) Definicao da tabela em db/migrations/20260521143000_production_hardening.sql cria public.subscriptions apenas com: id, store_id (uuid UNIQUE NOT NULL), plan_id, asaas_subscription_id, status, last_payment_status, created_at, updated_at. NAO ha provider.

  3) db/migrations/20260526110000_subscription_and_manual_pix.sql adiciona somente: asaas_customer_id, billing_type, external_reference, current_period_start, current_period_end, next_due_date, canceled_at, cancellation_effective_at. NAO ha provider.

  4) Busquei `provider` em todas as migrations: aparece apenas em payments (text DEFAULT 'asaas'), payment_events (provider NOT NULL), notification_events e store_settings.payment_gateway_provider. Nenhuma migration faz ALTER TABLE public.subscriptions ADD COLUMN provider. db/schema.sql e apenas um comentario apontando para db/migrations (nao define schema). Nao ha migrations em TS.

  5) O UNIQUE(store_id) exigido pelo ON CONFLICT (store_id) existe (store_id uuid UNIQUE NOT NULL), entao o conflito-target e valido; o unico problema e a coluna provider inexistente.

  Resultado: o Postgres faz parse/planejamento da instrucao antes de executar e lança erro deterministico 'column "provider" of relation "subscriptions" does not exist'. Tanto createSubscriptionCheckoutHandler quanto updateSubscriptionPlanHandler chamam persistSubscription, logo todo o fluxo de checkout pago e troca de plano falha 100% das vezes em runtime.

  Severidade: alta (nao critica). Quebra completa e deterministica de uma feature central de monetizacao (assinaturas pagas / upgrade de plano), mas nao e vulnerabilidade de seguranca, corrupcao de dados nem afeta o sistema inteiro. Correcao trivial: adicionar coluna provider a subscriptions via migration, ou remover provider do INSERT/UPSERT.

---

### Severidade: MEDIUM

#### 1. createSubscription que falha APOS persistSubscription nao pode ocorrer, mas a ordem de cancelamento da assinatura anterior deixa janela de assinatura duplicada ativa no gateway
- **Arquivo:linha:** `src/server/subscription.service.ts (createSubscriptionCheckoutHandler, blocos createSubscription -> persistSubscription -> cancelExistingGatewaySubscription)`
- **Dimensao:** checkout
- **Descricao:** A nova assinatura e criada no gateway e persistida ANTES de cancelar a anterior. Se cancelExistingGatewaySubscription falhar (a chamada usa .catch(()=>null) e apenas loga), a assinatura antiga continua ativa no Asaas e o cliente passa a ter DUAS assinaturas cobrando (a nova ja persistida + a antiga nao cancelada). Como o registro local tem unique (store_id), o local fica consistente, mas no gateway ha cobranca dupla persistente sem retry nem alerta de erro.
- **Correcao sugerida:** Tratar a falha de cancelamento como erro acionavel (registrar para reprocessamento/fila de reconciliacao) em vez de engolir com catch e console.warn, garantindo que a assinatura antiga seja efetivamente cancelada.
- **Racional da verificacao:** Verifiquei o arquivo /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/server/subscription.service.ts por completo. A evidencia citada bate exatamente com o codigo atual.

  Ordem confirmada em createSubscriptionCheckoutHandler: (1) deps.createSubscription cria a nova assinatura no gateway; (2) se subscription.errors, lanca; (3) persistSubscription grava localmente (status 'pendente_pagamento', ON CONFLICT(store_id) sobrescrevendo o registro antigo); (4) SOMENTE DEPOIS chama cancelExistingGatewaySubscription para a assinatura anterior. A nova assinatura no gateway e criada e persistida ANTES do cancelamento da antiga.

  cancelExistingGatewaySubscription (linhas confirmadas):
    const canceled = await deps.cancelSubscription(subscription.asaas_subscription_id).catch(() => null);
    if (canceled?.errors) { console.warn("Existing Asaas subscription cancel skipped:", ...); }
  O .catch(()=>null) engole excecoes (rede/throw) e os errors de API sao apenas logados via console.warn. Nao ha retry, rollback, nem alerta. Consequencia: se o cancelamento falhar, a assinatura antiga permanece ativa no Asaas enquanto a nova tambem esta ativa -> cobranca duplicada no gateway. Como subscriptions tem unique(store_id) e o INSERT ... ON CONFLICT(store_id) DO UPDATE sobrescreve o registro, o estado local fica consistente e mascara a duplicidade no gateway. Achado CONFIRMADO.

  Fatores que reduzem a severidade (sem refutar): o cancelamento so dispara quando existingSubscription.asaas_subscription_id !== subscription.id, ou seja, apenas no fluxo de troca/upgrade de plano com uma assinatura de gateway distinta pre-existente — nao em toda chamada nem ao recriar a mesma assinatura. Tambem ha skip quando status ja e 'cancelada'/'encerrada'. Portanto a janela de assinatura duplicada e condicional (somente upgrade/troca de plano com gateway sub anterior), best-effort silencioso, e nao e falha de seguranca/autorizacao. E um problema real de confiabilidade/financeiro (cobranca dupla persistente sem retry/alerta), mas condicional e nao garantido em todo caso, o que justifica severidade media em vez de alta.

#### 2. isActiveSubscription so trata status 'ativa'; assinatura 'inadimplente' ou 'pendente_pagamento' existente nao bloqueia nova criacao, gerando duplicidade
- **Arquivo:linha:** `src/server/subscription.service.ts (isActiveSubscription / createSubscriptionCheckoutHandler)`
- **Dimensao:** checkout
- **Descricao:** O early-return e a validacao de upgrade so disparam quando o status e exatamente 'ativa'. Se a loja tem uma assinatura 'pendente_pagamento' (criada por um checkout anterior cujo cartao ainda esta sendo processado) e o usuario reenvia o checkout, o codigo cria OUTRA assinatura no gateway e sobrescreve a anterior via ON CONFLICT, deixando a assinatura pendente anterior orfa e potencialmente ainda cobravel no Asaas.
- **Correcao sugerida:** Tratar tambem estados intermediarios ('pendente_pagamento'/'inadimplente') reaproveitando ou cancelando a assinatura anterior no gateway antes de criar uma nova, ou retornar o invoiceUrl existente quando ainda pendente para o mesmo plano.
- **Racional da verificacao:** A evidencia bate exatamente com o codigo atual em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/server/subscription.service.ts: `const isActiveSubscription = (subscription: any) => String(subscription?.status || "") === "ativa";` e o early-return/validateUpgrade so disparam dentro de `if (isActiveSubscription(existingSubscription))`. Confirmado: quando a assinatura existente tem status 'pendente_pagamento' ou 'inadimplente', isActiveSubscription retorna false, o bloco de bloqueio/validacao e pulado, e o handler segue criando OUTRA assinatura no gateway via deps.createSubscription(...) e sobrescrevendo a linha local via persistSubscription com INSERT ... ON CONFLICT (store_id) DO UPDATE. Isso gera duplicidade no Asaas (a segunda assinatura e criada antes de qualquer cancelamento da anterior) e o asaas_subscription_id anterior e substituido na linha local.

  Refutacao parcial encontrada: o achado afirma que a anterior fica simplesmente orfa, mas existe uma mitigacao best-effort que a descricao nao menciona: apos persistir, ha `if (existingSubscription?.asaas_subscription_id && existingSubscription.asaas_subscription_id !== subscription.id) { await cancelExistingGatewaySubscription(...) }`. Contudo essa mitigacao e fragil: cancelExistingGatewaySubscription usa `.catch(() => null)` e em caso de falha apenas emite console.warn e prossegue, deixando a assinatura anterior potencialmente ainda cobravel no Asaas (exatamente o risco descrito). Alem disso, se o checkout anterior falhou antes de salvar asaas_subscription_id, nao ha referencia para cancelar e a anterior fica realmente orfa. Tambem existe janela de duplicidade transitoria pois a nova assinatura e criada no gateway antes do cancelamento.

  Conclusao: o problema EXISTE (estados nao-'ativa' nao bloqueiam nova criacao, gerando duplicidade e risco de cobranca dupla). Severidade rebaixada para medium (e nao alta) porque ha tentativa de cancelamento best-effort que reduz, mas nao elimina, o impacto; requer pre-condicao especifica (assinatura pendente/inadimplente preexistente e reenvio de checkout) e falha do cancelamento ou perda de referencia para se materializar em cobranca duplicada persistente.

#### 3. validateUpgrade so e chamado quando a assinatura existente esta 'ativa', permitindo downgrade nao validado em assinaturas pendentes/inadimplentes
- **Arquivo:linha:** `src/server/subscription.service.ts (createSubscriptionCheckoutHandler)`
- **Dimensao:** checkout
- **Descricao:** A regra de bloqueio de downgrade (validateUpgrade) so executa dentro do bloco isActiveSubscription. Se a assinatura existente estiver 'pendente_pagamento' ou 'inadimplente', o usuario pode trocar para um plano de menor valor sem qualquer validacao, contornando a regra de negocio de 'downgrade nao permitido neste fluxo'.
- **Correcao sugerida:** Chamar validateUpgrade para qualquer assinatura existente com plan_id definido (independente do status), nao apenas quando 'ativa'.
- **Racional da verificacao:** Confirmado no codigo real de /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/server/subscription.service.ts. Em createSubscriptionCheckoutHandler, a chamada validateUpgrade(existingSubscription, plan) esta DENTRO do bloco if (isActiveSubscription(existingSubscription)). A funcao isActiveSubscription retorna true somente quando String(subscription?.status) === "ativa". Portanto, quando a assinatura existente esta com status "pendente_pagamento" ou "inadimplente", o fluxo nao executa validateUpgrade e segue direto para deps.createSubscription, criando a nova assinatura sem validar a regra de downgrade. A evidencia citada bate exatamente com o codigo. Reforco do achado: o handler updateSubscriptionPlanHandler chama validateUpgrade(subscription, plan) de forma incondicional (independente do status), o que demonstra que a omissao no checkout handler e uma inconsistencia real e nao um design intencional. Severidade reduzida para medium porque: (1) e bypass de regra de negocio (downgrade nao permitido) e nao falha de autenticacao/autorizacao - o acesso continua protegido por assertStoreAccess exigindo que o usuario seja dono da loja ou admin; (2) o impacto e comercial/financeiro moderado (usuario pode trocar para plano mais barato em estado pendente/inadimplente) e nao exposicao de dados ou comprometimento de seguranca.

#### 4. next_due_date e current_period_end usam o vencimento da cobranca ja paga, nao o proximo ciclo
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/webhooks.ts`
- **Dimensao:** webhook
- **Descricao:** Em evento pago, dueDate vem de payment.dueDate/originalDueDate (vencimento da cobranca que acabou de ser paga). O UPDATE define next_due_date = COALESCE($5::date, next_due_date) e current_period_end = ($5::date + INTERVAL '30 days'). Assim next_due_date passa a apontar para um vencimento que ja foi quitado (passado), em vez do proximo ciclo, e o periodo eh ancorado na data da cobranca atual em vez da data de pagamento. Isso desalinha a renovacao/cobranca de inadimplencia.
- **Correcao sugerida:** Para assinaturas, usar o proximo vencimento (next due date informado pela API de subscription do Asaas) e nao o dueDate da cobranca paga; ou calcular next_due_date = dueDate + 1 ciclo. Ancorar current_period_start na paymentDate e current_period_end em start + intervalo do plano.
- **Racional da verificacao:** Achado CONFIRMADO. O codigo em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/webhooks.ts corresponde fielmente a evidencia.

  Em updateSubscriptionIfPresent:
  - `const dueDate = payment.dueDate || payment.originalDueDate || null;` -> esse valor (parametro $5) e o vencimento da cobranca que acabou de ser paga, nao o proximo ciclo. Em eventos PAYMENT_RECEIVED/PAYMENT_CONFIRMED, payment.dueDate refere-se a propria parcela quitada (comportamento padrao da API Asaas), nao a proxima.

  No UPDATE:
  - `next_due_date = COALESCE($5::date, next_due_date)` -> next_due_date passa a apontar para a dueDate da cobranca ja paga (passada/atual), em vez de avancar ~30 dias para o proximo vencimento. Confirma o desalinhamento descrito.
  - `current_period_end = CASE WHEN $1 = 'ativa' THEN COALESCE(($5::date + INTERVAL '30 days')::timestamptz, ...)` -> ancorado em $5 (dueDate) e nao em $4 (paidAt). Como o primeiro termo do COALESCE e nao-nulo quando dueDate existe, ele prevalece. Ha inconsistencia adicional: current_period_start usa $4 (paidAt/now), enquanto current_period_end usa dueDate+30, o que pode produzir um periodo logicamente incoerente quando dueDate diverge da data de pagamento.

  Consequencias praticas: renovacao e deteccao de inadimplencia ficam ancoradas na data da cobranca ja quitada, e cancellation_effective_at deriva de current_period_end/next_due_date potencialmente passados.

  Severidade reduzida para medium (e nao high) porque: nao e falha de seguranca; o termo +30 dias atenua parcialmente o erro fornecendo uma janela; o impacto pleno depende do fluxo de assinaturas de plataforma; e nao ha perda de dados nem comprometimento de integridade transacional. E um bug de logica de negocio real que merece correcao (usar a data de pagamento como ancora e calcular o proximo vencimento como dueDate + 1 ciclo).

#### 5. Terceiro criterio do WHERE pode casar assinatura errada quando externalReference nao tem o prefixo platform-subscription
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/webhooks.ts`
- **Dimensao:** webhook
- **Descricao:** No UPDATE de subscriptions o terceiro criterio eh store_id::text = regexp_replace(COALESCE($6,''),'^platform-subscription:',''). Quando externalReference NAO comeca com 'platform-subscription:' (ex.: pagamento de PEDIDO normal cujo externalReference eh o id da ORDER ou o store_id), regexp_replace devolve a string original inalterada. Se essa string coincidir com um store_id existente, a assinatura daquela loja eh alterada (status/periodo) por um webhook que era de um pedido comum, nao de assinatura de plataforma.
- **Correcao sugerida:** So aplicar o casamento por store_id quando o externalReference realmente comecar com 'platform-subscription:' (verificar o prefixo em JS antes de montar o criterio, ou usar CASE WHEN $6 LIKE 'platform-subscription:%' THEN ... no SQL).
- **Racional da verificacao:** A evidencia bate exatamente com o codigo atual em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/webhooks.ts (funcao updateSubscriptionIfPresent). O terceiro criterio do WHERE eh: store_id::text = regexp_replace(COALESCE($6, ''), '^platform-subscription:', ''), com $6 = payment.externalReference. Comportamento confirmado: regexp_replace so remove o prefixo se ele existir; caso contrario devolve a string inalterada. Portanto, para um externalReference SEM o prefixo (ex.: pagamento de pedido comum), o criterio degenera para store_id::text = '<externalReference>', sem qualquer guard de prefixo. Confirmei tambem que updateSubscriptionIfPresent eh chamada incondicionalmente para TODO webhook de pagamento, ANTES de qualquer verificacao de prefixo; o startsWith('platform-subscription:') so eh avaliado depois, apenas para decidir o early-return, nao para gatekeep o UPDATE que ja rodou. O guard de entrada (status valido + presenca de externalReference/subscription) eh facilmente satisfeito por um pagamento de pedido normal. Logo, se externalReference coincidir com um store_id existente, a assinatura daquela loja eh alterada indevidamente. O defeito de design existe de fato. Severidade rebaixada para media (nao alta) porque a query principal de pagamentos trata externalReference como order_id (p.order_id::text = $2), sugerindo que no fluxo comum externalReference eh um order_id (UUID), tornando a colisao acidental com um store_id (tambem provavelmente UUID, namespace distinto) improvavel na pratica; o impacto real depende do formato concreto de externalReference em todos os fluxos de criacao, que nao pude verificar neste arquivo. Mesmo assim, o match por igualdade direta sem guard de prefixo eh um bug concreto e explorável em cenarios onde externalReference seja/contenha um store_id.

#### 6. Webhook aceito sem autenticacao quando ASAAS_WEBHOOK_SECRET ausente em ambiente nao-producao
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/webhooks.ts`
- **Dimensao:** webhook
- **Descricao:** A verificacao do header asaas-access-token so ocorre 'if (secret && !safeEqual(...))'. validateRuntimeEnv({ requireWebhookSecret: true }) deveria garantir o secret, mas se em algum runtime nao-producao o secret estiver vazio/undefined (e validateRuntimeEnv nao bloquear fora de producao), o handler segue sem exigir token e processa o payload. Em producao ha o guard '!secret && isProductionRuntime()', porem fora de producao qualquer requisicao sem token eh aceita.
- **Correcao sugerida:** Exigir o secret e o token em todos os ambientes (rejeitar 401 sempre que accessToken nao bater), garantindo que validateRuntimeEnv realmente impeca subir sem ASAAS_WEBHOOK_SECRET fora de producao tambem.
- **Racional da verificacao:** A evidencia bate exatamente com o codigo atual em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/webhooks.ts. No handler handleAsaasWebhook: secret = process.env.ASAAS_WEBHOOK_SECRET?.trim(); a verificacao do header so ocorre em 'if (secret && !safeEqual(accessToken, secret))', logo quando secret eh falsy a checagem de token eh totalmente pulada; e o unico guard de bloqueio sem secret eh 'if (!secret && isProductionRuntime())' que so dispara em producao.

  Tentei refutar a premissa lendo /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/env.ts. validateRuntimeEnv comeca com 'if (!isProduction()) return;', ou seja, fora de producao retorna imediatamente sem validar requireWebhookSecret. Isso CONFIRMA a premissa do achado: fora de producao o secret nao eh garantido e o handler processa o payload sem exigir o header asaas-access-token. Uma requisicao forjada sem token seria aceita.

  Em producao o problema NAO existe: ha dupla protecao (validateRuntimeEnv lanca erro -> 500, e o guard '!secret && isProductionRuntime()' -> 500). Por isso o impacto fica restrito a ambientes nao-producao (dev/staging/test). A exploracao requer um ambiente nao-producao exposto a rede com ASAAS_WEBHOOK_SECRET ausente/vazio, e o efeito so altera estado real se existir payment/order local correspondente (incluindo verificacao de valor divergente para evento 'pago'). Por depender dessa condicao de configuracao especifica e nao afetar producao, classifico como severidade medium, nao high/critical.

#### 7. listSubscriptionPayments nao envia paginacao/limit e pode perder a cobranca paga
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/server/asaas.server.ts:asaas.listSubscriptionPayments`
- **Dimensao:** asaas-client
- **Descricao:** O endpoint GET /subscriptions/{id}/payments da API Asaas v3 e paginado e retorna no maximo 10 itens por padrao (limit=10), com paginacao via offset/limit. O cliente monta a URL sem nenhum query param (limit/offset/status), entao sempre traz apenas a primeira pagina. Em syncSubscriptionStatusHandler, normalizeGatewayPayments le response.data e procura a cobranca CONFIRMED/RECEIVED entre os itens recebidos. Para uma assinatura com mais de 10 cobrancas (varios meses), a cobranca paga mais recente pode estar fora da primeira pagina, fazendo o sync nao detectar o pagamento (referencePayment cai em payments[0] ou em nenhum), marcando a assinatura como inadimplente/pendente incorretamente.
- **Correcao sugerida:** Anexar query params (ex.: ?limit=100&offset=0&order=desc) e, idealmente, iterar enquanto hasMore for true para coletar todas as cobrancas, ou filtrar por status diretamente na query (status=CONFIRMED etc). Isso garante que a cobranca paga mais recente seja considerada independentemente do numero total de cobrancas.
- **Racional da verificacao:** Achado CONFIRMADO no codigo atual. A evidencia bate exatamente: em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/server/asaas.server.ts, listSubscriptionPayments faz `return asaasRequest(\`/subscriptions/${encodeURIComponent(subscriptionId)}/payments\`, 'GET', ASAAS_API_KEY);` sem nenhum query param (sem limit, sem offset, sem status). O endpoint GET /subscriptions/{id}/payments da API Asaas v3 e paginado com limit padrao 10, entao apenas a primeira pagina e retornada.

  Confirmei o consumo em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/server/subscription.service.ts: syncSubscriptionStatusHandler chama deps.listSubscriptionPayments(...) e passa o resultado a normalizeGatewayPayments, que le Array.isArray(response?.data) e faz sort em memoria (decrescente por timestamp). Em seguida paidPayment = payments.find(status in {CONFIRMED, RECEIVED, RECEIVED_IN_CASH}). Como o sort so reordena os <=10 itens ja recebidos, se a cobranca paga relevante estiver fora da pagina 1 (assinatura com >10 cobrancas / varios meses), paidPayment fica undefined e a assinatura nao e marcada como 'ativa'. O codigo cai no ramo `!paidPayment && !failedPayment`, que apenas atualiza last_payment_status sem ativar — pagamento real nao detectado pelo sync.

  Ajustes ao texto do achado (cetico): (1) referencePayment cai em payments[0] da pagina, nao necessariamente o pagamento real; (2) a afirmacao de marcar 'inadimplente incorretamente' e imprecisa — o ramo inadimplente so dispara se houver failedPayment entre os 10 itens; sem pago nem falho, so atualiza last_payment_status e nao ativa. O efeito central (nao detectar o pagamento, deixando a assinatura nao-ativada) e real.

  Severidade rebaixada para medium (nao high) porque: (a) so se manifesta com mais de ~10 cobrancas E quando a pagina 1 nao contem o pagamento relevante; (b) existe a rota de webhook /api/webhooks/asaas como caminho primario de ativacao, tornando esse sync um fallback de reconciliacao, o que mitiga o impacto. Correcao recomendada: enviar limit (ate 100), iterar offset, e/ou filtrar com query param status=CONFIRMED,RECEIVED na chamada.

#### 8. current_period_start e current_period_end usam ancoras diferentes (paidAt vs dueDate+30), gerando periodo incoerente em pagamento atrasado
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/server/subscription.service.ts:~430 (UPDATE em syncSubscriptionStatusHandler)`
- **Dimensao:** sync-cancel
- **Descricao:** Ao marcar a assinatura como 'ativa', o current_period_start e calculado a partir de paidAt ($4 = paymentDate/confirmedDate/clientPaymentDate da cobranca paga), porem o current_period_end e calculado a partir de dueDate ($5) somando +30 dias. Como start e end usam ancoras diferentes, o tamanho real do periodo nao e 30 dias: ele e (dueDate + 30) - paidAt. Em pagamento adiantado o periodo fica MAIOR que 30 dias; em pagamento atrasado fica MENOR que 30 dias, podendo ate resultar em current_period_end ANTERIOR ao current_period_start (quando paidAt > dueDate + 30). Isso afeta diretamente o cancelSubscriptionHandler, que usa effectiveAt = subscription.current_period_end como data de efeito do cancelamento ao fim do periodo, podendo encerrar acesso no passado. O esperado seria ancorar ambos no mesmo marco (ex.: paidAt como inicio e paidAt + 30 como fim, ou dueDate para ambos).
- **Correcao sugerida:** Ancorar inicio e fim no mesmo marco. Ex.: current_period_end = COALESCE(($4::date + INTERVAL '30 days')::timestamptz, ...) usando paidAt; ou usar dueDate tanto para start quanto para end. Aplicar a mesma correcao no webhook (updateSubscriptionIfPresent) para manter os dois caminhos coerentes.
- **Racional da verificacao:** Confirmado lendo /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/server/subscription.service.ts (handler syncSubscriptionStatusHandler). A evidencia bate exatamente com o codigo atual.

  A query UPDATE possui:
    current_period_start = CASE WHEN $2 = 'ativa' THEN COALESCE($4::timestamptz, current_period_start, now()) ELSE current_period_start END,
    current_period_end = CASE WHEN $2 = 'ativa' THEN COALESCE(($5::date + INTERVAL '30 days')::timestamptz, current_period_end, now() + INTERVAL '30 days') ELSE current_period_end END,
  com bind array [data.storeId, nextStatus, gatewayStatus, paidAt, dueDate], logo $4 = paidAt e $5 = dueDate.

  paidAt = paidAtForGatewayPayment(paidPayment) = paymentDate || confirmedDate || clientPaymentDate (quando foi pago).
  dueDate = dueDateForGatewayPayment(referencePayment, subscription) = dueDate || originalDueDate || next_due_date (quando venceu).

  Portanto current_period_start usa a data de PAGAMENTO e current_period_end usa a data de VENCIMENTO + 30 dias. Sao ancoras distintas, entao a duracao real do periodo = (dueDate + 30) - paidAt, e nao 30 dias fixos. Em pagamento adiantado o periodo fica maior que 30 dias; em pagamento atrasado fica menor; e quando paidAt > dueDate + 30 (atraso superior a 30 dias) o current_period_end fica ANTES do current_period_start. Tentei refutar verificando se paidAt e dueDate viriam da mesma referencia temporal: vem da mesma cobranca (referencePayment === paidPayment quando ha pagamento pago), mas paymentDate e dueDate sao campos distintos da cobranca, entao a divergencia se mantem. A refutacao falha; o bug existe.

  Impacto confirmado em cancelSubscriptionHandler: effectiveAt = subscription.current_period_end || subscription.next_due_date || now(), usado como cancellation_effective_at, podendo encerrar acesso em data passada/incoerente no cenario extremo.

  Severidade medium (nao high): o efeito mais comum e apenas periodo levemente maior/menor que 30 dias (inconsistencia logica, sem perda de seguranca nem corrupcao de dados). O pior caso (period_end < period_start, cancelamento no passado) exige atraso de pagamento superior a 30 dias, cenario possivel porem pouco frequente. Recomendacao: ancorar ambos no mesmo marco (paidAt e paidAt + 30, ou dueDate para ambos).

#### 9. Assinatura fica presa em 'pendente_pagamento': auto-sync e disparado apenas uma vez e nao ha polling/realtime
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/lojista/Subscription.tsx`
- **Dimensao:** client-ui
- **Descricao:** Apos criar/validar a assinatura, o unico mecanismo automatico que reconsulta o backend e o useEffect de auto-sync. Ele esta protegido pelo guard `autoSyncedSubscriptionId === gatewaySubscriptionId`, ou seja, dispara UMA unica vez por id de assinatura do gateway. Como a confirmacao do cartao no Asaas (e o webhook) leva segundos a minutos, essa unica chamada quase sempre retorna ainda 'pendente_pagamento'. Depois disso o guard impede novas execucoes e nao existe nenhum setInterval, polling ou subscription realtime na pagina nem no hook use-subscription-status (refresh so roda no mount e manualmente). Resultado: o status permanece 'pendente_pagamento' indefinidamente ate o lojista clicar manualmente em 'Atualizar status', mesmo que o pagamento ja tenha sido confirmado no gateway.
- **Correcao sugerida:** Substituir o disparo unico por um polling com backoff e parada automatica: enquanto status === 'pendente_pagamento' (ou 'inadimplente'), agendar syncCurrentSubscription({silent:true}) a cada N segundos com setInterval/setTimeout, limpando o timer no cleanup do effect e parando assim que status virar 'ativa'/'trial' (ou apos M tentativas, exibindo aviso). Idealmente complementar com subscription realtime na tabela subscriptions por store_id para refletir o webhook em tempo real.
- **Racional da verificacao:** Achado CONFIRMADO. A evidencia bate exatamente com o codigo atual.

  Em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/lojista/Subscription.tsx o useEffect de auto-sync existe literalmente como citado, com o guard `if (autoSyncedSubscriptionId === gatewaySubscriptionId) return;` seguido de `setAutoSyncedSubscriptionId(gatewaySubscriptionId)`. Isso garante que o auto-sync silencioso dispare apenas UMA vez por asaas_subscription_id. Como a confirmacao do pagamento no Asaas leva tempo, essa unica chamada quase sempre retorna ainda 'pendente_pagamento', e depois o guard impede novas execucoes.

  Verifiquei toda a pagina: nao existe setInterval, setTimeout de polling, nem subscription realtime/channel. O unico re-fetch automatico restante e o botao manual 'Atualizar status' (syncCurrentSubscription sem silent).

  Verifiquei tambem /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/hooks/use-subscription-status.ts: o refresh roda apenas no mount via useEffect(() => { void refresh(); }, [refresh]). Nao ha setInterval, polling nem backend.channel/realtime. O refresh so e recriado por mudancas em authLoading/profile.is_exempt/profile.store_id/user, nada que reaja a mudanca de status no gateway.

  Portanto, o status realmente fica preso em 'pendente_pagamento' na UI ate o lojista clicar manualmente em 'Atualizar status' (ou recarregar a pagina, o que refaz o fetch no mount).

  Severidade MEDIA (nao alta): (1) e bug de UX/funcional, nao de seguranca; (2) o proprio codigo indica que a ativacao real acontece server-side via webhook do Asaas, que provavelmente persiste o status no banco independente da UI; (3) ha workaround facil (botao manual ou reload). O impacto e exibir status desatualizado por tempo indeterminado ate acao do usuario, o que pode confundir e levar o lojista a achar que o pagamento falhou.

#### 10. Tela admin de assinaturas nao exibe o status da assinatura (so flags da loja)
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/admin/AdminStores.tsx`
- **Dimensao:** admin-ui
- **Descricao:** A gestao de assinaturas do admin esta embutida em AdminStores. Tanto a lista quanto o dialog de detalhe carregam subscriptions(status, ...) mas NUNCA renderizam o status da assinatura. So sao exibidos os flags da loja (is_suspended, is_active, is_exempt) e o nome/preco do plano. Um admin nao consegue distinguir uma assinatura 'trial', 'pendente_pagamento', 'inadimplente' ou 'cancelada' de uma 'ativa' — todas aparecem identicas desde que a loja nao esteja suspensa. Existe inclusive getStatusMeta/STATUS_LABELS/STATUS_TONES em src/lib/subscription.ts pronto para isso, mas nao e usado aqui.
- **Correcao sugerida:** Exibir o status real da assinatura usando getStatusMeta(sub) de src/lib/subscription.ts, renderizando um Badge com label/tone (Ativa, Periodo de teste, Pagamento pendente, Pagamento em atraso, Cancelada) tanto na lista quanto no dialog de detalhe.
- **Racional da verificacao:** CONFIRMADO. Tentei refutar lendo o codigo real e a evidencia bate.

  Em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/admin/AdminStores.tsx:

  1) A query carrega o status: `backend.from("stores").select("*, subscriptions(status, plan_id, plans(name, price_monthly))")`. Ou seja, `status` esta disponivel em `s.subscriptions[0].status`.

  2) Na LISTA, ` const sub = s.subscriptions?.[0];` existe, mas o unico uso de `sub` e `{sub?.plans?.name ?? "Sem plano"}` e `{formatBRL(sub.plans.price_monthly)}/mes`. Os unicos Badges renderizados sao baseados em flags da LOJA: `{s.is_exempt && ...Isenta}`, `{s.is_suspended && <Badge variant="destructive">Suspensa</Badge>}` e `{!s.is_active && <Badge variant="secondary">Inativa</Badge>}`. O `sub.status` (trial/pendente_pagamento/inadimplente/cancelada/ativa) NUNCA e renderizado.

  3) No DIALOG de detalhe: sao exibidos slug, email, telefone, cidade, data, o switch de isento, e um Select de "Plano de Referencia" que usa `selected.subscriptions?.[0]?.plan_id` / `status === 'ativa'` apenas para definir o valor selecionado. Nenhum lugar renderiza o status legivel da assinatura. Botoes so controlam suspensao/exclusao da loja.

  4) O helper existe e esta pronto, mas nao e importado/usado: em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/lib/subscription.ts existem `STATUS_LABELS`, `STATUS_TONES` e `getStatusMeta(...)` (que retorna label/tone/detail com base em status, trial_ends_at, current_period_end). AdminStores.tsx nao tem qualquer import de "@/lib/subscription".

  Consequencia confirmada: um admin nao distingue trial / pendente_pagamento / inadimplente / cancelada de ativa na tela, desde que a loja nao esteja suspensa e esteja ativa — todas aparecem identicas mostrando apenas o nome do plano. Isso e um problema real de UX/observabilidade administrativa.

  Severidade: medium. Nao e um bug de seguranca nem de logica de bloqueio de acesso (o controle de acesso real fica em getSubscriptionAccessState, que considera o status corretamente). E uma lacuna de visibilidade na UI de admin: dados existem, capacidade de exibir existe, mas nao sao mostrados. Mantive medium (na duvida, severidade menor) por ser cosmetico/operacional e nao funcional/critico.

#### 11. Opcao 'Cortesia' nunca permanece selecionada (deteccao por plan_id ausente, mas codigo sempre grava plan_id)
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/admin/AdminStores.tsx`
- **Dimensao:** admin-ui
- **Descricao:** O value do Select tenta detectar cortesia por status 'ativa' E plan_id ausente. Porem changePlan, ao ativar cortesia, sempre grava um plan_id real (courtesyPlan?.id || plans[0]?.id). Logo apos ativar cortesia a assinatura tera plan_id preenchido e o Select mostrara o plano normal correspondente — nunca 'Cortesia'. Alem disso, o fallback plans[0]?.id atribui silenciosamente o primeiro plano da lista (potencialmente pago) quando nao existe plano premium_cortesia/isento, exibindo um plano pago como se fosse cortesia.
- **Correcao sugerida:** Marcar cortesia por slug do plano vinculado (premium_cortesia/isento) e nao por ausencia de plan_id; e nao usar plans[0]?.id como fallback — exigir a existencia de um plano de cortesia e avisar o admin se ele nao existir.
- **Racional da verificacao:** Verifiquei lendo /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/admin/AdminStores.tsx e a evidencia bate exatamente com o codigo atual.

  1) value do Select (no bloco "Plano de Referência"): value={selected.subscriptions?.[0]?.plan_id || (selected.subscriptions?.[0]?.status === 'ativa' && !selected.subscriptions?.[0]?.plan_id ? 'cortesia' : '')}. A deteccao de 'cortesia' exige status 'ativa' E plan_id AUSENTE. Alem disso a expressao e efetivamente morta/tautologica: o ramo so e avaliado quando o primeiro operando do || (plan_id) ja e falsy, e ai !plan_id e sempre true.

  2) changePlan, no ramo planId === 'cortesia', SEMPRE grava plan_id real: const courtesyPlan = plans.find(p => p.slug?.toLowerCase() === 'premium_cortesia' || p.slug?.toLowerCase() === 'isento'); const targetPlanId = courtesyPlan?.id || plans[0]?.id; e faz update/insert com plan_id: targetPlanId (e tambem stores.plan_id). Apos load(), a subscription tera plan_id preenchido, logo o Select exibira o SelectItem do plano correspondente (value={p.id}) e nunca 'cortesia'. Confirmado: a opcao 'Cortesia' nunca permanece selecionada.

  3) Fallback plans[0]?.id: quando nao existem planos com slug premium_cortesia/isento, atribui silenciosamente o primeiro plano (ordenado por sort_order, potencialmente pago) como se fosse cortesia. Confirmado.

  Ceticismo/severidade: o efeito garantido e um bug funcional de UI no painel admin (selecao nunca persiste visualmente como Cortesia) sempre que houver courtesyPlan ou plans[0]. O subcaso de exibir/atribuir um plano pago como cortesia e condicional (depende da ausencia dos slugs especificos). Sem corrupcao critica de dados, sem falha de seguranca, e o admin ainda consegue marcar isencao via toggle is_exempt separado. Impacto de confusao de billing/UX no admin -> severidade medium.

---

### Severidade: LOW

#### 1. Status persistido como 'pendente_pagamento' mesmo quando o pagamento do cartao ja foi confirmado pelo gateway
- **Arquivo:linha:** `src/server/subscription.service.ts (createSubscriptionCheckoutHandler, chamada a persistSubscription)`
- **Dimensao:** checkout
- **Descricao:** Para CREDIT_CARD o Asaas normalmente debita/confirma na criacao da assinatura (createSubscription retorna a primeira cobranca ja CONFIRMED/RECEIVED em muitos casos), mas o handler grava status fixo 'pendente_pagamento' e last_payment_status fixo 'pending' (no INSERT do persistSubscription), ignorando o status real retornado em subscription. Resultado: a loja fica como nao-paga apesar do pagamento ter ocorrido, ate que algum syncSubscriptionStatus rode. O status persistido nao reflete a realidade do pagamento.
- **Correcao sugerida:** Inspecionar o status retornado pelo gateway (ex.: subscription.status / primeira payment status) e mapear para 'ativa'/'pendente_pagamento' e last_payment_status correspondente, em vez de hardcode. Para CREDIT_CARD confirmado, gravar 'ativa' e last_payment_status 'CONFIRMED'.
- **Racional da verificacao:** O codigo citado existe e a evidencia bate. Em src/server/subscription.service.ts, createSubscriptionCheckoutHandler chama persistSubscription com status: "pendente_pagamento" fixo (string literal) e nextDueDate: subscription.nextDueDate || nextDueDate. Dentro de persistSubscription, o INSERT/UPSERT grava last_payment_status com o literal 'pending' hardcoded ($7::text mapeia status; o 'pending' seguinte e literal, nao parametrizado). O objeto subscription (resposta de POST /subscriptions) nunca tem seu status de cobranca lido para persistencia. Logo o fato central do achado e verdadeiro: o status persistido no checkout nao reflete o status real do pagamento.

  Porem, rebaixo a severidade para LOW apos analise adversarial: (1) A premissa tecnica da descricao e parcialmente imprecisa. POST /subscriptions do Asaas retorna o objeto da ASSINATURA, cujo campo status e tipicamente ACTIVE/INACTIVE, NAO o status da cobranca (CONFIRMED/RECEIVED). O status de pagamento real so esta nos objetos payment, obtidos via listSubscriptionPayments (/subscriptions/{id}/payments) — confirmado em asaas.server.ts. Portanto a "correcao obvia" sugerida na evidencia (usar subscription.status) nao resolveria corretamente; o dado de pagamento confirmado nao esta trivialmente disponivel na resposta de createSubscription. (2) Existe reconciliacao: syncSubscriptionStatusHandler consulta os pagamentos reais e corrige para 'ativa'/'inadimplente', e ha webhook em src/routes/api/webhooks/asaas.ts. (3) O retorno mode: "card_validated" indica design intencional de tratar o checkout como validacao do cartao, deixando a confirmacao para webhook/sync — padrao legitimo. (4) O impacto e transitorio (janela ate o webhook/sync rodar), sem perda permanente de dados ou receita. Achado real, mas de baixa severidade e com premissa de impacto exagerada.

#### 2. Retorno de insertPaymentEvent (ON CONFLICT DO NOTHING) nao curto-circuita reprocessamento de evento duplicado
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/webhooks.ts`
- **Dimensao:** webhook
- **Descricao:** insertPaymentEvent retorna Boolean(rows[0]) indicando se o evento foi de fato inserido (true) ou se ja existia (false, por ON CONFLICT DO NOTHING). Esse retorno eh descartado: o handler nunca verifica se o evento ja havia sido processado antes de re-atualizar payments/orders e re-disparar publishRealtime. A idempotencia 'real' depende somente do WHERE NOT EXISTS do order_status_history e da flag wasPaid; updates de status e eventos de realtime sao reemitidos a cada reentrega.
- **Correcao sugerida:** Capturar o retorno de insertPaymentEvent e, quando false (evento ja registrado), encerrar a transacao sem reaplicar updates/realtime (ex.: return { updated: false, duplicate: true }).
- **Racional da verificacao:** Confirmei lendo /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/webhooks.ts. A evidencia bate exatamente com o codigo.

  1) insertPaymentEvent usa `INSERT ... ON CONFLICT DO NOTHING RETURNING id` e retorna `Boolean(rows[0])` — ou seja, true se inseriu, false se o evento ja existia. Confirmado.

  2) No call site dentro de withTransaction, o retorno eh descartado: `await insertPaymentEvent(client, { event, payment, body, orderId: localPayment.order_id, storeId: localPayment.store_id });` seguido de `if (mappedStatus === "pago")`. Nao ha atribuicao nem branch baseado no retorno. Confirmado.

  3) Em uma reentrega duplicada: o UPDATE de payments sempre executa e retorna a linha (result.payment preenchido); o UPDATE de orders sempre executa em ambos os ramos (result.order preenchido); result.updated = true. Logo publishRealtime eh reemitido para payments e orders a cada reentrega, e updated_at eh sempre bumped. A unica protecao real eh o `WHERE NOT EXISTS` do order_status_history combinado com `!wasPaid`, que so evita duplicar a linha de historico — exatamente como descreve o achado.

  Contra-pontos (motivo da severidade baixa): nao ha corrupcao de dados — paid_at, external_id e asaas_id usam COALESCE evitando sobrescrita, e status reescrito eh o mesmo valor. O impacto eh efeito colateral redundante: eventos realtime reemitidos para clientes e churn de updated_at a cada reentrega de webhook (Asaas faz redelivery). O sinal de deduplicacao existe (return false em conflito) mas eh ignorado, nao curto-circuitando o reprocessamento. Defeito de corretude/eficiencia real, sem vulnerabilidade de integridade — severidade low.

#### 3. Mudanca de payload em reentrega quebra a deduplicacao por payload_hash
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/webhooks.ts`
- **Dimensao:** webhook
- **Descricao:** A constraint unica de payment_events inclui payload_hash, e hashPayload eh calculado sobre o payload redacted que contem paymentDate. O Asaas pode reentregar o MESMO evento (mesmo event_type + payment.id) com paymentDate/status ligeiramente diferentes (ex.: confirmado depois). Como o hash muda, o ON CONFLICT DO NOTHING nao dispara e a 'mesma' notificacao eh inserida novamente como evento distinto, derrotando a idempotencia baseada na tabela de eventos.
- **Correcao sugerida:** Definir idempotencia por (provider, event_type, external_payment_id) sem incluir payload_hash, ou usar o id do evento do proprio Asaas (campo id da notificacao) como chave de deduplicacao.
- **Racional da verificacao:** CONFIRMADO PARCIALMENTE. A evidencia bate com o codigo real.

  1) Indice unico (em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/db/migrations/20260521143000_production_hardening.sql) e EXATAMENTE como citado: CREATE UNIQUE INDEX ... payment_events_provider_event_payment_hash_unique ON public.payment_events(provider, event_type, external_payment_id, payload_hash) WHERE external_payment_id IS NOT NULL.

  2) Em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/webhooks.ts: hashPayload = sha256(JSON.stringify(payload)) sobre o objeto redacted, e redactPayload inclui payment.status e payment.paymentDate. Logo, uma reentrega do MESMO evento (mesmo event_type + payment.id) com status/paymentDate diferente gera payload_hash diferente, o ON CONFLICT DO NOTHING nao dispara e uma nova linha em payment_events e inserida. O mecanismo de dedup baseado no hash do payload de fato pode ser derrotado por mudanca de payload. ACHADO E REAL no nivel descrito.

  POReM, a severidade alegada (idempotencia da notificacao derrotada) e superestimada. A tabela payment_events funciona como AUDITORIA/rastreio, NAO como gate de idempotencia das operacoes que mexem em dinheiro/pedido. Evidencias no proprio webhooks.ts:
  - O valor de retorno de insertPaymentEvent (Boolean(rows[0])) e IGNORADO em ambos os call sites; o fluxo nao aborta nem ramifica com base nele.
  - As mutacoes reais sao independentemente idempotentes: UPDATE payments com paid_at = COALESCE(paid_at, now()) e status = $2 (set determinístico); UPDATE orders idempotente; e o INSERT em order_status_history usa WHERE NOT EXISTS para evitar duplicata, alem do guard wasPaid (localPayment.status === 'pago').
  - Ha tambem validacao de valor divergente antes de marcar como pago.

  Consequencia real: bloat/duplicacao de linhas na tabela de auditoria payment_events em reentregas com payload alterado. NAO ha cobranca dupla, processamento duplicado de pedido, nem entrada duplicada de historico de status. O impacto e baixo (qualidade de dados de auditoria / possivel ruido em consultas de dedup), nao critico/alto. Por isso marco isReal=true com severidade LOW.

#### 4. Calculo de periodo divergente entre webhook e sync quando paidAt e nulo
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/webhooks.ts:~75 (updateSubscriptionIfPresent) vs subscription.service.ts:~430`
- **Dimensao:** sync-cancel
- **Descricao:** No webhook, current_period_start usa COALESCE($4::timestamptz, now()) ou seja, se paidAt for nulo cai para now(). No syncSubscriptionStatusHandler usa COALESCE($4::timestamptz, current_period_start, now()), ou seja, preserva o current_period_start anterior antes de cair para now(). Para o mesmo evento de pagamento (paidAt nulo), os dois caminhos produzem current_period_start diferentes: o webhook sobrescreve para now() (perdendo o inicio real anterior), enquanto o sync mantem o valor antigo. Como ambos disparam para a mesma transicao 'ativa', o estado final depende de qual caminho rodou, causando inconsistencia de dados.
- **Correcao sugerida:** Padronizar o COALESCE nos dois arquivos, incluindo current_period_start como fallback intermediario no webhook (COALESCE($4::timestamptz, current_period_start, now())) para que reprocessamentos de webhook nao zerem o inicio real do periodo ja registrado.
- **Racional da verificacao:** Confirmei lendo os arquivos reais. webhooks.ts (updateSubscriptionIfPresent): current_period_start = CASE WHEN $1 = 'ativa' THEN COALESCE($4::timestamptz, now()) ELSE current_period_start END, com $4 = paidAt (paymentDate||confirmedDate||clientPaymentDate||null). subscription.service.ts (syncSubscriptionStatusHandler): current_period_start = CASE WHEN $2 = 'ativa' THEN COALESCE($4::timestamptz, current_period_start, now()) ELSE current_period_start END, com $4 = paidAtForGatewayPayment (mesma cadeia, ||null). As duas evidencias batem exatamente. A divergencia existe: para a mesma transicao para 'ativa' com paidAt nulo, o webhook sobrescreve current_period_start para now() (perdendo o inicio real), enquanto o sync preserva o valor anterior. Como ambos atualizam a mesma linha, o estado final depende de qual caminho rodou, gerando inconsistencia. paidAt nulo e plausivel (provedor pode retornar CONFIRMED sem datas de pagamento). Severidade baixa: o campo divergente e current_period_start (metadado de inicio de periodo); current_period_end e next_due_date usam formulas identicas nos dois caminhos e permanecem consistentes, e nao ha impacto financeiro direto nem falha de cobranca. Ocorre apenas no caso de borda paidAt nulo.

#### 5. Status 'encerrada' nunca e gravado, apenas lido — transicao morta
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/server/subscription.service.ts:cancelSubscriptionHandler e cancelExistingGatewaySubscription`
- **Dimensao:** sync-cancel
- **Descricao:** O valor 'encerrada' aparece somente em guardas de leitura (status === 'cancelada' || status === 'encerrada' em cancelExistingGatewaySubscription e no inicio de cancelSubscriptionHandler), mas nenhum dos handlers nem o webhook jamais escrevem status = 'encerrada'. O cancelamento sempre grava 'cancelada' com cancellation_effective_at no fim do periodo, e nao ha rotina que, ao atingir cancellation_effective_at, promova a assinatura de 'cancelada' para 'encerrada'. Assim o efeito 'ao fim do periodo' fica apenas em cancellation_effective_at; o estado nunca transiciona para 'encerrada', tornando esse valor de status efetivamente inalcancavel e o ciclo de vida incompleto.
- **Correcao sugerida:** Adicionar uma rotina/cron que transicione 'cancelada' -> 'encerrada' quando cancellation_effective_at <= now(), ou remover o valor 'encerrada' das guardas se ele nao fizer parte do modelo. Sem isso, o efeito de fim de periodo nao desliga de fato o acesso.
- **Racional da verificacao:** CONFIRMADO. Li o codigo real e a evidencia bate.

  1) /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/server/subscription.service.ts: 'encerrada' aparece SOMENTE em guardas de leitura: em cancelExistingGatewaySubscription (`if (status === "cancelada" || status === "encerrada") return;`) e no inicio de cancelSubscriptionHandler (`if (subscription.status === "cancelada" || subscription.status === "encerrada") return ...`). O UPDATE de cancelamento grava exatamente `SET status = 'cancelada', canceled_at = now(), cancellation_effective_at = $2::timestamptz`. Nenhum UPDATE neste arquivo grava 'encerrada'.

  2) /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/backend/webhooks.ts (updateSubscriptionIfPresent, alvo da rota /api/webhooks/asaas) so escreve status 'ativa' | 'inadimplente' | 'cancelada' — nunca 'encerrada'.

  3) /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/services/subscription-billing.ts contem apenas invokers de cliente, sem nenhuma escrita de status nem rotina/cron que promova 'cancelada' -> 'encerrada' ao atingir cancellation_effective_at. Nenhum job agendado encontrado no repo.

  4) /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/lib/subscription.ts NEM reconhece 'encerrada': ela esta ausente de STATUS_LABELS, STATUS_TONES e getSubscriptionAccessState. Isso reforca que o valor e inalcancavel e nao integrado ao ciclo de vida.

  Portanto o achado e verdadeiro: 'encerrada' e um estado de escrita morto/inalcancavel; o efeito 'fim de periodo' vive apenas em cancellation_effective_at/current_period_end e nao ha transicao para 'encerrada'.

  Severidade: BAIXA. Apesar de real, o impacto e benigno. O controle de acesso ja trata corretamente o fim do periodo via comparacao de current_period_end em getSubscriptionAccessState (uma assinatura 'cancelada' permanece "active" ate o fim do periodo e depois vira "canceled"). Ou seja, nao ha falha de acesso, cobranca ou seguranca — apenas um valor de status vestigial/inalcancavel e uma lacuna semantica no modelo de ciclo de vida. Na duvida, severidade menor.

#### 6. Sync de confirmacao roda imediatamente apos o checkout (race condition com o gateway)
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/lojista/Subscription.tsx`
- **Dimensao:** client-ui
- **Descricao:** Em submitCardCheckout, logo apos createSubscriptionCheckout a pagina chama syncCurrentSubscription({silent:true}) e refresh() de forma sincrona. Nesse instante o gateway frequentemente ainda nao processou o pagamento do cartao, entao o sync retorna 'pendente_pagamento'. Combinado com o auto-sync de disparo unico (achado anterior), essa primeira leitura prematura ja 'queima' a unica tentativa automatica de confirmacao, deixando a assinatura presa em pendente ate acao manual.
- **Correcao sugerida:** Nao tratar a primeira leitura como definitiva. Apos o checkout, iniciar um polling com algumas tentativas espacadas (ex.: 2s, 4s, 8s) ate o backend retornar 'ativa', e somente entao confirmar o estado ativo na UI. Manter o guard de auto-sync separado do polling pos-checkout para nao consumir a unica tentativa automatica.
- **Racional da verificacao:** A evidência literal CONFIRMA-SE no código atual. Em submitCardCheckout (/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/lojista/Subscription.tsx), logo após `createSubscriptionCheckout` a página chama `await syncCurrentSubscription({ silent: true })` seguido de `await refresh()` e do toast de sucesso, exatamente como descrito. Logo, a parte factual do achado (sync de confirmação roda imediatamente após o checkout) é real, e é plausível que o gateway ainda não tenha processado o pagamento do cartão nesse instante, retornando status pendente.

  PORÉM, a tese de impacto central do achado — que essa leitura prematura "queima a única tentativa automática de confirmação" do auto-sync de disparo único — é REFUTADA pelo código. O auto-sync de disparo único (useEffect com gate `autoSyncedSubscriptionId === gatewaySubscriptionId`) usa um state (`autoSyncedSubscriptionId`) que só é setado DENTRO daquele próprio useEffect. A chamada manual em submitCardCheckout invoca `syncCurrentSubscription` diretamente e NÃO altera `autoSyncedSubscriptionId`. Portanto a chamada manual NÃO consome/queima o gate do auto-sync: quando o estado de subscription for atualizado para `pendente_pagamento` com um `asaas_subscription_id` válido, o useEffect de auto-sync ainda disparará normalmente (uma vez por gatewaySubscriptionId). São caminhos independentes; a premissa de acoplamento que sustenta a gravidade não procede.

  Mitigações adicionais presentes no código: (1) botão "Atualizar status" (`syncCurrentSubscription()` não-silencioso) sempre disponível para reenviar a consulta; (2) a própria UI declara que a ativação ocorre pelo retorno do Asaas e pelo webhook configurado no painel admin — ou seja, a confirmação não depende exclusivamente desta única leitura do front. Assim, não há real risco de a assinatura ficar "presa em pendente até ação manual" por causa deste sync prematuro.

  Conclusão: o comportamento descrito (sync prematuro logo após checkout) existe e é, no máximo, uma ineficiência/UX subótima (uma chamada possivelmente redundante que pode mostrar status pendente momentaneamente), mas o mecanismo de dano alegado (queimar a única tentativa de auto-confirmação) não se sustenta no código. Marco como real porém de severidade baixa.

#### 7. Mensagem de sucesso nao reflete o estado real do backend
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/lojista/Subscription.tsx`
- **Dimensao:** client-ui
- **Descricao:** Apos submitCardCheckout, o toast de sucesso 'Cartao validado. Assinatura enviada para confirmacao' e exibido para qualquer retorno diferente de checkout.mode === 'active', sem checar o status real obtido pelo refresh()/sync. Se o gateway recusar o cartao mas a edge function nao lancar erro (ex.: devolve mode pendente/falha), o usuario ve mensagem positiva enquanto a assinatura permanece pendente ou recusada. A confirmacao de 'ativa' depende exclusivamente de checkout.mode retornado pela funcao, e nao do status persistido em subscriptions apos o refresh.
- **Correcao sugerida:** Apos refresh(), basear a mensagem no status realmente persistido (subscriptionStatusValue): mostrar sucesso 'ativa' apenas quando status === 'ativa'/'trial'; quando ainda pendente, comunicar explicitamente 'aguardando confirmacao do pagamento' e iniciar o polling; tratar status de recusa/inadimplencia com toast de erro.
- **Racional da verificacao:** Confirmei o achado lendo o codigo atual.

  Arquivo: /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/lojista/Subscription.tsx (funcao submitCardCheckout). Trecho real:

    await syncCurrentSubscription({ silent: true });
    await refresh();
    setCardDialogOpen(false);
    toast.success(
      checkout.mode === "active"
        ? "Assinatura ja esta ativa."
        : showUpgradeOptions
          ? "Cartao validado. Upgrade enviado para confirmacao."
          : "Cartao validado. Assinatura enviada para confirmacao.",
    );

  A evidencia citada bate (com a pequena imprecisao de o achado omitir a ramificacao de upgrade, mas a logica e identica). A premissa central e VERDADEIRA: o toast e decidido exclusivamente por checkout.mode, vindo direto da resposta da edge function. Em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/services/subscription-billing.ts, createSubscriptionCheckout so lanca erro quando `error` esta setado ou `result` e nulo; retorna `mode: result.mode` sem validacao. Logo, se o gateway recusar o cartao mas a edge function devolver resposta sem erro com mode != "active" (pendente/falha), o fluxo cai no toast.success exibindo "Cartao validado..." mesmo sem ativacao real. O codigo de fato faz refresh()/sync e atualiza badge/timeline a partir do status persistido, mas a MENSAGEM do toast nao consulta esse status atualizado.

  Atenuantes que reduzem a severidade (por isso "low", nao "medium/high"):
  1) A afirmacao forte ("ja esta ativa") esta corretamente protegida por checkout.mode === "active".
  2) A mensagem da ramificacao nao-ativa e intencionalmente neutra/pendente ("enviada para confirmacao" / "enviado para confirmacao"), comunicando que a confirmacao ainda esta pendente; nao afirma que a assinatura esta ativa. Portanto o titulo "mensagem de sucesso nao reflete o estado real" e parcialmente exagerado.
  3) O ponto problematico residual e o termo "Cartao validado", que pode ser enganoso se o gateway recusou o cartao mas a function retornou modo de falha sem lancar erro. Se a edge function realmente devolve recusa como erro (throw), o problema nao se materializa; isso depende da edge function (nao auditavel apenas por estes arquivos), aumentando a incerteza e justificando severidade menor.

  Conclusao: problema real de UX/clareza de mensagem (toast acoplado a checkout.mode em vez do status persistido apos refresh/sync), de baixo impacto e dependente do comportamento da edge function quanto a recusas.

#### 8. Fluxo de boleto/invoiceUrl morto: URL retornada nunca e exibida nem redirecionada
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/lojista/Subscription.tsx`
- **Dimensao:** client-ui
- **Descricao:** O servico createSubscriptionCheckout devolve checkoutUrl (`result.checkoutUrl || result.invoiceUrl`) e o tipo CreateSubscriptionCheckoutInput suporta billingType 'BOLETO'. Porem a UI sempre envia billingType: 'CREDIT_CARD' e, em submitCardCheckout, o objeto checkout retornado so e usado para ler checkout.mode — nunca para redirecionar ou exibir o invoiceUrl/boleto. O unico codigo que fazia window.location.href = checkout.checkoutUrl esta comentado dentro de startCheckout. Logo, nao existe caminho para o lojista visualizar/abrir o boleto; a parte 'exibir invoiceUrl (boleto)' do fluxo simplesmente nao acontece.
- **Correcao sugerida:** Implementar de fato o caminho de boleto: oferecer escolha de billingType na UI e, quando o retorno trouxer checkoutUrl/invoiceUrl, redirecionar (window.location.href) ou exibir um link/QR para o boleto. Remover o bloco comentado em startCheckout e consolidar a logica de redirecionamento usando o checkout.checkoutUrl retornado.
- **Racional da verificacao:** Confirmei lendo os dois arquivos citados. O achado bate com o codigo atual.

  1. Servico (/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/services/subscription-billing.ts): createSubscriptionCheckout retorna exatamente `checkoutUrl: result.checkoutUrl || result.invoiceUrl, subscriptionId, billingType, mode`. O tipo CreateSubscriptionCheckoutInput declara `billingType?: "CREDIT_CARD" | "BOLETO"`. Confirmado.

  2. Pagina (/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/lojista/Subscription.tsx): a UNICA chamada viva a createSubscriptionCheckout esta em submitCardCheckout, sempre com `billingType: "CREDIT_CARD"`. O objeto retornado `checkout` so e consumido em `checkout.mode === "active" ? ...` dentro do toast.success; checkoutUrl/invoiceUrl nunca e lido, exibido nem usado para redirecionar.

  3. O unico `window.location.href = checkout.checkoutUrl` esta dentro do bloco comentado /* ... */ em startCheckout, que e codigo morto (a funcao faz setCardDialogOpen(true); return; antes do comentario). Confirmado.

  4. Busquei na pagina inteira: nao ha render de invoiceUrl, nem texto/boleto, nem <a href>, nem qualquer outro redirect usando a URL. Logo a URL retornada e de fato dead code nesta UI e nao existe caminho para o lojista abrir o boleto.

  Rebaixei a severidade para low porque: (a) nao ha crash, perda de dados nem falha de seguranca; (b) o produto e intencionalmente card-only na UI viva (o proprio cabecalho diz "cobrada de forma recorrente no cartao de credito"), entao BOLETO/invoiceUrl e uma capacidade latente/nao utilizada do servico, nao uma feature anunciada quebrada. E uma lacuna de fluxo morto / manutenibilidade, nao um bug de impacto alto.

#### 9. Confirmacao de upgrade usa confirm() nativo e nao valida resultado do gateway
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/lojista/Subscription.tsx`
- **Dimensao:** client-ui
- **Descricao:** O fluxo de upgrade/cancelamento usa window.confirm() bloqueante, inconsistente com o restante da UI baseada em Dialog/sonner, e o caminho de upgrade no submitCardCheckout reusa createSubscriptionCheckout (em vez de updateSubscriptionPlan, que existe no servico mas nunca e chamado). Combinado com a falta de polling, um upgrade tambem pode ficar preso aguardando confirmacao sem feedback contínuo.
- **Correcao sugerida:** Padronizar a confirmacao via Dialog/AlertDialog, e avaliar usar updateSubscriptionPlan para o caminho de upgrade quando ja existe asaas_subscription_id, alem de aplicar o mesmo polling de confirmacao do fluxo de criacao.
- **Racional da verificacao:** Achado confirmado contra o codigo real em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/lojista/Subscription.tsx e /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/services/subscription-billing.ts.

  1) window.confirm() nativo: CONFIRMADO. A evidencia bate exatamente em startCheckout: `if (!confirm(\`Confirmar upgrade para ${checkoutPlan.name}? A troca cria uma nova recorrencia no gateway e cancela a recorrencia anterior apos a validacao.\`)) { return; }`. Tambem em cancelCurrentSubscription: `if (!confirm("Cancelar a recorrencia da assinatura?...")) return;`.

  2) Inconsistencia com UI: CONFIRMADO. A pagina importa e usa Dialog (DialogContent/Header/Footer) e toast do sonner intensamente, tornando os confirm() nativos inconsistentes com o padrao da UI.

  3) updateSubscriptionPlan exportado mas nunca importado/usado: CONFIRMADO. O import na linha 6 traz apenas { cancelSubscription, createSubscriptionCheckout, syncSubscriptionStatus }. updateSubscriptionPlan esta exportado em subscription-billing.ts (invoca edge function update-subscription-plan) mas nao consta nos imports da pagina; a unica referencia a ele esta dentro de um bloco comentado /* ... */ no startCheckout (codigo morto).

  4) Caminho ativo de upgrade reusa createSubscriptionCheckout: CONFIRMADO. submitCardCheckout (fluxo realmente executado via Dialog) chama createSubscriptionCheckout incondicionalmente, inclusive quando showUpgradeOptions=true (cenario de upgrade), sem ramificar para updateSubscriptionPlan.

  5) Falta de polling: CONFIRMADO/MATIZADO. Apos checkout ha um unico syncCurrentSubscription({silent:true}) + refresh, um useEffect de auto-sync UNICO para status pendente_pagamento (guardado por autoSyncedSubscriptionId) e um botao manual "Atualizar status". Nao existe polling continuo/automatico, entao a falta de feedback continuo apos enviar upgrade procede.

  Matizes para severidade baixa: o fluxo de upgrade ainda pode funcionar pois createSubscriptionCheckout retorna um `mode` e o backend pode tratar upgrade; o webhook do Asaas pode ativar a assinatura sem polling no frontend. Nao e vulnerabilidade de seguranca nem quebra garantida. E essencialmente problema de qualidade/UX/consistencia com risco moderado de comportamento incorreto ao ignorar a funcao updateSubscriptionPlan dedicada que existe. Por isso isReal=true com severidade baixa.

#### 10. Ausencia de acoes de Cancelar e Sincronizar assinatura no admin
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/admin/AdminStores.tsx`
- **Dimensao:** admin-ui
- **Descricao:** O backend expoe cancelSubscriptionHandler e syncSubscriptionStatusHandler (src/server/subscription.service.ts) que aceitam ator admin (assertStoreAccess permite actor.admin). Porem a tela admin nao oferece nenhuma acao para cancelar uma assinatura nem para sincronizar o status com o gateway. As unicas acoes no dialog sao: abrir loja publica, suspender/reativar a loja e excluir loja. Sem 'Sincronizar' o admin nao tem como reconciliar um status exibido divergente do gateway (ex.: pagamento confirmado no Asaas mas ainda 'pendente_pagamento' no banco).
- **Correcao sugerida:** Adicionar botoes 'Cancelar assinatura' e 'Sincronizar status' no dialog que invocam os handlers cancelSubscriptionHandler/syncSubscriptionStatusHandler (via backend.functions.invoke) passando storeId, e recarregar a lista apos a operacao.
- **Racional da verificacao:** Verifiquei os dois arquivos citados e a evidencia confere com o codigo atual.

  Em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/pages/admin/AdminStores.tsx, o bloco de acoes do dialog de detalhes da loja (div com className "flex flex-col gap-2 pt-2") contem exatamente tres botoes: "Abrir loja publica" (link), "Reativar/Suspender" (toggleSuspend, atualiza stores.is_suspended), e "Excluir loja" (remove, invoca admin-delete-store). Nao existe nenhum botao de "Cancelar assinatura" nem "Sincronizar status". As unicas operacoes sobre assinatura na tela sao o Select de "Plano de Referencia" (changePlan, que escreve direto no banco e seta status 'ativa') e o toggle de isencao. Nao ha nenhum functions.invoke nem chamada que aponte para cancelSubscriptionHandler ou syncSubscriptionStatusHandler.

  Em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/server/subscription.service.ts confirmei: cancelSubscriptionHandler e syncSubscriptionStatusHandler existem e ambos chamam assertStoreAccess, cuja regra (if (!actor.admin && !actor.ownedStoreIds.includes(storeId)) throw) permite ator admin. O syncSubscriptionStatusHandler de fato reconcilia status divergente com o gateway (nextStatus = paidPayment ? 'ativa' : 'inadimplente'), cobrindo exatamente o cenario de pagamento confirmado no Asaas mas ainda pendente no banco.

  Portanto o achado e REAL: a tela admin nao expoe acoes de cancelar nem sincronizar assinatura, apesar de o backend suportar ator admin nesses handlers.

  Severidade: rebaixada para low. Nao e vulnerabilidade de seguranca nem bug funcional que cause perda/corrupcao de dados; e uma lacuna operacional/UX. Existem caminhos parciais alternativos (Select de plano que forca 'ativa', toggle de isencao que bypassa travas) e os handlers podem ser acionados pelo proprio lojista. O impacto e limitado a inconveniencia de reconciliacao manual pelo admin.

#### 11. Coluna subscriptions.trial_ends_at lida pelo codigo nao existe no schema
- **Arquivo:linha:** `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/lib/subscription.ts:~330 (getStatusMeta)`
- **Dimensao:** schema
- **Descricao:** getStatusMeta recebe um Pick<SubscriptionRecord, "status" | "trial_ends_at" | "current_period_end"> e le subscription.trial_ends_at quando status === 'trial'. A coluna trial_ends_at nao existe em public.subscriptions: nao consta na criacao base nem em nenhuma das 10 migrations (as colunas de periodo sao apenas current_period_start/current_period_end). O tipo SubscriptionRecord vem de Tables<"subscriptions"> (types gerado), entao compila, mas em runtime o select '*' retorna undefined para trial_ends_at. O impacto e limitado porque o codigo nunca grava status='trial' (default do schema e 'pendente_pagamento' e os handlers gravam apenas pendente_pagamento/ativa/inadimplente/cancelada), porem e uma referencia a coluna inexistente e o branch 'trial' (presente em STATUS_LABELS/STATUS_TONES e em getSubscriptionAccessState) jamais funcionara com data de teste.
- **Correcao sugerida:** Decidir o contrato: se o status 'trial' deve ser suportado, adicionar a coluna via migration (ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz) e popula-la ao iniciar trials; caso contrario, remover trial_ends_at do Pick/getStatusMeta e os ramos 'trial' de STATUS_LABELS/STATUS_TONES/getSubscriptionAccessState, alinhando codigo e schema.
- **Racional da verificacao:** Verifiquei o codigo real e confirmo o achado.

  EVIDENCIA NO CODIGO (bate exatamente):
  Em /opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e/src/lib/subscription.ts, getStatusMeta recebe Pick<SubscriptionRecord, "status" | "trial_ends_at" | "current_period_end"> e contem o bloco literal citado:
    if (subscription.status === "trial" && subscription.trial_ends_at) {
      return { label: STATUS_LABELS[subscription.status], tone: STATUS_TONES[subscription.status], detail: `Teste ate ${formatDate(subscription.trial_ends_at)}.` };
    }
  "trial" tambem consta em STATUS_LABELS/STATUS_TONES e em getSubscriptionAccessState (if status==="trial" return "active").

  COLUNA NAO EXISTE NO SCHEMA EXECUTAVEL (confirmado):
  - Criacao base em db/migrations/20260521143000_production_hardening.sql: CREATE TABLE public.subscriptions tem apenas id, store_id, plan_id, asaas_subscription_id, status (default 'pendente_pagamento'), last_payment_status, created_at, updated_at. Sem trial_ends_at.
  - db/migrations/20260526110000_subscription_and_manual_pix.sql adiciona asaas_customer_id, billing_type, external_reference, current_period_start, current_period_end, next_due_date, canceled_at, cancellation_effective_at. Sem trial_ends_at.
  - Revisei as demais migrations (store_profile_and_plan_safety, supabase_auth_storage_maps, store_public_profile_columns, store_contract_columns, etc.); nenhuma adiciona trial_ends_at a subscriptions. db/schema.sql e apenas um stub (aplica migrations).

  POR QUE COMPILA (confirmado, como o achado previu):
  src/integrations/backend/types.ts contem, na Row/Insert/Update de subscriptions, "trial_ends_at: string | null" (e tambem "provider: string | null"), apesar de nenhuma migration criar essas colunas. Ou seja, o types gerado esta dessincronizado com as migrations; por isso SubscriptionRecord = Tables<"subscriptions"> inclui o campo e o TS compila, mas em runtime o select sobre a tabela real retorna undefined para trial_ends_at.

  IMPACTO (baixo, como descrito):
  Nenhum handler grava status='trial' (default e 'pendente_pagamento'); os estados gravados sao pendente_pagamento/ativa/inadimplente/cancelada. Logo o branch 'trial' (e o detail "Teste ate ...") nunca executa com dados reais; e referencia a coluna inexistente / codigo morto, sem crash nem corrupcao. Severidade low.

  A unica nuance versus o texto do achado: ele diz que trial_ends_at "nao consta no types gerado" implicitamente? Nao — o achado explicitamente afirma que vem do types gerado e por isso compila, o que confere. A coluna realmente nao existe no schema SQL. Achado valido.

---

## Inventario do fluxo

Tenho o mapeamento completo do fluxo. Aqui está o inventário.

# Inventário — Fluxo de Assinaturas Asaas

Raiz: `/opt/gateway-users/1ce4a0e7-8782-48c5-b685-18c9618a023e`

## Observação importante de nomenclatura
O fluxo de assinaturas (plataforma cobrando o lojista) e o fluxo de Pix de pedido (cliente final pagando a loja) estão divididos:
- Assinaturas da plataforma vivem em `src/server/subscription.service.ts` + `src/server/asaas.server.ts` (objeto `asaas`).
- `src/server/asaas.service.ts` NÃO trata assinaturas — é o Pix manual de pedidos. As funções "asaas" de pedido (`src/functions/asaas.ts`, `src/server/asaas.functions.ts`) também são de pedido, exceto pelos stubs `createSubscriptionCheckout`/`testAsaasConnection` que lançam erro e redirecionam para o backend autenticado.

## Camada de servidor / integração

| Caminho | Papel / Exports principais |
|---|---|
| `src/server/asaas.server.ts` | Cliente HTTP do gateway Asaas (`/api/v3`). Export `asaas` com: `createCustomer`, `createSubscription`, `updateSubscription`, `cancelSubscription`, `listSubscriptionPayments` (estes são o núcleo das assinaturas). Métodos de Pix de loja (`createStorePayment`, `getPayment`, `refundPayment`, etc.) estão desabilitados por design (retornam `errors`). Usa `ASAAS_API_KEY`, `ASAAS_ENVIRONMENT`, redação de PII em logs, timeout 25s, header `access_token` e `Idempotency-Key`. |
| `src/server/subscription.service.ts` | **Núcleo do fluxo de assinaturas.** Exports: `createSubscriptionCheckoutHandler`, `updateSubscriptionPlanHandler`, `syncSubscriptionStatusHandler`, `cancelSubscriptionHandler`. Valida via Zod (cartão, cliente, upgrade-only), cria cliente+assinatura no Asaas, persiste em `public.subscriptions` (upsert por `store_id`), atualiza `stores.plan_id`, publica realtime. Statuses internos: `pendente_pagamento`, `ativa`, `inadimplente`, `cancelada`. |
| `src/server/asaas.service.ts` | Pix MANUAL de **pedidos** (não assinatura). Exports: `createOrderPaymentForOrder`, `getOrderPaymentInfoForOrder`, `syncOrderPaymentStatus`, `approveManualPixPayment`. Gera payload Pix copia-e-cola, aprova pagamento manualmente. |
| `src/server/asaas.functions.ts` | Barril/re-export de `@/functions/asaas` (`createOrderPayment`, `createSubscriptionCheckout`, `getOrderPaymentInfo`, `refundOrderPayment`, `syncPaymentStatus`, `testAsaasConnection`). |
| `src/functions/asaas.ts` | Server functions TanStack Start. `createSubscriptionCheckout` e `testAsaasConnection` são **stubs que lançam erro** ("use a function autenticada via backend.functions.invoke"). As de pedido (`createOrderPayment`, etc.) delegam a `asaas.service`. |
| `src/backend/functions.ts` | **Roteador `invokeFunction`** que registra os handlers de assinatura: `create-subscription-checkout` → `createSubscriptionCheckoutHandler`; `cancel-subscription` → `cancelSubscriptionHandler`; `sync-subscription-status` → `syncSubscriptionStatusHandler`; `update-subscription-plan` → `updateSubscriptionPlanHandler`. Importa `getActor`/`signUp` de `./auth`, `query`/`withTransaction` de `./db`. |

## Webhook

| Caminho | Papel |
|---|---|
| `src/routes/api/webhooks/asaas.ts` | Rota `POST /api/webhooks/asaas`; delega a `handleAsaasWebhook(request)`. |
| `src/backend/webhooks.ts` | Export `handleAsaasWebhook`. Valida `ASAAS_WEBHOOK_SECRET` (header `asaas-access-token`, `timingSafeEqual`). Eventos pagos: `PAYMENT_RECEIVED/CONFIRMED`; falha: `PAYMENT_OVERDUE`; cancelado: `PAYMENT_DELETED/CANCELLED`; estorno: `PAYMENT_REFUNDED/PARTIALLY_REFUNDED`. `updateSubscriptionIfPresent` atualiza `public.subscriptions` por `asaas_subscription_id`/`external_reference` (prefixo `platform-subscription:`). Pagamentos de pedido vão para `payments`+`orders`, registrando em `payment_events` (idempotência + validação de valor). |

## Backend infra

| Caminho | Papel |
|---|---|
| `src/backend/db.ts` | Acesso a Postgres. Exports `query`, `withTransaction` (usados por subscription.service, webhooks, asaas.service). |
| `src/backend/auth.ts` | Autenticação. Export `getActor` (retorna `{ admin, ownedStoreIds, user }` — base do `assertStoreAccess`) e `signUp`. |
| `src/backend/realtime.ts` | Export `publishRealtime` (eventos realtime da tabela `subscriptions`). |
| `src/backend/env.ts` | `validateRuntimeEnv`, `isProductionRuntime` (exige webhook secret em produção). |

## Frontend — cliente, páginas, admin, hooks

| Caminho | Papel |
|---|---|
| `src/services/subscription-billing.ts` | Camada cliente. Exports: `createSubscriptionCheckout`, `cancelSubscription`, `syncSubscriptionStatus`, `updateSubscriptionPlan` (chamam `backend.functions.invoke(...)`). Tipos `SubscriptionCardData`, `CreateSubscriptionCheckoutInput`. |
| `src/lib/subscription.ts` | Lógica de domínio/capabilities. Exports: `normalizePlan`, `getPlanLimits`, `canUseFeature`, `hasReachedLimit`, `getStatusMeta`, `getSubscriptionAccessState`, `getSubscriptionAccessMessage`, `isPaidPlan`, etc. Define `PLAN_PRESETS` (inicial/basico/essencial/pro/premium/white_label), limites e capacidades, e o mapeamento de status → estado de acesso (`active`/`pending_payment`/`past_due`/`canceled`/`blocked`/`no_plan`). |
| `src/hooks/use-subscription-status.ts` | **Hook de status.** Export `useSubscriptionStatus`. Busca admin (`is_vexor_admin`), `stores`, `subscriptions` (join `plans`), calcula `accessState` via `getSubscriptionAccessState`. Retorna `{ loading, accessState, message, subscription, plan, store, isPlatformAdmin, refresh, ... }`. |
| `src/components/SubscriptionGuard.tsx` | Guard de rota: redireciona para `/lojista/assinatura?state=...` quando `accessState !== "active"` (exceto admin/`is_exempt`). |
| `src/pages/lojista/Subscription.tsx` | **Página de assinatura do lojista** (`/lojista/assinatura`). Usa `useSubscriptionStatus` + `subscription-billing`. Formulário de cartão/checkout, troca de plano, cancelamento, sync. |
| `src/pages/admin/AdminPlans.tsx` | **Tela admin de gestão de planos** (CRUD em `plans`, `normalizePlan`, features). |
| `src/pages/admin/AdminStores.tsx` | Gestão admin de lojas (suspensão/isenção influenciam acesso). |
| `src/integrations/backend/client.ts` | `backend.from(...)`, `backend.rpc(...)`, `backend.functions.invoke(...)` — fonte das leituras `subscriptions`/`plans` e invocação das functions. |

Não existe arquivo dedicado de "tela admin de assinaturas" separado; a gestão admin é via planos (`AdminPlans.tsx`) e lojas (`AdminStores.tsx`). Não existe `src/backend/db/` nem `src/backend/auth/` como diretórios — são os arquivos `db.ts` e `auth.ts`.

## Schema das tabelas

`db/schema.sql` é apenas um stub (aponta para `db/migrations`). O DDL real está em `db/migrations/20260521143000_production_hardening.sql`, com colunas adicionadas em `20260526110000_subscription_and_manual_pix.sql` e `20260527102000_store_profile_and_plan_safety.sql`.

### Tabela `public.plans` (DDL consolidado)
```sql
-- base: 20260521143000_production_hardening.sql
CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price_monthly numeric DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- colunas adicionadas em: 20260527102000_store_profile_and_plan_safety.sql
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS features jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS max_products integer,
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allows_coupons boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS allows_advanced_reports boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS allows_custom_branding boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS allows_custom_domain boolean DEFAULT false;
```

### Tabela `public.subscriptions` (DDL consolidado)
```sql
-- base: 20260521143000_production_hardening.sql
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid UNIQUE NOT NULL,
  plan_id uuid,
  asaas_subscription_id text,
  status text DEFAULT 'pendente_pagamento',
  last_payment_status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- colunas adicionadas em: 20260526110000_subscription_and_manual_pix.sql
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS asaas_customer_id text,
  ADD COLUMN IF NOT EXISTS billing_type text,
  ADD COLUMN IF NOT EXISTS external_reference text,
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS next_due_date date,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_effective_at timestamptz;

CREATE INDEX IF NOT EXISTS subscriptions_asaas_subscription_id_idx
  ON public.subscriptions(asaas_subscription_id) WHERE asaas_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS subscriptions_external_reference_idx
  ON public.subscriptions(external_reference) WHERE external_reference IS NOT NULL;
```

Nota: `provider` (usado no `INSERT` do `subscription.service.ts`, valor `'asaas'`) é referenciado no código mas NÃO aparece em nenhuma migration lida — possível coluna ausente/criada em outra migration não localizada, ou risco de erro de schema.

## Fluxo end-to-end (resumo)
1. Lojista em `Subscription.tsx` → `subscription-billing.createSubscriptionCheckout` → `backend.functions.invoke("create-subscription-checkout")`.
2. `src/backend/functions.ts#invokeFunction` roteia → `createSubscriptionCheckoutHandler` (`subscription.service.ts`).
3. Handler valida acesso (`auth.getActor`), chama `asaas.server.ts` (`createCustomer`/`createSubscription`), persiste em `subscriptions` (`db.query`) e publica realtime.
4. Asaas notifica `POST /api/webhooks/asaas` → `webhooks.handleAsaasWebhook` atualiza `subscriptions.status` (`ativa`/`inadimplente`/`cancelada`).
5. `useSubscriptionStatus` lê `subscriptions`+`plans` e `getSubscriptionAccessState` define o acesso; `SubscriptionGuard` aplica o bloqueio de rota.
