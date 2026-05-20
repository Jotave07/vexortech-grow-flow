import type { BackendResult } from "@/integrations/backend/compat-types";
import { getActor, signUp } from "./auth";
import { query, withTransaction } from "./db";
import { publishRealtime } from "./realtime";

const errorResult = (message: string): BackendResult => ({ data: null, error: { message } });

const requireAdmin = async (token?: string) => {
  const actor = await getActor(token);
  if (!actor) throw new Error("Nao autenticado.");
  if (!actor.admin) throw new Error("Acesso negado.");
  return actor;
};

export const invokeFunction = async (name: string, body: any, token?: string) => {
  try {
    if (name === "admin-create-store") return adminCreateStore(body, token);
    if (name === "admin-delete-store") return adminDeleteStore(body, token);
    return errorResult(`Function nao implementada: ${name}`);
  } catch (error: any) {
    return errorResult(error?.message || "Erro ao executar function.");
  }
};

const adminCreateStore = async (body: any, token?: string) => {
  await requireAdmin(token);

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const fullName = String(body.full_name || "").trim().toUpperCase();
  const name = String(body.name || "").trim().toUpperCase();
  const slug = String(body.slug || "").trim().toLowerCase();
  if (!email || !password || !name || !slug) return errorResult("E-mail, senha, nome e slug sao obrigatorios.");

  const created = await signUp(email, password, {
    full_name: fullName,
    document: String(body.document || "").replace(/\D/g, ""),
    account_type: "store_owner",
    role: "store_owner",
  });
  if (created.error || !created.data?.user) return created;

  const user = created.data.user;
  const phone = String(body.whatsapp || "").replace(/\D/g, "");

  const { rows } = await query(
    `INSERT INTO public.stores (owner_user_id, slug, name, whatsapp, phone, document, city, state, email)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      user.id,
      slug,
      name,
      phone || null,
      String(body.document || "").replace(/\D/g, "") || null,
      body.city ? String(body.city).toUpperCase() : null,
      body.state ? String(body.state).toUpperCase() : null,
      email,
    ],
  );
  const store = rows[0];

  await Promise.all([
    query(`INSERT INTO public.store_settings (store_id) VALUES ($1) ON CONFLICT DO NOTHING`, [store.id]).catch(() => null),
    query(`UPDATE public.profiles SET store_id = $1, role = 'store_owner' WHERE user_id = $2`, [store.id, user.id]).catch(() => null),
    query(`INSERT INTO public.user_roles (user_id, role, store_id) VALUES ($1, 'store_owner', $2) ON CONFLICT DO NOTHING`, [user.id, store.id]).catch(() => null),
  ]);

  publishRealtime({ schema: "public", table: "stores", eventType: "INSERT", new: store, old: null });
  return { data: { success: true, store_id: store.id, user_id: user.id }, error: null };
};

const adminDeleteStore = async (body: any, token?: string) => {
  const actor = await requireAdmin(token);

  if (body?.action === "cleanup_orphans") {
    const { rows: profileRows } = await query(`SELECT user_id FROM public.profiles WHERE user_id IS NOT NULL`);
    const profileIds = new Set(profileRows.map((row) => row.user_id));
    const { rows: users } = await query(`SELECT id, email FROM auth.users WHERE deleted_at IS NULL`);
    let deleted = 0;
    for (const user of users) {
      if (user.id === actor.user.id || user.email === "jvieira@vexortech.com.br") continue;
      if (!profileIds.has(user.id)) {
        await query(`UPDATE auth.users SET deleted_at = now(), updated_at = now() WHERE id = $1`, [user.id]);
        deleted += 1;
      }
    }
    return { data: { success: true, deleted_count: deleted }, error: null };
  }

  const storeId = String(body?.store_id || "");
  if (!storeId) return errorResult("Store ID is required.");

  await withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT owner_user_id FROM public.stores WHERE id = $1`, [storeId]);
    const ownerUserId = rows[0]?.owner_user_id;
    if (!rows[0]) throw new Error("Loja nao encontrada.");

    const simpleTables = [
      "order_item_options",
      "order_items",
      "order_status_history",
      "payments",
      "orders",
      "customers",
      "coupons",
      "delivery_zones",
      "product_option_items",
      "product_options",
      "products",
      "categories",
      "store_settings",
      "subscriptions",
      "user_roles",
    ];

    await client.query(
      `DELETE FROM public.order_item_options WHERE order_item_id IN (
        SELECT id FROM public.order_items WHERE store_id = $1
      )`,
      [storeId],
    );
    await client.query(
      `DELETE FROM public.product_option_items WHERE option_id IN (
        SELECT po.id FROM public.product_options po
        JOIN public.products p ON p.id = po.product_id
        WHERE p.store_id = $1
      )`,
      [storeId],
    );
    await client.query(
      `DELETE FROM public.product_options WHERE product_id IN (
        SELECT id FROM public.products WHERE store_id = $1
      )`,
      [storeId],
    );

    for (const table of simpleTables.filter((table) => !["order_item_options", "product_option_items", "product_options"].includes(table))) {
      await client.query(`DELETE FROM public."${table}" WHERE store_id = $1`, [storeId]).catch(() => null);
    }

    await client.query(`DELETE FROM public.stores WHERE id = $1`, [storeId]);
    if (ownerUserId) {
      await client.query(`DELETE FROM public.profiles WHERE user_id = $1`, [ownerUserId]).catch(() => null);
      await client.query(`UPDATE auth.users SET deleted_at = now(), updated_at = now() WHERE id = $1`, [ownerUserId]).catch(() => null);
    }
  });

  publishRealtime({ schema: "public", table: "stores", eventType: "DELETE", new: null, old: { id: storeId } });
  return { data: { success: true }, error: null };
};
