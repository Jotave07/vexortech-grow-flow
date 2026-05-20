# 🚀 START HERE - Deploy VPS Hype Delivery

## ⚡ TL;DR (30 segundos)

```bash
# 1. Conectar na VPS
ssh root@187.77.54.38  # Senha: #Joaovitor07

# 2. Executar deploy (escolha uma linha abaixo)
bash /home/vexortech/vexortech-grow-flow/QUICK_START_VPS.sh

# 3. Validar
sudo systemctl status vexortech
curl http://localhost:3000/api/health

# 4. ⛔ Revogar credenciais (IMPORTANTE!)
sudo passwd root  # Nova senha
```

---

## 📚 Guias Disponíveis (Escolha um)

### 🟢 **Para Iniciantes**
Leia: **`QUICK_START_VPS.sh`**
- Mais simples
- Passo a passo integrado
- Validações automáticas

### 🟡 **Para Intermediários**
Leia: **`DEPLOY_README.md`**
- 3 opções de deploy
- Explicações claras
- Troubleshooting incluído

### 🔴 **Para Avançados**
Leia: **`DEPLOY_GUIDE.md`** + **`DEPLOY_CHECKLIST.md`**
- Controle total
- Cada passo explicado
- Configurações customizáveis

---

## 🎯 Aqui está o que foi preparado

### ✅ Scripts Prontos para Usar

| Script | Comando | Uso |
|--------|---------|-----|
| **deploy-vps.sh** | `bash scripts/deploy-vps.sh` | VPS (SSH) |
| **QUICK_START_VPS.sh** | `bash QUICK_START_VPS.sh` | VPS (SSH) |
| **deploy-vps.ps1** | `.\deploy-vps.ps1 -Action deploy` | Windows (local) |
| **Manualmente** | Ver `DEPLOY_GUIDE.md` | Passo a passo |

### 📖 Documentação Completa

```
📁 Documentação de Deploy
├── 🎯 ESTE ARQUIVO (START_HERE.md)
├── 🚀 QUICK_START_VPS.sh - Execute isto na VPS
├── 📘 DEPLOY_README.md - Guia visual com 3 opções
├── 📕 DEPLOY_GUIDE.md - Passo a passo detalhado
├── 📙 DEPLOY_CHECKLIST.md - Validação + Troubleshooting
├── 💻 scripts/deploy-vps.sh - Script bash automatizado
├── 💻 scripts/sync-supabase-to-vps.mjs - Sync dados
└── ⚡ deploy-vps.ps1 - Script PowerShell Windows
```

---

## 🔄 O que vai acontecer

```
┌─────────────────────────────────────────────┐
│ 1. Git Pull (atualizar código)             │
├─────────────────────────────────────────────┤
│ 2. NPM CI (instalar deps)                  │
├─────────────────────────────────────────────┤
│ 3. NPM Build (compilar)                    │
├─────────────────────────────────────────────┤
│ 4. DB Bootstrap (setup banco - se novo)    │
├─────────────────────────────────────────────┤
│ 5. DB Sync (importar dados Supabase)       │
├─────────────────────────────────────────────┤
│ 6. Copiar arquivos (produção)              │
├─────────────────────────────────────────────┤
│ 7. Systemctl Restart (reiniciar serviço)   │
├─────────────────────────────────────────────┤
│ 8. Validar (verificar que tudo funciona)   │
└─────────────────────────────────────────────┘

Tempo Total: ~10-15 minutos (depende do tamanho dos dados)
```

---

## 📋 Checklist Rápido

### Antes do Deploy
- [ ] Build local concluído ✅ (já foi feito)
- [ ] SSH acesso verificado (teste: `ssh root@187.77.54.38`)
- [ ] Backup do banco criado (opcional mas recomendado)

### Durante o Deploy
- [ ] Escolher um script acima
- [ ] Executar o script (demora 10-15min)
- [ ] Aceitar sincronização de dados (quando perguntado)

### Depois do Deploy
- [ ] Verificar que serviço está ativo: `sudo systemctl status vexortech`
- [ ] Testar API: `curl http://localhost:3000/api/health`
- [ ] Acessar site: https://hypedelivery.com.br
- [ ] Verificar logs: `sudo journalctl -u vexortech -f`
- [ ] **REVOGAR CREDENCIAIS** ⛔ (MUITO IMPORTANTE!)

---

## ⚠️ Segurança - Após Completar

### Você compartilhou estas credenciais:
```
IP: 187.77.54.38
User: root
Senha: #Joaovitor07
Token Hostinger: jdKmohpThp0EwQk70GyvYnXiFDrfZ0YhgDqvXygYab43e064
DB Password: #Joaovitor07
```

### Execute IMEDIATAMENTE após deploy:

```bash
# 1. SSH na VPS
ssh root@187.77.54.38

# 2. Mudar senha root
sudo passwd root
# Digite uma nova senha forte

# 3. Ir para: https://hpanel.hostinger.com
# Account → Security → Tokens
# Delete o token compartilhado

# 4. Gerar novo JWT_SECRET
openssl rand -base64 32
# Copie o resultado e atualize no .env

# 5. Limpar histórico de bash
history -c
history -w
```

---

## 💡 Dicas

### Se der erro...
1. Leia `DEPLOY_CHECKLIST.md` - Troubleshooting section
2. Verifique logs: `sudo journalctl -u vexortech -n 50`
3. Tente reverter: `git reset --hard HEAD~1` (na VPS)

### Se tudo OK...
1. Monitorar em: `sudo journalctl -u vexortech -f`
2. Testar funcionalidades: https://hypedelivery.com.br
3. Considerar setup de alertas/backup

### Próximas atualizações (futuro)
```bash
cd /home/vexortech/vexortech-grow-flow
git pull origin main
npm run build
sudo systemctl restart vexortech
# Fim! (muito mais rápido depois)
```

---

## 🎓 Qual Script Usar?

### Recomendado: Use `QUICK_START_VPS.sh`
```bash
# Connect
ssh root@187.77.54.38

# Run
bash /home/vexortech/vexortech-grow-flow/QUICK_START_VPS.sh

# Done! ✓
```

**Porque:**
- ✅ Simples
- ✅ Tudo integrado
- ✅ Validações automáticas
- ✅ Colorido e fácil de ler

---

## 📞 Suporte Rápido

| Problema | Solução |
|----------|---------|
| Não conecta SSH | Verificar IP, user, senha |
| Porta 3000 em uso | `sudo lsof -i :3000` e matar |
| Banco não tem dados | Rodar: `npm run db:migrate-from-supabase` |
| Serviço não inicia | Verificar: `sudo journalctl -u vexortech -n 20` |
| Nginx não funciona | Rodar: `sudo nginx -t` e `sudo systemctl reload nginx` |

---

## 🚦 Próximos Passos

### Agora:
1. Escolha um script acima
2. Leia o guia correspondente
3. Execute na VPS

### Depois:
1. Validar funcionalidades
2. Revogar credenciais
3. Monitorar em produção

---

## 📌 Resumo

- ✅ **Build**: Concluído
- ✅ **Scripts**: Criados e testados
- ✅ **Docs**: Completa
- ⏳ **Deploy**: Pronto para você executar
- ⏳ **Segurança**: Revogue credenciais após

---

**Você está pronto! 🎉**

Escolha um script acima e comece.

Em caso de dúvida, leia `DEPLOY_README.md` ou `DEPLOY_CHECKLIST.md`.

Boa sorte! 🚀
