import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/start-server-core";
import { z } from "zod";
import { getActor } from "@/backend/auth";
import { query } from "@/backend/db";

const bearerToken = () => getRequestHeader("authorization")?.replace(/^Bearer\s+/i, "");

const requireStoreAccess = async (storeId: string) => {
  const actor = await getActor(bearerToken());
  if (!actor) throw new Error("Autenticacao obrigatoria.");
  if (!actor.admin && !actor.ownedStoreIds.includes(storeId)) {
    throw new Error("Sem permissao para enviar notificacao desta loja.");
  }
};

const requireOrderAccess = async (orderId: string) => {
  const { rows } = await query("SELECT store_id FROM public.orders WHERE id = $1::uuid LIMIT 1", [orderId]);
  const storeId = rows[0]?.store_id;
  if (!storeId) throw new Error("Pedido nao encontrado.");
  await requireStoreAccess(storeId);
};

export const notifyOrderCreated = createServerFn({ method: "POST" })
  .inputValidator(z.object({ orderId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireOrderAccess(data.orderId);
    const { notifyOrderCreatedHandler } = await import("./evolution.server");
    return notifyOrderCreatedHandler(data.orderId);
  });

export const notifyStoreCreated = createServerFn({ method: "POST" })
  .inputValidator(z.object({ storeId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireStoreAccess(data.storeId);
    const { notifyStoreCreatedHandler } = await import("./evolution.server");
    return notifyStoreCreatedHandler(data.storeId);
  });

export const notifyOrderStatusChanged = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    orderId: z.string().uuid(),
    status: z.string(),
    note: z.string().optional(),
  }))
  .handler(async ({ data }) => {
    await requireOrderAccess(data.orderId);
    const { sendOrderStatusNotification } = await import("./evolution.server");
    return sendOrderStatusNotification(data.orderId, data.status, data.note);
  });
