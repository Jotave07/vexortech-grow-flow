import { z } from "zod";
import type pg from "pg";
import type { BackendResult } from "@/integrations/backend/compat-types";
import { getActor } from "@/backend/auth";
import { withTransaction } from "@/backend/db";
import { isStoreOpen } from "@/lib/opening-hours";
import { createOrderPaymentForOrder } from "./asaas.service";
import { notifyOrderCreatedHandler } from "@/functions/evolution.server";
import { quoteDelivery } from "./delivery.service";

type DbClient = Pick<pg.PoolClient, "query">;

type Actor = NonNullable<Awaited<ReturnType<typeof getActor>>>;

type CheckoutDeps = {
  getActor: typeof getActor;
  withTransaction: typeof withTransaction;
  createPayment: typeof createOrderPaymentForOrder;
  notifyOrderCreated: typeof notifyOrderCreatedHandler;
  quoteDelivery: typeof quoteDelivery;
};

const defaultDeps: CheckoutDeps = {
  getActor,
  withTransaction,
  createPayment: createOrderPaymentForOrder,
  notifyOrderCreated: notifyOrderCreatedHandler,
  quoteDelivery,
};

const paymentMethods = [
  "pix",
  "dinheiro",
  "cartao_credito_entrega",
  "cartao_debito_entrega",
] as const;

const checkoutInputSchema = z.object({
  storeId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(160),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive().max(99),
    notes: z.string().max(500).optional().nullable(),
    options: z.array(z.object({
      optionId: z.string().uuid(),
      itemId: z.string().uuid(),
    })).default([]),
  })).min(1),
  customer: z.object({
    name: z.string().min(1).max(160),
    document: z.string().max(32).optional().nullable(),
    phone: z.string().min(8).max(32),
    email: z.string().email().optional().nullable(),
  }),
  delivery: z.object({
    type: z.enum(["entrega", "retirada"]),
    zipCode: z.string().max(16).optional().nullable(),
    street: z.string().max(200).optional().nullable(),
    number: z.string().max(40).optional().nullable(),
    complement: z.string().max(120).optional().nullable(),
    neighborhood: z.string().max(120).optional().nullable(),
    city: z.string().max(120).optional().nullable(),
    state: z.string().max(2).optional().nullable(),
    regionId: z.string().uuid().optional().nullable(),
    reference: z.string().max(180).optional().nullable(),
    customerCoordinates: z.object({
      lat: z.number(),
      lng: z.number(),
    }).optional().nullable(),
  }),
  paymentMethod: z.enum(paymentMethods),
  changeFor: z.number().nonnegative().optional().nullable(),
  couponCode: z.string().max(80).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  reference: z.string().max(160).optional().nullable(),
});

export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

const onlyDigits = (value?: string | null) => String(value || "").replace(/\D/g, "");
const upper = (value?: string | null) => String(value || "").trim().toUpperCase();
const money = (value: unknown) => Number(Number(value || 0).toFixed(2));

const buildOrderNotes = (input: CheckoutInput) => {
  const notes = input.notes?.trim();
  return notes || null;
};

const optionLimits = (group: any) => {
  const min = Math.max(group.is_required ? 1 : 0, Number(group.min_choices || 0));
  const max = Math.max(min, Number(group.max_choices || 1));
  return { min, max };
};

const isPaymentMethodAccepted = (settings: any, method: CheckoutInput["paymentMethod"]) => {
  if (method === "pix") return Boolean(settings.accept_pix) && Boolean(String(settings.pix_key || "").trim());
  if (method === "dinheiro") return Boolean(settings.accept_cash);
  return Boolean(settings.accept_card_on_delivery);
};

const loadProductsContext = async (client: DbClient, storeId: string, productIds: string[]) => {
  const { rows: products } = await client.query(
    `SELECT * FROM public.products
     WHERE store_id = $1 AND id = ANY($2::uuid[])`,
    [storeId, productIds],
  );
  const { rows: groups } = await client.query(
    `SELECT po.*
     FROM public.product_options po
     JOIN public.products p ON p.id = po.product_id
     WHERE p.store_id = $1 AND po.product_id = ANY($2::uuid[])`,
    [storeId, productIds],
  );
  const { rows: optionItems } = await client.query(
    `SELECT poi.*
     FROM public.product_option_items poi
     JOIN public.product_options po ON po.id = poi.option_id
     JOIN public.products p ON p.id = po.product_id
     WHERE p.store_id = $1 AND po.product_id = ANY($2::uuid[])`,
    [storeId, productIds],
  );

  return { products, groups, optionItems };
};

const calculateItems = (input: CheckoutInput, products: any[], groups: any[], optionItems: any[]) => {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const optionItemsById = new Map(optionItems.map((item) => [item.id, item]));
  const calculatedItems: Array<{
    input: CheckoutInput["items"][number];
    product: any;
    unitPrice: number;
    optionsTotal: number;
    subtotal: number;
    options: any[];
  }> = [];

  let subtotal = 0;
  for (const cartItem of input.items) {
    const product = productsById.get(cartItem.productId);
    if (!product) throw new Error("Produto nao encontrado no cardapio.");
    if (!product.is_active || product.is_available === false) {
      throw new Error(`Produto "${product.name}" esta indisponivel.`);
    }

    const productGroups = groups.filter((group) => group.product_id === product.id);
    const selectedByGroup = new Map<string, CheckoutInput["items"][number]["options"]>();
    for (const selected of cartItem.options) {
      selectedByGroup.set(selected.optionId, [...(selectedByGroup.get(selected.optionId) || []), selected]);
    }

    for (const group of productGroups) {
      const selected = selectedByGroup.get(group.id) || [];
      const { min, max } = optionLimits(group);
      const activeItems = optionItems.filter((item) => item.option_id === group.id && item.is_active !== false);
      if (min > 0 && activeItems.length === 0) throw new Error(`Produto "${product.name}" esta sem opcoes disponiveis.`);
      if (selected.length < min) throw new Error(`Falta escolher "${group.name}" em "${product.name}".`);
      if (selected.length > max) throw new Error(`Limite de "${group.name}" excedido em "${product.name}".`);
    }

    const selectedOptions = cartItem.options.map((selected) => {
      const group = groupsById.get(selected.optionId);
      const optionItem = optionItemsById.get(selected.itemId);
      if (!group || group.product_id !== product.id) throw new Error(`Opcao invalida em "${product.name}".`);
      if (!optionItem || optionItem.option_id !== group.id || optionItem.is_active === false) {
        throw new Error(`Opcao indisponivel em "${product.name}".`);
      }
      return {
        group,
        item: optionItem,
        extraPrice: money(optionItem.extra_price),
      };
    });

    const unitPrice = money(product.promo_price ?? product.price);
    const optionsTotal = money(selectedOptions.reduce((sum, option) => sum + option.extraPrice, 0));
    const itemSubtotal = money((unitPrice + optionsTotal) * cartItem.quantity);
    subtotal = money(subtotal + itemSubtotal);
    calculatedItems.push({ input: cartItem, product, unitPrice, optionsTotal, subtotal: itemSubtotal, options: selectedOptions });
  }

  return { calculatedItems, subtotal };
};

const loadCoupon = async (client: DbClient, storeId: string, couponCode?: string | null) => {
  const code = String(couponCode || "").trim();
  if (!code) return null;
  const { rows } = await client.query(
    `SELECT *
     FROM public.coupons
     WHERE store_id = $1 AND lower(code) = lower($2)
     LIMIT 1
     FOR UPDATE`,
    [storeId, code],
  );
  return rows[0] || null;
};

const calculateDiscount = (coupon: any, subtotal: number) => {
  if (!coupon) return 0;
  if (coupon.is_active === false) throw new Error("Cupom inativo.");
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) throw new Error("Cupom expirado.");
  if (coupon.usage_limit !== null && coupon.usage_limit !== undefined && Number(coupon.usage_count || 0) >= Number(coupon.usage_limit)) {
    throw new Error("Cupom esgotado.");
  }
  const minOrder = money(coupon.min_order_value ?? 0);
  if (subtotal < minOrder) throw new Error(`Cupom valido para pedidos acima de R$ ${minOrder.toFixed(2)}.`);

  const raw =
    coupon.discount_type === "percentual"
      ? (subtotal * Number(coupon.discount_value || 0)) / 100
      : Number(coupon.discount_value || 0);
  const capped = coupon.max_discount_amount ? Math.min(raw, Number(coupon.max_discount_amount)) : raw;
  return money(Math.min(capped, subtotal));
};

const createOrUpdateCustomer = async (client: DbClient, input: CheckoutInput, actor: Actor) => {
  const { rows: existingRows } = await client.query(
    `SELECT * FROM public.customers
     WHERE store_id = $1 AND user_id = $2
     ORDER BY created_at NULLS LAST
     LIMIT 1
     FOR UPDATE`,
    [input.storeId, actor.user.id],
  );

  const values = [
    input.storeId,
    actor.user.id,
    upper(input.customer.name),
    onlyDigits(input.customer.phone),
    onlyDigits(input.customer.document),
    upper(input.delivery.street),
    input.delivery.number || null,
    upper(input.delivery.neighborhood),
    upper(input.delivery.city),
    upper(input.delivery.state),
    onlyDigits(input.delivery.zipCode),
    input.delivery.complement?.trim() || null,
  ];

  if (existingRows[0]) {
    const { rows } = await client.query(
      `UPDATE public.customers
       SET full_name = $3, name = $3, phone = $4, document = $5, street = $6,
           number = $7, neighborhood = $8, city = $9, state = $10, zip_code = $11,
           complement = $12, registration_completed = true
       WHERE id = $13
       RETURNING *`,
      [...values, existingRows[0].id],
    );
    return rows[0];
  }

  const { rows } = await client.query(
    `INSERT INTO public.customers (
       store_id, user_id, full_name, name, phone, document, street, number,
       neighborhood, city, state, zip_code, complement, registration_completed
     )
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
     RETURNING *`,
    values,
  );
  return rows[0];
};

const insertOrderItems = async (
  client: DbClient,
  order: any,
  calculatedItems: ReturnType<typeof calculateItems>["calculatedItems"],
) => {
  for (const item of calculatedItems) {
    const { rows } = await client.query(
      `INSERT INTO public.order_items (
         order_id, store_id, product_id, product_name, unit_price, quantity, notes, subtotal, options_total
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        order.id,
        order.store_id,
        item.product.id,
        item.product.name,
        item.unitPrice,
        item.input.quantity,
        item.input.notes?.trim() || null,
        item.subtotal,
        item.optionsTotal,
      ],
    );
    const orderItem = rows[0];
    for (const option of item.options) {
      await client.query(
        `INSERT INTO public.order_item_options (
           order_item_id, option_id, option_name, item_name, extra_price, name, option_item_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          orderItem.id,
          option.group.id,
          option.group.name,
          option.item.name,
          option.extraPrice,
          option.item.name,
          option.item.id,
        ],
      );
    }
  }
};

export const createCheckoutOrderForActor = async (
  rawInput: unknown,
  actor: Actor,
  deps: CheckoutDeps = defaultDeps,
) => {
  const input = checkoutInputSchema.parse(rawInput);

  const order = await deps.withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [`checkout:${input.idempotencyKey}`]);

    const { rows: stores } = await client.query(
      `SELECT * FROM public.stores
       WHERE id = $1 AND COALESCE(is_active, true) IS TRUE
       FOR SHARE`,
      [input.storeId],
    );
    const store = stores[0];
    if (!store || store.is_suspended) throw new Error("Loja indisponivel.");
    if (store.owner_user_id === actor.user.id) throw new Error("Dono da loja nao pode comprar de si mesmo.");

    const { rows: settingsRows } = await client.query(
      `SELECT * FROM public.store_settings WHERE store_id = $1 LIMIT 1 FOR SHARE`,
      [input.storeId],
    );
    const settings = settingsRows[0];
    if (!settings) throw new Error("Configuracoes da loja nao encontradas.");
    if (!isStoreOpen(settings.business_hours, settings.is_open) && !settings.accept_orders_when_closed) {
      throw new Error("Loja fechada.");
    }
    if (!isPaymentMethodAccepted(settings, input.paymentMethod)) {
      throw new Error(input.paymentMethod === "pix" ? "PIX nao habilitado para esta loja." : "Forma de pagamento indisponivel.");
    }
    if (input.delivery.type === "retirada" && !settings.allow_pickup) {
      throw new Error("Retirada indisponivel para esta loja.");
    }
    if (onlyDigits(input.customer.phone).length < 10) throw new Error("WhatsApp invalido.");

    const productIds = [...new Set(input.items.map((item) => item.productId))];
    const { products, groups, optionItems } = await loadProductsContext(client, input.storeId, productIds);
    const { calculatedItems, subtotal } = calculateItems(input, products, groups, optionItems);

    const delivery = input.delivery.type === "retirada"
      ? {
        fee: 0,
        regionId: null,
        estimatedMin: null,
        estimatedMax: null,
        source: "pickup",
        distanceKm: null,
        normalizedAddress: null,
      }
      : await deps.quoteDelivery({
        storeId: input.storeId,
        subtotal,
        address: {
          cep: input.delivery.zipCode,
          street: input.delivery.street,
          number: input.delivery.number,
          complement: input.delivery.complement,
          neighborhood: input.delivery.neighborhood,
          city: input.delivery.city,
          state: input.delivery.state,
        },
        customerCoordinates: input.delivery.customerCoordinates || null,
      }, {
        query: client.query.bind(client) as any,
      }).then((quote) => {
        if (!quote.available) throw new Error(quote.reason || "Regiao nao atendida.");
        return {
          fee: quote.fee,
          regionId: quote.regionId || null,
          estimatedMin: quote.estimatedMin || null,
          estimatedMax: quote.estimatedMax || null,
          source: quote.source,
          distanceKm: quote.distanceKm || null,
          normalizedAddress: quote.normalizedAddress || null,
        };
      });
    const coupon = await loadCoupon(client, input.storeId, input.couponCode);
    const discount = calculateDiscount(coupon, subtotal);
    const total = money(Math.max(0, subtotal + delivery.fee - discount));
    if (input.paymentMethod === "dinheiro" && input.changeFor && input.changeFor < total) {
      throw new Error("Troco precisa ser maior ou igual ao total do pedido.");
    }

    const customer = await createOrUpdateCustomer(client, input, actor);
    const { rows: existingOrders } = await client.query(
      `SELECT id, store_id, public_token, payment_method, order_number
       FROM public.orders
       WHERE idempotency_key = $1 AND store_id = $2 AND customer_id = $3
       LIMIT 1
       FOR UPDATE`,
      [input.idempotencyKey, input.storeId, customer.id],
    );
    if (existingOrders[0]) {
      if (!existingOrders[0].public_token) throw new Error("Pedido existente sem token publico.");
      return existingOrders[0];
    }

    const status = input.paymentMethod === "pix" ? "aguardando_pagamento" : "novo";
    const address = input.delivery.type === "entrega"
      ? `${upper(input.delivery.street)}, ${input.delivery.number}${input.delivery.complement ? ` (${upper(input.delivery.complement)})` : ""} - ${upper(input.delivery.neighborhood)}`
      : "RETIRADA";

    const orderNotes = buildOrderNotes(input);
    const deliveryReference = input.delivery.reference?.trim() || input.reference?.trim() || null;
    const { rows: orderRows } = await client.query(
      `INSERT INTO public.orders (
         store_id, customer_id, customer_name, customer_phone, customer_document, customer_email,
         delivery_type, status, payment_status, delivery_address, delivery_fee, subtotal,
         discount_amount, total, payment_method, change_for, notes, zip_code, neighborhood,
         city, state, street, number, complement, delivery_reference, delivery_region_id, estimated_min,
         estimated_max, delivery_source, distance_km, coupon_id, coupon_code, idempotency_key
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11, $12,
         $13, $14, $15, $16, $17, $18, $19,
         $20, $21, $22, $23, $24, $25, $26, $27,
         $28, $29, $30, $31, $32, $33
       )
       RETURNING id, store_id, public_token, payment_method, order_number`,
      [
        input.storeId,
        customer.id,
        upper(input.customer.name),
        onlyDigits(input.customer.phone),
        onlyDigits(input.customer.document),
        input.customer.email || actor.user.email || null,
        input.delivery.type,
        status,
        "pendente",
        address,
        delivery.fee,
        subtotal,
        discount,
        total,
        input.paymentMethod,
        input.paymentMethod === "dinheiro" ? input.changeFor || null : null,
        orderNotes,
        delivery.normalizedAddress?.cep || onlyDigits(input.delivery.zipCode),
        delivery.normalizedAddress?.neighborhood || upper(input.delivery.neighborhood),
        delivery.normalizedAddress?.city || upper(input.delivery.city),
        delivery.normalizedAddress?.state || upper(input.delivery.state),
        delivery.normalizedAddress?.street || upper(input.delivery.street),
        input.delivery.number || null,
        input.delivery.complement?.trim() || null,
        deliveryReference,
        delivery.regionId,
        delivery.estimatedMin,
        delivery.estimatedMax,
        delivery.source,
        delivery.distanceKm,
        coupon?.id || null,
        coupon?.code || null,
        input.idempotencyKey,
      ],
    );
    const newOrder = orderRows[0];
    if (!newOrder?.public_token) throw new Error("Erro ao gerar token publico do pedido.");

    await insertOrderItems(client, newOrder, calculatedItems);
    await client.query(
      `INSERT INTO public.order_status_history (order_id, store_id, status, notes)
       VALUES ($1, $2, $3, $4)`,
      [newOrder.id, input.storeId, status, "Pedido criado pelo checkout"],
    );

    if (coupon) {
      await client.query(`UPDATE public.coupons SET usage_count = COALESCE(usage_count, 0) + 1 WHERE id = $1`, [coupon.id]);
    }

    return newOrder;
  });

  let payment = null;
  if (order.payment_method === "pix") {
    try {
      payment = await deps.createPayment({
        orderId: order.id,
        storeId: order.store_id,
        attemptKey: `checkout:${order.id}:${checkoutInputSchema.parse(rawInput).idempotencyKey}`,
      });
    } catch (error: any) {
      payment = {
        error: error?.message || "Pedido criado, mas nao foi possivel gerar o PIX agora.",
        status: "falhou",
      };
    }
  }

  await deps.notifyOrderCreated(order.id).catch((error) => {
    console.warn("Evolution notification skipped:", error);
  });

  return {
    orderId: order.id,
    publicToken: order.public_token,
    orderNumber: order.order_number,
    payment,
  };
};

export const createCheckoutOrderHandler = async (
  body: unknown,
  token?: string,
  deps: CheckoutDeps = defaultDeps,
): Promise<BackendResult> => {
  try {
    const actor = await deps.getActor(token);
    if (!actor) throw new Error("Nao autenticado.");
    const result = await createCheckoutOrderForActor(body, actor, deps);
    return { data: result, error: null };
  } catch (error: any) {
    return {
      data: null,
      error: { message: error?.issues?.[0]?.message || error?.message || "Erro ao criar pedido." },
    };
  }
};
