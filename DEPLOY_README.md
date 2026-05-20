# 📖 GUIA DE DEPLOY - VEXORTECH HYPE DELIVERY

## 🎯 Objetivo

Atualizar a VPS com o código mais recente do projeto e sincronizar dados do Supabase com o PostgreSQL da VPS, mantendo todas as funcionalidades existentes.

---

## 📁 Arquivos de Deploy Criados

| Arquivo | Descrição | Onde Usar |
|---------|-----------|-----------|
| `scripts/deploy-vps.sh` | Script bash automatizado | VPS (via SSH) |
| `deploy-vps.ps1` | Script PowerShell | Windows (local) |
| `DEPLOY_GUIDE.md` | Guia passo a passo | Referência manual |
| `DEPLOY_CHECKLIST.md` | Checklist e troubleshooting | Validação final |
| `scripts/sync-supabase-to-vps.mjs` | Sincronização de dados | VPS ou local |

---

## 🚀 Como Usar (3 Opções)

### **OPÇÃO 1: Automático via PowerShell (Windows)**

A forma mais fácil se você está usando Windows:

```powershell
cd "c:\Users\ADM\Desktop\Flow-drive\vexortech-grow-flow"

# Deploy completo (build + sincronizar + reiniciar)
.\deploy-vps.ps1 -Action deploy

# Ou apenas sincronizar dados
.\deploy-vps.ps1 -Action sync

# Ou verificar status
.\deploy-vps.ps1 -Action status

# Ou ver logs em tempo real
.\deploy-vps.ps1 -Action logs
```

**Pré-requisitos:**
- SSH instalado (Windows 10+ tem nativo)
- Conexão com a VPS via SSH funcionando

---

### **OPÇÃO 2: Automático via Bash (VPS)**

Conectar diretamente na VPS e executar:

```bash
# Conectar
ssh root@187.77.54.38
# Senha: #Joaovitor07

# Executar script
cd /home/vexortech/vexortech-grow-flow
chmod +x scripts/deploy-vps.sh
bash scripts/deploy-vps.sh
```

**Vantagens:**
- Tudo é feito localmente na VPS
- Mais rápido (sem transferência de arquivos)
- Menos dependências

---

### **OPÇÃO 3: Manual (Passo a Passo)**

Ver arquivo `DEPLOY_GUIDE.md` para instruções detalhadas.

Útil para:
- Debug de problemas
- Customizar cada etapa
- Entender o processo

---

## 📊 O que cada script faz

### `scripts/deploy-vps.sh`

```
1. Atualiza código (git pull)
2. Instala dependências (npm ci)
3. Compila aplicação (npm run build)
4. Bootstrap do banco (se necessário)
5. Sincroniza dados do Supabase
6. Copia arquivos de produção
7. Reinicia serviço (systemctl restart)
8. Valida que tudo está funcionando
```

**Tempo estimado:** 5-15 minutos (depende do tamanho dos dados)

---

### `scripts/sync-supabase-to-vps.mjs`

Sincroniza tabelas do Supabase para PostgreSQL VPS:

```
→ Plans
→ Stores
→ Customers
→ Orders
→ Products
→ Payments
→ Subscriptions
→ E mais 12 tabelas...
```

**Características:**
- Sincronização incremental (não apaga dados existentes)
- Pode ser executado múltiplas vezes com segurança
- Mostra progresso em tempo real
- Valida integridade dos dados

---

## ⚡ Sequência Recomendada

### Primeira Vez (Setup Completo)

1. **Conectar na VPS**
   ```bash
   ssh root@187.77.54.38
   ```

2. **Executar deploy completo**
   ```bash
   bash /home/vexortech/vexortech-grow-flow/scripts/deploy-vps.sh
   ```

3. **Validar tudo está funcionando**
   ```bash
   sudo systemctl status vexortech
   curl http://localhost:3000/api/health
   ```

### Atualizações Futuras (Apenas Código)

```bash
cd /home/vexortech/vexortech-grow-flow
git pull origin main
npm run build
sudo systemctl restart vexortech
```

### Sincronizar Dados Novamente

```bash
npm run db:migrate-from-supabase
```

---

## 🔍 Como Validar o Deploy

### 1. Serviço está rodando?
```bash
sudo systemctl status vexortech
# Esperado: active (running)
```

### 2. API está respondendo?
```bash
curl http://localhost:3000/api/health
# Esperado: {"status":"ok"}
```

### 3. Dados foram sincronizados?
```bash
psql -h localhost -U vitor -d hype_delivery -c "SELECT COUNT(*) FROM stores;"
# Deve retornar número > 0
```

### 4. Logs sem erros?
```bash
sudo journalctl -u vexortech -n 50
# Procurar por linhas com "error" ou "fatal"
```

### 5. Site acessível?
```
https://hypedelivery.com.br
```

---

## 🛠️ Troubleshooting Rápido

| Problema | Solução |
|----------|---------|
| Erro ao conectar via SSH | Verifique IP, usuário e senha |
| Porta 3000 já em uso | `sudo lsof -i :3000` e matar processo |
| Permissão negada | `sudo chown -R vexortech:vexortech /var/www/vexortech-grow-flow/` |
| Banco não sincroniza | Verificar variáveis `SUPABASE_URL` e `SUPABASE_ANON_KEY` |
| Serviço não inicia | `sudo journalctl -u vexortech -n 20` para ver erro |

Ver `DEPLOY_CHECKLIST.md` para troubleshooting completo.

---

## 📋 Pré-requisitos

✅ Já validados:
- [x] Build local concluído com sucesso
- [x] Scripts criados e testados
- [x] Documentação completa

⏳ Você precisa fazer:
- [ ] Conectar à VPS via SSH
- [ ] Executar um dos scripts de deploy
- [ ] Validar que tudo está funcionando
- [ ] **Revogar credenciais** após completar

---

## ⚠️ Segurança

### Credenciais Compartilhadas
Você compartilhou as seguintes informações neste chat:
- IP da VPS: 187.77.54.38
- Senha root: #Joaovitor07
- Token Hostinger: jdKmohpThp0EwQk70GyvYnXiFDrfZ0YhgDqvXygYab43e064
- Senha do banco: #Joaovitor07

### ⛔ APÓS COMPLETAR O DEPLOY:

1. **Mudar senha do root na VPS**
   ```bash
   ssh root@187.77.54.38
   sudo passwd root
   ```

2. **Revogar token Hostinger**
   - Acesse: https://hpanel.hostinger.com
   - Account → Security → Tokens
   - Delete token

3. **Atualizar variáveis sensíveis no `.env`**
   - Gerar novo JWT_SECRET
   - Atualizar chaves Supabase se necessário

---

## 📞 Próximas Ações

1. ✅ **Setup:** Scripts criados e documentação pronta
2. ⏳ **Deploy:** Execute um dos scripts de deploy
3. ⏳ **Validação:** Siga o DEPLOY_CHECKLIST.md
4. ⏳ **Segurança:** Revogue credenciais

---

## 📞 Suporte

Se encontrar problemas:

1. Verifique `DEPLOY_CHECKLIST.md` - Troubleshooting
2. Verifique logs: `sudo journalctl -u vexortech -f`
3. Verifique `.env`: `cat /etc/vexortech/vexortech.env`
4. Reverter se necessário: `git reset --hard HEAD~1`

---

**Última atualização:** 2026-05-20
**Versão:** 1.0
**Status:** ✅ Pronto para deploy
