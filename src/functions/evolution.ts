import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEFAULT_EVOLUTION_URL = "http://127.0.0.1:32773";

const getEvolutionConfig = () => ({
  baseUrl: (process.env.EVOLUTION_API_URL || DEFAULT_EVOLUTION_URL).replace(/\/$/, ""),
  apiKey: process.env.EVOLUTION_API_KEY || process.env.AUTHENTICATION_API_KEY || "",
  instance: process.env.EVOLUTION_INSTANCE || process.env.EVOLUTION_DEFAULT_INSTANCE || "",
});

export const notifyOrderCreated = createServerFn({ method: "POST" })
  .inputValidator(z.object({ orderId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", data.orderId)
      .maybeSingle();

    if (!order) return { sent: false, reason: "order_not_found" };

    const [{ data: store }, { data: settings }, { data: items }] = await Promise.all([
      supabaseAdmin.from("stores").select("*").eq("id", (order as any).store_id).maybeSingle(),
      supabaseAdmin.from("store_settings").select("whatsapp_number").eq("store_id", (order as any).store_id).maybeSingle(),
      supabaseAdmin.from("order_items").select("*, order_item_options(*)").eq("order_id", data.orderId),
    ]);

    const storePhone = firstPhone(settings?.whatsapp_number, (store as any)?.whatsapp, (store as any)?.whatsapp_number, (store as any)?.phone);
    const customerPhone = firstPhone((order as any).customer_phone);
    const storeMessage = buildStoreOrderMessage(order, store, items || []);
    const customerMessage = buildCustomerOrderMessage(order, store);

    const results = await Promise.allSettled([
      storePhone ? sendEvolutionText(storePhone, storeMessage) : Promise.resolve({ sent: false, reason: "missing_store_phone" }),
      customerPhone ? sendEvolutionText(customerPhone, customerMessage) : Promise.resolve({ sent: false, reason: "missing_customer_phone" }),
    ]);

    return {
      sent: results.some((result) => result.status === "fulfilled" && result.value.sent),
      results: results.map((result) => result.status === "fulfilled" ? result.value : { sent: false, reason: "send_failed" }),
    };
  });

export const notifyStoreCreated = createServerFn({ method: "POST" })
  .inputValidator(z.object({ storeId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { data: store } = await supabaseAdmin
      .from("stores")
      .select("*")
      .eq("id", data.storeId)
      .maybeSingle();

    if (!store) return { sent: false, reason: "store_not_found" };

    const phone = firstPhone((store as any).whatsapp, (store as any).whatsapp_number, (store as any).phone);
    if (!phone) return { sent: false, reason: "missing_store_phone" };

    return sendEvolutionText(phone, [
      `Sua loja ${store.public_name || store.name} foi criada na VexorTech.`,
      `Link do cardapio: https://vexortech.com.br/loja/${store.slug}`,
      "Proximo passo: complete endereco, coordenadas, raio de entrega e produtos no painel do parceiro.",
    ].join("\n"));
  });

const sendEvolutionText = async (phone: string, text: string) => {
  const config = getEvolutionConfig();
  if (!config.apiKey) return { sent: false, reason: "missing_api_key" };

  const instance = config.instance || await fetchFirstEvolutionInstance(config.baseUrl, config.apiKey);
  if (!instance) return { sent: false, reason: "missing_instance" };

  const response = await fetch(`${config.baseUrl}/message/sendText/${encodeURIComponent(instance)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.apiKey,
    },
    body: JSON.stringify({
      number: normalizeBrazilianPhone(phone),
      text,
    }),
  });

  if (!response.ok) {
    return { sent: false, reason: `http_${response.status}` };
  }

  return { sent: true, instance };
};

const fetchFirstEvolutionInstance = async (baseUrl: string, apiKey: string) => {
  try {
    const response = await fetch(`${baseUrl}/instance/fetchInstances`, { headers: { apikey: apiKey } });
    if (!response.ok) return "";
    const payload = await response.json();
    const instances = Array.isArray(payload) ? payload : payload?.response || [];
    const connected = instances.find((item: any) => {
      const state = String(item?.connectionStatus || item?.state || item?.instance?.state || "").toLowerCase();
      return state.includes("open") || state.includes("connected");
    }) || instances[0];
    return connected?.name || connected?.instanceName || connected?.instance?.instanceName || "";
  } catch {
    return "";
  }
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
  order.public_token ? `Acompanhe: https://vexortech.com.br/pedido/${order.public_token}` : null,
].filter(Boolean).join("\n");

const normalizeBrazilianPhone = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55")) return digits;
  return digits.length >= 10 ? `55${digits}` : digits;
};

const firstPhone = (...values: Array<string | null | undefined>) =>
  values.map((value) => value?.replace(/\D/g, "") || "").find((value) => value.length >= 10) || "";

const formatMoney = (value: number | string | null | undefined) =>
  Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

