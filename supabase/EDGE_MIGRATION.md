# Supabase Edge BFF migration

The `hype-api` function runs the same Request/Response handler used by the Node
fallback for `/api/backend`. The `asaas-webhook` function invokes the production
`handleAsaasWebhook` implementation; neither entrypoint is a placeholder.

## Required secrets

Configure these only in Supabase Edge secrets. Do not place them in the static
frontend or in a `VITE_*` variable.

- `DATABASE_URL`: Supavisor transaction-pooler URL for the restricted
  `vexortech_runtime` role. The handler deliberately does not fall back to the
  platform-provided `SUPABASE_DB_URL`, because that connection is privileged.
- `DATABASE_RUNTIME_ROLE`: optional; defaults to `vexortech_runtime`.
- `PUBLIC_APP_URL`, `PARTNER_APP_URL` and optionally `APP_ALLOWED_ORIGINS`.
- `AUTH_FLOW_SECRET`: at least 32 characters. A Supabase secret key is accepted
  as a fallback, but a dedicated value is preferred.
- `EDGE_PROXY_SECRET`: at least 32 random bytes encoded as base64url (the
  production runbook accepts 43-128 characters), shared only with the
  root-readable Nginx snippet. Without a valid secret, a direct Edge request
  cannot make the BFF trust a spoofed `X-Hype-Client-Ip` header.
- `ASAAS_API_KEY`, `ASAAS_ENVIRONMENT` and `ASAAS_WEBHOOK_SECRET` (or
  `ASAAS_WEBHOOK_AUTH_TOKEN`).
- Integration secrets already required by invoked operations, such as Google
  Maps and Evolution API credentials.

Hosted Edge Functions already provide `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS`. The backend accepts
those current plural JSON variables as well as the legacy singular variables.

Production Edge startup rejects a privileged database username, TLS-disabling
connection parameters, or a missing restricted `DATABASE_URL`. Hosted Edge TLS
uses the runtime trust store; the persistent Node fallback continues to require
its pinned `DATABASE_SSL_ROOT_CERT`. Both entrypoints call
`validateRuntimeEnv` before `Deno.serve`; the webhook additionally requires its
Asaas authentication secret at cold start.

## Routing and cookies

Keep the browser contract at same-origin `/api/backend`. Nginx can proxy that
path to `/functions/v1/hype-api`; this preserves the existing `HttpOnly`,
`Secure`, `SameSite=Lax`, `Path=/` cookies and PKCE flow. Calling the Supabase
function URL directly from another site is not a production cookie flow. GET
`/storage/<bucket>/<path>` can use the same function; public redirects and
private object authorization continue to be handled by `serveStorageFile` over
Supabase Storage.

Keep the Asaas dashboard pointed at
`https://hypedelivery.com.br/api/webhooks/asaas`. Nginx switches that stable
public URL to the Edge function and injects the private proxy secret; never
point Asaas at the direct `supabase.co/functions/v1/asaas-webhook` URL. Node and
Edge use the same idempotent handler during the transition.

## Reversible Nginx cutover

The blocks below define the proxy contract. For `hypedelivery.com.br`, use the
concrete generator and canary sequence in `DEPLOY_RUNBOOK.md`; it preserves the
existing `hype_api`/`hype_per_ip` limit zones, writes both snippets as
`root:root:0600`, records the previous Function versions and switches the active
symlink only after the Node fallback, Realtime private-only gate and direct Edge
canaries pass. Do not paste a real proxy secret into this document or the tracked
virtual-host file.

Replace `PROJECT_REF` and `EDGE_PROXY_SECRET` while installing the snippets;
never commit their real values. The active virtual host must contain exactly
one `include /etc/nginx/snippets/hype-backend-active.conf;` and no duplicate
locations for these paths. Define a shared-memory limiter once in Nginx's
`http` context; it is the authoritative cross-isolate request limiter:

```nginx
limit_req_zone $binary_remote_addr zone=hype_api:10m rate=20r/s;
```

Edge snippet (`/etc/nginx/snippets/hype-backend-edge.conf`, mode `0600`):

```nginx
location = /api/backend {
    client_max_body_size 6m;
    limit_req zone=hype_api burst=40 nodelay;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    proxy_ssl_server_name on;
    proxy_ssl_name PROJECT_REF.supabase.co;
    proxy_set_header Host PROJECT_REF.supabase.co;
    proxy_set_header Origin $http_origin;
    proxy_set_header Cookie $http_cookie;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Hype-Client-Ip $remote_addr;
    proxy_set_header X-Hype-Proxy-Secret "EDGE_PROXY_SECRET";
    proxy_pass https://PROJECT_REF.supabase.co/functions/v1/hype-api;
}

location = /api/webhooks/asaas {
    client_max_body_size 1m;
    limit_req zone=hype_api burst=20 nodelay;
    proxy_http_version 1.1;
    proxy_ssl_server_name on;
    proxy_ssl_name PROJECT_REF.supabase.co;
    proxy_set_header Host PROJECT_REF.supabase.co;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Hype-Proxy-Secret "EDGE_PROXY_SECRET";
    proxy_pass https://PROJECT_REF.supabase.co/functions/v1/asaas-webhook;
}

location ^~ /storage/ {
    proxy_http_version 1.1;
    proxy_ssl_server_name on;
    proxy_ssl_name PROJECT_REF.supabase.co;
    proxy_set_header Host PROJECT_REF.supabase.co;
    proxy_set_header Cookie $http_cookie;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Hype-Client-Ip $remote_addr;
    proxy_set_header X-Hype-Proxy-Secret "EDGE_PROXY_SECRET";
    proxy_redirect off;
    proxy_pass https://PROJECT_REF.supabase.co/functions/v1/hype-api/storage/;
}
```

Nginx preserves the original query string when `proxy_pass` above has no new
arguments, streams the original request body and forwards response `Set-Cookie`
headers by default. Because the Edge handler does not set `Domain`, the browser
stores those cookies for the visible `hypedelivery.com.br` host.

Rollback snippet (`/etc/nginx/snippets/hype-backend-node.conf`):

```nginx
location = /api/backend {
    client_max_body_size 6m;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 1h;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:3000;
}

location = /api/webhooks/asaas {
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:3000;
}

location ^~ /storage/ {
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:3000;
}
```

Cut over atomically only after function canaries pass:

```bash
sudo ln -sfn /etc/nginx/snippets/hype-backend-edge.conf /etc/nginx/snippets/hype-backend-active.conf
sudo nginx -t && sudo systemctl reload nginx
```

Rollback leaves Node running and changes only the symlink:

```bash
sudo ln -sfn /etc/nginx/snippets/hype-backend-node.conf /etc/nginx/snippets/hype-backend-active.conf
sudo nginx -t && sudo systemctl reload nginx
```

## Validation and current cutover limits

Run locally with a Docker-compatible engine:

```powershell
npx --yes supabase@2.109.1 functions serve --env-file .env.edge.local
```

The Node fallback remains the production path until canary tests pass. The
function rejects every deployed request that lacks the exact proxy secret, so
`verify_jwt=false` does not expose its public BFF routes directly. Per-operation
request buckets remain isolate-local defense in depth; Nginx `limit_req` is the
required shared limiter. The legacy SSE broadcaster is also isolate-local, so
use the private Supabase Realtime ticket/Broadcast path before disabling the
Node fallback at scale. Database transactions remain pinned to one `pg` client,
with an Edge pool size of one and a transaction-pooler URL.
