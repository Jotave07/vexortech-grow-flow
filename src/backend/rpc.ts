import type { BackendResult } from "@/integrations/supabase/compat-types";
import { query } from "./db";
import { getActor } from "./auth";

type RpcContext = {
  admin?: boolean;
  token?: string;
};

const errorResult = (message: string): BackendResult => ({ data: null, error: { message } });

export const executeRpc = async (name: string, args: Record<string, unknown> = {}, ctx: RpcContext = {}) => {
  try {
    if (name === "is_vexor_admin") {
      const userId = args._user_id || args.user_id;
      const { rows } = await query(`SELECT public.is_vexor_admin($1::uuid) AS value`, [userId]);
      return { data: Boolean(rows[0]?.value), error: null };
    }

    if (name === "get_public_order") {
      const { rows } = await query(`SELECT * FROM public.get_public_order($1::text)`, [args._token]);
      return { data: rows, error: null };
    }

    if (name === "get_public_order_items") {
      const { rows } = await query(`SELECT * FROM public.get_public_order_items($1::text)`, [args._token]);
      return { data: rows, error: null };
    }

    if (name === "get_public_order_status_history") {
      const { rows } = await query(`SELECT * FROM public.get_public_order_status_history($1::text)`, [args._token]);
      return { data: rows, error: null };
    }

    if (name === "get_store_rating") {
      const { rows } = await query(`SELECT * FROM public.get_store_rating($1::uuid)`, [args.p_store_id || args.store_id]);
      return { data: rows, error: null };
    }

    const actor = ctx.admin ? { admin: true } : await getActor(ctx.token);
    if (!actor?.admin) return errorResult("RPC nao autorizado.");
    return errorResult(`RPC nao implementado: ${name}`);
  } catch (error: any) {
    return { data: null, error: { message: error?.message || "Erro ao executar RPC", code: error?.code } };
  }
};
