# Deploy Runbook

## Backup

```bash
pg_dump "$DATABASE_URL" > backup-before-fix-$(date +%Y%m%d-%H%M%S).sql
```

Se o host nao tiver `pg_dump` instalado, execute o backup a partir do container/host PostgreSQL disponivel antes de trocar o symlink da release.

## Build e Validacao

```bash
npm ci --include=dev
npm run typecheck
npm run lint
npm test
npm run build
npm run db:migrate
npm run db:check
npm prune --omit=dev
```

## Restart

```bash
sudo systemctl restart vexortech
sudo systemctl status vexortech --no-pager
```

## Logs

```bash
journalctl -u vexortech -n 200 --no-pager
```

## Healthcheck

```bash
curl -f "$PUBLIC_APP_URL/api/health"
```

O healthcheck valida app, banco, migrations, storage e variaveis obrigatorias sem expor secrets.

Tambem valide pelo dominio publico depois do restart:

```bash
curl -f https://hypedelivery.com.br/api/health
```

## Smoke Test

Validar, em desktop e mobile, pelo menos:

- `/`
- `/lojas`
- `/entrar`
- `/cadastrar`
- `/recuperar-senha`
- `/lojista/entrar`
- `/admin/entrar`
- `/pedido/token-inexistente`
- `/loja/slug-inexistente`

Criterios:

- HTTP 200 ou erro funcional esperado.
- Conteudo visivel.
- Sem erro de console/pagina.
- Sem overflow horizontal inesperado.

## Rollback

1. Parar o servico ou trocar o symlink atomico para a release anterior.
2. Reiniciar o servico.
3. Validar `systemctl status vexortech --no-pager`.
4. Validar `/api/health` no host e no dominio publico.
5. Restaurar o backup do banco somente se a analise exigir rollback de dados/schema.
