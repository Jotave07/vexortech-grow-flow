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

  const results = [];
  for (const promise of messages) {
    const result = await promise.catch(() => ({ sent: false, reason: "send_failed" }));
    results.push(result);
    if (messages.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  return {
    sent: results.some((r) => r && (r as any).sent),
    results,
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

const CUSTOMER_NOTIFIABLE_STATUSES = new Set([
  "em_preparo",
  "saiu_para_entrega",
]);

export const sendOrderStatusNotification = async (orderId: string, status?: string, note?: string | null) => {
  const targetStatus = status || "";
  if (!CUSTOMER_NOTIFIABLE_STATUSES.has(targetStatus)) {
    return { sent: false, reason: "status_without_customer_notification" };
  }

  const { data: order } = await backendAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return { sent: false, reason: "order_not_found" };

  const [{ data: store }, { data: items }] = await Promise.all([
    backendAdmin.from("stores").select("*").eq("id", (order as any).store_id).maybeSingle(),
    backendAdmin.from("order_items").select("*, order_item_options(*)").eq("order_id", orderId),
  ]);

  const customerPhone = firstPhone((order as any).customer_phone);
  if (!customerPhone) return { sent: false, reason: "missing_customer_phone" };

  const config = getEvolutionConfig();
  const message = buildCustomerStatusMessage(order, store, targetStatus, config.appUrl, items || [], note);

  return sendIdempotentOrderNotification(`order_status_${targetStatus}`, orderId, customerPhone, message);
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

const escapeWhatsApp = (value: string) =>
  String(value || "")
    .replace(/[`*_~>]/g, "");

const buildStoreOrderMessage = (order: any, store: any, items: any[], appUrl: string) => {
  const isDelivery = order.delivery_type === "entrega";
  const fee = Number(order.delivery_fee || 0);
  const discount = Number(order.discount_amount || 0);
  const itemsLines = buildItemsSummary(items);

  return [
    "\u{1F514} *NOVO PEDIDO #" + escapeWhatsApp(String(order.order_number || "")) + "*",
    "",
    `\u{1F465} ${escapeWhatsApp(order.customer_name)}`,
    `\u{1F4DE} ${formatPhoneForMessage(order.customer_phone || "")}`,
    isDelivery ? "\u{1F69A} *ENTREGA*" : "\u{1F3EA} *RETIRADA NO LOCAL*",
  ]
  .concat(isDelivery ? [
    `\u{1F4CD} ${escapeWhatsApp(String(order.delivery_address || ""))}`,
    order.delivery_reference ? `Ref: ${escapeWhatsApp(String(order.delivery_reference))}` : "",
    order.delivery_complement ? `Compl: ${escapeWhatsApp(String(order.delivery_complement))}` : "",
    order.distance_km ? `Dist: ${Number(order.distance_km).toFixed(1).replace(".", ",")} km` : "",
  ] : [])
  .concat([
    "",
    "*Itens:*",
    itemsLines,
    "",
    `\u{1F4B0} Subtotal: ${formatMoney(order.subtotal)}`,
    isDelivery && fee > 0 ? `\u{1F69A} Entrega: ${formatMoney(fee)}` : "",
    discount > 0 ? `\u{1F389} Desconto: -${formatMoney(discount)}` : "",
    `\u{1F4B3} *Total: ${formatMoney(order.total)}*`,
    "",
    `\u{1F4B1} ${(order.payment_method || "").toUpperCase()}`,
    order.payment_method === "dinheiro" && Number(order.change_for) > 0 ? `Troco para: ${formatMoney(order.change_for)}` : "",
    order.notes ? `\u{1F4DD} ${escapeWhatsApp(order.notes)}` : "",
    "",
    `\u{1F517} Painel: ${appUrl}/lojista/pedidos`,
  ])
  .filter(Boolean).join("\n");
};

const buildCustomerOrderMessage = (order: any, store: any, items: any[], appUrl: string) => {
  const isDelivery = order.delivery_type === "entrega";
  const isPix = order.payment_method === "pix";
  const fee = Number(order.delivery_fee || 0);
  const discount = Number(order.discount_amount || 0);
  const itemsLines = buildItemsSummary(items);
  const storeName = store?.public_name || store?.name || "nossa loja";
  const trackingUrl = order.public_token ? `${appUrl}/pedido/${order.public_token}` : "";

  return [
    `\u{1F4E6} *Pedido Recebido* \u{1F4E6}`,
    "",
    `Ola, *${escapeWhatsApp(order.customer_name || "Cliente")}*!`,
    "",
    `Seu pedido #${escapeWhatsApp(String(order.order_number || ""))} foi recebido por *${escapeWhatsApp(storeName)}*.`,
    isPix ? "" : "",
    "",
    "*Itens do Pedido:*",
    itemsLines,
    "",
    `\u{1F4B0} Subtotal: ${formatMoney(order.subtotal)}`,
    isDelivery && fee > 0 ? `\u{1F69A} Entrega: ${formatMoney(fee)}` : "",
    discount > 0 ? `\u{1F389} Desconto: -${formatMoney(discount)}` : "",
    `\u{1F4B3} *Total: ${formatMoney(order.total)}*`,
    "",
    `\u{1F4B1} Pagamento: ${(order.payment_method || "").toUpperCase()}`,
  ]
  .concat(isDelivery ? [
    "",
    `\u{1F4CD} *Entrega em:*`,
    `${escapeWhatsApp(String(order.delivery_address || ""))}`,
    order.delivery_reference ? `Ref: ${escapeWhatsApp(String(order.delivery_reference))}` : "",
  ] : [])
  .concat([
    "",
    isPix
      ? "⏳ Apos a confirmacao do PIX, seu pedido entrara em preparo."
      : "🔥 Seu pedido ja esta sendo encaminhado para preparo!",
    trackingUrl ? "" : "",
    trackingUrl ? `🔗 Acompanhe: ${trackingUrl}` : "",
  ])
  .filter(Boolean).join("\n");
};

const STATUS_EMOJI: Record<string, string> = {
  em_preparo: "👨‍🍳",
  saiu_para_entrega: "🛥️",
};

const STATUS_LABEL: Record<string, string> = {
  em_preparo: "Em Preparo",
  saiu_para_entrega: "Saiu para Entrega",
};

const STATUS_MESSAGE: Record<string, string> = {
  em_preparo: "Seu pedido esta sendo preparado com todo cuidado.",
  saiu_para_entrega: "Seu pedido saiu para entrega e esta a caminho.",
};

const buildItemsSummary = (items: any[]) => {
  if (!items?.length) return "";
  const lines = items.map((item) => {
    const name = item.product_name || "";
    const qty = item.quantity || 1;
    const options = (item.order_item_options || [])
      .map((o: any) => o.item_name || o.name)
      .filter(Boolean)
      .join(", ");
    const detail = options ? `${name} (${options})` : name;
    return `  • ${qty}x ${detail}`;
  });
  return lines.join("\n");
};

const buildCustomerStatusMessage = (order: any, store: any, status: string, appUrl: string, items: any[], note?: string | null) => {
  const emoji = STATUS_EMOJI[status] || "📦";
  const label = STATUS_LABEL[status] || "Atualizacao";
  const msg = STATUS_MESSAGE[status] || "";
  const isPickup = order.delivery_type === "retirada";
  const isDelivery = order.delivery_type === "entrega";
  const trackingUrl = order.public_token ? `${appUrl}/pedido/${order.public_token}` : "";
  const itemsLines = buildItemsSummary(items);

  const header = `${emoji} *${label}* ${emoji}`;
  const greeting = `Ola, *${escapeWhatsApp(order.customer_name || "Cliente")}*!`;

  const lines = [
    header,
    "",
    greeting,
    "",
    msg,
    "",
    `*Resumo do Pedido #${escapeWhatsApp(String(order.order_number || ""))}*`,
  ];

  if (itemsLines) {
    lines.push(itemsLines);
  }

  const fee = Number(order.delivery_fee || 0);
  const discount = Number(order.discount_amount || 0);

  lines.push("");
  lines.push(`💰 Subtotal: ${formatMoney(order.subtotal)}`);
  if (isDelivery && fee > 0) lines.push(`🚚 Entrega: ${formatMoney(fee)}`);
  if (discount > 0) lines.push(`🎉 Desconto: -${formatMoney(discount)}`);
  lines.push(`💳 *Total: ${formatMoney(order.total)}*`);

  if (order.payment_method) {
    const methodLabel = {
      pix: "PIX",
      dinheiro: "Dinheiro",
      cartao_credito: "Cartao de Credito",
      cartao_debito: "Cartao de Debito",
      vr: "Vale Refeicao",
    }[order.payment_method] || order.payment_method;
    lines.push(`💱 Pagamento: ${methodLabel}`);
  }

  lines.push("");

  if (isDelivery) {
    lines.push(`📌 *Endereco de Entrega*`);
    lines.push(`${escapeWhatsApp(String(order.delivery_address || ""))}`);
    if (order.delivery_reference) {
      lines.push(`Ref: ${escapeWhatsApp(String(order.delivery_reference))}`);
    }
    if (order.delivery_complement) {
      lines.push(`Compl: ${escapeWhatsApp(String(order.delivery_complement))}`);
    }
    lines.push("");
  }

  if (isPickup) {
    lines.push(`🏪 *Retirada na Loja*`);
    if (store?.address) lines.push(`${escapeWhatsApp(store.address)}`);
    lines.push("");
  }

  if (status === "saiu_para_entrega" && order.estimated_min) {
    lines.push(`⏱️ Previsao de entrega: ${order.estimated_min}-${order.estimated_max || order.estimated_min} min`);
    lines.push("");
  }

  if (trackingUrl) {
    lines.push(`🔗 Acompanhe em tempo real:`);
    lines.push(trackingUrl);
    lines.push("");
  }

  if (note) {
    lines.push(`📝 ${escapeWhatsApp(note)}`);
    lines.push("");
  }

  return lines.join("\n");
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
