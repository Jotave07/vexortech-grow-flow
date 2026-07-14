import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readRootFile = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Supabase Edge deployment contract", () => {
  it("always enforces the reverse-proxy capability at both public Edge entrypoints", async () => {
    const [apiEntry, webhookEntry] = await Promise.all([
      readRootFile("supabase/functions/hype-api/index.ts"),
      readRootFile("supabase/functions/asaas-webhook/index.ts"),
    ]);

    expect(apiEntry).toContain("requireTrustedEdgeProxy(backendHandler, { enforce: true })");
    expect(webhookEntry).toContain(
      "requireTrustedEdgeProxy(handleAsaasWebhook, { enforce: true })",
    );
  });

  it("keeps static files and health on Node while delegating only the domain routes", async () => {
    const nginx = await readRootFile("deploy/nginx-vexortech.conf");

    expect(nginx.match(/include \/etc\/nginx\/snippets\/hype-backend-active\.conf;/g)).toHaveLength(
      2,
    );
    expect(nginx.match(/proxy_pass http:\/\/127\.0\.0\.1:3000/g)).toHaveLength(6);
    expect(nginx).toContain("location /api/");
    expect(nginx).toContain("location /assets/");
    expect(nginx).not.toContain("location /storage/");
    expect(nginx).not.toContain("EDGE_PROXY_SECRET");
  });

  it("documents a secret-safe, canary-gated and reversible Edge cutover", async () => {
    const runbook = await readRootFile("DEPLOY_RUNBOOK.md");
    const migration = runbook.indexOf("/usr/bin/npm run db:migrate");
    const deploy = runbook.indexOf('functions deploy "$function_name"');
    const edgeCut = runbook.indexOf('switch_backend_atomically "$BACKEND_EDGE_SNIPPET"');
    const candidateListener = runbook.indexOf("assert_loopback_listener 3101");
    const candidateBackendCut = runbook.indexOf(
      'switch_backend_atomically "$CANDIDATE_NODE_SNIPPET"',
      candidateListener,
    );
    const candidateSiteCut = runbook.indexOf(
      'install_site_atomically "$CANDIDATE_CONFIG"',
      candidateListener,
    );
    const mainListener = runbook.indexOf("assert_loopback_listener 3000", candidateSiteCut);
    const mainBackendCut = runbook.indexOf(
      'switch_backend_atomically "$BACKEND_NODE_SNIPPET"',
      mainListener,
    );
    const mainSiteCut = runbook.indexOf(
      'install_site_atomically "$RELEASE_DIR/deploy/nginx-vexortech.conf"',
      mainListener,
    );

    expect(migration).toBeGreaterThan(0);
    expect(deploy).toBeGreaterThan(migration);
    expect(edgeCut).toBeGreaterThan(deploy);
    expect(candidateBackendCut).toBeGreaterThan(candidateListener);
    expect(candidateSiteCut).toBeGreaterThan(candidateBackendCut);
    expect(mainBackendCut).toBeGreaterThan(mainListener);
    expect(mainSiteCut).toBeGreaterThan(mainBackendCut);
    expect(runbook).toContain("edge-functions-before.json");
    expect(runbook).toContain('functions download "$function_name"');
    expect(runbook).toContain("secrets set");
    expect(runbook).toContain("for function_name in hype-api asaas-webhook; do");
    expect(runbook).not.toContain("functions deploy hype-api asaas-webhook");
    expect(runbook).toContain('--workdir "$RELEASE_DIR"');
    expect(runbook).toContain('--env-file "$EDGE_ENV"');
    expect(runbook).toContain("trap cleanup_edge_material EXIT");
    expect(runbook).toContain('candidate.get("DATABASE_URL") !== active.get("DATABASE_URL")');
    expect(runbook).toContain(
      "decodeURIComponent(database.password) !== decodeURIComponent(candidateDatabase.password)",
    );
    expect(runbook).toContain("Este deploy NAO gira a senha de vexortech_runtime");
    expect(runbook).not.toContain("provisione por canal secreto uma senha SCRAM aleatoria");
    expect(runbook).toContain('header = "Authorization: Bearer %s"');
    expect(runbook).not.toContain("--token $SUPABASE_ACCESS_TOKEN");
    expect(runbook).not.toContain("Authorization: Bearer $(");
    expect(runbook).toContain('private_only":true');
    expect(runbook).toContain("config.private_only !== true");
    expect(runbook).toContain(
      "proxy_pass https://sjzdvlqnhhgbqdsvwiqt.supabase.co/functions/v1/hype-api;",
    );
    expect(runbook).toContain(
      "proxy_pass https://sjzdvlqnhhgbqdsvwiqt.supabase.co/functions/v1/asaas-webhook;",
    );
    expect(runbook).toContain("proxy_set_header Cookie $http_cookie;");
    expect(runbook).toContain("proxy_set_header Authorization $http_authorization;");
    expect(runbook).toContain("proxy_set_header X-Hype-Client-Ip $remote_addr;");
    expect(runbook).toContain("proxy_ssl_verify on;");
    expect(runbook).toContain("proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;");
    expect(runbook).toContain('database.searchParams.getAll("sslmode")');
    expect(runbook).toContain("supabase\\.(?:co|com)");
    expect(runbook).toContain('["require", "verify-ca", "verify-full"].includes(sslModes[0])');
    expect(runbook).toContain('switch_backend_atomically "$BACKEND_NODE_SNIPPET"');
    expect(runbook).toContain('switch_backend_atomically "$CANDIDATE_NODE_SNIPPET"');
    expect(runbook).toContain(
      'test "$(readlink -f "$BACKEND_ACTIVE_SNIPPET")" = "$CANDIDATE_NODE_SNIPPET"',
    );
    expect(runbook).toContain(
      'test "$(readlink -f "$BACKEND_ACTIVE_SNIPPET")" = "$BACKEND_NODE_SNIPPET"',
    );
    expect(runbook).toContain('"$CONFIG_BACKUP/vexortech.env" "$RUNTIME_ROLLBACK_TMP"');
    expect(runbook).toContain(
      '"$CONFIG_BACKUP/hype-backend-node.conf" "$NODE_SNIPPET_ROLLBACK_TMP"',
    );
    expect(runbook).toContain('"$origin/api/backend?bluegreen=$RELEASE_ID"');
  });

  it("does not advertise obsolete browser-side integration secrets", async () => {
    const environment = await readRootFile(".env.example");

    expect(environment).toContain("GOOGLE_MAPS_API_KEY=");
    expect(environment).toContain("ASAAS_ENVIRONMENT=production");
    expect(environment).not.toContain("VITE_GOOGLE_MAPS_API_KEY");
    expect(environment).not.toContain("NEXT_PUBLIC_ASAAS_ENVIRONMENT");
  });
});
