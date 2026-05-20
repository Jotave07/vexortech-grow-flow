#!/bin/bash
# QUICK START - Execute isto na VPS para fazer deploy completo

# ═══════════════════════════════════════════════════════════════════════════
# 1. CONECTAR NA VPS (execute no seu terminal local)
# ═══════════════════════════════════════════════════════════════════════════
# ssh root@187.77.54.38
# Senha: #Joaovitor07

# ═══════════════════════════════════════════════════════════════════════════
# 2. EXECUTE TUDO ISTO NA VPS:
# ═══════════════════════════════════════════════════════════════════════════

set -e  # Exit on any error

echo "╔════════════════════════════════════════╗"
echo "║   HYPE DELIVERY - DEPLOY RÁPIDO       ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Ir para diretório do projeto
cd /home/vexortech/vexortech-grow-flow

# PASSO 1: Atualizar código
echo -e "${CYAN}→${NC} Passo 1: Atualizando código..."
git pull origin main || echo -e "${YELLOW}⚠${NC} Git pull falhou, continuando..."
echo ""

# PASSO 2: Instalar dependências
echo -e "${CYAN}→${NC} Passo 2: Instalando dependências..."
npm ci
echo -e "${GREEN}✓${NC} Dependências instaladas"
echo ""

# PASSO 3: Build
echo -e "${CYAN}→${NC} Passo 3: Compilando aplicação..."
npm run build
echo -e "${GREEN}✓${NC} Build concluído"
echo ""

# PASSO 4: Bootstrap do banco (primeira vez)
echo -e "${CYAN}→${NC} Passo 4: Verificando banco de dados..."
if psql -h localhost -U vitor -d hype_delivery -c "\dt public.auth_users" 2>/dev/null | grep -q "auth_users"; then
    echo -e "${GREEN}✓${NC} Banco já existe, pulando bootstrap"
else
    echo -e "${YELLOW}⚠${NC} Banco novo, executando bootstrap..."
    npm run db:bootstrap
    echo -e "${GREEN}✓${NC} Bootstrap concluído"
fi
echo ""

# PASSO 5: Sincronizar dados (OPCIONAL)
echo -e "${CYAN}→${NC} Passo 5: Sincronizar dados do Supabase?"
read -p "Deseja sincronizar agora? (s/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Ss]$ ]]; then
    echo -e "${YELLOW}⚠${NC} Isto pode levar alguns minutos..."
    npm run db:migrate-from-supabase
    echo -e "${GREEN}✓${NC} Sincronização concluída"
else
    echo -e "${YELLOW}⚠${NC} Sincronização pulada"
fi
echo ""

# PASSO 6: Copiar arquivos
echo -e "${CYAN}→${NC} Passo 6: Copiando arquivos de produção..."
sudo cp -r .output/* /var/www/vexortech-grow-flow/
echo -e "${GREEN}✓${NC} Arquivos copiados"
echo ""

# PASSO 7: Atualizar serviço systemd
echo -e "${CYAN}→${NC} Passo 7: Atualizando serviço systemd..."
sudo cp deploy/vexortech.service /etc/systemd/system/vexortech.service
sudo systemctl daemon-reload
sudo systemctl enable vexortech
echo -e "${GREEN}✓${NC} Serviço configurado"
echo ""

# PASSO 8: Reiniciar
echo -e "${CYAN}→${NC} Passo 8: Reiniciando serviço..."
sudo systemctl restart vexortech
sleep 2
echo -e "${GREEN}✓${NC} Serviço reiniciado"
echo ""

# PASSO 9: Validar
echo -e "${CYAN}→${NC} Passo 9: Validando..."

if sudo systemctl is-active --quiet vexortech; then
    echo -e "${GREEN}✓${NC} Serviço está ativo"
else
    echo -e "${RED}✗${NC} Serviço não está respondendo"
    echo "Verificar logs:"
    sudo journalctl -u vexortech -n 20
    exit 1
fi

# Testar API
sleep 1
if curl -s http://localhost:3000/api/health > /dev/null; then
    echo -e "${GREEN}✓${NC} API respondendo"
else
    echo -e "${YELLOW}⚠${NC} API não respondendo em http://localhost:3000"
fi

# Verificar banco
STORE_COUNT=$(psql -h localhost -U vitor -d hype_delivery -t -c "SELECT COUNT(*) FROM stores;" 2>/dev/null || echo "0")
echo -e "${GREEN}✓${NC} Banco contém $STORE_COUNT lojas"

echo ""
echo "╔════════════════════════════════════════╗"
echo "║   ✓ DEPLOY CONCLUÍDO COM SUCESSO!    ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "Próximas etapas:"
echo "1. Testar em: https://hypedelivery.com.br"
echo "2. Ver logs: sudo journalctl -u vexortech -f"
echo "3. Revogar credenciais (ver DEPLOY_CHECKLIST.md)"
echo ""
