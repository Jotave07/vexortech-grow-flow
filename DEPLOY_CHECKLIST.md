# 🚀 CHECKLIST DE DEPLOY - VPS HYPE DELIVERY

## 📋 PRÉ-REQUISITOS
- [ ] SSH acesso confirmado: `ssh root@187.77.54.38`
- [ ] PostgreSQL rodando: `sudo systemctl status postgresql`
- [ ] Node.js instalado: `node --version` (v18+)
- [ ] Git instalado: `git --version`

## 🔄 EXECUTAR NA VPS

### 1️⃣ SSH na VPS
```bash
ssh root@187.77.54.38
# Senha: #Joaovitor07
```

### 2️⃣ Executar Deploy Automático
```bash
cd /home/vexortech/vexortech-grow-flow

# Dar permissão de execução
chmod +x scripts/deploy-vps.sh

# Executar script de deploy
bash scripts/deploy-vps.sh
```

**Este script automaticamente irá:**
- [ ] Fazer git pull das atualizações
- [ ] Instalar dependências (npm ci)
- [ ] Build da aplicação
- [ ] Executar bootstrap do banco (se necessário)
- [ ] Sincronizar dados do Supabase
- [ ] Copiar arquivos de produção
- [ ] Reiniciar serviço vexortech
- [ ] Validar que tudo está funcionando

### 3️⃣ Se o Script Automático Falhar, Executar Manualmente

```bash
# Entrar no diretório
cd /home/vexortech/vexortech-grow-flow

# Atualizar código
git pull origin main

# Instalar dependências
npm ci

# Build
npm run build

# Bootstrap (se primeira vez)
npm run db:bootstrap

# Sincronizar dados do Supabase para PostgreSQL
# (Configure temporariamente as variáveis do Supabase no .env)
npm run db:migrate-from-supabase

# Copiar build files
sudo cp -r .output/* /var/www/vexortech-grow-flow/

# Reiniciar serviço
sudo systemctl restart vexortech

# Verificar status
sudo systemctl status vexortech
```

## 🔍 TESTES APÓS DEPLOY

### API está respondendo?
```bash
curl http://localhost:3000/api/health
# Esperado: {"status":"ok"}
```

### Serviço está ativo?
```bash
sudo systemctl status vexortech
# Esperado: active (running)
```

### Ver logs em tempo real
```bash
sudo journalctl -u vexortech -f
```

### Verificar banco de dados
```bash
psql -h localhost -U vitor -d hype_delivery -c "SELECT COUNT(*) FROM stores; SELECT COUNT(*) FROM orders; SELECT COUNT(*) FROM customers;"
```

### Testar Nginx
```bash
curl https://hypedelivery.com.br/api/health
```

## 📊 VALIDAÇÃO DE DADOS

### Comparar contagens (Supabase vs PostgreSQL VPS)

**No Supabase (local):**
```bash
npm run db:shadow-export
```

**No PostgreSQL VPS:**
```bash
psql -h localhost -U vitor -d hype_delivery << EOF
SELECT 'plans' as table_name, COUNT(*) as count FROM plans
UNION ALL SELECT 'stores', COUNT(*) FROM stores
UNION ALL SELECT 'customers', COUNT(*) FROM customers
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'products', COUNT(*) FROM products
ORDER BY 1;
EOF
```

### Verificar integridade de chaves estrangeiras
```bash
psql -h localhost -U vitor -d hype_delivery -c "
SELECT constraint_name, table_name
FROM information_schema.table_constraints
WHERE constraint_type = 'FOREIGN KEY'
ORDER BY table_name;"
```

## ⚠️ ROLLBACK (em caso de problema)

Se algo quebrar, reverter para versão anterior:

```bash
cd /home/vexortech/vexortech-grow-flow

# Ver histórico de git
git log --oneline -n 10

# Reverter para commit anterior
git reset --hard HEAD~1

# Ou reverter para versão específica
git checkout <commit-hash>

# Executar deploy novamente
npm run build
sudo systemctl restart vexortech
```

## 🗄️ BACKUP ANTES DE SINCRONIZAR

```bash
# Backup do banco de dados atual
sudo -u postgres pg_dump hype_delivery > ~/backup_$(date +%Y%m%d_%H%M%S).sql

# Ou comprimir o backup
sudo -u postgres pg_dump hype_delivery | gzip > ~/backup_$(date +%Y%m%d_%H%M%S).sql.gz

# Verificar backup
ls -lh ~/backup_*
```

## 🔐 SEGURANÇA - APÓS COMPLETAR DEPLOY

### ⛔ REVOGAR CREDENCIAIS COMPARTILHADAS

1. **Mudar senha do root:**
```bash
sudo passwd root
# Digite nova senha segura
```

2. **Revogar token Hostinger:** 
   - Acesse: https://hpanel.hostinger.com
   - Vá para: Account → Security
   - Revogue o token: jdKmohpThp0EwQk70GyvYnXiFDrfZ0YhgDqvXygYab43e064

3. **Atualizar .env local:**
```bash
# Gerar novo JWT_SECRET
openssl rand -base64 32
```

4. **Limpar histórico SSH:**
```bash
history -c
rm ~/.bash_history
```

## 📞 TROUBLESHOOTING

### Erro: "bind EADDRINUSE :::3000"
```bash
# Kill processo na porta 3000
sudo lsof -i :3000 | grep LISTEN | awk '{print $2}' | xargs sudo kill -9
sudo systemctl restart vexortech
```

### Erro: "permission denied: /var/www/vexortech-grow-flow"
```bash
# Verificar permissões
ls -la /var/www/vexortech-grow-flow/
sudo chown -R vexortech:vexortech /var/www/vexortech-grow-flow/
```

### Erro: "DATABASE_URL not set"
```bash
# Verificar arquivo de env
sudo cat /etc/vexortech/vexortech.env
# Deve conter DATABASE_URL=postgres://...
```

### Banco de dados não sincroniza
```bash
# Verificar variáveis de Supabase
env | grep SUPABASE

# Se não existem, configurar temporariamente:
export SUPABASE_URL="https://lvwralrefzvpwpynhdrn.supabase.co"
export SUPABASE_ANON_KEY="sua_anon_key_aqui"

npm run db:migrate-from-supabase
```

## ✅ CONFIRMAÇÃO DE SUCESSO

Deploy bem-sucedido quando:

- [x] `sudo systemctl status vexortech` mostra `active (running)`
- [x] `curl http://localhost:3000/api/health` retorna `{"status":"ok"}`
- [x] `psql -U vitor hype_delivery -c "SELECT COUNT(*) FROM stores"` retorna número > 0
- [x] Logs não mostram erros: `sudo journalctl -u vexortech -n 50`
- [x] Site acessível em https://hypedelivery.com.br
- [x] Dados sincronizados corretamente

---

## 📝 NOTAS IMPORTANTES

1. **Não remover dados antigos:** O script usa `ON CONFLICT DO UPDATE`, então não apaga dados existentes
2. **Sincronização incremental:** Pode ser rodada múltiplas vezes com segurança
3. **Senhas não são sincronizadas:** Usuários precisam usar "Esqueci Senha" se virem do Supabase
4. **Monitorar RAM:** PostgreSQL pode usar muita memória em primeira sincronização
5. **Backup regular:** Configure backup diário do PostgreSQL

---

**Última atualização:** 2026-05-20
**Versão:** 1.0
