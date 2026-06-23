#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Hype Delivery - Deploy completo para VPS Hostinger
Empacota, envia via SFTP e reinicia o servico.
"""

import paramiko
import os
import sys
import time
import tarfile
import io
from pathlib import Path

# Fix Windows encoding
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# -- CONFIG -------------------------------------------------
HOST = "187.77.54.38"
USER = "root"
PASS = "#Joaovitor07"
PORT = 22

PROJECT_DIR = Path(r"c:\Users\ADM\Desktop\Flow-drive\vexortech-grow-flow")
OUTPUT_DIR = PROJECT_DIR / ".output"
DEPLOY_DIR = "/var/www/vexortech/current"
SERVICE_NAME = "vexortech"
TAR_NAME = "deploy.tar.gz"

ssh = None
sftp = None


def log(msg):
    print(f"  {msg}")


def step(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def connect():
    global ssh, sftp
    log(f"Conectando em {USER}@{HOST}:{PORT}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(
        HOST,
        port=PORT,
        username=USER,
        password=PASS,
        timeout=60,
        banner_timeout=60,
        auth_timeout=60,
        look_for_keys=False,
        allow_agent=False,
    )
    sftp = ssh.open_sftp()
    log("Conexao SSH estabelecida.")


def run_remote(cmd, show_output=True):
    """Executa comando remoto e retorna stdout/stderr."""
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=600)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if show_output and out.strip():
        for line in out.strip().splitlines():
            print(f"    {line}")
    if err.strip():
        for line in err.strip().splitlines():
            print(f"    [stderr] {line}")
    return out, err


def package_build():
    """Empacota build, scripts de banco e manifesto npm em tar.gz em memoria."""
    step("Empacotando build (.output + runtime -> tar.gz)")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for root, dirs, files in os.walk(OUTPUT_DIR):
            for fname in files:
                fpath = os.path.join(root, fname)
                arcname = os.path.relpath(fpath, OUTPUT_DIR)
                tar.add(fpath, arcname=arcname)
        for rel in ("package.json", "package-lock.json"):
            fpath = PROJECT_DIR / rel
            if fpath.exists():
                tar.add(fpath, arcname=rel)
        for rel in ("scripts/migrate.mjs", "scripts/check-schema.mjs"):
            fpath = PROJECT_DIR / rel
            if fpath.exists():
                tar.add(fpath, arcname=rel)
        migrations_dir = PROJECT_DIR / "db" / "migrations"
        if migrations_dir.exists():
            for root, dirs, files in os.walk(migrations_dir):
                for fname in files:
                    fpath = Path(root) / fname
                    arcname = fpath.relative_to(PROJECT_DIR)
                    tar.add(fpath, arcname=str(arcname).replace("\\", "/"))
    buf.seek(0)
    size_mb = len(buf.getvalue()) / (1024 * 1024)
    log(f"Pacote criado: {size_mb:.1f} MB")
    return buf


def upload_and_extract(tar_buf):
    """Envia tar.gz para a VPS e extrai no diretorio de deploy."""
    step("Enviando pacote para a VPS...")
    remote_tar = f"/tmp/{TAR_NAME}"

    # Upload com barra de progresso
    total = len(tar_buf.getvalue())
    log(f"Enviando {total/(1024*1024):.1f} MB...")
    sftp.putfo(tar_buf, remote_tar)
    log("Upload concluido.")

    log("Parando servico...")
    run_remote(f"systemctl stop {SERVICE_NAME}", show_output=False)

    log("Limpando diretorio atual...")
    run_remote(f"rm -rf {DEPLOY_DIR}/* 2>/dev/null || true", show_output=False)
    run_remote(f"mkdir -p {DEPLOY_DIR}", show_output=False)

    log("Extraindo build...")
    out, err = run_remote(f"tar -xzf {remote_tar} -C {DEPLOY_DIR}", show_output=False)
    if err.strip():
        log(f"Aviso na extracao: {err.strip()[:200]}")

    log("Limpando tar temporario...")
    run_remote(f"rm -f {remote_tar}", show_output=False)

    # Verifica se extraiu corretamente
    out, _ = run_remote(f"ls {DEPLOY_DIR}/server/index.mjs 2>&1")
    if "index.mjs" not in out:
        log("ERRO: server/index.mjs nao encontrado apos extracao!")
        return False

    log("Instalando dependencias de producao...")
    out, _ = run_remote(
        f"cd {DEPLOY_DIR} && npm ci --omit=dev --no-audit --no-fund && echo __NPM_CI_OK__",
        show_output=True,
    )
    if "__NPM_CI_OK__" not in out:
        log("ERRO: npm ci de producao falhou.")
        return False

    log("Aplicando migracoes e validando schema...")
    out, _ = run_remote(
        f"cd {DEPLOY_DIR} && "
        "set -a && . /etc/vexortech/vexortech.env && set +a && "
        "mkdir -p /var/backups/vexortech && "
        "pg_dump \"$DATABASE_URL\" > /var/backups/vexortech/backup-before-$(date +%Y%m%d-%H%M%S)-deploy.dump && "
        "npm run db:migrate && npm run db:check && echo __DB_CHECK_OK__",
        show_output=True,
    )
    if "__DB_CHECK_OK__" not in out:
        log("ERRO: migracao ou check de schema falhou.")
        return False

    log("Build extraido com sucesso.")
    return True


def setup_service():
    """Garante que o servico systemd e o env estao configurados."""
    step("Verificando systemd e ambiente...")

    # Cria diretorio de env se nao existir
    run_remote("mkdir -p /etc/vexortech", show_output=False)

    # Verifica se o arquivo .env existe
    out, _ = run_remote("test -s /etc/vexortech/vexortech.env && echo ENV_OK || echo ENV_MISSING")
    if "ENV_OK" not in out:
        log("AVISO: /etc/vexortech/vexortech.env nao encontrado na VPS!")
        log("Crie o arquivo com as variaveis de ambiente necessarias.")
        log("  Veja .env.example e deploy/VPS_BACKEND.md")
    else:
        log(".env encontrado na VPS.")

    # Copia o .service local
    local_service = PROJECT_DIR / "deploy" / "vexortech.service"
    if local_service.exists():
        log("Atualizando vexortech.service...")
        sftp.put(str(local_service), "/tmp/vexortech.service")
        run_remote("cp /tmp/vexortech.service /etc/systemd/system/vexortech.service")
        run_remote("rm /tmp/vexortech.service")
        run_remote("systemctl daemon-reload")

    log("Servico systemd configurado.")


def start_and_verify():
    """Inicia o servico e verifica saude."""
    step("Iniciando aplicacao...")

    run_remote(f"systemctl start {SERVICE_NAME}", show_output=False)
    log("Aguardando startup...")
    time.sleep(5)

    # Verifica status
    out, _ = run_remote(f"systemctl is-active {SERVICE_NAME}")
    status = out.strip()
    log(f"Status do servico: {status}")

    if status != "active":
        log("Tentando novamente apos erro...")
        run_remote(f"systemctl restart {SERVICE_NAME}", show_output=False)
        time.sleep(8)
        out, _ = run_remote(f"systemctl is-active {SERVICE_NAME}")
        status = out.strip()
        log(f"Status do servico (2a tentativa): {status}")

    # Mostra ultimas linhas do log
    log("Ultimas linhas do log:")
    out, _ = run_remote(f"journalctl -u {SERVICE_NAME} --no-pager -n 25")
    print(out)

    # Health check
    log("Testando health endpoint...")
    time.sleep(2)
    out, _ = run_remote("curl -sf http://127.0.0.1:3000/api/health 2>&1 || echo 'FAIL'")
    log(f"Health check: {out.strip()[:300]}")

    return status == "active"


def cleanup():
    if sftp:
        sftp.close()
    if ssh:
        ssh.close()
    log("Conexao SSH fechada.")


def main():
    print("=" * 60)
    print("  HYPE DELIVERY - DEPLOY VPS HOSTINGER")
    print("=" * 60)
    print(f"  Destino: {USER}@{HOST}:{PORT}")
    print(f"  App:     {DEPLOY_DIR}")
    print(f"  Servico: {SERVICE_NAME}")

    try:
        connect()

        # Verifica se build existe
        if not (OUTPUT_DIR / "server" / "index.mjs").exists():
            log("Build nao encontrada. Rodando npm run build...")
            import subprocess
            subprocess.run(["npm", "run", "build"], cwd=PROJECT_DIR, shell=True, check=True)

        tar_buf = package_build()
        setup_service()
        ok = upload_and_extract(tar_buf)
        if not ok:
            print("\n  FALHA na extracao. Abortando.")
            sys.exit(1)

        success = start_and_verify()

        if success:
            print(f"\n{'='*60}")
            print("  [OK] DEPLOY CONCLUIDO COM SUCESSO!")
            print(f"  https://hypedelivery.com.br")
            print(f"{'='*60}")
        else:
            print(f"\n{'='*60}")
            print("  [AVISO] Servico pode nao estar saudavel.")
            print("  Verifique: ssh root@187.77.54.38")
            print("  journalctl -u vexortech -f")
            print(f"{'='*60}")
            sys.exit(1)

    except Exception as e:
        print(f"\n  [ERRO] {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        cleanup()


if __name__ == "__main__":
    main()
