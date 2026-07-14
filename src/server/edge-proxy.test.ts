import { describe, expect, it, vi } from "vitest";
import { requireTrustedEdgeProxy } from "./edge-proxy";

const url = "https://project.supabase.co/functions/v1/hype-api";
const secret = "proxy-secret-0123456789abcdef0123456789";

describe("Edge reverse-proxy boundary", () => {
  it("rejects a direct production Edge request before application dispatch", async () => {
    const application = vi.fn(async () => Response.json({ ok: true }));
    const handler = requireTrustedEdgeProxy(application, { enforce: true, secret });

    const response = await handler(new Request(url));

    expect(response.status).toBe(403);
    expect(application).not.toHaveBeenCalled();
  });

  it("accepts only the exact root-proxy secret", async () => {
    const application = vi.fn(async () => Response.json({ ok: true }));
    const handler = requireTrustedEdgeProxy(application, { enforce: true, secret });

    const wrong = await handler(
      new Request(url, { headers: { "X-Hype-Proxy-Secret": `${secret.slice(0, -1)}x` } }),
    );
    const accepted = await handler(
      new Request(url, { headers: { "X-Hype-Proxy-Secret": secret } }),
    );

    expect(wrong.status).toBe(403);
    expect(accepted.status).toBe(200);
    expect(application).toHaveBeenCalledTimes(1);
  });
});
