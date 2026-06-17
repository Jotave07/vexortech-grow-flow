export type BackendError = {
  message: string;
  code?: string;
  details?: string;
};

export type LocalUser = {
  id: string;
  email?: string;
  role?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type LocalSession = {
  access_token: string;
  refresh_token?: string;
  token_type: "bearer";
  expires_at: number;
  expires_in: number;
  user: LocalUser;
};

export type AuthChangeEvent =
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | "PASSWORD_RECOVERY";

export type AuthStateCallback = (event: AuthChangeEvent, session: LocalSession | null) => void;

export type OAuthProvider = "google" | "apple";

export type QueryFilter =
  | { op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; column: string; value: unknown }
  | { op: "in"; column: string; values: unknown[] }
  | { op: "is"; column: string; value: unknown };

export type QueryOrder = {
  column: string;
  ascending?: boolean;
  nullsFirst?: boolean;
  referencedTable?: string;
};

export type QueryPayload = {
  table: string;
  operation: "select" | "insert" | "update" | "delete" | "upsert";
  select?: string;
  selectOptions?: { count?: "exact" | null; head?: boolean };
  values?: unknown;
  filters: QueryFilter[];
  orders: QueryOrder[];
  limit?: number;
  single?: "single" | "maybeSingle";
  returning?: boolean;
  upsertOptions?: { onConflict?: string };
};

export type BackendResult<T = unknown> = {
  data: T | null;
  error: BackendError | null;
  count?: number | null;
};
