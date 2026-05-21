import { backendAdmin } from "@/integrations/backend/client.server";

const DEFAULT_EVOLUTION_URL = "http://127.0.0.1:32773";
const DELIVERY_BASE_URL = "https://hypedelivery.com.br";
const REQUIRED_EVOLUTION_SENDER_PHONE = "11971582072";

const getEvolutionConfig = () => ({
  baseUrl: (process.env.EVOLUTION_API_URL || DEFAULT_EVOLUTION_URL).replace(/\/$/, ""),
  apiKey: process.env.EVOLUTION_API_KEY || process.env.AUTHENTICATION_API_KEY || "",
  instance: process.env.EVOLUTION_INSTANCE || process.env.EVOLUTION_DEFAULT_INSTANCE || "hypedelivery",
  senderPhone: process.env.EVOLUTION_SENDER_PHONE || REQUIRED_EVOLUTION_SENDER_PHONE,
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

  const storePhone = firstPhone(settings?.whatsapp_number, (store as any)?.whatsapp, (store as any)?.whatsapp_number, (store as any)?.phone);
  const customerPhone = firstPhone((order as any).customer_phone);
  const storeMessage = buildStoreOrderMessage(order, store, items || []);
  const customerMessage = buildCustomerOrderMessage(order, store);

  const results = await Promise.allSettled([
    storePhone ? sendEvolutionText(storePhone, storeMessage) : Promise.resolve({ sent: false, reason: "missing_store_phone" }),
    customerPhone ? sendEvolutionText(customerPhone, customerMessage, storePhone) : Promise.resolve({ sent: false, reason: "missing_customer_phone" }),
  ]);

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

  return sendEvolutionText(phone, [
    `Sua loja ${store.public_name || store.name} foi criada na Hype Delivery.`,
    `Link do cardapio: ${DELIVERY_BASE_URL}/loja/${store.slug}`,
    "Proximo passo: complete endereco, coordenadas, raio de entrega e produtos no painel do parceiro.",
  ].join("\n"));
};

export const sendOrderStatusNotification = async (orderId: string, status?: string, note?: string | null) => {
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

  const storePhone = firstPhone(settings?.whatsapp_number, (store as any)?.whatsapp, (store as any)?.whatsapp_number, (store as any)?.phone);
  const message = buildCustomerStatusMessage(order, store, status || (order as any).status, storePhone, note);

  return sendEvolutionText(customerPhone, message, storePhone);
};

const sendEvolutionText = async (phone: string, text: string, preferredInstancePhone?: string) => {
  const config = getEvolutionConfig();
  if (!config.apiKey) return { sent: false, reason: "missing_api_key" };

  const instance = await fetchEvolutionInstance(config.baseUrl, config.apiKey, config.instance, config.senderPhone || preferredInstancePhone);
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
    const candidates = [preferredInstance, normalizedPreferredPhone, normalizedPreferredPhone ? `store-${normalizedPreferredPhone}` : ""]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    const named = instances.find((item: any) => {
      const name = getInstanceName(item).toLowerCase();
      const phone = getInstancePhone(item);
      return candidates.includes(name) || (normalizedPreferredPhone && phone === normalizedPreferredPhone);
    });

    if (named && isEvolutionInstanceConnected(named)) return getInstanceName(named);

    if (normalizedPreferredPhone) return "";

    const connected = instances.find(isEvolutionInstanceConnected);
    if (connected) return getInstanceName(connected);

    if (named) return getInstanceName(named);

    const defaultNamed = instances.find((item: any) => getInstanceName(item).toLowerCase() === "hypedelivery");
    if (defaultNamed) return getInstanceName(defaultNamed);

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

const buildStoreOrderMessage = (order: any, store: any, items: any[]) => {
  const lines = items.map((item) => {
    const options = (item.order_item_options || [])
      .map((option: any) => `   + ${option.item_name}${Number(option.extra_price) > 0 ? ` (${formatMoney(option.extra_price)})` : ""}`)
      .join("\n");
    return `- ${item.quantity}x ${item.product_name}${options ? `\n${options}` : ""}${item.notes ? `\n   Obs: ${item.notes}` : ""}`;
  });

  return [
    `Novo pedido #${order.order_number || ""} - ${store?.public_name || store?.name || "Loja"}`,
    `Cliente: ${order.customer_name}`,
    `Telefone: ${order.customer_phone}`,
    `Tipo: ${order.delivery_type}`,
    order.delivery_type === "entrega" ? `Endereco: ${order.delivery_address}` : "Retirada no local",
    order.distance_km ? `Distancia: ${Number(order.distance_km).toFixed(1).replace(".", ",")} km` : null,
    "",
    "Itens:",
    ...lines,
    "",
    `Subtotal: ${formatMoney(order.subtotal)}`,
    `Entrega: ${formatMoney(order.delivery_fee)}`,
    `Total: ${formatMoney(order.total)}`,
    `Pagamento: ${order.payment_method}`,
    order.notes ? `Obs pedido: ${order.notes}` : null,
  ].filter(Boolean).join("\n");
};

const buildCustomerOrderMessage = (order: any, store: any) => [
  `${order.customer_name}, recebemos seu pedido #${order.order_number || ""} em ${store?.public_name || store?.name || "nossa loja"}.`,
  `Status inicial: ${order.status}.`,
  `Total: ${formatMoney(order.total)}.`,
  order.public_token ? `Acompanhe: ${DELIVERY_BASE_URL}/pedido/${order.public_token}` : null,
].filter(Boolean).join("\n");

const buildCustomerStatusMessage = (order: any, store: any, status: string, storePhone: string, note?: string | null) => {
  const label = STATUS_MESSAGE_LABELS[status] || `Status atualizado: ${status}`;
  return [
    `${order.customer_name || "Cliente"}, seu pedido #${order.order_number || ""} foi atualizado.`,
    label,
    order.delivery_type === "retirada" && status === "pronto_para_retirada" ? "Pode retirar no local informado pela loja." : null,
    order.delivery_type === "entrega" && status === "saiu_para_entrega" ? "Fique de olho no telefone e no endereco de entrega." : null,
    note ? `Observacao: ${note}` : null,
    `Loja: ${store?.public_name || store?.name || "Hype Delivery"}.`,
    storePhone ? `Contato da loja: ${formatPhoneForMessage(storePhone)}` : null,
    order.public_token ? `Acompanhe em tempo real: ${DELIVERY_BASE_URL}/pedido/${order.public_token}` : null,
  ].filter(Boolean).join("\n");
};

const STATUS_MESSAGE_LABELS: Record<string, string> = {
  aguardando_pagamento: "Estamos aguardando a confirmacao do pagamento PIX.",
  novo: "Pedido recebido e encaminhado para a loja.",
  confirmado: "A loja confirmou seu pedido.",
  em_preparo: "Seu pedido entrou em preparo.",
  saiu_para_entrega: "Seu pedido saiu para entrega.",
  pronto_para_retirada: "Seu pedido esta pronto para retirada.",
  entregue: "Pedido entregue. Obrigado pela preferencia!",
  cancelado: "Pedido cancelado pela loja.",
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
