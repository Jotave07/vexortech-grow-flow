/**
 * Contract consumed by the framework-free public routes.
 *
 * The router owns authentication and document titles. A route `render(ctx)` is
 * synchronous and always returns an Element; data is filled asynchronously.
 * Before removing a mounted route, the shell calls `element.cleanup?.()`.
 *
 * @typedef {Object} PublicPageContext
 * @property {{pathname: string}} location
 * @property {Record<string, string>} params
 * @property {(path: string) => void} navigate
 * @property {Object} api
 * @property {(table: string) => Object} api.from Supabase-compatible query builder.
 * @property {(name: string, body?: Object) => Promise<{data?: *, error?: *}|*>} api.fn
 * @property {(name: string, body?: Object) => Promise<{data?: *, error?: *}|*>} api.rpc
 * @property {Object} auth
 * @property {Object|null} auth.session
 * @property {Object|null} auth.profile
 * @property {string|null} auth.role
 * @property {(role: 'customer'|'store_owner'|'super_admin') => Promise<boolean>|boolean} auth.require
 * @property {() => Promise<void>} auth.signOut
 * @property {Object} ui
 * @property {(options: Object) => void} ui.toast
 * @property {(options: Object) => Promise<boolean>|boolean} ui.confirm
 * @property {(value: number) => string} ui.money
 * @property {(value: string|Date) => string} ui.date
 */

export const PUBLIC_SHELL_CONTRACT = Object.freeze({
  route: Object.freeze({
    shape: "{ pattern, auth?, title, render }",
    cleanup: "Call returnedElement.cleanup?.() before unmounting.",
  }),
  api: Object.freeze({
    tables: Object.freeze([
      "stores",
      "store_settings",
      "categories",
      "products",
      "product_options",
      "product_option_items",
      "store_reviews",
      "plans",
    ]),
    functions: Object.freeze([
      "quote-delivery",
      "create-checkout-order",
      "get-order-payment-info",
    ]),
    rpc: Object.freeze([
      "get_public_order",
      "get_public_order_items",
      "get_public_order_status_history",
    ]),
  }),
  security: Object.freeze({
    html: "Pages create DOM nodes and assign textContent; dynamic HTML is not accepted.",
    secrets: "Only explicit public columns are queried; gateway credentials are never requested.",
    checkout: "Prices, options, delivery and idempotency are revalidated by the server function.",
  }),
});
