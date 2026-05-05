import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Global Asaas Webhook Handler
 * Used for platform subscriptions
 */
export const Route = createFileRoute("/api/public/webhooks/asaas")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json();
        const webhookToken = request.headers.get("asaas-access-token");

        // Verify webhook token
        if (webhookToken !== process.env.ASAAS_WEBHOOK_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { event, payment } = body;

        // Handle subscription payment events
        if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
          const subscriptionId = payment.subscription;
          
          if (subscriptionId) {
            // Update subscription in database
            const { error } = await supabaseAdmin
              .from("subscriptions")
              .update({ 
                status: "ativa",
                current_period_end: new Date(payment.dueDate).toISOString()
              })
              .eq("external_subscription_id", subscriptionId);

            if (error) {
              console.error("Error updating subscription:", error);
              return new Response("Error updating subscription", { status: 500 });
            }
          }
        }

        return new Response("OK", { status: 200 });
      },
    },
  },
});
