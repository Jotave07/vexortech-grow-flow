import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const notifyOrderCreated = createServerFn({ method: "POST" })
  .inputValidator(z.object({ orderId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { notifyOrderCreatedHandler } = await import("./evolution.server");
    return notifyOrderCreatedHandler(data.orderId);
  });

export const notifyStoreCreated = createServerFn({ method: "POST" })
  .inputValidator(z.object({ storeId: z.string().uuid() }))
  .handler(async ({ data }) => {
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
    const { sendOrderStatusNotification } = await import("./evolution.server");
    return sendOrderStatusNotification(data.orderId, data.status, data.note);
  });
