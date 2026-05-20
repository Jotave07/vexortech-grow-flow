import type { BackendResult, QueryPayload } from "./compat-types";
import { LocalQueryBuilder } from "./query-builder";

const executeServerQuery = async (payload: QueryPayload): Promise<BackendResult<any>> => {
  const { executeQueryPayload } = await import("@/backend/query");
  return executeQueryPayload(payload, { admin: true });
};

const rpc = async (name: string, args?: Record<string, unknown>) => {
  const { executeRpc } = await import("@/backend/rpc");
  return executeRpc(name, args || {}, { admin: true });
};

export const supabaseAdmin = {
  from(table: string) {
    return new LocalQueryBuilder(table, executeServerQuery);
  },
  rpc,
};
