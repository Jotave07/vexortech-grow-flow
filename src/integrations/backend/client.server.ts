import type { BackendResult, QueryPayload } from "./compat-types";
import { LocalQueryBuilder } from "./query-builder";
import { executeQueryPayload } from "@/backend/query";
import { executeRpc } from "@/backend/rpc";

const executeServerQuery = async (payload: QueryPayload): Promise<BackendResult<any>> => {
  return executeQueryPayload(payload, { admin: true });
};

const rpc = async (name: string, args?: Record<string, unknown>) => {
  return executeRpc(name, args || {}, { admin: true });
};

export const backendAdmin = {
  from(table: string) {
    return new LocalQueryBuilder(table, executeServerQuery);
  },
  rpc,
};
