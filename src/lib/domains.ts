export const DELIVERY_DOMAIN = "hypedelivery.com.br";
export const PARTNERS_DOMAIN = "parceiros.hypedelivery.com.br";

const withLeadingSlash = (path: string) => (path.startsWith("/") ? path : `/${path}`);

const isLocalHost = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

export const isPartnersDomain = () => {
  if (typeof window === "undefined") return false;
  return window.location.hostname.toLowerCase().startsWith("parceiros.");
};

export const getDeliveryBaseUrl = () => {
  if (typeof window === "undefined") return `https://${DELIVERY_DOMAIN}`;

  const { protocol, hostname, port } = window.location;
  if (isLocalHost(hostname)) {
    return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
  }

  return `https://${DELIVERY_DOMAIN}`;
};

export const getPartnersBaseUrl = () => {
  if (typeof window === "undefined") return `https://${PARTNERS_DOMAIN}`;

  const { protocol, hostname, port } = window.location;
  if (isLocalHost(hostname)) {
    return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
  }

  return `https://${PARTNERS_DOMAIN}`;
};

export const buildDeliveryUrl = (path = "/") => `${getDeliveryBaseUrl()}${withLeadingSlash(path)}`;
export const buildPartnersUrl = (path = "/") => `${getPartnersBaseUrl()}${withLeadingSlash(path)}`;
