# Deploy Runbook

## Backup

```bash
pg_dump "$DATABASE_URL" > backup-before-fix-$(date +%Y%m%d-%H%M%S).sql
```

## Build e Validacao

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run db:migrate
npm run db:check
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

## Rollback

1. Parar o servico.
2. Voltar o release/symlink para a versao anterior.
3. Restaurar o backup do banco se a migration ja tiver sido aplicada.
4. Reiniciar o servico.
5. Validar `/api/health` e logs.
