export const MERCHANT_STYLESHEET = new URL("./merchant.css", import.meta.url).href;

// The route bundle imports merchant.css. This compatibility hook deliberately
// performs no DOM mutation so strict style-src CSP remains effective.
export function ensureMerchantStyles() {
  return MERCHANT_STYLESHEET;
}
