import type { BackendResult, QueryFilter, QueryOrder, QueryPayload } from "./compat-types";

type ExecuteQuery = (payload: QueryPayload) => Promise<BackendResult<any>>;

export class LocalQueryBuilder<T = any> implements PromiseLike<BackendResult<T>> {
  private operation: QueryPayload["operation"] = "select";
  private selected = "*";
  private selectOptions: QueryPayload["selectOptions"];
  private values: unknown;
  private filters: QueryFilter[] = [];
  private orders: QueryOrder[] = [];
  private rowLimit: number | undefined;
  private singleMode: QueryPayload["single"];
  private returning = false;
  private upsertOptions: QueryPayload["upsertOptions"];

  constructor(
    private readonly table: string,
    private readonly executeQuery: ExecuteQuery,
  ) {}

  select(columns = "*", options?: QueryPayload["selectOptions"]) {
    this.operation = this.operation === "select" ? "select" : this.operation;
    this.selected = columns || "*";
    this.selectOptions = options;
    this.returning = true;
    return this;
  }

  insert(values: unknown) {
    this.operation = "insert";
    this.values = values;
    return this;
  }

  update(values: unknown) {
    this.operation = "update";
    this.values = values;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  upsert(values: unknown, options?: QueryPayload["upsertOptions"]) {
    this.operation = "upsert";
    this.values = values;
    this.upsertOptions = options;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ op: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ op: "neq", column, value });
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.push({ op: "gt", column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ op: "gte", column, value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push({ op: "lt", column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ op: "lte", column, value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ op: "in", column, values });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ op: "is", column, value });
    return this;
  }

  ilike(column: string, pattern: string) {
    this.filters.push({ op: "ilike", column, pattern });
    return this;
  }

  or(filters: readonly QueryFilter[]) {
    if (!Array.isArray(filters) || filters.length === 0) {
      throw new TypeError("O filtro .or() requer uma lista estruturada de condicoes");
    }

    this.filters.push({ op: "or", filters: [...filters] });
    return this;
  }

  order(column: string, options?: Omit<QueryOrder, "column">) {
    this.orders.push({ column, ...(options || {}) });
    return this;
  }

  limit(count: number) {
    this.rowLimit = count;
    return this;
  }

  single() {
    this.singleMode = "single";
    return this;
  }

  maybeSingle() {
    this.singleMode = "maybeSingle";
    return this;
  }

  async execute(): Promise<BackendResult<T>> {
    return this.executeQuery({
      table: this.table,
      operation: this.operation,
      select: this.selected,
      selectOptions: this.selectOptions,
      values: this.values,
      filters: this.filters,
      orders: this.orders,
      limit: this.rowLimit,
      single: this.singleMode,
      returning: this.returning,
      upsertOptions: this.upsertOptions,
    });
  }

  then<TResult1 = BackendResult<T>, TResult2 = never>(
    onfulfilled?: ((value: BackendResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}
