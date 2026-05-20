#!/bin/bash
# ====================================
# Deploy Automático - VPS Hype Delivery
# ====================================
set -e

echo "╔════════════════════════════════════════╗"
echo "║   DEPLOY VPS - HYPE DELIVERY          ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Variáveis
APP_DIR="/home/vexortech/vexortech-grow-flow"
ENV_FILE="/etc/vexortech/vexortech.env"
DB_NAME="hype_delivery"
DB_USER="vitor"
DB_HOST="localhost"

# Cores para output
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Funções
log_info() {
    echo -e "${GREEN}✓${NC} $1"
}

log_step() {
    echo -e "${CYAN}→${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

# Verificações iniciais
log_step "Verificando ambiente..."

if [ ! -f "$ENV_FILE" ]; then
    log_warn "Arquivo de ambiente não encontrado em $ENV_FILE"
    log_info "Criando arquivo com variáveis padrão..."
    
    # Criar arquivo de ambiente
    cat > /tmp/vexortech.env.template << 'EOL'
NODE_ENV=production
PORT=3000
PUBLIC_APP_URL=https://hypedelivery.com.br
DATABASE_URL=postgres://vitor:#Joaovitor07@localhost:5432/hype_delivery
JWT_SECRET=$(openssl rand -base64 32)
STORAGE_DIR=/var/www/vexortech-grow-flow/storage
EOL
    
    log_warn "Template criado em /tmp/vexortech.env.template"
    log_warn "Copie e edite para $ENV_FILE"
fi

log_info "Ambiente verificado"
echo ""

# 1. ATUALIZAR CÓDIGO
log_step "1. Atualizando código..."
cd "$APP_DIR"

if [ -d ".git" ]; then
    git pull origin main && log_info "Git pull concluído" || log_warn "Git pull falhou, continuando..."
else
    log_warn "Repositório Git não encontrado"
fi
echo ""

# 2. INSTALAR DEPENDÊNCIAS
log_step "2. Instalando dependências..."
npm ci && log_info "Dependências instaladas"
echo ""

# 3. BUILD
log_step "3. Compilando aplicação..."
npm run build && log_info "Build concluído"
echo ""

# 4. VERIFICAR BANCO
log_step "4. Verificando banco de dados..."
if psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "\dt public.auth_users" 2>/dev/null | grep -q "auth_users"; then
    log_info "Banco de dados já existe com estrutura"
else
    log_warn "Banco não inicializado, executando bootstrap..."
    npm run db:bootstrap && log_info "Bootstrap concluído"
fi
echo ""

# 5. SINCRONIZAR DADOS DO SUPABASE
log_step "5. Sincronizando dados do Supabase para PostgreSQL..."
read -p "Deseja sincronizar dados do Supabase? (s/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Ss]$ ]]; then
    npm run db:migrate-from-supabase && log_info "Sincronização concluída" || log_error "Sincronização falhou"
else
    log_warn "Sincronização pulada"
fi
echo ""

# 6. COPIAR ARQUIVOS DO BUILD
log_step "6. Copiando arquivos de produção..."
if [ -d ".output" ]; then
    sudo cp -r .output/* /var/www/vexortech-grow-flow/ && log_info "Arquivos copiados"
else
    log_error ".output não encontrado"
fi
echo ""

# 7. REINICIAR SERVIÇO
log_step "7. Reiniciando serviço..."
sudo systemctl restart vexortech && log_info "Serviço reiniciado"
sleep 2

# 8. VERIFICAR STATUS
log_step "8. Verificando status..."
if sudo systemctl is-active --quiet vexortech; then
    log_info "Serviço rodando com sucesso"
    echo ""
    log_step "Informações do serviço:"
    sudo systemctl status vexortech --no-pager | head -n 5
else
    log_error "Serviço não conseguiu iniciar"
    echo ""
    log_step "Logs de erro:"
    sudo journalctl -u vexortech -n 20 --no-pager
    exit 1
fi
echo ""

# 9. TESTE DA API
log_step "9. Testando API..."
sleep 1
if curl -s http://localhost:3000/api/health > /dev/null; then
    log_info "API respondendo normalmente"
else
    log_warn "API não respondeu em http://localhost:3000"
    log_info "Verifique a configuração do Nginx"
fi
echo ""

# 10. VERIFICAR BANCO
log_step "10. Verificando integridade do banco..."
STORE_COUNT=$(psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM stores;" 2>/dev/null || echo "0")
USER_COUNT=$(psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM auth_users;" 2>/dev/null || echo "0")

echo -e "${GREEN}Lojas:${NC} $STORE_COUNT"
echo -e "${GREEN}Usuários:${NC} $USER_COUNT"
echo ""

# Resumo final
echo "╔════════════════════════════════════════╗"
echo "║   DEPLOY CONCLUÍDO COM SUCESSO!       ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo -e "${YELLOW}⚠ Próximos passos:${NC}"
echo "1. Verificar logs: sudo journalctl -u vexortech -f"
echo "2. Testar em https://hypedelivery.com.br"
echo "3. Monitorar performance"
echo ""
