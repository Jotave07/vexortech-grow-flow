# Deploy Automático para VPS - PowerShell
# Requer: Git Bash, WSL ou conexão SSH configurada

param(
    [string]$Action = "deploy",
    [string]$VPS_IP = "187.77.54.38",
    [string]$VPS_USER = "root"
)

$ErrorActionPreference = "Stop"

# Cores
function Write-Success { Write-Host "✓ $args" -ForegroundColor Green }
function Write-Info { Write-Host "→ $args" -ForegroundColor Cyan }
function Write-Warning { Write-Host "⚠ $args" -ForegroundColor Yellow }
function Write-Error { Write-Host "✗ $args" -ForegroundColor Red }

Write-Host "`n╔════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   DEPLOY VPS - HYPE DELIVERY          ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════╝`n" -ForegroundColor Cyan

# Verificar se temos SSH configurado
function Test-SSH {
    Write-Info "Testando conexão SSH..."
    try {
        $output = ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no "$VPS_USER@$VPS_IP" "echo OK" 2>&1
        if ($output -contains "OK") {
            Write-Success "Conexão SSH funcionando"
            return $true
        }
    } catch {
        Write-Warning "SSH falhou"
        return $false
    }
}

# Função para executar comandos SSH
function Invoke-VpsCommand {
    param([string]$Command)
    
    # Preparar comando multi-linha
    $scriptBlock = @"
#!/bin/bash
set -e
cd /home/vexortech/vexortech-grow-flow
$Command
"@
    
    ssh "$VPS_USER@$VPS_IP" $scriptBlock
}

# AÇÃO: Deploy Completo
function Deploy-VPS {
    Write-Info "Iniciando deploy completo na VPS..."
    
    if (-not (Test-SSH)) {
        Write-Error "Não foi possível conectar via SSH"
        Write-Warning "Por favor, use uma das seguintes opções:"
        Write-Host "  1. Git Bash: git-bash.exe" -ForegroundColor White
        Write-Host "  2. WSL: wsl" -ForegroundColor White
        Write-Host "  3. PuTTY: putty.exe $VPS_IP" -ForegroundColor White
        exit 1
    }
    
    Write-Host "`n1. Atualizando código..." -ForegroundColor Yellow
    Invoke-VpsCommand "git pull origin main"
    Write-Success "Código atualizado"
    
    Write-Host "`n2. Instalando dependências..." -ForegroundColor Yellow
    Invoke-VpsCommand "npm ci"
    Write-Success "Dependências instaladas"
    
    Write-Host "`n3. Compilando aplicação..." -ForegroundColor Yellow
    Invoke-VpsCommand "npm run build"
    Write-Success "Build concluído"
    
    Write-Host "`n4. Copiando arquivos..." -ForegroundColor Yellow
    Invoke-VpsCommand "sudo cp -r .output/* /var/www/vexortech-grow-flow/"
    Write-Success "Arquivos copiados"
    
    Write-Host "`n5. Reiniciando serviço..." -ForegroundColor Yellow
    Invoke-VpsCommand "sudo systemctl restart vexortech"
    Start-Sleep -Seconds 2
    Write-Success "Serviço reiniciado"
    
    Write-Host "`n6. Verificando status..." -ForegroundColor Yellow
    $status = Invoke-VpsCommand "sudo systemctl is-active vexortech"
    if ($status -eq "active") {
        Write-Success "Serviço está ativo!"
    } else {
        Write-Error "Serviço não está respondendo"
    }
}

# AÇÃO: Apenas Sincronizar Dados
function Sync-Data {
    Write-Info "Sincronizando dados Supabase → PostgreSQL..."
    
    if (-not (Test-SSH)) {
        Write-Error "Não foi possível conectar via SSH"
        exit 1
    }
    
    Write-Host "`nAtenção: Este processo pode levar vários minutos!" -ForegroundColor Yellow
    
    Invoke-VpsCommand @"
# Sincronizar dados
npm run db:migrate-from-supabase
"@
    
    Write-Success "Sincronização concluída"
    Write-Info "Verifique os logs com: sudo journalctl -u vexortech -f"
}

# AÇÃO: Verificar Status
function Check-Status {
    Write-Info "Verificando status da aplicação..."
    
    if (-not (Test-SSH)) {
        Write-Error "Não foi possível conectar via SSH"
        exit 1
    }
    
    Write-Host "`nStatus do Serviço:" -ForegroundColor Cyan
    Invoke-VpsCommand "sudo systemctl status vexortech --no-pager | head -n 8"
    
    Write-Host "`nÚltimos 10 logs:" -ForegroundColor Cyan
    Invoke-VpsCommand "sudo journalctl -u vexortech -n 10 --no-pager"
    
    Write-Host "`nContagem de Dados:" -ForegroundColor Cyan
    Invoke-VpsCommand @"
psql -h localhost -U vitor -d hype_delivery -c "
SELECT 'Lojas' as tipo, COUNT(*) FROM stores
UNION ALL
SELECT 'Clientes', COUNT(*) FROM customers
UNION ALL
SELECT 'Pedidos', COUNT(*) FROM orders
UNION ALL
SELECT 'Produtos', COUNT(*) FROM products
ORDER BY 1;"
"@
}

# AÇÃO: Ver Logs
function View-Logs {
    param([int]$Lines = 50)
    
    Write-Info "Exibindo últimos $Lines logs..."
    
    if (-not (Test-SSH)) {
        Write-Error "Não foi possível conectar via SSH"
        exit 1
    }
    
    Write-Host "`nLogs em tempo real (Ctrl+C para sair):" -ForegroundColor Yellow
    ssh "$VPS_USER@$VPS_IP" "sudo journalctl -u vexortech -f --lines=$Lines"
}

# Processar ação
switch ($Action.ToLower()) {
    "deploy" { Deploy-VPS }
    "sync" { Sync-Data }
    "status" { Check-Status }
    "logs" { View-Logs }
    default {
        Write-Host "Uso: .\deploy-vps.ps1 [-Action <ação>]" -ForegroundColor White
        Write-Host "`nAções disponíveis:" -ForegroundColor Cyan
        Write-Host "  deploy  : Deploy completo (build + sincronizar + reiniciar)" -ForegroundColor White
        Write-Host "  sync    : Apenas sincronizar dados Supabase → PostgreSQL" -ForegroundColor White
        Write-Host "  status  : Verificar status da aplicação" -ForegroundColor White
        Write-Host "  logs    : Ver logs em tempo real" -ForegroundColor White
        Write-Host "`nExemplos:" -ForegroundColor Cyan
        Write-Host "  .\deploy-vps.ps1 -Action deploy" -ForegroundColor Gray
        Write-Host "  .\deploy-vps.ps1 -Action sync" -ForegroundColor Gray
        Write-Host "  .\deploy-vps.ps1 -Action status" -ForegroundColor Gray
        exit 1
    }
}

Write-Host "`n✓ Concluído!" -ForegroundColor Green
