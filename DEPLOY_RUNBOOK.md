# Runbook unico de deploy da VPS

Este e o procedimento autoritativo. Cada deploy cria uma release imutavel em
`/var/www/vexortech/releases/<data>-<commit>` e troca o symlink
`/var/www/vexortech/current` apenas depois de backup, validacao, build e migration.
Nao copie `.env` para a release, nao informe secrets na linha de comando e nao use
`set -x`.

## 1. Contratos permanentes da VPS

Use acesso SSH por chave com um usuario de deploy e `sudo`; login SSH por senha ou
como `root` nao faz parte deste procedimento.

Arquivos protegidos, provisionados fora do Git por secret manager:

- `/etc/vexortech/build.env` (`root:www-data`, modo `0640`): apenas
  `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- `/etc/vexortech/vexortech.env` (`root:www-data`, modo `0640`): `DATABASE_URL`,
  `PUBLIC_APP_URL`, `PARTNER_APP_URL`, `APP_ALLOWED_ORIGINS`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, uma das chaves
  `SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY`, `AUTH_FLOW_SECRET`, uma das
  `ASAAS_WEBHOOK_SECRET`/`ASAAS_WEBHOOK_AUTH_TOKEN`, `ASAAS_API_KEY`,
  `ASAAS_ENVIRONMENT`, `TRUSTED_PROXY_IPS` e `DATABASE_SSL_ROOT_CERT`.
- `/etc/vexortech/migrate.env` (`root:root`, modo `0600`): `DATABASE_URL` de
  administracao para migration/check. Use conexao direta Supabase ou pooler de
  sessao, nunca pooler de transacao. Inclua `DATABASE_SSL_ROOT_CERT`.
- `/etc/vexortech/supabase-root-2021.crt` (`root:www-data`, modo `0640`): CA do
  projeto Supabase, validado antes da instalacao. O runtime e as migrations
  forcam `sslmode=verify-full` quando esse caminho absoluto esta configurado.
- `/etc/vexortech/pg_service.conf` e `/etc/vexortech/pgpass` (`root:root`, modo
  `0600`): conexao libpq do backup. O service `vexortech_backup` deve declarar
  `host`, `port`, `dbname`, `user`, `sslmode=verify-full` e `sslrootcert`; a senha
  fica somente no `pgpass`, em registro correspondente. Provisione ambos sem colar
  a senha no historico do shell.
- `/root/.supabase/access-token` (`root:root`, modo `0600`): PAT da CLI/Management
  API. Use um token dedicado com permissoes para Functions, Secrets e
  `realtime_config_read`/`realtime_config_write`; nunca o passe em argumento.
- `/etc/nginx/snippets/hype-backend-node.conf` e
  `/etc/nginx/snippets/hype-backend-edge.conf` (`root:root`, modo `0600`): rotas
  reversiveis. O segundo contem `EDGE_PROXY_SECRET`; o symlink
  `hype-backend-active.conf` seleciona um deles atomicamente.

`DATABASE_URL` do runtime deve apontar para o mesmo project ref de
`NEXT_PUBLIC_SUPABASE_URL`. Para uma VPS persistente, use conexao direta quando
IPv6 estiver disponivel ou pooler de sessao quando for necessario IPv4. O arquivo
de migration deve usar uma role separada, com privilegios de DDL; o runtime deve
usar apenas os privilegios efetivamente exigidos pela aplicacao.

Preflight, sem imprimir valores:

```bash
set -Eeuo pipefail
test -s /etc/vexortech/build.env
test -s /etc/vexortech/vexortech.env
test -s /etc/vexortech/migrate.env
test -s /etc/vexortech/pg_service.conf
test -s /etc/vexortech/pgpass
test -s /etc/vexortech/supabase-root-2021.crt
test -s /root/.supabase/access-token
test -r /etc/ssl/certs/ca-certificates.crt
test "$(stat -c '%U:%G:%a' /etc/vexortech/build.env)" = "root:www-data:640"
test "$(stat -c '%U:%G:%a' /etc/vexortech/vexortech.env)" = "root:www-data:640"
test "$(stat -c '%a' /etc/vexortech/migrate.env)" = 600
test "$(stat -c '%a' /etc/vexortech/pg_service.conf)" = 600
test "$(stat -c '%a' /etc/vexortech/pgpass)" = 600
test "$(stat -c '%U:%G:%a' /etc/vexortech/supabase-root-2021.crt)" = "root:www-data:640"
test "$(stat -c '%U:%G:%a' /root/.supabase/access-token)" = "root:root:600"
grep -Eq '^[[:space:]]*DATABASE_URL=' /etc/vexortech/vexortech.env
grep -Eq '^[[:space:]]*DATABASE_URL=' /etc/vexortech/migrate.env
grep -Eq '^[[:space:]]*DATABASE_SSL_ROOT_CERT=/etc/vexortech/supabase-root-2021\.crt[[:space:]]*$' /etc/vexortech/vexortech.env
grep -Eq '^[[:space:]]*DATABASE_SSL_ROOT_CERT=/etc/vexortech/supabase-root-2021\.crt[[:space:]]*$' /etc/vexortech/migrate.env
! grep -Eq '^[[:space:]]*(DATABASE|POSTGRES)_SSL_REJECT_UNAUTHORIZED=false[[:space:]]*$' /etc/vexortech/vexortech.env
! grep -Eq '^[[:space:]]*(DATABASE|POSTGRES)_SSL_REJECT_UNAUTHORIZED=false[[:space:]]*$' /etc/vexortech/migrate.env
grep -Eq '^\[vexortech_backup\][[:space:]]*$' /etc/vexortech/pg_service.conf
/usr/bin/node -e "const [major,minor]=process.versions.node.split('.').map(Number); if(major<22||(major===22&&minor<12)) process.exit(1)"
```

O PAT e `EDGE_PROXY_SECRET` sao credenciais diferentes. O PAT nunca vai para as
Functions ou para o Nginx; `EDGE_PROXY_SECRET` nunca vai para o frontend, para o
ambiente persistente do Node ou para argumentos de processo.

## 2. Gate e artefato na estacao/CI

Execute com variaveis de teste, nunca com credenciais de producao. A arvore deve
estar limpa para que o artefato validado seja exatamente o commit transferido.

```bash
set -Eeuo pipefail
test -z "$(git status --porcelain)"
npm ci --include=dev
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e

RELEASE_SHA="$(git rev-parse HEAD)"
ARTIFACT_DIR="$(pwd)/.deploy-artifacts"
ARTIFACT_NAME="vexortech-${RELEASE_SHA}.tar.gz"
mkdir -p "$ARTIFACT_DIR"
git archive --format=tar.gz --output="$ARTIFACT_DIR/$ARTIFACT_NAME" HEAD
(
  cd "$ARTIFACT_DIR"
  sha256sum "$ARTIFACT_NAME" > "$ARTIFACT_NAME.sha256"
)
```

Transfira os dois arquivos para `/var/tmp` usando SSH por chave. O operador define
`VPS_SSH` no proprio ambiente; o runbook nao armazena host, usuario ou credencial.

```bash
test -n "${VPS_SSH:?defina VPS_SSH no ambiente}"
scp "$ARTIFACT_DIR/$ARTIFACT_NAME" "$ARTIFACT_DIR/$ARTIFACT_NAME.sha256" \
  "$VPS_SSH:/var/tmp/"
```

## 3. Preparar a release na VPS

Entre com o usuario de deploy e execute `sudo -i`. Mantenha este mesmo shell ate o
fim da observacao para que o lock cubra backup, migration e corte. No shell elevado,
informe somente o SHA ja validado. Os valores abaixo nao contem secrets.

```bash
set -Eeuo pipefail
umask 027
exec 9>/run/lock/vexortech-deploy.lock
flock -n 9

RELEASE_SHA="COMMIT_SHA_DE_40_CARACTERES"
test "${#RELEASE_SHA}" -eq 40
case "$RELEASE_SHA" in (*[!0-9a-f]*) exit 1;; esac

APP_ROOT=/var/www/vexortech
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-${RELEASE_SHA:0:12}"
RELEASE_DIR="$APP_ROOT/releases/$RELEASE_ID"
ARTIFACT_NAME="vexortech-${RELEASE_SHA}.tar.gz"
ARTIFACT="/var/tmp/$ARTIFACT_NAME"
DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:-}}"
test -n "$DEPLOY_USER"
test "$DEPLOY_USER" != root
id "$DEPLOY_USER" >/dev/null
BUILD_ENV=/etc/vexortech/build.env
RUNTIME_ENV=/etc/vexortech/vexortech.env
MIGRATE_ENV=/etc/vexortech/migrate.env
SYSTEMD_UNIT=/etc/systemd/system/vexortech.service
NGINX_SITE=/etc/nginx/sites-enabled/vexortech
NGINX_SNIPPET_DIR=/etc/nginx/snippets
BACKEND_NODE_SNIPPET="$NGINX_SNIPPET_DIR/hype-backend-node.conf"
BACKEND_EDGE_SNIPPET="$NGINX_SNIPPET_DIR/hype-backend-edge.conf"
BACKEND_ACTIVE_SNIPPET="$NGINX_SNIPPET_DIR/hype-backend-active.conf"
PROJECT_REF=sjzdvlqnhhgbqdsvwiqt
SUPABASE_FUNCTION_HOST="$PROJECT_REF.supabase.co"
CONFIG_BACKUP="/var/backups/vexortech/config-$RELEASE_ID"
CANDIDATE_ENV_DIR=/etc/vexortech/release-env
CANDIDATE_ENV="$CANDIDATE_ENV_DIR/$RELEASE_ID.env"

cd /var/tmp
sha256sum --check "$ARTIFACT_NAME.sha256"
test ! -e "$RELEASE_DIR"
install -d -o "$DEPLOY_USER" -g www-data -m 0750 "$APP_ROOT/releases"
install -d -o "$DEPLOY_USER" -g www-data -m 0750 "$RELEASE_DIR"
sudo -u "$DEPLOY_USER" tar --extract --gzip --file "$ARTIFACT" --directory "$RELEASE_DIR"
test ! -e "$RELEASE_DIR/.env"

# Preserve the active configuration before any migration or candidate
# environment is created. The canonical runtime environment remains untouched
# until the candidate is already serving public traffic on 3101.
test -L "$APP_ROOT/current"
PREVIOUS_RELEASE="$(readlink -f "$APP_ROOT/current")"
case "$PREVIOUS_RELEASE" in
  "$APP_ROOT"/releases/*) ;;
  *) echo "current aponta para fora de releases" >&2; exit 1 ;;
esac
test -f "$SYSTEMD_UNIT"
test ! -L "$SYSTEMD_UNIT"
test -f "$NGINX_SITE"
test ! -L "$NGINX_SITE"
test "$(stat -c '%U:%G:%a' "$RUNTIME_ENV")" = "root:www-data:640"
install -d -o root -g root -m 0700 "$CONFIG_BACKUP"
printf '%s\n' "$PREVIOUS_RELEASE" > "$CONFIG_BACKUP/previous-release"
cp --archive "$SYSTEMD_UNIT" "$CONFIG_BACKUP/vexortech.service"
cp --archive "$NGINX_SITE" "$CONFIG_BACKUP/nginx-vexortech.conf"
cp --archive "$RUNTIME_ENV" "$CONFIG_BACKUP/vexortech.env"
test ! -f "$BACKEND_NODE_SNIPPET" || \
  cp --archive "$BACKEND_NODE_SNIPPET" "$CONFIG_BACKUP/hype-backend-node.conf"
test ! -f "$BACKEND_EDGE_SNIPPET" || \
  cp --archive "$BACKEND_EDGE_SNIPPET" "$CONFIG_BACKUP/hype-backend-edge.conf"
if test -L "$BACKEND_ACTIVE_SNIPPET"; then
  readlink -f "$BACKEND_ACTIVE_SNIPPET" > "$CONFIG_BACKUP/backend-active-target"
elif test -e "$BACKEND_ACTIVE_SNIPPET"; then
  echo "snippet ativo precisa ser symlink" >&2
  exit 1
else
  printf '%s\n' absent > "$CONFIG_BACKUP/backend-active-target"
fi
install -d -o root -g www-data -m 0750 "$CANDIDATE_ENV_DIR"
```

`git archive` deliberadamente nao inclui `.git`; a identidade da release e
garantida pelo nome, SHA256 e gate da arvore limpa.

## 4. Backup logico custom antes da migration

O backup usa `PGSERVICEFILE` e `PGPASSFILE`; nenhuma URI ou senha aparece em
argumentos, logs ou historico. O major de `pg_dump` deve ser igual ou mais novo que
o major do servidor PostgreSQL.

```bash
export PGSERVICEFILE=/etc/vexortech/pg_service.conf
export PGPASSFILE=/etc/vexortech/pgpass
PGSERVICE=vexortech_backup
BACKUP_DIR=/var/backups/vexortech/database
install -d -o root -g root -m 0700 "$BACKUP_DIR"

SERVER_VERSION_NUM="$(psql "service=$PGSERVICE" -XAtqc 'show server_version_num')"
SERVER_MAJOR="$((SERVER_VERSION_NUM / 10000))"
PG_DUMP_MAJOR="$(pg_dump --version | sed -E 's/^[^0-9]*([0-9]+).*/\1/')"
test "$PG_DUMP_MAJOR" -ge "$SERVER_MAJOR"

BACKUP="$BACKUP_DIR/pre-${RELEASE_ID}.dump"
umask 077
pg_dump --dbname="service=$PGSERVICE" --format=custom --compress=9 \
  --no-owner --no-acl --file="$BACKUP"
test -s "$BACKUP"
pg_restore --list "$BACKUP" >/dev/null
sha256sum "$BACKUP" > "$BACKUP.sha256"
```

Se qualquer comando falhar, pare: nao execute migration nem altere `current`.

## 5. Instalar, validar e buildar sem ativar

Dependencias e validacoes rodam como o usuario de deploy. O build recebe apenas o
arquivo de ambiente publico via unidade transitoria; o arquivo nao e `source`ado.

```bash
sudo -u "$DEPLOY_USER" npm --prefix "$RELEASE_DIR" ci --include=dev
sudo -u "$DEPLOY_USER" npm --prefix "$RELEASE_DIR" run typecheck
sudo -u "$DEPLOY_USER" npm --prefix "$RELEASE_DIR" run lint
sudo -u "$DEPLOY_USER" npm --prefix "$RELEASE_DIR" test

systemd-run --quiet --wait --pipe --collect \
  --unit="vexortech-build-$RELEASE_ID" \
  --property=Type=oneshot \
  --property="User=$DEPLOY_USER" \
  --property=Group=www-data \
  --property="WorkingDirectory=$RELEASE_DIR" \
  --property="EnvironmentFile=$BUILD_ENV" \
  /usr/bin/npm run build

test -r "$RELEASE_DIR/dist/index.html"
test -r "$RELEASE_DIR/.output/server/vanilla-server.js"
sudo -u "$DEPLOY_USER" npm --prefix "$RELEASE_DIR" prune --omit=dev
chown -R root:www-data "$RELEASE_DIR"
chmod -R u=rwX,g=rX,o= "$RELEASE_DIR"
```

## 6. Migration, reconciliacao contratual e verificacao do schema

Use a conexao administrativa protegida somente para migration e schema check.
`systemd-run` injeta cada arquivo sem expor seu conteudo. A migration precisa
concluir antes do corte.

```bash
systemd-run --quiet --wait --pipe --collect \
  --unit="vexortech-migrate-$RELEASE_ID" \
  --property=Type=oneshot \
  --property=User=www-data \
  --property=Group=www-data \
  --property="WorkingDirectory=$RELEASE_DIR" \
  --property="EnvironmentFile=$MIGRATE_ENV" \
  /usr/bin/npm run db:migrate

# Gere CANDIDATE_ENV atomicamente a partir do ambiente ativo pelo secret manager.
# Este deploy NAO gira a senha de vexortech_runtime: a DATABASE_URL da candidata
# deve ser exatamente a mesma do release ativo. Assim os dois pools continuam
# validos durante canario, corte, drenagem e rollback. Uma primeira provisao da
# senha da role, ou uma futura rotacao, e um procedimento de manutencao separado
# com sobreposicao de credenciais; nunca altere a unica senha durante este fluxo.
# Nao passe segredos em argumento, SQL inline, log ou historico do shell.
# CANDIDATE_ENV deve ser root:www-data:0640.
test "$(stat -c '%U:%G:%a' "$RUNTIME_ENV")" = "root:www-data:640"
test "$(stat -c '%U:%G:%a' "$CANDIDATE_ENV")" = "root:www-data:640"
/usr/bin/node - "$RUNTIME_ENV" "$CANDIDATE_ENV" <<'NODE'
const fs = require("node:fs");
const read = (file) => {
  const values = new Map();
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) process.exit(1);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || values.has(key)) process.exit(1);
    values.set(key, value);
  }
  return values;
};
const active = read(process.argv[2]);
const candidate = read(process.argv[3]);
if (!active.get("DATABASE_URL") || candidate.get("DATABASE_URL") !== active.get("DATABASE_URL")) process.exit(1);
const database = new URL(candidate.get("DATABASE_URL"));
if (decodeURIComponent(database.username).split(".")[0] !== "vexortech_runtime") process.exit(1);
NODE
systemd-run --quiet --wait --pipe --collect \
  --unit="vexortech-runtime-env-$RELEASE_ID" \
  --property=Type=oneshot \
  --property=User=www-data \
  --property=Group=www-data \
  --property="WorkingDirectory=$RELEASE_DIR" \
  --property="EnvironmentFile=$CANDIDATE_ENV" \
  /usr/bin/node -e 'const u=new URL(process.env.DATABASE_URL||"");if(decodeURIComponent(u.username).split(".")[0]!=="vexortech_runtime")process.exit(1)'

# O utilitario usa a role runtime de menor privilegio e apenas GET no Asaas. Ele
# valida todas as identidades, atualiza de forma condicionada sob lock e transacao,
# e termina somente quando a contagem de contratos pendentes for zero.
systemd-run --quiet --wait --pipe --collect \
  --unit="vexortech-contract-prices-$RELEASE_ID" \
  --property=Type=oneshot \
  --property=User=www-data \
  --property=Group=www-data \
  --property="WorkingDirectory=$RELEASE_DIR" \
  --property="EnvironmentFile=$CANDIDATE_ENV" \
  /usr/bin/npm run --silent db:reconcile-contract-prices

systemd-run --quiet --wait --pipe --collect \
  --unit="vexortech-schema-$RELEASE_ID" \
  --property=Type=oneshot \
  --property=User=www-data \
  --property=Group=www-data \
  --property="WorkingDirectory=$RELEASE_DIR" \
  --property="EnvironmentFile=$MIGRATE_ENV" \
  /usr/bin/npm run db:check

# A migration e expand/contract: a release ainda ativa precisa continuar saudavel.
curl -fsS --connect-timeout 2 --max-time 8 \
  http://127.0.0.1:3000/api/health >/dev/null
```

Falha em qualquer etapa interrompe o deploy antes do symlink. O reconciliador e
idempotente: depois de corrigir uma falha de rede ou dados, execute-o novamente.
Nao restaure o dump automaticamente; investigue e aplique uma correcao forward.

## 7. Preparar Supabase Edge e validar sem trafego publico

As migrations e o schema check acima sao pre-condicao das Functions e das
policies de Broadcast. Antes de atualizar uma Function, mantenha as tres rotas no
fallback Node. Assim uma nova versao da Edge nunca recebe trafego publico antes
dos canarios.

Crie um env-file temporario por secret manager. Ele deve ser `root:root:0600`, nao
pode ser `source`ado e deve conter apenas os valores server-side abaixo. A
`DATABASE_URL` daqui e a do Supavisor em transaction mode (`6543`) para a role
`vexortech_runtime`; ela nao e a URL administrativa nem a URL persistente do Node.
Os secrets Supabase padrao (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` e
`SUPABASE_SECRET_KEYS`) ja existem no runtime hospedado e nao entram neste arquivo.

```bash
set -Eeuo pipefail
umask 077
EDGE_TMP="/run/vexortech-edge-$RELEASE_ID"
EDGE_ENV="$EDGE_TMP/functions.env"
EDGE_PROXY_CURL="$EDGE_TMP/proxy.curl"
MANAGEMENT_CURL="$EDGE_TMP/management.curl"
EDGE_RESULT="$EDGE_TMP/result.json"
EDGE_HEADERS="$EDGE_TMP/headers.txt"
FUNCTIONS_RESULT="$EDGE_TMP/functions.json"
REALTIME_RESULT="$EDGE_TMP/realtime.json"
NODE_SNIPPET_TMP="$EDGE_TMP/backend-node.conf"
EDGE_SNIPPET_TMP="$EDGE_TMP/backend-edge.conf"

cleanup_edge_material() {
  rm -f -- "$EDGE_ENV" "$EDGE_PROXY_CURL" "$MANAGEMENT_CURL" \
    "$EDGE_RESULT" "$EDGE_HEADERS" "$FUNCTIONS_RESULT" "$REALTIME_RESULT" \
    "$NODE_SNIPPET_TMP" "$EDGE_SNIPPET_TMP"
  rmdir "$EDGE_TMP" 2>/dev/null || true
}
trap cleanup_edge_material EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

test ! -e "$EDGE_TMP"
install -d -o root -g root -m 0700 "$EDGE_TMP"
install -o root -g root -m 0600 /dev/null "$EDGE_ENV"

# PARE AQUI: o secret manager deve substituir EDGE_ENV atomicamente, sem
# imprimir valores. Use formato KEY=VALUE sem export, comandos ou expansoes.
# Obrigatorias:
# DATABASE_URL, DATABASE_RUNTIME_ROLE, PUBLIC_APP_URL, PARTNER_APP_URL,
# APP_ALLOWED_ORIGINS, AUTH_FLOW_SECRET, EDGE_PROXY_SECRET,
# GOOGLE_MAPS_API_KEY, ASAAS_API_KEY, ASAAS_ENVIRONMENT,
# ASAAS_WEBHOOK_SECRET (ou ASAAS_WEBHOOK_AUTH_TOKEN), EVOLUTION_API_URL,
# EVOLUTION_API_KEY e EVOLUTION_INSTANCE. As demais EVOLUTION_* sao opcionais.

test "$(stat -c '%U:%G:%a' "$EDGE_ENV")" = "root:root:600"
/usr/bin/node - "$EDGE_ENV" "$CANDIDATE_ENV" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const values = new Map();
for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator <= 0) process.exit(1);
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(key) || values.has(key) || !value) process.exit(1);
  values.set(key, value);
}
const required = [
  "DATABASE_URL", "DATABASE_RUNTIME_ROLE", "PUBLIC_APP_URL", "PARTNER_APP_URL",
  "APP_ALLOWED_ORIGINS", "AUTH_FLOW_SECRET", "EDGE_PROXY_SECRET",
  "GOOGLE_MAPS_API_KEY", "ASAAS_API_KEY", "ASAAS_ENVIRONMENT",
  "EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE",
];
if (required.some((key) => !values.get(key))) process.exit(1);
if (!values.get("ASAAS_WEBHOOK_SECRET") && !values.get("ASAAS_WEBHOOK_AUTH_TOKEN")) process.exit(1);
if (values.get("DATABASE_RUNTIME_ROLE") !== "vexortech_runtime") process.exit(1);
if (values.get("PUBLIC_APP_URL") !== "https://hypedelivery.com.br") process.exit(1);
if (values.get("PARTNER_APP_URL") !== "https://parceiros.hypedelivery.com.br") process.exit(1);
if (values.get("ASAAS_ENVIRONMENT") !== "production") process.exit(1);
if ((values.get("AUTH_FLOW_SECRET") || "").length < 32) process.exit(1);
if (!/^[A-Za-z0-9_-]{43,128}$/.test(values.get("EDGE_PROXY_SECRET") || "")) process.exit(1);
const origins = new Set((values.get("APP_ALLOWED_ORIGINS") || "").split(",").map((v) => v.trim()));
for (const origin of [
  "https://hypedelivery.com.br",
  "https://www.hypedelivery.com.br",
  "https://parceiros.hypedelivery.com.br",
]) if (!origins.has(origin)) process.exit(1);
const database = new URL(values.get("DATABASE_URL"));
if (decodeURIComponent(database.username).split(".")[0] !== "vexortech_runtime") process.exit(1);
if (!/(^|\.)supabase\.(?:co|com)$/i.test(database.hostname)) process.exit(1);
if (database.port !== "6543") process.exit(1);
const sslModes = database.searchParams.getAll("sslmode").map((value) => value.toLowerCase());
if (sslModes.length !== 1 || !["require", "verify-ca", "verify-full"].includes(sslModes[0])) process.exit(1);
const candidateLine = fs.readFileSync(process.argv[3], "utf8").split(/\r?\n/)
  .find((line) => line.trim().startsWith("DATABASE_URL="));
if (!candidateLine) process.exit(1);
const candidateDatabase = new URL(candidateLine.trim().slice("DATABASE_URL=".length));
if (decodeURIComponent(database.password) !== decodeURIComponent(candidateDatabase.password)) process.exit(1);
const forbidden = [
  "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_URL", "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY", "DATABASE_SSL_ROOT_CERT",
];
if ([...values.keys()].some((key) => forbidden.includes(key) || key.startsWith("VITE_") || key.startsWith("NEXT_PUBLIC_"))) process.exit(1);
NODE
```

Gere os dois snippets. O valor privado entra no arquivo Edge somente por
`printf` builtin; nao aparece em argumento de processo. `$remote_addr` e a unica
identidade de cliente aceita. Se houver CDN, configure antes o modulo `real_ip`
com allowlist dos CIDRs oficiais; nunca promova um `X-Forwarded-For` arbitrario.
Os `proxy_pass` nao definem argumentos novos, portanto preservam a query string;
Nginx mantem metodo/corpo e repassa `Set-Cookie` por padrao. Cookie, Authorization
e Origin sao definidos explicitamente nas rotas que os utilizam.

```bash
cat > "$NODE_SNIPPET_TMP" <<'NGINX'
location = /api/backend {
    client_max_body_size 6m;
    limit_req zone=hype_api burst=40 nodelay;
    limit_conn hype_per_ip 20;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_request_buffering off;
    proxy_read_timeout 1h;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:3000;
}

location = /api/webhooks/asaas {
    client_max_body_size 1m;
    limit_req zone=hype_api burst=40 nodelay;
    limit_conn hype_per_ip 20;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 60s;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:3000;
}

location ^~ /storage/ {
    client_max_body_size 6m;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:3000;
}
NGINX

EDGE_PROXY_SECRET_VALUE=
while IFS= read -r line || test -n "$line"; do
  case "$line" in
    EDGE_PROXY_SECRET=*) EDGE_PROXY_SECRET_VALUE="${line#EDGE_PROXY_SECRET=}" ;;
  esac
done < "$EDGE_ENV"
case "$EDGE_PROXY_SECRET_VALUE" in
  ""|*[!A-Za-z0-9_-]*) echo "formato de EDGE_PROXY_SECRET invalido" >&2; exit 1 ;;
esac
test "${#EDGE_PROXY_SECRET_VALUE}" -ge 43

{
  printf '%s\n' \
    'location = /api/backend {' \
    '    client_max_body_size 6m;' \
    '    limit_req zone=hype_api burst=40 nodelay;' \
    '    limit_conn hype_per_ip 20;' \
    '    proxy_http_version 1.1;' \
    '    proxy_buffering off;' \
    '    proxy_cache off;' \
    '    proxy_request_buffering off;' \
    '    proxy_read_timeout 1h;' \
    '    proxy_ssl_server_name on;' \
    '    proxy_ssl_name sjzdvlqnhhgbqdsvwiqt.supabase.co;' \
    '    proxy_ssl_verify on;' \
    '    proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;' \
    '    proxy_ssl_verify_depth 3;' \
    '    proxy_set_header Connection "";' \
    '    proxy_set_header Host sjzdvlqnhhgbqdsvwiqt.supabase.co;' \
    '    proxy_set_header Origin $http_origin;' \
    '    proxy_set_header Cookie $http_cookie;' \
    '    proxy_set_header Authorization $http_authorization;' \
    '    proxy_set_header X-Forwarded-Proto $scheme;' \
    '    proxy_set_header X-Forwarded-Host $host;' \
    '    proxy_set_header X-Forwarded-For $remote_addr;' \
    '    proxy_set_header X-Hype-Client-Ip $remote_addr;'
  builtin printf '    proxy_set_header X-Hype-Proxy-Secret "%s";\n' "$EDGE_PROXY_SECRET_VALUE"
  printf '%s\n' \
    '    proxy_redirect off;' \
    '    proxy_pass https://sjzdvlqnhhgbqdsvwiqt.supabase.co/functions/v1/hype-api;' \
    '}' \
    '' \
    'location = /api/webhooks/asaas {' \
    '    client_max_body_size 1m;' \
    '    limit_req zone=hype_api burst=40 nodelay;' \
    '    limit_conn hype_per_ip 20;' \
    '    proxy_http_version 1.1;' \
    '    proxy_buffering off;' \
    '    proxy_read_timeout 60s;' \
    '    proxy_ssl_server_name on;' \
    '    proxy_ssl_name sjzdvlqnhhgbqdsvwiqt.supabase.co;' \
    '    proxy_ssl_verify on;' \
    '    proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;' \
    '    proxy_ssl_verify_depth 3;' \
    '    proxy_set_header Connection "";' \
    '    proxy_set_header Host sjzdvlqnhhgbqdsvwiqt.supabase.co;' \
    '    proxy_set_header Origin $http_origin;' \
    '    proxy_set_header Asaas-Access-Token $http_asaas_access_token;' \
    '    proxy_set_header X-Forwarded-Proto $scheme;' \
    '    proxy_set_header X-Forwarded-Host $host;' \
    '    proxy_set_header X-Forwarded-For $remote_addr;'
  builtin printf '    proxy_set_header X-Hype-Proxy-Secret "%s";\n' "$EDGE_PROXY_SECRET_VALUE"
  printf '%s\n' \
    '    proxy_redirect off;' \
    '    proxy_pass https://sjzdvlqnhhgbqdsvwiqt.supabase.co/functions/v1/asaas-webhook;' \
    '}' \
    '' \
    'location ^~ /storage/ {' \
    '    client_max_body_size 6m;' \
    '    proxy_http_version 1.1;' \
    '    proxy_buffering off;' \
    '    proxy_ssl_server_name on;' \
    '    proxy_ssl_name sjzdvlqnhhgbqdsvwiqt.supabase.co;' \
    '    proxy_ssl_verify on;' \
    '    proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;' \
    '    proxy_ssl_verify_depth 3;' \
    '    proxy_set_header Connection "";' \
    '    proxy_set_header Host sjzdvlqnhhgbqdsvwiqt.supabase.co;' \
    '    proxy_set_header Origin $http_origin;' \
    '    proxy_set_header Cookie $http_cookie;' \
    '    proxy_set_header Authorization $http_authorization;' \
    '    proxy_set_header X-Forwarded-Proto $scheme;' \
    '    proxy_set_header X-Forwarded-Host $host;' \
    '    proxy_set_header X-Forwarded-For $remote_addr;' \
    '    proxy_set_header X-Hype-Client-Ip $remote_addr;'
  builtin printf '    proxy_set_header X-Hype-Proxy-Secret "%s";\n' "$EDGE_PROXY_SECRET_VALUE"
  printf '%s\n' \
    '    proxy_redirect off;' \
    '    proxy_pass https://sjzdvlqnhhgbqdsvwiqt.supabase.co/functions/v1/hype-api/storage/;' \
    '}'
} > "$EDGE_SNIPPET_TMP"

builtin printf 'header = "X-Hype-Proxy-Secret: %s"\n' \
  "$EDGE_PROXY_SECRET_VALUE" > "$EDGE_PROXY_CURL"
unset EDGE_PROXY_SECRET_VALUE
chmod 0600 "$EDGE_PROXY_CURL" "$NODE_SNIPPET_TMP" "$EDGE_SNIPPET_TMP"
test "$(grep -Ec '^location (= /api/backend|= /api/webhooks/asaas|\^~ /storage/) ' "$NODE_SNIPPET_TMP")" -eq 3
test "$(grep -Ec '^location (= /api/backend|= /api/webhooks/asaas|\^~ /storage/) ' "$EDGE_SNIPPET_TMP")" -eq 3
test "$(grep -Fc 'X-Hype-Proxy-Secret' "$EDGE_SNIPPET_TMP")" -eq 3
! grep -Fq 'X-Hype-Proxy-Secret' "$NODE_SNIPPET_TMP"

install_snippet_atomically() {
  local source="$1" target="$2" temporary
  temporary="$NGINX_SNIPPET_DIR/.$(basename "$target").$RELEASE_ID"
  install -o root -g root -m 0600 "$source" "$temporary"
  mv --no-target-directory "$temporary" "$target"
  test "$(stat -c '%U:%G:%a' "$target")" = "root:root:600"
}

switch_backend_atomically() {
  local target="$1" temporary="$NGINX_SNIPPET_DIR/.hype-backend-active-$RELEASE_ID"
  case "$target" in
    "$BACKEND_NODE_SNIPPET"|"$BACKEND_EDGE_SNIPPET") ;;
    *) return 1 ;;
  esac
  rm -f -- "$temporary"
  ln --symbolic "$target" "$temporary"
  mv --no-target-directory "$temporary" "$BACKEND_ACTIVE_SNIPPET"
  test "$(readlink -f "$BACKEND_ACTIVE_SNIPPET")" = "$target"
}

install -d -o root -g root -m 0755 "$NGINX_SNIPPET_DIR"
install_snippet_atomically "$NODE_SNIPPET_TMP" "$BACKEND_NODE_SNIPPET"
install_snippet_atomically "$EDGE_SNIPPET_TMP" "$BACKEND_EDGE_SNIPPET"
switch_backend_atomically "$BACKEND_NODE_SNIPPET"
nginx -t
systemctl reload nginx
```

Com o fallback confirmado, envie secrets, publique exatamente as duas Functions
e execute canarios diretos. A CLI esta pinada; `--use-api` valida o bundle no
servico hospedado sem depender de Docker na VPS. A chamada sem segredo precisa
falhar em `403`; os canarios com segredo exercitam JSON/DB, webhook e Storage sem
criar ou alterar dados.

```bash
PUBLIC_QUERY='{"kind":"query","query":{"table":"stores","operation":"select","select":"id","filters":[],"orders":[],"limit":1}}'
curl -fsS --connect-timeout 5 --max-time 20 \
  -H 'Origin: https://hypedelivery.com.br' \
  -H 'Content-Type: application/json' \
  --data-binary "$PUBLIC_QUERY" \
  https://hypedelivery.com.br/api/backend > "$EDGE_RESULT"
/usr/bin/node - "$EDGE_RESULT" <<'NODE'
const fs = require("node:fs");
const body = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!Array.isArray(body.data) || body.error) process.exit(1);
NODE

SUPABASE_CLI=(/usr/bin/npx --yes supabase@2.109.1)
EDGE_PREVIOUS_WORKDIR="$CONFIG_BACKUP/edge-functions-before"
install -d -o root -g root -m 0700 \
  "$EDGE_PREVIOUS_WORKDIR/supabase/functions"
install -o root -g root -m 0600 \
  "$RELEASE_DIR/supabase/config.toml" \
  "$EDGE_PREVIOUS_WORKDIR/supabase/config.toml"
"${SUPABASE_CLI[@]}" functions list \
  --workdir "$RELEASE_DIR" \
  --project-ref "$PROJECT_REF" \
  --output json > "$CONFIG_BACKUP/edge-functions-before.json"
chmod 0600 "$CONFIG_BACKUP/edge-functions-before.json"
for function_name in hype-api asaas-webhook; do
  if /usr/bin/node - "$CONFIG_BACKUP/edge-functions-before.json" "$function_name" <<'NODE'
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const rows = Array.isArray(payload) ? payload : (payload.functions || payload.data || []);
process.exit(rows.some((row) => (row.name || row.slug) === process.argv[3]) ? 0 : 1);
NODE
  then
    "${SUPABASE_CLI[@]}" functions download "$function_name" \
      --workdir "$EDGE_PREVIOUS_WORKDIR" \
      --project-ref "$PROJECT_REF" \
      --use-api
  fi
done
chmod -R u=rwX,go= "$EDGE_PREVIOUS_WORKDIR"

"${SUPABASE_CLI[@]}" secrets set \
  --workdir "$RELEASE_DIR" \
  --project-ref "$PROJECT_REF" \
  --env-file "$EDGE_ENV"
for function_name in hype-api asaas-webhook; do
  "${SUPABASE_CLI[@]}" functions deploy "$function_name" \
    --workdir "$RELEASE_DIR" \
    --project-ref "$PROJECT_REF" \
    --use-api
done
"${SUPABASE_CLI[@]}" functions list \
  --workdir "$RELEASE_DIR" \
  --project-ref "$PROJECT_REF" \
  --output json > "$FUNCTIONS_RESULT"
/usr/bin/node - "$FUNCTIONS_RESULT" <<'NODE'
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const rows = Array.isArray(payload) ? payload : (payload.functions || payload.data || []);
const names = new Set(rows.map((row) => row.name || row.slug));
if (!names.has("hype-api") || !names.has("asaas-webhook")) process.exit(1);
NODE
install -o root -g root -m 0600 "$FUNCTIONS_RESULT" \
  "$CONFIG_BACKUP/edge-functions-after.json"

EDGE_API="https://$SUPABASE_FUNCTION_HOST/functions/v1/hype-api"
EDGE_WEBHOOK="https://$SUPABASE_FUNCTION_HOST/functions/v1/asaas-webhook"
test "$(curl -sS --connect-timeout 5 --max-time 20 -o /dev/null -w '%{http_code}' \
  -H 'Origin: https://hypedelivery.com.br' \
  -H 'Content-Type: application/json' \
  --data-binary "$PUBLIC_QUERY" "$EDGE_API")" = 403

test "$(curl --config "$EDGE_PROXY_CURL" -sS --connect-timeout 5 --max-time 30 \
  -o "$EDGE_RESULT" -w '%{http_code}' \
  -H 'Origin: https://hypedelivery.com.br' \
  -H 'Content-Type: application/json' \
  --data-binary "$PUBLIC_QUERY" "$EDGE_API")" = 200
/usr/bin/node - "$EDGE_RESULT" <<'NODE'
const fs = require("node:fs");
const body = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!Array.isArray(body.data) || body.error) process.exit(1);
NODE

test "$(curl --config "$EDGE_PROXY_CURL" -sS --connect-timeout 5 --max-time 20 \
  -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' --data-binary '{}' "$EDGE_WEBHOOK")" = 401
test "$(curl --config "$EDGE_PROXY_CURL" -sS --connect-timeout 5 --max-time 20 \
  -o /dev/null -w '%{http_code}' \
  "$EDGE_API/storage/__hype_canary__/missing")" = 404
```

Ative a restricao global de canais privados pelo endpoint oficial de Management
API. A configuracao desconecta clientes Realtime; por isso ela ocorre com o BFF
no Node e polling disponivel. O PAT e lido do arquivo protegido e entra somente em
um curl config temporario, nunca na linha de comando.

```bash
SUPABASE_ACCESS_TOKEN_VALUE=
IFS= read -r SUPABASE_ACCESS_TOKEN_VALUE < /root/.supabase/access-token
case "$SUPABASE_ACCESS_TOKEN_VALUE" in
  ""|*[!A-Za-z0-9._-]*) echo "PAT Supabase invalido" >&2; exit 1 ;;
esac
test "${#SUPABASE_ACCESS_TOKEN_VALUE}" -ge 32
builtin printf 'header = "Authorization: Bearer %s"\n' \
  "$SUPABASE_ACCESS_TOKEN_VALUE" > "$MANAGEMENT_CURL"
unset SUPABASE_ACCESS_TOKEN_VALUE
chmod 0600 "$MANAGEMENT_CURL"

REALTIME_API="https://api.supabase.com/v1/projects/$PROJECT_REF/config/realtime"
test "$(curl --config "$MANAGEMENT_CURL" --silent --show-error --fail-with-body \
  --connect-timeout 5 --max-time 30 --request PATCH \
  --header 'Content-Type: application/json' \
  --data-binary '{"private_only":true}' \
  --output /dev/null --write-out '%{http_code}' "$REALTIME_API")" = 204
curl --config "$MANAGEMENT_CURL" --silent --show-error --fail-with-body \
  --connect-timeout 5 --max-time 30 \
  --output "$REALTIME_RESULT" "$REALTIME_API"
/usr/bin/node - "$REALTIME_RESULT" <<'NODE'
const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (config.private_only !== true) process.exit(1);
NODE

cleanup_edge_material
trap - EXIT INT TERM HUP
unset EDGE_ENV EDGE_PROXY_CURL MANAGEMENT_CURL EDGE_RESULT EDGE_HEADERS \
  FUNCTIONS_RESULT REALTIME_RESULT NODE_SNIPPET_TMP EDGE_SNIPPET_TMP
```

Se qualquer canario ou o gate `private_only` falhar, nao prossiga. As Functions
publicadas ainda estao fora do trafego e o symlink permanece no Node; corrija
forward e repita esta secao. Nao corte confiando apenas no status da CLI.

## 8. Corte blue/green do Node com rollback automatico

O processo antigo permanece em `127.0.0.1:3000`. Primeiro suba a release candidata
em `127.0.0.1:3101`; apenas depois do health desvie o Nginx para ela. Enquanto a
candidata atende o publico, atualize o symlink e o servico principal. Assim, nenhum
restart ocorre no upstream que esta recebendo trafego.

Execute o bloco em um unico shell `root`. O `trap` restaura ambiente, symlink, unit
e Nginx se qualquer validacao falhar. Se o processo antigo nao puder ser recuperado,
o rollback mantem a candidata atendendo em 3101, que e o estado seguro.

```bash
set -Eeuo pipefail

test -L "$APP_ROOT/current"
PREVIOUS_RELEASE="$(readlink -f "$APP_ROOT/current")"
case "$PREVIOUS_RELEASE" in
  "$APP_ROOT"/releases/*) ;;
  *) echo "current aponta para fora de releases" >&2; exit 1 ;;
esac
test -d "$PREVIOUS_RELEASE"
test -f "$CONFIG_BACKUP/vexortech.service"
test -f "$CONFIG_BACKUP/nginx-vexortech.conf"
test "$(stat -c '%U:%G:%a' "$CONFIG_BACKUP/vexortech.env")" = "root:www-data:640"
test "$(stat -c '%U:%G:%a' "$CANDIDATE_ENV")" = "root:www-data:640"
systemctl is-active --quiet vexortech
systemctl is-active --quiet nginx
nginx -t
curl -fsS --connect-timeout 2 --max-time 8 \
  http://127.0.0.1:3000/api/health >/dev/null
test -z "$(ss -H -ltn 'sport = :3101')"

CANDIDATE_UNIT="vexortech-candidate-$RELEASE_ID"
CANDIDATE_CONFIG="$CONFIG_BACKUP/nginx-candidate.conf"
CANDIDATE_NODE_SNIPPET="$CONFIG_BACKUP/hype-backend-candidate.conf"
COMMITTED=0
CANDIDATE_STARTED=0
CANDIDATE_EVER_PUBLIC=0
TRAFFIC_ON_CANDIDATE=0
MAIN_SWITCHED=0
UNIT_CHANGED=0
ENV_CHANGED=0

wait_health() {
  local port="$1" ready=0
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if curl -fsS --connect-timeout 2 --max-time 8 \
      "http://127.0.0.1:${port}/api/health" >/dev/null; then
      ready=1
      break
    fi
    sleep 2
  done
  test "$ready" -eq 1
}

install_site_atomically() {
  local source="$1" temporary
  temporary="$(dirname "$NGINX_SITE")/.vexortech-${RELEASE_ID}-$$"
  install -o root -g root -m 0644 "$source" "$temporary"
  mv --no-target-directory "$temporary" "$NGINX_SITE"
  test -f "$NGINX_SITE"
  test ! -L "$NGINX_SITE"
}

install_unit_atomically() {
  local source="$1" temporary
  temporary="$(dirname "$SYSTEMD_UNIT")/.vexortech-${RELEASE_ID}-$$.service"
  install -o root -g root -m 0644 "$source" "$temporary"
  mv --no-target-directory "$temporary" "$SYSTEMD_UNIT"
  test -f "$SYSTEMD_UNIT"
  test ! -L "$SYSTEMD_UNIT"
}

install_runtime_env_atomically() {
  local source="$1" temporary
  temporary="$(dirname "$RUNTIME_ENV")/.vexortech-env-${RELEASE_ID}-$$"
  install -o root -g www-data -m 0640 "$source" "$temporary"
  mv --no-target-directory "$temporary" "$RUNTIME_ENV"
  test "$(stat -c '%U:%G:%a' "$RUNTIME_ENV")" = "root:www-data:640"
}

switch_backend_atomically() {
  local target="$1" temporary="$NGINX_SNIPPET_DIR/.hype-backend-active-$RELEASE_ID"
  case "$target" in
    "$BACKEND_NODE_SNIPPET"|"$CANDIDATE_NODE_SNIPPET") ;;
    *) return 1 ;;
  esac
  rm -f -- "$temporary"
  ln --symbolic "$target" "$temporary"
  mv --no-target-directory "$temporary" "$BACKEND_ACTIVE_SNIPPET"
  test "$(readlink -f "$BACKEND_ACTIVE_SNIPPET")" = "$target"
}

assert_loopback_listener() {
  local port="$1" sockets
  sockets="$(ss -H -ltn "sport = :${port}")"
  test -n "$sockets"
  printf '%s\n' "$sockets" | grep -Eq "127\\.0\\.0\\.1:${port}"
  ! printf '%s\n' "$sockets" | grep -Eq "(0\\.0\\.0\\.0|\\*|\\[::\\]):${port}"
}

public_smoke() {
  local root_html asset_path
  curl -fsS --connect-timeout 5 --max-time 10 \
    https://hypedelivery.com.br/api/health >/dev/null
  curl -fsS --connect-timeout 5 --max-time 10 \
    https://parceiros.hypedelivery.com.br/api/health >/dev/null
  root_html="$(curl -fsS --connect-timeout 5 --max-time 10 \
    https://hypedelivery.com.br/)"
  curl -fsS --connect-timeout 5 --max-time 10 \
    https://parceiros.hypedelivery.com.br/ >/dev/null
  asset_path="$(printf '%s' "$root_html" \
    | grep -oE '/assets/[^"[:space:]]+\.(js|css)' | sed -n '1p')"
  test -n "$asset_path"
  curl -fsSI --connect-timeout 5 --max-time 10 \
    "https://hypedelivery.com.br$asset_path" >/dev/null
  curl -fsSI --connect-timeout 5 --max-time 10 \
    "https://parceiros.hypedelivery.com.br$asset_path" >/dev/null
  for origin in https://hypedelivery.com.br https://parceiros.hypedelivery.com.br; do
    curl -fsS --connect-timeout 5 --max-time 30 \
      -H "Origin: $origin" -H 'Content-Type: application/json' \
      --data-binary '{"kind":"query","query":{"table":"stores","operation":"select","select":"id","filters":[],"orders":[],"limit":1}}' \
      "$origin/api/backend?bluegreen=$RELEASE_ID" \
      | /usr/bin/node -e 'let body="";process.stdin.on("data",chunk=>body+=chunk);process.stdin.on("end",()=>{const parsed=JSON.parse(body);if(!Array.isArray(parsed.data)||parsed.error)process.exit(1)})'
  done
  test "$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' \
    'http://hypedelivery.com.br/smoke?from=deploy')" = \
    '301 https://hypedelivery.com.br/smoke?from=deploy'
  test "$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' \
    'http://parceiros.hypedelivery.com.br/smoke?from=deploy')" = \
    '301 https://parceiros.hypedelivery.com.br/smoke?from=deploy'
  test "$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' \
    'http://www.hypedelivery.com.br/smoke?from=deploy')" = \
    '301 https://hypedelivery.com.br/smoke?from=deploy'
  test "$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' \
    'https://www.hypedelivery.com.br/smoke?from=deploy')" = \
    '301 https://hypedelivery.com.br/smoke?from=deploy'
}

rollback_deploy() {
  local exit_code="$?" old_ready=0
  trap - EXIT INT TERM HUP
  if test "$COMMITTED" -eq 1; then
    exit "$exit_code"
  fi

  echo "deploy falhou; iniciando rollback" >&2
  if test "$MAIN_SWITCHED" -eq 1; then
    rollback_link="$APP_ROOT/.rollback-$RELEASE_ID"
    rm -f "$rollback_link"
    ln --symbolic "$PREVIOUS_RELEASE" "$rollback_link"
    mv --no-target-directory "$rollback_link" "$APP_ROOT/current"
  fi
  if test "$UNIT_CHANGED" -eq 1; then
    install_unit_atomically "$CONFIG_BACKUP/vexortech.service"
    systemctl daemon-reload
  fi
  if test "$ENV_CHANGED" -eq 1; then
    install_runtime_env_atomically "$CONFIG_BACKUP/vexortech.env"
  fi

  if test "$MAIN_SWITCHED" -eq 1 || test "$UNIT_CHANGED" -eq 1; then
    if systemctl restart vexortech && wait_health 3000; then
      old_ready=1
    fi
  elif curl -fsS --connect-timeout 2 --max-time 8 \
    http://127.0.0.1:3000/api/health >/dev/null; then
    old_ready=1
  fi
  if test "$old_ready" -eq 1; then
    switch_backend_atomically "$BACKEND_NODE_SNIPPET"
    install_site_atomically "$CONFIG_BACKUP/nginx-vexortech.conf"
    nginx -t
    systemctl reload nginx
    if test "$CANDIDATE_EVER_PUBLIC" -eq 1; then
      echo "rollback concluido; preserve a candidata ate os workers antigos drenarem: $CANDIDATE_UNIT.service" >&2
    elif test "$CANDIDATE_STARTED" -eq 1; then
      systemctl stop "$CANDIDATE_UNIT.service" || true
    fi
  elif test "$CANDIDATE_STARTED" -eq 1 && \
    curl -fsS --connect-timeout 2 --max-time 8 \
      http://127.0.0.1:3101/api/health >/dev/null; then
    switch_backend_atomically "$CANDIDATE_NODE_SNIPPET"
    install_site_atomically "$CANDIDATE_CONFIG"
    nginx -t
    systemctl reload nginx
    echo "processo antigo indisponivel; candidata foi mantida em 3101" >&2
  else
    switch_backend_atomically "$BACKEND_NODE_SNIPPET"
    install_site_atomically "$CONFIG_BACKUP/nginx-vexortech.conf"
    nginx -t
  fi
  exit "$exit_code"
}
trap rollback_deploy EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

test "$(grep -Fc '127.0.0.1:3000' \
  "$RELEASE_DIR/deploy/nginx-vexortech.conf")" -eq 6
test "$(grep -Fc '127.0.0.1:3000' "$BACKEND_NODE_SNIPPET")" -eq 3
sed 's/127\.0\.0\.1:3000/127.0.0.1:3101/g' \
  "$BACKEND_NODE_SNIPPET" > "$CANDIDATE_NODE_SNIPPET"
chmod 0600 "$CANDIDATE_NODE_SNIPPET"
test "$(stat -c '%U:%G:%a' "$CANDIDATE_NODE_SNIPPET")" = "root:root:600"
test "$(grep -Fc '127.0.0.1:3101' "$CANDIDATE_NODE_SNIPPET")" -eq 3
test "$(grep -Fc '127.0.0.1:3000' "$CANDIDATE_NODE_SNIPPET" || true)" -eq 0
sed 's/127\.0\.0\.1:3000/127.0.0.1:3101/g' \
  "$RELEASE_DIR/deploy/nginx-vexortech.conf" > "$CANDIDATE_CONFIG"
test "$(grep -Fc '127.0.0.1:3101' "$CANDIDATE_CONFIG")" -eq 6
test "$(grep -Fc '127.0.0.1:3000' "$CANDIDATE_CONFIG" || true)" -eq 0

CANDIDATE_STARTED=1
systemd-run --quiet --collect --unit="$CANDIDATE_UNIT" \
  --property=Type=simple \
  --property=User=www-data \
  --property=Group=www-data \
  --property=Restart=on-failure \
  --property=RestartSec=2s \
  --property=UMask=0027 \
  --property=NoNewPrivileges=true \
  --property=PrivateTmp=true \
  --property=PrivateDevices=true \
  --property=ProtectSystem=strict \
  --property=ProtectHome=true \
  --property=ProtectKernelTunables=true \
  --property=ProtectKernelModules=true \
  --property=ProtectControlGroups=true \
  --property=RestrictSUIDSGID=true \
  --property=LockPersonality=true \
  --property=RestrictAddressFamilies='AF_UNIX AF_INET AF_INET6' \
  --property="WorkingDirectory=$RELEASE_DIR" \
  --property="EnvironmentFile=$CANDIDATE_ENV" \
  /usr/bin/env NODE_ENV=production HOST=127.0.0.1 PORT=3101 \
  /usr/bin/node .output/server/vanilla-server.js
wait_health 3101
CANDIDATE_PID="$(systemctl show --property=MainPID --value "$CANDIDATE_UNIT.service")"
test "$CANDIDATE_PID" -gt 1
test "$(readlink -f "/proc/$CANDIDATE_PID/cwd")" = "$RELEASE_DIR"
assert_loopback_listener 3101

switch_backend_atomically "$CANDIDATE_NODE_SNIPPET"
test "$(readlink -f "$BACKEND_ACTIVE_SNIPPET")" = "$CANDIDATE_NODE_SNIPPET"
install_site_atomically "$CANDIDATE_CONFIG"
nginx -t
systemctl reload nginx
TRAFFIC_ON_CANDIDATE=1
CANDIDATE_EVER_PUBLIC=1
public_smoke

ENV_CHANGED=1
install_runtime_env_atomically "$CANDIDATE_ENV"
UNIT_CHANGED=1
install_unit_atomically "$RELEASE_DIR/deploy/vexortech.service"
systemd-analyze verify "$SYSTEMD_UNIT"
systemctl daemon-reload
systemctl enable vexortech

NEXT_LINK="$APP_ROOT/.current-$RELEASE_ID"
rm -f "$NEXT_LINK"
ln --symbolic "$RELEASE_DIR" "$NEXT_LINK"
MAIN_SWITCHED=1
mv --no-target-directory "$NEXT_LINK" "$APP_ROOT/current"
systemctl restart vexortech
systemctl is-active --quiet vexortech
wait_health 3000
MAIN_PID="$(systemctl show --property=MainPID --value vexortech.service)"
test "$MAIN_PID" -gt 1
test "$(readlink -f "/proc/$MAIN_PID/cwd")" = "$RELEASE_DIR"
assert_loopback_listener 3000

OLD_NGINX_WORKERS="$(pgrep -P "$(cat /run/nginx.pid)" || true)"
switch_backend_atomically "$BACKEND_NODE_SNIPPET"
test "$(readlink -f "$BACKEND_ACTIVE_SNIPPET")" = "$BACKEND_NODE_SNIPPET"
install_site_atomically "$RELEASE_DIR/deploy/nginx-vexortech.conf"
nginx -t
systemctl reload nginx
TRAFFIC_ON_CANDIDATE=0
public_smoke
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  https://hypedelivery.com.br/api/health)" = 405

COMMITTED=1
trap - EXIT INT TERM HUP

# Nao interrompa SSE ainda atendido pelos workers antigos do Nginx. Se eles nao
# drenarem em 30 s, preserve a candidata e finalize-a manualmente apos a janela.
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  alive=0
  for pid in $OLD_NGINX_WORKERS; do
    test ! -d "/proc/$pid" || alive=1
  done
  test "$alive" -eq 1 || break
  sleep 2
done
if test "${alive:-0}" -eq 0; then
  if ! systemctl stop "$CANDIDATE_UNIT.service"; then
    echo "deploy concluido; falha nao critica ao parar candidata: $CANDIDATE_UNIT.service" >&2
  fi
  rm -f "$CANDIDATE_ENV"
else
  echo "candidata mantida para drenar conexoes; parar depois: $CANDIDATE_UNIT.service e remover $CANDIDATE_ENV"
fi
```

## 9. Corte atomico das rotas para Supabase Edge

Somente depois de migrations, Functions, canarios diretos, Realtime privado e
blue/green do Node aprovados, troque o snippet ativo. O Node continua executando
em `127.0.0.1:3000` como rollback. Este corte nao altera o symlink da release nem
reinicia processos.

```bash
set -Eeuo pipefail
test "$(readlink -f "$BACKEND_ACTIVE_SNIPPET")" = "$BACKEND_NODE_SNIPPET"
test "$(stat -c '%U:%G:%a' "$BACKEND_NODE_SNIPPET")" = "root:root:600"
test "$(stat -c '%U:%G:%a' "$BACKEND_EDGE_SNIPPET")" = "root:root:600"
test "$(grep -Fc 'include /etc/nginx/snippets/hype-backend-active.conf;' \
  "$NGINX_SITE")" -eq 2
curl -fsS --connect-timeout 2 --max-time 8 \
  http://127.0.0.1:3000/api/health >/dev/null

EDGE_CUT_TMP="/run/vexortech-edge-cut-$RELEASE_ID"
test ! -e "$EDGE_CUT_TMP"
install -d -o root -g root -m 0700 "$EDGE_CUT_TMP"

switch_backend_atomically() {
  local target="$1" temporary="$NGINX_SNIPPET_DIR/.hype-backend-active-$RELEASE_ID"
  case "$target" in
    "$BACKEND_NODE_SNIPPET"|"$BACKEND_EDGE_SNIPPET") ;;
    *) return 1 ;;
  esac
  rm -f -- "$temporary"
  ln --symbolic "$target" "$temporary"
  mv --no-target-directory "$temporary" "$BACKEND_ACTIVE_SNIPPET"
  test "$(readlink -f "$BACKEND_ACTIVE_SNIPPET")" = "$target"
}

cleanup_edge_cut() {
  rm -f -- "$EDGE_CUT_TMP/api.json" "$EDGE_CUT_TMP/headers.txt" \
    "$EDGE_CUT_TMP/body.json" "$EDGE_CUT_TMP/csp.txt"
  rmdir "$EDGE_CUT_TMP" 2>/dev/null || true
}

EDGE_ROUTE_COMMITTED=0
rollback_edge_route() {
  local exit_code="$?"
  trap - EXIT INT TERM HUP
  if test "$EDGE_ROUTE_COMMITTED" -eq 0; then
    switch_backend_atomically "$BACKEND_NODE_SNIPPET" || true
    if nginx -t; then systemctl reload nginx || true; fi
    echo "corte Edge falhou; rotas restauradas no fallback Node" >&2
  fi
  cleanup_edge_cut
  exit "$exit_code"
}
trap rollback_edge_route EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

switch_backend_atomically "$BACKEND_EDGE_SNIPPET"
nginx -t
systemctl reload nginx
test "$(readlink -f "$BACKEND_ACTIVE_SNIPPET")" = "$BACKEND_EDGE_SNIPPET"

PUBLIC_QUERY='{"kind":"query","query":{"table":"stores","operation":"select","select":"id","filters":[],"orders":[],"limit":1}}'
for origin in https://hypedelivery.com.br https://parceiros.hypedelivery.com.br; do
  test "$(curl -sS --connect-timeout 5 --max-time 30 \
    -o "$EDGE_CUT_TMP/api.json" -w '%{http_code}' \
    -H "Origin: $origin" -H 'Content-Type: application/json' \
    --data-binary "$PUBLIC_QUERY" \
    "$origin/api/backend?cutover=$RELEASE_ID")" = 200
  /usr/bin/node - "$EDGE_CUT_TMP/api.json" <<'NODE'
const fs = require("node:fs");
const body = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!Array.isArray(body.data) || body.error) process.exit(1);
NODE
done

# signOut sem sessao nao altera dados e valida corpo, Origin e os Set-Cookie
# HttpOnly devolvidos pela Edge atraves do dominio publico.
test "$(curl -sS --connect-timeout 5 --max-time 30 \
  -D "$EDGE_CUT_TMP/headers.txt" -o "$EDGE_CUT_TMP/body.json" -w '%{http_code}' \
  -H 'Origin: https://hypedelivery.com.br' \
  -H 'Content-Type: application/json' \
  --data-binary '{"kind":"auth","action":"signOut"}' \
  https://hypedelivery.com.br/api/backend)" = 200
test "$(grep -Eic '^set-cookie: hype_(access|refresh)=' "$EDGE_CUT_TMP/headers.txt")" -ge 2
grep -Eiq '^set-cookie: hype_access=.*Path=/.*HttpOnly.*SameSite=Lax.*Max-Age=0.*Secure' \
  "$EDGE_CUT_TMP/headers.txt"

test "$(curl -sS --connect-timeout 5 --max-time 20 -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' --data-binary '{}' \
  https://hypedelivery.com.br/api/webhooks/asaas)" = 401
test "$(curl -sS --connect-timeout 5 --max-time 20 -o /dev/null -w '%{http_code}' \
  https://hypedelivery.com.br/storage/__hype_canary__/missing)" = 404
test "$(curl -sS --connect-timeout 5 --max-time 20 -o /dev/null -w '%{http_code}' \
  -H 'Origin: https://hypedelivery.com.br' \
  -H 'Content-Type: application/json' --data-binary "$PUBLIC_QUERY" \
  "https://$SUPABASE_FUNCTION_HOST/functions/v1/hype-api")" = 403

curl -fsS --connect-timeout 5 --max-time 10 \
  https://hypedelivery.com.br/api/health >/dev/null
curl -fsSI --connect-timeout 5 --max-time 10 \
  https://hypedelivery.com.br/ > "$EDGE_CUT_TMP/csp.txt"
grep -Fqi "connect-src 'self' https://sjzdvlqnhhgbqdsvwiqt.supabase.co wss://sjzdvlqnhhgbqdsvwiqt.supabase.co" \
  "$EDGE_CUT_TMP/csp.txt"
! grep -Fq '*.supabase.co' "$EDGE_CUT_TMP/csp.txt"

EDGE_ROUTE_COMMITTED=1
trap - EXIT INT TERM HUP
cleanup_edge_cut
```

Se uma validacao posterior apontar regressao, execute imediatamente o rollback
de rota abaixo; nao e necessario desfazer migration nem Function para retirar a
Edge do trafego:

```bash
switch_backend_atomically "$BACKEND_NODE_SNIPPET"
nginx -t
systemctl reload nginx
test "$(readlink -f "$BACKEND_ACTIVE_SNIPPET")" = "$BACKEND_NODE_SNIPPET"
```

## 10. Smoke publico e observacao

O health responde `200` apenas quando ambiente, project ref, banco gravavel,
privilegios efetivos de escrita nas tabelas criticas, migration e postura RLS/grants
estao corretos. O contrato inclui as colunas `subscriptions.gateway_action_pending`
e `subscriptions.gateway_paused_for_dispute`. Ele aceita apenas `GET`/`HEAD`, nao
inclui erros internos e coalesce consultas por aproximadamente cinco segundos.
Tambem falha se um webhook nao processado ou uma acao pendente no gateway ficar
sem recuperacao por mais de dez minutos.

```bash
curl -fsS --connect-timeout 5 --max-time 10 \
  https://hypedelivery.com.br/api/health
curl -fsSI --connect-timeout 5 --max-time 10 \
  https://parceiros.hypedelivery.com.br/api/health >/dev/null

ASSET_PATH="$(curl -fsS https://hypedelivery.com.br/ \
  | grep -oE '/assets/[^"[:space:]]+\.(js|css)' | head -n 1)"
test -n "$ASSET_PATH"
curl -fsSI "https://hypedelivery.com.br$ASSET_PATH" >/dev/null
curl -fsSI "https://parceiros.hypedelivery.com.br$ASSET_PATH" >/dev/null

systemctl status vexortech --no-pager
journalctl -u vexortech --since '-10 minutes' --no-pager
```

Valide tambem `/`, `/lojas`, `/entrar`, `/cadastrar`, `/recuperar-senha`,
`/lojista/entrar`, `/admin/entrar`, `/pedido/token-inexistente` e
`/loja/slug-inexistente` em desktop e mobile. O gate E2E completo ja deve ter sido
executado contra o mesmo commit na etapa 2; qualquer E2E pos-deploy deve ser
explicitamente nao mutante e usar `E2E_BASE_URL` no CI, nunca secrets da VPS.

## 11. Rollback da aplicacao e das configuracoes

Rollback nao desfaz migration automaticamente. Antes de voltar o binario, confirme
que a release anterior e compativel com o schema forward. Se nao for, corrija
forward; restauracao de banco exige janela, aprovacao e plano separado.

```bash
set -Eeuo pipefail
APP_ROOT=/var/www/vexortech
CONFIG_BACKUP="/var/backups/vexortech/config-RELEASE_ID_COM_FALHA"
SYSTEMD_UNIT=/etc/systemd/system/vexortech.service
RUNTIME_ENV=/etc/vexortech/vexortech.env
NGINX_SITE=/etc/nginx/sites-enabled/vexortech
NGINX_SNIPPET_DIR=/etc/nginx/snippets
BACKEND_NODE_SNIPPET="$NGINX_SNIPPET_DIR/hype-backend-node.conf"
BACKEND_ACTIVE_SNIPPET="$NGINX_SNIPPET_DIR/hype-backend-active.conf"
PREVIOUS_RELEASE="$(cat "$CONFIG_BACKUP/previous-release")"
test -d "$PREVIOUS_RELEASE"
test "$(stat -c '%U:%G:%a' "$CONFIG_BACKUP/vexortech.env")" = "root:www-data:640"

# Restaure primeiro os arquivos de configuracao que pertencem a release anterior.
# Os temporarios ficam no mesmo filesystem dos destinos para manter o corte atomico.
if test -f "$CONFIG_BACKUP/hype-backend-node.conf"; then
  NODE_SNIPPET_ROLLBACK_TMP="$NGINX_SNIPPET_DIR/.hype-backend-node-rollback-$$"
  install -o root -g root -m 0600 \
    "$CONFIG_BACKUP/hype-backend-node.conf" "$NODE_SNIPPET_ROLLBACK_TMP"
  mv --no-target-directory "$NODE_SNIPPET_ROLLBACK_TMP" "$BACKEND_NODE_SNIPPET"
fi
RUNTIME_ROLLBACK_TMP="$(dirname "$RUNTIME_ENV")/.vexortech-env-rollback-$$"
install -o root -g www-data -m 0640 \
  "$CONFIG_BACKUP/vexortech.env" "$RUNTIME_ROLLBACK_TMP"
mv --no-target-directory "$RUNTIME_ROLLBACK_TMP" "$RUNTIME_ENV"
test "$(stat -c '%U:%G:%a' "$RUNTIME_ENV")" = "root:www-data:640"

# Retire a Edge do trafego antes de trocar binario ou tentar restaurar codigo de
# Function. A troca usa um symlink temporario no mesmo filesystem.
BACKEND_ROLLBACK_LINK="$NGINX_SNIPPET_DIR/.hype-backend-active-rollback-$$"
rm -f -- "$BACKEND_ROLLBACK_LINK"
ln --symbolic "$BACKEND_NODE_SNIPPET" "$BACKEND_ROLLBACK_LINK"
mv --no-target-directory "$BACKEND_ROLLBACK_LINK" "$BACKEND_ACTIVE_SNIPPET"
test "$(readlink -f "$BACKEND_ACTIVE_SNIPPET")" = "$BACKEND_NODE_SNIPPET"
nginx -t
systemctl reload nginx

ROLLBACK_LINK="$APP_ROOT/.rollback-$(date -u +%Y%m%dT%H%M%SZ)"
ln --symbolic "$PREVIOUS_RELEASE" "$ROLLBACK_LINK"
mv --no-target-directory "$ROLLBACK_LINK" "$APP_ROOT/current"

test ! -f "$CONFIG_BACKUP/vexortech.service" || \
  install -o root -g root -m 0644 "$CONFIG_BACKUP/vexortech.service" "$SYSTEMD_UNIT"
test ! -f "$CONFIG_BACKUP/nginx-vexortech.conf" || \
  install -o root -g root -m 0644 "$CONFIG_BACKUP/nginx-vexortech.conf" "$NGINX_SITE"

systemd-analyze verify "$SYSTEMD_UNIT"
nginx -t
systemctl daemon-reload
systemctl restart vexortech
systemctl is-active --quiet vexortech
curl -fsS --connect-timeout 5 --max-time 10 \
  http://127.0.0.1:3000/api/health >/dev/null
systemctl reload nginx
curl -fsS --connect-timeout 5 --max-time 10 \
  https://hypedelivery.com.br/api/health >/dev/null
```

O backup registra metadados em `edge-functions-before.json` e, quando a Function
ja existia, baixa sua fonte para `edge-functions-before/`. Restaurar o control
plane e opcional e sempre ocorre com as rotas ainda no Node:

```bash
set -Eeuo pipefail
PROJECT_REF=sjzdvlqnhhgbqdsvwiqt
EDGE_PREVIOUS_WORKDIR="$CONFIG_BACKUP/edge-functions-before"
SUPABASE_CLI=(/usr/bin/npx --yes supabase@2.109.1)
for function_name in hype-api asaas-webhook; do
  test ! -d "$EDGE_PREVIOUS_WORKDIR/supabase/functions/$function_name" || \
    "${SUPABASE_CLI[@]}" functions deploy "$function_name" \
      --workdir "$EDGE_PREVIOUS_WORKDIR" \
      --project-ref "$PROJECT_REF" \
      --use-api
done
```

Esse redeploy cria uma nova versao hospedada a partir da fonte anterior; ele nao
reativa a Edge. Repita os canarios da secao 7 antes de qualquer novo corte.

Conserve a release anterior, o dump custom e o backup de configuracao ate o fim da
janela de observacao. So depois remova artefatos antigos de forma manual e
explicitamente revisada.
