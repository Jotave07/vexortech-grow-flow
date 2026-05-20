# 📋 GUIA DE DEPLOY PARA VPS

## Credenciais
- **IP**: 187.77.54.38
- **Usuário**: root
- **Senha**: #Joaovitor07
- **DB**: hype_delivery (user: vitor, senha: #Joaovitor07)

## ⚙️ Passo 1: Conectar à VPS

Use Git Bash, WSL ou PuTTY:

```bash
ssh root@187.77.54.38
# Digite a senha quando solicitado
```

## 📦 Passo 2: Atualizar o Código

```bash
cd /home/vexortech/vexortech-grow-flow

# Se usar Git, fazer pull
git pull origin main

# Ou, fazer upload manual dos arquivos do .output
```

## 🔧 Passo 3: Instalar Dependências

```bash
npm ci
```

## 🏗️ Passo 4: Build da Aplicação

```bash
npm run build
```

## 🗄️ Passo 5: Preparar Banco de Dados

### Primeira vez (bootstrap):

```bash
npm run db:bootstrap
```

### Sincronizar dados do Supabase:

```bash
# Configurar temporariamente as variáveis do Supabase no .env:
export SUPABASE_URL="https://lvwralrefzvpwpynhdrn.supabase.co"
export SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Executar migração
npm run db:migrate-from-supabase
```

## 🚀 Passo 6: Atualizar Serviço Systemd

```bash
sudo cp deploy/vexortech.service /etc/systemd/system/vexortech.service
sudo systemctl daemon-reload
sudo systemctl enable vexortech
sudo systemctl restart vexortech

# Verificar status
sudo systemctl status vexortech
```

## ✅ Passo 7: Verificar Nginx

```bash
# Copiar configuração Nginx
sudo cp deploy/nginx-vexortech.conf /etc/nginx/sites-available/vexortech

# Ativar site
sudo ln -s /etc/nginx/sites-available/vexortech /etc/nginx/sites-enabled/

# Testar configuração
sudo nginx -t

# Recarregar Nginx
sudo systemctl reload nginx
```

## 🔍 Passo 8: Testar a Aplicação

```bash
# Ver logs
sudo journalctl -u vexortech -f

# Testar API
curl https://hypedelivery.com.br/api/health

# Verificar banco
psql -h localhost -U vitor -d hype_delivery -c "SELECT COUNT(*) FROM stores;"
```

## 🛡️ ⚠️ IMPORTANTE: APÓS COMPLETAR

1. **Revogar as credenciais compartilhadas:**
   - Mude a senha do root
   - Revogue o token Hostinger
   - Atualize .env com novos secrets
   
2. **Backup:**
   ```bash
   sudo pg_dump -U vitor hype_delivery > backup_$(date +%Y%m%d).sql
   ```

3. **Monitoramento:**
   - Configure alertas de erro
   - Monitore uso de CPU/RAM/Disco
