import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Nginx Supabase Realtime CSP", () => {
  it("admits only the exact project HTTPS/WSS origins on every HTTPS host", async () => {
    const config = await readFile(
      new URL("../../deploy/nginx-vexortech.conf", import.meta.url),
      "utf8",
    );
    const directive =
      "connect-src 'self' https://sjzdvlqnhhgbqdsvwiqt.supabase.co wss://sjzdvlqnhhgbqdsvwiqt.supabase.co";

    expect(config.split(directive)).toHaveLength(4);
    expect(config).not.toContain("connect-src 'self';");
    expect(config).not.toContain("*.supabase.co");
  });
});
