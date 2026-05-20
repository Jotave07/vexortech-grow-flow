# Script de Deploy para VPS
# Variables
$VPS_IP = "187.77.54.38"
$VPS_USER = "root"
$VPS_PASSWORD = "#Joaovitor07"
$VPS_PORT = 22
$APP_DIR = "/home/vexortech/vexortech-grow-flow"
$ENV_FILE = "/etc/vexortech/vexortech.env"

# Database info
$DB_HOST = "localhost"
$DB_NAME = "hype_delivery"
$DB_USER = "vitor"
$DB_PASSWORD = "#Joaovitor07"

Write-Host "=== Iniciando Deploy na VPS ===" -ForegroundColor Green

# Verify local build exists
if (-not (Test-Path ".\.output")) {
    Write-Host "Erro: Build local não encontrado. Execute 'npm run build' primeiro." -ForegroundColor Red
    exit 1
}

Write-Host "✓ Build local validado" -ForegroundColor Green

# Criar arquivo de deployment remoto
$DEPLOY_SCRIPT = @"
#!/bin/bash
set -e

echo "=== Deploy VPS Iniciado ==="

# 1. Atualizar código
cd $APP_DIR
git pull origin main || echo "Git pull falhou, continuando..."

# 2. Instalar dependências
npm ci

# 3. Build
npm run build

# 4. Bootstrap do banco (apenas na primeira vez)
if ! psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "\dt" 2>/dev/null | grep -q "stores"; then
    echo "Banco vazio, executando bootstrap..."
    npm run db:bootstrap
fi

# 5. Atualizar código do servidor
sudo systemctl stop vexortech || true
sleep 2

# 6. Copiar arquivos do build
cp -r .output/* /var/www/vexortech-grow-flow/

# 7. Reiniciar serviço
sudo systemctl start vexortech
sudo systemctl status vexortech

echo "=== Deploy Concluído ==="
"@

Write-Host "Script de deploy criado." -ForegroundColor Green

# Copiar build files para VPS usando SCP
Write-Host "Transferindo arquivos para VPS..." -ForegroundColor Cyan

# Install PSSession modules if needed
$plink = "plink.exe"
$pscp = "pscp.exe"

Write-Host "Nota: Use ferramentas SSH como Git Bash, WSL ou PuTTY para executar:" -ForegroundColor Yellow
Write-Host "ssh root@187.77.54.38" -ForegroundColor White
Write-Host "" 
Write-Host "Comandos a executar na VPS:" -ForegroundColor Yellow
Write-Host "
cd /home/vexortech/vexortech-grow-flow
git pull origin main
npm ci
npm run build
npm run db:bootstrap
npm run db:migrate-from-supabase
sudo systemctl restart vexortech
" -ForegroundColor White
