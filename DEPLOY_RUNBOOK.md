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
test "$(stat -c '%U:%G:%a' /etc/vexortech/build.env)" = "root:www-data:640"
test "$(stat -c '%U:%G:%a' /etc/vexortech/vexortech.env)" = "root:www-data:640"
test "$(stat -c '%a' /etc/vexortech/migrate.env)" = 600
test "$(stat -c '%a' /etc/vexortech/pg_service.conf)" = 600
test "$(stat -c '%a' /etc/vexortech/pgpass)" = 600
test "$(stat -c '%U:%G:%a' /etc/vexortech/supabase-root-2021.crt)" = "root:www-data:640"
grep -Eq '^[[:space:]]*DATABASE_URL=' /etc/vexortech/vexortech.env
grep -Eq '^[[:space:]]*DATABASE_URL=' /etc/vexortech/migrate.env
grep -Eq '^[[:space:]]*DATABASE_SSL_ROOT_CERT=/etc/vexortech/supabase-root-2021\.crt[[:space:]]*$' /etc/vexortech/vexortech.env
grep -Eq '^[[:space:]]*DATABASE_SSL_ROOT_CERT=/etc/vexortech/supabase-root-2021\.crt[[:space:]]*$' /etc/vexortech/migrate.env
! grep -Eq '^[[:space:]]*(DATABASE|POSTGRES)_SSL_REJECT_UNAUTHORIZED=false[[:space:]]*$' /etc/vexortech/vexortech.env
! grep -Eq '^[[:space:]]*(DATABASE|POSTGRES)_SSL_REJECT_UNAUTHORIZED=false[[:space:]]*$' /etc/vexortech/migrate.env
grep -Eq '^\[vexortech_backup\][[:space:]]*$' /etc/vexortech/pg_service.conf
/usr/bin/node -e "const [major,minor]=process.versions.node.split('.').map(Number); if(major<22||(major===22&&minor<12)) process.exit(1)"
```

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
# credential is created. The canonical runtime environment remains untouched
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

# Neste ponto, provisione por canal secreto uma senha SCRAM aleatoria para a role
# vexortech_runtime criada pela migration e gere CANDIDATE_ENV atomicamente a
# partir do ambiente ativo. Nao altere RUNTIME_ENV ainda: ele e o rollback da
# release corrente. Nao passe a senha em argumento, SQL inline, log ou historico
# do shell. CANDIDATE_ENV deve ser root:www-data:0640 e DATABASE_URL deve usar
# vexortech_runtime.
test "$(stat -c '%U:%G:%a' "$RUNTIME_ENV")" = "root:www-data:640"
test "$(stat -c '%U:%G:%a' "$CANDIDATE_ENV")" = "root:www-data:640"
systemd-run --quiet --wait --pipe --collect \
  --unit="vexortech-runtime-env-$RELEASE_ID" \
  --property=Type=oneshot \
  --property=User=www-data \
  --property=Group=www-data \
  --property="WorkingDirectory=$RELEASE_DIR" \
  --property="EnvironmentFile=$CANDIDATE_ENV" \
  /usr/bin/node -e 'const u=new URL(process.env.DATABASE_URL||"");if(decodeURIComponent(u.username)!=="vexortech_runtime")process.exit(1)'

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

## 7. Corte blue/green com rollback automatico

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
    install_site_atomically "$CANDIDATE_CONFIG"
    nginx -t
    systemctl reload nginx
    echo "processo antigo indisponivel; candidata foi mantida em 3101" >&2
  else
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
  "$RELEASE_DIR/deploy/nginx-vexortech.conf")" -eq 8
sed 's/127\.0\.0\.1:3000/127.0.0.1:3101/g' \
  "$RELEASE_DIR/deploy/nginx-vexortech.conf" > "$CANDIDATE_CONFIG"
test "$(grep -Fc '127.0.0.1:3101' "$CANDIDATE_CONFIG")" -eq 8
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

## 8. Smoke publico e observacao

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

## 9. Rollback da aplicacao e das configuracoes

Rollback nao desfaz migration automaticamente. Antes de voltar o binario, confirme
que a release anterior e compativel com o schema forward. Se nao for, corrija
forward; restauracao de banco exige janela, aprovacao e plano separado.

```bash
set -Eeuo pipefail
APP_ROOT=/var/www/vexortech
CONFIG_BACKUP="/var/backups/vexortech/config-RELEASE_ID_COM_FALHA"
SYSTEMD_UNIT=/etc/systemd/system/vexortech.service
NGINX_SITE=/etc/nginx/sites-enabled/vexortech
PREVIOUS_RELEASE="$(cat "$CONFIG_BACKUP/previous-release")"
test -d "$PREVIOUS_RELEASE"

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

Conserve a release anterior, o dump custom e o backup de configuracao ate o fim da
janela de observacao. So depois remova artefatos antigos de forma manual e
explicitamente revisada.
