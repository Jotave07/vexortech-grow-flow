import type { BackendResult, LocalSession } from "@/integrations/backend/compat-types";
import { assertActiveMerchantSubscription, getActor, signUp } from "./auth";
import { query, withTransaction } from "./db";
import { publishRealtime } from "./realtime";
import { createCheckoutOrderHandler } from "@/server/order.functions";
import { quoteDeliveryHandler } from "@/server/delivery.service";
import { updateOrderStatusHandler } from "@/server/order-status.service";
import { approveManualPixPayment, getOrderPaymentInfoForOrder } from "@/server/asaas.service";
import {
  adminSetStoreExemptionHandler,
  adminSetStoreSuspensionHandler,
  cancelSubscriptionHandler,
  createSubscriptionCheckoutHandler,
  syncSubscriptionStatusHandler,
  updateSubscriptionPlanHandler,
} from "@/server/subscription.service";
import {
  markOrderDelivered,
  cancelOrderByMerchant,
  adminRetryTransfer,
  adminRetryRefund,
  adminBlockTransfer,
  adminManualAdjustment,
  getOrderFinancial,
  getMerchantStatement,
  listFinancialOrders,
  merchantUpdatePixConfig,
  adminUpdateStoreFinancials,
} from "@/server/order.lifecycle";
import { isValidDocument, normalizeDocument } from "@/lib/validators";
import { deleteSupabaseAuthUser } from "./supabase";
import {
  fetchAddressByCep,
  isValidCoordinates,
  reverseGeocodeCoordinates,
} from "@/services/viacep";

const errorResult = (message: string): BackendResult => ({ data: null, error: { message } });
const ok = (data: unknown): BackendResult => ({ data, error: null });

const requireAdmin = async (token?: string) => {
  const actor = await getActor(token);
  if (!actor) throw new Error("Nao autenticado.");
  if (!actor.admin) throw new Error("Acesso negado.");
  return actor;
};

type FunctionContext = {
  remoteIp?: string | null;
};

export const invokeFunction = async (
  name: string,
  body: any,
  token?: string,
  context: FunctionContext = {},
) => {
  try {
    if (
      name.startsWith("merchant-") ||
      name === "update-order-status" ||
      name === "approve-manual-pix"
    ) {
      await assertActiveMerchantSubscription(await getActor(token), body?.storeId);
    }
    if (name === "admin-create-store") return adminCreateStore(body, token);
    if (name === "admin-delete-store") return adminDeleteStore(body, token);
    if (name === "admin-set-store-suspension") {
      return ok(await adminSetStoreSuspensionHandler(body, token));
    }
    if (name === "admin-set-store-exemption") {
      return ok(await adminSetStoreExemptionHandler(body, token));
    }
    if (name === "create-own-store") return ok(await createOwnStore(body, token));
    if (name === "merchant-update-settings") return ok(await merchantUpdateSettings(body, token));
    if (name === "create-checkout-order") return createCheckoutOrderHandler(body, token);
    if (name === "quote-delivery") return ok(await quoteDeliveryHandler(body));
    if (name === "reverse-geocode") {
      const coordinates = { lat: Number(body?.lat), lng: Number(body?.lng) };
      if (!isValidCoordinates(coordinates)) return errorResult("Coordenadas invalidas.");
      return ok(await reverseGeocodeCoordinates(coordinates));
    }
    if (name === "lookup-cep") return ok(await fetchAddressByCep(String(body?.cep || "")));
    if (name === "get-order-payment-info") {
      const publicToken = String(body?.publicToken || "").trim();
      if (publicToken.length < 8 || publicToken.length > 200) {
        return errorResult("Token publico do pedido invalido.");
      }
      return ok(
        await getOrderPaymentInfoForOrder({
          orderId: String(body?.orderId || ""),
          storeId: String(body?.storeId || ""),
          publicToken,
        }),
      );
    }
    if (name === "update-order-status") {
      if (["entregue", "cancelado"].includes(String(body?.status || ""))) {
        return errorResult("Estados finais devem usar o fluxo financeiro dedicado do pedido.");
      }
      return ok(await updateOrderStatusHandler(body, token));
    }
    if (name === "approve-manual-pix") return ok(await approveManualPixPayment(body, token));
    if (name === "create-subscription-checkout") {
      return ok(await createSubscriptionCheckoutHandler(body, token, undefined, context));
    }
    if (name === "update-subscription-plan") {
      return ok(await updateSubscriptionPlanHandler(body, token, undefined, context));
    }
    if (name === "sync-subscription-status")
      return ok(await syncSubscriptionStatusHandler(body, token));
    if (name === "cancel-subscription") return ok(await cancelSubscriptionHandler(body, token));

    // ── Fluxo financeiro central (escrow / repasse / reembolso) ──
    if (name === "merchant-mark-delivered")
      return ok(await markOrderDelivered(body, await getActor(token)));
    if (name === "merchant-cancel-order")
      return ok(await cancelOrderByMerchant(body, await getActor(token)));
    if (name === "merchant-order-financial")
      return ok(await getOrderFinancial(body, await getActor(token)));
    if (name === "merchant-statement")
      return ok(await getMerchantStatement(body, await getActor(token)));
    if (name === "merchant-update-pix-config")
      return ok(await merchantUpdatePixConfig(body, await getActor(token)));
    if (name === "admin-retry-transfer")
      return ok(await adminRetryTransfer(body, await getActor(token)));
    if (name === "admin-retry-refund")
      return ok(await adminRetryRefund(body, await getActor(token)));
    if (name === "admin-block-transfer")
      return ok(await adminBlockTransfer(body, await getActor(token)));
    if (name === "admin-manual-adjustment")
      return ok(await adminManualAdjustment(body, await getActor(token)));
    if (name === "admin-financial-orders")
      return ok(await listFinancialOrders(body, await getActor(token)));
    if (name === "admin-update-store-financials")
      return ok(await adminUpdateStoreFinancials(body, await getActor(token)));

    return errorResult(`Function nao implementada: ${name}`);
  } catch (error: any) {
    return errorResult(error?.message || "Erro ao executar function.");
  }
};

const createOwnStore = async (body: any, token?: string) => {
  const actor = await getActor(token);
  if (!actor) throw new Error("Nao autenticado.");
  if (!actor.admin && !actor.roles.has("store_owner") && actor.profile?.role !== "store_owner") {
    throw new Error("Esta conta nao esta habilitada para criar uma loja.");
  }
  const name = String(body.name || "")
    .trim()
    .toUpperCase();
  const slug = String(body.slug || "")
    .trim()
    .toLowerCase();
  const document = normalizeDocument(String(body.document || actor.profile?.document || ""));
  const phone = String(body.whatsapp || body.phone || "").replace(/\D/g, "");
  if (name.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error("Nome ou endereco publico da loja invalido.");
  if (!isValidDocument(document)) throw new Error("CPF ou CNPJ invalido.");
  if (phone.length < 10) throw new Error("WhatsApp invalido.");

  const store = await withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
      `create-store:${actor.user.id}`,
    ]);
    const { rows: owned } = await client.query(
      `SELECT id FROM public.stores WHERE owner_user_id = $1 LIMIT 1 FOR UPDATE`,
      [actor.user.id],
    );
    if (owned[0]) throw new Error("Esta conta ja possui uma loja.");
    const { rows: slugRows } = await client.query(
      `SELECT id FROM public.stores WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    if (slugRows[0]) throw new Error("Este endereco de loja ja esta em uso.");
    const { rows } = await client.query(
      `INSERT INTO public.stores (
         owner_user_id, slug, name, description, whatsapp, phone, document, city, state, email
       ) VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        actor.user.id,
        slug,
        name,
        body.description ? String(body.description).trim().slice(0, 500).toUpperCase() : null,
        phone,
        document,
        body.city ? String(body.city).trim().toUpperCase() : null,
        body.state ? String(body.state).trim().toUpperCase().slice(0, 2) : null,
        actor.user.email || null,
      ],
    );
    await client.query(
      `INSERT INTO public.store_settings (store_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [rows[0].id],
    );
    await client.query(
      `UPDATE public.profiles SET store_id = $1, role = 'store_owner', updated_at = now() WHERE user_id = $2`,
      [rows[0].id, actor.user.id],
    );
    await client.query(
      `INSERT INTO public.user_roles (user_id, role, store_id)
       VALUES ($1, 'store_owner', $2)
       ON CONFLICT DO NOTHING`,
      [actor.user.id, rows[0].id],
    );
    return rows[0];
  });
  publishRealtime({
    schema: "public",
    table: "stores",
    eventType: "INSERT",
    new: store,
    old: null,
  });
  return { storeId: store.id, store };
};

const merchantUpdateSettings = async (body: any, token?: string) => {
  const actor = await getActor(token);
  await assertActiveMerchantSubscription(actor, body?.storeId);
  if (!actor) throw new Error("Nao autenticado.");
  const storeId = String(body?.storeId || "");
  if (!actor.admin && !actor.ownedStoreIds.includes(storeId))
    throw new Error("Loja fora do escopo do usuario.");
  const storeInput = body?.store && typeof body.store === "object" ? body.store : {};
  const settingsInput = body?.settings && typeof body.settings === "object" ? body.settings : {};
  const text = (value: unknown, maximum: number) => {
    const normalized = String(value ?? "").trim();
    return normalized ? normalized.slice(0, maximum) : null;
  };
  const assetUrl = (value: unknown) => {
    const normalized = text(value, 2_000);
    if (!normalized) return null;
    if (normalized.startsWith("/storage/")) return normalized;
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:")
      throw new Error("Imagens devem usar HTTPS ou o storage da plataforma.");
    return parsed.toString();
  };
  const color = (value: unknown, fallback: string) => {
    const normalized = String(value || fallback).trim();
    if (!/^#[0-9a-f]{6}$/i.test(normalized)) throw new Error("Cor da identidade visual invalida.");
    return normalized.toLowerCase();
  };
  const whatsapp = String(storeInput.whatsapp || "").replace(/\D/g, "");
  const cep = String(storeInput.zip_code || "").replace(/\D/g, "");
  const state = String(storeInput.state || "")
    .trim()
    .toUpperCase();
  if (String(storeInput.public_name || "").trim().length < 2)
    throw new Error("Informe o nome publico da loja.");
  if (whatsapp.length < 10 || whatsapp.length > 13) throw new Error("WhatsApp invalido.");
  if (cep.length !== 8) throw new Error("CEP invalido.");
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("UF invalida.");
  if (!settingsInput.allow_delivery && !settingsInput.allow_pickup)
    throw new Error("Ative entrega ou retirada.");
  if (
    !settingsInput.accept_pix &&
    !settingsInput.accept_cash &&
    !settingsInput.accept_card_on_delivery
  ) {
    throw new Error("Ative ao menos uma forma de pagamento.");
  }
  const pixKeyType = text(settingsInput.pix_key_type, 30)?.toUpperCase() || null;
  if (
    pixKeyType &&
    !new Set(["CPF", "CNPJ", "EMAIL", "PHONE", "EVP", "RANDOM", "KEY", "COPY_PASTE"]).has(
      pixKeyType,
    )
  ) {
    throw new Error("Tipo de chave Pix invalido.");
  }
  const businessHours =
    settingsInput.business_hours && typeof settingsInput.business_hours === "object"
      ? settingsInput.business_hours
      : {};
  if (JSON.stringify(businessHours).length > 20_000)
    throw new Error("Horarios de funcionamento invalidos.");
  const result = await withTransaction(async (client) => {
    const { rows: locked } = await client.query(
      `SELECT s.id, ss.financeiro_ativo, ss.payment_gateway_api_key, ss.asaas_api_key
       FROM public.stores s
       LEFT JOIN public.store_settings ss ON ss.store_id = s.id
       WHERE s.id = $1
       FOR UPDATE OF s`,
      [storeId],
    );
    if (!locked[0]) throw new Error("Loja nao encontrada.");
    if (
      settingsInput.accept_pix &&
      !text(settingsInput.pix_key, 500) &&
      !locked[0].financeiro_ativo &&
      !locked[0].payment_gateway_api_key &&
      !locked[0].asaas_api_key
    ) {
      throw new Error("Configure uma chave Pix ou gateway antes de aceitar Pix.");
    }
    const { rows: stores } = await client.query(
      `UPDATE public.stores SET
         public_name = $2, whatsapp = $3, whatsapp_number = $3,
         logo_url = $4, cover_url = $5, description = $6,
         zip_code = $7, address = $8, address_number = $9,
         address_complement = $10, neighborhood = $11, city = $12, state = $13,
         primary_color = $14, secondary_color = $15, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        storeId,
        text(storeInput.public_name, 160),
        whatsapp,
        assetUrl(storeInput.logo_url),
        assetUrl(storeInput.cover_url),
        text(storeInput.description, 1_500),
        cep,
        text(storeInput.address, 200),
        text(storeInput.address_number, 30),
        text(storeInput.address_complement, 120),
        text(storeInput.neighborhood, 120),
        text(storeInput.city, 120),
        state,
        color(storeInput.primary_color, "#b2d83f"),
        color(storeInput.secondary_color, "#303938"),
      ],
    );
    await client.query(
      `INSERT INTO public.store_settings (
         store_id, avg_prep_time_minutes, min_order_value, is_open,
         allow_delivery, allow_pickup, accept_orders_when_closed,
         accept_pix, pix_key, pix_key_type, payment_instructions,
         accept_cash, accept_card_on_delivery, whatsapp_number,
         delivery_radius_km, business_hours, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,now())
       ON CONFLICT (store_id) DO UPDATE SET
         avg_prep_time_minutes=EXCLUDED.avg_prep_time_minutes,
         min_order_value=EXCLUDED.min_order_value, is_open=EXCLUDED.is_open,
         allow_delivery=EXCLUDED.allow_delivery, allow_pickup=EXCLUDED.allow_pickup,
         accept_orders_when_closed=EXCLUDED.accept_orders_when_closed,
         accept_pix=EXCLUDED.accept_pix, pix_key=EXCLUDED.pix_key,
         pix_key_type=EXCLUDED.pix_key_type, payment_instructions=EXCLUDED.payment_instructions,
         accept_cash=EXCLUDED.accept_cash,
         accept_card_on_delivery=EXCLUDED.accept_card_on_delivery,
         whatsapp_number=EXCLUDED.whatsapp_number,
         delivery_radius_km=EXCLUDED.delivery_radius_km,
         business_hours=EXCLUDED.business_hours, updated_at=now()`,
      [
        storeId,
        Math.min(240, Math.max(1, Number(settingsInput.avg_prep_time_minutes || 30))),
        Math.max(0, Number(settingsInput.min_order_value || 0)),
        Boolean(settingsInput.is_open),
        Boolean(settingsInput.allow_delivery),
        Boolean(settingsInput.allow_pickup),
        Boolean(settingsInput.accept_orders_when_closed),
        Boolean(settingsInput.accept_pix),
        text(settingsInput.pix_key, 500),
        pixKeyType,
        text(settingsInput.payment_instructions, 1_000),
        Boolean(settingsInput.accept_cash),
        Boolean(settingsInput.accept_card_on_delivery),
        whatsapp,
        settingsInput.delivery_radius_km
          ? Math.min(500, Math.max(0.1, Number(settingsInput.delivery_radius_km)))
          : null,
        JSON.stringify(businessHours),
      ],
    );
    return stores[0];
  });
  publishRealtime({
    schema: "public",
    table: "stores",
    eventType: "UPDATE",
    new: result,
    old: null,
  });
  return { success: true };
};

const adminCreateStore = async (body: any, token?: string) => {
  await requireAdmin(token);

  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const password = String(body.password || "");
  const fullName = String(body.full_name || "")
    .trim()
    .toUpperCase();
  const name = String(body.name || "")
    .trim()
    .toUpperCase();
  const slug = String(body.slug || "")
    .trim()
    .toLowerCase();
  const document = normalizeDocument(String(body.document || ""));
  if (!email || !password || !name || !slug)
    return errorResult("E-mail, senha, nome e slug sao obrigatorios.");
  if (document && !isValidDocument(document)) return errorResult("CPF ou CNPJ invalido.");

  const created = (await signUp(email, password, {
    full_name: fullName,
    document,
    account_type: "store_owner",
    role: "store_owner",
  })) as BackendResult<LocalSession>;
  if (created.error || !created.data?.user) return created;

  const user = created.data.user;
  const phone = String(body.whatsapp || "").replace(/\D/g, "");

  let store: any;
  try {
    store = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO public.stores (owner_user_id, slug, name, whatsapp, phone, document, city, state, email)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          user.id,
          slug,
          name,
          phone || null,
          document || null,
          body.city ? String(body.city).toUpperCase() : null,
          body.state ? String(body.state).toUpperCase() : null,
          email,
        ],
      );
      const createdStore = rows[0];
      await client.query(
        `INSERT INTO public.store_settings (store_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [createdStore.id],
      );
      await client.query(
        `UPDATE public.profiles SET store_id = $1, role = 'store_owner' WHERE user_id = $2`,
        [createdStore.id, user.id],
      );
      await client.query(
        `INSERT INTO public.user_roles (user_id, role, store_id)
         VALUES ($1, 'store_owner', $2)
         ON CONFLICT DO NOTHING`,
        [user.id, createdStore.id],
      );
      return createdStore;
    });
  } catch (error) {
    await deleteSupabaseAuthUser(user.id).catch(() => null);
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM public.user_roles WHERE user_id = $1`, [user.id]);
      await client.query(`DELETE FROM public.profiles WHERE user_id = $1`, [user.id]);
    }).catch(() => null);
    throw error;
  }

  publishRealtime({
    schema: "public",
    table: "stores",
    eventType: "INSERT",
    new: store,
    old: null,
  });
  return { data: { success: true, store_id: store.id, user_id: user.id }, error: null };
};

const adminDeleteStore = async (body: any, token?: string) => {
  const actor = await requireAdmin(token);

  if (body?.action === "cleanup_orphans") {
    return errorResult(
      "Limpeza automatica de usuarios foi desativada. Revise os candidatos e use o painel Supabase Auth com trilha de auditoria.",
    );
  }

  const storeId = String(body?.store_id || "");
  if (!storeId) return errorResult("Store ID is required.");

  const { rows: preflightOrders } = await query(
    `SELECT count(*)::int AS total
     FROM public.orders
     WHERE store_id = $1
       AND status NOT IN ('entregue', 'cancelado', 'cancelled', 'finalizado')`,
    [storeId],
  );
  if (Number(preflightOrders[0]?.total || 0) > 0) {
    throw new Error("A loja possui pedidos em andamento e nao pode ser arquivada.");
  }

  await adminSetStoreSuspensionHandler({ storeId, suspended: true }, token);

  const archivedStore = await withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT * FROM public.stores WHERE id = $1 FOR UPDATE`, [
      storeId,
    ]);
    if (!rows[0]) throw new Error("Loja nao encontrada.");
    const { rows: activeOrders } = await client.query(
      `SELECT count(*)::int AS total
       FROM public.orders
       WHERE store_id = $1
         AND status NOT IN ('entregue', 'cancelado', 'cancelled', 'finalizado')`,
      [storeId],
    );
    if (Number(activeOrders[0]?.total || 0) > 0) {
      throw new Error("A loja possui pedidos em andamento e nao pode ser arquivada.");
    }
    const { rows: archived } = await client.query(
      `UPDATE public.stores
       SET is_active = false,
           is_suspended = true,
           archived_at = COALESCE(archived_at, now()),
           archived_by = $2::uuid,
           archive_reason = $3,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        storeId,
        actor.user.id,
        String(body?.reason || "Arquivada pelo administrador").slice(0, 500),
      ],
    );
    return archived[0];
  });

  publishRealtime({
    schema: "public",
    table: "stores",
    eventType: "UPDATE",
    new: archivedStore,
    old: null,
  });
  return { data: { success: true, archived: true, store_id: storeId }, error: null };
};
