import { query } from "@/backend/db";
import { backendAdmin } from "@/integrations/backend/client.server";

const clean = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "";
};

const getEvolutionConfig = () => ({
  baseUrl: (clean(process.env.EVOLUTION_API_URL) || "").replace(/\/$/, ""),
  apiKey: clean(process.env.EVOLUTION_API_KEY),
  instance: clean(process.env.EVOLUTION_INSTANCE),
  automationPhone: clean(process.env.EVOLUTION_AUTOMATION_PHONE),
  sendCustomerConfirmation:
    process.env.NODE_ENV === "production" ||
    process.env.EVOLUTION_SEND_CUSTOMER_CONFIRMATION === "true",
  appUrl: clean(process.env.PUBLIC_APP_URL) || "https://hypedelivery.com.br",
});

export const notifyOrderCreatedHandler = async (orderId: string) => {
  const { data: order } = await backendAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return { sent: false, reason: "order_not_found" };

  const [{ data: store }, { data: settings }, { data: items }] = await Promise.all([
    backendAdmin.from("stores").select("*").eq("id", (order as any).store_id).maybeSingle(),
    backendAdmin.from("store_settings").select("whatsapp_number").eq("store_id", (order as any).store_id).maybeSingle(),
    backendAdmin.from("order_items").select("*, order_item_options(*)").eq("order_id", orderId),
  ]);

  const config = getEvolutionConfig();
  const storePhone = firstPhone(settings?.whatsapp_number, (store as any)?.whatsapp, (store as any)?.whatsapp_number, (store as any)?.phone);
  const customerPhone = firstPhone((order as any).customer_phone);
  const messages = [
    storePhone
      ? sendIdempotentOrderNotification("order_created_store", orderId, storePhone, buildStoreOrderMessage(order, store, items || [], config.appUrl))
      : Promise.resolve({ sent: false, reason: "missing_store_phone" }),
  ];

  if (config.sendCustomerConfirmation) {
    messages.push(
      customerPhone
        ? sendIdempotentOrderNotification("order_created_customer", orderId, customerPhone, buildCustomerOrderMessage(order, store, items || [], config.appUrl), storePhone)
        : Promise.resolve({ sent: false, reason: "missing_customer_phone" }),
    );
  }

  const results = await Promise.allSettled(messages);
  return {
    sent: results.some((result) => result.status === "fulfilled" && result.value.sent),
    results: results.map((result) => result.status === "fulfilled" ? result.value : { sent: false, reason: "send_failed" }),
  };
};

export const notifyStoreCreatedHandler = async (storeId: string) => {
  const { data: store } = await backendAdmin
    .from("stores")
    .select("*")
    .eq("id", storeId)
    .maybeSingle();

  if (!store) return { sent: false, reason: "store_not_found" };

  const phone = firstPhone((store as any).whatsapp, (store as any).whatsapp_number, (store as any).phone);
  if (!phone) return { sent: false, reason: "missing_store_phone" };

  const config = getEvolutionConfig();
  return sendIdempotentNotification("store_created", storeId, phone, [
    `Sua loja ${store.public_name || store.name} foi criada na Hype Delivery.`,
    `Link do cardapio: ${config.appUrl}/loja/${store.slug}`,
    "Proximo passo: complete endereco, coordenadas, raio de entrega e produtos no painel do parceiro.",
  ].join("\n"));
};

export const sendOrderStatusNotification = async (orderId: string, status?: string, note?: string | null) => {
  const targetStatus = status || "";
  if (!["saiu_para_entrega", "pronto_para_retirada", "novo"].includes(targetStatus)) {
    return { sent: false, reason: "status_without_customer_notification" };
  }

  const { data: order } = await backendAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return { sent: false, reason: "order_not_found" };

  const [{ data: store }, { data: settings }] = await Promise.all([
    backendAdmin.from("stores").select("*").eq("id", (order as any).store_id).maybeSingle(),
    backendAdmin.from("store_settings").select("whatsapp_number").eq("store_id", (order as any).store_id).maybeSingle(),
  ]);

  const customerPhone = firstPhone((order as any).customer_phone);
  if (!customerPhone) return { sent: false, reason: "missing_customer_phone" };

  const config = getEvolutionConfig();
  const storePhone = firstPhone(settings?.whatsapp_number, (store as any)?.whatsapp, (store as any)?.whatsapp_number, (store as any)?.phone);
  const message = buildCustomerStatusMessage(order, store, targetStatus, storePhone, config.appUrl, note);

  return sendIdempotentOrderNotification(`order_status_${targetStatus}`, orderId, customerPhone, message, storePhone);
};

const sendIdempotentOrderNotification = (
  eventType: string,
  orderId: string,
  phone: string,
  text: string,
  preferredInstancePhone?: string,
) => sendIdempotentNotification(eventType, orderId, phone, text, preferredInstancePhone);

const sendIdempotentNotification = async (
  eventType: string,
  orderId: string,
  phone: string,
  text: string,
  preferredInstancePhone?: string,
) => {
  const recipient = normalizeBrazilianPhone(phone);
  const { rows } = await query(
    `INSERT INTO public.notification_events (provider, event_type, order_id, recipient_phone, status)
     VALUES ('evolution', $1, $2, $3, 'pending')
     ON CONFLICT (provider, event_type, order_id, recipient_phone) DO NOTHING
     RETURNING id`,
    [eventType, orderId, recipient],
  ).catch(() => ({ rows: [{ id: null }] }));

  if (!rows[0]?.id) return { sent: false, duplicate: true };

  const result = await sendEvolutionText(recipient, text, preferredInstancePhone);
  await query(
    `UPDATE public.notification_events
     SET status = $2, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END, error = $3
     WHERE id = $1`,
    [rows[0].id, result.sent ? "sent" : "failed", result.sent ? null : result.reason || "send_failed"],
  ).catch(() => null);

  return result;
};

const sendEvolutionText = async (phone: string, text: string, preferredInstancePhone?: string) => {
  const config = getEvolutionConfig();
  if (!config.baseUrl) return { sent: false, reason: "missing_base_url" };
  if (!config.apiKey) return { sent: false, reason: "missing_api_key" };

  const instance = await fetchEvolutionInstance(config.baseUrl, config.apiKey, config.instance, config.automationPhone || preferredInstancePhone);
  if (!instance) return { sent: false, reason: "missing_sender_instance" };

  const url = `${config.baseUrl}/message/sendText/${encodeURIComponent(instance)}`;
  const headers = {
    "Content-Type": "application/json",
    apikey: config.apiKey,
  };

  let response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      number: normalizeBrazilianPhone(phone),
      text,
      delay: 700,
      linkPreview: false,
    }),
  });

  if (!response.ok && [400, 404, 422].includes(response.status)) {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        number: normalizeBrazilianPhone(phone),
        textMessage: { text },
        delay: 700,
        linkPreview: false,
      }),
    });
  }

  if (!response.ok) {
    return { sent: false, reason: `http_${response.status}` };
  }

  return { sent: true, instance };
};

const fetchEvolutionInstance = async (baseUrl: string, apiKey: string, preferredInstance?: string, preferredPhone?: string) => {
  try {
    const response = await fetch(`${baseUrl}/instance/fetchInstances`, { headers: { apikey: apiKey } });
    if (!response.ok) return preferredInstance || "";
    const payload = await response.json();
    const instances = Array.isArray(payload) ? payload : payload?.response || [];

    const normalizedPreferredPhone = preferredPhone ? normalizeBrazilianPhone(preferredPhone) : "";
    const preferredInstanceName = String(preferredInstance || "").toLowerCase();
    const candidates = [preferredInstance, normalizedPreferredPhone, normalizedPreferredPhone ? `store-${normalizedPreferredPhone}` : ""]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    const namedByInstance = preferredInstanceName
      ? instances.find((item: any) => getInstanceName(item).toLowerCase() === preferredInstanceName)
      : null;
    if (namedByInstance && isEvolutionInstanceConnected(namedByInstance)) return getInstanceName(namedByInstance);
    if (preferredInstance && !normalizedPreferredPhone) return preferredInstance;

    const named = instances.find((item: any) => {
      const name = getInstanceName(item).toLowerCase();
      const phone = getInstancePhone(item);
      return candidates.includes(name) || (normalizedPreferredPhone && phone === normalizedPreferredPhone);
    });

    if (named && isEvolutionInstanceConnected(named)) return getInstanceName(named);
    if (preferredInstance && namedByInstance) return preferredInstance;
    if (preferredInstance && !named) return preferredInstance;
    if (normalizedPreferredPhone) return "";

    const connected = instances.find(isEvolutionInstanceConnected);
    if (connected) return getInstanceName(connected);
    if (named) return getInstanceName(named);

    return preferredInstance || getInstanceName(instances[0]) || "";
  } catch {
    return preferredInstance || "";
  }
};

const getInstanceName = (item: any) =>
  item?.name || item?.instanceName || item?.instance?.instanceName || "";

const getInstancePhone = (item: any) =>
  firstPhone(
    item?.number,
    item?.phone,
    item?.owner,
    item?.ownerJid,
    item?.profile?.phone,
    item?.instance?.number,
    item?.instance?.phone,
    item?.instance?.owner,
    item?.instance?.ownerJid,
  )
    ? normalizeBrazilianPhone(firstPhone(
      item?.number,
      item?.phone,
      item?.owner,
      item?.ownerJid,
      item?.profile?.phone,
      item?.instance?.number,
      item?.instance?.phone,
      item?.instance?.owner,
      item?.instance?.ownerJid,
    ))
    : "";

const isEvolutionInstanceConnected = (item: any) => {
  const state = String(item?.connectionStatus || item?.state || item?.instance?.state || "").toLowerCase();
  return state.includes("open") || state.includes("connected");
};

const buildItemsLines = (items: any[]) => items.map((item) => {
  const options = (item.order_item_options || [])
    .map((option: any) => `   + ${option.item_name}${Number(option.extra_price) > 0 ? ` (${formatMoney(option.extra_price)})` : ""}`)
    .join("\n");
  return `- ${item.quantity}x ${item.product_name}${options ? `\n${options}` : ""}${item.notes ? `\n   Obs: ${item.notes}` : ""}`;
});

const buildStoreOrderMessage = (order: any, store: any, items: any[], appUrl: string) => [
  `Novo pedido registrado #${order.order_number || ""}`,
  `Loja: ${store?.public_name || store?.name || "Loja"}`,
  `Cliente: ${order.customer_name}`,
  `Telefone: ${order.customer_phone}`,
  `Tipo: ${order.delivery_type}`,
  order.delivery_type === "entrega" ? `Endereco: ${order.delivery_address}` : "Retirada no local",
  order.delivery_reference ? `Referencia: ${order.delivery_reference}` : null,
  order.distance_km ? `Distancia: ${Number(order.distance_km).toFixed(1).replace(".", ",")} km` : null,
  "",
  "Itens:",
  ...buildItemsLines(items),
  "",
  `Subtotal: ${formatMoney(order.subtotal)}`,
  `Frete: ${formatMoney(order.delivery_fee)}`,
  Number(order.discount_amount || 0) > 0 ? `Desconto: ${formatMoney(order.discount_amount)}` : null,
  `Total: ${formatMoney(order.total)}`,
  `Pagamento: ${order.payment_method}`,
  order.notes ? `Obs pedido: ${order.notes}` : null,
  `Painel: ${appUrl}/lojista/pedidos`,
].filter(Boolean).join("\n");

const buildCustomerOrderMessage = (order: any, store: any, items: any[], appUrl: string) => [
  `${order.customer_name}, recebemos seu pedido #${order.order_number || ""} em ${store?.public_name || store?.name || "nossa loja"}.`,
  "",
  "Itens:",
  ...buildItemsLines(items),
  "",
  `Subtotal: ${formatMoney(order.subtotal)}`,
  `Frete: ${formatMoney(order.delivery_fee)}`,
  Number(order.discount_amount || 0) > 0 ? `Desconto: ${formatMoney(order.discount_amount)}` : null,
  `Total: ${formatMoney(order.total)}`,
  `Pagamento: ${order.payment_method}`,
  `Status inicial: ${order.status}.`,
  order.payment_method === "pix" ? "Pedido entra na fila apos confirmacao do PIX." : null,
  order.public_token ? `Acompanhe: ${appUrl}/pedido/${order.public_token}` : null,
].filter(Boolean).join("\n");

const buildCustomerStatusMessage = (order: any, store: any, status: string, storePhone: string, appUrl: string, note?: string | null) => {
  const isPickup = status === "pronto_para_retirada";
  return [
    `${order.customer_name || "Cliente"}, atualizacao do pedido #${order.order_number || ""}.`,
    isPickup ? "Seu pedido esta pronto para retirada." : STATUS_MESSAGE_LABELS[status],
    status === "saiu_para_entrega" && order.estimated_min ? `Previsao: ${order.estimated_min}-${order.estimated_max || order.estimated_min} min.` : null,
    order.delivery_type === "entrega" ? `Endereco: ${order.delivery_address}` : `Retirada em: ${store?.address || store?.city || "endereco da loja"}`,
    note ? `Observacao: ${note}` : null,
    `Loja: ${store?.public_name || store?.name || "Hype Delivery"}.`,
    storePhone ? `Contato da loja: ${formatPhoneForMessage(storePhone)}` : null,
    order.public_token ? `Acompanhe em tempo real: ${appUrl}/pedido/${order.public_token}` : null,
  ].filter(Boolean).join("\n");
};

const STATUS_MESSAGE_LABELS: Record<string, string> = {
  novo: "Pagamento confirmado. Seu pedido foi encaminhado para a loja.",
  saiu_para_entrega: "Seu pedido saiu para entrega.",
  pronto_para_retirada: "Seu pedido esta pronto para retirada.",
};

const normalizeBrazilianPhone = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55")) return digits;
  return digits.length >= 10 ? `55${digits}` : digits;
};

const firstPhone = (...values: Array<string | null | undefined>) =>
  values.map((value) => value?.replace(/\D/g, "") || "").find((value) => value.length >= 10) || "";

const formatMoney = (value: number | string | null | undefined) =>
  Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatPhoneForMessage = (phone: string) => {
  const digits = normalizeBrazilianPhone(phone);
  if (digits.startsWith("55") && digits.length >= 12) {
    const local = digits.slice(2);
    if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
    if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return digits;
};
